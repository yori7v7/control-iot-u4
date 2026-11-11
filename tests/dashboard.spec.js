import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { CONFIG } from '../js/config.js';

const APP = '/control-iot-u4/';
const SIMULATION = `${APP}?modo=simulacion`;
const KEY = 'playwright-fixture-only';
const INVALID_KEY = 'playwright-invalid-fixture-only';
const VEHICLE = '/vehiculos/1';
const CATALOG = `${VEHICLE}/comandos`;
const DEMO = `${VEHICLE}/demos/21`;
const MOVEMENT = `${VEHICLE}/movimientos`;
const COMMAND_BUTTONS = '#direction-buttons button, #extra-buttons button';
const commandCatalog = [
  [11, 'DETENER', 0, true], [22, 'AVANZAR', 1, true], [44, 'IZQUIERDA', 4, true],
  [66, 'DERECHA', 8, true], [88, 'LUCES', 16, true], [99, 'VELOCIDAD', 32, false],
].map(([id_comando, nombre, codigo, activo]) => ({
  id_comando, id_vehiculo: 1, nombre, codigo, activo, descripcion: null,
}));
const fullCatalog = [
  ...commandCatalog.map(command => ({ ...command, activo: true })),
  ...[
    [302, 'RETROCEDER', 2], [306, 'RETROCEDER_IZQUIERDA', 6],
    [309, 'AVANZAR_DERECHA', 9], [405, 'AVANZAR_IZQUIERDA', 5],
    [410, 'RETROCEDER_DERECHA', 10], [564, 'DEMO_ORIGINAL', 64], [628, 'CLAXON', 128],
  ].map(([id_comando, nombre, codigo]) => ({
    id_comando, id_vehiculo: 1, nombre, codigo, activo: true, descripcion: null,
  })),
];
const step = {
  id_demo_movimiento: 51, orden: 1, id_comando: 22, comando: 'AVANZAR', codigo: 1,
  duracion_ms: 600, pausa_ms: 150,
};

