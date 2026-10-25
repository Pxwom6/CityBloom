/**
 * A city's place in a shared region (M32): it reports itself to the region now and then (offers,
 * people, deals, a small picture, and a save for visitors), takes in the others' news as a
 * `regionUpdate` command in its own sim, and pays into the region project. The city itself stays
 * single player: it runs at its own speed on its owner's machine.
 */
import type { Command, CommandResult } from '../sim/commands';
import type { RegionReport, RegionUpdate } from '../sim/systems/region';
import type { SaveFile } from '../sim/save';
import { PROTOCOL_VERSION } from '../../relay/protocol';
import type { RegionClientMsg, RegionRoomMsg, RegionView } from '../../relay/region';
import type { Link } from './link';
import { decodeSnapshot, encodeSnapshot } from './snapshot';

/** What a region link needs from the city: its own commands and queries, and a save. */
export interface CityPort {
  command(cmd: Command): Promise<CommandResult>;
  report(): Promise<RegionReport>;
  save(): Promise<SaveFile>;
  cityName(): string;
  /** A small picture of the city (a data URL), or null. */
  thumb?(): string | null;
}

/** The region's news as this city's `regionUpdate` (pure: tested on its own). */
export function regionUpdateFor(view: RegionView, slot: number): RegionUpdate {
  const others = view.cities.filter((c) => c.slot !== slot && c.report);
  const p = view.project;
  const mine = p.by[slot] ?? 0;
  return {
    cities: others.map((c) => ({
      slot: c.slot,
      name: c.name,
      mayor: c.mayor,
      color: c.color,
      population: c.report!.population,
      kind: c.report!.kind,
      offers: c.report!.offers,
      workers: c.report!.workers,
      jobs: c.report!.jobs,
      shoppers: c.report!.shoppers,
      online: c.online,
    })),
    // The others' deals with this city, from this city's side.
    contracts: others.flatMap((c) =>
      c
        .report!.deals.filter((d) => d.slot === slot)
        .map((d) => ({
          slot: c.slot,
          resource: d.resource,
          direction: d.direction === 'buy' ? ('sell' as const) : ('buy' as const),
          amount: d.amount,
        })),
    ),
    project: {
      total: p.total,
      goal: p.goal,
      funded: p.funded,
      host: p.host === slot,
      built: p.built,
      power: p.built ? Math.round((p.power * mine) / p.goal) : 0,
    },
  };
}

export interface RegionLinkOptions {
  mayor: string;
  color: number;
  create?: { name: string };
  rejoin?: { slot: number; secret: string };
  /** How often to report (ms) and to keep a save for visitors. */
  reportEvery?: number;
  saveEvery?: number;
}

export class RegionLink {
  state: 'connecting' | 'in' | 'reconnecting' | 'closed' = 'connecting';
  slot = 0;
  secret = '';
  view: RegionView | null = null;
  error: string | null = null;
  private link: Link | null = null;
  private timers: ReturnType<typeof setInterval>[] = [];
  private started: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private retry = 0;
  private lastSave = 0;
  private lastThumb = 0;
  onChange: (() => void) | null = null;
  onNotice: ((text: string) => void) | null = null;
  sent = { messages: 0, bytes: 0 };

  constructor(
    private readonly city: CityPort,
    private readonly connect: () => Promise<Link>,
    private readonly opts: RegionLinkOptions,
  ) {
    if (opts.rejoin) {
      this.slot = opts.rejoin.slot;
      this.secret = opts.rejoin.secret;
    }
  }

  start(): Promise<void> {
    const p = new Promise<void>((resolve, reject) => (this.started = { resolve, reject }));
    void this.open();
    this.timers.push(setInterval(() => void this.reportNow(), this.opts.reportEvery ?? 30_000));
    return p;
  }

  private send(m: RegionClientMsg): void {
    if (!this.link) return;
    const t = JSON.stringify(m);
    this.sent.messages++;
    this.sent.bytes += t.length;
    this.link.send(t);
  }

