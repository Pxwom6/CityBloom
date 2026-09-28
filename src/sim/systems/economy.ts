import { specialisationIncome } from './specialisations';
import { POLICY, policyCost, type PolicyId } from '../../data/policies';
import { ROAD_TYPES } from '../../data/roads';
import { TRAM } from '../../data/balance';
import {
  BANKRUPTCY,
  DEPTS,
  LEDGER_HISTORY_MONTHS,
  LOAN_OPTIONS,
  MAX_LOANS,
  TAX_BASE,
  TAX_DEFAULT,
  TAX_MAX,
  TAX_MIN,
  FUNDING_MAX,
  FUNDING_MIN,
  type Dept,
  type ZoneKey,
} from '../../data/economy';
import { ZONE_C, ZONE_I, ZONE_R } from '../../data/zones';
import { fail, ok, type CommandResult } from '../commands';
import type { Sim } from '../sim';
import { BRIDGE } from '../world/bridge';
import { HOURS_PER_DAY } from '../time';
import { BState, type Building } from '../world/buildings';
import { districtAt, districtFigures } from './districts';
import { civicDef, civicUpkeep } from '../world/civic';
import type { DistrictReport } from '../protocol';

export interface Loan {
  id: number;
  principal: number;
  annualRate: number;
  months: number;
  /** Monthly payment (annuity). */
  payment: number;
  /** Outstanding principal (float; bookings are integers via the ledger carry). */
  balance: number;
  takenTick: number;
}

export interface MonthReport {
  /** Months since the start (the month this report covers). */
  month: number;
  lines: Record<string, number>;
  treasury: number;
}

export interface EconomyState {
  taxes: Record<ZoneKey, [number, number, number]>;
  funding: Record<Dept, number>;
  loans: Loan[];
  /** Integer totals per ledger category for the current month (signed: + income, − expense). */
  month: Record<string, number>;
  /** Fractional remainders per category carried hour to hour so nothing is lost. */
  carry: Record<string, number>;
  monthStartTreasury: number;
  history: MonthReport[];
  negativeHours: number;
  bankrupt: boolean;
}

export function defaultEconomy(treasury: number): EconomyState {
  const funding = {} as Record<Dept, number>;
  for (const d of DEPTS) funding[d.id] = 100;
  return {
    taxes: {
      R: [TAX_DEFAULT, TAX_DEFAULT, TAX_DEFAULT],
      C: [TAX_DEFAULT, TAX_DEFAULT, TAX_DEFAULT],
      I: [TAX_DEFAULT, TAX_DEFAULT, TAX_DEFAULT],
    },
    funding,
    loans: [],
    month: {},
    carry: {},
    monthStartTreasury: treasury,
    history: [],
    negativeHours: 0,
    bankrupt: false,
  };
}

/** Book an integer amount to the treasury and the ledger (+ income, − expense). */
export function book(sim: Sim, category: string, amount: number): void {
  const v = Math.round(amount);
  if (!v) return;
  const e = sim.state.economy;
  sim.state.treasury += v;
  e.month[category] = (e.month[category] ?? 0) + v;
}

/** Accrue a fractional amount: whole dollars are booked, the remainder carries to next time. */
export function accrue(sim: Sim, category: string, amount: number): void {
  if (!amount) return;
  const e = sim.state.economy;
  const c = (e.carry[category] ?? 0) + amount;
  const whole = c < 0 ? Math.ceil(c) : Math.floor(c);
  e.carry[category] = c - whole;
  book(sim, category, whole);
}

const ZONE_KEY: Record<number, ZoneKey> = { [ZONE_R]: 'R', [ZONE_C]: 'C', [ZONE_I]: 'I' };

/** Monthly tax a building pays at current rates. */
export function buildingTax(sim: Sim, b: Building): number {
  const z = ZONE_KEY[b.zone];
  if (!z || b.pop <= 0) return 0;
  const rate = sim.state.economy.taxes[z][b.wealth]! / 100;
  let base = b.pop * TAX_BASE[z][b.wealth]!;
  if (z === 'C') base *= 0.5 + 0.5 * Math.min(1, b.shop);
  return base * rate;
}

/**
 * Monthly cost of each district's policies (M21): the city-wide price times the district's share of
 * the people who live or work in the city (`people` per district over `everyone`), so a shopping street
 * or an industrial estate pays its part too. A policy already in force across the city costs nothing
 * more in a district.
 */
export function districtPolicyCosts(
  sim: Sim,
  people: Map<number, number>,
  everyone: number,
): { total: number; by: Map<number, number> } {
  const s = sim.state;
  const city = Math.max(1, everyone);
  const by = new Map<number, number>();
  let total = 0;
  for (const d of s.districts.values())
    for (const id of d.policies) {
      const p = POLICY.get(id as PolicyId);
      if (!p || s.policies.includes(id)) continue;
      const cost = (policyCost(p, s.totals.population) * (people.get(d.id) ?? 0)) / city;
      by.set(d.id, (by.get(d.id) ?? 0) + cost);
      total += cost;
    }
  return { total, by };
}

