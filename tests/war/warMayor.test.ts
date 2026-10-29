import { describe, expect, it } from 'vitest';
import { RAIDS, SKIRMISH } from '../../src/data/battle';
import { CIVIC } from '../../src/data/civic';
import { INVEST } from '../../src/data/warEconomy';
import { Player } from '../../src/sim/ai/mayor';
import { objectiveSpots } from '../../src/sim/battle/layout';
import { DMath } from '../../src/sim/dmath';
import { Sim } from '../../src/sim/sim';
import { cityStrength } from '../../src/sim/systems/raids';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, connectPoint, newSim, road } from '../helpers';
import { dip, eco, ofKind, ok, rivals, setTreasury, stockUp, treaty, warCity } from './economyHelpers';

/**
 * M38 step 9: the balance mayor at war. The careful mayor builds a military HQ and barracks once
 * raids threaten, trains a force and raises defences against the biggest raid a neighbour could
 * mount, answers proposals and offers by a few plain rules, and puts a surplus into stakes. The
 * rules are tried one at a time on a small city; the last test plays a few years of a real one.
 * (With rivals off the mayor is untouched: balance runs without --rivals print what they always did.)
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A careful mayor over a war city with a street or two, the books showing taxes and spending. */
function mayor(taxes = 50_000, spending = 20_000): { p: Player; sim: Sim } {
  const sim = warCity();
  buildTown(sim, { zone: false });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.state.economy.history.push({
    month: 0,
    lines: { taxR1: taxes, roads: -spending },
    treasury: sim.state.treasury,
  });
  return { p: new Player('careful', sim), sim };
}

/** One round of the war plan with the city counted as `pop` residents (the empty test city has none). */
const go = (p: Player, sim: Sim, pop = 3_000) => {
  sim.state.totals.population = pop;
  // (The books of a city with no buildings close empty: show last month's taxes as the mayor reads them.)
  const last = sim.state.economy.history.at(-1)!;
  if (!Object.keys(last.lines).some((k) => k.startsWith('tax'))) last.lines.taxR1 = 50_000;
  p.warPlan.play();
};

const declare = (sim: Sim, id: number) => {
  ok(sim, { type: 'declareWar', neighbour: id, scale: 'war', reason: 'Our border' });
  sim.advance(13 * H);
};
const propose = (sim: Sim, id: number, terms: Parameters<typeof treaty>[2]) => {
  ok(sim, { type: 'cheat', cheat: 'proposal', neighbour: id, terms });
  return dip(sim).proposals.find((p) => p.from === 'them' && p.with === id)!;
};

describe('M38: the careful mayor answers proposals', () => {
  it('signs peace or a ceasefire when the war is going against it or it is weary, or the neighbour pays', () => {
    const cases: [string, number, number, boolean, boolean][] = [
      // [name, score, weariness, neighbour pays, signed]
      ['winning and fresh', 20, 0, false, false],
      ['losing', -10, 0, false, true],
      ['winning but weary', 20, 0.5, false, true],
      ['winning, and the neighbour pays', 20, 0, true, true],
    ];
    for (const [name, score, weary, pays, signed] of cases) {
      const { p, sim } = mayor();
      const foe = rivals(sim)[0]!;
      declare(sim, foe.id);
      dip(sim).wars[0]!.score = score;
      if (weary) (sim.state.war!.economy ??= { stakes: {}, loans: [], aid: {} }).weariness = weary;
      const terms = pays
        ? [{ k: 'peace' as const }, { k: 'reparations' as const, payer: 'them' as const, amount: 5_000 }]
        : [{ k: 'peace' as const }];
      propose(sim, foe.id, terms);
      p.warPlan.play();
      expect(dip(sim).wars.length === 0, name).toBe(signed);
      expect(dip(sim).proposals.length, name).toBe(0);
    }
  });

  it('refuses what it can’t afford or mustn’t sign: heavy tribute, a demilitarised side, an embargo', () => {
    const { p, sim } = mayor(50_000);
    const foe = rivals(sim)[0]!;
    declare(sim, foe.id);
    dip(sim).wars[0]!.score = -30;
    // A tribute of $20,000 a month is over an eighth of taxes of $50,000: no. $4,000 is: yes.
    ok(sim, {
      type: 'cheat',
      cheat: 'proposal',
      neighbour: foe.id,
      terms: [{ k: 'peace' }, { k: 'tribute', payer: 'us', amount: 20_000, months: 24 }],
    });
    p.warPlan.play();
    expect(dip(sim).wars).toHaveLength(1);
    expect(dip(sim).pacts.some((x) => x.term.k === 'tribute')).toBe(false);
    ok(sim, {
      type: 'cheat',
      cheat: 'proposal',
      neighbour: foe.id,
      terms: [{ k: 'peace' }, { k: 'tribute', payer: 'us', amount: 4_000, months: 12 }],
    });
    p.warPlan.play();
    expect(dip(sim).wars).toHaveLength(0);
    expect(dip(sim).pacts.some((x) => x.term.k === 'tribute')).toBe(true);
    // Not a demilitarised side, an embargo or an alliance, however it is dressed.
    const other = rivals(sim)[1]!;
    for (const term of [{ k: 'dmz', side: 'us', months: 12 }, { k: 'embargo' }, { k: 'alliance' }] as const) {
      propose(sim, other.id, [term]);
      p.warPlan.play();
      expect(
        dip(sim).pacts.some((x) => x.with === other.id && x.term.k === term.k),
        term.k,
      ).toBe(false);
      expect(dip(sim).proposals.length).toBe(0);
    }
    // A pact of non-aggression is fine.
    propose(sim, other.id, [{ k: 'nonAggression', months: 12 }]);
    p.warPlan.play();
    expect(dip(sim).pacts.some((x) => x.with === other.id && x.term.k === 'nonAggression')).toBe(true);
  });

  it('sues for peace in a war going badly, then adds a little tribute', () => {
    const { p, sim } = mayor();
    const foe = rivals(sim)[0]!;
    declare(sim, foe.id);
    dip(sim).wars[0]!.score = -40;
    p.warPlan.play();
    const first = dip(sim).proposals.find((x) => x.from === 'us');
    expect(first?.terms).toEqual([{ k: 'peace' }]);
  });
});

