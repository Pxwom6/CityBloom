import { describe, expect, it } from 'vitest';
import { BLACKOUT, TIER, type TierKey } from '../../src/data/research';
import { INTEL, SPY_OP } from '../../src/data/intel';
import { WARNING } from '../../src/data/battle';
import { CIVIC } from '../../src/data/civic';
import type { Command } from '../../src/sim/commands';
import type { Sim } from '../../src/sim/sim';
import type { RegionUpdate } from '../../src/sim/systems/region';
import {
  OP_TAKEN,
  SUPER_UNCOUNTED,
  battleHasSuper,
  checkDossier,
  dossierOf,
  friendOpsWaiting,
  opKey,
} from '../../src/sim/systems/regionOps';
import { intelSummary } from '../../src/sim/systems/intel';
import { blackoutFactor, civicOutput } from '../../src/sim/systems/utilities';
import { warningHours } from '../../src/sim/systems/raids';
import { blackedOut } from '../../src/sim/systems/supers';
import { stampBattle } from '../../src/sim/battle/version';
import type { BattleInput } from '../../src/sim/battle/types';
import { civicOnline } from '../../src/sim/world/civic';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { labTown, ok, refusal } from './researchTown';

/**
 * M37, step 9: operations between friends' cities, each city's side (design call 14). The region
 * room decides (relay/tests/regionOps.test.ts); here the sender's sim waits for its verdict and
 * takes it once (`missionResult`), and the target's takes what the region decided once
 * (`opResolve`), choosing for itself what a saboteur closes. Forged and stale verdicts change nothing.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

const zero = { power: 0, water: 0, garbage: 0 };

/** The region's news: Brookside (slot 2) in a neighbour's place, in a region at war. */
function friendUpdate(extra: Partial<RegionUpdate['cities'][number]> = {}, supers = true): RegionUpdate {
  return {
    cities: [
      {
        slot: 2,
        name: 'Brookside',
        mayor: 'Sam',
        color: 1,
        population: 5_000,
        kind: 'suburb',
        offers: { buy: { ...zero }, sell: { ...zero } },
        workers: 0,
        jobs: 0,
        shoppers: 0,
        online: true,
        raid: 'open',
        tiers: [0, 2, 0, 0, 1, 0],
        counter: 250,
        ...extra,
      },
    ],
    contracts: [],
    project: null,
    rules: { war: true, scale: 'skirmish', ...(supers ? { supers: true as const } : {}) },
  };
}

/** A war town with a staffed spy agency (intelligence to Stealth), and Brookside as a friend. */
function friendTown(tiers: TierKey[] = ['intel1', 'intel2', 'intel3']) {
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  ok(sim, { type: 'cheat', cheat: 'research', tiers });
  const agency = place('spyagency');
  ok(sim, { type: 'regionUpdate', update: friendUpdate() });
  sim.advance(M);
  expect(sim.state.civics.get(agency)!.staff ?? 0).toBeGreaterThanOrEqual(0.25);
  const friend = sim.state.region.neighbours.find((n) => n.player?.slot === 2)!;
  expect(friend.player!.tiers).toEqual([0, 2, 0, 0, 1, 0]);
  return { sim, place, friend };
}

/** Sends an agent and steps until it's at the friend's city, waiting for the region. */
function arrive(sim: Sim, cmd: Extract<Command, { type: 'spyMission' }>) {
  const id = ok(sim, cmd).created![0]!;
  const w = sim.state.war!;
  const m = () => w.intel!.missions.find((x) => x.id === id);
  for (let t = 0; t < 40 && m()?.state === 'out'; t++) sim.advance(H);
  expect(m()!.state).toBe('arrived');
  return { id, m };
}

/** A command that must be refused and leave the city exactly as it was. */
function harmless(sim: Sim, cmd: Command): string {
  const before = sim.hash();
  const r = sim.dispatch(cmd);
  expect(r.ok, JSON.stringify(cmd)).toBe(false);
  expect(sim.hash()).toBe(before);
  return r.ok ? '' : r.reason;
}

