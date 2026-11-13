/** 5.5-K-U: Chrome REAL -> HTTPS loopback FastAPI K-S/K-T.
 *
 * NO simula respuestas de API: Chrome hace peticiones TCP/TLS al Python
 * efimero en 127.0.0.1:9443. Solo intercepta el HTML y el modulo frontend
 * para representar el origen GitHub Pages SIN consultar Internet.
 * La CA raiz temporal debe estar en el trust store del runner; nunca
 * ignoreHTTPSErrors:true, --ignore-certificate-errors o bypass de CORS.
 *
 * Ejecutar SOLO bajo workflow experimental-frontend-ku.yml.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const PAGES = 'https://yori7v7.github.io';
const API = 'https://ks.localhost:9443';
const ROOT = '/publico/vehiculos/1/solicitudes';
const ADMIN = '/admin/vehiculos/1/control-publico/solicitudes';
const MODULE = '/control-iot-u4/assets/js/services/GuestAdmissionService.js';
const ADMIN_KEY = process.env.KU_ADMIN_TEST_KEY || '';
const HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; connect-src https://ks.localhost:9443; base-uri 'none'; form-action 'none'">
<title>5.5 K-U integración HTTPS CI</title></head><body><main id="laboratorio">K-U HTTPS solo virtual</main></body></html>`;
const JS_MODULE = readFileSync(resolve('assets/js/services/GuestAdmissionService.js'), 'utf8');

test.use({
  ignoreHTTPSErrors: false,
  launchOptions: { args: ['--no-proxy-server'] },
  channel: 'chrome',
});
test.setTimeout(55_000);

async function isolatedPage(context, pageOrigin = PAGES) {
  const page = await context.newPage();
  const requests = [];
  await page.route('**/*', route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.origin === pageOrigin && url.pathname === '/control-iot-u4/') {
      return route.fulfill({
        status: 200, contentType: 'text/html; charset=utf-8', body: HTML,
      });
    }
    if (url.origin === pageOrigin && url.pathname === MODULE) {
      return route.fulfill({
        status: 200, contentType: 'application/javascript; charset=utf-8',
        body: JS_MODULE,
      });
    }
    if (url.origin === API) {
      requests.push({ method: req.method(), path: url.pathname });
      return route.continue(); // Petición REAL por TLS. No mock.
    }
    return route.abort('blockedbyclient'); // Prohibido consultar GitHub/AWS.
  });
  await page.goto(pageOrigin + '/control-iot-u4/');
  return { page, requests };
}

