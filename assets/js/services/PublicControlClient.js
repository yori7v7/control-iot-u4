import { CONFIG } from '../config.js';
import { isEntityId, isRecord } from '../models/validation.js';
import { ApiError, isApiKeyInput } from './ApiClient.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const GUEST_DIRECTIONS = Object.freeze([
  'AVANZAR', 'RETROCEDER', 'IZQUIERDA', 'DERECHA',
  'AVANZAR_IZQUIERDA', 'AVANZAR_DERECHA', 'RETROCEDER_IZQUIERDA', 'RETROCEDER_DERECHA',
]);
const PUBLIC_STATES = ['cerrado', 'disponible', 'ocupado', 'deteniendo', 'bloqueado'];
const OPERATION_STATES = ['aceptada', 'despachada', 'finalizada', 'rechazada', 'incierta'];
const STOP_STATES = ['pendiente', 'verificada', 'incierta', 'fallida'];

export const isGuestDirection = action => GUEST_DIRECTIONS.includes(action);
export const isLoopbackHost = host => LOCAL_HOSTS.has(host);

function timestamp(value) {
  return typeof value === 'string' && /(?:Z|[+-]00:00)$/.test(value) && Number.isFinite(Date.parse(value));
}

function nullable(value, validate) {
  return value === null || validate(value);
}

function uuid(value) {
  return typeof value === 'string' && UUID.test(value);
}

function operation(data, vehicleId, states) {
  return isRecord(data) && data.id_vehiculo === vehicleId && data.simulado === true &&
    uuid(data.id_operacion) && isEntityId(data.epoca_operacion) && states.includes(data.estado);
}

function movement(data, vehicleId) {
  return operation(data, vehicleId, OPERATION_STATES) && timestamp(data.creada_en);
}

function stopResult(data, vehicleId) {
  return operation(data, vehicleId, STOP_STATES) && timestamp(data.solicitada_en) &&
    nullable(data.verificada_en, timestamp) && (data.estado !== 'verificada' || data.verificada_en !== null);
}

function publicStatus(data, vehicleId) {
  return isRecord(data) && data.id_vehiculo === vehicleId && typeof data.habilitado === 'boolean' &&
    typeof data.simulado === 'boolean' && PUBLIC_STATES.includes(data.estado) &&
    timestamp(data.hora_servidor) && nullable(data.vence_ventana_en, timestamp) &&
    data.habilitado === (data.vence_ventana_en !== null) &&
    Number.isSafeInteger(data.revision) && data.revision >= 0 &&
    (data.simulado || (!data.habilitado && data.estado === 'cerrado'));
}

function adminStatus(data, vehicleId) {
  return publicStatus(data, vehicleId) && nullable(data.inicio_ventana_en, timestamp) &&
    nullable(data.id_turno_auditoria, uuid) && nullable(data.turno_vence_en, timestamp) &&
    nullable(data.parada, value => stopResult(value, vehicleId)) &&
    nullable(data.motivo_bloqueo, value => typeof value === 'string');
}

function ownTurn(data, vehicleId) {
  return isRecord(data) && data.id_vehiculo === vehicleId && data.simulado === true &&
    ['activo', 'deteniendo'].includes(data.estado) && timestamp(data.vence_en) &&
    timestamp(data.vence_inactividad_en) && timestamp(data.hora_servidor) &&
    Date.parse(data.vence_inactividad_en) <= Date.parse(data.vence_en) &&
    isEntityId(data.epoca_operacion) && isEntityId(data.siguiente_secuencia) &&
    nullable(data.ultima_operacion, value => movement(value, vehicleId));
}

export class PublicControlClient {
  #url;
  #fetch;
  #vehicleId;
  #timeoutMs;
  #simulation;

