// Dev: screenshot the main menu over its demo town, then again 20 s later (the town keeps running).
// Usage: npm run build:test && node scripts/dev/menushot.mjs dist-test outPrefix
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const [dir, out] = process.argv.slice(2);
const server = spawn('npx', ['vite', 'preview', '--outDir', dir, '--port', '4196', '--strictPort'], {
  stdio: 'ignore',
  // Its own process group, so the preview server (a child of npx) goes down with it.
  detached: true,
});
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on(
    'console',
    (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console:', m.text()),
  );
  // Keep the default graphics (a first launch would pick the light preset on SwiftShader).
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.settings', JSON.stringify({ graphicsChecked: true })),
  );
  await page.goto('http://localhost:4196/');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'menu', null, {
    timeout: 120000,
  });
  await page.evaluate(() => window.__game.waitFrames(4));
  const s = await page.evaluate(() => window.__game.getState());
  console.log(
    'pop',
    s.population,
    'tick',
    s.tick,
    'calls',
    s.renderStats.calls,
    'tris',
    s.renderStats.triangles,
  );
  await page.screenshot({ path: `${out}-a.png` });
  await page.waitForTimeout(20000);
  await page.evaluate(() => window.__game.waitFrames(2));
  const s2 = await page.evaluate(() => window.__game.getState());
  console.log('after 20s tick', s2.tick, 'pop', s2.population);
  await page.screenshot({ path: `${out}-b.png` });
} finally {
  await browser.close();
  process.kill(-server.pid);
}