async function adminCall(page, key, path, method = 'GET', body) {
  return page.evaluate(async ({ key, path, method, body, api }) => {
    const headers = { 'X-API-Key': key, Accept: 'application/json' };
    if (body) headers['Content-Type'] = 'application/json';
    const r = await fetch(api + path, {
      method, headers, credentials: 'omit', cache: 'no-store',
      referrerPolicy: 'no-referrer', redirect: 'error',
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, data: await r.json(),
      cors: r.headers.get('access-control-allow-origin'),
      cache: r.headers.get('cache-control'),
    };
  }, { key, path, method, body, api: API });
}

test('K-U: Chrome y cliente frontend real por HTTPS con CORS, idempotencia y revocación virtual', async ({ context }) => {
  expect(ADMIN_KEY.length).toBeGreaterThanOrEqual(32);
  const { page: guest, requests: guestRequests } = await isolatedPage(context);
  const { page: admin, requests: adminRequests } = await isolatedPage(context);

  const created = await guest.evaluate(async ({ api, modulePath }) => {
    const { GuestAdmissionClient } = await import(modulePath);
    const c = new GuestAdmissionClient({ apiUrl: api, vehicleId: 1 });
    globalThis.__kuGuest = c;
    const first = await c.request();
    const repeat = await c.request();
    globalThis.__kuTicket = first;
    const current = await c.status(first.browser_secret);
    return { first: { id: first.request_id, code: first.display_code,
      simulado: first.simulado, control_fisico: first.control_fisico,
      canDrive: first.canDrive, replay: first.idempotent_replay },
      repeat: { id: repeat.request_id, replay: repeat.idempotent_replay,
        canDrive: repeat.canDrive },
      current: { estado: current.estado, canDrive: current.canDrive },
    };
  }, { api: API, modulePath: MODULE });
  expect(created.first.id).toMatch(/^[a-f0-9-]{36}$/);
  expect(created.first.code).toMatch(/^[A-F0-9]{8}$/);
  expect(created.first).toMatchObject({
    simulado: true, control_fisico: false, canDrive: false, replay: false,
  });
  expect(created.repeat).toMatchObject({
    id: created.first.id, replay: true, canDrive: false,
  });
  expect(created.current).toEqual({ estado: 'esperando_autorizacion', canDrive: false });

  const absent = await admin.evaluate(async ({ api, path }) => {
    const r = await fetch(api + path, { credentials: 'omit', cache: 'no-store' });
    return r.status;
  }, { api: API, path: ADMIN });
  expect(absent).toBe(401);
  const wrong = await adminCall(admin, 'clave-incorrecta', ADMIN);
  expect(wrong.status).toBe(403);
  const queue = await adminCall(admin, ADMIN_KEY, ADMIN);
  expect(queue.status).toBe(200);
  expect(queue.data.solicitudes).toHaveLength(1);
  expect(queue.data.solicitudes[0].request_id).toBe(created.first.id);
  expect(queue.data.control_fisico).toBe(false);
  expect(queue.data.canDrive).toBe(false);
  expect(queue.cors).toBe(PAGES);
  expect(queue.cache).toBe('no-store');

  const supervised = await adminCall(admin, ADMIN_KEY, ADMIN + '/supervision', 'POST');
  expect(supervised).toMatchObject({ status: 200, data: { supervision: true, vigencia_s: 15 } });
  const approved = await adminCall(admin, ADMIN_KEY,
    ADMIN + '/' + created.first.id + '/aprobar', 'POST',
    { modo: 'timed', segundos: 120 });
  expect(approved).toMatchObject({ status: 200, data: { aprobada: true,
    simulado: true, control_fisico: false, canDrive: false } });

  const permitted = await guest.evaluate(async () =>
    globalThis.__kuGuest.status(globalThis.__kuTicket.browser_secret));
  expect(permitted.estado).toBe('autorizado');
  expect(permitted.canDrive).toBe(false);
  const revoked = await adminCall(admin, ADMIN_KEY, ADMIN + '/revocar', 'POST');
  expect(revoked).toMatchObject({ status: 200, data: {
    revocado: true, stop_fisico_confirmado: false, canDrive: false } });
  const ended = await guest.evaluate(async () =>
    globalThis.__kuGuest.status(globalThis.__kuTicket.browser_secret));
  expect(ended.estado).toBe('revocado_o_caducado');
  expect(ended.canDrive).toBe(false);

  const all = [...guestRequests, ...adminRequests];
  expect(all.some(r => r.method === 'OPTIONS')).toBe(true); // CORS real
  expect(all.some(r => r.method === 'POST' && r.path === ROOT)).toBe(true);
  expect(all.some(r => /movimientos|acciones|ejecutar|cancelar|parada/.test(r.path))).toBe(false);
  // La sesión vive solo en memoria; no se guardó en storage ni cookie.
  expect(await guest.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie]))
    .toEqual([0, 0, '']);
});

test('K-U: navegador de origen ajeno no puede superar el CORS real', async ({ context }) => {
  const { page: evil } = await isolatedPage(context, 'https://evil.example');
  const outcome = await evil.evaluate(async ({ api, path }) => {
    try {
      await fetch(api + path, { method: 'POST', credentials: 'omit',
        headers: { 'Idempotency-Key': 'a'.repeat(43),
          'X-Browser-Proposal': 'b'.repeat(43) } });
      return 'unexpected_success';
    } catch {
      return 'cors_blocked';
    }
  }, { api: API, path: ROOT });
  expect(outcome).toBe('cors_blocked');
});