async function interceptBackend(page, { serve = true, catalog = commandCatalog } = {}) {
  const requests = [];
  const posts = [];
  const sockets = [];
  const sentToSocket = [];
  const fixtures = {
    requests, posts, sockets, sentToSocket, catalog, reachable: true,
    apiAvailable: true, rdsAvailable: true, catalogAvailable: true,
    socketAvailable: true, stopStatus: null, publishMovement: true, beforeCatalogResponse: async () => {},
    beforeMovementResponse: async () => {}, beforeDemoStartResponse: async () => {},
    beforeDemoCancelResponse: async () => {},
  };
  let eventNumber = 0;
  function emit(type, data) {
    const id_evento = (++eventNumber).toString(16).padStart(32, '0');
    sockets.at(-1)?.send(JSON.stringify({ id_vehiculo: 1, tipo_evento: type, id_evento, ...data }));
  }
  fixtures.emitDemo = (type, data = {}) => emit(type, {
    id_demo: 21, nombre_demo: 'Circuito de prueba', timestamp: '2026-11-07T10:00:00Z',
    id_demo_movimiento: null, id_comando: null, orden: null, comando: null, codigo: null,
    duracion_ms: null, pausa_ms: null, conectado: null, mensaje: null, ...data,
  });
  fixtures.emitMovement = () => emit('movimiento', fixtures.lastMovement);

  // Fulfill intercepted browser traffic without forwarding any request to AWS.
  await page.routeWebSocket('**/*', socket => {
    sockets.push(socket);
    socket.onMessage(message => sentToSocket.push(message));
    if (!serve || !fixtures.reachable || !fixtures.socketAvailable || socket.url() !== CONFIG.wsUrl) {
      socket.close({ code: 1008, reason: 'Unexpected test connection' });
      return;
    }
    socket.send(JSON.stringify({
      tipo_evento: 'estado_actual', id_vehiculo: 1, comando: null, codigo: null, timestamp: null, estado: null,
    }));
  });
  await page.route(url => url.origin === CONFIG.apiUrl, async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const headers = request.headers();
    requests.push({ method, path, headers });
    if (!serve || !fixtures.reachable) return route.abort();
    const cors = {
      'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, X-API-Key',
    };
    const json = (body, status = 200) => route.fulfill({ json: body, status, headers: cors });
    if (method === 'OPTIONS') return route.fulfill({ status: 200, headers: cors });
    if (method === 'GET') {
      if (path === '/') return fixtures.apiAvailable
        ? json({ status: 'ok', service: 'Playwright fixture', environment: 'production' }) : route.abort();
      if (path === '/health/database') return fixtures.rdsAvailable
        ? json({ status: 'ok', database: 'available' })
        : json({ detail: 'No fue posible completar la comprobación de lectura de la base de datos.' }, 503);
      if (path === VEHICLE) return json({
        id_vehiculo: 1, nombre: 'Vehículo de prueba REST', modelo: null, descripcion: null,
        microcontrolador: null, fecha_registro: null, activo: true,
      });
      if (path === CATALOG) {
        await fixtures.beforeCatalogResponse();
        return fixtures.catalogAvailable ? json(fixtures.catalog) : route.abort();
      }
      if (path === `${VEHICLE}/demos`) return json([{
        id_demo: 21, id_vehiculo: 1, nombre: 'Circuito de prueba', descripcion: null, activo: true,
      }]);
      if (path === `${DEMO}/movimientos`) return json([step]);
    }
    if (method === 'POST') {
      const body = request.postDataJSON();
      const key = headers['x-api-key'];
      posts.push({ path, body, key });
      if (key !== KEY) return json({ detail: `Texto remoto deliberadamente ignorado: ${key}` }, 403);
      if (path === MOVEMENT) {
        const command = fixtures.catalog.find(item => item.id_comando === body?.id_comando && item.activo);
        if (!command) return json({ detail: 'Comando de prueba inexistente' }, 404);
        if (command.nombre === 'DETENER' && fixtures.stopStatus) {
          return json({ detail: 'Fallo de prueba al detener' }, fixtures.stopStatus);
        }
        const timestamp = new Date().toISOString();
        const details = {
          id_comando: command.id_comando, comando: command.nombre, codigo: command.codigo,
          conectado: false, origen: 'API',
        };
        fixtures.lastMovement = { ...details, timestamp };
        if (fixtures.socketAvailable && fixtures.publishMovement) fixtures.emitMovement();
        await fixtures.beforeMovementResponse(command.id_comando);
        return json({ resultado: 'ok', id_vehiculo: 1, fecha_actualizacion: timestamp, ...details });
      }
      if (path === `${DEMO}/ejecutar`) {
        await fixtures.beforeDemoStartResponse();
        return json({ id_vehiculo: 1, id_demo: 21, estado: 'iniciada' }, 202);
      }
      if (path === `${DEMO}/cancelar`) {
        fixtures.emitDemo('demo_cancelada');
        await fixtures.beforeDemoCancelResponse();
        return json({ id_vehiculo: 1, id_demo: 21, estado: 'cancelada' });
      }
    }
    return json({ detail: 'Ruta de prueba inexistente' }, 404);
  });
  return fixtures;
}

async function enableControl(page, key = KEY) {
  await page.locator('#open-session').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/puede activar físicamente/i);
  await dialog.getByLabel('Clave API').fill(key);
  await dialog.getByRole('checkbox').check();
  await dialog.locator('#save-session').click();
  await expect(dialog).toBeHidden();
}

async function expectBlockedCommands(page, buttons = page.locator(COMMAND_BUTTONS), count = 12) {
  const lastCommand = page.locator('#last-command');
  const previousCommand = await lastCommand.textContent();
  await expect(buttons).toHaveCount(count);
  for (const button of await buttons.all()) {
    await expect(button).toBeVisible();
    await expect(button).toBeDisabled();
  }
  // A synthetic event bypasses the browser's native disabled click suppression.
  await buttons.evaluateAll(elements => {
    for (const element of elements) element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await expect(lastCommand).toHaveText(previousCommand);
}

async function assertAccessible(page) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run({ runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
    return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) }));
  });
  expect(violations).toEqual([]);
}

async function assertFitsViewport(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const stop = page.locator('#stop');
  await stop.scrollIntoViewIfNeeded();
  const bounds = await stop.boundingBox();
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  await expect(stop).toBeInViewport();
}

async function startPointer(page) {
  const joystick = page.getByRole('group', { name: 'Joystick del vehículo' });
  await joystick.scrollIntoViewIfNeeded();
  const bounds = await joystick.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const travel = bounds.width * 0.28;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - travel);
  return { x, y, travel };
}