describe('M37 operations between friends: the sender', () => {
  it('an agent goes to a friend’s city, waits for the region there, and brings home a dossier once', () => {
    const { sim, friend } = friendTown();
    const w = sim.state.war!;
    const { id, m } = arrive(sim, { type: 'spyMission', neighbour: friend.id, op: 'reveal' });
    expect(m()!.slot).toBe(2);
    expect(sim.events.some((e) => e.kind === 'spyArrived' && e.id === id)).toBe(true);
    // The page sees it waiting, by the id the region will know it by.
    const waiting = intelSummary(sim)!.regionOps;
    expect(waiting).toEqual([
      { mission: id, key: opKey(sim, 'spy', id), slot: 2, op: 'reveal', settling: false },
    ]);
    expect(waiting[0]!.key).toMatch(/^op-[0-9a-f]{8}-\d+$/);
    // Pinned while the region decides.
    ok(sim, { type: 'spySettling', mission: id, on: true });
    expect(friendOpsWaiting(sim)[0]!.settling).toBe(true);
    // A dossier that isn't one is refused, and changes nothing.
    harmless(sim, {
      type: 'missionResult',
      mission: id,
      outcome: 'success',
      dossier: {
        tick: 1,
        forces: { dragon: 3 },
        defences: {},
        tiers: [0, 0, 0, 0, 0, 0],
        supers: [],
      } as never,
    });
    // The region kept it: the page made the dossier from Brookside's save (here, another town's).
    const other = labTown(0).sim;
    other.dispatch({ type: 'cheat', cheat: 'research', tiers: ['land1', 'land2'] });
    const dossier = dossierOf(other.state)!;
    expect(checkDossier(JSON.parse(JSON.stringify(dossier)))).toEqual(dossier);
    expect(dossier.tiers).toEqual([2, 0, 0, 0, 0, 0]);
    ok(sim, { type: 'missionResult', mission: id, outcome: 'success', dossier });
    expect(m()!.state).toBe('back');
    expect(w.intel!.seen![2]).toMatchObject({
      tiers: [2, 0, 0, 0, 0, 0],
      until: w.clock + INTEL.revealHours,
    });
    expect(intelSummary(sim)!.seen[2]!.tiers).toEqual([2, 0, 0, 0, 0, 0]);
    expect(w.intel!.results.at(-1)!.text).toMatch(/looked round Brookside/);
    // Taken once: the same verdict again changes nothing.
    harmless(sim, { type: 'missionResult', mission: id, outcome: 'caught' });
    // Home after the other half.
    sim.advance((SPY_OP.reveal.hours / 2 + 1) * H);
    expect(m()).toBeUndefined();
  });

  it('turned away by the region, the agent comes home and the mission is refunded in full', () => {
    const { sim, friend } = friendTown();
    const w = sim.state.war!;
    const { id, m } = arrive(sim, {
      type: 'spyMission',
      neighbour: friend.id,
      op: 'sabotage',
      target: 'depot',
    });
    const before = sim.state.treasury;
    ok(sim, {
      type: 'missionResult',
      mission: id,
      outcome: 'refused',
      reason: 'Brookside has had a saboteur today: no more until midnight (UTC)',
    });
    expect(sim.state.treasury - before).toBe(SPY_OP.sabotage.cost);
    expect(m()!.state).toBe('back');
    expect(m()!.outcome).toBeUndefined();
    expect(w.intel!.results.at(-1)!.text).toBe(
      `Agent ${m()!.agent} was turned back from Brookside: Brookside has had a saboteur today: no more until midnight (UTC). The mission’s $45,000 is refunded`,
    );
    // Refunded once.
    harmless(sim, { type: 'missionResult', mission: id, outcome: 'refused' });
  });

  it('a caught agent is lost, and a theft banks a quarter of the next tier once per friend', () => {
    const { sim, friend } = friendTown();
    const w = sim.state.war!;
    const caught = arrive(sim, { type: 'spyMission', neighbour: friend.id, op: 'reveal' });
    ok(sim, { type: 'missionResult', mission: caught.id, outcome: 'caught' });
    expect(caught.m()).toBeUndefined();
    expect(w.intel!.lost).toEqual([w.clock + INTEL.replaceHours]);
    expect(w.intel!.results.at(-1)).toMatchObject({
      text: expect.stringMatching(/caught in Brookside/),
      tone: 'bad',
    });
    // Brookside is further on in Air research: a theft.
    const steal = arrive(sim, { type: 'spyMission', neighbour: friend.id, op: 'steal', branch: 'air' });
    // A tier that isn't the one the city lacks next, or with another operation, is no report.
    harmless(sim, { type: 'missionResult', mission: steal.id, outcome: 'failed', stole: 'air1' });
    ok(sim, { type: 'missionResult', mission: steal.id, outcome: 'success', stole: 'air1' });
    const pts = Math.floor(TIER.get('air1')!.points * INTEL.stealShare);
    expect(w.research!.points.air1).toBe(pts);
    expect(w.intel!.stolen).toEqual({ 2: ['air1'] });
    // Not twice from the same friend: refused before the agent leaves.
    for (let t = 0; t < 30 && w.intel!.missions.length; t++) sim.advance(H);
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'steal', branch: 'air' })).toBe(
      `Your agents have taken all they can of ${TIER.get('air1')!.name} from Brookside`,
    );
    // Nor where the friend is no further on.
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'steal', branch: 'land' })).toBe(
      'Brookside is no further than you in Land research',
    );
  });

  it('the city’s own refusals, as the region would decide them', () => {
    const { sim, friend } = friendTown();
    ok(sim, { type: 'regionUpdate', update: friendUpdate({ online: false }) });
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'sabotage', target: 'power' })).toBe(
      'Brookside’s player isn’t here: saboteurs wait for them',
    );
    ok(sim, { type: 'regionUpdate', update: friendUpdate({ raid: 'new' }) });
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'sabotage', target: 'power' })).toBe(
      'Brookside is too young or small for that, unless it strikes first',
    );
    ok(sim, { type: 'regionUpdate', update: friendUpdate({ raid: 'neutral' }) });
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'steal', branch: 'air' })).toBe(
      'Brookside is neutral: spies may only look there',
    );
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'reveal' })).toBeNull();
    // A city shared with friends in a room sends no spies to friends' cities.
    sim.shared = true;
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'reveal' })).toBe(
      'Spies from a shared city come with war among friends',
    );
    sim.shared = false;
    // War off in the region: none at all.
    const peace = friendUpdate();
    peace.rules = { war: false, scale: 'skirmish' };
    ok(sim, { type: 'regionUpdate', update: peace });
    expect(refusal(sim, { type: 'spyMission', neighbour: friend.id, op: 'reveal' })).toBe(
      'Your region’s rules don’t allow war',
    );
  });

  it('an agent that never hears from the region comes home with nothing', () => {
    const { sim, friend } = friendTown();
    const { m } = arrive(sim, { type: 'spyMission', neighbour: friend.id, op: 'reveal' });
    const at = sim.state.war!.clock;
    while (sim.state.war!.clock < at + 72) sim.advance(H);
    expect(m()!.state).toBe('back');
    expect(sim.state.war!.intel!.results.at(-1)!.text).toMatch(/heard nothing from the region/);
  });
});

