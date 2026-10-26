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
import { PEACE_RULES, cleanWarRules, warRulesText, type RegionWarRules } from '../src/data/war';
import {
  MAX_SNAPSHOT_PARTS,
  PLAYER_COLORS,
  PROTOCOL_VERSION,
  SNAPSHOT_PART,
  cleanCityName,
  cleanName,
  makeSecret,
} from './protocol';
import { DAY_MS, DailyRows, TokenBucket, dailyLimitText, type RowBudget } from './limits';
import type { RoomEnv } from './room';

export const MAX_CITIES = 4;
/** Battles kept for a city at most (M35), and the parts one may come in. */
export const MAX_PENDING_BATTLES = 8;
const MAX_BATTLE_PARTS = 8;
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
  | { t: 'battle'; to: number; id: string; part: number; parts: number; data: string }
  | { t: 'battleSeen'; id: string }
  /** A force set off against another city of the region (M35): it's told, if its player is here. */
  | { t: 'forceOut'; to: number; units: number; hours: number };

export type RegionRoomMsg =
  | { t: 'rwelcome'; slot: number; secret: string; region: RegionView }
  | { t: 'region'; region: RegionView }
  | { t: 'citysave'; slot: number; part: number; parts: number; data: string }
  /** A battle fought against this city (M35); `late`: kept while it was away. */
  | { t: 'battle'; from: number; id: string; part: number; parts: number; data: string; late: boolean }
  /** The region keeps the battle a city sent until its target has seen it (M35). */
  | { t: 'battleKept'; id: string }
  /** Another city's force is on its way to this one (M35): `hours` of the sender's game time. */
  | { t: 'incoming'; from: number; units: number; hours: number }
  | { t: 'notice'; text: string }
  | {
      t: 'error';
      /** `closed`: the region shut for good (a peer-to-peer host's browser left, F10). */
      code:
        'version' | 'no-region' | 'full' | 'exists' | 'bad-message' | 'no-save' | 'rate' | 'limit' | 'closed';
      text: string;
    };

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
  /** Battles fought against it that it hasn't seen yet (M35): id, attacker, when, store row. */
  pending?: { id: string; from: number; at: number; k: number }[];
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

const finite = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

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
      };
    case 'battleSeen':
      return typeof m.id === 'string' && /^[\w-]{1,40}$/.test(m.id) ? { t: 'battleSeen', id: m.id } : null;
    case 'forceOut':
      return finite(m.to, 1, 64) && finite(m.units, 1, 24) && finite(m.hours, 0, 72)
        ? {
            t: 'forceOut',
            to: m.to as number,
            units: Math.round(m.units as number),
            hours: m.hours as number,
          }
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
    private readonly env: RoomEnv,
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
          JSON.stringify([c.name, c.report?.kind, c.report?.offers, c.report?.deals, c.report?.projectBuilt]);
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
        if (was.war === m.rules.war && was.scale === m.rules.scale) return;
        this.meta.rules = m.rules;
        for (const c of this.conns.keys())
          c.send({ t: 'notice', text: `${city.name} set the region's rules: ${warRulesText(m.rules)}` });
        this.broadcast();
        this.changed(slot);
        return;
      }
      case 'battle': {
        // Only where war is allowed, against another city of the region (M35).
        if (!this.meta.rules?.war || m.to === slot) return;
        const target = this.meta.cities.find((c) => c.slot === m.to);
        if (!target) return;
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
        // Sent again (its acknowledgement was lost): kept already.
        if (target.pending?.some((p) => p.id === m.id)) return conn.send({ t: 'battleKept', id: m.id });
        // A few at once, then one every few minutes; within the region's day.
        if (this.budget.over(now) || !this.battlesOf(slot).take(now)) return;
        const pending = (target.pending ??= []);
        // Eight at most: the oldest gives way.
        if (pending.length >= MAX_PENDING_BATTLES) {
          const old = pending.shift()!;
          this.store.deleteBattle(target.slot, old.k);
        }
        let k = 0;
        while (pending.some((p) => p.k === k)) k++;
        const parts = inc.parts as string[];
        this.store.saveBattle(target.slot, k, parts);
        pending.push({ id: m.id, from: slot, at: now, k });
        this.save();
        conn.send({ t: 'battleKept', id: m.id });
        // The defender playing now gets it at once (it stays kept until it says it has seen it).
        for (const [c, s] of this.conns)
          if (s.slot === target.slot)
            parts.forEach((data, part) =>
              c.send({ t: 'battle', from: slot, id: m.id, part, parts: parts.length, data, late: false }),
            );
        return;
      }
      case 'battleSeen': {
        const pending = city.pending;
        const i = pending?.findIndex((p) => p.id === m.id) ?? -1;
        if (i < 0) return;
        const [seen] = pending!.splice(i, 1);
        if (!pending!.length) delete city.pending;
        this.store.deleteBattle(slot, seen!.k);
        this.save();
        return;
      }
      case 'forceOut': {
        // Its target's player hears of it, if they're here (where war is allowed).
        if (!this.meta.rules?.war || m.to === slot) return;
        for (const [c, s] of this.conns)
          if (s.slot === m.to) c.send({ t: 'incoming', from: slot, units: m.units, hours: m.hours });
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
          conn.send({ t: 'battle', from: p.from, id: p.id, part, parts: parts.length, data, late: true }),
        );
    }
    this.broadcast();
  }
}
