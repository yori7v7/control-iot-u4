/** 5.5-K-H: visitor admission for the EXISTING single-page UI.
 * No movement methods; never grants physical control from a status response.
 */
const FALLBACK_BACKOFF_MS = 300_000;
const MIN_RETRY_AFTER_MS = 30_000;
const MAX_RETRY_AFTER_MS = 86_400_000;

export class AdmissionRateLimitError extends Error {
  constructor(retryAfterMs = null) {
    super('Límite temporal de solicitudes');
    this.name = 'AdmissionRateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

function retryAfterMs(header) {
  if (typeof header !== 'string' || !header.trim()) return null;
  const raw = header.trim();
  let ms;
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    if (!Number.isSafeInteger(seconds)) return null;
    ms = seconds * 1000;
  } else {
    const date = Date.parse(raw);
    if (!Number.isFinite(date)) return null;
    ms = date - Date.now();
  }
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.max(MIN_RETRY_AFTER_MS, Math.min(ms, MAX_RETRY_AFTER_MS));
}

export class GuestAdmissionService {
  #client;
  #onChange;
  #setInterval;
  #clearInterval;
  #setTimeout;
  #clearTimeout;
  #now;
  #pollMs;
  #timer = null;
  #retryTimer = null;
  #retryAt = 0;
  #generation = 0;
  #active = false;
  #suspended = false;
  #browserSecret = '';
  #busy = false;
  #phase = 'inactive';
  #code = '';

  constructor({ client, onChange = () => {}, setIntervalImpl = globalThis.setInterval.bind(globalThis),
    clearIntervalImpl = globalThis.clearInterval.bind(globalThis),
    setTimeoutImpl = globalThis.setTimeout.bind(globalThis),
    clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis),
    nowImpl = Date.now, pollMs = 2000 } = {}) {
    if (!client || typeof client.request !== 'function' || typeof client.status !== 'function' ||
        typeof onChange !== 'function' || !Number.isSafeInteger(pollMs) || pollMs < 1000 ||
        typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function' ||
        typeof nowImpl !== 'function') {
      throw new TypeError('Contrato de admisión inválido.');
    }
    this.#client = client;
    this.#onChange = onChange;
    this.#setInterval = setIntervalImpl;
    this.#clearInterval = clearIntervalImpl;
    this.#setTimeout = setTimeoutImpl;
    this.#clearTimeout = clearTimeoutImpl;
    this.#now = nowImpl;
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

  #clearRetryTimer() {
    if (this.#retryTimer !== null) this.#clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #scheduleRetry(generation) {
    if (!this.#active || this.#suspended || generation !== this.#generation ||
        this.#retryTimer !== null) return;
    const delay = Math.max(0, this.#retryAt - this.#now());
    this.#retryTimer = this.#setTimeout(() => {
      this.#retryTimer = null;
      if (!this.#active || this.#suspended || generation !== this.#generation) return;
      if (this.#now() < this.#retryAt) {
        this.#scheduleRetry(generation);
        return;
      }
      this.#retryAt = 0;
      if (this.#browserSecret) void this.refresh();
      else void this.#requestInitial(generation);
    }, delay);
  }

  #rateLimited(error, generation) {
    this.#stopPolling();
    this.#clearRetryTimer();
    const delay = error.retryAfterMs ?? FALLBACK_BACKOFF_MS;
    this.#retryAt = this.#now() + delay;
    this.#notify('rate_limited', this.#browserSecret ? this.#code : '');
    this.#scheduleRetry(generation);
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
      this.#retryAt = 0;
      this.#clearRetryTimer();
      this.#stopPolling();
      this.#notify('waiting', row.display_code);
      this.#timer = this.#setInterval(() => void this.refresh(), this.#pollMs);
    } catch (error) {
      if (!this.#active || this.#suspended || generation !== this.#generation) return;
      this.#browserSecret = '';
      if (error instanceof AdmissionRateLimitError) {
        this.#rateLimited(error, generation);
        return;
      }
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
      if (!row || row.control_fisico !== false || row.simulado !== true || row.canDrive !== false ||
          !['esperando_autorizacion', 'autorizado', 'revocado_o_caducado'].includes(row.estado) ||
          row.display_code !== this.#code) {
        throw new TypeError('Respuesta de autorización no verificable.');
      }
      this.#retryAt = 0;
      this.#clearRetryTimer();
      if (row.estado === 'revocado_o_caducado') {
        this.#browserSecret = '';
        this.#stopPolling();
        this.#notify('revoked');
      } else {
        this.#notify(row.estado === 'autorizado' ? 'approved_virtual' : 'waiting');
        if (this.#timer === null) {
          this.#timer = this.#setInterval(() => void this.refresh(), this.#pollMs);
        }
      }
    } catch (error) {
      if (this.#active && !this.#suspended && generation === this.#generation) {
        if (error instanceof AdmissionRateLimitError) this.#rateLimited(error, generation);
        else this.#notify('unavailable');
      }
      // A session status may be rate-limited too; never poll it every 2 seconds after 429.
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
    this.#clearRetryTimer();
    this.#busy = false;
    this.#notify('unavailable');
  }

  /** Al regresar no reutilizamos el estado anterior: GET al servidor primero. */
  resume() {
    if (!this.#active || !this.#suspended) return;
    this.#suspended = false;
    if (this.#retryAt > this.#now()) {
      this.#notify('rate_limited', this.#browserSecret ? this.#code : '');
      this.#scheduleRetry(this.#generation);
      return;
    }
    this.#retryAt = 0;
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
    this.#clearRetryTimer();
    this.#retryAt = 0;
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
    if (response.status === 429) {
      throw new AdmissionRateLimitError(retryAfterMs(response.headers?.get?.('Retry-After')));
    }
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
