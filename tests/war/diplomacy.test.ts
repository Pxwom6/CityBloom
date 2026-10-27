import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { DIPLOMACY, termProblem, type Term } from '../../src/data/diplomacy';
import { FIGHT_TIMEOUT_HOURS, SKIRMISH } from '../../src/data/battle';
import { MAP_SIZE } from '../../src/data/world';
import { battleLayout } from '../../src/sim/battle/layout';
import { BATTLE_VERSION, type BattleInput } from '../../src/sim/battle/types';
import type { AwayResult } from '../../src/sim/systems/expeditions';
import { scoreHomeBattle } from '../../src/sim/systems/diplomacy';
import type { BattleReport } from '../../src/sim/systems/raids';
import { regionReport, type Neighbour } from '../../src/sim/systems/region';
import { militaryDetails } from '../../src/sim/systems/war';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';

/**
 * M36: the stakes of each scale of war, scripted. A skirmish changes no land; a war ends in a treaty
 * whose tribute is paid month by month; a total war conquers a city that plays on as a vassal and
 * later rises; a pact broken with a computer neighbour turns its allies; and the fairness limits
 * the sim keeps hold.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A war town with an HQ, barracks, a bunker and some squads at home. */
function warTown(squads = 3): { sim: Sim; barracks: number } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(2 * M);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
  const segs = [...streets].reverse();
  const place = (def: string) => {
    for (const seg of segs)
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* next street */
      }
    throw new Error(`no room for ${def}`);
  };
  place('militaryhq');
  const barracks = place('barracks');
  place('bunker');
  for (let k = 0; k < squads; k++) sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  sim.advance(2 * M);
  expect(sim.state.war!.units.size).toBe(squads);
  return { sim, barracks };
}

const rivals = (sim: Sim) => sim.state.region.neighbours.filter((n) => n.rival && !n.player);
const ok = (sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) => {
  const r = sim.dispatch(cmd);
  if (!r.ok) throw new Error(r.reason);
  return r;
};
const dip = (sim: Sim) => sim.state.war!.diplomacy!;
/** Neighbours too weak to raid (a raid needs a strength of 1): only the scripted battles count. */
const disarm = (sim: Sim) => {
  for (const r of rivals(sim))
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: r.id, forces: 0.5, defences: 1 });
};

/** Send every unit at home to strike a neighbour and report the battle the page fought there. */
function strike(sim: Sim, n: Neighbour, result: Partial<AwayResult> = {}, target = 'military'): void {
  const w = sim.state.war!;
  // Wait for the forces to be home and mended enough to go.
  for (let t = 0; t < 3 * M && [...w.units.values()].some((u) => u.away || u.hp < 0.5); t++) sim.step();
  const units = [...w.units.values()].filter((u) => !u.away).map((u) => u.id);
  const r = ok(sim, {
    type: 'sendForce',
    units,
    to: n.id,
    route: 'highway',
    target: target as 'military',
    stance: 'bold',
  });
  const id = r.created![0]!;
  const e = () => w.expeditions!.find((x) => x.id === id)!;
  for (let t = 0; t < 2 * M && e().state !== 'fighting'; t++) sim.step();
  expect(e().state).toBe('fighting');
  ok(sim, {
    type: 'battleReport',
    expedition: id,
    result: {
      outcome: 'raided',
      units: units.map((u) => ({ id: u, hp: 0.9, out: false })),
      theirLost: 2,
      theirStrength: 6,
      defencesLost: 0,
      destroyed: 5,
      damaged: 3,
      objectives: { aimed: 2, down: 2 },
      hash: 'x',
      ...result,
    },
  });
}

/** What the ledger says for a line in each month closed since `from` (a month index). */
function ledger(sim: Sim, key: string): number[] {
  return sim.state.economy.history.map((h) => h.lines[key] ?? 0);
}

describe('M36: a skirmish changes no land', () => {
  it('a raid and a strike outside a declared war leave the map, the money terms and the score alone', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    const deals = JSON.stringify(sim.state.region.deals);
    const districts = JSON.stringify([...sim.state.districts.keys()]);
    sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: n.id });
    for (let t = 0; t < M && sim.state.war!.battle; t++) sim.step();
    expect(sim.state.war!.battle).toBeUndefined();
    strike(sim, n);
    sim.advance(2 * M);
    // No declaration, no treaty, no score, the city's word as good as ever.
    const d = sim.state.war!.diplomacy;
    expect(d?.wars ?? []).toHaveLength(0);
    expect(d?.pacts ?? []).toHaveLength(0);
    expect(d?.reputation ?? DIPLOMACY.reputation.start).toBe(DIPLOMACY.reputation.start);
    expect(JSON.stringify(sim.state.region.deals)).toBe(deals);
    expect(JSON.stringify([...sim.state.districts.keys()])).toBe(districts);
    for (const r of rivals(sim)) expect(r.rival!.vassal).toBeUndefined();
    for (const k of [
      'tributeIn',
      'tributeOut',
      'reparationsIn',
      'reparationsOut',
      'occupationOut',
      'overlord',
    ])
      expect(ledger(sim, k).every((v) => v === 0)).toBe(true);
  });

  it('a skirmish can’t strike the seat of power', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    const units = [...sim.state.war!.units.keys()];
    const r = sim.dispatch({
      type: 'sendForce',
      units,
      to: n.id,
      route: 'highway',
      target: 'cityhall',
      stance: 'bold',
    });
    expect(r.ok).toBe(false);
  });
});

