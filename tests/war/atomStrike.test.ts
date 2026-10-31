import { beforeAll, describe, expect, it } from 'vitest';
import { ATOM } from '../../src/data/atom';
import { DOME, TIER_KEYS } from '../../src/data/research';
import { ACHIEVEMENTS } from '../../src/data/achievements';
import { resolveBattle, BATTLE_BUSY, raidMood, sheltersWithin, raidsHour } from '../../src/sim/systems/raids';
import type { Sim } from '../../src/sim/sim';
import { partHashes } from '../../src/sim/sync';
import {
  atomHour,
  atomInbound,
  atomStage,
  atomSummary,
  atomTick,
  bombMood,
} from '../../src/sim/systems/atom';
import { fightingWith, warWith } from '../../src/sim/systems/diplomacy';
import { progressHour } from '../../src/sim/systems/progress';
import { bombStopped, lowerDome, supersHour } from '../../src/sim/systems/supers';
import { warSummary } from '../../src/sim/systems/war';
import { isMonthStart, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';
import type { Civic } from '../../src/sim/world/civic';
import { groundZero } from '../../src/sim/systems/atomImpact';
import { clone, dip, rivals, treaty, why } from './economyHelpers';
import { labTown, ok } from './researchTown';
import { domeStatus } from '../../src/ui/warView';

/**
 * M40, step 3, the strike (docs/plans/M40-design.md, calls 8 to 10): a bomb on its way to the city,
 * the warning, the dome that stops one whole and what it costs, the flight of the city's own bomb to a
 * computer neighbour and what it does to that neighbour's record. (The blast itself, slice by slice,
 * is `atomImpact.test.ts`.) Calls to `atomTick` stand in for a tick where the test wants a landing
 * at once; the real clock is stepped where the flight itself is the point.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
const PLANT = 'enrichment';
const SILO = 'atomsilo';
const DOME_DEF = 'domeshield';

/** The neighbours go dark for ever: no raids and no spies to spoil a run that is about something else. */
function dark(sim: Sim): void {
  for (const n of rivals(sim)) n.rival!.blackout = { from: 0, until: 1e9 };
}

const civic = (sim: Sim, def: string) => [...sim.state.civics.values()].find((c) => c.def === def)!;
const dome = (sim: Sim) => sim.state.war!.supers!.dome!;
const atom = (sim: Sim) => sim.state.war!.atom!;
const events = (sim: Sim, kind: string) => sim.events.filter((e) => e.kind === kind);
const rubbleIds = (sim: Sim) =>
  [...sim.state.buildings.values()].filter((b) => b.state === BState.Rubble).map((b) => b.id);

/** The dome at full strength: crewed, powered, charged, in its usual mode. */
function charged(sim: Sim): void {
  const c = civic(sim, DOME_DEF);
  c.staff = 1;
  c.powered = 1;
  const d = dome(sim);
  d.hours = DOME.chargeHours;
  d.mode = 'all';
  delete d.down;
  delete d.reserve;
  delete d.raised;
}

/** Ticks of the atom system alone until a landed bomb's blast is over (civic buildings come down a few a tick). */
function blast(sim: Sim): void {
  for (let n = 0; n < 2_000 && !atom(sim).impact?.over; n++) {
    sim.state.tick++;
    atomTick(sim);
  }
  expect(atom(sim).impact?.over, 'the blast ended').toBe(true);
}

/** A bomb fired at the city by the first rival, landing in `hours`. */
function bombIn(sim: Sim, hours = 0): void {
  ok(sim, { type: 'cheat', cheat: 'bombIn', hours });
}

/** `n` hours of the superweapon buildings. */
function domeHours(sim: Sim, n: number): void {
  for (let k = 0; k < n; k++) supersHour(sim);
}

let base: Sim;
let ids: { rival: number; other: number };

beforeAll(() => {
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  dark(sim);
  place('nuclear');
  sim.advance(M);
  ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  for (const def of [PLANT, SILO, DOME_DEF])
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place(def) });
  // The crews are posted over the next days.
  sim.advance(3 * M);
  const [rival, other] = rivals(sim);
  ok(sim, { type: 'declareWar', neighbour: rival!.id, scale: 'total', reason: 'The race' });
  const war = dip(sim).wars.find((w) => w.with === rival!.id)!;
  sim.advance(Math.max(0, war.opens - sim.state.tick) + 1);
  expect(fightingWith(sim, rival!.id)?.scale).toBe('total');
  base = sim;
  ids = { rival: rival!.id, other: other!.id };
}, 180_000);

