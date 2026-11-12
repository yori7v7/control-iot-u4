import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { BACKEND_DETAILS, CONFIG, isSimulation } from '../js/config.js';
import { Command } from '../js/models/Command.js';
import { Demo } from '../js/models/Demo.js';
import { Vehicle } from '../js/models/Vehicle.js';
import { ApiClient, ApiError } from '../js/services/ApiClient.js';
import { ConnectionService } from '../js/services/ConnectionService.js';
import { createSimulation } from '../js/services/simulation.js';
import { WebSocketClient } from '../js/services/WebSocketClient.js';

const movement = {
  resultado: 'ok', id_vehiculo: 1, id_comando: 2, comando: 'AVANZAR', codigo: 1,
  fecha_actualizacion: '2026-11-07T18:33:22', conectado: false, origen: 'API',
};

test('REST envía los contratos exactos y limita la clave a los POST protegidos', async () => {
  const responses = [
    Response.json({ status: 'ok', service: 'API de prueba', environment: 'development' }),
    Response.json(movement),
    Response.json({ id_vehiculo: 1, id_demo: 3, estado: 'iniciada' }, { status: 202 }),
    Response.json({ id_vehiculo: 1, id_demo: 3, estado: 'cancelada' }),
  ];
  const calls = [];
  const api = new ApiClient({ fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    return responses.shift();
  } });

  await assert.rejects(api.sendCommand(2), { kind: 'auth' });
  assert.equal(api.setApiKey('clave\r\ninválida'), false);
  assert.equal(api.setApiKey('🛑'), false);
  assert.equal(api.setApiKey('clave-de-prueba'), true);
  assert.equal(api.setApiKey('clave\r\ninválida'), false);
  assert.equal(api.setApiKey('   '), false);
  assert.equal(api.hasApiKey, true);
  await api.health();
  assert.deepEqual(await api.sendCommand(2), movement);
  assert.equal((await api.startDemo(3)).estado, 'iniciada');
  assert.equal((await api.cancelDemo(3)).estado, 'cancelada');
  assert.deepEqual(calls.map(call => [new URL(call.url).pathname, call.method]), [
    ['/', 'GET'], ['/vehiculos/1/movimientos', 'POST'],
    ['/vehiculos/1/demos/3/ejecutar', 'POST'], ['/vehiculos/1/demos/3/cancelar', 'POST'],
  ]);
  assert.equal(calls[0].headers['X-API-Key'], undefined);
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[1].body), { id_comando: 2 });
  for (const call of calls.slice(1)) {
    assert.equal(call.headers['X-API-Key'], 'clave-de-prueba');
    assert.equal(call.redirect, 'error');
    assert.equal(call.credentials, 'omit');
  }
  assert.ok(calls.slice(2).every(call => call.body === undefined));
  assert.ok(calls.slice(2).every(call => call.headers['Content-Type'] === undefined));
  assert.equal(api.setApiKey(''), false);
  assert.equal(api.hasApiKey, false);
  await assert.rejects(api.sendCommand(2), { kind: 'auth' });
  assert.throws(() => new ApiClient({ simulation: true }), /transporte REST/);
});

test('REST distingue timeout, cancelación, HTTP y formato sin reflejar respuestas sensibles', async () => {
  const timeoutApi = new ApiClient({ timeoutMs: 10, fetchImpl: (_url, { signal }) => delay(1000, null, { signal }) });
  await assert.rejects(timeoutApi.getDemos(), { kind: 'timeout' });
  const controller = new AbortController();
  const pending = timeoutApi.getDemoMovements(3, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { kind: 'aborted' });

  const secret = 'valor-solo-para-prueba';
  const deniedApi = new ApiClient({ fetchImpl: async () => Response.json({ detail: secret }, { status: 403 }) });
  deniedApi.setApiKey(secret);
  await assert.rejects(deniedApi.sendCommand(2), error =>
    error instanceof ApiError && error.status === 403 && !error.message.includes(secret));
  const mismatchedApi = new ApiClient({ fetchImpl: async () => Response.json({ ...movement, id_comando: 1 }) });
  mismatchedApi.setApiKey(secret);
  await assert.rejects(mismatchedApi.sendCommand(2), { kind: 'format' });
});

