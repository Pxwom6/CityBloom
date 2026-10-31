import { describe, expect, it } from 'vitest';
import { ATOM } from '../../src/data/atom';
import { CIVIC } from '../../src/data/civic';
import { ROAD_RULES } from '../../src/data/roads';
import { TIER, TIER_KEYS, type TierKey } from '../../src/data/research';
import { cleanWarRules, sameWarRules, warRulesText, type RegionWarRules } from '../../src/data/war';
import type { Sim } from '../../src/sim/sim';
import { atomOf, atomLock, bombAllowed, nuclearRunning } from '../../src/sim/systems/atom';
import { warProject } from '../../src/sim/systems/projects';
import { allTiersDone, civicLock, tierCounts } from '../../src/sim/systems/research';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { connectPoint } from '../helpers';
import { labTown, ok, refusal } from './researchTown';

/**
 * M40, step 1: the gate on the atom bomb's two buildings (docs/plans/M40-design.md, calls 2 to 4):
 * every research branch maxed (all 24 tiers, counted tier by tier), the rules, no scenario, the bomb
 * not used, a running nuclear plant for the enrichment plant and the plant online for the silo; a
 * hard gate sandbox cannot skip, with no refund for the buildings.
 */

const M = TICKS_PER_MONTH;
const PLANT = 'enrichment';
const SILO = 'atomsilo';

/** A war town with a military HQ, rich, with a nuclear plant standing and giving power. */
function gateTown(): { sim: Sim; place: (def: string) => number; nuclear: number } {
  const { sim, place } = labTown(0);
  const nuclear = place('nuclear');
  sim.advance(M);
  return { sim, place, nuclear };
}

const everyTier = (sim: Sim) => ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });

/** The city's tiers done, set directly (the research cheat only ever adds). */
function setDone(sim: Sim, done: readonly TierKey[]) {
  sim.state.war!.research!.done = [...done];
}

/** A place command that would be fine but for the gate: the refusal comes before the ground is looked at. */
function placeCmd(sim: Sim, def: string) {
  const c = connectPoint(sim);
  return { type: 'placeBuilding', def, x: c.x + 60, z: c.z + 60, angle: 0, side: 1 } as const;
}