/** A copy of the base town, its dome charged. */
function town(): Sim {
  const sim = clone(base);
  charged(sim);
  return sim;
}

describe('M40: the dome and a bomb that lands', () => {
  it('stops one bomb whole: no building or civic lost, the dome down for 1,200 hours, the bomb counted', () => {
    const sim = town();
    const before = {
      rubble: rubbleIds(sim),
      civics: [...sim.state.civics.keys()],
      craters: sim.state.craters.length,
    };
    bombIn(sim);
    atomTick(sim);
    expect(events(sim, 'bombWarning')).toHaveLength(1);
    expect(events(sim, 'bombStopped')).toEqual([
      expect.objectContaining({ id: ids.rival, info: expect.objectContaining({ down: ATOM.dome.down }) }),
    ]);
    // Whole: nothing was touched.
    expect(rubbleIds(sim)).toEqual(before.rubble);
    expect([...sim.state.civics.keys()]).toEqual(before.civics);
    expect(sim.state.craters).toHaveLength(before.craters);
    expect(atom(sim).inbound).toBeUndefined();
    expect(atom(sim).impact).toBeUndefined();
    expect(atom(sim)).toMatchObject({ stopped: 1, boom: 0 });
    expect(events(sim, 'atomImpact')).toHaveLength(0);
    // The dome spent its charge and is down for the 1,200 hours before the 240 of charging.
    expect(ATOM.dome.down).toBe(1_200);
    expect(ATOM.dome.down + DOME.chargeHours).toBe(DOME.bombRecharge);
    expect(dome(sim)).toMatchObject({ hours: 0, down: 1_200 });
    expect(bombStopped(sim)).toBe(false);
    // The dome's summary says so, and the achievement follows within the hour.
    expect(warSummary(sim, () => 0)!.supers!.dome).toMatchObject({ charge: 0, down: 1_200, raised: false });
    expect(ACHIEVEMENTS.map((a) => a.id)).toContain('underTheDome');
    expect(sim.state.progress.achievements.underTheDome).toBeUndefined();
    progressHour(sim);
    expect(sim.state.progress.achievements.underTheDome).toBeDefined();
  });

  it('rises for the bomb in the dome’s other mode too, and a stopped bomb leaves no dread behind', () => {
    const sim = town();
    dome(sim).mode = 'super';
    bombIn(sim, 2);
    atomTick(sim);
    expect(raidMood(sim)).toBeLessThanOrEqual(0);
    sim.advance(2 * H);
    expect(events(sim, 'bombStopped')).toHaveLength(1);
    expect(raidMood(sim)).toBe(0);
    expect(bombMood(sim)).toBe(0);
  });

  it('a second bomb inside the window lands, and the dome is charged again 1,440 war hours after the first', () => {
    const sim = town();
    bombIn(sim);
    atomTick(sim);
    expect(atom(sim).stopped).toBe(1);
    // Another comes while it is down: it lands (the dome is not spent further).
    bombIn(sim);
    atomTick(sim);
    blast(sim);
    expect(atom(sim).impact).toMatchObject({ done: 1 });
    expect(atom(sim).boom).toBe(1);
    expect(atom(sim).stopped).toBe(1);
    expect(dome(sim)).toMatchObject({ hours: 0, down: 1_200 });
    // 1,439 hours on: nearly charged, still not stopping anything. The 1,440th does.
    const late = town();
    bombIn(late);
    atomTick(late);
    const crew = civic(late, DOME_DEF);
    crew.staff = 1;
    crew.powered = 1;
    domeHours(late, 1_199);
    expect(dome(late).down).toBe(1);
    domeHours(late, 1);
    expect(dome(late).down).toBeUndefined();
    expect(dome(late).hours).toBe(0);
    domeHours(late, DOME.chargeHours - 1);
    expect(dome(late).hours).toBe(DOME.chargeHours - 1);
    expect(bombStopped(late)).toBe(false);
    domeHours(late, 1);
    expect(dome(late).hours).toBe(DOME.chargeHours);
    expect(events(late, 'domeCharged')).toHaveLength(1);
    expect(bombStopped(late)).toBe(true);
    bombIn(late);
    atomTick(late);
    expect(atom(late).stopped).toBe(2);
  });

  it('counts its downtime on the war clock of the real run, a blackout or not, and rises for no battle meanwhile', () => {
    const sim = town();
    bombIn(sim);
    atomTick(sim);
    const clock0 = sim.state.war!.clock;
    sim.advance(10 * H);
    const passed = sim.state.war!.clock - clock0;
    expect(passed).toBeGreaterThanOrEqual(9);
    expect(dome(sim).down).toBe(1_200 - passed);
    // A blackout doesn't hold the count.
    sim.state.war!.blackout = { by: 1, from: sim.state.war!.clock, until: sim.state.war!.clock + 100 };
    const left = dome(sim).down!;
    domeHours(sim, 5);
    expect(dome(sim).down).toBe(left - 5);
    // And while it is down it rises over no battle, though its charge reads full once it is up.
    delete sim.state.war!.blackout;
    dome(sim).hours = DOME.chargeHours;
    expect(warSummary(sim, () => 0)!.supers!.dome!.down).toBeGreaterThan(0);
    sim.state.war!.supers!.dome!.hours = DOME.chargeHours;
    expect(bombStopped(sim)).toBe(false);
  });

  const LANDS: { name: string; cause: (sim: Sim) => void }[] = [
    { name: 'its mode is off', cause: (sim) => (dome(sim).mode = 'off') },
    { name: 'it is not charged', cause: (sim) => (dome(sim).hours = DOME.chargeHours - 1) },
    {
      name: 'the city is blacked out',
      cause: (sim) => {
        const w = sim.state.war!;
        w.blackout = { by: 1, from: w.clock - 1, until: w.clock + 10 };
      },
    },
    { name: 'it has no crew', cause: (sim) => (civic(sim, DOME_DEF).staff = 0.1) },
    { name: 'it has no power', cause: (sim) => (civic(sim, DOME_DEF).powered = 0.2) },
    {
      name: 'the region’s rules turn superweapons off',
      cause: (sim) => (sim.state.region.rules = { war: true, scale: 'war' }),
    },
    { name: 'the dome is gone', cause: (sim) => sim.removeCivic(civic(sim, DOME_DEF).id) },
  ];
  for (const { name, cause } of LANDS)
    it(`lands when ${name}, and the dome is left as it was`, () => {
      const sim = town();
      cause(sim);
      const spent = dome(sim).hours;
      bombIn(sim);
      atomTick(sim);
      blast(sim);
      expect(atom(sim)).toMatchObject({ stopped: 0, boom: 1 });
      expect(atom(sim).impact).toMatchObject({ over: true });
      expect(events(sim, 'bombStopped')).toHaveLength(0);
      expect(dome(sim).hours).toBe(spent);
      expect(dome(sim).down).toBeUndefined();
      expect(rubbleIds(sim).length).toBeGreaterThan(0);
    });

  it('a dome raised for a battle stops the bomb, and goes on over the battle, down for the long wait', () => {
    const sim = town();
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: ids.rival });
    const w = sim.state.war!;
    expect(w.battle).toBeDefined();
    expect(dome(sim).raised).toBe(true);
    // (Its charge is whatever it was: a raised dome counts as charged.)
    dome(sim).hours = 0;
    bombIn(sim);
    atomTick(sim);
    expect(atom(sim)).toMatchObject({ stopped: 1, boom: 0 });
    expect(w.battle).toBeDefined();
    expect(dome(sim)).toMatchObject({ raised: true, down: 1_200, hours: 0 });
    expect(rubbleIds(sim).length).toBe(0);
    // The battle's own end lowers the dome and leaves the downtime as it is.
    lowerDome(sim);
    expect(dome(sim).raised).toBeUndefined();
    expect(dome(sim).down).toBe(1_200);
  });

  it('does not charge while down even if everything else is right, and is never spent twice by one bomb', () => {
    const sim = town();
    bombIn(sim);
    atomTick(sim);
    atomTick(sim);
    atomTick(sim);
    expect(atom(sim).stopped).toBe(1);
    expect(events(sim, 'bombStopped')).toHaveLength(1);
    domeHours(sim, 100);
    expect(dome(sim)).toMatchObject({ hours: 0, down: 1_100 });
  });
});

