import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { annuity } from '../src/sim/systems/economy';
import { SAVE_VERSION } from '../src/sim/save';
import { buildTown, connectPoint, newSim, road, serveTown } from './helpers';

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe('ledger', () => {
  it('accounts for every dollar: each month income − expenses = change in treasury, exactly', () => {
    const sim = newSim(); // testMode also checks the balance every tick
    const start = sim.state.treasury;
    buildTown(sim);
    sim.dispatch({ type: 'takeLoan', amount: 25_000 });
    sim.advance(TICKS_PER_MONTH * 12);
    const e = sim.state.economy;
    expect(e.history.length).toBe(12);
    let prev = start;
    for (const h of e.history) {
      expect(h.treasury - prev).toBe(sum(h.lines));
      prev = h.treasury;
    }
    expect(sim.state.treasury - prev).toBe(sum(e.month));
    // Taxes actually flowed in.
    const taxes = e.history
      .flatMap((h) => Object.entries(h.lines))
      .filter(([k]) => k.startsWith('tax'))
      .reduce((a, [, v]) => a + v, 0);
    expect(taxes).toBeGreaterThan(1000);
    const upkeep = e.history.reduce((a, h) => a + (h.lines.roadUpkeep ?? 0), 0);
    expect(upkeep).toBeLessThan(0);
  });

  it('budget projection matches the rates the city is paying', () => {
    const sim = newSim();
    buildTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    const b = sim.budget();
    expect(Object.keys(b.projection).some((k) => k.startsWith('taxR'))).toBe(true);
    expect(b.projection.roadUpkeep).toBeLessThan(0);
    // Each projected line is rounded separately, so allow one dollar per line.
    expect(Math.abs(sim.stats().netMonthly - sum(b.projection))).toBeLessThanOrEqual(
      Object.keys(b.projection).length,
    );
  });
});

describe('taxes', () => {
  it('high residential taxes cut demand and growth; low taxes help', () => {
    const run = (rate: number) => {
      const sim = newSim();
      buildTown(sim);
      serveTown(sim);
      sim.dispatch({ type: 'setTax', zone: 'R', wealth: 'all', rate });
      sim.advance(TICKS_PER_MONTH * 2);
      return {
        pop: sim.state.totals.population,
        demand: sim.state.demand.R,
        approval: sim.state.totals.approval,
        factor: sim.state.demand.factors.R.find((f) => /tax/i.test(f.label))?.value ?? 0,
      };
    };
    const low = run(5);
    const mid = run(9);
    const high = run(20);
    expect(high.factor).toBeLessThan(-0.3);
    expect(low.factor).toBeGreaterThan(0.1);
    expect(high.demand).toBeLessThan(mid.demand);
    expect(high.pop).toBeLessThan(mid.pop);
    expect(high.approval).toBeLessThan(mid.approval);
    // Low taxes pull people in faster, which uses up the job surplus that also drives demand,
    // so compare the tax term of demand and the growth it causes rather than the total.
    expect(low.factor).toBeGreaterThan(mid.factor);
    expect(low.pop).toBeGreaterThan(mid.pop);
    expect(low.approval).toBeGreaterThan(mid.approval);
  });

  it('higher taxes raise more money per resident', () => {
    const income = (rate: number) => {
      const sim = newSim();
      buildTown(sim);
      sim.advance(TICKS_PER_MONTH);
      sim.dispatch({ type: 'setTax', zone: 'R', wealth: 'all', rate });
      const b = sim.budget();
      const r = Object.entries(b.projection)
        .filter(([k]) => k.startsWith('taxR'))
        .reduce((a, [, v]) => a + v, 0);
      return r / Math.max(1, sim.state.totals.population);
    };
    expect(income(15)).toBeGreaterThan(income(9) * 1.5);
  });
});

describe('funding', () => {
  it('road maintenance funding scales its cost', () => {
    const sim = newSim();
    buildTown(sim, { zone: false });
    const full = sim.budget().projection.roadUpkeep!;
    sim.dispatch({ type: 'setFunding', dept: 'roads', pct: 50 });
    const half = sim.budget().projection.roadUpkeep!;
    expect(half).toBeCloseTo(full / 2, -1);
    expect(sim.dispatch({ type: 'setFunding', dept: 'roads', pct: 400 }).ok).toBe(true);
    expect(sim.state.economy.funding.roads).toBe(150);
  });
});

