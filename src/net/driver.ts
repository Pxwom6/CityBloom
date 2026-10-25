/**
 * What a room session needs from the city it shares (M30): the worker in a real game (`SimClient`),
 * or a sim run in place for a headless test player (`HeadlessDriver`). Both report the same things.
 */
import type { Stamped } from '../sim/lockstep';
import { Lockstep } from '../sim/lockstep';
import type { SharedSnapshot } from '../sim/protocol';
import type { SaveFile } from '../sim/save';
import { Sim } from '../sim/sim';
import { partHashes } from '../sim/sync';
import { isMonthStart } from '../sim/time';
import type { SharedMessage } from '../client/simClient';

export interface SimDriver {
  share(player: number, lastSeq: number): void;
  stamped(events: Stamped[], allow: number): void;
  /** Join (`resync` false) or catch up a city already on screen (true). */
  loadShared(snapshot: SharedSnapshot, player: number, resync?: boolean): Promise<unknown>;
  unshare(): void;
  /** A save of the city as it stands (solo: settled). */
  save(): Promise<SaveFile>;
  onShared(l: (m: SharedMessage) => void): () => void;
  /** The sim's tick and how far behind the room it is, as last heard. */
  readonly tick: number;
}

/**
 * A sim run in this thread (Node or a page), fed like the worker: up to `budgetMs` of ticks every
 * `everyMs`, never dropping one. For headless test players and the soak test.
 */
export class HeadlessDriver implements SimDriver {
  lockstep: Lockstep | null = null;
  private listeners: ((m: SharedMessage) => void)[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private player = 0;
  private lastSum = 0;
  /** Slow this player down (ms of extra work per tick), to test waiting for a slow machine. */
  slowMs = 0;
  /** Stop running (as a frozen tab would). */
  frozen = false;
  /** Errors applying the room's events or running the city (F7), as the worker would post them. */
  errors: string[] = [];

  constructor(
    public sim: Sim,
    private readonly budgetMs = 20,
    everyMs = 50,
    private readonly monthHashes = false,
  ) {
    this.timer = setInterval(() => this.pump(), everyMs);
  }

  get tick(): number {
    return this.sim.tick;
  }

  get behind(): number {
    return this.lockstep?.behind ?? 0;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(m: SharedMessage): void {
    for (const l of this.listeners) l(m);
  }

  onShared(l: (m: SharedMessage) => void): () => void {
    this.listeners.push(l);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== l);
    };
  }

  private attach(lastSeq: number, eventHash?: number): void {
    const ls = new Lockstep(this.sim, lastSeq);
    if (eventHash !== undefined) ls.eventHash = eventHash;
    this.sim.viewer = this.player;
    this.lastSum = this.sim.tick;
    ls.onRebirth = () => {
      this.sim = ls.sim;
    };
    ls.onError = (what, err) =>
      this.errors.push(`${what.type} by ${what.by} at ${what.tick}: ${String(err)}`);
    ls.onApplied = (a) => {
      if (a.ev.kind === 'cmd') this.emit({ type: 'applied', list: [a] });
      else if (a.ev.kind === 'settle' && a.ev.taker === this.player && a.save)
        this.emit({
          type: 'snapshot',
          tick: a.tick,
          reason: a.ev.reason,
          snapshot: {
            save: a.save,
            rules: ls.sim.rules,
            history: ls.sim.historyState(),
            seq: a.seq,
            eventHash: ls.eventHash,
          },
        });
    };
    this.lockstep = ls;
  }

  share(player: number, lastSeq: number): void {
    this.player = player;
    this.sim.setHistoryState([]);
    this.attach(lastSeq);
    const ls = this.lockstep!;
    const save = ls.rebirth();
    this.emit({
      type: 'snapshot',
      tick: this.sim.tick,
      reason: 'upload',
      snapshot: { save, history: [], seq: lastSeq, eventHash: ls.eventHash },
    });
  }

  stamped(events: Stamped[], allow: number): void {
    const ls = this.lockstep;
    if (!ls) return;
    for (const e of events) if (ls.push(e) === 'late') this.emit({ type: 'late', tick: e.tick, seq: e.seq });
    ls.allow(allow);
  }

  async loadShared(snapshot: SharedSnapshot, player: number): Promise<void> {
    this.player = player;
    this.sim = Sim.fromSave(snapshot.save);
    this.sim.setHistoryState(snapshot.history);
    this.sim.rules = snapshot.rules ?? null;
    this.attach(snapshot.seq, snapshot.eventHash);
  }

  unshare(): void {
    this.sim.shared = false;
    this.lockstep = null;
  }

  async save(): Promise<SaveFile> {
    return this.sim.save('headless', !this.lockstep);
  }

  /** Run as the worker does: within the budget, emitting checksums and month hashes. */
  pump(): void {
    try {
      this.run();
    } catch (err) {
      this.errors.push(String(err));
    }
  }

  private run(): void {
    const ls = this.lockstep;
    if (!ls || this.frozen) return;
    const t0 = performance.now();
    if (ls.behind === 0 && ls.pending) ls.run(0);
    while (ls.behind > 0 && performance.now() - t0 < this.budgetMs) {
      ls.run(1);
      if (this.slowMs) {
        const until = performance.now() + this.slowMs;
        while (performance.now() < until) {
          /* a slow machine */
        }
      }
      if (this.monthHashes && isMonthStart(ls.sim.tick))
        this.emit({ type: 'monthHashes', tick: ls.sim.tick, parts: partHashes(ls.sim) });
    }
    for (const [tick, sum] of ls.checksums)
      if (tick > this.lastSum) {
        this.emit({ type: 'checksum', tick, sum });
        this.lastSum = tick;
      }
  }
}
