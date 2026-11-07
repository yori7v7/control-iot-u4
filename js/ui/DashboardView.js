const DIRECTIONS = {
  AVANZAR: ['Avanzar', 'up'],
  IZQUIERDA: ['Izquierda', 'left'],
  DERECHA: ['Derecha', 'right'],
  RETROCEDER: ['Retroceder', 'down'],
};
const EXTRAS = {
  LUCES: ['Luces', 'lights'],
  VELOCIDAD: ['Velocidad', 'speed'],
  DEMO_ORIGINAL: ['DEMO original', 'sequence'],
  CLAXON: ['Claxon', 'horn'],
  AVANZAR_DERECHA: ['Avanzar y derecha', 'diagonal-up'],
  RETROCEDER_IZQUIERDA: ['Retroceder e izquierda', 'diagonal-down'],
};
const PHASE_LABELS = {
  queued: 'Solicitud en espera.',
  sending: 'Solicitud enviada. Esperando respuesta HTTP.',
  accepted: 'HTTP 200 aceptado.',
  error: 'Error en la solicitud.',
};
const EVENT_LABELS = {
  estado_actual: 'Estado inicial',
  movimiento: 'Movimiento',
  demo_inicio: 'Inicio de DEMO',
  demo_movimiento: 'Paso de DEMO',
  demo_fin: 'Fin de DEMO',
  demo_cancelada: 'DEMO cancelada',
  demo_error: 'Error de DEMO',
};
const SVG = 'http://www.w3.org/2000/svg';

function setText(node, content) {
  if (node.textContent !== content) node.textContent = content;
}

export class DashboardView {
  #document;
  #elements = new Map();
  #catalog = null;
  #demoCatalog = null;
  #steps = null;

  constructor(document) {
    this.#document = document;
  }

  element(id) {
    if (!this.#elements.has(id)) this.#elements.set(id, this.#document.getElementById(id));
    return this.#elements.get(id);
  }

  #text(id, content) {
    setText(this.element(id), content);
  }

  setSimulation(simulation, isLocal) {
    this.element('simulation-banner').hidden = !simulation;
    this.element('exit-simulation').hidden = !simulation;
    this.element('open-session').hidden = simulation;
    this.element('simulation-link').hidden = simulation || !isLocal;
  }

  setVehicle(vehicle, vehicleId, loading) {
    this.#text('vehicle-id', `ID ${String(vehicleId).padStart(2, '0')}`);
    const identity = [vehicle?.name, vehicle?.model, vehicle && !vehicle.active ? 'Vehículo inactivo' : null]
      .filter(Boolean).join(' · ');
    this.#text('vehicle-name', identity || (loading ? 'Consultando el vehículo y su catálogo…' : 'Nombre del vehículo sin verificar'));
  }

  setNotice(message, bad = false) {
    const notice = this.element('notice');
    notice.dataset.tone = bad ? 'bad' : 'idle';
    notice.hidden = !message;
    setText(notice, message);
  }

