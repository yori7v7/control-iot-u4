import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import test from 'node:test';
import { GUEST_DIRECTIONS, PublicControlClient } from '../js/services/PublicControlClient.js';
import { PublicControlService } from '../js/services/PublicControlService.js';

const LOCAL = 'http://127.0.0.1:4173';
const REMOTE = 'https://frontend-api.test';
const PUBLIC = '/publico/vehiculos/1';
const ADMIN = '/admin/vehiculos/1/control-publico';
const KEY = 'fake-owner-key';
const BASE_TIME = Date.UTC(2040, 0, 1);
const iso = time => new Date(BASE_TIME + time).toISOString();
const json = (body, status = 200) => Response.json(body, { status });
const reject = status => json({ detalle: 'Mensaje interno que no debe llegar a la interfaz.' }, status);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function simulator({ simulation = true } = {}) {
  let clock = 0;
  let revision = 0;
  let windowEnd = 0;
  let guest = null;
  let operation = null;
  let stopped = null;
  let epoch = 0;
  let guestNumber = 0;
  const requests = [];

  function publicStatus() {
    if (windowEnd && clock >= windowEnd) {
      windowEnd = 0;
      guest = null;
      revision++;
    }
    if (guest && clock >= guest.idle) {
      guest = null;
      revision++;
    }
    return {
      id_vehiculo: 1, habilitado: Boolean(windowEnd),
      estado: guest ? 'ocupado' : windowEnd ? 'disponible' : 'cerrado',
      vence_ventana_en: windowEnd ? iso(windowEnd) : null, hora_servidor: iso(clock), revision, simulado: simulation,
    };
  }

  function adminStatus() {
    return {
      ...publicStatus(), inicio_ventana_en: windowEnd ? iso(windowEnd - 1200000) : null,
      id_turno_auditoria: guest?.id ?? null, turno_vence_en: guest ? iso(guest.expires) : null,
      parada: stopped, motivo_bloqueo: null,
    };
  }

  function turnStatus() {
    if (operation && clock >= Date.parse(operation.creada_en) - BASE_TIME + 250) {
      operation.estado = 'finalizada';
    }
    return {
      id_vehiculo: 1, estado: 'activo', vence_en: iso(guest.expires), vence_inactividad_en: iso(guest.idle),
      hora_servidor: iso(clock), epoca_operacion: epoch, siguiente_secuencia: guest.sequence,
      ultima_operacion: operation, simulado: true,
    };
  }

  function stopResult() {
    epoch++;
    revision++;
    if (operation) operation.estado = 'finalizada';
    stopped = {
      id_operacion: randomUUID(), id_vehiculo: 1, epoca_operacion: epoch, estado: 'verificada',
      solicitada_en: iso(clock), verificada_en: iso(clock), simulado: true,
    };
    return json(stopped, 202);
  }

  function respond({ path, method, headers, body }) {
    const status = publicStatus();
    const owner = headers['X-API-Key'];
    const token = headers.Authorization;
    if (path === `${PUBLIC}/control` && method === 'GET') return json(status);
    if (path.startsWith(ADMIN)) {
      if (owner !== KEY || token) return reject(403);
      if (path === ADMIN && method === 'GET') return json(adminStatus());
      if (path === `${ADMIN}/ventana` && method === 'PUT') {
        if (windowEnd) return reject(409);
        windowEnd = clock + 1200000;
        revision++;
        return json(adminStatus());
      }
      if (path === `${ADMIN}/ventana` && method === 'DELETE') {
        if (!windowEnd) return json(adminStatus());
        windowEnd = 0;
        guest = null;
        return stopResult();
      }
      if (path === `${ADMIN}/revocacion` && method === 'POST') {
        guest = null;
        return stopResult();
      }
    }
    if (path === `${PUBLIC}/sesion` && method === 'POST') {
      if (token || owner) return reject(403);
      if (status.estado !== 'disponible') return reject(409);
      revision++;
      epoch++;
      guest = {
        id: randomUUID(), token: String(++guestNumber).padStart(43, 'x'),
        expires: clock + 120000, idle: clock + 20000, sequence: 1,
      };
      operation = null;
      return json({ ...turnStatus(), token: guest.token }, 201);
    }
    if (path.startsWith(`${PUBLIC}/sesion`)) {
      if (!guest || token !== `Bearer ${guest.token}` || owner) return reject(401);
      if (path === `${PUBLIC}/sesion` && method === 'GET') return json(turnStatus());
      if (path === `${PUBLIC}/sesion` && method === 'DELETE') {
        guest = null;
        return stopResult();
      }
      if (path === `${PUBLIC}/sesion/parada` && method === 'POST') return stopResult();
      if (path === `${PUBLIC}/sesion/acciones` && method === 'POST') {
        if (body.epoca_operacion !== epoch || body.secuencia !== guest.sequence) return reject(409);
        if (!GUEST_DIRECTIONS.includes(body.accion)) return reject(403);
        guest.sequence++;
        guest.idle = Math.min(guest.expires, clock + 20000);
        revision++;
        operation = {
          id_operacion: randomUUID(), id_vehiculo: 1, epoca_operacion: epoch, estado: 'aceptada',
          creada_en: iso(clock), simulado: true,
        };
        return json(operation, 202);
      }
    }
    return reject(404);
  }

  const fixture = {
    requests, override: null,
    advance(ms) { clock += ms; },
    client() {
      return new PublicControlClient({
        baseUrl: simulation ? LOCAL : REMOTE, simulation,
        async fetchImpl(url, { method, headers, body, ...options }) {
          assert.equal(new URL(url).origin, simulation ? LOCAL : REMOTE);
          const request = { path: new URL(url).pathname, method, headers, body: body && JSON.parse(body), options };
          requests.push(request);
          return fixture.override?.(request, respond) ?? respond(request);
        },
      });
    },
    service(options = {}) {
      return new PublicControlService({ client: fixture.client(), now: () => clock, uuid: randomUUID, ...options });
    },
  };
  return fixture;
}

