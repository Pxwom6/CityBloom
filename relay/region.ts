/**
 * A shared region (M32): up to four players' cities side by side, each played on its owner's
 * machine at its own speed. Unlike a room, a region orders nothing: it keeps each city's latest
 * report (its offers, people, deals and a small picture), the region project's fund, and each city's
 * latest save for visitors, and passes the news on. Each city settles its deals every game month on
 * its own clock from what the others last reported, so an offline city's last offer stands.
 *
 * Runs in the local relay, a Durable Object (`/region/CODE`) and a host's browser alike.
 *
 * Within Cloudflare's free plan under abuse (F8): every connection is rate limited (generously:
 * honest cities report every half minute, and a burst of reports is never dropped); what's written
 * is throttled instead, each city's changes put together and written at a measured pace, never
 * lost; a city's save for visitors is kept at most every ten minutes; and the region stops writing
 * at a daily row budget and says when it may be forgotten (`expiresAt`).
 */
import type { RegionReport } from '../src/sim/systems/region';
import { DEAL_RESOURCES, NEIGHBOUR_KINDS } from '../src/data/region';
import {
  PEACE_RULES,
  UNIT,
  cleanWarRules,
  sameWarRules,
  warRulesText,
  type RegionWarRules,
  type UnitKind,
} from '../src/data/war';
import { SPY_OPS, spyOdds, spyOutcome, type SabotageTarget, type SpyOp } from '../src/data/intel';
import { BRANCHES, BRANCH_IDS, cleanTiers, type Branch, type TierKey } from '../src/data/research';
import {
  FRIENDS,
  LIVE,
  LIVE_PROTOCOL,
  MAX_SNAPSHOT_PARTS,
  MIN_REGION_PROTOCOL,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  SNAPSHOT_PART,
  boundedJson,
  cleanChat,
  cleanCityName,
  cleanName,
  makeSecret,
  secureIndex,
  type BattleOutcome,
  type FriendScale,
  type FriendsClientMsg,
  type FriendsRoomMsg,
  type FriendsWelcome,
  type WarEvent,
} from './protocol';
import { FriendsWar, type FriendsState, type FwContext, type FwOut } from './friendsWar';
import { DAY_MS, DailyRows, TokenBucket, dailyLimitText, type RowBudget } from './limits';
import {
  LiveSession,
  cleanLiveOrder,
  withinDepth,
  type LiveEnd,
  type LiveOrder,
  type LiveOrderIn,
  type LiveRecord,
  type LiveSide,
} from './live';
import type { RoomEnv } from './room';

export type { LiveEnd, LiveOrder, LiveOrderIn, LiveRecord, LiveSide } from './live';
export type { FriendsClientMsg, FriendsRoomMsg, FriendsWelcome } from './protocol';

export const MAX_CITIES = 4;
/** A newcomer may answer a city that raided it for this long (ms, M36), and battles seen are
 * remembered this many. */
export const RAID_ANSWER_MS = DAY_MS;
const SEEN_KEEP = 24;
/** Battles kept for a city at most (M35), and the parts one may come in. */
export const MAX_PENDING_BATTLES = 8;
const MAX_BATTLE_PARTS = 8;
/** Operations kept for a city at most (M37), apart from its battles, and verdicts a sender's kept. */
export const MAX_PENDING_OPS = 8;
const VERDICTS_KEEP = 24;
/**
 * The fair clock (M37, design call 15): a city's war clock may run at most this far ahead of the
 * hours the region has seen it play at 1× (a game hour is 7.5 s), and a report adds at most two
 * minutes' worth however long since the last.
 */
export const FAIR = { msPerHour: 7_500, gapMax: 120_000, bank: 48 };

/** What a friend's spy or the blackout tower does in another city of the region (M37). */
export type RegionOp = SpyOp | 'blackout';
export const REGION_OPS: readonly RegionOp[] = [...SPY_OPS, 'blackout'];
export type OpOutcome = 'success' | 'failed' | 'caught';

/** The region project: what it costs all told, and the power it gives its contributors (MW). */
export const REGION_PROJECT = { name: 'Sunfield Commons', goal: 600_000, power: 1_600 };
/** The biggest small picture of a city we keep (characters of a data URL). */
const MAX_THUMB = 40_000;

export interface RegionCityView {
  slot: number;
  name: string;
  mayor: string;
  color: number;
  online: boolean;
  report: RegionReport | null;
  thumb: string | null;
  /** Ms since the room last heard from it. */
  quietFor: number;
  /** A save of the city is kept for visitors. */
  visitable: boolean;
  /** Where war is allowed (M36): raids it may still take today (UTC), by the region's limit. */
  raidsLeft?: number;
  /** Cities that raided it lately (M36): it may answer them even as a newcomer. */
  raidedBy?: number[];
  /**
   * Where war is allowed (M37): spies it may still take today (UTC), and superweapons (a blackout or
   * a superweapon's battle; each is also one of its raids).
   */
  opsLeft?: number;
  supersLeft?: number;
  /** Its fair clock (M37): the war-clock hours the region has seen it play at 1×. */
  fair?: number;
}

export interface RegionProjectView {
  name: string;
  goal: number;
  total: number;
  /** Paid in by each city, by slot. */
  by: Record<number, number>;
  funded: boolean;
  /** The city that builds it (the biggest contributor when it was paid for), or 0. */
  host: number;
  built: boolean;
  power: number;
}

export interface RegionView {
  code: string;
  name: string;
  kind: 'online' | 'p2p' | 'local';
  cities: RegionCityView[];
  project: RegionProjectView;
  /** The city that made the region (M34): it sets the rules. */
  host: number;
  /** War in the region (M34): on or off, and the largest scale; set by the host. */
  rules: RegionWarRules;
}

export type RegionClientMsg =
  | {
      t: 'rhello';
      v: number;
      mayor: string;
      color: number;
      city: string;
      create?: { name: string; rules?: RegionWarRules };
      rejoin?: { slot: number; secret: string };
      /** Just looking (a visitor reading a city): no slot. */
      visitor?: boolean;
    }
  | { t: 'report'; city: string; report: RegionReport; thumb?: string }
  | { t: 'contribute'; amount: number }
  /** A save for visitors; `last` marks the one a city sends as its player leaves. */
  | { t: 'save'; id: string; part: number; parts: number; data: string; last?: true }
  | { t: 'visit'; slot: number }
  /** The host changes the region's war rules (M34). */
  | { t: 'rrules'; rules: RegionWarRules }
  /**
   * A battle fought against another city (M35), in parts: its input, kept for that city until it
   * says it has seen it (its own sim re-runs it and applies the damage).
   */
  | {
      t: 'battle';
      to: number;
      id: string;
      part: number;
      parts: number;
      data: string;
      /** Fought at half strength, as against a player who isn't here (M36). */
      away?: boolean;
      /**
       * It brings a superweapon (M37): set by the sender's page from the battle itself, counted in
       * the target's day and passed on (a target's sim takes nothing from an unflagged one).
       */
      super?: true;
    }
  /** `from`: the battle's sender (M36: two cities' battles may share an id). */
  | { t: 'battleSeen'; id: string; from?: number }
  /**
   * A force set off against another city of the region (M35): it's told, if its player is here; what
   * superweapon it brings, and whether it comes through the express gate (M37).
   */
  | { t: 'forceOut'; to: number; units: number; hours: number; super?: UnitKind; gate?: true }
  /**
   * An operation against another city of the region (M37): a spy's look, sabotage or theft, or the
   * blackout tower. The region decides it, and keeps it for its target until seen.
   */
  | { t: 'op'; to: number; id: string; op: RegionOp; target?: SabotageTarget; branch?: Branch }
  | { t: 'opSeen'; id: string; from: number }
  /**
   * Live battles (M39, protocol 6; design call 3). The attacker asks to fight `to`'s player live: its
   * force is opaque to the room, which goes through the checks a `battle` does, and calls the
   * defender if it's here. `super`: the force brings a superweapon.
   */
  | { t: 'blive'; to: number; id: string; force: object; super?: true }
  /** The defender's answer to a call: the battle input (opaque), in parts as a `battle` is. */
  | { t: 'binput'; id: string; part: number; parts: number; data: string }
  | { t: 'bdecline'; id: string }
  /**
   * A combatant's progress (how many steps its page has run), at least every few seconds, with the
   * orders its player gave since the last (the room adds the side and stamps the step).
   */
  | { t: 'bstep'; id: string; step: number; orders?: LiveOrderIn[] }
  /** A combatant's page reached the battle's end: its step and `hash()`. */
  | { t: 'bdone'; id: string; step: number; hash: string }
  /** A combatant comes back (or its page restarted): the battle from its input, and command again. */
  | { t: 'bjoin'; id: string }
  /** Any city: watch a battle (`from`: its attacker, if two battles share an id), and stop. */
  | { t: 'bwatch'; id: string; from?: number }
  | { t: 'bunwatch'; id: string; from?: number }
  /** Any city: a finished battle the region keeps, to watch again. */
  | { t: 'breplay'; id: string; from?: number }
  /**
   * Wars and treaties between friends (M39, protocol 6; design calls 9 and 10): declaring, proposing,
   * answering, ending a pact early, acknowledging a treaty, and how a battle ended. See `FriendsClientMsg`.
   */
  | FriendsClientMsg;

export type RegionRoomMsg =
  | {
      t: 'rwelcome';
      slot: number;
      secret: string;
      region: RegionView;
      /** Protocol 6: the finished live battles the region keeps (oldest first). */
      replays?: LiveReplay[];
      /**
       * Protocol 6: the wars, pacts and vassals between friends, this city's own proposals waiting,
       * and the war history (M39). Treaties it hasn't applied and proposals for it follow as `tsign`
       * and `tprop` messages.
       */
      friends?: FriendsWelcome;
    }
  | { t: 'region'; region: RegionView }
  | { t: 'citysave'; slot: number; part: number; parts: number; data: string }
  /**
   * A battle fought against this city (M35); `late`: kept while it was away and offered on its
   * return; `away` (M36): its player wasn't here when it came, so it does half the damage.
   */
  | {
      t: 'battle';
      from: number;
      id: string;
      part: number;
      parts: number;
      data: string;
      late: boolean;
      away?: boolean;
      /** It brings a superweapon, and the region counted it so (M37). */
      super?: true;
      /**
       * M39: a live battle this city's player wasn't here to see the end of: `data` is a
       * `LiveRecord` (JSON, in parts) with the orders stamped in it, not an encoded input.
       */
      live?: true;
    }
  /** The region keeps the battle a city sent until its target has seen it (M35). */
  | { t: 'battleKept'; id: string }
  /**
   * The region turned a battle away (M36): its target is neutral, a newcomer the sender may not
   * raid, has taken the day's raids or has as many waiting as it keeps, or war is off. `again`: its
   * player has left since it was fought: fight it again at half strength. `later`: not now (the
   * region's pace): ask again after this many ms.
   */
  | { t: 'battleRefused'; id: string; reason: string; again?: boolean; later?: number }
  /** Another city's force is on its way to this one (M35): `hours` of the sender's game time. */
  | { t: 'incoming'; from: number; units: number; hours: number; super?: UnitKind; gate?: true }
  /**
   * The region's verdict on an operation this city sent (M37): kept (its outcome, and the tier whose
   * points a theft took), or turned away (`later`: not now, the region's pace; ask again then).
   */
  | { t: 'opKept'; id: string; outcome: OpOutcome; stole?: TierKey }
  | { t: 'opRefused'; id: string; reason: string; later?: number }
  /**
   * An operation against this city (M37), as the region decided it; `late`: kept while its player
   * was away (or left before seeing it): it brings only a notice.
   */
  | {
      t: 'opOn';
      from: number;
      id: string;
      op: RegionOp;
      outcome: OpOutcome;
      target?: SabotageTarget;
      late: boolean;
    }
  /**
   * Live battles (M39, protocol 6). A call to this city: `from` wants to fight its player live with
   * this force; answer with `binput` (the battle's input) or `bdecline` within `LIVE.call`.
   */
  | { t: 'bcall'; id: string; from: number; force: object; super?: true }
  /**
   * The live call is off: for the attacker, fight the old way (a `battle`), unless `refused`: the
   * region won't take this battle at all (`later`: ask again after this many ms); `gone`: the battle
   * you speak of isn't one the region has (it ended, or the room restarted): carry on with what you
   * have. For a defender, forget the call.
   */
  | { t: 'bliveoff'; id: string; why: string; refused?: true; later?: number; gone?: true }
  /**
   * A live battle starts for this page (or the page comes back to it): `role`, the attacker's and
   * defender's slots, the defender's input (as it was sent, in parts), the frontier, every order
   * stamped so far, and the sides handed over. Pages run steps below `allow`.
   */
  | {
      t: 'bstart';
      id: string;
      role: 'attacker' | 'defender' | 'watcher';
      attacker: number;
      defender: number;
      input: string[];
      allow: number;
      orders: LiveOrder[];
      handed: LiveSide[];
    }
  /** The frontier moved, or orders were stamped (in the order of their `seq`). */
  | { t: 'ballow'; id: string; allow: number; ords?: LiveOrder[] }
  /**
   * The battle is over: the step and `hash()` of the defender's run (the truth for its city; the
   * attacker's if it was the only one to report), whether both agreed, and why if it was cut short.
   */
  | {
      t: 'bend';
      id: string;
      from: number;
      to: number;
      step: number;
      hash: string;
      agree: boolean;
      solo?: true;
      abandoned?: true;
    }
  /** A live battle started in the region (to every city but its combatants), to watch. */
  | { t: 'blivenow'; id: string; from: number; to: number }
  /** A finished battle's record, asked for (`breplay`) or owed to a combatant who wasn't here at its end. */
  | { t: 'breplaydata'; id: string; from: number; to: number; record: LiveRecord }
  | { t: 'notice'; text: string }
  /** Wars and treaties between friends (M39, protocol 6): see `FriendsRoomMsg`. */
  | Exclude<FriendsRoomMsg, { t: 'notice' }>
  | {
      t: 'error';
      /** `closed`: the region shut for good (a peer-to-peer host's browser left, F10). */
      code:
        'version' | 'no-region' | 'full' | 'exists' | 'bad-message' | 'no-save' | 'rate' | 'limit' | 'closed';
      text: string;
    };