  setCatalog(catalog, request, loaded) {
    if (catalog === this.#catalog) return;
    this.#catalog = catalog;
    const directions = this.element('direction-buttons');
    const extras = this.element('extra-buttons');
    directions.replaceChildren();
    extras.replaceChildren();
    const active = new Map(catalog.filter(command => command.active).map(command => [command.key, command]));
    for (const [key, [label, icon]] of Object.entries(DIRECTIONS)) {
      if (active.has(key)) directions.append(this.#commandButton(key, label, request, icon));
    }
    for (const command of active.values()) {
      if (command.key !== 'DETENER' && !Object.hasOwn(DIRECTIONS, command.key)) {
        const [label, icon] = EXTRAS[command.key] ?? [command.name];
        extras.append(this.#commandButton(command.key, label, request, icon));
      }
    }
    this.element('no-extras').hidden = extras.childElementCount > 0;
    this.#text('no-extras', loaded ? 'No hay comandos adicionales activos.' : 'Catálogo sin verificar.');
  }

  #commandButton(key, label, request, icon) {
    const button = this.#document.createElement('button');
    button.className = 'btn btn-outline-panel';
    button.type = 'button';
    button.dataset.command = key;
    if (icon) {
      const svg = this.#document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      const use = this.#document.createElementNS(SVG, 'use');
      use.setAttribute('href', `./assets/icons.svg#${icon}`);
      svg.append(use);
      button.append(svg);
    }
    button.append(label);
    button.addEventListener('click', () => request(key));
    return button;
  }

  setControl({ armed, canCommand, canStop, canClose, busy }) {
    const mode = this.element('control-mode');
    setText(mode, canStop ? 'HABILITADO' : 'BLOQUEADO');
    mode.dataset.armed = String(canStop);
    this.#text('session-label', armed ? 'Sesión de control' : 'Habilitar control');
    this.#text('session-title', armed ? 'Sesión de control real' : 'Habilitar control real');
    this.#text('save-session', armed ? 'Actualizar clave' : 'Habilitar');
    this.element('save-session').disabled = busy;
    this.element('clear-session').hidden = !armed;
    this.element('clear-session').disabled = !canClose;
    this.element('clear-session-help').hidden = !armed || canClose;
    this.element('stop').disabled = !canStop;
    this.element('joystick').setAttribute('aria-disabled', String(!Object.keys(DIRECTIONS).some(canCommand)));
    for (const button of this.#document.querySelectorAll('[data-command]')) {
      button.disabled = !canCommand(button.dataset.command);
    }
  }

  setPreview(key) {
    this.element('joystick').dataset.direction = key ?? '';
    this.#text('joystick-direction', key ? key.replaceAll('_', ' ') : 'POSICIÓN NEUTRAL');
  }

  setCommand(state) {
    if (!state) return;
    const { command, phase, message, correlation, ambiguous } = state;
    this.#text('last-command', `${command.name} · ID ${command.id}`);
    this.#text('command-state', [PHASE_LABELS[phase], message].filter(Boolean).join(' '));
    this.element('event-correlation').hidden = phase !== 'accepted';
    this.#text('event-correlation', ambiguous
      ? 'Se observaron varias coincidencias WSS. La relación con la solicitud es indeterminada.'
      : correlation
        ? 'Evento WSS compatible con la respuesta HTTP por comando y marca de tiempo. La coincidencia es orientativa.'
        : 'Sin evento WSS compatible observado para esta solicitud.');
  }

  setEvent(event) {
    const label = EVENT_LABELS[event.tipo_evento];
    const demo = event.id_demo ? event.nombre_demo || `DEMO ${event.id_demo}` : null;
    this.#text('last-event', demo ? `${label} · ${demo}` : label);
    const timestamp = event.timestamp?.replace('T', ' ');
    const command = event.comando ? `${event.comando} · código ${event.codigo}` : null;
    this.#text('event-detail', [event.tipo_evento, command, timestamp].filter(Boolean).join(' · '));
  }

  setDemo(state, { loading, busy, canStart }) {
    const select = this.element('demo-select');
    if (state.catalog !== this.#demoCatalog || select.dataset.loading !== String(loading)) {
      this.#demoCatalog = state.catalog;
      select.dataset.loading = String(loading);
      const initial = this.#document.createElement('option');
      initial.value = '';
      initial.disabled = true;
      initial.hidden = true;
      initial.textContent = loading ? 'Consultando catálogo…' : state.catalog.length ? 'Elige una DEMO' : 'Sin DEMO disponibles';
      select.replaceChildren(initial);
      for (const demo of state.catalog) {
        const option = this.#document.createElement('option');
        option.value = String(demo.id);
        option.textContent = demo.active ? demo.name : `${demo.name} (inactiva)`;
        select.append(option);
      }
    }
    select.value = state.selectedId ?? '';
    select.disabled = !state.catalog.length || busy;
    const description = state.catalog.find(demo => demo.id === state.selectedId)?.description;
    this.element('demo-description').hidden = !description;
    this.#text('demo-description', description ?? '');
    this.element('demo-start').disabled = !state.canStart;
    this.element('demo-cancel').disabled = !state.canCancel;
    this.#setDemoHttp(state.http);
    this.element('demo-state').dataset.phase = state.phase;
    const activeOther = state.activeId !== null && state.activeId !== state.selectedId ? `DEMO activa ID ${state.activeId}.` : null;
    const progress = state.progress ? `Movimiento ${state.progress.orden} · ${state.progress.comando}.` : null;
    const helper = state.stepsStatus === 'ready' && state.steps.length && !state.canStart ? canStart : null;
    const message = state.message ?? helper ?? 'Sin ejecución observada.';
    const cancelNote = state.phase === 'canceled' ? this.#demoStopNote(state.stop) : null;
    this.#text('demo-state', [activeOther, message, progress, cancelNote]
      .filter(Boolean).join(' '));

    const bar = this.element('demo-progress');
    const expected = state.lastEvent?.id_demo === state.selectedId ? state.steps.length : 0;
    bar.hidden = !state.observedSteps || !expected;
    bar.max = expected || 1;
    bar.value = Math.min(state.observedSteps, bar.max);
    const details = this.element('demo-steps');
    details.hidden = state.selectedId === null;
    const stepsMessage = {
      loading: 'Consultando movimientos…',
      error: state.stepsError,
      ready: state.steps.length ? '' : 'La DEMO no tiene movimientos programados.',
    };
    this.#text('demo-steps-title', state.steps.length ? `Movimientos programados (${state.steps.length})` : 'Movimientos programados');
    this.#text('demo-steps-status', stepsMessage[state.stepsStatus] ?? '');
    if (state.steps !== this.#steps) {
      this.#steps = state.steps;
      const list = this.element('demo-steps-list');
      list.replaceChildren(...state.steps.map(step => {
        const item = this.#document.createElement('li');
        item.textContent = `${step.comando} · ${step.duracion_ms} ms · pausa ${step.pausa_ms} ms`;
        return item;
      }));
    }
  }

  #demoStopNote(stop) {
    if (stop?.phase === 'accepted') {
      const observation = stop.compatible ? ' Evento WSS compatible recibido.'
        : stop.ambiguous ? ' La correspondencia WSS es indeterminada.' : '';
      return `DETENER aceptado por HTTP 200.${observation}`;
    }
    const warning = stop?.phase === 'error' ? 'DETENER no se confirmó. ' : '';
    return `${warning}Usa DETENER para enviar una orden de parada.`;
  }

  #setDemoHttp(http) {
    this.element('demo-http').hidden = !http;
    if (!http) return;
    const action = http.action === 'start' ? 'Inicio REST' : 'Cancelación REST';
    const outcome = http.phase === 'accepted' ? `HTTP ${http.status} aceptado.`
      : http.phase === 'error' && http.status ? `Error en la solicitud (HTTP ${http.status}).`
        : PHASE_LABELS[http.phase];
    this.#text('demo-http', `${action} · ${outcome}`);
  }

  clearForm() {
    this.element('session-form').reset();
    this.element('api-key').value = '';
    this.setSessionError('');
  }

  setSessionError(message) {
    this.element('session-error').hidden = !message;
    this.#text('session-error', message);
  }
}
