/** K-M: prueba E2E del sitio de una sola URL, SIN AWS, WSS o motores.
 * Únicamente este test sustituye config.js en memoria y simula las rutas HTTPS.
 * config.js del repositorio, main y GitHub Pages quedan con flags false.
 */
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const APP = '/control-iot-u4/';
const LAB = 'https://lab.invalid';
const ADMIN_KEY = 'clave-ficticia-km-no-publicar';
const ROOT = '/publico/vehiculos/1/solicitudes';
const ADMIN = '/admin/vehiculos/1/control-publico/solicitudes';
const ACTION_BLOCK = '#direction-buttons button, #extra-buttons button';
const SECRET = 'x'.repeat(43);

function virtual(extra = {}) {
  return { simulado: true, control_fisico: false, ...extra };
}

async function prepareMockedPages(context, origin) {
  const requests = [];
  const unexpected = [];
  const tickets = [];
  let index = 0;
  let active = null;
  let supervised = false;
  const catalog = [
    ['DETENER', 0], ['AVANZAR', 1], ['RETROCEDER', 2], ['IZQUIERDA', 4],
    ['DERECHA', 8], ['AVANZAR_IZQUIERDA', 5], ['AVANZAR_DERECHA', 9],
    ['RETROCEDER_IZQUIERDA', 6], ['RETROCEDER_DERECHA', 10],
    ['LUCES', 16], ['VELOCIDAD', 32], ['DEMO_ORIGINAL', 64], ['CLAXON', 128],
  ].map(([nombre, codigo], i) => ({
    id_comando: i + 1, id_vehiculo: 1, nombre, codigo, activo: true, descripcion: null,
  }));

  // Las peticiones externas no se envían realmente; un dominio reservado
  // recibe respuestas inventadas solo por Playwright.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === origin && route.request().method() === 'GET'
      ? route.continue()
      : (unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`), route.abort());
  });
  await context.routeWebSocket('**/*', socket => {
    socket.close({ code: 1008, reason: 'WSS bloqueado durante pruebas K-M' });
  });
  await context.route(`${LAB}/**`, route => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    const headers = req.headers();
    requests.push({ method, path, headers });
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'X-API-Key, X-Browser-Session, Content-Type',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    };
    const json = (body, status = 200) => route.fulfill({ status, json: body, headers: cors });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

    if (path.startsWith(ADMIN)) {
      if (headers['x-api-key'] !== ADMIN_KEY) return json({ detail: 'Denegado' }, 403);
      if (path === ADMIN && method === 'GET') {
        return json(virtual({
          solicitudes: tickets.filter(row => row.status === 'esperando_autorizacion')
            .map(({ id, code }) => ({ request_id: id, display_code: code, vence_en_seg: 120 })),
          turno_activo: Boolean(active),
        }));
      }
      if (path === ADMIN + '/supervision' && method === 'POST') {
        supervised = true;
        return json(virtual({ supervision: true, vigencia_s: 15 }));
      }
      if (path === ADMIN + '/revocar' && method === 'POST') {
        if (active) active.status = 'revocado_o_caducado';
        active = null;
        supervised = false;
        return json(virtual({ revocado: true }));
      }
      if (path.endsWith('/rechazar') && method === 'POST') {
        const id = path.slice(ADMIN.length + 1, -'/rechazar'.length);
        const ticket = tickets.find(x => x.id === id && x.status === 'esperando_autorizacion');
        if (!ticket) return json({ detail: 'Ticket no vigente' }, 409);
        ticket.status = 'revocado_o_caducado';
        return json(virtual({ rechazada: true }));
      }
      if (path.endsWith('/aprobar') && method === 'POST') {
        const id = path.slice(ADMIN.length + 1, -'/aprobar'.length);
        const ticket = tickets.find(x => x.id === id && x.status === 'esperando_autorizacion');
        const payload = req.postDataJSON();
        if (!ticket || !supervised || active || payload?.modo !== 'timed' || payload?.segundos !== 120) {
          return json({ detail: 'No autorizado' }, 409);
        }
        ticket.status = 'autorizado';
        active = ticket;
        return json(virtual({ aprobada: true }));
      }
      return json({ detail: 'Ruta admin desconocida' }, 404);
    }

    if (path === ROOT && method === 'POST') {
      if (headers['x-api-key'] || headers.authorization) return json({ detail: 'No enviar credenciales' }, 403);
      index++;
      const ticket = {
        id: randomUUID(), code: index.toString(16).toUpperCase().padStart(8, '0'),
        secret: (index.toString(16) + SECRET).slice(0, 43),
        status: 'esperando_autorizacion',
      };
      tickets.push(ticket);
      return json(virtual({
        request_id: ticket.id, browser_secret: ticket.secret,
        display_code: ticket.code, estado: ticket.status,
      }), 201);
    }
    if (path === ROOT + '/estado' && method === 'GET') {
      const ticket = tickets.find(x => x.secret === headers['x-browser-session']);
      return ticket ? json(virtual({ estado: ticket.status, display_code: ticket.code }))
        : json({ detail: 'Sesión no disponible' }, 401);
    }

    if (method === 'GET' && path === '/') {
      return json({ status: 'ok', environment: 'development', service: 'Fixture K-M' });
    }
    if (method === 'GET' && path === '/health/database') {
      return json({ status: 'ok', database: 'available' });
    }
    if (method === 'GET' && path === '/vehiculos/1') {
      return json({
        id_vehiculo: 1, nombre: 'Vehículo de prueba K-M', activo: true,
        modelo: null, descripcion: null, microcontrolador: null, fecha_registro: null,
      });
    }
    if (method === 'GET' && path === '/vehiculos/1/comandos') return json(catalog);
    if (method === 'GET' && path === '/vehiculos/1/demos') return json([]);
    if (method === 'GET' && path === '/vehiculos/1/estado') return json(null);
    if (method === 'GET' && path === '/vehiculos/1/historial') return json([]);
    unexpected.push(`${method} ${path}`);
    return json({ detail: 'Ruta no simulada' }, 404);
  });

  async function load(page) {
    await page.route('**/assets/js/config.js', async route => {
      const response = await route.fetch();
      const original = await response.text();
      const next = original
        .replace("const apiUrl = 'https://100-30-4-62.nip.io';", `const apiUrl = '${LAB}';`)
        .replace('guestAdmissionEnabled: false', 'guestAdmissionEnabled: true')
        .replace('adminApprovalEnabled: false', 'adminApprovalEnabled: true');
      if (next === original || !next.includes(`const apiUrl = '${LAB}';`) ||
          next.includes('guestAdmissionEnabled: false') ||
          next.includes('adminApprovalEnabled: false')) {
        throw new Error('La configuracion K-M ha cambiado; NO activar conexiones externas.');
      }
      await route.fulfill({ response, body: next });
    });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(APP);
    return errors;
  }

  return { requests, unexpected, tickets, load };
}

