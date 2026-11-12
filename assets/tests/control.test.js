import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandService } from '../js/controllers/CommandService.js';
import { DemoController } from '../js/controllers/DemoController.js';
import { JoystickController } from '../js/controllers/JoystickController.js';

const CATALOG = [
  { id: 1, name: 'DETENER', key: 'DETENER', code: 0, active: true },
  { id: 2, name: 'AVANZAR', key: 'AVANZAR', code: 1, active: true },
  { id: 4, name: 'IZQUIERDA', key: 'IZQUIERDA', code: 4, active: true },
  { id: 6, name: 'DERECHA', key: 'DERECHA', code: 8, active: true },
  { id: 7, name: 'AVANZAR_DERECHA', key: 'AVANZAR_DERECHA', code: 9, active: false },
];
const DEMOS = [{ id: 1, name: 'Prueba A', active: true }, { id: 2, name: 'Prueba B', active: true }];
const TIMESTAMP = '2026-11-07T19:01:01';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

function movement(id) {
  const command = CATALOG.find(entry => entry.id === id);
  return {
    resultado: 'ok', id_vehiculo: 1, id_comando: id, comando: command.name, codigo: command.code,
    fecha_actualizacion: TIMESTAMP, conectado: false, origen: 'API',
  };
}

function movementEvent(id, eventId, overrides = {}) {
  const { resultado, fecha_actualizacion, ...shared } = movement(id);
  return { ...shared, timestamp: fecha_actualizacion, tipo_evento: 'movimiento', id_evento: eventId, ...overrides };
}

test('DETENER descarta direcciones pendientes y la respuesta anterior no reemplaza el estado vigente', async () => {
  const forward = deferred();
  const stop = deferred();
  const sent = [];
  const service = new CommandService({ vehicleId: 1, api: {
    sendCommand(id) { sent.push(id); return id === 1 ? stop.promise : forward.promise; },
  } });
  service.setCatalog(CATALOG);

  assert.equal(service.request('AVANZAR'), true);
  assert.equal(service.request('AVANZAR'), true);
  assert.equal(service.request('IZQUIERDA'), true);
  assert.equal(service.request('DERECHA'), true);
  assert.equal(service.stop(), true);
  assert.equal(service.stop(), true);
  assert.equal(service.request('IZQUIERDA'), false);
  assert.deepEqual(sent, [2]);
  assert.equal(service.state.command.key, 'DETENER');
  assert.equal(service.state.phase, 'queued');

  forward.reject(new Error('Falla anterior'));
  await nextTurn();
  assert.deepEqual(sent, [2, 1]);
  assert.equal(service.state.phase, 'sending');
  assert.equal(service.mayBeMoving, true);
  stop.resolve(movement(1));
  await nextTurn();
  assert.equal(service.state.phase, 'accepted');
  assert.equal(service.state.message, null);
  assert.equal(service.mayBeMoving, false);
  assert.equal(service.busy, false);
});

test('coalesce direcciones y exige un DETENER activo antes de mover', async () => {
  const first = deferred();
  const sent = [];
  const service = new CommandService({ vehicleId: 1, api: {
    sendCommand(id) { sent.push(id); return id === 2 ? first.promise : Promise.resolve(movement(id)); },
  } });
  service.setCatalog(CATALOG.slice(1));
  assert.equal(service.request('AVANZAR'), false);
  service.setCatalog([{ ...CATALOG[0], code: 16 }, ...CATALOG.slice(1)]);
  assert.equal(service.request('AVANZAR'), false);
  service.setCatalog(CATALOG);
  assert.equal(service.request('AVANZAR_DERECHA'), false);
  service.request('AVANZAR');
  service.request('IZQUIERDA');
  service.request('DERECHA');
  first.resolve(movement(2));
  await nextTurn();
  assert.deepEqual(sent, [2, 6]);
});

