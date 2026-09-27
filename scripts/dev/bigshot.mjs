// Dev: import a saved city (e.g. from `bench.ts --big --save city.gz`) through the load screen's
// "Import from file", then screenshot it from a few camera poses and print the render stats.
// Usage: npm run build:test && node scripts/dev/bigshot.mjs city.gz outDir [hour]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const [file, out, hourArg] = process.argv.slice(2);
if (!file || !out) throw new Error('usage: node scripts/dev/bigshot.mjs city.gz outDir [hour]');
mkdirSync(out, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-test', '--port', '4195', '--strictPort'], {
  stdio: 'ignore',
  // Its own process group, so the preview server (a child of npx) goes down with it.
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
  await page.goto('http://localhost:4195/');
  await page.getByTestId('main-load').click({ timeout: 120_000 });
  await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
  await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
    timeout: 180_000,
  });
  const hour = Number(hourArg ?? 13);
  const ticks = await page.evaluate(async (h) => {
    const g = window.__game;
    const s = await g.getState();
    // Game clocks start at 07:00 (tick 0).
    const now = (s.tick + 7 * 60) % 1440;
    await g.advance((h * 60 - now + 1440) % 1440 || 1);
    await g.waitFrames(2);
    return { before: s.tick, after: (await g.getState()).tick };
  }, hour);
  console.log(
    `clock: tick ${ticks.before} → ${ticks.after} (${Math.floor(((ticks.after + 420) % 1440) / 60)}:00)`,
  );
  const poses = {
    overview: 'overview',
    city: 'city',
    street: 'street',
    low: { x: 700, z: 1000, distance: 900, yaw: 0.9, tilt: -0.15 },
  };
  for (const [name, pose] of Object.entries(poses)) {
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate(() => window.__game.waitFrames(4));
    await page.screenshot({ path: `${out}/${name}.png` });
    const s = await page.evaluate(() => window.__game.getState());
    const r = s.renderStats;
    const parts = await page.evaluate(() => window.__game.renderBreakdown());
    console.log(
      `  ${parts
        .filter((p) => p.meshes)
        .map((p) => `${p.name} ${p.meshes}/${p.shadow}`)
        .join(', ')}`,
    );
    console.log(
      `${name}: pop ${s.population}, draw calls ${r.calls}, triangles ${(r.triangles / 1e6).toFixed(2)}M, cars ${r.cars}, walkers ${r.walkers}, trees ${r.trees}`,
    );
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
