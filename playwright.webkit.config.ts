import { defineConfig, devices } from '@playwright/test';

/**
 * Specs in WebKit, Safari's engine (phase 6 end: the Workshop's copied prompt lost a name typed just before
 * pressing Copy there). Its own ports, beside the main suite (the relay is shared if one is running):
 * `npm run build:e2e && npx playwright test -c playwright.webkit.config.ts m47-workshop m48-submit`.
 * Real Safari, and Safari on a phone, stay under "To check on the Mac" in PROGRESS.
 */
const BASE = '/CityBloom/';
const PORT = 4185;

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results-webkit',
  timeout: 600_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    ...devices['Desktop Safari'],
    baseURL: `http://localhost:${PORT}${BASE}`,
    viewport: { width: 1280, height: 860 },
  },
  webServer: [
    {
      command: `node e2e/serve.mjs dist-e2e ${PORT} ${BASE}`,
      url: `http://localhost:${PORT}${BASE}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command:
        'npx tsx relay/local.ts 8787 --owner-key e2e-owner-key-0123456789 --board-every 1 --test-clock --submit-per-address 40',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