describe('M40: the flight of the city’s own bomb to a computer neighbour', () => {
  /** The city, its bomb prepared for the rival at the end of the war's first day. */
  function fired(): Sim {
    const sim = clone(base);
    // (Not on a month's first tick: the neighbours' populations drift at each month's start, and the
    // landing is a day later, on the same minute.)
    while (isMonthStart(sim.state.tick)) sim.step();
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'preparing', to: ids.rival });
    for (const def of [PLANT, SILO]) {
      civic(sim, def).staff = 1;
      civic(sim, def).powered = 1;
    }
    for (let k = 0; k < ATOM.launch.prepHours / 2; k++) atomHour(sim);
    expect(atom(sim).fired).toBeDefined();
    return sim;
  }

  it('lands a game day after it left, on the city’s own clock, and changes the neighbour’s record', () => {
    const sim = fired();
    const f = atom(sim).fired!;
    const n = rivals(sim).find((x) => x.id === ids.rival)!;
    const r = n.rival!;
    const before = {
      population: n.population,
      relation: r.relation,
      forces: r.forces,
      defences: r.defences,
      others: rivals(sim).map((x) => [x.id, x.population, x.rival!.relation]),
    };
    const score0 = warWith(sim, ids.rival)!.score;
    expect(atomStage(sim)).toBe('flying');
    // Nothing yet, a tick before (the neighbour has grown or shrunk at the month's start since).
    sim.advance(ATOM.flight.hours * H - 1);
    expect(atom(sim).fired!.landed).toBeUndefined();
    expect(r.fallout).toBeUndefined();
    expect(r.relation).toBe(before.relation);
    const pre = { population: n.population, forces: r.forces, defences: r.defences };
    // The landing tick.
    sim.advance(1);
    expect(sim.state.tick).toBe(f.tick + ATOM.flight.hours * H);
    expect(atom(sim).fired!.landed).toBe(true);
    expect(n.population).toBe(Math.round(pre.population * ATOM.record.keep));
    expect(r.forces).toBeCloseTo(pre.forces * ATOM.record.keep, 3);
    expect(r.defences).toBeCloseTo(pre.defences * ATOM.record.keep, 3);
    expect(r.relation).toBe(-100);
    expect(r.fallout).toBe(1);
    expect(events(sim, 'atomImpact')).toEqual([
      expect.objectContaining({
        id: ids.rival,
        info: expect.objectContaining({ to: n.name, lost: pre.population - n.population }),
      }),
    ]);
    // The war score swings by the bomb's weight through the war's own scoring (60 ends a war: the
    // neighbour capitulates), and the other neighbour is untouched.
    const war = warWith(sim, ids.rival)!;
    expect(war.score).toBe(Math.min(100, score0 + ATOM.record.score));
    expect(war.capitulated).toMatchObject({ by: 'them' });
    const other = rivals(sim).find((x) => x.id === ids.other)!;
    expect(other.rival!.fallout).toBeUndefined();
    // (It has grown or shrunk a little with the month, but it has not lost most of its people.)
    expect(other.population).toBeGreaterThan(
      0.9 * (before.others.find((x) => x[0] === ids.other)![1] as number),
    );
    expect(other.rival!.relation).not.toBe(-100);
    // The firing city lost nothing, and has used its bomb.
    expect(atomStage(sim)).toBe('spent');
    expect(atom(sim).impact).toBeUndefined();
    expect(atom(sim).boom).toBe(0);
    // It lands once: later days change nothing.
    const pop = n.population;
    sim.advance(3 * M);
    expect(events(sim, 'atomImpact')).toHaveLength(1);
    // (It drifts with the months as any town does, but is not cut again.)
    expect(n.population).toBeGreaterThan(0.8 * pop);
  });

  it('is saved in the air and lands the same after a load', () => {
    const sim = fired();
    sim.advance(10 * H);
    const copy = clone(sim);
    expect(partHashes(copy)).toEqual(partHashes(sim));
    sim.advance(ATOM.flight.hours * H);
    copy.advance(ATOM.flight.hours * H);
    expect(atom(copy).fired!.landed).toBe(true);
    expect(partHashes(copy)).toEqual(partHashes(sim));
  });

  it('a war already paused by a ceasefire at the landing still costs the neighbour its people but swings no score', () => {
    const sim = fired();
    const war = warWith(sim, ids.rival)!;
    const score0 = war.score;
    // The war is called off by a ceasefire before the bomb lands (a treaty does not call a flight back).
    treaty(sim, ids.rival, [{ k: 'ceasefire', hours: 240 }]);
    expect(fightingWith(sim, ids.rival)).toBeUndefined();
    const n = rivals(sim).find((x) => x.id === ids.rival)!;
    const pop = n.population;
    sim.advance(ATOM.flight.hours * H);
    expect(n.population).toBeLessThan(pop);
    expect(n.rival!.relation).toBe(-100);
    expect(war.score).toBe(score0);
  });

  it('at a friend’s city it lands in that city’s own sim: this record is left alone', () => {
    const sim = fired();
    atom(sim).fired!.slot = 3;
    const n = rivals(sim).find((x) => x.id === ids.rival)!;
    sim.advance(ATOM.flight.hours * H - 1);
    const pop = n.population;
    sim.advance(1);
    expect(atom(sim).fired!.landed).toBe(true);
    expect(n.population).toBe(pop);
    expect(n.rival!.fallout).toBeUndefined();
    expect(events(sim, 'atomImpact')).toHaveLength(0);
  });

  it('a neighbour that is gone by the landing takes nothing and the bomb is still spent', () => {
    const sim = fired();
    sim.state.region.neighbours = sim.state.region.neighbours.filter((x) => x.id !== ids.rival);
    sim.advance(ATOM.flight.hours * H);
    expect(atom(sim).fired!.landed).toBe(true);
    expect(events(sim, 'atomImpact')).toHaveLength(0);
  });
});

