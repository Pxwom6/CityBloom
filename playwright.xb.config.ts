import { defineConfig, devices } from '@playwright/test';

/**
 * The cross-browser determinism test (M29): the sim alone in a blank page, in Chromium, WebKit and
 * Firefox (`npx playwright install webkit firefox`), compared with Node. No server, no rendering.
 */
export default defineConfig({
  testDir: 'e2e-xb',
  timeout: 600_000,
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list']],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  ],
});
