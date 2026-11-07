import { CONFIG } from '../config.js';

export class ConnectionService {
  #api;
  #onApiState;
  #onDatabaseState;
  #intervalMs;
  #timer = null;
  #controller = null;
  #pending = null;

  constructor({ api, onApiState, onDatabaseState, intervalMs = CONFIG.healthIntervalMs }) {
    this.#api = api;
    this.#onApiState = onApiState;
    this.#onDatabaseState = onDatabaseState;
    this.#intervalMs = intervalMs;
  }

  start() {
    if (this.#timer !== null) return this.#pending;
    this.#timer = setInterval(() => void this.refresh(), this.#intervalMs);
    return this.refresh();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#controller?.abort();
    this.#controller = null;
    this.#pending = null;
  }

  refresh() {
    if (this.#pending) return this.#pending;

    const controller = new AbortController();
    this.#controller = controller;
    const { signal } = controller;
    this.#onApiState('checking');
    this.#pending = Promise.all([
      this.#probeApi(signal),
      this.#probeDatabase(signal),
    ]).finally(() => {
      if (this.#controller === controller) {
        this.#pending = null;
        this.#controller = null;
      }
    });
    return this.#pending;
  }

  async #probeApi(signal) {
    let state = 'available';
    try {
      await this.#api.health({ signal });
    } catch {
      state = 'unavailable';
    }
    if (!signal.aborted) this.#onApiState(state);
  }

  async #probeDatabase(signal) {
    let state = 'available';
    try {
      await this.#api.databaseHealth({ signal });
    } catch (error) {
      // A network or proxy failure leaves RDS unverified. The dedicated 503 JSON reports failure.
      state = error.kind === 'database' ? 'unavailable' : 'unverified';
    }
    if (!signal.aborted) this.#onDatabaseState(state);
  }
}
