import test from 'node:test';
import assert from 'node:assert/strict';
import { AdminApprovalClient, AdminApprovalService } from '../js/services/AdminApprovalService.js';

const ID = '12345678-1234-4234-a234-123456789abc';
const REQUEST = { request_id: ID, display_code: 'A1B2C3D4', vence_en_seg: 120 };
const snapshot = (active = false) => ({
  solicitudes: [REQUEST], turno_activo: active, control_fisico: false, simulado: true,
});
const ack = fields => ({ ...fields, control_fisico: false, simulado: true });
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function setup(overrides = {}) {
  let time = 1000;
  const timers = new Map();
  let index = 0;
  const client = {
    pending: async () => snapshot(),
    heartbeat: async () => ack({ supervision: true, vigencia_s: 15 }),
    approve: async () => ack({ aprobada: true }),
    reject: async () => ack({ rechazada: true }),
    revoke: async () => ack({ revocado: true }),
    ...overrides,
  };
  const service = new AdminApprovalService({
    client,
    clock: () => time,
    onChange: () => {},
    setIntervalImpl: (fn, ms) => { const id = ++index; timers.set(id, { fn, ms }); return id; },
    clearIntervalImpl: id => timers.delete(id),
  });
  return { service, timers, setTime: value => { time = value; } };
}

test('K-J: la clave no concede permiso sin supervisor', async () => {
  const { service } = setup();
  service.start('clave-local-ficticia');
  await flush();
  assert.equal(service.state.phase, 'ready');
  assert.equal(service.state.canApprove, false);
  assert.equal(await service.approve(ID), false);
  assert.equal(service.state.canDrive, false);
  service.stop();
});

test('K-J: aprobación solo después de latido supervisado', async () => {
  const calls = [];
  const { service } = setup({ approve: async (...args) => {
    calls.push(args);
    return ack({ aprobada: true });
  } });
  service.start('admin-local');
  await flush();
  assert.equal(await service.beginSupervision(), true);
  assert.equal(service.state.canApprove, true);
  assert.equal(await service.approve(ID, 'timed', 120), true);
  assert.equal(calls[0][1], ID);
  assert.equal(calls[0][2], 'timed');
  assert.equal(calls[0][3], 120);
  assert.equal(service.state.canDrive, false);
  service.stop();
});

test('K-J: jamás se puede aprobar una solicitud ajena', async () => {
  const { service } = setup();
  service.start('admin-local'); await flush(); await service.beginSupervision();
  assert.equal(await service.approve('00000000-0000-4000-8000-000000000000'), false);
  service.stop();
});

test('K-J: turno limitado de 120 segundos', async () => {
  let seconds = 0;
  const { service } = setup({ approve: async (_key, _id, _mode, duration) => {
    seconds = duration;
    return ack({ aprobada: true });
  } });
  service.start('admin-local'); await flush(); await service.beginSupervision();
  assert.equal(await service.approve(ID, 'timed', 120), true);
  assert.equal(seconds, 120);
  assert.equal(await service.approve(ID, 'timed', 900), false);
  assert.equal(await service.approve(ID, 'timed', 121), false);
  assert.equal(await service.approve(ID, 'timed', 120), false);
  service.stop();
});

test('K-J: rechazo de solicitud concreta', async () => {
  let rejected;
  const { service } = setup({ reject: async (_key, id) => {
    rejected = id;
    return ack({ rechazada: true });
  } });
  service.start('admin-local'); await flush();
  assert.equal(await service.reject(ID), true);
  assert.equal(rejected, ID);
  service.stop();
});

test('K-J: revocación solo con turno confirmado', async () => {
  let revoked = 0;
  const { service } = setup({
    pending: async () => snapshot(true),
    revoke: async () => { revoked++; return ack({ revocado: true }); },
  });
  service.start('admin-local'); await flush();
  assert.equal(service.state.canRevoke, true);
  assert.equal(await service.revoke(), true);
  assert.equal(revoked, 1);
  service.stop();
});

test('K-J: latido vencido desactiva aprobar aunque la pestaña esté abierta', async () => {
  const { service, setTime } = setup();
  service.start('admin-local'); await flush(); await service.beginSupervision();
  assert.equal(service.state.canApprove, true);
  setTime(16000);
  assert.equal(service.state.supervising, false);
  assert.equal(service.state.canApprove, false);
  service.stop();
});

test('K-J: pérdida de API deja cerrado el panel', async () => {
  const { service } = setup({ pending: async () => { throw Error('sin conexión'); } });
  service.start('admin-local'); await flush();
  assert.equal(service.state.phase, 'unavailable');
  assert.equal(service.state.canApprove, false);
  service.stop();
});

