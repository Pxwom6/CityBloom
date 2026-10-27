import { describe, expect, it } from 'vitest';
import { INTEL, SPY_OP, type SpyOp } from '../../src/data/intel';
import { TIER } from '../../src/data/research';
import type { Sim } from '../../src/sim/sim';
import { awayCity } from '../../src/sim/battle/away';
import { rivalMix, rivalMods } from '../../src/sim/ai/tech';
import { RIVAL_MIX } from '../../src/data/battle';
import {
  agentsFree,
  agentsKept,
  counterIntel,
  depotSabotaged,
  freshIncident,
  grieved,
  intelMonth,
  powerSabotaged,
  revealed,
  rivalCounter,
} from '../../src/sim/systems/intel';
import { rivalsMonth } from '../../src/sim/systems/war';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { labTown, ok, refusal } from './researchTown';

/** M37: spies and counter-intelligence (docs/plans/M37-design.md, key calls 11–12; step 8). */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A war town with a spy agency (Spy agency and Stealth researched), staffed. */
function agencyTown(tiers: string[] = ['intel1', 'intel2', 'intel3']) {
  // A town big enough to keep its agency staffed (a small one's forces take every spare worker).
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  ok(sim, { type: 'cheat', cheat: 'research', tiers: tiers as never });
  const agency = place('spyagency');
  sim.advance(M);
  const c = sim.state.civics.get(agency)!;
  expect(c.staff ?? 0).toBeGreaterThanOrEqual(0.25);
  const rival = sim.state.region.neighbours.find((n) => n.rival)!;
  return { sim, place, agency, rival };
}

/**
 * Sends missions of a kind until one ends as wanted (each mission's dice are its own, the same on
 * every machine), and returns its result; at most `tries`.
 */
function missionUntil(
  sim: Sim,
  to: number,
  op: SpyOp,
  want: 'success' | 'caught' | 'failed',
  extra: { target?: 'power' | 'depot'; branch?: 'air' | 'land' } = {},
  tries = 40,
) {
  const w = sim.state.war!;
  for (let k = 0; k < tries; k++) {
    // An agent free (a caught one is replaced after two days).
    for (let t = 0; t < 4 * 24 && agentsFree(sim) <= 0; t++) sim.advance(H);
    const id = ok(sim, { type: 'spyMission', neighbour: to, op, ...extra }).created![0]!;
    const m = () => w.intel!.missions.find((x) => x.id === id);
    const arrive = m()!.arrive;
    while (w.clock < arrive) sim.advance(H);
    const outcome = m()?.outcome ?? 'caught';
    if (outcome === want) return { id, k };
    // Home again before the next.
    for (let t = 0; t < 30 && m(); t++) sim.advance(H);
  }
  throw new Error(`no ${want} in ${tries} missions`);
}

