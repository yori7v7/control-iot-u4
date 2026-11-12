import { expect, test } from '@playwright/test';
import axe from 'axe-core';
import { CONFIG } from '../assets/js/config.js';

const APP = '/control-iot-u4/';
const MONITOR = `${APP}#monitoreo`;
const VEHICLE = `/vehiculos/${CONFIG.vehicleId}`;
const STATE = `${VEHICLE}/estado`;
const HISTORY = `${VEHICLE}/historial`;
const WHEN = '2026-11-11T18:01:47';
const FORWARD = 'Avanzar a la derecha';
const REVERSE = 'Retroceder a la izquierda';
const monitor = '#monitor-view';
const command = '#monitor-command';
const rows = '#monitor-history-body tr';

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
  } finally {
    reconciled.resolve();
  }
  await expect(page.locator(rows)).toHaveCount(2);
  await expect(page.locator(rows).first()).toContainText(REVERSE);
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
  fixtures.publish({
    tipo_evento: 'demo_movimiento', id_demo: 21, nombre_demo: 'Ruta de prueba', id_demo_movimiento: 3,
    id_comando: 5, comando: 'RETROCEDER_IZQUIERDA', codigo: 6, timestamp: WHEN, conectado: true,
    orden: 1, duracion_ms: 500, pausa_ms: 150,
  });
  await expect(page.locator(command)).toHaveText(REVERSE);
  await expect(page.locator('#monitor-event')).toContainText(/demostración|demo/i);
  await page.clock.runFor(800);
  await expect.poll(() => fixtures.reads(STATE)).toBeGreaterThan(previousState);
  expect(fixtures.reads(HISTORY)).toBe(previousHistory);
  await expect(page.locator(rows)).toHaveCount(1);
  await expect(page.locator(rows).first()).toContainText(FORWARD);
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
  fixtures.state = savedState('DETENER', 0, 1);
  fixtures.history = [historyEntry(641, 'DETENER', 0), ...fixtures.history];
  fixtures.sockets[0].close({ code: 1011, reason: 'corte de prueba' });
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', /bad|wait/);
  await expect(page.locator('#monitor-realtime')).toContainText(/esperando|reconectando/i);
  await expect(page.locator(rows)).toHaveCount(1);
  await page.clock.runFor(2800);
  await expect.poll(() => fixtures.sockets.length).toBe(2);
  await expect(page.locator('#ws-indicator')).toHaveAttribute('data-tone', 'good');
  await expect(page.locator('#monitor-realtime')).toContainText('en vivo');
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

test.describe('MONITOREO móvil', () => {
  test.use({ isMobile: true, hasTouch: true });

  for (const [width, height] of [[320, 568], [568, 320]]) {
    test(`${width} × ${height} conserva navegación, tabla y controles dentro del ancho`, async ({ page, baseURL }) => {
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
      await expect(page.locator(rows)).toHaveCount(10);
      const dimensions = await page.evaluate(() => {
        const { body, documentElement } = document;
        return {
          viewport: documentElement.clientWidth, document: documentElement.scrollWidth, body: body.scrollWidth,
        };
      });
      expect(dimensions).toEqual({ viewport: width, document: width, body: width });
      if (width === 320) {
        await page.evaluate(axe.source);
        const violations = await page.evaluate(async () => {
          const result = await window.axe.run({ runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
          return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) }));
        });
        expect(violations).toEqual([]);
      }
      await navigate(page, 'Control');
      await expect(page.locator('#stop')).toBeInViewport();
      await expect(page.locator('#joystick')).toBeInViewport();
      expect(fixtures.sockets).toHaveLength(1);
      assertIsolated(fixtures);
    });
  }
});
