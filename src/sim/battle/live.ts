/**
 * Live battles (M39, design calls 1, 3 and 4): what a battle fought while its orders arrive needs
 * beyond the battle itself. The region room stamps each player's orders at a step and numbers them
 * (`seq`); every page that fights the battle (the defender's sim, the attacker's battle worker, a
 * replay) feeds them to its `Battle` through the one function here, so each one keeps the same list
 * and the battle plays out the same everywhere. Pure and deterministic; nothing here keeps a clock.
 */
import { orderListProblem } from './check';
import { BATTLE_V4, S, type BattleInput, type BattleOrder, type OrderKind, type Side } from './types';

/** An order as the region room stamped it: `seq` its place in the battle's log, `step` where it applies. */
export interface StampedOrder {
  seq: number;
  step: number;
  side: Side;
  kind: string;
  units?: number[];
  target?: number;
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
 * Add the room's orders the battle hasn't seen to its input (`input.orders` is read by step as the
 * battle runs, so an order appended before its step is reached applies there). Orders are taken in
 * `seq` order and each only once: those at or below `seen` are skipped, so a page told the whole log
 * again (it came back to the battle) takes nothing twice. An order that isn't sound (a bad shape, or
 * one that would break the battle's limits) is left out the same way on every page; its number still
 * counts as seen. Returns the highest number seen.
 */
export function appendOrders(input: BattleInput, seen: number, list: readonly StampedOrder[]): number {
  const structs = input.layout.structs.length / S.stride;
  const fresh = list.filter((o) => Number.isInteger(o?.seq) && o.seq > seen).sort((a, b) => a.seq - b.seq);
  for (const o of fresh.slice(0, MOST_ORDERS_AT_ONCE)) {
    seen = o.seq;
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
