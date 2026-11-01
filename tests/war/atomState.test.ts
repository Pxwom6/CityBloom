import { describe, expect, it } from 'vitest';
import * as ATOM_DATA from '../../src/data/atom';
import { ATOM, ATOM_STAGES, ATOM_STAGE_NAMES, atomStageNo } from '../../src/data/atom';
import { CIVIC } from '../../src/data/civic';
import { requirementStatus } from '../../src/data/projects';
import { TIER_KEYS, treeProgress } from '../../src/data/research';
import { unlocksAt } from '../../src/data/unlocks';
import { MILITARY_DEFS, WAR } from '../../src/data/war';
import type { Sim } from '../../src/sim/sim';
import {
  atomOf,
  atomPrices,
  atomStage,
  atomSummary,
  civicRunning,
  nuclearRunning,
} from '../../src/sim/systems/atom';
import { projectRequirements, requirementContext } from '../../src/sim/systems/projects';
import { researchTree } from '../../src/sim/systems/research';
import { warSummary } from '../../src/sim/systems/war';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { labTown, ok } from './researchTown';

/**
 * M40, step 1: the race's state and the stage that follows from it (docs/plans/M40-design.md, call 1),
 * the numbers' relations, the requirement lines the build menu shares with the gate, and the tone.
 */

const M = TICKS_PER_MONTH;
const H = TICKS_PER_HOUR;

const NOT_SAID = /casualt|killed|dead|victim/i;

/** Every string a value holds, at any depth. */
function strings(v: unknown, into: string[] = []): string[] {
  if (typeof v === 'string') into.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, into);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, into);
  return into;
}

describe('M40: the numbers', () => {
  it('give the race its steps in order, one name each, numbered from nothing to used', () => {
    expect(ATOM_STAGES).toHaveLength(9);
    expect(ATOM_STAGES.map(atomStageNo)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Object.keys(ATOM_STAGE_NAMES).sort()).toEqual([...ATOM_STAGES].sort());
    expect(new Set(Object.values(ATOM_STAGE_NAMES)).size).toBe(9);
  });

  it('keep the long steps long: fuel is the longest wait, the flight the shortest', () => {
    const dome = ATOM.dome.down;
    expect(dome).toBeGreaterThan(0);
    expect(ATOM.fuel.hours).toBeGreaterThan(ATOM.bomb.hours);
    expect(ATOM.bomb.hours).toBeGreaterThan(ATOM.launch.prepHours);
    expect(ATOM.launch.prepHours).toBeGreaterThan(ATOM.flight.hours);
    // The dome is down longer than the flight lasts, so a second bomb in the window does land.
    expect(dome).toBeGreaterThan(ATOM.flight.hours);
    // The blast reaches further than ground zero's window is wide, and the aftermath further still.
    expect(ATOM.impact.level * 2).toBeGreaterThan(ATOM.impact.window);
    expect(ATOM.impact.civicReach).toBeGreaterThan(1);
    expect(ATOM.impact.treeReach).toBeGreaterThan(1);
    expect(ATOM.impact.crater).toBeLessThan(ATOM.impact.level);
    expect(ATOM.impact.roadClosed).toBeGreaterThan(ATOM.impact.civicClosed);
    expect(ATOM.impact.slice).toBeGreaterThan(0);
    expect(ATOM.fuel.fundingMax).toBeGreaterThanOrEqual(1);
    expect(ATOM.flight.sirenEvery).toBeGreaterThan(0);
    expect(ATOM.flight.tickLast).toBeGreaterThan(0);
  });

  it('price the race in millions, the bomb and the launch the dearest, the buildings with no refund', () => {
    const stages = (id: string) => CIVIC.get(id)!.project!.stages;
    const money = (id: string) => stages(id).reduce((a, s) => a + s.cost, 0);
    const months = (id: string) => stages(id).reduce((a, s) => a + s.months, 0);
    const fuel = ATOM.fuel.hours * ATOM.fuel.cost;
    const bomb = (ATOM.bomb.hours / ATOM.bomb.every) * ATOM.bomb.instalment.money;
    for (const m of [money('enrichment'), money('atomsilo'), fuel, bomb, ATOM.launch.cost])
      expect(m).toBeGreaterThan(1_000_000);
    expect(bomb).toBeGreaterThan(money('enrichment'));
    expect(bomb).toBeGreaterThan(money('atomsilo'));
    // Building a plant or a silo takes less war time than the fuel or the bomb it then makes (a month is a game day).
    expect(months('enrichment') * 24).toBeLessThan(ATOM.fuel.hours);
    expect(months('atomsilo') * 24).toBeLessThan(ATOM.bomb.hours);
    for (const d of MILITARY_DEFS.filter((x) => x.military.atom)) expect(d.refundShare).toBe(0);
    // Staff and power are the buildings’ own and the plant is the bigger: it feeds the silo.
    expect(CIVIC.get('enrichment')!.military!.jobs).toBeGreaterThan(CIVIC.get('atomsilo')!.military!.jobs);
    expect(CIVIC.get('enrichment')!.military!.power).toBeGreaterThan(CIVIC.get('atomsilo')!.military!.power);
  });

  it('keep the prices in the band they were sized for: years of the reference city’s taxes', () => {
    // "On the order of several years of a big city's entire income" (SPEC-5): sized on the 57,000-
    // resident careful city, $3.6M of taxes a year, the silo and bomb about three years of it and the
    // whole race, with the two buildings' upkeep, five to six. The 110,000-resident bench city has twice
    // the taxes and reads about half (atomprice.ts prints both); it is the reference that is held.
    const P = atomPrices();
    const year = ATOM.priceCity.taxesPerYear;
    expect(ATOM.priceCity.residents).toBeGreaterThan(50_000);
    expect(P.siloBomb / year).toBeGreaterThan(2.5);
    expect(P.siloBomb / year).toBeLessThan(3.5);
    expect((P.race + P.upkeep) / year).toBeGreaterThan(4.5);
    expect((P.race + P.upkeep) / year).toBeLessThan(6);
    // The sums are the steps': the silo and bomb inside the race, the race inside the race with upkeep.
    expect(P.race).toBeGreaterThan(P.siloBomb);
    expect(P.upkeep).toBeGreaterThan(0);
    expect(P.siloBomb).toBe(P.silo.price + P.bomb.price);
    // The critical path: the silo is built beside the fuel, so it is not on it.
    expect(P.end).toBe(P.plant.hours + P.fuel.hours + P.bomb.hours + P.launch.hours);
    expect(P.siloDone).toBeLessThan(P.plantDone + P.fuel.hours);
  });

  it('say nothing of anyone hurt, in the numbers’ file or the buildings’ words', () => {
    const words = [
      ...strings(ATOM_DATA),
      ...MILITARY_DEFS.filter((d) => d.military.atom).flatMap((d) => strings([d.name, d.blurb, d.project])),
    ];
    expect(words.length).toBeGreaterThan(10);
    for (const w of words) expect(w, w).not.toMatch(NOT_SAID);
  });

  it('keep the two buildings out of the population unlock announcements, and the nuclear plant in', () => {
    expect(unlocksAt(40_000, true)).toContain('Nuclear power plant');
    expect(unlocksAt(40_000, true)).not.toContain('Enrichment plant');
    expect(unlocksAt(40_000, true)).not.toContain('Atom silo');
    expect(unlocksAt(40_000)).not.toContain('Atom silo');
  });
});

