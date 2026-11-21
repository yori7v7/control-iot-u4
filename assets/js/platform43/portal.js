import { ApiClient } from '../services/ApiClient.js';
import { ConnectionService } from '../services/ConnectionService.js';
import { ConnectionIndicators } from '../ui/ConnectionIndicators.js';
import { showAdmin } from './admin.js';
import { baseUrl, request } from './client.js';
import { button, el, field, form, input, list, section, select } from './dom.js';
import { demoEditor } from './editor.js';

export function portal(mount) {
  document.body.classList.add('platform43');
  const byId = id => document.getElementById(id);
  const panel = byId('platform-view');
  const status = byId('platform-status');
  const account = byId('platform-account');
  const control = byId('control-view');
  const monitor = byId('monitor-view');
  const timer = byId('platform-time');

  const indicators = new ConnectionIndicators(document);
  const health = new ConnectionService({
    api: new ApiClient({ baseUrl, operatorApiKey: '' }),
    onApiState: value => indicators.set('api', value),
    onDatabaseState: value => indicators.set('rds', value),
  });
  let identity;
  let units = [];
  let vehicle;
  let active;
  let expiration;
  let generation = 0;


  function report(message = '', error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
    status.hidden = !message;
  }

  function invalidate(message, error = true) {
    active?.scope.abort();
    active = undefined;
    identity = undefined;
    units = [];
    vehicle = undefined;
    clearInterval(expiration);
    timer.textContent = '';
    timer.hidden = true;
    report(message, error);
    location.hash = '#cuenta';
    route();
  }

  async function api(path, options) {
    const current = identity;
    try {
      return await request(path, { ...options, token: current?.token });
    } catch (error) {
      if (current && identity === current && error.status === 401) invalidate('La sesión caducó o fue revocada.');
      throw error;
    }
  }

  async function open(session) {
    identity = session;
    report();
    clearInterval(expiration);
    const update = () => {
      const remaining = Math.max(0, Math.ceil((Date.parse(session.vence) - Date.now()) / 1000));
      if (!remaining) {
        invalidate('La sesión caducó.');
        return;
      }
      timer.hidden = session.rol !== 'invitado';
      timer.textContent = timer.hidden ? '' : `Exhibición · ${remaining} s`;
    };
    expiration = setInterval(update, 1000);
    update();
    if (identity !== session) return;
    if (session.rol !== 'administrador') {
      try {
        const available = await api('/vehiculos');
        if (identity !== session) return;
        units = available;
        vehicle = units[0]?.id_vehiculo;
      } catch (error) {
        if (identity === session) report(error.message, true);
      }
    }
    location.hash = session.rol === 'administrador' ? '#administracion' : vehicle ? '#control' : '#cuenta';
    route();
  }

  async function signOut() {
    try {
      await api('/sesion', { method: 'DELETE' });
      invalidate('Sesión cerrada.', false);
    } catch (error) {
      if (identity) report(error.message, true);
    }
  }

  function loginPanel(expected) {
    const listing = el('div', {}, el('p', { role: 'status' }, 'Consultando catálogo…'));
    const signIn = form('Iniciar sesión', [
      field('Correo', input('email', 'email', '', { autocomplete: 'username', maxLength: 254, required: true })),
      field('Contraseña', input('password', 'password', '', { autocomplete: 'current-password', maxLength: 128, required: true })),
    ], async values => {
      const session = await request('/sesion', { method: 'POST', body: Object.fromEntries(values) });
      if (generation === expected) await open(session);
    }, report);
    panel.replaceChildren(el('h2', { tabIndex: -1 }, 'Acceso a la plataforma'),
      el('div', { class: 'iot-columns' }, section('Compradores y administración', signIn),
        section('Prueba nuestros vehículos IoT', listing)));

    async function fetchCatalog() {
      try {
        const catalog = await request('/catalogo');
        if (generation !== expected) return;
        listing.replaceChildren(list(catalog.modelos, model => [
          el('strong', {}, model.nombre),
          model.descripcion ? el('p', {}, model.descripcion) : null,
          list(catalog.unidades.filter(unit => unit.modelo === model.id), unit => [
            el('span', {}, unit.nombre),
            unit.disponible ? button('Solicitar demostración', async event => {
              const action = event.currentTarget;
              action.disabled = true;
              try {
                const session = await request(`/invitados/${unit.vehiculo}`, { method: 'POST' });
                if (generation === expected) await open(session);
              } catch (error) {
                report(error.message, true);
                void fetchCatalog();
              } finally {
                action.disabled = false;
              }
            }) : el('span', {}, 'Reservada'),
          ], 'Sin unidades de exhibición.'),
        ], 'No hay modelos públicos.'));
      } catch (error) {
        if (generation === expected) listing.replaceChildren(el('p', { role: 'alert' }, error.message),
          button('Actualizar catálogo', () => void fetchCatalog(), true));
      }
    }
    void fetchCatalog();
  }

  function accountPanel(expected) {
    const editorContent = el('div');
    const editor = el('div', {}, button('Volver a vehículos', () => show(workspace), true), editorContent);
    let editorRequest = 0;
    const unitSelection = select('vehiculo', units.map(unit => [unit.id_vehiculo, unit.nombre]), vehicle);
    unitSelection.onchange = () => {
      vehicle = Number(unitSelection.value);
      editorContent.replaceChildren();
    };
    const profile = section(identity.rol === 'invitado' ? 'Sesión de exhibición' : 'Mi cuenta',
      el('p', {}, identity.nombre));
    if (identity.rol !== 'invitado') {
      profile.append(form('Cambiar contraseña', [
        field('Contraseña actual', input('actual', 'password', '', { required: true, maxLength: 128, autocomplete: 'current-password' })),
        field('Nueva contraseña', input('nueva', 'password', '', { required: true, minLength: 12, maxLength: 128, autocomplete: 'new-password' })),
      ], async values => {
        await api('/perfil/password', { method: 'PUT', body: Object.fromEntries(values) });
        invalidate('Contraseña actualizada. Inicia sesión de nuevo.', false);
      }, report));
    }
    const workspace = section(identity.rol === 'invitado' ? 'Unidad de exhibición' : 'Mis vehículos',
      units.length ? field('Vehículo', unitSelection) : el('p', {}, 'Sin vehículos asignados.'),
      units.length ? el('div', { class: 'iot-actions iot-vehicle-actions' },
        button('Abrir Control', () => { location.hash = '#control'; }),
        button('Abrir Monitoreo', () => { location.hash = '#monitoreo'; }, true),
        identity.rol === 'usuario' ? button('Mis DEMOS', () => void loadEditor(), true) : null) : null);
    const tabs = el('nav', { class: 'iot-actions iot-account-nav', 'aria-label': 'Secciones de cuenta' },
      identity.rol !== 'administrador' ? button('Vehículos', () => show(workspace), true) : null,
      button('Perfil', () => show(profile), true), button('Cerrar sesión', () => void signOut(), true));
    const show = (selected, focus = true) => {
      for (const surface of [workspace, profile, editor]) surface.hidden = surface !== selected;
      if (focus) {
        const target = selected.querySelector('h3, button');
        if (target) { target.tabIndex = 0; target.focus(); }
      }
    };
    panel.replaceChildren(el('h2', { tabIndex: -1 }, 'Cuenta y vehículos'), tabs, workspace, profile, editor);
    show(identity.rol === 'administrador' ? profile : workspace, false);

    async function loadEditor(selected) {
      const target = vehicle;
      const base = `/vehiculos/${target}/demos/privadas`;
      const requested = ++editorRequest;
      show(editor);
      editorContent.replaceChildren(el('p', { role: 'status' }, 'Cargando DEMOS…'));
      try {
        const [demos, commands] = await Promise.all([api(base), api(`/vehiculos/${target}/comandos`)]);
        if (expected !== generation || vehicle !== target || requested !== editorRequest) return;
        const view = demoEditor({
          demos, commands, report, reload: loadEditor,
          save: (id, body) => api(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', body }),
        });
        if (selected) view.select(selected);
        editorContent.replaceChildren(view.node);
      } catch (error) {
        if (expected === generation && vehicle === target && requested === editorRequest) {
          editorContent.replaceChildren(el('p', { role: 'alert' }, error.message));
        }
      }
    }
  }

  function route() {
    const hash = location.hash;
    const isAdmin = identity?.rol === 'administrador';
    const isConsole = Boolean(identity && vehicle && ['#control', '#monitoreo'].includes(hash));
    const isAdminPanel = isAdmin && hash === '#administracion';
    for (const link of document.querySelectorAll('a[data-view]')) {
      const shown = link.dataset.view === 'administracion' ? isAdmin : Boolean(identity && vehicle);
      link.hidden = !shown;
      if (shown && link.hash === hash) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }

    account.textContent = identity ? 'Cuenta' : 'Acceso';
    panel.hidden = isConsole;
    document.body.classList.toggle('platform-ops', isConsole);
    if (isConsole && active?.vehicle === vehicle) return;
    active?.scope.abort();
    active = undefined;
    const expected = ++generation;
    control.hidden = true;
    monitor.hidden = true;
    document.body.dataset.view = isConsole ? hash.slice(1) : 'plataforma';
    if (isConsole) {
      health.stop();
      const current = identity;
      const scope = new AbortController();
      active = { vehicle, scope };
      const socketUrl = new URL(`/plataforma/ws/vehiculos/${vehicle}`, baseUrl);
      socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
      const ticketPath = `/vehiculos/${vehicle}/ticket`;
      void mount({
        vehicleId: vehicle, signal: scope.signal, simulation: false,
        apiOptions: { baseUrl, session: current.token, operatorApiKey: '',
          onUnauthorized: () => { if (identity === current) invalidate('La sesión caducó o fue revocada.'); } },
        socketOptions: { url: socketUrl.href, getProtocols: async () => {
          const { ticket } = await api(ticketPath, { method: 'POST', signal: scope.signal });
          return ['iot43', ticket];
        } },
      }).catch(error => report(error.message, true));
      return;
    }
    indicators.set('ws', 'disconnected');
    void health.start();
    if (isAdminPanel) showAdmin(panel, api, report);
    else if (identity) accountPanel(expected);
    else loginPanel(expected);
  }

  document.querySelectorAll('[data-platform-link]').forEach(link => { link.hidden = false; });

  byId('refresh').addEventListener('click', () => { if (!active) void health.refresh(); });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { if (!active) void health.refresh(); });
  window.addEventListener('pagehide', () => health.stop());
  window.addEventListener('pageshow', event => { if (event.persisted && !active) void health.start(); });
  route();
}
