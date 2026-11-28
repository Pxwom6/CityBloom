// Many players' own landmarks (M46, the frame budget): imports a city made by
// `npx tsx scripts/dev/customcity.ts [N]` (N 2×2 landmarks all wearing a heavy model, 85 % of the
// landmark's triangle budget, carried in the save) through the load screen, then measures draw calls,
// triangles and the page's own work per frame from a few cameras: with the models drawn, then with
// "Show friends' custom buildings" off (the same buildings in the game's own look), to show what the
// models add. On the Mac add `GPU=1` (headed Chrome on the GPU: frame intervals mean something there).
// Usage (after `npm run build:test`): node scripts/dev/custombench.mjs [city=bench-results/custom-city.citybloom]
// Env: PORT (4183), QUALITY (high), MS (frames recorded per view, 3000), SHOTS=dir (a picture a view), GPU=1.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { clickMain } from './menu.mjs';

const file = process.argv[2] ?? 'bench-results/custom-city.citybloom';
const port = Number(process.env.PORT ?? 4183);
const ms = Number(process.env.MS ?? 3000);
const shots = process.env.SHOTS;
const gpu = process.env.GPU === '1';
if (shots) mkdirSync(shots, { recursive: true });

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
const game = `http://localhost:${port}/index.html`;
for (let i = 0; i < 50; i++) {
  try {
    if ((await fetch(game)).ok) break;
  } catch {
    /* not yet */
  }
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch(
  gpu
    ? { channel: 'chrome', headless: false, args: ['--disable-gpu-vsync', '--disable-frame-rate-limit'] }
    : { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'] },
);
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => m.type() === 'error' && console.log(`[page] ${m.text()}`));
await page.addInitScript((q) => {
  localStorage.setItem(
    'citybloom.settings',
    JSON.stringify({ tips: false, graphicsChecked: true, quality: q, reportsNotice: true, timelapse: false }),
  );
}, process.env.QUALITY ?? 'high');
await page.goto(game);
await clickMain(page, 'main-load', { timeout: 120_000 });
await Promise.all([page.waitForURL(/\?load=/), page.getByTestId('import-file').setInputFiles(file)]);
await page.waitForFunction(() => window.__game?.ready && window.__game.getShell().mode === 'play', null, {
  timeout: 180_000,
});
// The models come with the save and are checked again on arrival: wait until they're drawn.
await page.waitForFunction(async () => (await window.__game.getMyBuildings()).drawn > 0, null, {
  timeout: 120_000,
  polling: 1000,
});
const info = await page.evaluate(async () => {
  const g = window.__game;
  const own = g.getCivics().filter((c) => c.look);
  const cx = own.reduce((t, c) => t + c.x, 0) / own.length;
  const cz = own.reduce((t, c) => t + c.z, 0) / own.length;
  g.setSpeed(0);
  return { own: own.length, cx, cz };
});
console.log(`${info.own} buildings wear a model`);
const views = [
  ['overview', 'overview'],
  ['city', { x: info.cx, z: info.cz, distance: 650, yaw: 0.4, tilt: 0.7 }],
  ['street', { x: info.cx, z: info.cz, distance: 140, yaw: 0.6, tilt: 0.45 }],
];
async function measure(label) {
  const rows = [];
  for (const [name, pose] of views) {
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate(() => window.__game.waitFrames(12));
    const st = (await page.evaluate(() => window.__game.getState())).renderStats;
    const rec = await page.evaluate((ms) => window.__game.recordFrames(ms), ms);
    const avg = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const p95 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] ?? 0;
    rows.push({
      view: name,
      calls: st.calls,
      triangles: st.triangles,
      workAvg: +avg(rec.work).toFixed(2),
      workP95: +p95(rec.work).toFixed(2),
      intervalAvg: +avg(rec.interval).toFixed(1),
      frames: rec.work.length,
    });
    if (shots) await page.screenshot({ path: `${shots}/${label}-${name}.png` });
  }
  const drawn = (await page.evaluate(() => window.__game.getMyBuildings())).drawn;
  console.log(`${label}: ${drawn} drawn wearing a model`);
  console.table(rows);
  return rows;
}
const withModels = await measure('custom');
await page.evaluate(() => window.__game.setSettings({ showFriendsBuildings: false }));
await page.evaluate(() => window.__game.waitFrames(20));
const plain = await measure('plain');
console.log('difference (custom − plain):');
console.table(
  withModels.map((r, i) => ({
    view: r.view,
    calls: r.calls - plain[i].calls,
    triangles: r.triangles - plain[i].triangles,
    workAvg: +(r.workAvg - plain[i].workAvg).toFixed(2),
  })),
);
await browser.close();
process.exit(0);
