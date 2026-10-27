// Dev (M37): weapon development's looks. A coast town with rival neighbours, its research done, the
// new buildings (lab, proving ground, spy agency, interceptor, shield generator, and the dome, tower
// and gate with their stages cheated done); screenshots of a prototype on trial, the superweapons
// parked at their bases, a staged battle under the dome (shield bubbles, interceptors), the robot's
// stomp, the gate's swirl and the tower's ring. Prints the draw cost of each view.
// Usage: node scripts/dev/supershot.mjs outDir   (after npm run build:test)
// Env: ONLY=trial,parked,dome,shields,robot,gate,tower,low   QUALITY=medium   PORT=4392   SEED=port
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'super-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4392);
const quality = process.env.QUALITY ?? 'medium';
const only = process.env.ONLY?.split(',');
const want = (n) => !only || only.includes(n);
const server = spawn(
  'npx',
  ['vite', 'preview', '--outDir', 'dist-test', '--port', String(port), '--strictPort'],
  { stdio: 'ignore', detached: true },
);
await new Promise((r) => setTimeout(r, 2000));
const browser = await chromium.launch({
  ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}),
  args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});
const t0 = Date.now();
const log = (...a) => console.log(`[supershot ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
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
  const built = await page.evaluate(async () => {
    const g = window.__game;
    const fails = [];
    const d = async (cmd) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) fails.push(`${cmd.type} ${cmd.cheat ?? cmd.def ?? cmd.kind ?? ''}: ${r.reason}`);
      return r;
    };
    await d({ type: 'cheat', cheat: 'unlockAll' });
    await d({ type: 'cheat', cheat: 'addMoney', amount: 30_000_000 });
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
    let util = 250;
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
    for (const def of ['coal', 'coal', 'coal', 'pump', 'pump', 'treatment', 'landfill', 'pump'])
      await g.placeCivic(def, at(240, util));
    for (const def of ['firestation', 'police', 'clinic', 'primary']) await g.placeCivic(def, at(240, 0));
    await g.advance(1440 * 3);
    await d({
      type: 'cheat',
      cheat: 'research',
      tiers: ['land', 'air', 'sea', 'defence', 'intel', 'logistics'].flatMap((b) =>
        [1, 2, 3, 4].map((t) => `${b}${t}`),
      ),
    });
    const ids = {};
    const put = async (def, near) => {
      const id = await g.placeCivic(def, near);
      if (id === null) fails.push(`place ${def}`);
      else {
        ids[def] = id;
        const c = (await g.getCivics()).find((x) => x.id === id);
        if (c?.stage !== undefined) await d({ type: 'cheat', cheat: 'finishStages', civic: id });
      }
      return id;
    };
    await put('militaryhq', at(300, -160));
    await put('vehicledepot', at(200, 160));
    await put('militarylab', at(100, -160));
    await put('shieldgen', at(380, -160));
    await put('interceptor', at(150, 160));
    await put('domeshield', at(60, 160));
    await put('blackouttower', at(440, 160));
    await put('spyagency', at(20, -160));
    for (const dz of [-420, -480, -540, -360]) {
      const pts = [at(40, dz), at(800, dz)];
      if (!(await g.preview({ type: 'buildRoad', road: 'avenue', points: pts })).ok) continue;
      await d({ type: 'buildRoad', road: 'avenue', points: pts });
      await d({ type: 'buildRoad', road: 'street', points: [at(96, dz), at(96, -160)] });
      await put('airfield', at(420, dz));
      await put('provingground', at(200, dz));
      await put('expressgate', at(700, dz));
      break;
    }
    for (const x of [1430, 1410, 1390, 1450, 1370]) {
      const shore = [
        { x, z: hw.z - 400 },
        { x, z: hw.z + 400 },
      ];
      const link = [at(480, 0), { x, z: hw.z }];
      if (!(await g.preview({ type: 'buildRoad', road: 'street', points: shore })).ok) continue;
      if (!(await g.preview({ type: 'buildRoad', road: 'avenue', points: link })).ok) continue;
      await d({ type: 'buildRoad', road: 'avenue', points: link });
      await d({ type: 'buildRoad', road: 'street', points: shore });
      if ((await put('navalyard', { x, z: hw.z - 150 })) !== null) break;
    }
    const st = await g.getState();
    for (const n of st.region.neighbours.filter((x) => x.rival))
      await d({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
    await g.advance(60 * 12);
    return { ids, fails };
  });
  log('built', JSON.stringify(built));
  const civics = await page.evaluate(() => window.__game.getCivics());
  const civ = (def) => civics.find((c) => c.def === def);
  let current = quality;
  const snap = async (name, pose, frames = 3, q = quality) => {
    if (q !== current) {
      await page.evaluate((v) => window.__game.setSettings({ quality: v }), q);
      current = q;
    }
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate((n) => window.__game.waitFrames(n), frames);
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
    const st = await page.evaluate(() => window.__game.getState());
    const sup = await page.evaluate(() => window.__game.getSupers().shown);
    log(name, 'calls', st.renderStats.calls, 'tris', st.renderStats.triangles, 'supers', JSON.stringify(sup));
  };
  const daylight = () =>
    page.evaluate(async () => {
      const g = window.__game;
      const s = await g.getState();
      const now = (s.tick + 420) % 1440;
      if (now >= 9 * 60 && now < 16 * 60) return;
      await g.advance((10 * 60 - now + 1440) % 1440);
    });
  await daylight();
  // A prototype on trial at the proving ground.
  const ground = civ('provingground');
  if (want('trial') && ground) {
    await page.evaluate(async (id) => {
      const g = window.__game;
      await g.dispatch({ type: 'startTrial', ground: id, kind: 'heavytank' });
      await g.advance(90);
    }, ground.id);
    await snap('trial', { x: ground.x, z: ground.z, distance: 70, yaw: 0.6, tilt: 0.1 });
  }
  // The superweapons parked at home (shown on the page only: training takes fifteen days).
  if (want('parked')) {
    const shown = await page.evaluate((ids) => {
      const g = window.__game;
      return g.showUnits(
        [
          { kind: 'windupbot', base: ids.vehicledepot },
          { kind: 'skyfortress', base: ids.airfield },
          { kind: 'clockworkwhale', base: ids.navalyard },
        ].filter((e) => e.base),
      );
    }, built.ids);
    log('parked', shown.length);
    const dep = civ('vehicledepot');
    if (dep) await snap('parked-robot', { x: dep.x, z: dep.z, distance: 90, yaw: 2.6, tilt: 0.08 });
    const air = civ('airfield');
    if (air) await snap('parked-fortress', { x: air.x - 40, z: air.z, distance: 160, yaw: 0.4, tilt: 0.1 });
    const yard = civ('navalyard');
    if (yard) await snap('parked-whale', { x: yard.x + 40, z: yard.z, distance: 180, yaw: 1.4, tilt: 0.12 });
  }
  const hq = civ('militaryhq');
  // A battle at home under the dome: the dome raised, shield bubbles, interceptors bursting shells.
  if ((want('dome') || want('shields')) && hq) {
    const why = await page.evaluate(async () => {
      const g = window.__game;
      await g.dispatch({ type: 'cheat', cheat: 'superReady' });
      const r = await g.stageBattle('max');
      if (r) return r;
      await g.advance(40);
      return null;
    });
    log('staged', why ?? 'ok');
    if (want('dome')) await snap('dome', { x: hq.x, z: hq.z, distance: 1500, yaw: 0.3, tilt: 0.12 }, 4);
    if (want('shields')) {
      const sg = civ('shieldgen');
      await snap('shields', { x: sg?.x ?? hq.x, z: sg?.z ?? hq.z, distance: 520, yaw: 0.8, tilt: 0.2 }, 4);
      await page.evaluate(() => window.__game.followBattle());
      await snap('intercept', await page.evaluate(() => window.__game.getCamera()), 4);
    }
    if (want('low'))
      await snap('dome-low', { x: hq.x, z: hq.z, distance: 1500, yaw: 0.3, tilt: 0.12 }, 4, 'low');
    await page.evaluate(async () => {
      const g = window.__game;
      for (let k = 0; k < 60 && (await g.getBattle()).frame; k++) await g.advance(60);
    });
  }
  // The robot stomping (a staged raid with it).
  if (want('robot') && hq) {
    const why = await page.evaluate(async () => {
      const g = window.__game;
      const r = await g.stageBattle('robot');
      if (r) return r;
      await g.advance(30);
      return null;
    });
    log('robot raid', why ?? 'ok');
    await page.evaluate(() => window.__game.followBattle());
    await snap('robot', await page.evaluate(() => window.__game.getCamera()), 4);
    await page.evaluate(async () => {
      const g = window.__game;
      for (let k = 0; k < 60 && (await g.getBattle()).frame; k++) await g.advance(60);
    });
  }
  // The gate: a tank through it, the swirl while it goes.
  const gate = civ('expressgate');
  if (want('gate') && gate) {
    const sent = await page.evaluate(async (ids) => {
      const g = window.__game;
      const s = await g.getState();
      const rival = s.region.neighbours.find((n) => n.rival);
      await g.dispatch({ type: 'trainUnit', base: ids.vehicledepot, kind: 'tank' });
      for (let k = 0; k < 20 && !(await g.getForces()).units.some((u) => u.kind === 'tank'); k++)
        await g.advance(720);
      const tank = (await g.getForces()).units.find((u) => u.kind === 'tank');
      if (!tank) return 'no tank';
      const r = await g.dispatch({
        type: 'sendForce',
        units: [tank.id],
        to: rival.id,
        route: 'highway',
        target: 'military',
        stance: 'bold',
        gate: true,
      });
      return r.ok ? null : r.reason;
    }, built.ids);
    log('gate', sent ?? 'ok');
    await snap('gate', { x: gate.x, z: gate.z, distance: 110, yaw: 0.5, tilt: 0.15 });
  }
  // The tower charging at a rival: its ring glows.
  const tower = civ('blackouttower');
  if (want('tower') && tower) {
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const s = await g.getState();
      const rival = s.region.neighbours.find((n) => n.rival);
      const res = await g.dispatch({ type: 'useBlackout', neighbour: rival.id });
      return res.ok ? null : res.reason;
    });
    log('tower', r ?? 'ok');
    await snap('tower', { x: tower.x, z: tower.z, distance: 120, yaw: 0.4, tilt: 0.12 });
  }
  log('errors', errors.length, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  try {
    process.kill(-server.pid);
  } catch {
    /* gone */
  }
}