describe('M40: a bomb on its way to the city', () => {
  it('is warned of at once: the siren, the homes in the blast and the shelters, in the summary before any raid', () => {
    const sim = town();
    // A raid is already coming and has been warned of.
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 1, neighbour: ids.other });
    expect(sim.state.war!.incoming).toHaveLength(1);
    expect(warSummary(sim, () => 0)!.incoming?.kind).toBe('raid');
    // Ground zero is fixed by the city's own sim, now.
    const gz = groundZero(sim);
    bombIn(sim, ATOM.flight.hours);
    const hit = atom(sim).inbound!;
    expect(hit).toMatchObject({ from: ids.rival, x: gz.x, z: gz.z, warn: sim.state.tick });
    expect(hit.arrive).toBe(sim.state.tick + ATOM.flight.hours * H);
    expect(hit.warned).toBeUndefined();
    expect(events(sim, 'bombWarning')).toHaveLength(0);
    sim.step();
    const warn = events(sim, 'bombWarning');
    expect(warn).toHaveLength(1);
    const near = sheltersWithin(sim, gz.x, gz.z, ATOM.impact.level);
    expect(warn[0]!.info).toMatchObject({ hours: 24, near: near.near, sheltered: near.sheltered, stops: 1 });
    expect(near.near).toBeGreaterThan(0);
    // The bomb comes first in the war summary, with nothing else of a raid about it.
    const inc = warSummary(sim, () => 0)!.incoming!;
    expect(inc).toMatchObject({
      kind: 'bomb',
      from: hit.name,
      arrive: hit.arrive,
      units: 0,
      near: near.near,
    });
    expect(inc.at).toEqual(gz);
    expect(atomSummary(sim)!.inbound).toMatchObject({ x: gz.x, z: gz.z, stops: true, near: near.near });
    // The warning is given once.
    sim.advance(3);
    expect(events(sim, 'bombWarning')).toHaveLength(1);
    // The people dread it: the raid dip's formula, at the bomb's weight, less the shelters.
    const sheltered = near.sheltered / near.near;
    expect(raidMood(sim)).toBeCloseTo(-ATOM.warning.mood * (1 - sheltered), 6);
    expect(raidMood(sim)).toBeLessThan(0);
  });

  it('holds back every raid and battle while it is in the air, and they go on after it', () => {
    const sim = town();
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 3, neighbour: ids.other });
    const raid = sim.state.war!.incoming![0]!;
    bombIn(sim, 10);
    // No second raid is made, or asked for (here a raid is coming already; with none, the bomb is why).
    expect(why(sim, { type: 'cheat', cheat: 'raidIn', hours: 5 })).toMatch(/already on its way/);
    const only = town();
    bombIn(only, 10);
    expect(why(only, { type: 'cheat', cheat: 'raidIn', hours: 5 })).toMatch(/atom bomb is on its way/);
    // The raid that was coming is due in three hours, and waits.
    sim.advance(4 * H);
    expect(sim.state.war!.battle).toBeUndefined();
    expect(sim.state.war!.incoming).toHaveLength(1);
    expect(raid.arrive).toBeGreaterThan(sim.state.tick);
    // A friend's battle is put off too (offered again later).
    const cloneWithBattle = town();
    ok(cloneWithBattle, { type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: ids.other });
    const input = { ...cloneWithBattle.state.war!.battle!.input, id: 'friend-battle-1' };
    const probe = (s: Sim) => resolveBattle(s, input, 'instant', true);
    const free = town();
    expect(probe(free)).toMatchObject({ ok: true });
    const inbound = town();
    bombIn(inbound, 5);
    expect(probe(inbound)).toMatchObject({ ok: false, reason: BATTLE_BUSY });
    // The bomb lands (the dome stops it); the raid then begins within the hour.
    sim.advance(7 * H);
    expect(atom(sim).stopped).toBe(1);
    expect(atom(sim).inbound).toBeUndefined();
    sim.advance(2 * H);
    expect(sim.state.war!.battle ?? sim.state.war!.reports?.length).toBeTruthy();
  });

  it('decides no new raid while it is in the air (the neighbours’ dice are not even drawn), and does when it is not', () => {
    const arm = (sim: Sim) => {
      // The rival at war with the city is free to raid and far stronger.
      delete sim.state.region.neighbours.find((n) => n.id === ids.rival)!.rival!.blackout;
      sim.state.region.neighbours.find((n) => n.id === ids.rival)!.rival!.forces = 400;
    };
    // The control: with nothing in the air the strong rival raids within a few hundred tries.
    const control = town();
    arm(control);
    for (let k = 0; k < 400 && !control.state.war!.incoming?.length; k++) raidsHour(control);
    expect(control.state.war!.incoming?.length ?? 0).toBe(1);
    // With a bomb in the air it never does, and no dice are drawn.
    const sim = town();
    arm(sim);
    bombIn(sim, 24);
    const w = sim.state.war!;
    const rng = JSON.stringify(w.rng);
    for (let k = 0; k < 400; k++) raidsHour(sim);
    expect(w.incoming).toBeUndefined();
    expect(JSON.stringify(w.rng)).toBe(rng);
  });

  it('refuses a second bomb while one is in the air, and says so', () => {
    const sim = town();
    bombIn(sim, 5);
    expect(why(sim, { type: 'cheat', cheat: 'bombIn', hours: 1 })).toMatch(/already on its way/);
    expect(atomInbound(sim, { id: ids.other, name: 'x' })).toMatch(/already on its way/);
    expect(atom(sim).inbound!.from).toBe(ids.rival);
  });

  it('is a test-mode cheat only, and a war-city one', () => {
    const sim = town();
    sim.testMode = false;
    expect(why(sim, { type: 'cheat', cheat: 'bombIn', hours: 1 })).toMatch(/Test mode only/);
    sim.testMode = true;
    expect(why(sim, { type: 'cheat', cheat: 'bombIn', hours: -1 })).toMatch(/Invalid hours/);
    expect(why(sim, { type: 'cheat', cheat: 'bombIn', hours: 1, from: 99_999 })).toMatch(/No rival/);
    delete sim.state.war;
    expect(why(sim, { type: 'cheat', cheat: 'bombIn', hours: 1 })).toMatch(/War is off/);
  });

  it('flies on the city’s own clock: the fair clock holds the war clock, and the dome’s downtime with it, not the missile', () => {
    const sim = town();
    const w = sim.state.war!;
    // A region's fair clock holds a city that is ahead of it: the war clock stands still.
    w.clockCap = w.clock;
    const clock0 = w.clock;
    bombIn(sim, 5);
    sim.advance(5 * H);
    expect(atom(sim)).toMatchObject({ stopped: 1, boom: 0 });
    sim.advance(3 * H);
    expect(w.clock).toBe(clock0);
    // The dome's long wait counts war hours, so it has not moved.
    expect(dome(sim).down).toBe(ATOM.dome.down);
    // Let the clock go and it counts again.
    delete w.clockCap;
    sim.advance(3 * H);
    expect(dome(sim).down).toBeLessThan(ATOM.dome.down);
  });

  it('is saved in the air and lands the same after a load', () => {
    const sim = town();
    civic(sim, DOME_DEF).staff = 1;
    dome(sim).mode = 'off';
    bombIn(sim, 6);
    sim.advance(2 * H);
    const copy = clone(sim);
    expect(atom(copy).inbound).toEqual(atom(sim).inbound);
    expect(partHashes(copy)).toEqual(partHashes(sim));
    sim.advance(8 * H);
    copy.advance(8 * H);
    expect(atom(sim).boom).toBe(1);
    expect(partHashes(copy)).toEqual(partHashes(sim));
  });
});

