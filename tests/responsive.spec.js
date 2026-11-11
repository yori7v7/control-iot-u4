import { expect, test } from '@playwright/test';
import axe from 'axe-core';

const APP = '/control-iot-u4/';
const SIMULATION = `${APP}?modo=simulacion`;
const CRITICAL = [
  '#stop', '#direction-buttons [data-command]', '#extra-buttons [data-command]',
  '#demo-select', '#demo-start', '#demo-cancel',
];
const ESSENTIAL = [
  ...CRITICAL, '#joystick', '#refresh', '#ws-indicator', '#api-indicator', '#rds-indicator',
  '#exit-simulation', '#simulation-banner', '#demo-state',
];
const INSPECTORS = ['#activity-toggle', '#demo-detail-toggle', '#vehicle-detail-toggle'];

const viewports = [
  {
    group: 'teléfono vertical', mobile: true,
    sizes: [[320, 568], [360, 640], [375, 667], [390, 844], [414, 896], [430, 932]],
  },
  {
    group: 'teléfono horizontal', mobile: true,
    sizes: [[568, 320], [640, 360], [667, 375], [740, 360], [844, 390], [896, 414], [932, 430]],
  },
  { group: 'tableta', mobile: true, sizes: [[768, 1024], [1024, 768]] },
  { group: 'escritorio', mobile: false, sizes: [[1280, 720], [1366, 768], [1920, 1080]] },
];

async function isolate(page, baseURL) {
  const origin = new URL(baseURL).origin;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin && route.request().method() === 'GET'
    ? route.continue()
    : route.abort());
  await page.routeWebSocket('**/*', socket => socket.close());
  return errors;
}

async function openSimulation(page, baseURL) {
  const errors = await isolate(page, baseURL);
  await page.goto(SIMULATION);
  await expect(page.locator('#simulation-banner')).toBeVisible();
  await expect(page.locator('#direction-buttons [data-command]')).toHaveCount(8);
  await expect(page.locator('#extra-buttons [data-command]')).toHaveCount(4);
  await expect(page.locator('#stop')).toBeEnabled();
  await expect(page.locator('#demo-select')).toBeEnabled();
  return errors;
}

async function auditAccessibility(page) {
  const violations = await page.evaluate(async () => {
    const popovers = [...document.querySelectorAll('.inspector:popover-open')];
    const entrances = popovers.flatMap(popover => popover.getAnimations());
    await Promise.allSettled(entrances.map(animation => animation.finished));
    const result = await window.axe.run({ runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] });
    return result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => node.target) }));
  });
  expect(violations).toEqual([]);
}

async function auditLayout(page, { critical = CRITICAL, essential = ESSENTIAL, optional = INSPECTORS, insets = {} } = {}) {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const diagnostics = await page.evaluate(({ viewport, critical, essential, optional, insets }) => {
    const failures = [];
    const root = document.documentElement;
    const { body } = document;
    const epsilon = 0.75;
    const safe = {
      top: insets.top ?? 0,
      left: insets.left ?? 0,
      bottom: viewport.height - (insets.bottom ?? 0),
      right: viewport.width - (insets.right ?? 0),
    };
    if (root.clientWidth !== viewport.width || root.clientHeight !== viewport.height) {
      failures.push(`Área del documento ${root.clientWidth}×${root.clientHeight}; esperada ${viewport.width}×${viewport.height}`);
    }
    if (root.scrollWidth !== root.clientWidth || root.scrollHeight !== root.clientHeight ||
        body.scrollWidth > root.clientWidth || body.scrollHeight > root.clientHeight) {
      failures.push(`Scroll: raíz ${root.scrollWidth}×${root.scrollHeight}, cuerpo ${body.scrollWidth}×${body.scrollHeight}, área ${root.clientWidth}×${root.clientHeight}`);
    }
    if (window.scrollX || window.scrollY) failures.push(`Desplazamiento actual (${window.scrollX}, ${window.scrollY})`);

    const visibility = { visibilityProperty: true, opacityProperty: true };
    const targets = [...essential, ...optional].flatMap(selector => {
      const matches = [...document.querySelectorAll(selector)];
      const required = essential.includes(selector);
      if (!matches.length && required) failures.push(`No se encontró ${selector}`);
      return matches.filter(element => required || element.checkVisibility(visibility)).map(element => ({
        element, rect: element.getBoundingClientRect(),
        name: element.id ? `#${element.id}` : (element.dataset.command ?? selector),
        critical: critical.some(pattern => element.matches(pattern)),
      }));
    });
    for (const [index, target] of targets.entries()) {
      const { element, rect, name } = target;
      const { left, top, right, bottom, width, height } = rect;
      if (!element.checkVisibility(visibility) || width <= 0 || height <= 0 ||
          left < safe.left - epsilon || top < safe.top - epsilon || right > safe.right + epsilon || bottom > safe.bottom + epsilon) {
        failures.push(`${name} fuera del área visible (${[left, top, right, bottom].map(value => value.toFixed(1)).join(', ')})`);
        continue;
      }
      if (target.critical && (width < 44 - epsilon || height < 44 - epsilon)) {
        failures.push(`${name} mide ${width.toFixed(1)}×${height.toFixed(1)} px, mínimo 44×44`);
      }
      if (element.id === 'joystick' && (width < 100 - epsilon || Math.abs(width - height) > epsilon)) {
        failures.push(`Joystick no circular o insuficiente (${width.toFixed(1)}×${height.toFixed(1)})`);
      }
      if (element.matches('button:not(:disabled), select:not(:disabled), a[href], #joystick:not([aria-disabled="true"])')) {
        for (const [x, y] of [[left + width / 2, top + height / 2], [left + width / 4, top + height * 0.75]]) {
          if (!element.contains(document.elementFromPoint(x, y))) {
            failures.push(`${name} no recibe interacción en (${x.toFixed(1)}, ${y.toFixed(1)})`);
            break;
          }
        }
      }
      for (const other of targets.slice(index + 1)) {
        if (element.contains(other.element) || other.element.contains(element)) continue;
        if (Math.min(right, other.rect.right) - Math.max(left, other.rect.left) > epsilon &&
            Math.min(bottom, other.rect.bottom) - Math.max(top, other.rect.top) > epsilon) {
          failures.push(`${name} se superpone a ${other.name}`);
        }
      }
    }
    return failures;
  }, { viewport, critical, essential, optional, insets });
  expect(diagnostics).toEqual([]);
}