test('K-J: no se acepta respuesta con control físico', async () => {
  const { service } = setup({ pending: async () => ({ ...snapshot(), control_fisico: true }) });
  service.start('admin-local'); await flush();
  assert.equal(service.state.phase, 'unavailable');
  service.stop();
});

test('K-J: cerrar sesión elimina estado y temporizadores', async () => {
  const { service, timers } = setup();
  service.start('admin-local'); await flush(); await service.beginSupervision();
  assert.equal(timers.size, 2);
  service.stop();
  assert.equal(timers.size, 0);
  assert.equal(service.state.phase, 'inactive');
  assert.equal(service.state.canDrive, false);
});

test('K-J: solicitud anterior no puede restaurarse tras cerrar', async () => {
  let resolve;
  const { service } = setup({ pending: () => new Promise(done => { resolve = done; }) });
  service.start('primera-clave');
  service.stop();
  resolve(snapshot());
  await flush();
  assert.equal(service.state.phase, 'inactive');
});

test('K-J: API key viaja en header, nunca en URL ni en almacenamiento', async () => {
  const requests = [];
  const client = new AdminApprovalClient({
    apiUrl: 'https://api.example.com/', vehicleId: 1,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ack({ solicitudes: [], turno_activo: false }) };
    },
  });
  await client.pending('clave-no-compartir');
  await client.approve('clave-no-compartir', ID, 'timed', 120);
  assert.equal(requests[0].url, 'https://api.example.com/admin/vehiculos/1/control-publico/solicitudes');
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {modo: 'timed', segundos: 120});
  await assert.rejects(client.approve('clave-no-compartir', ID, 'supervised', null), TypeError);
  await assert.rejects(client.approve('clave-no-compartir', ID, 'timed', 121), TypeError);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].options.headers['X-API-Key'], 'clave-no-compartir');
  assert.ok(requests.every(row => !row.url.includes('clave-no-compartir') &&
    row.options.credentials === 'omit' && row.options.cache === 'no-store'));
  assert.equal(typeof client.move, 'undefined');
});

test('K-J: HTTP 200 sin aprobación positiva no concede éxito', async () => {
  const { service } = setup({ approve: async () => ack({ aprobada: false }) });
  service.start('admin-local'); await flush(); await service.beginSupervision();
  assert.equal(await service.approve(ID, 'supervised'), false);
  assert.equal(service.state.phase, 'unavailable');
  assert.equal(service.state.canApprove, false);
  service.stop();
});


test('K-N: ocultar admin revoca virtual best-effort y no reanuda supervisor',async()=>{
  let revoked=0;
  const {service,timers}=setup({revoke:async()=>{revoked++;return ack({revocado:true})}});
  service.start('admin-local');await flush();
  assert.equal(service.state.phase,'ready');
  assert.equal(await service.beginSupervision(),true);
  assert.equal(service.state.canApprove,true);
  const acknowledged=await service.pause();
  assert.equal(acknowledged,true);
  assert.equal(revoked,1);
  assert.equal(service.state.phase,'unavailable');
  assert.equal(service.state.canApprove,false);
  assert.equal(service.state.canDrive,false);
  assert.equal(timers.size,0);
  service.resume();
  await flush();
  assert.equal(service.state.phase,'ready');
  assert.equal(service.state.supervising,false);
  assert.equal(service.state.canApprove,false);
  assert.equal(service.state.canSupervise,true);
  service.stop();
});

test('K-N: sin red no se puede confirmar revocacion, pero la UI falla cerrada',async()=>{
  const {service}=setup({pending:async()=>snapshot(true),
    revoke:async()=>{throw Error('offline')}});
  service.start('admin-local');await flush();
  assert.equal(service.state.canRevoke,true);
  const ack=await service.pause();
  assert.equal(ack,false);
  assert.equal(service.state.phase,'unavailable');
  assert.equal(service.state.canApprove,false);
  assert.equal(service.state.canRevoke,false);
  assert.equal(await service.approve(ID,'timed',120),false);
  service.stop();
});

test('K-N: respuesta admin pendiente no restaura estado tras pestaña oculta',async()=>{
  let answer;
  let n=0;
  const {service}=setup({pending:()=>{
    n++;
    return n===1?new Promise(resolve=>{answer=resolve}):Promise.resolve(snapshot());
  }});
  service.start('admin-local');
  const ack=await service.pause();
  assert.equal(ack,false);
  answer(snapshot());
  await flush();
  assert.equal(service.state.phase,'unavailable');
  assert.equal(service.state.pending.length,0);
  service.resume();
  await flush();
  assert.equal(service.state.phase,'ready');
  assert.equal(service.state.canApprove,false);
  assert.equal(n,2);
  service.stop();
});