/** Each district's figures and monthly budget (M21), with id 0 for the rest of the city. */
export function districtReports(sim: Sim): DistrictReport[] {
  const s = sim.state;
  const figs = districtFigures(sim);
  const taxes = new Map<number, number>();
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Active && !(b.state === BState.Construction && b.pop > 0)) continue;
    const d = districtAt(s.districtCells, b.x, b.z);
    taxes.set(d, (taxes.get(d) ?? 0) + buildingTax(sim, b));
  }
  const upkeep = new Map<number, number>();
  const scale = sim.upkeepScale();
  for (const c of s.civics.values()) {
    const def = civicDef(c);
    const d = districtAt(s.districtCells, c.x, c.z);
    upkeep.set(d, (upkeep.get(d) ?? 0) + civicUpkeep(c) * (s.economy.funding[def.dept] / 100) * scale);
  }
  const people = new Map([...figs].map(([id, f]) => [id, f.population + f.jobs]));
  const everyone = [...people.values()].reduce((a, b) => a + b, 0);
  const policies = districtPolicyCosts(sim, people, everyone).by;
  return [...figs].map(([id, f]) => ({
    id,
    ...f,
    taxes: Math.round(taxes.get(id) ?? 0),
    upkeep: Math.round(upkeep.get(id) ?? 0),
    policies: Math.round(policies.get(id) ?? 0),
  }));
}

/** Monthly amounts by category at current conditions (the hourly accrual is this / 24). */
export function monthlyRates(sim: Sim): Record<string, number> {
  const s = sim.state;
  const e = s.economy;
  const out: Record<string, number> = {};
  const add = (k: string, v: number) => {
    if (v) out[k] = (out[k] ?? 0) + v;
  };
  // District policies (M21) cost their district's share of the city-wide price, by the people who
  // live or work there.
  const districtPolicies = sim.districtPolicies();
  const districtPeople = districtPolicies.size ? new Map<number, number>() : null;
  let everyone = 0;
  for (const b of s.buildings.values()) {
    if (b.state !== BState.Active && !(b.state === BState.Construction && b.pop > 0)) continue;
    const z = ZONE_KEY[b.zone];
    if (!z || b.pop <= 0) continue;
    add(`tax${z}${b.wealth}`, buildingTax(sim, b));
    if (districtPeople) {
      everyone += b.pop;
      const d = districtAt(s.districtCells, b.x, b.z);
      if (d) districtPeople.set(d, (districtPeople.get(d) ?? 0) + b.pop);
    }
  }
  let roadUpkeep = 0;
  for (const seg of s.net.segments.values()) {
    const perMetre = ROAD_TYPES[seg.type].upkeepPerMetre;
    roadUpkeep += sim.net.curve(seg.id).length * (perMetre + (seg.tram ? TRAM.trackUpkeep : 0));
    const deck = sim.deck(seg.id);
    if (deck) roadUpkeep += deck.overWater * perMetre * (BRIDGE.upkeepFactor - 1);
  }
  const scale = sim.upkeepScale();
  add('roadUpkeep', -roadUpkeep * (e.funding.roads / 100) * scale);
  for (const [dept, cost] of Object.entries(sim.departmentUpkeep()))
    add(`upkeep:${dept}`, -cost * (e.funding[dept as Dept] / 100) * scale);
  for (const [k, v] of Object.entries(specialisationIncome(sim))) add(k, v);
  for (const id of s.policies) {
    const p = POLICY.get(id as PolicyId);
    if (p) add('policies', -policyCost(p, s.totals.population));
  }
  if (districtPeople) add('policies', -districtPolicyCosts(sim, districtPeople, everyone).total);
  for (const loan of e.loans) {
    const r = loan.annualRate / 12;
    const interest = Math.min(loan.balance * r, loan.payment);
    add('loanInterest', -interest);
    add('loanPrincipal', -Math.min(loan.balance, loan.payment - interest));
  }
  return out;
}

