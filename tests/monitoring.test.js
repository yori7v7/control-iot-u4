import assert from 'node:assert/strict';
import test from 'node:test';
import { MonitoringController } from '../assets/js/controllers/MonitoringController.js';
import { MovementHistoryEntry } from '../assets/js/models/MovementHistoryEntry.js';
import { VehicleState } from '../assets/js/models/VehicleState.js';
import { ApiClient } from '../assets/js/services/ApiClient.js';
import { WebSocketClient } from '../assets/js/services/WebSocketClient.js';

const time = '2026-11-11T18:01:47';
const stateRow = {
  id_vehiculo: 1, vehiculo: 'Montacargas', id_comando: 1, comando: 'DETENER', codigo: 0,
  conectado: true, fecha_actualizacion: time,
};
const historyRow = {
  id_historial: 629, id_vehiculo: 1, comando: 'DETENER', codigo: 0, fecha_hora: time, origen: 'API',
};
const movement = {
  tipo_evento: 'movimiento', id_evento: 'publicacion-1', id_vehiculo: 1, id_comando: 2,
  comando: 'AVANZAR_DERECHA', codigo: 9, conectado: true, timestamp: time, origen: 'API',
};
const demoStep = {
  tipo_evento: 'demo_movimiento', id_evento: 'publicacion-2', id_vehiculo: 1, id_demo: 2, nombre_demo: 'Pista',
  id_demo_movimiento: 7, id_comando: 3, comando: 'RETROCEDER_IZQUIERDA', codigo: 6, orden: 1,
  duracion_ms: 500, pausa_ms: 50, conectado: true, timestamp: time,
};
const nextTurn = () => new Promise(resolve => setImmediate(resolve));

function mockedApi(...responses) {
  const calls = [];
  const api = new ApiClient({ fetchImpl: async (url, options) => {
    calls.push({ path: new URL(url).pathname, ...options });
    return responses.shift();
  } });
  return { api, calls };
}

function monitorFixture(t, readers = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = { persisted: [], history: [] };
  const changes = [];
  const monitor = new MonitoringController({
    readState: ({ signal }) => {
      calls.persisted.push(signal);
      return readers.persisted ? readers.persisted() : stateRow;
    },
    readHistory: ({ signal }) => {
      calls.history.push(signal);
      return readers.history ? readers.history() : [historyRow];
    },
    onChange: state => changes.push(state),
    reconcileDelayMs: 25,
  });
  t.after(() => monitor.deactivate());
  return { monitor, calls, changes };
}

async function reconcile(t) {
  t.mock.timers.tick(25);
  await nextTurn();
}

test('MONITOREO lee estado real, null e historial vacío sin enviar credenciales', async () => {
  const { api, calls } = mockedApi(Response.json(stateRow), Response.json(null), Response.json([]));
  assert.equal(api.setApiKey('valor-ficticio-de-prueba'), true);
  const state = await api.getVehicleState();
  assert.ok(state instanceof VehicleState);
  assert.deepEqual({ ...state }, stateRow);
  assert.equal(await api.getVehicleState(), null);
  assert.deepEqual(await api.getMovementHistory(), []);
  assert.deepEqual(calls.map(call => call.path), [
    '/vehiculos/1/estado', '/vehiculos/1/estado', '/vehiculos/1/historial',
  ]);
  for (const call of calls) {
    assert.equal(call.method, 'GET');
    assert.equal(call.headers['X-API-Key'], undefined);
    assert.equal(call.credentials, 'omit');
    assert.equal(call.body, undefined);
  }
});

