import { expect, test } from '@playwright/test';

const APP = '/control-iot-u4/';
const BASE = 'http://127.0.0.1:8043';
const BUYER = { token: 'buyer_fixture', rol: 'usuario', nombre: 'Ana', vence: '2099-01-01T00:00:00Z' };
const ADMIN = { ...BUYER, token: 'admin_fixture', rol: 'administrador', nombre: 'Operación' };

async function fixtures(page, user, options = {}) {
  const acks = [];
  await page.route(url => url.origin === BASE, async route => {
    const path = new URL(route.request().url()).pathname;
    const methods = route.request().method();
    const origin = route.request().headers().origin || 'http://127.0.0.1:4173';
    const headers = { 'access-control-allow-origin': origin,
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization' };
    if (methods === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (path.startsWith('/plataforma/vehiculos') || path === '/plataforma/dashboard')
      expect(route.request().headers().authorization).toBe(`Bearer ${user.token}`);
    let status = 200;
    let json = null;
    switch (path) {
      case '/':
        json = { status: 'ok', service: 'API', environment: 'development' };
        break;
      case '/health/database':
        json = { status: 'ok', database: 'available' };
        break;
      case '/plataforma/catalogo':
        json = { modelos: [{ id: 3, nombre: 'Montacargas' }], unidades: options.guest ? [
          { vehiculo: 2, modelo: 3, nombre: 'Exhibición', disponible: true },
        ] : [] };
        break;
      case '/plataforma/invitados/2':
        json = user;
        break;
      case '/plataforma/sesion':
        if (methods === 'DELETE') return route.fulfill({ status: 204, headers });
        json = user;
        break;
      case '/plataforma/vehiculos':
        json = [{ id_vehiculo: 2, nombre: 'Mi unidad' }];
        break;
      case '/plataforma/vehiculos/2':
        json = { id_vehiculo: 2, nombre: 'Mi unidad', modelo: null, descripcion: null, microcontrolador: null,
          fecha_registro: null, activo: true };
        break;
      case '/plataforma/vehiculos/2/comandos':
        json = [[0, 'DETENER'], [1, 'AVANZAR'], [64, 'DEMO_ORIGINAL'], [128, 'CLAXON']].map(([codigo, nombre], i) =>
          ({ id_comando: 7 + i, id_vehiculo: 2, nombre, codigo, descripcion: null, activo: true }));
        break;
      case '/plataforma/vehiculos/2/despacho':
        json = options.dispatch ?? { estado: 'inhibido', demo_original: false, demo_original_pendiente: false };
        break;
      case '/plataforma/vehiculos/2/demos':
      case '/plataforma/vehiculos/2/historial':
        json = [];
        break;
      case '/plataforma/vehiculos/2/demos/privadas':
        json = options.demos ?? [];
        break;
      case '/plataforma/vehiculos/2/estado':
        json = null;
        break;
      case '/plataforma/vehiculos/2/ticket':
        acks.push(path);
        await options.waitForTicket?.(acks.length);
        json = { ticket: 'ticket_fixture' };
        status = 201;
        break;
      case '/plataforma/dashboard':
        json = { modelos: 2, unidades: 6, vendidas: 3, exhibicion: 1, clientes: 3, demos: 4 };
        break;
      default:
        status = 404;
        json = { detail: 'Recurso no disponible.' };
    }
    return route.fulfill({ headers, status, contentType: 'application/json', body: JSON.stringify(json) });
  });
  await page.routeWebSocket('**/plataforma/ws/vehiculos/2', socket => {
    options.sockets?.push(socket);
    socket.send(JSON.stringify({ tipo_evento: 'estado_actual', id_vehiculo: 2,
      timestamp: null, estado: null, comando: null, codigo: null }));
  });
  return acks;
}

test('distingue control lógico, DEMO original y claxon sin enviar órdenes', async ({ page }) => {
  const options = {};
  await fixtures(page, BUYER, options);
  await signIn(page);
  const original = page.locator('[data-command="DEMO_ORIGINAL"]');
  const horn = page.locator('[data-command="CLAXON"]');
  await expect(page.locator('#control-mode')).toHaveText('LÓGICO · INHIBIDO');
  await expect(original).toBeDisabled();
  await expect(horn).toBeEnabled();
  options.dispatch = { estado: 'disponible_sin_ack', demo_original: true, demo_original_pendiente: false };
  await expect(original).toBeEnabled();
  options.dispatch.demo_original_pendiente = true;
  await expect(page.locator('#control-mode')).toHaveText('DEMO Q6 · CLAXON');
  await expect(original).toBeDisabled();
  await expect(page.locator('[data-command="AVANZAR"]')).toBeDisabled();
  await expect(horn).toBeEnabled();
});

async function noPageScroll(page) {
  expect(await page.evaluate(() => ({ height: document.documentElement.scrollHeight - innerHeight,
    width: document.documentElement.scrollWidth - innerWidth }))).toEqual({ height: 0, width: 0 });
}

for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [393, 852], [568, 320]]) {
  test(`mantiene Control, Monitoreo y edición acotados a ${width}×${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const pasos = Array.from({ length: 24 }, () => ({ codigo: 128, duracion_ms: 300, pausa_ms: 100 }));
    await fixtures(page, BUYER, { demos: [{ id: 9, nombre: 'Larga', activo: true, pasos }] });
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Control manual' })).toBeVisible();
    await expect(page.locator('#control-mode')).toHaveText('LÓGICO · INHIBIDO');
    await noPageScroll(page);
    await page.evaluate(() => { location.hash = '#monitoreo'; });
    await expect(page.locator('#monitor-view')).toBeVisible();
    await noPageScroll(page);
    await page.getByRole('link', { name: 'Cuenta', exact: true }).click();
    await page.getByRole('button', { name: 'Mis DEMOS' }).click();
    await page.getByRole('combobox', { name: 'DEMO', exact: true }).selectOption('9');
    await page.getByRole('combobox', { name: 'Paso de la secuencia', exact: true }).selectOption('23');
    await expect(page.locator('fieldset.iot-step')).toHaveCount(1);
    await expect(page.getByLabel('Duración (ms)')).toHaveAttribute('max', '300');
    await expect(page.locator('select[name="codigo"] option[value="64"]')).toHaveCount(0);
    await noPageScroll(page);
  });
}

test('catálogo invitado y Administración conservan espacio de trabajo en pantalla pequeña', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await fixtures(page, { ...BUYER, rol: 'invitado' }, { guest: true });
  await page.goto(APP);
  await noPageScroll(page);
  await page.getByRole('button', { name: 'Solicitar demostración' }).click();
  await expect(page.getByRole('heading', { name: 'Control manual' })).toBeVisible();
  await noPageScroll(page);
  await page.unrouteAll({ behavior: 'wait' });
  await fixtures(page, ADMIN);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Administración', exact: true })).toBeVisible();
  await expect(page.getByText('Modelos activos')).toBeVisible();
  await noPageScroll(page);
});

async function signIn(page) {
  await page.goto(APP);
  await page.getByLabel('Correo').fill('persona@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña-de-prueba');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

test('administra en la misma aplicación y usa métricas de la API', async ({ page }) => {
  const sockets = [];
  const tickets = await fixtures(page, ADMIN, { sockets });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Administración', exact: true })).toBeVisible();
  await expect(page.getByText('Modelos activos')).toBeVisible();
  await expect(page.locator('.iot-metrics dd').first()).toHaveText('2');
  const wss = page.locator('#ws-indicator');
  await expect(wss.locator('strong')).toHaveText('No requerido');
  await expect(wss).toHaveAttribute('data-tone', 'idle');
  await expect(page.getByRole('link', { name: 'Control', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Cuenta', exact: true }).click();
  await expect(wss.locator('strong')).toHaveText('No requerido');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Acceso a la plataforma' })).toBeVisible();
  await expect(wss).toHaveAttribute('data-tone', 'idle');
  expect(tickets).toHaveLength(0);
  expect(sockets).toHaveLength(0);
});

test('el indicador WSS distingue vistas sin socket, caída y reconexión', async ({ page }) => {
  await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
  await page.clock.pauseAt(new Date('2030-01-01T00:00:01Z'));
  const sockets = [];
  const retry = Promise.withResolvers();
  const tickets = await fixtures(page, BUYER, {
    sockets, waitForTicket: count => count === 2 ? retry.promise : undefined,
  });
  const wss = page.locator('#ws-indicator');
  await signIn(page);
  await expect(wss.locator('strong')).toHaveText('En línea');
  await expect(wss).toHaveAttribute('data-tone', 'good');

  await page.evaluate(() => { location.hash = '#monitoreo'; });
  await expect(page.locator('#monitor-view')).toBeVisible();
  await expect(wss).toHaveAttribute('data-tone', 'good');
  expect(sockets).toHaveLength(1);
  await sockets[0].close({ code: 1011 });
  await expect(wss.locator('strong')).toHaveText('Desconectado');
  await expect(wss).toHaveAttribute('data-tone', 'bad');

  try {
    await page.clock.runFor(1000);
    await expect(wss.locator('strong')).toHaveText('Reconectando');
    await expect(wss).toHaveAttribute('data-tone', 'wait');
  } finally {
    retry.resolve();
  }
  await expect(wss).toHaveAttribute('data-tone', 'good');
  await page.evaluate(() => { location.hash = '#control'; });
  await expect(page.getByRole('heading', { name: 'Control manual' })).toBeVisible();
  await expect(wss.locator('strong')).toHaveText('En línea');
  expect(sockets).toHaveLength(2);

  await page.getByRole('link', { name: 'Cuenta', exact: true }).click();
  await expect(wss.locator('strong')).toHaveText('No requerido');
  await expect(wss).toHaveAttribute('data-tone', 'idle');
  await page.clock.runFor(3000);
  expect(tickets).toHaveLength(2);
  expect(sockets).toHaveLength(2);
  await page.getByRole('button', { name: 'Abrir Monitoreo' }).click();
  await expect(wss).toHaveAttribute('data-tone', 'good');
  expect(sockets).toHaveLength(3);
});

for (const viewport of [{ width: 393, height: 852 }, { width: 852, height: 393 }]) {
  test(`un comprador usa Control, Monitoreo y el editor en ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const attempts = await fixtures(page, BUYER);
    await signIn(page);
    await expect(page.getByRole('heading', { name: 'Control manual' })).toBeVisible();
    await expect(page.locator('#ws-indicator strong')).toHaveText('En línea');
    await page.evaluate(() => { location.hash = '#monitoreo'; });
    await expect(page.locator('#monitor-view')).toBeVisible();
    expect(attempts.length).toBe(1);
    await page.getByRole('link', { name: 'Cuenta', exact: true }).click();
    await page.getByRole('button', { name: 'Mis DEMOS' }).click();
    await page.getByRole('button', { name: 'Agregar paso' }).click();
    await expect(page.getByText('Duración total 0.6 s')).toBeVisible();
    await page.getByRole('button', { name: 'Quitar paso' }).click();
    await expect(page.getByText('Duración total 0 s')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
