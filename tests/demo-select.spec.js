import { devices, expect, test } from '@playwright/test';
import { CONFIG } from '../assets/js/config.js';

const APP = '/control-iot-u4/';
const CATALOG = `${CONFIG.apiUrl}/vehiculos/${CONFIG.vehicleId}/demos`;
const { viewport, deviceScaleFactor, hasTouch, isMobile, userAgent } = devices['Pixel 7'];

async function blockExternalTraffic(page, baseURL) {
  await page.route('**/*', route => new URL(route.request().url()).origin === new URL(baseURL).origin
    ? route.continue()
    : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
}

for (const screen of ['escritorio', 'móvil']) {
  test.describe(screen, () => {
    if (screen === 'móvil') test.use({ viewport, deviceScaleFactor, hasTouch, isMobile, userAgent });

    test('el selector DEMO nativo muestra el placeholder cerrado y permite elegir solo una DEMO del catálogo', async ({ page, baseURL, hasTouch }) => {
      await blockExternalTraffic(page, baseURL);
      await page.goto(`${APP}?modo=simulacion`);

      const select = page.getByRole('combobox', { name: 'Seleccionar DEMO' });
      const placeholder = select.locator('option:checked');
      await expect(select).toBeEnabled();
      await expect(select).toHaveValue('');
      await expect(placeholder).toHaveText('Elige una DEMO');
      await expect(placeholder).toHaveAttribute('hidden', '');
      await expect(placeholder).toBeDisabled();
      await expect(page.locator('#demo-start')).toBeDisabled();

      if (hasTouch) await select.tap();
      else await select.click();
      await expect(page.locator('#demo-select:open')).toHaveCount(1);
      const visibleOptions = await select.evaluate(element => Array.from(element.options)
        .filter(option => getComputedStyle(option).display !== 'none')
        .map(option => option.text));
      expect(visibleOptions).toEqual(['Recorrido de práctica']);

      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      await expect(page.locator('#demo-select:open')).toHaveCount(0);
      await expect(select.locator('option:checked')).toHaveText('Recorrido de práctica');
      await expect(page.locator('#demo-start')).toBeEnabled();
      await expect(page.locator('#demo-steps-list li').first()).toHaveText(/Avanzar/);
    });
  });
}

test('el selector DEMO conserva los mensajes de carga y catálogo vacío', async ({ page, baseURL }) => {
  await blockExternalTraffic(page, baseURL);
  const catalog = Promise.withResolvers();
  await page.route(CATALOG, async route => {
    await catalog.promise;
    await route.fulfill({ json: [], headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  const select = page.getByRole('combobox', { name: 'Seleccionar DEMO' });
  try {
    await page.goto(APP);
    await expect(select).toBeDisabled();
    await expect(select.locator('option:checked')).toHaveText('Consultando catálogo…');
  } finally {
    catalog.resolve();
  }
  await expect(select).toBeDisabled();
  await expect(select.locator('option:checked')).toHaveText('Sin DEMO disponibles');
});