  private async open(): Promise<void> {
    try {
      const link = await this.connect();
      if (this.state === 'closed') return link.close();
      this.link = link;
      link.onmessage = (t) => {
        if (t === 'pong') return;
        try {
          void this.receive(JSON.parse(t) as RegionRoomMsg);
        } catch {
          /* not for us */
        }
      };
      link.onclose = () => this.dropped();
      this.send({
        t: 'rhello',
        v: PROTOCOL_VERSION,
        mayor: this.opts.mayor,
        color: this.opts.color,
        city: this.city.cityName(),
        ...(this.opts.create && !this.slot ? { create: this.opts.create } : {}),
        ...(this.slot ? { rejoin: { slot: this.slot, secret: this.secret } } : {}),
      });
    } catch (err) {
      if (this.slot) return this.dropped();
      this.fail(`Couldn't reach the region (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  private dropped(): void {
    this.link = null;
    if (this.state === 'closed') return;
    if (!this.slot) return this.fail('The connection closed');
    if (this.state !== 'reconnecting') this.onNotice?.('Reconnecting to the region…');
    this.state = 'reconnecting';
    this.onChange?.();
    setTimeout(
      () => this.state === 'reconnecting' && void this.open(),
      Math.min(15_000, 500 * 2 ** this.retry++),
    );
  }

  private fail(text: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.error = text;
    this.started?.reject(new Error(text));
    this.started = null;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.onChange?.();
  }

  private async receive(m: RegionRoomMsg): Promise<void> {
    switch (m.t) {
      case 'rwelcome':
        this.slot = m.slot;
        this.secret = m.secret;
        this.retry = 0;
        if (this.state === 'reconnecting') this.onNotice?.('Back in the region');
        this.state = 'in';
        await this.take(m.region);
        await this.reportNow(true);
        this.started?.resolve();
        this.started = null;
        return;
      case 'region':
        await this.take(m.region);
        return;
      case 'notice':
        this.onNotice?.(m.text);
        return;
      case 'error':
        this.fail(m.text);
        this.link?.close();
        return;
      case 'citysave':
        return;
    }
  }

  /** The region's news into this city's sim. */
  private async take(view: RegionView): Promise<void> {
    this.view = view;
    if (this.slot)
      await this.city.command({ type: 'regionUpdate', update: regionUpdateFor(view, this.slot) });
    this.onChange?.();
  }

  /** Tell the region how this city stands (and, now and then, its picture and a save for visitors). */
  async reportNow(force = false): Promise<void> {
    if (this.state !== 'in' || !this.link) return;
    const now = performance.now();
    const report = await this.city.report();
    const thumb = force || now - this.lastThumb > 120_000 ? this.city.thumb?.() : null;
    if (thumb) this.lastThumb = now;
    this.send({ t: 'report', city: this.city.cityName(), report, ...(thumb ? { thumb } : {}) });
    if (force || now - this.lastSave > (this.opts.saveEvery ?? 300_000)) {
      this.lastSave = now;
      const save = await this.city.save();
      const { parts } = encodeSnapshot({ save, history: [], seq: -1, eventHash: 0 }, `${this.slot}`);
      const id = `${this.slot}-${Math.round(now)}`;
      parts.forEach((data, part) => this.send({ t: 'save', id, part, parts: parts.length, data }));
    }
  }

  /** Pay into the region project: this city's sim takes the money, then the region hears of it. */
  async contribute(amount: number): Promise<CommandResult> {
    const r = await this.city.command({ type: 'contributeProject', amount });
    if (r.ok && r.cost > 0) this.send({ t: 'contribute', amount: r.cost });
    return r;
  }

  leave(): void {
    if (this.state === 'closed') return;
    void this.reportNow(true).finally(() => {
      this.state = 'closed';
      for (const t of this.timers) clearInterval(t);
      this.timers = [];
      this.link?.close();
      this.link = null;
      this.onChange?.();
    });
  }

  /** For tests: the connection drops (it comes back by itself). */
  dropForTest(): void {
    const l = this.link;
    l?.close();
    this.dropped();
  }
}

/** A neighbour's latest city from the region, to look round read-only (M32). */
export function fetchCitySave(
  connect: () => Promise<Link>,
  slot: number,
  mayor: string,
  timeoutMs = 30_000,
): Promise<SaveFile> {
  return new Promise((resolve, reject) => {
    let link: Link | null = null;
    const parts: (string | null)[] = [];
    const timer = setTimeout(() => {
      link?.close();
      reject(new Error('The region didn’t send that city in time'));
    }, timeoutMs);
    const done = (err: Error | null, save?: SaveFile) => {
      clearTimeout(timer);
      link?.close();
      if (err) reject(err);
      else resolve(save!);
    };
    connect().then(
      (l) => {
        link = l;
        l.onmessage = (t) => {
          if (t === 'pong') return;
          const m = JSON.parse(t) as RegionRoomMsg;
          if (m.t === 'rwelcome') l.send(JSON.stringify({ t: 'visit', slot } satisfies RegionClientMsg));
          else if (m.t === 'error') done(new Error(m.text));
          else if (m.t === 'citysave' && m.slot === slot) {
            if (parts.length !== m.parts)
              parts.splice(0, parts.length, ...new Array<string | null>(m.parts).fill(null));
            parts[m.part] = m.data;
            if (parts.every((x) => x !== null)) done(null, decodeSnapshot(parts as string[]).save);
          }
        };
        l.onclose = () => done(new Error('The region closed the connection'));
        l.send(
          JSON.stringify({
            t: 'rhello',
            v: PROTOCOL_VERSION,
            mayor,
            color: 0,
            city: '',
            visitor: true,
          } satisfies RegionClientMsg),
        );
      },
      (err: unknown) => done(err instanceof Error ? err : new Error(String(err))),
    );
  });
}