describe('M36: a war ends in a treaty with tribute paid month by month', () => {
  it('declared, won in battle, and settled: the tribute comes in each month until it’s paid', () => {
    const { sim } = warTown();
    const n = rivals(sim).find((x) => x.rival!.personality !== 'aggressive') ?? rivals(sim)[0]!;
    disarm(sim);
    // A declaration names a reason and warns before the war opens.
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'war', reason: 'Our border' });
    const war = () => dip(sim).wars.find((x) => x.with === n.id)!;
    expect(war().opens).toBe(sim.state.tick + DIPLOMACY.warningHours * H);
    expect(sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' }).ok).toBe(false);
    // Forces can't go before it opens; then two decisive strikes.
    const units = [...sim.state.war!.units.keys()];
    expect(
      sim.dispatch({
        type: 'sendForce',
        units,
        to: n.id,
        route: 'highway',
        target: 'military',
        stance: 'bold',
      }).ok,
    ).toBe(false);
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n);
    strike(sim, n);
    expect(war().battles).toBe(2);
    expect(war().score).toBeGreaterThanOrEqual(30);
    expect(war().score).toBeLessThan(-DIPLOMACY.score.capitulate);
    // Peace, with tribute from the losing side.
    const amount = 2_000;
    ok(sim, {
      type: 'propose',
      neighbour: n.id,
      terms: [{ k: 'peace' }, { k: 'tribute', payer: 'them', amount, months: 6 }],
    });
    sim.advance(3 * H);
    expect(dip(sim).wars.some((x) => x.with === n.id)).toBe(false);
    const pact = dip(sim).pacts.find((p) => p.term.k === 'tribute')!;
    expect(pact.left).toBe(6);
    // The war with it just ended: no new one until the cooldown has passed.
    const again = sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toMatch(/too recently/);
    // Month by month: a full month's tribute in each month's books, and the pact counts down.
    const start = sim.state.economy.history.length;
    let last = 6;
    for (let m = 1; m <= 8; m++) {
      sim.advance(M);
      const left = dip(sim).pacts.find((x) => x.term.k === 'tribute')?.left ?? 0;
      expect(left === last || left === last - 1).toBe(true);
      last = left;
    }
    const paid = ledger(sim, 'tributeIn').slice(start);
    const full = paid.filter((v) => v > 0);
    expect(full.length).toBe(6);
    for (const v of full) expect(Math.abs(v - amount)).toBeLessThanOrEqual(1);
    expect(dip(sim).pacts.some((x) => x.term.k === 'tribute')).toBe(false);
    // The cooldown long past: war may be declared again.
    expect(sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' }).ok).toBe(true);
  });

  it('a side whose score collapses capitulates, and the winner’s terms stand', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    for (let k = 0; k < 4 && !dip(sim).wars[0]?.capitulated; k++) strike(sim, n, { destroyed: 12 });
    const war = dip(sim).wars.find((x) => x.with === n.id)!;
    expect(war.capitulated?.by).toBe('them');
    // No more raids from it, and the city sets the terms without asking: here an embargo too.
    expect(sim.state.war!.incoming?.some((r) => r.from === n.id) ?? false).toBe(false);
    ok(sim, {
      type: 'propose',
      neighbour: n.id,
      terms: [{ k: 'reparations', payer: 'them', amount: 5_000 }, { k: 'embargo' }],
    });
    expect(dip(sim).wars.some((x) => x.with === n.id)).toBe(false);
    expect(sim.state.economy.month.reparationsIn ?? 0).toBe(5_000);
    // The embargo stops deals with it.
    expect(sim.state.region.deals.some((d) => d.neighbour === n.id)).toBe(false);
    const deal = sim.dispatch({
      type: 'setDeal',
      neighbour: n.id,
      resource: 'power',
      direction: 'buy',
      amount: 5,
    });
    expect(deal.ok).toBe(false);
    if (!deal.ok) expect(deal.reason).toMatch(/embargo/);
  });
});