test('historial limita a diez registros distintos en el orden de REST y conserva fechas y origen', async () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    ...historyRow, id_historial: 100 - index,
  }));
  rows[0] = { ...rows[0], fecha_hora: null, comando: null, codigo: null, origen: 'IMPORTACIÓN' };
  rows.splice(2, 0, { ...rows[0], origen: 'Otro origen' });
  const { api } = mockedApi(Response.json(rows));
  const history = await api.getMovementHistory();
  assert.deepEqual(history.map(row => row.id_historial),
    ['100', '99', '98', '97', '96', '95', '94', '93', '92', '91']);
  assert.ok(history.every(row => row instanceof MovementHistoryEntry));
  assert.equal(history[0].fecha_hora, null);
  assert.equal(history[0].comando, null);
  assert.equal(history[0].codigo, null);
  assert.equal(history[0].origen, 'IMPORTACIÓN');
  assert.equal(history[1].fecha_hora, time);
});

test('historial conserva IDs int64 adyacentes fuera de la precisión de Number', async () => {
  const json = JSON.stringify([historyRow, historyRow])
    .replace('"id_historial":629', '"id_historial":9223372036854775807')
    .replace('"id_historial":629', '"id_historial":9223372036854775806');
  const { api } = mockedApi(new Response(json));
  const history = await api.getMovementHistory();
  assert.deepEqual(history.map(row => row.id_historial), ['9223372036854775807', '9223372036854775806']);
});

test('las lecturas rechazan vehículos ajenos, fechas inválidas e IDs fuera de contrato', async () => {
  const { api } = mockedApi(
    Response.json({ ...stateRow, id_vehiculo: 2 }),
    Response.json([{ ...historyRow, id_vehiculo: 2 }]),
    Response.json([{ ...historyRow, fecha_hora: 'dato inválido' }]),
    Response.json([{ ...historyRow, id_historial: '629' }]),
    new Response(JSON.stringify([historyRow]).replace('"id_historial":629', '"id_historial":9223372036854775808')),
  );
  await assert.rejects(api.getVehicleState(), { kind: 'format', status: 200 });
  for (let index = 0; index < 4; index++) {
    await assert.rejects(api.getMovementHistory(), { kind: 'format', status: 200 });
  }
  assert.throws(() => new MovementHistoryEntry({ ...historyRow, id_historial: 2 ** 53 }, 1), TypeError);
});

test('un movimiento recibido se presenta de inmediato y sólo REST cambia las filas', async t => {
  let latestHistory = [historyRow];
  const { monitor, calls, changes } = monitorFixture(t, { history: () => latestHistory });
  await monitor.activate();
  const confirmed = monitor.state.history.value;
  latestHistory = [{ ...historyRow, id_historial: 630, comando: movement.comando }, historyRow];

  monitor.handleEvent(movement);
  assert.equal(changes.at(-1).preview, movement);
  assert.equal(monitor.state.history.value, confirmed);
  assert.equal(monitor.state.history.status, 'loading');
  await reconcile(t);
  assert.equal(monitor.state.history.value, latestHistory);
  assert.equal(monitor.state.preview, null);
  assert.equal(monitor.state.event, movement);
  assert.equal(calls.history.length, 2);
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(calls.history.length, 2);
});

test('el paso y la cancelación de DEMO reconcilian estado sin consultar ni agregar historial', async t => {
  const { monitor, calls } = monitorFixture(t);
  await monitor.activate();
  const original = monitor.state.history.value;
  monitor.handleEvent(demoStep);
  assert.equal(monitor.state.preview, demoStep);
  assert.equal(monitor.state.history.status, 'ready');
  await reconcile(t);
  monitor.handleEvent({ ...demoStep, tipo_evento: 'demo_cancelada' });
  assert.equal(monitor.state.event, demoStep);
  await reconcile(t);
  assert.equal(calls.persisted.length, 3);
  assert.equal(calls.history.length, 1);
  assert.equal(monitor.state.history.value, original);
});

