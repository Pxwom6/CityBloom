import { describe, expect, it } from 'vitest';
import type { UnitKind } from '../../src/data/war';
import type { Sim } from '../../src/sim/sim';
import type { AwayResult } from '../../src/sim/systems/expeditions';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { battleLayout } from '../../src/sim/battle/layout';
import { awayCity, awayInput } from '../../src/sim/battle/away';
import { growRivalTown } from '../../src/sim/ai/town';
import { S } from '../../src/sim/battle/types';
import { DOME, type TierKey } from '../../src/data/research';
import { blackedOut, domeCharge, rivalBlackedOut, superBuilding } from '../../src/sim/systems/supers';
import { labTown, ok, refusal } from './researchTown';
import { trainingRate, vehicleSpeedup, warSummary } from '../../src/sim/systems/war';
import { adoptBattle } from '../../src/sim/systems/raids';
import type { BattleInput } from '../../src/sim/battle/types';

/** M37: superweapons (docs/plans/M37-design.md, key calls 7–9; steps 6–7). */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/**
 * A war town with a vehicle depot, and a way to put units in it; `big` grows one large enough to
 * staff a superweapon building (about 2,600 people).
 */
function supersTown(big = false) {
  const { sim, place } = labTown(0, big ? { length: 800, streets: 7 } : {});
  const depot = place('vehicledepot');
  sim.advance(M);
  const s = sim.state;
  const w = s.war!;
  const add = (kind: UnitKind, base = depot) => {
    const id = s.nextId++;
    w.units.set(id, { id, kind, base, hp: 1, born: s.tick });
    return id;
  };
  const rival = s.region.neighbours.find((n) => n.rival && n.side === 'west') ?? s.region.neighbours[0]!;
  return { sim, place, depot, add, rival };
}

const sendCmd = (units: number[], to: number, route: 'highway' | 'rail' | 'sea' | 'air' = 'highway') =>
  ({ type: 'sendForce', units, to, route, target: 'military', stance: 'bold' }) as const;

/** The page's report of a battle in which `out` were knocked out and the rest came through whole. */
function report(units: number[], out: number[] = []): AwayResult {
  return {
    outcome: 'raided',
    units: units.map((id) => ({ id, hp: out.includes(id) ? 0 : 0.8, out: out.includes(id) })),
    theirLost: 0,
    theirStrength: 10,
    defencesLost: 0,
    destroyed: 0,
    damaged: 0,
    objectives: { aimed: 1, down: 0 },
    hash: 'test',
  };
}

/** Steps until the force is at its target. */
function arrive(sim: Sim, id: number): void {
  const e = () => sim.state.war!.expeditions!.find((x) => x.id === id)!;
  for (let t = 0; t < 48 * H && e().state !== 'fighting'; t++) sim.step();
  expect(e().state).toBe('fighting');
}

/** Steps until every force is home. */
function home(sim: Sim): void {
  for (let t = 0; t < 72 * H && sim.state.war!.expeditions?.length; t++) sim.step();
  expect(sim.state.war!.expeditions).toBeUndefined();
}

