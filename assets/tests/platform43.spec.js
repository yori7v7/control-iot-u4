import { expect, test } from '@playwright/test';

const APP = '/control-iot-u4/';
const BASE = 'http://127.0.0.1:8043';
const BUYER = { token: 'buyer_fixture', rol: 'usuario', nombre: 'Ana', vence: '2099-01-01T00:00:00Z' };
const ADMIN = { ...BUYER, token: 'admin_fixture', rol: 'administrador', nombre: 'Operación' };

async function fixtures(page, user) {
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
        json = { modelos: [{ id: 3, nombre: 'Montacargas' }], unidades: [] };
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
        json = [{ id_comando: 7, id_vehiculo: 2, nombre: 'DETENER', codigo: 0, descripcion: null, activo: true }];
        break;
      case '/plataforma/vehiculos/2/demos':
      case '/plataforma/vehiculos/2/demos/privadas':
      case '/plataforma/vehiculos/2/historial':
        json = [];
        break;
      case '/plataforma/vehiculos/2/estado':
        json = null;
        break;
      case '/plataforma/vehiculos/2/ticket':
        acks.push(path);
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
    socket.send(JSON.stringify({ tipo_evento: 'estado_actual', id_vehiculo: 2,
      timestamp: null, estado: null, comando: null, codigo: null }));
  });
  return acks;
}

async function signIn(page) {
  await page.goto(APP);
  await page.getByLabel('Correo').fill('persona@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('contraseña-de-prueba');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
}

test('administra en la misma aplicación y usa métricas de la API', async ({ page }) => {
  await fixtures(page, ADMIN);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Administración', exact: true })).toBeVisible();
  await expect(page.getByText('Modelos activos')).toBeVisible();
  await expect(page.locator('.iot-metrics dd').first()).toHaveText('2');
  await expect(page.getByRole('link', { name: 'Control', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Cuenta', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Acceso a la plataforma' })).toBeVisible();
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