/**
 * A region's surroundings: a room's clock and timers, and (M37) the dice it rolls friends' spies
 * with, a whole number in [0, 1000): `crypto.getRandomValues` unless a test fixes it.
 */
export interface RegionEnv extends RoomEnv {
  roll?(): number;
}

export interface RegionConn {
  send(m: RegionRoomMsg): void;
  close(code: number, reason: string): void;
  /** The city this connection speaks for, and the protocol its page said (kept through hibernation). */
  bind?(slot: number, v?: number): void;
  /** May this connection make a region (F8)? As a room's `Conn.mayCreate`. */
  mayCreate?: boolean;
}

interface City {
  slot: number;
  name: string;
  mayor: string;
  color: number;
  secret: string;
  report: RegionReport | null;
  thumb: string | null;
  heard: number;
  /** A save of it is kept for visitors. */
  saved?: boolean;
  /** When that save was last kept (ms; F8). */
  savedAt?: number;
  /**
   * Battles fought against it that it hasn't seen yet (M35): id, attacker, when, store row, and
   * whether its player was away when it came (M36).
   */
  pending?: {
    id: string;
    from: number;
    at: number;
    k: number;
    away?: boolean;
    super?: true;
    /** A live battle (M39): the row is a `LiveRecord`. */
    live?: true;
  }[];
  /** Raids it took on a UTC day (M36): the day's number and how many. */
  raids?: { day: number; n: number };
  /** When each other city last raided it (ms, M36): a newcomer may answer those. */
  raidedBy?: Record<number, number>;
  /** Battles it has seen lately (M36, `sender slot:id`): one sent again isn't counted again. */
  seen?: string[];
  /**
   * Operations against it it hasn't seen yet (M37), kept in the region's record (no rows of their
   * own): the sender, what, the region's verdict, and when.
   */
  ops?: { id: string; from: number; op: RegionOp; outcome: OpOutcome; target?: SabotageTarget; at: number }[];
  /** Spies it took on a UTC day (saboteurs among them), and superweapons (M37). */
  spied?: { day: number; n: number; sabotage: number };
  supers?: { day: number; n: number };
  /** The region's verdicts on its own last operations (M37): one sent again gets the same answer. */
  verdicts?: { id: string; to: number; op: RegionOp; outcome: OpOutcome; stole?: TierKey }[];
  /** Its fair clock (M37): war-clock hours at 1× while its player is here, and when last moved (ms). */
  fair?: { hours: number; at: number };
  /** Live battles it attacked in that ended while it wasn't here (M39): their ends are owed to it. */
  liveOwed?: string[];
  /** The protocol its page last said (M39): a war with a friend needs two pages that speak it. */
  v?: number;
}

/** A finished live battle the region keeps (M39): who fought, how it ended, and where its record is. */
export interface LiveReplay {
  id: string;
  from: number;
  to: number;
  step: number;
  hash: string;
  agree: boolean;
  solo?: true;
  abandoned?: true;
  /** Its row (0 to `LIVE.replays` − 1; the region's, not a city's). */
  k: number;
}

export interface RegionMeta {
  code: string;
  name: string;
  kind: RegionView['kind'];
  nextSlot: number;
  cities: City[];
  project: { total: number; by: Record<number, number>; host: number; built: boolean };
  /** The city that made it, which sets its rules (M34); older records: slot 1. */
  host?: number;
  /** War in the region (M34); older records: peace. */
  rules?: RegionWarRules;
  /** Finished live battles, oldest first (M39): their records are rows of the region's own. */
  replays?: LiveReplay[];
  /** Wars, pacts, proposals and vassals between friends, and the treaties each city hasn't applied (M39). */
  friends?: FriendsState;
  /** The last 100 war events, oldest first (M39, design call 10). */
  history?: WarEvent[];
  /** When the record was last saved (ms): the region expires a while after (F8). */
  lastActive?: number;
  /** Rows written today (F8). */
  budget?: RowBudget;
}

export interface RegionStore {
  loadMeta(): RegionMeta | null;
  saveMeta(m: RegionMeta): void;
  saveCity(slot: number, parts: string[]): void;
  loadCity(slot: number): string[] | null;
  /** Battles kept for a city that hasn't seen them (M35): `k` 0–7, a row of its own each. */
  saveBattle(slot: number, k: number, parts: string[]): void;
  loadBattle(slot: number, k: number): string[] | null;
  deleteBattle(slot: number, k: number): void;
  /** Forget the region (it expired). */
  deleteAll(): void;
  /** Rows written so far, as a Durable Object's SQLite counts them. */
  readonly rowsWritten: number;
}

export class MemoryRegionStore implements RegionStore {
  meta: RegionMeta | null = null;
  saves = new Map<number, string[]>();
  rowsWritten = 0;
  loadMeta() {
    return this.meta ? (JSON.parse(JSON.stringify(this.meta)) as RegionMeta) : null;
  }
  saveMeta(m: RegionMeta) {
    this.rowsWritten++;
    this.meta = JSON.parse(JSON.stringify(m)) as RegionMeta;
  }
  saveCity(slot: number, parts: string[]) {
    // Each part upserted, and the old parts past the new count deleted (`relay/sqlStore.ts`).
    this.rowsWritten += parts.length + Math.max(0, (this.saves.get(slot)?.length ?? 0) - parts.length);
    this.saves.set(slot, parts.slice());
  }
  loadCity(slot: number) {
    return this.saves.get(slot) ?? null;
  }
  battles = new Map<string, string[]>();
  saveBattle(slot: number, k: number, parts: string[]) {
    this.rowsWritten += parts.length;
    this.battles.set(`${slot}:${k}`, parts.slice());
  }
  loadBattle(slot: number, k: number) {
    return this.battles.get(`${slot}:${k}`) ?? null;
  }
  deleteBattle(slot: number, k: number) {
    if (this.battles.delete(`${slot}:${k}`)) this.rowsWritten++;
  }
  deleteAll() {
    this.meta = null;
    this.saves.clear();
    this.battles.clear();
  }
}

/** What one connection may send, and what the region may write (F8). */
export interface RegionLimits {
  /** Messages a second per connection and a burst: past it they're dropped; past twice it, closed. */
  rate: number;
  burst: number;
  /** Writes a second one city's changes may cause, and a burst; more are put together. */
  writeRate: number;
  writeBurst: number;
  /** Changes that don't matter to the other cities (numbers, pictures) are written this often (ms). */
  keepEvery: number;
  /** A city's save for visitors is kept at most this often (ms). */
  saveEvery: number;
  /** A connection may read a city's save this often (ms). */
  visitEvery: number;
  /** A city may send another city a battle this often (ms), with a few at once (M35). */
  battleEvery: number;
  battleBurst: number;
  /** Raids a city may take in a UTC day, from all the others together (M36). */
  raidsPerDay: number;
  /**
   * M37: spies a city may take in a UTC day (saboteurs among them), and superweapons (blackouts and
   * superweapons' battles, each one of its raids too); each sender's operations, one every so often
   * (ms) with a few at once.
   */
  opsPerDay: number;
  sabotagePerDay: number;
  supersPerDay: number;
  opEvery: number;
  opBurst: number;
  /** Rows the region may write in a UTC day. */
  dailyRows: number;
  /** How long a region nobody comes back to is kept (ms). */
  ttl: number;
  /** Connections at once. */
  maxConns: number;
}

/** Online defaults. Four honest cities write about a hundred rows an hour. */
export const REGION_LIMITS: RegionLimits = {
  rate: 2,
  burst: 60,
  writeRate: 1 / 30,
  writeBurst: 4,
  keepEvery: 5 * 60_000,
  saveEvery: 10 * 60_000,
  visitEvery: 30_000,
  battleEvery: 5 * 60_000,
  battleBurst: 3,
  raidsPerDay: 3,
  opsPerDay: 4,
  sabotagePerDay: 1,
  supersPerDay: 1,
  opEvery: 2 * 60_000,
  opBurst: 3,
  dailyRows: 3000,
  ttl: 60 * DAY_MS,
  maxConns: 16,
};

/** Past the day's budget, the record is still saved as the region empties, but at most this often. */
const OVER_BUDGET_SAVE = 10 * 60_000;

interface ConnState {
  /** The city it speaks for (0: a visitor, or not said hello yet). */
  slot: number;
  /** The protocol its page speaks (M39: live battles need `LIVE_PROTOCOL`). */
  v: number;
  hello: boolean;
  all: TokenBucket;
  visits: TokenBucket;
  /** Order of opening, to drop the oldest silent socket when full. */
  n: number;
  /** The save of a city whose player is leaving (M35): kept whatever the pace, once a connection. */
  lastSave?: string;
  lastUsed?: boolean;
}

/** A small count in words, as the region's refusals say it. */
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number) => WORDS[n] ?? String(n);

const finite = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const wholeIn = (v: unknown, lo: number, hi: number): v is number => finite(v, lo, hi) && Number.isInteger(v);
const ID = /^[\w-]{1,40}$/;
const FRIEND_SCALES: readonly FriendScale[] = ['skirmish', 'war', 'total'];
const BATTLE_OUTCOMES: readonly BattleOutcome[] = ['raided', 'repelled', 'withdrew'];

/** A city's report, checked for shape and bounds (the cities are friends', but a bug shouldn't spread). */
function cleanReport(r: unknown): RegionReport | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (!finite(o.population, 0, 1e8) || !NEIGHBOUR_KINDS.includes(o.kind as never)) return null;
  for (const k of ['workers', 'jobs', 'shoppers'] as const) if (!finite(o[k], 0, 1e8)) return null;
  const offers = o.offers as Record<string, Record<string, unknown>> | undefined;
  if (!offers) return null;
  for (const dir of ['buy', 'sell'])
    for (const res of DEAL_RESOURCES) if (!finite(offers[dir]?.[res], 0, 1e7)) return null;
  if (!Array.isArray(o.deals) || o.deals.length > 24) return null;
  for (const d of o.deals as Record<string, unknown>[])
    if (
      !finite(d.slot, 1, 64) ||
      !DEAL_RESOURCES.includes(d.resource as never) ||
      (d.direction !== 'buy' && d.direction !== 'sell') ||
      !finite(d.amount, 0, 1e7)
    )
      return null;
  // War (M37): optional, but checked when there.
  if (o.tiers !== undefined && !cleanTiers(o.tiers)) return null;
  if (o.counter !== undefined && !wholeIn(o.counter, 0, 1000)) return null;
  if (o.coast !== undefined && o.coast !== true) return null;
  if (o.clock !== undefined && !wholeIn(o.clock, 0, 1e9)) return null;
  return {
    population: o.population as number,
    kind: o.kind as RegionReport['kind'],
    offers: {
      buy: { ...(offers.buy as RegionReport['offers']['buy']) },
      sell: { ...(offers.sell as RegionReport['offers']['sell']) },
    },
    workers: o.workers as number,
    jobs: o.jobs as number,
    shoppers: o.shoppers as number,
    deals: (o.deals as RegionReport['deals']).map((d) => ({ ...d })),
    projectBuilt: o.projectBuilt === true,
    ...(o.shield === 'new' || o.shield === 'neutral' ? { shield: o.shield } : {}),
    // War (M37): research tiers, counter-intelligence, a coast, the war clock.
    ...(o.tiers !== undefined ? { tiers: [...(o.tiers as number[])] } : {}),
    ...(o.counter !== undefined ? { counter: o.counter as number } : {}),
    ...(o.coast === true ? { coast: true as const } : {}),
    ...(o.clock !== undefined ? { clock: o.clock as number } : {}),
  };
}

