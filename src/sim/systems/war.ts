import { CIVIC } from '../../data/civic';
import { COMMUTE, TRAFFIC } from '../../data/balance';
import { annuity } from '../../data/economy';
import {
  PERSONALITY,
  PERSONALITY_IDS,
  RIVALS,
  UNIT,
  UNIT_CLASSES,
  WAR,
  type MilitaryInfo,
  type Personality,
  type UnitClass,
  type UnitKind,
} from '../../data/war';
import { Rng, type RngState } from '../rng';
import { fail, ok, type CommandResult } from '../commands';
import { formatInt } from '../dmath';
import type { Sim } from '../sim';
import type { ForceData, MilitaryDetails } from '../protocol';
import { HOURS_PER_DAY, TICKS_PER_MONTH } from '../time';
import { accessOf, BState, type Building } from '../world/buildings';
import { ZONE_I } from '../../data/zones';
import { RAIDS } from '../../data/battle';
import { civicOnline, civicUpkeep, lowerName, type Civic } from '../world/civic';
import type { Origin } from './commute';
import type { BattleReport, HostedBattle, Raid } from './raids';
import type { Expedition } from './expeditions';
import {
  researchEffect,
  researchHour,
  researchSummary,
  trialsHour,
  unitLock,
  type Research,
  type ResearchSummary,
} from './research';
import { accrue, book, fundingPct } from './economy';
import { Dijkstra, type RoadGraph } from './graph';
import {
  diplomacySummary,
  standDownReason,
  standsDown,
  theirDmz,
  type Diplomacy,
  type DiplomacySummary,
} from './diplomacy';
import { DIPLOMACY, DIPLOMATS } from '../../data/diplomacy';
import type { FlowAccumulator } from './traffic';

/**
 * A city's armed forces (M34), DESIGN.md §3.28: its units and the training under way, readiness,
 * the stores of materials, and war bonds. `SimState.war` exists only in a city with war on (rival
 * neighbours, or a shared region whose rules allow war), so a peaceful city's state, saves and
 * hash are exactly as before.
 */

/** A trained unit, kept at its base. */
export interface Unit {
  id: number;
  kind: UnitKind;
  /** The military building it's based at. */
  base: number;
  /** Health, 0–1 (battles, M35). */
  hp: number;
  /** Tick it finished training. */
  born: number;
  /** Away on an expedition (its id, M35); absent at home. */
  away?: number;
}

/** A unit being trained at a base. Each base trains its orders one at a time, oldest first. */
export interface TrainOrder {
  id: number;
  kind: UnitKind;
  base: number;
  /** Hours of training done (the unit's `hours` finishes it). */
  done: number;
  /** Money paid for it (refunded in part if it's called off). */
  paid: number;
}

/** A war bond: borrowed from the city's residents, repaid in monthly instalments with interest. */
export interface Bond {
  id: number;
  principal: number;
  annualRate: number;
  months: number;
  payment: number;
  balance: number;
  takenTick: number;
}

/** Materials for the forces, and munitions. */
export interface WarStock {
  goods: number;
  ore: number;
  oil: number;
  munitions: number;
}
export type Material = keyof WarStock;
export const MATERIALS: readonly Material[] = ['goods', 'ore', 'oil', 'munitions'];

export interface WarState {
  units: Map<number, Unit>;
  orders: Map<number, TrainOrder>;
  /** How ready the forces are to fight, 0–1. */
  readiness: number;
  stock: WarStock;
  bonds: Bond[];
  /**
   * The war's own dice (M34), seeded from the city's seed: the neighbours' arming and, later,
   * battles draw from these, never from the city's other streams (a peaceful city's are untouched).
   */
  rng: RngState;
  /**
   * The war clock (hours) that training runs on. In a city of its own it is the city's game hours;
   * in a shared region it can't run ahead of the region's fair clock (SPEC-5: 3× must not raise an
   * army in minutes that others need hours to answer).
   */
  clock: number;
  /** Raids on their way (M35); absent when none. */
  incoming?: Raid[];
  /** The battle being fought in the city now (M35). */
  battle?: HostedBattle;
  /** Forces away raiding neighbours (M35). */
  expeditions?: Expedition[];
  /** The last battles' reports, newest last (M35). */
  reports?: BattleReport[];
  /** When the neighbours last set off to raid it: any, and each (ticks). */
  raided?: { any: number; by: Record<number, number> };
  /** When the city's own forces last struck each computer neighbour (ticks; M35, retaliation). */
  struck?: Record<number, number>;
  /** The city has passed the bar past which neighbours may raid it (told once, M35). */
  exposed?: true;
  /**
   * Battles from outside the city it has taken, newest last (each is taken once): by input id, or
   * a friend's by `slot:id` (M36).
   */
  taken?: string[];
  /** Declarations, treaties, pacts and the city's standing (M36); absent until first used. */
  diplomacy?: Diplomacy;
  /** Test mode (M36): friends may raid it though it's a newcomer (e2e and relay tests). */
  unshielded?: true;
  /** Weapons research, prototypes and their trials (M37); absent until the first research is queued. */
  research?: Research;
}

export function initialWar(seed: string): WarState {
  return {
    units: new Map(),
    orders: new Map(),
    readiness: 0,
    stock: { goods: 0, ore: 0, oil: 0, munitions: 0 },
    bonds: [],
    rng: Rng.fromSeed(`${seed}:war`).getState(),
    clock: 0,
  };
}