describe('M40: what the blast takes from the race', () => {
  /** The blast on a civic building of the base town, the dome out of the way, the bomb ready and the fuel full. */
  function strike(def: string): { sim: Sim; at: Civic; plant: Civic; silo: Civic } {
    const sim = clone(base);
    dome(sim).mode = 'off';
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'preparing', to: ids.rival });
    const plant = civic(sim, PLANT);
    const silo = civic(sim, SILO);
    expect(atom(sim)).toMatchObject({ fuel: ATOM.fuel.hours, have: true });
    expect(atom(sim).prep).toBeDefined();
    const at = civic(sim, def);
    bombIn(sim);
    Object.assign(atom(sim).inbound!, { x: at.x, z: at.z });
    atomTick(sim);
    blast(sim);
    return { sim, at, plant, silo };
  }
  const inBlast = (a: Civic, b: Civic) => Math.hypot(a.x - b.x, a.z - b.z) <= ATOM.impact.level;

  it('a silo in the blast loses its bomb, its build and its preparation, as any lost silo does', () => {
    const { sim, at, plant } = strike(SILO);
    expect(sim.state.civics.has(at.id)).toBe(false);
    const a = atom(sim);
    expect(a.have).toBeUndefined();
    expect(a.prep).toBeUndefined();
    expect(a.bomb).toBeUndefined();
    expect(events(sim, 'atomLost').filter((e) => e.info?.what === 'bomb')).toHaveLength(1);
    expect(atomStage(sim)).not.toBe('ready');
    expect(atomStage(sim)).not.toBe('preparing');
    // The plant stands or falls with where it is.
    expect(sim.state.civics.has(plant.id)).toBe(!inBlast(plant, at));
    expect(a.fuel).toBe(inBlast(plant, at) ? ATOM.fuel.hours / 2 : ATOM.fuel.hours);
  });

  it('a plant in the blast halves the fuel', () => {
    const { sim, at, silo } = strike(PLANT);
    expect(sim.state.civics.has(at.id)).toBe(false);
    expect(atom(sim).fuel).toBe(ATOM.fuel.hours / 2);
    expect(events(sim, 'atomLost').filter((e) => e.info?.what === 'fuel')).toHaveLength(1);
    // The bomb goes with the silo if it stood in the blast too.
    expect(sim.state.civics.has(silo.id)).toBe(!inBlast(silo, at));
    expect(atom(sim).have).toBe(inBlast(silo, at) ? undefined : true);
  });
});