test('K-N: reloj retrocede y el latido deja de autorizar inmediatamente',async()=>{
  const {service,setTime}=setup();
  service.start('admin-local');await flush();
  await service.beginSupervision();
  assert.equal(service.state.canApprove,true);
  setTime(900);
  assert.equal(service.state.supervising,false);
  assert.equal(service.state.canApprove,false);
  service.stop();
});

test('K-N: detener durante pausa invalida cualquier futura reanudacion',async()=>{
  const {service}=setup();
  service.start('admin-local');await flush();await service.beginSupervision();
  await service.pause();
  service.stop();
  service.resume();
  await flush();
  assert.equal(service.state.phase,'inactive');
  assert.equal(service.state.canDrive,false);
});


test('K-N: aprobación HTTP tardía no restaura permisos tras suspender la pestaña',async()=>{
  let release;
  const {service}=setup({approve:()=>new Promise(resolve=>{release=resolve})});
  service.start('admin-local');await flush();
  await service.beginSupervision();
  const pending=service.approve(ID,'timed',120);
  assert.equal(service.state.busy,true);
  assert.equal(await service.pause(),true);
  assert.equal(service.state.phase,'unavailable');
  release(ack({aprobada:true}));
  assert.equal(await pending,false);
  assert.equal(service.state.phase,'unavailable');
  assert.equal(service.state.canApprove,false);
  assert.equal(service.state.canDrive,false);
  service.stop();
});


test('K-AF: cancelación de sesión y timeout permanecen combinados', async () => {
  const controller = new AbortController();
  let passedSignal;
  const client = new AdminApprovalClient({
    apiUrl: 'https://api.example.com/', vehicleId: 1,
    fetchImpl: async (_url, options) => {
      passedSignal = options.signal;
      return { ok: true, json: async () => ack({ solicitudes: [], turno_activo: false }) };
    },
  });
  await client.pending('clave-local', controller.signal);
  assert.ok(passedSignal);
  assert.notEqual(passedSignal, controller.signal, 'No puede perderse el deadline al recibir señal de sesión.');
  assert.equal(passedSignal.aborted, false);
  controller.abort();
  assert.equal(passedSignal.aborted, true, 'Cerrar el panel debe cancelar la petición.');
});

test('K-AF: HTTP bloqueado agota deadline incluso con señal de sesión activa', async () => {
  const controller = new AbortController();
  let observedSignal;
  const client = new AdminApprovalClient({
    apiUrl: 'https://api.example.com/', vehicleId: 1, timeoutMs: 25,
    fetchImpl: async (_url, options) => {
      observedSignal = options.signal;
      return new Promise((_resolve, reject) => {
        if (options.signal.aborted) return reject(options.signal.reason);
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
  });
  // AbortSignal.timeout usa un timer no-ref en Node; mantener activo el
  // proceso de prueba para observar realmente la expiración de la petición.
  const keepEventLoopAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(client.pending('clave-local', controller.signal), /timeout|aborted/i);
  } finally {
    clearTimeout(keepEventLoopAlive);
  }
  assert.equal(controller.signal.aborted, false, 'El timeout no debe invalidar la sesión del administrador.');
  assert.equal(observedSignal.aborted, true);
});

test('K-AF: configuraciones sin deadline válido se rechazan', () => {
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 60001, '5000']) {
    assert.throws(() => new AdminApprovalClient({
      apiUrl: 'https://api.example.com/', vehicleId: 1, timeoutMs,
      fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
    }), TypeError);
  }
});


test('K-AF: una respuesta HTTP resuelta después de cancelar jamás cuenta como éxito', async () => {
  const controller = new AbortController();
  let completeFetch;
  const client = new AdminApprovalClient({
    apiUrl: 'https://api.example.com/', vehicleId: 1,
    fetchImpl: () => new Promise(resolve => { completeFetch = resolve; }),
  });
  const request = client.pending('clave-local', controller.signal);
  controller.abort();
  completeFetch({ ok: true, status: 200, json: async () => ack({ solicitudes: [], turno_activo: false }) });
  await assert.rejects(request, error => error?.name === 'AbortError');
});

test('K-AF: un JSON demorado no se acepta si la sesión fue cancelada', async () => {
  const controller = new AbortController();
  let completeJson;
  const client = new AdminApprovalClient({
    apiUrl: 'https://api.example.com/', vehicleId: 1,
    fetchImpl: async () => ({
      ok: true, status: 200,
      json: () => new Promise(resolve => { completeJson = resolve; }),
    }),
  });
  const request = client.pending('clave-local', controller.signal);
  await Promise.resolve();
  controller.abort();
  completeJson(ack({ solicitudes: [], turno_activo: false }));
  await assert.rejects(request, error => error?.name === 'AbortError');
});