describe('M36: total war and conquest', () => {
  it('a city whose HQ is held falls, plays on as a vassal, and later rises and goes free', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 400, defences: 20 });
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: 'Freedom of the seas' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    // Its raid goes for the HQ and knocks it down.
    let held = false;
    for (let k = 0; k < 4 && !held; k++) {
      for (let t = 0; t < M && (sim.state.war!.battle || sim.state.war!.incoming?.length); t++) sim.step();
      ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: n.id, seat: true });
      for (let t = 0; t < M && sim.state.war!.battle; t++) sim.step();
      held = !!dip(sim).wars[0]?.hold;
    }
    expect(dip(sim).wars[0]!.hold?.by).toBe('them');
    sim.advance(DIPLOMACY.conquestHours * H + H);
    expect(dip(sim).vassal?.overlord).toBe(n.id);
    expect(dip(sim).fell?.by).toBe(n.id);
    // Its war is over, and so are those of its allies that came in on its side.
    expect(dip(sim).wars.length).toBe(0);
    // Plays on as a vassal: a fifth of its taxes to the overlord, month by month.
    const pop = sim.state.totals.population;
    sim.advance(3 * M);
    expect(sim.state.totals.population).toBeGreaterThan(pop * 0.5);
    const dues = ledger(sim, 'overlord').slice(-2);
    const taxes = sim.state.economy.history
      .slice(-2)
      .map((h) => Object.entries(h.lines).reduce((a, [k, v]) => a + (k.startsWith('tax') ? v : 0), 0));
    for (let k = 0; k < 2; k++)
      expect(Math.abs(dues[k]! + taxes[k]! * 0.2)).toBeLessThan(taxes[k]! * 0.02 + 5);
    // No war but a rising, and only once strong enough.
    const other = rivals(sim).find((x) => x.id !== n.id)!;
    expect(sim.dispatch({ type: 'declareWar', neighbour: other.id, scale: 'war', reason: '' }).ok).toBe(
      false,
    );
    expect(sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'total', reason: 'Freedom' }).ok).toBe(
      false,
    );
    // The city rebuilds its forces, and the overlord's are spent elsewhere: the city rises.
    const barracks = [...sim.state.civics.values()].find((c) => c.def === 'barracks')!.id;
    for (let k = 0; k < 3; k++) ok(sim, { type: 'trainUnit', base: barracks, kind: 'infantry' });
    sim.advance(2 * M);
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 1, defences: 0.5 });
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: 'Freedom' });
    expect(dip(sim).wars[0]!.rebellion).toBe(true);
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n, {}, 'cityhall');
    expect(dip(sim).wars[0]!.hold?.by).toBe('us');
    sim.advance(DIPLOMACY.conquestHours * H + H);
    expect(dip(sim).vassal).toBeUndefined();
    expect(n.rival!.vassal).toBeDefined();
    expect(n.rival!.forces).toBeLessThanOrEqual(1);
  });

  it('a held seat is taken back by a battle its defender wins', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n, {}, 'cityhall');
    expect(dip(sim).wars[0]!.hold?.by).toBe('us');
    strike(sim, n, { outcome: 'repelled', objectives: { aimed: 1, down: 0 }, destroyed: 0 }, 'cityhall');
    expect(dip(sim).wars[0]!.hold).toBeUndefined();
  });
});

describe('M36: treaties, pacts and allies', () => {
  it('a pact broken with a computer neighbour turns its allies', () => {
    const { sim } = warTown();
    const [n, a] = rivals(sim);
    // Two neighbours that stand by each other; the first likes the city enough for a pact.
    n!.rival!.personality = 'honourable';
    a!.rival!.personality = 'honourable';
    n!.rival!.allies = [a!.id];
    a!.rival!.allies = [n!.id];
    n!.rival!.relation = 40;
    a!.rival!.relation = 30;
    ok(sim, { type: 'propose', neighbour: n!.id, terms: [{ k: 'nonAggression', months: 24 }] });
    ok(sim, { type: 'propose', neighbour: a!.id, terms: [{ k: 'nonAggression', months: 24 }] });
    sim.advance(3 * H);
    expect(
      dip(sim)
        .pacts.filter((p) => p.term.k === 'nonAggression')
        .map((p) => p.with)
        .sort(),
    ).toEqual([n!.id, a!.id].sort());
    const rep = dip(sim).reputation;
    // The pact stands in the way: the city is asked first.
    const asked = sim.dispatch({ type: 'declareWar', neighbour: n!.id, scale: 'war', reason: '' });
    expect(asked.ok).toBe(false);
    if (!asked.ok) expect(asked.info?.breaks).toBe(true);
    const units = [...sim.state.war!.units.keys()];
    expect(
      sim.dispatch({
        type: 'sendForce',
        units,
        to: n!.id,
        route: 'highway',
        target: 'military',
        stance: 'bold',
      }).ok,
    ).toBe(false);
    const aRelation = a!.rival!.relation;
    ok(sim, { type: 'declareWar', neighbour: n!.id, scale: 'war', reason: '', breakPact: true });
    expect(dip(sim).reputation).toBeLessThanOrEqual(rep + DIPLOMACY.reputation.breakPact);
    // Its ally: likes the city far less, ends its own pact, and comes into the war.
    expect(a!.rival!.relation).toBeLessThanOrEqual(aRelation + DIPLOMACY.alliesRelation);
    expect(dip(sim).pacts.some((p) => p.with === a!.id)).toBe(false);
    expect(dip(sim).wars.find((x) => x.with === a!.id)?.by).toBe('them');
    expect(dip(sim).log.some((e) => e.text.includes('broke'))).toBe(true);
  });

  it('computer neighbours weigh terms by character: a mercantile one won’t take an embargo', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    n.rival!.personality = 'mercantile';
    n.rival!.relation = 20;
    ok(sim, { type: 'propose', neighbour: n.id, terms: [{ k: 'embargo' }] });
    sim.advance(3 * H);
    expect(dip(sim).pacts.length).toBe(0);
    expect(dip(sim).proposals.filter((p) => p.from === 'us').length).toBe(0);
    // An alliance with a neighbour that doesn't like the city is turned down too.
    n.rival!.relation = 0;
    ok(sim, { type: 'propose', neighbour: n.id, terms: [{ k: 'alliance' }] });
    sim.advance(3 * H);
    expect(dip(sim).pacts.some((p) => p.term.k === 'alliance')).toBe(false);
  });
});

