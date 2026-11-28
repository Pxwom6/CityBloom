import { defineConfig } from '@playwright/test';

/**
 * The suite runs against a production-mode build served from a subpath, as GitHub Pages serves it
 * (`npm run build:e2e`; only `--mode test` differs, which adds the `window.__game` test API).
 */
const E2E_BASE = '/CityBloom/';
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
  webServer: [
    {
      command: `node e2e/serve.mjs dist-e2e ${PORT} ${E2E_BASE}`,
      url: `http://localhost:${PORT}${E2E_BASE}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    // The local relay (M30): online rooms and peer-to-peer signalling, as test builds expect, and the
    // report desk (M41). A friend's
    // atom strike is kept after 20 s of a launch being prepared rather than 20 minutes (M40 step 12).
    {
      // The owner area's key for the tests (M41): the local relay's only; production keeps OWNER_KEY secret.
      command:
        'npx tsx relay/local.ts 8787 --atom-prep 20 --test-matches --owner-key e2e-owner-key-0123456789 --board-every 1 --test-clock --submit-per-address 40',
      url: 'http://127.0.0.1:8787/health',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
