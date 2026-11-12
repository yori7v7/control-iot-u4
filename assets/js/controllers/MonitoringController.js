import { CONFIG } from '../config.js';

const DEMO_TERMINAL_EVENTS = new Set(['demo_fin', 'demo_cancelada', 'demo_error']);

function resource(read) {
  return { read, value: undefined, status: 'idle', dirty: false, request: null };
}

export class MonitoringController {
  #resources;
  #onChange;
  #vehicleId;
  #reconcileDelayMs;
  #timer = null;
  #active = false;
  #connected = false;
  #event = null;
  #preview = null;

  constructor({ readState, readHistory, onChange, vehicleId = CONFIG.vehicleId, reconcileDelayMs = 150 }) {
    this.#resources = { persisted: resource(readState), history: resource(readHistory) };
    this.#onChange = onChange;
    this.#vehicleId = vehicleId;
    this.#reconcileDelayMs = reconcileDelayMs;
  }

  get state() {
    const { persisted, history } = this.#resources;
    return {
      persisted: { status: persisted.status, value: persisted.value },
      history: { status: history.status, value: history.value },
      event: this.#event,
      preview: this.#preview,
      connected: this.#connected,
    };
  }

  activate() {
    if (this.#active) return this.#flush();
    this.#active = true;
    return this.refresh();
  }

  deactivate() {
    this.#active = false;
    clearTimeout(this.#timer);
    this.#timer = null;
    this.#abortReads();
    for (const item of Object.values(this.#resources)) {
      item.dirty = false;
      item.status = item.value === undefined ? 'idle' : 'ready';
    }
    this.#event = null;
    this.#preview = null;
  }

  refresh() {
    if (!this.#active) return Promise.resolve();
    for (const item of Object.values(this.#resources)) {
      if (item.request === null) item.dirty = true;
    }
    return this.#flush();
  }

  setConnected(connected) {
    if (this.#connected === connected) return;
    this.#connected = connected;
    if (!this.#active) return;
    if (connected) {
      this.#abortReads();
      this.#invalidate('persisted', 'history');
    }
    this.#publish();
  }

  handleEvent(event) {
    // The shared WebSocketClient validates payloads and deduplicates event IDs before delivery.
    if (!this.#active || event?.id_vehiculo !== this.#vehicleId) return;
    const type = event.tipo_evento;
    if (type === 'estado_actual' || type === 'movimiento' || type === 'demo_movimiento') {
      this.#event = event;
      this.#preview = event;
      if (type === 'movimiento') this.#invalidate('persisted', 'history');
      else this.#invalidate('persisted');
      this.#publish();
    } else if (DEMO_TERMINAL_EVENTS.has(type)) {
      this.#invalidate('persisted');
      this.#publish();
    }
  }

  #invalidate(...keys) {
    for (const key of keys) {
      const item = this.#resources[key];
      item.dirty = true;
      item.status = 'loading';
    }
    this.#scheduleReconciliation();
  }

  #scheduleReconciliation() {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      void this.#flush();
    }, this.#reconcileDelayMs);
  }

  #flush() {
    if (!this.#active) return Promise.resolve();
    return Promise.all(Object.values(this.#resources).map(item => this.#load(item)));
  }

  #load(item) {
    if (item.request !== null) return item.request.promise;
    if (!item.dirty) return;
    const controller = new AbortController();
    const request = { controller, promise: null };
    item.request = request;
    item.dirty = false;
    item.status = 'loading';

    const isCurrent = () => item.request === request && !item.dirty;
    request.promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return item.read({ signal: controller.signal });
    }).then(value => {
      if (!isCurrent()) return;
      item.value = value;
      item.status = 'ready';
      if (item === this.#resources.persisted) this.#preview = null;
      this.#publish();
    }, () => {
      if (!isCurrent()) return;
      item.status = 'error';
      this.#publish();
    }).finally(() => {
      if (item.request !== request) return;
      item.request = null;
      if (item.dirty) this.#scheduleReconciliation();
    });
    this.#publish();
    return request.promise;
  }

  #abortReads() {
    for (const item of Object.values(this.#resources)) {
      const request = item.request;
      item.request = null;
      request?.controller.abort();
    }
  }

  #publish() {
    this.#onChange(this.state);
  }
}
