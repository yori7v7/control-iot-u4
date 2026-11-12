import { formatCommandName } from './commandLabels.js';

function formatTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?$/u.exec(value);
  if (!match) return value;
  const [, year, month, day, time, offset] = match;
  return `${day}/${month}/${year} · ${time}${offset ? ` ${offset}` : ''}`;
}

function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function eventSource(event) {
  if (event.tipo_evento === 'demo_movimiento') return 'Paso de demostración · WSS';
  if (event.tipo_evento === 'movimiento') return `Movimiento · ${event.origen} · WSS`;
  return 'Instantánea de estado · WSS';
}

export class MonitoringView {
  #document;
  #elements = new Map();
  #vehicleId;
  #vehicleName = null;
  #persistedName = null;
  #rows;
  #hadWss = false;

  constructor(document, vehicleId) {
    this.#document = document;
    this.#vehicleId = vehicleId;
    this.#text('monitor-vehicle-id', `ID ${String(vehicleId).padStart(2, '0')}`);
  }

  #element(id) {
    if (!this.#elements.has(id)) this.#elements.set(id, this.#document.getElementById(id));
    return this.#elements.get(id);
  }

  #text(id, content) {
    setText(this.#element(id), content);
  }

  setVehicle(vehicle, loading) {
    this.#vehicleName = vehicle?.name ?? null;
    this.#showVehicleName(loading);
  }

  #showVehicleName(loading = false) {
    this.#text('monitor-vehicle', this.#vehicleName || this.#persistedName ||
      (loading ? 'Consultando el vehículo…' : `Vehículo ${this.#vehicleId}`));
  }

  showSimulation() {
    this.#text('monitor-command', 'Datos reales no disponibles');
    this.#text('monitor-state-status', 'El modo simulación está activo.');
    this.#text('monitor-history-status', 'El historial real está disponible en el modo conectado.');
    this.#text('monitor-realtime', 'Simulación local');
    this.#element('monitor-refresh').disabled = true;
  }

  render({ persisted, history, event, preview, connected }) {
    this.#persistedName = persisted.value?.vehiculo ?? preview?.estado?.vehiculo ?? null;
    this.#showVehicleName();

    const report = preview ?? persisted.value;
    const command = formatCommandName(report?.comando);
    this.#text('monitor-source', preview ? eventSource(preview) : 'Estado persistido · Origen no informado');
    this.#text('monitor-command', command || this.#emptyCommand(report, persisted.status));
    this.#showTimestamp(this.#element('monitor-timestamp'), preview ? preview.timestamp : report?.fecha_actualizacion);
    this.#text('monitor-state-status', this.#stateMessage(persisted, preview));
    this.#text('monitor-event', event
      ? `Último evento · ${eventSource(event)}${event.comando ? ` · ${formatCommandName(event.comando)}` : ''}`
      : 'Sin eventos recibidos.');

    if (connected) this.#hadWss = true;
    this.#element('monitor-realtime').dataset.connected = String(connected);
    this.#text('monitor-realtime', connected ? 'Actualización en vivo' : this.#hadWss ? 'Reconectando WSS' : 'Esperando conexión WSS');
    this.#showHistory(history);
  }

  #emptyCommand(report, status) {
    if (report === null || report?.estado === null) return 'Sin estado registrado';
    if (report !== undefined) return 'Sin comando reportado';
    return status === 'error' ? 'Estado no disponible' : 'Consultando estado…';
  }

  #stateMessage({ status, value }, preview) {
    if (status === 'error') return value === undefined ? 'No se pudo consultar el estado.' : 'Estado guardado pendiente de actualización.';
    if (status === 'loading' || status === 'idle') {
      if (!preview || !value) return 'Consultando estado persistido…';
      const savedCommand = formatCommandName(value.comando) || 'Sin comando';
      return `Última lectura de RDS · ${savedCommand}. Actualizando…`;
    }
    return value === null ? 'Sin estado registrado en RDS.' : 'Estado confirmado por REST.';
  }

  #showTimestamp(node, value) {
    node.hidden = !value;
    if (value) {
      node.dateTime = value;
      setText(node, formatTimestamp(value));
    } else {
      node.removeAttribute('datetime');
      setText(node, '');
    }
  }

  #showHistory({ status, value }) {
    const statusText = {
      idle: 'Consultando historial…',
      loading: value === undefined ? 'Consultando historial…' : 'Actualizando historial…',
      ready: value?.length ? `${value.length} ${value.length === 1 ? 'movimiento registrado' : 'movimientos registrados'}` : 'Sin movimientos registrados.',
      error: value !== undefined ? 'Historial pendiente de actualización. Se conserva la última lectura.' : 'No se pudo consultar el historial.',
    };
    this.#text('monitor-history-status', statusText[status]);
    if (this.#rows === value) return;
    this.#rows = value;
    this.#element('monitor-history-body').replaceChildren(...(value ?? []).map(row => this.#createRow(row)));
  }

  #createRow(entry) {
    const row = this.#document.createElement('tr');
    row.dataset.historyId = entry.id_historial;
    const date = row.insertCell();
    if (entry.fecha_hora) {
      const time = this.#document.createElement('time');
      this.#showTimestamp(time, entry.fecha_hora);
      date.append(time);
    } else {
      date.textContent = 'Fecha no disponible';
    }

    const command = row.insertCell();
    command.textContent = formatCommandName(entry.comando) || 'Sin comando';
    if (entry.codigo !== null) {
      const code = this.#document.createElement('small');
      code.textContent = `Código ${entry.codigo}`;
      command.append(code);
    }
    const origin = row.insertCell();
    origin.textContent = entry.origen || 'Sin origen';
    const id = this.#document.createElement('small');
    id.textContent = `#${entry.id_historial}`;
    origin.append(id);
    return row;
  }
}
