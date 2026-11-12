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

async function start() {
  const { vehicleId } = CONFIG;
  const simulation = isSimulation(location.search);
  const transport = simulation ? (await import('./services/simulation.js')).createSimulation() : {};
  const api = new ApiClient({ simulation, ...transport });
  const indicators = new ConnectionIndicators(document);
  const monitoringView = new MonitoringView(document, vehicleId);
  const monitoring = simulation ? null : new MonitoringController({
    vehicleId,
    readState: options => api.getVehicleState(options),
    readHistory: options => api.getMovementHistory(options),
    onChange: state => monitoringView.render(state),
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
  const canCommand = key => canStop() && !demo.busy && !commands.stopping && Boolean(commands.getCommand(key));
  const sessionBusy = () => commands.busy || demo.busy;
  const protectedRequestPending = () => commands.busy || demo.requestPending;
  const canCloseSession = () => !sessionBusy() && !commands.mayBeMoving;
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
        if (currentView === 'monitoreo') void monitoring?.refresh();
      }
    },
    onDatabaseState: state => indicators.set('rds', state),
  });
  const socket = new WebSocketClient({
    ...transport,
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
    const catalogReady = catalogVerified && !apiWasUnavailable;
    const catalogStatus = apiWasUnavailable ? 'Sin conexión'
      : !catalogReady ? (loading ? 'Esperando catálogo' : 'Catálogo sin verificar')
        : !catalog.some(command => command.active && command.key !== 'DETENER') ? 'Sin comandos activos' : '';
    view.setVehicle(vehicle, vehicleId, loading);
    monitoringView.setVehicle(vehicle, loading);
    view.setCatalog(catalog, key => commands.request(key));
    view.setControl({
      armed: api.hasApiKey, canCommand, canStop: canStop(),
      canClose: canCloseSession(), busy: protectedRequestPending(),
      catalogReady, catalogStatus,
    });
    const inMonitoring = currentView === 'monitoreo';
    const demoState = demo.state;
    const stopPending = demoState.phase === 'canceled' && demoState.stop?.phase !== 'accepted';
    view.element('open-session').hidden = simulation || inMonitoring;
    view.element('stop').hidden = inMonitoring && !(canStop() && (commands.mayBeMoving || sessionBusy() || stopPending));
    view.setCommand(commands.state);
    view.setDemo(demoState, {
      loading, busy: demo.busy,
      canStart: demo.busy ? null
        : !canStop() ? 'Habilita el control y verifica que DETENER esté disponible para iniciar.'
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
        ? `No se pudo actualizar: ${failed.join(', ')}. Comprueba la conexión y usa Actualizar para volver a consultar.`
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
      await Promise.all([connection.refresh(), loadCatalog(), currentView === 'monitoreo' && monitoring?.refresh()]);
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
    for (const id of ['view-navigation', 'vehicle-detail', 'activity-pane', 'demo-detail']) {
      view.element(id).hidePopover?.();
    }

    if (inMonitoring) void monitoring?.activate();
    else monitoring?.deactivate();
    render();
    if (focus) view.element(inMonitoring ? 'monitor-title' : 'drive-title').focus({ preventScroll: true });
  }

  const dialog = view.element('session-dialog');
  view.element('open-session').addEventListener('click', () => {
    view.clearForm();
    dialog.showModal();
  });
  view.element('close-session').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => view.clearForm());
  view.element('session-form').addEventListener('submit', event => {
    event.preventDefault();
    if (protectedRequestPending() || !view.element('risk-ack').checked) return;
    const input = view.element('api-key');
    const accepted = api.setApiKey(input.value);
    input.value = '';
    render();
    if (accepted) dialog.close();
    else {
      view.setSessionError('Introduce una clave válida para el encabezado de la API.');
      input.focus();
    }
  });
  view.element('clear-session').addEventListener('click', () => {
    if (!canCloseSession()) return;
    api.setApiKey('');
    dialog.close();
    render();
  });
  view.element('refresh').addEventListener('click', () => void refresh());
  const monitorRefresh = view.element('monitor-refresh');
  monitorRefresh.addEventListener('click', async () => {
    if (!monitoring) return;
    monitorRefresh.disabled = true;
    try {
      await monitoring.refresh();
    } finally {
      monitorRefresh.disabled = false;
    }
  });
  const navigation = view.element('view-navigation');
  navigation.addEventListener('click', event => {
    if (event.target.closest('a[data-view]')) navigation.hidePopover?.();
  });
  view.element('views-vehicle-detail').addEventListener('click', () => {
    navigation.hidePopover?.();
    view.element('vehicle-detail').showPopover?.();
  });
  window.addEventListener('hashchange', () => selectView(true));
  view.element('stop').addEventListener('click', () => {
    joystick.reset();
    commands.stop();
  });
  view.element('demo-select').addEventListener('change', event => void demo.select(event.target.value));
  view.element('demo-start').addEventListener('click', () => void demo.start());
  view.element('demo-cancel').addEventListener('click', () => void demo.cancel());

  window.addEventListener('online', () => void refresh());
  window.addEventListener('pagehide', () => {
    monitoring?.deactivate();
    joystick.reset({ stop: true });
    api.setApiKey('');
    view.clearForm();
    if (dialog.open) dialog.close();
    socket.stop();
    connection.stop();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    if (currentView === 'monitoreo') void monitoring?.activate();
    socket.start();
    void connection.start();
    void loadCatalog();
  });
  view.setSimulation(simulation, ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  if (simulation) monitoringView.showSimulation();
  selectView();
  socket.start();
  void connection.start();
  void loadCatalog();
}

void start().catch(() => view.setNotice('El panel no pudo inicializarse. Recarga la página para volver a intentar.', true));
