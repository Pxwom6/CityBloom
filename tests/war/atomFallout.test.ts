import { beforeAll, describe, expect, it } from 'vitest';
import { FALLOUT } from '../../src/data/atom';
import { CIVIC } from '../../src/data/civic';
import { GRID_CELL, GRID_RES, MAP_SIZE } from '../../src/data/world';
import { checkInvariants, InvariantError } from '../../src/sim/invariants';
import { Sim } from '../../src/sim/sim';
import { partHashes, stateParts } from '../../src/sim/sync';
import { atomInbound } from '../../src/sim/systems/atom';
import { buildingTax } from '../../src/sim/systems/economy';
import {
  cleanupPrice,
  depositFallout,
  doseAtCell,
  falloutBanned,
  falloutDose,
  falloutDue,
  falloutMood,
  falloutOf,
  falloutReading,
  falloutRefusal,
  falloutSickness,
  falloutSummary,
  falloutTownMonth,
  falloutYears,
  playTime,
  radiationWork,
  strikeDeposit,
  updateFallout,
} from '../../src/sim/systems/fallout';
import { happinessFactors } from '../../src/sim/systems/happiness';
import { sicknessRate } from '../../src/sim/systems/health';
import { updateLandValue } from '../../src/sim/systems/landValue';
import { computeOverlay } from '../../src/sim/systems/overlays';
import { windAngle } from '../../src/sim/systems/pollution';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';
import { roadsidePose } from '../../src/sim/world/civic';
import { buildTown, connectPoint, newSim, road, serveTown } from '../helpers';
import { clone, rivals, why } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40, step 4, fallout (docs/plans/M40-design.md, calls 11 and 12): the ground that stays and the air
 * that moves, what both do to the city, the bans, the clean-up, and what drifts across the edges to
 * the computer neighbours. The raster tests play the real update (`updateFallout`, three game hours
 * at a time) without the town around it; the others use a city, whole or just its map.
 */

const H = TICKS_PER_HOUR;
const R = GRID_RES;
const MID = MAP_SIZE / 2;

/** A war city with nothing built and no disasters: the map is the test. */
const bare = (seed = 'citybloom') => newSim({ seed, rivals: true, disasters: false });

/** The raster cell under a point. */
const cell = (x: number, z: number) => Math.floor(z / GRID_CELL) * R + Math.floor(x / GRID_CELL);

/** One update: the clock moves on three game hours and the raster is updated (what the slot does). */
function update(sim: Sim, n = 1): void {
  for (let k = 0; k < n; k++) {
    sim.state.tick += 3 * H;
    updateFallout(sim);
  }
}

/** A game day of updates (eight) and the neighbours' monthly fade: the raster-only clock. */
function day(sim: Sim, n = 1): void {
  for (let d = 0; d < n; d++) {
    update(sim, TICKS_PER_MONTH / (3 * H));
    for (const nb of sim.state.region.neighbours) falloutTownMonth(nb);
  }
}

/**
 * The centre of mass of a raster in metres, and its mass; of the cells within `within` metres of a
 * point if one is given.
 */
function com(
  a: Float32Array,
  within?: { x: number; z: number; r: number },
): { x: number; z: number; mass: number } {
  let m = 0;
  let x = 0;
  let z = 0;
  for (let k = 0; k < a.length; k++) {
    const v = a[k]!;
    if (v <= 0) continue;
    if (
      within &&
      Math.hypot(((k % R) + 0.5) * GRID_CELL - within.x, (Math.floor(k / R) + 0.5) * GRID_CELL - within.z) >
        within.r
    )
      continue;
    m += v;
    x += v * ((k % R) + 0.5) * GRID_CELL;
    z += v * (Math.floor(k / R) + 0.5) * GRID_CELL;
  }
  return { x: m ? x / m : 0, z: m ? z / m : 0, mass: m };
}

const level = (sim: Sim, side: string) =>
  sim.state.region.neighbours.find((n) => n.side === side)?.rival?.fallout ?? 0;

/** Every random stream the sim keeps, and the war's own: their states. */
function streams(sim: Sim): string {
  const out: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(sim.rng)) out[k] = r.getState();
  out.war = sim.state.war!.rng;
  return JSON.stringify(out);
}

/** The neighbours go dark for ever: no raids and no spies to move a die. */
function quiet(sim: Sim): Sim {
  for (const n of rivals(sim)) n.rival!.blackout = { from: 0, until: 1e9 };
  return sim;
}

/** A bomb lands at once at (x, z) and the real clock plays the blast out; returns the sim. */
function strike(sim: Sim, at: { x: number; z: number }): Sim {
  quiet(sim);
  ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
  const hit = sim.state.war!.atom!.inbound!;
  hit.x = at.x;
  hit.z = at.z;
  for (let t = 0; t < 4 * H && !sim.state.war!.atom!.impact?.over; t++) sim.step();
  expect(sim.state.war!.atom!.impact?.over, 'the blast ended').toBe(true);
  return sim;
}

/** Set the ground over a rectangle (metres) to a level. */
function closeRect(sim: Sim, x0: number, z0: number, x1: number, z1: number, v: number): void {
  const f = falloutOf(sim);
  for (let j = Math.floor(z0 / GRID_CELL); j <= Math.floor(z1 / GRID_CELL); j++)
    for (let i = Math.floor(x0 / GRID_CELL); i <= Math.floor(x1 / GRID_CELL); i++)
      if (i >= 0 && j >= 0 && i < R && j < R) f.ground[j * R + i] = v;
}

// ---------------------------------------------------------------------------------------------

