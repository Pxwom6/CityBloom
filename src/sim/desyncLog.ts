/**
 * What a shared city's worker keeps so a desync can be replayed (M41): where this machine's run of the
 * city started (the last snapshot it agreed on, or the city's founding when it was made here), the
 * room's events since, and its own hourly checksums. The page asks for it when the room says the
 * city fell out of step, before the catching-up snapshot replaces it; the report carries it to the
 * owner, and `scripts/desync.ts` replays it in Node to find where the hashes split.
 *
 * Pure, like the rest of `src/sim`. Bounded: past `DESYNC_LOG.events` events it stops recording and
 * says so (the report then carries the hashes without a replay).
 */
import type { CommandLogEntry } from './commands';
import type { Stamped } from './lockstep';
import type { GameOptions } from './state';
import type { SharedRules } from './rules';

export const DESYNC_LOG = {
  /** Events kept since the start; past this the replay is cut. */
  events: 3000,
  /** Hourly checksums kept (the most recent). */
  sums: 200,
  /** Commands before sharing kept for a city founded here. */
  pre: 2000,
};

/** The options a replay can found the city again with (never its name: checksums don't read it). */
export type FoundingOptions = Omit<Partial<GameOptions>, 'cityName' | 'editor'>;

export interface DesyncStart {
  /** The tick this run started at, and the room's last sequence number then. */
  tick: number;
  seq: number;
  /** The city's hourly checksum function at the start (`checksum`), to check a save given to a replay. */
  sum: string;
  /** The lockstep's event fingerprint at the start (hourly sums end with it). */
  eventHash: number;
  /** Who could do what at the start (players by number; no names). */
  rules: SharedRules | null;
  /** For a city founded on this machine with only its own commands before sharing: how to found it again. */
  founded?: FoundingOptions;
  /** Those commands (single player's log, each at its tick). */
  pre?: CommandLogEntry[];
}

export interface DesyncLogData {
  start: DesyncStart | null;
  events: Stamped[];
  /** Hourly checksums, oldest first. */
  sums: [number, string][];
  /** Events weren't all kept. */
  cut: boolean;
}

export class DesyncLog {
  private start: DesyncStart | null = null;
  private events: Stamped[] = [];
  private sums: [number, string][] = [];
  private cut = false;

  /** A new run: a snapshot loaded, or this machine's city shared. */
  begin(start: DesyncStart): void {
    this.start =
      start.pre && start.pre.length > DESYNC_LOG.pre
        ? { ...start, pre: undefined, founded: undefined }
        : start;
    this.events = [];
    this.sums = [];
    this.cut = false;
  }

  /** Not shared any more. */
  clear(): void {
    this.start = null;
    this.events = [];
    this.sums = [];
    this.cut = false;
  }

  event(e: Stamped): void {
    if (!this.start || this.cut) return;
    if (this.events.length >= DESYNC_LOG.events) {
      this.cut = true;
      this.events = [];
      return;
    }
    this.events.push(e);
  }

  sum(tick: number, sum: string): void {
    if (!this.start) return;
    this.sums.push([tick, sum]);
    if (this.sums.length > DESYNC_LOG.sums) this.sums.shift();
  }

  data(): DesyncLogData {
    return { start: this.start, events: this.events.slice(), sums: this.sums.slice(), cut: this.cut };
  }
}