/** Hourly accrual of every income and expense line, loan amortisation and bankruptcy checks. */
export function economyHour(sim: Sim): void {
  const s = sim.state;
  const e = s.economy;
  if (e.bankrupt) return;
  const rates = monthlyRates(sim);
  for (const k of Object.keys(rates).sort()) {
    if (k === 'loanPrincipal' || k === 'loanInterest') continue;
    accrue(sim, k, rates[k]! / HOURS_PER_DAY);
  }
  // Loans: pay an hourly share of the monthly payment; interest first, then principal.
  for (const loan of [...e.loans]) {
    const r = loan.annualRate / 12;
    const interest = (loan.balance * r) / HOURS_PER_DAY;
    const pay = Math.min(loan.payment / HOURS_PER_DAY, loan.balance + interest);
    const principal = pay - interest;
    accrue(sim, 'loanInterest', -interest);
    accrue(sim, 'loanPrincipal', -principal);
    loan.balance -= principal;
    if (loan.balance <= 0.5) {
      // Settle the last cents exactly so nothing is lost or created.
      accrue(sim, 'loanPrincipal', -loan.balance);
      e.loans = e.loans.filter((l) => l !== loan);
      sim.events.push({ kind: 'loanRepaid', id: loan.id });
    }
  }
  if (!s.options.sandbox) {
    if (s.treasury < 0) {
      e.negativeHours++;
      if (e.negativeHours === 1 || e.negativeHours % 12 === 0)
        sim.events.push({ kind: 'moneyNegative', id: BANKRUPTCY.graceHours - e.negativeHours });
      if (e.negativeHours >= BANKRUPTCY.graceHours) {
        e.bankrupt = true;
        sim.events.push({ kind: 'bankrupt', id: 0 });
      }
    } else e.negativeHours = 0;
  }
}

/** Close the month: store its report and start a new one. */
export function closeMonth(sim: Sim, monthIndex: number): void {
  const e = sim.state.economy;
  e.history.push({ month: monthIndex, lines: { ...e.month }, treasury: sim.state.treasury });
  if (e.history.length > LEDGER_HISTORY_MONTHS) e.history.shift();
  e.month = {};
  e.monthStartTreasury = sim.state.treasury;
}

export function setTax(
  sim: Sim,
  zone: ZoneKey,
  wealth: 0 | 1 | 2 | 'all',
  rate: number,
  dryRun: boolean,
): CommandResult {
  if (!['R', 'C', 'I'].includes(zone)) return fail('Unknown zone');
  if (!Number.isFinite(rate)) return fail('Invalid rate');
  const r = Math.max(TAX_MIN, Math.min(TAX_MAX, Math.round(rate * 10) / 10));
  if (!dryRun) {
    const t = sim.state.economy.taxes[zone];
    if (wealth === 'all') t[0] = t[1] = t[2] = r;
    else t[wealth] = r;
  }
  return ok(0, { info: { rate: r } });
}

export function setFunding(sim: Sim, dept: Dept, pct: number, dryRun: boolean): CommandResult {
  if (!DEPTS.some((d) => d.id === dept)) return fail('Unknown department');
  if (!Number.isFinite(pct)) return fail('Invalid funding');
  const v = Math.max(FUNDING_MIN, Math.min(FUNDING_MAX, Math.round(pct)));
  if (!dryRun) sim.state.economy.funding[dept] = v;
  sim.markNetworkChanged();
  return ok(0, { info: { funding: v } });
}

export function annuity(principal: number, annualRate: number, months: number): number {
  const r = annualRate / 12;
  return r === 0 ? principal / months : (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function takeLoan(sim: Sim, amount: number, dryRun: boolean): CommandResult {
  const s = sim.state;
  const opt = LOAN_OPTIONS.find((o) => o.amount === amount);
  if (!opt) return fail('No such loan');
  if (!sim.isUnlocked(opt.unlockPopulation))
    return fail(`Needs ${opt.unlockPopulation.toLocaleString('en-US')} residents`);
  if (s.economy.loans.length >= MAX_LOANS) return fail(`At most ${MAX_LOANS} loans at a time`);
  if (s.economy.bankrupt) return fail('The city is bankrupt');
  const payment = annuity(opt.amount, opt.annualRate, opt.months);
  if (!dryRun) {
    const loan: Loan = {
      id: s.nextId++,
      principal: opt.amount,
      annualRate: opt.annualRate,
      months: opt.months,
      payment,
      balance: opt.amount,
      takenTick: s.tick,
    };
    s.economy.loans.push(loan);
    book(sim, 'loans', opt.amount);
  }
  return ok(-opt.amount, { info: { payment: Math.round(payment) } });
}

export function repayLoan(sim: Sim, id: number, dryRun: boolean): CommandResult {
  const e = sim.state.economy;
  const loan = e.loans.find((l) => l.id === id);
  if (!loan) return fail('No such loan');
  const due = Math.ceil(loan.balance);
  if (!sim.state.options.sandbox && sim.state.treasury < due) return fail('Not enough money to repay it now');
  if (!dryRun) {
    accrue(sim, 'loanPrincipal', -loan.balance);
    e.loans = e.loans.filter((l) => l !== loan);
  }
  return ok(due);
}