for (const { group, mobile, sizes } of viewports) {
  test.describe(group, () => {
    test.use({ isMobile: mobile, hasTouch: mobile });

    for (const [width, height] of sizes) {
      test(`${width} × ${height} mantiene visibles los controles sin scroll`, async ({ page, baseURL }) => {
        await page.setViewportSize({ width, height });
        const errors = await openSimulation(page, baseURL);
        await auditLayout(page);
        if (width === 320 || height === 320) {
          for (const command of ['AVANZAR_IZQUIERDA', 'RETROCEDER_DERECHA']) {
            await page.locator(`[data-command="${command}"]`).tap();
            await expect(page.locator('#last-command')).toContainText(command);
            await expect(page.locator('#command-state')).toContainText('HTTP 200');
            await auditLayout(page);
          }
          await page.locator('#stop').tap();
          await expect(page.locator('#last-command')).toHaveText('DETENER · ID 1');
          await auditLayout(page);
        }
        expect(errors).toEqual([]);
      });
    }
  });
}

test.describe('Cambios durante la operación', () => {
  test.use({ isMobile: true, hasTouch: true });

  test('rota durante una DEMO y conserva el selector, el progreso y DETENER accesibles', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
    const errors = await openSimulation(page, baseURL);
    await auditLayout(page);
    await page.locator('#demo-select').selectOption('1');
    await expect(page.locator('#demo-start')).toBeEnabled();
    await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500));
    await page.locator('#demo-start').tap();
    await page.clock.runFor(120);
    await expect(page.locator('#demo-progress')).toBeVisible();

    const activeDemo = [...ESSENTIAL, '#demo-http', '#demo-progress'];
    for (const [width, height] of [[320, 568], [568, 320], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await expect(page.locator('#demo-select')).toHaveValue('1');
      await expect(page.locator('#demo-cancel')).toBeEnabled();
      await auditLayout(page, { essential: activeDemo });
    }
    await page.setViewportSize({ width: 568, height: 320 });
    await page.locator('#demo-cancel').tap();
    await page.clock.runFor(120);
    await expect(page.locator('#demo-state')).toContainText(/cancelaci[oó]n/i);
    const pendingStop = [...ESSENTIAL, '#demo-http', '#demo-stop-warning'];
    await auditLayout(page, { essential: pendingStop });

    for (const [width, height] of [[320, 568], [390, 844]]) {
      await page.setViewportSize({ width, height });
      await auditLayout(page, { essential: pendingStop });
    }
    await page.locator('#stop').tap();
    await page.clock.runFor(120);
    await expect(page.locator('#last-command')).toHaveText('DETENER · ID 1');
    await expect(page.locator('#demo-stop-warning')).toBeHidden();
    await auditLayout(page);
    expect(errors).toEqual([]);
  });

  test('respeta las áreas seguras laterales e inferiores en horizontal', async ({ page, baseURL, context }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    const cdp = await context.newCDPSession(page);
    const insets = { left: 44, right: 36, top: 12, bottom: 18 };
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    await openSimulation(page, baseURL);
    await auditLayout(page, { insets });
  });

  test('el formato compacto conserva mensajes largos y permite consultar el detalle', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    const errors = await openSimulation(page, baseURL);
    await page.evaluate(axe.source);
    const messages = {
      vehicle: 'Vehículo montacargas de pruebas de operación remota del laboratorio de sistemas embebidos',
      alert: 'No se pudo actualizar el catálogo de demostraciones. Comprueba la conexión y vuelve a consultar antes de operar el vehículo.',
      command: 'La solicitud agotó el tiempo de espera y no se obtuvo confirmación del servidor. Comprueba los indicadores de conectividad.',
    };
    await page.evaluate(async messages => {
      const { DashboardView } = await import(`${location.pathname}js/ui/DashboardView.js`);
      const view = new DashboardView(document);
      view.setVehicle({ name: messages.vehicle, model: 'HJ2025-1D', active: true }, 1, false);
      view.setNotice(messages.alert, true);
      view.setCommand({ command: { name: 'RETROCEDER_DERECHA', id: 102 }, phase: 'error', message: messages.command });
    }, messages);
    await expect(page.locator('#notice')).toBeVisible();
    await auditLayout(page, { essential: [...ESSENTIAL, '#notice', '#activity-toggle', '#vehicle-detail-toggle'], optional: ['#demo-detail-toggle'] });

    await page.locator('#activity-toggle').tap();
    const activity = page.locator('#activity-pane');
    await expect(activity).toBeVisible();
    await expect(activity.locator('#notice-detail')).toHaveText(messages.alert);
    await expect(activity.locator('#command-state')).toContainText(messages.command);
    await auditLayout(page, { critical: ['#activity-close', '#stop'], essential: ['#activity-close', '#stop'], optional: [] });
    await auditAccessibility(page);
    await page.locator('#activity-close').tap();
    await expect(activity).toBeHidden();

    await page.locator('#vehicle-detail-toggle').tap();
    const vehicle = page.locator('#vehicle-detail');
    await expect(vehicle).toBeVisible();
    await expect(vehicle).toContainText(messages.vehicle);
    await auditLayout(page, { critical: ['#vehicle-detail-close', '#stop'], essential: ['#vehicle-detail-close', '#stop'], optional: [] });
    await page.locator('#vehicle-detail-close').tap();

    await page.locator('#demo-select').selectOption('1');
    await expect(page.locator('#demo-start')).toBeEnabled();
    await auditLayout(page);
    await page.locator('#demo-detail-toggle').tap();
    const demo = page.locator('#demo-detail');
    await expect(demo).toBeVisible();
    const steps = page.locator('#demo-steps');
    if (await steps.evaluate(element => !element.open)) await steps.locator('summary').tap();
    await expect(page.locator('#demo-steps-list li').first()).toBeVisible();
    await expect(page.locator('#demo-steps-list li')).toHaveCount(3);
    await auditLayout(page, { critical: ['#demo-detail-close', '#stop'], essential: ['#demo-detail-close', '#stop'], optional: [] });
    await auditAccessibility(page);
    await page.locator('#demo-detail-close').tap();
    await auditLayout(page);
    await page.setViewportSize({ width: 320, height: 568 });
    const activityButton = page.locator('#activity-toggle');
    await expect(activityButton).toContainText('Error');
    await expect(activityButton.locator('.attention-label')).toBeVisible();
    await auditLayout(page, { essential: [...ESSENTIAL, '#activity-toggle'] });
    await activityButton.tap();
    await expect(activity.locator('#notice-detail')).toHaveText(messages.alert);
    await expect(activity.locator('#command-state')).toContainText(messages.command);
    await auditLayout(page, { critical: ['#activity-close', '#stop'], essential: ['#activity-close', '#stop'], optional: [] });
    expect(errors).toEqual([]);
  });

  test('mantiene una salida accesible del diálogo con un área visible reducida', async ({ page, baseURL, context }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    const insets = { top: 20, bottom: 16 };
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets });
    const errors = await isolate(page, baseURL);
    await page.goto(APP);
    const trigger = page.locator('#open-session');
    const dialog = page.locator('#session-dialog');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(page.locator('#api-key')).toBeFocused();

    // The reduced viewport models a mobile browser reserving space for its keyboard.
    await page.setViewportSize({ width: 390, height: 350 });
    const close = page.locator('#close-session');
    const bounds = await close.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.y).toBeGreaterThanOrEqual(insets.top);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(350 - insets.bottom);
    expect(await close.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
    })).toBe(true);
    await close.tap();
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  });
});

test('respeta movimiento reducido y pasa la revisión automática WCAG 2.1 AA', async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = await openSimulation(page, baseURL);
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
  const longestMotion = await page.locator('#joystick, #joystick-knob, #stop, #demo-start').evaluateAll(elements =>
    Math.max(...elements.flatMap(element => {
      const style = getComputedStyle(element);
      return `${style.animationDuration},${style.transitionDuration}`.split(',').map(duration =>
        Number.parseFloat(duration) * (duration.trim().endsWith('ms') ? 1 : 1000));
    })));
  expect(longestMotion).toBeLessThanOrEqual(10);
  await page.evaluate(axe.source);
  await auditAccessibility(page);
  expect(errors).toEqual([]);
});