test('observa candidatos WSS por los campos compartidos y descarta una coincidencia ambigua', async () => {
  const response = deferred();
  const service = new CommandService({ vehicleId: 1, api: { sendCommand: () => response.promise } });
  service.setCatalog(CATALOG);
  service.handleEvent(movementEvent(2, 'anterior'));
  service.request('AVANZAR');
  service.handleEvent(movementEvent(2, 'otro-vehiculo', { id_vehiculo: 2 }));
  service.handleEvent(movementEvent(2, 'sin-fecha', { timestamp: null }));
  service.handleEvent(movementEvent(2, 'candidato'));
  service.handleEvent(movementEvent(2, 'candidato'));
  response.resolve(movement(2));
  await nextTurn();
  assert.equal(service.state.phase, 'accepted');
  assert.equal(service.state.correlation.id_evento, 'candidato');
  service.handleEvent(movementEvent(2, 'otro-comando', { conectado: true }));
  assert.equal(service.state.correlation.id_evento, 'candidato');
  service.handleEvent(movementEvent(2, 'otra-publicacion'));
  assert.equal(service.state.correlation, null);
  assert.equal(service.state.ambiguous, true);
});

test('un primer comando rechazado por autenticación permite reemplazar la clave', async () => {
  const service = new CommandService({ vehicleId: 1, api: {
    async sendCommand() { throw Object.assign(new Error('Clave inválida.'), { status: 403 }); },
  } });
  service.setCatalog(CATALOG);
  service.request('AVANZAR');
  await nextTurn();
  assert.equal(service.state.phase, 'error');
  assert.equal(service.mayBeMoving, false);
});

test('DETENER comienza sin esperas si no hay DEMO y bloquea el catálogo si el código remoto cambió', async () => {
  const sent = [];
  const service = new CommandService({ vehicleId: 1, api: {
    async sendCommand(id) { sent.push(id); return { ...movement(id), codigo: 1 }; },
  } });
  service.setCatalog(CATALOG);
  service.stop();
  assert.deepEqual(sent, [1]);
  await nextTurn();
  assert.equal(service.state.phase, 'error');
  assert.equal(service.getCommand('DETENER'), null);
  assert.equal(service.request('AVANZAR'), false);
  assert.equal(service.mayBeMoving, true);
});

test('al cambiar la DEMO seleccionada una lectura anterior no reemplaza la secuencia actual', async () => {
  const first = deferred();
  const second = deferred();
  const demo = new DemoController({ vehicleId: 1, api: {
    getDemoMovements(id) { return id === 1 ? first.promise : second.promise; },
  } });
  demo.setCatalog(DEMOS);
  const readFirst = demo.select('1');
  const readSecond = demo.select('2');
  assert.equal(demo.state.stepsStatus, 'loading');
  second.resolve([{ id_demo_movimiento: 25, orden: 4 }]);
  await readSecond;
  first.resolve([{ id_demo_movimiento: 19, orden: 2 }]);
  await readFirst;
  assert.equal(demo.state.selectedId, 2);
  assert.equal(demo.state.steps[0].id_demo_movimiento, 25);
  assert.equal(demo.state.canStart, true);
});

test('los pasos y el resultado de DEMO proceden de WSS, incluso si llegan antes del HTTP 202', async () => {
  const response = deferred();
  const demo = new DemoController({ vehicleId: 1, api: {
    getDemoMovements: async () => [{ id_demo_movimiento: 9, orden: 3 }],
    startDemo: () => response.promise,
  } });
  demo.setCatalog(DEMOS);
  await demo.select(1);
  demo.setConnected(true);
  const start = demo.start();
  assert.equal(await demo.start(), false);
  assert.equal(demo.state.phase, 'starting');

  demo.handleEvent({ tipo_evento: 'demo_inicio', id_vehiculo: 1, id_demo: 1 });
  const step = { tipo_evento: 'demo_movimiento', id_vehiculo: 1, id_demo: 1, id_demo_movimiento: 9, orden: 3 };
  demo.handleEvent(step);
  demo.handleEvent(step);
  assert.equal(demo.state.phase, 'running');
  const runToken = demo.state.runToken;
  assert.equal(demo.state.progress.orden, 3);
  assert.equal(demo.state.observedSteps, 1);
  demo.handleEvent({ tipo_evento: 'demo_fin', id_vehiculo: 1, id_demo: 1 });
  assert.equal(demo.state.phase, 'completed');
  assert.equal(demo.state.runToken, runToken);
  response.resolve({ id_vehiculo: 1, id_demo: 1, estado: 'iniciada' });
  await start;
  assert.equal(demo.state.http.status, 202);
  assert.equal(demo.state.phase, 'completed');
  assert.equal(demo.busy, false);
});