/** A war town with a friend, a staffed blackout tower (its stages cheated) and its research. */
function towerTown() {
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  ok(sim, { type: 'cheat', cheat: 'research', tiers: ['intel1', 'intel2', 'intel3', 'intel4'] });
  const civic = place('blackouttower');
  ok(sim, { type: 'cheat', cheat: 'finishStages', civic });
  ok(sim, { type: 'regionUpdate', update: friendUpdate() });
  sim.advance(M);
  const friend = sim.state.region.neighbours.find((n) => n.player?.slot === 2)!;
  return { sim, friend };
}

describe('M37 operations between friends: the blackout tower', () => {
  it('charges at a friend, and starts its recharge only once the region keeps the blackout', () => {
    const { sim, friend } = towerTown();
    const w = sim.state.war!;
    ok(sim, { type: 'useBlackout', neighbour: friend.id });
    const t = w.supers!.tower!;
    const ready = t.ready;
    expect(t.charging).toMatchObject({ to: friend.id, slot: 2 });
    const op = t.charging!.op!;
    expect(friendOpsWaiting(sim)).toEqual([
      { mission: op, key: opKey(sim, 'tower', op), slot: 2, op: 'blackout', settling: false },
    ]);
    // Turned away: the tower stands ready again, its recharge not begun.
    ok(sim, {
      type: 'missionResult',
      mission: op,
      outcome: 'refused',
      reason: 'Brookside has taken a superweapon today',
    });
    expect(t.charging).toBeUndefined();
    expect(t.ready).toBe(ready);
    expect(sim.preview({ type: 'useBlackout', neighbour: friend.id }).ok).toBe(true);
    // Kept: ten days from now.
    ok(sim, { type: 'useBlackout', neighbour: friend.id });
    const op2 = t.charging!.op!;
    ok(sim, { type: 'missionResult', mission: op2, outcome: 'success' });
    expect(t.ready).toBe(w.clock + BLACKOUT.recharge);
    harmless(sim, { type: 'missionResult', mission: op2, outcome: 'success' });
    sim.advance(2 * H);
    expect(t.charging).toBeUndefined();
    expect(refusal(sim, { type: 'useBlackout', neighbour: friend.id })).toMatch(
      /^The blackout tower is charging: ready in \d+ hours$/,
    );
  });

  it('needs the friend’s player here, superweapons on, and a city of its own', () => {
    const { sim, friend } = towerTown();
    ok(sim, { type: 'regionUpdate', update: friendUpdate({ online: false }) });
    expect(refusal(sim, { type: 'useBlackout', neighbour: friend.id })).toBe(
      'Brookside’s player isn’t here: superweapons wait for them',
    );
    ok(sim, { type: 'regionUpdate', update: friendUpdate({ raid: 'spent' }) });
    expect(refusal(sim, { type: 'useBlackout', neighbour: friend.id })).toMatch(/three raids for today/);
    ok(sim, { type: 'regionUpdate', update: friendUpdate({}, false) });
    expect(refusal(sim, { type: 'useBlackout', neighbour: friend.id })).toBe(
      'Your region’s rules turn superweapons off',
    );
    ok(sim, { type: 'regionUpdate', update: friendUpdate() });
    sim.shared = true;
    expect(refusal(sim, { type: 'useBlackout', neighbour: friend.id })).toBe(
      'Blackouts from a shared city come with war among friends',
    );
  });
});

