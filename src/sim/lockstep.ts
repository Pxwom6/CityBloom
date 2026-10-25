/**
 * Lockstep for shared cities (phase 4, M29). Every player runs the same sim; only commands travel,
 * each stamped by the room with the tick it applies at and a sequence number that orders commands
 * on the same tick. The room also says how far the sims may run (`allow`): it promises that every
 * event before that tick has been sent. This runner, used by the worker and by headless players,
 * applies each event at its tick, never drops a tick, and keeps an hourly checksum to compare.
 *
 * Pure and deterministic like the rest of `src/sim`: no clocks, no network. The caller decides how
 * many ticks to run at a time (the worker by its time budget, tests all at once).
 */
import type { Command, CommandResult } from './commands';
import type { Sim } from './sim';
import { checksum } from './sync';
import { TICKS_PER_HOUR } from './time';

/** What the room orders. */
export type RoomEvent =
  /** A player's command; `ref` is the issuer's own reference, so its result can go back to them. */
  | { kind: 'cmd'; cmd: Command; by: number; ref?: number }
  /**
   * Settle the city for a snapshot or an autosave: every player finishes the commute round under
   * way at this tick, so the one who saves and the ones who don't carry on alike. `taker` saves.
   */
  | { kind: 'settle'; taker: number; reason: 'snapshot' | 'autosave' };

export interface Stamped {
  tick: number;
  seq: number;
  ev: RoomEvent;
}

export interface Applied {
  tick: number;
  seq: number;
  ev: RoomEvent;
  /** For commands: what the sim said. */
  result?: CommandResult;
}

/** How many hourly checksums to keep (a game day's worth). */
const KEEP_CHECKSUMS = 48;

export class Lockstep {
  /** Events not yet applied, by tick then sequence. */
  private queue: Stamped[] = [];
  /** Every event before this tick is known: the sim may run up to it. */
  allowed: number;
  /** The last sequence number received (events arrive in order; repeats are ignored). */
  lastSeq: number;
  /** Checksums at the end of each recent game hour, by tick. */
  readonly checksums = new Map<number, string>();
  /** Called for every applied event (commands with their result; settles before the next event). */
  onApplied: ((a: Applied) => void) | null = null;
  /** Ticks run since this runner started (never fewer than the room asked for). */
  ticksRun = 0;
  /**
   * A running fingerprint of every event applied, with its tick and outcome: two players who
   * applied the same command at different ticks differ here at once, even before the city does.
   * Carried in snapshots.
   */
  eventHash = 0x811c9dc5;

  constructor(
    readonly sim: Sim,
    lastSeq = -1,
  ) {
    sim.shared = true;
    this.allowed = sim.tick;
    this.lastSeq = lastSeq;
  }

  /**
   * Queue an event from the room. `late` means it was stamped for a tick this sim has already
   * passed: the sims can no longer agree, and this player needs a snapshot.
   */
  push(e: Stamped): 'ok' | 'late' | 'repeat' {
    if (e.seq <= this.lastSeq) return 'repeat';
    this.lastSeq = e.seq;
    if (e.tick < this.sim.tick) return 'late';
    let i = this.queue.length;
    while (
      i > 0 &&
      (this.queue[i - 1]!.tick > e.tick ||
        (this.queue[i - 1]!.tick === e.tick && this.queue[i - 1]!.seq > e.seq))
    )
      i--;
    this.queue.splice(i, 0, e);
    return 'ok';
  }

  /** The room lets the sims run up to `tick` (exclusive of events still to come at `tick`). */
  allow(tick: number): void {
    if (tick > this.allowed) this.allowed = tick;
  }

  /** Ticks the room has allowed that this sim hasn't run yet. */
  get behind(): number {
    return Math.max(0, this.allowed - this.sim.tick);
  }

  /** Events waiting, for tests and the debug panel. */
  get pending(): number {
    return this.queue.length;
  }

  /** Run up to `maxTicks` ticks towards the allowed tick; returns how many ran. */
  run(maxTicks = Infinity): number {
    let n = 0;
    while (n < maxTicks && this.sim.tick < this.allowed) {
      this.applyDue();
      this.sim.step();
      n++;
      this.ticksRun++;
      if (this.sim.tick % TICKS_PER_HOUR === 0) {
        this.checksums.set(this.sim.tick, `${checksum(this.sim)}:${(this.eventHash >>> 0).toString(16)}`);
        if (this.checksums.size > KEEP_CHECKSUMS) this.checksums.delete(this.checksums.keys().next().value!);
      }
    }
    return n;
  }

  private noteEvent(e: Stamped, ok: boolean): void {
    let h = this.eventHash;
    for (const w of [e.tick, e.seq, ok ? 1 : 0]) h = Math.imul(h ^ w, 0x01000193);
    this.eventHash = h;
  }

  /** Apply every event stamped for the current tick, in sequence order. */
  private applyDue(): void {
    const t = this.sim.tick;
    while (this.queue.length && this.queue[0]!.tick === t) {
      const e = this.queue.shift()!;
      if (e.ev.kind === 'cmd') {
        const result = this.sim.dispatch(e.ev.cmd, e.ev.by);
        this.noteEvent(e, result.ok);
        this.onApplied?.({ tick: t, seq: e.seq, ev: e.ev, result });
      } else {
        this.sim.finishMatching();
        this.noteEvent(e, true);
        this.onApplied?.({ tick: t, seq: e.seq, ev: e.ev });
      }
    }
  }
}
