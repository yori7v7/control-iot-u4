import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { CONFIG } from '../js/config.js';
import { viewports } from './viewport-matrix.js';

const APP = '/control-iot-u4/';
const MONITOR = `${APP}#monitoreo`;
const VEHICLE = `/vehiculos/${CONFIG.vehicleId}`;
const STATE = `${VEHICLE}/estado`;
const HISTORY = `${VEHICLE}/historial`;
const PUBLIC_STATUS = `/publico${VEHICLE}/control`;
const WHEN = '2026-11-11T18:01:47';
const FORWARD = 'Avanzar a la derecha';
const REVERSE = 'Retroceder a la izquierda';
const monitor = '#monitor-view';
const command = '#monitor-command';
const demoIndicator = '#monitor-demo';
const rows = '#monitor-history-body tr';
const pager = '#monitor-history-pagination';
const previousPage = '#monitor-history-prev';
const nextPage = '#monitor-history-next';
const pageNumber = '#monitor-history-page';

async function expectMonitoringToFit(page) {
  await expect.poll(() => page.evaluate(() => {
    const { documentElement, body } = document;
    const table = document.querySelector('#monitor-history-table');
    const tableBounds = table.getBoundingClientRect();
    const rowsFit = [...table.querySelectorAll('tr')].every(row => {
      const bounds = row.getBoundingClientRect();
      return bounds.height > 0 && bounds.top >= tableBounds.top && bounds.bottom <= tableBounds.bottom &&
        bounds.left >= 0 && bounds.right <= documentElement.clientWidth && bounds.bottom <= documentElement.clientHeight;
    });
    return {
      document: [documentElement.scrollWidth - documentElement.clientWidth,
        documentElement.scrollHeight - documentElement.clientHeight],
      bodyFits: body.scrollWidth <= documentElement.clientWidth && body.scrollHeight <= documentElement.clientHeight,
      table: [table.scrollWidth - table.clientWidth, table.scrollHeight - table.clientHeight],
      scroll: [window.scrollX, window.scrollY], rowsFit,
    };
  })).toEqual({ document: [0, 0], bodyFits: true, table: [0, 0], scroll: [0, 0], rowsFit: true });
}

async function historyIds(page) {
  return page.locator(rows).evaluateAll(elements => elements.map(row => row.dataset.historyId));
}

function savedState(comando = 'AVANZAR_DERECHA', codigo = 9, id_comando = 7, fecha_actualizacion = WHEN) {
  return {
    id_vehiculo: CONFIG.vehicleId,
    vehiculo: 'Montacargas de prueba',
    id_comando,
    comando,
    codigo,
    conectado: true,
    fecha_actualizacion,
  };
}

function historyEntry(id_historial, comando, codigo, fecha_hora = WHEN, origen = 'API') {
  return { id_historial, id_vehiculo: CONFIG.vehicleId, comando, codigo, fecha_hora, origen };
}

function historyWindow() {
  const commands = [
    ['AVANZAR_DERECHA', 9], ['DETENER', 0], ['RETROCEDER_IZQUIERDA', 6], ['DEMO_ORIGINAL', 64],
    ['LUZ_INTERIOR', 16], ['AVANZAR_IZQUIERDA', 5], ['RETROCEDER_DERECHA', 10], ['AVANZAR', 1],
    ['RETROCEDER', 2], ['DERECHA', 8], ['FUERA_DE_LA_VENTANA', 4], ['DETENER', 0],
  ];
  return commands.map(([name, code], index) => historyEntry(
    640 - index, name, code, index >= 9 ? null : `2026-11-11T18:01:${47 - index}`,
    index === 1 ? 'MANUAL' : 'API',
  ));
}

function demoLifecycle(tipo_evento, timestamp = `${WHEN}Z`) {
  return { tipo_evento, id_demo: 21, nombre_demo: 'Ruta de prueba', timestamp, mensaje: null };
}