describe('M36: fairness the sim keeps', () => {
  it('a young city is not declared on, however weak; a neutral one sends no forces and goes to no war', () => {
    const { sim } = warTown();
    for (const n of rivals(sim)) {
      n.rival!.personality = 'aggressive';
      n.rival!.relation = -90;
      ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 500, defences: 50 });
    }
    // Four months old: neighbours may not declare yet.
    sim.advance(4 * M);
    expect(sim.state.war!.diplomacy?.wars.length ?? 0).toBe(0);
    ok(sim, { type: 'setNeutral', on: true });
    const n = rivals(sim)[0]!;
    expect(sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' }).ok).toBe(false);
    const units = [...sim.state.war!.units.keys()];
    expect(
      sim.dispatch({
        type: 'sendForce',
        units,
        to: n.id,
        route: 'highway',
        target: 'military',
        stance: 'bold',
      }).ok,
    ).toBe(false);
    // Leaving neutrality takes a month to count.
    ok(sim, { type: 'setNeutral', on: false });
    expect(sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' }).ok).toBe(false);
    sim.advance(DIPLOMACY.neutral.leaveMonths * M);
    expect(sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' }).ok).toBe(true);
  });

  it('diplomacy round-trips through a save, and a war goes on the same after loading', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: 'Saved' });
    // A proposal on the table too, to one not at war with the city (its allies may have joined in).
    const calm = rivals(sim).find((x) => !dip(sim).wars.some((w) => w.with === x.id));
    if (calm) ok(sim, { type: 'propose', neighbour: calm.id, terms: [{ k: 'nonAggression', months: 12 }] });
    sim.advance(20 * H);
    const copy = Sim.fromSave(sim.save());
    expect(copy.hash()).toBe(sim.hash());
    sim.advance(2 * M);
    copy.advance(2 * M);
    expect(copy.hash()).toBe(sim.hash());
  });

  it('a v28 war save gains its neighbours’ alliances from the same dice', () => {
    const { sim } = warTown();
    const want = rivals(sim).map((n) => [n.id, [...(n.rival!.allies ?? [])]]);
    const save = sim.save() as {
      version: number;
      state: { region: { neighbours: { rival?: { allies?: number[] } }[] } };
    };
    save.version = 28;
    for (const n of save.state.region.neighbours) if (n.rival) delete n.rival.allies;
    const old = Sim.fromSave(save as never);
    expect(rivals(old).map((n) => [n.id, [...(n.rival!.allies ?? [])]])).toEqual(want);
  });
});