test('WSS compartido filtra duplicados y otros vehículos y reconcilia al reconectar', async t => {
  const { monitor, calls, changes } = monitorFixture(t);
  const sockets = [];
  class Socket extends EventTarget {
    readyState = 0;
    constructor() {
      super();
      sockets.push(this);
    }
    open() {
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    }
    close() {
      this.readyState = 3;
      this.dispatchEvent(new Event('close'));
    }
    message(data) {
      this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }
  const client = new WebSocketClient({
    WebSocketImpl: Socket, retryBaseMs: 5,
    onState: state => monitor.setConnected(state === 'connected'),
    onEvent: event => monitor.handleEvent(event),
  });
  t.after(() => client.stop());
  client.start();
  sockets[0].open();
  await monitor.activate();
  assert.equal(monitor.state.connected, true);

  sockets[0].message(movement);
  const afterMovement = changes.length;
  sockets[0].message(movement);
  sockets[0].message({ ...movement, id_evento: 'ajeno', id_vehiculo: 8 });
  assert.equal(changes.length, afterMovement);
  await reconcile(t);
  assert.equal(calls.history.length, 2);

  sockets[0].close();
  assert.equal(monitor.state.connected, false);
  t.mock.timers.tick(5);
  sockets[1].open();
  await reconcile(t);
  assert.equal(monitor.state.connected, true);
  assert.equal(calls.persisted.length, 3);
  assert.equal(calls.history.length, 3);
});

test('las ráfagas se agrupan y un GET anterior al evento no reemplaza la vista previa', async t => {
  const pending = Promise.withResolvers();
  const newer = { ...stateRow, comando: 'RETROCEDER', id_comando: 3, codigo: 2 };
  let readCount = 0;
  const { monitor, calls } = monitorFixture(t, {
    persisted: () => ++readCount === 1 ? pending.promise : newer,
  });
  const initial = monitor.activate();
  await nextTurn();
  monitor.handleEvent(movement);
  monitor.handleEvent({ ...movement, id_evento: 'publicacion-3' });
  monitor.handleEvent(demoStep);
  await reconcile(t);
  assert.equal(calls.persisted.length, 1);
  assert.equal(monitor.state.preview, demoStep);

  pending.resolve(stateRow);
  await initial;
  assert.equal(monitor.state.persisted.value, undefined);
  assert.equal(monitor.state.preview, demoStep);
  await reconcile(t);
  assert.equal(calls.persisted.length, 2);
  assert.equal(calls.history.length, 2);
  assert.equal(monitor.state.persisted.value, newer);
  assert.equal(monitor.state.preview, null);
});

test('una respuesta tardía de una vista abandonada queda descartada aunque no respete abort', async t => {
  const late = Promise.withResolvers();
  const newer = { ...stateRow, comando: 'AVANZAR', id_comando: 2, codigo: 1 };
  let callsCount = 0;
  const { monitor, calls } = monitorFixture(t, {
    persisted: () => ++callsCount === 1 ? late.promise : newer,
  });
  const first = monitor.activate();
  await nextTurn();
  monitor.deactivate();
  assert.equal(calls.persisted[0].aborted, true);
  await monitor.activate();
  assert.equal(monitor.state.persisted.value, newer);

  late.resolve(stateRow);
  await first;
  assert.equal(monitor.state.persisted.value, newer);
  assert.equal(monitor.state.persisted.status, 'ready');
});

test('un fallo transitorio conserva los datos confirmados y una nueva lectura los actualiza', async t => {
  let unavailable = false;
  const { monitor } = monitorFixture(t, {
    history: () => {
      if (unavailable) throw new Error('Fallo simulado');
      return [historyRow];
    },
  });
  await monitor.activate();
  const confirmed = monitor.state.history.value;
  unavailable = true;
  await monitor.refresh();
  assert.equal(monitor.state.history.value, confirmed);
  assert.equal(monitor.state.history.status, 'error');
  assert.equal(monitor.state.persisted.status, 'ready');

  unavailable = false;
  await monitor.refresh();
  assert.equal(monitor.state.history.status, 'ready');
  assert.notEqual(monitor.state.history.value, confirmed);
});