test('DETENER espera el inicio pendiente, cancela la DEMO y después envía el comando individual', async () => {
  const start = deferred();
  const cancel = deferred();
  const calls = [];
  const api = {
    getDemoMovements: async () => [{ orden: 1 }],
    startDemo(id) { calls.push(['start', id]); return start.promise; },
    cancelDemo(id) { calls.push(['cancel', id]); return cancel.promise; },
    async sendCommand(id) { calls.push(['movement', id]); return movement(id); },
  };
  const demo = new DemoController({ vehicleId: 1, api });
  const service = new CommandService({ vehicleId: 1, api,
    isDemoBusy: () => demo.busy, beforeStop: () => demo.cancelForStop(),
    observeStop: () => demo.observeStop(),
  });
  service.setCatalog(CATALOG);
  demo.setCatalog(DEMOS);
  await demo.select(1);
  void demo.start();
  assert.equal(service.request('AVANZAR'), false);
  assert.equal(service.stop(), true);
  await nextTurn();
  assert.deepEqual(calls, [['start', 1]]);
  start.resolve({ id_vehiculo: 1, id_demo: 1, estado: 'iniciada' });
  await nextTurn();
  assert.deepEqual(calls, [['start', 1], ['cancel', 1]]);
  assert.equal(demo.state.phase, 'canceling');
  demo.handleEvent({ tipo_evento: 'demo_cancelada', id_vehiculo: 1, id_demo: 1 });
  cancel.resolve({ id_vehiculo: 1, id_demo: 1, estado: 'cancelada' });
  await nextTurn();
  assert.deepEqual(calls, [['start', 1], ['cancel', 1], ['movement', 1]]);
  assert.equal(service.state.phase, 'accepted');
  assert.equal(demo.state.phase, 'canceled');
  assert.equal(demo.state.stop.phase, 'accepted');
});

test('la respuesta de un DETENER anterior a la cancelación no quita el aviso', async () => {
  const response = deferred();
  const demo = new DemoController({ vehicleId: 1, api: {} });
  const service = new CommandService({ vehicleId: 1, api: { sendCommand: () => response.promise },
    observeStop: () => demo.observeStop(),
  });
  service.setCatalog(CATALOG);
  service.stop();
  assert.equal(service.state.phase, 'sending');
  demo.handleEvent({ tipo_evento: 'demo_cancelada', id_vehiculo: 1, id_demo: 1 });
  service.handleEvent(movementEvent(1, 'detener-anterior'));
  response.resolve(movement(1));
  await nextTurn();
  assert.equal(service.state.phase, 'accepted');
  assert.equal(demo.state.phase, 'canceled');
  assert.equal(demo.state.stop, null);
});

test('la cancelación conserva su progreso y evidencia aunque las tramas lleguen después del HTTP', async () => {
  const api = {
    cancelDemo: async () => {},
    sendCommand: async id => movement(id),
  };
  const demo = new DemoController({ vehicleId: 1, api });
  const service = new CommandService({ vehicleId: 1, api, observeStop: () => demo.observeStop() });
  service.setCatalog(CATALOG);
  demo.setConnected(true);
  const event = { id_vehiculo: 1, id_demo: 1 };
  demo.handleEvent({ ...event, tipo_evento: 'demo_inicio' });
  demo.handleEvent({ ...event, tipo_evento: 'demo_movimiento', id_demo_movimiento: 8, orden: 1 });
  await demo.cancel();
  service.stop();
  await nextTurn();
  assert.deepEqual(demo.state.stop, { phase: 'accepted', compatible: false, ambiguous: false });
  demo.handleEvent({ ...event, tipo_evento: 'demo_movimiento', id_demo_movimiento: 9, orden: 2 });
  demo.handleEvent({ ...event, tipo_evento: 'demo_cancelada' });
  assert.equal(demo.state.phase, 'canceled');
  assert.equal(demo.state.progress.orden, 2);
  assert.equal(demo.state.observedSteps, 2);
  assert.equal(demo.state.stop.phase, 'accepted');

  service.request('AVANZAR');
  await nextTurn();
  service.handleEvent(movementEvent(1, 'detener-tardio'));
  assert.equal(demo.state.stop.compatible, true);
  service.handleEvent(movementEvent(1, 'detener-ambiguo'));
  assert.equal(demo.state.stop.compatible, false);
  assert.equal(demo.state.stop.ambiguous, true);
  demo.handleEvent({ ...event, tipo_evento: 'demo_inicio' });
  assert.equal(demo.state.stop, null);
  assert.equal(demo.state.http, null);
});