describe('M40: the atom bomb’s two buildings', () => {
  it('are war projects on the superweapon buildings’ footing, in their own field', () => {
    for (const [id, kind, w, d] of [
      [PLANT, 'plant', 48, 40],
      [SILO, 'silo', 40, 40],
    ] as const) {
      const def = CIVIC.get(id)!;
      expect(def.military?.atom, id).toBe(kind);
      expect(def.military?.superweapon, id).toBeUndefined();
      expect([def.w, def.d], id).toEqual([w, d]);
      expect(def.category).toBe('military');
      expect(def.dept).toBe('defence');
      expect(def.unique).toBe(true);
      expect(def.requires).toBe('militaryhq');
      expect(def.unlockPopulation).toBe(40_000);
      // Their stages wait for the war clock as the superweapon buildings' do.
      expect(warProject(def), id).toBe(true);
      expect(def.project!.stages).toHaveLength(3);
      expect(def.refundShare, id).toBe(0);
      // Behind every research branch, and a running building of the step before.
      expect(def.project!.requires[0]).toEqual({ kind: 'researchAll' });
    }
    expect(CIVIC.get(PLANT)!.project!.requires[1]).toMatchObject({ kind: 'civicOnline', def: 'nuclear' });
    expect(CIVIC.get(SILO)!.project!.requires[1]).toMatchObject({ kind: 'civicOnline', def: PLANT });
    // The plant is built first and takes longer; the silo can be built beside the fuel.
    const total = (id: string) => CIVIC.get(id)!.project!.stages.reduce((a, s) => a + s.cost, 0);
    expect(total(PLANT)).toBeGreaterThan(total(SILO));
    expect(CIVIC.get(PLANT)!.upkeep).toBeGreaterThan(CIVIC.get(SILO)!.upkeep);
    // Nothing else in the game is gated this way.
    expect(
      [...CIVIC.values()]
        .filter((d) => d.military?.atom)
        .map((d) => d.id)
        .sort(),
    ).toEqual([SILO, PLANT].sort());
  });

  it('refuse each of the 24 tiers withheld, naming that tier', () => {
    const { sim } = gateTown();
    everyTier(sim);
    expect(allTiersDone(sim)).toBe(true);
    expect(TIER_KEYS).toHaveLength(24);
    for (const key of TIER_KEYS) {
      setDone(
        sim,
        TIER_KEYS.filter((k) => k !== key),
      );
      expect(allTiersDone(sim), key).toBe(false);
      for (const id of [PLANT, SILO]) {
        const why = civicLock(sim, id);
        expect(why, `${id} without ${key}`).toContain(TIER.get(key)!.name);
        expect(why, key).toMatch(/^Needs every research branch maxed \(23 of 24 done/);
      }
      // The same words come back through a placement.
      expect(refusal(sim, placeCmd(sim, PLANT)), key).toContain(TIER.get(key)!.name);
    }
  });

  it('count the tiers one by one: six top tiers are not the tree, however the counts read', () => {
    const { sim } = gateTown();
    // The test-mode cheat skips prerequisites: the six tier 4s alone give every branch a count of 4.
    ok(sim, {
      type: 'cheat',
      cheat: 'research',
      tiers: ['land4', 'air4', 'sea4', 'defence4', 'intel4', 'logistics4'],
    });
    expect(Object.values(tierCounts(sim))).toEqual([4, 4, 4, 4, 4, 4]);
    expect(allTiersDone(sim)).toBe(false);
    expect(civicLock(sim, PLANT)).toBe(
      `Needs every research branch maxed (6 of 24 done; ${TIER.get('land1')!.name} is next)`,
    );
    // One branch's top tier alone, by the same cheat, counts as 4 in its branch and opens nothing.
    setDone(sim, ['land4']);
    expect(tierCounts(sim).land).toBe(4);
    expect(civicLock(sim, PLANT)).toContain('1 of 24 done');
    // No research at all says so too.
    delete sim.state.war!.research;
    expect(allTiersDone(sim)).toBe(false);
    expect(civicLock(sim, PLANT)).toContain('0 of 24 done');
  });

  it('open the plant with all 24 and a running nuclear plant, then the silo once the plant is online', () => {
    const { sim, place } = gateTown();
    expect(nuclearRunning(sim)).toBe(true);
    everyTier(sim);
    expect(civicLock(sim, PLANT)).toBeNull();
    // The silo waits for the plant, and a plant still going up is not online.
    expect(civicLock(sim, SILO)).toBe('Needs the enrichment plant online (not yet)');
    const plant = place(PLANT);
    const built = sim.state.civics.get(plant)!;
    expect(built.build).toBeDefined();
    // A war project: its stage counts from the war clock too.
    expect(built.build!.clock).toBeDefined();
    expect(civicLock(sim, SILO)).toBe('Needs the enrichment plant online (not yet)');
    expect(refusal(sim, placeCmd(sim, SILO))).toBe('Needs the enrichment plant online (not yet)');
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plant });
    expect(civicLock(sim, SILO)).toBeNull();
    const silo = place(SILO);
    expect(sim.state.civics.get(silo)!.def).toBe(SILO);
    // One of each: a second is turned away by the building's own rule.
    expect(refusal(sim, placeCmd(sim, PLANT))).toBe('The city already has an enrichment plant');
  });

  it('are not for sandbox cities to skip, whatever else sandbox lifts', () => {
    const { sim } = gateTown();
    sim.state.options.sandbox = true;
    ok(sim, { type: 'cheat', cheat: 'research', tiers: TIER_KEYS.slice(1) as TierKey[] });
    const why = refusal(sim, placeCmd(sim, PLANT));
    expect(why).toContain(TIER.get(TIER_KEYS[0]!)!.name);
    // Sandbox lifts a project's requirements (money, the population bars), not this gate.
    everyTier(sim);
    expect(refusal(sim, placeCmd(sim, PLANT)) ?? '').not.toContain('research branch');
    sim.state.war!.research!.done.pop();
    expect(refusal(sim, placeCmd(sim, SILO))).toMatch(/^Needs every research branch maxed/);
  });

  it('need a nuclear plant giving power, the rules, no scenario and a bomb not yet used', () => {
    const { sim, nuclear } = gateTown();
    everyTier(sim);
    expect(civicLock(sim, PLANT)).toBeNull();
    // A plant that is closed gives no power.
    sim.state.civics.get(nuclear)!.damage = 5;
    expect(nuclearRunning(sim)).toBe(false);
    expect(civicLock(sim, PLANT)).toBe('Needs a nuclear power plant running (not yet)');
    sim.state.civics.get(nuclear)!.damage = 0;
    expect(civicLock(sim, PLANT)).toBeNull();
    // Without one at all.
    sim.state.civics.delete(nuclear);
    expect(civicLock(sim, PLANT)).toBe('Needs a nuclear power plant running (not yet)');
  });

  it('follow the rules: a region allows the bomb only with total war and superweapons', () => {
    const { sim } = gateTown();
    everyTier(sim);
    const s = sim.state;
    // A city of its own with rivals: allowed.
    expect(bombAllowed(sim)).toBe(true);
    const rules = (r: RegionWarRules | undefined) => {
      if (r) s.region.rules = r;
      else delete s.region.rules;
    };
    rules({ war: true, scale: 'total', supers: true });
    expect(bombAllowed(sim)).toBe(false);
    expect(civicLock(sim, PLANT)).toBe('Your region’s rules turn the atom bomb off');
    expect(refusal(sim, placeCmd(sim, PLANT))).toBe('Your region’s rules turn the atom bomb off');
    rules({ war: true, scale: 'total', supers: true, bomb: true });
    expect(bombAllowed(sim)).toBe(true);
    expect(civicLock(sim, PLANT)).toBeNull();
    // Whatever a message says, the rule stands only with both (cleaning drops it; this guards the state).
    rules({ war: true, scale: 'war', supers: true, bomb: true });
    expect(bombAllowed(sim)).toBe(false);
    rules({ war: true, scale: 'total', bomb: true });
    expect(bombAllowed(sim)).toBe(false);
    rules({ war: false, scale: 'total', supers: true, bomb: true });
    expect(bombAllowed(sim)).toBe(false);
    // The region's rules gone and no rivals: no bomb either, and the words say what would do.
    rules(undefined);
    s.options.rivals = false;
    expect(bombAllowed(sim)).toBe(false);
    expect(civicLock(sim, PLANT)).toBe(
      'The atom bomb needs rival neighbours or a region whose rules allow it',
    );
    s.options.rivals = true;
    expect(bombAllowed(sim)).toBe(true);
    // A peaceful city (no war state) never.
    const war = s.war;
    delete s.war;
    expect(bombAllowed(sim)).toBe(false);
    s.war = war;
  });

  it('are not part of a scenario, and not for a city that has used its bomb', () => {
    const { sim } = gateTown();
    everyTier(sim);
    const was = sim.state.scenario;
    sim.state.scenario = {} as never;
    expect(civicLock(sim, PLANT)).toBe('The atom bomb is not part of a scenario');
    sim.state.scenario = was;
    expect(civicLock(sim, PLANT)).toBeNull();
    atomOf(sim).fired = { tick: 1, to: 2, name: 'Gravelford' };
    const used = 'The city has used its atom bomb: there is only ever one';
    expect(civicLock(sim, PLANT)).toBe(used);
    expect(civicLock(sim, SILO)).toBe(used);
    expect(refusal(sim, placeCmd(sim, SILO))).toBe(used);
  });

  it('say nothing about any other building', () => {
    const { sim } = gateTown();
    for (const d of CIVIC.values()) if (!d.military?.atom) expect(atomLock(sim, d.id), d.id).toBeNull();
    expect(atomLock(sim, 'no such building')).toBeNull();
    // A building that research alone gates keeps its own words.
    expect(civicLock(sim, 'domeshield')).toBe(`Needs ${TIER.get('defence4')!.name} research`);
  });

  it('pay no refund when bulldozed, where other buildings pay their share', () => {
    const { sim, place } = gateTown();
    everyTier(sim);
    const plant = place(PLANT);
    const paid = sim.state.civics.get(plant)!.cost;
    expect(paid).toBeGreaterThan(1_000_000);
    const before = sim.state.treasury;
    const dry = sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: plant } } as never);
    expect(dry.ok, JSON.stringify(dry)).toBe(true);
    expect(sim.state.treasury).toBe(before);
    expect(sim.state.civics.has(plant)).toBe(false);
    // The same command on an ordinary building pays the road rules' share of what it cost.
    const other = gateTown();
    const coal = other.place('wind');
    const cost = other.sim.state.civics.get(coal)!.cost;
    const t0 = other.sim.state.treasury;
    const r = other.sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: coal } } as never);
    expect(r.ok).toBe(true);
    expect(other.sim.state.treasury - t0).toBe(Math.round(cost * ROAD_RULES.bulldozeRefund));
    expect(ROAD_RULES.bulldozeRefund).toBeGreaterThan(0);
  });
});