describe('M36: friends’ raids', () => {
  /** A friend's city in the place of a computer neighbour, as a shared region's news brings it. */
  const friend = (sim: Sim, extra: Record<string, unknown> = {}) => {
    const none = { power: 0, water: 0, garbage: 0 };
    const r = sim.dispatch({
      type: 'regionUpdate',
      update: {
        cities: [
          {
            slot: 2,
            name: 'Samton',
            mayor: 'Sam',
            color: 1,
            population: 5_000,
            kind: 'suburb',
            offers: { buy: { ...none }, sell: { ...none } },
            workers: 0,
            jobs: 0,
            shoppers: 0,
            online: false,
            ...extra,
          },
        ],
        contracts: [],
        project: null,
        rules: { war: true, scale: 'skirmish' },
      },
    });
    expect(r.ok).toBe(true);
    return sim.state.region.neighbours.find((n) => n.player?.slot === 2)!;
  };
  const send = (sim: Sim, to: number) =>
    sim.dispatch({
      type: 'sendForce',
      units: [...sim.state.war!.units.keys()],
      to,
      route: 'highway',
      target: 'military',
      stance: 'bold',
    });

  it('the attacker’s city sends no force where the region would turn it away', () => {
    const { sim } = warTown();
    for (const [verdict, why] of [
      ['new', /too young or small/],
      ['neutral', /neutral/],
      ['spent', /today/],
    ] as const) {
      const sam = friend(sim, { raid: verdict });
      const r = send(sim, sam.id);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(why);
    }
    const sam = friend(sim, { raid: 'open' });
    expect(send(sim, sam.id).ok).toBe(true);
  });

  it('a force whose battle is with the region can’t be called back until the region answers', () => {
    const { sim } = warTown();
    disarm(sim);
    const sam = friend(sim, { raid: 'open' });
    const r = send(sim, sam.id);
    expect(r.ok).toBe(true);
    const id = r.ok ? r.created![0]! : 0;
    const e = () => sim.state.war!.expeditions!.find((x) => x.id === id)!;
    for (let t = 0; t < 2 * M && e().state !== 'fighting'; t++) sim.step();
    expect(e().state).toBe('fighting');
    ok(sim, { type: 'battleSettling', expedition: id, on: true });
    const back = sim.dispatch({ type: 'recallForce', expedition: id });
    expect(back.ok).toBe(false);
    if (!back.ok) expect(back.reason).toMatch(/region/);
    // Waiting on the region outlasts the ordinary wait for a battle.
    sim.advance((FIGHT_TIMEOUT_HOURS + 1) * H);
    expect(e().state).toBe('fighting');
    // Turned away: freed, and called home.
    ok(sim, { type: 'battleSettling', expedition: id, on: false });
    ok(sim, { type: 'recallForce', expedition: id });
    expect(e().state).toBe('back');
    // A force no longer fighting can't be pinned: its page forgets the battle instead.
    expect(sim.dispatch({ type: 'battleSettling', expedition: id, on: true }).ok).toBe(false);
  });

  it('the defender’s city takes a raid only from a city of the region it knows, at half the damage while away', () => {
    const { sim } = warTown();
    friend(sim, { online: true });
    const input = (id: string) => ({
      ...strongRaid(sim, id),
      caps: { maxCollapse: 10_000, maxWreck: 10_000 },
    });
    // From a place in the region the city knows nothing of: refused, and nothing changes.
    const hash = sim.hash();
    const r = sim.dispatch({ type: 'battleResolve', input: input('f-1'), mode: 'instant', from: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/doesn’t know/);
    expect(sim.hash()).toBe(hash);
    // From its friend, made while the player was away: half the damage.
    expect(
      sim.dispatch({ type: 'battleResolve', input: input('f-2'), mode: 'instant', from: 2, away: true }).ok,
    ).toBe(true);
    const report = sim.state.war!.reports!.at(-1)!;
    expect(report.absent).toBe(true);
    expect(report.collapsed.length).toBeLessThanOrEqual(SKIRMISH.awayCollapse);
    expect(report.civics.filter((c) => c.wrecked).length).toBeLessThanOrEqual(SKIRMISH.awayWreck);
  });

  it('a city reports its shield to the region: new, neutral, or none once past the bar (or in tests, unshielded)', () => {
    const { sim } = warTown();
    expect(regionReport(sim).shield).toBe('new');
    ok(sim, { type: 'setNeutral', on: true });
    expect(regionReport(sim).shield).toBe('neutral');
    ok(sim, { type: 'setNeutral', on: false });
    ok(sim, { type: 'cheat', cheat: 'unshield' });
    expect(regionReport(sim).shield).toBeUndefined();
  });
});

/** A heavy raid on the town's military, as a friend's page would fight it. */
function strongRaid(sim: Sim, id: string): BattleInput {
  return {
    v: BATTLE_VERSION,
    id,
    seed: `seed-${id}`,
    scale: 'skirmish',
    layout: battleLayout(sim, { target: 'military', from: 'west' }),
    attacker: {
      name: 'Samton',
      color: 0xd04040,
      units: Array.from({ length: 24 }, (_, k) => ({
        id: 90_000 + k,
        kind: 'tank' as const,
        hp: 1,
        x: 0,
        z: 0,
        base: -1,
      })),
      route: 'highway',
      target: 'military',
      stance: 'bold',
      readiness: 1,
    },
    defender: { name: sim.state.cityName, color: 0x4060d0 },
    orders: [],
    caps: { maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck },
  };
}

describe('M36: computer neighbours of their own accord', () => {
  /** The menu's demo town (six years old, past the newcomer bar) with war turned on by its region. */
  function establishedCity(scale: 'skirmish' | 'war' | 'total'): Sim {
    const sim = Sim.fromSave(decodeSave(readFileSync('public/demo.citybloom')));
    sim.testMode = true;
    const r = sim.dispatch({
      type: 'regionUpdate',
      update: { cities: [], contracts: [], project: null, rules: { war: true, scale } },
    });
    expect(r.ok).toBe(true);
    expect(sim.state.war).toBeDefined();
    return sim;
  }

  it('an aggressive neighbour that outguns and dislikes an established city declares war on it', () => {
    const sim = establishedCity('total');
    const n = rivals(sim)[0]!;
    n.rival!.personality = 'aggressive';
    n.rival!.relation = -80;
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 400, defences: 50 });
    for (let d = 0; d < 30 && !sim.state.war!.diplomacy?.wars.some((w) => w.with === n.id); d++)
      sim.advance(M);
    const war = sim.state.war!.diplomacy!.wars.find((w) => w.with === n.id)!;
    expect(war.by).toBe('them');
    expect(war.reason.length).toBeGreaterThan(0);
    expect(sim.state.war!.diplomacy!.log.some((e) => e.text.includes('declares'))).toBe(true);
  });

  it('a neighbour that likes the city doesn’t, and a region of skirmishes allows no declarations', () => {
    const sim = establishedCity('skirmish');
    const n = rivals(sim)[0]!;
    n.rival!.personality = 'aggressive';
    n.rival!.relation = -80;
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 400, defences: 50 });
    sim.advance(10 * M);
    expect(sim.state.war!.diplomacy?.wars.length ?? 0).toBe(0);
    const r = sim.dispatch({ type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/skirmishes only/);
  });

  it('a conquered neighbour pays its dues, and rises once it’s strong enough', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n, {}, 'cityhall');
    sim.advance(DIPLOMACY.conquestHours * H + H);
    expect(n.rival!.vassal).toBeDefined();
    sim.advance(2 * M);
    const dues = ledger(sim, 'vassals').slice(-1)[0]!;
    expect(
      Math.abs(
        dues - Math.round(n.population * DIPLOMACY.neighbourTaxPerResident * DIPLOMACY.vassal.taxShare),
      ),
    ).toBeLessThanOrEqual(Math.max(5, n.population * 0.1));
    // It raids no more; rebuilt past the city's strength, it rises. It stays a vassal until the
    // rising wins, and pays no dues while it's up in arms.
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 300, defences: 50 });
    const rising = () => sim.state.war!.diplomacy!.wars.find((w) => w.with === n.id);
    for (let d = 0; d < 30 && !rising(); d++) sim.advance(M);
    const war = rising()!;
    expect(war.by).toBe('them');
    expect(war.rebellion).toBe(true);
    expect(n.rival!.vassal).toBeDefined();
    sim.advance(2 * M);
    expect(ledger(sim, 'vassals').slice(-1)[0] ?? 0).toBe(0);
  });
});

