import test from 'node:test';
import assert from 'node:assert/strict';
import { GuestAdmissionService, GuestAdmissionClient } from '../js/services/GuestAdmissionService.js';

const secret = 'x'.repeat(43);
const reply = { browser_secret: secret, display_code: 'A1B2C3D4', estado: 'esperando_autorizacion',
  simulado: true, control_fisico: false, canDrive: false };
const status = estado => ({ estado, display_code: reply.display_code, simulado: true, control_fisico: false, canDrive: false });
const make = (client) => {
  let tick = null, clears = 0;
  const updates = [];
  const model = new GuestAdmissionService({ client, onChange: s => updates.push(s),
    setIntervalImpl: fn => {tick=fn;return 123;}, clearIntervalImpl: () => {clears++;} });
  return { model, updates, get tick(){return tick;}, get clears(){return clears;} };
};

test('Solicitud automática queda esperando, sin acceso de mando', async () => {
  const t = make({ request: async () => reply, status: async () => status('esperando_autorizacion') });
  await t.model.start();
  assert.equal(t.model.state.phase, 'waiting');
  assert.equal(t.model.state.canDrive, false);
  assert.equal(t.model.state.code, 'A1B2C3D4');
});
test('Aprobado virtual NO habilita el joystick', async () => {
  const t = make({ request: async () => reply, status: async () => status('autorizado') });
  await t.model.start(); await t.model.refresh();
  assert.equal(t.model.state.phase,'approved_virtual'); assert.equal(t.model.state.canDrive,false);
});
test('Revocación observada sin botón deja sesión inválida', async () => {
  let count=0;
  const t=make({request:async()=>reply,status:async()=>status(++count===1?'autorizado':'revocado_o_caducado')});
  await t.model.start(); await t.tick(); await Promise.resolve();
  assert.equal(t.model.state.phase,'approved_virtual');
  await t.tick(); await Promise.resolve();
  assert.equal(t.model.state.phase,'revoked'); assert.equal(t.clears,1);
});
test('Respuesta ambigua falla cerrado',async()=>{
  const t=make({request:async()=>reply,status:async()=>({...status('autorizado'),control_fisico:true})});
  await t.model.start();await t.model.refresh();
  assert.equal(t.model.state.phase,'unavailable'); assert.equal(t.model.state.canDrive,false);
});
test('HTTP caído no habilita controles',async()=>{
  const t=make({request:async()=>{throw new Error('offline')},status:async()=>status('autorizado')});
  await t.model.start(); assert.equal(t.model.state.phase,'unavailable');assert.equal(t.model.state.canDrive,false);
});
test('Cierre impide que solicitud tardía reinstale sesión',async()=>{
  let resolve;
  const t=make({request:()=>new Promise(r=>resolve=r),status:async()=>status('autorizado')});
  const work=t.model.start();t.model.stop();resolve(reply);await work;
  assert.equal(t.model.state.phase,'inactive');assert.equal(t.model.state.code,'');
});
test('Doble comienzo produce una sola solicitud',async()=>{
  let n=0;
  const t=make({request:async()=>{n++;return reply},status:async()=>status('esperando_autorizacion')});
  await Promise.all([t.model.start(),t.model.start()]);assert.equal(n,1);
});
test('Validación del secreto del cliente',async()=>{
  const c=new GuestAdmissionClient({apiUrl:'https://api.example.com/',vehicleId:1,fetchImpl:async()=>{throw Error('should not call')}});
  assert.throws(()=>c.status('too short'),TypeError);
  assert.throws(()=>new GuestAdmissionClient({apiUrl:'http://api.example.com/',vehicleId:1}),TypeError);
});
test('Ninguna API de movimiento ni contraseña de administrador',()=>{
  const c=new GuestAdmissionClient({apiUrl:'https://api.example.com/',vehicleId:1,fetchImpl:()=>{}});
  assert.equal(typeof c.move,'undefined');assert.equal(typeof c.stop,'undefined');assert.equal(typeof c.approve,'undefined');
});
test('HTTP sin credenciales ni token en URL',async()=>{
  let recorded;
  const c=new GuestAdmissionClient({apiUrl:'https://api.example.com/',vehicleId:1,fetchImpl:async (url,opt)=>{
    recorded={url,opt};
    return {ok:true,json:async()=>({...reply,
      browser_secret:opt.headers['X-Browser-Proposal'] || reply.browser_secret})};
  }});
  await c.request();
  assert.equal(recorded.url,'https://api.example.com/publico/vehiculos/1/solicitudes');
  assert.equal(recorded.opt.credentials,'omit');assert.equal(recorded.opt.method,'POST');
  await c.status(secret);
  assert.equal(recorded.opt.headers['X-Browser-Session'],secret);
  assert.ok(!recorded.url.includes(secret));
});


