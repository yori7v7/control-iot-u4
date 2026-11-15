/** K-X: DOS ventanas de la PÁGINA COMPLETA -> FastAPI REAL HTTPS + SQLite.
 *
 * Sólo GitHub Actions con dos IP loopback y CA efímera confiable en Chrome.
 * Ningún API mock, interceptación HTTP ni fuente JS inventada.
 * Flags habilitadas EN RAM por el servidor CI, nunca en GitHub Pages.
 * RDS apagada, ESP inexistente, ningún movimiento físico.
 */
import { expect, test } from '@playwright/test';

const PAGES = 'https://yori7v7.github.io/control-iot-u4/';
const API = 'https://100-30-4-62.nip.io';
const VISITOR = '/publico/vehiculos/1/solicitudes';
const ADMIN = '/admin/vehiculos/1/control-publico/solicitudes';
const KEY = process.env.KX_ADMIN_TEST_KEY || '';
const BUTTONS = '#direction-buttons button:enabled, #extra-buttons button:enabled';

test.use({
  ignoreHTTPSErrors: false,
  channel: 'chrome',
  launchOptions: { args: ['--no-proxy-server'] },
});
test.setTimeout(75_000);

async function actualPage(context) {
  const page = await context.newPage();
  const posts = [];
  const transport = [];
  page.on('request', req => {
    const url = new URL(req.url());
    if (url.origin === API) {
      transport.push(req.method() + ' ' + url.pathname);
      if (req.method() === 'POST') posts.push(url.pathname);
    }
  });
  const response = await page.goto(PAGES);
  expect(response?.status()).toBe(200);
  return { page, posts, transport };
}

async function noMotorUI(page) {
  await expect(page.locator('#joystick')).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator(BUTTONS)).toHaveCount(0);
  await expect(page.locator('#stop')).toBeDisabled();
  await expect(page.locator('#demo-start')).toBeDisabled();
  await expect(page.locator('#demo-cancel')).toBeDisabled();
}

test('K-X: página completa profesor solicita -> admin aprueba -> revoca, backend HTTPS real', async ({ context }) => {
  expect(KEY.length).toBeGreaterThanOrEqual(32);
  const guest = await actualPage(context);
  await expect(guest.page.locator('#control-mode')).toHaveText('En espera', { timeout: 25_000 });
  await noMotorUI(guest.page);

  await guest.page.locator('#open-public-control').click();
  const waiting = await guest.page.locator('#public-control-status').innerText();
  expect(waiting).toMatch(/Solicitud [0-9A-F]{8}/);
  const code = waiting.match(/Solicitud ([0-9A-F]{8})/)[1];
  await guest.page.keyboard.press('Escape');

  const admin = await actualPage(context);
  // Solo conservamos destinos (rutas), nunca el valor de la clave administrativa.
  const keyDestinations = [];
  admin.page.on('request', req => {
    if (Object.hasOwn(req.headers(), 'x-api-key')) {
      keyDestinations.push(new URL(req.url()).pathname);
    }
  });
  await admin.page.locator('#open-session').click();
  const dialog = admin.page.getByRole('dialog');
  await dialog.getByLabel('Clave API').fill(KEY);
  await dialog.locator('#risk-ack').check();
  await dialog.locator('#save-session').click();
  await expect(dialog).toBeHidden();
  await admin.page.locator('#open-public-control').click();
  await expect(admin.page.locator('#admin-requests')).toBeVisible();
  const authorize = admin.page.getByRole('button', { name: `Autorizar solicitud ${code}` });
  await expect(authorize).toBeVisible({ timeout: 20_000 });
  await admin.page.locator('#admin-approval-mode').selectOption('timed');
  await admin.page.locator('#admin-supervision-start').click();
  await expect(authorize).toBeEnabled({ timeout: 10_000 });
  await authorize.click();

  await expect(guest.page.locator('#control-mode')).toHaveText('Permiso virtual', { timeout: 15_000 });
  await noMotorUI(guest.page);
  await noMotorUI(admin.page);
  await expect(admin.page.locator('#admin-revoke-guest')).toBeEnabled();
  await admin.page.locator('#admin-revoke-guest').click();
  await expect(guest.page.locator('#control-mode')).toHaveText('Turno revocado', { timeout: 15_000 });
  await noMotorUI(guest.page);

  // La credencial de K-X solo puede salir hacia su API administrativa virtual.
  expect(keyDestinations.length).toBeGreaterThan(0);
  expect(keyDestinations.every(path => path.startsWith(ADMIN))).toBe(true);

  // Demostrar que nunca se usa la ruta histórica de movimientos ni DEMO.
  const allPosts = [...guest.posts, ...admin.posts];
  expect(allPosts).toContain(VISITOR);
  expect(allPosts).toContain(ADMIN + '/supervision');
  expect(allPosts).toContain(ADMIN + '/revocar');
  expect(allPosts.some(path => /movimientos|\/demos\/|\/sesion\/acciones/.test(path))).toBe(false);
  expect(guest.transport.some(path => path.startsWith('GET ' + VISITOR + '/estado'))).toBe(true);
  expect(admin.transport.some(path => path === 'GET ' + ADMIN)).toBe(true);
  expect(await guest.page.evaluate(() => [
    localStorage.length, sessionStorage.length, document.cookie,
  ])).toEqual([0, 0, '']);
});