describe('M36 review: the rules hold at their edges', () => {
  /** A treaty a neighbour puts to the city, accepted. */
  const treaty = (sim: Sim, n: Neighbour, terms: Term[]) => {
    ok(sim, { type: 'cheat', cheat: 'proposal', neighbour: n.id, terms });
    const p = dip(sim).proposals.find((x) => x.from === 'them' && x.with === n.id)!;
    ok(sim, { type: 'answerProposal', proposal: p.id, accept: true });
  };

  it('whatever the city had with a computer neighbour ends when a friend’s city takes its place', () => {
    const { sim } = warTown();
    const [n, m] = rivals(sim);
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n!.id, scale: 'war', reason: '' });
    sim.state.war!.diplomacy!.vassal = { overlord: m!.id, since: sim.state.tick };
    // Friends take both places (each goes to the first neighbour that isn't a player yet).
    const none = { power: 0, water: 0, garbage: 0 };
    const city = (slot: number, name: string) => ({
      slot,
      name,
      mayor: name,
      color: slot,
      population: 4_000,
      kind: 'suburb' as const,
      offers: { buy: { ...none }, sell: { ...none } },
      workers: 0,
      jobs: 0,
      shoppers: 0,
      online: true,
    });
    ok(sim, {
      type: 'regionUpdate',
      update: {
        cities: [city(2, 'Samton'), city(3, 'Tamton')],
        contracts: [],
        project: null,
        rules: { war: true, scale: 'total' },
      },
    });
    expect(n!.player && m!.player).toBeTruthy();
    expect(dip(sim).wars).toHaveLength(0);
    expect(dip(sim).vassal).toBeUndefined();
    for (const r of rivals(sim)) expect(r.rival!.allies ?? []).not.toContain(n!.id);
    // Nothing keyed to them is left to throw or pay out.
    sim.advance(10 * M);
    expect(
      ledger(sim, 'overlord')
        .slice(-3)
        .every((v) => v === 0),
    ).toBe(true);
  });

  it('a raid that finds nothing to strike scores nothing', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    // No military buildings left: nothing a raid could aim at.
    for (const c of [...sim.state.civics.values()].filter(
      (c) => c.def === 'militaryhq' || c.def === 'barracks' || c.def === 'bunker',
    ))
      ok(sim, { type: 'bulldoze', target: { kind: 'civic', id: c.id } });
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 200, defences: 10 });
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    for (let k = 0; k < 3; k++) {
      for (let t = 0; t < M && (sim.state.war!.battle || sim.state.war!.incoming?.length); t++) sim.step();
      ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0, neighbour: n.id, seat: true });
      for (let t = 0; t < M && sim.state.war!.battle; t++) sim.step();
    }
    const war = dip(sim).wars.find((w) => w.with === n.id)!;
    expect(war.battles).toBe(0);
    expect(war.capitulated).toBeUndefined();
  });

  it('a ceasefire freezes a hold on a seat of power', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n, {}, 'cityhall');
    const war = () => dip(sim).wars.find((w) => w.with === n.id);
    expect(war()!.hold?.by).toBe('us');
    treaty(sim, n, [{ k: 'ceasefire', hours: 72 }]);
    const score = war()!.score;
    sim.advance(60 * H);
    expect(n.rival!.vassal).toBeUndefined();
    expect(war()!.hold?.by).toBe('us');
    expect(war()!.score).toBe(score);
    // Once it lapses the hold runs on, and the city falls.
    sim.advance((12 + DIPLOMACY.conquestHours + 2) * H);
    expect(n.rival!.vassal).toBeDefined();
  });

  it('an ally of the target with a pact with the city keeps its word and stays out', () => {
    const { sim } = warTown();
    const [n, a] = rivals(sim);
    disarm(sim);
    n!.rival!.allies = [a!.id];
    a!.rival!.allies = [n!.id];
    a!.rival!.personality = 'honourable';
    treaty(sim, a!, [{ k: 'nonAggression', months: 24 }]);
    ok(sim, { type: 'declareWar', neighbour: n!.id, scale: 'war', reason: '' });
    expect(dip(sim).wars.some((w) => w.with === a!.id)).toBe(false);
  });

  it('conquest ends the fallen side’s claims, and a fallen city’s other wars', () => {
    const { sim } = warTown();
    const [n, m] = rivals(sim);
    disarm(sim);
    // The city pays n tribute, then conquers it: the tribute ends with n's fall.
    treaty(sim, n!, [{ k: 'tribute', payer: 'us', amount: 500, months: 24 }]);
    ok(sim, { type: 'declareWar', neighbour: n!.id, scale: 'total', reason: '', breakPact: true });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n!, {}, 'cityhall');
    sim.advance(DIPLOMACY.conquestHours * H + H);
    expect(n!.rival!.vassal).toBeDefined();
    expect(dip(sim).pacts.some((p) => p.with === n!.id && p.term.k === 'tribute')).toBe(false);
    // At war with m too, the city falls to it: every war of its ends under its overlord's peace.
    const other = rivals(sim).find((x) => x.id !== n!.id && x.id !== m!.id) ?? m!;
    ok(sim, { type: 'declareWar', neighbour: other.id, scale: 'war', reason: '' });
    ok(sim, { type: 'cheat', cheat: 'fall', neighbour: m!.id });
    expect(dip(sim).vassal?.overlord).toBe(m!.id);
    expect(dip(sim).wars).toHaveLength(0);
  });

  it('a computer vassal whose rising is beaten stays a vassal', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n, {}, 'cityhall');
    sim.advance(DIPLOMACY.conquestHours * H + H);
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 300, defences: 50 });
    const rising = () => dip(sim).wars.find((w) => w.with === n.id);
    for (let d = 0; d < 30 && !rising(); d++) sim.advance(M);
    expect(rising()?.rebellion).toBe(true);
    // Beaten (its forces spent, then struck hard until it capitulates); the usual terms stand.
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    for (let k = 0; k < 4 && !rising()?.capitulated; k++) strike(sim, n, { destroyed: 12 });
    expect(rising()?.capitulated?.by).toBe('them');
    sim.advance(DIPLOMACY.termsDays * M + H);
    expect(rising()).toBeUndefined();
    expect(n.rival!.vassal).toBeDefined();
  });

  it('a neutral city that is attacked is neutral no more, and may answer', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    for (const r of rivals(sim)) r.rival!.allies = [];
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n, {}, 'cityhall');
    sim.advance(DIPLOMACY.conquestHours * H + H);
    expect(n.rival!.vassal).toBeDefined();
    // Neutral once the strike is far enough behind it; then its vassal rises against it.
    sim.advance(DIPLOMACY.neutral.afterStrikeMonths * M);
    ok(sim, { type: 'setNeutral', on: true });
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 300, defences: 50 });
    for (let d = 0; d < 30 && !dip(sim).wars.length; d++) sim.advance(M);
    expect(dip(sim).wars[0]?.rebellion).toBe(true);
    expect(dip(sim).neutral).toBeUndefined();
    expect(dip(sim).log.some((e) => e.text.includes('neutral no more'))).toBe(true);
    // And it may answer at once.
    sim.advance(DIPLOMACY.warningHours * H + 60);
    const units = [...sim.state.war!.units.values()].filter((u) => !u.away).map((u) => u.id);
    expect(
      sim.dispatch({
        type: 'sendForce',
        units,
        to: n.id,
        route: 'highway',
        target: 'military',
        stance: 'bold',
      }).ok,
    ).toBe(true);
  });
});

