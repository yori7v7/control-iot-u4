import { test, expect } from '@playwright/test';

// Reproducción del Chrome 1365 x 768 de Windows: el viewport de la página
// queda cerca de 1365 x 680 después de pestañas y barra de direcciones.
// Sin AWS, sin POST ni WSS físicos.
const sizes = [[1366, 680], [1366, 768], [1280, 650], [1440, 700]];
const required = ['#joystick', '#direction-buttons', '#extra-buttons',
  '#demo-select', '#demo-start', '#demo-cancel', '#demo-detail-toggle'];

for (const [width, height] of sizes) {
  for (const mode of ['offline', 'simulation']) {
    test(`Control 4.2 ${mode}: ${width}x${height} sin scroll vertical, ni controles cortados`, async ({page, baseURL}) => {
      await page.setViewportSize({width, height});
      const origin = new URL(baseURL).origin;
      const javascriptErrors = [];
      page.on('pageerror', e => javascriptErrors.push(e.message));
      await page.route('**/*', route =>
        new URL(route.request().url()).origin === origin && route.request().method() === 'GET'
          ? route.continue() : route.abort());
      await page.routeWebSocket('**/*', ws => ws.close());
      await page.goto('/control-iot-u4/' + (mode === 'simulation' ? '?modo=simulacion' : ''));
      await expect(page.locator('#direction-buttons [data-command]')).toHaveCount(8);
      await expect(page.locator('#extra-buttons [data-command]')).toHaveCount(4);
      if (mode === 'offline') {
        await expect(page.locator('#api-indicator strong')).toHaveText('No disponible');
      }
      await expect(page.locator('#monitor-view')).toBeHidden();
      await expect(page.locator('#control-view')).toBeVisible();
      const report = await page.evaluate((selectors) => {
        const {documentElement: root, body} = document;
        const visible = selectors.map(selector => {
          const node = document.querySelector(selector);
          const r = node?.getBoundingClientRect();
          return {selector, box: r ? {top: r.top, bottom: r.bottom,
            width: r.width, height: r.height} : null};
        });
        return {
          viewport: {width: innerWidth, height: innerHeight},
          root: {clientWidth:root.clientWidth,clientHeight:root.clientHeight,
            scrollWidth:root.scrollWidth,scrollHeight:root.scrollHeight},
          body: {scrollWidth:body.scrollWidth, scrollHeight:body.scrollHeight},
          panels: [...document.querySelectorAll('.main-shell, .dashboard, .drive-panel, .joystick-stage, .right-column, .extra-control')]
            .map(n => ({name: n.className, top: n.getBoundingClientRect().top,
              bottom:n.getBoundingClientRect().bottom})),
          visible,
        };
      },required);
      expect(report.root.scrollWidth, JSON.stringify(report)).toBeLessThanOrEqual(width);
      expect(report.root.scrollHeight, JSON.stringify(report)).toBeLessThanOrEqual(height + 1);
      expect(report.body.scrollHeight, JSON.stringify(report)).toBeLessThanOrEqual(height + 1);
      for (const item of report.visible) {
        expect(item.box, JSON.stringify(report)).not.toBeNull();
        expect(item.box.top, item.selector).toBeGreaterThanOrEqual(-1);
        expect(item.box.bottom,item.selector).toBeLessThanOrEqual(height + 1);
        expect(item.box.width,item.selector).toBeGreaterThan(0);
      }
      expect(javascriptErrors).toEqual([]);
    });
  }
}
