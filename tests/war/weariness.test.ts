import { describe, expect, it } from 'vitest';
import { WEARINESS } from '../../src/data/warEconomy';
import { ZONE_R } from '../../src/data/zones';
import { Sim } from '../../src/sim/sim';
import { fightingWith } from '../../src/sim/systems/diplomacy';
import { happinessFactors } from '../../src/sim/systems/happiness';
import { computeTotals } from '../../src/sim/systems/totals';
import { tiredOfWar, warCheer, weariness } from '../../src/sim/systems/weariness';
import { warEconomySummary } from '../../src/sim/systems/warEconomy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';
import { buildTown, newSim, serveTown } from '../helpers';
import { DIPLOMACY } from '../../src/data/diplomacy';
import {
  clone,
  dip,
  eco,
  ofKind,
  ok,
  rate,
  rivals,
  setTreasury,
  toMonthStart,
  treaty,
  warCity,
  why,
} from './economyHelpers';

/**
 * M38 step 6: war weariness. It grows each hour a war is open with the city (faster in a total war and
 * in a war being lost), each raid on the city adds to it, it costs approval and (past half) growth,
 * it falls in peace, and the end of a war that tired the city gives a short recovery. A city with no
 * war is untouched. The war cities here have rival neighbours too weak to raid, and no buildings.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
/** The hours the warning takes before a declared war opens. */
const OPENS = DIPLOMACY.warningHours;

/** The neighbours' forces back to next to nothing: a raid needs a force of one. */
function weaken(sim: Sim): void {
  for (const n of rivals(sim)) n.rival!.forces = 0.5;
}

/** Advance, keeping the neighbours too weak to raid (they arm a little at each month's start), so only the war itself wears on the city. */
function quiet(sim: Sim, ticks: number): void {
  for (let t = 0; t < ticks; t += H) {
    weaken(sim);
    sim.advance(Math.min(H, ticks - t));
  }
}

/** A war city whose neighbours are too weak to raid (see `quiet`). */
function quietCity(): Sim {
  const sim = warCity();
  weaken(sim);
  return sim;
}

/** Declare a war on a neighbour and run past its warning, to the hour it opens. */
function openWar(sim: Sim, id: number, scale: 'war' | 'total' = 'war'): void {
  ok(sim, { type: 'declareWar', neighbour: id, scale, reason: 'Our border' });
  sim.advance(OPENS * H);
  expect(fightingWith(sim, id)).toBeDefined();
}

/** Weariness after `hours` hours of an open war in a quiet city. */
function worn(hours: number, scale: 'war' | 'total' = 'war', score = 0): number {
  const sim = quietCity();
  const foe = rivals(sim)[0]!;
  openWar(sim, foe.id, scale);
  const before = weariness(sim);
  if (score) dip(sim).wars[0]!.score = score;
  quiet(sim, hours * H);
  return weariness(sim) - before;
}

/** A grown, served town at war with weak rivals, with a home to look at. */
function townAtWar(): { sim: Sim; home: () => ReturnType<typeof homeOf> } {
  const sim = newSim({ rivals: true, disasters: false });
  buildTown(sim);
  serveTown(sim);
  sim.advance(2 * M);
  weaken(sim);
  return { sim, home: () => homeOf(sim) };
}

/** The war economy, made if the city has none yet (a test sets weariness without a war). */
const withEconomy = (sim: Sim) => (sim.state.war!.economy ??= { stakes: {}, loans: [], aid: {} });

const homeOf = (sim: Sim) => {
  const b = [...sim.state.buildings.values()].find(
    (x) => x.zone === ZONE_R && x.state === BState.Active && x.pop > 0,
  );
  expect(b, 'a home with people in it').toBeDefined();
  return b!;
};