describe('M40: the stage of the race', () => {
  /** A war town with every tier researched and a nuclear plant running. */
  function town(): { sim: Sim; place: (def: string) => number } {
    const { sim, place } = labTown(0);
    place('nuclear');
    sim.advance(M);
    ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
    return { sim, place };
  }

  it('follows the facts from nothing to a bomb used', () => {
    const { sim, place } = town();
    const stage = () => atomStage(sim);
    expect(stage()).toBe('none');
    expect(sim.state.war!.atom).toBeUndefined();
    // Reading the stage never makes the race.
    const plantId = place('enrichment');
    expect(stage()).toBe('plant');
    expect(sim.state.war!.atom).toBeUndefined();
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plantId });
    expect(stage()).toBe('plant');
    const a = atomOf(sim);
    expect(a).toEqual({ fuel: 0, boom: 0, stopped: 0 });
    a.fuel = 1;
    expect(stage()).toBe('enriching');
    // Damage closes the plant for a while; the stage doesn't flicker.
    sim.state.civics.get(plantId)!.damage = 6;
    expect(civicRunning(sim, 'enrichment')).toBe(false);
    expect(stage()).toBe('enriching');
    sim.state.civics.get(plantId)!.damage = 0;
    // The silo comes once the plant is online.
    const siloId = place('atomsilo');
    expect(stage()).toBe('silo');
    a.bomb = { done: 0, paid: 1 };
    expect(stage()).toBe('bomb');
    delete a.bomb;
    a.have = true;
    expect(stage()).toBe('ready');
    a.prep = { done: 10, to: 3 };
    expect(stage()).toBe('preparing');
    delete a.have;
    delete a.prep;
    a.fired = { tick: sim.state.tick, to: 3, name: 'Brookline' };
    expect(stage()).toBe('flying');
    a.fired.tick = sim.state.tick - ATOM.flight.hours * H + 1;
    expect(stage()).toBe('flying');
    a.fired.tick = sim.state.tick - ATOM.flight.hours * H;
    expect(stage()).toBe('spent');
    // Losses take the race back a step (a silo lost, then the plant).
    delete a.fired;
    sim.state.civics.delete(siloId);
    expect(stage()).toBe('enriching');
    sim.state.civics.delete(plantId);
    expect(stage()).toBe('none');
  });

  it('is summarised for the page: allowed, the stage, the tree, the plants and the fuel', () => {
    const { sim, place } = town();
    const s0 = atomSummary(sim)!;
    expect(s0).toEqual({
      allowed: true,
      stage: 'none',
      research: { done: 24, total: 24, next: null },
      nuclear: true,
      plant: false,
      fuel: 0,
      fuelWait: null,
      bomb: null,
      have: false,
      launch: null,
      fired: null,
      inbound: null,
      impact: null,
      rivals: [],
    });
    const plant = place('enrichment');
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plant });
    atomOf(sim).fuel = ATOM.fuel.hours / 4;
    const s1 = atomSummary(sim)!;
    expect(s1).toMatchObject({ stage: 'enriching', plant: true, fuel: 0.25 });
    // It rides in the war summary the page is sent, for the build menu.
    expect(warSummary(sim, () => 0)!.atom).toEqual(s1);
    // Rules that turn the bomb off show too, and the first tier still to do is named.
    sim.state.region.rules = { war: true, scale: 'total', supers: true };
    sim.state.war!.research!.done = TIER_KEYS.filter((k) => k !== 'sea3');
    const s2 = atomSummary(sim)!;
    expect(s2.allowed).toBe(false);
    expect(s2.research).toEqual({ done: 23, total: 24, next: 'Submarines' });
    // No war, no race to show.
    delete sim.state.war;
    expect(atomSummary(sim)).toBeNull();
  });

  it('shares its requirement lines between the gate and the build menu', () => {
    const { sim } = town();
    // What a page works out from its own mirror (tiers done, the nuclear plant) gives the same words.
    const done = sim.state.war!.research!.done;
    const page = {
      ...requirementContext(sim),
      tree: { ...treeProgress(done), next: undefined },
      online: (id: string) => (id === 'nuclear' ? nuclearRunning(sim) : civicRunning(sim, id)),
    };
    for (const id of ['enrichment', 'atomsilo']) {
      const def = CIVIC.get(id)!;
      expect(def.project!.requires.map((r) => requirementStatus(r, page))).toEqual(
        projectRequirements(sim, def),
      );
    }
    expect(projectRequirements(sim, CIVIC.get('enrichment')!).map((r) => [r.label, r.met, r.now])).toEqual([
      ['Every research branch maxed', true, '24 of 24 done'],
      ['A nuclear power plant running', true, 'yes'],
    ]);
    expect(projectRequirements(sim, CIVIC.get('atomsilo')!).map((r) => [r.label, r.met, r.now])).toEqual([
      ['Every research branch maxed', true, '24 of 24 done'],
      ['The enrichment plant online', false, 'not yet'],
    ]);
    // With none of the tree done, the line says how far there is to go.
    delete sim.state.war!.research;
    expect(researchTree(sim)).toEqual({ done: 0, total: 24, next: 'Field workshops' });
    expect(projectRequirements(sim, CIVIC.get('enrichment')!)[0]).toEqual({
      label: 'Every research branch maxed',
      met: false,
      now: '0 of 24 done; Field workshops is next',
    });
  });
});