test('un nuevo inicio de DEMO descarta la evidencia y aísla un DETENER pendiente', async () => {
  const response = deferred();
  const demo = new DemoController({ vehicleId: 1, api: {} });
  const service = new CommandService({ vehicleId: 1, api: { sendCommand: () => response.promise },
    observeStop: () => demo.observeStop(),
  });
  service.setCatalog(CATALOG);
  const event = { id_vehiculo: 1, id_demo: 1 };
  demo.handleEvent({ ...event, tipo_evento: 'demo_cancelada' });
  service.stop();
  demo.handleEvent({ ...event, tipo_evento: 'demo_inicio' });
  assert.equal(demo.state.phase, 'running');
  assert.equal(demo.state.stop, null);
  demo.handleEvent({ ...event, tipo_evento: 'demo_cancelada' });
  response.resolve(movement(1));
  await nextTurn();
  assert.equal(demo.state.phase, 'canceled');
  assert.equal(demo.state.stop, null);
});

test('una DEMO observada sigue siendo cancelable tras perder WSS y DETENER se intenta ante fallo de cancelación', async () => {
  const sent = [];
  const api = {
    async cancelDemo() { throw new Error('Se agotó el tiempo.'); },
    async sendCommand(id) { sent.push(id); return movement(id); },
  };
  const demo = new DemoController({ vehicleId: 1, api });
  const service = new CommandService({ vehicleId: 1, api,
    isDemoBusy: () => demo.busy, beforeStop: () => demo.cancelForStop(),
  });
  service.setCatalog(CATALOG);
  demo.setConnected(true);
  demo.handleEvent({ tipo_evento: 'demo_inicio', id_vehiculo: 1, id_demo: 2 });
  demo.setConnected(false);
  assert.equal(demo.state.phase, 'uncertain');
  assert.equal(demo.state.canCancel, true);
  assert.equal(service.stop(), true);
  await nextTurn();
  assert.deepEqual(sent, [1]);
  assert.match(service.state.message, /cancelación/);
  assert.equal(demo.busy, true);
});

test('una DEMO externa sin identificar bloquea movimientos hasta observar su estado, con DETENER disponible', async () => {
  const sent = [];
  const api = {
    getDemoMovements: async () => [{ orden: 1 }],
    async startDemo() { throw Object.assign(new Error('Vehículo ocupado.'), { status: 409, kind: 'demo-conflict' }); },
    async sendCommand(id) { sent.push(id); return movement(id); },
  };
  const demo = new DemoController({ vehicleId: 1, api });
  const service = new CommandService({ vehicleId: 1, api,
    isDemoBusy: () => demo.busy, beforeStop: () => demo.cancelForStop(),
  });
  service.setCatalog(CATALOG);
  demo.setCatalog(DEMOS);
  await demo.select(1);
  await demo.start();
  assert.equal(demo.state.phase, 'uncertain');
  assert.equal(demo.state.activeId, null);
  assert.equal(demo.state.canCancel, false);
  assert.equal(service.request('AVANZAR'), false);
  service.stop();
  await nextTurn();
  assert.deepEqual(sent, [1]);
  assert.match(service.state.message, /identificador/);
  demo.handleEvent({ tipo_evento: 'demo_fin', id_vehiculo: 1, id_demo: 2 });
  assert.equal(demo.busy, false);
});