function demoMovement() {
  return {
    ...demoLifecycle('demo_movimiento', WHEN), id_demo_movimiento: 3, id_comando: 5,
    comando: 'RETROCEDER_IZQUIERDA', codigo: 6, conectado: true, orden: 1, duracion_ms: 500, pausa_ms: 150,
  };
}

async function intercept(page, baseURL, { state = savedState(), history = [] } = {}) {
  const origin = new URL(baseURL).origin;
  const fixtures = {
    state, history, requests: [], sockets: [], socketWrites: [], unexpected: [],
    brokenAssets: [], loadedAssets: new Set(), errors: [],
    respondState: null, respondHistory: null,
  };
  const catalog = [
    { id_comando: 1, id_vehiculo: CONFIG.vehicleId, nombre: 'DETENER', codigo: 0, activo: true, descripcion: null },
    { id_comando: 7, id_vehiculo: CONFIG.vehicleId, nombre: 'AVANZAR_DERECHA', codigo: 9, activo: true, descripcion: null },
  ];
  const vehicle = {
    id_vehiculo: CONFIG.vehicleId, nombre: 'Montacargas de prueba', modelo: 'RC-4.2',
    descripcion: null, microcontrolador: null, fecha_registro: null, activo: true,
  };
  const headers = { 'access-control-allow-origin': origin };
  let eventCount = 0;

  fixtures.reads = path => fixtures.requests.filter(request => request.path === path).length;
  fixtures.publish = data => {
    const message = {
      id_vehiculo: CONFIG.vehicleId,
      id_evento: (++eventCount).toString(16).padStart(32, '0'),
      ...data,
    };
    fixtures.sockets.at(-1).send(JSON.stringify(message));
    return message;
  };
  page.on('pageerror', error => fixtures.errors.push(error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.origin !== origin) return;
    if (response.status() >= 400) fixtures.brokenAssets.push(url.pathname);
    if (url.pathname.startsWith(`${APP}assets/`)) fixtures.loadedAssets.add(url.pathname);
  });
  await page.routeWebSocket('**/*', socket => {
    if (socket.url() !== CONFIG.wsUrl) {
      fixtures.unexpected.push(socket.url());
      socket.close();
      return;
    }
    fixtures.sockets.push(socket);
    socket.onMessage(message => fixtures.socketWrites.push(message));
    const current = fixtures.state;
    socket.send(JSON.stringify({
      tipo_evento: 'estado_actual',
      id_vehiculo: CONFIG.vehicleId,
      comando: current?.comando ?? null,
      codigo: current?.codigo ?? null,
      timestamp: current?.fecha_actualizacion ?? null,
      estado: current,
    }));
  });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin === origin && method === 'GET') return route.continue();
    if (url.origin !== CONFIG.apiUrl || method !== 'GET') {
      fixtures.unexpected.push(`${method} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    const path = url.pathname;
    fixtures.requests.push({ path, headers: request.headers() });
    const json = (data, status = 200) => route.fulfill({ json: data, status, headers });
    if (path === '/') return json({ status: 'ok', service: 'API de prueba', environment: 'production' });
    if (path === '/health/database') return json({ status: 'ok', database: 'available' });
    if (path === VEHICLE) return json(vehicle);
    if (path === `${VEHICLE}/comandos`) return json(catalog);
    if (path === `${VEHICLE}/demos`) return json([]);
    if (path === PUBLIC_STATUS) return json({
      id_vehiculo: CONFIG.vehicleId, habilitado: false, estado: 'cerrado',
      vence_ventana_en: null, hora_servidor: new Date().toISOString(), revision: 0, simulado: false,
    });
    if (path === STATE) return fixtures.respondState ? fixtures.respondState(json) : json(fixtures.state);
    if (path === HISTORY) return fixtures.respondHistory ? fixtures.respondHistory(json) : json(fixtures.history);
    fixtures.unexpected.push(`GET ${path}`);
    return route.abort();
  });
  return fixtures;
}

function assertIsolated(fixtures) {
  expect(fixtures.unexpected).toEqual([]);
  expect(fixtures.socketWrites).toEqual([]);
  expect(fixtures.errors).toEqual([]);
  expect(fixtures.requests.every(({ headers }) => !headers['x-api-key'] && !headers.authorization)).toBe(true);
}

async function navigate(page, view, { keyboard = false } = {}) {
  const toggle = page.locator('#views-toggle');
  if (await toggle.isVisible()) {
    if (keyboard) {
      await toggle.focus();
      await page.keyboard.press('Enter');
    } else {
      await toggle.click();
    }
  }
  const link = page.getByRole('link', { name: new RegExp(`^${view}$`, 'i') });
  await expect(link).toBeVisible();
  if (keyboard) {
    await link.focus();
    await page.keyboard.press('Enter');
  } else {
    await link.click();
  }
}

test('abre MONITOREO sin clave, limita el historial ordenado a diez y carga assets bajo Pages', async ({ page, request, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: historyWindow() });
  await page.goto(MONITOR);
  await expect(page.locator(monitor)).toBeVisible();
  await expect(page.locator('#monitor-vehicle')).toContainText('Montacargas de prueba');
  await expect(page.locator(command)).toHaveText(FORWARD);
  await expect(page.locator(monitor)).toContainText('18:01:47');
  await expect(page.locator(rows)).toHaveCount(10);
  await expect(page.locator(rows).first()).toContainText(FORWARD);
  await expect(page.locator(rows).nth(1)).toContainText('MANUAL');
  await expect(page.locator(rows).nth(2)).toContainText(REVERSE);
  await expect(page.locator(rows).nth(3)).toContainText('Demostración original');
  await expect(page.locator(rows).last()).toContainText(/sin fecha|—|no informada|no disponible|no registrada/i);
  await expect(page.locator(monitor)).not.toContainText(/AVANZAR_DERECHA|RETROCEDER_IZQUIERDA|DEMO_ORIGINAL|FUERA_DE_LA_VENTANA/);
  await expect(page.locator('#session-dialog')).not.toBeVisible();
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#api-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#rds-indicator')).toHaveAttribute('data-tone', 'good');

  expect([...fixtures.loadedAssets]).toEqual(expect.arrayContaining([
    `${APP}assets/css/app.css`, `${APP}assets/css/vendor/bootstrap.min.css`,
    `${APP}assets/js/app.js`, `${APP}assets/js/ui/sessionViewport.js`,
  ]));
  const favicon = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(new URL(favicon, page.url()).pathname).toBe(`${APP}assets/favicon.svg`);
  const sprites = await page.locator('svg use[href]').evaluateAll(icons =>
    [...new Set(icons.map(icon => new URL(icon.getAttribute('href'), document.baseURI).pathname))]);
  expect(sprites).toEqual([`${APP}assets/icons.svg`]);
  for (const path of [favicon, './assets/icons.svg']) {
    expect((await request.get(new URL(path, page.url()).href)).ok()).toBe(true);
  }
  expect(fixtures.brokenAssets).toEqual([]);

  await navigate(page, 'Control', { keyboard: true });
  await expect(page).toHaveURL(/#control$/i);
  await expect(page.locator('#control-view')).toBeVisible();
  await expect(page.locator(monitor)).not.toBeVisible();
  await expect(page.locator('#joystick')).toBeVisible();
  await expect(page.locator('#stop')).toBeVisible();
  await expect(page.locator('#stop')).toBeDisabled();
  await expect(page.locator('#demo-select')).toBeVisible();
  await page.goBack();
  await expect(page.locator(monitor)).toBeVisible();
  await expect(page.locator(rows)).toHaveCount(10);
  await expect(page.locator(rows).first()).toHaveAttribute('data-history-id', '640');
  await expect(page.locator(rows).last()).toHaveAttribute('data-history-id', '631');
  expect(fixtures.sockets).toHaveLength(1);
  assertIsolated(fixtures);
});

test('distingue estado nulo, historial vacío y pérdida de frescura tras un fallo', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { state: null });
  await page.goto(MONITOR);
  await expect(page.locator('#monitor-state-status')).toContainText(/sin estado/i);
  await expect(page.locator('#monitor-history-status')).toContainText(/sin movimientos|no hay movimientos|historial vacío/i);
  await expect(page.locator(rows)).toHaveCount(0);

  fixtures.state = savedState('DETENER', 0, 1, null);
  fixtures.history = [historyEntry(650, 'DETENER', 0, null)];
  await page.locator('#monitor-refresh').click();
  await expect(page.locator(command)).toHaveText('Detener');
  await expect(page.locator(rows)).toHaveCount(1);
  await expect(page.locator(rows)).toContainText(/sin fecha|—|no informada|no disponible|no registrada/i);

  fixtures.respondHistory = json => json({ detail: 'fallo de prueba' }, 503);
  await page.locator('#monitor-refresh').click();
  await expect(page.locator('#monitor-history-status')).toContainText(/pendiente|no se pudo|desactualizad/i);
  await expect(page.locator(rows)).toHaveCount(1);
  await expect(page.locator(rows)).toContainText('Detener');
  await expect(page.locator(command)).toHaveText('Detener');
  assertIsolated(fixtures);
});

test('un evento externo cambia la tarjeta de inmediato y el historial espera la lectura REST', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: [historyEntry(640, 'AVANZAR_DERECHA', 9)] });
  await page.setViewportSize({ width: 568, height: 320 });
  await page.clock.install();
  await page.goto(MONITOR);
  await expect(page.locator(rows)).toHaveCount(1);
  await expect(page.locator(command)).toHaveText(FORWARD);
  await expect.poll(() => fixtures.sockets.length).toBe(1);
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#monitor-history-status')).toHaveText('1 movimiento registrado');
  await page.clock.runFor(800);

  const waiting = Promise.withResolvers();
  const reconciled = Promise.withResolvers();
  fixtures.respondHistory = async json => {
    waiting.resolve();
    await reconciled.promise;
    return json(fixtures.history);
  };
  fixtures.respondState = async json => {
    await reconciled.promise;
    return json(fixtures.state);
  };
  fixtures.state = savedState('RETROCEDER_IZQUIERDA', 6, 5);
  fixtures.history = [historyEntry(641, 'RETROCEDER_IZQUIERDA', 6), ...fixtures.history];
  const event = fixtures.publish({
    tipo_evento: 'movimiento', id_comando: 5, comando: 'RETROCEDER_IZQUIERDA', codigo: 6,
    timestamp: WHEN, conectado: true, origen: 'API',
  });
  try {
    await expect(page.locator(command)).toHaveText(REVERSE);
    await expect(page.locator(rows)).toHaveCount(1);
    await page.clock.runFor(800);
    await waiting.promise;
    await expect(page.locator(rows)).toHaveCount(1);
    await expectMonitoringToFit(page);
  } finally {
    reconciled.resolve();
  }
  await expect(page.locator(rows)).toHaveCount(2);
  await expect(page.locator(rows).first()).toContainText(REVERSE);
  fixtures.respondState = null;
  fixtures.respondHistory = null;
  await page.clock.runFor(800);
  const before = { state: fixtures.reads(STATE), history: fixtures.reads(HISTORY) };
  fixtures.publish(event);
  fixtures.publish({ ...event, id_evento: '99999999999999999999999999999999', id_vehiculo: CONFIG.vehicleId + 1 });
  await page.clock.runFor(1200);
  expect(fixtures.reads(STATE)).toBe(before.state);
  expect(fixtures.reads(HISTORY)).toBe(before.history);
  await expect(page.locator(rows)).toHaveCount(2);

  const health = fixtures.reads('/');
  await page.clock.fastForward(CONFIG.healthIntervalMs + 1000);
  await expect.poll(() => fixtures.reads('/')).toBeGreaterThan(health);
  expect(fixtures.reads(HISTORY)).toBe(before.history);
  assertIsolated(fixtures);
});

test('un paso de DEMO actualiza el estado sin añadir ni releer filas individuales', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: [historyEntry(640, 'AVANZAR_DERECHA', 9)] });
  await page.clock.install();
  await page.goto(MONITOR);
  await expect(page.locator(rows)).toHaveCount(1);
  await expect.poll(() => fixtures.sockets.length).toBe(1);
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#monitor-history-status')).toHaveText('1 movimiento registrado');
  await page.clock.runFor(800);
  const previousState = fixtures.reads(STATE);
  const previousHistory = fixtures.reads(HISTORY);
  fixtures.state = savedState('RETROCEDER_IZQUIERDA', 6, 5);
  fixtures.publish(demoMovement());
  await expect(page.locator(command)).toHaveText(REVERSE);
  await expect(page.locator('#monitor-event')).toContainText(/demostración|demo/i);
  await expect(page.locator(demoIndicator)).toHaveText(`DEMO programada · Paso observado · ${REVERSE}`);
  await page.clock.runFor(800);
  await expect.poll(() => fixtures.reads(STATE)).toBeGreaterThan(previousState);
  expect(fixtures.reads(HISTORY)).toBe(previousHistory);
  await expect(page.locator(rows)).toHaveCount(1);
  await expect(page.locator(rows).first()).toContainText(FORWARD);
  assertIsolated(fixtures);
});

test('muestra el inicio, paso y desenlaces de DEMO programada al alternar las vistas y se reinicia al recargar', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: [historyEntry(640, 'DEMO_ORIGINAL', 64)] });
  await page.goto(APP);
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  fixtures.publish({
    tipo_evento: 'movimiento', id_comando: 10, comando: 'DEMO_ORIGINAL', codigo: 64,
    timestamp: WHEN, conectado: true, origen: 'API',
  });
  await navigate(page, 'Monitoreo');
  const indicator = page.locator(demoIndicator);
  await expect(indicator).toBeHidden();
  await navigate(page, 'Control');
  fixtures.publish(demoLifecycle('demo_inicio'));
  await navigate(page, 'Monitoreo');
  await expect(indicator).toHaveText('DEMO programada · En ejecución');
  fixtures.publish(demoMovement());
  await expect(indicator).toHaveText(`DEMO programada · En ejecución · ${REVERSE}`);
  await navigate(page, 'Control');
  fixtures.publish(demoLifecycle('demo_fin', '2026-11-11T18:01:48Z'));
  await navigate(page, 'Monitoreo');
  await expect(indicator).toHaveText(`DEMO programada · Finalización observada · ${REVERSE}`);
  fixtures.publish(demoLifecycle('demo_cancelada', '2026-11-11T18:01:49Z'));
  await expect(indicator).toContainText('Cancelación observada');
  fixtures.publish(demoLifecycle('demo_error', '2026-11-11T18:01:50Z'));
  await expect(indicator).toContainText('Error observado');
  await expect(page.locator(rows)).toHaveCount(1);
  await expect(page.locator(rows).first()).toContainText('Demostración original');
  expect(fixtures.sockets).toHaveLength(1);

  await page.reload();
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(indicator).toBeHidden();
  assertIsolated(fixtures);
});

test('relee estado e historial al reconectar WSS y conserva la tabla durante el corte', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: [historyEntry(640, 'AVANZAR_DERECHA', 9)] });
  await page.clock.install();
  await page.goto(MONITOR);
  await expect(page.locator(rows)).toHaveCount(1);
  await expect.poll(() => fixtures.sockets.length).toBe(1);
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#monitor-history-status')).toHaveText('1 movimiento registrado');
  await page.clock.runFor(800);
  const previous = { state: fixtures.reads(STATE), history: fixtures.reads(HISTORY) };
  fixtures.publish(demoLifecycle('demo_inicio'));
  await expect(page.locator(demoIndicator)).toContainText('En ejecución');
  fixtures.state = savedState('DETENER', 0, 1);
  fixtures.history = [historyEntry(641, 'DETENER', 0), ...fixtures.history];
  fixtures.sockets[0].close({ code: 1011, reason: 'corte de prueba' });
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', /bad|wait/);
  await expect(page.locator('#monitor-realtime')).toContainText(/esperando|reconectando/i);
  await expect(page.locator(demoIndicator)).toHaveText('DEMO programada · Estado sin confirmar');
  await expect(page.locator(rows)).toHaveCount(1);
  await page.clock.runFor(2800);
  await expect.poll(() => fixtures.sockets.length).toBe(2);
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#monitor-realtime')).toContainText('en vivo');
  await expect(page.locator(demoIndicator)).toHaveText('DEMO programada · Estado sin confirmar');
  await expect(page.locator(command)).toHaveText('Detener');
  await expect(page.locator(rows)).toHaveCount(2);
  await expect(page.locator(rows).first()).toContainText('Detener');
  expect(fixtures.reads(STATE)).toBeGreaterThan(previous.state);
  expect(fixtures.reads(HISTORY)).toBeGreaterThan(previous.history);
  assertIsolated(fixtures);
});

test('descarta una respuesta de una visita anterior al volver a MONITOREO', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL);
  await page.goto(APP);
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  const initial = page.waitForResponse(response => new URL(response.url()).pathname === STATE && response.ok());
  await navigate(page, 'Monitoreo');
  await (await initial).finished();
  await expect(page.locator(command)).toHaveText(FORWARD);
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const completed = Promise.withResolvers();
  let first = true;
  const previous = fixtures.state;
  fixtures.respondState = async json => {
    if (!first) return json(fixtures.state);
    first = false;
    started.resolve();
    await release.promise;
    try {
      await json(previous);
    } catch {
      // Leaving the view can abort this request before the mock replies.
    } finally {
      completed.resolve();
    }
  };
  try {
    await page.locator('#monitor-refresh').click();
    await started.promise;
    await navigate(page, 'Control');
    await expect(page.locator('#control-view')).toBeVisible();
    fixtures.state = savedState('DETENER', 0, 1);
    await navigate(page, 'Monitoreo');
    await expect(page.locator(command)).toHaveText('Detener');
  } finally {
    release.resolve();
  }
  await completed.promise;
  await expect(page.locator(command)).toHaveText('Detener');
  expect(fixtures.sockets).toHaveLength(1);
  assertIsolated(fixtures);
});

test('la simulación no presenta registros como historial real', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL);
  await page.goto(`${APP}?modo=simulacion#monitoreo`);
  await expect(page.locator(monitor)).toBeVisible();
  await expect(page.locator('#monitor-history-status')).toContainText(/simulación|datos reales|historial real/i);
  await expect(page.locator(rows)).toHaveCount(0);
  expect(fixtures.requests).toEqual([]);
  expect(fixtures.sockets).toEqual([]);
  assertIsolated(fixtures);
});

