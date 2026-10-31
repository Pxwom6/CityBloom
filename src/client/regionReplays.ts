/**
 * The region's replays, a page's part (M39 step 7, design calls 8 and 10). The region room keeps the
 * last twenty live battles it saw end, as the defender's input with every order stamped in it, and
 * serves them to any of its cities (`breplay` answered by `breplaydata`). This page:
 *
 * - remembers which battles the region keeps (`rwelcome` and `bend` say), for the history list's
 *   Watch buttons;
 * - asks for one, and turns the record into a battle the viewer plays (`?battle=`): the record as a
 *   `BattleRecord` of this browser's (its final input, orders included, and the end it must reach), and
 *   the town it is shown in: this city's own copy if it fought the battle, else the region's latest
 *   save of the defender's city;
 * - keeps a replay's progress for the panel (`statusOf`).
 *
 * The viewer then runs the battle in the town's own sim, as it does any kept battle, and the game
 * checks where it ends against the record's end (`replayVerdict`).
 */
import type { LiveRecord } from '../../relay/live';
import type { RegionClientMsg, RegionRoomMsg, RegionView } from '../../relay/region';
import type { SaveFile } from '../sim/save';
import { checkBattleInput } from '../sim/battle/check';
import { inputOfRecord } from '../net/liveRecord';
import { expectOf, replayKey, replaysFrom, withReplay, type ReplayRef } from './regionHistory';
import type { BattleRecord } from './battles';

/** The room's answer to a replay asked for. */
export interface ReplaySink {
  /** A message from the room; true when it was a replay this page asked for (nothing else needs it). */
  message(m: RegionRoomMsg): boolean;
}

/** The region link, as replays use it (a `RegionLink`). */
export interface ReplayLink {
  readonly state: string;
  readonly slot: number;
  readonly view: RegionView | null;
  replays: ReplaySink | null;
  sendLive(m: RegionClientMsg): void;
  fetchSave(slot: number): Promise<SaveFile>;
}

/** What the page keeps battles in, and what it knows of the city. */
export interface ReplayEnv {
  cityName(): string;
  tick(): number;
  now(): number;
  loadTown(key: string): Promise<SaveFile | null>;
  keepTown(key: string, save: SaveFile): Promise<void>;
  keepBattle(record: BattleRecord): Promise<void>;
  /** The list of replays or a status changed: the panel redraws. */
  changed(): void;
}

/** How far a replay asked for has got, for the button that asked. */
export type ReplayStatus = { state: 'fetching'; what: string } | { state: 'error'; why: string };

/** The id a region replay is kept under in this browser (its attacker's place and the battle's id). */
export const replayRecordId = (from: number, id: string): string => `rep-${from}-${id}`.slice(0, 60);

/** The key of the town a region replay is shown in. */
export const replayTownKey = (from: number, id: string): string => `replay:${replayRecordId(from, id)}`;

/** Where this page keeps its own copy of a live battle's town: a defender's, an attacker's. */
const ownTownKey = (role: 'defender' | 'attacker', id: string): string =>
  role === 'defender' ? `replay:${`def-${id}`.slice(0, 60)}` : `player:${id}`;

/** How long to wait for the room to send a record before saying it is not kept (ms). */
export const FETCH_MS = 15_000;