test('K-N: pestaña oculta invalida permiso, para polling y exige GET al volver',async()=>{
  let calls=0;
  const t=make({request:async()=>reply,status:async()=>{calls++;return status('autorizado')}});
  await t.model.start();await t.model.refresh();
  assert.equal(t.model.state.phase,'approved_virtual');
  t.model.pause();
  assert.equal(t.model.state.phase,'unavailable');
  assert.equal(t.model.state.canDrive,false);
  const before=calls;
  await t.tick();
  assert.equal(calls,before);
  t.model.resume();
  for(let i=0;i<4;i++) await Promise.resolve();
  assert.equal(calls,before+1);
  assert.equal(t.model.state.phase,'approved_virtual');
  assert.equal(t.model.state.canDrive,false);
  t.model.stop();
});

test('K-N: caducidad remota durante desconexion revoca al reconectar',async()=>{
  let remote='autorizado';
  const t=make({request:async()=>reply,status:async()=>status(remote)});
  await t.model.start();await t.model.refresh();
  assert.equal(t.model.state.phase,'approved_virtual');
  t.model.pause();
  remote='revocado_o_caducado';
  t.model.resume();
  for(let i=0;i<4;i++) await Promise.resolve();
  assert.equal(t.model.state.phase,'revoked');
  assert.equal(t.model.state.canDrive,false);
  assert.equal(t.clears>=1,true);
  t.model.stop();
});

test('K-N: respuesta HTTP tardia tras pausa nunca restaura permiso',async()=>{
  let release;
  let calls=0;
  const t=make({request:async()=>reply,status:()=>{
    calls++;
    if(calls===1)return new Promise(resolve=>{release=resolve});
    return Promise.resolve(status('revocado_o_caducado'));
  }});
  await t.model.start();
  const pending=t.model.refresh();
  t.model.pause();
  release(status('autorizado'));
  await pending;
  assert.equal(t.model.state.phase,'unavailable');
  t.model.resume();
  for(let i=0;i<5;i++) await Promise.resolve();
  assert.equal(t.model.state.phase,'revoked');
  assert.equal(t.model.state.canDrive,false);
  t.model.stop();
});

test('K-N: solicitud inicial en vuelo se descarta al ocultar y reintenta sin persistencia',async()=>{
  let deliver;
  let requests=0;
  const t=make({request:()=>{
    requests++;
    return requests===1 ? new Promise(resolve=>{deliver=resolve}) : Promise.resolve(reply);
  },status:async()=>status('esperando_autorizacion')});
  const first=t.model.start();
  t.model.pause();
  deliver(reply);
  await first;
  assert.equal(t.model.state.phase,'unavailable');
  t.model.resume();
  for(let i=0;i<5;i++) await Promise.resolve();
  assert.equal(requests,2);
  assert.equal(t.model.state.phase,'waiting');
  assert.equal(t.model.state.canDrive,false);
  t.model.stop();
});