describe('M40: the region’s bomb rule', () => {
  const base: RegionWarRules = { war: true, scale: 'total', supers: true };

  it('is stored only when true, and only with total war and superweapons', () => {
    expect(cleanWarRules({ ...base, bomb: true })).toEqual({ ...base, bomb: true });
    expect(cleanWarRules(base)).toEqual(base);
    expect(cleanWarRules({ ...base, bomb: false })).toEqual(base);
    expect(cleanWarRules({ ...base, bomb: 'yes' })).toEqual(base);
    expect(cleanWarRules({ ...base, bomb: 1 })).toEqual(base);
    // Not with a smaller war, nor without superweapons: the dome is the one thing that can stop it.
    expect(cleanWarRules({ ...base, scale: 'war', bomb: true })).toEqual({ ...base, scale: 'war' });
    expect(cleanWarRules({ war: true, scale: 'total', bomb: true })).toEqual({ war: true, scale: 'total' });
    expect(cleanWarRules({ war: true, scale: 'skirmish', supers: true, bomb: true })).toEqual({
      war: true,
      scale: 'skirmish',
      supers: true,
    });
    // No stray keys: an absent flag is absent, not undefined.
    expect(Object.keys(cleanWarRules({ war: true, scale: 'total' })!)).toEqual(['war', 'scale']);
    expect(Object.keys(cleanWarRules({ ...base, bomb: true })!)).toEqual(['war', 'scale', 'supers', 'bomb']);
    expect(cleanWarRules(null)).toBeNull();
    expect(cleanWarRules({ war: true, scale: 'huge', bomb: true })).toBeNull();
  });

  it('is told in the rules’ sentence and counted among their differences', () => {
    expect(warRulesText({ ...base, bomb: true })).toBe('total war, superweapons and the atom bomb allowed');
    expect(warRulesText(base)).toBe('total war, superweapons allowed');
    expect(warRulesText({ war: true, scale: 'total' })).toBe('total war');
    expect(warRulesText({ war: false, scale: 'total' })).toBe('war is off');
    expect(sameWarRules(base, { ...base })).toBe(true);
    expect(sameWarRules(base, { ...base, bomb: true })).toBe(false);
    expect(sameWarRules({ ...base, bomb: true }, { ...base, bomb: true })).toBe(true);
  });

  it('reads off in the old regions that never had it', () => {
    // A region from before the rule: no flag, and nothing else in its rules changes meaning.
    const old = cleanWarRules(JSON.parse('{"war":true,"scale":"total","supers":true}'))!;
    expect(old.bomb).toBeUndefined();
    const { sim } = gateTown();
    sim.state.region.rules = old;
    expect(bombAllowed(sim)).toBe(false);
  });

  it('keeps the build and the launch numbers in proportion', () => {
    // Relations, not values: the bomb is built in as many instalments as its hours allow, and a launch
    // is dearer than one instalment but far cheaper than the whole bomb.
    const instalments = ATOM.bomb.hours / ATOM.bomb.every;
    expect(Number.isInteger(instalments)).toBe(true);
    expect(instalments).toBeGreaterThan(1);
    expect(ATOM.launch.cost).toBeGreaterThan(ATOM.bomb.instalment.money);
    expect(ATOM.launch.cost).toBeLessThan(ATOM.bomb.instalment.money * instalments);
    expect(ATOM.launch.refund).toBeGreaterThan(0);
    expect(ATOM.launch.refund).toBeLessThan(1);
  });
});