test('los doce botones permanecen bloqueados mientras carga y con un catálogo válido vacío', async ({ page }) => {
  const pending = Promise.withResolvers();
  const fixtures = await interceptBackend(page, { catalog: [] });
  fixtures.beforeCatalogResponse = () => pending.promise;
  try {
    await page.goto(APP);
    await expect.poll(() => fixtures.requests.some(request => request.path === CATALOG)).toBe(true);
    await expect(page.locator('#direction-buttons button')).toHaveCount(8);
    await expect(page.locator('#extra-buttons button')).toHaveCount(4);
    const keys = await page.locator(COMMAND_BUTTONS).evaluateAll(elements =>
      elements.map(element => element.dataset.command).sort());
    expect(keys).toEqual(fullCatalog.map(command => command.nombre).filter(key => key !== 'DETENER').sort());
    await expect(page.locator('#control-mode')).toHaveText(/esperando cat[aá]logo/i);
    await expectBlockedCommands(page);
  } finally {
    pending.resolve();
  }
  await expect(page.locator('#control-mode')).toHaveText(/sin comandos activos/i);
  await expect(page.locator('#notice-detail')).toContainText('DETENER no está activo');
  await enableControl(page);
  await expectBlockedCommands(page);
  await expect(page.locator('#stop')).toBeDisabled();
  expect(fixtures.requests.filter(request => request.method === 'POST')).toEqual([]);
});

test('recupera el catálogo dinámico y bloquea los botones sin conexión, inactivos o ausentes', async ({ page }) => {
  const fixtures = await interceptBackend(page, { catalog: fullCatalog });
  const buttons = page.locator(COMMAND_BUTTONS);
  const enabled = page.locator('#direction-buttons button:enabled, #extra-buttons button:enabled');
  const refresh = page.locator('#refresh');
  const mode = page.locator('#control-mode');
  const api = page.locator('#api-indicator strong');
  const left = page.locator('[data-command="AVANZAR_IZQUIERDA"]');
  fixtures.reachable = false;
  await page.goto(APP);
  await expect(mode).toHaveText(/sin conexi[oó]n/i);
  await expect(buttons).toHaveCount(12);
  await expectBlockedCommands(page);

  fixtures.reachable = true;
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(api).toHaveText('Disponible');
  await expectBlockedCommands(page);
  await enableControl(page);
  await expect(enabled).toHaveCount(12);
  await left.click();
  await expect(page.locator('#last-command')).toHaveText('AVANZAR_IZQUIERDA · ID 405');
  await expect(page.locator('#command-state')).toContainText('HTTP 200');

  fixtures.catalogAvailable = false;
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(api).toHaveText('Disponible');
  await expect(mode).toHaveText(/cat[aá]logo sin verificar/i);
  await expectBlockedCommands(page);

  fixtures.catalogAvailable = true;
  fixtures.catalog = fullCatalog
    .filter(command => !['RETROCEDER_DERECHA', 'VELOCIDAD'].includes(command.nombre))
    .map(command => ['AVANZAR_IZQUIERDA', 'CLAXON'].includes(command.nombre) ? { ...command, activo: false }
      : command.nombre === 'LUCES' ? { ...command, id_comando: 771 } : command);
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(buttons).toHaveCount(12);
  await expect(enabled).toHaveCount(8);
  const unavailable = page.locator('[data-command="AVANZAR_IZQUIERDA"], [data-command="RETROCEDER_DERECHA"], [data-command="VELOCIDAD"], [data-command="CLAXON"]');
  await expectBlockedCommands(page, unavailable, 4);
  await page.locator('[data-command="LUCES"]').click();
  await expect(page.locator('#last-command')).toHaveText('LUCES · ID 771');
  await expect(page.locator('#command-state')).toContainText('HTTP 200');

  fixtures.reachable = false;
  await refresh.click();
  await expect(refresh).toBeEnabled();
  await expect(mode).toHaveText(/sin conexi[oó]n/i);
  await expectBlockedCommands(page);
  expect(fixtures.requests.filter(request => request.method === 'POST')).toHaveLength(2);

  fixtures.reachable = true;
  fixtures.catalog = fullCatalog;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(api).toHaveText('Disponible');
  await expect(enabled).toHaveCount(12);
  await page.locator('#stop').click();
  await expect(page.locator('#last-command')).toHaveText('DETENER · ID 11');
  await expect(page.locator('#command-state')).toContainText('HTTP 200');
  expect(fixtures.posts.map(({ body }) => body.id_comando)).toEqual([405, 771, 11]);
  expect(fixtures.requests.filter(request => request.method === 'POST')).toHaveLength(3);
  expect(fixtures.sentToSocket).toEqual([]);
});