async function checkNoDrive(page) {
  await expect(page.locator(ACTION_BLOCK)).toHaveCount(12);
  await expect(page.locator(ACTION_BLOCK + ':enabled')).toHaveCount(0);
  await expect(page.locator('#joystick')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#stop')).toBeDisabled();
  await expect(page.locator('#demo-start')).toBeDisabled();
  await expect(page.locator('#demo-cancel')).toBeDisabled();
}

test('K-M: profesor y admin en la MISMA página, autorización virtual y revocación', async ({ context, baseURL }) => {
  test.setTimeout(60_000);
  const lab = await prepareMockedPages(context, new URL(baseURL).origin);
  const guest = await context.newPage();
  const guestErrors = await lab.load(guest);
  await expect(guest.locator('#control-mode')).toHaveText('En espera');
  const code = lab.tickets[0]?.code;
  expect(code).toMatch(/^[0-9A-F]{8}$/);
  await checkNoDrive(guest);

  const admin = await context.newPage();
  const adminErrors = await lab.load(admin);
  await admin.locator('#open-session').click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Clave API').fill(ADMIN_KEY);
  await dialog.locator('#risk-ack').check();
  await dialog.locator('#save-session').click();
  await expect(dialog).toBeHidden();
  await expect(admin.locator('#control-mode')).toContainText('solicitud(es)');
  await admin.locator('#open-public-control').click();
  await expect(admin.locator('#admin-requests')).toBeVisible();
  await expect(admin.getByRole('button', { name: `Autorizar solicitud ${code}` })).toBeVisible();
  await admin.locator('#admin-approval-mode').selectOption('timed');
  await admin.locator('#admin-supervision-start').click();
  await expect(admin.getByRole('button', { name: `Autorizar solicitud ${code}` })).toBeEnabled();
  await admin.getByRole('button', { name: `Autorizar solicitud ${code}` }).click();

  await expect(guest.locator('#control-mode')).toHaveText('Permiso virtual', { timeout: 12_000 });
  await checkNoDrive(guest);
  await checkNoDrive(admin);
  await expect(admin.locator('#admin-revoke-guest')).toBeEnabled();
  await admin.locator('#admin-revoke-guest').click();
  await expect(guest.locator('#control-mode')).toHaveText('Turno revocado', { timeout: 12_000 });
  await checkNoDrive(guest);

  await guest.locator('#open-public-control').click();
  await expect(guest.locator('#public-control-status')).toContainText(/revocado|caducó/i);
  await expect(guest.locator('#public-guest-actions')).toBeHidden();
  const publicRequests = lab.requests.filter(r => r.path.startsWith(ROOT));
  expect(publicRequests.some(r => r.method === 'POST' && r.path === ROOT)).toBe(true);
  expect(publicRequests.every(r => !r.headers['x-api-key'] && !r.headers.authorization)).toBe(true);
  expect(lab.requests.filter(r => r.path.startsWith(ADMIN)).some(r => r.headers['x-api-key'] === ADMIN_KEY)).toBe(true);
  expect(lab.requests.filter(r => r.method === 'POST' &&
    /movimientos|acciones|ejecutar|cancelar|parada/.test(r.path))).toHaveLength(0);
  expect(lab.requests.every(r => !r.path.includes(SECRET))).toBe(true);
  expect(await guest.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  expect(guestErrors).toEqual([]);
  expect(adminErrors).toEqual([]);
  expect(lab.unexpected).toEqual([]);
});

test('K-M: visitante móvil 390 × 844 muestra espera sin scroll horizontal ni controles activos', async ({ context, baseURL }) => {
  const lab = await prepareMockedPages(context, new URL(baseURL).origin);
  const guest = await context.newPage();
  await guest.setViewportSize({ width: 390, height: 844 });
  const errors = await lab.load(guest);
  await expect(guest.locator('#control-mode')).toHaveText('En espera');
  await checkNoDrive(guest);
  expect(await guest.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await expect(guest.locator('#joystick')).toBeInViewport();
  await guest.locator('#open-public-control').click();
  await expect(guest.locator('#public-control-status')).toContainText('Esperando autorización');
  await expect(guest.locator('#public-control-status')).toContainText(lab.tickets[0].code);
  await guest.keyboard.press('Escape');
  await expect(guest.locator('#public-control')).toBeHidden();
  expect(errors).toEqual([]);
  expect(lab.unexpected).toEqual([]);
});
