import { isGuestDirection } from './PublicControlClient.js';

const STATES = {
  cerrado: 'closed', disponible: 'available', ocupado: 'occupied', deteniendo: 'stopping', bloqueado: 'blocked',
};
const ACTIVE_OPERATIONS = new Set(['aceptada', 'despachada']);
const POLL_MS = 1000;
const TICK_MS = 200;
const MOVEMENT_MS = 250;
const INTENT_MS = 750;

function deadline(expires, serverTime, sentAt) {
  // Use elapsed time locally and deduct the whole round trip from the grant.
  return expires === null ? null : sentAt + Date.parse(expires) - Date.parse(serverTime);
}

function remaining(deadlineAt, now) {
  return deadlineAt === null || deadlineAt === undefined ? null : Math.max(0, Math.ceil((deadlineAt - now) / 1000));
}

function projectStatus(row, sentAt) {
  return {
    simulated: row.simulado, status: STATES[row.estado], revision: row.revision,
    serverTime: Date.parse(row.hora_servidor),
    windowEnd: deadline(row.vence_ventana_en, row.hora_servidor, sentAt),
    turnEnd: deadline(row.turno_vence_en ?? null, row.hora_servidor, sentAt),
  };
}

function isOlder(next, current) {
  if (!current || next.simulated !== current.simulated) return false;
  return next.revision < current.revision ||
    (next.revision === current.revision && next.serverTime < current.serverTime);
}

function stopMessage(result) {
  if (result.estado === 'verificada') return 'Parada verificada en el simulador.';
  if (result.estado === 'pendiente') return 'Parada pendiente en el simulador.';
  return 'El simulador no pudo verificar la parada.';
}

function failureMessage(error) {
  if (error.status === 401 || error.status === 403) return 'El permiso para esta operación dejó de ser válido.';
  if (error.status === 409) return 'El estado del turno cambió. Consulta la disponibilidad actualizada.';
  if (error.status === 429) return 'Se alcanzó el límite de solicitudes. Espera antes de volver a intentarlo.';
  return 'No se pudo confirmar la operación. Comprueba el estado actualizado antes de volver a intentarlo.';
}

export class PublicControlService {
  #client;
  #onChange;
  #now;
  #uuid;
  #pollInterval;
  #online = true;
  #timer = null;
  #pollAt = 0;
  #displayedTime = '';
  #controller = new AbortController();
  #revisionFence = 0;
  #refreshing = null;
  #refreshQueued = false;
  #tasks = new Map();
  #public = null;
  #publicFresh = false;
  #unsupported = false;
  #admin = null;
  #adminFresh = false;
  #adminKey = '';
  #adminPermission = 'unverified';
  #token = '';
  #turn = null;
  #turnFresh = false;
  #ceding = false;
  #stopEpoch = null;
  #moveNeedsRead = false;
  #activeDirection = null;
  #pendingDirection = null;
  #receiptId = 0;
  #receipt = null;
  #message = '';

  constructor({ client, onChange = () => {}, now = () => performance.now(), uuid = () => crypto.randomUUID(),
    pollIntervalMs = POLL_MS }) {
    this.#client = client;
    this.#onChange = onChange;
    this.#now = now;
    this.#uuid = uuid;
    this.#pollInterval = pollIntervalMs;
  }

