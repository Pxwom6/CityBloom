// Dev (M19): visible cars at a junction. Loads a save (e.g. from `junction.ts --save`), looks at a
// point at rush hour, lets the cars run and screenshots them, printing how many are near, held up,
// on a roundabout's ring, and the closest two cars (overlaps show as < 3 m).
// Usage: npm run build:test && node scripts/dev/queueshot.mjs <save.citybloom> <out.png> [x z] [hour]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';

const [file, out, xs, zs, hs] = process.argv.slice(2);
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4199', '--strictPort'], {
  stdio: 'ignore',
  detached: true,
});
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true })),
  );
  await page.goto('http://localhost:4199/');
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const at = await page.evaluate(
    async ([xs, zs]) => {
      const s = await window.__game.getState();
      return { x: xs ? Number(xs) : 484, z: zs ? Number(zs) : s.highwayZ };
    },
    [xs, zs],
  );
  // To the rush hour, then let the cars run for a while at normal speed.
  const hour = Number(hs ?? 8);
  await page.evaluate(async (h) => {
    const g = window.__game;
    const s = await g.getState();
    const now = ((s.tick + 420) % 1440) / 60;
    await g.advance(Math.round(((h - now + 24) % 24) * 60));
  }, hour);
  await page.evaluate((p) => window.__game.setCamera(p), { ...at, distance: 150, yaw: 0.5, tilt: 0.05 });
  await page.evaluate(() => window.__game.setSpeed(1));
  for (let k = 0; k < 6; k++) await page.evaluate(() => window.__game.waitFrames(10));
  await page.evaluate(() => window.__game.setSpeed(0));
  await page.evaluate(() => window.__game.waitFrames(2));
  await page.screenshot({ path: out });
  const stats = await page.evaluate((at) => {
    const cars = window.__game.getCars().filter((c) => Math.hypot(c.x - at.x, c.z - at.z) < 200);
    let closest = Infinity;
    for (let i = 0; i < cars.length; i++)
      for (let j = i + 1; j < cars.length; j++)
        closest = Math.min(closest, Math.hypot(cars[i].x - cars[j].x, cars[i].z - cars[j].z));
    return {
      all: window.__game.getCars().length,
      near: cars.length,
      held: cars.filter((c) => c.waited > 0).length,
      ring: cars.filter((c) => c.ring !== null).length,
      closest: Math.round(closest * 10) / 10,
    };
  }, at);
  console.log(JSON.stringify(stats));
} finally {
  await browser.close();
  process.kill(-server.pid);
}