describe('M37 superweapons in forces', () => {
  it('a force takes one superweapon, by its own route, twice as long on the road', () => {
    const { sim, add, rival } = supersTown();
    const robot = add('windupbot');
    const robot2 = add('windupbot');
    const tank = add('tank');
    expect(refusal(sim, sendCmd([robot, robot2], rival.id))).toBe('A force takes one superweapon');
    sim.state.war!.units.delete(robot2);
    expect(refusal(sim, sendCmd([robot, tank], rival.id, 'rail'))).toBe(
      'The giant wind-up robot goes only by road',
    );
    // Off where the region's rules say so.
    sim.state.region.rules = { war: true, scale: 'skirmish' };
    expect(refusal(sim, sendCmd([robot, tank], rival.id))).toBe('Your region’s rules turn superweapons off');
    delete sim.state.region.rules;
    const r = ok(sim, sendCmd([robot, tank], rival.id));
    const e = sim.state.war!.expeditions!.find((x) => x.id === r.created![0])!;
    // Six hours by road, twice over for the robot (and a fifth more from the north or south).
    const hours = rival.side === 'west' ? 12 : 14.5;
    expect((e.arrive - e.depart) / H).toBe(hours);
  });

  it('the whale needs a coast to come from; so does any force by sea', () => {
    const { sim, add, rival } = supersTown();
    const s = sim.state;
    const whale = add('clockworkwhale');
    rival.kind = 'industrial';
    expect(refusal(sim, sendCmd([whale], rival.id, 'sea'))).toBe(
      `The clockwork whale needs a coast: ${rival.name} has none it can reach`,
    );
    const boat = add('patrolboat');
    s.war!.units.delete(whale);
    expect(refusal(sim, sendCmd([boat], rival.id, 'sea'))).toBe(`${rival.name} has no coast to come from`);
    rival.kind = 'resort';
    expect(refusal(sim, sendCmd([boat], rival.id, 'sea'))).toBeNull();
  });

  it('never lost: knocked out, it is towed home, and winds up for twice as long', () => {
    const { sim, add, rival } = supersTown();
    const w = sim.state.war!;
    const robot = add('windupbot');
    const tank = add('tank');
    const first = ok(sim, sendCmd([robot, tank], rival.id)).created![0]!;
    arrive(sim, first);
    ok(sim, { type: 'battleReport', expedition: first, result: report([robot, tank], [robot, tank]) });
    // The tank is gone; the robot is wound down to its last spring and comes home.
    expect(w.units.has(tank)).toBe(false);
    expect(w.units.get(robot)!.hp).toBe(0.05);
    expect(w.reports!.at(-1)!.lost).toEqual({ tank: 1 });
    expect(w.units.get(robot)!.ready).toBeUndefined();
    home(sim);
    const robotUnit = w.units.get(robot)!;
    expect(robotUnit.away).toBeUndefined();
    expect(robotUnit.ready).toBe(w.clock + 480);
    // Mended, it still waits for its spring.
    robotUnit.hp = 1;
    sim.advance(5 * H);
    expect(refusal(sim, sendCmd([robot], rival.id))).toBe(
      `The giant wind-up robot is winding up again: ready in ${robotUnit.ready! - w.clock} hours`,
    );
    sim.advance((robotUnit.ready! - w.clock) * H);
    expect(refusal(sim, sendCmd([robot], rival.id))).toBeNull();
  });

  it('a battle fought whole spends one cooldown; one never fought spends none', () => {
    const { sim, add, rival } = supersTown();
    const w = sim.state.war!;
    const robot = add('windupbot');
    // Called back on the way: no cooldown.
    const first = ok(sim, sendCmd([robot], rival.id)).created![0]!;
    sim.advance(2 * H);
    ok(sim, { type: 'recallForce', expedition: first });
    home(sim);
    expect(w.units.get(robot)!.ready).toBeUndefined();
    // Fought and came through: 240 hours.
    const second = ok(sim, sendCmd([robot], rival.id)).created![0]!;
    arrive(sim, second);
    ok(sim, { type: 'battleReport', expedition: second, result: report([robot]) });
    home(sim);
    expect(w.units.get(robot)!.ready).toBe(w.clock + 240);
  });

  it('never defends at home, and the cheat winds every one up', () => {
    const { sim, add } = supersTown();
    const robot = add('windupbot');
    const tank = add('tank');
    const ids = battleLayout(sim, { target: 'military' }).defenders.map((u) => u.id);
    expect(ids).toContain(tank);
    expect(ids).not.toContain(robot);
    const w = sim.state.war!;
    w.units.get(robot)!.ready = w.clock + 100;
    ok(sim, { type: 'cheat', cheat: 'superReady' });
    expect(w.units.get(robot)!.ready).toBeUndefined();
  });
});

/** A war town with a superweapon building finished (its research done, its stages cheated) and staffed. */
function withBuilding(def: string, tiers: TierKey[]) {
  const t = supersTown(true);
  ok(t.sim, { type: 'cheat', cheat: 'research', tiers });
  const civic = t.place(def);
  expect(t.sim.state.civics.get(civic)!.build).toBeDefined();
  ok(t.sim, { type: 'cheat', cheat: 'finishStages', civic });
  t.sim.advance(M);
  const c = t.sim.state.civics.get(civic)!;
  expect(c.staff ?? 0).toBeGreaterThanOrEqual(0.25);
  expect(c.powered ?? 0).toBeGreaterThanOrEqual(0.5);
  return { ...t, civic };
}