/**
 * War comes to a city (M34): founded with rival neighbours, or its region's host turned war on.
 * It gets its war state, and its computer neighbours each a character and forces to match.
 */
export function startWar(sim: Sim): void {
  const s = sim.state;
  if (s.war) return;
  s.war = initialWar(s.options.seed);
  markRivals(sim);
  sim.warChanged();
}

/** Characters and starting forces for the computer neighbours, from the city's seed (M34). */
export function markRivals(sim: Sim): void {
  const rng = Rng.fromSeed(`${sim.state.options.seed}:rivals`);
  const left = [...PERSONALITY_IDS];
  for (const n of sim.state.region.neighbours) {
    if (n.player || n.rival) continue;
    // Different characters while they last, so a city's rivals aren't three of a kind.
    const pick = left.splice(rng.int(left.length), 1)[0] ?? PERSONALITY_IDS[rng.int(PERSONALITY_IDS.length)]!;
    const p = PERSONALITY[pick];
    const k = n.population / 1000;
    n.rival = {
      personality: pick,
      forces: Math.round(k * p.forces * rng.range(0.5, 0.8) * 10) / 10,
      defences: Math.round(k * p.defences * rng.range(0.5, 0.8) * 10) / 10,
      relation: Math.round(p.relation + rng.range(-10, 10)),
    };
  }
  assignAllies(sim);
}

/**
 * Which computer neighbours stand by each other (M36), from dice of their own so a city's
 * neighbours have the same alliances wherever it's played: honourable and cautious ones ally
 * readily, treacherous ones hardly ever. A neighbour attacked calls on these.
 */
export function assignAllies(sim: Sim): void {
  const rivals = sim.state.region.neighbours.filter((n) => n.rival && !n.player);
  const allies = rivalAllies(
    sim.state.options.seed,
    rivals.map((n) => ({ id: n.id, personality: n.rival!.personality })),
  );
  for (const n of rivals) n.rival!.allies = allies.get(n.id) ?? [];
}

/** Each computer neighbour's allies, from the city's seed (also the v29 migration's). */
export function rivalAllies(
  seed: string,
  rivals: { id: number; personality: Personality }[],
): Map<number, number[]> {
  const rng = Rng.fromSeed(`${seed}:allies`);
  const out = new Map<number, number[]>(rivals.map((n) => [n.id, []]));
  for (let i = 0; i < rivals.length; i++)
    for (let j = i + 1; j < rivals.length; j++) {
      const a = rivals[i]!;
      const b = rivals[j]!;
      if (!rng.chance(DIPLOMATS[a.personality].allies * DIPLOMATS[b.personality].allies * 1.5)) continue;
      out.get(a.id)!.push(b.id);
      out.get(b.id)!.push(a.id);
    }
  return out;
}

/** The computer neighbours arm month by month towards what their character keeps (M34). */
export function rivalsMonth(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  const rng = new Rng(w.rng);
  for (const n of sim.state.region.neighbours) {
    const r = n.rival;
    if (!r || n.player) continue;
    const p = PERSONALITY[r.personality];
    const k = n.population / 1000;
    const step = RIVALS.arming * (1 + RIVALS.jitter * rng.range(-1, 1));
    // A demilitarised zone on its side (M36) halves the defences it keeps.
    const keep = theirDmz(sim, n.id) ? 0.5 : 1;
    // A vassal of the city (M36) rebuilds its forces only so far.
    const allowed = r.vassal ? DIPLOMACY.vassal.forcesLeft : 1;
    r.forces = Math.round((r.forces + (k * p.forces * allowed - r.forces) * step) * 10) / 10;
    r.defences = Math.round((r.defences + (k * p.defences * keep - r.defences) * step) * 10) / 10;
  }
  w.rng = rng.getState();
}

/** Is war on in this city (M34)? Its military state exists only then. */
export function warOn(sim: Sim): boolean {
  return !!sim.state.war;
}

/** What a military building does, or undefined for any other building. */
export function militaryOf(c: Civic): MilitaryInfo | undefined {
  return CIVIC.get(c.def)?.military;
}

/** The city's military buildings, in id order. */
export function militaryCivics(sim: Sim): Civic[] {
  return [...sim.state.civics.values()].filter((c) => !!militaryOf(c)).sort((a, b) => a.id - b.id);
}

/** Units based at a building and orders it has in hand, which together fill its places. */
export function baseLoad(sim: Sim, base: number): { units: number; orders: number } {
  const w = sim.state.war;
  let units = 0;
  let orders = 0;
  if (!w) return { units, orders };
  for (const u of w.units.values()) if (u.base === base) units++;
  for (const o of w.orders.values()) if (o.base === base) orders++;
  return { units, orders };
}

/** The order a base is training now: its oldest. */
export function trainingAt(sim: Sim, base: number): TrainOrder | undefined {
  const w = sim.state.war;
  if (!w) return undefined;
  let best: TrainOrder | undefined;
  for (const o of w.orders.values()) if (o.base === base && (!best || o.id < best.id)) best = o;
  return best;
}

/** Power a military building draws now: its own need, and its training's. */
export function militaryPowerNeed(sim: Sim, c: Civic): number {
  const m = militaryOf(c);
  if (!m || !civicOnline(c)) return 0;
  const o = trainingAt(sim, c.id);
  return m.power + (o ? (UNIT.get(o.kind)?.power ?? 0) : 0);
}

