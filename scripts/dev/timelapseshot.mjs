// The timelapse (M45), for looking at: a test build's new city grows a town for a few game years
// with recording on (a frame every `STEP` game ticks, default a sixth of a month), then the stored
// frames of each view are written out (first, a few between, last) and the capture times printed.
// Usage (after `npm run build:test`): node scripts/dev/timelapseshot.mjs <outDir> [months=24]
// Env: STEP (ticks between frames), PORT (4181), QUALITY (low; high with GPU=1), GPU=1 (headed Chrome
// on the GPU: scripts/dev/gpuLaunch.mjs), MAKE (the video's length: 15, 30 or
// 60; 0 for none), MUSIC=1 (with the music).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { launchBrowser, QUALITY, SHADOWS } from './gpuLaunch.mjs';

const out = process.argv[2] ?? 'shots/timelapse';
const months = Number(process.argv[3] ?? 24);
const step = Number(process.env.STEP ?? 240);
const port = Number(process.env.PORT ?? 4181);
mkdirSync(out, { recursive: true });
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
const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(
  ([q, sh]) => {
    localStorage.setItem(
      'citybloom.settings',
      JSON.stringify({ tips: false, graphicsChecked: true, quality: q, shadows: sh, reportsNotice: true }),
    );
  },
  [QUALITY, SHADOWS],
);
const page = await ctx.newPage();
page.on('console', (m) => m.type() === 'error' && console.log(`[page] ${m.text()}`));
await page.goto(`${game}?seed=tl1&preset=river`);
await page.waitForFunction(
  () => window.__game?.ready === true && window.__game.getShell().mode === 'play',
  null,
  {
    timeout: 180_000,
  },
);
await page.evaluate(async (step) => {
  const g = window.__game;
  g.setSpeed(0);
  g.setTimelapseStep(step);
  const s = await g.getState();
  const c = { x: 24, z: s.highwayZ };
  const ok = async (cmd) => {
    const r = await g.dispatch(cmd);
    if (!r.ok) console.log(`${cmd.type}: ${r.reason}`);
  };
  await ok({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
  await ok({ type: 'cheat', cheat: 'unlockAll' });
  await ok({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 700, z: c.z }] });
  for (let k = 1; k <= 6; k++)
    await ok({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: c.x + k * 100, z: c.z - 220 },
        { x: c.x + k * 100, z: c.z + 220 },
      ],
    });
  for (const [zone, dz, r] of [
    ['R', -120, 90],
    ['C', 20, 22],
    ['R', 120, 60],
    ['I', 190, 40],
  ])
    await ok({
      type: 'zone',
      zone,
      area: {
        kind: 'brush',
        points: [
          { x: c.x + 20, z: c.z + dz },
          { x: c.x + 690, z: c.z + dz },
        ],
        radius: r,
      },
    });
  for (const def of [
    'coal',
    'coal',
    'pump',
    'pump',
    'treatment',
    'landfill',
    'firestation',
    'clinic',
    'primary',
    'police',
  ])
    await g.placeCivic(def, { x: c.x + 350, z: c.z + 240 });
}, step);
// The years, a step at a time, so the recorder sees each one pass.
const steps = Math.ceil((months * 1440) / step);
const t0 = Date.now();
for (let k = 0; k < steps; k++) {
  await page.evaluate((step) => window.__game.advance(step), step);
  await page.evaluate(() => window.__game.waitFrames(2));
  if (k % 20 === 0) console.log(`step ${k}/${steps} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
await page.evaluate(() => window.__game.waitFrames(10));
const tl = await page.evaluate(() => window.__game.getTimelapse());
console.log(
  JSON.stringify({ ...tl, stored: { wide: tl.stored.wide.length, orbit: tl.stored.orbit.length } }),
);
// Some frames of each view as files.
for (const view of ['wide', 'orbit']) {
  const list = tl.stored[view];
  const pick = [0, Math.floor(list.length / 3), Math.floor((2 * list.length) / 3), list.length - 1];
  for (const i of [...new Set(pick)]) {
    if (!list[i]) continue;
    const b64 = await page.evaluate(
      async ([view, tick]) => {
        const req = indexedDB.open('citybloom-timelapse');
        const db = await new Promise((res) => (req.onsuccess = () => res(req.result)));
        const key = window.__game.getTimelapse ? (await window.__game.getTimelapse()).key : '';
        const rec = await new Promise(
          (res) =>
            (db.transaction('frames').objectStore('frames').get([key, view, tick]).onsuccess = (e) =>
              res(e.target.result)),
        );
        const buf = new Uint8Array(await rec.blob.arrayBuffer());
        let s = '';
        for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode(...buf.subarray(j, j + 0x8000));
        return btoa(s);
      },
      [view, list[i].tick],
    );
    writeFileSync(`${out}/${view}-${String(i).padStart(3, '0')}.jpg`, Buffer.from(b64, 'base64'));
  }
}
console.log(`frames written to ${out}`);
// Through City history: Make timelapse, a length (env MAKE, default 15) and the whole map, then the
// video's length and its first and last frames.
const len = Number(process.env.MAKE ?? 15);
if (len > 0) {
  await page.getByTestId('open-history').click();
  await page.getByTestId('timelapse-section').waitFor();
  await page.screenshot({ path: `${out}/history.png` });
  await page.getByTestId('timelapse-open').click();
  await page.getByTestId(`timelapse-length-${len}`).click();
  if (process.env.MUSIC === '1') await page.getByTestId('timelapse-music').check();
  await page.screenshot({ path: `${out}/card.png` });
  const m0 = Date.now();
  await page.getByTestId('timelapse-make').click();
  await page.getByTestId('timelapse-result').waitFor({ timeout: 600_000 });
  console.log(`made a ${len} s video in ${((Date.now() - m0) / 1000).toFixed(1)} s`);
  const v = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid=timelapse-video]');
    if (el.readyState < 1) await new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true }));
    const shot = async (t) => {
      el.currentTime = t;
      await new Promise((r) => el.addEventListener('seeked', r, { once: true }));
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 90;
      const ctx = c.getContext('2d');
      ctx.drawImage(el, 0, 0, 160, 90);
      const d = ctx.getImageData(0, 0, 160, 90).data;
      // Pixels that aren't grass or forest green: roads, roofs, water.
      let town = 0;
      for (let i = 0; i < d.length; i += 4) if (!(d[i + 1] > d[i] + 12 && d[i + 1] > d[i + 2] + 12)) town++;
      return town;
    };
    const res = await fetch(el.src);
    const bytes = (await res.arrayBuffer()).byteLength;
    return {
      duration: el.duration,
      width: el.videoWidth,
      height: el.videoHeight,
      bytes,
      first: await shot(0.1),
      last: await shot(el.duration - 0.1),
    };
  });
  console.log('video', JSON.stringify(v));
  await page.screenshot({ path: `${out}/result.png` });
  const b64 = await page.evaluate(async () => {
    const el = document.querySelector('[data-testid=timelapse-video]');
    const buf = new Uint8Array(await (await fetch(el.src)).arrayBuffer());
    let s = '';
    for (let j = 0; j < buf.length; j += 0x8000) s += String.fromCharCode(...buf.subarray(j, j + 0x8000));
    return btoa(s);
  });
  writeFileSync(`${out}/timelapse-${len}s.mp4`, Buffer.from(b64, 'base64'));
}
await browser.close();
process.exit(0);