describe('M40: staffing', () => {
  it('posts workers at the plant and the silo after the labs and the superweapon buildings’ rank', () => {
    const { sim, place } = labTown(0, { length: 800, streets: 7 });
    place('nuclear');
    sim.advance(M);
    ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
    const plant = place('enrichment');
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plant });
    const silo = place('atomsilo');
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: silo });
    sim.advance(2 * M);
    for (const id of [plant, silo]) {
      const c = sim.state.civics.get(id)!;
      expect(c.staff ?? 0, c.def).toBeGreaterThan(0);
    }
  });

  it('posts them before an idle base built earlier, when the forces’ share of the workers runs short', () => {
    // Staffing only has an order when the share binds: the plant and silo rank with the superweapon
    // buildings, ahead of the bases in build order. An idle arms factory is built first, so by id it
    // would take its 200 posts before them; the town can't staff all four, so who is short shows the rank.
    const { sim, place } = labTown(0, { length: 800, streets: 7 });
    place('nuclear');
    sim.advance(M);
    ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
    const factory = place('armsfactory');
    const plant = place('enrichment');
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plant });
    const silo = place('atomsilo');
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: silo });
    expect(factory).toBeLessThan(plant);
    sim.advance(2 * M);
    const posts = (id: number) => CIVIC.get(sim.state.civics.get(id)!.def)!.military!.jobs;
    const staff = (id: number) => sim.state.civics.get(id)!.staff ?? 0;
    const hq = [...sim.state.civics.values()].find((c) => c.def === 'militaryhq')!.id;
    const spare = sim.state.totals.workers * WAR.enlistShare;
    const all = [hq, factory, plant, silo];
    // The share binds: there are more posts than the forces may fill.
    expect(all.reduce((a, id) => a + posts(id), 0)).toBeGreaterThan(spare);
    expect(all.reduce((a, id) => a + staff(id) * posts(id), 0)).toBeLessThanOrEqual(spare * 1.05);
    // The headquarters, the plant and the silo are whole; the factory is what is short.
    for (const id of [hq, plant, silo])
      expect(staff(id), sim.state.civics.get(id)!.def).toBeGreaterThan(0.99);
    expect(staff(factory)).toBeLessThan(0.9);
  });
});
