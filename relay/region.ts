/**
 * A shared region (M32): up to four players' cities side by side, each played on its owner's
 * machine at its own speed. Unlike a room, a region orders nothing: it keeps each city's latest
 * report (its offers, people, deals and a small picture), the region project's fund, and each city's
 * latest save for visitors, and passes the news on. Each city settles its deals every game month on
 * its own clock from what the others last reported, so an offline city's last offer stands.
 *
 * Runs in the local relay, a Durable Object (`/region/CODE`) and a host's browser alike.
 */
import type { RegionReport } from '../src/sim/systems/region';
import { DEAL_RESOURCES, NEIGHBOUR_KINDS } from '../src/data/region';
import { MAX_NAME, PLAYER_COLORS, PROTOCOL_VERSION, SNAPSHOT_PART, cleanName, makeSecret } from './protocol';

export const MAX_CITIES = 4;
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
}

export type RegionClientMsg =
  | {
      t: 'rhello';
      v: number;
      mayor: string;
      color: number;
      city: string;
      create?: { name: string };
      rejoin?: { slot: number; secret: string };
      /** Just looking (a visitor reading a city): no slot. */
      visitor?: boolean;
    }
  | { t: 'report'; city: string; report: RegionReport; thumb?: string }
  | { t: 'contribute'; amount: number }
  | { t: 'save'; id: string; part: number; parts: number; data: string }
  | { t: 'visit'; slot: number };

export type RegionRoomMsg =
  | { t: 'rwelcome'; slot: number; secret: string; region: RegionView }
  | { t: 'region'; region: RegionView }
  | { t: 'citysave'; slot: number; part: number; parts: number; data: string }
  | { t: 'notice'; text: string }
  | {
      t: 'error';
      /** `closed`: the region shut for good (a peer-to-peer host's browser left, F10). */
      code: 'version' | 'no-region' | 'full' | 'exists' | 'bad-message' | 'no-save' | 'closed';
      text: string;
    };

export interface RegionConn {
  send(m: RegionRoomMsg): void;
  close(code: number, reason: string): void;
  bind?(slot: number): void;
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
}

export interface RegionMeta {
  code: string;
  name: string;
  kind: RegionView['kind'];
  nextSlot: number;
  cities: City[];
  project: { total: number; by: Record<number, number>; host: number; built: boolean };
}

export interface RegionStore {
  loadMeta(): RegionMeta | null;
  saveMeta(m: RegionMeta): void;
  saveCity(slot: number, parts: string[]): void;
  loadCity(slot: number): string[] | null;
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
    this.rowsWritten += parts.length;
    this.saves.set(slot, parts);
  }
  loadCity(slot: number) {
    return this.saves.get(slot) ?? null;
  }
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
      const city = typeof m.city === 'string' ? m.city.slice(0, 40) : null;
      if (!finite(m.v, 0, 1e6) || !mayor || city === null || !finite(m.color, 0, PLAYER_COLORS.length - 1))
        return null;
      const out: RegionClientMsg = { t: 'rhello', v: m.v as number, mayor, color: m.color as number, city };
      if (m.create !== undefined) {
        const c = m.create as Record<string, unknown>;
        const name = cleanName(c?.name);
        if (!name) return null;
        out.create = { name: name.slice(0, MAX_NAME + 20) };
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
        city: m.city.slice(0, 40),
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
        !finite(m.parts, 1, 200) ||
        !finite(m.part, 0, (m.parts as number) - 1)
      )
        return null;
      if (typeof m.data !== 'string' || m.data.length > SNAPSHOT_PART) return null;
      return { t: 'save', id: m.id, part: m.part as number, parts: m.parts as number, data: m.data };
    case 'visit':
      return finite(m.slot, 1, 64) ? { t: 'visit', slot: m.slot as number } : null;
    default:
      return null;
  }
}

export class RegionRoom {
  private meta: RegionMeta | null;
  /** Connections and the city each speaks for (0: a visitor, or not said hello yet). */
  private conns = new Map<RegionConn, number>();
  private incoming = new Map<number, { id: string; parts: (string | null)[] }>();

