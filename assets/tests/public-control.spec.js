import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const APP = '/control-iot-u4/?modo=turnos';
const PUBLIC = '/publico/vehiculos/1';
const ADMIN = '/admin/vehiculos/1/control-publico';
const KEY = 'stage-53-playwright-fixture';
const TOKEN = 's'.repeat(43);
const DIRECTIONS = '#direction-buttons [data-command]';
const EXTRAS = '#extra-buttons [data-command]';

async function simulateSessions(context, baseURL) {
  const origin = new URL(baseURL).origin;
  const traffic = [];
  const unexpected = [];
  const server = { offset: 3_600_000, failTurnRead: false, beforeMoveResponse: async () => {}, traffic, unexpected };
  const now = () => Date.now() + server.offset;
  const utc = time => new Date(time).toISOString();
  let revision = 0;
  let windowEnd = null;
  let turn = null;
  let lastStop = null;
  const publicStatus = () => ({
    id_vehiculo: 1, habilitado: windowEnd !== null,
    estado: turn ? 'ocupado' : windowEnd ? 'disponible' : 'cerrado',
    vence_ventana_en: windowEnd === null ? null : utc(windowEnd), hora_servidor: utc(now()),
    revision, simulado: true,
  });
  const adminStatus = () => ({
    ...publicStatus(), inicio_ventana_en: windowEnd === null ? null : utc(windowEnd - 1_200_000),
    id_turno_auditoria: turn?.id ?? null, turno_vence_en: turn ? utc(turn.end) : null,
    parada: lastStop, motivo_bloqueo: null,
  });
  const currentTurn = () => ({
    id_vehiculo: 1, estado: 'activo', vence_en: utc(turn.end), vence_inactividad_en: utc(turn.idle),
    hora_servidor: utc(now()), epoca_operacion: turn.epoch, siguiente_secuencia: turn.sequence,
    ultima_operacion: turn.operation, simulado: true,
  });
  const stop = () => {
    if (turn.operation) turn.operation = { ...turn.operation, estado: 'finalizada' };
    return lastStop = {
      id_operacion: randomUUID(), id_vehiculo: 1, epoca_operacion: ++turn.epoch,
      estado: 'verificada', solicitada_en: utc(now()), verificada_en: utc(now()), simulado: true,
    };
  };
  const closeTurn = () => {
    const stopped = stop();
    turn = null;
    revision++;
    return stopped;
  };

  await context.routeWebSocket('**/*', socket => {
    unexpected.push(socket.url());
    socket.close();
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname;
    if (url.origin !== origin) {
      unexpected.push(url.origin);
      return route.abort();
    }
    if (!path.startsWith(PUBLIC) && !path.startsWith(ADMIN)) {
      if (method === 'GET') return route.continue();
      unexpected.push(`${method} ${path}`);
      return route.abort();
    }
    const headers = await request.allHeaders();
    const body = request.postDataJSON();
    traffic.push({ method, path, key: headers['x-api-key'], authorization: headers.authorization, body });
    const reply = (status, json) => route.fulfill({ status, json, headers: { 'Cache-Control': 'no-store' } });
    const reject = (status, codigo) => reply(status, { codigo, detalle: 'Error simulado.' });
    if (turn && now() >= Math.min(turn.end, turn.idle)) closeTurn();
    if (path.startsWith(ADMIN)) {
      if (headers['x-api-key'] !== KEY || headers.authorization) return reject(403, 'credencial_invalida');
      if (method === 'GET' && path === ADMIN) return reply(200, adminStatus());
      if (method === 'PUT' && path === `${ADMIN}/ventana`) {
        windowEnd = now() + 1_200_000;
        revision++;
        return reply(200, adminStatus());
      }
      if (method === 'DELETE' && path === `${ADMIN}/ventana`) {
        if (turn) closeTurn();
        windowEnd = null;
        revision++;
        return reply(200, adminStatus());
      }
      if (method === 'POST' && path === `${ADMIN}/revocacion` && turn) return reply(202, closeTurn());
    }
    if (headers['x-api-key']) return reject(403, 'credenciales_no_permitidas');
    if (method === 'GET' && path === `${PUBLIC}/control`) return reply(200, publicStatus());
    if (method === 'POST' && path === `${PUBLIC}/sesion`) {
      if (turn || !windowEnd) return reject(409, 'turno_ocupado');
      turn = { id: randomUUID(), end: now() + 120_000, idle: now() + 20_000, sequence: 1, epoch: 1, operation: null };
      revision++;
      return reply(201, { ...currentTurn(), token: TOKEN });
    }
    if (!turn || headers.authorization !== `Bearer ${TOKEN}`) return reject(401, 'token_invalido');
    if (path === `${PUBLIC}/sesion` && method === 'GET') {
      return server.failTurnRead ? route.abort() : reply(200, currentTurn());
    }
    if (path === `${PUBLIC}/sesion` && method === 'DELETE') return reply(202, closeTurn());
    if (path === `${PUBLIC}/sesion/parada` && method === 'POST') return reply(202, stop());
    if (path === `${PUBLIC}/sesion/acciones` && method === 'POST') {
      if (body.secuencia !== turn.sequence || body.epoca_operacion !== turn.epoch) return reject(409, 'epoca_invalida');
      const operation = turn.operation = {
        id_operacion: randomUUID(), id_vehiculo: 1, epoca_operacion: turn.epoch, estado: 'aceptada',
        creada_en: utc(now()), simulado: true,
      };
      turn.sequence++;
      turn.idle = now() + 20_000;
      await server.beforeMoveResponse();
      if (turn?.operation === operation) turn.operation = { ...operation, estado: 'finalizada' };
      return reply(202, operation);
    }
    unexpected.push(`${method} ${path}`);
    return reject(404, 'no_encontrado');
  });
  return server;
}

