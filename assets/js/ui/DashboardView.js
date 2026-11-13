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
  DEMO_ORIGINAL: 'demo-original',
  CLAXON: 'horn',
};
const DIRECTION_PULSE = {
  frames: [
    { transform: 'none' },
    { transform: 'translate(var(--press-x, 0px), var(--press-y, 0px)) scale(1.12)', offset: .28 },
    { transform: 'none' },
  ],
  duration: 180,
};
const AUXILIARY_PULSES = {
  LUCES: {
    frames: [
      { filter: 'none' },
      { filter: 'brightness(1.75) drop-shadow(0 0 5px #ff8e97)', offset: .22 },
      { filter: 'none' },
    ],
    duration: 300,
  },
  VELOCIDAD: {
    frames: [{ transform: 'none' }, { transform: 'rotate(20deg)', offset: .34 }, { transform: 'none' }],
    duration: 240,
  },
  DEMO_ORIGINAL: {
    frames: [{ transform: 'none' }, { transform: 'scale(1.16)', offset: .32 }, { transform: 'none' }],
    duration: 200,
  },
  CLAXON: {
    frames: [
      { transform: 'none' }, { transform: 'rotate(-9deg)', offset: .2 },
      { transform: 'rotate(7deg)', offset: .44 }, { transform: 'rotate(-4deg)', offset: .68 },
      { transform: 'none' },
    ],
    duration: 230,
  },
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
const PUBLIC_ROLES = { observer: 'Observador', guest: 'Invitado', administrator: 'Administrador' };
const PUBLIC_STATUS = {
  unavailable: 'Los turnos de invitado aún no están disponibles.',
  closed: 'La demostración está desactivada.',
  available: 'Hay un turno disponible.',
  occupied: 'El turno está ocupado.',
  stopping: 'Verificando la parada simulada.',
  blocked: 'Los turnos están bloqueados.',
  unknown: 'Sin confirmación de disponibilidad.',
};
const PUBLIC_LABELS = {
  unavailable: 'Turnos', closed: 'Turnos', available: 'Turno libre', occupied: 'Turno ocupado',
  stopping: 'Deteniendo', blocked: 'Turnos', unknown: 'Turnos',
};
const ADMIN_STATUS = {
  checking: 'Verificando permisos administrativos…',
  rejected: 'La API rechazó la clave administrativa.',
  unavailable: 'No se pudieron verificar los permisos administrativos.',
};
// K-H no habilita el joystick; solo comunica estados de autorización.
const GUEST_ADMISSION_LABELS = Object.freeze({
  requesting: 'Solicitando permiso',
  waiting: 'En espera',
  approved_virtual: 'Permiso virtual',
  revoked: 'Turno revocado',
  unavailable: 'Sin acceso',
});
const GUEST_ADMISSION_MESSAGES = Object.freeze({
  requesting: 'Solicitando acceso al administrador…',
  waiting: 'Esperando autorización del administrador.',
  approved_virtual: 'Autorización virtual concedida. Control físico deshabilitado.',
  revoked: 'El turno fue revocado o caducó.',
  unavailable: 'No se pudo comprobar el permiso. El control permanece bloqueado.',
});

function setText(node, content) {
  if (node.textContent !== content) node.textContent = content;
}

function formatCountdown(seconds) {
  const total = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export class DashboardView {
  #document;
  #elements = new Map();
  #catalog = null;
  #demoCatalog = null;
  #steps = null;
  #demoNotice = null;
  #pressAnimations = new WeakMap();
  #publicControl = null;
  #guestAdmission = null;
  #controlMode = { canStop: false, catalogStatus: 'Esperando catálogo' };
  #publicSimulation = false;
  #showingGuestReceipt = false;

  constructor(document) {
    this.#document = document;
    const supervision = this.element('public-supervision');
    supervision.addEventListener('change', () => this.#setSupervision());
    this.element('public-control').addEventListener('toggle', event => {
      if (event.newState === 'closed') this.resetSupervision();
    });
  }

  element(id) {
    if (!this.#elements.has(id)) this.#elements.set(id, this.#document.getElementById(id));
    return this.#elements.get(id);
  }

  #text(id, content) {
    setText(this.element(id), content);
  }

  setSimulation(simulation, isLocal, { publicSimulation = false } = {}) {
    this.#publicSimulation = publicSimulation;
    this.element('simulation-banner').hidden = !simulation;
    this.element('exit-simulation').hidden = !simulation || publicSimulation;
    this.element('open-session').hidden = simulation && !publicSimulation;
    this.element('simulation-link').hidden = simulation || !isLocal;
    if (publicSimulation) {
      this.#text('session-risk', 'Usa únicamente una clave ficticia de la simulación local.');
      this.#text('session-key-help', 'La clave de prueba se utiliza para verificar permisos administrativos y se mantiene en memoria.');
      this.#text('risk-ack-label', 'Confirmo que usaré una clave ficticia.');
    }
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
    const notice = this.element('notice');
    notice.dataset.tone = bad ? 'bad' : 'idle';
    notice.hidden = !message;
    setText(notice, formatCommandReferences(message));
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
    let graphic;
    if (icon) {
      graphic = this.#document.createElementNS(SVG, 'svg');
      graphic.setAttribute('class', 'icon');
      graphic.setAttribute('aria-hidden', 'true');
      const use = this.#document.createElementNS(SVG, 'use');
      use.setAttribute('href', `./assets/icons.svg#${icon}`);
      graphic.append(use);
      button.append(graphic);
    }
    const caption = this.#document.createElement('span');
    caption.className = 'command-label';
    caption.textContent = label;
    button.append(caption);
    button.addEventListener('click', () => {
      if (!button.disabled && request(key) && graphic) this.#pulseCommand(key, graphic);
    });
    return button;
  }

  #pulseCommand(key, graphic) {
    const pulse = Object.hasOwn(DIRECTIONS, key) ? DIRECTION_PULSE : AUXILIARY_PULSES[key];
    if (!pulse || !graphic.animate) return;
    this.#pressAnimations.get(graphic)?.cancel();
    if (this.#document.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const { frames, duration } = pulse;
    this.#pressAnimations.set(graphic, graphic.animate(frames, { duration, easing: 'ease-out' }));
  }

  setControl({ armed, canCommand, canStop, canClose, busy, catalogReady, catalogStatus }) {
    this.#controlMode = { canStop, catalogStatus };
    this.#renderControlMode();
    const sessionLabel = armed ? 'Sesión de control' : 'Habilitar control';
    this.#text('session-label', sessionLabel);
    this.element('open-session').title = sessionLabel;
    const scope = this.#publicSimulation ? 'simulado' : 'real';
    this.#text('session-title', armed ? `Sesión de control ${scope}` : `Habilitar control ${scope}`);
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

  setPublicControl(state) {
    this.#publicControl = state;
    this.#renderControlMode();
    if (!state) return;

    const { role, status, simulation, windowSeconds, turnSeconds, canAcquire, canRelease,
      canDisable, canRevoke, adminPermission, message } = state;
    const guest = role === 'guest';
    const administrator = role === 'administrator';
    const showAdmin = simulation && administrator;
    const windowOpen = windowSeconds > 0 || canDisable;
    const statusText = PUBLIC_STATUS[status] ?? 'Consultando disponibilidad…';
    this.#text('public-control-role', PUBLIC_ROLES[role] ?? PUBLIC_ROLES.observer);
    this.#text('public-control-status', guest && status === 'occupied' ? 'Tienes el turno.' : statusText);
    this.element('public-control-simulation').hidden = !simulation;
    this.element('public-exit-simulation').hidden = !simulation;
    const messageText = message || ADMIN_STATUS[adminPermission] || '';
    this.#text('public-control-message', messageText);
    this.element('public-control-message').hidden = !messageText;
    this.#setCountdown('window', windowSeconds, simulation);
    this.#setCountdown('turn', turnSeconds, simulation && (guest || administrator));

    this.element('public-guest-actions').hidden = !simulation || administrator;
    this.element('public-take').hidden = guest;
    this.element('public-take').disabled = !canAcquire;
    this.element('public-release').hidden = !guest;
    this.element('public-release').disabled = !canRelease;
    this.element('public-admin-actions').hidden = !showAdmin;
    this.element('public-close-window').hidden = !windowOpen;
    this.element('public-close-window').disabled = !canDisable;
    this.element('public-open-window').hidden = windowOpen;
    this.element('public-revoke').disabled = !canRevoke;
    this.element('public-supervision-field').hidden = windowOpen;
    if (!showAdmin || windowOpen) this.resetSupervision();
    else this.#setSupervision();
  }

  setGuestAdmission(state) {
    this.#guestAdmission = state?.phase !== 'inactive' ? state : null;
    this.#renderControlMode();
    if (!this.#guestAdmission) return;
    const text = GUEST_ADMISSION_MESSAGES[state.phase] ?? GUEST_ADMISSION_MESSAGES.unavailable;
    this.#text('public-control-role', 'Visitante');
    this.#text('public-control-status', state.code ? `${text} Solicitud ${state.code}.` : text);
    this.element('public-guest-actions').hidden = true;
    this.element('public-admin-actions').hidden = true;
  }

  #renderControlMode() {
    const { canStop, catalogStatus } = this.#controlMode;
    const state = this.#publicControl;
    const label = state?.simulation ? (state.role === 'guest' ? 'Tu turno' : PUBLIC_LABELS[state.status] ?? 'Turnos')
      : state && !canStop ? 'Turnos' : canStop ? 'HABILITADO' : 'BLOQUEADO';
    const trigger = this.element('open-public-control');
    const guestLabel = this.#guestAdmission
      ? GUEST_ADMISSION_LABELS[this.#guestAdmission.phase] ?? 'Sin acceso' : null;
    const text = guestLabel || catalogStatus || (state?.adminPermission === 'rejected' ? 'Clave rechazada' : label);
    this.#text('control-mode', text);
    this.#text('control-mode-announcement', text);
    trigger.setAttribute('aria-label', `Turnos de control · ${text}`);
    trigger.disabled = !state || typeof this.element('public-control').showPopover !== 'function';
    trigger.dataset.armed = String(canStop);
    trigger.toggleAttribute('data-catalog-status', Boolean(catalogStatus));
  }

  #setCountdown(kind, seconds, allowed) {
    const visible = allowed && Number.isFinite(seconds) && seconds > 0;
    this.element(`public-${kind}-time`).hidden = !visible;
    this.#text(`public-${kind}-countdown`, visible ? formatCountdown(seconds) : '');
  }

  resetSupervision() {
    this.element('public-supervision').checked = false;
    this.#setSupervision();
  }

  #setSupervision() {
    const supervision = this.element('public-supervision');
    supervision.disabled = !this.#publicControl?.canEnable;
    this.element('public-open-window').disabled = supervision.disabled || !supervision.checked;
  }

  setPreview(key) {
    this.element('joystick').dataset.direction = key ?? '';
    this.#text('joystick-direction', key ? formatCommandName(key) : 'POSICIÓN NEUTRAL');
  }

  setCommand(state) {
    if (!state) return;
    const { command, phase, message, correlation, ambiguous } = state;
    this.element('control-receipt').dataset.commandPhase = phase;
    const commandLabel = `${formatCommandName(command.name)} · ID ${command.id}`;
    this.#text('last-command', commandLabel);
    const status = formatCommandReferences(phase === 'error' && message
      ? message : [PHASE_LABELS[phase], message].filter(Boolean).join(' '));
    this.#text('command-state', status);
    this.element('event-correlation').hidden = phase !== 'accepted';
    this.#text('event-correlation', ambiguous
      ? 'Varias coincidencias WSS. La relación es indeterminada.'
      : correlation
        ? 'WSS compatible (orientativo).'
        : 'Sin WSS compatible.');
  }

  setGuestCommand(state, { active = Boolean(state) } = {}) {
    if (!active && !this.#showingGuestReceipt) return;
    this.#showingGuestReceipt = active;
    const receipt = this.element('control-receipt');
    if (state?.phase) receipt.dataset.commandPhase = state.phase;
    else delete receipt.dataset.commandPhase;
    this.element('event-correlation').hidden = true;
    this.element('receipt-wss').hidden = true;
    this.#text('last-command', state?.action ? `${formatCommandName(state.action)} · Simulación` : 'Sin comandos solicitados');
    const detail = [state?.status && `HTTP ${state.status}`, state?.message].filter(Boolean).join(' · ');
    this.#text('command-state', detail || (active ? 'Esperando una acción simulada.' : 'Esperando una acción manual.'));
  }

  setEvent(event) {
    this.element('receipt-wss').hidden = this.#showingGuestReceipt || event.tipo_evento === 'estado_actual';
    const label = EVENT_LABELS[event.tipo_evento];
    const demo = event.id_demo ? formatCommandReferences(event.nombre_demo || `DEMO ${event.id_demo}`) : null;
    this.#text('last-event', demo ? `${label} · ${demo}` : label);
    const timestamp = event.timestamp?.replace('T', ' ');
    const command = formatCommandName(event.comando);
    const code = command && event.codigo != null ? `código ${event.codigo}` : null;
    this.#text('event-detail', [command, code, timestamp].filter(Boolean).join(' · '));
  }

  setDemo(state, { loading, busy, canStart, canOperateDemo = true, canSelectDemo = true }) {
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
    select.disabled = !state.catalog.length || busy || !canSelectDemo;
    const description = state.catalog.find(demo => demo.id === state.selectedId)?.description;
    this.element('demo-description').hidden = !description;
    this.#text('demo-description', formatCommandReferences(description ?? ''));
    this.element('demo-start').disabled = !state.canStart || !canOperateDemo;
    this.element('demo-cancel').disabled = !state.canCancel || !canOperateDemo;
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
