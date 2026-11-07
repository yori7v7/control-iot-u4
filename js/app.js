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
import { ConnectionIndicators } from './ui/ConnectionIndicators.js';
import { DashboardView } from './ui/DashboardView.js';

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
  let vehicle = null;
  let catalog = [];
  let catalogLoaded = false;
  let refreshing = null;
  let loading = true;
  let wsConnected = false;
  let apiWasUnavailable = false;

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
      if (state === 'unavailable') apiWasUnavailable = true;
      if (state === 'available' && apiWasUnavailable) {
        apiWasUnavailable = false;
        void loadCatalog();
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
      render();
    },
    onEvent(event) {
      view.setEvent(event);
      commands.handleEvent(event);
      demo.handleEvent(event);
    },
    onInvalid: message => view.setNotice(message, true),
  });

  function render() {
    view.setVehicle(vehicle, vehicleId, loading);
    view.setCatalog(catalog, key => commands.request(key), catalogLoaded);
    view.setControl({
      armed: api.hasApiKey, canCommand, canStop: canStop(),
      canClose: canCloseSession(), busy: protectedRequestPending(),
    });
    view.setCommand(commands.state);
    view.setDemo(demo.state, {
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
      if (commandsResult.status === 'fulfilled') {
        catalog = commandsResult.value;
        catalogLoaded = true;
        commands.setCatalog(catalog);
      } else if (catalogIsInvalid(commandsResult.reason)) {
        catalog = [];
        catalogLoaded = false;
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
      await Promise.all([connection.refresh(), loadCatalog()]);
    } finally {
      button.disabled = false;
    }
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
  view.element('stop').addEventListener('click', () => {
    joystick.reset();
    commands.stop();
  });
  view.element('demo-select').addEventListener('change', event => void demo.select(event.target.value));
  view.element('demo-start').addEventListener('click', () => void demo.start());
  view.element('demo-cancel').addEventListener('click', () => void demo.cancel());

  window.addEventListener('online', () => void refresh());
  window.addEventListener('pagehide', () => {
    joystick.reset({ stop: true });
    api.setApiKey('');
    view.clearForm();
    if (dialog.open) dialog.close();
    socket.stop();
    connection.stop();
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    socket.start();
    void connection.start();
    void loadCatalog();
  });
  view.setSimulation(simulation, ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname));
  render();
  socket.start();
  void connection.start();
  void loadCatalog();
}

void start().catch(() => view.setNotice('El panel no pudo inicializarse. Recarga la página para volver a intentar.', true));
