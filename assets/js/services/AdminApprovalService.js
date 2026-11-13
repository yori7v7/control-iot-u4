/** K-J — Admin approval IN THE EXISTING TURN INSPECTOR; DISABLED in config.
 * No movement methods. The server must enforce admin identity, one active
 * driver, safety fences, token expiration, STOP and device authentication.
 */
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CODE = /^[A-F0-9]{8}$/;
const MODE = new Set(['supervised', 'timed']);

function verifiedList(data) {
  if (!data || !Array.isArray(data.solicitudes) || data.solicitudes.length > 20 ||
      data.control_fisico !== false || data.simulado !== true ||
      typeof data.turno_activo !== 'boolean') throw new TypeError('Estado de autorizaciones inválido.');
  const ids = new Set();
  return {
    active: data.turno_activo,
    pending: data.solicitudes.map(row => {
      if (!row || typeof row.request_id !== 'string' || !UUID.test(row.request_id) ||
          ids.has(row.request_id) || !CODE.test(row.display_code) ||
          !Number.isSafeInteger(row.vence_en_seg) || row.vence_en_seg < 0 || row.vence_en_seg > 300) {
        throw new TypeError('Solicitud no válida.');
      }
      ids.add(row.request_id);
      return Object.freeze({ id: row.request_id, code: row.display_code, seconds: row.vence_en_seg });
    }),
  };
}

export class AdminApprovalClient {
  #base;
  #fetch;