describe('M38: war weariness grows in a war', () => {
  it('by the hour while a war is open, at the data’s rate, and not before it opens', () => {
    const sim = quietCity();
    const foe = rivals(sim)[0]!;
    ok(sim, { type: 'declareWar', neighbour: foe.id, scale: 'war', reason: 'Our border' });
    // The warning hours (a declared war isn't open yet): nothing wears.
    sim.advance((OPENS - 1) * H);
    expect(weariness(sim)).toBe(0);
    expect(sim.state.war!.economy).toBeUndefined();
    sim.advance(2 * H);
    expect(weariness(sim)).toBeGreaterThan(0);
    // Ten days of war: the data's rate an hour.
    const start = weariness(sim);
    quiet(sim, 10 * M);
    expect(weariness(sim) - start).toBeCloseTo(WEARINESS.perHour * 24 * 10, 3);
    expect(weariness(sim)).toBeGreaterThan(0.1);
    expect(weariness(sim)).toBeLessThan(0.15);
  });

  it('half as fast again in a total war, and again in a war being lost', () => {
    const plain = worn(100);
    expect(plain).toBeCloseTo(WEARINESS.perHour * 100, 3);
    expect(worn(100, 'total')).toBeCloseTo(plain * WEARINESS.total, 3);
    expect(worn(100, 'war', WEARINESS.losingBelow)).toBeCloseTo(plain * WEARINESS.losing, 3);
    // Not losing yet one point above the bar.
    expect(worn(100, 'war', WEARINESS.losingBelow + 1)).toBeCloseTo(plain, 3);
    // Both together.
    expect(worn(100, 'total', -30)).toBeCloseTo(plain * WEARINESS.total * WEARINESS.losing, 3);
  });

  it('never past one', () => {
    const sim = quietCity();
    const foe = rivals(sim)[0]!;
    openWar(sim, foe.id, 'total');
    dip(sim).wars[0]!.score = -40;
    withEconomy(sim).weariness = 0.999;
    sim.advance(10 * H);
    expect(weariness(sim)).toBe(1);
  });

  it('every raid that reaches the city adds to it, a neighbour’s or a friend’s', () => {
    const sim = quietCity();
    expect(weariness(sim)).toBe(0);
    // A neighbour's raid, arriving at once.
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0 });
    expect(sim.state.war!.battle).toBeDefined();
    expect(weariness(sim)).toBe(WEARINESS.perRaid);
    // The battle ends, and with no war open the people mind it less each hour.
    sim.advance(24 * H);
    expect(sim.state.war!.battle).toBeUndefined();
    expect(weariness(sim)).toBeLessThan(WEARINESS.perRaid);
    // The warning of the next doesn't count; its arrival does.
    eco(sim).weariness = 0.1;
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 3 });
    expect(weariness(sim)).toBe(0.1);
    let arrived = false;
    for (let t = 0; t < 4 * H && !arrived; t++) {
      const prev = weariness(sim);
      sim.step();
      // (An empty city's battle is over in the tick it begins: the jump is the arrival.)
      if (weariness(sim) - prev > WEARINESS.perRaid / 2) {
        expect(weariness(sim) - prev).toBeCloseTo(WEARINESS.perRaid, 2);
        arrived = true;
      }
    }
    expect(arrived).toBe(true);
    expect(weariness(sim)).toBeGreaterThan(0.1);
  });

  it('nothing at all without war', () => {
    // A peaceful city has no war state and reads zero everywhere.
    const peace = newSim({ disasters: false });
    buildTown(peace);
    serveTown(peace);
    peace.advance(2 * M);
    expect(peace.state.war).toBeUndefined();
    expect(weariness(peace)).toBe(0);
    expect(warCheer(peace)).toBe(0);
    expect(tiredOfWar(peace)).toBe(0);
    expect(happinessFactors(peace, homeOf(peace)).some((f) => f.label === 'Tired of war')).toBe(false);
    // A war city that never fights makes no war economy for it either, whatever the months.
    const calm = quietCity();
    calm.advance(5 * M);
    expect(calm.state.war!.economy).toBeUndefined();
    expect(weariness(calm)).toBe(0);
    expect(warCheer(calm)).toBe(0);
    expect(warEconomySummary(calm)!.weariness).toEqual({
      value: 0,
      cheer: 0,
      recovery: null,
      growth: 0,
      perDay: 0,
    });
  });
});

