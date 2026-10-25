import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// SpiderMonkey's shell, if fetched (`sh scripts/dev/jsshell.sh`), checks Firefox's engine where
// Playwright's Firefox won't launch (macOS 27). XB_FIREFOX=0 leaves the Firefox browser out.
if (!process.env.JS_SHELL && existsSync('.cache/jsshell/js')) process.env.JS_SHELL = '.cache/jsshell/js';

/**
 * The cross-browser determinism test (M29): the sim alone in a blank page, in Chromium, WebKit and
 * Firefox (`npx playwright install webkit firefox`), compared with Node. No server, no rendering.
 * On the owner's Mac run `XB_FIREFOX=0 npm run xbrowser` (Firefox under Playwright fails to launch
 * there; the SpiderMonkey shell stands in).
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
    ...(process.env.XB_FIREFOX === '0' ? [] : [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }]),
  ],
});
