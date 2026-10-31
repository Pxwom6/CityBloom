import { beforeAll, describe, expect, it } from 'vitest';
import { ATOM } from '../../src/data/atom';
import { GRID_CELL, GRID_RES, MAP_SIZE } from '../../src/data/world';
import { ZONE_R } from '../../src/data/zones';
import type { Sim } from '../../src/sim/sim';
import { partHashes } from '../../src/sim/sync';
import { atomTick, bombMood } from '../../src/sim/systems/atom';
import { groundZero, impactSlice } from '../../src/sim/systems/atomImpact';
import { raidMood } from '../../src/sim/systems/raids';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { BState, type Building } from '../../src/sim/world/buildings';
import { clone, rivals } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40, step 3, the blast (docs/plans/M40-design.md, call 10): where a bomb falls and what it does to
 * the city under it, in hourly slices. Ground zero is moved by hand where a test wants a ring of
 * buildings round it (the scripted town is only 750 m long); the densest-district rule is tested on
 * its own. The blast is dealt out by calls to `atomTick` (a landing at once) and `impactSlice`, or
 * by stepping the real clock where the hours between slices are the point.
 */

const H = TICKS_PER_HOUR;
const L = ATOM.impact;

/** The west end of the scripted town: buildings inside the blast, in the ring round it, and far beyond. */
const WEST = { x: 48, z: 600 };
/** Further east: the military HQ stands just outside the blast, in the ring where civics close. */
const MID = { x: 300, z: 600 };

let base: Sim;

beforeAll(() => {
  const { sim } = labTown(0, { length: 800, streets: 7 });
  // The neighbours go dark for ever: no raids and no spies.
  for (const n of rivals(sim)) n.rival!.blackout = { from: 0, until: 1e9 };
  // The scripted town has the room for a hundred fires: a few more days for it to settle.
  sim.advance(2 * 1440);
  base = sim;
}, 120_000);

const atom = (sim: Sim) => sim.state.war!.atom!;
const events = (sim: Sim, kind: string) => sim.events.filter((e) => e.kind === kind);
const dist = (b: { x: number; z: number }, at: { x: number; z: number }) =>
  Math.hypot(b.x - at.x, b.z - at.z);

/**
 * A copy of the town with a bomb about to land on `at` (ground zero set by hand), after a battle
 * begun in the city if asked (no raid begins once a bomb is in the air).
 */
function aimed(at: { x: number; z: number }, hours = 0, battle = false): Sim {
  const sim = clone(base);
  if (battle) ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: rivals(sim)[0]!.id });
  ok(sim, { type: 'cheat', cheat: 'bombIn', hours });
  const hit = atom(sim).inbound!;
  hit.x = at.x;
  hit.z = at.z;
  return sim;
}

/** Buildings still standing, by where they are relative to ground zero. */
function sets(sim: Sim, at: { x: number; z: number }) {
  const standing = [...sim.state.buildings.values()].filter((b) => b.state !== BState.Rubble);
  return {
    inside: standing.filter((b) => dist(b, at) <= L.level),
    ring: standing.filter((b) => dist(b, at) > L.level && dist(b, at) <= L.level * L.fireReach),
    far: standing.filter((b) => dist(b, at) > L.level * L.fireReach),
  };
}

/**
 * Ticks of the atom system alone (the world stands still) until the blast is over: the civic
 * buildings inside come down a few every tick, the buildings in hourly slices. Says how many.
 */
function blast(sim: Sim, limit = 2_000): number {
  let n = 0;
  while (!atom(sim).impact?.over && n++ < limit) {
    sim.state.tick++;
    atomTick(sim);
  }
  expect(atom(sim).impact?.over, 'the blast ended').toBe(true);
  return n;
}

/** What a building is, for "did anything about it change". */
const frozen = (b: Building) => JSON.stringify(b);

/** Every random stream the sim keeps, and the war's own: their states. */
function streams(sim: Sim): string {
  const out: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(sim.rng)) out[k] = r.getState();
  out.war = sim.state.war!.rng;
  return JSON.stringify(out);
}

/** Run `fn` with the slice limit lowered (the scripted town has fewer than 400 buildings inside), then restore it. */
function withSlice<T>(slice: number, fn: () => T): T {
  const was = L.slice;
  L.slice = slice;
  try {
    return fn();
  } finally {
    L.slice = was;
  }
}