async function openTurns(page) {
  await page.locator('#open-public-control').click();
  await expect(page.locator('#public-control')).toBeVisible();
}

async function closeTurns(page) {
  await page.getByRole('button', { name: 'Cerrar turnos de control' }).click();
}

async function activateWindow(page) {
  await page.goto(APP);
  await page.locator('#open-session').click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Clave API').fill(KEY);
  await dialog.locator('#risk-ack').check();
  await dialog.locator('#save-session').click();
  await openTurns(page);
  await expect(page.locator('#public-control-role')).toHaveText('Administrador');
  const enable = page.locator('#public-open-window');
  await expect(enable).toBeDisabled();
  await page.locator('#public-supervision').check();
  await enable.click();
  await expect(page.locator('#public-window-countdown')).toHaveText(/^(19:\d{2}|20:00)$/);
}

async function takeTurn(page) {
  await page.goto(APP);
  await openTurns(page);
  await page.locator('#public-take').click();
  await expect(page.locator('#public-control-role')).toHaveText('Invitado');
  await expect(page.locator('#public-turn-countdown')).toHaveText(/^0:(19|20)$/);
  await closeTurns(page);
}

test('una ventana autoriza un solo invitado; observador, cesión y revocación se concilian por GET', async ({ page: admin, context, baseURL }) => {
  test.setTimeout(45_000);
  const server = await simulateSessions(context, baseURL);
  await activateWindow(admin);
  const guest = await context.newPage();
  const observer = await context.newPage();
  await takeTurn(guest);
  await observer.goto(APP);
  await openTurns(observer);
  await expect(observer.locator('#public-control-status')).toContainText(/ocupado/i);
  await expect(observer.locator('#public-take')).toBeDisabled();
  await closeTurns(observer);
  await expect(observer.locator(DIRECTIONS)).toHaveCount(8);
  for (const button of await observer.locator(DIRECTIONS).all()) await expect(button).toBeDisabled();
  await observer.locator('.view-links-wide a[data-view="monitoreo"]').click();
  await expect(observer.locator('#monitor-view')).toBeVisible();

  for (const button of await guest.locator(DIRECTIONS).all()) await expect(button).toBeEnabled();
  for (const button of await guest.locator(EXTRAS).all()) await expect(button).toBeDisabled();
  await expect(guest.locator('#demo-start')).toBeDisabled();
  await expect(guest.locator('#demo-cancel')).toBeDisabled();
  await openTurns(guest);
  await guest.locator('#public-release').click();
  await expect(guest.locator('#public-control-role')).toHaveText('Observador');
  await expect(guest.locator('#stop')).toBeDisabled();
  await observer.locator('.view-links-wide a[data-view="control"]').click();
  await openTurns(observer);
  await observer.locator('#public-take').click();
  await expect(observer.locator('#public-control-role')).toHaveText('Invitado');

  await admin.locator('#public-revoke').click();
  await expect(observer.locator('#public-control-role')).toHaveText('Observador');
  await expect(observer.locator('#stop')).toBeDisabled();
  await admin.locator('#public-close-window').click();
  await expect(admin.locator('#public-window-time')).toBeHidden();
  await expect(observer.locator('#public-take')).toBeDisabled();
  const activation = server.traffic.find(entry => entry.method === 'PUT');
  expect(activation.body).toMatchObject({ duracion_seg: 1200, supervision_confirmada: true });
  expect(server.traffic.filter(entry => entry.path.startsWith(ADMIN)).every(entry => entry.key === KEY && !entry.authorization)).toBe(true);
  expect(server.traffic.filter(entry => entry.path.startsWith(PUBLIC)).every(entry => !entry.key)).toBe(true);
  expect(server.unexpected).toEqual([]);
});

