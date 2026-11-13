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
  #suspended = false;
  #browserSecret = '';
  #busy = false;
  #phase = 'inactive';
  #code = '';

  constructor({ client, onChange = () => {}, setIntervalImpl = globalThis.setInterval.bind(globalThis),
    clearIntervalImpl = globalThis.clearInterval.bind(globalThis), pollMs = 2000 } = {}) {
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
    this.#suspended = false;
    this.#active = true;
    const generation = ++this.#generation;
    this.#notify('requesting', '');
    await this.#requestInitial(generation);
  }

  async #requestInitial(generation) {
    if (!this.#active || this.#suspended || generation !== this.#generation || this.#busy) return;
    this.#busy = true;
    try {
      const row = await this.#client.request();
      if (!this.#active || this.#suspended || generation !== this.#generation) return;
      if (typeof row?.browser_secret !== 'string' || row.browser_secret.length < 32 ||
          !/^[A-F0-9]{8}$/.test(row.display_code) || row.estado !== 'esperando_autorizacion' ||
          row.simulado !== true || row.control_fisico !== false || row.canDrive !== false) {
        throw new TypeError('Respuesta de solicitud inválida.');
      }
      this.#browserSecret = row.browser_secret; // ONLY memory. Never put in URL or storage.
      this.#stopPolling();
      this.#notify('waiting', row.display_code);
      this.#timer = this.#setInterval(() => void this.refresh(), this.#pollMs);
    } catch (_error) {
      if (!this.#active || this.#suspended || generation !== this.#generation) return;
      this.#browserSecret = '';
      this.#notify('unavailable', '');
      // Si se pierde la respuesta 201, el cliente repite EL MISMO par K-T
      // en vez de crear tickets nuevos. Nunca solicita movimiento físico.
      if (this.#timer === null) {
        this.#timer = this.#setInterval(() => void this.#requestInitial(generation), this.#pollMs);
      }
    } finally {
      if (generation === this.#generation) this.#busy = false;
    }
  }

  async refresh() {
    if (!this.#active || this.#suspended || !this.#browserSecret || this.#busy) return;
    const generation = this.#generation;
    const secret = this.#browserSecret;
    this.#busy = true;
    try {
      const row = await this.#client.status(secret);
      if (!this.#active || this.#suspended || generation !== this.#generation) return;
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
      if (this.#active && !this.#suspended && generation === this.#generation) this.#notify('unavailable');
      // Keep polling if a browser session already exists. No movement at any phase.
    } finally {
      if (generation === this.#generation) this.#busy = false;
    }
  }

  /** K-N: oculta o sin red = sin autorización comprobable.
   * El secreto solo vive en RAM y se conserva para revalidarlo; NO habilita mando.
   */
  pause() {
    if (!this.#active || this.#suspended) return;
    this.#suspended = true;
    this.#generation++;
    this.#stopPolling();
    this.#busy = false;
    this.#notify('unavailable');
  }

  /** Al regresar no reutilizamos el estado anterior: GET al servidor primero. */
  resume() {
    if (!this.#active || !this.#suspended) return;
    this.#suspended = false;
    if (!this.#browserSecret) {
      // El POST inicial pudo quedar en vuelo; nuevos tickets expiran en servidor.
      this.#active = false;
      void this.start();
      return;
    }
    this.#notify('unavailable');
    void this.refresh();
    this.#timer = this.#setInterval(() => void this.refresh(), this.#pollMs);
  }

  #stopPolling() {
    if (this.#timer !== null) this.#clearInterval(this.#timer);
    this.#timer = null;
  }

  stop() {
    this.#active = false;
    this.#suspended = false;
    this.#generation++;
    this.#stopPolling();
    this.#busy = false;
    this.#browserSecret = '';
    this.#client.reset?.();
    this.#notify('inactive', '');
  }
}

/** Future HTTPS API contract. Disabled until the protected public backend exists. */
export class GuestAdmissionClient {
  #api;
  #fetch;
  #vehicleId;
  #pendingPair = null;

  constructor({ apiUrl, vehicleId, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    const url = new URL(apiUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || !Number.isSafeInteger(vehicleId) || vehicleId <= 0 ||
        typeof fetchImpl !== 'function') throw new TypeError('Origen HTTPS inválido.');
    this.#api = url.origin;
    this.#fetch = fetchImpl;
    this.#vehicleId = vehicleId;
  }

  get #path() { return `/publico/vehiculos/${this.#vehicleId}/solicitudes`; }

  async #request(path, { method = 'GET', secret, pair } = {}) {
    const headers = { Accept: 'application/json' };
    if (secret) headers['X-Browser-Session'] = secret;
    if (pair) {
      headers['Idempotency-Key'] = pair.key;
      headers['X-Browser-Proposal'] = pair.secret;
    }
    const response = await this.#fetch(`${this.#api}${path}`, {
      method, headers, credentials: 'omit', cache: 'no-store', redirect: 'error',
      referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Servicio de admisión: HTTP ${response.status}`);
    return response.json();
  }

  // Aleatoriedad criptográfica del navegador; nunca Math.random.
  static #newRandomToken() {
    if (typeof globalThis.crypto?.getRandomValues !== 'function' ||
        typeof globalThis.btoa !== 'function') {
      throw new Error('Sin generador criptográfico de sesiones seguro.');
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
    return globalThis.btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  request() {
    // Las dos claves viven solamente en RAM y permanecen iguales si el POST
    // fue aceptado pero su respuesta se perdió. Se reemplazan SOLO al cerrar.
    if (this.#pendingPair === null) {
      const key = GuestAdmissionClient.#newRandomToken();
      let secret = GuestAdmissionClient.#newRandomToken();
      while (secret === key) secret = GuestAdmissionClient.#newRandomToken();
      this.#pendingPair = { key, secret };
    }
    return this.#request(this.#path, { method: 'POST', pair: this.#pendingPair })
      .then(row => {
        if (row?.browser_secret !== this.#pendingPair?.secret ||
            row?.simulado !== true || row?.control_fisico !== false ||
            row?.canDrive !== false) {
          throw new TypeError('El servidor no confirmó la misma sesión virtual.');
        }
        return row;
      });
  }

  reset() { this.#pendingPair = null; }

  status(secret) {
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) {
      throw new TypeError('Sesión de navegador inválida.');
    }
    return this.#request(`${this.#path}/estado`, { secret });
  }
}
