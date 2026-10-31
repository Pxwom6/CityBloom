/**
 * Live battles (M39, design calls 1, 3 and 4): what a battle fought while its orders arrive needs
 * beyond the battle itself. The region room stamps each player's orders at a step and numbers them
 * (`seq`); every page that fights the battle (the defender's sim, the attacker's battle worker, a
 * replay) feeds them to its `Battle` through the one function here, so each one keeps the same list
 * and the battle plays out the same everywhere. Pure and deterministic; nothing here keeps a clock.
 */
import type { BattleRoute } from '../../data/battle';
import type { UnitKind } from '../../data/war';
import { helperListProblem, orderListProblem } from './check';
import {
  BATTLE_V4,
  S,
  type BattleHelper,
  type BattleInput,
  type BattleMods,
  type BattleOrder,
  type BattleUnitIn,
  type OrderKind,
  type Side,
} from './types';

/**
 * An allied force as the region room stamped it into the battle's log (M39 step 6): who it is (the
 * helper city's place in the region is its owner), the side it fights on, the units it sends
 * (`owner * 10_000 + k` for ids, which keeps them clear of both cities' own), the step it arrives at
 * and the way it comes. The page that sent it is trusted for nothing but its units: the battle checks
 * them (`helperListProblem`) as it takes the entry, the same way on every page.
 */
export interface StampedHelper {
  owner: number;
  name: string;
  color: number;
  side: Side;
  units: { id: number; kind: UnitKind; hp: number }[];
  arrive: number;
  route?: BattleRoute;
  mods?: BattleMods;
}

/**
 * An order as the region room stamped it: `seq` its place in the battle's log, `step` where it
 * applies. An entry of kind `help` carries an allied force (`helper`) instead of an order: `side` is
 * the side it fights on, `step` the frontier it was stamped at (the battle takes it up there).
 */
export interface StampedOrder {
  seq: number;
  step: number;
  side: Side;
  kind: string;
  units?: number[];
  target?: number;
  helper?: StampedHelper;
}

/** What a page asks of its units (the room adds the side, the step and the number). */
export interface OrderRequest {
  kind: OrderKind;
  units?: number[];
  target?: number;
}

const KINDS: readonly string[] = ['withdraw', 'focus', 'guard', 'hold', 'free'];
const MOST_ORDERS_AT_ONCE = 300;

/** A stamped order as a battle's own, or null when it isn't one (an unknown kind, a bad side or number). */
export function battleOrderOf(o: StampedOrder): BattleOrder | null {
  if (!o || typeof o !== 'object') return null;
  if (!Number.isInteger(o.step) || (o.side !== 0 && o.side !== 1) || !KINDS.includes(o.kind)) return null;
  const out: BattleOrder = { step: o.step, side: o.side, kind: o.kind as OrderKind };
  if (o.units !== undefined) {
    if (!Array.isArray(o.units)) return null;
    out.units = [...o.units];
  }
  if (o.target !== undefined) out.target = o.target;
  return out;
}

/**
 * An allied force from the log as a battle's own helper, or null when it isn't one (a bad shape, a
 * side that isn't the entry's, an arrival before the step it was stamped at). Only known fields are
 * kept, and every unit is made over as a waiting unit with no base: the sender says which units, not where.
 */
export function battleHelperOf(o: StampedOrder): BattleHelper | null {
  const h = o?.helper;
  if (!h || typeof h !== 'object' || Array.isArray(h)) return null;
  if (!Number.isInteger(o.step) || o.step < 0 || h.side !== o.side || !Array.isArray(h.units)) return null;
  if (!Number.isInteger(h.arrive) || h.arrive < o.step) return null;
  const units: BattleUnitIn[] = [];
  for (const u of h.units) {
    if (!u || typeof u !== 'object') return null;
    units.push({ id: u.id, kind: u.kind, hp: u.hp, x: 0, z: 0, base: -1 });
  }
  const out: BattleHelper = {
    owner: h.owner,
    name: h.name,
    color: h.color,
    side: h.side,
    units,
    arrive: h.arrive,
    at: o.step,
  };
  if (h.route !== undefined) out.route = h.route;
  if (h.mods !== undefined) out.mods = structuredClone(h.mods);
  return out;
}

/**
 * Add the room's orders the battle hasn't seen to its input (`input.orders` is read by step as the
 * battle runs, so an order appended before its step is reached applies there). Orders are taken in
 * `seq` order and each only once: those at or below `seen` are skipped, so a page told the whole log
 * again (it came back to the battle) takes nothing twice. An order that isn't sound (a bad shape, or
 * one that would break the battle's limits) is left out the same way on every page; its number still
 * counts as seen. An allied force (kind `help`) goes to `input.helpers`, with the step it was stamped
 * at, when the battle can take it (at most three, none repeating an owner or a unit id). Returns the
 * highest number seen.
 */
export function appendOrders(input: BattleInput, seen: number, list: readonly StampedOrder[]): number {
  const structs = input.layout.structs.length / S.stride;
  const fresh = list.filter((o) => Number.isInteger(o?.seq) && o.seq > seen).sort((a, b) => a.seq - b.seq);
  for (const o of fresh.slice(0, MOST_ORDERS_AT_ONCE)) {
    seen = o.seq;
    if (o.kind === 'help') {
      const helper = battleHelperOf(o);
      if (helper && !helperListProblem(input, [...(input.helpers ?? []), helper]))
        (input.helpers ??= []).push(helper);
      continue;
    }
    const order = battleOrderOf(o);
    if (!order) continue;
    if (orderListProblem([...input.orders, order], structs)) continue;
    input.orders.push(order);
  }
  return seen;
}

/** A live battle's input is version 4 from the start: orders may be given to it while it runs. */
export function stampLive(input: BattleInput): BattleInput {
  input.v = BATTLE_V4;
  input.layout.v = BATTLE_V4;
  return input;
}

/** The battle as it was fought, to run again: its input with every order the room stamped in it. */
export function recordInput(input: BattleInput, orders: readonly StampedOrder[]): BattleInput {
  const out = structuredClone(input);
  out.orders = [];
  appendOrders(out, 0, orders);
  return stampLive(out);
}