describe('M37 operations between friends: the target', () => {
  const resolve = (o: Partial<Extract<Command, { type: 'opResolve' }>> = {}): Command => ({
    type: 'opResolve',
    from: 2,
    id: 'op-12345678-77',
    op: 'sabotage',
    outcome: 'success',
    target: 'power',
    late: false,
    ...o,
  });

  /** The city's working power plants, largest first. */
  const plants = (sim: Sim) =>
    [...sim.state.civics.values()]
      .filter((c) => (CIVIC.get(c.def)?.output?.power ?? 0) > 0)
      .sort((a, b) => (CIVIC.get(b.def)!.output!.power ?? 0) - (CIVIC.get(a.def)!.output!.power ?? 0));

  it('a saboteur closes the city’s own largest working plant for a day, once', () => {
    const { sim } = friendTown();
    const plant = plants(sim).find((c) => civicOnline(c))!;
    expect(plant).toBeDefined();
    // Forged or stale: nothing happens.
    for (const bad of [
      resolve({ from: 7 }),
      resolve({ id: 'has spaces' }),
      resolve({ op: 'nuke' as never }),
      resolve({ target: undefined }),
      resolve({ op: 'reveal' }),
      resolve({ op: 'blackout', outcome: 'caught', target: undefined }),
      resolve({ late: 'yes' as never }),
    ])
      harmless(sim, bad);
    expect(harmless(sim, resolve({ from: 7 }))).toBe('That came from a city this one doesn’t know');
    ok(sim, resolve());
    expect(plant.damage).toBe(INTEL.sabotageClosed);
    expect(civicOnline(plant)).toBe(false);
    expect(sim.state.war!.intel!.results.at(-1)!.text).toMatch(/^Saboteurs from Brookside closed the /);
    // Taken once, however often it's offered.
    expect(harmless(sim, resolve())).toBe(OP_TAKEN);
    // The disasters' repair reopens it.
    sim.advance((INTEL.sabotageClosed + 2) * H);
    expect(plant.damage).toBe(0);
  });

  it('one that came while the player was away brings only a notice; a caught spy is logged', () => {
    const { sim } = friendTown();
    const before = plants(sim).map((c) => c.damage);
    ok(sim, resolve({ id: 'late-1', late: true }));
    expect(plants(sim).map((c) => c.damage)).toEqual(before);
    expect(sim.state.war!.intel!.results.at(-1)!.text).toMatch(/while you were away/);
    ok(sim, resolve({ id: 'caught-1', outcome: 'caught' }));
    expect(sim.state.war!.intel!.results.at(-1)).toMatchObject({
      text: 'Your agents caught a spy from Brookside at the power plant',
      tone: 'good',
    });
    expect(sim.events.some((e) => e.kind === 'enemySpyCaught')).toBe(true);
    // A quiet failure leaves nothing but its mark.
    const hash = sim.hash();
    ok(sim, resolve({ id: 'quiet-1', outcome: 'failed' }));
    expect(sim.state.war!.taken).toContain('2:op:quiet-1');
    void hash;
  });

  it('a blackout warns for an hour, then for twelve its plants falter and its radars go dark', () => {
    const { sim, place } = friendTown();
    place('radar');
    sim.advance(M);
    const w = sim.state.war!;
    const plant = plants(sim).find((c) => civicOnline(c))!;
    const full = civicOutput(sim, plant, 'power');
    const warned = warningHours(sim);
    expect(warned).toBeGreaterThan(WARNING.base);
    ok(sim, resolve({ id: 'bo-12345678-5', op: 'blackout', target: undefined }));
    expect(w.blackout).toEqual({ by: 2, from: w.clock + 1, until: w.clock + 13 });
    expect(blackedOut(sim)).toBe(false);
    sim.advance(H);
    expect(blackedOut(sim)).toBe(true);
    expect(blackoutFactor(sim)).toBe(BLACKOUT.plants);
    expect(civicOutput(sim, plant, 'power')).toBeCloseTo(full * BLACKOUT.plants, 6);
    expect(warningHours(sim)).toBe(WARNING.base);
    sim.advance(12 * H);
    expect(blackedOut(sim)).toBe(false);
    expect(w.blackout).toBeUndefined();
    expect(civicOutput(sim, plant, 'power')).toBeCloseTo(full, 6);
    // Late: only a notice.
    ok(sim, resolve({ id: 'bo-12345678-6', op: 'blackout', target: undefined, late: true }));
    expect(w.blackout).toBeUndefined();
  });

  it('takes nothing from a friend’s battle that brings a superweapon the region didn’t count', () => {
    const { sim } = friendTown();
    const w = sim.state.war!;
    // A battle as a friend's page would make one: a raid's, with a giant robot in it.
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0 });
    const input = structuredClone(w.battle!.input) as BattleInput;
    while (w.battle) sim.step();
    expect(battleHasSuper(input)).toBe(false);
    input.attacker.units[0]!.kind = 'windupbot';
    input.id = 'exp-friend-1';
    stampBattle(input);
    expect(battleHasSuper(input)).toBe(true);
    const cmd = { type: 'battleResolve', input, mode: 'instant', from: 2 } as const;
    expect(harmless(sim, cmd)).toBe(SUPER_UNCOUNTED);
    // Counted by the region: taken.
    ok(sim, { ...cmd, super: true });
    expect(w.taken).toContain('2:exp-friend-1');
  });
});
