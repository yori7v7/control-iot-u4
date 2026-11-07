import { BACKEND_DETAILS, CONFIG } from '../config.js';
import {
  isCode, isEntityId, isMilliseconds, isName, isNullableTimestamp, isRecord,
} from '../models/validation.js';

const httpMessages = {
  401: 'La API requiere una clave de control.',
  403: 'La API rechazó la clave de control.',
  404: 'El recurso solicitado no existe.',
  409: 'La API detectó un conflicto con el estado actual del recurso.',
  422: 'La API rechazó los datos de la solicitud.',
  429: 'La API recibió demasiadas solicitudes. Intenta nuevamente más tarde.',
  503: 'La API no pudo completar la operación por falta de un servicio requerido.',
};

function isOrderedDemoPlan(rows) {
  if (!Array.isArray(rows)) return false;
  const movementIds = new Set();
  let previousOrder = 0;
  for (const row of rows) {
    if (!isRecord(row) || !isEntityId(row.id_demo_movimiento) || !isEntityId(row.id_comando) ||
        !isEntityId(row.orden) || row.orden <= previousOrder || movementIds.has(row.id_demo_movimiento) ||
        !isName(row.comando) || !isCode(row.codigo) ||
        !isMilliseconds(row.duracion_ms) || !isMilliseconds(row.pausa_ms)) {
      return false;
    }
    previousOrder = row.orden;
    movementIds.add(row.id_demo_movimiento);
  }
  return true;
}

export class ApiError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
  }
}

export class ApiClient {
  #baseUrl;
  #vehicleId;
  #vehiclePath;
  #fetch;
  #timeoutMs;
  #healthTimeoutMs;
  #databaseHealthTimeoutMs;
  #simulation;
  #apiKey = '';