export function parseRegionMsg(raw: string): RegionClientMsg | null {
  if (raw.length > 300_000) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.t) {
    case 'rhello': {
      const mayor = cleanName(m.mayor);
      const city = typeof m.city === 'string' ? cleanCityName(m.city) : null;
      if (!finite(m.v, 0, 1e6) || !mayor || city === null || !finite(m.color, 0, PLAYER_COLORS.length - 1))
        return null;
      const out: RegionClientMsg = { t: 'rhello', v: m.v as number, mayor, color: m.color as number, city };
      if (m.create !== undefined) {
        const c = m.create as Record<string, unknown>;
        if (typeof c?.name !== 'string') return null;
        out.create = { name: cleanCityName(c.name) };
        if (c.rules !== undefined) {
          const rules = cleanWarRules(c.rules);
          if (!rules) return null;
          out.create.rules = rules;
        }
      }
      if (m.rejoin !== undefined) {
        const r = m.rejoin as Record<string, unknown>;
        if (!finite(r?.slot, 1, 64) || typeof r.secret !== 'string' || r.secret.length > 64) return null;
        out.rejoin = { slot: r.slot as number, secret: r.secret };
      }
      if (m.visitor === true) out.visitor = true;
      return out;
    }
    case 'report': {
      const report = cleanReport(m.report);
      if (!report || typeof m.city !== 'string') return null;
      if (
        m.thumb !== undefined &&
        (typeof m.thumb !== 'string' || m.thumb.length > MAX_THUMB || !m.thumb.startsWith('data:image/'))
      )
        return null;
      return {
        t: 'report',
        city: cleanCityName(m.city),
        report,
        ...(m.thumb ? { thumb: m.thumb as string } : {}),
      };
    }
    case 'contribute':
      return finite(m.amount, 1, 1e8) ? { t: 'contribute', amount: Math.round(m.amount as number) } : null;
    case 'save':
      if (
        typeof m.id !== 'string' ||
        m.id.length > 40 ||
        !finite(m.parts, 1, MAX_SNAPSHOT_PARTS) ||
        !finite(m.part, 0, (m.parts as number) - 1)
      )
        return null;
      if (typeof m.data !== 'string' || m.data.length > SNAPSHOT_PART) return null;
      return {
        t: 'save',
        id: m.id,
        part: m.part as number,
        parts: m.parts as number,
        data: m.data,
        ...(m.last === true ? { last: true as const } : {}),
      };
    case 'visit':
      return finite(m.slot, 1, 64) ? { t: 'visit', slot: m.slot as number } : null;
    case 'rrules': {
      const rules = cleanWarRules(m.rules);
      return rules ? { t: 'rrules', rules } : null;
    }
    case 'battle':
      if (
        !finite(m.to, 1, 64) ||
        typeof m.id !== 'string' ||
        !/^[\w-]{1,40}$/.test(m.id) ||
        !finite(m.parts, 1, MAX_BATTLE_PARTS) ||
        !finite(m.part, 0, (m.parts as number) - 1) ||
        typeof m.data !== 'string' ||
        m.data.length > SNAPSHOT_PART
      )
        return null;
      return {
        t: 'battle',
        to: m.to as number,
        id: m.id,
        part: m.part as number,
        parts: m.parts as number,
        data: m.data,
        ...(m.away === true ? { away: true } : {}),
        ...(m.super === true ? { super: true as const } : {}),
      };
    case 'battleSeen':
      return typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id)
        ? { t: 'battleSeen', id: m.id, ...(finite(m.from, 1, 64) ? { from: m.from as number } : {}) }
        : null;
    case 'forceOut':
      if (m.super !== undefined && !UNIT.get(m.super as UnitKind)?.super) return null;
      return finite(m.to, 1, 64) && finite(m.units, 1, 24) && finite(m.hours, 0, 72)
        ? {
            t: 'forceOut',
            to: m.to as number,
            units: Math.round(m.units as number),
            hours: m.hours as number,
            ...(m.super !== undefined ? { super: m.super as UnitKind } : {}),
            ...(m.gate === true ? { gate: true as const } : {}),
          }
        : null;
    case 'op': {
      if (!wholeIn(m.to, 1, 64) || typeof m.id !== 'string' || !ID.test(m.id)) return null;
      if (!REGION_OPS.includes(m.op as RegionOp)) return null;
      const op = m.op as RegionOp;
      // A saboteur's target, and a thief's branch: each only with its operation.
      if (op === 'sabotage' ? m.target !== 'power' && m.target !== 'depot' : m.target !== undefined)
        return null;
      if (op === 'steal' ? !BRANCH_IDS.includes(m.branch as Branch) : m.branch !== undefined) return null;
      return {
        t: 'op',
        to: m.to,
        id: m.id,
        op,
        ...(op === 'sabotage' ? { target: m.target as SabotageTarget } : {}),
        ...(op === 'steal' ? { branch: m.branch as Branch } : {}),
      };
    }
    case 'opSeen':
      return typeof m.id === 'string' && ID.test(m.id) && wholeIn(m.from, 1, 64)
        ? { t: 'opSeen', id: m.id, from: m.from }
        : null;
    // Live battles (M39): the room reads their shape and size, never what they mean.
    case 'blive': {
      if (!wholeIn(m.to, 1, 64) || typeof m.id !== 'string' || !ID.test(m.id)) return null;
      const f = m.force;
      if (!f || typeof f !== 'object' || Array.isArray(f) || !withinDepth(f)) return null;
      if (JSON.stringify(f).length > LIVE.forceChars) return null;
      return {
        t: 'blive',
        to: m.to,
        id: m.id,
        force: f,
        ...(m.super === true ? { super: true as const } : {}),
      };
    }
    case 'binput':
      if (
        typeof m.id !== 'string' ||
        !ID.test(m.id) ||
        !wholeIn(m.parts, 1, LIVE.inputParts) ||
        !wholeIn(m.part, 0, (m.parts as number) - 1) ||
        typeof m.data !== 'string' ||
        m.data.length > SNAPSHOT_PART
      )
        return null;
      return { t: 'binput', id: m.id, part: m.part as number, parts: m.parts as number, data: m.data };
    case 'bdecline':
    case 'bjoin':
      return typeof m.id === 'string' && ID.test(m.id) ? { t: m.t, id: m.id } : null;
    case 'bwatch':
    case 'bunwatch':
    case 'breplay':
      if (typeof m.id !== 'string' || !ID.test(m.id)) return null;
      if (m.from !== undefined && !wholeIn(m.from, 1, 64)) return null;
      return { t: m.t, id: m.id, ...(m.from !== undefined ? { from: m.from as number } : {}) };
    case 'bstep': {
      if (typeof m.id !== 'string' || !ID.test(m.id) || !wholeIn(m.step, 0, 1e6)) return null;
      const out: Extract<RegionClientMsg, { t: 'bstep' }> = { t: 'bstep', id: m.id, step: m.step };
      if (m.orders !== undefined) {
        if (!Array.isArray(m.orders) || m.orders.length > LIVE.perMessage) return null;
        const orders: LiveOrderIn[] = [];
        for (const o of m.orders) {
          const c = cleanLiveOrder(o);
          if (!c) return null;
          orders.push(c);
        }
        if (orders.length) out.orders = orders;
      }
      return out;
    }
    case 'bdone':
      return typeof m.id === 'string' &&
        ID.test(m.id) &&
        wholeIn(m.step, 0, 1e6) &&
        typeof m.hash === 'string' &&
        /^[\w-]{1,64}$/.test(m.hash)
        ? { t: 'bdone', id: m.id, step: m.step, hash: m.hash }
        : null;
    // Wars and treaties between friends (M39): the room reads their shape, and the module what they mean.
    case 'wdeclare':
      if (
        !wholeIn(m.to, 1, 64) ||
        !FRIEND_SCALES.includes(m.scale as FriendScale) ||
        typeof m.reason !== 'string' ||
        m.reason.length > 400
      )
        return null;
      return {
        t: 'wdeclare',
        to: m.to,
        scale: m.scale as FriendScale,
        reason: cleanChat(m.reason) ?? '',
        ...(m.breakPact === true ? { breakPact: true as const } : {}),
      };
    case 'tprop':
      if (
        !wholeIn(m.to, 1, 64) ||
        typeof m.id !== 'string' ||
        !ID.test(m.id) ||
        !Array.isArray(m.terms) ||
        m.terms.length < 1 ||
        m.terms.length > 2 * FRIENDS.maxTerms ||
        !m.terms.every((x) => x && typeof x === 'object' && !Array.isArray(x) && boundedJson(x)) ||
        JSON.stringify(m.terms).length > 4_000
      )
        return null;
      return {
        t: 'tprop',
        id: m.id,
        to: m.to,
        terms: m.terms as unknown[],
        ...(m.imposed === true ? { imposed: true as const } : {}),
      };
    case 'tans':
      return typeof m.id === 'string' && ID.test(m.id) && typeof m.accept === 'boolean'
        ? { t: 'tans', id: m.id, accept: m.accept }
        : null;
    case 'tbreak':
      return wholeIn(m.pact, 1, 1e9) ? { t: 'tbreak', pact: m.pact } : null;
    case 'tseen':
      return typeof m.id === 'string' && ID.test(m.id) ? { t: 'tseen', id: m.id } : null;
    case 'battleResult':
      if (
        typeof m.id !== 'string' ||
        !ID.test(m.id) ||
        !wholeIn(m.from, 1, 64) ||
        !wholeIn(m.to, 1, 64) ||
        !BATTLE_OUTCOMES.includes(m.outcome as BattleOutcome) ||
        (m.decisive !== undefined && !finite(m.decisive, 0, 1)) ||
        (m.worth !== undefined && !finite(m.worth, 0, 1e9))
      )
        return null;
      return {
        t: 'battleResult',
        id: m.id,
        from: m.from,
        to: m.to,
        outcome: m.outcome as BattleOutcome,
        ...(m.decisive !== undefined ? { decisive: Math.round((m.decisive as number) * 100) / 100 } : {}),
        ...(m.worth !== undefined ? { worth: Math.round(m.worth as number) } : {}),
        ...(m.seatDown === true ? { seatDown: true as const } : {}),
        ...(m.away === true ? { away: true as const } : {}),
      };
    default:
      return null;
  }
}

/** A live battle the room keeps (M39): its state, and the connections watching it. */
interface LiveRun {
  s: LiveSession;
  watchers: Set<RegionConn>;
}

/** What a page says in a live battle (M39). */
const LIVE_MESSAGES = new Set<string>([
  'blive',
  'binput',
  'bdecline',
  'bstep',
  'bdone',
  'bjoin',
  'bwatch',
  'bunwatch',
  'breplay',
]);

/** What a page says about wars and treaties with friends (M39): only pages that speak protocol 6 are heard. */
const FRIEND_MESSAGES = new Set<string>(['wdeclare', 'tprop', 'tans', 'tbreak', 'tseen', 'battleResult']);

/** A live battle is known by its attacker and its id (two cities' battles may share an id). */
const liveKey = (from: number, id: string) => `${from}:${id}`;

/** Finished battles' records are rows beside the cities' battles, in slots no city has. */
const REPLAY_SLOT = MAX_CITIES + 1;
const replayRow = (k: number): [number, number] => [REPLAY_SLOT + (k >> 3), k & 7];

/** Text cut into parts of at most `size` characters (one at least). */
function chunks(text: string, size = SNAPSHOT_PART): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out.length ? out : [''];
}