describe('M37 intelligence', () => {
  it('the agency keeps agents, and missions are refused without what they need', () => {
    const { sim, rival } = agencyTown(['intel1', 'intel2']);
    expect(agentsKept(sim)).toBe(INTEL.agents);
    expect(refusal(sim, { type: 'spyMission', neighbour: rival.id, op: 'steal', branch: 'air' })).toBe(
      `${SPY_OP.steal.name} needs ${TIER.get('intel3')!.name} research`,
    );
    expect(refusal(sim, { type: 'spyMission', neighbour: rival.id, op: 'sabotage' })).toBe(
      'Choose what to sabotage: its power or its depot',
    );
    const before = sim.state.economy.month.spies ?? 0;
    ok(sim, { type: 'spyMission', neighbour: rival.id, op: 'reveal' });
    expect((sim.state.economy.month.spies ?? 0) - before).toBe(-SPY_OP.reveal.cost);
    ok(sim, { type: 'spyMission', neighbour: rival.id, op: 'reveal' });
    expect(refusal(sim, { type: 'spyMission', neighbour: rival.id, op: 'reveal' })).toBe(
      'Every agent is out',
    );
    // Stealth brings a third agent.
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['intel3'] });
    expect(agentsKept(sim)).toBe(INTEL.agents + 1);
    expect(agentsFree(sim)).toBe(1);
    // Stealing needs a neighbour further on than the city.
    expect(refusal(sim, { type: 'spyMission', neighbour: rival.id, op: 'steal', branch: 'air' })).toBe(
      `${rival.name} is no further than you in Air research`,
    );
    // A neutral city only looks.
    ok(sim, { type: 'setNeutral', on: true });
    expect(refusal(sim, { type: 'spyMission', neighbour: rival.id, op: 'sabotage', target: 'power' })).toBe(
      'A neutral city only sends spies to look',
    );
  });

  it('a look round reveals the neighbour: forces readier there, its raids seen sooner', () => {
    const { sim, rival } = agencyTown();
    const w = sim.state.war!;
    expect(revealed(sim, rival)).toBe(false);
    missionUntil(sim, rival.id, 'reveal', 'success');
    expect(revealed(sim, rival)).toBe(true);
    expect(w.intel!.results.at(-1)!.text).toMatch(/looked round/);
    // Readier there: a force's readiness goes up by a tenth.
    w.readiness = 0.5;
    const e = { id: 1, to: rival.id, route: 'highway', target: 'military', stance: 'bold', units: [] };
    expect(awayCity(sim, e as never).readiness).toBe(0.6);
    // It lasts ten days.
    sim.advance(INTEL.revealHours * H);
    expect(revealed(sim, rival)).toBe(false);
  });

  it('sabotage: power half-mans its guns and stops its raids; a depot stops its arming', () => {
    const { sim, rival } = agencyTown();
    const r = rival.rival!;
    missionUntil(sim, rival.id, 'sabotage', 'success', { target: 'power' });
    expect(powerSabotaged(sim, rival)).toBe(true);
    const e = { id: 1, to: rival.id, route: 'highway', target: 'military', stance: 'bold', units: [] };
    expect(awayCity(sim, e as never).neighbour.manning).toBe(INTEL.sabotageManning);
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: rival.id, forces: 10, defences: 5 });
    missionUntil(sim, rival.id, 'sabotage', 'success', { target: 'depot' });
    expect(depotSabotaged(sim, rival)).toBe(true);
    // Its forces don't grow while it's sabotaged.
    const forces = r.forces;
    rivalsMonth(sim);
    expect(r.forces).toBe(forces);
  });

  it('stealing banks a quarter of the next tier, once per neighbour and tier', () => {
    const { sim, rival } = agencyTown();
    ok(sim, { type: 'cheat', cheat: 'rivalTech', neighbour: rival.id, tech: 2 });
    missionUntil(sim, rival.id, 'steal', 'success', { branch: 'air' });
    const res = sim.state.war!.research!;
    expect(res.points.air1).toBe(Math.floor(TIER.get('air1')!.points * INTEL.stealShare));
    expect(res.paid).not.toContain('air1');
    expect(rival.rival!.intel!.stolen).toEqual(['air1']);
    expect(refusal(sim, { type: 'spyMission', neighbour: rival.id, op: 'steal', branch: 'air' })).toBe(
      `Your agents have taken all they can of ${TIER.get('air1')!.name} from ${rival.name}`,
    );
  });

  it('a spy of the city’s caught is an incident: reputation, feelings, a lost agent', () => {
    const { sim, rival } = agencyTown();
    const w = sim.state.war!;
    const before = { relation: rival.rival!.relation, reputation: w.diplomacy?.reputation ?? 50 };
    const kept = agentsKept(sim);
    missionUntil(sim, rival.id, 'sabotage', 'caught', { target: 'power' });
    expect(freshIncident(sim, rival.id)).toBe(true);
    expect(rival.rival!.relation).toBe(Math.max(-100, before.relation + INTEL.caught.relation));
    expect(w.diplomacy!.reputation).toBe(before.reputation + INTEL.caught.reputation);
    expect(w.diplomacy!.log.at(-1)!.text).toMatch(/was caught in/);
    // A caught saboteur is a strike; the agent is lost until replaced.
    expect(w.struck?.[rival.id]).toBeDefined();
    expect(w.intel!.lost!.length).toBe(1);
    expect(agentsKept(sim)).toBe(kept);
    expect(rivalCounter(sim, rival)).toBeGreaterThan(0);
    sim.advance(INTEL.replaceHours * H + H);
    expect(w.intel!.lost).toBeUndefined();
  });

  it('counter-intelligence catches a computer neighbour’s spy: a grievance, and war costs no reputation', () => {
    const { sim, rival } = agencyTown();
    const w = sim.state.war!;
    expect(counterIntel(sim)).toBeGreaterThan(INTEL.counter.base);
    let caught = false;
    for (let k = 0; k < 40 && !caught; k++) {
      ok(sim, { type: 'cheat', cheat: 'spyIn', neighbour: rival.id, op: 'reveal' });
      caught = w.intel?.results.at(-1)?.text.startsWith('Your agents caught a spy') ?? false;
    }
    expect(caught).toBe(true);
    expect(grieved(sim, rival.id)).toBe(true);
    const reputation = w.diplomacy?.reputation ?? 50;
    ok(sim, { type: 'declareWar', neighbour: rival.id, scale: 'war', reason: 'Spies' });
    expect(w.diplomacy!.reputation).toBe(reputation);
  });

  it('a saboteur who gets through closes the city’s biggest power plant for a day', () => {
    const { sim, rival } = agencyTown();
    const w = sim.state.war!;
    let closed = false;
    for (let k = 0; k < 40 && !closed; k++) {
      ok(sim, { type: 'cheat', cheat: 'spyIn', neighbour: rival.id, op: 'sabotage', target: 'power' });
      closed = w.intel?.results.at(-1)?.text.startsWith('Saboteurs from') ?? false;
      sim.advance(30 * H);
    }
    expect(closed).toBe(true);
  });

  it('computer neighbours’ tech: battle mods from tech 1, heavier raids from tech 2', () => {
    const { sim, rival } = agencyTown();
    const r = rival.rival!;
    expect(rivalMods(r)).toBeUndefined();
    expect(rivalMix(r)).toBe(RIVAL_MIX[r.personality]);
    ok(sim, { type: 'cheat', cheat: 'rivalTech', neighbour: rival.id, tech: 1 });
    // Tier 1's battle mods: jet engines and hull design (field workshops have none).
    expect(rivalMods(r)).toEqual({ air: { attack: 1.15 }, sea: { hp: 1.2 } });
    expect(rivalMix(r)).toBe(RIVAL_MIX[r.personality]);
    ok(sim, { type: 'cheat', cheat: 'rivalTech', neighbour: rival.id, tech: 2 });
    expect(Object.keys(rivalMix(r)).length).toBeGreaterThanOrEqual(
      Object.keys(RIVAL_MIX[r.personality]!).length,
    );
    ok(sim, { type: 'cheat', cheat: 'rivalTech', neighbour: rival.id, tech: 3 });
    // And tier 3's: composite armour, swarm control, submarines.
    expect(rivalMods(r)).toEqual({
      land: { hp: 1.25, armour: 0.05 },
      air: { attack: 1.15, hp: 1.15 },
      sea: { hp: 1.2, armour: 0.05 },
    });
  });

  it('their tech moves on only once the city researches, and spies come only to a city with a lab or agency', () => {
    const { sim } = labTown(0);
    const w = sim.state.war!;
    for (let k = 0; k < 40; k++) intelMonth(sim);
    expect(sim.state.region.neighbours.every((n) => !n.rival?.tech)).toBe(true);
    expect(w.intel).toBeUndefined();
  });
});