describe('M37 superweapon buildings', () => {
  it('the dome charges for ten days while it works, takes a mode, and holds four hours in a blackout', () => {
    const { sim } = withBuilding('domeshield', ['defence1', 'defence2', 'defence3', 'defence4']);
    const w = sim.state.war!;
    expect(superBuilding(sim, 'dome')).toBeDefined();
    const dome = w.supers!.dome!;
    expect(dome.mode).toBe('all');
    // A month (a game day) of charging so far.
    expect(dome.hours).toBeGreaterThan(0);
    expect(dome.hours).toBeLessThanOrEqual(24);
    // An hour's charge for every hour it works: full within the ten days and a little.
    for (let h = 0; h < DOME.chargeHours + 60 && domeCharge(sim) < 1; h++) sim.advance(H);
    expect(domeCharge(sim)).toBe(1);
    expect(refusal(sim, { type: 'setDome', mode: 'bogus' as never })).toBe('No such mode');
    ok(sim, { type: 'setDome', mode: 'super' });
    expect(w.supers!.dome!.mode).toBe('super');
    // Blacked out: no charging, and a full dome falls after its reserve.
    w.blackout = { by: 1, from: w.clock, until: w.clock + 12 };
    expect(blackedOut(sim)).toBe(true);
    sim.advance(3 * H);
    expect(domeCharge(sim)).toBe(1);
    sim.advance(2 * H);
    expect(domeCharge(sim)).toBe(0);
    sim.advance(8 * H);
    // The blackout over, it charges again.
    expect(blackedOut(sim)).toBe(false);
    sim.advance(3 * H);
    expect(w.supers!.dome!.hours).toBeGreaterThan(0);
  });

  it('the blackout tower darkens a computer neighbour after an hour: no raids from it, and it minds', () => {
    const { sim, rival } = withBuilding('blackouttower', ['intel1', 'intel2', 'intel3', 'intel4']);
    const w = sim.state.war!;
    const friend = sim.state.region.neighbours.find((n) => !n.rival);
    if (friend)
      expect(refusal(sim, { type: 'useBlackout', neighbour: friend.id })).toBe(
        `${friend.name} isn’t a rival`,
      );
    sim.state.region.rules = { war: true, scale: 'skirmish' };
    expect(refusal(sim, { type: 'useBlackout', neighbour: rival.id })).toBe(
      'Your region’s rules turn superweapons off',
    );
    delete sim.state.region.rules;
    const before = rival.rival!.relation;
    ok(sim, { type: 'useBlackout', neighbour: rival.id });
    expect(refusal(sim, { type: 'useBlackout', neighbour: rival.id })).toBe(
      'The blackout tower is already charging',
    );
    expect(rivalBlackedOut(sim, rival)).toBe(false);
    sim.advance(H);
    expect(rivalBlackedOut(sim, rival)).toBe(true);
    expect(rival.rival!.relation).toBe(Math.max(-100, before - 15));
    expect(refusal(sim, { type: 'useBlackout', neighbour: rival.id })).toMatch(
      /^The blackout tower is charging: ready in \d+ hours$/,
    );
    sim.advance(12 * H);
    expect(rivalBlackedOut(sim, rival)).toBe(false);
    expect(rival.rival!.blackout).toBeUndefined();
    // Ten days from use, it may fire again.
    sim.advance(240 * H);
    expect(refusal(sim, { type: 'useBlackout', neighbour: rival.id })).toBeNull();
    void w;
  });

  it('a blacked-out neighbour sends no raids, even at war with a city it outguns', () => {
    const raidsFrom = (blackout: boolean) => {
      const { sim, rival } = supersTown();
      const w = sim.state.war!;
      ok(sim, { type: 'cheat', cheat: 'rival', neighbour: rival.id, forces: 200, defences: 10 });
      rival.rival!.relation = -100;
      // At war, a town raids however young the city is.
      ok(sim, { type: 'declareWar', neighbour: rival.id, scale: 'war', reason: 'Our border' });
      if (blackout) rival.rival!.blackout = { from: w.clock, until: w.clock + 10_000 };
      let seen = 0;
      for (let h = 0; h < 30 * 24; h++) {
        sim.advance(H);
        if (w.incoming?.some((r) => r.from === rival.id) || w.battle?.raid.from === rival.id) seen++;
        if (seen) break;
      }
      return seen;
    };
    expect(raidsFrom(false)).toBeGreaterThan(0);
    expect(raidsFrom(true)).toBe(0);
  });

  it('the express gate takes a land or air force there in an hour, then charges for five days', () => {
    const { sim, add, rival } = withBuilding('expressgate', [
      'logistics1',
      'logistics2',
      'logistics3',
      'logistics4',
    ]);
    const w = sim.state.war!;
    const tank = add('tank');
    const boat = add('patrolboat');
    rival.kind = 'resort';
    expect(refusal(sim, { ...sendCmd([boat], rival.id, 'sea'), gate: true })).toBe(
      'Ships can’t go through the gate',
    );
    const id = ok(sim, { ...sendCmd([tank], rival.id), gate: true }).created![0]!;
    const e = w.expeditions!.find((x) => x.id === id)!;
    expect(e.arrive - e.depart).toBe(H);
    expect(e.gate).toBe(true);
    expect(w.supers!.gate!.ready).toBe(w.clock + 120);
    const tank2 = add('tank');
    const other = sim.state.region.neighbours.find((n) => n.rival && n.id !== rival.id);
    if (other)
      expect(refusal(sim, { ...sendCmd([tank2], other.id), gate: true })).toBe(
        'The express gate is charging: ready in 120 hours',
      );
    arrive(sim, id);
    ok(sim, { type: 'battleReport', expedition: id, result: report([tank]) });
    expect((e.home - sim.state.tick) / H).toBe(1);
    home(sim);
  });

  it('a charged dome rises over a battle at home, soaks it, and is down afterwards', () => {
    const { sim, rival } = withBuilding('domeshield', ['defence1', 'defence2', 'defence3', 'defence4']);
    const w = sim.state.war!;
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: rival.id, forces: 60, defences: 10 });
    const raid = (mode: 'all' | 'super' | 'off') => {
      ok(sim, { type: 'setDome', mode });
      ok(sim, { type: 'cheat', cheat: 'superReady' });
      expect(domeCharge(sim)).toBe(1);
      sim.events.length = 0;
      ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: rival.id });
      for (let t = 0; t < M && !w.battle; t++) sim.step();
      expect(w.battle).toBeDefined();
      const pool = w.battle!.input.layout.dome;
      const raised = !!w.supers!.dome!.raised;
      const events: string[] = [];
      for (let t = 0; t < M && w.battle; t++) {
        sim.step();
        events.push(...sim.events.map((e) => e.kind));
      }
      expect(w.battle).toBeUndefined();
      return { pool, raised, events, charge: domeCharge(sim) };
    };
    // Kept down, or kept for superweapons (computer raids bring none): the battle meets no dome.
    for (const mode of ['off', 'super'] as const) {
      const r = raid(mode);
      expect(r.pool, mode).toBeUndefined();
      expect(r.raised, mode).toBe(false);
      expect(r.charge, mode).toBe(1);
    }
    // Raised for every battle: its pool is in the battle, and it's spent once the battle is over.
    const r = raid('all');
    expect(r.pool).toBe(DOME.pool);
    expect(r.raised).toBe(true);
    expect(r.charge).toBe(0);
    expect(w.supers!.dome!.raised).toBeUndefined();
    // Nothing of the city fell while the dome held, unless it popped.
    const last = w.reports!.at(-1)!;
    if (!r.events.includes('domePopped')) {
      expect(last.collapsed).toEqual([]);
      expect(last.civics).toEqual([]);
    }
  });

  it('in a blacked-out town the guns are manned at a third', () => {
    const { sim, add, rival } = supersTown();
    const w = sim.state.war!;
    const tank = add('tank');
    const id = ok(sim, sendCmd([tank], rival.id)).created![0]!;
    const e = w.expeditions!.find((x) => x.id === id)!;
    const town = growRivalTown({
      citySeed: sim.state.options.seed,
      neighbour: rival.id,
      name: rival.name,
      kind: rival.kind,
      personality: rival.rival!.personality,
      population: rival.population,
      cap: 1_500,
    });
    const manned = (input: ReturnType<typeof awayInput>) => {
      const out: number[] = [];
      for (let k = 0; k < input.layout.structs.length / S.stride; k++)
        if (input.layout.structs[k * S.stride + S.gun]! > 0)
          out.push(input.layout.structs[k * S.stride + S.manned]!);
      return out;
    };
    const before = manned(awayInput(awayCity(sim, e), town));
    expect(before.some((m) => m > 0)).toBe(true);
    expect(awayCity(sim, e).neighbour.manning).toBeUndefined();
    rival.rival!.blackout = { from: w.clock, until: w.clock + 12 };
    const city = awayCity(sim, e);
    expect(city.neighbour.manning).toBe(0.3);
    const after = manned(awayInput(city, town));
    expect(after).toEqual(before.map((m) => Math.round(m * 0.3 * 1000) / 1000));
  });
});