export class RegionRoom {
  private meta: RegionMeta | null;
  private conns = new Map<RegionConn, ConnState>();
  /** Each city's save for visitors arriving in parts: one in flight per city (F8). */
  private incoming = new Map<number, { id: string; parts: (string | null)[]; got: number }>();
  /** Battles coming in, in parts, by sender and id (M35). */
  private battleIn = new Map<string, { parts: (string | null)[]; got: number }>();
  private readonly limits: RegionLimits;
  /** Each city's allowance of writes, and of battles sent (M35). */
  private writes = new Map<number, TokenBucket>();
  private battles = new Map<number, TokenBucket>();
  /** Each city's allowance of operations sent (M37). */
  private opsSent = new Map<number, TokenBucket>();
  /** Changes not yet written, and the timer that will write them. */
  private dirty = false;
  private saveTimer: (() => void) | null = null;
  private saveDue = 0;
  private lastSaved: number;
  private readonly budget: DailyRows;
  private overSaved = -Infinity;
  private opened = 0;
  /** Live battles calling or running (M39), in memory only, by `attacker slot:id`. */
  private lives = new Map<string, LiveRun>();
  /** Each city's allowance of diplomatic moves: declarations, proposals, ended pacts (M39). */
  private acts = new Map<number, TokenBucket>();

  constructor(
    readonly code: string,
    readonly kind: RegionView['kind'],
    private readonly store: RegionStore,
    private readonly env: RegionEnv,
    limits: Partial<RegionLimits> = {},
  ) {
    this.limits = { ...REGION_LIMITS, ...limits };
    const now = env.now();
    this.meta = store.loadMeta();
    this.lastSaved = this.meta?.lastActive ?? now;
    this.budget = new DailyRows(this.limits.dailyRows, () => store.rowsWritten, this.meta?.budget, now);
  }

  get exists(): boolean {
    return !!this.meta;
  }

  /** Sockets open now. */
  get connections(): number {
    return this.conns.size;
  }

  /** When this region may be forgotten (F8): a while after its record was last saved. */
  expiresAt(): number | null {
    if (!this.meta || this.conns.size) return null;
    return this.lastSaved + this.limits.ttl;
  }

  private connState(slot: number, v = PROTOCOL_VERSION): ConnState {
    const now = this.env.now();
    return {
      slot,
      v,
      hello: slot > 0,
      all: new TokenBucket(this.limits.rate, this.limits.burst, now),
      visits: new TokenBucket(1000 / this.limits.visitEvery, 1, now),
      n: ++this.opened,
    };
  }

  open(conn: RegionConn): void {
    // A shut room answers whatever comes next (the hello) with why.
    if (this.shut) return;
    if (this.conns.size >= this.limits.maxConns) {
      // Sockets opened by a script mustn't crowd cities out: the oldest yet to say hello goes.
      let oldest: [RegionConn, ConnState] | null = null;
      for (const e of this.conns) if (!e[1].hello && (!oldest || e[1].n < oldest[1].n)) oldest = e;
      if (!oldest) {
        conn.send({ t: 'error', code: 'full', text: 'Too many connections to this region' });
        return conn.close(4000, 'full');
      }
      this.conns.delete(oldest[0]);
      oldest[0].close(4000, 'full');
    }
    this.conns.set(conn, this.connState(0));
    this.sweep(this.env.now());
  }

  /** Why the region shut for good, once it has (F10). */
  private shut: string | null = null;

  /** The region shuts for good (its peer-to-peer host's browser is leaving): every city is told. */
  close(text: string): void {
    this.shut = text;
    this.lives.clear();
    for (const c of [...this.conns.keys()]) {
      c.send({ t: 'error', code: 'closed', text });
      c.close(1000, 'closed');
    }
    this.conns.clear();
  }

  /** After a Durable Object wakes: a socket, the city it spoke for and the protocol its page said. */
  reattach(conn: RegionConn, slot: number, tag?: { v?: number } | null): void {
    this.conns.set(conn, this.connState(slot, tag?.v));
  }

  closed(conn: RegionConn): void {
    const st = this.conns.get(conn);
    this.conns.delete(conn);
    for (const r of this.lives.values()) r.watchers.delete(conn);
    // A combatant whose last connection has gone is handed over at once (M39), as one gone silent.
    this.sweep(this.env.now());
    if (!st?.slot) return;
    if (!this.online(st.slot)) this.incoming.delete(st.slot);
    // A city leaving: what's changed is written now, not left to a timer that may never run.
    if (this.dirty) this.save(this.conns.size ? 'change' : 'empty');
    this.broadcast();
  }

  private online(slot: number): boolean {
    for (const s of this.conns.values()) if (s.slot === slot) return true;
    return false;
  }

  /**
   * Write the region's record. Past the day's budget only as the region empties, now and then; the
   * changes stay in memory meanwhile.
   */
  private save(why: 'change' | 'empty' = 'change'): void {
    const meta = this.meta;
    if (!meta) return;
    const now = this.env.now();
    if (this.budget.over(now)) {
      if (why !== 'empty' || now - this.overSaved < OVER_BUDGET_SAVE) return;
      this.overSaved = now;
    }
    this.saveTimer?.();
    this.saveTimer = null;
    this.dirty = false;
    this.lastSaved = now;
    meta.lastActive = now;
    meta.budget = this.budget.record(now);
    this.store.saveMeta(meta);
  }

  /** A battle arriving in parts (a `battle`'s, or a live battle's input): the whole, once every part is in. */
  private gather(key: string, parts: number, part: number, data: string): string[] | null {
    let inc = this.battleIn.get(key);
    if (!inc) {
      if (this.battleIn.size > 16) this.battleIn.clear();
      this.battleIn.set(key, (inc = { parts: new Array<string | null>(parts).fill(null), got: 0 }));
    }
    if (inc.parts.length !== parts) return null;
    if (inc.parts[part] === null) inc.got++;
    inc.parts[part] = data;
    if (inc.got < inc.parts.length) return null;
    this.battleIn.delete(key);
    return inc.parts as string[];
  }

  private battlesOf(slot: number): TokenBucket {
    let b = this.battles.get(slot);
    if (!b)
      this.battles.set(
        slot,
        (b = new TokenBucket(1000 / this.limits.battleEvery, this.limits.battleBurst, this.env.now())),
      );
    return b;
  }

  private opsOf(slot: number): TokenBucket {
    let b = this.opsSent.get(slot);
    if (!b)
      this.opsSent.set(
        slot,
        (b = new TokenBucket(1000 / this.limits.opEvery, this.limits.opBurst, this.env.now())),
      );
    return b;
  }

  /** The region's dice for a friend's spy (M37): 0–999, from the platform's cryptographic source. */
  private roll(): number {
    const r = this.env.roll?.() ?? secureIndex(1000);
    return Math.max(0, Math.min(999, Math.floor(r)));
  }

  private writesOf(slot: number): TokenBucket {
    let b = this.writes.get(slot);
    if (!b)
      this.writes.set(
        slot,
        (b = new TokenBucket(this.limits.writeRate, this.limits.writeBurst, this.env.now())),
      );
    return b;
  }

  /**
   * A change the other cities care about: written now if the city's allowance has room, else put
   * together with whatever follows and written when it has (or when the city leaves).
   */
  private changed(slot: number): void {
    this.dirty = true;
    const b = this.writesOf(slot);
    if (b.take(this.env.now())) return this.save();
    const later = this.env.later;
    if (!later) return;
    const wait = b.wait(this.env.now());
    const due = this.env.now() + wait;
    if (this.saveTimer && this.saveDue <= due) return;
    this.saveTimer?.();
    this.saveDue = due;
    this.saveTimer = later(wait, () => {
      this.saveTimer = null;
      if (this.dirty) this.changed(slot);
    });
  }

  view(): RegionView {
    const m = this.meta!;
    const now = this.env.now();
    const p = m.project;
    const total = Math.min(REGION_PROJECT.goal, p.total);
    return {
      code: m.code,
      name: m.name,
      kind: m.kind,
      cities: m.cities.map((c) => ({
        slot: c.slot,
        name: c.name,
        mayor: c.mayor,
        color: c.color,
        online: this.online(c.slot),
        report: c.report,
        thumb: c.thumb,
        quietFor: Math.max(0, now - c.heard),
        visitable: !!c.saved,
        ...(m.rules?.war
          ? {
              raidsLeft: this.raidsLeft(c, now),
              raidedBy: this.raidedBy(c, now),
              opsLeft: this.opsLeft(c, now),
              supersLeft: this.supersLeft(c, now),
            }
          : {}),
        ...(c.fair ? { fair: c.fair.hours } : {}),
      })),
      project: {
        name: REGION_PROJECT.name,
        goal: REGION_PROJECT.goal,
        total,
        by: { ...p.by },
        funded: total >= REGION_PROJECT.goal,
        host: p.host,
        built: p.built,
        power: REGION_PROJECT.power,
      },
      host: m.host ?? 1,
      rules: { ...(m.rules ?? PEACE_RULES) },
    };
  }

  /** Cities that raided this one within the window a newcomer may answer in (M36). */
  private raidedBy(c: City, now: number): number[] {
    return Object.entries(c.raidedBy ?? {})
      .filter(([, at]) => now - at < RAID_ANSWER_MS)
      .map(([slot]) => Number(slot))
      .sort((a, b) => a - b);
  }

  /**
   * Why this city may not raid that one now (M36), or null: the region decides, on its own clock,
   * so both cities' sims agree on what was fought.
   */
  private raidRefusal(from: City, target: City, now: number, except?: LiveSession): string | null {
    if (!from.report || !target.report) return `${target.name} isn’t in the region’s war yet`;
    if (from.report.shield === 'neutral') return `${from.name} is neutral: it raids no one`;
    if (target.report.shield === 'neutral') return `${target.name} is neutral`;
    // Friends' diplomacy (M39): a war that hasn't opened, a ceasefire, a capitulation, a pact, a vassal.
    const fw = this.meta?.friends ? new FriendsWar(this.meta, this.fwContext()) : null;
    const stop = fw?.raidBlock(from.slot, target.slot);
    if (stop) return stop;
    // A region on one player's computer ends with its host: a raid there needs its target's player.
    if (this.kind === 'p2p' && !this.online(target.slot))
      return `${target.name}’s player isn’t here, and this region keeps nothing for them`;
    // A live battle against it (M39) may end with it away, and is then kept as one more: a place for it.
    if ((target.pending?.length ?? 0) + this.liveAgainst(target.slot, except) >= MAX_PENDING_BATTLES)
      return `${target.name} has ${MAX_PENDING_BATTLES} raids waiting for its player: no more until it takes them`;
    // A newcomer at war with the sender is raided like any other: the war's warning covered it (M39).
    if (
      target.report.shield === 'new' &&
      !this.raidedBy(from, now).includes(target.slot) &&
      !fw?.atWar(from.slot, target.slot)
    )
      return `${target.name} is too young or small to raid, unless it strikes first`;
    if (this.raidsLeft(target, now) <= 0)
      return `${target.name} has been raided ${this.limits.raidsPerDay} times today: the region allows no more until midnight (UTC)`;
    return null;
  }

  /** Raids a city may still take today (UTC; M36). */
  private raidsLeft(c: City, now: number): number {
    const day = Math.floor(now / DAY_MS);
    return Math.max(0, this.limits.raidsPerDay - (c.raids?.day === day ? c.raids.n : 0));
  }

  /**
   * Why a battle (or a live one, M39) may not stand now: a raid's checks, and a superweapon's if it
   * brings one. One place for a `battle` and for a live call to ask.
   */
  private strikeRefusal(
    from: City,
    target: City,
    superweapon: boolean,
    now: number,
    except?: LiveSession,
  ): string | null {
    return (
      this.raidRefusal(from, target, now, except) ?? (superweapon ? this.superRefusal(target, now) : null)
    );
  }

  /** Spies a city may still take today (UTC; M37). */
  private opsLeft(c: City, now: number): number {
    const day = Math.floor(now / DAY_MS);
    return Math.max(0, this.limits.opsPerDay - (c.spied?.day === day ? c.spied.n : 0));
  }

  /** Superweapons a city may still take today (UTC; M37): blackouts and superweapons' battles. */
  private supersLeft(c: City, now: number): number {
    const day = Math.floor(now / DAY_MS);
    return Math.max(0, this.limits.supersPerDay - (c.supers?.day === day ? c.supers.n : 0));
  }

  /** A superweapon taken (M37): counted in the city's day. */
  private countSuper(c: City, now: number): void {
    const day = Math.floor(now / DAY_MS);
    c.supers = { day, n: (c.supers?.day === day ? c.supers.n : 0) + 1 };
  }

  /**
   * Why a battle bringing a superweapon may not stand now (M37), beyond a raid's own checks: the
   * region's rules, its target's player here (with no half-strength fight again: superweapons wait
   * for them), and the target's superweapon for the day.
   */
  private superRefusal(target: City, now: number): string | null {
    if (!this.meta?.rules?.supers) return 'The region’s rules turn superweapons off';
    if (!this.online(target.slot)) return `${target.name}’s player isn’t here: superweapons wait for them`;
    if (this.supersLeft(target, now) <= 0)
      return `${target.name} has taken a superweapon today: no more until midnight (UTC)`;
    return null;
  }