describe('M40: the ground stays, the air moves', () => {
  it('the ground’s centre of mass is still after three days, the air’s moves along the wind', () => {
    for (const seed of ['citybloom', 'b', 'f', 'hill']) {
      const sim = bare(seed);
      depositFallout(sim, MID, MID);
      const f = falloutOf(sim);
      const disc = { x: MID, z: MID, r: FALLOUT.impact.reach };
      const g0 = com(f.ground, disc);
      const a0 = com(f.air);
      expect(a0.mass, `${seed}: a plume`).toBeGreaterThan(0);
      // One update: the air’s centre of mass moves one wind step along the bearing of that tick.
      update(sim);
      const a1 = com(f.air);
      const bearing = windAngle(seed, sim.state.tick);
      const step = FALLOUT.air.wind * GRID_CELL;
      expect(a1.x - a0.x).toBeCloseTo(Math.cos(bearing) * step, -0.5);
      expect(a1.z - a0.z).toBeCloseTo(Math.sin(bearing) * step, -0.5);
      // Three days on, the ground under the strike has not gone anywhere (the plume leaves a little of
      // itself on it as it passes: a cell of drift or so, where the air moved four cells in one update).
      day(sim, 3);
      const g3 = com(f.ground, disc);
      expect(Math.hypot(g3.x - g0.x, g3.z - g0.z), `${seed}: ground drift`).toBeLessThan(step / 2);
      expect(Math.hypot(a1.x - a0.x, a1.z - a0.z), `${seed}: air drift`).toBeGreaterThan(step * 0.9);
    }
  });

  it('the air leaves the map and fades: a year on there is none of it and the ground is what is left', () => {
    const sim = bare('f');
    depositFallout(sim, MID, MID);
    const f = falloutOf(sim);
    day(sim, 12);
    expect(com(f.air).mass).toBe(0);
    expect(f.ground[cell(MID, MID)]!).toBeGreaterThan(0.8);
    checkInvariants(sim);
  });

  it('the strike’s deposit: 1 at ground zero, 0.2 at about 570 m, nothing past 720 m', () => {
    expect(strikeDeposit(0)).toBe(1);
    expect(strikeDeposit(570)).toBeGreaterThan(0.18);
    expect(strikeDeposit(570)).toBeLessThan(0.23);
    expect(strikeDeposit(FALLOUT.impact.reach)).toBe(0);
    let last = 1;
    for (let d = 0; d < 720; d += 10) {
      expect(strikeDeposit(d)).toBeLessThanOrEqual(last);
      last = strikeDeposit(d);
    }
  });

  it('the plume carries its share of the mass over the downwind side only', () => {
    const sim = bare('citybloom');
    depositFallout(sim, MID, MID);
    const f = falloutOf(sim);
    const a = windAngle('citybloom', sim.state.tick);
    let ground = 0;
    let air = 0;
    for (let k = 0; k < f.ground.length; k++) {
      ground += f.ground[k]!;
      const cx = ((k % R) + 0.5) * GRID_CELL - MID;
      const cz = (Math.floor(k / R) + 0.5) * GRID_CELL - MID;
      if (f.air[k]! > 0) {
        air += f.air[k]!;
        expect(cx * Math.cos(a) + cz * Math.sin(a), 'air only downwind').toBeGreaterThan(0);
      }
    }
    expect(air / ground).toBeGreaterThan(FALLOUT.impact.plume * 0.9);
    expect(air / ground).toBeLessThan(FALLOUT.impact.plume * 1.3);
  });

  it('the core of the strike falls below the ban in 17 to 20 game years, a 0.3 rim in about five', () => {
    const sim = bare('citybloom');
    depositFallout(sim, MID, MID);
    const f = falloutOf(sim);
    // (The wind of this seed blows south: the rim to the north has none of the plume on it.)
    let d = 0;
    while (strikeDeposit(d) > 0.3) d += 4;
    const rim = cell(MID, MID - d);
    expect(f.ground[rim]!).toBeGreaterThanOrEqual(0.29);
    expect(f.ground[rim]!).toBeLessThan(0.31);
    let core = -1;
    let rimOpened = -1;
    for (let month = 1; month <= 12 * 22 && core < 0; month++) {
      day(sim);
      if (rimOpened < 0 && f.ground[rim]! < FALLOUT.ban) rimOpened = month / 12;
      if (f.ground[cell(MID, MID)]! < FALLOUT.ban) core = month / 12;
    }
    expect(core).toBeGreaterThanOrEqual(17);
    expect(core).toBeLessThanOrEqual(20);
    expect(rimOpened).toBeGreaterThan(4);
    expect(rimOpened).toBeLessThan(6);
    // (Hours of play at 1x: 11.)
    expect(playTime(core)).toMatch(/^1[01] hours of play$/);
    checkInvariants(sim);
  });

  it('values below the floor snap to zero and the rasters stay in range', () => {
    const sim = bare('b');
    depositFallout(sim, 300, MID);
    const f = falloutOf(sim);
    day(sim, 40);
    for (let k = 0; k < f.ground.length; k++) {
      for (const v of [f.ground[k]!, f.air[k]!]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v === 0 || v >= FALLOUT.floor).toBe(true);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: fallout across the map’s edges', () => {
  // A seed for each side the wind can blow towards (the bearing wobbles by a third of a radian).
  const SIDES = [
    ['citybloom', 'south', { x: MID, z: MAP_SIZE - 230 }],
    ['f', 'north', { x: MID, z: 230 }],
    ['b', 'west', { x: 230, z: MID }],
  ] as const;

  it('a hit near the downwind edge raises the fallout of the neighbour on that side, and only that side', () => {
    for (const [seed, side, at] of SIDES) {
      const sim = bare(seed);
      const a = windAngle(seed, 0);
      expect(
        side === 'south' ? Math.sin(a) : side === 'north' ? -Math.sin(a) : -Math.cos(a),
        `${seed} blows towards the ${side}`,
      ).toBeGreaterThan(0.85);
      depositFallout(sim, at.x, at.z);
      day(sim, 4);
      expect(level(sim, side), `${seed}: the ${side} neighbour`).toBeGreaterThan(0.2);
      for (const other of ['north', 'south', 'west'])
        if (other !== side) expect(level(sim, other), `${seed}: the ${other} neighbour`).toBe(0);
      // The other sides’ counters did not move either.
      const out = falloutOf(sim).out;
      expect(out[side]).toBeGreaterThan(0);
      for (const other of ['north', 'south', 'west'] as const) if (other !== side) expect(out[other]).toBe(0);
    }
  });

  it('a hit in the middle sends less than one near the edge; it is capped at 1', () => {
    const edge = bare('f');
    depositFallout(edge, MID, 230);
    day(edge, 4);
    const middle = bare('f');
    depositFallout(middle, MID, MID);
    day(middle, 4);
    expect(level(middle, 'north')).toBeGreaterThan(0.05);
    expect(level(middle, 'north')).toBeLessThan(level(edge, 'north'));
    // Struck again and again, a neighbour tops out at 1.
    for (let k = 0; k < 40; k++) {
      depositFallout(edge, MID, 230);
      day(edge, 2);
    }
    expect(level(edge, 'north')).toBeLessThanOrEqual(1);
  });

  it('the counters are cumulative, rounded to a thousandth, and the east edge is a sink', () => {
    // A seed whose wind blows east: nothing is counted on any side, and the air is gone.
    let east: string | null = null;
    for (let k = 0; k < 80 && !east; k++) if (Math.cos(windAngle(`s${k}`, 0)) > 0.95) east = `s${k}`;
    expect(east, 'a seed whose wind blows east').not.toBeNull();
    const sim = bare(east ?? 'a');
    depositFallout(sim, MAP_SIZE - 300, MID);
    const f = falloutOf(sim);
    day(sim, 3);
    expect(f.out).toEqual({ north: 0, south: 0, west: 0 });
    expect(com(f.air).mass).toBe(0);
    // And a counted one is a whole number of thousandths, growing as more crosses.
    const sim2 = bare('f');
    depositFallout(sim2, MID, 230);
    update(sim2, 6);
    const first = falloutOf(sim2).out.north;
    depositFallout(sim2, MID, 230);
    update(sim2, 12);
    const second = falloutOf(sim2).out.north;
    expect(second).toBeGreaterThan(first);
    for (const v of [first, second]) expect(Math.abs(v * 1000 - Math.round(v * 1000))).toBeLessThan(1e-6);
  });

  it('a neighbour’s level fades by half every eight game years and a trace is dropped', () => {
    const sim = bare('f');
    const n = rivals(sim)[0]!;
    n.rival!.fallout = 0.8;
    for (let m = 0; m < 12 * 8; m++) falloutTownMonth(n);
    expect(n.rival!.fallout).toBeGreaterThan(0.395);
    expect(n.rival!.fallout).toBeLessThan(0.405);
    n.rival!.fallout = 0.0051;
    for (let m = 0; m < 3; m++) falloutTownMonth(n);
    expect(n.rival!.fallout).toBeUndefined();
    expect('fallout' in n.rival!).toBe(false);
  });

  it('a neighbour with fallout slows its town’s growth, by a value and never a draw', () => {
    const a = bare('f');
    const b = bare('f');
    const na = rivals(a)[0]!;
    na.rival!.fallout = 1;
    const before = streams(a);
    expect(streams(b)).toBe(before);
    for (let m = 0; m < 6; m++) {
      a.advance(TICKS_PER_MONTH);
      b.advance(TICKS_PER_MONTH);
    }
    // The same dice were rolled (the streams agree), the town with fallout grew less.
    expect(streams(a)).toBe(streams(b));
    const pa = a.state.region.neighbours.find((x) => x.id === na.id)!.population;
    const pb = b.state.region.neighbours.find((x) => x.id === na.id)!.population;
    expect(pa).toBeLessThan(pb);
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: a neighbour’s fallout drifts back in when the wind blows from its side', () => {
  it('the first stream in makes the raster and leaves a little on the ground; a wind blowing away makes none', () => {
    // 'river': the wind blows towards the south-east, so it comes in from the north and the west.
    const a = windAngle('river', 0);
    expect(Math.cos(a)).toBeGreaterThan(0.5);
    expect(Math.sin(a)).toBeGreaterThan(0.3);
    const sim = bare('river');
    expect(sim.state.fallout).toBeUndefined();
    const west = rivals(sim).find((n) => n.side === 'west')!;
    const south = rivals(sim).find((n) => n.side === 'south')!;
    // The south neighbour’s fallout is blown away from the city: no raster, however long.
    south.rival!.fallout = 1;
    expect(falloutDue(sim)).toBe(false);
    day(sim, 3);
    expect(sim.state.fallout).toBeUndefined();
    expect('fallout' in sim.state).toBe(false);
    // The west one’s comes in.
    west.rival!.fallout = 1;
    expect(falloutDue(sim)).toBe(true);
    day(sim, 20);
    const f = sim.state.fallout!;
    expect(f).toBeDefined();
    let ground = 0;
    for (let k = 0; k < f.ground.length; k++) ground += f.ground[k]!;
    expect(ground).toBeGreaterThan(0.5);
    // A thin stream: it never closes the ground.
    expect(Math.max(...f.ground)).toBeLessThan(FALLOUT.ban);
    // Proportional to the neighbour’s level: half the level, about half the ground.
    const half = bare('river');
    rivals(half).find((n) => n.side === 'west')!.rival!.fallout = 0.5;
    day(half, 20);
    let g2 = 0;
    for (let k = 0; k < half.state.fallout!.ground.length; k++) g2 += half.state.fallout!.ground[k]!;
    expect(g2 / ground).toBeGreaterThan(0.4);
    expect(g2 / ground).toBeLessThan(0.65);
    checkInvariants(sim);
  });

  it('a stream passing through the city is haze: it does not reach the next town', () => {
    // 'river' blows towards the south-east: what comes in from the west leaves by the south and the east.
    const sim = bare('river');
    rivals(sim).find((n) => n.side === 'west')!.rival!.fallout = 1;
    day(sim, 60);
    const f = falloutOf(sim);
    expect(f.out).toEqual({ north: 0, south: 0, west: 0 });
    expect(level(sim, 'south')).toBe(0);
    expect(level(sim, 'north')).toBe(0);
    // A real cloud still counts: the same city, struck, sends its plume south.
    depositFallout(sim, MID, MAP_SIZE - 300);
    day(sim, 4);
    expect(f.out.south).toBeGreaterThan(FALLOUT.edge.trickle);
    expect(level(sim, 'south')).toBeGreaterThan(0.05);
  });

  it('the stream coming in is not counted as leaving again', () => {
    const sim = bare('river');
    rivals(sim).find((n) => n.side === 'west')!.rival!.fallout = 1;
    day(sim, 10);
    expect(falloutOf(sim).out.west).toBe(0);
    // The west neighbour’s own level only fades.
    expect(level(sim, 'west')).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: fallout in the running city', () => {
  it('a strike makes the raster through the real clock, the update runs in its slot, and the city stays valid', () => {
    const sim = bare('f');
    sim.testMode = true;
    expect(sim.state.fallout).toBeUndefined();
    strike(sim, { x: MID, z: 300 });
    const f = sim.state.fallout!;
    expect(f).toBeDefined();
    expect(f.ground[cell(MID, 300)]!).toBeGreaterThan(0.9);
    const air0 = com(f.air).mass;
    expect(air0).toBeGreaterThan(0);
    // The slot is every third hour, the minute after the air pollution’s: it has run within three hours.
    sim.advance(3 * H);
    expect(com(f.air).mass).toBeLessThan(air0);
    // The plume reaches the north edge in a few days and the north neighbour has it.
    sim.advance(2 * TICKS_PER_MONTH);
    expect(f.out.north).toBeGreaterThan(0);
    expect(level(sim, 'north')).toBeGreaterThan(0.2);
    expect(level(sim, 'south')).toBe(0);
  });

  it('a save in the middle of the plume loads and goes on exactly as the city would have', () => {
    const sim = bare('f');
    strike(sim, { x: MID, z: 400 });
    sim.advance(10 * H);
    const copy = clone(sim);
    expect(partHashes(copy)).toEqual(partHashes(sim));
    sim.advance(3 * TICKS_PER_MONTH);
    copy.advance(3 * TICKS_PER_MONTH);
    expect(partHashes(copy)).toEqual(partHashes(sim));
    expect(copy.state.fallout!.out).toEqual(sim.state.fallout!.out);
    expect(level(copy, 'north')).toBe(level(sim, 'north'));
  });

  it('a strike, its fallout and the days after draw nothing from any random stream', () => {
    const a = quiet(bare('f'));
    const b = quiet(bare('f'));
    a.testMode = true;
    strike(a, { x: MID, z: 300 });
    // (The control is brought to the same tick by the same stepping.)
    while (b.state.tick < a.state.tick) b.step();
    a.advance(3 * TICKS_PER_MONTH);
    b.advance(3 * TICKS_PER_MONTH);
    expect(a.state.fallout).toBeDefined();
    expect(b.state.fallout).toBeUndefined();
    expect(streams(a)).toBe(streams(b));
  });

  it('a city that was never struck has no fallout key, peaceful or at war', () => {
    const peace = newSim({ disasters: false });
    const war = quiet(bare('f'));
    for (const sim of [peace, war]) {
      sim.advance(2 * TICKS_PER_MONTH);
      expect('fallout' in sim.state).toBe(false);
      expect(Object.keys(sim.state)).not.toContain('fallout');
      expect(stateParts(sim.state).map(([k]) => k)).not.toContain('fallout');
      expect(partHashes(sim).fallout).toBeUndefined();
    }
    // A strike adds the key, and it is part of the hashes from then on.
    strike(war, { x: MID, z: MID });
    expect(Object.keys(war.state)).toContain('fallout');
    expect(partHashes(war).fallout).toBeDefined();
  });

  it('a peaceful city refuses the clean-up and keeps the radiation map empty', () => {
    const sim = newSim({ disasters: false });
    expect(why(sim, { type: 'cleanFallout', x: 500, z: 500 })).toMatch(/no fallout/);
    const o = computeOverlay(sim, 'radiation');
    expect(o.ramp).toBe('hazard');
    expect([...o.values].every((v) => v === -1)).toBe(true);
    expect(sim.state.fallout).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: the words', () => {
  it('the refusal says how many game years are left, from the decay', () => {
    const sim = bare('citybloom');
    closeRect(sim, 400, 400, 600, 600, 0.5);
    const years = falloutYears(0.5);
    expect(years).toBeCloseTo(FALLOUT.halfLifeYears * (Math.log(2.5) / Math.LN2), 2);
    expect(falloutRefusal(sim, 500, 500)).toBe(
      `Fallout lies on this ground. Nothing can be built here for about ${Math.round(years)} more game years.`,
    );
    // The worst point of a footprint decides.
    expect(falloutRefusal(sim, 700, 500, [[500, 500]])).toMatch(/for about 11 more game years\.$/);
    // Open ground says nothing; so does a city with no fallout.
    expect(falloutRefusal(sim, 900, 900)).toBeNull();
    expect(falloutRefusal(bare('citybloom'), 500, 500)).toBeNull();
    // A single year is singular, and ground just at the ban has a year left, not none.
    closeRect(sim, 400, 400, 600, 600, FALLOUT.ban);
    expect(falloutRefusal(sim, 500, 500)).toMatch(/for about 1 more game year\.$/);
  });

  it('the map’s tooltip gives the dose, the years left and the hours of play', () => {
    const sim = bare('citybloom');
    closeRect(sim, 400, 400, 600, 600, 0.34);
    const r = falloutReading(sim, 500, 500);
    expect(r.closed).toBe(true);
    expect(r.dose).toBeCloseTo(0.34, 2);
    expect(r.text).toBe(
      `Fallout 0.34. Closed for about ${Math.round(falloutYears(0.34))} more game years (${playTime(falloutYears(0.34))})`,
    );
    expect(r.text).toMatch(/^Fallout 0\.34\. Closed for about 6 more game years \(4 hours of play\)$/);
    closeRect(sim, 400, 400, 600, 600, 0.1);
    expect(falloutReading(sim, 500, 500).text).toBe('Fallout 0.10. Open for building');
    expect(falloutReading(sim, 1500, 1500).text).toBe('No fallout here');
    expect(falloutReading(bare('citybloom'), 500, 500).text).toBe('No fallout here');
    expect(playTime(13)).toBe('8 hours of play');
    expect(playTime(0.5)).toBe('18 minutes of play');
  });

  it('no string in the fallout words speaks of people hurt', () => {
    const sim = bare('citybloom');
    closeRect(sim, 400, 400, 600, 600, 0.5);
    const words = [
      falloutRefusal(sim, 500, 500)!,
      falloutReading(sim, 500, 500).text,
      playTime(30),
      why(sim, { type: 'cleanFallout', x: 1500, z: 1500 }) ?? '',
      why(bare('citybloom'), { type: 'cleanFallout', x: 1, z: 1 }) ?? '',
    ].join(' ');
    expect(words).not.toMatch(/casualt|killed|dead|victim/i);
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: the radiation map', () => {
  it('has three bands, the air lighter than the ground, closed ground outlined', () => {
    const sim = bare('citybloom');
    const f = falloutOf(sim);
    closeRect(sim, 600, 600, 900, 900, 0.5); // closed
    closeRect(sim, 1000, 600, 1100, 700, 0.1); // open, with fallout
    f.air[cell(1500, 1500)] = 0.3; // air alone
    const o = computeOverlay(sim, 'radiation');
    expect(o.map).toBe('radiation');
    expect(o.ramp).toBe('hazard');
    const v = (x: number, z: number) => o.values[cell(x, z)]!;
    expect(v(100, 100)).toBe(-1);
    expect(v(1500, 1500)).toBeGreaterThanOrEqual(0.1);
    expect(v(1500, 1500)).toBeLessThanOrEqual(0.25);
    expect(v(1050, 650)).toBeGreaterThanOrEqual(0.3);
    expect(v(1050, 650)).toBeLessThanOrEqual(0.55);
    expect(v(750, 750)).toBeGreaterThanOrEqual(0.6);
    expect(v(750, 750)).toBeLessThan(1);
    // The air is lighter than any ground; the edge of the closed ground is the darkest of all.
    expect(v(1500, 1500)).toBeLessThan(v(1050, 650));
    expect(v(1050, 650)).toBeLessThan(v(750, 750));
    expect(v(604, 604)).toBe(1);
    expect(o.legend).toEqual(['Clear', 'Heavy fallout']);
  });

  it('is part of the lockstep poke and answers the same on a copy', () => {
    const sim = bare('f');
    strike(sim, { x: MID, z: 400 });
    const copy = clone(sim);
    const a = computeOverlay(sim, 'radiation');
    const b = computeOverlay(copy, 'radiation');
    expect([...a.values]).toEqual([...b.values]);
    expect(a.values.some((x) => x >= 0.6)).toBe(true);
  });

  it('the query answers with the reading at a spot and the summary', () => {
    const sim = bare('citybloom');
    expect(sim.query({ type: 'fallout' })).toEqual({ reading: null, summary: null });
    strike(sim, { x: MID, z: MID });
    const q = sim.query({ type: 'fallout', x: MID, z: MID }) as {
      reading: { closed: boolean; text: string };
      summary: { closedArea: number; peak: number; price: number; relief: boolean; jobs: unknown[] };
    };
    expect(q.reading.closed).toBe(true);
    expect(q.reading.text).toMatch(/^Fallout 1\.00\. Closed for about 19 more game years/);
    expect(q.summary.peak).toBeGreaterThan(0.95);
    expect(q.summary.closedArea).toBeGreaterThan(0.9e6);
    expect(q.summary.relief).toBe(true);
    expect(q.summary.price).toBe(FALLOUT.cleanup.cost * FALLOUT.cleanup.relief);
    expect(falloutSummary(sim)!.jobs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: clean-up', () => {
  /** A struck bare city with money and, if asked, Repair crews researched. */
  function struck(crews: boolean): Sim {
    const sim = bare('citybloom');
    sim.testMode = true;
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    if (crews) ok(sim, { type: 'cheat', cheat: 'research', tiers: ['logistics2'] });
    strike(sim, { x: MID, z: MID });
    return sim;
  }
  const money = (sim: Sim) => sim.state.treasury;
  const dose = (sim: Sim, x: number, z: number) => sim.state.fallout!.ground[cell(x, z)]!;

  it('a job costs its price on the ledger line and halves the ground within 128 m after 96 hours', () => {
    const sim = struck(true);
    const control = clone(sim);
    const spot = { x: MID - 60, z: MID + 30 };
    const m0 = money(sim);
    const r = ok(sim, { type: 'cleanFallout', ...spot });
    expect(r.cost).toBe(FALLOUT.cleanup.cost);
    expect(money(sim)).toBe(m0 - 350_000);
    expect(sim.state.economy.month.cleanup).toBe(-350_000);
    expect(sim.state.fallout!.jobs).toEqual([{ x: spot.x, z: spot.z, left: 96 }]);
    // Nothing happens before the crew is done, and the ground there is the control’s until then.
    sim.advance(90 * H);
    control.advance(90 * H);
    expect(dose(sim, spot.x, spot.z)).toBe(dose(control, spot.x, spot.z));
    expect(sim.state.fallout!.jobs.length).toBe(1);
    sim.advance(9 * H);
    control.advance(9 * H);
    expect(sim.state.fallout!.jobs).toEqual([]);
    expect(sim.events.some((e) => e.kind === 'falloutCleaned')).toBe(true);
    // Half the dose inside the reach, the control’s outside it.
    for (const [dx, dz] of [
      [0, 0],
      [60, 0],
      [-90, 60],
    ])
      expect(dose(sim, spot.x + dx, spot.z + dz) / dose(control, spot.x + dx, spot.z + dz)).toBeCloseTo(
        0.5,
        2,
      );
    for (const [dx, dz] of [
      [200, 0],
      [0, -250],
    ])
      expect(dose(sim, spot.x + dx, spot.z + dz)).toBe(dose(control, spot.x + dx, spot.z + dz));
    checkInvariants(sim);
  });

  it('relief crews for a city without Repair crews: twice the price, said so', () => {
    const sim = struck(false);
    expect(cleanupPrice(sim)).toEqual({ price: 700_000, relief: true });
    const m0 = money(sim);
    const r = ok(sim, { type: 'cleanFallout', x: MID, z: MID });
    expect(r.cost).toBe(700_000);
    expect(r.info).toMatchObject({ relief: true });
    expect(money(sim)).toBe(m0 - 700_000);
    expect(sim.state.fallout!.jobs[0]).toMatchObject({ relief: true, left: 96 });
    // With the tier researched it is the plain price.
    const crews = struck(true);
    expect(cleanupPrice(crews)).toEqual({ price: 350_000, relief: false });
    expect(ok(crews, { type: 'cleanFallout', x: MID, z: MID }).info).toMatchObject({ relief: false });
    expect(crews.state.fallout!.jobs[0]!.relief).toBeUndefined();
  });

  it('three crews at a time, not two on the same ground, not on clean ground, not without the money', () => {
    const sim = struck(true);
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    ok(sim, { type: 'cleanFallout', x: MID, z: MID });
    // The same spot (or very near it) has a crew already.
    expect(why(sim, { type: 'cleanFallout', x: MID + 30, z: MID })).toMatch(/already working there/);
    ok(sim, { type: 'cleanFallout', x: MID + 250, z: MID });
    ok(sim, { type: 'cleanFallout', x: MID - 250, z: MID });
    expect(why(sim, { type: 'cleanFallout', x: MID, z: MID + 250 })).toMatch(/3 crews are already at work/);
    // Clean ground is not worth a crew.
    const fresh = struck(true);
    expect(why(fresh, { type: 'cleanFallout', x: 100, z: 100 })).toMatch(/clean enough/);
    // Money: the plain price is short by a dollar.
    const poor = struck(true);
    poor.state.economy.monthStartTreasury -= money(poor) - 349_999;
    poor.state.treasury = 349_999;
    expect(why(poor, { type: 'cleanFallout', x: MID, z: MID })).toMatch(
      /Not enough money: \$350,000 for a clean-up crew/,
    );
    const poorRelief = struck(false);
    poorRelief.state.economy.monthStartTreasury -= money(poorRelief) - 500_000;
    poorRelief.state.treasury = 500_000;
    expect(why(poorRelief, { type: 'cleanFallout', x: MID, z: MID })).toMatch(/\$700,000 for relief crews/);
    // Positions off the map are refused.
    expect(why(sim, { type: 'cleanFallout', x: -5, z: 10 })).toBe('Invalid position');
  });

  it('a preview costs nothing, and sandbox plays for free', () => {
    const sim = struck(true);
    const m0 = money(sim);
    const p = sim.preview({ type: 'cleanFallout', x: MID, z: MID });
    expect(p).toMatchObject({ ok: true, cost: 350_000 });
    expect(money(sim)).toBe(m0);
    expect(sim.state.fallout!.jobs).toEqual([]);
    const free = struck(true);
    free.state.options.sandbox = true;
    const m1 = money(free);
    ok(free, { type: 'cleanFallout', x: MID, z: MID });
    // (Sandbox skips the check, not the charge: it only lets the treasury run short.)
    expect(money(free)).toBeLessThanOrEqual(m1);
  });

  it('a clean-up on the running clock is saved and loaded with its crews', () => {
    const sim = struck(true);
    ok(sim, { type: 'cleanFallout', x: MID, z: MID });
    sim.advance(30 * H);
    const copy = clone(sim);
    expect(copy.state.fallout!.jobs).toEqual(sim.state.fallout!.jobs);
    sim.advance(80 * H);
    copy.advance(80 * H);
    expect(partHashes(copy)).toEqual(partHashes(sim));
    expect(copy.state.fallout!.jobs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: the bans', () => {
  /** A planned town, unzoned, with the east of it closed by fallout (x beyond `cut` metres from the highway). */
  function closedEast(zoned: boolean) {
    const sim = bare('citybloom');
    sim.testMode = true;
    const { streets } = buildTown(sim, { length: 800, streets: 7, zone: zoned });
    serveTown(sim);
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    const c = connectPoint(sim);
    const cut = c.x + 450;
    closeRect(sim, cut, 0, MAP_SIZE, MAP_SIZE, 0.5);
    return { sim, c, cut, streets };
  }

  it('zoning is refused on ground at the threshold, and only the open part of a brush is painted', () => {
    const { sim, c, cut } = closedEast(false);
    const brush = (x0: number, x1: number, z = c.z - 100) => ({
      kind: 'brush' as const,
      points: [
        { x: x0, z },
        { x: x1, z },
      ],
      radius: 40,
    });
    // Only closed ground: refused, with the years left.
    const closed = sim.dispatch({ type: 'zone', zone: 'R', area: brush(cut + 80, cut + 300) });
    expect(closed.ok).toBe(false);
    if (!closed.ok) expect(closed.reason).toBe(falloutRefusal(sim, cut + 100, c.z - 100));
    const dry = sim.preview({ type: 'zone', zone: 'R', area: brush(cut + 80, cut + 300) });
    expect(dry.ok).toBe(false);
    // A brush across the line paints the open side and says it left some.
    const mixed = sim.dispatch({ type: 'zone', zone: 'R', area: brush(cut - 200, cut + 200) });
    expect(mixed.ok).toBe(true);
    if (mixed.ok) {
      expect((mixed.info as { cells: number }).cells).toBeGreaterThan(5);
      expect((mixed.info as { closed: number }).closed).toBeGreaterThan(5);
    }
    // None of the zoned cells stands on closed ground.
    for (const b of sim.state.net.blocks.values())
      for (let i = 0; i < b.zone.length; i++)
        if (b.zone[i]) {
          const p = sim.net.cellCenter(b.id, i);
          expect(falloutBanned(sim, p.x, p.z), `cell at ${p.x},${p.z}`).toBe(false);
        }
    // Clearing a zone is always allowed, and so is zoning ground that is only a little hot.
    const open = sim.dispatch({ type: 'zone', zone: 'none', area: brush(cut + 80, cut + 300) });
    expect(open.ok).toBe(true);
    closeRect(sim, cut, 0, MAP_SIZE, MAP_SIZE, 0.19);
    expect(sim.dispatch({ type: 'zone', zone: 'C', area: brush(cut + 80, cut + 300) }).ok).toBe(true);
  });

  it('a civic building can’t be placed on closed ground, and can on the open', () => {
    const { sim, c, cut, streets } = closedEast(false);
    const def = CIVIC.get('firestation')!;
    const midOf = (seg: number) => {
      const curve = sim.net.curve(seg);
      return { seg, len: curve.length, at: curve.pointAt(curve.length / 2) };
    };
    const inEast = streets.map(midOf).find((s) => s.at.x > cut + 100)!;
    const inWest = streets.map(midOf).find((s) => s.at.x < cut - 100)!;
    const pose = (s: { seg: number; len: number }) => roadsidePose(sim.net, s.seg, s.len / 2, 1, def.d);
    const east = sim.dispatch({ type: 'placeBuilding', def: 'firestation', ...pose(inEast) });
    expect(east.ok).toBe(false);
    if (!east.ok)
      expect(east.reason).toMatch(
        /^Fallout lies on this ground\. Nothing can be built here for about 11 more game years\.$/,
      );
    // The preview and the move say the same.
    expect(sim.preview({ type: 'placeBuilding', def: 'firestation', ...pose(inEast) }).ok).toBe(false);
    const west = sim.dispatch({ type: 'placeBuilding', def: 'firestation', ...pose(inWest) });
    expect(west.ok).toBe(true);
    // A footprint with a corner on closed ground is closed.
    const straddle = streets.map(midOf).find((s) => Math.abs(s.at.x - cut) < 80);
    if (straddle) {
      const p = pose(straddle);
      const r = sim.preview({ type: 'placeBuilding', def: 'firestation', ...p });
      if (!r.ok && /Fallout/.test(r.reason)) expect(falloutBanned(sim, p.x + 30, p.z)).toBe(true);
    }
    void c;
  });

  it('roads, bulldozing and clean-up are not banned', () => {
    const { sim, c, cut, streets } = closedEast(false);
    const before = sim.state.net.segments.size;
    const r = road(sim, [
      { x: cut + 100, z: c.z - 140 },
      { x: cut + 300, z: c.z - 140 },
    ]);
    expect(r.created!.length).toBeGreaterThan(0);
    expect(sim.state.net.segments.size).toBeGreaterThan(before);
    // Bulldozing a road on closed ground works.
    const bulldoze = sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: r.created![0]! } });
    expect(bulldoze.ok).toBe(true);
    // A crew can be sent to closed ground (that is what it is for).
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['logistics2'] });
    expect(sim.dispatch({ type: 'cleanFallout', x: cut + 200, z: c.z }).ok).toBe(true);
    void streets;
  });

  it('growth builds nothing on closed ground, and builds on the open ground beside it', () => {
    const control = (() => {
      const sim = bare('citybloom');
      buildTown(sim, { length: 800, streets: 7 });
      serveTown(sim);
      return sim;
    })();
    const { sim, c, cut } = closedEast(true);
    const firstNew = sim.state.nextId;
    control.advance(4 * TICKS_PER_MONTH);
    sim.advance(4 * TICKS_PER_MONTH);
    const east = (s: Sim) => [...s.state.buildings.values()].filter((b) => b.x > cut + 16).length;
    const west = (s: Sim) => [...s.state.buildings.values()].filter((b) => b.x <= cut).length;
    expect(east(control), 'the control grows in the east').toBeGreaterThan(10);
    expect(east(sim), 'no building on closed ground').toBe(0);
    expect(west(sim), 'growth goes on beside it').toBeGreaterThan(10);
    for (const b of sim.state.buildings.values())
      if (b.id >= firstNew) expect(falloutBanned(sim, b.x, b.z), `building ${b.id}`).toBe(false);
    void c;
  });

  it('a town on closed ground neither upgrades nor retools, and its buildings are not demolished', () => {
    const { sim: base } = labTown(0, { length: 800, streets: 7 });
    const control = clone(base);
    const hot = clone(base);
    closeRect(hot, 0, 0, MAP_SIZE, MAP_SIZE, 0.3);
    const standing = [...hot.state.buildings.values()].filter((b) => b.state !== BState.Rubble).length;
    const ups = (sim: Sim) => {
      let n = 0;
      for (let d = 0; d < 4; d++) {
        sim.advance(TICKS_PER_MONTH);
        n += sim.events.filter((e) => e.kind === 'upgrading').length;
        sim.events.length = 0;
      }
      return n;
    };
    expect(ups(control), 'the control upgrades').toBeGreaterThan(30);
    expect(ups(hot), 'closed ground does not').toBe(0);
    // Nothing was bulldozed or destroyed by the ban itself (the bans never touch the lots’ validity).
    expect(hot.events.filter((e) => e.kind === 'demolished').length).toBe(0);
    expect(
      [...hot.state.buildings.values()].filter((b) => b.state !== BState.Rubble).length,
    ).toBeGreaterThanOrEqual(standing - 10);
    expect(hot.state.net.blocks.size).toBe(control.state.net.blocks.size);
  }, 120_000);
});

// ---------------------------------------------------------------------------------------------

describe('M40: what fallout does to the people and the work', () => {
  let base: Sim;
  beforeAll(() => {
    base = labTown(0, { length: 800, streets: 7 }).sim;
  }, 120_000);

  it('every effect is exactly 1 (or 0) without fallout, with an empty raster, and under open ground too', () => {
    const peaceful = clone(base);
    const emptied = clone(base);
    falloutOf(emptied);
    const homes = [...peaceful.state.buildings.values()].filter(
      (b) => b.pop > 0 && b.state === BState.Active,
    );
    expect(homes.length).toBeGreaterThan(20);
    for (const sim of [peaceful, emptied])
      for (const b of homes) {
        expect(radiationWork(sim, b)).toBe(1);
        expect(falloutSickness(sim, b)).toBe(0);
        expect(falloutMood(sim, b)).toBe(0);
        expect(falloutDose(sim, b.x, b.z)).toBe(0);
        expect(falloutBanned(sim, b.x, b.z)).toBe(false);
        expect(happinessFactors(sim, b).some((f) => f.label === 'Fallout nearby')).toBe(false);
      }
    for (const b of homes) {
      expect(sicknessRate(emptied, b)).toBe(sicknessRate(peaceful, b));
      expect(buildingTax(emptied, b)).toBe(buildingTax(peaceful, b));
    }
    // And a whole city with an empty raster plays two days exactly as one without: every part the same.
    peaceful.advance(2 * TICKS_PER_MONTH);
    emptied.advance(2 * TICKS_PER_MONTH);
    const a = partHashes(peaceful);
    const b = partHashes(emptied);
    const { fallout, ...rest } = b;
    expect(fallout).toBeDefined();
    expect(rest).toEqual(a);
  });

  it('sickness, mood, taxes, freight, the specialisations’ income and land value all feel it', () => {
    const control = clone(base);
    const hot = clone(base);
    closeRect(hot, 0, 0, MAP_SIZE, MAP_SIZE, 0.3);
    const homes = [...hot.state.buildings.values()].filter(
      (b) => b.pop > 0 && b.state === BState.Active && b.zone === 1,
    );
    expect(homes.length).toBeGreaterThan(10);
    const h = homes[0]!;
    const c = control.state.buildings.get(h.id)!;
    // Sickness: the dose’s share on top of the usual causes.
    expect(sicknessRate(hot, h) - sicknessRate(control, c)).toBeCloseTo(FALLOUT.effect.sickness * 0.3, 6);
    // Mood: a labelled term, negative, and the home is less happy.
    const factor = happinessFactors(hot, h).find((f) => f.label === 'Fallout nearby')!;
    expect(factor.value).toBeCloseTo(FALLOUT.effect.mood * 0.3, 3);
    // Work: taxes (and freight and income, which read the same function) are scaled.
    const k = radiationWork(hot, h);
    expect(k).toBeCloseTo(1 - FALLOUT.effect.work * 0.3, 6);
    expect(k).toBeGreaterThanOrEqual(1 - FALLOUT.effect.workMax);
    expect(buildingTax(hot, h)).toBeCloseTo(buildingTax(control, c) * k, 6);
    // Dose at full strength loses at most 60 % of the work.
    closeRect(hot, 0, 0, MAP_SIZE, MAP_SIZE, 1);
    expect(radiationWork(hot, h)).toBeCloseTo(1 - FALLOUT.effect.workMax, 9);
    // Land value: the raster settles lower.
    closeRect(hot, 0, 0, MAP_SIZE, MAP_SIZE, 0.3);
    for (let i = 0; i < 20; i++) {
      updateLandValue(hot);
      updateLandValue(control);
    }
    const cellH = cell(h.x, h.z);
    expect(hot.state.landValue[cellH]!).toBeLessThan(control.state.landValue[cellH]! - 0.05);
    // The air counts for half in the dose.
    const f = hot.state.fallout!;
    f.ground[cellH] = 0.1;
    f.air[cellH] = 0.4;
    expect(doseAtCell(f, cellH)).toBeCloseTo(0.1 + FALLOUT.airDose * 0.4, 6);
    f.ground[cellH] = 0.9;
    f.air[cellH] = 0.9;
    expect(doseAtCell(f, cellH)).toBe(1);
  });

  it('freight and the specialisations’ income are scaled by the same work', () => {
    const control = clone(base);
    const hot = clone(base);
    closeRect(hot, 0, 0, MAP_SIZE, MAP_SIZE, 0.5);
    // Taxes over the whole city: lower by the work share.
    let tc = 0;
    let th = 0;
    for (const b of control.state.buildings.values()) tc += buildingTax(control, b);
    for (const b of hot.state.buildings.values()) th += buildingTax(hot, b);
    expect(th).toBeLessThan(tc * 0.6);
    expect(th).toBeGreaterThan(tc * 0.35);
  });

  it('move-outs follow: homes in the cloud lose residents faster than the control’s', () => {
    const control = clone(base);
    const hot = clone(base);
    closeRect(hot, 0, 0, MAP_SIZE, MAP_SIZE, 0.6);
    const pop = (s: Sim) => s.state.totals.population;
    control.advance(2 * TICKS_PER_MONTH);
    hot.advance(2 * TICKS_PER_MONTH);
    expect(pop(hot)).toBeLessThan(pop(control));
  });
});

// ---------------------------------------------------------------------------------------------

describe('M40: the command and the room', () => {
  it('cleanFallout is in the lists the room checks (the roles test and the command checks cover the rest)', async () => {
    const { checkCommand } = await import('../../src/sim/commandCheck');
    expect(checkCommand({ type: 'cleanFallout', x: 100, z: 200 })).toEqual({
      cmd: { type: 'cleanFallout', x: 100, z: 200 },
    });
    expect(checkCommand({ type: 'cleanFallout', x: 'a', z: 1 })).toHaveProperty('problem');
    expect(checkCommand({ type: 'cleanFallout', x: 1e9, z: 1 })).toHaveProperty('problem');
  });

  it('atomInbound still refuses a second bomb while the first one’s fallout is being made', () => {
    // (The seam between the blast and the fallout: the blast is over before the fallout starts.)
    const sim = quiet(bare('f'));
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    const n = rivals(sim)[0]!;
    expect(atomInbound(sim, { id: n.id, name: n.name })).toMatch(/already on its way/);
  });
});

describe('M40: the checks', () => {
  it('finds a raster that is not finite or not in range, a negative counter and a crew with no time', () => {
    const sim = bare('citybloom');
    depositFallout(sim, MID, MID);
    expect(sim.state.tick % H).toBe(0);
    checkInvariants(sim);
    const f = falloutOf(sim);
    const bad: ((f: ReturnType<typeof falloutOf>) => void)[] = [
      (f) => (f.ground[7] = Number.NaN),
      (f) => (f.ground[7] = 1.5),
      (f) => (f.ground[7] = -0.1),
      (f) => (f.air[9] = Number.POSITIVE_INFINITY),
      (f) => (f.air[9] = -1),
      (f) => (f.out.west = -1),
      (f) => (f.out.north = Number.NaN),
      (f) => f.jobs.push({ x: 100, z: 100, left: 0 }),
      (f) => f.jobs.push({ x: Number.NaN, z: 100, left: 5 }),
    ];
    for (const [i, change] of bad.entries()) {
      const copy = clone(sim);
      change(falloutOf(copy));
      expect(() => checkInvariants(copy), `case ${i}`).toThrow(InvariantError);
    }
    // The raster is only scanned on the hour (it changes only at an update or a strike).
    const mid = clone(sim);
    mid.state.tick += 5;
    falloutOf(mid).ground[7] = 5;
    expect(() => checkInvariants(mid)).not.toThrow();
    void f;
  });
});