test('el joystick invitado prioriza DETENER, concilia errores de red y caduca con la hora del servidor', async ({ page: admin, context, baseURL }) => {
  const server = await simulateSessions(context, baseURL);
  await activateWindow(admin);
  const guest = await context.newPage();
  await takeTurn(guest);
  const movement = Promise.withResolvers();
  server.beforeMoveResponse = () => movement.promise;
  const joystick = guest.locator('#joystick');
  await joystick.focus();
  await guest.keyboard.down('ArrowUp');
  try {
    await expect.poll(() => server.traffic.filter(entry => entry.path.endsWith('/acciones')).length).toBe(1);
    await guest.keyboard.up('ArrowUp');
    await expect.poll(() => server.traffic.filter(entry => entry.path.endsWith('/parada')).length).toBe(1);
    await expect(guest.locator('#command-state')).toContainText('HTTP 202');
    await expect(guest.locator('#last-command')).toContainText(/detener/i);
  } finally {
    movement.resolve();
  }
  const first = server.traffic.find(entry => entry.path.endsWith('/acciones'));
  expect(first.body).toMatchObject({ accion: 'AVANZAR', secuencia: 1, epoca_operacion: 1 });
  expect(first.body.duracion_ms).toBeGreaterThanOrEqual(100);
  expect(first.body.duracion_ms).toBeLessThanOrEqual(500);
  expect(first.authorization).toBe(`Bearer ${TOKEN}`);
  const diagonal = guest.locator('[data-command="RETROCEDER_DERECHA"]');
  await diagonal.click();
  await expect.poll(() => server.traffic.filter(entry => entry.path.endsWith('/acciones')).at(-1)?.body.accion).toBe('RETROCEDER_DERECHA');
  await expect(guest.locator('body')).not.toContainText(TOKEN);
  expect(await guest.evaluate(() => [localStorage.length, sessionStorage.length, document.cookie])).toEqual([0, 0, '']);

  server.failTurnRead = true;
  await guest.locator('#refresh').click();
  await expect(diagonal).toBeDisabled();
  await expect(guest.locator('#stop')).toBeEnabled();
  server.failTurnRead = false;
  await guest.locator('#refresh').click();
  await expect(diagonal).toBeEnabled();
  server.offset += 21_000;
  await guest.locator('#refresh').click();
  await expect(guest.locator('#stop')).toBeDisabled();
  await openTurns(guest);
  await expect(guest.locator('#public-control-role')).toHaveText('Observador');
  await expect(guest.locator('#public-take')).toBeEnabled();
  await guest.locator('#public-take').click();
  await expect(guest.locator('#public-control-role')).toHaveText('Invitado');
  await guest.reload();
  await openTurns(guest);
  await expect(guest.locator('#public-control-role')).toHaveText('Observador');
  await expect(guest.locator('#public-take')).toBeDisabled();
  expect(server.unexpected).toEqual([]);
});