  /**
   * Why an operation may not stand now (M37, design call 14), in plain words: war on (and
   * superweapons for a blackout); a neutral sender or target only looks; a newcomer target takes
   * looks and thefts only, unless it struck the sender first; saboteurs and blackouts need the
   * target's player here; the day's spies, saboteur, superweapon and raids; operations waiting; a
   * theft needs a target further on in that branch.
   */
  private opRefusal(
    from: City,
    target: City | undefined,
    m: Extract<RegionClientMsg, { t: 'op' }>,
    now: number,
  ): string | null {
    const rules = this.meta?.rules;
    if (!rules?.war) return 'War is off in this region';
    if (!target || target.slot === from.slot) return 'That city isn’t in the region';
    if (m.op === 'blackout' && !rules.supers) return 'The region’s rules turn superweapons off';
    if (!from.report?.tiers || !target.report?.tiers) return `${target.name} isn’t in the region’s war yet`;
    if (m.op !== 'reveal' && from.report.shield === 'neutral')
      return `${from.name} is neutral: its spies only look`;
    if (m.op !== 'reveal' && target.report.shield === 'neutral')
      return `${target.name} is neutral: spies may only look there`;
    const harm = m.op === 'sabotage' || m.op === 'blackout';
    if (harm && target.report.shield === 'new' && !this.raidedBy(from, now).includes(target.slot))
      return `${target.name} is too young or small for that, unless it strikes first`;
    if (harm && !this.online(target.slot))
      return m.op === 'blackout'
        ? `${target.name}’s player isn’t here: superweapons wait for them`
        : `${target.name}’s player isn’t here: saboteurs wait for them`;
    if ((target.ops?.length ?? 0) >= MAX_PENDING_OPS)
      return `${target.name} has ${MAX_PENDING_OPS} operations waiting for its player: no more until it takes them`;
    if (m.op === 'steal') {
      const b = BRANCH_IDS.indexOf(m.branch!);
      if (!(target.report.tiers[b]! > from.report.tiers[b]!))
        return `${target.name} is no further than you in ${BRANCHES[b]!.name} research`;
    }
    if (m.op === 'blackout') {
      if (this.supersLeft(target, now) <= 0)
        return `${target.name} has taken a superweapon today: no more until midnight (UTC)`;
      if (this.raidsLeft(target, now) <= 0)
        return `${target.name} has been raided ${this.limits.raidsPerDay} times today: the region allows no more until midnight (UTC)`;
      return null;
    }
    if (this.opsLeft(target, now) <= 0)
      return `${target.name} has had ${count(this.limits.opsPerDay)} spies today: no more until midnight (UTC)`;
    const day = Math.floor(now / DAY_MS);
    if (
      m.op === 'sabotage' &&
      (target.spied?.day === day ? target.spied.sabotage : 0) >= this.limits.sabotagePerDay
    )
      return `${target.name} has had a saboteur today: no more until midnight (UTC)`;
    return null;
  }

  private broadcast(): void {
    if (!this.meta) return;
    const msg: RegionRoomMsg = { t: 'region', region: this.view() };
    for (const c of this.conns.keys()) c.send(msg);
  }

  private reject(conn: RegionConn, code: Extract<RegionRoomMsg, { t: 'error' }>['code'], text: string): void {
    conn.send({ t: 'error', code, text });
    conn.close(4000, code);
    this.closed(conn);
  }

