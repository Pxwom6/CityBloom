// Dev: every big project (M17) at each construction stage and finished, row by row, for review.
// Usage: npm run build:test && node scripts/dev/projectshot.mjs <outDir> [hour] [x] [z]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [out, hourArg, xArg, zArg] = process.argv.slice(2);
if (!out) throw new Error('usage: node scripts/dev/projectshot.mjs outDir [hour] [x] [z]');
mkdirSync(out, { recursive: true });
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
  await page.goto('http://localhost:4199/?seed=projects&preset=lakes&paused=1');
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 120_000 });
  const hour = Number(hourArg ?? 11);
  await page.evaluate(async (h) => {
    const g = window.__game;
    const s = await g.getState();
    const now = (s.tick + 7 * 60) % 1440;
    await g.advance((h * 60 - now + 1440) % 1440 || 1);
  }, hour);
  const at = { x: Number(xArg ?? 500), z: Number(zArg ?? 300) };
  await page.evaluate((a) => window.__game.showProjects(a), at);
  const rows = ['stadium', 'launchsite', 'helioarray', 'gardenexpo', 'convention'];
  const depth = [96, 112, 128, 112, 80];
  let z = at.z;
  for (let k = 0; k < rows.length; k++) {
    const cz = z + depth[k] / 2;
    await page.evaluate(
      ({ x, z }) => window.__game.setCamera({ x, z, distance: 330, yaw: 0.35, tilt: 0.05 }),
      { x: at.x + 300, z: cz },
    );
    await page.evaluate(() => window.__game.waitFrames(4));
    await page.screenshot({ path: `${out}/${rows[k]}.png` });
    console.log('shot', rows[k]);
    z += depth[k] + 14;
  }
  // Close-ups of each finished project (the last in its row).
  const widths = { stadium: 120, launchsite: 112, helioarray: 128, gardenexpo: 144, convention: 120 };
  z = at.z;
  for (let k = 0; k < rows.length; k++) {
    const w = widths[rows[k]];
    const x = at.x + 3 * (w + 12) + w / 2;
    await page.evaluate(
      ({ x, z }) => window.__game.setCamera({ x, z, distance: 170, yaw: 0.6, tilt: -0.05 }),
      { x, z: z + depth[k] / 2 },
    );
    await page.evaluate(() => window.__game.waitFrames(4));
    await page.screenshot({ path: `${out}/${rows[k]}-done.png` });
    z += depth[k] + 14;
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
