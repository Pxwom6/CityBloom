// Dev (phase 3): how invisible is the hand-over between levels of detail? Opens a saved city (or
// a gallery of models), looks at it from a run of distances, and at each compares the picture
// drawn at one level of detail with the next: the share of pixels that differ visibly and the mean
// difference. At the distance a level takes over, the difference should be next to nothing.
// Usage: npm run build:test && node scripts/dev/lodprobe.mjs city.gz|gallery [outDir] [--gpu] [--night]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const [file, out] = argv.filter((a) => !a.startsWith('--'));
const gpu = argv.includes('--gpu');
const night = argv.includes('--night');
if (out) mkdirSync(out, { recursive: true });
const PORT = 4188;
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(PORT), '--strictPort'],
  {
    stdio: 'ignore',
    detached: true,
  },
);
await new Promise((r) => setTimeout(r, 1500));
const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--window-size=1500,1000', '--window-position=0,0'] }
    : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
);
try {
  const page = await browser.newPage({
    viewport: { width: 1400, height: 900 },
    deviceScaleFactor: gpu ? 2 : 1,
  });
  page.on('pageerror', (e) => console.log('ERROR', String(e)));
  await page.addInitScript(() =>
    localStorage.setItem('citybloom.settings', JSON.stringify({ tips: false, graphicsChecked: true })),
  );
  let focus;
  if (file === 'gallery') {
    await page.goto(`http://localhost:${PORT}/?paused=1&seed=models&preset=lakes`);
    await page.waitForFunction(() => window.__game?.ready, null, { timeout: 60000 });
    focus = await page.evaluate(() => {
      const g = window.__game;
      const rows = [];
      for (const z of ['R', 'C', 'I'])
        for (const d of [0, 1, 2]) for (const l of [1, 2, 3]) rows.push(`${z}${d}${l % 3}${l}`);
      g.showGallery(rows, { x: 300, z: 300 }, 8);
      const b = g.getBuildings().filter((b) => b.id >= 9_000_000);
      return { x: b.reduce((s, v) => s + v.x, 0) / b.length, z: b.reduce((s, v) => s + v.z, 0) / b.length };
    });
  } else {
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByTestId('main-load').click({ timeout: 120_000 });
    await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
    await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
      timeout: 180_000,
    });
    focus = await page.evaluate(() => {
      const b = window.__game.getBuildings();
      return { x: b.reduce((s, v) => s + v.x, 0) / b.length, z: b.reduce((s, v) => s + v.z, 0) / b.length };
    });
  }
  await page.evaluate(async (night) => {
    const g = window.__game;
    const s = await g.getState();
    const now = (s.tick + 7 * 60) % 1440;
    await g.advance(((night ? 22 : 13) * 60 - now + 1440) % 1440 || 1);
    await g.waitFrames(12);
  }, night);
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  const range = await page.evaluate(() => window.__game.getLod().range);
  console.log(
    `hand-over: near→far ${range.nearStart}–${range.nearEnd} m, far→skyline ${range.skyStart}–${range.skyEnd} m`,
  );
  console.log('distance   near|far changed  mean   far|sky changed  mean   play|near changed mean');
  for (const distance of [120, 200, 260, 300, 340, 420, 520, 620, 760, 900, 1020, 1150, 1400, 2000, 2750]) {
    const r = await page.evaluate(
      async ({ focus, distance }) => {
        const g = window.__game;
        g.setCamera({ x: focus.x, z: focus.z, distance, yaw: 0.5, tilt: 0 });
        await g.waitFrames(4);
        return {
          nf: g.compareLod('near', 'far'),
          fs: g.compareLod('far', 'sky'),
          pn: g.compareLod(null, 'near'),
          lod: g.getLod(),
        };
      },
      { focus, distance },
    );
    const p = (v) => `${(v.changed * 100).toFixed(2).padStart(6)} %  ${v.mean.toFixed(2).padStart(5)}`;
    console.log(
      `${String(distance).padStart(6)} m   ${p(r.nf)}    ${p(r.fs)}    ${p(r.pn)}   on show: near ${Math.round(r.lod.buildings.near / 1000)}k far ${Math.round(r.lod.buildings.far / 1000)}k sky ${Math.round(r.lod.buildings.sky / 1000)}k plain ${Math.round(r.lod.buildings.plain / 1000)}k`,
    );
    if (out && [300, 620, 1020].includes(distance))
      for (const level of ['near', 'far', 'sky', null]) {
        await page.evaluate((l) => window.__game.setLod(l), level);
        await page.evaluate(() => window.__game.waitFrames(3));
        await page.screenshot({ path: `${out}/lod-${distance}-${level ?? 'play'}.png` });
      }
    await page.evaluate(() => window.__game.setLod(null));
  }
} finally {
  await browser.close();
  process.kill(-server.pid);
}