describe('loans', () => {
  it('a loan pays out, amortises with interest, and ends', () => {
    const sim = newSim({ sandbox: false });
    const t0 = sim.state.treasury;
    expect(sim.dispatch({ type: 'takeLoan', amount: 50_000 }).ok).toBe(true);
    expect(sim.state.treasury).toBe(t0 + 50_000);
    const loan = sim.state.economy.loans[0]!;
    expect(loan.payment).toBeCloseTo(annuity(50_000, 0.06, 60), 6);
    sim.advance(TICKS_PER_MONTH * 12);
    expect(sim.state.economy.loans[0]!.balance).toBeLessThan(50_000 * 0.85);
    expect(sim.dispatch({ type: 'repayLoan', id: loan.id }).ok).toBe(true);
    expect(sim.state.economy.loans.length).toBe(0);
    const paid =
      sim.state.economy.history.reduce(
        (a, h) => a + (h.lines.loanInterest ?? 0) + (h.lines.loanPrincipal ?? 0),
        0,
      ) +
      (sim.state.economy.month.loanInterest ?? 0) +
      (sim.state.economy.month.loanPrincipal ?? 0);
    expect(-paid).toBeGreaterThan(50_000);
    expect(-paid).toBeLessThan(50_000 * 1.1);
  });

  it('limits the number of loans', () => {
    const sim = newSim();
    for (let i = 0; i < 3; i++) expect(sim.dispatch({ type: 'takeLoan', amount: 25_000 }).ok).toBe(true);
    expect(sim.dispatch({ type: 'takeLoan', amount: 25_000 }).ok).toBe(false);
  });
});

describe('bankruptcy', () => {
  it('a city that spends everything on roads it cannot afford goes bankrupt after the grace period', () => {
    const sim = newSim({ difficulty: 'hard' });
    const c = connectPoint(sim);
    road(sim, [c, { x: c.x + 60, z: c.z }], 'street');
    // Build avenues until the money is nearly gone (sized by preview, since earthworks vary).
    for (let k = 0; k < 20 && sim.state.treasury > 2000; k++) {
      const z = c.z - 300 + k * 40;
      let len = Math.min(700, sim.state.treasury / 26 - 20);
      for (let tries = 0; tries < 8 && len > 40; tries++) {
        const cmd = {
          type: 'buildRoad' as const,
          road: 'avenue' as const,
          points: [
            { x: c.x + 60, z },
            { x: c.x + 60 + len, z },
          ],
        };
        const p = sim.preview(cmd);
        if (p.ok) {
          sim.dispatch(cmd);
          break;
        }
        if (p.reason !== 'Not enough money') break;
        len *= 0.85;
      }
    }
    expect(sim.state.treasury).toBeLessThan(6000);
    let warned = false;
    for (let h = 0; h < 24 * 30 && !sim.state.economy.bankrupt; h++) {
      sim.advance(60);
      if (sim.state.economy.negativeHours > 0) warned = true;
    }
    expect(warned).toBe(true);
    expect(sim.state.economy.bankrupt).toBe(true);
    expect(
      sim.dispatch({ type: 'buildRoad', road: 'street', points: [c, { x: c.x + 50, z: c.z + 50 }] }).ok,
    ).toBe(false);
  });

  it('sandbox cities never go bankrupt', () => {
    const sim = newSim({ sandbox: true });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: -sim.state.treasury - 1_000_000 });
    sim.advance(TICKS_PER_MONTH * 3);
    expect(sim.state.economy.bankrupt).toBe(false);
  });
});

describe('save migrations', () => {
  it('loads a version 1 save (before the economy existed)', () => {
    const sim = Sim.create({ seed: 'migrate' });
    buildTown(sim);
    sim.advance(500);
    const save = JSON.parse(JSON.stringify(sim.save())) as {
      version: number;
      state: Record<string, unknown>;
    };
    delete save.state.economy;
    save.version = 1;
    const loaded = Sim.fromSave(save as never);
    loaded.testMode = true;
    expect(loaded.state.economy.taxes.R).toEqual([9, 9, 9]);
    expect(loaded.state.version).toBe(SAVE_VERSION);
    expect(loaded.state.civics.size).toBe(0);
    loaded.advance(TICKS_PER_MONTH);
    expect(loaded.state.economy.history.length).toBeGreaterThan(0);
  });
});