test('conserva Detener en MONITOREO hasta confirmar la parada de una DEMO cancelada', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL);
  await page.clock.install();
  await page.goto(`${APP}?modo=simulacion#control`);
  const select = page.locator('#demo-select');
  const stop = page.locator('#stop');
  await expect(select).toBeEnabled();
  await select.selectOption('1');
  await expect(page.locator('#demo-start')).toBeEnabled();
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
  await page.locator('#demo-start').click();
  await page.clock.runFor(120);
  await expect(page.locator('#demo-progress')).toBeVisible();
  await page.locator('#demo-cancel').click();
  await page.clock.runFor(120);
  await expect(page.locator('#demo-stop-warning')).toBeVisible();

  await navigate(page, 'Monitoreo');
  await expect(page.locator(monitor)).toBeVisible();
  await expect(page.locator(demoIndicator)).toContainText('Cancelación observada');
  await expect(stop).toBeVisible();
  await expect(stop).toBeEnabled();
  await stop.click();
  await page.clock.runFor(120);
  await expect(page.locator('#last-command')).toHaveText('Detener · ID 1');
  await expect(stop).toBeHidden();
  await navigate(page, 'Control');
  await expect(page.locator('#control-view')).toBeVisible();
  await expect(stop).toBeVisible();
  await expect(page.locator('#demo-stop-warning')).toBeHidden();
  expect(fixtures.requests).toEqual([]);
  expect(fixtures.sockets).toEqual([]);
  assertIsolated(fixtures);
});

