const STOP = 'DETENER';
const EVENT_WINDOW_MS = 5000;
const MAX_CANDIDATES = 32;
const REJECTED_BEFORE_MOVEMENT = new Set([401, 403, 404, 409, 422]);

export class CommandService {
  #api;
  #vehicleId;
  #canControl;
  #isDemoBusy;
  #beforeStop;
  #observeStop;
  #onChange;
  #catalog = new Map();
  #current = null;
  #inFlight = null;
  #pending = null;
  #draining = false;
  #mayBeMoving = false;
  #lastObservedStop = null;

  constructor({ api, vehicleId, canControl = () => true, isDemoBusy = () => false,
    beforeStop = async () => {}, observeStop = () => null, onChange = () => {} }) {
    this.#api = api;
    this.#vehicleId = vehicleId;
    this.#canControl = canControl;
    this.#isDemoBusy = isDemoBusy;
    this.#beforeStop = beforeStop;
    this.#observeStop = observeStop;
    this.#onChange = onChange;
  }

  setCatalog(commands) {
    this.#catalog = new Map(commands
      .filter(command => command.active && (command.key !== STOP || command.code === 0))
      .map(command => [command.key, command]));
    this.#onChange();
  }

  getCommand(name) {
    return this.#catalog.get(name) ?? null;
  }

  get busy() {
    return Boolean(this.#inFlight || this.#pending);
  }

  get mayBeMoving() {
    return this.#mayBeMoving;
  }

  get stopping() {
    return this.#pending?.command.key === STOP || this.#inFlight?.command.key === STOP;
  }

  get state() {
    const ticket = this.#current;
    if (!ticket) return null;
    const { command, phase, message, correlation, ambiguous } = ticket;
    return { command, phase, message, correlation, ambiguous };
  }

  stop() {
    return this.request(STOP);
  }

  request(name) {
    const command = this.getCommand(name);
    if (!command || !this.#canControl()) return false;

    if (this.stopping) return name === STOP;
    if (name !== STOP && (!this.getCommand(STOP) || this.#isDemoBusy())) return false;
    if (this.#pending?.command.id === command.id) return true;

    if (this.#inFlight?.command.id === command.id) {
      this.#pending = null;
      this.#current = this.#inFlight;
      this.#onChange();
      return true;
    }

    const ticket = {
      command, phase: 'queued', message: null, candidates: [],
      correlation: null, ambiguous: false, overflow: false, response: null, acceptedAt: null,
    };
    this.#pending = this.#current = ticket;
    this.#onChange();
    if (!this.#draining) void this.#drain();
    return true;
  }

  async #drain() {
    this.#draining = true;
    while (this.#pending) {
      const ticket = this.#inFlight = this.#pending;
      this.#pending = null;
      const stop = ticket.command.key === STOP;
      const previouslyMoving = this.#mayBeMoving;
      let cancelError = null;

      try {
        if (stop && this.#isDemoBusy()) {
          this.#mayBeMoving = true;
          try {
            await this.#beforeStop();
          } catch (error) {
            cancelError = `No se confirmó la cancelación de la DEMO. ${error.message}`;
          }
        }
        if (stop) ticket.observeResult = this.#observeStop();

        const currentCommand = this.getCommand(ticket.command.key);
        if (!this.#canControl() || currentCommand?.id !== ticket.command.id ||
            currentCommand.code !== ticket.command.code || currentCommand.name !== ticket.command.name ||
            (!stop && (!this.getCommand(STOP) || this.#isDemoBusy()))) {
          throw new Error('El comando dejó de estar habilitado antes del envío.');
        }

        ticket.phase = 'sending';
        if (stop) this.#lastObservedStop = null;
        if (!stop) this.#mayBeMoving = true;
        if (this.#current === ticket) this.#onChange();
        ticket.response = await this.#api.sendCommand(ticket.command.id);
        if (stop && ticket.response.codigo !== 0) {
          this.#mayBeMoving = true;
          this.#catalog.delete(STOP);
          throw new Error('La API respondió con un código distinto de cero para DETENER. Actualiza el catálogo.');
        }
        const changed = ticket.response.codigo !== ticket.command.code || ticket.response.comando !== ticket.command.name;
        if (changed) this.#catalog.delete(ticket.command.key);
        ticket.acceptedAt = Date.now();
        ticket.phase = 'accepted';
        const catalogWarning = changed ? 'El comando confirmado difiere del catálogo cargado. Actualiza los comandos.' : null;
        ticket.message = [cancelError, catalogWarning].filter(Boolean).join(' ') || null;
        if (stop) this.#mayBeMoving = false;
        this.#match(ticket);
      } catch (error) {
        if (!stop && (REJECTED_BEFORE_MOVEMENT.has(error.status) || ['auth', 'input'].includes(error.kind))) {
          this.#mayBeMoving = previouslyMoving;
        }
        ticket.phase = 'error';
        ticket.message = [cancelError, error.message].filter(Boolean).join(' ');
      } finally {
        this.#inFlight = null;
        if (ticket.observeResult && ticket.phase === 'accepted') this.#lastObservedStop = ticket;
        this.#reportStop(ticket);
        this.#onChange();
      }
    }
    this.#draining = false;
  }

  handleEvent(event) {
    const ticket = this.#inFlight ?? this.#current;
    this.#observeMovement(ticket, event);
    if (this.#lastObservedStop !== ticket) this.#observeMovement(this.#lastObservedStop, event);
  }

  #observeMovement(ticket, event) {
    if (!ticket || event.tipo_evento !== 'movimiento' || event.id_vehiculo !== this.#vehicleId ||
        event.id_comando !== ticket.command.id || event.codigo !== ticket.command.code ||
        event.comando !== ticket.command.name || event.origen !== 'API' ||
        !event.timestamp || !['sending', 'accepted'].includes(ticket.phase)) return;
    if (ticket.acceptedAt !== null && Date.now() - ticket.acceptedAt > EVENT_WINDOW_MS) return;
    if (event.id_evento && ticket.candidates.some(candidate => candidate.id_evento === event.id_evento)) return;

    if (ticket.candidates.length < MAX_CANDIDATES) ticket.candidates.push(event);
    else ticket.overflow = true;
    if (ticket.response) {
      this.#match(ticket);
      this.#reportStop(ticket);
      if (this.#current === ticket || ticket.observeResult) this.#onChange();
    }
  }

  #reportStop(ticket) {
    ticket.observeResult?.({
      phase: ticket.phase,
      compatible: Boolean(ticket.correlation),
      ambiguous: ticket.ambiguous,
    });
  }

  #match(ticket) {
    const response = ticket.response;
    const matches = ticket.candidates.filter(event =>
      event.id_vehiculo === response.id_vehiculo && event.id_comando === response.id_comando &&
      event.comando === response.comando && event.codigo === response.codigo &&
      event.timestamp === response.fecha_actualizacion && event.conectado === response.conectado &&
      event.origen === response.origen);
    ticket.ambiguous = ticket.overflow || matches.length > 1;
    ticket.correlation = !ticket.ambiguous && matches.length === 1 ? matches[0] : null;
  }
}
