import { defineConfig } from '@playwright/test';

/**
 * The suite runs against a production-mode build served from a subpath, as GitHub Pages serves it
 * (`npm run build:e2e`; only `--mode test` differs, which adds the `window.__game` test API).
 */
const E2E_BASE = '/Sim-Cities/';
const PORT = 4174;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The long soak and playthrough tests run only with `npm run soak` and `npm run playthrough`.
  grepInvert: process.env.SOAK || process.env.PLAYTHROUGH ? undefined : /@soak|@playthrough/,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}${E2E_BASE}`,
    viewport: { width: 1280, height: 800 },
    launchOptions: {
      args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: `node e2e/serve.mjs dist-e2e ${PORT} ${E2E_BASE}`,
    url: `http://localhost:${PORT}${E2E_BASE}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