/** Is a working arms factory speeding up vehicles (land units other than infantry)? */
function vehicleSpeedup(sim: Sim): number {
  let best = 0;
  for (const c of sim.state.civics.values()) {
    const a = militaryOf(c)?.arms;
    if (a && civicOnline(c) && (c.staff ?? 0) >= WAR.minStaffed) best = Math.max(best, a.vehicleTime);
  }
  return best;
}

/** Training per war-clock hour at a base (0 while it's offline, unpowered or short of staff). */
export function trainingRate(sim: Sim, c: Civic, kind: UnitKind): number {
  if (!civicOnline(c)) return 0;
  const staff = c.staff ?? 0;
  if (staff < WAR.minStaffed) return 0;
  const powered = c.powered ?? 0;
  let rate = Math.min(1, staff) * powered * Math.min(1.25, sim.fundingEff('defence'));
  const def = UNIT.get(kind);
  if (def?.domain === 'land' && def.id !== 'infantry') rate /= 1 - vehicleSpeedup(sim);
  return rate * trainingFactor(sim, kind);
}

/**
 * Research's training speed (M37) by what is trained: vehicles, aircraft, drones and boats (1
 * without it). Superweapons keep their own long build.
 */
export function trainingFactor(sim: Sim, kind: UnitKind): number {
  const def = UNIT.get(kind);
  if (!def || def.group === 'superweapons') return 1;
  if (kind === 'drone') return researchEffect(sim, 'droneTraining');
  if (def.domain === 'air') return researchEffect(sim, 'aircraftTraining');
  if (def.domain === 'sea') return researchEffect(sim, 'boatTraining');
  return kind === 'infantry' ? 1 : researchEffect(sim, 'vehicleTraining');
}