test('K-T: mismo par aleatorio en reintentos tras perdida de respuesta',async()=>{
  let attempts=0, saved;
  const fetchImpl=async(url,opt)=>{
    assert.equal(opt.method,'POST');
    attempts++;
    const key=opt.headers['Idempotency-Key'];
    const proposal=opt.headers['X-Browser-Proposal'];
    assert.match(key,/^[A-Za-z0-9_-]{43}$/);
    assert.match(proposal,/^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(key,proposal);
    if(saved){assert.equal(key,saved.key); assert.equal(proposal,saved.proposal);}
    else saved={key,proposal};
    if(attempts===1)throw new Error('HTTP aceptado, respuesta perdida');
    return {ok:true,json:async()=>({
      browser_secret:proposal,display_code:'A1B2C3D4',estado:'esperando_autorizacion',
      simulado:true,control_fisico:false,canDrive:false,
    })};
  };
  const client=new GuestAdmissionClient({apiUrl:'https://api.example.com/',vehicleId:1,fetchImpl});
  const service=make({request:()=>client.request(),status:async()=>status('esperando_autorizacion')});
  await service.model.start();
  assert.equal(service.model.state.phase,'unavailable');
  assert.equal(service.model.state.canDrive,false);
  await service.tick();
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(attempts,2);
  assert.equal(service.model.state.phase,'waiting');
  assert.equal(service.model.state.canDrive,false);
  service.model.stop();
});

test('K-T: cerrar elimina las claves K-T y una nueva solicitud usa otras',async()=>{
  const seen=[];
  const client=new GuestAdmissionClient({
    apiUrl:'https://api.example.com/',vehicleId:1,
    fetchImpl:async(_url,opt)=>{
      seen.push({key:opt.headers['Idempotency-Key'],proposal:opt.headers['X-Browser-Proposal']});
      return {ok:true,json:async()=>({...reply,browser_secret:opt.headers['X-Browser-Proposal']})};
    },
  });
  await client.request(); await client.request();
  assert.deepEqual(seen[0],seen[1]);
  client.reset();
  await client.request();
  assert.notEqual(seen[0].key,seen[2].key);
  assert.notEqual(seen[0].proposal,seen[2].proposal);
});

test('K-T: rechaza token falso, backend físico o secreto distinto',async()=>{
  const base={...reply,browser_secret:'x'.repeat(43)};
  const cases=[
    {...base,simulado:false},
    {...base,control_fisico:true},
    {...base,canDrive:true},
  ];
  for (const fake of cases){
    const client=new GuestAdmissionClient({apiUrl:'https://api.example.com/',vehicleId:1,
      fetchImpl:async()=>({ok:true,json:async()=>fake})});
    await assert.rejects(()=>client.request(),TypeError);
  }
  assert.equal(typeof GuestAdmissionClient.prototype.move,'undefined');
});


test('K-AH: una respuesta de estado con canDrive verdadero nunca concede permiso virtual',async()=>{
  const t=make({request:async()=>reply,status:async()=>({...status('autorizado'),canDrive:true})});
  await t.model.start();await t.model.refresh();
  assert.equal(t.model.state.phase,'unavailable');
  assert.equal(t.model.state.canDrive,false);
  t.model.stop();
});

function cooldownFixture(client) {
  let now = 0, callback = null, delay = null;
  let polling = null;
  const model = new GuestAdmissionService({
    client, nowImpl: () => now,
    setTimeoutImpl: (fn, ms) => { callback = fn; delay = ms; return 901; },
    clearTimeoutImpl: () => { callback = null; },
    setIntervalImpl: fn => { polling = fn; return 902; },
    clearIntervalImpl: () => { polling = null; },
  });
  return {
    model,
    get delay() { return delay; },
    get hasRetry() { return callback !== null; },
    get isPolling() { return polling !== null; },
    async advance(ms) {
      now += ms;
      if (callback) {
        const fn = callback;
        callback = null;
        fn();
        for (let i = 0; i < 12; i++) await Promise.resolve();
      }
    },
  };
}

test('HTTP 429: cliente reconoce Retry-After y mantiene el mismo par K-T', async () => {
  const sent = [];
  const client = new GuestAdmissionClient({
    apiUrl: 'https://api.example.com/', vehicleId: 1,
    fetchImpl: async (_url, opts) => {
      sent.push({ key: opts.headers['Idempotency-Key'], token: opts.headers['X-Browser-Proposal'] });
      if (sent.length === 1) {
        return { ok: false, status: 429, headers: { get: () => '90' } };
      }
      return { ok: true, status: 201, json: async () => ({
        ...reply, browser_secret: opts.headers['X-Browser-Proposal'],
      }) };
    },
  });
  await assert.rejects(() => client.request(),
    e => e instanceof AdmissionRateLimitError && e.retryAfterMs === 90_000);
  const accepted = await client.request();
  assert.equal(accepted.control_fisico, false);
  assert.deepEqual(sent[0], sent[1]);
});

test('HTTP 429: sin Retry-After espera cinco minutos sin repetir cada dos segundos', async () => {
  let count = 0;
  const t = cooldownFixture({
    request: async () => {
      count++;
      if (count === 1) throw new AdmissionRateLimitError();
      return reply;
    },
    status: async () => status('esperando_autorizacion'),
  });
  await t.model.start();
  assert.equal(t.model.state.phase, 'rate_limited');
  assert.equal(t.model.state.canDrive, false);
  assert.equal(t.delay, 300_000);
  assert.equal(t.isPolling, false);
  t.model.pause();
  assert.equal(t.model.state.phase, 'unavailable');
  t.model.resume();
  assert.equal(t.model.state.phase, 'rate_limited');
  await t.advance(240_000);
  assert.equal(count, 1);
  assert.equal(t.delay, 60_000);
  await t.advance(60_000);
  assert.equal(count, 2);
  assert.equal(t.model.state.phase, 'waiting');
  assert.equal(t.model.state.canDrive, false);
  t.model.stop();
});

test('HTTP 429: estado de una sesión se revalida después de la espera y sigue virtual', async () => {
  let count = 0;
  const t = cooldownFixture({
    request: async () => reply,
    status: async () => {
      count++;
      if (count === 1) throw new AdmissionRateLimitError(60_000);
      return status('autorizado');
    },
  });
  await t.model.start();
  await t.model.refresh();
  assert.equal(t.model.state.phase, 'rate_limited');
  assert.equal(t.delay, 60_000);
  assert.equal(t.isPolling, false);
  await t.advance(60_000);
  assert.equal(count, 2);
  assert.equal(t.model.state.phase, 'approved_virtual');
  assert.equal(t.model.state.canDrive, false);
  assert.equal(t.isPolling, true);
  t.model.stop();
});

test('HTTP 429: detener cancela reintentos y no revela control físico', async () => {
  let count = 0;
  const t = cooldownFixture({
    request: async () => { count++; throw new AdmissionRateLimitError(); },
    status: async () => status('autorizado'),
  });
  await t.model.start();
  assert.equal(t.hasRetry, true);
  t.model.stop();
  assert.equal(t.hasRetry, false);
  await t.advance(600_000);
  assert.equal(count, 1);
  assert.deepEqual(t.model.state, { phase: 'inactive', code: '', canDrive: false });
});