describe('M38: the careful mayor answers offers', () => {
  it('takes an ally’s arms offer only when the stores hold the crates', () => {
    for (const [stock, taken] of [
      [1_000, true],
      [10, false],
    ] as const) {
      const { p, sim } = mayor();
      const n = ofKind(sim, 'industrial');
      n.population = 20_000;
      n.rival!.personality = 'aggressive';
      treaty(sim, n.id, [{ k: 'alliance' }]);
      stockUp(sim, 1_000);
      ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'arms' });
      stockUp(sim, stock);
      p.warPlan.play();
      expect(!!eco(sim).arms?.[n.id], `${stock} crates`).toBe(taken);
      expect(eco(sim).offers ?? [], `${stock} crates`).toHaveLength(0);
    }
  });

  it('takes a loan when short of cash, an investment only when the bank is overdrawn', () => {
    for (const kind of ['loan', 'invest'] as const) {
      for (const short of [true, false]) {
        const { p, sim } = mayor();
        const n = ofKind(sim, 'industrial');
        n.rival!.personality = 'mercantile';
        n.population = 20_000;
        sim.state.economy.history.push({
          month: 0,
          lines: { taxI1: 6_000, taxR1: 20_000, roads: -20_000 },
          treasury: 0,
        });
        setTreasury(sim, 5_000);
        ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: kind });
        // (An investment sells a share of the industrial taxes for two years: short is not enough.)
        const short5 = kind === 'invest' ? -1_000 : 5_000;
        setTreasury(sim, short ? short5 : 1_000_000);
        p.warPlan.play();
        const took = kind === 'loan' ? !!eco(sim).debts?.length : !!eco(sim).investors?.length;
        expect(took, `${kind}, ${short ? 'short' : 'flush'}`).toBe(short);
        expect(eco(sim).offers ?? []).toHaveLength(0);
      }
    }
  });
});

describe('M38: the careful mayor does not borrow more than it can carry', () => {
  it('takes loans while their instalments stay within a fifth of its taxes, and one investor at a time', () => {
    const { p, sim } = mayor();
    sim.state.economy.history.push({
      month: 0,
      lines: { taxI1: 6_000, taxR1: 50_000, roads: -20_000 },
      treasury: 0,
    });
    const towns = rivals(sim);
    for (const n of towns) {
      n.rival!.personality = 'mercantile';
      n.population = 20_000;
    }
    setTreasury(sim, 5_000);
    const taken: boolean[] = [];
    for (const n of towns) {
      setTreasury(sim, 5_000);
      ok(sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'loan' });
      go(p, sim, 0);
      taken.push(!!eco(sim).debts?.some((d) => d.from === n.id));
    }
    // $56,000 of taxes: instalments of $11,200 at most; each $100,000 loan (the gap to three months of
    // spending) is about $4,500 a month.
    expect(taken).toEqual([true, true, false]);
    // An investment only with the bank overdrawn, and one investor at a time.
    const sim2 = mayor();
    sim2.sim.state.economy.history.push({ month: 0, lines: { taxI1: 6_000, taxR1: 20_000 }, treasury: 0 });
    const [a, b] = rivals(sim2.sim);
    for (const n of [a!, b!]) {
      n.rival!.personality = 'mercantile';
      n.population = 20_000;
    }
    ok(sim2.sim, { type: 'cheat', cheat: 'offer', neighbour: a!.id, offer: 'invest' });
    setTreasury(sim2.sim, 5_000);
    go(sim2.p, sim2.sim, 0);
    expect(eco(sim2.sim).investors).toBeUndefined();
    for (const n of [a!, b!]) {
      if (!eco(sim2.sim).offers?.some((o) => o.from === n.id))
        ok(sim2.sim, { type: 'cheat', cheat: 'offer', neighbour: n.id, offer: 'invest' });
      setTreasury(sim2.sim, -1_000);
      go(sim2.p, sim2.sim, 0);
    }
    expect(eco(sim2.sim).investors).toHaveLength(1);
  });
});