describe('M37 review fixes: superweapons and research in battles', () => {
  it('a base keeping a superweapon can’t be bulldozed (no cooldown dodged, no second one made)', () => {
    const { sim, add, depot } = supersTown();
    const robot = add('windupbot');
    expect(refusal(sim, { type: 'bulldoze', target: { kind: 'civic', id: depot } })).toBe(
      'The vehicle depot keeps the giant wind-up robot: stand it down first',
    );
    ok(sim, { type: 'disbandUnit', unit: robot });
    expect(refusal(sim, { type: 'bulldoze', target: { kind: 'civic', id: depot } })).toBeNull();
  });

  it('an arms factory speeds up vehicles, not the robot', () => {
    const { sim, place, depot } = supersTown(true);
    place('armsfactory');
    sim.advance(M);
    const c = sim.state.civics.get(depot)!;
    const speedup = vehicleSpeedup(sim);
    expect(speedup).toBeGreaterThan(0);
    const tank = trainingRate(sim, c, 'tank');
    expect(trainingRate(sim, c, 'windupbot')).toBeCloseTo(tank * (1 - speedup), 12);
  });

  it('a superweapon building going up has no posts in the war room’s staff count', () => {
    const { sim, place } = supersTown(true);
    const before = warSummary(sim, () => 0)!.staff.jobs;
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['defence1', 'defence2', 'defence3', 'defence4'] });
    const dome = place('domeshield');
    expect(sim.state.civics.get(dome)!.build).toBeDefined();
    expect(warSummary(sim, () => 0)!.staff.jobs).toBe(before);
  });

  it('a friend’s battle picturing the city’s defenders without their research fights them as strangers', () => {
    const { sim, add } = supersTown();
    const tank = add('tank');
    const plane = add('patrolboat');
    // The battle's picture: drawn before Composite armour (no land mods).
    const layout = battleLayout(sim, { target: 'military' });
    expect(layout.mods).toBeUndefined();
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['land1', 'land2', 'land3'] });
    const input = {
      v: 3,
      id: 'stale',
      seed: 'x',
      scale: 'skirmish',
      layout,
      attacker: {
        name: 'A',
        color: 1,
        units: [],
        route: 'highway',
        target: 'military',
        stance: 'bold',
        readiness: 1,
      },
      defender: { name: 'B', color: 2 },
      orders: [],
      caps: { maxCollapse: 12, maxWreck: 3 },
    } as unknown as BattleInput;
    const adopted = adoptBattle(sim, input);
    const ids = adopted.layout.defenders.map((u) => u.id);
    // The tank (land, now stronger than pictured) is a stranger; the boat (sea, unchanged) is the city's.
    expect(ids).not.toContain(tank);
    expect(ids).toContain(plane);
    // A picture with the research in it keeps the tank.
    const fresh = adoptBattle(sim, { ...input, layout: battleLayout(sim, { target: 'military' }) });
    expect(fresh.layout.defenders.map((u) => u.id)).toContain(tank);
  });
});
