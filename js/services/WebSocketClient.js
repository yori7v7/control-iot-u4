import { CONFIG } from '../config.js';
import {
  isCode, isEntityId, isMilliseconds, isName, isNullableText, isNullableTimestamp, isRecord,
} from '../models/validation.js';

const DEMO_EVENTS = new Set(['demo_inicio', 'demo_movimiento', 'demo_fin', 'demo_cancelada', 'demo_error']);
const MAX_EVENT_LENGTH = 16384;
const MAX_RECENT_IDS = 256;

function isNullableCode(value) {
  return value === null || isCode(value);
}

function isInitialState(state, vehicleId) {
  return state === null || (isRecord(state) && state.id_vehiculo === vehicleId &&
    isName(state.vehiculo) && (state.id_comando === null || isEntityId(state.id_comando)) &&
    isNullableText(state.comando) && isNullableCode(state.codigo) &&
    typeof state.conectado === 'boolean' && isNullableTimestamp(state.fecha_actualizacion));
}

function isEvent(event, vehicleId) {
  if (!isRecord(event) || event.id_vehiculo !== vehicleId || !isNullableTimestamp(event.timestamp)) return false;
  if (event.id_evento !== undefined &&
      (typeof event.id_evento !== 'string' || event.id_evento.length === 0 || event.id_evento.length > 128)) {
    return false;
  }

  if (event.tipo_evento === 'estado_actual') {
    return isNullableText(event.comando) && isNullableCode(event.codigo) && isInitialState(event.estado, vehicleId);
  }
  if (event.tipo_evento === 'movimiento') {
    return isEntityId(event.id_comando) && isName(event.comando) && isCode(event.codigo) &&
      typeof event.conectado === 'boolean' && event.origen === 'API';
  }
  if (!DEMO_EVENTS.has(event.tipo_evento) || !isEntityId(event.id_demo) || !isNullableText(event.nombre_demo)) {
    return false;
  }
  if (event.tipo_evento === 'demo_movimiento') {
    return isEntityId(event.id_demo_movimiento) && isEntityId(event.id_comando) &&
      isName(event.comando) && isCode(event.codigo) && isEntityId(event.orden) &&
      isMilliseconds(event.duracion_ms) && isMilliseconds(event.pausa_ms) &&
      typeof event.conectado === 'boolean';
  }
  return isNullableText(event.mensaje);
}

export class WebSocketClient {
  #url;
  #vehicleId;
  #WebSocket;
  #onState;
  #onEvent;
  #onInvalid;
  #retryBaseMs;
  #retryMaxMs;
  #handshakeTimeoutMs;
  #running = false;
  #retryTimer = null;
  #attempts = 0;
  #connection = null;
  #state = 'disconnected';
  #recentIds = new Set();

  constructor({
    url = CONFIG.wsUrl, vehicleId = CONFIG.vehicleId, WebSocketImpl = globalThis.WebSocket,
    onState, onEvent, onInvalid = () => {},
    retryBaseMs = 1000, retryMaxMs = 30000, handshakeTimeoutMs = 7000,
  }) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'wss:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new TypeError('La dirección WebSocket debe ser WSS y no incluir credenciales.');
    }
    if (!isEntityId(vehicleId)) throw new TypeError('El identificador del vehículo no es válido.');
    this.#url = parsed.href;
    this.#vehicleId = vehicleId;
    this.#WebSocket = WebSocketImpl;
    this.#onState = onState;
    this.#onEvent = onEvent;
    this.#onInvalid = onInvalid;
    this.#retryBaseMs = retryBaseMs;
    this.#retryMaxMs = retryMaxMs;
    this.#handshakeTimeoutMs = handshakeTimeoutMs;
  }

  get state() {
    return this.#state;
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#attempts = 0;
    this.#setState('connecting');
    this.#connect();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#release();
    this.#recentIds.clear();
    this.#setState('disconnected');
  }

  #setState(state) {
    if (this.#state === state) return;
    this.#state = state;
    this.#onState(state);
  }

  #connect() {
    if (!this.#running) return;
    let socket;
    try {
      socket = new this.#WebSocket(this.#url);
    } catch {
      this.#retry();
      return;
    }

    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const connection = {
      socket, listeners, openedAt: null,
      timer: setTimeout(() => this.#lost(connection), this.#handshakeTimeoutMs),
    };
    this.#connection = connection;
    socket.addEventListener('open', () => {
      clearTimeout(connection.timer);
      connection.openedAt = Date.now();
      this.#setState('connected');
    }, options);
    socket.addEventListener('message', message => this.#receive(message.data), options);
    socket.addEventListener('close', () => this.#lost(connection), options);
    socket.addEventListener('error', () => this.#lost(connection), options);
  }

  #lost(connection) {
    if (connection !== this.#connection) return;
    if (connection.openedAt !== null && Date.now() - connection.openedAt >= 10000) this.#attempts = 0;
    this.#release();
    this.#retry();
  }

  #release() {
    if (!this.#connection) return;
    const { socket, listeners, timer } = this.#connection;
    this.#connection = null;
    clearTimeout(timer);
    listeners.abort();
    if (socket.readyState < 2) socket.close();
  }

  #retry() {
    if (!this.#running) return;
    const delay = Math.min(this.#retryBaseMs * 2 ** this.#attempts, this.#retryMaxMs);
    this.#attempts = Math.min(this.#attempts + 1, 16);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.#connect();
    }, delay);
    this.#setState('reconnecting');
  }

  #receive(data) {
    let event;
    try {
      if (typeof data === 'string' && data.length <= MAX_EVENT_LENGTH) event = JSON.parse(data);
    } catch {
      // A malformed frame does not affect socket availability.
    }
    if (!isEvent(event, this.#vehicleId)) {
      this.#onInvalid('Se ignoró un evento WSS con formato inválido.');
      return;
    }
    if (event.id_evento !== undefined) {
      if (this.#recentIds.has(event.id_evento)) return;
      this.#recentIds.add(event.id_evento);
      if (this.#recentIds.size > MAX_RECENT_IDS) this.#recentIds.delete(this.#recentIds.values().next().value);
    }
    this.#onEvent(event);
  }
}