describe('M40: the blast', () => {
  it('levels everything within the radius, leaves everything beyond the fire reach as it was, and sets fires between', () => {
    const sim = aimed(WEST);
    const before = sets(sim, WEST);
    expect(before.inside.length).toBeGreaterThan(100);
    expect(before.ring.length).toBeGreaterThan(50);
    expect(before.far.length).toBeGreaterThan(10);
    const farBefore = before.far.map(frozen);
    const homes = before.inside.filter((b) => b.zone === ZONE_R);
    const homesPop = homes.reduce((n, b) => n + b.pop, 0);
    expect(homesPop).toBeGreaterThan(0);
    const burningBefore = new Set(sim.state.burning);
    const incidents = sim.state.incidents.size;

    atomTick(sim);
    blast(sim);

    // Everything standing within the blast is rubble now (the whole town's inside is under 400).
    expect(before.inside.length).toBeLessThanOrEqual(L.slice);
    for (const b of before.inside) {
      const now = sim.state.buildings.get(b.id)!;
      expect(now.state, `building ${b.id} at ${Math.round(dist(b, WEST))} m`).toBe(BState.Rubble);
      expect(now.pop).toBe(0);
    }
    // None beyond 1.5 times it is touched.
    expect(before.far.map((b) => frozen(sim.state.buildings.get(b.id)!))).toEqual(farBefore);
    // Between: nothing is levelled, some are burning, only new fires (none lit by the blast beyond the ring).
    const lit = before.ring.filter(
      (b) => sim.state.buildings.get(b.id)!.fire > 0 && !burningBefore.has(b.id),
    );
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.length).toBeLessThanOrEqual(L.fires);
    expect(before.ring.every((b) => sim.state.buildings.get(b.id)!.state !== BState.Rubble)).toBe(true);
    expect(sim.state.burning.every((id) => burningBefore.has(id) || lit.some((b) => b.id === id))).toBe(true);
    // The closer, the likelier: the burning ones are nearer, on the whole, than the ones that are not.
    const mean = (bs: Building[]) => bs.reduce((n, b) => n + dist(b, WEST), 0) / bs.length;
    const unlit = before.ring.filter((b) => !lit.includes(b));
    if (unlit.length) expect(mean(lit)).toBeLessThan(mean(unlit));

    // The residents of the levelled homes are counted as having left, and nothing says more.
    const im = atom(sim).impact!;
    expect(im).toMatchObject({ over: true, done: 1, x: WEST.x, z: WEST.z, levelled: before.inside.length });
    expect(im.fled).toBe(homesPop);
    expect(atom(sim)).toMatchObject({ boom: 1, stopped: 0 });
    expect(atom(sim).inbound).toBeUndefined();
    expect(events(sim, 'bombLanded')).toHaveLength(1);
    expect(events(sim, 'atomImpact')).toEqual([
      expect.objectContaining({
        info: expect.objectContaining({
          fled: homesPop,
          levelled: before.inside.length,
          x: WEST.x,
          z: WEST.z,
        }),
      }),
    ]);
    // Not a disaster, no ambulance, no incident, no one named a casualty.
    expect(sim.state.disasters).toHaveLength(0);
    expect(sim.state.incidents.size).toBe(incidents);
    expect([...sim.state.vehicles.values()].filter((v) => v.kind === 'ambulance')).toHaveLength(0);
    expect(events(sim, 'disaster')).toHaveLength(0);
    expect(events(sim, 'disasterOver')).toHaveLength(0);
    expect(JSON.stringify(sim.events)).not.toMatch(/casualt|killed|dead|victim/i);
  });

  it('takes the civic buildings inside it, closes those in the ring, shuts the roads, clears the trees and leaves a crater', () => {
    const sim = aimed(MID);
    const s = sim.state;
    const civics = [...s.civics.values()];
    const inside = civics.filter((c) => dist(c, MID) <= L.level);
    const ring = civics.filter((c) => dist(c, MID) > L.level && dist(c, MID) <= L.level * L.civicReach);
    const far = civics.filter((c) => dist(c, MID) > L.level * L.civicReach);
    expect(inside.length).toBeGreaterThan(3);
    expect(ring.map((c) => c.def)).toContain('militaryhq');
    const closedBefore = new Map(far.map((c) => [c.id, c.damage]));
    // Roads: every segment that reaches into the blast; the regional highway is left open.
    const segs = [...s.net.segments.keys()].filter((id) => {
      if (id === s.highway.segment) return false;
      const p = sim.net.curve(id).project(MID);
      return p.d <= L.level;
    });
    expect(segs.length).toBeGreaterThan(2);
    // Trees: put some in and round the blast, count what is cleared and what is not.
    const cell = (x: number, z: number) => Math.floor(z / GRID_CELL) * GRID_RES + Math.floor(x / GRID_CELL);
    const inTrees = [
      cell(MID.x, MID.z - 600),
      cell(MID.x + 300, MID.z + 300),
      cell(MID.x - 100, MID.z + 500),
    ];
    const outTree = cell(MID.x, MID.z - 700 - GRID_CELL * 2);
    for (const i of [...inTrees, outTree]) s.trees[i] = 3;
    for (const i of inTrees)
      expect(
        dist({ x: ((i % GRID_RES) + 0.5) * GRID_CELL, z: (Math.floor(i / GRID_RES) + 0.5) * GRID_CELL }, MID),
      ).toBeLessThan(L.level * L.treeReach);
    const treesFar = s.trees[outTree];

    atomTick(sim);
    const landed = s.tick;
    // The ring's civics close at once; the civic buildings inside come down a few a tick, nearest
    // first, from the second tick after the landing (the first sets the fires).
    const gone = () => inside.filter((c) => !s.civics.has(c.id));
    const nearest = [...inside].sort((a, b) => dist(a, MID) - dist(b, MID) || a.id - b.id);
    expect(inside.length).toBeGreaterThan(L.civicsPerTick * 2);
    expect(gone()).toHaveLength(0);
    for (const c of ring) expect(s.civics.get(c.id)!.damage).toBeGreaterThan(0);
    s.tick++;
    atomTick(sim);
    expect(atom(sim).impact!.fires).toBe(true);
    expect(gone()).toHaveLength(0);
    for (let k = 1; k <= 2; k++) {
      s.tick++;
      atomTick(sim);
      expect(
        gone()
          .map((c) => c.id)
          .sort((a, b) => a - b),
      ).toEqual(
        nearest
          .slice(0, k * L.civicsPerTick)
          .map((c) => c.id)
          .sort((a, b) => a - b),
      );
    }
    const ticks = blast(sim);
    expect(ticks).toBeLessThanOrEqual(Math.ceil(inside.length / L.civicsPerTick));

    for (const c of inside) expect(s.civics.has(c.id), `${c.def} inside`).toBe(false);
    for (const c of ring) {
      const now = s.civics.get(c.id)!;
      expect(now.damage, `${c.def} in the ring`).toBeGreaterThan(0);
      expect(now.damage).toBeLessThanOrEqual(L.civicClosed);
    }
    for (const c of far) expect(s.civics.get(c.id)!.damage).toBe(closedBefore.get(c.id));
    expect(events(sim, 'civicDestroyed')).toHaveLength(inside.length);
    for (const id of segs)
      expect(s.roadDamage.get(id) ?? 0, `segment ${id}`).toBeGreaterThanOrEqual(L.roadClosed);
    expect(s.roadDamage.has(s.highway.segment)).toBe(false);
    for (const i of inTrees) expect(s.trees[i]).toBe(0);
    expect(s.trees[outTree]).toBe(treesFar);
    expect(s.craters).toEqual([{ x: MID.x, z: MID.z, r: L.crater, tick: landed }]);
  });

  it('is dealt out in slices of at most the limit, one an hour, nearest first, and a save in the middle carries on exactly', () => {
    // (The limit itself is 400; the scripted town has fewer than that inside, so it is lowered to see slices.)
    expect(L.slice).toBe(400);
    withSlice(40, () => {
      const sim = aimed(MID);
      const order = sets(sim, MID)
        .inside.map((b) => ({ id: b.id, d: dist(b, MID) }))
        .sort((a, b) => a.d - b.d || a.id - b.id)
        .map((x) => x.id);
      expect(order.length).toBeGreaterThan(200);
      const slices = Math.ceil(order.length / 40);
      const rubble = () =>
        new Set([...sim.state.buildings.values()].filter((b) => b.state === BState.Rubble).map((b) => b.id));
      const were = rubble();
      atomTick(sim);
      // The first slice: the forty nearest, and not one more.
      const first = [...rubble()].filter((id) => !were.has(id));
      expect(first.sort((a, b) => a - b)).toEqual(order.slice(0, 40).sort((a, b) => a - b));
      expect(atom(sim).impact).toMatchObject({ done: 1, levelled: 40 });
      expect(atom(sim).impact!.over).toBeUndefined();
      expect(atom(sim).boom).toBe(0);
      // A tick a slice at most, one an hour.
      let copy: Sim | null = null;
      let ticks = 0;
      let lastDone = 1;
      while (!atom(sim).impact!.over && ticks++ < slices * H + 5) {
        const standing = rubble().size;
        sim.step();
        // (Fires burn out and houses decay for other reasons now and then; slices are the bulk of it.)
        expect(rubble().size - standing).toBeLessThanOrEqual(40 + 3);
        const done = atom(sim).impact!.done;
        if (done !== lastDone) {
          expect(done).toBe(lastDone + 1);
          lastDone = done;
          // Saved mid-impact, loaded, and the same state: the rest of the blast comes out the same.
          if (done === 3 && !copy) {
            copy = clone(sim);
            expect(partHashes(copy)).toEqual(partHashes(sim));
          }
        }
      }
      expect(atom(sim).impact).toMatchObject({ over: true, done: slices });
      expect(ticks).toBeLessThanOrEqual((slices - 1) * H + 2);
      expect(atom(sim).boom).toBe(1);
      expect(events(sim, 'atomImpact')).toHaveLength(1);
      expect(sets(sim, MID).inside).toHaveLength(0);
      // The copy made after the third slice plays on to the same end.
      const rest = (slices - 3) * H + 2;
      copy!.advance(rest + 1);
      expect(atom(copy!).impact).toMatchObject({ over: true, done: slices });
      expect(atom(copy!).boom).toBe(1);
      // (Equal to a run of the original for the same ticks: stepped alike from the same save.)
      const twin = clone(copy!);
      expect(partHashes(twin)).toEqual(partHashes(copy!));
    });
  });

  it('plays the same from a save in the middle as it does uninterrupted', () => {
    withSlice(40, () => {
      const run = aimed(MID);
      atomTick(run);
      run.advance(H + 1);
      // (Slices come at the first minute of each hour: one or two have been dealt since the landing.)
      expect(atom(run).impact!.done).toBeGreaterThan(1);
      expect(atom(run).impact!.over).toBeUndefined();
      const saved = clone(run);
      expect(partHashes(saved)).toEqual(partHashes(run));
      run.advance(4 * H);
      saved.advance(4 * H);
      expect(atom(saved).impact!.done).toBe(atom(run).impact!.done);
      expect(partHashes(saved)).toEqual(partHashes(run));
    });
  });

  it('draws on no random stream of the sim’s: every stream and the war’s dice stand where they were', () => {
    withSlice(60, () => {
      const sim = aimed(WEST);
      const at = streams(sim);
      atomTick(sim);
      expect(streams(sim)).toBe(at);
      const im = atom(sim).impact!;
      let guard = 0;
      while (!im.razed && guard++ < 20) {
        expect(impactSlice(sim, im)).toBe(sets(sim, WEST).inside.length === 0);
        expect(streams(sim)).toBe(at);
        if (sets(sim, WEST).inside.length === 0) im.razed = true;
      }
      expect(sets(sim, WEST).inside).toHaveLength(0);
      // The civic buildings coming down, with the lots round them re-checked, draw nothing either.
      blast(sim);
      expect(streams(sim)).toBe(at);
    });
  });

  it('sets the same fires every time, whatever else the sim has drawn, because they have dice of their own', () => {
    const burning = (sim: Sim) => [...sim.state.burning].sort((a, b) => a - b).join(',');
    const a = aimed(WEST);
    const b = aimed(WEST);
    // Burn through some of the shared streams in one of them: the fires must not care.
    for (const r of Object.values(b.rng)) for (let k = 0; k < 50; k++) r.next();
    atomTick(a);
    atomTick(b);
    blast(a);
    blast(b);
    expect(burning(a)).toBe(burning(b));
    expect(a.state.burning.length).toBeGreaterThan(0);
    // A different seed lights different fires.
    const c = aimed(WEST);
    (c.state.options as { seed: string }).seed = 'another';
    atomTick(c);
    blast(c);
    expect(burning(c)).not.toBe(burning(a));
  });

  it('is idempotent: a slice after the last changes nothing', () => {
    const sim = aimed(WEST);
    atomTick(sim);
    blast(sim);
    const im = atom(sim).impact!;
    const fled = im.fled;
    const levelled = im.levelled;
    const parts = partHashes(sim);
    const kinds = sim.events.length;
    expect(impactSlice(sim, im)).toBe(true);
    expect(im).toMatchObject({ fled, levelled });
    expect(sim.events.length).toBe(kinds);
    // Only the slice counter moved.
    const after = partHashes(sim);
    const moved = Object.keys(after).filter((k) => after[k] !== parts[k]);
    expect(moved).toEqual(['war']);
  });

  it('waits for an open hosted battle, at most twelve hours, then ends it as withdrawn and falls', () => {
    const sim = aimed(WEST, 0, true);
    const w = sim.state.war!;
    expect(w.battle).toBeDefined();
    const arrive = atom(sim).inbound!.arrive;
    const before = sets(sim, WEST).inside.length;
    atomTick(sim);
    // It has landed (warned) but the battle holds it back.
    expect(atom(sim).inbound).toMatchObject({ warned: true });
    expect(atom(sim).impact).toBeUndefined();
    sim.state.tick = arrive + 11 * H;
    atomTick(sim);
    expect(atom(sim).impact).toBeUndefined();
    expect(w.battle).toBeDefined();
    // The twelfth hour: the battle is ended as withdrawn, and the bomb falls.
    sim.state.tick = arrive + 12 * H;
    atomTick(sim);
    expect(w.battle).toBeUndefined();
    expect(w.reports!.at(-1)).toMatchObject({ outcome: 'withdrew', ours: false });
    expect(atom(sim).impact).toMatchObject({ levelled: before });
    blast(sim);
    expect(atom(sim).inbound).toBeUndefined();
    expect(L.battleWait).toBe(12);
  });

  it('falls the moment a battle that ends by itself is over, with no battle ended for it', () => {
    const sim = aimed(WEST, 0, true);
    expect(sim.state.war!.battle).toBeDefined();
    let ticks = 0;
    while (sim.state.war!.battle && ticks++ < 12 * H) sim.step();
    expect(sim.state.war!.battle).toBeUndefined();
    sim.advance(2);
    expect(atom(sim).impact).toBeDefined();
    // The battle's own report stands as it was fought.
    expect(sim.state.war!.reports!.at(-1)!.outcome).not.toBeUndefined();
  });

  it('holds a second bomb back while a blast is still being dealt out, and lets it fall after', () => {
    withSlice(60, () => {
      const sim = aimed(MID);
      atomTick(sim);
      expect(atom(sim).impact!.over).toBeUndefined();
      ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
      atomTick(sim);
      expect(atom(sim).inbound).toBeDefined();
      expect(atom(sim).boom).toBe(0);
      let guard = 0;
      while ((atom(sim).inbound || !atom(sim).impact!.over) && guard++ < 12 * H) sim.step();
      expect(atom(sim).boom).toBeGreaterThanOrEqual(1);
      // (The first blast ended; the second one fell on what was left.)
      sim.advance(2);
      expect(atom(sim).inbound).toBeUndefined();
    });
  });

  it('weighs on approval while it is in the air and for three days after it lands, then lets go', () => {
    const sim = aimed(WEST, 10);
    atomTick(sim);
    const hit = atom(sim).inbound!;
    expect(hit.near).toBeGreaterThan(0);
    const full = -ATOM.warning.mood * (1 - (hit.sheltered ?? 0) / hit.near!);
    expect(bombMood(sim)).toBeCloseTo(full, 8);
    expect(raidMood(sim)).toBeCloseTo(full, 8);
    sim.advance(10 * H);
    expect(atom(sim).impact).toBeDefined();
    const landed = atom(sim).impact!.at!;
    expect(bombMood(sim)).toBeLessThan(0);
    // Half way through the three days the dread is half what it was.
    const span = ATOM.warning.days * 24 * H;
    sim.state.tick = landed + span / 2;
    expect(bombMood(sim)).toBeCloseTo(full / 2, 8);
    sim.state.tick = landed + span;
    expect(bombMood(sim)).toBe(0);
  });
});