test('REST distingue conflictos de ejecución y valida la secuencia sin reordenarla', async () => {
  const step = { id_demo_movimiento: 1, orden: 2, id_comando: 2, comando: 'AVANZAR', codigo: 1,
    duracion_ms: 250, pausa_ms: 0 };
  const responses = [
    Response.json({ detail: BACKEND_DETAILS.demoConflict }, { status: 409 }),
    Response.json({ detail: 'La demo está inactiva.' }, { status: 409 }),
    Response.json([step, { ...step, id_demo_movimiento: 2, orden: 9 }]),
    Response.json([step, { ...step, id_demo_movimiento: 2, orden: 1 }]),
    Response.json([step, { ...step, orden: 3 }]),
  ];
  const api = new ApiClient({ fetchImpl: async () => responses.shift() });
  api.setApiKey('clave-de-prueba');
  await assert.rejects(api.startDemo(3), { kind: 'demo-conflict', status: 409 });
  await assert.rejects(api.startDemo(3), { kind: 'http', status: 409 });
  assert.deepEqual((await api.getDemoMovements(3)).map(row => row.orden), [2, 9]);
  await assert.rejects(api.getDemoMovements(3), { kind: 'format' });
  await assert.rejects(api.getDemoMovements(3), { kind: 'format' });
});

test('los sondeos de API y RDS distinguen degradación, falta de verificación y recuperación', async () => {
  const simulation = createSimulation({ requestDelayMs: 0 });
  const api = new ApiClient({ simulation: true, ...simulation });
  const states = { api: [], database: [] };
  const connection = new ConnectionService({
    api, onApiState: state => states.api.push(state), onDatabaseState: state => states.database.push(state),
  });

  await connection.refresh();
  simulation.setAvailability({ database: false });
  const pending = connection.refresh();
  assert.equal(connection.refresh(), pending);
  await pending;
  simulation.setAvailability({ api: false });
  await connection.refresh();
  simulation.setAvailability({ api: true, database: true });
  await connection.refresh();
  assert.deepEqual(states.api, [
    'checking', 'available', 'checking', 'available', 'checking', 'unavailable', 'checking', 'available',
  ]);
  assert.deepEqual(states.database, ['available', 'unavailable', 'unverified', 'available']);
  connection.stop();
});

test('RDS admite una respuesta de 7 segundos y sigue teniendo un timeout independiente', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let databaseDelayMs = 7000;
  const states = { api: [], database: [] };
  const api = new ApiClient({ fetchImpl: (url, { signal }) => {
    if (new URL(url).pathname === '/') {
      return Promise.resolve(Response.json({ status: 'ok', service: 'API de prueba', environment: 'development' }));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json({ status: 'ok', database: 'available' })), databaseDelayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });
  } });
  const connection = new ConnectionService({
    api, onApiState: state => states.api.push(state), onDatabaseState: state => states.database.push(state),
  });
  t.after(() => connection.stop());

  const slowProbe = connection.refresh();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(states.api, ['checking', 'available']);
  t.mock.timers.tick(databaseDelayMs - 1);
  assert.deepEqual(states.database, []);
  t.mock.timers.tick(1);
  await slowProbe;
  assert.deepEqual(states.database, ['available']);

  databaseDelayMs = CONFIG.databaseHealthTimeoutMs + 1000;
  const timedOut = connection.refresh();
  t.mock.timers.tick(CONFIG.databaseHealthTimeoutMs);
  await timedOut;
  assert.deepEqual(states.database, ['available', 'unverified']);
});

