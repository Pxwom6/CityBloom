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
  MAX_SNAPSHOT_PARTS,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  SNAPSHOT_PART,
  cleanCityName,
  cleanName,
  makeSecret,
  secureIndex,
} from './protocol';
import { DAY_MS, DailyRows, TokenBucket, dailyLimitText, type RowBudget } from './limits';
import type { RoomEnv } from './room';

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
  | { t: 'opSeen'; id: string; from: number };

export type RegionRoomMsg =
  | { t: 'rwelcome'; slot: number; secret: string; region: RegionView }
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
  | { t: 'notice'; text: string }
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
  bind?(slot: number): void;
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
  pending?: { id: string; from: number; at: number; k: number; away?: boolean; super?: true }[];
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
    default:
      return null;
  }
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

  private connState(slot: number): ConnState {
    const now = this.env.now();
    return {
      slot,
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
  }

  /** Why the region shut for good, once it has (F10). */
  private shut: string | null = null;

  /** The region shuts for good (its peer-to-peer host's browser is leaving): every city is told. */
  close(text: string): void {
    this.shut = text;
    for (const c of [...this.conns.keys()]) {
      c.send({ t: 'error', code: 'closed', text });
      c.close(1000, 'closed');
    }
    this.conns.clear();
  }

  /** After a Durable Object wakes: a socket and the city it spoke for. */
  reattach(conn: RegionConn, slot: number): void {
    this.conns.set(conn, this.connState(slot));
  }

  closed(conn: RegionConn): void {
    const st = this.conns.get(conn);
    this.conns.delete(conn);
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
  private raidRefusal(from: City, target: City, now: number): string | null {
    if (!from.report || !target.report) return `${target.name} isn’t in the region’s war yet`;
    if (from.report.shield === 'neutral') return `${from.name} is neutral: it raids no one`;
    if (target.report.shield === 'neutral') return `${target.name} is neutral`;
    // A region on one player's computer ends with its host: a raid there needs its target's player.
    if (this.kind === 'p2p' && !this.online(target.slot))
      return `${target.name}’s player isn’t here, and this region keeps nothing for them`;
    if ((target.pending?.length ?? 0) >= MAX_PENDING_BATTLES)
      return `${target.name} has ${MAX_PENDING_BATTLES} raids waiting for its player: no more until it takes them`;
    if (target.report.shield === 'new' && !this.raidedBy(from, now).includes(target.slot))
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
    if (raw === 'ping') return;
    if (this.shut) {
      conn.send({ t: 'error', code: 'closed', text: this.shut });
      return conn.close(1000, 'closed');
    }
    const st = this.conns.get(conn);
    if (!st) return;
    // A burst is fine, a flood is dropped, a torrent closes the connection.
    const now = this.env.now();
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
        const before = JSON.stringify([city.report, city.thumb]);
        const was = matters(city);
        city.name = m.city;
        city.report = m.report;
        if (m.thumb) city.thumb = m.thumb;
        const p = this.meta.project;
        const built = m.report.projectBuilt && p.host === slot && !p.built;
        if (built) p.built = true;
        this.broadcast();
        if (built || matters(city) !== was) this.changed(slot);
        else if (JSON.stringify([city.report, city.thumb]) !== before) {
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
        const key = `${slot}:${m.id}`;
        let inc = this.battleIn.get(key);
        if (!inc) {
          if (this.battleIn.size > 16) this.battleIn.clear();
          this.battleIn.set(key, (inc = { parts: new Array<string | null>(m.parts).fill(null), got: 0 }));
        }
        if (inc.parts.length !== m.parts) return;
        if (inc.parts[m.part] === null) inc.got++;
        inc.parts[m.part] = m.data;
        if (inc.got < inc.parts.length) return;
        this.battleIn.delete(key);
        // The region decides whether it stands (M36): the target's shield, the sender's right to
        // answer a newcomer that raided it, and the day's raids. The sender's city hasn't taken the
        // result yet, so a refusal leaves both cities as they were. One bringing a superweapon (M37)
        // needs the region's rules, its target's player here (no half-strength fight again) and the
        // target's superweapon for the day.
        const why = this.raidRefusal(city, target, now) ?? (m.super ? this.superRefusal(target, now) : null);
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
        const parts = inc.parts as string[];
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
    if (m.v !== PROTOCOL_VERSION)
      return this.reject(
        conn,
        'version',
        'This region runs a different version of Citybloom: reload to update',
      );
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
    } else if (city.mayor !== m.mayor || city.color !== m.color) write = 'changed';
    city.mayor = m.mayor;
    city.color = m.color;
    city.heard = now;
    st.slot = city.slot;
    conn.bind?.(city.slot);
    // A new city is written at once (four at most, ever); a change at the city's pace.
    if (write === 'new') this.save();
    else if (write === 'changed') this.changed(city.slot);
    conn.send({ t: 'rwelcome', slot: city.slot, secret: city.secret, region: this.view() });
    // Battles fought against it while it was away (M35), oldest first.
    for (const p of city.pending ?? []) {
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
          }),
        );
    }
    // Operations against it it hasn't seen (M37): late, so they bring only a notice.
    for (const o of city.ops ?? []) conn.send(opOn(o, true));
    this.broadcast();
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
