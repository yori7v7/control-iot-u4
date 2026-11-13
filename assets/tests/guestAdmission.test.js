import test from 'node:test';
import assert from 'node:assert/strict';
import { GuestAdmissionService, GuestAdmissionClient } from '../js/services/GuestAdmissionService.js';

const secret = 'x'.repeat(43);
const reply = { browser_secret: secret, display_code: 'A1B2C3D4', estado: 'esperando_autorizacion' };
const status = estado => ({ estado, display_code: reply.display_code, simulado: true, control_fisico: false });
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
  const c=new GuestAdmissionClient({apiUrl:'https://api.example.com/',vehicleId:1,fetchImpl:async (url,opt)=>{recorded={url,opt};return {ok:true,json:async()=>reply}}});
  await c.request();
  assert.equal(recorded.url,'https://api.example.com/publico/vehiculos/1/solicitudes');
  assert.equal(recorded.opt.credentials,'omit');assert.equal(recorded.opt.method,'POST');
  await c.status(secret);
  assert.equal(recorded.opt.headers['X-Browser-Session'],secret);
  assert.ok(!recorded.url.includes(secret));
});