  constructor({ baseUrl = CONFIG.apiUrl, vehicleId = CONFIG.vehicleId, fetchImpl,
    simulation = false, timeoutMs = 5000 } = {}) {
    const url = new URL(baseUrl);
    const local = isLoopbackHost(url.hostname) && ['http:', 'https:'].includes(url.protocol) &&
      (!globalThis.location || url.origin === globalThis.location.origin);
    if (!isEntityId(vehicleId) || url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
        (simulation ? !local : url.protocol !== 'https:')) {
      throw new TypeError('Origen o vehículo inválido para el control público.');
    }
    this.#url = url.origin;
    this.#vehicleId = vehicleId;
    this.#simulation = simulation;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get simulation() { return this.#simulation; }

  get #guest() { return `/publico/vehiculos/${this.#vehicleId}`; }

  get #admin() { return `/admin/vehiculos/${this.#vehicleId}/control-publico`; }

  getPublic({ signal } = {}) {
    return this.#request(`${this.#guest}/control`, { signal, validate: publicStatus });
  }

  getAdmin(key, { signal } = {}) {
    return this.#request(this.#admin, { key, signal, validate: adminStatus });
  }

  acquire({ signal } = {}) {
    return this.#request(`${this.#guest}/sesion`, {
      method: 'POST', body: {}, expectedStatus: 201, signal,
      validate: (data, vehicleId) => ownTurn(data, vehicleId) && typeof data.token === 'string' && TOKEN.test(data.token),
    });
  }

  getTurn(token = '', { signal } = {}) {
    return this.#request(`${this.#guest}/sesion`, { token, signal, validate: ownTurn });
  }

  release(token = '', { signal } = {}) {
    return this.#request(`${this.#guest}/sesion`, {
      method: 'DELETE', token, expectedStatus: 202, signal, validate: stopResult,
    });
  }

  move(token = '', body, { signal } = {}) {
    return this.#request(`${this.#guest}/sesion/acciones`, {
      method: 'POST', token, body, expectedStatus: 202, signal,
      validate: (data, id) => movement(data, id) && data.epoca_operacion === body.epoca_operacion,
    });
  }

  stop(token = '', id, { signal } = {}) {
    return this.#request(`${this.#guest}/sesion/parada`, {
      method: 'POST', token, body: { id_solicitud: id }, expectedStatus: 202, signal, validate: stopResult,
    });
  }

  enableWindow(key, id, { signal } = {}) {
    return this.#request(`${this.#admin}/ventana`, {
      method: 'PUT', key, body: { id_solicitud: id, duracion_seg: 1200, supervision_confirmada: true },
      signal, validate: adminStatus,
    });
  }

  disableWindow(key, { signal } = {}) {
    return this.#request(`${this.#admin}/ventana`, {
      method: 'DELETE', key, expectedStatus: [200, 202], signal,
      validate: (data, id, status) => (status === 200 ? adminStatus : stopResult)(data, id),
    });
  }

  revoke(key, id, { signal } = {}) {
    return this.#request(`${this.#admin}/revocacion`, {
      method: 'POST', key, body: { id_solicitud: id }, expectedStatus: 202, signal, validate: stopResult,
    });
  }

  async #request(path, { method = 'GET', key, token, body, signal, expectedStatus = 200, validate }) {
    if ((!this.#simulation && (method !== 'GET' || token !== undefined)) ||
        (path.startsWith('/admin/') && !isApiKeyInput(key)) ||
        (token !== undefined && (typeof token !== 'string' || !TOKEN.test(token)))) {
      throw new ApiError('auth', 'La operación requiere un permiso de control simulado válido.');
    }

    const headers = { Accept: 'application/json' };
    if (key) headers['X-API-Key'] = key;
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

    try {
      requestSignal.throwIfAborted();
      const response = await this.#fetch(`${this.#url}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: requestSignal,
      });
      if (!response.ok) throw new ApiError('http', 'La API rechazó la operación de turno.', response.status);
      const data = await response.json().catch(error => {
        if (requestSignal.aborted) throw error;
        throw new ApiError('format', 'La respuesta del control público no es válida.', response.status);
      });
      if (![expectedStatus].flat().includes(response.status) || !validate(data, this.#vehicleId, response.status)) {
        throw new ApiError('format', 'La respuesta del control público no es válida.', response.status);
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw new ApiError('aborted', 'Se interrumpió la consulta de turnos.');
      if (timeout.aborted) throw new ApiError('timeout', 'La consulta de turnos agotó el tiempo de espera.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('network', 'No se pudo contactar al servicio de turnos.');
    }
  }
}
