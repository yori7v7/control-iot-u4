import { CONFIG, isSimulation } from './config.js';
import { Command } from './models/Command.js';
import { Demo } from './models/Demo.js';
import { Vehicle } from './models/Vehicle.js';
import { ApiClient, isApiKeyInput } from './services/ApiClient.js';
import { ConnectionService } from './services/ConnectionService.js';
import { isGuestDirection, isLoopbackHost, PublicControlClient } from './services/PublicControlClient.js';
import { PublicControlService } from './services/PublicControlService.js';
import { GuestAdmissionClient, GuestAdmissionService } from './services/GuestAdmissionService.js';
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
  const local = isLoopbackHost(location.hostname);
  const publicSimulation = local && new URLSearchParams(location.search).get('modo') === 'turnos';
  const simulation = publicSimulation || isSimulation(location.search);
  const transport = simulation ? (await import('./services/simulation.js')).createSimulation() : {};
  const api = new ApiClient({ simulation, ...transport });
  // K-H: disabled until an audited public HTTPS backend exists; never grants motion.
  const guestAdmission = !simulation && CONFIG.guestAdmissionEnabled
    ? new GuestAdmissionService({
        client: new GuestAdmissionClient({ apiUrl: CONFIG.apiUrl, vehicleId }),
        onChange: state => view.setGuestAdmission(state),
      }) : null;
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
  let guestWasControlling = false;
  let publicStarted = false;
  let pageActive = true;

  const publicControl = simulation && !publicSimulation ? null : new PublicControlService({
    client: new PublicControlClient({
      baseUrl: publicSimulation ? location.origin : CONFIG.apiUrl, vehicleId, simulation: publicSimulation,
    }),
    onChange: ({ canStop: controlling }) => {
      if (guestWasControlling && !controlling) joystick.reset();
      guestWasControlling = controlling;
      render();
    },
  });
  const hasGuest = () => publicSimulation && publicControl.state.role === 'guest';
  const canControl = () => {
    if (!api.hasApiKey || vehicle?.active !== true) return false;
    if (!publicControl) return true;
    const { adminPermission, adminReady, status, windowOpen, busy } = publicControl.state;
    return publicSimulation ? adminReady && !busy && !windowOpen && status === 'closed'
      : adminPermission === 'authorized' || adminPermission === 'legacy';
  };
  const canStop = () => hasGuest() ? publicControl.state.canStop
    : canControl() && Boolean(commands.getCommand('DETENER'));
  const canCommand = key => catalogVerified && !apiWasUnavailable && Boolean(commands.getCommand(key)) &&
    (hasGuest() ? publicControl.state.canMove && isGuestDirection(key)
      : canStop() && !demo.busy && !commands.stopping);
  const requestDirection = key => {
    if (!canCommand(key)) return false;
    if (!hasGuest()) return commands.request(key);
    return publicControl.move(key);
  };
  const stopControl = () => hasGuest() ? void publicControl.requestStop() : commands.stop();
  const sessionBusy = () => commands.busy || demo.busy;
  const protectedRequestPending = () => commands.busy || demo.requestPending;
  const canCloseSession = () => !sessionBusy() && !commands.mayBeMoving;
  const canOpenWindow = () => canCloseSession() && !demo.state.stopPending;
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
    onDirection: requestDirection,
    onRelease: stopControl,
    onPreview: key => view.setPreview(key),
  });
  const connection = new ConnectionService({
    api,
    onApiState(state) {
      indicators.set('api', state);
      if (!publicSimulation && publicControl && pageActive && state === 'available') startPublicControl();
      if (publicControl && state === 'unavailable') publicControl.setOnline(false);
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
    ...transport,
    onState(state) {
      indicators.set('ws', state);
      const wasConnected = wsConnected;
      wsConnected = state === 'connected';
      demo.setConnected(wsConnected);
      monitoring.setConnected(wsConnected);
      if (wsConnected && !wasConnected && publicStarted) void publicControl.refresh();
      render();
    },
    onEvent(event) {
      view.setEvent(event);
      commands.handleEvent(event);
      demo.handleEvent(event);
      monitoring.handleEvent(event);
    },
    onInvalid: message => view.setNotice(message, true),
  });

  function startPublicControl() {
    if (!publicControl) return;
    publicControl.setOnline(navigator.onLine);
    if (publicStarted) return;
    publicStarted = true;
    publicControl.start();
  }

  function render() {
    const catalogReady = catalogVerified && !apiWasUnavailable;
    const catalogStatus = apiWasUnavailable ? 'Sin conexión'
      : !catalogReady ? (loading ? 'Esperando catálogo' : 'Catálogo sin verificar')
        : !catalog.some(command => command.active && command.key !== 'DETENER') ? 'Sin comandos activos' : '';
    view.setVehicle(vehicle, vehicleId, loading);
    monitoringView.setVehicle(vehicle, loading);
    view.setCatalog(catalog, requestDirection);
    view.setControl({
      armed: publicSimulation ? publicControl.state.adminPermission !== 'unverified' : !simulation && api.hasApiKey,
      canCommand, canStop: canStop(),
      canClose: canCloseSession(), busy: protectedRequestPending() || commands.mayBeMoving,
      catalogReady, catalogStatus,
    });
    const inMonitoring = currentView === 'monitoreo';
    const demoState = demo.state;
    view.element('open-session').hidden = (simulation && !publicSimulation) || inMonitoring || hasGuest();
    view.element('stop').hidden = inMonitoring && !(canStop() && (hasGuest() || commands.mayBeMoving || sessionBusy() || demoState.stopPending));
    view.setPublicControl(publicControl ? {
      ...publicControl.state,
      canEnable: publicControl.state.canEnable && canOpenWindow(),
    } : null);
    if (guestAdmission) view.setGuestAdmission(guestAdmission.state);
    if (hasGuest()) view.setGuestCommand(publicControl.state.guestReceipt, { active: true });
    else {
      view.setGuestCommand(null);
      view.setCommand(commands.state);
    }
    view.setDemo(demoState, {
      loading, busy: demo.busy,
      canOperateDemo: canControl(),
      canSelectDemo: !hasGuest(),
      canStart: demo.busy ? null
        : !canControl() || !canStop() ? 'Habilita el control y verifica que DETENER esté disponible para iniciar.'
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
      await Promise.all([
        connection.refresh(), loadCatalog(), !simulation && currentView === 'monitoreo' && monitoring.refresh(),
        publicStarted && publicControl.refresh(),
      ]);
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
    if (inMonitoring && hasGuest()) joystick.reset({ stop: true });
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
    for (const id of ['view-navigation', 'vehicle-detail', 'demo-detail', 'public-control']) {
      view.element(id).hidePopover?.();
    }

    if (!simulation && inMonitoring) void monitoring.activate();
    else monitoring.deactivate();
    render();
    if (focus) view.element(inMonitoring ? 'monitor-title' : 'drive-title').focus({ preventScroll: true });
  }

  const dialog = view.element('session-dialog');
  view.element('open-session').addEventListener('click', () => {
    if (hasGuest()) return;
    view.clearForm();
    dialog.showModal();
  });
  view.element('close-session').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => view.clearForm());
  view.element('session-form').addEventListener('submit', event => {
    event.preventDefault();
    if (hasGuest() || protectedRequestPending() || commands.mayBeMoving || !view.element('risk-ack').checked) return;
    const input = view.element('api-key');
    const key = input.value;
    const accepted = publicSimulation ? isApiKeyInput(key) && publicControl.setAdminKey(key.trim()) : api.setApiKey(key);
    input.value = '';
    if (accepted && !publicSimulation) publicControl?.setAdminKey(key.trim());
    render();
    if (accepted) {
      guestAdmission?.stop();
      dialog.close();
    }
    else {
      view.setSessionError('Introduce una clave válida para el encabezado de la API.');
      input.focus();
    }
  });
  view.element('clear-session').addEventListener('click', () => {
    if (!canCloseSession()) return;
    api.setApiKey('');
    publicControl?.setAdminKey('');
    if (guestAdmission) void guestAdmission.start();
    dialog.close();
    render();
  });
  view.element('refresh').addEventListener('click', () => void refresh());
  const monitorRefresh = view.element('monitor-refresh');
  monitorRefresh.addEventListener('click', async () => {
    if (simulation) return;
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
    stopControl();
  });
  view.element('demo-select').addEventListener('change', event => void demo.select(event.target.value));
  view.element('demo-start').addEventListener('click', () => void demo.start());
  view.element('demo-cancel').addEventListener('click', () => void demo.cancel());

  if (publicControl) {
    view.element('public-take').addEventListener('click', () => void publicControl.acquire());
    view.element('public-release').addEventListener('click', () => {
      joystick.reset();
      void publicControl.release();
    });
    view.element('public-open-window').addEventListener('click', () => {
      const supervision = view.element('public-supervision');
      if (!canOpenWindow() || !supervision.checked) return;
      void publicControl.enableWindow(true);
      view.resetSupervision();
    });
    view.element('public-close-window').addEventListener('click', () => void publicControl.disableWindow());
    view.element('public-revoke').addEventListener('click', () => void publicControl.revoke());
  }

  window.addEventListener('online', () => {
    if (publicSimulation) startPublicControl();
    void refresh();
  });
  window.addEventListener('offline', () => publicControl?.setOnline(false));
  window.addEventListener('pagehide', () => {
    guestAdmission?.stop();
    pageActive = false;
    monitoring.deactivate();
    joystick.reset({ stop: true });
    api.setApiKey('');
    publicStarted = false;
    publicControl?.stop();
    view.clearForm();
    if (dialog.open) dialog.close();
    socket.stop();
    connection.stop();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    pageActive = true;
    if (!simulation && currentView === 'monitoreo') void monitoring.activate();
    if (publicSimulation) startPublicControl();
    if (guestAdmission && !api.hasApiKey) void guestAdmission.start();
    socket.start();
    void connection.start();
    void loadCatalog();
  });
  view.setSimulation(simulation, local, { publicSimulation });
  if (simulation) monitoringView.showSimulation();
  selectView();
  if (publicSimulation) startPublicControl();
  else publicControl?.setOnline(false);
  if (guestAdmission && !api.hasApiKey) void guestAdmission.start();
  socket.start();
  void connection.start();
  void loadCatalog();
}

void start().catch(() => view.setNotice('El panel no pudo inicializarse. Recarga la página para volver a intentar.', true));