test('carga recursos en el subdirectorio y opera por teclado en simulación sin tráfico a AWS', async ({ page, request }) => {
  const fixtures = await interceptBackend(page, { serve: false });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const redirect = await request.get('/?modo=simulacion', { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  expect(redirect.headers().location).toBe(SIMULATION);
  await page.goto(SIMULATION);
  await expect(page.locator('#simulation-banner')).toBeVisible();
  await expect(page.locator('#vehicle-name')).toContainText('Montacargas de práctica');
  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  const faviconUrl = new URL(href, page.url());
  expect(faviconUrl.pathname).toBe(`${APP}assets/favicon.svg`);
  const favicon = await request.get(faviconUrl.href);
  expect(favicon.headers()['content-type']).toContain('image/svg+xml');
  expect(await favicon.text()).toContain('<svg');
  expect((await request.get(`${APP}tests/dashboard.spec.js`)).status()).toBe(404);

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Saltar a los controles' })).toBeFocused();
  const joystick = page.getByRole('group', { name: 'Joystick del vehículo' });
  await joystick.focus();
  await page.keyboard.down('ArrowUp');
  await expect(page.locator('#last-command')).toHaveText(/avanzar/i);
  await expect(page.locator('#command-state')).toContainText(/HTTP/i);
  await page.keyboard.up('ArrowUp');
  await expect(page.locator('#last-command')).toHaveText(/detener/i);
  await expect(page.locator('#joystick-direction')).toContainText(/neutral/i);
  await assertFitsViewport(page);
  await assertAccessible(page);
  expect(fixtures.requests).toEqual([]);
  expect(fixtures.sockets).toEqual([]);
  expect(errors).toEqual([]);
});

test.describe('móvil táctil', () => {
  test.use({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true });

  test('control táctil, pointercancel y adaptación vertical y horizontal', async ({ page, context }) => {
    await interceptBackend(page, { serve: false });
    await page.goto(SIMULATION);
    const joystick = page.getByRole('group', { name: 'Joystick del vehículo' });
    await expect(joystick).toHaveAttribute('aria-disabled', 'false');
    await assertFitsViewport(page);
    await assertAccessible(page);
    await joystick.scrollIntoViewIfNeeded();
    const bounds = await joystick.boundingBox();
    const x = Math.round(bounds.x + bounds.width / 2);
    const y = Math.round(bounds.y + bounds.height / 2);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: x + Math.round(bounds.width * 0.28), y }],
    });
    await expect(page.locator('#last-command')).toHaveText(/derecha/i);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(page.locator('#last-command')).toHaveText(/detener/i);
    await expect(page.locator('#joystick-direction')).toContainText(/neutral/i);
    await page.setViewportSize({ width: 800, height: 360 });
    await assertFitsViewport(page);
  });
});