for (const { group, mobile, sizes } of viewports) {
  test.describe(`MONITOREO en ${group}`, () => {
    test.use({ isMobile: mobile, hasTouch: mobile });

    for (const [width, height] of sizes) {
      test(`${width} × ${height} permite consultar los diez registros sin scroll`, async ({ page, baseURL }) => {
        const fixtures = await intercept(page, baseURL, { history: historyWindow() });
        await page.setViewportSize({ width, height });
        await page.goto(APP);
        await expect(page.locator('#stop')).toBeInViewport();
        const size = await page.locator('#stop').boundingBox();
        expect(size.width).toBeGreaterThanOrEqual(44);
        expect(size.height).toBeGreaterThanOrEqual(44);

        await navigate(page, 'Monitoreo');
        await expect(page.locator(monitor)).toBeVisible();
        await expect(page.getByRole('table')).toBeVisible();
        await expect(page.getByRole('columnheader').first()).toBeVisible();
        await expect(page.locator(rows).first()).toHaveAttribute('data-history-id', '640');
        await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
        fixtures.publish(demoLifecycle('demo_inicio'));
        fixtures.publish(demoMovement());
        await expect(page.locator(demoIndicator)).toHaveText(`DEMO programada · En ejecución · ${REVERSE}`);
        await expect(page.locator(demoIndicator)).toBeInViewport({ ratio: 1 });
        await expectMonitoringToFit(page);
        if (width === 1920) {
          await expect(page.locator(rows)).toHaveCount(10);
          await expect(page.locator(pager)).toBeHidden();
        }
        if (width === 320 || height === 320) {
          await expect(page.locator(pager)).toBeVisible();
          expect(await page.locator(rows).count()).toBeLessThan(10);
          await expect(page.locator(pageNumber)).toHaveText(/^Página 1 de (?:[2-9]|10)$/);
          for (const selector of [previousPage, nextPage]) {
            const target = await page.locator(selector).boundingBox();
            expect(target.width).toBeGreaterThanOrEqual(44);
            expect(target.height).toBeGreaterThanOrEqual(44);
          }
        }
        if (width === 320) {
          await page.evaluate(axe.source);
          const violations = await page.evaluate(async () => {
            const result = await window.axe.run({ runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
            return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) }));
          });
          expect(violations).toEqual([]);
        }

        const seen = await historyIds(page);
        const next = page.locator(nextPage);
        for (let step = 0; step < 9 && await next.isVisible() && await next.isEnabled(); step++) {
          const first = (await historyIds(page))[0];
          if (mobile) await next.tap();
          else await next.click();
          await expect(page.locator(rows).first()).not.toHaveAttribute('data-history-id', first);
          await expectMonitoringToFit(page);
          seen.push(...await historyIds(page));
        }
        expect(seen).toEqual(historyWindow().slice(0, 10).map(row => String(row.id_historial)));
        if (await page.locator(pager).isVisible()) await expect(next).toBeDisabled();

        await navigate(page, 'Control');
        await expect(page.locator('#stop')).toBeInViewport();
        await expect(page.locator('#joystick')).toBeInViewport();
        expect(fixtures.sockets).toHaveLength(1);
        assertIsolated(fixtures);
      });
    }
  });
}