describe('M36 review: what the page is told', () => {
  it('a term out of bounds is named with its limits', () => {
    const { sim } = warTown(1);
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    const r = sim.dispatch({ type: 'propose', neighbour: n.id, terms: [{ k: 'ceasefire', hours: 6 }] });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toBe('Ceasefire: 12 to 720 hours');
    expect(termProblem({ k: 'tribute', payer: 'them', amount: 50, months: 12 })).toMatch(
      /^Tribute: \$100 or more/,
    );
    expect(termProblem({ k: 'nonAggression', months: 0 })).toMatch(/1 to 120 months/);
    expect(termProblem({ k: 'peace' })).toBeNull();
  });

  it('a neighbour’s occupied quarter is named', () => {
    const { sim } = warTown(1);
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, {
      type: 'cheat',
      cheat: 'proposal',
      neighbour: n.id,
      terms: [{ k: 'occupy', side: 'them', district: 2 }],
    });
    const p = dip(sim).proposals.find((x) => x.from === 'them')!;
    ok(sim, { type: 'answerProposal', proposal: p.id, accept: true });
    expect(dip(sim).log.at(-1)!.text).toContain(`the city occupies ${n.name}’s middle quarter`);
  });

  it('a hold is good news when the city holds and bad when it is held', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    sim.events = [];
    strike(sim, n, {}, 'cityhall');
    const hold = sim.events.find((e) => e.kind === 'diplomacy' && e.info?.what === 'hold');
    expect(hold?.info?.tone).toBe('good');
  });

  it('a base in a demilitarised zone says it stands down, and trains nothing', () => {
    const { sim, barracks } = warTown(1);
    disarm(sim);
    const c = sim.state.civics.get(barracks)!;
    // A zone on the city's side towards the neighbour whose border is nearest the barracks.
    const MAP = MAP_SIZE;
    const dist = (side: string) =>
      side === 'north' ? c.z : side === 'south' ? MAP - c.z : side === 'east' ? MAP - c.x : c.x;
    const n = [...rivals(sim)].sort((a, b) => dist(a.side) - dist(b.side))[0]!;
    const before = DIPLOMACY.dmz;
    (DIPLOMACY as { dmz: number }).dmz = dist(n.side) + 1;
    try {
      ok(sim, {
        type: 'cheat',
        cheat: 'proposal',
        neighbour: n.id,
        terms: [{ k: 'dmz', side: 'us', months: 12 }],
      });
      const p = dip(sim).proposals.find((x) => x.from === 'them')!;
      ok(sim, { type: 'answerProposal', proposal: p.id, accept: true });
      const r = sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reason).toMatch(/^Stands down: the treaty with /);
      const why = militaryDetails(sim, c).trains.find((t) => t.kind === 'infantry')!.why;
      expect(why).toMatch(/^Stands down/);
    } finally {
      (DIPLOMACY as { dmz: number }).dmz = before;
    }
  });
});

