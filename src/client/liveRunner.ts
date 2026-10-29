/**
 * The attacker's side of a live battle (M39, design call 5): the same `Battle` the defender's city
 * hosts, run here from the input the region room gave both, fed the room's stamped orders and its
 * frontier as they arrive. It never steps to the frontier (the room lets a page run only below it),
 * and keeps the battle's pace, 16 steps a second as at 1×, unless it is far behind (a page that
 * came back to a battle on, or one the room has ended and this run only has to finish). Everything
 * here is pure but for the clock it is given, so the battle worker runs it and tests drive it by hand.
 */
import { LIVE } from '../../relay/protocol';
import { BATTLE } from '../data/battle';
import { awayResult } from '../sim/battle/away';
import { Battle } from '../sim/battle/battle';
import { appendOrders, type StampedOrder } from '../sim/battle/live';
import type { BattleFrame, BattleInput } from '../sim/battle/types';
import { SPEED_TICKS_PER_SECOND } from '../sim/time';
import type { AwayResult } from '../sim/systems/expeditions';

/** Steps a battle runs a second at 1×: the city's ticks a second times the battle's steps a tick. */
export const LIVE_STEPS_PER_SECOND = SPEED_TICKS_PER_SECOND[1] * BATTLE.stepsPerTick;

/** More than this many steps behind the frontier (two leads), a run catches up without waiting. */
const CATCH_UP = 2 * LIVE.lead;

/** What a finished live run says of itself. */
export interface LiveEnd {
  /** The battle's step and `hash()` at its end. */
  step: number;
  hash: string;
  /** The force's side of it, as the city is told. */
  result: AwayResult;
}

export class LiveRunner {
  readonly battle: Battle;
  /** The room's frontier as last given: steps below it may be run. */
  allow = 0;
  /** The last of the room's orders taken. */
  seen = 0;
  private last: number;
  private credit = 0;
  /** Run unpaced to the end (the room has ended this battle, or it is a record). */
  private rushing = false;

  constructor(
    readonly input: BattleInput,
    private readonly now: () => number,
  ) {
    this.battle = new Battle(input);
    this.last = now();
  }

  get step(): number {
    return this.battle.step;
  }

  get done(): boolean {
    return this.battle.outcome !== null;
  }

  /** The room's orders (those not taken yet) and frontier. */
  feed(orders: readonly StampedOrder[], allow: number): void {
    this.seen = appendOrders(this.input, this.seen, orders);
    if (allow > this.allow) this.allow = allow;
  }

  /** Run to the end as fast as the orders and frontier allow (the room has ended the battle). */
  rush(): void {
    this.rushing = true;
  }

  /** Run the steps that are due; returns how many ran. */
  pump(): number {
    const t = this.now();
    // Time spent waiting at the frontier is not owed: a run that was held up goes on at the battle's
    // pace, not in a burst.
    this.credit = Math.min(this.credit + (t - this.last) * LIVE_STEPS_PER_SECOND, 8_000);
    this.last = t;
    const b = this.battle;
    const free = this.allow - b.step;
    let n: number;
    if (this.rushing || free > CATCH_UP) n = free;
    else {
      // (The credit is in thousandths of a step, so a clock in whole milliseconds loses nothing.)
      n = Math.min(Math.floor(this.credit / 1000), free);
      this.credit -= Math.max(0, n) * 1000;
    }
    let ran = 0;
    for (; ran < n && !b.outcome; ran++) b.stepOnce();
    b.drain();
    return ran;
  }

  frame(): BattleFrame {
    return this.battle.frame();
  }

  /** How it ended, once it has. */
  end(): LiveEnd | null {
    const b = this.battle;
    if (!b.outcome) return null;
    return { step: b.step, hash: b.hash(), result: awayResult(this.input, b) };
  }
}

/**
 * A run's turn (the worker does this every 40 ms): the steps that are due, its picture every other
 * step, and its end when it has one. True once it has ended.
 */
export function pumpRun(
  run: LiveRunner,
  shown: { step: number },
  on: { frame(step: number, frame: BattleFrame): void; done(end: LiveEnd): void },
): boolean {
  run.pump();
  const end = run.end();
  if (end || run.step - shown.step >= 2) {
    shown.step = run.step;
    on.frame(run.step, run.frame());
  }
  if (end) on.done(end);
  return !!end;
}