  constructor({
    baseUrl = CONFIG.apiUrl, vehicleId = CONFIG.vehicleId, fetchImpl,
    timeoutMs = CONFIG.requestTimeoutMs, healthTimeoutMs = CONFIG.healthTimeoutMs,
    databaseHealthTimeoutMs = CONFIG.databaseHealthTimeoutMs,
    simulation = false,
  } = {}) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new TypeError('La dirección de la API debe ser HTTPS y no incluir credenciales.');
    }
    if (!isEntityId(vehicleId)) throw new TypeError('El identificador del vehículo no es válido.');
    if (simulation && (!fetchImpl || fetchImpl === globalThis.fetch)) {
      throw new TypeError('La simulación requiere su propio transporte REST.');
    }

    this.#baseUrl = url.href.replace(/\/$/, '');
    this.#vehicleId = vehicleId;
    this.#vehiclePath = `/vehiculos/${vehicleId}`;
    this.#fetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.#timeoutMs = timeoutMs;
    this.#healthTimeoutMs = healthTimeoutMs;
    this.#databaseHealthTimeoutMs = databaseHealthTimeoutMs;
    this.#simulation = simulation;
  }

  get hasApiKey() {
    return this.#simulation || this.#apiKey.length > 0;
  }

  setApiKey(value) {
    if (value === '') {
      this.#apiKey = '';
      return false;
    }
    // Fetch accepts byte strings for header values. Reject control characters before trimming.
    if (this.#simulation || typeof value !== 'string' || /[^\x20-\x7e\xa0-\xff]/.test(value) || !value.trim()) {
      return false;
    }
    this.#apiKey = value.trim();
    return true;
  }

  health({ signal } = {}) {
    return this.#request('/', {
      signal,
      timeoutMs: this.#healthTimeoutMs,
      validate: data => data?.status === 'ok' && typeof data.service === 'string' &&
        ['development', 'production'].includes(data.environment),
    });
  }

  databaseHealth({ signal } = {}) {
    return this.#request('/health/database', {
      signal,
      timeoutMs: this.#databaseHealthTimeoutMs,
      validate: data => data?.status === 'ok' && data.database === 'available',
    });
  }

  getVehicle() {
    return this.#request(this.#vehiclePath, {
      validate: data => isRecord(data) && data.id_vehiculo === this.#vehicleId,
    });
  }

  getCommands() {
    return this.#request(`${this.#vehiclePath}/comandos`, { validate: Array.isArray });
  }

  getDemos() {
    return this.#request(`${this.#vehiclePath}/demos`, { validate: Array.isArray });
  }

  async getDemoMovements(id, { signal } = {}) {
    return this.#request(`${this.#demoPath(id)}/movimientos`, {
      signal,
      validate: isOrderedDemoPlan,
    });
  }

  async sendCommand(id) {
    if (!isEntityId(id)) throw new ApiError('input', 'El identificador del comando no es válido.');
    return this.#request(`${this.#vehiclePath}/movimientos`, {
      method: 'POST',
      body: { id_comando: id },
      validate: data => isRecord(data) && data.resultado === 'ok' &&
        data.id_vehiculo === this.#vehicleId && data.id_comando === id &&
        isName(data.comando) && isCode(data.codigo) && isNullableTimestamp(data.fecha_actualizacion) &&
        typeof data.conectado === 'boolean' && data.origen === 'API',
    });
  }

  async startDemo(id) {
    return this.#request(`${this.#demoPath(id)}/ejecutar`, {
      method: 'POST',
      expectedStatus: 202,
      validate: data => this.#matchesDemo(data, id, 'iniciada'),
    });
  }

  async cancelDemo(id) {
    return this.#request(`${this.#demoPath(id)}/cancelar`, {
      method: 'POST',
      validate: data => this.#matchesDemo(data, id, 'cancelada'),
    });
  }

  #demoPath(id) {
    if (!isEntityId(id)) throw new ApiError('input', 'El identificador de la DEMO no es válido.');
    return `${this.#vehiclePath}/demos/${id}`;
  }

  #matchesDemo(data, id, state) {
    return isRecord(data) && data.id_vehiculo === this.#vehicleId &&
      data.id_demo === id && data.estado === state;
  }

  async #request(path, {
    method = 'GET', body, signal, timeoutMs = this.#timeoutMs, expectedStatus = 200, validate,
  }) {
    const headers = { Accept: 'application/json' };
    if (method === 'POST') {
      if (!this.hasApiKey) throw new ApiError('auth', 'Introduce la clave de control para continuar.');
      if (!this.#simulation) headers['X-API-Key'] = this.#apiKey;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      abort();
    }, timeoutMs);

    try {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      let data;
      try {
        data = await response.json();
      } catch (error) {
        if (controller.signal.aborted || !(error instanceof SyntaxError)) throw error;
      }
      if (!response.ok) {
        if (path === '/health/database' && response.status === 503 && data?.detail === BACKEND_DETAILS.databaseUnavailable) {
          throw new ApiError('database', 'El diagnóstico de Amazon RDS no se pudo completar.', response.status);
        }
        if (path.endsWith('/ejecutar') && response.status === 409 && data?.detail === BACKEND_DETAILS.demoConflict) {
          throw new ApiError('demo-conflict', 'La API informó que puede haber otra DEMO en ejecución.', response.status);
        }
        throw new ApiError('http', httpMessages[response.status] ?? 'La API devolvió un error.', response.status);
      }
      if (response.status !== expectedStatus || !validate(data)) {
        throw new ApiError('format', 'La respuesta de la API no coincide con el formato esperado.', response.status);
      }
      return data;
    } catch (error) {
      if (timedOut) throw new ApiError('timeout', 'La solicitud agotó el tiempo de espera.');
      if (signal?.aborted) throw new ApiError('aborted', 'Se interrumpió la espera de la solicitud.');
      if (error instanceof ApiError) throw error;
      throw new ApiError('network', 'No se pudo contactar con la API. Comprueba la conexión y el origen autorizado.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }
}
