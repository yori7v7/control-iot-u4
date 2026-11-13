/** 5.5-K-H: visitor admission for the EXISTING single-page UI.
 * No movement methods; never grants physical control from a status response.
 */
export class GuestAdmissionService {
  #client;
  #onChange;
  #setInterval;
  #clearInterval;
  #pollMs;
  #timer = null;
  #generation = 0;
  #active = false;
  #browserSecret = '';
  #busy = false;
  #phase = 'inactive';
  #code = '';

  constructor({ client, onChange = () => {}, setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval, pollMs = 2000 } = {}) {
    if (!client || typeof client.request !== 'function' || typeof client.status !== 'function' ||
        typeof onChange !== 'function' || !Number.isSafeInteger(pollMs) || pollMs < 1000) {
      throw new TypeError('Contrato de admisión inválido.');
    }
    this.#client = client;
    this.#onChange = onChange;
    this.#setInterval = setIntervalImpl;
    this.#clearInterval = clearIntervalImpl;
    this.#pollMs = pollMs;
  }

  get state() {
    return Object.freeze({ phase: this.#phase, code: this.#code, canDrive: false });
  }

  #notify(phase, code = this.#code) {
    this.#phase = phase;
    this.#code = code;
    this.#onChange(this.state);
  }

  async start() {
    if (this.#active) return;
    this.#active = true;
    const generation = ++this.#generation;
    this.#notify('requesting', '');
    try {
      const row = await this.#client.request();
      if (!this.#active || generation !== this.#generation) return;
      if (typeof row?.browser_secret !== 'string' || row.browser_secret.length < 32 ||
          !/^[A-F0-9]{8}$/.test(row.display_code) || row.estado !== 'esperando_autorizacion') {
        throw new TypeError('Respuesta de solicitud inválida.');
      }
      this.#browserSecret = row.browser_secret; // ONLY memory. Never put in URL or storage.
      this.#notify('waiting', row.display_code);
      this.#timer = this.#setInterval(() => void this.refresh(), this.#pollMs);
    } catch (_error) {
      if (!this.#active || generation !== this.#generation) return;
      this.#browserSecret = '';
      this.#notify('unavailable', '');
    }
  }

  async refresh() {
    if (!this.#active || !this.#browserSecret || this.#busy) return;
    const generation = this.#generation;
    const secret = this.#browserSecret;
    this.#busy = true;
    try {
      const row = await this.#client.status(secret);
      if (!this.#active || generation !== this.#generation) return;
      if (!row || row.control_fisico !== false || row.simulado !== true ||
          !['esperando_autorizacion', 'autorizado', 'revocado_o_caducado'].includes(row.estado) ||
          row.display_code !== this.#code) {
        throw new TypeError('Respuesta de autorización no verificable.');
      }
      if (row.estado === 'revocado_o_caducado') {
        this.#browserSecret = '';
        this.#stopPolling();
        this.#notify('revoked');
      } else {
        this.#notify(row.estado === 'autorizado' ? 'approved_virtual' : 'waiting');
      }
    } catch (_error) {
      if (this.#active && generation === this.#generation) this.#notify('unavailable');
      // Keep polling if a browser session already exists. No movement at any phase.
    } finally {
      if (generation === this.#generation) this.#busy = false;
    }
  }

  #stopPolling() {
    if (this.#timer !== null) this.#clearInterval(this.#timer);
    this.#timer = null;
  }

  stop() {
    this.#active = false;
    this.#generation++;
    this.#stopPolling();
    this.#busy = false;
    this.#browserSecret = '';
    this.#notify('inactive', '');
  }
}

/** Future HTTPS API contract. Disabled until the protected public backend exists. */
export class GuestAdmissionClient {
  #api;
  #fetch;
  #vehicleId;

  constructor({ apiUrl, vehicleId, fetchImpl = globalThis.fetch } = {}) {
    const url = new URL(apiUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || !Number.isSafeInteger(vehicleId) || vehicleId <= 0 ||
        typeof fetchImpl !== 'function') throw new TypeError('Origen HTTPS inválido.');
    this.#api = url.origin;
    this.#fetch = fetchImpl;
    this.#vehicleId = vehicleId;
  }

  get #path() { return `/publico/vehiculos/${this.#vehicleId}/solicitudes`; }

  async #request(path, { method = 'GET', secret } = {}) {
    const headers = { Accept: 'application/json' };
    if (secret) headers['X-Browser-Session'] = secret;
    const response = await this.#fetch(`${this.#api}${path}`, {
      method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
      referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Servicio de admisión: HTTP ${response.status}`);
    return response.json();
  }

  request() { return this.#request(this.#path, { method: 'POST' }); }
  status(secret) {
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
      throw new TypeError('Sesión de navegador inválida.');
    }
    return this.#request(`${this.#path}/estado`, { secret });
  }
}
