import { expect, test } from '@playwright/test';

test('invitado conecta Chrome, FastAPI y MySQL aislado con despacho inhibido', async ({ page, request }) => {
  test.skip(process.env.IOT43_LIVE !== '1', 'Requiere python -m scripts.local43 y una unidad de exhibición de prueba.');
  const base = 'http://127.0.0.1:8043';
  const [api, contract, db, catalog] = await Promise.all([
    request.get(base), request.get(base + '/openapi.json'), request.get(base + '/health/database'),
    request.get(base + '/plataforma/catalogo'),
  ]);
  expect((await api.json()).environment).toBe('development');
  expect((await contract.json()).info.version).toBe('4.3.0');
  expect((await db.json()).database).toBe('available');
  expect((await catalog.json()).unidades.some(unit => unit.disponible)).toBe(true);
  await page.goto('/control-iot-u4/');
  await page.getByRole('button', { name: 'Solicitar demostración' }).first().click();
  await expect(page.getByRole('heading', { name: 'Control manual' })).toBeVisible();
  await expect(page.locator('#ws-indicator strong')).toHaveText('En línea');
  await expect(page.locator('#api-indicator strong')).toHaveText('Disponible');
  await expect(page.locator('#rds-indicator strong')).toHaveText('Disponible');
  await expect(page.locator('#platform-time')).toContainText('Exhibición');
  await page.getByRole('button', { name: 'Detener', exact: true }).click();
  await expect(page.locator('#command-state')).toContainText('HTTP 200');
  await page.getByRole('link', { name: 'Cuenta', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('heading', { name: 'Acceso a la plataforma' })).toBeVisible();
});
