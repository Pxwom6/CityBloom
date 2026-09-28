// Dev (M21): open Castlebridge (the Big Game scenario's city), paint two districts through the UI,
// open the Districts panel, give one a heritage policy, and show the land value map filtered to it.
// Usage: node scripts/dev/districtshot.mjs outDir   (after npm run build:test)
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
const out = process.argv[2];
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4187', '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true }));
  });
  await page.goto('http://localhost:4187/?scenario=stadium');
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 120000,
  });
  await page.getByTestId('scenario-begin').click();
  await page.evaluate(() => window.__game.setSpeed(0));
  const cam = async (p) => {
    await page.evaluate((p) => window.__game.setCamera(p), p);
    await page.evaluate(() => window.__game.waitFrames(1));
  };
  const scr = (x, z) => page.evaluate(([x, z]) => window.__game.worldToScreen(x, z), [x, z]);
  /** Drag a brush stroke through world points. */
  const stroke = async (pts) => {
    const a = await scr(pts[0][0], pts[0][1]);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    for (const [x, z] of pts.slice(1)) {
      const p = await scr(x, z);
      await page.mouse.move(p.x, p.y, { steps: 6 });
    }
    await page.mouse.up();
    await page.evaluate(() => window.__game.waitFrames(2));
  };
  await cam({ x: 640, z: 1400, distance: 900, yaw: 0, tilt: 0.75 });
  await page.keyboard.press('i');
  await page.getByTestId('district-new').click();
  await stroke([
    [700, 1380],
    [980, 1380],
    [980, 1480],
    [700, 1480],
  ]);
  await page.waitForFunction(() => window.__game.getDistricts().list.length === 1, null, { timeout: 60000 });
  await page.getByTestId('district-new').click();
  await stroke([
    [520, 1250],
    [700, 1250],
    [700, 1330],
  ]);
  await page.waitForFunction(() => window.__game.getDistricts().list.length === 2, null, { timeout: 60000 });
  await page.evaluate(() => window.__game.waitFrames(2));
  const d = await page.evaluate(() => window.__game.getDistricts());
  console.log(JSON.stringify(d));
  await page.screenshot({ path: `${out}/paint.png` });
  // Pick the first district in the panel and make it a heritage district.
  const first = d.list[0];
  await page.getByTestId(`district-${first.id}`).click();
  await page.getByTestId('district-policy-heritage').check();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/panel.png` });
  // Land value, this district only.
  await page.getByTestId('district-filter').click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/filtered.png` });
  if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 10).join('\n'));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