describe('M38: war weariness costs approval and growth', () => {
  it('approval falls in proportion, up to the data’s figure', () => {
    const { sim } = townAtWar();
    const base = computeTotals(sim).approval;
    expect(base).toBeGreaterThan(0.2);
    expect(base).toBeLessThan(0.8);
    for (const w of [0.2, 0.4, 1]) {
      withEconomy(sim).weariness = w;
      expect(warCheer(sim)).toBeCloseTo(WEARINESS.approval * w, 5);
      expect(computeTotals(sim).approval).toBeCloseTo(base + WEARINESS.approval * w, 3);
    }
    expect(WEARINESS.approval).toBe(-0.12);
  });

  it('a long war leaves a town less pleased than the same town at peace', () => {
    const { sim } = townAtWar();
    const control = clone(sim);
    const foe = rivals(sim)[0]!;
    openWar(sim, foe.id);
    dip(sim).wars[0]!.score = WEARINESS.losingBelow - 15;
    quiet(sim, 20 * M);
    control.advance(sim.state.tick - control.state.tick);
    const w = weariness(sim);
    // Twenty days of a war being lost: weary, but below the bar where it touches the homes' moods.
    expect(w).toBeGreaterThan(0.3);
    expect(w).toBeLessThan(WEARINESS.growthFrom);
    // The approval the hourly totals keep: the control's less the weariness's cost, near enough.
    const gap = control.state.totals.approval - sim.state.totals.approval;
    const cost = -WEARINESS.approval * w;
    expect(gap).toBeGreaterThan(0.6 * cost);
    expect(gap).toBeLessThan(1.4 * cost);
  });

  it('homes grow less happy only past half weariness, by up to the data’s figure', () => {
    const { sim, home } = townAtWar();
    const tired = () => happinessFactors(sim, home()).find((f) => f.label === 'Tired of war');
    withEconomy(sim).weariness = WEARINESS.growthFrom;
    expect(tired()).toBeUndefined();
    withEconomy(sim).weariness = 0.75;
    expect(tired()!.value).toBeCloseTo(WEARINESS.growth / 2, 3);
    withEconomy(sim).weariness = 1;
    expect(tired()!.value).toBe(WEARINESS.growth);
    // Businesses are not homes: the factor is for the people.
    const shop = [...sim.state.buildings.values()].find(
      (b) => b.zone !== ZONE_R && b.state === BState.Active,
    )!;
    expect(happinessFactors(sim, shop).some((f) => f.label === 'Tired of war')).toBe(false);
    // And it moves the home's happiness by that much.
    const b = home();
    withEconomy(sim).weariness = 0.5;
    const lower = (): number => happinessFactors(sim, b).reduce((a, f) => a + f.value, 0);
    const before = lower();
    withEconomy(sim).weariness = 1;
    expect(lower() - before).toBeCloseTo(WEARINESS.growth, 3);
  });
});

