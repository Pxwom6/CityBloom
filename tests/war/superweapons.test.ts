import { describe, expect, it } from 'vitest';
import type { UnitKind } from '../../src/data/war';
import type { Sim } from '../../src/sim/sim';
import type { AwayResult } from '../../src/sim/systems/expeditions';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { battleLayout } from '../../src/sim/battle/layout';
import { labTown, ok, refusal } from './researchTown';

/** M37: superweapons (docs/plans/M37-design.md, key calls 7–9; steps 6–7). */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A war town with a vehicle depot, and a way to put units in it. */
function supersTown() {
  const { sim, place } = labTown(0);
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