test('mantiene la página anterior al reconciliar WSS y permite volver a lo más reciente con teclado', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: historyWindow() });
  await page.setViewportSize({ width: 568, height: 320 });
  await page.goto(MONITOR);
  await expect(page.locator(rows).first()).toHaveAttribute('data-history-id', '640');
  const next = page.locator(nextPage);
  await expect(next).toBeEnabled();
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator(pageNumber)).toContainText('Página 2 de');
  await expect(next).toBeFocused();
  await expect.poll(() => fixtures.sockets.length).toBe(1);
  const anchor = (await historyIds(page))[0];

  fixtures.state = savedState('DETENER', 0, 1);
  fixtures.history = [historyEntry(641, 'DETENER', 0), ...fixtures.history];
  fixtures.publish({
    tipo_evento: 'movimiento', id_comando: 1, comando: 'DETENER', codigo: 0,
    timestamp: WHEN, conectado: true, origen: 'API',
  });
  await expect(page.locator(command)).toHaveText('Detener');
  await expect(page.locator('#monitor-history-new')).toBeVisible();
  await expect(page.locator(rows).first()).toHaveAttribute('data-history-id', anchor);
  await expect(next).toBeFocused();
  await expectMonitoringToFit(page);

  const previous = page.locator(previousPage);
  await previous.focus();
  for (let step = 0; step < 9 && await previous.isEnabled(); step++) await page.keyboard.press('Enter');
  await expect(page.locator(pageNumber)).toContainText('Página 1 de');
  await expect(page.locator(rows).first()).toHaveAttribute('data-history-id', '641');
  await expect(page.locator('#monitor-history-new')).toBeHidden();
  assertIsolated(fixtures);
});