async function reconcile(...sessions) {
  // Let a reconciliation queued behind an invalidated GET complete.
  await setImmediate();
  await Promise.all(sessions.map(session => session.refresh()));
  await setImmediate();
}

async function open(fixture) {
  const owner = fixture.service();
  assert.equal(owner.setAdminKey(KEY), true);
  await reconcile(owner);
  assert.equal(await owner.enableWindow(true), true);
  await reconcile(owner);
  return owner;
}

async function claim(fixture) {
  const visitor = fixture.service();
  await reconcile(visitor);
  assert.equal(await visitor.acquire(), true);
  await reconcile(visitor);
  return visitor;
}

test('production reads only the closed public and authenticated admin projections', async () => {
  const fixture = simulator({ simulation: false });
  const client = fixture.client();
  assert.throws(() => new PublicControlClient({ baseUrl: REMOTE, simulation: true }), TypeError);
  assert.throws(() => new PublicControlClient({ baseUrl: `${LOCAL}/arbitrary`, simulation: true }), TypeError);
  assert.throws(() => new PublicControlClient({ baseUrl: LOCAL }), TypeError);
  const token = 'x'.repeat(43);
  await assert.rejects(client.acquire(), { kind: 'auth' });
  await assert.rejects(client.getTurn(token), { kind: 'auth' });
  await assert.rejects(client.getTurn(), { kind: 'auth' });
  await assert.rejects(client.move(token, {}), { kind: 'auth' });
  await assert.rejects(client.stop(token, randomUUID()), { kind: 'auth' });
  await assert.rejects(client.release(token), { kind: 'auth' });
  await assert.rejects(client.enableWindow(KEY, randomUUID()), { kind: 'auth' });
  await assert.rejects(client.revoke(KEY, randomUUID()), { kind: 'auth' });
  await assert.rejects(client.disableWindow(KEY), { kind: 'auth' });
  assert.equal(fixture.requests.length, 0);

  const owner = fixture.service();
  owner.setAdminKey(KEY);
  await reconcile(owner);
  assert.equal(owner.state.role, 'administrator');
  assert.equal(owner.state.status, 'unavailable');
  assert.equal(owner.state.adminReady, false);
  assert.equal(await owner.enableWindow(true), false);
  assert.ok(fixture.requests.every(request => request.method === 'GET'));
  assert.deepEqual(fixture.requests.find(({ path }) => path === `${PUBLIC}/control`).headers,
    { Accept: 'application/json' });
  assert.deepEqual(fixture.requests.find(({ path }) => path === ADMIN).headers,
    { Accept: 'application/json', 'X-API-Key': KEY });
});

