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
  return 'Estado inicial · WSS';
}

function pagesFor(rows, capacity) {
  const pages = [];
  let page = [];
  let height = 0;
  for (const { entry, rowHeight } of rows) {
    if (page.length && height + rowHeight > capacity) {
      pages.push(page);
      page = [];
      height = 0;
    }
    page.push(entry);
    height += rowHeight;
  }
  if (page.length) pages.push(page);
  return pages;
}

export class MonitoringView {
  #document;
  #elements = new Map();
  #vehicleId;
  #vehicleName = null;
  #persistedName = null;
  #rows;
  #hadWss = false;
  #pages = [];
  #page = 0;
  #shown = [];
  #newer = false;
  #layoutPending = false;

  constructor(document, vehicleId) {
    this.#document = document;
    this.#vehicleId = vehicleId;
    this.#text('monitor-vehicle-id', `ID ${String(vehicleId).padStart(2, '0')}`);
    this.#element('monitor-history-prev').addEventListener('click', () => this.#changePage(-1));
    this.#element('monitor-history-next').addEventListener('click', () => this.#changePage(1));

    const win = document.defaultView;
    const schedule = () => this.#scheduleHistoryLayout();
    const resize = new win.ResizeObserver(schedule);
    for (const element of document.querySelectorAll('.topbar, .connectivity, .monitor-report, #monitor-history-heading')) {
      resize.observe(element);
    }
    win.addEventListener('resize', schedule);
    win.visualViewport?.addEventListener('resize', schedule);
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
    const eventCommand = event?.comando === report?.comando ? null : formatCommandName(event?.comando);
    this.#text('monitor-source', preview ? eventSource(preview) : 'Estado persistido · REST');
    this.#text('monitor-command', command || this.#emptyCommand(report, persisted.status));
    this.#showTimestamp(this.#element('monitor-timestamp'), preview ? preview.timestamp : report?.fecha_actualizacion);
    this.#text('monitor-state-status', this.#stateMessage(persisted, preview));
    this.#text('monitor-event', event
      ? [eventSource(event), eventCommand].filter(Boolean).join(' · ')
      : 'Sin eventos recibidos.');

    if (connected) this.#hadWss = true;
    this.#element('monitor-realtime').dataset.connected = String(connected);
    this.#text('monitor-realtime', connected ? 'WSS en vivo' : this.#hadWss ? 'Reconectando WSS' : 'Esperando WSS');
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
      if (preview.comando === value.comando) return 'Actualizando lectura de RDS…';
      const savedCommand = formatCommandName(value.comando) || 'Sin comando';
      return `RDS anterior · ${savedCommand}. Actualizando…`;
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
    if (this.#page > 0 && value?.length && !this.#rows?.some(row => row.id_historial === value[0].id_historial)) {
      this.#newer = true;
    }
    this.#rows = value;
    this.#scheduleHistoryLayout();
  }

  #scheduleHistoryLayout() {
    if (this.#layoutPending) return;
    this.#layoutPending = true;
    this.#document.defaultView.requestAnimationFrame(() => {
      this.#layoutPending = false;
      if (!this.#element('monitor-view').hidden) this.#layoutHistory();
    });
  }

  #layoutHistory() {
    const entries = this.#rows ?? [];
    let page = 0;
    let pages = [];
    if (entries.length) {
      const { measured, fullHeight, available, paginatedCapacity } = this.#measureHistory(entries);
      if (fullHeight <= available) {
        pages = [entries];
      } else {
        // Keep an older page's first surviving row at the top after a live update or resize.
        const previous = this.#page > 0 ? this.#pages[this.#page] : [];
        const indices = new Map(entries.map((entry, index) => [entry.id_historial, index]));
        const anchor = previous.find(entry => indices.has(entry.id_historial));
        const split = indices.get(anchor?.id_historial) ?? 0;
        const prefix = pagesFor(measured.slice(0, split), paginatedCapacity);
        const suffix = pagesFor(measured.slice(split), paginatedCapacity);
        pages = [...prefix, ...suffix];
        page = previous.length && !anchor ? pages.length - 1 : prefix.length;
      }
    }
    this.#pages = pages;
    this.#page = page;
    this.#renderPage();
  }

  #measureHistory(entries) {
    const win = this.#document.defaultView;
    const region = this.#element('monitor-history-table');
    const history = region.parentElement;
    const view = this.#element('monitor-view');
    const shell = view.parentElement;
    const pixels = (node, property) => parseFloat(win.getComputedStyle(node)[property]) * (node.currentCSSZoom ?? 1);
    const viewport = Math.min(this.#document.documentElement.clientHeight, win.visualViewport?.height ?? Infinity);
    const regionTop = region.getBoundingClientRect().top + win.scrollY;
    const available = Math.floor(viewport - regionTop - pixels(history, 'paddingBottom') -
      pixels(view, 'borderBottomWidth') - pixels(shell, 'paddingBottom'));

    const probe = this.#document.createElement('div');
    probe.className = 'monitor-table-measure';
    probe.inert = true;
    probe.setAttribute('aria-hidden', 'true');
    const displayed = region.firstElementChild;
    const table = displayed.cloneNode(false);
    table.append(displayed.tHead.cloneNode(true));
    const rows = entries.map(entry => this.#createRow(entry));
    table.createTBody().append(...rows);
    const pager = this.#element('monitor-history-pagination').cloneNode(true);
    setText(pager.querySelector('#monitor-history-page'), 'Página 10 de 10');
    pager.querySelector('#monitor-history-new').hidden = !this.#newer;
    for (const node of [pager, ...pager.querySelectorAll('[id]')]) node.removeAttribute('id');
    pager.hidden = false;
    probe.append(table, pager);
    region.append(probe);
    const measured = rows.map((row, index) => ({ entry: entries[index], rowHeight: row.getBoundingClientRect().height }));
    const fullHeight = table.getBoundingClientRect().height;
    const paginatedCapacity = available - table.tHead.getBoundingClientRect().height -
      pager.getBoundingClientRect().height - pixels(history, 'rowGap') - 1;
    probe.remove();
    return { measured, fullHeight, available, paginatedCapacity };
  }

  #changePage(direction) {
    const page = this.#page + direction;
    if (page < 0 || page >= this.#pages.length) return;
    this.#page = page;
    this.#renderPage();
  }

  #renderPage() {
    const entries = this.#pages[this.#page] ?? [];
    if (entries.length !== this.#shown.length || entries.some((entry, index) => entry !== this.#shown[index])) {
      this.#element('monitor-history-body').replaceChildren(...entries.map(row => this.#createRow(row)));
      this.#shown = entries;
    }
    const pager = this.#element('monitor-history-pagination');
    if (this.#page === 0) this.#newer = false;
    const multiple = this.#pages.length > 1;
    if (!multiple && pager.contains(this.#document.activeElement)) {
      this.#element('monitor-history-title').focus({ preventScroll: true });
    }
    pager.hidden = !multiple;
    this.#element('monitor-history-prev').setAttribute('aria-disabled', String(this.#page === 0));
    this.#element('monitor-history-next').setAttribute('aria-disabled', String(this.#page >= this.#pages.length - 1));
    this.#text('monitor-history-page', multiple ? `Página ${this.#page + 1} de ${this.#pages.length}` : '');
    this.#element('monitor-history-new').hidden = !this.#newer;
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