describe('M38: the careful mayor invests a surplus', () => {
  it('buys stakes in friendly neighbours once the bank holds two years of spending, up to the most', () => {
    const { p, sim } = mayor(50_000, 20_000);
    const [a, b, c] = rivals(sim);
    a!.rival!.relation = 60;
    b!.rival!.relation = 25;
    c!.rival!.relation = 10; // not friendly enough
    setTreasury(sim, 400_000); // under 24 × $20,000
    p.warPlan.play();
    expect(sim.state.war!.economy?.stakes ?? {}).toEqual({});
    setTreasury(sim, 50_000_000);
    for (let month = 0; month < 6; month++) {
      p.warPlan.play();
      sim.advance(M);
      setTreasury(sim, 50_000_000);
    }
    const stakes = eco(sim).stakes;
    expect(stakes[a!.id]?.share).toBe(INVEST.maxShare);
    expect(stakes[b!.id]?.share).toBe(INVEST.maxShare);
    expect(stakes[c!.id]).toBeUndefined();
    // Not in a neighbour it is at war with.
    const { p: q, sim: war } = mayor(50_000, 20_000);
    const foe = rivals(war)[0]!;
    declare(war, foe.id);
    setTreasury(war, 50_000_000);
    q.warPlan.play();
    expect(war.state.war!.economy?.stakes[foe.id]).toBeUndefined();
    expect(Object.keys(war.state.war!.economy?.stakes ?? {}).length).toBeGreaterThan(0);
  });
});

describe('M38: the careful mayor arms', () => {
  it('builds an HQ and a barracks once raids threaten, then trains a force and raises defences to meet the biggest raid', () => {
    const { p, sim } = mayor();
    // Under the bar nothing happens.
    setTreasury(sim, 2_000_000);
    go(p, sim, 2_000);
    expect(p.count('militaryhq')).toBe(0);
    go(p, sim);
    expect(p.count('militaryhq')).toBe(1);
    expect(p.count('barracks')).toBe(0);
    sim.advance(3 * M);
    go(p, sim);
    expect(p.count('barracks')).toBe(1);
    // A force: trained in the barracks, two squads at a time.
    sim.advance(3 * M);
    for (let k = 0; k < 4; k++) {
      go(p, sim);
      sim.advance(H);
    }
    expect(sim.state.war!.orders.size + sim.state.war!.units.size).toBeGreaterThan(0);
    expect(sim.state.war!.orders.size).toBeLessThanOrEqual(2);
    // Sized to the biggest raid: the strongest neighbour's share of its forces.
    const threat = Math.max(...rivals(sim).map((n) => n.rival!.forces * RAIDS.share));
    expect(threat).toBeGreaterThan(0);
    // Bunkers beside the HQ once the barracks is busy (a month apart).
    for (let month = 0; month < 6; month++) {
      sim.advance(M);
      for (let k = 0; k < 3; k++) go(p, sim);
    }
    expect(p.count('bunker')).toBeGreaterThan(0);
    // A city that cannot afford it builds nothing more: the military may cost an eighth of taxes.
    const before = p.count('bunker') + p.count('barracks');
    sim.state.economy.history.push({ month: 1, lines: { taxR1: 1_000 }, treasury: 0 });
    for (let month = 0; month < 3; month++) {
      sim.advance(M);
      go(p, sim);
    }
    expect(p.count('bunker') + p.count('barracks')).toBe(before);
    expect(cityStrength(sim)).toBeGreaterThanOrEqual(0);
  });

  it('keeps defence funding sensible: full, more in a war when flush, less when short', () => {
    const { p, sim } = mayor(50_000, 20_000);
    const funding = () => Math.round(sim.state.economy.funding.defence ?? 100);
    setTreasury(sim, 100_000); // between 3 and 12 months of spending
    p.warPlan.play();
    expect(funding()).toBe(100);
    sim.advance(M);
    setTreasury(sim, 10_000);
    p.warPlan.play();
    expect(funding()).toBe(80);
    sim.advance(M);
    declare(sim, rivals(sim)[0]!.id);
    setTreasury(sim, 1_000_000);
    p.warPlan.play();
    expect(funding()).toBe(120);
  });
});

