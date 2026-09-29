import { expect, test } from '@playwright/test';
import { shot, watchErrors } from './helpers';
import { frames, settings, state } from './ui';

/**
 * Phase 2 review: at a level crossing the barriers come down while a train passes and cars wait at
 * the line; trams and cars on a shared avenue keep out of each other's way. The M20 rail scene
 * (scripts/dev/railshot.mjs): an avenue with tram track, a street across a railway with two
 * stations on it, and a freight terminal on the regional link.
 */
test('Phase 2 review: barriers come down for trains, cars wait for them, and trams and cars keep apart', async ({
  page,
}) => {
  test.setTimeout(600_000);
  const errs = watchErrors(page);
  await settings(page);
  await page.goto('./?paused=1&seed=goods');
  await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 90_000 });
  const info = await page.evaluate(async () => {
    const g = window.__game!;
    const d = (cmd: Parameters<typeof g.dispatch>[0]) => g.dispatch(cmd);
    await d({ type: 'cheat', cheat: 'unlockAll' });
    await d({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    const s = await g.getState();
    const c = { x: 24, z: s.highwayZ };
    const rail = s.railway!;
    const dir = Math.sign(rail.z - c.z) || 1;
    const at = (dx: number, dz: number) => ({ x: c.x + dx, z: c.z + dz });
    const rz = rail.z - c.z;
    await d({ type: 'buildRoad', road: 'avenue', points: [c, at(640, 0)] });
    for (const x of [120, 220, 420, 520])
      await d({ type: 'buildRoad', road: 'street', points: [at(x, -dir * 170), at(x, dir * 170)] });
    await d({ type: 'buildRoad', road: 'street', points: [at(320, -dir * 170), at(320, rz + dir * 110)] });
    await d({ type: 'buildRoad', road: 'rail', points: [{ x: rail.x, z: rail.z }, at(760, rz)] });
    const brush = (
      zone: 'R' | 'C' | 'I',
      a: { x: number; z: number },
      b: { x: number; z: number },
      radius: number,
    ) => d({ type: 'zone', zone, area: { kind: 'brush', points: [a, b], radius } });
    await brush('R', at(40, -dir * 100), at(600, -dir * 100), 75);
    await brush('C', at(40, dir * 20), at(600, dir * 20), 25);
    await brush('R', at(40, dir * 110), at(300, dir * 110), 55);
    await brush('R', at(330, rz + dir * 60), at(330, rz + dir * 100), 40);
    await brush('I', at(420, dir * 120), at(600, dir * 120), 55);
    for (const def of ['coal', 'pump', 'pump', 'pump', 'treatment', 'landfill'])
      await g.placeCivic(def, at(560, -dir * 170));
    for (const [def, x, dz] of [
      ['firestation', 120, -60],
      ['police', 420, -60],
      ['clinic', 220, 60],
      ['primary', 520, -110],
    ] as const)
      await g.placeCivic(def, at(x, dir * dz));
    await g.placeCivic('station', at(150, rz));
    await g.placeCivic('station', at(560, rz));
    for (let x = 30; x <= 630; x += 20) {
      const sg = g.segmentAt(c.x + x, c.z);
      if (sg && sg.type === 'avenue') await d({ type: 'setTram', seg: sg.id, on: true });
    }
    await g.placeCivic('tramdepot', at(80, 0));
    for (const x of [110, 270, 370, 470, 600])
      await d({ type: 'placeStop', x: c.x + x, z: c.z + dir * 8, tram: true });
    await g.advance(3 * 1440);
    // The morning rush.
    const now = ((await g.getState()).tick + 420) % 1440;
    await g.advance((8 * 60 - now + 1440) % 1440 || 1440);
    return { c, rz, crossing: at(320, rz) };
  });
  const st = await state(page);
  expect(st.population).toBeGreaterThan(500);
  const crossing = (await page.evaluate(() => window.__game!.getCrossings())).find(
    (x) => Math.hypot(x.x - info.crossing.x, x.z - info.crossing.z) < 4,
  );
  expect(crossing, 'the street crosses the railway on the level').toBeDefined();
  await page.evaluate(
    (p) => window.__game!.setCamera({ x: p.x, z: p.z, distance: 90, yaw: 0.6, tilt: 0.2 }),
    info.crossing,
  );
  await page.evaluate(() => window.__game!.setSpeed(1));

  // Watch for a while: the barriers, the cars at the crossing, and the cars round the trams.
  let closedSeen = 0;
  let downSeen = 0;
  let onWhileDown = 0;
  let queued = 0;
  let tramSamples = 0;
  let overlaps = 0;
  let shotTaken = false;
  for (let k = 0; k < 160; k++) {
    await frames(page, 1);
    const r = await page.evaluate(() => {
      const g = window.__game!;
      return { x: g.getCrossings(), cars: g.getCars(), trams: g.getTrams() };
    });
    const x = r.x.find((q) => q.node === crossing!.node)!;
    if (x.closed) closedSeen++;
    if (x.down > 0.99) {
      downSeen++;
      for (const c of r.cars.filter((c) => Math.hypot(c.x - x.x, c.z - x.z) < 5)) {
        onWhileDown++;
        console.log(
          `[crossings] frame ${k}: car ${c.id} on the crossing with the barriers down, ${Math.hypot(c.x - x.x, c.z - x.z).toFixed(1)} m from it, road ${c.seg} leg ${c.leg}/${c.legs} at ${c.t.toFixed(1)} m, waited ${c.waited.toFixed(1)}`,
        );
      }
      queued += r.cars.filter((c) => c.waited > 0 && Math.hypot(c.x - x.x, c.z - x.z) < 30).length;
      if (!shotTaken && queued > 0) {
        await shot(page, 'review-crossing-down');
        shotTaken = true;
      }
    }
    // A car inside a tram's body, lined up with it: within 1.2 m of the tram's line along its track
    // (points from front to rear), or up to 2 m past either end, heading along it or against it.
    for (const t of r.trams) {
      tramSamples++;
      const p = t.pts;
      for (const c of r.cars) {
        for (let i = 0; i + 3 < p.length; i += 2) {
          const ax = p[i]!;
          const az = p[i + 1]!;
          const sl = Math.hypot(p[i + 2]! - ax, p[i + 3]! - az);
          if (sl < 1e-6) continue;
          const ux = (p[i + 2]! - ax) / sl;
          const uz = (p[i + 3]! - az) / sl;
          const along = (c.x - ax) * ux + (c.z - az) * uz;
          const lo = i === 0 ? -2 : 0;
          const hi = i + 4 >= p.length ? sl + 2 : sl;
          if (along < lo || along > hi) continue;
          const lateral = Math.abs((c.z - az) * ux - (c.x - ax) * uz);
          const heading = Math.cos(c.heading) * ux + Math.sin(c.heading) * uz;
          if (lateral >= 1.2 || Math.abs(heading) <= 0.7) continue;
          overlaps++;
          // Where and how, to trace it: the car's road, lane and leg, and the tram's ends.
          const rel = (x: number, z: number) => `${(x - info.c.x).toFixed(1)},${(z - info.c.z).toFixed(1)}`;
          console.log(
            `[crossings] frame ${k}: car ${c.id} at ${rel(c.x, c.z)} inside a tram (${(i + along).toFixed(1)} m from its front, ${lateral.toFixed(2)} m aside, heading ${heading.toFixed(2)}), road ${c.seg} lane ${c.lane} leg ${c.leg}/${c.legs} at ${c.t.toFixed(1)} m, waited ${c.waited.toFixed(1)}; tram ${rel(t.fx, t.fz)} to ${rel(t.rx, t.rz)}`,
          );
          break;
        }
      }
    }
  }
  await page.evaluate(() => window.__game!.setSpeed(0));
  const rs = (await state(page)).renderStats;
  console.log(
    `[crossings] visible cars ${rs.cars ?? '?'}, their cost ${rs.trafficMs?.toFixed(2) ?? '?'} ms a frame`,
  );
  console.log(
    `[crossings] closed ${closedSeen}/160 frames, barriers down ${downSeen}, cars on the crossing while down ${onWhileDown}, cars queued at it ${queued}; ${tramSamples} tram samples, ${overlaps} cars inside a tram`,
  );
  expect(closedSeen).toBeGreaterThan(0);
  expect(downSeen).toBeGreaterThan(0);
  expect(onWhileDown).toBe(0);
  expect(tramSamples).toBeGreaterThan(0);
  expect(overlaps).toBe(0);
  if (!shotTaken) await shot(page, 'review-crossing-down');
  errs.check();
});
