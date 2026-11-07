const TERMINAL_PHASES = {
  demo_fin: 'completed', demo_cancelada: 'canceled', demo_error: 'error',
};

const EVENT_MESSAGES = {
  demo_inicio: 'Inicio observado por WSS.',
  demo_movimiento: 'Paso observado por WSS.',
  demo_fin: 'Finalización observada por WSS.',
  demo_cancelada: 'Cancelación observada por WSS.',
  demo_error: 'Error de ejecución observado por WSS.',
};

export class DemoController {
  #api;
  #vehicleId;
  #canControl;
  #canStart;
  #onChange;
  #catalog = [];
  #selectedId = null;
  #steps = [];
  #stepsStatus = 'idle';
  #stepsError = null;
  #selectionVersion = 0;
  #selectionRequest = null;
  #connected = false;
  #tracked = new Map();
  #starting = null;
  #canceling = null;
  #terminal = null;
  #lastEvent = null;
  #http = null;
  #unidentifiedActivity = false;

  constructor({ api, vehicleId, canControl = () => true, canStart = () => true, onChange = () => {} }) {
    this.#api = api;
    this.#vehicleId = vehicleId;
    this.#canControl = canControl;
    this.#canStart = canStart;
    this.#onChange = onChange;
  }

  get busy() {
    return Boolean(this.#tracked.size || this.#starting || this.#canceling || this.#unidentifiedActivity);
  }

  get requestPending() {
    return Boolean(this.#starting || this.#canceling);
  }

  get state() {
    const active = [...this.#tracked.values()].at(-1);
    const run = active ?? this.#terminal;
    const selected = this.#catalog.find(demo => demo.id === this.#selectedId);
    return {
      catalog: this.#catalog, selectedId: this.#selectedId, steps: this.#steps,
      stepsStatus: this.#stepsStatus, stepsError: this.#stepsError,
      activeId: active?.id ?? null, phase: run?.phase ?? 'idle', message: run?.message ?? null,
      progress: run?.progress ?? null, observedSteps: run?.seen.size ?? 0, lastEvent: this.#lastEvent,
      http: this.#http, stop: run?.stop ?? null,
      canStart: Boolean(!this.busy && selected?.active && this.#stepsStatus === 'ready' &&
        this.#steps.length && this.#canControl() && this.#canStart()),
      canCancel: Boolean((active || this.#starting) && !this.#canceling && this.#canControl()),
    };
  }

  setCatalog(demos) {
    this.#catalog = demos;
    if (this.#selectedId !== null && !demos.some(demo => demo.id === this.#selectedId)) {
      void this.select(null);
    } else {
      this.#onChange();
    }
  }

  async select(id) {
    const selected = this.#catalog.find(demo => demo.id === Number(id));
    this.#selectedId = selected?.id ?? null;
    const version = ++this.#selectionVersion;
    this.#selectionRequest?.abort();
    const request = this.#selectionRequest = selected ? new AbortController() : null;
    this.#steps = [];
    this.#stepsError = null;
    this.#stepsStatus = selected ? 'loading' : 'idle';
    this.#onChange();
    if (!selected) return;

    try {
      const steps = await this.#api.getDemoMovements(selected.id, { signal: request.signal });
      if (version !== this.#selectionVersion) return;
      this.#steps = steps;
      this.#stepsStatus = 'ready';
    } catch (error) {
      if (version !== this.#selectionVersion) return;
      this.#stepsStatus = 'error';
      this.#stepsError = error.message;
    } finally {
      if (this.#selectionRequest === request) this.#selectionRequest = null;
    }
    this.#onChange();
  }

  start() {
    if (!this.state.canStart) return Promise.resolve(false);
    const run = this.#newRun(this.#selectedId);
    run.eventAtStart = this.#lastEvent;
    run.phase = 'starting';
    run.message = 'Esperando el evento de inicio por WSS.';
    this.#http = { action: 'start', phase: 'sending', id: run.id };
    this.#starting = Promise.resolve().then(() => this.#start(run));
    this.#onChange();
    return this.#starting;
  }

  async #start(run) {
    try {
      await this.#api.startDemo(run.id);
      this.#http = { action: 'start', phase: 'accepted', id: run.id, status: 202 };
      if (this.#tracked.get(run.id) === run && run.phase === 'starting') {
        run.phase = 'accepted';
        run.message = this.#connected
          ? 'Esperando el evento de inicio por WSS.'
          : 'WSS está desconectado y el progreso no es observable.';
      }
      return true;
    } catch (error) {
      this.#http = { action: 'start', phase: 'error', id: run.id, status: error.status, message: error.message };
      if (this.#tracked.get(run.id) === run && run.phase === 'starting') {
        if (error.kind === 'demo-conflict' && this.#tracked.size === 1 && this.#lastEvent === run.eventAtStart) {
          this.#unidentifiedActivity = true;
          this.#finish(run, 'uncertain', 'La API informa que el vehículo puede estar ocupado por una DEMO sin identificar. Espera un evento WSS que aclare el estado.');
        } else if (!['auth', 'input'].includes(error.kind) &&
            (!error.status || error.status >= 500 || error.kind === 'format')) {
          run.phase = 'uncertain';
          run.message = 'El inicio no se pudo verificar. Comprueba o cancela la ejecución antes de mover el vehículo.';
        } else {
          this.#finish(run, 'error', error.message);
        }
      }
      return false;
    } finally {
      this.#starting = null;
      this.#onChange();
    }
  }

  async cancel() {
    if (!this.#canControl()) return false;
    try {
      return await this.cancelForStop();
    } catch {
      return false;
    }
  }

  cancelForStop() {
    if (this.#canceling) return this.#canceling;
    if (!this.busy) return Promise.resolve(false);

    // A start reserves the vehicle before executing. Wait for its response
    // before cancelling so a quick STOP cannot miss the start reservation.
    this.#canceling = Promise.resolve().then(() => this.#cancelTracked());
    this.#onChange();
    return this.#canceling;
  }

  observeStop() {
    const terminal = this.#terminal;
    if (terminal?.phase !== 'canceled' || this.#tracked.size) return null;

    // Bind the response to the cancellation visible when the STOP is dispatched.
    return result => {
      if (this.#terminal !== terminal || (terminal.stop?.phase === 'accepted' && result.phase !== 'accepted')) return;
      terminal.stop = result;
    };
  }

  async #cancelTracked() {
    const errors = [];
    try {
      await this.#starting;
      if (this.#unidentifiedActivity) {
        throw new Error('No se conoce el identificador de la DEMO que podría estar activa.');
      }
      for (const run of [...this.#tracked.values()]) {
        if (this.#tracked.get(run.id) !== run) continue;
        run.phase = 'canceling';
        run.message = 'Esperando el evento de cancelación por WSS.';
        this.#http = { action: 'cancel', phase: 'sending', id: run.id };
        this.#onChange();

        try {
          await this.#api.cancelDemo(run.id);
          this.#http = { action: 'cancel', phase: 'accepted', id: run.id, status: 200 };
          this.#finish(run, 'canceled', 'Aún no se observó la cancelación por WSS.', this.#connected);
        } catch (error) {
          this.#http = { action: 'cancel', phase: 'error', id: run.id, status: error.status, message: error.message };
          if (error.status === 404) {
            this.#finish(run, 'error', 'La API indica que esa DEMO ya no tiene una ejecución activa.');
          } else if (this.#tracked.get(run.id) === run) {
            run.phase = 'uncertain';
            run.message = error.message;
            errors.push(error.message);
          }
        }
      }
      if (errors.length) throw new Error(errors.join(' '));
      return true;
    } finally {
      this.#canceling = null;
      this.#onChange();
    }
  }

  setConnected(connected) {
    if (this.#connected === connected) return;
    this.#connected = connected;
    if (!connected) {
      if (this.#terminal) this.#terminal.awaitingCancelEvent = false;
      for (const run of this.#tracked.values()) {
        if (!['accepted', 'running'].includes(run.phase)) continue;
        run.phase = 'uncertain';
        run.message = 'WSS se desconectó durante la DEMO. La ejecución podría continuar en el servidor.';
      }
    }
    this.#onChange();
  }

  handleEvent(event) {
    const type = event.tipo_evento;
    if (event.id_vehiculo !== this.#vehicleId || !Object.hasOwn(EVENT_MESSAGES, type)) return;
    this.#unidentifiedActivity = false;
    this.#lastEvent = event;
    let run = this.#tracked.get(event.id_demo);
    if (Object.hasOwn(TERMINAL_PHASES, type)) {
      const phase = TERMINAL_PHASES[type];
      const message = EVENT_MESSAGES[type];
      if (run) this.#finish(run, phase, message);
      else if (phase === 'canceled' && this.#terminal?.phase === phase && this.#terminal.id === event.id_demo) {
        this.#terminal.message = message;
        this.#terminal.awaitingCancelEvent = false;
      } else {
        this.#terminal = { id: event.id_demo, phase, message, seen: new Set() };
      }
    } else if (!run && type === 'demo_movimiento' && this.#terminal?.id === event.id_demo &&
      this.#terminal.awaitingCancelEvent) {
      // On the same socket, a buffered step may precede the terminal WSS event.
      this.#terminal.progress = event;
      this.#terminal.seen.add(event.id_demo_movimiento);
    } else {
      run ??= this.#newRun(event.id_demo);
      if (type === 'demo_inicio') {
        run.seen.clear();
        run.progress = null;
      } else {
        run.progress = event;
        run.seen.add(event.id_demo_movimiento);
      }
      if (run.phase !== 'canceling') {
        run.phase = 'running';
        run.message = EVENT_MESSAGES[type];
      }
    }
    this.#onChange();
  }

  #newRun(id) {
    const run = { id, phase: 'idle', message: null, progress: null, seen: new Set() };
    this.#terminal = null;
    if (!this.#tracked.size) this.#http = null;
    this.#tracked.set(id, run);
    return run;
  }

  #finish(run, phase, message, awaitingCancelEvent = false) {
    if (this.#tracked.get(run.id) !== run) return;
    this.#tracked.delete(run.id);
    this.#terminal = { ...run, phase, message, awaitingCancelEvent };
  }
}