  constructor({ apiUrl, vehicleId, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    const url = new URL(apiUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/' || !Number.isSafeInteger(vehicleId) || vehicleId <= 0 ||
        typeof fetchImpl !== 'function') throw new TypeError('Origen de autorización inválido.');
    this.#base = `${url.origin}/admin/vehiculos/${vehicleId}/control-publico/solicitudes`;
    this.#fetch = fetchImpl;
  }

  async #call(path, key, { method = 'GET', data, signal } = {}) {
    if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw new TypeError('Credencial inválida.');
    const headers = { Accept: 'application/json', 'X-API-Key': key };
    if (data !== undefined) headers['Content-Type'] = 'application/json';
    const response = await this.#fetch(this.#base + path, {
      method, headers, body: data === undefined ? undefined : JSON.stringify(data),
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      redirect: 'error', signal: signal ?? AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Autorización administrativa HTTP ${response.status}`);
    const parsed = await response.json();
    if (!parsed || parsed.control_fisico !== false || parsed.simulado !== true) {
      throw new TypeError('Respuesta del backend no verificable.');
    }
    return parsed;
  }

  pending(key, signal) { return this.#call('', key, { signal }); }
  heartbeat(key, signal) { return this.#call('/supervision', key, { method: 'POST', signal }); }
  approve(key, id, mode, seconds, signal) {
    if (!UUID.test(id) || !MODE.has(mode) ||
        (mode === 'timed' && (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 300))) {
      throw new TypeError('Selección de autorización no válida.');
    }
    const data = { modo: mode };
    if (mode === 'timed') data.segundos = seconds;
    return this.#call(`/${id}/aprobar`, key, { method: 'POST', data, signal });
  }
  reject(key, id, signal) {
    if (!UUID.test(id)) throw new TypeError('Solicitud inválida.');
    return this.#call(`/${id}/rechazar`, key, { method: 'POST', signal });
  }
  revoke(key, signal) { return this.#call('/revocar', key, { method: 'POST', signal }); }
}

export class AdminApprovalService {
  #client; #onChange; #clock; #setInterval; #clearInterval;
  #key = ''; #generation = 0; #timer = null; #beatTimer = null; #abort = null;
  #suspended = false;
  #busy = false; #reading = false; #beating = false; #supervising = false;
  #lastBeat = 0; #phase = 'inactive'; #message = ''; #pending = []; #active = false;

  constructor({ client, onChange = () => {}, clock = () => Date.now(),
    setIntervalImpl = globalThis.setInterval.bind(globalThis), clearIntervalImpl = globalThis.clearInterval.bind(globalThis) } = {}) {
    if (!client || !['pending','heartbeat','approve','reject','revoke'].every(x => typeof client[x] === 'function')
        || typeof onChange !== 'function') throw new TypeError('Cliente de aprobación inválido.');
    this.#client = client; this.#onChange = onChange; this.#clock = clock;
    this.#setInterval = setIntervalImpl; this.#clearInterval = clearIntervalImpl;
  }

  get state() {
    const age = this.#clock() - this.#lastBeat;
    const fresh = !this.#suspended && this.#supervising && this.#lastBeat > 0 && age >= 0 && age < 15000;
    return Object.freeze({
      phase: this.#phase, message: this.#message, pending: Object.freeze([...this.#pending]),
      active: this.#active, supervising: fresh, busy: this.#busy,
      canApprove: this.#phase === 'ready' && fresh && !this.#busy,
      canRevoke: this.#phase === 'ready' && !this.#busy && this.#active,
      canSupervise: this.#phase === 'ready' && !this.#busy && !fresh,
      canEndSupervision: fresh && !this.#busy,
      canDrive: false,
    });
  }

  #notify() { this.#onChange(this.state); }
  #stopIntervals() {
    if (this.#timer !== null) this.#clearInterval(this.#timer);
    if (this.#beatTimer !== null) this.#clearInterval(this.#beatTimer);
    this.#timer = this.#beatTimer = null;
  }
  stop() {
    this.#generation++; this.#abort?.abort(); this.#stopIntervals();
    this.#suspended = false;
    this.#key = ''; this.#abort = null; this.#phase = 'inactive'; this.#message = '';
    this.#pending = []; this.#active = false; this.#supervising = false;
    this.#busy = this.#reading = this.#beating = false; this.#lastBeat = 0;
    this.#notify();
  }
  /** K-N: suspender la UI de inmediato (pestaña oculta, offline).
   * Revocación de red es best-effort; el servidor debe imponer TTL y STOP.
   */
  pause() {
    if (!this.#key || this.#suspended) return Promise.resolve(false);
    const needsRevoke = this.#active || this.#supervising || this.#busy;
    const key = this.#key;
    this.#suspended = true;
    this.#generation++;
    this.#abort?.abort();
    this.#stopIntervals();
    this.#pending = []; this.#active = false; this.#supervising = false;
    this.#lastBeat = 0; this.#reading = false; this.#beating = false; this.#busy = false;
    this.#phase = 'unavailable';
    this.#message = 'Pestaña oculta o sin conexión. Supervisión suspendida; revocación sin confirmar.';
    this.#notify();
    if (!needsRevoke) return Promise.resolve(false);
    return Promise.resolve()
      .then(() => this.#client.revoke(key))
      .then(row => row?.simulado === true && row?.control_fisico === false && row?.revocado === true)
      .catch(() => false);
  }

  /** En primer plano se vuelve a consultar la cola; nunca reanuda el latido. */
  resume() {
    if (!this.#key || !this.#suspended) return;
    this.#suspended = false;
    this.#abort = new AbortController();
    this.#phase = 'checking';
    this.#message = 'Revalidando permisos. Inicia la supervisión manualmente.';
    this.#reading = false;
    this.#notify();
    this.#timer = this.#setInterval(() => void this.refresh(), 2000);
    void this.refresh();
  }

  start(key) {
    if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) return false;
    this.stop();
    this.#suspended = false;
    this.#key = key; this.#abort = new AbortController(); this.#phase = 'checking';
    this.#notify();
    this.#timer = this.#setInterval(() => void this.refresh(), 2000);
    void this.refresh();
    return true;
  }

  async refresh() {
    if (!this.#key || this.#suspended || this.#reading || this.#busy) return;
    const generation = this.#generation; this.#reading = true;
    try {
      const snapshot = verifiedList(await this.#client.pending(this.#key, this.#abort.signal));
      if (this.#suspended || generation !== this.#generation) return;
      this.#pending = snapshot.pending; this.#active = snapshot.active;
      this.#phase = 'ready'; this.#message = '';
    } catch {
      if (this.#suspended || generation !== this.#generation) return;
      this.#phase = 'unavailable'; this.#message = 'No se pudo verificar la sesión administrativa.';
      this.#pending = []; this.#active = false; this.#supervising = false; this.#lastBeat = 0;
      if (this.#beatTimer !== null) this.#clearInterval(this.#beatTimer);
      this.#beatTimer = null;
    } finally {
      if (generation === this.#generation) { this.#reading = false; this.#notify(); }
    }
  }

  async #beat() {
    if (!this.#key || this.#suspended || this.#beating || this.#busy) return;
    const generation = this.#generation; this.#beating = true;
    try {
      const result = await this.#client.heartbeat(this.#key, this.#abort.signal);
      if (this.#suspended || generation !== this.#generation) return;
      if (result.supervision !== true || result.vigencia_s !== 15) throw new TypeError('Latido inválido.');
      this.#lastBeat = this.#clock(); this.#supervising = true;
      this.#message = '';
    } catch {
      if (this.#suspended || generation !== this.#generation) return;
      this.#supervising = false; this.#lastBeat = 0;
      this.#message = 'Supervisión no confirmada. No se pueden aprobar solicitudes.';
      if (this.#beatTimer !== null) this.#clearInterval(this.#beatTimer);
      this.#beatTimer = null;
    } finally {
      if (generation === this.#generation) { this.#beating = false; this.#notify(); }
    }
  }

  async beginSupervision() {
    if (!this.state.canSupervise) return false;
    await this.#beat();
    if (!this.state.supervising) return false;
    if (this.#beatTimer === null) this.#beatTimer = this.#setInterval(() => void this.#beat(), 5000);
    return true;
  }

  async #change(operation, successMessage, successFlag) {
    if (!this.#key || this.#suspended || this.#busy || this.#phase !== 'ready') return false;
    const generation = this.#generation; this.#busy = true; this.#notify();
    let ok = false;
    try {
      const result = await operation(this.#key, this.#abort.signal);
      if (this.#suspended || generation !== this.#generation) return false;
      if (result.control_fisico !== false || result.simulado !== true || result[successFlag] !== true) throw new TypeError();
      this.#message = successMessage; ok = true;
    } catch {
      if (generation !== this.#generation) return false;
      this.#message = 'Operación no confirmada; vuelve a consultar el estado.';
      this.#phase = 'unavailable'; this.#pending = []; this.#active = false;
      this.#supervising = false; this.#lastBeat = 0;
      if (this.#beatTimer !== null) this.#clearInterval(this.#beatTimer);
      this.#beatTimer = null;
    } finally {
      if (generation === this.#generation) {
        this.#busy = false; this.#notify();
        if (ok) void this.refresh();
      }
    }
    return ok;
  }

  approve(id, mode = 'supervised', seconds = null) {
    if (!this.state.canApprove || !this.#pending.some(x => x.id === id)) return Promise.resolve(false);
    if (!MODE.has(mode) || (mode === 'timed' &&
        (!Number.isSafeInteger(seconds) || seconds < 30 || seconds > 300))) return Promise.resolve(false);
    return this.#change((key, signal) => this.#client.approve(key, id, mode, seconds, signal),
      'Solicitud aprobada. Control físico aún deshabilitado.', 'aprobada');
  }
  reject(id) {
    if (this.#suspended || this.#phase !== 'ready' || this.#busy || !this.#pending.some(x => x.id === id)) return Promise.resolve(false);
    return this.#change((key, signal) => this.#client.reject(key, id, signal), 'Solicitud rechazada.', 'rechazada');
  }
  revoke() {
    if (!this.state.canRevoke) return Promise.resolve(false);
    return this.#change((key, signal) => this.#client.revoke(key, signal),
      'Revocación solicitada. La parada física no está verificada.', 'revocado');
  }
  async endSupervision() {
    if (!this.#key || this.#suspended) return false;
    this.#supervising = false; this.#lastBeat = 0;
    if (this.#beatTimer !== null) this.#clearInterval(this.#beatTimer);
    this.#beatTimer = null; this.#notify();
    // Require server revocation; failing leaves UI fail-closed until heartbeat TTL.
    if (this.#phase !== 'ready') return false;
    return this.#change((key, signal) => this.#client.revoke(key, signal),
      'Supervisión finalizada. Revocación solicitada.', 'revocado');
  }
}