  get state() {
    const now = this.#now();
    const simulation = this.#client.simulation;
    const guest = this.#guestAlive(now);
    const authorized = this.#adminPermission === 'authorized';
    const adminReady = simulation && this.#online && authorized && this.#adminFresh && this.#admin?.simulated === true;
    const publicReady = simulation && this.#online && this.#publicFresh && this.#public?.simulated === true;
    const publicWindow = publicReady && remaining(this.#public.windowEnd, now) > 0;
    const adminWindow = adminReady && remaining(this.#admin.windowEnd, now) > 0;
    const busy = this.#tasks.has('admin') || this.#tasks.has('acquire') || this.#tasks.has('release');
    const canStop = guest && this.#online && !this.#tasks.has('release');
    const windowSeconds = remaining(adminReady ? this.#admin.windowEnd : this.#public?.windowEnd, now);
    let status = 'unknown';
    if (!simulation || this.#unsupported) status = 'unavailable';
    else if (publicReady) status = this.#public.windowEnd !== null && !publicWindow ? 'closed' : this.#public.status;

    return {
      role: guest ? 'guest' : authorized ? 'administrator' : 'observer',
      status, simulation, busy, adminReady, adminPermission: this.#adminPermission,
      windowOpen: adminWindow || publicWindow, windowSeconds,
      turnActive: guest, turnSeconds: guest ? remaining(this.#turn.deadline, now)
        : adminReady ? remaining(this.#admin.turnEnd, now) : null,
      canAcquire: publicWindow && this.#tasks.size === 0 && !this.#adminKey && !this.#token &&
        this.#public.status === 'available',
      canRelease: canStop && !this.#tasks.has('stop'),
      canEnable: adminReady && !busy && this.#admin.status === 'closed',
      canDisable: adminReady && !busy && (adminWindow || ['stopping', 'blocked'].includes(this.#admin.status)),
      canRevoke: adminReady && !busy && ['occupied', 'stopping'].includes(this.#admin.status),
      canMove: canStop && publicWindow && this.#public.status === 'occupied' && this.#turnFresh &&
        this.#turn.state === 'activo' && !this.#ceding && !this.#tasks.has('stop') &&
        (this.#stopEpoch === null || this.#turn.epoch > this.#stopEpoch),
      canStop, moveBusy: this.#tasks.has('move') || this.#moveNeedsRead || ACTIVE_OPERATIONS.has(this.#turn?.operationState),
      stopBusy: this.#tasks.has('stop'), guestReceipt: this.#receipt, message: this.#message,
    };
  }

  start() {
    if (this.#client.simulation && this.#timer === null) {
      this.#timer = setInterval(() => this.#tick(), TICK_MS);
    }
    return this.refresh();
  }

  stop() {
    clearInterval(this.#timer);
    this.#timer = null;
    this.#invalidateRequests();
    this.#public = null;
    this.#admin = null;
    this.#adminKey = '';
    this.#adminPermission = 'unverified';
    this.#forgetGuest();
    this.#message = '';
    this.#notify();
  }

  setOnline(online) {
    if (this.#online === online) return;
    this.#online = online;
    if (!online && this.#tasks.has('move') && this.#turn) this.#stopEpoch = this.#turn.epoch;
    this.#invalidateRequests();
    this.#expireTurn();
    this.#notify();
    if (online) void this.refresh();
  }

  setAdminKey(key) {
    if (this.#token || this.#tasks.has('acquire')) return false;
    if (key === this.#adminKey) {
      if (key && this.#adminPermission !== 'authorized') void this.refresh();
      return true;
    }
    this.#invalidateRequests();
    this.#admin = null;
    this.#adminKey = key;
    this.#adminPermission = key ? 'checking' : 'unverified';
    this.#message = '';
    this.#notify();
    if (this.#online) void this.refresh();
    return true;
  }

  refresh() {
    if (!this.#online) return Promise.resolve();
    if (this.#refreshing) return this.#refreshing;
    this.#pollAt = this.#now() + this.#pollInterval;
    this.#expireTurn();
    const signal = this.#controller.signal;
    const currentRead = this.#revisionFence;
    const sentAt = this.#now();
    const key = this.#adminKey;
    const token = this.#token;
    const current = () => !signal.aborted && this.#revisionFence === currentRead;
    const publicRead = this.#client.getPublic({ signal }).then(row => {
      if (!current()) return;
      const next = projectStatus(row, sentAt);
      if (isOlder(next, this.#public)) return;
      this.#public = next;
      this.#publicFresh = true;
      this.#unsupported = !row.simulado;
    }).catch(error => {
      if (!current()) return;
      this.#publicFresh = false;
      this.#pendingDirection = null;
      if (error.status === 404) this.#unsupported = true;
    });
    const adminRead = key && this.#client.getAdmin(key, { signal }).then(row => {
      if (!current()) return;
      const next = projectStatus(row, sentAt);
      if (isOlder(next, this.#admin)) return;
      this.#admin = next;
      this.#adminFresh = true;
      this.#adminPermission = 'authorized';
    }).catch(error => {
      if (!current()) return;
      this.#adminFresh = false;
      if ([401, 403].includes(error.status)) this.#adminPermission = 'rejected';
      else if (!this.#client.simulation && error.status === 404) this.#adminPermission = 'legacy';
      else if (error.kind === 'format' || !['authorized', 'legacy'].includes(this.#adminPermission)) {
        this.#adminPermission = 'unavailable';
      }
    });
    const turnRead = token && this.#client.getTurn(token, { signal }).then(row => {
      if (!current() || token !== this.#token) return;
      this.#updateTurn(row, sentAt);
    }).catch(error => {
      if (!current() || token !== this.#token) return;
      this.#turnFresh = false;
      this.#pendingDirection = null;
      if ([401, 403].includes(error.status)) {
        this.#forgetGuest();
        this.#message = 'El turno ya no está autorizado.';
      }
    });

    const task = Promise.all([publicRead, adminRead, turnRead]).then(() => {
      if (!current()) return;
      this.#expireTurn();
      this.#notify();
      this.#dispatchMove();
    }).finally(() => {
      if (this.#refreshing !== task) return;
      this.#refreshing = null;
      if (this.#refreshQueued) {
        this.#refreshQueued = false;
        void this.refresh();
      }
    });
    this.#refreshing = task;
    return task;
  }

  acquire() {
    if (!this.state.canAcquire) return Promise.resolve(false);
    const sentAt = this.#now();
    return this.#run('acquire', signal => this.#client.acquire({ signal }), row => {
      this.#token = row.token;
      this.#updateTurn(row, sentAt);
      this.#expireTurn();
      this.#message = this.#token ? 'Turno de simulación concedido.' : 'El turno venció durante la solicitud.';
    });
  }

  release() {
    if (!this.state.canRelease) return Promise.resolve(false);
    this.#ceding = true;
    this.#pendingDirection = null;
    this.#receiptId++;
    const token = this.#token;
    return this.#run('release', signal => this.#client.release(token, { signal }), result => {
      this.#forgetGuest();
      this.#message = `Turno cedido. ${stopMessage(result)}`;
    }, 'guest');
  }

  enableWindow(supervisionConfirmed) {
    if (!this.state.canEnable || supervisionConfirmed !== true) return Promise.resolve(false);
    const key = this.#adminKey;
    return this.#run('admin', signal => this.#client.enableWindow(key, this.#uuid(), { signal }), () => {
      this.#message = 'Demostración simulada habilitada por 20 minutos.';
    }, 'admin');
  }

  disableWindow() {
    if (!this.state.canDisable) return Promise.resolve(false);
    const key = this.#adminKey;
    return this.#run('admin', signal => this.#client.disableWindow(key, { signal }), result => {
      this.#message = result.id_operacion ? `Ventana cerrada. ${stopMessage(result)}` : 'Ventana cerrada.';
    }, 'admin');
  }

  revoke() {
    if (!this.state.canRevoke) return Promise.resolve(false);
    const key = this.#adminKey;
    return this.#run('admin', signal => this.#client.revoke(key, this.#uuid(), { signal }), result => {
      this.#message = `Turno revocado. ${stopMessage(result)}`;
    }, 'admin');
  }

  move(action) {
    if (!this.state.canMove || !isGuestDirection(action)) return false;
    this.#pendingDirection = this.#activeDirection === action ? null : { action, at: this.#now() };
    this.#dispatchMove();
    return true;
  }

  requestStop() {
    if (this.#tasks.has('stop')) return this.#tasks.get('stop').promise;
    if (!this.state.canStop) return Promise.resolve(false);
    this.#pendingDirection = null;
    this.#stopEpoch = this.#turn.epoch;
    const receipt = ++this.#receiptId;
    const token = this.#token;
    const action = 'DETENER';
    this.#receipt = { action, phase: 'sending', status: null, message: 'Parada simulada solicitada.' };
    return this.#run('stop', signal => this.#client.stop(token, this.#uuid(), { signal }), result => {
      if (token !== this.#token) return;
      this.#receipt = { action, phase: 'accepted', status: 202, message: stopMessage(result) };
    }, 'guest', (error, message) => this.#showReceiptError(receipt, action, error, message));
  }

  #dispatchMove() {
    const direction = this.#pendingDirection;
    if (!direction) return;
    if (this.#now() - direction.at > INTENT_MS || !this.state.canMove) {
      this.#pendingDirection = null;
      return;
    }
    if (this.state.moveBusy) return;

    this.#pendingDirection = null;
    this.#activeDirection = direction.action;
    this.#moveNeedsRead = true;
    const token = this.#token;
    const receipt = ++this.#receiptId;
    const { action } = direction;
    const body = {
      id_solicitud: this.#uuid(), secuencia: this.#turn.sequence, epoca_operacion: this.#turn.epoch,
      duracion_ms: MOVEMENT_MS, accion: action,
    };
    this.#receipt = { action, phase: 'sending', status: null, message: 'Movimiento solicitado al simulador.' };
    void this.#run('move', signal => this.#client.move(token, body, { signal }), () => {
      if (receipt !== this.#receiptId || token !== this.#token) return;
      this.#receipt = { action, phase: 'accepted', status: 202, message: 'Movimiento admitido por el simulador.' };
    }, 'guest', (error, message) => {
      if (receipt !== this.#receiptId) return;
      this.#pendingDirection = null;
      this.#turnFresh = false;
      const ambiguous = ['network', 'timeout', 'format'].includes(error.kind) || error.status >= 500;
      if (ambiguous) this.#stopEpoch = body.epoca_operacion;
      this.#showReceiptError(receipt, action, error, ambiguous ? `${message} Envía DETENER para continuar.` : message);
    }, () => receipt === this.#receiptId && token === this.#token);
  }

  #showReceiptError(id, action, error, message) {
    if (id === this.#receiptId) this.#receipt = { action, phase: 'error', status: error.status ?? null, message };
  }

  #run(kind, request, success, auth, failure, applies = () => true) {
    const signal = this.#controller.signal;
    const task = {};
    this.#tasks.set(kind, task);
    this.#revisionFence++;
    this.#message = '';
    task.promise = Promise.resolve().then(() => request(signal)).then(result => {
      if (signal.aborted || !applies()) return false;
      success(result);
      return true;
    }).catch(error => {
      if (signal.aborted || !applies()) return false;
      const message = failureMessage(error);
      if ([401, 403].includes(error.status)) {
        if (auth === 'guest' && error.status === 401) this.#forgetGuest();
        if (auth === 'admin') {
          this.#adminPermission = 'rejected';
          this.#adminFresh = false;
        }
      }
      failure?.(error, message);
      this.#message = message;
      return false;
    }).finally(() => {
      if (this.#tasks.get(kind) !== task) return;
      this.#tasks.delete(kind);
      if (kind === 'move') {
        this.#activeDirection = null;
        if (this.#token) this.#moveNeedsRead = true;
      } else if (kind !== 'stop') {
        this.#publicFresh = false;
        if (kind === 'admin') this.#adminFresh = false;
      }
      this.#revisionFence++;
      this.#notify();
      if (this.#refreshing) this.#refreshQueued = true;
      else void this.refresh();
    });
    this.#notify();
    return task.promise;
  }

  #updateTurn(row, sentAt) {
    const serverTime = Date.parse(row.hora_servidor);
    const previous = this.#turn;
    if (previous && (row.epoca_operacion < previous.epoch || row.siguiente_secuencia < previous.sequence ||
        serverTime < previous.serverTime)) return;
    const absolute = deadline(row.vence_en, row.hora_servidor, sentAt);
    this.#turn = {
      state: row.estado, epoch: row.epoca_operacion, sequence: row.siguiente_secuencia, serverTime,
      absolute: Math.min(previous?.absolute ?? Infinity, absolute),
      deadline: deadline(row.vence_inactividad_en, row.hora_servidor, sentAt),
      operationState: row.ultima_operacion?.estado ?? null,
    };
    this.#turn.deadline = Math.min(this.#turn.absolute, this.#turn.deadline,
      previous?.sequence === this.#turn.sequence ? previous.deadline : Infinity);
    this.#turnFresh = true;
    this.#moveNeedsRead = false;
  }

  #guestAlive(now) {
    return Boolean(this.#token && this.#turn && this.#turn.deadline > now);
  }

  #expireTurn() {
    if (!this.#token || this.#guestAlive(this.#now())) return false;
    this.#forgetGuest();
    this.#message = 'El tiempo del turno terminó.';
    return true;
  }

  #forgetGuest() {
    this.#token = '';
    this.#turn = null;
    this.#turnFresh = false;
    this.#ceding = false;
    this.#stopEpoch = null;
    this.#moveNeedsRead = false;
    this.#pendingDirection = null;
    this.#receiptId++;
    this.#receipt = null;
  }

  #invalidateRequests() {
    this.#controller.abort();
    this.#controller = new AbortController();
    this.#revisionFence++;
    this.#refreshing = null;
    this.#refreshQueued = false;
    this.#tasks.clear();
    this.#publicFresh = this.#adminFresh = this.#turnFresh = false;
    this.#activeDirection = this.#pendingDirection = null;
    this.#receiptId++;
    if (this.#receipt?.phase === 'sending') {
      this.#receipt = { ...this.#receipt, phase: 'error', message: 'Se interrumpió la confirmación de la solicitud.' };
    }
  }

  #tick() {
    const expired = this.#expireTurn();
    const state = this.state;
    if (expired || this.#displayedTime !== `${state.windowSeconds}/${state.turnSeconds}`) this.#notify();
    if (this.#online && (expired || this.#now() >= this.#pollAt || this.#pendingDirection)) void this.refresh();
  }

  #notify() {
    const state = this.state;
    this.#displayedTime = `${state.windowSeconds}/${state.turnSeconds}`;
    this.#onChange(state);
  }
}
