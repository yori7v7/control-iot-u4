import { CONFIG, isSimulation } from './config.js';
import { Command } from './models/Command.js';
import { Demo } from './models/Demo.js';
import { Vehicle } from './models/Vehicle.js';
import { ApiClient } from './services/ApiClient.js';
import { ConnectionService } from './services/ConnectionService.js';
import { WebSocketClient } from './services/WebSocketClient.js';
import { CommandService } from './controllers/CommandService.js';
import { DemoController } from './controllers/DemoController.js';
import { JoystickController } from './controllers/JoystickController.js';
import { MonitoringController } from './controllers/MonitoringController.js';
import { ConnectionIndicators } from './ui/ConnectionIndicators.js';
import { DashboardView } from './ui/DashboardView.js';
import { MonitoringView } from './ui/MonitoringView.js';

const view = new DashboardView(document);

function catalogIsInvalid(error) {
  return error.status === 404 || error.kind === 'format' || error instanceof TypeError;
}

async function mount({ vehicleId = CONFIG.vehicleId, apiOptions = {}, socketOptions = {},
                       simulation = isSimulation(location.search), signal } = {}) {
  const listeners = { signal };
  const transport = simulation ? (await import('./services/simulation.js')).createSimulation() : {};
  const api = new ApiClient({ vehicleId, simulation, ...transport, ...apiOptions });
  if (signal?.aborted) return;
  const indicators = new ConnectionIndicators(document);
  const monitoringView = new MonitoringView(document, vehicleId);
  const monitoring = new MonitoringController({
    vehicleId,
    readState: simulation ? async () => null : options => api.getVehicleState(options),
    readHistory: simulation ? async () => [] : options => api.getMovementHistory(options),
    onChange: state => simulation ? monitoringView.renderDemo(state.demo) : monitoringView.render(state),
  });
  let vehicle = null;
  let catalog = [];
  let catalogVerified = false;
  let refreshing = null;
  let loading = true;
  let wsConnected = false;
  let apiWasUnavailable = false;
  let currentView = null;

  const canControl = () => api.hasApiKey && vehicle?.active === true;
  const canStop = () => canControl() && Boolean(commands.getCommand('DETENER'));
  const canCommand = key => catalogVerified && !apiWasUnavailable && canStop() && !demo.busy && !commands.stopping && Boolean(commands.getCommand(key));
  const controlBusy = () => commands.busy || demo.busy;
  const commands = new CommandService({
    api, vehicleId, canControl,
    isDemoBusy: () => demo.busy,
    beforeStop: () => demo.cancelForStop(),
    observeStop: () => demo.observeStop(),
    onChange: render,
  });
  const demo = new DemoController({
    api, vehicleId, canControl,
    canStart: () => canStop() && wsConnected && !commands.busy && !commands.mayBeMoving,
    onChange: render,
  });
  const joystick = new JoystickController({
    element: view.element('joystick'),
    knob: view.element('joystick-knob'),
    canCommand,
    onDirection: key => commands.request(key),
    onRelease: () => commands.stop(),
    onPreview: key => view.setPreview(key),
  });
  const connection = new ConnectionService({
    api,
    onApiState(state) {
      indicators.set('api', state);
      if (state === 'unavailable' && !apiWasUnavailable) {
        apiWasUnavailable = true;
        catalogVerified = false;
        render();
      }
      if (state === 'available' && apiWasUnavailable) {
        apiWasUnavailable = false;
        void loadCatalog();
        if (!simulation && currentView === 'monitoreo') void monitoring.refresh();
      }
    },
    onDatabaseState: state => indicators.set('rds', state),
  });
  const socket = new WebSocketClient({
    vehicleId, ...transport, ...socketOptions,
    onState(state) {
      indicators.set('ws', state);
      wsConnected = state === 'connected';
      demo.setConnected(wsConnected);
      monitoring?.setConnected(wsConnected);
      render();
    },
    onEvent(event) {
      view.setEvent(event);
      commands.handleEvent(event);
      demo.handleEvent(event);
      monitoring?.handleEvent(event);
    },
    onInvalid: message => view.setNotice(message, true),
  });

  function render() {
    if (signal?.aborted) return;
    const catalogReady = catalogVerified && !apiWasUnavailable;
    const catalogStatus = apiWasUnavailable ? 'Sin conexión'
      : !catalogReady ? (loading ? 'Esperando catálogo' : 'Catálogo sin verificar')
        : !catalog.some(command => command.active && command.key !== 'DETENER') ? 'Sin comandos activos' : '';
    view.setVehicle(vehicle, vehicleId, loading);
    monitoringView.setVehicle(vehicle, loading);
    view.setCatalog(catalog, key => commands.request(key));
    view.setControl({
      armed: api.hasApiKey, canCommand, canStop: canStop(),
      catalogReady, catalogStatus,
    });
    const inMonitoring = currentView === 'monitoreo';
    const demoState = demo.state;
    view.element('stop').hidden = inMonitoring && !(canStop() && (commands.mayBeMoving || controlBusy() || demoState.stopPending));
    view.setCommand(commands.state);
    view.setDemo(demoState, {
      loading, busy: demo.busy,
      canStart: demo.busy ? null
        : !canStop() ? 'Verifica la configuración de operador y que DETENER esté disponible para iniciar.'
          : !wsConnected ? 'Espera la conexión WSS para observar el progreso.'
            : commands.mayBeMoving ? 'Pulsa DETENER antes de iniciar una DEMO.' : null,
    });
  }

  function loadCatalog() {
    if (refreshing) return refreshing;
    loading = true;
    render();
    refreshing = Promise.allSettled([
      api.getVehicle().then(row => new Vehicle(row, vehicleId)),
      api.getCommands().then(rows => Command.forVehicle(rows, vehicleId)),
      api.getDemos().then(rows => Demo.forVehicle(rows, vehicleId)),
    ]).then(([vehicleResult, commandsResult, demosResult]) => {
      if (signal?.aborted) return;
      if (vehicleResult.status === 'fulfilled') vehicle = vehicleResult.value;
      else if (catalogIsInvalid(vehicleResult.reason)) vehicle = null;
      catalogVerified = commandsResult.status === 'fulfilled';
      if (catalogVerified) {
        catalog = commandsResult.value;
        commands.setCatalog(catalog);
      } else if (catalogIsInvalid(commandsResult.reason)) {
        catalog = [];
        commands.setCatalog(catalog);
      }
      if (demosResult.status === 'fulfilled') {
        demo.setCatalog(demosResult.value);
        if (!demo.busy && demo.state.stepsStatus === 'error') void demo.select(demo.state.selectedId);
      } else if (catalogIsInvalid(demosResult.reason)) {
        demo.setCatalog([]);
      }
      const failed = [
        [vehicleResult, 'vehículo'], [commandsResult, 'comandos'], [demosResult, 'DEMO'],
      ].filter(([result]) => result.status === 'rejected').map(([, label]) => label);
      view.setNotice(failed.length
        ? `Falló la consulta de ${failed.join(', ')}. Comprueba la conexión y pulsa Actualizar.`
        : !commands.getCommand('DETENER') ? 'DETENER no está activo en el catálogo. Los movimientos están bloqueados.' : '',
      Boolean(failed.length || !commands.getCommand('DETENER')));
    }).finally(() => {
      refreshing = null;
      loading = false;
      render();
    });
    return refreshing;
  }

  async function refresh() {
    const button = view.element('refresh');
    button.disabled = true;
    try {
      await Promise.all([connection.refresh(), loadCatalog(), !simulation && currentView === 'monitoreo' && monitoring.refresh()]);
    } finally {
      button.disabled = false;
    }
  }

  function selectView(focus = false) {
    const hash = location.hash;
    const next = hash === '#monitoreo' ? 'monitoreo'
      : !hash || hash === '#control' ? 'control' : currentView ?? 'control';
    if (next === currentView) return;

    const inMonitoring = next === 'monitoreo';
    currentView = next;
    document.body.dataset.view = next;
    view.element('control-view').hidden = inMonitoring;
    view.element('monitor-view').hidden = !inMonitoring;
    const refreshLabel = inMonitoring ? 'Actualizar conexión y datos' : 'Actualizar conexión y catálogos';
    view.element('refresh').setAttribute('aria-label', refreshLabel);
    view.element('refresh').title = refreshLabel;
    for (const link of document.querySelectorAll('a[data-view]')) {
      if (link.dataset.view === next) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    for (const id of ['view-navigation', 'vehicle-detail', 'demo-detail']) {
      view.element(id).hidePopover?.();
    }

    if (!simulation && inMonitoring) void monitoring.activate();
    else monitoring?.deactivate();
    render();
    if (focus) view.element(inMonitoring ? 'monitor-title' : 'drive-title').focus({ preventScroll: true });
  }

  view.element('refresh').addEventListener('click', () => void refresh(), listeners);
  const monitorRefresh = view.element('monitor-refresh');
  monitorRefresh.addEventListener('click', async () => {
    if (simulation) return;
    monitorRefresh.disabled = true;
    try {
      await monitoring.refresh();
    } finally {
      monitorRefresh.disabled = false;
    }
  }, listeners);
  const navigation = view.element('view-navigation');
  navigation.addEventListener('click', event => {
    if (event.target.closest('a[data-view]')) navigation.hidePopover?.();
  }, listeners);
  view.element('views-vehicle-detail').addEventListener('click', () => {
    navigation.hidePopover?.();
    view.element('vehicle-detail').showPopover?.();
  }, listeners);
  window.addEventListener('hashchange', () => selectView(true), listeners);
  view.element('stop').addEventListener('click', () => {
    joystick.reset();
    commands.stop();
  }, listeners);
  view.element('demo-select').addEventListener('change', event => void demo.select(event.target.value), listeners);
  view.element('demo-start').addEventListener('click', () => void demo.start(), listeners);
  view.element('demo-cancel').addEventListener('click', () => void demo.cancel(), listeners);

  window.addEventListener('online', () => void refresh(), listeners);
  window.addEventListener('pagehide', () => {
    monitoring?.deactivate();
    joystick.reset({ stop: true });
    socket.stop();
    connection.stop();
  }, listeners);
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    if (!simulation && currentView === 'monitoreo') void monitoring.activate();
    socket.start();
    void connection.start();
    void loadCatalog();
  }, listeners);
  signal?.addEventListener('abort', () => {
    joystick.destroy();
    if (commands.mayBeMoving || demo.busy) commands.stop();
    monitoring.deactivate();
    socket.stop();
    connection.stop();
  }, { once: true });
  view.setSimulation(simulation, ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  if (simulation) monitoringView.showSimulation();
  selectView();
  socket.start();
  void connection.start();
  void loadCatalog();
}

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
const regression = local && (new URLSearchParams(location.search).get('modo') === 'regresion' || window.__iot43Regression);
const boot = isSimulation(location.search) || regression
  ? mount()
  : import('./platform43/portal.js').then(({ portal }) => portal(mount));

void boot.catch(() => view.setNotice('El panel no pudo inicializarse. Recarga la página para volver a intentar.', true));