describe('M38: the careful mayor keeps its power out of the raiders’ reach', () => {
  it('puts new power plants beyond the border zone when a road there has room, and anywhere else when none has', () => {
    const near = (sim: Sim) => objectiveSpots(sim, 'power').length;
    // Only the town's own roads (all inside the zone): the plant goes up all the same, never leaving the city dark.
    const { p, sim } = mayor();
    go(p, sim, 0);
    expect(p.awayFromEntry).toBeGreaterThan(SKIRMISH.border);
    expect(p.place('wind', 'industry')).toBe(true);
    expect(near(sim)).toBe(1);
    // An avenue out beyond the zone: the next plant goes there, and raids have nothing of the kind to go for.
    const c = connectPoint(sim);
    let joined = false;
    for (const [dx, dz] of [
      [900, 0],
      [900, 150],
      [900, -150],
      [900, 300],
      [900, -300],
      [1_200, 0],
      [-900, 0],
    ] as const) {
      const pts = [
        { x: c.x + (dx < 0 ? 0 : 480), z: c.z },
        { x: c.x + dx, z: c.z + dz },
      ];
      if (!sim.preview({ type: 'buildRoad', road: 'avenue', points: pts }).ok) continue;
      road(sim, pts, 'avenue');
      joined = true;
      break;
    }
    expect(joined).toBe(true);
    expect(p.place('wind', 'industry')).toBe(true);
    expect(near(sim)).toBe(1);
    const plants = [...sim.state.civics.values()].filter((x) => CIVIC.get(x.def)?.category === 'power');
    expect(plants).toHaveLength(2);
    expect(Math.max(...plants.map((x) => DMath.hypot(x.x - c.x, x.z - c.z)))).toBeGreaterThan(
      SKIRMISH.border,
    );
    // In peace the mayor places as it always did: no distance asked.
    const peace = new Player('careful', newSim({ disasters: false }));
    buildTown(peace.sim, { zone: false });
    expect(peace.awayFromEntry).toBe(0);
  });
});

describe('M38: the careful mayor over a few years at war', () => {
  it('arms, survives the raids and keeps a growing city', { timeout: 300_000 }, () => {
    const p = new Player('careful', { seed: 'balance', difficulty: 'normal', rivals: true });
    const months = 36;
    let pop12 = 0;
    for (let m = 0; m < months; m++) {
      if (m === 12) pop12 = p.sim.state.totals.population;
      for (let h = 0; h < 4; h++) {
        p.play();
        p.sim.advance(H * 6);
      }
    }
    const s = p.sim.state;
    expect(s.war).toBeDefined();
    expect(s.economy.bankrupt).toBeFalsy();
    // (The war slows a careful city's first years: peace has 10,000 at three years, this about half.)
    expect(s.totals.population).toBeGreaterThan(3_500);
    expect(s.totals.population).toBeGreaterThan(pop12 * 1.5);
    // Armed: a seat for the forces, a barracks, units and defences against what could come.
    expect(p.count('militaryhq')).toBe(1);
    expect(p.count('barracks')).toBeGreaterThanOrEqual(1);
    expect(s.war!.units.size + s.war!.orders.size).toBeGreaterThan(0);
    expect(cityStrength(p.sim)).toBeGreaterThan(0);
    // It saw the war: raids came, were counted, and the city came through.
    const t = p.warPlan.tally;
    expect(t.raids).toBeGreaterThan(0);
    expect(s.totals.approval).toBeGreaterThan(0.3);
    // The ledger has the military's cost.
    expect(t.military).toBeGreaterThan(0);
    expect(t.spending).toBeGreaterThan(t.military);
  });

  it('plays a city with rivals off exactly as before: no war state, no war plan work', () => {
    const p = new Player('careful', { seed: 'balance', difficulty: 'normal' });
    for (let h = 0; h < 12; h++) {
      p.play();
      p.sim.advance(H * 6);
    }
    expect(p.sim.state.war).toBeUndefined();
    expect(p.warPlan.tally.raids).toBe(0);
    expect(p.sample().war).toBeUndefined();
    expect(p.log.some((l) => /militaryhq|barracks|infantry|stake/.test(l))).toBe(false);
  });
});