  message(conn: RegionConn, raw: string): void {
    // The room has no timers: a silent combatant, an unanswered call or an abandoned battle is
    // noticed when anything reaches it, a ping included (M39).
    if (raw === 'ping') return this.sweep(this.env.now(), this.conns.get(conn)?.slot);
    if (this.shut) {
      conn.send({ t: 'error', code: 'closed', text: this.shut });
      return conn.close(1000, 'closed');
    }
    const st = this.conns.get(conn);
    if (!st) return;
    // A burst is fine, a flood is dropped, a torrent closes the connection.
    const now = this.env.now();
    this.sweep(now, st.slot);
    const left = st.all.spend(now);
    if (left < -this.limits.burst) return this.reject(conn, 'rate', 'Too many messages');
    if (left < 0) return;
    const m = parseRegionMsg(raw);
    if (!m) return this.reject(conn, 'bad-message', 'A message the region could not read');
    const slot = st.slot;
    if (m.t === 'rhello') {
      if (st.hello) return this.reject(conn, 'bad-message', 'One hello is enough');
      st.hello = true;
      return this.hello(conn, st, m);
    }
    if (!st.hello) return this.reject(conn, 'bad-message', 'Say hello first');
    if (!this.meta) return;
    if (m.t === 'visit') {
      // Each read sends a whole city: a few a minute at most.
      if (!st.visits.take(now)) return;
      const parts = this.store.loadCity(m.slot);
      if (!parts)
        return conn.send({
          t: 'error',
          code: 'no-save',
          text: 'That city hasn’t been saved to the region yet',
        });
      parts.forEach((data, part) =>
        conn.send({ t: 'citysave', slot: m.slot, part, parts: parts.length, data }),
      );
      return;
    }
    const city = this.meta.cities.find((c) => c.slot === slot);
    if (!city) return;
    city.heard = now;
    // Live battles are for pages that speak them: an older page sending one is ignored (a call is
    // told it can't, so the sender's force goes the old way).
    if (st.v < LIVE_PROTOCOL && LIVE_MESSAGES.has(m.t) && m.t !== 'blive') return;
    // Likewise wars and treaties with friends: a protocol-5 page doesn't know them.
    if (st.v < LIVE_PROTOCOL && FRIEND_MESSAGES.has(m.t)) return;
    switch (m.t) {
      case 'report': {
        // Every report goes to the others at once; only offers, deals and the like are written
        // promptly, the numbers and the picture now and then.
        const matters = (c: City) =>
          JSON.stringify([
            c.name,
            c.report?.kind,
            c.report?.offers,
            c.report?.deals,
            c.report?.projectBuilt,
            c.report?.shield,
          ]);
        // The fair clock (M37) is kept with the rest of what changes now and then.
        const kept = () => JSON.stringify([city.report, city.thumb, city.fair?.hours]);
        const before = kept();
        const was = matters(city);
        city.name = m.city;
        city.report = m.report;
        // The fair clock (M37): started at the city's war clock, then moved on at 1× for the time
        // since the last report (two minutes at most: a city away isn't playing here), written with
        // the rest now and then.
        if (m.report.clock !== undefined) {
          if (!city.fair) city.fair = { hours: m.report.clock, at: now };
          else {
            const gain = Math.min(Math.max(0, now - city.fair.at), FAIR.gapMax) / FAIR.msPerHour;
            city.fair = { hours: Math.round((city.fair.hours + gain) * 1000) / 1000, at: now };
          }
        }
        if (m.thumb) city.thumb = m.thumb;
        const p = this.meta.project;
        const built = m.report.projectBuilt && p.host === slot && !p.built;
        if (built) p.built = true;
        this.broadcast();
        if (built || matters(city) !== was) this.changed(slot);
        else if (kept() !== before) {
          this.dirty = true;
          if (now - this.lastSaved >= this.limits.keepEvery) this.save();
        }
        return;
      }
      case 'contribute': {
        const p = this.meta.project;
        if (p.total >= REGION_PROJECT.goal) return;
        const give = Math.min(m.amount, REGION_PROJECT.goal - p.total);
        p.by[slot] = (p.by[slot] ?? 0) + give;
        p.total += give;
        if (p.total >= REGION_PROJECT.goal && !p.host) {
          // Paid for: the city that gave most hosts it (the first to give that much, on a tie).
          const top = Object.entries(p.by).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0]!;
          p.host = Number(top[0]);
          const host = this.meta.cities.find((c) => c.slot === p.host);
          for (const c of this.conns.keys())
            c.send({
              t: 'notice',
              text: `${REGION_PROJECT.name} is paid for: ${host?.name ?? 'a city'} will build it`,
            });
        }
        // The city has paid already: written promptly, never dropped.
        this.broadcast();
        this.changed(slot);
        return;
      }
      case 'rrules': {
        // Only the host sets the rules; the change goes to everyone and is written at its pace.
        if (slot !== (this.meta.host ?? 1)) return;
        const was = this.meta.rules ?? PEACE_RULES;
        if (sameWarRules(was, m.rules)) return;
        this.meta.rules = m.rules;
        // War turned off: every war between friends ends in plain peace.
        if (was.war && !m.rules.war) this.fwRun(slot, (fw) => fw.warOff());
        for (const c of this.conns.keys())
          c.send({ t: 'notice', text: `${city.name} set the region's rules: ${warRulesText(m.rules)}` });
        this.broadcast();
        this.changed(slot);
        return;
      }
      case 'battle': {
        // Only where war is allowed, against another city of the region (M35); every battle is
        // answered (M36), so its sender's force never waits on nothing.
        const target = this.meta.cities.find((c) => c.slot === m.to);
        // The same battle, called live (M39): a call not yet answered gives way to this (the sender
        // fights the old way); one running is being fought, and its end will be kept.
        const live = this.lives.get(liveKey(slot, m.id));
        if (live) {
          if (live.s.state === 'running') {
            if (m.part === 0)
              conn.send({ t: 'battleRefused', id: m.id, reason: 'That battle is being fought live' });
            return;
          }
          this.callOff(live, 'The attacker went the old way', 'defender');
        }
        // Sent again (its acknowledgement was lost): kept already, or seen already (known by its
        // sender too: two cities' battles may share an id). Answered so first, whatever has changed
        // since (war turned off, the day's raids), as its target has it or will.
        if (
          target &&
          (target.pending?.some((p) => p.id === m.id && p.from === slot) ||
            target.seen?.includes(`${slot}:${m.id}`))
        ) {
          if (m.part === 0) conn.send({ t: 'battleKept', id: m.id });
          return;
        }
        if (!this.meta.rules?.war || m.to === slot || !target) {
          if (m.part === 0)
            conn.send({
              t: 'battleRefused',
              id: m.id,
              reason: !this.meta.rules?.war ? 'War is off in this region' : 'That city isn’t in the region',
            });
          return;
        }
        const whole = this.gather(`${slot}:${m.id}`, m.parts, m.part, m.data);
        if (!whole) return;
        // The region decides whether it stands (M36): the target's shield, the sender's right to
        // answer a newcomer that raided it, and the day's raids. The sender's city hasn't taken the
        // result yet, so a refusal leaves both cities as they were. One bringing a superweapon (M37)
        // needs the region's rules, its target's player here (no half-strength fight again) and the
        // target's superweapon for the day.
        const why = this.strikeRefusal(city, target, m.super === true, now);
        if (why) return conn.send({ t: 'battleRefused', id: m.id, reason: why });
        // Fought as against a player who is here, but the player has gone: fought again at half.
        const away = !this.online(target.slot);
        if (away && !m.away)
          return conn.send({
            t: 'battleRefused',
            id: m.id,
            reason: `${target.name}’s player has left: the raid is fought again at half strength`,
            again: true,
          });
        // Within the region's day; a few at once, then one every few minutes (asked again later).
        if (this.budget.over(now))
          return conn.send({ t: 'battleRefused', id: m.id, reason: dailyLimitText('region') });
        if (!this.battlesOf(slot).take(now))
          return conn.send({
            t: 'battleRefused',
            id: m.id,
            reason: 'The region takes a few battles at a time',
            later: this.limits.battleEvery,
          });
        const day = Math.floor(now / DAY_MS);
        target.raids = { day, n: (target.raids?.day === day ? target.raids.n : 0) + 1 };
        target.raidedBy = { ...(target.raidedBy ?? {}), [slot]: now };
        // A superweapon's battle is also the target's superweapon for the day (M37).
        const sup = m.super === true;
        if (sup) this.countSuper(target, now);
        // Eight at most (more are turned away above, so every battle kept is one its target takes).
        const pending = (target.pending ??= []);
        let k = 0;
        while (pending.some((p) => p.k === k)) k++;
        const parts = whole;
        this.store.saveBattle(target.slot, k, parts);
        // As the sender fought it: at half strength when it said so (always when the player is away).
        const half = m.away === true;
        pending.push({
          id: m.id,
          from: slot,
          at: now,
          k,
          ...(half ? { away: true } : {}),
          ...(sup ? { super: true as const } : {}),
        });
        // One line of the region's war history, written with the battle.
        this.fwRun(slot, (fw) => fw.battle(slot, target.slot, m.id), false);
        this.save();
        conn.send({ t: 'battleKept', id: m.id });
        this.broadcast();
        // The defender playing now gets it at once (it stays kept until it says it has seen it).
        for (const [c, s] of this.conns)
          if (s.slot === target.slot)
            parts.forEach((data, part) =>
              c.send({
                t: 'battle',
                from: slot,
                id: m.id,
                part,
                parts: parts.length,
                data,
                late: false,
                away: half,
                ...(sup ? { super: true as const } : {}),
              }),
            );
        return;
      }
      case 'battleSeen': {
        const pending = city.pending;
        const i =
          pending?.findIndex((p) => p.id === m.id && (m.from === undefined || p.from === m.from)) ?? -1;
        if (i < 0) return;
        const [seen] = pending!.splice(i, 1);
        if (!pending!.length) delete city.pending;
        // Remembered a while: the same battle sent again is acknowledged, not counted again.
        city.seen = [...(city.seen ?? []), `${seen!.from}:${m.id}`].slice(-SEEN_KEEP);
        this.store.deleteBattle(slot, seen!.k);
        this.save();
        return;
      }
      case 'forceOut': {
        // Its target's player hears of it, if they're here (where war is allowed): with the
        // superweapon it brings and whether it comes through the gate (M37).
        if (!this.meta.rules?.war || m.to === slot) return;
        for (const [c, s] of this.conns)
          if (s.slot === m.to)
            c.send({
              t: 'incoming',
              from: slot,
              units: m.units,
              hours: m.hours,
              ...(m.super ? { super: m.super } : {}),
              ...(m.gate ? { gate: true as const } : {}),
            });
        return;
      }
      case 'op':
        return this.op(conn, city, m, now);
      case 'opSeen': {
        const ops = city.ops;
        const i = ops?.findIndex((o) => o.id === m.id && o.from === m.from) ?? -1;
        if (i < 0) return;
        ops!.splice(i, 1);
        if (!ops!.length) delete city.ops;
        // Put together with what follows: an operation offered again is known to the city already.
        this.changed(slot);
        return;
      }
      case 'wdeclare':
      case 'tprop':
      case 'tbreak': {
        // A city's diplomatic moves are paced, and none starts past the day's rows (they are kept).
        const slow = !this.actsOf(slot).take(now)
          ? 'The region takes a few diplomatic moves at a time'
          : this.budget.over(now)
            ? dailyLimitText('region')
            : null;
        if (slow) {
          if (m.t === 'wdeclare') conn.send({ t: 'wrefused', to: m.to, why: slow });
          else conn.send({ t: 'trefused', id: m.t === 'tprop' ? m.id : String(m.pact), why: slow });
          return;
        }
        if (m.t === 'wdeclare')
          return this.fwRun(slot, (fw) =>
            fw.declare(slot, {
              to: m.to,
              scale: m.scale,
              reason: m.reason,
              ...(m.breakPact ? { breakPact: true as const } : {}),
            }),
          );
        if (m.t === 'tprop')
          return this.fwRun(slot, (fw) =>
            fw.propose(slot, {
              id: m.id,
              to: m.to,
              terms: m.terms,
              ...(m.imposed ? { imposed: true as const } : {}),
            }),
          );
        return this.fwRun(slot, (fw) => fw.breakPact(slot, { pact: m.pact }));
      }
      case 'tans':
        return this.fwRun(slot, (fw) => fw.answer(slot, m));
      case 'tseen':
        return this.fwRun(slot, (fw) => fw.seen(slot, m.id));
      case 'battleResult':
        return this.fwRun(slot, (fw) => fw.result(slot, m));
      case 'blive':
        return this.blive(conn, st, city, m, now);
      case 'binput':
        return this.binput(conn, city, m, now);
      case 'bdecline':
        return this.bdecline(city, m);
      case 'bstep':
        return this.bstep(conn, city, m, now);
      case 'bdone':
        return this.bdone(conn, city, m, now);
      case 'bjoin':
        return this.bjoin(conn, city, m, now);
      case 'bwatch':
        return this.bwatch(conn, city, m, now);
      case 'bunwatch':
        for (const r of this.lives.values())
          if (r.s.id === m.id && (m.from === undefined || r.s.from === m.from)) r.watchers.delete(conn);
        return;
      case 'breplay':
        return this.breplay(conn, m);
      case 'save': {
        // Kept at most every so often; parts in between are ignored before they take memory. The
        // save a city sends as its player leaves is kept whatever the pace, once a connection: in a
        // region at war, a raid on an absent friend is fought in the city as it was left (M35).
        if (m.last && !st.lastUsed && (st.lastSave ?? m.id) === m.id) st.lastSave = m.id;
        else if (city.savedAt !== undefined && now - city.savedAt < this.limits.saveEvery) return;
        let inc = this.incoming.get(slot);
        if (!inc || inc.id !== m.id)
          this.incoming.set(
            slot,
            (inc = { id: m.id, parts: new Array<string | null>(m.parts).fill(null), got: 0 }),
          );
        if (inc.parts.length !== m.parts) return;
        if (inc.parts[m.part] === null) inc.got++;
        inc.parts[m.part] = m.data;
        if (inc.got < inc.parts.length) return;
        this.incoming.delete(slot);
        if (m.last && st.lastSave === m.id) st.lastUsed = true;
        if (this.budget.over(now)) return;
        this.store.saveCity(slot, inc.parts as string[]);
        const first = !city.saved;
        city.saved = true;
        city.savedAt = now;
        this.save();
        if (first) this.broadcast();
        return;
      }
    }
  }

  private hello(conn: RegionConn, st: ConnState, m: Extract<RegionClientMsg, { t: 'rhello' }>): void {
    // A region serves the last protocol too (M39): its pages share no sim, so an older page simply
    // gets no live battles. A newer one is turned away.
    if (m.v < MIN_REGION_PROTOCOL || m.v > PROTOCOL_VERSION)
      return this.reject(
        conn,
        'version',
        'This region runs a different version of Citybloom: reload to update',
      );
    st.v = m.v;
    if (m.create) {
      if (conn.mayCreate === false)
        return this.reject(conn, 'version', 'Making a region needs a newer Citybloom: reload to update');
      if (this.meta) return this.reject(conn, 'exists', 'That region code is taken');
      this.meta = {
        code: this.code,
        name: m.create.name,
        kind: this.kind,
        nextSlot: 1,
        cities: [],
        project: { total: 0, by: {}, host: 0, built: false },
        // The city making it is its first and its host (M34); war only if it asked for it.
        host: 1,
        ...(m.create.rules?.war ? { rules: m.create.rules } : {}),
      };
    }
    if (!this.meta) return this.reject(conn, 'no-region', 'No region with that code');
    if (m.visitor) {
      conn.send({ t: 'rwelcome', slot: 0, secret: '', region: this.view() });
      return;
    }
    let city = m.rejoin
      ? this.meta.cities.find((c) => c.slot === m.rejoin!.slot && c.secret === m.rejoin!.secret)
      : undefined;
    const now = this.env.now();
    // Written only for a new city, or a mayor's new name or colour (F8): coming back writes nothing.
    let write: 'new' | 'changed' | null = null;
    if (!city) {
      if (this.meta.cities.length >= MAX_CITIES)
        return this.reject(
          conn,
          'full',
          `This region is full: it has places for ${MAX_CITIES} cities, and each keeps its place while its mayor is away`,
        );
      if (this.budget.over(now)) return this.reject(conn, 'limit', dailyLimitText('region'));
      write = 'new';
      city = {
        slot: this.meta.nextSlot++,
        name: m.city,
        mayor: m.mayor,
        color: m.color,
        secret: makeSecret(),
        report: null,
        thumb: null,
        heard: now,
      };
      this.meta.cities.push(city);
      for (const c of this.conns.keys()) c.send({ t: 'notice', text: `${m.city} joined the region` });
    } else if (city.mayor !== m.mayor || city.color !== m.color || (city.v ?? 0) !== m.v) write = 'changed';
    city.mayor = m.mayor;
    city.color = m.color;
    city.v = m.v;
    city.heard = now;
    st.slot = city.slot;
    conn.bind?.(city.slot, m.v);
    // A new city is written at once (four at most, ever); a change at the city's pace.
    if (write === 'new') this.save();
    else if (write === 'changed') this.changed(city.slot);
    // Protocol 6: the wars and pacts between friends as they stand (time brought up to date first).
    let friends: ReturnType<FriendsWar['welcome']> | null = null;
    if (m.v >= LIVE_PROTOCOL) {
      if (this.meta.friends) this.fwRun(city.slot, (fw) => fw.tick());
      friends = new FriendsWar(this.meta, this.fwContext()).welcome(city.slot);
    }
    conn.send({
      t: 'rwelcome',
      slot: city.slot,
      secret: city.secret,
      region: this.view(),
      ...(m.v >= LIVE_PROTOCOL ? { replays: (this.meta.replays ?? []).map((r) => ({ ...r })) } : {}),
      ...(m.v >= LIVE_PROTOCOL ? { friends: friends!.info } : {}),
    });
    // Its fair clock carries on from now (M37): the time away isn't play.
    if (city.fair) city.fair = { ...city.fair, at: now };
    // Battles fought against it while it was away (M35), oldest first.
    for (const p of city.pending ?? []) {
      // A live battle's record is for a page that speaks live battles (M39); it waits for one.
      if (p.live && m.v < LIVE_PROTOCOL) continue;
      const parts = this.store.loadBattle(city.slot, p.k);
      if (parts)
        parts.forEach((data, part) =>
          conn.send({
            t: 'battle',
            from: p.from,
            id: p.id,
            part,
            parts: parts.length,
            data,
            late: true,
            away: p.away === true,
            ...(p.super ? { super: true as const } : {}),
            ...(p.live ? { live: true as const } : {}),
          }),
        );
    }
    // Operations against it it hasn't seen (M37): late, so they bring only a notice.
    for (const o of city.ops ?? []) conn.send(opOn(o, true));
    if (m.v >= LIVE_PROTOCOL) this.liveWelcome(conn, city);
    // Proposals for it to answer and treaties it hasn't applied, oldest first.
    for (const msg of friends?.after ?? []) conn.send(msg);
    this.broadcast();
  }

  // ---- Wars and treaties between friends (M39, design calls 9 and 10) --------------------------
  // The module `FriendsWar` keeps the record (in `meta.friends` and `meta.history`) and says what to
  // send; the room gives it the clock and what it knows of the cities, sends, and writes at its pace.

  private actsOf(slot: number): TokenBucket {
    let b = this.acts.get(slot);
    if (!b)
      this.acts.set(slot, (b = new TokenBucket(1000 / FRIENDS.actEvery, FRIENDS.actBurst, this.env.now())));
    return b;
  }

  /** The protocol a city's pages speak: the best of those here, else the last it said. */
  private protoOf(c: City): number {
    let v = 0;
    for (const s of this.conns.values()) if (s.slot === c.slot) v = Math.max(v, s.v);
    return v || (c.v ?? PROTOCOL_VERSION);
  }

  private fwContext(): FwContext {
    const meta = this.meta!;
    const now = this.env.now();
    const cityOf = (slot: number) => meta.cities.find((c) => c.slot === slot);
    return {
      now,
      rules: meta.rules ?? PEACE_RULES,
      city: (slot) => {
        const c = cityOf(slot);
        return c
          ? {
              slot,
              name: c.name,
              ...(c.report?.shield ? { shield: c.report.shield } : {}),
              reported: !!c.report,
              proto: this.protoOf(c),
            }
          : undefined;
      },
      struck: (slot, by) => {
        const c = cityOf(slot);
        return !!c && this.raidedBy(c, now).includes(by);
      },
      battleKnown: (from, to, id) => {
        const t = cityOf(to);
        if (t?.seen?.includes(`${from}:${id}`) || t?.pending?.some((p) => p.id === id && p.from === from))
          return true;
        if (this.lives.get(liveKey(from, id))?.s.to === to) return true;
        return this.replayOf(id, from)?.to === to;
      },
    };
  }

  /**
   * Run the module on the record and send what it says to the cities that are here (those that speak
   * protocol 6). What it changed is written at `slot`'s pace, unless the caller writes it (`save` false).
   */
  private fwRun(slot: number, fn: (fw: FriendsWar) => void, save = true): void {
    if (!this.meta) return;
    const fw = new FriendsWar(this.meta, this.fwContext());
    fn(fw);
    for (const o of fw.out) this.fwSend(o);
    if (fw.dirty && save) this.changed(slot);
    else if (fw.dirty || fw.quiet) {
      // What must be kept is written at the city's pace; what could be worked out again waits for the
      // region's slower one (or for a city to leave), as the numbers in a report do.
      this.dirty = true;
      if (!save) return;
      if (this.env.now() - this.lastSaved >= this.limits.keepEvery) this.save();
    }
  }

  private fwSend(o: FwOut): void {
    for (const [c, s] of this.conns) {
      if (s.slot <= 0 || s.v < LIVE_PROTOCOL) continue;
      if (o.to === 'all' ? o.except?.includes(s.slot) : !o.to.includes(s.slot)) continue;
      c.send(o.msg);
    }
  }

  // ---- Live battles (M39, design call 3) -------------------------------------------------------
  // The room keeps a battle between two players in memory only: it paces it, stamps its orders,
  // hands a silent combatant over, and writes once, when it ends (its record, for a defender who
  // wasn't here and for replays). It never reads the battle, only its shape.

  /** The connections of a city's pages that speak live battles. */
  private liveConns(slot: number): RegionConn[] {
    const out: RegionConn[] = [];
    for (const [c, s] of this.conns) if (s.slot === slot && s.v >= LIVE_PROTOCOL) out.push(c);
    return out;
  }

  /** The live battle a city is in, calling or running. */
  private runOf(slot: number): LiveRun | undefined {
    for (const r of this.lives.values()) if (r.s.from === slot || r.s.to === slot) return r;
    return undefined;
  }

  /** The live battle `slot` fights in with that id. */
  private runBy(slot: number, id: string): LiveRun | undefined {
    for (const r of this.lives.values())
      if (r.s.id === id && (r.s.from === slot || r.s.to === slot)) return r;
    return undefined;
  }

  /** Live battles aimed at a city, calling or running: each may end as one more battle kept for it. */
  private liveAgainst(slot: number, except?: LiveSession): number {
    let n = 0;
    for (const r of this.lives.values()) if (r.s.to === slot && r.s !== except) n++;
    return n;
  }

  private cityName(slot: number): string {
    return this.meta?.cities.find((c) => c.slot === slot)?.name ?? 'A city';
  }

  /** Tell every page in a battle: its combatants' and its watchers'. */
  private toRun(r: LiveRun, msg: RegionRoomMsg): void {
    for (const c of this.liveConns(r.s.from)) c.send(msg);
    for (const c of this.liveConns(r.s.to)) c.send(msg);
    for (const c of r.watchers) c.send(msg);
  }

  /** Tell every city's page that speaks live battles (but those of the cities given). */
  private toLive(msg: RegionRoomMsg, except: number[] = []): void {
    for (const [c, s] of this.conns)
      if (s.slot > 0 && s.v >= LIVE_PROTOCOL && !except.includes(s.slot)) c.send(msg);
  }

  private bstart(r: LiveRun, role: 'attacker' | 'defender' | 'watcher'): RegionRoomMsg {
    const s = r.s;
    return {
      t: 'bstart',
      id: s.id,
      role,
      attacker: s.from,
      defender: s.to,
      input: s.input,
      allow: s.allow,
      orders: s.orders.map((o) => ({ ...o })),
      handed: s.handed(),
    };
  }

  /** A live call that came to nothing: who is told (`attacker` fights the old way unless `extra.refused`). */
  private callOff(
    r: LiveRun,
    why: string,
    tell: 'attacker' | 'defender' | 'both',
    extra: { refused?: true; later?: number } = {},
  ): void {
    this.lives.delete(liveKey(r.s.from, r.s.id));
    const msg = (more: object): RegionRoomMsg => ({ t: 'bliveoff', id: r.s.id, why, ...more });
    if (tell !== 'defender') for (const c of this.liveConns(r.s.from)) c.send(msg(extra));
    if (tell !== 'attacker') for (const c of this.liveConns(r.s.to)) c.send(msg({}));
  }

  /**
   * What the room notices when anything reaches it (it has no timers): a call the defender hasn't
   * answered in time or whose player has gone, a combatant gone silent or gone (handed over), a battle
   * both of whose pages have finished, and one nobody has spoken in for a minute.
   */
  private sweep(now: number, speaker = 0): void {
    // Wars open, ceasefires and proposals run out: noticed now, with the rest (M39).
    if (this.meta?.friends) this.fwRun(speaker, (fw) => fw.tick());
    if (!this.lives.size) return;
    for (const r of [...this.lives.values()]) {
      const s = r.s;
      // The city whose message this is has just shown it's here: its side isn't left behind for
      // having been quiet before it, nor is a battle it is in called abandoned.
      const speaking = speaker > 0 && s.sideOf(speaker) >= 0;
      if (s.state === 'calling') {
        if (!this.liveConns(s.from).length) this.callOff(r, 'The attacker left', 'defender');
        else if (!this.liveConns(s.to).length)
          this.callOff(r, `${this.cityName(s.to)}’s player isn’t here`, 'attacker');
        else if (now - s.called >= LIVE.call)
          this.callOff(r, `${this.cityName(s.to)}’s player didn’t answer`, 'both');
        continue;
      }
      const ords: LiveOrder[] = [];
      for (const i of [0, 1] as const) {
        const side = s.sides[i];
        if (side.handed || side.done) continue;
        const here = this.liveConns(side.slot).length > 0;
        if (here && (now - side.heard < LIVE.silent || side.slot === speaker)) continue;
        // Silent, or gone: its units go back to the battle's own judgement.
        const o = s.handover(i);
        if (o) ords.push(o);
        this.toRun(r, { t: 'notice', text: `${this.cityName(side.slot)}’s forces fight on their own now` });
      }
      this.advance(r, now, ords, speaking);
    }
  }

  /** Move a running battle on: its frontier, what was stamped, and its end (or its abandoning). */
  private advance(r: LiveRun, now: number, ords: LiveOrder[] = [], speaking = false): void {
    const s = r.s;
    const moved = s.pace(now);
    if (moved || ords.length)
      this.toRun(r, { t: 'ballow', id: s.id, allow: s.allow, ...(ords.length ? { ords } : {}) });
    const end = s.ending(now);
    if (end) return this.endRun(r, end, now);
    if (!speaking && s.abandoned(now))
      this.endRun(r, { step: s.furthest, hash: '', agree: false, abandoned: true }, now);
  }

  /**
   * A live battle begins, from `blive`: the region's checks for a battle (so a refusal is the one
   * `battle` would give), then what a live one needs: both cities free, a place in the region, and
   * the defender's page here and able. Nothing is counted yet (so the old way is open if the call
   * comes to nothing): the battle's raid and pace are taken when the defender's input arrives.
   */
  private blive(
    conn: RegionConn,
    st: ConnState,
    from: City,
    m: Extract<RegionClientMsg, { t: 'blive' }>,
    now: number,
  ): void {
    const meta = this.meta!;
    const off = (why: string, extra: { refused?: true; later?: number } = {}) =>
      conn.send({ t: 'bliveoff', id: m.id, why, ...extra });
    // Asked again (the answer was lost): where that battle stands.
    const mine = this.lives.get(liveKey(from.slot, m.id));
    if (mine) {
      if (mine.s.state === 'running') conn.send(this.bstart(mine, 'attacker'));
      return;
    }
    const over = this.replayOf(m.id, from.slot);
    if (over) return this.sendEnd(conn, over);
    const target = meta.cities.find((c) => c.slot === m.to);
    if (!meta.rules?.war) return off('War is off in this region', { refused: true });
    if (!target || target.slot === from.slot) return off('That city isn’t in the region', { refused: true });
    if (st.v < LIVE_PROTOCOL) return off('Live battles need a newer Citybloom');
    // Kept for that city already, by the old way: that way knows it.
    if (
      target.pending?.some((p) => p.id === m.id && p.from === from.slot) ||
      target.seen?.includes(`${from.slot}:${m.id}`)
    )
      return off('That battle is kept already');
    const why = this.strikeRefusal(from, target, m.super === true, now);
    if (why) return off(why, { refused: true });
    if (this.budget.over(now)) return off(dailyLimitText('region'), { refused: true });
    if (!this.battlesOf(from.slot).has(now))
      return off('The region takes a few battles at a time', {
        refused: true,
        later: this.limits.battleEvery,
      });
    // What a live battle needs: a free place, and the defender's page here and able.
    if (this.runOf(from.slot)) return off(`${from.name} is in a live battle already`);
    if (this.runOf(target.slot)) return off(`${target.name} is in a live battle already`);
    if (this.lives.size >= LIVE.sessions)
      return off(`The region fights ${count(LIVE.sessions)} live battles at a time`);
    if (!this.online(target.slot)) return off(`${target.name}’s player isn’t here`);
    const ears = this.liveConns(target.slot);
    if (!ears.length) return off(`${target.name}’s page is an older version, which can’t fight live`);
    const s = new LiveSession(m.id, from.slot, target.slot, m.force, m.super === true, now);
    this.lives.set(liveKey(from.slot, m.id), { s, watchers: new Set() });
    for (const c of ears)
      c.send({
        t: 'bcall',
        id: m.id,
        from: from.slot,
        force: m.force,
        ...(m.super ? { super: true as const } : {}),
      });
  }

  /**
   * The defender's input: the battle begins. The checks are made again (a call may wait twenty
   * seconds), then the raid is counted in the target's day, the pace is taken and both players start.
   */
  private binput(
    conn: RegionConn,
    target: City,
    m: Extract<RegionClientMsg, { t: 'binput' }>,
    now: number,
  ): void {
    const r = this.runBy(target.slot, m.id);
    if (!r) return void conn.send({ t: 'bliveoff', id: m.id, why: 'That call is over' });
    const s = r.s;
    if (s.to !== target.slot || s.state !== 'calling') return;
    const input = this.gather(`live:${target.slot}:${m.id}`, m.parts, m.part, m.data);
    if (!input) return;
    const from = this.meta!.cities.find((c) => c.slot === s.from)!;
    const why = !this.meta!.rules?.war
      ? 'War is off in this region'
      : (this.strikeRefusal(from, target, s.superweapon, now, s) ??
        (this.budget.over(now) ? dailyLimitText('region') : null));
    if (why) return this.callOff(r, why, 'both', { refused: true });
    if (!this.battlesOf(s.from).take(now))
      return this.callOff(r, 'The region takes a few battles at a time', 'both', {
        refused: true,
        later: this.limits.battleEvery,
      });
    // Counted in the target's day (and its superweapon's), and it may answer the attacker: in memory,
    // written when the battle ends.
    const day = Math.floor(now / DAY_MS);
    target.raids = { day, n: (target.raids?.day === day ? target.raids.n : 0) + 1 };
    target.raidedBy = { ...(target.raidedBy ?? {}), [from.slot]: now };
    if (s.superweapon) this.countSuper(target, now);
    this.dirty = true;
    s.start(input, now);
    for (const c of this.liveConns(s.from)) c.send(this.bstart(r, 'attacker'));
    for (const c of this.liveConns(s.to)) c.send(this.bstart(r, 'defender'));
    this.toLive({ t: 'blivenow', id: s.id, from: s.from, to: s.to }, [s.from, s.to]);
    this.broadcast();
  }

  /** A combatant's page says how far it has run, and what its player ordered. */
  private bstep(
    conn: RegionConn,
    city: City,
    m: Extract<RegionClientMsg, { t: 'bstep' }>,
    now: number,
  ): void {
    const r = this.runBy(city.slot, m.id);
    if (!r) return void conn.send(gone(m.id));
    const s = r.s;
    if (s.state !== 'running') return;
    const i = s.sideOf(city.slot) as LiveSide;
    s.report(i, m.step, now);
    let ords: LiveOrder[] = [];
    if (m.orders?.length) {
      const { stamped, refused } = s.stamp(i, m.orders);
      ords = stamped;
      if (refused) conn.send({ t: 'notice', text: refused });
    }
    this.advance(r, now, ords);
  }

  /** A combatant's page reached the battle's end: its step and hash. */
  private bdone(
    conn: RegionConn,
    city: City,
    m: Extract<RegionClientMsg, { t: 'bdone' }>,
    now: number,
  ): void {
    const r = this.runBy(city.slot, m.id);
    if (!r) {
      const over = this.replayOf(m.id, undefined, city.slot);
      return void (over ? this.sendEnd(conn, over) : conn.send(gone(m.id)));
    }
    if (r.s.state !== 'running') return;
    r.s.finish(r.s.sideOf(city.slot) as LiveSide, m.step, m.hash, now);
    this.advance(r, now);
  }

  /** The defender won't fight live: the attacker's force goes the old way. */
  private bdecline(city: City, m: Extract<RegionClientMsg, { t: 'bdecline' }>): void {
    const r = this.runBy(city.slot, m.id);
    if (!r || r.s.to !== city.slot || r.s.state !== 'calling') return;
    this.callOff(r, `${city.name} would rather not fight live`, 'attacker');
  }

  /**
   * A combatant comes back, or its page restarted: it gets the battle from the start again (the
   * input and every order so far) and takes command again, and the others are told.
   */
  private bjoin(conn: RegionConn, city: City, m: { id: string }, now: number): void {
    const r = this.runBy(city.slot, m.id);
    if (!r) {
      const over = this.replayOf(m.id, undefined, city.slot);
      return void (over ? this.sendEnd(conn, over) : conn.send(gone(m.id)));
    }
    const s = r.s;
    if (s.state !== 'running') return;
    const i = s.sideOf(city.slot) as LiveSide;
    const was = s.sides[i].handed;
    s.rejoin(i, now);
    conn.send(this.bstart(r, i === 0 ? 'attacker' : 'defender'));
    if (was) {
      const text = `${city.name} is back in command`;
      for (const c of this.liveConns(s.sides[i === 0 ? 1 : 0].slot)) c.send({ t: 'notice', text });
      for (const c of r.watchers) c.send({ t: 'notice', text });
    }
  }

  /** Any city may watch a live battle: the input, the orders so far, then what follows. */
  private bwatch(
    conn: RegionConn,
    city: City,
    m: Extract<RegionClientMsg, { t: 'bwatch' }>,
    now: number,
  ): void {
    let r: LiveRun | undefined;
    for (const x of this.lives.values())
      if (x.s.state === 'running' && x.s.id === m.id && (m.from === undefined || x.s.from === m.from)) r = x;
    if (!r) {
      // Over, or not a battle: a finished one is shown from its record.
      const over = this.replayOf(m.id, m.from);
      return void (over
        ? this.sendEnd(conn, over)
        : conn.send({ t: 'notice', text: 'That battle isn’t on any more' }));
    }
    if (r.s.sideOf(city.slot) >= 0) return this.bjoin(conn, city, m, now);
    if (r.watchers.size >= LIVE.watchers && !r.watchers.has(conn))
      return void conn.send({ t: 'notice', text: 'That battle has all the watchers it takes' });
    r.watchers.add(conn);
    conn.send(this.bstart(r, 'watcher'));
  }

  /** A finished battle the region keeps, as the record it's run again from. */
  private breplay(conn: RegionConn, m: Extract<RegionClientMsg, { t: 'breplay' }>): void {
    const rep = this.replayOf(m.id, m.from);
    const record = rep && this.loadRecord(rep);
    if (!rep || !record) return void conn.send({ t: 'notice', text: 'That battle isn’t kept any more' });
    conn.send({ t: 'breplaydata', id: rep.id, from: rep.from, to: rep.to, record });
  }

  private replayOf(id: string, from?: number, combatant?: number): LiveReplay | undefined {
    return (this.meta?.replays ?? []).find(
      (r) =>
        r.id === id &&
        (from === undefined || r.from === from) &&
        (combatant === undefined || r.from === combatant || r.to === combatant),
    );
  }

  private loadRecord(rep: LiveReplay): LiveRecord | null {
    const [slot, k] = replayRow(rep.k);
    const parts = this.store.loadBattle(slot, k);
    if (!parts) return null;
    try {
      const rec = JSON.parse(parts.join('')) as LiveRecord;
      return rec.v === 1 && rec.id === rep.id ? rec : null;
    } catch {
      return null;
    }
  }

  /** How a finished battle ended, and its record, for a page that missed it. */
  private sendEnd(conn: RegionConn, rep: LiveReplay): void {
    conn.send(endMsg(rep));
    const record = this.loadRecord(rep);
    if (record) conn.send({ t: 'breplaydata', id: rep.id, from: rep.from, to: rep.to, record });
  }

  /**
   * A battle is over (both pages reported its end, or one did and the other was left behind) or
   * abandoned. The one write of its life: its record is kept for replays, and for whoever of its
   * cities wasn't here at the end: a defender gets it as a battle kept for it (its own sim runs it, with
   * the orders), an attacker is owed its end and the record.
   */
  private endRun(r: LiveRun, end: LiveEnd, now: number): void {
    const s = r.s;
    const meta = this.meta!;
    this.lives.delete(liveKey(s.from, s.id));
    const record: LiveRecord = {
      v: 1,
      id: s.id,
      from: s.from,
      to: s.to,
      input: s.input,
      orders: s.orders,
      end,
    };
    const target = meta.cities.find((c) => c.slot === s.to)!;
    const attacker = meta.cities.find((c) => c.slot === s.from)!;
    const rep: LiveReplay = {
      id: s.id,
      from: s.from,
      to: s.to,
      step: end.step,
      hash: end.hash,
      agree: end.agree,
      ...(end.solo ? { solo: true as const } : {}),
      ...(end.abandoned ? { abandoned: true as const } : {}),
      k: 0,
    };
    // Kept for replays, within the day's rows (a battle lost for want of a row would be worse).
    let kept = false;
    if (!this.budget.over(now)) {
      const list = (meta.replays ??= []);
      let k = 0;
      if (list.length >= LIVE.replays) k = list.shift()!.k;
      else while (list.some((x) => x.k === k)) k++;
      rep.k = k;
      const [slot, row] = replayRow(k);
      this.store.saveBattle(slot, row, chunks(JSON.stringify(record)));
      list.push(rep);
      kept = true;
    }
    if (this.liveConns(target.slot).length) {
      // The defender saw it end: its own sim has the battle. Remembered, so a `battle` of the same id
      // (the attacker's page, going the old way after a crash) is acknowledged and not counted again.
      target.seen = [...(target.seen ?? []), `${s.from}:${s.id}`].slice(-SEEN_KEEP);
    } else {
      // Not here: kept for it with its orders, as any battle is (a place was kept for it: `liveAgainst`).
      const pending = (target.pending ??= []);
      let k = 0;
      while (pending.some((p) => p.k === k)) k++;
      this.store.saveBattle(target.slot, k, chunks(JSON.stringify(record)));
      pending.push({
        id: s.id,
        from: s.from,
        at: now,
        k,
        live: true,
        ...(s.superweapon ? { super: true as const } : {}),
      });
    }
    if (!this.liveConns(attacker.slot).length && kept)
      attacker.liveOwed = [...(attacker.liveOwed ?? []), s.id].slice(-4);
    // One line of the region's war history, written with the battle's record.
    this.fwRun(
      0,
      (fw) =>
        fw.battle(s.from, s.to, s.id, {
          live: true,
          agree: end.agree,
          ...(end.abandoned ? { abandoned: true as const } : {}),
        }),
      false,
    );
    // To every city's page that speaks live battles, the watchers (cities all) among them.
    this.toLive(endMsg(rep));
    this.save();
    this.broadcast();
  }

  /** On a city's welcome: the live battles on now (to watch, or to come back to), and the ends it is owed. */
  private liveWelcome(conn: RegionConn, city: City): void {
    for (const r of this.lives.values()) {
      if (r.s.state === 'running') conn.send({ t: 'blivenow', id: r.s.id, from: r.s.from, to: r.s.to });
      // A call its page missed (it reloaded within the twenty seconds): asked again.
      else if (r.s.to === city.slot)
        conn.send({
          t: 'bcall',
          id: r.s.id,
          from: r.s.from,
          force: r.s.force as object,
          ...(r.s.superweapon ? { super: true as const } : {}),
        });
    }
    const owed = city.liveOwed;
    if (!owed?.length) return;
    delete city.liveOwed;
    for (const id of owed) {
      const rep = this.replayOf(id, city.slot);
      if (rep) this.sendEnd(conn, rep);
    }
    this.changed(city.slot);
  }

  /**
   * An operation against another city of the region (M37): the region decides whether it stands,
   * rolls its outcome with its own dice, remembers its verdict (an operation sent again gets the
   * same answer), counts it in the target's day and keeps it for the target until seen.
   */
  private op(conn: RegionConn, from: City, m: Extract<RegionClientMsg, { t: 'op' }>, now: number): void {
    const meta = this.meta!;
    // Sent again (its answer was lost): the same answer, whatever has changed since.
    const known = from.verdicts?.find((v) => v.id === m.id);
    if (known) {
      if (known.to !== m.to || known.op !== m.op)
        return conn.send({ t: 'opRefused', id: m.id, reason: 'The region decided that operation already' });
      return conn.send({
        t: 'opKept',
        id: m.id,
        outcome: known.outcome,
        ...(known.stole ? { stole: known.stole } : {}),
      });
    }
    const target = meta.cities.find((c) => c.slot === m.to);
    const why = this.opRefusal(from, target, m, now);
    if (why) return conn.send({ t: 'opRefused', id: m.id, reason: why });
    if (this.budget.over(now))
      return conn.send({ t: 'opRefused', id: m.id, reason: dailyLimitText('region') });
    // A few at once, then one every couple of minutes (asked again later).
    if (!this.opsOf(from.slot).take(now))
      return conn.send({
        t: 'opRefused',
        id: m.id,
        reason: 'The region takes a few operations at a time',
        later: this.limits.opEvery,
      });
    const to = target!;
    const tiers = from.report!.tiers!;
    // The verdict: a spy rolled against the target's counter-intelligence, as the sim does a
    // computer neighbour's (the same whole-number odds); a blackout always lands.
    let outcome: OpOutcome = 'success';
    let stole: TierKey | undefined;
    if (m.op !== 'blackout') {
      const intel = tiers[BRANCH_IDS.indexOf('intel')]!;
      outcome = spyOutcome(this.roll(), spyOdds(m.op, intel, to.report!.counter ?? 0, false, intel >= 3));
      if (outcome === 'success' && m.op === 'steal') {
        const b = BRANCH_IDS.indexOf(m.branch!);
        stole = `${m.branch!}${Math.min(4, tiers[b]! + 1)}` as TierKey;
      }
    }
    // Counted in the target's day: spies (saboteurs among them), or a superweapon and a raid.
    const day = Math.floor(now / DAY_MS);
    if (m.op === 'blackout') {
      this.countSuper(to, now);
      to.raids = { day, n: (to.raids?.day === day ? to.raids.n : 0) + 1 };
    } else {
      const was = to.spied?.day === day ? to.spied : { day, n: 0, sabotage: 0 };
      to.spied = { day, n: was.n + 1, sabotage: was.sabotage + (m.op === 'sabotage' ? 1 : 0) };
    }
    // A strike the target knows of (a spy caught, a saboteur's work, a blackout) lets it answer.
    if (outcome === 'caught' || (outcome === 'success' && (m.op === 'sabotage' || m.op === 'blackout')))
      to.raidedBy = { ...(to.raidedBy ?? {}), [from.slot]: now };
    from.verdicts = [
      ...(from.verdicts ?? []),
      { id: m.id, to: to.slot, op: m.op, outcome, ...(stole ? { stole } : {}) },
    ].slice(-VERDICTS_KEEP);
    // Kept for the target only when it does something there (a quiet failure leaves no trace).
    const kept =
      outcome === 'failed'
        ? null
        : {
            id: m.id,
            from: from.slot,
            op: m.op,
            outcome,
            ...(m.op === 'sabotage' ? { target: m.target! } : {}),
            at: now,
          };
    if (kept) (to.ops ??= []).push(kept);
    this.save();
    conn.send({ t: 'opKept', id: m.id, outcome, ...(stole ? { stole } : {}) });
    if (outcome === 'caught')
      for (const c of this.conns.keys())
        c.send({ t: 'notice', text: `A spy from ${from.name} was caught in ${to.name}` });
    this.broadcast();
    // The target playing now hears of it at once (kept until it says it has seen it).
    if (kept) for (const [c, st] of this.conns) if (st.slot === to.slot) c.send(opOn(kept, false));
  }
}

/** An operation as its target hears of it (M37). */
function opOn(o: NonNullable<City['ops']>[number], late: boolean): RegionRoomMsg {
  return {
    t: 'opOn',
    from: o.from,
    id: o.id,
    op: o.op,
    outcome: o.outcome,
    ...(o.target ? { target: o.target } : {}),
    late,
  };
}

/** A page speaks of a live battle the region doesn't have (it ended long ago, or the room restarted). */
function gone(id: string): RegionRoomMsg {
  return { t: 'bliveoff', id, why: 'The region has no such battle now', gone: true };
}

/** A finished battle's end, as the region tells it. */
function endMsg(r: LiveReplay): RegionRoomMsg {
  return {
    t: 'bend',
    id: r.id,
    from: r.from,
    to: r.to,
    step: r.step,
    hash: r.hash,
    agree: r.agree,
    ...(r.solo ? { solo: true as const } : {}),
    ...(r.abandoned ? { abandoned: true as const } : {}),
  };
}