test('recalcula las filas al reducir el viewport CSS equivalente al zoom al 200 %', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: historyWindow() });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(MONITOR);
  await expect(page.locator(rows).first()).toHaveAttribute('data-history-id', '640');
  await expectMonitoringToFit(page);
  const initialRows = await page.locator(rows).count();

  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.locator(nextPage)).toBeEnabled();
  await expect.poll(() => page.locator(rows).count()).toBeLessThan(initialRows);
  await expectMonitoringToFit(page);
  await page.locator(nextPage).click();
  await expect(page.locator(pageNumber)).toContainText('Página 2 de');
  await expectMonitoringToFit(page);
  assertIsolated(fixtures);
});

test('mantiene las páginas de MONITOREO dentro de las áreas seguras en horizontal', async ({ page, baseURL, context }) => {
  const fixtures = await intercept(page, baseURL, { history: historyWindow() });
  await page.setViewportSize({ width: 844, height: 390 });
  const cdp = await context.newCDPSession(page);
  const insets = { left: 44, right: 36, top: 12, bottom: 18 };
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
  await page.goto(MONITOR);
  await expect(page.locator(rows).first()).toHaveAttribute('data-history-id', '640');
  await expectMonitoringToFit(page);
  const bounds = await page.locator(monitor).boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(insets.left);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(844 - insets.right);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(390 - insets.bottom);
  await page.locator(nextPage).click();
  await expect(page.locator(pageNumber)).toContainText('Página 2 de');
  await expectMonitoringToFit(page);
  assertIsolated(fixtures);
});

test('permite leer y paginar con desplazamiento de página cuando el alto es extremo', async ({ page, baseURL }) => {
  const fixtures = await intercept(page, baseURL, { history: historyWindow() });
  await page.setViewportSize({ width: 320, height: 200 });
  await page.goto(MONITOR);
  const first = page.locator(rows).first();
  await expect(first).toHaveAttribute('data-history-id', '640');
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#monitor-history-status')).toHaveText('10 movimientos registrados');
  expect(await page.evaluate(() => {
    const root = document.documentElement;
    const table = document.querySelector('#monitor-history-table');
    return root.scrollHeight > root.clientHeight && root.scrollWidth === root.clientWidth &&
      table.scrollHeight === table.clientHeight && table.scrollWidth === table.clientWidth;
  })).toBe(true);
  await page.locator(nextPage).click();
  await expect(first).toHaveAttribute('data-history-id', '639');
  await first.scrollIntoViewIfNeeded();
  await expect(first).toBeInViewport();
  assertIsolated(fixtures);
});
