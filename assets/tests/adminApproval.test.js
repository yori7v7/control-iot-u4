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
  assert.equal(await service.approve(ID, 'supervised'), true);
  assert.equal(calls[0][1], ID);
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
  await client.approve('clave-no-compartir', ID, 'supervised', null);
  assert.equal(requests[0].url, 'https://api.example.com/admin/vehiculos/1/control-publico/solicitudes');
  assert.equal(requests[1].options.method, 'POST');
  assert.equal(requests[0].options.headers['X-API-Key'], 'clave-no-compartir');
  assert.ok(requests.every(row => !row.url.includes('clave-no-compartir') &&
    row.options.credentials === 'omit' && row.options.cache === 'no-store'));
  assert.equal(typeof client.move, 'undefined');
});