test('K-X: escritorio y móvil sin miniscroll ni mandos ocultos tras aviso virtual', async ({ context }) => {
  const guest = await context.newPage();
  await guest.setViewportSize({ width: 1365, height: 680 });
  await guest.goto(PAGES);
  await expect(guest.locator('#control-mode')).toHaveText('En espera', { timeout: 25_000 });
  await noMotorUI(guest);
  await expect(guest.locator('.virtual-mode-chip')).toBeVisible();
  for (const [width, height] of [
    [1365, 680], [1280, 720], [1366, 768], [1920, 1080],
    [768, 1024], [390, 844], [320, 568], [844, 390],
  ]) {
    await guest.setViewportSize({ width, height });
    const result = await guest.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      const stop = document.getElementById('stop').getBoundingClientRect();
      const extras = document.getElementById('extra-control')?.getBoundingClientRect()
        ?? document.querySelector('.extra-control').getBoundingClientRect();
      return {
        viewport: [root.clientWidth, root.clientHeight],
        scroll: [root.scrollWidth, root.scrollHeight, body.scrollWidth, body.scrollHeight],
        extrasBottom: extras.bottom,
        stopBottom: stop.bottom,
      };
    });
    expect(result.scroll[0], `scroll horizontal ${width}x${height}`).toBe(result.viewport[0]);
    expect(result.scroll[1], `scroll vertical ${width}x${height}`).toBe(result.viewport[1]);
    expect(result.scroll[2], `body horizontal ${width}x${height}`).toBeLessThanOrEqual(result.viewport[0]);
    expect(result.scroll[3], `body vertical ${width}x${height}`).toBeLessThanOrEqual(result.viewport[1]);
    expect(result.extrasBottom, `auxiliares visibles ${width}x${height}`).toBeLessThanOrEqual(height + 1);
    expect(result.stopBottom, `detener visible ${width}x${height}`).toBeLessThanOrEqual(height + 1);
    await noMotorUI(guest);
  }
});

test('K-X: visitante no puede consultar bandeja sin clave y CORS ajeno cerrado', async ({ request }) => {
  // Este request usa TLS del runner, no ignoreHTTPSErrors ni api mocking.
  const unauthorized = await request.get(API + ADMIN, {
    headers: { Origin: 'https://yori7v7.github.io' },
  });
  expect(unauthorized.status()).toBe(401);
  const differentOrigin = await request.post(API + VISITOR, {
    headers: { Origin: 'https://evil.example' },
    data: '',
  });
  expect(differentOrigin.status()).toBe(403);
});
