import { describe, expect, it } from 'vitest';
import { CIVIC } from '../../src/data/civic';
import { SPY_OP, spyOdds, spyOutcome } from '../../src/data/intel';
import {
  BRANCH_IDS,
  CIVIC_TIER,
  RESEARCH,
  TIER,
  TIERS,
  UNIT_TIER,
  prerequisite,
  type TierKey,
} from '../../src/data/research';
import { UNIT, UNIT_DEFS } from '../../src/data/war';
import { Sim } from '../../src/sim/sim';
import {
  labRate,
  parkFactor,
  researchRate,
  researched,
  unitLock,
  trialTerms,
  type Research,
} from '../../src/sim/systems/research';
import { militaryCivics } from '../../src/sim/systems/war';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { readWarSites } from '../../scripts/lib/modelPipeline';
import { buildTown, connectPoint, newSim, placeAlong, road, serveTown } from '../helpers';

/** M37: weapons research's data and the labs' work (docs/plans/M37-design.md, steps 1–2). */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

describe('M37 research data', () => {
  it('six branches of four tiers, each needing the one before, the fourth a superweapon', () => {
    expect(TIERS).toHaveLength(24);
    for (const b of BRANCH_IDS) {
      const tiers = TIERS.filter((t) => t.branch === b);
      expect(tiers.map((t) => t.tier)).toEqual([1, 2, 3, 4]);
      expect(prerequisite(`${b}1` as TierKey)).toBeNull();
      expect(prerequisite(`${b}3` as TierKey)).toBe(`${b}2`);
      const top = tiers[3]!;
      expect(top.park).toBe(true);
      const supers = [
        ...(top.unlocks?.units ?? []).filter((u) => UNIT.get(u)?.super),
        ...(top.unlocks?.civics ?? []).filter((c) => CIVIC.get(c)?.military?.superweapon),
      ];
      expect(supers, b).toHaveLength(1);
    }
  });

  it('every locked unit and gated building is unlocked by exactly one tier, as its own data says', () => {
    for (const u of UNIT_DEFS) {
      const by = TIERS.filter((t) => t.unlocks?.units?.includes(u.id)).map((t) => t.key);
      if (u.research) expect(by, u.id).toEqual([u.research]);
      else expect(by, u.id).toEqual([]);
      expect(UNIT_TIER.get(u.id)).toBe(u.research);
    }
    for (const [id, key] of CIVIC_TIER) {
      const def = CIVIC.get(id);
      expect(def?.military, id).toBeDefined();
      expect(TIERS.filter((t) => t.unlocks?.civics?.includes(id)).map((t) => t.key)).toEqual([key]);
    }
    // The superweapon buildings' projects ask for the same research.
    for (const d of ['domeshield', 'blackouttower', 'expressgate']) {
      const req = CIVIC.get(d)!.project!.requires.find((r) => r.kind === 'research');
      expect(req && req.kind === 'research' && req.key).toBe(CIVIC_TIER.get(d));
    }
  });

  it('the new buildings stand on their prompts’ sites', () => {
    const sites = readWarSites();
    for (const id of [
      'militarylab',
      'spyagency',
      'interceptor',
      'shieldgen',
      'domeshield',
      'blackouttower',
      'expressgate',
    ]) {
      const def = CIVIC.get(id)!;
      const site = sites.get(id);
      expect(site, id).toBeDefined();
      expect([def.w, def.d], id).toEqual([site!.w, site!.d]);
    }
  });

  it('spy odds are whole numbers per thousand, as the worked examples say', () => {
    expect(spyOdds('reveal', 2, 250, false, false)).toEqual({ success: 750, caught: 137 });
    expect(spyOdds('sabotage', 2, 300, false, false)).toEqual({ success: 480, caught: 335 });
    expect(spyOdds('steal', 3, 400, false, true)).toEqual({ success: 390, caught: 283 });
    // Bounds hold at the extremes, and a recent look makes sabotage surer.
    const best = spyOdds('reveal', 4, 0, true, true);
    expect(best.success).toBeLessThanOrEqual(950);
    expect(best.caught).toBeGreaterThanOrEqual(50);
    const worst = spyOdds('steal', 0, 850, false, false);
    expect(worst.success).toBe(100);
    expect(worst.success + worst.caught).toBeLessThanOrEqual(1000);
    expect(spyOdds('sabotage', 2, 300, true, false).success).toBe(580);
    expect(spyOutcome(0, best)).toBe('success');
    expect(spyOutcome(999, worst)).toBe('caught');
    expect(spyOutcome(worst.success, worst)).toBe(worst.success < 1000 - worst.caught ? 'failed' : 'caught');
    for (const op of Object.keys(SPY_OP))
      expect(TIER.has(SPY_OP[op as keyof typeof SPY_OP].research)).toBe(true);
  });
});