describe('M40: ground zero', () => {
  it('is the centre of the densest window of the map by the people in it, ties to the lowest cell', () => {
    const sim = clone(base);
    const n = Math.ceil(MAP_SIZE / L.bucket);
    const w = Math.round(L.window / L.bucket);
    // The same answer by the long way.
    const grid = Array.from({ length: n * n }, () => 0);
    for (const b of sim.state.buildings.values()) {
      if (b.state === BState.Rubble || b.pop <= 0) continue;
      const i = Math.min(n - 1, Math.max(0, Math.floor(b.x / L.bucket)));
      const j = Math.min(n - 1, Math.max(0, Math.floor(b.z / L.bucket)));
      grid[j * n + i]! += Math.round(b.pop);
    }
    let best = -1;
    let at = { x: 0, z: 0 };
    for (let j = 0; j + w <= n; j++)
      for (let i = 0; i + w <= n; i++) {
        let sum = 0;
        for (let dj = 0; dj < w; dj++) for (let di = 0; di < w; di++) sum += grid[(j + dj) * n + i + di]!;
        if (sum > best) {
          best = sum;
          at = { x: (i + w / 2) * L.bucket, z: (j + w / 2) * L.bucket };
        }
      }
    expect(groundZero(sim)).toEqual(at);
    // It sits in the thick of the town, not at the edge of the map.
    expect(at.x).toBeGreaterThan(100);
    expect(at.x).toBeLessThan(900);
  });

  it('follows the people: a crowd far from the old centre pulls it there; a tie goes to the lowest cell', () => {
    const sim = clone(base);
    for (const b of sim.state.buildings.values()) b.pop = 0;
    const homes = [...sim.state.buildings.values()].filter((b) => b.state === BState.Active).slice(0, 4);
    expect(homes).toHaveLength(4);
    // Move four buildings to a far corner of the map and fill them.
    homes.forEach((b, k) => {
      b.x = 1700 + k * 20;
      b.z = 1500 + k * 20;
      b.pop = 500;
    });
    const gz = groundZero(sim);
    // The window holds all four (a window is eight 64 m cells across)...
    expect(gz.x - 256).toBeLessThanOrEqual(1700);
    expect(gz.x + 256).toBeGreaterThanOrEqual(1760);
    expect(gz.z - 256).toBeLessThanOrEqual(1500);
    expect(gz.z + 256).toBeGreaterThanOrEqual(1560);
    // ...and of all the windows that do, the lowest in cell order (north first, then west) is taken: the
    // four stand in cells 26 and 27 across and 23 and 24 down, so the window starts at cell 20 and 17.
    expect(gz).toEqual({ x: (20 + 4) * 64, z: (17 + 4) * 64 });
    expect(groundZero(sim)).toEqual(gz);
    // The city is empty: the middle of the map.
    for (const b of sim.state.buildings.values()) b.pop = 0;
    expect(groundZero(sim)).toEqual({ x: MAP_SIZE / 2, z: MAP_SIZE / 2 });
    // Rubble holds nobody.
    homes.forEach((b) => {
      b.pop = 500;
      b.state = BState.Rubble;
    });
    expect(groundZero(sim)).toEqual({ x: MAP_SIZE / 2, z: MAP_SIZE / 2 });
  });

  it('is fixed when the city accepts the bomb and does not follow the town afterwards', () => {
    const sim = clone(base);
    const gz = groundZero(sim);
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 24 });
    expect(atom(sim).inbound).toMatchObject({ x: gz.x, z: gz.z });
    for (const b of sim.state.buildings.values()) {
      b.pop = 0;
      b.sick = 0;
    }
    atomTick(sim);
    expect(atom(sim).inbound).toMatchObject({ x: gz.x, z: gz.z });
    expect(groundZero(sim)).not.toEqual(gz);
  });
});