test('aplica la clave solo a POST, distingue HTTP y WSS y descarta la credencial al recargar', async ({ page }) => {
  const fixtures = await interceptBackend(page);
  await page.goto(APP);
  await expect(page.locator('#simulation-banner')).toBeHidden();
  await expect(page.locator('#vehicle-name')).toHaveText(/vehículo de prueba REST/i);
  const advance = page.getByRole('button', { name: /^avanzar$/i });
  await expect(advance).toBeDisabled();
  await expect(page.getByRole('button', { name: /^velocidad$/i })).toBeDisabled();
  await page.locator('#open-session').click();
  const dialog = page.getByRole('dialog');
  await assertAccessible(page);
  await dialog.getByLabel('Clave API').fill(INVALID_KEY);
  await dialog.getByRole('button', { name: 'Habilitar', exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Habilitar', exact: true }).click();
  await advance.click();
  await expect(page.locator('#command-state')).toContainText(/rechazó la clave/i);
  await expect(page.locator('body')).not.toContainText(INVALID_KEY);

  await enableControl(page);
  const gate = Promise.withResolvers();
  fixtures.beforeMovementResponse = () => gate.promise;
  try {
    await advance.click();
    await expect(page.locator('#last-event')).toHaveText(/movimiento/i);
    await expect(page.locator('#event-detail')).toContainText(/avanzar/i);
    await expect(page.locator('#command-state')).toHaveText(/solicitud enviada.*esperando respuesta HTTP/i);
  } finally {
    gate.resolve();
  }
  await expect(page.locator('#command-state')).toContainText(/HTTP 200/i);
  await expect(page.locator('#event-correlation')).toContainText(/compatible/i);
  expect(fixtures.posts).toEqual([
    { path: MOVEMENT, body: { id_comando: 22 }, key: INVALID_KEY },
    { path: MOVEMENT, body: { id_comando: 22 }, key: KEY },
  ]);
  expect(fixtures.requests.filter(request => request.method === 'GET').every(request =>
    !Object.hasOwn(request.headers, 'x-api-key'))).toBe(true);
  expect(fixtures.sentToSocket).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);
  await page.reload();
  await expect(advance).toBeDisabled();
  await expect(page.locator('#api-key')).toHaveValue('');
});

test('el joystick deduplica dirección y DETENER reemplaza una orden pendiente', async ({ page }) => {
  const fixtures = await interceptBackend(page);
  await page.goto(APP);
  await enableControl(page);
  const gate = Promise.withResolvers();
  fixtures.beforeMovementResponse = id => id === 22 ? gate.promise : Promise.resolve();
  try {
    const { x, y, travel } = await startPointer(page);
    await expect.poll(() => fixtures.posts.length).toBe(1);
    await page.mouse.move(x, y - travel * 0.9, { steps: 4 });
    await page.mouse.move(x + travel, y);
    await expect(page.locator('#joystick-direction')).toContainText(/derecha/i);
    await page.mouse.up();
    await expect(page.locator('#last-command')).toHaveText(/detener/i);
  } finally {
    gate.resolve();
  }
  await expect(page.locator('#command-state')).toContainText(/HTTP 200/i);
  expect(fixtures.posts.map(post => post.body.id_comando)).toEqual([22, 11]);
  await expect(page.locator('#joystick-direction')).toContainText(/neutral/i);

  const { x, y, travel } = await startPointer(page);
  await expect(page.locator('#command-state')).toContainText(/HTTP 200/i);
  await page.mouse.move(x + travel, y);
  await expect(page.locator('#last-command')).toHaveText(/derecha/i);
  await expect(page.locator('#command-state')).toContainText(/HTTP 200/i);
  await page.mouse.up();
  await expect(page.locator('#last-command')).toHaveText(/detener/i);
  await expect(page.locator('#command-state')).toContainText(/HTTP 200/i);
  expect(fixtures.posts.map(post => post.body.id_comando)).toEqual([22, 11, 22, 66, 11]);
});

test('el joystick envía las ocho direcciones con los IDs del catálogo y se detiene al soltar', async ({ page }) => {
  const sectors = [
    [0, -1, 'AVANZAR', 22, 1], [1, -1, 'AVANZAR_DERECHA', 309, 9],
    [1, 0, 'DERECHA', 66, 8], [1, 1, 'RETROCEDER_DERECHA', 410, 10],
    [0, 1, 'RETROCEDER', 302, 2], [-1, 1, 'RETROCEDER_IZQUIERDA', 306, 6],
    [-1, 0, 'IZQUIERDA', 44, 4], [-1, -1, 'AVANZAR_IZQUIERDA', 405, 5],
  ];
  const extraCommands = sectors.filter(([, , , id]) => id > 100)
    .map(([, , nombre, id_comando, codigo]) => ({
      id_comando, id_vehiculo: 1, nombre, codigo, activo: true, descripcion: null,
    }));
  const fixtures = await interceptBackend(page, { catalog: [...commandCatalog, ...extraCommands] });
  await page.goto(APP);
  await enableControl(page);
  const joystick = page.locator('#joystick');
  await joystick.scrollIntoViewIfNeeded();
  const bounds = await joystick.boundingBox();
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const travel = bounds.width * 0.28;
  const command = page.locator('#last-command');
  const state = page.locator('#command-state');

  await page.mouse.move(x, y);
  await page.mouse.down();
  for (const [dx, dy, name, id, code] of sectors) {
    await page.mouse.move(x + dx * travel, y + dy * travel);
    await expect(joystick).toHaveAttribute('data-direction', name);
    await expect(command).toHaveText(`${name} · ID ${id}`);
    await expect(state).toContainText('HTTP 200');
    await expect(page.locator('#event-detail')).toContainText(`${name} · código ${code}`);
  }
  await page.mouse.up();
  await expect(joystick).toHaveAttribute('data-direction', '');
  await expect(page.locator('#joystick-direction')).toContainText(/neutral/i);
  await expect(command).toHaveText('DETENER · ID 11');
  await expect(state).toContainText('HTTP 200');
  expect(fixtures.posts.map(({ body }) => body.id_comando)).toEqual([...sectors.map(([, , , id]) => id), 11]);
  expect(fixtures.sentToSocket).toEqual([]);
});

test('la simulación muestra iconos para las nuevas diagonales y responde sin contactar AWS', async ({ page, request }) => {
  const fixtures = await interceptBackend(page, { serve: false });
  await page.goto(SIMULATION);
  await expect(page.locator('#simulation-banner')).toBeVisible();
  const sprite = await request.get(`${APP}assets/icons.svg`);
  expect(sprite.ok()).toBe(true);
  const symbols = await sprite.text();

  for (const [label, name, id, code, icon] of [
    ['Avanzar e izquierda', 'AVANZAR_IZQUIERDA', 101, 5, 'diagonal-up-left'],
    ['Retroceder y derecha', 'RETROCEDER_DERECHA', 102, 10, 'diagonal-down-right'],
  ]) {
    const button = page.getByRole('button', { name: label });
    await expect(button.locator('use')).toHaveAttribute('href', `./assets/icons.svg#${icon}`);
    expect(symbols).toContain(`id="${icon}"`);
    await button.click();
    await expect(page.locator('#last-command')).toHaveText(`${name} · ID ${id}`);
    await expect(page.locator('#command-state')).toContainText('HTTP 200');
    await expect(page.locator('#event-detail')).toContainText(`${name} · código ${code}`);
  }
  await page.locator('#stop').click();
  await expect(page.locator('#last-command')).toHaveText('DETENER · ID 1');
  await expect(page.locator('#command-state')).toContainText('HTTP 200');
  expect(fixtures.requests).toEqual([]);
  expect(fixtures.sockets).toEqual([]);
});

test('consulta los pasos, espera eventos DEMO y coordina cancelar antes de DETENER', async ({ page }) => {
  const fixtures = await interceptBackend(page);
  await page.goto(APP);
  await enableControl(page);
  await page.getByLabel('Seleccionar DEMO').selectOption('21');
  await page.locator('#demo-detail-toggle').click();
  await page.getByText(/movimientos programados/i, { exact: false }).first().click();
  await expect(page.locator('#demo-steps-list')).toContainText(/avanzar/i);
  await page.locator('#demo-detail-close').click();
  expect(fixtures.requests.some(request => request.method === 'GET' && request.path === `${DEMO}/movimientos`)).toBe(true);
  const execute = page.getByRole('button', { name: 'Ejecutar', exact: true });
  const demoState = page.locator('#demo-state');
  const demoHttp = page.locator('#demo-http');
  const startGate = Promise.withResolvers();
  fixtures.beforeDemoStartResponse = () => startGate.promise;
  try {
    await execute.click();
    await expect(demoHttp).toContainText(/inicio REST.*solicitud enviada/i);
    await expect(page.getByRole('button', { name: /^avanzar$/i })).toBeDisabled();
    fixtures.emitDemo('demo_inicio');
    await expect(demoState).toContainText(/inicio observado por WSS/i);
    await expect(demoHttp).toContainText(/solicitud enviada/i);
  } finally {
    startGate.resolve();
  }
  await expect(demoHttp).toContainText(/HTTP 202 aceptado/i);
  fixtures.emitDemo('demo_movimiento', { ...step, conectado: false });
  await expect(page.locator('#demo-progress')).toHaveAttribute('value', '1');
  fixtures.emitDemo('demo_fin');
  await expect(demoState).toContainText(/finalización.*WSS/i);
  await execute.click();
  await expect(demoHttp).toContainText(/HTTP 202/i);
  const cancelGate = Promise.withResolvers();
  fixtures.beforeDemoCancelResponse = () => cancelGate.promise;
  try {
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(demoState).toContainText(/cancelación observada por WSS/i);
    await expect(demoHttp).toContainText(/cancelación REST.*solicitud enviada/i);
  } finally {
    cancelGate.resolve();
  }
  await expect(demoHttp).toContainText(/cancelación REST.*HTTP 200 aceptado/i);
  await execute.click();
  await expect(demoHttp).toContainText(/HTTP 202/i);
  await page.getByRole('button', { name: /detener/i }).click();
  await expect(demoState).toContainText(/cancelación/i);
  await expect(page.locator('#command-state')).toContainText(/HTTP 200/i);
  expect(fixtures.posts.map(({ path, body }) => [path, body])).toEqual([
    [`${DEMO}/ejecutar`, null], [`${DEMO}/ejecutar`, null], [`${DEMO}/cancelar`, null],
    [`${DEMO}/ejecutar`, null], [`${DEMO}/cancelar`, null], [MOVEMENT, { id_comando: 11 }],
  ]);
  expect(fixtures.sentToSocket).toEqual([]);
});

test('simulación conserva la DEMO cancelada y actualiza el aviso tras DETENER', async ({ page }) => {
  await page.clock.install();
  await interceptBackend(page, { serve: false });
  await page.goto(SIMULATION);
  await page.getByLabel('Seleccionar DEMO').selectOption('1');
  await page.locator('#demo-start').click();
  const state = page.locator('#demo-state');
  await expect(state).toContainText('Movimiento 1 · AVANZAR');
  await page.locator('#demo-cancel').click();
  await expect(state).toContainText('Usa DETENER para enviar una orden de parada.');
  await page.locator('#stop').click();
  await expect(state).toContainText('Cancelación observada por WSS.');
  await expect(state).toContainText('Movimiento 1 · AVANZAR');
  await expect(state).toContainText('DETENER aceptado por HTTP 200. Evento WSS compatible recibido.');
  await expect(state).not.toContainText('Usa DETENER');
  await page.clock.fastForward(4100);
  await expect(state).toHaveText('Sin DEMO en ejecución.');
  await expect(page.locator('#demo-http')).toBeHidden();
  await expect(page.locator('#demo-progress')).toBeHidden();
  await expect(page.locator('#demo-progress')).toHaveAttribute('value', '0');
  await expect(page.locator('#demo-select')).toHaveValue('1');
  await expect(page.locator('#demo-start')).toBeEnabled();
  await page.locator('#demo-detail-toggle').click();
  await page.getByText('Último resultado', { exact: true }).click();
  const summary = page.locator('#demo-last-result-text');
  await expect(summary).toContainText('Cancelación REST · HTTP 200 aceptado.');
  await expect(summary).toContainText('Cancelación observada por WSS. Movimiento 1 · AVANZAR.');
  await expect(summary).toContainText('DETENER aceptado por HTTP 200. Evento WSS compatible recibido.');
});

test('un DETENER fallido conserva el aviso y un HTTP 200 sin WSS no inventa una coincidencia', async ({ page }) => {
  await page.clock.install();
  const fixtures = await interceptBackend(page);
  await page.goto(APP);
  await enableControl(page);
  await page.getByLabel('Seleccionar DEMO').selectOption('21');
  await page.locator('#demo-start').click();
  await expect(page.locator('#demo-http')).toContainText('HTTP 202');
  fixtures.emitDemo('demo_inicio');
  fixtures.emitDemo('demo_movimiento', { ...step, conectado: false });
  const state = page.locator('#demo-state');
  await expect(state).toContainText('Movimiento 1 · AVANZAR');
  await page.locator('#demo-cancel').click();
  await expect(state).toContainText('Usa DETENER');
  await expect(page.locator('#demo-http')).toContainText('Cancelación REST · HTTP 200');

  fixtures.socketAvailable = false;
  fixtures.sockets.at(-1).close({ code: 1011 });
  await expect(page.locator('#ws-indicator')).toContainText('Reconectando');
  fixtures.stopStatus = 503;
  await page.locator('#stop').click();
  await expect(state).toContainText('DETENER no se confirmó. Usa DETENER');
  await page.clock.fastForward(4100);
  await expect(state).toContainText('DETENER no se confirmó. Usa DETENER');
  await expect(page.locator('#demo-last-result')).toBeHidden();
  fixtures.stopStatus = null;

  const timeoutGate = Promise.withResolvers();
  fixtures.beforeMovementResponse = () => timeoutGate.promise;
  try {
    await page.locator('#stop').click();
    await expect(page.locator('#command-state')).toContainText('Esperando respuesta HTTP.');
    await page.clock.fastForward(CONFIG.requestTimeoutMs + 100);
    await expect(page.locator('#command-state')).toContainText('agotó el tiempo');
    await expect(state).toContainText('DETENER no se confirmó. Usa DETENER');
  } finally {
    timeoutGate.resolve();
  }
  fixtures.beforeMovementResponse = async () => {};
  await page.locator('#stop').click();
  await expect(state).toContainText('DETENER aceptado por HTTP 200.');
  await expect(state).toContainText('Cancelación observada por WSS. Movimiento 1 · AVANZAR.');
  await expect(state).not.toContainText('Evento WSS compatible recibido.');
  await expect(state).not.toContainText('Usa DETENER');
  const requestCount = fixtures.requests.length;
  await page.clock.fastForward(4100);
  await expect(state).toHaveText('Sin DEMO en ejecución.');
  await expect(page.locator('#demo-last-result-text')).toContainText('DETENER aceptado por HTTP 200.');
  await expect(page.locator('#demo-last-result-text')).not.toContainText('Evento WSS compatible recibido.');
  expect(fixtures.requests).toHaveLength(requestCount);

  fixtures.socketAvailable = true;
  await page.clock.fastForward(9000);
  await expect(page.locator('#ws-indicator')).toContainText('En línea');
  await expect(state).toHaveText('Sin DEMO en ejecución.');
});

test('el temporizador anterior no afecta a otra DEMO y el cierre normal conserva su propio resultado', async ({ page }) => {
  await page.clock.install();
  const fixtures = await interceptBackend(page);
  await page.goto(APP);
  await enableControl(page);
  await page.locator('#demo-select').selectOption('21');
  const start = page.locator('#demo-start');
  const state = page.locator('#demo-state');
  await start.click();
  await expect(page.locator('#demo-http')).toContainText('HTTP 202');
  fixtures.emitDemo('demo_inicio');
  await page.locator('#demo-cancel').click();
  await expect(page.locator('#demo-http')).toContainText('Cancelación REST · HTTP 200');
  await page.locator('#stop').click();
  await expect(state).toContainText('DETENER aceptado por HTTP 200.');

  await start.click();
  await expect(page.locator('#demo-http')).toContainText('Inicio REST · HTTP 202');
  fixtures.emitDemo('demo_inicio');
  fixtures.emitDemo('demo_movimiento', { ...step, conectado: false });
  await expect(state).toContainText('Movimiento 1 · AVANZAR');
  await page.clock.fastForward(4100);
  await expect(state).toContainText('Paso observado por WSS. Movimiento 1 · AVANZAR.');
  await expect(page.locator('#demo-progress')).toBeVisible();
  await expect(page.locator('#demo-last-result-text')).toContainText('DETENER aceptado por HTTP 200.');

  fixtures.emitDemo('demo_fin');
  await expect(state).toContainText('Finalización observada por WSS.');
  await page.clock.fastForward(4100);
  await expect(state).toHaveText('Sin DEMO en ejecución.');
  await expect(page.locator('#demo-progress')).toBeHidden();
  await expect(page.locator('#demo-last-result-text')).toContainText('Finalización observada por WSS.');
  await expect(page.locator('#demo-last-result-text')).not.toContainText('DETENER');

  await start.click();
  await expect(page.locator('#demo-http')).toContainText('Inicio REST · HTTP 202');
  fixtures.emitDemo('demo_error');
  await expect(state).toContainText('Error de ejecución observado por WSS.');
  await page.clock.fastForward(4100);
  await expect(state).toContainText('Error de ejecución observado por WSS.');
});

test('un WSS compatible tardío actualiza solo el resumen cuando ya volvió el estado neutral', async ({ page }) => {
  await page.clock.install();
  const fixtures = await interceptBackend(page);
  fixtures.publishMovement = false;
  await page.goto(APP);
  await enableControl(page);
  await page.locator('#demo-select').selectOption('21');
  await page.locator('#demo-start').click();
  await expect(page.locator('#demo-http')).toContainText('HTTP 202');
  fixtures.emitDemo('demo_inicio');
  await page.locator('#demo-cancel').click();
  await expect(page.locator('#demo-http')).toContainText('Cancelación REST · HTTP 200');
  const state = page.locator('#demo-state');
  await page.locator('#stop').click();
  await expect(state).toContainText('DETENER aceptado por HTTP 200.');
  await page.clock.fastForward(4100);
  await expect(state).toHaveText('Sin DEMO en ejecución.');
  fixtures.emitMovement();
  await expect(page.locator('#demo-last-result-text')).toContainText('Evento WSS compatible recibido.');
  await expect(state).toHaveText('Sin DEMO en ejecución.');
  await expect(page.locator('#demo-http')).toBeHidden();
});

test('los tres indicadores se actualizan de forma independiente y se recuperan', async ({ page }) => {
  const fixtures = await interceptBackend(page);
  fixtures.rdsAvailable = false;
  await page.goto(APP);
  const wss = page.locator('#ws-indicator strong');
  const api = page.locator('#api-indicator strong');
  const rds = page.locator('#rds-indicator strong');
  await expect(page.locator('.connection-list > li')).toHaveCount(3);
  await expect(wss).toHaveText('En línea');
  await expect(api).toHaveText('Disponible');
  await expect(rds).toHaveText('No disponible');
  fixtures.sockets.at(-1).close({ code: 1011, reason: 'Cierre de prueba' });
  await expect(wss).toHaveText('Reconectando');
  await expect(api).toHaveText('Disponible');
  await expect(wss).toHaveText('En línea');
  expect(fixtures.sockets).toHaveLength(2);

  const refresh = page.getByRole('button', { name: 'Actualizar conexión y catálogos' });
  fixtures.apiAvailable = false;
  fixtures.rdsAvailable = true;
  await refresh.click();
  await expect(api).toHaveText('No disponible');
  await expect(rds).toHaveText('Disponible');
  await expect(wss).toHaveText('En línea');
  fixtures.apiAvailable = true;
  await refresh.click();
  await expect(api).toHaveText('Disponible');
});