/** A war town with an HQ and a staffed, powered weapons lab. */
function labTown(labs = 1): { sim: Sim; place: (def: string) => number } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(2 * M);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  const segs = [...streets].reverse();
  const place = (def: string) => {
    for (const seg of segs)
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* the next street */
      }
    throw new Error(`no room for ${def}`);
  };
  // A street on past the avenue's end, with room for a research park.
  const c = connectPoint(sim);
  const east = road(sim, [
    { x: c.x + 480, z: c.z },
    { x: c.x + 800, z: c.z },
  ]).created!;
  segs.push(...east);
  place('militaryhq');
  for (let k = 0; k < labs; k++) place('militarylab');
  // Neighbours too weak to raid: only research happens.
  for (const n of sim.state.region.neighbours)
    if (n.rival) sim.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
  sim.advance(M);
  return { sim, place };
}

const ok = (sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) => {
  const r = sim.dispatch(cmd);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const refusal = (sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) => {
  const r = sim.dispatch(cmd);
  return r.ok ? null : r.reason;
};
const res = (sim: Sim): Research => sim.state.war!.research!;
/** Spent on weapons research this month, by the ledger. */
const spentOnResearch = (sim: Sim) => -(sim.state.economy.month.weaponsResearch ?? 0);

describe('M37 research in the city', () => {
  it('a lab makes points by staff, power and funding; a research park lifts them', () => {
    const { sim, place } = labTown(2);
    const labs = militaryCivics(sim).filter((c) => c.def === 'militarylab');
    expect(labs).toHaveLength(2);
    for (const c of labs) {
      const want =
        4 * Math.min(1, c.staff ?? 0) * (c.powered ?? 0) * Math.min(1.25, sim.fundingEff('defence'));
      expect(labRate(sim, c)).toBeCloseTo((c.staff ?? 0) < 0.25 ? 0 : want, 9);
    }
    expect(parkFactor(sim)).toBe(1);
    expect(researchRate(sim)).toBeCloseTo(
      labs.reduce((a, c) => a + labRate(sim, c), 0),
      9,
    );
    expect(researchRate(sim)).toBeGreaterThan(0);
    place('university');
    place('techpark');
    sim.advance(M);
    expect(parkFactor(sim)).toBe(RESEARCH.parkFactor);
  });

  it('research queues, is paid for when it starts, keeps its points, and finishes in game time', () => {
    const { sim } = labTown(1);
    // Nothing is there until the first tier is queued (peace and M34–M36 cities stay as they were).
    expect(sim.state.war!.research).toBeUndefined();
    expect(refusal(sim, { type: 'queueResearch', key: 'land2' })).toBe('Field workshops comes first');
    ok(sim, { type: 'queueResearch', key: 'land1' });
    ok(sim, { type: 'queueResearch', key: 'land2' });
    expect(refusal(sim, { type: 'queueResearch', key: 'land1' })).toBe('Field workshops is queued already');
    ok(sim, { type: 'queueResearch', key: 'air1' });
    ok(sim, { type: 'queueResearch', key: 'sea1' });
    expect(refusal(sim, { type: 'queueResearch', key: 'defence1' })).toBe(
      `The research queue holds ${RESEARCH.queueMax}`,
    );
    const before = spentOnResearch(sim);
    sim.advance(H + 1);
    // Paid once, when it reached the head of the queue.
    expect(res(sim).paid).toEqual(['land1']);
    expect(spentOnResearch(sim) - before).toBe(TIER.get('land1')!.cost);
    const pts = res(sim).points.land1!;
    expect(pts).toBeGreaterThan(0);
    // Taken out of the queue, its points stay (and what follows it that needs it goes too).
    ok(sim, { type: 'unqueueResearch', key: 'land1' });
    expect(res(sim).queue).toEqual(['air1', 'sea1']);
    expect(res(sim).points.land1).toBe(pts);
    ok(sim, { type: 'unqueueResearch', key: 'air1' });
    ok(sim, { type: 'unqueueResearch', key: 'sea1' });
    ok(sim, { type: 'queueResearch', key: 'land1' });
    // Queued again: nothing more to pay, and it carries on from its points.
    const t0 = spentOnResearch(sim);
    sim.advance(H);
    expect(res(sim).paid).toEqual(['land1']);
    expect(res(sim).points.land1!).toBeGreaterThan(pts);
    expect(spentOnResearch(sim)).toBe(t0);
    for (let h = 0; h < 24 * 20 && !researched(sim, 'land1'); h++) sim.advance(H);
    expect(researched(sim, 'land1')).toBe(true);
    expect(res(sim).queue).toEqual([]);
  });

  it('the labs wait for money, and a superweapon tier for a research park', () => {
    const { sim, place } = labTown(1);
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 1_000 - sim.state.treasury });
    ok(sim, { type: 'queueResearch', key: 'intel1' });
    sim.advance(2 * H);
    expect(res(sim).paid).toEqual([]);
    expect(res(sim).waiting).toBe('Not enough money to start Long-range radar: $40,000');
    expect(res(sim).points.intel1).toBeUndefined();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    sim.advance(2 * H);
    expect(res(sim).paid).toEqual(['intel1']);
    expect(res(sim).waiting).toBeUndefined();
    // Straight to the top of a branch: tier 4 waits for a research park.
    const r = res(sim);
    r.done.push('land1', 'land2', 'land3');
    ok(sim, { type: 'unqueueResearch', key: 'intel1' });
    ok(sim, { type: 'queueResearch', key: 'land4' });
    sim.advance(2 * H);
    expect(r.waiting).toBe('Giant wind-up robot needs a research park in service');
    expect(r.points.land4).toBeUndefined();
    place('university');
    place('techpark');
    sim.advance(M);
    expect(r.points.land4).toBeGreaterThan(0);
  });

  it('a unit needs its research and then its trial; a building its research; three labs at most', () => {
    const { sim, place } = labTown(1);
    expect(unitLock(sim, 'tank')).toBeNull();
    expect(unitLock(sim, 'heavytank')).toBe('Heavy tanks need Heavy armour research');
    ok(sim, { type: 'queueResearch', key: 'land1' });
    res(sim).done.push('land1', 'land2');
    res(sim).prototypes.push('heavytank');
    expect(unitLock(sim, 'heavytank')).toBe('Heavy tanks need a trial at the proving ground first');
    res(sim).proven.push('heavytank');
    expect(unitLock(sim, 'heavytank')).toBeNull();
    // Buildings research unlocks.
    expect(() => place('interceptor')).toThrow();
    const why = sim.preview({ type: 'placeBuilding', def: 'interceptor', x: 0, z: 0, angle: 0, side: 1 });
    expect(!why.ok && why.reason).toBe('Needs Interceptors research');
    res(sim).done.push('defence1', 'defence2');
    expect(place('interceptor')).toBeGreaterThan(0);
    // Labs: three at most.
    place('militarylab');
    place('militarylab');
    const fourth = sim.preview({ type: 'placeBuilding', def: 'militarylab', x: 0, z: 0, angle: 0, side: 1 });
    expect(!fourth.ok && fourth.reason).toBe('The city runs three weapons labs: the most it can use');
  });

  it('superweapons follow the region’s rules; a city with computer rivals may have them', () => {
    const { sim } = labTown(1);
    ok(sim, { type: 'queueResearch', key: 'land1' });
    const r = res(sim);
    r.done.push('land1', 'land2', 'land3', 'land4');
    expect(unitLock(sim, 'windupbot')).toBe('Giant wind-up robots need a trial at the proving ground first');
    sim.state.region.rules = { war: true, scale: 'skirmish' };
    expect(unitLock(sim, 'windupbot')).toBe('Your region’s rules turn superweapons off');
    sim.state.region.rules = { war: true, scale: 'skirmish', supers: true };
    r.proven.push('windupbot');
    expect(unitLock(sim, 'windupbot')).toBeNull();
  });

  it('a peaceful city sees none of it: no research, no labs', () => {
    const sim = newSim({ disasters: false });
    buildTown(sim);
    serveTown(sim);
    sim.advance(M);
    expect(sim.state.war).toBeUndefined();
    expect(refusal(sim, { type: 'queueResearch', key: 'land1' })).toBe('War is off in this city');
  });
});

