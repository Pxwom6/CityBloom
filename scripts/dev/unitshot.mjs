// Dev (M34): a coast town with rival neighbours, every military building and units of every kind;
// screenshots of the town, each base close up (parked and on drills), a patrol on a street, planes
// over the airfield, boats off the naval yard, night, and a gallery of every war building's
// generated look. Prints what the units cost to draw.
// Usage: node scripts/dev/unitshot.mjs outDir   (after npm run build:test)
// Env: ONLY=overview,barracks,drill,depot,pad,patrol,airfield,flying,heli,naval,sailing,night,gallery,dots
//      QUALITY=medium (low|medium|high), PORT=4391, SEED=port
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'war-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4391);
const quality = process.env.QUALITY ?? 'medium';
// Wide views are drawn at Low (SwiftShader takes too long otherwise), close-ups at `quality`.
const wide = process.env.WIDE ?? 'low';
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
const log = (...a) => console.log(`[warshot ${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(
    `http://localhost:${port}/?paused=1&rivals=1&preset=coast&seed=${process.env.SEED ?? 'port'}`,
  );
  await page.waitForFunction(() => window.__game?.ready, null, { timeout: 90000 });
  await page.evaluate((q) => window.__game.setSettings({ quality: q, graphicsChecked: true }), quality);
  // The town: the test suite's planned town, its services, a few months' growth.
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
    const c = s.civics !== undefined ? null : null;
    void c;
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
    // The utility street and services.
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
    return { hw, util, fails };
  });
  log('town', JSON.stringify(town));
  // The military: every building, the airfield on a long avenue north, the naval yard and coastal
  // gun on a street along the shore.
  const war = await page.evaluate(async ({ hw }) => {
    const g = window.__game;
    const fails = [];
    const d = async (cmd) => {
      const r = await g.dispatch(cmd);
      if (!r.ok) fails.push(`${cmd.type} ${cmd.road ?? cmd.def ?? cmd.kind ?? ''}: ${r.reason}`);
      return r;
    };
    const at = (dx, dz) => ({ x: hw.x + dx, z: hw.z + dz });
    await d({ type: 'cheat', cheat: 'addMoney', amount: 8_000_000 });
    const bases = {};
    const put = async (def, near) => {
      const id = await g.placeCivic(def, near);
      if (id === null) fails.push(`place ${def}`);
      else bases[def] = id;
      return id;
    };
    await put('militaryhq', at(300, -160));
    await put('barracks', at(380, -160));
    await put('vehicledepot', at(200, 160));
    for (const def of ['shelter', 'bunker', 'antiair', 'radar']) await put(def, at(100, -160));
    // A long avenue north of town for the airfield, joined to the first side street.
    for (const dz of [-420, -480, -540, -360]) {
      const pts = [at(40, dz), at(800, dz)];
      if (!(await g.preview({ type: 'buildRoad', road: 'avenue', points: pts })).ok) continue;
      await d({ type: 'buildRoad', road: 'avenue', points: pts });
      await d({ type: 'buildRoad', road: 'street', points: [at(96, dz), at(96, -160)] });
      await put('airfield', at(420, dz));
      await put('armsfactory', at(700, dz));
      await put('provingground', at(200, dz));
      break;
    }
    // Out to the sea: an avenue east, then a street along the shore.
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
      if ((await put('navalyard', { x, z: hw.z - 150 })) === null) continue;
      // The coastal gun wherever the shore street comes closest to the water.
      for (let dz = 350; dz >= -350 && !bases.coastalgun; dz -= 50) {
        const id = await g.placeCivic('coastalgun', { x, z: hw.z + dz });
        if (id !== null) bases.coastalgun = id;
      }
      if (!bases.coastalgun) fails.push('place coastalgun');
      break;
    }
    await d({ type: 'setFunding', dept: 'defence', pct: 125 });
    // Units of every kind the sim trains without research, a few of some.
    const orders = {
      barracks: ['infantry', 'infantry', 'infantry', 'infantry', 'infantry', 'infantry'],
      vehicledepot: ['tank', 'transport', 'artillery', 'tank'],
      airfield: ['drone', 'helicopter', 'fighter', 'drone'],
      navalyard: ['patrolboat', 'patrolboat'],
    };
    for (const [base, kinds] of Object.entries(orders))
      for (const kind of kinds) if (bases[base]) await d({ type: 'trainUnit', base: bases[base], kind });
    return { bases, fails };
  }, town);
  log('war', JSON.stringify(war));
  // Train: advance until every order is done (or a long while).
  let trained = null;
  for (let k = 0; k < 40; k++) {
    trained = await page.evaluate(async () => {
      const g = window.__game;
      await g.advance(480);
      const s = await g.getState();
      return { tick: s.tick, war: s.war ?? null, pop: s.population };
    });
    const w = trained.war;
    if (w && w.training === 0 && w.units > 0) break;
    if (k % 4 === 0)
      log(
        'training',
        JSON.stringify({
          tick: trained.tick,
          pop: trained.pop,
          war: w && {
            units: w.units,
            training: w.training,
            readiness: w.readiness,
            staff: w.staff,
            power: w.power,
          },
        }),
      );
  }
  log(
    'trained',
    JSON.stringify(trained?.war ? { units: trained.war.units, training: trained.war.training } : trained),
  );
  // Kinds that need research the sim can't train yet: shown on the client only, for review.
  const injected = await page.evaluate(({ bases }) => {
    const g = window.__game;
    const extra = [
      { kind: 'heavytank', base: bases.vehicledepot },
      { kind: 'repair', base: bases.vehicledepot },
      { kind: 'bomber', base: bases.airfield },
      { kind: 'gunboat', base: bases.navalyard },
      { kind: 'submarine', base: bases.navalyard },
      { kind: 'landingcraft', base: bases.navalyard },
    ].filter((e) => e.base);
    return g.showUnits(extra);
  }, war);
  log('injected (client only)', injected.length);
  await page.evaluate(() => window.__game.waitFrames(2));
  const civics = await page.evaluate(() => window.__game.getCivics());
  const civ = (def) => civics.find((c) => c.def === def);
  const units = () => page.evaluate(() => window.__game.getUnits());
  let current = quality;
  const snap = async (name, pose, frames = 2, q = quality) => {
    if (q !== current) {
      await page.evaluate((v) => window.__game.setSettings({ quality: v }), q);
      current = q;
    }
    await page.evaluate((p) => window.__game.setCamera(p), pose);
    await page.evaluate((n) => window.__game.waitFrames(n), frames);
    await page.screenshot({ path: `${out}/${name}.png`, timeout: 240000 });
    const st = await page.evaluate(() => window.__game.getState());
    const br = await page.evaluate(() => window.__game.renderBreakdown().find((b) => b.name === 'units'));
    log(
      name,
      'units',
      JSON.stringify(st.renderStats.units),
      'calls',
      st.renderStats.calls,
      'tris',
      st.renderStats.triangles,
      'group',
      JSON.stringify(br),
    );
  };
  /** Advance the clock a little at a time until some unit is doing `what` (and `pred`). */
  const until = async (what, pred = () => true, step = 15, max = 200) => {
    for (let k = 0; k < max; k++) {
      const list = (await units()).filter((u) => u.doing === what && pred(u));
      if (list.length) return list;
      await page.evaluate(async (s) => {
        await window.__game.advance(s);
        await window.__game.waitFrames(1);
      }, step);
    }
    return [];
  };
  const counts = async () => {
    const list = await units();
    const by = {};
    for (const u of list) by[`${u.kind}:${u.doing}`] = (by[`${u.kind}:${u.doing}`] ?? 0) + 1;
    return { n: list.length, by };
  };
  log('units now', JSON.stringify(await counts()));
  const hq = civ('militaryhq');
  if (want('overview') && hq)
    await snap('overview', { x: hq.x + 250, z: hq.z - 150, distance: 1300, yaw: 0.3, tilt: 0.05 }, 2, wide);
  const bar = civ('barracks');
  if (bar) {
    // Parked first (outside a drill), then on drills.
    if (want('barracks')) {
      await until('parked', (u) => u.kind === 'infantry');
      const drilling = (await units()).some((u) => u.kind === 'infantry' && u.doing === 'drill');
      if (!drilling) await snap('barracks', { x: bar.x, z: bar.z, distance: 70, yaw: 0.5, tilt: 0.05 });
    }
    if (want('drill')) {
      const list = await until('drill', (u) => u.kind === 'infantry', 30, 60);
      log('drill', list.length);
      await page.evaluate(async () => {
        await window.__game.advance(40);
      });
      await snap('drill', { x: bar.x, z: bar.z, distance: 60, yaw: 0.9, tilt: 0.1 });
    }
  }
  const dep = civ('vehicledepot');
  if (dep) {
    if (want('depot')) await snap('depot', { x: dep.x, z: dep.z, distance: 80, yaw: 2.6, tilt: 0.05 });
    if (want('pad')) {
      const list = await until('drill', (u) => u.kind === 'tank' || u.kind === 'heavytank', 30, 60);
      log('pad drill', list.length);
      if (list.length) await snap('pad', { x: list[0].x, z: list[0].z, distance: 45, yaw: 2.4, tilt: 0.1 });
    }
    if (want('patrol')) {
      const list = await until('patrol', () => true, 20, 120);
      log('patrol', list.length);
      if (list.length) {
        // Away from the base, out on a street.
        let best = list[0];
        for (let k = 0; k < 12; k++) {
          const l = (await units()).filter((u) => u.doing === 'patrol');
          const far = l.find((u) => Math.hypot(u.x - dep.x, u.z - dep.z) > 90);
          if (far) {
            best = far;
            break;
          }
          await page.evaluate(async () => {
            await window.__game.advance(12);
            await window.__game.waitFrames(1);
          });
        }
        await snap('patrol', { x: best.x, z: best.z, distance: 40, yaw: 0.7, tilt: 0.12 });
      }
    }
  }
  const air = civ('airfield');
  if (air) {
    if (want('airfield')) await snap('airfield', { x: air.x, z: air.z, distance: 180, yaw: 0.4, tilt: 0.05 });
    if (want('flying')) {
      const list = await until('flying', (u) => u.kind === 'fighter' || u.kind === 'bomber', 25, 120);
      log('planes flying', list.length);
      // Wait for one to leave the ground, then frame it with the airfield.
      for (let k = 0; k < 40; k++) {
        const l = (await units()).filter(
          (u) => (u.kind === 'fighter' || u.kind === 'bomber') && u.doing === 'flying',
        );
        const up = l.find((u) => u.y > (air.y ?? 0) + 25);
        if (up) {
          await snap('flying', { x: up.x, z: up.z, distance: 160, yaw: 0.4, tilt: 0.2 });
          break;
        }
        await page.evaluate(async () => {
          await window.__game.advance(4);
          await window.__game.waitFrames(1);
        });
      }
    }
    if (want('heli')) {
      for (let k = 0; k < 60; k++) {
        const l = (await units()).filter(
          (u) => (u.kind === 'helicopter' || u.kind === 'drone') && u.doing === 'flying',
        );
        const up = l.find((u) => Math.hypot(u.x - air.x, u.z - air.z) > 150);
        if (up) {
          await snap('heli', { x: up.x, z: up.z, distance: 70, yaw: 0.8, tilt: 0.3 });
          break;
        }
        await page.evaluate(async () => {
          await window.__game.advance(15);
          await window.__game.waitFrames(1);
        });
      }
    }
  }
  const nav = civ('navalyard');
  if (nav) {
    if (want('naval')) {
      await until('parked', (u) => u.kind === 'patrolboat');
      await snap('naval', { x: nav.x, z: nav.z, distance: 150, yaw: Math.PI - nav.angle, tilt: 0.05 });
    }
    if (want('sailing')) {
      const list = await until('sailing', () => true, 30, 120);
      log('sailing', list.length);
      for (let k = 0; k < 30; k++) {
        const l = (await units()).filter((u) => u.doing === 'sailing');
        const out = l.find((u) => Math.hypot(u.x - nav.x, u.z - nav.z) > 110);
        if (out) {
          await snap('sailing', { x: out.x, z: out.z, distance: 120, yaw: 0.6, tilt: 0.1 });
          break;
        }
        await page.evaluate(async () => {
          await window.__game.advance(10);
          await window.__game.waitFrames(1);
        });
      }
    }
  }
  if (want('dots') && hq) {
    await snap('dots', { x: hq.x + 300, z: hq.z - 200, distance: 2600, yaw: 0.3, tilt: 0.1 }, 2, wide);
  }
  if (want('night') && dep) {
    // To 22:00.
    await page.evaluate(async () => {
      const g = window.__game;
      const s = await g.getState();
      const now = (s.tick + 420) % 1440;
      let dt = 22 * 60 - now;
      if (dt <= 0) dt += 1440;
      await g.advance(dt);
    });
    await snap('night', { x: dep.x, z: dep.z, distance: 90, yaw: 2.6, tilt: 0.05 }, 4);
  }
  if (want('gallery')) {
    // Every war building's generated look, side by side on open ground west of the town.
    const ids = [
      'militaryhq',
      'barracks',
      'shelter',
      'bunker',
      'vehicledepot',
      'radar',
      'antiair',
      'coastalgun',
      'interceptor',
      'shieldgen',
      'armsfactory',
      'militarylab',
      'provingground',
      'spyagency',
      'domeshield',
      'blackouttower',
      'expressgate',
      'enrichment',
      'atomsilo',
      'airfield',
      'navalyard',
    ];
    const g0 = await page.evaluate(async ({ hw }) => {
      const g = window.__game;
      const s = await g.getState();
      const now = (s.tick + 420) % 1440;
      let dt = 13 * 60 - now;
      if (dt <= 0) dt += 1440;
      await g.advance(dt);
      return { x: hw.x + 40, z: hw.z + 420 };
    }, town);
    const shown = await page.evaluate(({ ids, g0 }) => window.__game.showWarModels(ids, g0, 260), {
      ids,
      g0,
    });
    log('gallery', shown.length);
    const rows = [
      ['militaryhq', 'barracks', 'shelter', 'bunker', 'vehicledepot', 'radar'],
      ['antiair', 'coastalgun', 'interceptor', 'shieldgen', 'armsfactory'],
      ['militarylab', 'provingground', 'spyagency', 'domeshield'],
      ['blackouttower', 'expressgate', 'enrichment', 'atomsilo'],
      ['airfield'],
      ['navalyard'],
    ];
    let k = 0;
    for (const row of rows) {
      const list = shown.filter((s) => row.includes(s.id));
      if (!list.length) continue;
      const xs = list.map((s) => s.x);
      const zs = list.map((s) => s.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const span = Math.max(...xs) - Math.min(...xs) + 60;
      await snap(
        `gallery-${k++}`,
        { x: cx, z: cz, distance: Math.max(110, span * 1.1), yaw: 0.25, tilt: 0.05 },
        3,
        span > 300 ? wide : quality,
      );
    }
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
