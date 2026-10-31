import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ATOM } from '../../src/data/atom';
import { SERVICES } from '../../src/data/civic';
import { GRID_CELL, GRID_RES, MAP_SIZE } from '../../src/data/world';
import { ZONE_R } from '../../src/data/zones';
import { DMath } from '../../src/sim/dmath';
import type { Sim } from '../../src/sim/sim';
import { partHashes } from '../../src/sim/sync';
import { atomInbound, atomTick, bombMood } from '../../src/sim/systems/atom';
import { groundZero, impactSlice } from '../../src/sim/systems/atomImpact';
import { dispatch } from '../../src/sim/systems/incidents';
import { raidMood } from '../../src/sim/systems/raids';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { BState, type Building } from '../../src/sim/world/buildings';
import { civicRect, type Civic } from '../../src/sim/world/civic';
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
/** The blast's limits as the game has them: a test that changes one gets it back, pass or fail. */
const LIMITS = { ...L };
afterEach(() => {
  Object.assign(L, LIMITS);
});

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
function aimed(at: { x: number; z: number }, hours = 0, battle = false, minute?: number): Sim {
  const sim = clone(base);
  // (Moved on to a minute of the hour, for a test where it matters.)
  if (minute !== undefined) sim.state.tick += (minute - (sim.state.tick % H) + H) % H;
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

/** Run `fn` with some of the blast's limits changed, then put them back. */
function withImpact<T>(patch: Partial<typeof L>, fn: () => T): T {
  const was = { ...L };
  Object.assign(L, patch);
  try {
    return fn();
  } finally {
    Object.assign(L, was);
  }
}

/** Run `fn` with the slice limit lowered (the scripted town has fewer than 400 buildings inside), then restore it. */
const withSlice = <T>(slice: number, fn: () => T): T => withImpact({ slice }, fn);

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
    const incidents = [...sim.state.incidents.values()];
    const levelledIds = new Set(before.inside.map((b) => b.id));

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
    // (Calls for help at buildings that fell are called off; nothing else is opened or closed.)
    expect(sim.state.incidents.size).toBe(incidents.filter((i) => !levelledIds.has(i.building)).length);
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

    // (The cell budget, tried on its own below, is off here: this is the count limit, three a tick.)
    L.civicCells = Infinity;
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
    sim.advance(atom(sim).inbound!.arrive - sim.state.tick);
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

describe('M40: the blast and what stands in it', () => {
  it('calls off the calls for help at the buildings it levels: no patient lost, none saved, no crime', () => {
    const sim = aimed(WEST);
    const s = sim.state;
    const { inside, far } = sets(sim, WEST);
    const homes = inside.filter((b) => b.zone === ZONE_R && b.pop > 0);
    const shop = inside.find((b) => b.zone !== ZONE_R)!;
    const safe = far.find((b) => b.zone === ZONE_R && b.pop > 0)!;
    expect(homes.length).toBeGreaterThan(3);
    const open = (b: Building, kind: 'emergency' | 'crime', window: number) => {
      const inc = { id: s.nextId++, kind, building: b.id, deadline: s.tick + window, responder: 0 };
      s.incidents.set(inc.id, inc);
      return inc;
    };
    const calls = [
      open(homes[0]!, 'emergency', SERVICES.emergencyWindow),
      open(homes[1]!, 'emergency', SERVICES.emergencyWindow),
      open(shop, 'crime', SERVICES.crimeWindow),
    ];
    const kept = open(safe, 'emergency', SERVICES.emergencyWindow);
    // An ambulance already on its way to another.
    const way = open(homes[2]!, 'emergency', SERVICES.emergencyWindow);
    const v = dispatch(sim, 'health', 'ambulance', homes[2]!.id, way.id);
    expect(v, 'an ambulance was sent').not.toBeNull();
    way.responder = v!.id;
    calls.push(way);

    atomTick(sim);
    // At once: every call at a building that fell is gone, the one elsewhere stands, the ambulance is let go.
    for (const inc of calls) expect(s.incidents.has(inc.id), `${inc.kind} at ${inc.building}`).toBe(false);
    expect(s.incidents.has(kept.id)).toBe(true);
    expect(s.vehicles.get(v!.id)!.ref).toBe(0);
    // Past every deadline, and the ambulance's arrival: nothing is written over the rubble.
    sim.advance(SERVICES.emergencyWindow + 100);
    const fell = new Set(inside.map((b) => b.id));
    for (const kind of ['death', 'crime', 'patientSaved', 'crimeStopped'])
      expect(
        events(sim, kind).filter((e) => fell.has(e.id)),
        kind,
      ).toHaveLength(0);
    expect(JSON.stringify(sim.events)).not.toMatch(/casualt|killed|dead|victim/i);
  });

  it('takes a base’s units and training orders with it, and leaves the books straight', () => {
    const { sim, place } = labTown(0, { length: 800, streets: 7 });
    for (const n of rivals(sim)) n.rival!.blackout = { from: 0, until: 1e9 };
    const barracks = place('barracks');
    for (let k = 0; k < 3; k++) ok(sim, { type: 'trainUnit', base: barracks, kind: 'infantry' });
    sim.advance(2 * TICKS_PER_MONTH);
    const w = sim.state.war!;
    expect([...w.units.values()].filter((u) => u.base === barracks)).toHaveLength(3);
    for (let k = 0; k < 2; k++) ok(sim, { type: 'trainUnit', base: barracks, kind: 'infantry' });
    expect([...w.orders.values()].filter((o) => o.base === barracks).length).toBeGreaterThan(0);

    const c = sim.state.civics.get(barracks)!;
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    Object.assign(sim.state.war!.atom!.inbound!, { x: c.x, z: c.z });
    atomTick(sim);
    blast(sim);
    // The base is gone and nothing of its is left standing in the war's books.
    expect(sim.state.civics.has(barracks)).toBe(false);
    expect([...w.units.values()].filter((u) => u.base === barracks)).toHaveLength(0);
    expect([...w.orders.values()].filter((o) => o.base === barracks)).toHaveLength(0);
    // The invariants (checked on each step in test mode) hold for days after.
    sim.advance(5 * TICKS_PER_MONTH);
    expect([...w.units.values()].filter((u) => !sim.state.civics.has(u.base) && u.base !== 0)).toHaveLength(
      0,
    );
  }, 60_000);

  it('closes the regional rail link and the region’s great work but does not take them: neither can be put back', () => {
    const sim = clone(base);
    ok(sim, { type: 'cheat', cheat: 'removeRailLink' });
    ok(sim, { type: 'buildRailLink', z: 300 });
    const s = sim.state;
    const link = [...s.civics.values()].find((c) => c.def === 'raillink')!;
    expect(link).toBeDefined();
    // The blast is centred between the link and a civic building, which stands in for the commons.
    const at = { x: 250, z: 400 };
    expect(dist(link, at)).toBeLessThan(L.level);
    const stand = [...s.civics.values()]
      .filter((c) => c !== link && dist(c, at) < L.level)
      .sort((a, b) => dist(a, at) - dist(b, at) || a.id - b.id)[0]!;
    expect(stand, 'a civic building inside the blast').toBeDefined();
    stand.def = 'sunfield';
    const others = [...s.civics.values()].filter((c) => c !== link && c !== stand && dist(c, at) <= L.level);
    expect(others.length).toBeGreaterThan(1);
    const refused = sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: link.id } });
    expect(refused.ok).toBe(false);

    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    Object.assign(s.war!.atom!.inbound!, at);
    atomTick(sim);
    blast(sim);
    // They stand, closed for as long as the roads there; everything else inside is gone.
    expect(s.civics.has(link.id)).toBe(true);
    expect(s.civics.has(stand.id)).toBe(true);
    expect(s.civics.get(link.id)!.damage).toBeGreaterThan(L.civicClosed);
    expect(s.civics.get(stand.id)!.damage).toBeGreaterThan(L.civicClosed);
    expect(s.civics.get(link.id)!.damage).toBeLessThanOrEqual(L.roadClosed);
    for (const c of others) expect(s.civics.has(c.id), `${c.def}`).toBe(false);
    const destroyed = events(sim, 'civicDestroyed').map((e) => e.id);
    expect(destroyed).not.toContain(link.id);
    expect(destroyed).not.toContain(stand.id);
    expect(destroyed.sort((a, b) => a - b)).toEqual(others.map((c) => c.id).sort((a, b) => a - b));
    // The railway is still joined to the city, and no second link can be laid.
    expect(s.railway).toBeTruthy();
    expect(sim.preview({ type: 'buildRailLink', z: 300 }).ok).toBe(false);
  });

  /** Civic work as the blast counts it: the lots `removeCivic` re-checks round it. */
  const work = (sim: Sim, c: Civic): number => {
    const r = civicRect(c);
    const pad = DMath.hypot(r.hw, r.hd) + 40;
    return sim.net.cellHash.query({ minX: c.x - pad, minZ: c.z - pad, maxX: c.x + pad, maxZ: c.z + pad })
      .length;
  };

  /**
   * Ticks of the real blast with the civic buildings inside coming down: for each tick that took any,
   * who went, who was left in order, and what they cost.
   */
  function civicTicks(sim: Sim, inside: Civic[]) {
    const s = sim.state;
    const out: { took: Civic[]; left: Civic[]; cost: number[] }[] = [];
    atomTick(sim);
    for (let n = 0; n < 500 && !atom(sim).impact!.over; n++) {
      const left = inside.filter((c) => s.civics.has(c.id));
      const cost = left.map((c) => work(sim, c));
      const fires = atom(sim).impact!.fires;
      s.tick++;
      atomTick(sim);
      if (!fires) continue;
      const took = left.filter((c) => !s.civics.has(c.id));
      if (took.length) out.push({ took, left, cost });
    }
    expect(atom(sim).impact!.over).toBe(true);
    return out;
  }

  it('takes the civic buildings a few a tick, nearest first, none past the cell budget but one, and always one', () => {
    const sim = aimed(MID);
    const inside = [...sim.state.civics.values()]
      .filter((c) => dist(c, MID) <= L.level)
      .sort((a, b) => dist(a, MID) - dist(b, MID) || a.id - b.id);
    expect(inside.length).toBeGreaterThan(6);
    const ticks = civicTicks(sim, inside);
    let split = 0;
    for (const { took, left, cost } of ticks) {
      expect(took.length).toBeLessThanOrEqual(L.civicsPerTick);
      expect(took.map((c) => c.id)).toEqual(left.slice(0, took.length).map((c) => c.id));
      const spent = cost.slice(0, took.length).reduce((n, x) => n + x, 0);
      if (took.length > 1) expect(spent).toBeLessThanOrEqual(L.civicCells);
      // It stops short only for the count or for the budget.
      if (took.length < L.civicsPerTick && left.length > took.length) {
        expect(spent + cost[took.length]!).toBeGreaterThan(L.civicCells);
        split++;
      }
    }
    // (In this town the lots round a civic building come to about two hundred cells: the budget bites.)
    expect(split, 'a tick the budget cut short').toBeGreaterThan(0);
    expect(ticks.flatMap((t) => t.took)).toHaveLength(inside.length);
    expect(sim.state.war!.atom!.impact!.over).toBe(true);
  });

  it('takes one a tick when each costs more than the whole budget, so a big one cannot be put off for ever', () => {
    withImpact({ civicCells: 1 }, () => {
      const sim = aimed(MID);
      const inside = [...sim.state.civics.values()].filter((c) => dist(c, MID) <= L.level);
      const ticks = civicTicks(sim, inside);
      expect(ticks).toHaveLength(inside.length);
      for (const t of ticks) expect(t.took).toHaveLength(1);
    });
  });

  it('sets the fires a hundred or so a tick from where the last tick stopped, and never lights a fire put out in between again', () => {
    const burning = (sim: Sim) => [...sim.state.burning].sort((a, b) => a - b);
    const whole = aimed(WEST);
    atomTick(whole);
    blast(whole);
    const all = burning(whole);
    expect(all.length).toBeGreaterThan(30);

    withImpact({ firesPerTick: 10 }, () => {
      const sim = aimed(WEST);
      const before = new Set(sim.state.burning);
      atomTick(sim);
      const im = atom(sim).impact!;
      expect(im.fires).toBeUndefined();
      const lit = () => sim.state.burning.filter((id) => !before.has(id));
      let was = 0;
      let putOut = 0;
      let copy: Sim | null = null;
      let ticks = 0;
      while (!im.fires && ticks++ < 100) {
        sim.state.tick++;
        atomTick(sim);
        const now = lit().length;
        expect(now - was, `tick ${ticks}`).toBeLessThanOrEqual(10);
        if (ticks === 1) {
          expect(now).toBe(10);
          // The first fire is put out by the fire engines: it must not come back.
          putOut = lit()[0]!;
          const b = sim.state.buildings.get(putOut)!;
          b.fire = 0;
          b.burn = 0;
          sim.state.burning = sim.state.burning.filter((id) => id !== putOut);
          was = now - 1;
          continue;
        }
        if (ticks === 3) copy = clone(sim);
        was = now;
      }
      expect(im.fires).toBe(true);
      expect(ticks).toBeGreaterThan(all.length / 10 - 1);
      expect(sim.state.buildings.get(putOut)!.fire).toBe(0);
      // The same fires as one big go, less the one put out.
      expect(burning(sim)).toEqual(all.filter((id) => id !== putOut));
      // A save in the middle of it carries on to the same end.
      blast(sim);
      let more = 0;
      while (!atom(copy!).impact!.over && more++ < 2_000) {
        copy!.state.tick++;
        atomTick(copy!);
      }
      expect(partHashes(copy!)).toEqual(partHashes(sim));
    });
  });

  it('puts no more than the total limit of fires out, spread over the ticks', () => {
    withImpact({ firesPerTick: 7, fires: 20 }, () => {
      const sim = aimed(WEST);
      const before = new Set(sim.state.burning);
      atomTick(sim);
      blast(sim);
      expect(sim.state.burning.filter((id) => !before.has(id))).toHaveLength(20);
    });
  });
});