describe('M40: the test cheat for a used bomb', () => {
  it('sets a bomb that has already landed: the neighbour it was aimed at is not hit again', () => {
    const sim = clone(base);
    const n = rivals(sim).find((x) => x.id === ids.rival)!;
    const before = {
      population: n.population,
      relation: n.rival!.relation,
      forces: n.rival!.forces,
      defences: n.rival!.defences,
      fallout: n.rival!.fallout,
    };
    const score0 = warWith(sim, ids.rival)?.score;
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'spent', to: ids.rival });
    expect(atomStage(sim)).toBe('spent');
    expect(atom(sim).fired).toMatchObject({ to: ids.rival, landed: true });
    atomTick(sim);
    sim.step();
    expect(atomStage(sim)).toBe('spent');
    expect(n.population).toBe(before.population);
    expect(n.rival!.relation).toBe(before.relation);
    expect(n.rival!.forces).toBe(before.forces);
    expect(n.rival!.defences).toBe(before.defences);
    expect(n.rival!.fallout).toBe(before.fallout);
    expect(warWith(sim, ids.rival)?.score).toBe(score0);
    expect(events(sim, 'atomImpact')).toHaveLength(0);
    // (A bomb in the air is another stage: it does land.)
    const air = clone(base);
    ok(air, { type: 'cheat', cheat: 'atom', stage: 'flying', to: ids.rival });
    expect(atom(air).fired!.landed).toBeUndefined();
  });
});

describe('M40: the dome inspector’s words', () => {
  it('says down for the wait after it stops a bomb, then charging, then charged, and raised over a battle', () => {
    const sim = town();
    const summary = () => warSummary(sim, () => 0)!.supers!.dome!;
    expect(domeStatus(summary())).toBe('Charged');
    bombIn(sim);
    atomTick(sim);
    // Down: how long, not "Charging" with an empty bar.
    expect(summary()).toMatchObject({ charge: 0, down: ATOM.dome.down });
    expect(domeStatus(summary())).toBe('Down for 50 days more');
    civic(sim, DOME_DEF).staff = 1;
    civic(sim, DOME_DEF).powered = 1;
    domeHours(sim, ATOM.dome.down - 12);
    expect(domeStatus(summary())).toBe('Down for 12 h more');
    domeHours(sim, 12);
    expect(domeStatus(summary())).toBe('Charging');
    domeHours(sim, DOME.chargeHours);
    expect(domeStatus(summary())).toBe('Charged');
    expect(domeStatus({ raised: true, down: 300, charge: 0 })).toBe('Raised');
  });
});
