import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT ?? 4173);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.js',
  timeout: 25_000,
  reporter: 'list',
  workers: 2,
  use: {
    baseURL,
    channel: 'chrome',
    viewport: { width: 1440, height: 1000 },
  },
  webServer: {
    command: 'npm start',
    url: `${baseURL}/control-iot-u4/`,
    reuseExistingServer: !process.env.CI,
  },
});