test('DETENER puede reintentarse si la DEMO se canceló y el POST individual falló', async () => {
  const calls = [];
  const api = {
    async cancelDemo(id) { calls.push(['cancel', id]); },
    async sendCommand(id) {
      calls.push(['movement', id]);
      if (calls.length === 2) throw new Error('Timeout');
      return movement(id);
    },
  };
  const demo = new DemoController({ vehicleId: 1, api });
  const service = new CommandService({ vehicleId: 1, api,
    isDemoBusy: () => demo.busy, beforeStop: () => demo.cancelForStop(),
    observeStop: () => demo.observeStop(),
  });
  service.setCatalog(CATALOG);
  demo.handleEvent({ tipo_evento: 'demo_inicio', id_vehiculo: 1, id_demo: 2 });
  service.stop();
  await nextTurn();
  assert.equal(service.mayBeMoving, true);
  assert.equal(demo.busy, false);
  assert.equal(demo.state.stop.phase, 'error');
  service.stop();
  await nextTurn();
  assert.deepEqual(calls, [['cancel', 2], ['movement', 1], ['movement', 1]]);
  assert.equal(service.mayBeMoving, false);
  assert.equal(demo.state.stop.phase, 'accepted');
});

function joystickFixture(canCommand = name => name !== 'RETROCEDER_IZQUIERDA') {
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { defaultView: window, hidden: false });
  const element = Object.assign(new EventTarget(), {
    ownerDocument: document, focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    setPointerCapture() {}, hasPointerCapture: () => false,
  });
  const knob = { style: {}, getBoundingClientRect: () => ({ width: 40, height: 40 }) };
  const commands = [];
  const controller = new JoystickController({ element, knob,
    canCommand,
    onDirection: name => commands.push(name), onRelease: () => commands.push('DETENER'),
  });
  return { controller, element, knob, window, document, commands };
}

function dispatch(target, type, props = {}) {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, props);
  target.dispatchEvent(event);
  return event;
}

test('joystick deduplica, usa diagonales válidas y detiene en pointercancel o pérdida de captura', () => {
  const { controller, element, knob, window, commands } = joystickFixture();
  const pointer = { pointerId: 1, pointerType: 'touch', button: 0, buttons: 1 };
  dispatch(element, 'pointerdown', { ...pointer, clientX: 100, clientY: 35 });
  dispatch(window, 'pointermove', { ...pointer, clientX: 105, clientY: 30 });
  dispatch(window, 'pointermove', { ...pointer, clientX: 150, clientY: 50 });
  dispatch(window, 'pointercancel', pointer);
  assert.deepEqual(commands, ['AVANZAR', 'AVANZAR_DERECHA', 'DETENER']);
  assert.equal(knob.style.translate, '0px 0px');
  dispatch(element, 'pointerdown', { ...pointer, clientX: 45, clientY: 100 });
  dispatch(element, 'lostpointercapture', pointer);
  assert.deepEqual(commands.slice(-2), ['IZQUIERDA', 'DETENER']);
  controller.destroy();
});

test('joystick admite teclado y detiene al soltar, sin repetir el DETENER de la zona neutral', () => {
  const { controller, element, window, commands } = joystickFixture();
  assert.equal(dispatch(element, 'keydown', { key: 'ArrowRight' }).defaultPrevented, true);
  dispatch(element, 'keydown', { key: 'ArrowRight', repeat: true });
  dispatch(element, 'keyup', { key: 'ArrowRight' });
  const pointer = { pointerId: 2, pointerType: 'mouse', button: 0, buttons: 1 };
  dispatch(element, 'pointerdown', { ...pointer, clientX: 100, clientY: 40 });
  dispatch(window, 'pointermove', { ...pointer, clientX: 101, clientY: 100 });
  dispatch(window, 'pointerup', pointer);
  assert.deepEqual(commands, ['DERECHA', 'DETENER', 'AVANZAR', 'DETENER']);
  controller.destroy();
});

