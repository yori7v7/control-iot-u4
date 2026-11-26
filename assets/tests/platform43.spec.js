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
        if (options.failCatalog) {
          options.failCatalog -= 1;
          status = 503;
          json = { detail: 'Catálogo temporalmente no disponible.' };
          break;
        }
        json = options.commands ??
          [[0, 'DETENER'], [1, 'AVANZAR'], [64, 'DEMO_ORIGINAL'], [128, 'CLAXON']].map(([codigo, nombre], i) =>
            ({ id_comando: 7 + i, id_vehiculo: 2, nombre, codigo, descripcion: null, activo: true }));
        break;
      case '/plataforma/vehiculos/2/movimientos': {
        const { id_comando } = route.request().postDataJSON();
        const command = options.commands?.find(row => row.id_comando === id_comando);
        options.sent?.push(id_comando);
        status = command ? 200 : 404;
        json = command ? { resultado: 'ok', id_vehiculo: 2, id_comando, comando: command.nombre,
          codigo: command.codigo, conectado: false, fecha_actualizacion: new Date().toISOString(), origen: 'API' }
          : { detail: 'Recurso no disponible.' };
        break;
      }
      case '/plataforma/modelos':
        json = options.models ?? [];
        break;
      case '/plataforma/modelos/3':
        expect(methods).toBe('PUT');
        options.modelUpdates.push(route.request().postDataJSON());
        if (options.modelError) {
          status = 409;
          json = { detail: options.modelError };
        } else {
          options.models[0] = { ...options.models[0], ...options.modelUpdates.at(-1) };
          json = { id: 3 };
        }
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

test('guarda habilitación sin quitar la capacidad y muestra el rechazo de Administración', async ({ page }) => {
  const options = { modelUpdates: [], models: [{ id: 3, sku: 'HJ2025-1D', nombre: 'Montacargas', activo: true,
    publico: true, capacidades: [
      { codigo: 0, nombre: 'DETENER', habilitada: true, invitado: false },
      { codigo: 2, nombre: 'RETROCEDER', habilitada: true, invitado: true },
    ] }] };
  await fixtures(page, ADMIN, options);
  await signIn(page);
  const section = page.getByRole('combobox', { name: 'Sección', exact: true });
  await section.selectOption('modelos');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByText('Estas casillas se aplican a todas las unidades vendidas de este modelo.', {
    exact: false,
  })).toBeVisible();
  const reverse = page.getByLabel('RETROCEDER', { exact: true });
  const save = page.getByRole('button', { name: 'Actualizar modelo', exact: true });
  await expect(page.getByLabel('DETENER', { exact: true })).toBeDisabled();
  await reverse.uncheck();
  await save.click();
  await expect(page.locator('#platform-status')).toHaveText('Modelo guardado.');
  expect(options.modelUpdates[0].capacidades[1]).toEqual({
    codigo: 2, nombre: 'RETROCEDER', habilitada: false, invitado: true,
  });
  await expect(reverse).not.toBeChecked();
  await expect(page.getByLabel('Invitado · RETROCEDER', { exact: true })).toBeChecked();

  options.modelError = 'Las capacidades del modelo ya tienen referencias.';
  await page.getByText('Editar pertenencia al catálogo', { exact: true }).click();
  await page.getByLabel('Conservar en catálogo · RETROCEDER', { exact: true }).uncheck();
  await save.click();
  await expect(page.locator('#platform-status')).toHaveText(options.modelError);
  await expect(page.locator('#platform-status')).toHaveAttribute('data-error', 'true');
  expect(options.models[0].capacidades[1].habilitada).toBe(false);
  await section.selectOption('dashboard');
  await section.selectOption('modelos');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(reverse).not.toBeChecked();
});

test('el comprador abierto aplica la revocación y rehabilitación a botones, joystick y teclado', async ({ page }) => {
  const commands = [[0, 'DETENER'], [1, 'AVANZAR'], [2, 'RETROCEDER'], [4, 'IZQUIERDA'], [6, 'RETROCEDER_IZQUIERDA'],
    [8, 'DERECHA'], [10, 'RETROCEDER_DERECHA']].map(([codigo, nombre]) =>
    ({ id_comando: 100 + codigo, id_vehiculo: 2, nombre, codigo, descripcion: null, activo: true }));
  const revision = rows => rows.map(row => row.id_comando).join(',');
  const options = { commands, sent: [], dispatch: { estado: 'inhibido', demo_original: false,
    demo_original_pendiente: false, revision_comandos: revision(commands) } };
  await fixtures(page, BUYER, options);
  await signIn(page);
  const reverse = page.locator('[data-command="RETROCEDER"]');
  await expect(reverse).toBeEnabled();
  await expect(page.locator('#control-mode')).toHaveText('LÓGICO · INHIBIDO');
  options.commands = commands.filter(row => ![2, 6, 10].includes(row.codigo));
  options.dispatch.revision_comandos = revision(options.commands);
  await expect(reverse).toBeDisabled();
  await expect(page.locator('[data-command^="RETROCEDER_"]')).toHaveCount(2);
  for (const button of await page.locator('[data-command^="RETROCEDER_"]').all()) await expect(button).toBeDisabled();
  const stick = page.locator('#joystick');
  await stick.focus();
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('ArrowRight');
  await page.keyboard.up('ArrowRight');
  await page.keyboard.up('ArrowDown');
  const bounds = await stick.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.77, bounds.y + bounds.height * 0.83);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
  await expect.poll(() => options.sent.includes(100)).toBe(true);
  expect(options.sent.every(id => id === 100)).toBe(true);
  await page.locator('[data-command="AVANZAR"]').click();
  await expect.poll(() => options.sent.includes(101)).toBe(true);
  options.commands = commands;
  options.failCatalog = 1;
  options.dispatch.revision_comandos = revision(commands);
  await expect(reverse).toBeEnabled({ timeout: 9000 });
  expect(options.failCatalog).toBe(0);
  await reverse.click();
  await expect.poll(() => options.sent.includes(102)).toBe(true);
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
