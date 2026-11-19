import { test as playwright } from '@playwright/test';

export * from '@playwright/test';

export const test = playwright.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(() => { window.__iot43Regression = true; });
    await use(page);
  },
});