test('production distinguishes a legacy route, denied key, malformed response and transient error', async () => {
  const fixture = simulator({ simulation: false });
  const owner = fixture.service();
  fixture.override = ({ path }) => path === ADMIN ? reject(404) : undefined;
  owner.setAdminKey(KEY);
  await reconcile(owner);
  assert.equal(owner.state.adminPermission, 'legacy');
  assert.equal(owner.state.role, 'observer');
  fixture.override = ({ path }) => path === ADMIN ? reject(403) : undefined;
  await reconcile(owner);
  assert.equal(owner.state.adminPermission, 'rejected');
  fixture.override = null;
  await reconcile(owner);
  assert.equal(owner.state.adminPermission, 'authorized');
  fixture.override = ({ path }) => path === ADMIN ? Promise.reject(new Error(KEY)) : undefined;
  await reconcile(owner);
  assert.equal(owner.state.adminPermission, 'authorized');
  assert.doesNotMatch(JSON.stringify(owner.state), /fake-owner-key/);
  fixture.override = ({ path }) => path === ADMIN ? json({ estado: 'cerrado' }) : undefined;
  await reconcile(owner);
  assert.equal(owner.state.adminPermission, 'unavailable');
  assert.equal(owner.state.role, 'observer');
});

test('a replaced key and an older server revision cannot overwrite the current policy', async () => {
  const fixture = simulator();
  const owner = fixture.service();
  const oldKey = deferred();
  fixture.override = ({ path, headers }) => path === ADMIN && headers['X-API-Key'] === 'old' ? oldKey.promise : undefined;
  owner.setAdminKey('old');
  owner.setAdminKey(KEY);
  await reconcile(owner);
  assert.equal(owner.state.adminPermission, 'authorized');
  oldKey.resolve(reject(403));
  await setImmediate();
  assert.equal(owner.state.adminPermission, 'authorized');
  let stale;
  fixture.override = (request, respond) => request.path === `${PUBLIC}/control`
    ? respond(request).json().then(row => { stale = row; return json(row); }) : undefined;
  await reconcile(owner);
  fixture.override = null;
  assert.equal(await owner.enableWindow(true), true);
  await reconcile(owner);
  assert.equal(owner.state.status, 'available');
  fixture.override = ({ path }) => path === `${PUBLIC}/control` ? json(stale) : undefined;
  await reconcile(owner);
  assert.equal(owner.state.status, 'available');
});

