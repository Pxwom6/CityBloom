// The timelapse's cost (M45): imports a saved city (the bench city: `bench.ts 6 --big --save
// bench-results/city.gz`) through the load screen, then compares the player's ordinary frames with
// timelapse captures: each capture's main-thread time, draw calls and triangles per view, and the
// ordinary frames' work over a few seconds with and without a capture in them. In the VM (SwiftShader)
// only the calls and triangles and the ratio of a capture to a frame mean anything; on the Mac run it with
// GPU=1 (headed Chrome on the GPU) for real times.
// Usage (after `npm run build:test`): node scripts/dev/timelapsebench.mjs [city.gz] [captures=6]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { clickMain } from './menu.mjs';

const file = process.argv[2] ?? 'bench-results/city.gz';
const n = Number(process.argv[3] ?? 6);
const port = 4196;
const server = spawn('node', ['e2e/serve.mjs', 'dist-test', String(port), '/'], {
  stdio: 'ignore',
  detached: true,
});
process.on('exit', () => {
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
});
await new Promise((r) => setTimeout(r, 1500));
const gpu = process.env.GPU === '1';
const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] }
    : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(
  (q) =>
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, quality: q, reportsNotice: true }),
    ),
  process.env.QUALITY ?? (gpu ? 'high' : 'medium'),
);
await page.goto(`http://localhost:${port}/index.html`);
await clickMain(page, 'main-load', { timeout: 120_000 });
await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
  timeout: 240_000,
});
await page.evaluate(() => {
  window.__game.setSpeed(0);
  window.__game.setCamera('city');
});
await page.evaluate(() => window.__game.waitFrames(30));
const frames = await page.evaluate(() => window.__game.recordFrames(3000));
const avg = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const st = (await page.evaluate(() => window.__game.getState())).renderStats;
console.log(
  `player's frames (city view): ${frames.work.length} frames, work avg ${avg(frames.work).toFixed(1)} ms, interval avg ${avg(frames.interval).toFixed(1)} ms; ${st.calls} calls, ${st.triangles.toLocaleString('en-US')} triangles`,
);
const rows = [];
for (let k = 0; k < n; k++) {
  await page.evaluate(() => window.__game.captureTimelapse());
  const t = await page.evaluate(() => window.__game.getTimelapse());
  rows.push({
    view: t.lastDraw.view,
    ms: t.lastMs,
    calls: t.lastDraw.calls,
    triangles: t.lastDraw.triangles,
  });
  await page.waitForFunction(() => window.__game.getTimelapse().then((t) => !t.busy), null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__game.waitFrames(5));
}
for (const view of ['wide', 'orbit']) {
  const r = rows.filter((x) => x.view === view);
  if (!r.length) continue;
  console.log(
    `capture ${view}: ${avg(r.map((x) => x.ms)).toFixed(1)} ms main thread (worst ${Math.max(...r.map((x) => x.ms)).toFixed(1)}), ${Math.round(avg(r.map((x) => x.calls)))} calls, ${Math.round(avg(r.map((x) => x.triangles))).toLocaleString('en-US')} triangles`,
  );
}
const t = await page.evaluate(() => window.__game.getTimelapse());
console.log(
  `kept: ${t.frames.wide + t.frames.orbit} frames, ${(t.bytes / 1e3).toFixed(0)} kB (${(t.bytes / Math.max(1, t.frames.wide + t.frames.orbit) / 1e3).toFixed(0)} kB a frame)`,
);
// A capture every 7.5 s of real time at 3×: its share of the frame budget, averaged.
const cap = avg(rows.map((x) => x.ms));
console.log(
  `at 3×, one capture each 7.5 s: ${((cap / 7500) * 100).toFixed(2)} % of the main thread on average; one frame in ${Math.round(7500 / Math.max(1, avg(frames.interval)))} costs about ${(cap / Math.max(0.1, avg(frames.work))).toFixed(1)}× an ordinary frame's work`,
);
await browser.close();
process.exit(0);