describe('M37 prototypes on trial', () => {
  it('a prototype is trained only after its trial at the proving ground, one trial a ground at a time', () => {
    const { sim, place } = labTown(1);
    const depot = place('vehicledepot');
    const ground = place('provingground');
    ok(sim, { type: 'queueResearch', key: 'land1' });
    ok(sim, { type: 'queueResearch', key: 'land2' });
    ok(sim, { type: 'cheat', cheat: 'researchPoints', points: 1_000 });
    expect(res(sim).done).toEqual(['land1', 'land2']);
    expect(res(sim).prototypes).toEqual(['heavytank']);
    expect(refusal(sim, { type: 'trainUnit', base: depot, kind: 'heavytank' })).toBe(
      'Heavy tanks need a trial at the proving ground first',
    );
    expect(refusal(sim, { type: 'startTrial', ground: depot, kind: 'heavytank' })).toBe(
      'Prototypes are tested at a proving ground',
    );
    sim.advance(M);
    const spent = -(sim.state.economy.month.trials ?? 0);
    ok(sim, { type: 'startTrial', ground, kind: 'heavytank' });
    expect(-(sim.state.economy.month.trials ?? 0) - spent).toBe(trialTerms('heavytank').cost);
    expect(trialTerms('heavytank')).toEqual({ hours: 36, cost: 7_500 });
    // One at a time: a second prototype waits for the ground.
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['logistics1', 'logistics2'] });
    expect(refusal(sim, { type: 'startTrial', ground, kind: 'repair' })).toBe(
      'The proving ground is busy with the heavy tank’s trial',
    );
    // It runs its hours, a notice at each run, and passes.
    for (let h = 0; h < 24 * 6 && res(sim).trials.length; h++) sim.advance(H);
    expect(res(sim).trials).toEqual([]);
    expect(res(sim).proven).toEqual(['heavytank']);
    expect(res(sim).prototypes).toEqual(['repair']);
    expect(refusal(sim, { type: 'startTrial', ground, kind: 'heavytank' })).toBe(
      'Heavy tanks have passed their trial already',
    );
    ok(sim, { type: 'trainUnit', base: depot, kind: 'heavytank' });
  });

  it('a trial called off gives back what wasn’t run; sea trials need a naval yard', () => {
    const { sim, place } = labTown(1);
    const ground = place('provingground');
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['sea1', 'sea2'] });
    expect(refusal(sim, { type: 'startTrial', ground, kind: 'gunboat' })).toBe(
      'Sea trials need a naval yard',
    );
    ok(sim, { type: 'cheat', cheat: 'research', tiers: ['land1', 'land2'] });
    sim.advance(M);
    ok(sim, { type: 'startTrial', ground, kind: 'heavytank' });
    sim.advance(6 * H);
    const t = res(sim).trials[0]!;
    expect(t.done).toBeGreaterThan(0);
    const back = Math.round(t.paid * (1 - t.done / t.hours));
    const before = sim.state.economy.month.trials ?? 0;
    ok(sim, { type: 'stopTrial', ground });
    expect((sim.state.economy.month.trials ?? 0) - before).toBe(back);
    expect(res(sim).trials).toEqual([]);
    // Still a prototype (beside the sea tiers' boats), waiting for another trial.
    expect(res(sim).prototypes).toEqual(['gunboat', 'landingcraft', 'heavytank']);
    expect(res(sim).proven).toEqual([]);
  });
});
