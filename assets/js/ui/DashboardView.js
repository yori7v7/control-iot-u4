import { formatCommandName, formatCommandReferences } from './commandLabels.js';

const DIRECTIONS = {
  AVANZAR_IZQUIERDA: 'diagonal-up-left',
  AVANZAR: 'up',
  AVANZAR_DERECHA: 'diagonal-up',
  IZQUIERDA: 'left',
  DERECHA: 'right',
  RETROCEDER_IZQUIERDA: 'diagonal-down',
  RETROCEDER: 'down',
  RETROCEDER_DERECHA: 'diagonal-down-right',
};
const CARDINAL_DIRECTIONS = ['AVANZAR', 'IZQUIERDA', 'DERECHA', 'RETROCEDER'];
const EXTRAS = {
  LUCES: 'lights',
  VELOCIDAD: 'speed',
  DEMO_ORIGINAL: 'sequence',
  CLAXON: 'horn',
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
const DEMO_RESULT_MS = 4000;
const DEMO_IDLE = 'Sin DEMO en ejecución.';

function setText(node, content) {
  if (node.textContent !== content) node.textContent = content;
}

export class DashboardView {
  #document;
  #elements = new Map();
  #catalog = null;
  #demoCatalog = null;
  #steps = null;
  #demoNotice = null;

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
    const id = `ID ${String(vehicleId).padStart(2, '0')}`;
    this.#text('vehicle-id', id);
    this.#text('vehicle-detail-id', id);
    const identity = [vehicle?.name, vehicle?.model, vehicle && !vehicle.active ? 'Vehículo inactivo' : null]
      .filter(Boolean).join(' · ') || (loading ? 'Consultando el vehículo y su catálogo…' : 'Nombre del vehículo sin verificar');
    this.#text('vehicle-name', identity);
    this.#text('vehicle-detail-name', identity);
  }

  setNotice(message, bad = false) {
    const text = formatCommandReferences(message);
    for (const id of ['notice', 'notice-detail']) {
      const notice = this.element(id);
      notice.dataset.tone = bad ? 'bad' : 'idle';
      notice.hidden = !message;
      setText(notice, text);
    }
    this.#updateActivityAttention();
  }

  setCatalog(catalog, request) {
    if (catalog === this.#catalog) return;
    this.#catalog = catalog;
    const directions = this.element('direction-buttons');
    const extras = this.element('extra-buttons');
    directions.replaceChildren();
    extras.replaceChildren();
    for (const [key, icon] of Object.entries(DIRECTIONS)) {
      directions.append(this.#commandButton(key, key, request, icon));
    }
    for (const [key, icon] of Object.entries(EXTRAS)) {
      extras.append(this.#commandButton(key, key, request, icon));
    }
    for (const { key, name, active } of catalog) {
      if (active && key !== 'DETENER' && !Object.hasOwn(DIRECTIONS, key) && !Object.hasOwn(EXTRAS, key)) {
        extras.append(this.#commandButton(key, name, request));
      }
    }
  }

  #commandButton(key, name, request, icon) {
    const label = formatCommandName(name);
    const button = this.#document.createElement('button');
    button.className = 'btn btn-outline-panel';
    button.type = 'button';
    button.disabled = true;
    button.dataset.command = key;
    button.setAttribute('aria-label', label);
    button.title = label;
    if (icon) {
      const svg = this.#document.createElementNS(SVG, 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      const use = this.#document.createElementNS(SVG, 'use');
      use.setAttribute('href', `./assets/icons.svg#${icon}`);
      svg.append(use);
      button.append(svg);
    }
    const caption = this.#document.createElement('span');
    caption.className = 'command-label';
    caption.textContent = label;
    button.append(caption);
    button.addEventListener('click', () => {
      if (!button.disabled) request(key);
    });
    return button;
  }

  setControl({ armed, canCommand, canStop, canClose, busy, catalogReady, catalogStatus }) {
    const mode = this.element('control-mode');
    setText(mode, catalogStatus || (canStop ? 'HABILITADO' : 'BLOQUEADO'));
    mode.dataset.armed = String(canStop);
    mode.toggleAttribute('data-catalog-status', Boolean(catalogStatus));
    const sessionLabel = armed ? 'Sesión de control' : 'Habilitar control';
    this.#text('session-label', sessionLabel);
    this.element('open-session').title = sessionLabel;
    this.#text('session-title', armed ? 'Sesión de control real' : 'Habilitar control real');
    this.#text('save-session', armed ? 'Actualizar clave' : 'Habilitar');
    this.element('save-session').disabled = busy;
    this.element('clear-session').hidden = !armed;
    this.element('clear-session').disabled = !canClose;
    this.element('clear-session-help').hidden = !armed || canClose;
    this.element('stop').disabled = !canStop;
    this.element('joystick').setAttribute('aria-disabled', String(!CARDINAL_DIRECTIONS.some(canCommand)));
    for (const button of this.#document.querySelectorAll('[data-command]')) {
      button.disabled = !catalogReady || !canCommand(button.dataset.command);
    }
  }

  setPreview(key) {
    this.element('joystick').dataset.direction = key ?? '';
    this.#text('joystick-direction', key ? formatCommandName(key) : 'POSICIÓN NEUTRAL');
  }

  setCommand(state) {
    if (!state) return;
    const { command, phase, message, correlation, ambiguous } = state;
    this.element('activity-pane').dataset.commandPhase = phase;
    this.#updateActivityAttention();
    const commandLabel = `${formatCommandName(command.name)} · ID ${command.id}`;
    this.#text('last-command', commandLabel);
    this.#text('control-receipt-command', commandLabel);
    const status = formatCommandReferences([PHASE_LABELS[phase], message].filter(Boolean).join(' '));
    this.#text('command-state', status);
    this.#text('control-receipt-status', status);
    this.#text('command-alert', phase === 'error' ? status : '');
    this.element('event-correlation').hidden = phase !== 'accepted';
    this.#text('event-correlation', ambiguous
      ? 'Se observaron varias coincidencias WSS. La relación con la solicitud es indeterminada.'
      : correlation
        ? 'Evento WSS compatible con la respuesta HTTP por comando y marca de tiempo. La coincidencia es orientativa.'
        : 'Sin evento WSS compatible observado para esta solicitud.');
  }

  #updateActivityAttention() {
    const notice = this.element('notice');
    const noticeError = !notice.hidden && notice.dataset.tone === 'bad';
    const commandError = this.element('activity-pane').dataset.commandPhase === 'error';
    this.element('activity-toggle').toggleAttribute('data-attention', noticeError || commandError);
  }

  setEvent(event) {
    const label = EVENT_LABELS[event.tipo_evento];
    const demo = event.id_demo ? formatCommandReferences(event.nombre_demo || `DEMO ${event.id_demo}`) : null;
    this.#text('last-event', demo ? `${label} · ${demo}` : label);
    const timestamp = event.timestamp?.replace('T', ' ');
    const command = formatCommandName(event.comando);
    const code = command && event.codigo != null ? `código ${event.codigo}` : null;
    this.#text('event-detail', [command, code, timestamp].filter(Boolean).join(' · '));
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
        const name = formatCommandReferences(demo.name);
        option.textContent = demo.active ? name : `${name} (inactiva)`;
        select.append(option);
      }
    }
    select.value = state.selectedId ?? '';
    select.disabled = !state.catalog.length || busy;
    const description = state.catalog.find(demo => demo.id === state.selectedId)?.description;
    this.element('demo-description').hidden = !description;
    this.#text('demo-description', formatCommandReferences(description ?? ''));
    this.element('demo-start').disabled = !state.canStart;
    this.element('demo-cancel').disabled = !state.canCancel;
    this.#setDemoStatus(state, busy, canStart);

    const details = this.element('demo-steps');
    details.hidden = state.selectedId === null;
    const stepsMessage = {
      loading: 'Consultando movimientos…',
      error: state.stepsError,
      ready: state.steps.length ? '' : 'La DEMO no tiene movimientos programados.',
    };
    this.#text('demo-steps-title', state.steps.length ? `Movimientos programados (${state.steps.length})` : 'Movimientos programados');
    this.#text('demo-steps-status', formatCommandReferences(stepsMessage[state.stepsStatus] ?? ''));
    if (state.steps !== this.#steps) {
      this.#steps = state.steps;
      const list = this.element('demo-steps-list');
      list.replaceChildren(...state.steps.map(step => {
        const item = this.#document.createElement('li');
        item.textContent = `${formatCommandName(step.comando)} · ${step.duracion_ms} ms · pausa ${step.pausa_ms} ms`;
        return item;
      }));
    }
  }

  #setDemoStatus(state, busy, canStart) {
    const httpText = this.#demoHttpText(state.http);
    const activeOther = state.activeId !== null && state.activeId !== state.selectedId ? `DEMO activa ID ${state.activeId}.` : null;
    const progress = state.progress
      ? `Movimiento ${state.progress.orden} · ${formatCommandName(state.progress.comando)}.`
      : null;
    const helper = state.stepsStatus === 'ready' && state.steps.length && !state.canStart ? canStart : null;
    const stopNote = state.stopPending || state.stop ? this.#demoStopNote(state.stop) : null;
    const status = formatCommandReferences(
      [activeOther, state.message ?? helper ?? DEMO_IDLE, progress, stopNote].filter(Boolean).join(' '));
    const success = !busy && state.http?.phase !== 'error' &&
      (state.phase === 'completed' || (state.phase === 'canceled' && state.stop?.phase === 'accepted'));

    if (success) {
      this.#text('demo-last-result-text', [httpText, status].filter(Boolean).join(' '));
      this.element('demo-last-result').hidden = false;
    }
    this.#scheduleDemoNotice(success ? state.runToken : null);
    if (this.#demoNotice?.expired) {
      this.#showNeutralDemo();
      return;
    }

    this.#setDemoHttp(httpText);
    this.#setDemoState(status, state.phase);
    this.element('demo-stop-warning').hidden = !state.stopPending;
    const bar = this.element('demo-progress');
    const expected = state.lastEvent?.id_demo === state.selectedId ? state.steps.length : 0;
    bar.hidden = !state.observedSteps || !expected;
    bar.max = expected || 1;
    bar.value = Math.min(state.observedSteps, bar.max);
  }

  #scheduleDemoNotice(key) {
    if ((this.#demoNotice?.key ?? null) === key) return;
    clearTimeout(this.#demoNotice?.timer);
    this.#demoNotice = null;
    if (key === null) return;

    const notice = { key, expired: false };
    notice.timer = setTimeout(() => {
      if (this.#demoNotice !== notice) return;
      notice.expired = true;
      this.#showNeutralDemo();
    }, DEMO_RESULT_MS);
    this.#demoNotice = notice;
  }

  #showNeutralDemo() {
    this.#setDemoHttp('');
    this.#setDemoState(DEMO_IDLE, 'idle');
    this.element('demo-stop-warning').hidden = true;
    const bar = this.element('demo-progress');
    bar.hidden = true;
    bar.value = 0;
    bar.max = 1;
  }

  #demoStopNote(stop) {
    if (stop?.phase === 'accepted') {
      const observation = stop.compatible ? ' Evento WSS compatible recibido.'
        : stop.ambiguous ? ' La correspondencia WSS es indeterminada.' : '';
      return `Detener aceptado por HTTP 200.${observation}`;
    }
    const warning = stop?.phase === 'error' ? 'Detener no se confirmó. ' : '';
    return `${warning}Usa Detener para enviar una orden de parada.`;
  }

  #demoHttpText(http) {
    if (!http) return '';
    const action = http.action === 'start' ? 'Inicio REST' : 'Cancelación REST';
    const outcome = http.phase === 'accepted' ? `HTTP ${http.status} aceptado.`
      : http.phase === 'error' && http.status ? `Error en la solicitud (HTTP ${http.status}).`
        : PHASE_LABELS[http.phase];
    return `${action} · ${outcome}`;
  }

  #setDemoHttp(text) {
    for (const id of ['demo-http', 'demo-http-detail']) {
      const http = this.element(id);
      http.hidden = !text;
      setText(http, text);
    }
  }

  #setDemoState(text, phase) {
    for (const id of ['demo-state', 'demo-status-detail']) {
      const status = this.element(id);
      status.dataset.phase = phase;
      setText(status, text);
    }
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