test('two clients reconcile occupancy, release and administrator revocation without sharing credentials', async () => {
  const fixture = simulator();
  const owner = fixture.service();
  owner.setAdminKey(KEY);
  await reconcile(owner);
  assert.equal(await owner.enableWindow(false), false);
  assert.equal(fixture.requests.some(request => request.method === 'PUT'), false);
  assert.equal(await owner.enableWindow(true), true);
  await reconcile(owner);
  const enable = fixture.requests.find(request => request.method === 'PUT');
  assert.equal(enable.path, `${ADMIN}/ventana`);
  assert.equal(enable.body.supervision_confirmada, true);
  assert.equal(enable.body.duracion_seg, 1200);
  assert.match(enable.body.id_solicitud, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
  const visitor = await claim(fixture);
  const observer = fixture.service();
  await reconcile(observer, owner);
  assert.equal(visitor.state.role, 'guest');
  assert.equal(visitor.state.canMove, true);
  assert.equal(visitor.state.canStop, true);
  assert.equal(visitor.state.turnSeconds, 20);
  assert.equal(visitor.setAdminKey(KEY), false);
  assert.equal(visitor.move('DEMO_ORIGINAL'), false);
  assert.equal(observer.state.status, 'occupied');
  assert.equal(observer.state.role, 'observer');
  assert.equal(observer.state.canAcquire, false);
  assert.equal(observer.move('AVANZAR'), false);
  assert.equal(await observer.requestStop(), false);
  assert.equal(await visitor.release(), true);
  await reconcile(visitor, observer);
  assert.equal(visitor.state.role, 'observer');
  assert.equal(observer.state.canAcquire, true);
  assert.equal(await observer.acquire(), true);
  await reconcile(observer, owner);
  assert.equal(owner.state.canRevoke, true);
  assert.equal(await owner.revoke(), true);
  await reconcile(observer, owner);
  assert.equal(observer.state.role, 'observer');
  assert.equal(observer.state.canStop, false);
  assert.match(observer.state.message, /ya no está autorizado/);
  assert.equal(await owner.disableWindow(), true);
  await reconcile(owner);
  assert.equal(owner.state.status, 'closed');
  assert.equal(owner.state.windowOpen, false);

  const publicRequests = fixture.requests.filter(({ path, method }) =>
    path === `${PUBLIC}/control` || (path === `${PUBLIC}/sesion` && method === 'POST'));
  for (const { headers, options } of publicRequests) {
    assert.equal(headers.Authorization, undefined);
    assert.equal(headers['X-API-Key'], undefined);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
  }
  assert.ok(fixture.requests.filter(({ path }) => path.startsWith(ADMIN)).every(({ headers }) =>
    headers.Authorization === undefined && headers['X-API-Key'] === KEY));
  assert.doesNotMatch(JSON.stringify(visitor.state), /x{40}|fake-owner-key/);
});

test('DETENER bypasses a pending direction, coalesces duplicates and discards stale receipts and intents', async () => {
  const fixture = simulator();
  await open(fixture);
  const visitor = await claim(fixture);
  const oldMove = deferred();
  fixture.override = (request, respond) => request.path.endsWith('/acciones')
    ? oldMove.promise.then(() => respond(request)) : undefined;
  assert.equal(visitor.move('AVANZAR_IZQUIERDA'), true);
  assert.equal(visitor.state.canMove, true);
  assert.equal(visitor.state.moveBusy, true);
  assert.equal(visitor.move('RETROCEDER_DERECHA'), true);
  const stop = visitor.requestStop();
  assert.equal(visitor.requestStop(), stop);
  assert.equal(await stop, true);
  assert.equal(visitor.state.guestReceipt.action, 'DETENER');
  assert.equal(visitor.state.guestReceipt.status, 202);
  oldMove.resolve();
  await reconcile(visitor);
  assert.equal(visitor.state.guestReceipt.action, 'DETENER');
  assert.equal(visitor.state.guestReceipt.phase, 'accepted');
  assert.equal(visitor.state.message, '');
  assert.equal(visitor.state.canMove, true);
  const writes = fixture.requests.filter(request => /\/(acciones|parada)$/.test(request.path));
  assert.deepEqual(writes.map(({ path }) => path), [`${PUBLIC}/sesion/acciones`, `${PUBLIC}/sesion/parada`]);
  assert.equal(writes[0].body.accion, 'AVANZAR_IZQUIERDA');
  assert.equal(writes[0].body.secuencia, 1);
  assert.equal(writes[0].body.duracion_ms, 250);
  assert.equal(writes[0].headers['X-API-Key'], undefined);
  assert.match(writes[0].headers.Authorization, /^Bearer [\w-]{43}$/);
});

test('only the latest fresh direction is sent after the simulator finalizes the previous movement', async () => {
  const fixture = simulator();
  await open(fixture);
  const visitor = await claim(fixture);
  assert.equal(visitor.move('AVANZAR'), true);
  await reconcile(visitor);
  assert.equal(visitor.state.moveBusy, true);
  assert.equal(visitor.move('DERECHA'), true);
  assert.equal(visitor.move('IZQUIERDA'), true);
  fixture.advance(251);
  await reconcile(visitor);
  assert.equal(visitor.state.guestReceipt.action, 'IZQUIERDA');
  assert.equal(visitor.state.guestReceipt.phase, 'accepted');
  assert.equal(visitor.move('RETROCEDER'), true);
  fixture.advance(751);
  await reconcile(visitor);
  const moves = fixture.requests.filter(request => request.path.endsWith('/acciones'));
  assert.deepEqual(moves.map(({ body }) => [body.accion, body.secuencia]), [['AVANZAR', 1], ['IZQUIERDA', 2]]);
});

test('a read failure locks movements, reconnect reconciles the turn and inactivity expires it locally', async () => {
  const fixture = simulator();
  await open(fixture);
  const visitor = await claim(fixture);
  fixture.override = () => Promise.reject(new Error('red caída'));
  await reconcile(visitor);
  assert.equal(visitor.state.canMove, false);
  assert.equal(visitor.state.canStop, true);
  visitor.setOnline(false);
  assert.equal(visitor.state.canStop, false);
  assert.equal(await visitor.requestStop(), false);
  assert.equal(visitor.move('AVANZAR'), false);
  fixture.override = null;
  fixture.advance(19500);
  visitor.setOnline(true);
  assert.equal(visitor.state.canMove, false);
  assert.equal(visitor.state.canStop, true);
  await reconcile(visitor);
  assert.equal(visitor.state.canMove, true);
  assert.equal(visitor.state.turnSeconds, 1);
  fixture.advance(501);
  assert.equal(visitor.state.role, 'observer');
  assert.equal(visitor.state.canStop, false);
  assert.equal(visitor.move('AVANZAR'), false);
  await reconcile(visitor);
  assert.match(visitor.state.message, /turno terminó/);
  assert.equal(visitor.state.canAcquire, true);
  assert.equal(fixture.requests.filter(request => request.method === 'POST').length, 1);
});

test('an ambiguous STOP does not replay or allow movements before reconciliation of a new epoch', async () => {
  const fixture = simulator();
  await open(fixture);
  const visitor = await claim(fixture);
  fixture.override = ({ path }) => path.endsWith('/parada') ? Promise.reject(new Error('interrumpida')) : undefined;
  assert.equal(await visitor.requestStop(), false);
  await reconcile(visitor);
  assert.equal(visitor.state.guestReceipt.phase, 'error');
  assert.equal(visitor.state.canMove, false);
  assert.equal(visitor.state.canStop, true);
  assert.equal(fixture.requests.filter(request => request.path.endsWith('/parada')).length, 1);
  fixture.override = null;
  assert.equal(await visitor.requestStop(), true);
  await reconcile(visitor);
  assert.equal(visitor.state.canMove, true);
  visitor.stop();
  assert.equal(visitor.state.role, 'observer');
  assert.equal(visitor.state.guestReceipt, null);
  await reconcile(visitor);
  assert.equal(visitor.state.status, 'occupied');
  assert.equal(visitor.state.canStop, false);
});

test('a grant received after disconnection is discarded and never retried', async () => {
  const fixture = simulator();
  await open(fixture);
  const visitor = fixture.service();
  await reconcile(visitor);
  const reply = deferred();
  let granted;
  fixture.override = (request, respond) => {
    if (request.method !== 'POST' || request.path !== `${PUBLIC}/sesion`) return undefined;
    granted = respond(request);
    return reply.promise.then(() => granted);
  };
  const acquisition = visitor.acquire();
  await setImmediate();
  assert.equal(granted.status, 201);
  visitor.setOnline(false);
  reply.resolve();
  assert.equal(await acquisition, false);
  visitor.setOnline(true);
  await reconcile(visitor);
  assert.equal(visitor.state.role, 'observer');
  assert.equal(visitor.state.status, 'occupied');
  assert.equal(visitor.state.canStop, false);
  assert.equal(fixture.requests.filter(({ method }) => method === 'POST').length, 1);
  assert.ok(fixture.requests.every(({ headers }) => !headers.Authorization));
});

test('an ambiguous move needs a new stop epoch before any new direction', async () => {
  const fixture = simulator();
  await open(fixture);
  const visitor = await claim(fixture);
  fixture.override = ({ path }) => path.endsWith('/acciones') ? Promise.reject(new Error('interrumpida')) : undefined;
  assert.equal(visitor.move('AVANZAR'), true);
  await reconcile(visitor);
  assert.equal(visitor.state.guestReceipt.phase, 'error');
  assert.match(visitor.state.guestReceipt.message, /Envía DETENER/);
  assert.equal(visitor.state.canMove, false);
  assert.equal(visitor.move('RETROCEDER'), false);
  assert.equal(visitor.state.canStop, true);
  assert.equal(fixture.requests.filter(request => request.path.endsWith('/acciones')).length, 1);
  assert.equal(await visitor.requestStop(), true);
  await reconcile(visitor);
  assert.equal(visitor.state.canMove, true);
});