  constructor(
    readonly code: string,
    readonly kind: RegionView['kind'],
    private readonly store: RegionStore,
    private readonly env: { now(): number },
  ) {
    this.meta = store.loadMeta();
  }

  get exists(): boolean {
    return !!this.meta;
  }

  open(conn: RegionConn): void {
    // A shut room answers whatever comes next (the hello) with why.
    if (this.shut) return;
    this.conns.set(conn, 0);
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
    this.conns.set(conn, slot);
  }

  closed(conn: RegionConn): void {
    const slot = this.conns.get(conn);
    this.conns.delete(conn);
    if (slot) this.broadcast();
  }

  private online(slot: number): boolean {
    for (const s of this.conns.values()) if (s === slot) return true;
    return false;
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
    this.conns.delete(conn);
  }

  message(conn: RegionConn, raw: string): void {
    if (raw === 'ping') return;
    if (this.shut) {
      conn.send({ t: 'error', code: 'closed', text: this.shut });
      return conn.close(1000, 'closed');
    }
    if (!this.conns.has(conn)) return;
    const m = parseRegionMsg(raw);
    if (!m) return this.reject(conn, 'bad-message', 'A message the region could not read');
    const slot = this.conns.get(conn)!;
    if (m.t === 'rhello') return this.hello(conn, m);
    if (!this.meta) return;
    if (m.t === 'visit') {
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
    city.heard = this.env.now();
    switch (m.t) {
      case 'report':
        city.name = m.city;
        city.report = m.report;
        if (m.thumb) city.thumb = m.thumb;
        if (m.report.projectBuilt && this.meta.project.host === slot) this.meta.project.built = true;
        this.store.saveMeta(this.meta);
        this.broadcast();
        return;
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
        this.store.saveMeta(this.meta);
        this.broadcast();
        return;
      }
      case 'save': {
        let inc = this.incoming.get(slot);
        if (!inc || inc.id !== m.id)
          this.incoming.set(slot, (inc = { id: m.id, parts: new Array<string | null>(m.parts).fill(null) }));
        if (inc.parts.length !== m.parts) return;
        inc.parts[m.part] = m.data;
        if (inc.parts.some((x) => x === null)) return;
        this.incoming.delete(slot);
        this.store.saveCity(slot, inc.parts as string[]);
        if (!city.saved) {
          city.saved = true;
          this.store.saveMeta(this.meta);
          this.broadcast();
        }
        return;
      }
    }
  }

  private hello(conn: RegionConn, m: Extract<RegionClientMsg, { t: 'rhello' }>): void {
    if (m.v !== PROTOCOL_VERSION)
      return this.reject(
        conn,
        'version',
        'This region runs a different version of Citybloom: reload to update',
      );
    if (m.create) {
      if (this.meta) return this.reject(conn, 'exists', 'That region code is taken');
      this.meta = {
        code: this.code,
        name: m.create.name,
        kind: this.kind,
        nextSlot: 1,
        cities: [],
        project: { total: 0, by: {}, host: 0, built: false },
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
    if (!city) {
      if (this.meta.cities.length >= MAX_CITIES)
        return this.reject(conn, 'full', `This region is full (${MAX_CITIES} cities)`);
      city = {
        slot: this.meta.nextSlot++,
        name: m.city,
        mayor: m.mayor,
        color: m.color,
        secret: makeSecret(),
        report: null,
        thumb: null,
        heard: this.env.now(),
      };
      this.meta.cities.push(city);
      for (const c of this.conns.keys()) c.send({ t: 'notice', text: `${m.city} joined the region` });
    }
    city.mayor = m.mayor;
    city.color = m.color;
    city.heard = this.env.now();
    this.conns.set(conn, city.slot);
    conn.bind?.(city.slot);
    this.store.saveMeta(this.meta);
    conn.send({ t: 'rwelcome', slot: city.slot, secret: city.secret, region: this.view() });
    this.broadcast();
  }
}