describe('M36 second review: the rules at their edges', () => {
  const treaty = (sim: Sim, n: Neighbour, terms: Term[]) => {
    ok(sim, { type: 'cheat', cheat: 'proposal', neighbour: n.id, terms });
    const p = dip(sim).proposals.find((x) => x.from === 'them' && x.with === n.id)!;
    ok(sim, { type: 'answerProposal', proposal: p.id, accept: true });
  };

  it('a rising vassal offers its freedom or nothing, and rises again only after the cooldown', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    for (const r of rivals(sim)) r.rival!.allies = [];
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'total', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    strike(sim, n, {}, 'cityhall');
    sim.advance(DIPLOMACY.conquestHours * H + H);
    expect(n.rival!.vassal).toBeDefined();
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 300, defences: 50 });
    const rising = () => dip(sim).wars.find((w) => w.with === n.id);
    for (let d = 0; d < 30 && !rising(); d++) sim.advance(M);
    expect(rising()?.rebellion).toBe(true);
    // Up in arms, it's held to a score (its raids could otherwise win it the city's HQ).
    ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    // Winning, it puts terms to the city: always its freedom (refused here, to see more).
    let offers = 0;
    for (let d = 0; d < 20; d++) {
      rising()!.score = -40;
      sim.advance(M);
      for (const p of dip(sim).proposals.filter((x) => x.from === 'them' && x.with === n.id)) {
        offers++;
        expect(p.terms.map((t) => t.k)).toEqual(expect.arrayContaining(['peace', 'independence']));
        ok(sim, { type: 'answerProposal', proposal: p.id, accept: false });
      }
    }
    expect(offers).toBeGreaterThan(0);
    // A peace without its freedom (as the city might agree to): still a vassal, and not up in arms
    // again before the cooldown (made long here, so the daily dice can't hide a rising).
    const cooldown = DIPLOMACY.cooldownMonths;
    (DIPLOMACY as { cooldownMonths: number }).cooldownMonths = 20;
    try {
      treaty(sim, n, [{ k: 'peace' }]);
      expect(rising()).toBeUndefined();
      expect(n.rival!.vassal).toBeDefined();
      ok(sim, { type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 300, defences: 50 });
      for (let d = 0; d < 19; d++) {
        sim.advance(M);
        expect(rising()).toBeUndefined();
      }
      for (let d = 0; d < 30 && !rising(); d++) sim.advance(M);
      expect(rising()?.rebellion).toBe(true);
    } finally {
      (DIPLOMACY as { cooldownMonths: number }).cooldownMonths = cooldown;
    }
  });

  it('a raid beaten off by wounds alone, or that set homes burning, is a battle the score counts', () => {
    const { sim } = warTown();
    const n = rivals(sim)[0]!;
    disarm(sim);
    ok(sim, { type: 'declareWar', neighbour: n.id, scale: 'war', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    const war = () => dip(sim).wars.find((w) => w.with === n.id)!;
    const report = (extra: Partial<BattleReport> = {}): BattleReport => ({
      id: 1,
      start: 0,
      end: 0,
      other: n.name,
      ours: false,
      target: 'military',
      outcome: 'withdrew',
      collapsed: [],
      burning: [],
      civics: [],
      craters: 0,
      lost: {},
      theirLost: 0,
      theirTotal: 10,
      near: 0,
      sheltered: 0,
      homeless: 0,
      ...extra,
    });
    scoreHomeBattle(sim, n.id, report(), 3, 0, false);
    expect(war().battles).toBe(0);
    scoreHomeBattle(sim, n.id, report(), 3, 0, true);
    expect(war().battles).toBe(1);
    expect(war().score).toBeGreaterThan(0);
    scoreHomeBattle(sim, n.id, report({ burning: [1] }), 3, 0, false);
    expect(war().battles).toBe(2);
  });

  it('a war a fall has just ended does nothing more in the same hour', () => {
    const { sim } = warTown();
    const [a, b] = rivals(sim);
    disarm(sim);
    for (const r of rivals(sim)) r.rival!.allies = [];
    ok(sim, { type: 'declareWar', neighbour: a!.id, scale: 'total', reason: '' });
    ok(sim, { type: 'declareWar', neighbour: b!.id, scale: 'war', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    const d = dip(sim);
    const wa = d.wars.find((w) => w.with === a!.id)!;
    const wb = d.wars.find((w) => w.with === b!.id)!;
    // A holds the city's HQ, its 48 hours up in the same hour B's war would open.
    wa.hold = { by: 'them', since: sim.state.tick - DIPLOMACY.conquestHours * H + 30 };
    wb.opened = undefined;
    wb.opens = sim.state.tick + 30;
    sim.advance(2 * H);
    expect(d.vassal?.overlord).toBe(a!.id);
    expect(d.wars).toHaveLength(0);
    const fell = d.log.findIndex((e) => e.text.startsWith('The city falls'));
    expect(fell).toBeGreaterThanOrEqual(0);
    expect(d.log.slice(fell).some((e) => e.text.includes(`war with ${b!.name} has begun`))).toBe(false);
  });
});