describe('M40: when the bomb comes down', () => {
  it('deals the next slice in the next hour, not on the tick after a landing on the top of an hour', () => {
    withSlice(40, () => {
      const sim = aimed(MID, 0, false, 0);
      const T = sim.state.tick;
      expect(T % H).toBe(0);
      atomTick(sim);
      const im = atom(sim).impact!;
      expect(im.done).toBe(1);
      let second = 0;
      for (let k = 1; k <= 2 * H && !second; k++) {
        sim.state.tick = T + k;
        atomTick(sim);
        if (im.done === 2) second = k;
        // (The fires are set on the tick after the landing: nothing else heavy shares it.)
        if (k === 1) expect(im.done).toBe(1);
      }
      expect(second).toBe(H + 1);
    });
  });

  it('does not let a flight land on the top of an hour, but a bomb due at once still does', () => {
    for (const minute of [0, 1, 17, 59]) {
      const sim = clone(base);
      sim.state.tick += (minute - (sim.state.tick % H) + H) % H;
      const t = sim.state.tick;
      expect(atomInbound(sim, { id: 1, name: 'Rival' }, ATOM.flight.hours)).toBeNull();
      const arrive = atom(sim).inbound!.arrive;
      expect(arrive % H, `accepted at minute ${minute}`).not.toBe(0);
      expect(arrive - t, `accepted at minute ${minute}`).toBe(ATOM.flight.hours * H + (minute === 0 ? 1 : 0));
    }
    const sim = clone(base);
    sim.state.tick += (0 - (sim.state.tick % H) + H) % H;
    expect(atomInbound(sim, { id: 1, name: 'Rival' }, 0)).toBeNull();
    expect(atom(sim).inbound!.arrive).toBe(sim.state.tick);
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
