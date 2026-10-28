// Dev (M37): weapon development's looks. A coast town with rival neighbours, its research done, the
// new buildings (lab, proving ground, spy agency, interceptor, shield generator, and the dome, tower
// and gate with their stages cheated done); screenshots of a prototype on trial, the superweapons
// parked at their bases, the gate's swirl and the tower's ring, a staged battle under the dome
// (shield bubbles, interceptors) and the robot's stomp. Prints the draw cost of each view.
// Usage: node scripts/dev/supershot.mjs outDir   (after npm run build:test)
// Env: ONLY=trial,parked,gate,tower,dome,shields,low,robot   QUALITY=medium   PORT=4392   SEED=port
//   (`shields` also takes the interceptors' shot, `low` the Low dome; every shot is in clear
//   weather with the interface and problem icons hidden.)
// Notes on what the shots need (each learnt the hard way):
//  - The town is big enough (about 4,000 people) that the forces' quarter of the workers staffs the
//    HQ, the dome, the tower, the agency and the gate (which is last in line, after them); the power
//    is a nuclear plant, since coal plants' smoke and land value hold a town this size back. The
//    gate and tower shots come before any battle: a raid closes the buildings it damages (the HQ,
//    the gate) and kills homes.
//  - A real tank is trained first: the proving ground's stand-in is only drawn when the city has
//    at least one unit (src/render/units.ts update(); see the note in the trial shot).
//  - The superweapons are shown on the page only (training one takes fifteen days), and each idles
//    (patrols, flies, sails) on a cycle set by its id: a shot of one parked at its base tries ids
//    until it is home at the hour, invisible padding units (base 0) moving the id along.
//  - The dome stands over every building of the city, from its own building out to the farthest (the
//    naval yard on the shore): it goes by the link road at the town's east edge (1,000 m, where the
//    far end of the town was 1,500), and the shield generator in the town's middle, so its bubble
//    covers the town.
//  - The shells and the tower's ring are additive light: they show against a dusk sky, hardly in
//    full sun. So the tower and the battle at home (dome, bubble, interceptors) are shot at dusk, the
//    rest (and the robot's stomp) in daylight.
//  - A raid's robot walks into the town, stands and stomps, then pulls out, all within about 150
//    ticks: the shot steps the battle until the robot has stopped in the town and aims at it.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'super-shots';
mkdirSync(out, { recursive: true });
const port = Number(process.env.PORT ?? 4392);
const quality = process.env.QUALITY ?? 'medium';
const only = process.env.ONLY?.split(',');
const want = (n) => !only || only.includes(n);
const VIEW = { width: 960, height: 600 };
// A frame costs next to nothing in a window this small: where the page only has to settle poses.
const TINY = { width: 200, height: 125 };
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
  const page = await browser.newPage({ viewport: VIEW });
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
    // Four streets from the military strip's end in the north down to the utilities in the south.
    for (const x of [96, 192, 288, 384])
      await d({ type: 'buildRoad', road: 'street', points: [at(x, -300), at(x, 160)] });
    const brush = (zone, a, b, radius) =>
      d({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
    await brush('R', at(20, -100), at(480, -100), 70);
    await brush('R', at(20, -230), at(480, -230), 70);
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
    // Power from one nuclear plant: coal plants' smoke and land value stop a town this size growing,
    // and a dome, tower and gate draw 1,900 between them.
    for (const def of [
      'coal',
      'coal',
      'coal',
      'nuclear',
      'pump',
      'pump',
      'pump',
      'pump',
      'pump',
      'pump',
      'treatment',
      'treatment',
      'landfill',
    ])
      if ((await g.placeCivic(def, at(240, util))) === null) fails.push(`place ${def}`);
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
    // In the town's middle, so the bubble (300 m) covers the town.
    if ((await put('shieldgen', at(300, 40))) === null) await put('shieldgen', at(380, -160));
    await put('interceptor', at(150, 160));
    await put('blackouttower', at(440, 160));
    await put('spyagency', at(20, -160));
    for (const dz of [-420, -480, -540, -360]) {
      const pts = [at(40, dz), at(800, dz)];
      if (!(await g.preview({ type: 'buildRoad', road: 'avenue', points: pts })).ok) continue;
      await d({ type: 'buildRoad', road: 'avenue', points: pts });
      await d({ type: 'buildRoad', road: 'street', points: [at(96, dz), at(96, -300)] });
      await put('airfield', at(420, dz));
      await put('provingground', at(200, dz));
      await put('expressgate', at(700, dz));
      break;
    }
    let shoreX = null;
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
      if ((await put('navalyard', { x, z: hw.z - 150 })) !== null) {
        shoreX = x;
        break;
      }
    }
    // The dome covers every building out to the farthest (the naval yard, on the shore). A civic put
    // "near" a point stands at the start of the nearest road, so this is the link road's, at the
    // town's east edge: about 1,000 m to the yard, where the town's west end made it 1,500.
    if (shoreX === null || (await put('domeshield', at(560, 30))) === null)
      await put('domeshield', at(60, 160));
    const st = await g.getState();
    for (const n of st.region.neighbours.filter((x) => x.rival))
      await d({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
    await g.advance(60 * 12);
    // A real tank (the gate sends it, the proving ground needs a unit on the roster to show its
    // stand-in).
    await d({ type: 'trainUnit', base: ids.vehicledepot, kind: 'tank' });
    for (let k = 0; k < 20 && !(await g.getForces()).units.some((u) => u.kind === 'tank'); k++)
      await g.advance(720);
    if (!(await g.getForces()).units.some((u) => u.kind === 'tank')) fails.push('no tank trained');
    return { ids, fails };
  });
  log('built', JSON.stringify(built));
  const civics = await page.evaluate(() => window.__game.getCivics());
  const civ = (def) => civics.find((c) => c.def === def);
  const growth = await page.evaluate(async () => {
    const s = await window.__game.getState();
    return { population: s.population, workers: s.workers, power: s.utilities.power };
  });
  log('town', JSON.stringify(growth));
  // Clear weather and no interface or icons in every shot.
  await page.addStyleTag({ content: '#ui { display: none !important; }' });
  await page.evaluate(() => {
    const g = window.__game;
    g.showGroup('icons', false);
    g.setWeatherLook({ season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 });
  });
  let current = quality;
  /** Shoot `name` from `pose`; `q` switches the quality first (and stays). */
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
  /** Into the day (10:00 unless it is between 9:00 and 16:00 already): a shot is in daylight. */
  const daylight = () =>
    page.evaluate(async () => {
      const g = window.__game;
      const s = await g.getState();
      const now = (s.tick + 420) % 1440;
      if (now >= 9 * 60 && now < 16 * 60) return;
      await g.advance((10 * 60 - now + 1440) % 1440);
    });
  /** Advance to a given hour (the next time it is that hour). */
  const toHour = (h) =>
    page.evaluate(async (hour) => {
      const g = window.__game;
      const now = (((await g.getState()).tick + 420) % 1440) / 60;
      await g.advance(Math.round(((hour - now + 24) % 24) * 60));
    }, h);
  /** Run a battle out (the next shot starts clean). */
  const finishBattle = () =>
    page.evaluate(async () => {
      const g = window.__game;
      for (let k = 0; k < 80 && (await g.getBattle()).frame; k++) await g.advance(60);
    });
  await daylight();

  // A prototype on trial at the proving ground, running its track.
  const ground = civ('provingground');
  if (want('trial') && ground) {
    const trial = await page.evaluate(async (id) => {
      const g = window.__game;
      const r = await g.dispatch({ type: 'startTrial', ground: id, kind: 'heavytank' });
      await g.advance(90);
      await g.waitFrames(3);
      const research = await g.getResearch();
      const stand = g.getUnits().find((u) => u.doing === 'trial');
      return {
        started: r.ok ? 'ok' : r.reason,
        trials: research?.trials ?? null,
        units: (await g.getForces())?.units.length ?? null,
        standIn: stand ?? null,
      };
    }, ground.id);
    log('trial', JSON.stringify(trial));
    // BUG (src/render/units.ts, update(), "War off, or no units yet"): with no unit on the roster the
    // renderer returns before it poses the prototype on trial, so a city that has researched and
    // started a trial but trained nothing sees an empty track. This town has a tank.
    const at = trial.standIn ?? { x: ground.x, z: ground.z };
    await snap('trial', { x: at.x, z: at.z, distance: 55, yaw: 0.7, tilt: 0.1 }, 4);
  }

  // The gate: a tank sent through it, the swirl while it goes (the hour after, it has faded).
  const gate = civ('expressgate');
  if (want('gate') && gate) {
    const sent = await page.evaluate(async () => {
      const g = window.__game;
      const s = await g.getState();
      const rival = s.region.neighbours.find((n) => n.rival);
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
    });
    log('gate', sent ?? 'ok');
    await snap('gate', { x: gate.x, z: gate.z, distance: 110, yaw: 0.5, tilt: 0.15 });
  }

  // The tower charging at a rival: its ring glows (it is additive light: at dusk it shows, in full
  // sun it hardly does).
  const tower = civ('blackouttower');
  if (want('tower') && tower) {
    await toHour(20);
    const r = await page.evaluate(async () => {
      const g = window.__game;
      const s = await g.getState();
      const rival = s.region.neighbours.find((n) => n.rival);
      const res = await g.dispatch({ type: 'useBlackout', neighbour: rival.id });
      return res.ok ? null : res.reason;
    });
    log('tower', r ?? 'ok');
    await snap('tower', { x: tower.x, z: tower.z, distance: 150, yaw: 0.4, tilt: 0.03 });
  }

  // The superweapons parked at home (shown on the page only: training takes fifteen days). Each
  // idles on a cycle that its id sets, so the shot tries ids until the unit is at its base now.
  if (want('parked')) {
    await toHour(11.5);
    const parkAt = async (kind, def) => {
      await page.setViewportSize(TINY);
      const u = await page.evaluate(
        async ({ kind, base }) => {
          const g = window.__game;
          for (let pad = 0; pad < 60; pad++) {
            // superReady has the sim send the forces again, which wipes the units shown before.
            await g.dispatch({ type: 'cheat', cheat: 'superReady' });
            g.showUnits([...Array(pad).fill({ kind: 'infantry', base: 0 }), { kind, base }]);
            await g.waitFrames(1);
            const u = g.getUnits().find((x) => x.kind === kind);
            if (u?.doing === 'parked') return { ...u, pad };
          }
          return null;
        },
        { kind, base: civ(def)?.id },
      );
      await page.setViewportSize(VIEW);
      log('parked', kind, JSON.stringify(u));
      return u;
    };
    const robot = civ('vehicledepot') && (await parkAt('windupbot', 'vehicledepot'));
    if (robot) await snap('parked-robot', { x: robot.x, z: robot.z, distance: 110, yaw: 2.6, tilt: 0.1 });
    const fortress = civ('airfield') && (await parkAt('skyfortress', 'airfield'));
    if (fortress)
      await snap('parked-fortress', { x: fortress.x, z: fortress.z, distance: 190, yaw: 0.4, tilt: 0.1 });
    const whale = civ('navalyard') && (await parkAt('clockworkwhale', 'navalyard'));
    if (whale) await snap('parked-whale', { x: whale.x, z: whale.z, distance: 170, yaw: 1.4, tilt: 0.12 });
  }

  const hq = civ('militaryhq');
  const dome = civ('domeshield');
  // A battle at home under the dome: the dome raised, shield bubbles, interceptors bursting shells
  // (at dusk, where the shells show).
  if ((want('dome') || want('shields') || want('low')) && hq) {
    await toHour(18.3);
    const why = await page.evaluate(async () => {
      const g = window.__game;
      await g.dispatch({ type: 'cheat', cheat: 'superReady' });
      const r = await g.stageBattle('max');
      if (r) return r;
      await g.advance(40);
      return null;
    });
    log('staged', why ?? 'ok');
    // The dome's reach, as the effect works it out (shields.ts domeSpot): round its own building,
    // out to the farthest civic or building.
    const reach = await page.evaluate(async (domeId) => {
      const g = window.__game;
      const civs = await g.getCivics();
      const d = civs.find((c) => c.id === domeId);
      if (!d) return null;
      let r = 300;
      for (const o of civs) r = Math.max(r, Math.hypot(o.x - d.x, o.z - d.z) + 40);
      for (const b of await g.getBuildings()) r = Math.max(r, Math.hypot(b.x - d.x, b.z - d.z) + 30);
      return Math.min(2000, r);
    }, dome?.id);
    log('dome reach', reach);
    const view = dome && reach ? { x: dome.x, z: dome.z, distance: Math.min(3400, reach * 2.7) } : hq;
    const domeView = { ...view, yaw: 0.3, tilt: 0.12 };
    if (want('dome')) await snap('dome', domeView, 4);
    if (want('shields')) {
      const sg = civ('shieldgen');
      // The bubbles are drawn in full at High: Medium keeps only a faint rim.
      await snap(
        'shields',
        { x: sg?.x ?? hq.x, z: sg?.z ?? hq.z, distance: 600, yaw: 0.8, tilt: 0.15 },
        4,
        'high',
      );
      await page.evaluate(() => window.__game.followBattle());
      await snap('intercept', await page.evaluate(() => window.__game.getCamera()), 4);
    }
    if (want('low')) await snap('dome-low', domeView, 4, 'low');
    await finishBattle();
  }

  // The robot stomping (a staged raid with it among the raiders): it walks into the town, stands and
  // stomps, and pulls out again within about 150 ticks, so the battle is stepped until it has stopped.
  if (want('robot') && hq) {
    await daylight();
    const why = await page.evaluate(async () => {
      const g = window.__game;
      return await g.stageBattle('robot');
    });
    log('robot raid', why ?? 'ok');
    const found = await page.evaluate(async () => {
      const g = window.__game;
      const trace = [];
      let robot = null;
      let inTown = null;
      const look = async (ticks) => {
        await g.advance(ticks);
        await g.waitFrames(1);
        robot = g.getUnits().find((u) => u.kind === 'windupbot' && u.doing === 'battle') ?? robot;
        const b = await g.getBattle();
        trace.push(
          `${robot ? `${Math.round(robot.x)},${Math.round(robot.z)}` : '-'}/${b.frame ? b.frame.step : 'over'}`,
        );
        if (robot && b.frame && robot.x >= 24) inTown = robot;
      };
      // To the first street (120 m in from the highway), then a few ticks on, where it stomps.
      for (let k = 0; k < 60 && !(robot && robot.x >= 120); k++) await look(8);
      await look(8);
      return { robot: inTown ?? robot, trace: trace.join(' ') };
    });
    log('robot', JSON.stringify(found.robot), found.trace);
    const at = found.robot ?? hq;
    await snap('robot', { x: at.x, z: at.z, distance: 130, yaw: 0.9, tilt: 0.15 }, 3);
    await finishBattle();
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