test('un arrastre recorre los ocho sectores, deduplica movimientos y vuelve a neutral', () => {
  const { controller, element, knob, window, commands } = joystickFixture(() => true);
  const pointer = { pointerId: 1, pointerType: 'touch', button: 0, buttons: 1 };
  const sectors = [
    [100, 40, 'AVANZAR'], [160, 40, 'AVANZAR_DERECHA'], [160, 100, 'DERECHA'],
    [160, 160, 'RETROCEDER_DERECHA'], [100, 160, 'RETROCEDER'],
    [40, 160, 'RETROCEDER_IZQUIERDA'], [40, 100, 'IZQUIERDA'], [40, 40, 'AVANZAR_IZQUIERDA'],
  ];

  dispatch(element, 'pointerdown', { ...pointer, clientX: 100, clientY: 100 });
  assert.deepEqual(commands, []);
  for (const [clientX, clientY] of sectors) {
    dispatch(window, 'pointermove', { ...pointer, clientX, clientY });
    dispatch(window, 'pointermove', { ...pointer, clientX, clientY });
  }
  assert.deepEqual(commands, sectors.map(([, , name]) => name));

  dispatch(window, 'pointermove', { ...pointer, clientX: 100, clientY: 100 });
  assert.deepEqual(commands.slice(-2), ['AVANZAR_IZQUIERDA', 'DETENER']);
  assert.equal(knob.style.translate, '0px 0px');
  dispatch(window, 'pointerup', pointer);
  assert.equal(commands.length, sectors.length + 1);

  dispatch(element, 'pointerdown', { ...pointer, clientX: 160, clientY: 160 });
  dispatch(window, 'pointerup', pointer);
  assert.deepEqual(commands.slice(-2), ['RETROCEDER_DERECHA', 'DETENER']);
  assert.equal(knob.style.translate, '0px 0px');
  controller.destroy();
});

test('el teclado combina las nuevas diagonales y detiene al soltar ambas teclas', () => {
  const { controller, element, knob, commands } = joystickFixture(() => true);
  for (const [type, key] of [
    ['keydown', 'ArrowUp'], ['keydown', 'ArrowLeft'],
    ['keyup', 'ArrowLeft'], ['keyup', 'ArrowUp'],
    ['keydown', 'ArrowRight'], ['keydown', 'ArrowDown'],
    ['keyup', 'ArrowDown'], ['keyup', 'ArrowRight'],
  ]) {
    assert.equal(dispatch(element, type, { key }).defaultPrevented, true);
  }
  assert.deepEqual(commands, [
    'AVANZAR', 'AVANZAR_IZQUIERDA', 'AVANZAR', 'DETENER',
    'DERECHA', 'RETROCEDER_DERECHA', 'DERECHA', 'DETENER',
  ]);
  assert.equal(knob.style.translate, '0px 0px');
  controller.destroy();
});

test('sin las diagonales activas del catálogo se mantiene el cardinal dominante', () => {
  const missing = new Set(['AVANZAR_IZQUIERDA', 'RETROCEDER_DERECHA']);
  const { controller, element, window, commands } = joystickFixture(name => !missing.has(name));
  const pointer = { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1 };
  dispatch(element, 'pointerdown', { ...pointer, clientX: 40, clientY: 40 });
  dispatch(window, 'pointermove', { ...pointer, clientX: 160, clientY: 140 });
  dispatch(window, 'pointerup', pointer);
  assert.deepEqual(commands, ['AVANZAR', 'DERECHA', 'DETENER']);
  controller.destroy();
});

test('al salir de la página el joystick detiene solo cuando hay una interacción activa', () => {
  const { controller, element, window, commands } = joystickFixture();
  dispatch(window, 'pagehide');
  assert.deepEqual(commands, []);
  dispatch(element, 'keydown', { key: 'ArrowLeft' });
  dispatch(window, 'pagehide');
  dispatch(window, 'pagehide');
  assert.deepEqual(commands, ['IZQUIERDA', 'DETENER']);
  controller.destroy();
});