/** Units a base keeps: its own number, or an airfield's after Swarm control (M37). */
export function holdsOf(sim: Sim, c: Civic): number {
  const m = militaryOf(c);
  if (!m?.holds) return 0;
  return m.runway ? researchEffect(sim, 'airfieldHolds', m.holds) : m.holds;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** How much the stores hold of each material: the base stores and each arms factory's. */
export function storeCapacity(sim: Sim): WarStock {
  const base = WAR.materials.storage;
  let extra = 0;
  let any = false;
  for (const c of sim.state.civics.values()) {
    const m = militaryOf(c);
    if (!m) continue;
    any = true;
    if (m.arms && civicOnline(c)) extra += m.arms.storage;
  }
  // No stores until the city has a military building to keep them.
  if (!any) return { goods: 0, ore: 0, oil: 0, munitions: 0 };
  // Forward supply (M37) makes room for half as much again.
  const f = researchEffect(sim, 'storeCapacity');
  return {
    goods: Math.round((base.goods + extra) * f),
    ore: Math.round((base.ore + extra) * f),
    oil: Math.round((base.oil + extra) * f),
    munitions: Math.round((base.munitions + extra) * f),
  };
}

/** Industrial jobs filled: the goods the city's industry makes. */
function industrialWorkers(sim: Sim): number {
  let n = 0;
  for (const b of sim.state.buildings.values())
    if (b.state === BState.Active && b.zone === ZONE_I) n += b.pop;
  return n;
}

/**
 * What flows into the stores a day: the arms factories' own goods and munitions (paid for by their
 * upkeep), goods from the city's industry and ore and oil from its mines and wells (paid at the local
 * price: what the city would otherwise sell them for).
 */
export function storeSupply(sim: Sim, extraction: (c: Civic) => number): { free: WarStock; local: WarStock } {
  const free: WarStock = { goods: 0, ore: 0, oil: 0, munitions: 0 };
  const local: WarStock = { goods: 0, ore: 0, oil: 0, munitions: 0 };
  for (const c of [...sim.state.civics.values()].sort((a, b) => a.id - b.id)) {
    const def = CIVIC.get(c.def);
    const a = def?.military?.arms;
    if (a && civicOnline(c)) {
      const k = Math.min(1, c.staff ?? 0) * (c.powered ?? 0);
      free.goods += a.goods * k;
      free.munitions += a.munitions * k;
    }
    const r = def?.resource;
    if (r) local[r.kind] += extraction(c) * WAR.materials.resourceShare;
  }
  local.goods = industrialWorkers(sim) * WAR.materials.goodsPerJob;
  return { free, local };
}

/** Readiness the forces head for: staff, power and defence funding; an HQ; the proving ground's drills. */
export function readinessTarget(sim: Sim): number {
  let jobs = 0;
  let staffed = 0;
  let powered = 0;
  let hq = false;
  let drills = 0;
  for (const c of militaryCivics(sim)) {
    // A building still going up (a superweapon's project, M37) isn't yet one the forces miss.
    if (c.build) continue;
    const m = militaryOf(c)!;
    const online = civicOnline(c);
    jobs += m.jobs;
    staffed += online ? m.jobs * Math.min(1, c.staff ?? 0) : 0;
    powered += online ? m.jobs * (c.powered ?? 0) : 0;
    if (m.hq && online && (c.staff ?? 0) >= WAR.minStaffed) hq = true;
    if (m.drills && online) drills = Math.max(drills, m.drills * Math.min(1, c.staff ?? 0));
  }
  if (jobs <= 0) return 0;
  let t = (staffed / jobs) * (powered / jobs) * Math.min(1, sim.fundingEff('defence'));
  if (!hq) t = Math.min(t, WAR.noHqReadiness);
  if (sim.state.economy.bankrupt || sim.state.treasury < 0) t *= 0.5;
  return Math.max(0, Math.min(1, t + drills));
}

/**
 * The war's hour (M34): the clock moves, training at each base goes on, readiness eases towards its
 * target and the stores fill from the city's own industry, mines and wells.
 */
export function warHour(sim: Sim, extraction: (c: Civic) => number): void {
  const w = sim.state.war;
  if (!w) return;
  const step = 1;
  w.clock += step;
  // Training: each base works on its oldest order.
  for (const c of militaryCivics(sim)) {
    const o = trainingAt(sim, c.id);
    if (!o) continue;
    const def = UNIT.get(o.kind);
    if (!def) {
      w.orders.delete(o.id);
      continue;
    }
    const was = o.done;
    o.done = round3(o.done + trainingRate(sim, c, o.kind) * step);
    // The page's training bars follow the roster: send it again as training moves on.
    if (o.done !== was) sim.warChanged();
    if (o.done + 1e-9 >= def.hours) {
      w.orders.delete(o.id);
      const id = sim.state.nextId++;
      w.units.set(id, { id, kind: o.kind, base: c.id, hp: 1, born: sim.state.tick });
      sim.events.push({ kind: 'unitTrained', id, info: { unit: def.name, base: c.id } });
      sim.warChanged();
    }
  }
  // Weapons research and prototypes' trials (M37).
  researchHour(sim);
  trialsHour(sim);
  // Readiness.
  const target = readinessTarget(sim);
  const d = WAR.readinessPerDay / HOURS_PER_DAY;
  w.readiness = round3(w.readiness + Math.max(-d, Math.min(d, target - w.readiness)));
  // The stores.
  const cap = storeCapacity(sim);
  const { free, local } = storeSupply(sim, extraction);
  const price = WAR.materials.localPrice;
  let cost = 0;
  for (const m of MATERIALS) {
    let room = Math.max(0, cap[m] - w.stock[m]);
    const f = Math.min(room, free[m] / HOURS_PER_DAY);
    room -= f;
    const l = Math.min(room, local[m] / HOURS_PER_DAY);
    cost += l * price[m];
    w.stock[m] = round3(w.stock[m] + f + l);
  }
  if (cost > 0) accrue(sim, 'warMaterials', -cost);
}

/** Monthly running costs of the forces (the budget's projection; booked hourly with the rest). */
export function forcesUpkeep(sim: Sim): number {
  const w = sim.state.war;
  if (!w) return 0;
  let n = 0;
  for (const u of w.units.values()) n += UNIT.get(u.kind)?.upkeep ?? 0;
  return n;
}

/** Materials a unit needs, what the stores cover, and what must be bought in (with its price). */
export function unitBill(
  sim: Sim,
  kind: UnitKind,
): { money: number; imports: number; take: WarStock; short: WarStock } {
  const def = UNIT.get(kind)!;
  const w = sim.state.war;
  const need: WarStock = { goods: def.goods, ore: def.ore, oil: def.oil, munitions: 0 };
  const take: WarStock = { goods: 0, ore: 0, oil: 0, munitions: 0 };
  const short: WarStock = { goods: 0, ore: 0, oil: 0, munitions: 0 };
  let imports = 0;
  for (const m of MATERIALS) {
    take[m] = Math.min(need[m], Math.floor(w?.stock[m] ?? 0));
    short[m] = need[m] - take[m];
    imports += short[m] * WAR.materials.importPrice[m];
  }
  return { money: def.cost, imports, take, short };
}

/** Order a unit trained at a base (M34). */
export function trainUnit(sim: Sim, baseId: number, kind: UnitKind, dryRun: boolean): CommandResult {
  const s = sim.state;
  const w = s.war;
  if (!w) return fail('War is off in this city: start one with rival neighbours to raise forces');
  const def = UNIT.get(kind);
  if (!def) return fail('Unknown unit');
  const c = s.civics.get(baseId);
  const m = c ? militaryOf(c) : undefined;
  if (!c || !m) return fail('Units are trained at military buildings');
  const name = CIVIC.get(c.def)!.name;
  if (!m.trains?.includes(kind))
    return fail(`The ${lowerName(name)} doesn't train ${def.plural.toLowerCase()}`);
  const lock = unitLock(sim, kind);
  if (lock) return fail(lock);
  const down = standDownReason(sim, c.x, c.z);
  if (down) return fail(down);
  if (s.economy.bankrupt) return fail('The city is bankrupt');
  const load = baseLoad(sim, baseId);
  const holds = holdsOf(sim, c);
  if (load.units + load.orders >= holds)
    return fail(`The ${lowerName(name)} is full: it keeps ${holds} units`);
  const bill = unitBill(sim, kind);
  const total = bill.money + bill.imports;
  if (!s.options.sandbox && s.treasury < total)
    return fail(`Not enough money: $${formatInt(total)} with the materials bought in`);
  if (dryRun) return ok(total, { info: { imports: bill.imports } });
  for (const mat of MATERIALS) w.stock[mat] = round3(w.stock[mat] - bill.take[mat]);
  sim.spend(bill.money, 'training');
  if (bill.imports > 0) sim.spend(bill.imports, 'warImports');
  const id = s.nextId++;
  w.orders.set(id, { id, kind, base: baseId, done: 0, paid: bill.money });
  sim.warChanged();
  return ok(total, { created: [id], info: { imports: bill.imports } });
}

/** Call off a unit in training: the money for the training not yet done comes back. */
export function cancelTraining(sim: Sim, orderId: number, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  const o = w?.orders.get(orderId);
  if (!w || !o) return fail('No such training');
  const def = UNIT.get(o.kind);
  const left = def ? Math.max(0, 1 - o.done / def.hours) : 1;
  const refund = Math.round(o.paid * left);
  if (dryRun) return ok(-refund);
  w.orders.delete(orderId);
  if (refund > 0) sim.earn(refund, 'refunds');
  sim.warChanged();
  return ok(-refund);
}

/** Stand a unit down: it goes, and so does its upkeep. */
export function disbandUnit(sim: Sim, unitId: number, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  if (!w || !w.units.has(unitId)) return fail('No such unit');
  if (!dryRun) {
    w.units.delete(unitId);
    sim.warChanged();
  }
  return ok(0);
}

/** A base is gone (bulldozed, destroyed): its units are stood down and its training called off. */
export function baseRemoved(sim: Sim, base: number): void {
  const w = sim.state.war;
  if (!w) return;
  let changed = false;
  for (const u of [...w.units.values()])
    if (u.base === base) {
      w.units.delete(u.id);
      changed = true;
    }
  for (const o of [...w.orders.values()])
    if (o.base === base) {
      w.orders.delete(o.id);
      changed = true;
    }
  if (changed) sim.warChanged();
}

/** Borrow from the city's residents (M34): bigger and cheaper than the bank, but they mind. */
export function issueBond(sim: Sim, amount: number, dryRun: boolean): CommandResult {
  const s = sim.state;
  const w = s.war;
  if (!w) return fail('War bonds are for a city with war on');
  const opt = WAR.bonds.find((o) => o.amount === amount);
  if (!opt) return fail('No such bond');
  if (!sim.isUnlocked(opt.unlockPopulation))
    return fail(`Needs ${formatInt(opt.unlockPopulation)} residents`);
  if (w.bonds.length >= WAR.maxBonds) return fail(`At most ${WAR.maxBonds} war bonds at a time`);
  if (s.economy.bankrupt) return fail('The city is bankrupt');
  const payment = annuity(opt.amount, opt.annualRate, opt.months);
  if (!dryRun) {
    w.bonds.push({
      id: s.nextId++,
      principal: opt.amount,
      annualRate: opt.annualRate,
      months: opt.months,
      payment,
      balance: opt.amount,
      takenTick: s.tick,
    });
    book(sim, 'bonds', opt.amount);
    sim.warChanged();
  }
  return ok(-opt.amount, { info: { payment: Math.round(payment) } });
}

/** Pay a war bond off early. */
export function repayBond(sim: Sim, id: number, dryRun: boolean): CommandResult {
  const w = sim.state.war;
  const bond = w?.bonds.find((b) => b.id === id);
  if (!w || !bond) return fail('No such bond');
  const due = Math.ceil(bond.balance);
  if (!sim.state.options.sandbox && sim.state.treasury < due) return fail('Not enough money to repay it now');
  if (!dryRun) {
    accrue(sim, 'bondPrincipal', -bond.balance);
    w.bonds = w.bonds.filter((b) => b !== bond);
    sim.warChanged();
  }
  return ok(due);
}

/** The hour's share of each bond's instalment: interest first, then principal (like a loan). */
export function bondsHour(sim: Sim): void {
  const w = sim.state.war;
  if (!w) return;
  for (const bond of [...w.bonds]) {
    const r = bond.annualRate / 12;
    const interest = (bond.balance * r) / HOURS_PER_DAY;
    const pay = Math.min(bond.payment / HOURS_PER_DAY, bond.balance + interest);
    const principal = pay - interest;
    accrue(sim, 'bondInterest', -interest);
    accrue(sim, 'bondPrincipal', -principal);
    bond.balance -= principal;
    if (bond.balance <= 0.5) {
      accrue(sim, 'bondPrincipal', -bond.balance);
      w.bonds = w.bonds.filter((b) => b !== bond);
      sim.events.push({ kind: 'bondRepaid', id: bond.id });
      sim.warChanged();
    }
  }
}

/** Monthly bond payments for the budget's projection. */
export function bondRates(sim: Sim): { interest: number; principal: number } {
  let interest = 0;
  let principal = 0;
  for (const bond of sim.state.war?.bonds ?? []) {
    const r = bond.annualRate / 12;
    const i = Math.min(bond.balance * r, bond.payment);
    interest += i;
    principal += Math.min(bond.balance, bond.payment - i);
  }
  return { interest, principal };
}

/** What outstanding war bonds cost in approval, city-wide (0 or negative). */
export function bondMood(sim: Sim): number {
  const w = sim.state.war;
  if (!w || !w.bonds.length) return 0;
  const owed = w.bonds.reduce((a, b) => a + b.balance, 0);
  const per = owed / Math.max(1, sim.state.totals.population);
  return Math.max(WAR.bondMoodMax, (WAR.bondMood * per) / 10);
}

/** How safe a home feels with military buildings nearby (M34): 0 when there are none. */
export function safetyAt(sim: Sim, b: Building): number {
  if (!sim.state.war) return 0;
  let best = 0;
  for (const id of sim.civHash.queryPoint(b.x, b.z, MAX_SAFETY)) {
    const c = sim.state.civics.get(id);
    const safe = c && civicOnline(c) ? militaryOf(c)?.safety : undefined;
    if (!safe) continue;
    const dx = b.x - c!.x;
    const dz = b.z - c!.z;
    const d2 = dx * dx + dz * dz;
    if (d2 >= safe.radius * safe.radius) continue;
    best = Math.max(best, safe.value * (1 - Math.sqrt(d2) / safe.radius));
  }
  return best * WAR.safetyLike[b.wealth]!;
}

/** The widest safety radius of any military building. */
const MAX_SAFETY = Math.max(0, ...[...CIVIC.values()].map((d) => d.military?.safety?.radius ?? 0));

const dijkstra = new Dijkstra();

/** The road node a civic building's access point is nearest. */
function accessNode(sim: Sim, g: RoadGraph, c: Civic): number | undefined {
  if (!c.access) return undefined;
  const seg = sim.state.net.segments.get(c.access.seg);
  if (!seg) return undefined;
  const len = sim.net.curve(seg.id).length;
  return g.index.get(c.access.s <= len / 2 ? seg.a : seg.b);
}

/** Who works for the military this round (M34): posts taken per home, and their travel seconds. */
export interface MilitaryStaff {
  taken: Map<number, number>;
  seconds: Map<number, number>;
}

/**
 * Staff for the military buildings (M34), at the start of each matching round: each base, in id
 * order, takes the workers nearest it by road before the city's businesses look for theirs (the
 * forces recruit first), and they drive there with everyone else. A base's `staff` is the share of
 * its posts filled. The matcher then places the rest of each home's workers.
 */
export function militaryStaffing(
  sim: Sim,
  r: {
    g: RoadGraph;
    costs: Float64Array;
    flows: FlowAccumulator;
    origins: Map<number, Origin>;
    car: number;
  },
): MilitaryStaff {
  const out: MilitaryStaff = { taken: new Map(), seconds: new Map() };
  if (!sim.state.war) return out;
  const { g, costs, flows, origins, car } = r;
  // The forces may take a share of the city's workers at most. The HQ is staffed first, then bases
  // training units (oldest order first), each in full while the share lasts; then (M37) proving
  // grounds with a prototype on trial and labs with research queued; then the rest, in build order.
  const work = sim.state.war.research;
  const trying = new Set((work?.trials ?? []).map((t) => t.ground));
  const researching = !!work?.queue.length;
  const first = new Map<number, number>();
  for (const o of [...sim.state.war.orders.values()].sort((a, b) => a.id - b.id))
    if (!first.has(o.base)) first.set(o.base, o.id);
  const bases: { c: Civic; m: MilitaryInfo; node: number }[] = [];
  for (const c of militaryCivics(sim)) {
    c.staff = 0;
    const m = militaryOf(c)!;
    const node = civicOnline(c) ? accessNode(sim, g, c) : undefined;
    // In a demilitarised zone on the city's side (M36) the building stands down: no one is posted.
    if (node === undefined || m.jobs <= 0 || standsDown(sim, c.x, c.z)) continue;
    bases.push({ c, m, node });
  }
  const rank = (c: Civic) =>
    militaryOf(c)!.hq
      ? -1
      : (first.get(c.id) ??
        (trying.has(c.id)
          ? Number.MAX_SAFE_INTEGER - 2
          : researching && militaryOf(c)!.lab
            ? Number.MAX_SAFE_INTEGER - 1
            : Number.MAX_SAFE_INTEGER));
  bases.sort((a, b) => rank(a.c) - rank(b.c) || a.c.id - b.c.id);
  let workforce = 0;
  for (const o of origins.values()) for (const e of o.list) workforce += e.workers;
  let spare = Math.floor(workforce * WAR.enlistShare);
  for (const { c, m, node } of bases) {
    const want = Math.min(m.jobs, spare);
    if (want <= 0) continue;
    let jobs = want;
    const loads = new Map<number, number>();
    const search = (g.hasOneWay ? dijkstra.runReverse : dijkstra.run).bind(dijkstra);
    search(
      g,
      [{ node, cost: 0 }],
      COMMUTE.maxCommute,
      (u, cost) => {
        const o = origins.get(u);
        if (o)
          for (const e of o.list) {
            if (jobs <= 0) break;
            const free = e.workers - (out.taken.get(e.b.id) ?? 0);
            if (free <= 0) continue;
            const take = Math.min(free, jobs);
            out.taken.set(e.b.id, (out.taken.get(e.b.id) ?? 0) + take);
            out.seconds.set(e.b.id, (out.seconds.get(e.b.id) ?? 0) + take * (cost + e.att.offset));
            jobs -= take;
            const n = take * TRAFFIC.tripsPerWorker * car;
            loads.set(u, (loads.get(u) ?? 0) + n);
            flows.addSegment(accessOf(sim, e.b)?.seg ?? -1, n);
          }
        return jobs > 0;
      },
      costs,
      true,
    );
    for (const [u, n] of loads) flows.addLoad(u, n);
    if (g.hasOneWay) flows.accumulateReverse(dijkstra);
    else flows.accumulate(dijkstra);
    c.staff = round3((want - jobs) / m.jobs);
    spare -= want - jobs;
  }
  return out;
}

/** The forces' figures for the page (M34): the war room, the budget and the toolbar. */
export interface WarSummary {
  readiness: number;
  /** Where readiness is heading. */
  target: number;
  units: number;
  training: number;
  /** Rough fighting worth of the units, by health. */
  strength: number;
  byGroup: Record<UnitClass, number>;
  /** Monthly running costs at the current funding: units, and the military buildings. */
  upkeep: { forces: number; buildings: number };
  /** Defence funding (%). */
  funding: number;
  stock: WarStock;
  capacity: WarStock;
  /** What the stores take in a day now: free (arms factories) and bought locally. */
  supply: WarStock;
  bonds: {
    id: number;
    principal: number;
    balance: number;
    payment: number;
    annualRate: number;
    monthsLeft: number;
  }[];
  /** City-wide approval the outstanding bonds cost (0 or negative). */
  bondMood: number;
  /** Military posts and those filled; power drawn and served. */
  staff: { jobs: number; filled: number };
  power: { need: number; served: number };
  /** The military HQ's id, or null without one (no war room). */
  hq: number | null;
  /** Military buildings. */
  bases: number;
  /**
   * Battles (M35): a raid on its way once the city has heard of it (who, how many, the tick it
   * arrives), the battle on now, and the last reports, newest first.
   */
  incoming: {
    id: number;
    from: string;
    units: number;
    arrive: number;
    target: string;
    near: number;
    sheltered: number;
  } | null;
  battle: { id: number; from: string; start: number } | null;
  reports: BattleReport[];
  /** Whether neighbours may raid yet, and those that may answer a raid of the city's own. */
  threat: { open: boolean; answering: number[] };
  /** The routes a force could take besides road and air: rail with a rail link, sea with ships. */
  routes: { rail: boolean; sea: boolean };
  /** Wars, treaties, pacts and the neighbours' standing (M36). */
  diplomacy: DiplomacySummary | null;
  /** Weapons research, prototypes and trials (M37). */
  research: ResearchSummary | null;
  /** Forces away (M35): where to, how many, and when they arrive or are home. */
  expeditions: {
    id: number;
    to: number;
    name: string;
    state: 'out' | 'fighting' | 'back';
    /** Its battle is with the region (M36): it can't be called back until it answers. */
    settling: boolean;
    units: number;
    route: string;
    target: string;
    depart: number;
    arrive: number;
    home: number;
  }[];
}

/**
 * Whether computer neighbours may raid the city (M35): not a young or small one, except a
 * neighbour it struck within `RAIDS.retaliate` months, which may answer (the neighbours' ids).
 */
export function raidThreat(sim: Sim): { open: boolean; answering: number[] } {
  const s = sim.state;
  const w = s.war;
  const open = s.totals.population >= RAIDS.minPopulation && s.tick >= RAIDS.minMonths * TICKS_PER_MONTH;
  const answering = s.region.neighbours
    .filter(
      (n) =>
        n.rival && !n.player && s.tick - (w?.struck?.[n.id] ?? -Infinity) < RAIDS.retaliate * TICKS_PER_MONTH,
    )
    .map((n) => n.id);
  return { open, answering };
}

export function warSummary(sim: Sim, extraction: (c: Civic) => number): WarSummary | null {
  const s = sim.state;
  const w = s.war;
  if (!w) return null;
  const byGroup = Object.fromEntries(UNIT_CLASSES.map((g) => [g.id, 0])) as Record<UnitClass, number>;
  let strength = 0;
  for (const u of w.units.values()) {
    const def = UNIT.get(u.kind);
    if (!def) continue;
    byGroup[def.group]++;
    strength += def.strength * u.hp;
  }
  let jobs = 0;
  let filled = 0;
  let need = 0;
  let served = 0;
  let hq: number | null = null;
  let buildings = 0;
  const bases = militaryCivics(sim);
  for (const c of bases) {
    const m = militaryOf(c)!;
    jobs += m.jobs;
    filled += Math.round(m.jobs * Math.min(1, c.staff ?? 0));
    const p = militaryPowerNeed(sim, c);
    need += p;
    served += p * (c.powered ?? 0);
    if (m.hq && hq === null) hq = c.id;
    buildings += civicUpkeep(c);
  }
  const scale = sim.upkeepScale();
  const fund = fundingPct(s.economy, 'defence') / 100;
  const { free, local } = storeSupply(sim, extraction);
  const supply = { goods: 0, ore: 0, oil: 0, munitions: 0 };
  for (const m of MATERIALS) supply[m] = Math.round(free[m] + local[m]);
  const months = (tick: number) => Math.floor((s.tick - tick) / TICKS_PER_MONTH);
  return {
    readiness: w.readiness,
    target: Math.round(readinessTarget(sim) * 1000) / 1000,
    units: w.units.size,
    training: w.orders.size,
    strength: Math.round(strength * 10) / 10,
    byGroup,
    upkeep: {
      forces: Math.round(forcesUpkeep(sim) * fund * scale),
      buildings: Math.round(buildings * fund * scale),
    },
    funding: fundingPct(s.economy, 'defence'),
    stock: {
      goods: Math.floor(w.stock.goods),
      ore: Math.floor(w.stock.ore),
      oil: Math.floor(w.stock.oil),
      munitions: Math.floor(w.stock.munitions),
    },
    capacity: storeCapacity(sim),
    supply,
    bonds: w.bonds.map((b) => ({
      id: b.id,
      principal: b.principal,
      balance: Math.round(b.balance),
      payment: Math.round(b.payment),
      annualRate: b.annualRate,
      monthsLeft: Math.max(0, b.months - months(b.takenTick)),
    })),
    bondMood: Math.round(bondMood(sim) * 1000) / 1000,
    staff: { jobs, filled },
    power: { need: Math.round(need), served: Math.round(served) },
    hq,
    bases: bases.length,
    incoming: incomingSummary(w),
    battle: w.battle ? { id: w.battle.id, from: w.battle.raid.name, start: w.battle.start } : null,
    reports: [...(w.reports ?? [])].reverse(),
    threat: raidThreat(sim),
    routes: {
      rail: !!s.railway,
      sea: [...w.units.values()].some((u) => UNIT.get(u.kind)?.domain === 'sea'),
    },
    diplomacy: diplomacySummary(sim),
    research: researchSummary(sim),
    expeditions: (w.expeditions ?? []).map((e) => ({
      id: e.id,
      to: e.to,
      name: e.name,
      state: e.state,
      settling: !!e.settling,
      units: e.units.length,
      route: e.route,
      target: e.target,
      depart: e.depart,
      arrive: e.arrive,
      home: e.home,
    })),
  };
}

function incomingSummary(w: WarState): WarSummary['incoming'] {
  const r = (w.incoming ?? []).find((x) => x.warned);
  if (!r) return null;
  return {
    id: r.id,
    from: r.name,
    units: r.units.length,
    arrive: r.arrive,
    target: r.target,
    near: r.near ?? 0,
    sheltered: r.sheltered ?? 0,
  };
}

/** The roster for the page: every unit, and the training at each base (M34). */
export function forceData(sim: Sim): ForceData | null {
  const w = sim.state.war;
  if (!w) return null;
  const orders = [...w.orders.values()].sort((a, b) => a.id - b.id);
  return {
    units: [...w.units.values()]
      .sort((a, b) => a.id - b.id)
      .map((u) =>
        u.away
          ? { id: u.id, kind: u.kind, base: u.base, hp: u.hp, away: u.away }
          : { id: u.id, kind: u.kind, base: u.base, hp: u.hp },
      ),
    orders: orders.map((o) => {
      const c = sim.state.civics.get(o.base);
      const head = c && trainingAt(sim, c.id)?.id === o.id;
      return {
        id: o.id,
        kind: o.kind,
        base: o.base,
        done: o.done,
        hours: UNIT.get(o.kind)?.hours ?? 1,
        rate: head && c ? Math.round(trainingRate(sim, c, o.kind) * 1000) / 1000 : 0,
      };
    }),
    // Prototypes on trial at the proving grounds (M37), for the page to show them on the track.
    trials: (w.research?.trials ?? []).map((t) => ({
      ground: t.ground,
      kind: t.kind,
      done: t.done,
      hours: t.hours,
    })),
  };
}

/** A military building in the inspector (M34): staff, power, units, training and prices. */
export function militaryDetails(sim: Sim, c: Civic): MilitaryDetails {
  const m = militaryOf(c)!;
  const w = sim.state.war;
  const name = lowerName(CIVIC.get(c.def)!.name);
  const load = baseLoad(sim, c.id);
  const holds = holdsOf(sim, c);
  const full = load.units + load.orders >= holds;
  const units = w
    ? [...w.units.values()]
        .filter((u) => u.base === c.id)
        .sort((a, b) => a.id - b.id)
        .map((u) => ({ id: u.id, kind: u.kind, hp: u.hp }))
    : [];
  const training = w
    ? [...w.orders.values()]
        .filter((o) => o.base === c.id)
        .sort((a, b) => a.id - b.id)
        .map((o, i) => ({
          id: o.id,
          kind: o.kind,
          done: o.done,
          hours: UNIT.get(o.kind)?.hours ?? 1,
          rate: i === 0 ? Math.round(trainingRate(sim, c, o.kind) * 1000) / 1000 : 0,
        }))
    : [];
  const down = standDownReason(sim, c.x, c.z);
  const trains = (m.trains ?? []).map((kind) => {
    const def = UNIT.get(kind)!;
    const bill = unitBill(sim, kind);
    const why = !w
      ? 'War is off in this city'
      : unitLock(sim, kind)
        ? unitLock(sim, kind)
        : down
          ? down
          : full
            ? `The ${name} is full: it keeps ${holds} units`
            : !sim.state.options.sandbox && sim.state.treasury < bill.money + bill.imports
              ? 'Not enough money'
              : null;
    return { kind, cost: bill.money, imports: bill.imports, hours: def.hours, why };
  });
  const staff = c.staff ?? 0;
  const powered = c.powered ?? 0;
  let posts = 0;
  for (const o of militaryCivics(sim)) if (civicOnline(o)) posts += militaryOf(o)!.jobs;
  const spare = Math.floor(sim.state.totals.workers * WAR.enlistShare);
  const stalled = !training.length
    ? null
    : !civicOnline(c)
      ? 'Closed for repairs'
      : down
        ? down
        : staff < WAR.minStaffed
          ? posts > spare
            ? `Short of staff (${Math.round(staff * 100)} %): the forces may take a quarter of the city's workers (${formatInt(spare)}) and the bases have ${formatInt(posts)} posts; bases that started training sooner come first`
            : `Short of staff (${Math.round(staff * 100)} %): not enough residents looking for work nearby`
          : powered < 0.5
            ? 'Short of power'
            : null;
  return {
    jobs: m.jobs,
    staffed: Math.round(m.jobs * Math.min(1, staff)),
    power: Math.round(militaryPowerNeed(sim, c)),
    powered,
    holds,
    units,
    training,
    trains,
    stalled,
    hq: !!m.hq,
    shelters: m.shelters ?? 0,
    defends: m.defends ? { ...m.defends, against: [...m.defends.against] } : null,
    radar: m.radar ?? 0,
    safety: m.safety ? { ...m.safety } : null,
    noise: m.noise?.reach ?? m.runway ?? 0,
  };
}