describe('M38: peace brings recovery', () => {
  /** A city worn down by a long war with `foe` (weariness near a half), still at war. */
  function weary() {
    const sim = quietCity();
    const foe = rivals(sim)[0]!;
    openWar(sim, foe.id);
    withEconomy(sim).weariness = 0.5;
    return { sim, foe };
  }

  it('falls in a ceasefire, which is no end to the war; it grows again when the fighting does', () => {
    const { sim, foe } = weary();
    sim.advance(5 * H);
    const fighting = weariness(sim);
    expect(fighting).toBeGreaterThan(0.5);
    treaty(sim, foe.id, [{ k: 'ceasefire', hours: 100 }]);
    expect(fightingWith(sim, foe.id)).toBeUndefined();
    sim.advance(10 * H);
    expect(weariness(sim)).toBeCloseTo(fighting - 10 * WEARINESS.fallPerHour, 4);
    // No recovery's cheer: the war is not over.
    expect(sim.state.war!.economy!.recoveryUntil).toBeUndefined();
    quiet(sim, 100 * H);
    expect(fightingWith(sim, foe.id)).toBeDefined();
    const low = weariness(sim);
    sim.advance(10 * H);
    expect(weariness(sim)).toBeGreaterThan(low);
  });

  it('a peace treaty starts ten days of cheer that ease away while weariness wears off', () => {
    const { sim, foe } = weary();
    sim.advance(4 * H);
    const w0 = weariness(sim);
    sim.events = [];
    treaty(sim, foe.id, [{ k: 'peace' }]);
    const tick = sim.state.tick;
    const e = eco(sim);
    expect(e.recoveryUntil).toBe(tick + WEARINESS.recovery.days * M);
    expect(sim.events.filter((x) => x.kind === 'diplomacy' && x.info?.what === 'recovery')).toHaveLength(1);
    // Straight away: the cost of weariness less the cheer of the relief.
    expect(warCheer(sim)).toBeCloseTo(w0 * WEARINESS.approval + WEARINESS.recovery.cheer, 4);
    // Halfway the relief is half as big, and the weariness (falling) costs less.
    quiet(sim, (WEARINESS.recovery.days * M) / 2);
    expect(warCheer(sim)).toBeCloseTo(weariness(sim) * WEARINESS.approval + WEARINESS.recovery.cheer / 2, 4);
    expect(weariness(sim)).toBeLessThan(w0);
    expect(summaryRecovery(sim)).toBeCloseTo(WEARINESS.recovery.cheer / 2, 3);
    // After ten days: the relief is spent, and so is the weariness (a day's fall is 0.036).
    quiet(sim, (WEARINESS.recovery.days * M) / 2);
    expect(warCheer(sim)).toBeCloseTo(weariness(sim) * WEARINESS.approval, 6);
    expect(weariness(sim)).toBeLessThan(w0 - 0.2);
    quiet(sim, 10 * M);
    expect(weariness(sim)).toBe(0);
    expect(warCheer(sim)).toBe(0);
    expect(sim.state.war!.economy!.weariness).toBeUndefined();
  });

  it('the end of a war by conquest starts it too, but a war that hardly tired the city gives none', () => {
    const won = weary();
    won.sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    // The city holds the neighbour's seat of power until it falls.
    const war = dip(won.sim).wars[0]!;
    war.hold = { by: 'us', since: won.sim.state.tick - DIPLOMACY.conquestHours * H };
    won.sim.advance(2 * H);
    expect(dip(won.sim).wars).toHaveLength(0);
    expect(won.foe.rival!.vassal).toBeDefined();
    expect(eco(won.sim).recoveryUntil).toBeGreaterThan(won.sim.state.tick);
    // A skirmish of a day: peace and nothing to recover from.
    const sim = quietCity();
    const foe = rivals(sim)[0]!;
    openWar(sim, foe.id);
    sim.advance(24 * H);
    expect(weariness(sim)).toBeLessThan(WEARINESS.recovery.minimum);
    treaty(sim, foe.id, [{ k: 'peace' }]);
    expect(eco(sim).recoveryUntil).toBeUndefined();
    expect(sim.events.filter((x) => x.kind === 'diplomacy' && x.info?.what === 'recovery')).toHaveLength(0);
  });

  it('is no peace while another war goes on, and a new fight ends the relief', () => {
    const { sim, foe } = weary();
    const other = rivals(sim)[1]!;
    ok(sim, { type: 'declareWar', neighbour: other.id, scale: 'war', reason: 'And yours' });
    sim.advance(OPENS * H);
    treaty(sim, foe.id, [{ k: 'peace' }]);
    expect(fightingWith(sim, other.id)).toBeDefined();
    expect(eco(sim).recoveryUntil).toBeUndefined();
    // Peace with the second too: the relief begins; a raid in the middle of it ends it.
    withEconomy(sim).weariness = 0.4;
    treaty(sim, other.id, [{ k: 'peace' }]);
    expect(eco(sim).recoveryUntil).toBeDefined();
    ok(sim, { type: 'cheat', cheat: 'raidIn', hours: 0 });
    expect(eco(sim).recoveryUntil).toBeUndefined();
  });

  it('thaws stakes and loans and lifts the sanctions of the war, as peace always did', () => {
    const sim = quietCity();
    setTreasury(sim, 5_000_000);
    const e = ofKind(sim, 'suburb');
    const n = ofKind(sim, 'industrial');
    n.rival!.personality = 'mercantile';
    n.rival!.allies = [e.id];
    e.rival!.allies = [n.id];
    treaty(sim, n.id, [{ k: 'alliance' }]);
    ok(sim, { type: 'buyStake', neighbour: e.id, share: 10 });
    ok(sim, { type: 'buyStake', neighbour: n.id, share: 10 });
    ok(sim, { type: 'lendAlly', neighbour: n.id, amount: 50_000 });
    sim.advance(2 * H);
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);
    expect(rate(sim, 'allyInterest')).toBeGreaterThan(0);
    // The war on E: its stake freezes; N, E's ally, sanctions the city, and its stake and loan freeze.
    openWar(sim, e.id);
    sim.advance(H);
    toMonthStart(sim);
    expect(eco(sim).sanctionedBy![n.id]).toMatchObject({ cause: 'ally' });
    expect(rate(sim, 'dividends')).toBe(0);
    expect(rate(sim, 'allyInterest')).toBe(0);
    expect(why(sim, { type: 'sellStake', neighbour: e.id })).toMatch(/fighting/);
    expect(why(sim, { type: 'sellStake', neighbour: n.id })).toMatch(/Sanctions/);
    const owed = eco(sim).loans[0]!.balance;
    sim.advance(3 * H);
    expect(eco(sim).loans[0]!.balance).toBe(owed);
    // Peace: the stakes pay and can be sold again, the loan is repaid again, and the day's pass
    // lifts N's sanction.
    treaty(sim, e.id, [{ k: 'peace' }]);
    expect(rate(sim, 'dividends')).toBeGreaterThan(0);
    expect(why(sim, { type: 'sellStake', neighbour: e.id })).toBeNull();
    toMonthStart(sim);
    expect(eco(sim).sanctionedBy?.[n.id]).toBeUndefined();
    expect(rate(sim, 'allyInterest')).toBeGreaterThan(0);
    sim.advance(3 * H);
    expect(eco(sim).loans[0]!.balance).toBeLessThan(owed);
    expect(why(sim, { type: 'sellStake', neighbour: n.id })).toBeNull();
  });
});

describe('M38: weariness is part of the saved game', () => {
  it('saves, loads and plays on exactly as the city it was saved from', () => {
    const sim = quietCity();
    openWar(sim, rivals(sim)[0]!.id, 'total');
    quiet(sim, 8 * M);
    const w = weariness(sim);
    expect(w).toBeGreaterThan(0.1);
    const copy = clone(sim);
    expect(weariness(copy)).toBe(w);
    expect(copy.hash()).toBe(sim.hash());
    quiet(sim, 2 * M);
    quiet(copy, 2 * M);
    expect(copy.hash()).toBe(sim.hash());
    expect(weariness(copy)).toBe(weariness(sim));
    expect(Sim.fromSave(sim.save('2026-10-29')).state.war!.economy!.weariness).toBe(weariness(sim));
  });
});

/** The recovery's cheer the war summary reports (0 when none). */
function summaryRecovery(sim: Sim): number {
  return warEconomySummary(sim)!.weariness.recovery?.cheer ?? 0;
}