interface Wait {
  resolve(r: LiveRecord): void;
  reject(e: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export class RegionReplays implements ReplaySink {
  private link: ReplayLink | null = null;
  private kept: ReplayRef[] = [];
  private waits = new Map<string, Wait>();
  private status = new Map<string, ReplayStatus>();

  constructor(private readonly env: ReplayEnv) {}

  attach(link: ReplayLink): void {
    this.detach();
    this.link = link;
    link.replays = this;
  }

  detach(): void {
    const link = this.link;
    if (link?.replays === this) link.replays = null;
    this.link = null;
    for (const [key, w] of this.waits) {
      clearTimeout(w.timer);
      w.reject(new Error('The city left the region'));
      this.waits.delete(key);
    }
    this.kept = [];
    this.status.clear();
    this.env.changed();
  }

  /** The battles the region keeps, oldest first. */
  list(): readonly ReplayRef[] {
    return this.kept;
  }

  statusOf(from: number, id: string): ReplayStatus | undefined {
    return this.status.get(replayKey(from, id));
  }

  // ---- The room's words ---------------------------------------------------------------------

  message(m: RegionRoomMsg): boolean {
    switch (m.t) {
      case 'rwelcome':
        this.kept = replaysFrom(m.replays);
        this.env.changed();
        return false;
      case 'bend':
        this.kept = withReplay(this.kept, m);
        this.env.changed();
        return false;
      case 'breplaydata': {
        const key = replayKey(m.from, m.id);
        const w = this.waits.get(key);
        if (!w) return false;
        this.waits.delete(key);
        clearTimeout(w.timer);
        w.resolve(m.record);
        return true;
      }
      default:
        return false;
    }
  }

  // ---- Asking -------------------------------------------------------------------------------

  /** The record of a battle, from the region (rejected if it doesn't keep it any more). */
  fetch(from: number, id: string, timeoutMs: number = FETCH_MS): Promise<LiveRecord> {
    const link = this.link;
    if (!link || link.state !== 'in') return Promise.reject(new Error('The city isn’t in the region now'));
    const key = replayKey(from, id);
    const had = this.waits.get(key);
    if (had) {
      clearTimeout(had.timer);
      had.reject(new Error('Asked again'));
    }
    return new Promise<LiveRecord>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waits.delete(key);
        reject(new Error('The region didn’t send that battle: it may not keep it any more'));
      }, timeoutMs);
      this.waits.set(key, { resolve, reject, timer });
      link.sendLive({ t: 'breplay', id, from });
    });
  }

  private nameOf(slot: number): string {
    return this.link?.view?.cities.find((c) => c.slot === slot)?.name ?? 'that city';
  }

  /**
   * Get a replay ready for the viewer: the record from the region, the town to show it in, both
   * kept in this browser. Resolves with the id the viewer opens (`?battle=`), or why it can't be.
   * The kept list loses the battle when the region says it doesn't keep it.
   */
  async prepare(
    ref: ReplayRef,
    timeoutMs: number = FETCH_MS,
  ): Promise<{ ok: true; id: string } | { ok: false; why: string }> {
    const key = replayKey(ref.from, ref.id);
    const say = (s: ReplayStatus | null) => {
      if (s) this.status.set(key, s);
      else this.status.delete(key);
      this.env.changed();
    };
    const fail = (why: string) => {
      say({ state: 'error', why });
      return { ok: false as const, why };
    };
    if (this.status.get(key)?.state === 'fetching')
      return { ok: false, why: 'That battle is already on its way' };
    say({ state: 'fetching', what: 'Asking the region for the battle' });
    let record: LiveRecord;
    try {
      record = await this.fetch(ref.from, ref.id, timeoutMs);
    } catch (err) {
      if (this.link?.state === 'in') this.kept = this.kept.filter((r) => replayKey(r.from, r.id) !== key);
      return fail(err instanceof Error ? err.message : String(err));
    }
    let input;
    try {
      input = inputOfRecord(record);
    } catch {
      return fail('The region’s record of that battle couldn’t be read');
    }
    if (checkBattleInput(input)) return fail('The region’s record of that battle couldn’t be read');
    // The town: this city's own copy when it fought the battle, else the region's latest save of
    // the defender's city (which may have changed since: the viewer says if the battle differs).
    say({ state: 'fetching', what: `Fetching ${this.nameOf(ref.to)}’s town` });
    let town: SaveFile | null = null;
    const mine = this.link?.slot;
    if (mine === ref.to) town = await this.env.loadTown(ownTownKey('defender', ref.id)).catch(() => null);
    else if (mine === ref.from)
      town = await this.env.loadTown(ownTownKey('attacker', ref.id)).catch(() => null);
    if (!town) {
      try {
        town = await this.link!.fetchSave(ref.to);
      } catch {
        return fail(`The region has no save of ${this.nameOf(ref.to)}’s city to show the battle in`);
      }
    }
    const townKey = replayTownKey(ref.from, ref.id);
    const id = replayRecordId(ref.from, ref.id);
    try {
      await this.env.keepTown(townKey, town);
      const expect = expectOf(ref);
      await this.env.keepBattle({
        id,
        city: this.env.cityName(),
        other: input.attacker.name,
        tick: this.env.tick(),
        input,
        townKey,
        savedAt: new Date(this.env.now()).toISOString(),
        region: { expect },
      });
    } catch {
      return fail('This browser couldn’t keep the battle to show it');
    }
    say(null);
    return { ok: true, id };
  }
}
