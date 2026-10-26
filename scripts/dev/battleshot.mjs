// Dev (M35): a raid on a town with rival neighbours, from the warning to the repairs. Builds the
// test town (as unitshot.mjs) with an HQ, barracks, a depot and bunkers, trains a few units, then
// has a neighbour raid it (the raidIn cheat) and shoots: the countdown, the battle (several
// moments, following the fighting), the battle bar, the war room's report, and the town repaired.
// Prints what the battle draws.
// Usage: npm run build:test && node scripts/dev/battleshot.mjs outDir
// Env: QUALITY=medium (low|medium|high), PORT=4392, SEED=port, ONLY=warning,battle,bar,report,map,repaired
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'battle-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4392);
const quality = process.env.QUALITY ?? 'medium';
const only = process.env.ONLY?.split(',');
const want = (n) => !only || only.includes(n);
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(port), '--strictPort'],
  {
    stdio: 'ignore',
    detached: true,
  },
);
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const t0 = Date.now();
const log = (...a) => console.log(`[battleshot ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(
    `http://localhost:${port}/?paused=1&rivals=1&preset=coast&seed=${process.env.SEED ?? 'port'}`,
  );
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 90000 });
  await page.evaluate(
    (q) => window.__game.setSettings({ quality: q, graphicsChecked: true, tips: false }),
    quality,
  );
  const town = await page.evaluate(async () => {
    const g = window.__game;
    const fails = [];
    const d = async (cmd) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) fails.push(`${cmd.type} ${cmd.road ?? cmd.def ?? cmd.kind ?? ''}: ${r.reason}`);
      return r;
    };
    await d({ type: 'cheat', cheat: 'unlockAll' });
    await d({ type: 'cheat', cheat: 'addMoney', amount: 8_000_000 });
    const s = await g.getState();
    const hw = { x: 24, z: s.highwayZ };
    const at = (dx, dz) => ({ x: hw.x + dx, z: hw.z + dz });
    await d({ type: 'buildRoad', road: 'avenue', points: [hw, at(480, 0)] });
    for (const x of [96, 192, 288, 384])
      await d({ type: 'buildRoad', road: 'street', points: [at(x, -160), at(x, 160)] });
    const brush = (zone, a, b, radius) =>
      d({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
    await brush('R', at(20, -100), at(480, -100), 70);
    await brush('C', at(20, 20), at(480, 20), 22);
    await brush('R', at(20, 90), at(240, 90), 50);
    await brush('I', at(260, 110), at(480, 110), 50);
    let util = null;
    for (const dz of [230, 250, 270, 210, 290]) {
      const pts = [at(30, dz), at(470, dz)];
      if ((await g.preview({ type: 'buildRoad', road: 'street', points: pts })).ok) {
        await d({ type: 'buildRoad', road: 'street', points: pts });
        util = dz;
        break;
      }
    }
    for (const x of [96, 192, 288, 384])
      await d({ type: 'buildRoad', road: 'street', points: [at(x, 160), at(x, util)] });
    for (const def of ['coal', 'coal', 'pump', 'pump', 'treatment', 'landfill', 'pump'])
      await g.placeCivic(def, at(240, util));
    for (const def of ['firestation', 'police', 'clinic', 'primary']) await g.placeCivic(def, at(240, 0));
    await g.advance(1440 * 3);
    const bases = {};
    for (const [def, near] of [
      ['militaryhq', at(300, -160)],
      ['barracks', at(380, -160)],
      ['vehicledepot', at(200, 160)],
      ['bunker', at(100, -160)],
      ['bunker', at(140, 0)],
      ['shelter', at(200, -160)],
      ['antiair', at(100, 160)],
    ]) {
      const id = await g.placeCivic(def, near);
      if (id === null) fails.push(`place ${def}`);
      else bases[def] = id;
    }
    for (const kind of ['infantry', 'infantry', 'infantry', 'infantry'])
      await d({ type: 'trainUnit', base: bases.barracks, kind });
    for (const kind of ['tank', 'tank', 'artillery'])
      await d({ type: 'trainUnit', base: bases.vehicledepot, kind });
    for (let k = 0; k < 8; k++) await g.advance(1440);
    return { hw, fails, bases };
  });
  log('town', JSON.stringify(town));
  const snap = async (name, pose, frames = 3) => {
    if (pose) await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate((n) => window.__game.waitFrames(n), frames);
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
    const b = await page.evaluate(() => window.__game.getBattle());
    const st = await page.evaluate(() => window.__game.getState());
    log(
      name,
      JSON.stringify({ frame: b.frame, effects: b.effects, drawn: b.drawn }),
      'calls',
      st.renderStats.calls,
    );
  };
  // To 09:00, and a raid four hours off.
  await page.evaluate(async () => {
    const g = window.__game;
    const s = await g.getState();
    const now = (s.tick + 420) % 1440;
    await g.advance((9 * 60 - now + 1440) % 1440);
    const r = await g.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 4 });
    if (!r.ok) throw new Error(r.reason);
    // Past the warning (an hour before it arrives, with no radar).
    await g.advance(3 * 60 + 20);
  });
  const hq = town.bases.militaryhq;
  const civ = await page.evaluate((id) => window.__game.getCivics().find((c) => c.id === id), hq);
  if (want('warning')) await snap('warning', { x: civ.x, z: civ.z, distance: 520, yaw: 0.5, tilt: 0.45 });
  // On to the battle.
  for (let k = 0; k < 400; k++) {
    const b = await page.evaluate(async () => {
      await window.__game.advance(10);
      return window.__game.getBattle();
    });
    if (b.frame && b.frame.units > 0 && b.frame.step > 40) break;
  }
  if (want('battle'))
    for (const [name, ticks] of [
      ['battle-1', 0],
      ['battle-2', 40],
      ['battle-3', 60],
    ]) {
      await page.evaluate(async (t) => {
        if (t) await window.__game.advance(t);
        window.__game.followBattle();
      }, ticks);
      await snap(name, null, 6);
    }
  if (want('close')) {
    // Down among the units: the nearest attacker still fighting, close up.
    const u = await page.evaluate(() => {
      const f = window.__game.getBattle();
      return f.frame ? window.__game.getUnits().find((x) => x.doing === 'battle' && x.id < -999_999) : null;
    });
    if (u) await snap('close', { x: u.x, z: u.z, distance: 60, yaw: 0.7, tilt: 0.12 }, 4);
  }
  if (want('bar')) {
    await page.evaluate(() => window.__game.followBattle());
    await snap('bar', null, 3);
  }
  // To the end of the battle.
  for (let k = 0; k < 200; k++) {
    const b = await page.evaluate(async () => {
      await window.__game.advance(20);
      return window.__game.getBattle();
    });
    if (!b.frame) break;
  }
  if (want('report')) {
    await page.evaluate(() => window.__game.openPanel('war'));
    await page.getByTestId('war-tab-reports').click();
    await snap('report', { x: civ.x, z: civ.z, distance: 420, yaw: 0.5, tilt: 0.45 }, 3);
    await page.evaluate(() => window.__game.openPanel('war'));
  }
  if (want('map')) {
    // The war room's map: the neighbours, the roads' hours, the front, and when raids may come.
    await page.evaluate(() => window.__game.openPanel('war'));
    await page.getByTestId('war-tab-map').click();
    await snap('map', { x: civ.x, z: civ.z, distance: 420, yaw: 0.5, tilt: 0.45 }, 2);
    await page.evaluate(() => window.__game.openPanel('war'));
  }
  if (want('repaired')) {
    await page.evaluate(() => window.__game.advance(1440 * 5));
    await snap('repaired', { x: civ.x, z: civ.z, distance: 420, yaw: 0.5, tilt: 0.45 }, 3);
  }
  const reports = (await page.evaluate(() => window.__game.getBattle())).reports;
  log('reports', JSON.stringify(reports));
  log('errors', errors.length, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
}