test('WSS valida vehículo y formato, deduplica, reconecta y cierra sus recursos', async t => {
  const sockets = [];
  class Socket extends EventTarget {
    readyState = 0;

    constructor(url) {
      super();
      assert.equal(url, CONFIG.wsUrl);
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
      this.dispatchEvent(new MessageEvent('message', { data }));
    }
  }
  const states = [];
  const events = [];
  const invalid = [];
  const socket = new WebSocketClient({
    WebSocketImpl: Socket, onState: state => states.push(state), onEvent: event => events.push(event),
    onInvalid: message => invalid.push(message), retryBaseMs: 2, handshakeTimeoutMs: 300,
  });
  t.after(() => socket.stop());
  socket.start();
  sockets[0].open();
  const { fecha_actualizacion, resultado, ...fields } = movement;
  const frame = { ...fields, tipo_evento: 'movimiento', id_evento: 'evento-1', timestamp: fecha_actualizacion };
  sockets[0].message(JSON.stringify(frame));
  sockets[0].message(JSON.stringify(frame));
  sockets[0].message(JSON.stringify({ ...frame, id_vehiculo: 8 }));
  sockets[0].message('{');
  assert.deepEqual(events, [frame]);
  assert.equal(invalid.length, 2);

  sockets[0].close();
  assert.equal(socket.state, 'reconnecting');
  await delay(15);
  sockets[1].open();
  sockets[0].message(JSON.stringify({ ...frame, id_evento: 'evento-viejo' }));
  sockets[1].message(JSON.stringify(frame));
  assert.deepEqual(events, [frame]);
  socket.stop();
  assert.equal(sockets[1].readyState, 3);
  assert.deepEqual(states, ['connecting', 'connected', 'reconnecting', 'connected', 'disconnected']);
});

test('la simulación explícita ejercita catálogo, movimiento, DEMO completa y cancelación', async t => {
  assert.equal(isSimulation(''), false);
  assert.equal(isSimulation('?modo=simulacion'), true);
  const simulation = createSimulation({ requestDelayMs: 0, demoStepScale: 0.002 });
  const api = new ApiClient({ simulation: true, ...simulation });
  const events = [];
  let complete;
  const ended = new Promise(resolve => { complete = resolve; });
  const socket = new WebSocketClient({ ...simulation, onState() {}, onEvent(event) {
    events.push(event);
    if (event.tipo_evento === 'demo_fin') complete();
  } });
  t.after(() => socket.stop());
  socket.start();

  const [vehicleRow, commandRows, demoRows] = await Promise.all([api.getVehicle(), api.getCommands(), api.getDemos()]);
  assert.equal(new Vehicle(vehicleRow).id, 1);
  assert.equal(Command.forVehicle(commandRows, 1).find(command => command.key === 'DETENER').code, 0);
  assert.throws(() => Command.forVehicle([commandRows[0], commandRows[0]], 1), /repetidos/);
  assert.throws(() => Command.forVehicle([{ ...commandRows[0], id_vehiculo: 2 }], 1), /inválido/);
  const [demo] = Demo.forVehicle(demoRows, 1);
  assert.throws(() => Demo.forVehicle([demoRows[0], demoRows[0]], 1), /repetidos/);
  const steps = await api.getDemoMovements(demo.id);
  const response = await api.sendCommand(2);
  assert.equal(events.at(-1).timestamp, response.fecha_actualizacion);
  assert.equal(events.at(-1).tipo_evento, 'movimiento');
  await api.startDemo(demo.id);
  await ended;
  assert.deepEqual(events.filter(event => event.tipo_evento === 'demo_movimiento').map(event => event.orden),
    steps.map(step => step.orden));
  assert.equal(events.find(event => event.tipo_evento === 'demo_inicio').id_demo, demo.id);

  await api.startDemo(demo.id);
  await api.cancelDemo(demo.id);
  assert.equal(events.at(-1).tipo_evento, 'demo_cancelada');
});
