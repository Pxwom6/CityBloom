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
import type { RegionWarRules } from '../data/war';
import { decodeBattle, decodeSnapshot, encodeBattle, encodeSnapshot } from './snapshot';
import type { BattleInput } from '../sim/battle/types';

/** What a region link needs from the city: its own commands and queries, and a save. */
export interface CityPort {
  command(cmd: Command): Promise<CommandResult>;
  report(): Promise<RegionReport>;
  save(): Promise<SaveFile>;
  cityName(): string;
  /** A small picture of the city (a data URL), or null. */
  thumb?(): string | null;
  /**
   * A battle another city of the region fought against this one (M35): `late` when it was kept while
   * this city was away. `taken`: the city has it, saved (the region then forgets it); `later`: not
   * now (it's offered again); `refused`: never (unreadable, or not from a city of the region).
   */
  battle?(input: BattleInput, meta: BattleMeta): Promise<BattleAnswer>;
}

export type BattleAnswer = 'taken' | 'later' | 'refused';

/** Where a battle came from: the sending city's place, its id, kept while away; `away` (M36): the
 * player wasn't here when it came, so it does half the damage. */
export interface BattleMeta {
  from: number;
  id: string;
  late: boolean;
  away?: boolean;
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
      // War (M36): what the region allows against it today, and its shield.
      ...(view.rules?.war && c.raidsLeft !== undefined ? { raidsLeft: c.raidsLeft } : {}),
      ...(view.rules?.war && c.report!.shield ? { shield: c.report!.shield } : {}),
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
    // War (M34): what the region's host allows (an older region sends none: peace).
    ...(view.rules?.war ? { rules: { ...view.rules } } : {}),
  };
}

export interface RegionLinkOptions {
  mayor: string;
  color: number;
  create?: { name: string; rules?: RegionWarRules };
  rejoin?: { slot: number; secret: string };
  /** How often to report (ms) and to keep a save for visitors. */
  reportEvery?: number;
  saveEvery?: number;
  /**
   * Stop reconnecting after this many tries in a row that couldn't reach the region (F10): a region in
   * its host's browser is gone while the host isn't playing.
   */
  giveUpAfter?: number;
}

export class RegionLink {
  state: 'connecting' | 'in' | 'reconnecting' | 'closed' = 'connecting';
  slot = 0;
  secret = '';
  view: RegionView | null = null;
  error: string | null = null;
  /** The region shut for good (its host's browser left it, F10): the city's place there is gone. */
  gone = false;
  private link: Link | null = null;
  private misses = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private started: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private retry = 0;
  private lastSave = 0;
  private lastThumb = 0;
  onChange: (() => void) | null = null;
  onNotice: ((text: string) => void) | null = null;
  /** The region keeps a battle this city sent (M35), and another city's force is on its way here. */
  onBattleKept: ((id: string) => void) | null = null;
  /** The region turned a battle away (M36: its target has taken the day's raids). */
  onBattleRefused: ((id: string, reason: string) => void) | null = null;
  onIncoming: ((m: { from: number; units: number; hours: number }) => void) | null = null;
  /** Battles coming in, in parts (by sender and id), and those taken already (M35). */
  private battlesIn = new Map<string, (string | null)[]>();
  private battlesTaken = new Set<string>();
  /** Taken and acknowledged: offered again (the word was lost), they're acknowledged again. */
  private battlesDone = new Set<string>();
  /** Battles the city couldn't take yet (one was on already): tried again with each report. */
  private battlesWaiting = new Map<
    string,
    { input: BattleInput; from: number; late: boolean; away?: boolean }
  >();
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
      if (this.opts.giveUpAfter && ++this.misses >= this.opts.giveUpAfter)
        return this.fail(
          'The region isn’t open: it runs in its host’s browser while they play. Your city keeps its neighbours as they last were.',
        );
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
        this.misses = 0;
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
        if (m.code === 'closed') this.gone = true;
        this.fail(m.text);
        this.link?.close();
        return;
      case 'citysave':
        return;
      case 'battle': {
        // A battle fought against this city (M35): once whole, the city's own sim re-runs it.
        const key = `${m.from}:${m.id}`;
        let list = this.battlesIn.get(key);
        if (!list || list.length !== m.parts)
          this.battlesIn.set(key, (list = new Array<string | null>(m.parts).fill(null)));
        list[m.part] = m.data;
        if (list.some((x) => x === null)) return;
        this.battlesIn.delete(key);
        if (this.battlesDone.has(m.id)) return this.send({ t: 'battleSeen', id: m.id });
        if (this.battlesTaken.has(m.id)) return;
        let input: BattleInput;
        try {
          input = decodeBattle(list as string[]);
        } catch {
          // Unreadable: it never will be, so the region needn't keep offering it.
          this.send({ t: 'battleSeen', id: m.id });
          return;
        }
        await this.takeBattle(m.id, { input, from: m.from, late: m.late, ...(m.away ? { away: true } : {}) });
        return;
      }
      case 'battleKept':
        this.onBattleKept?.(m.id);
        return;
      case 'battleRefused':
        this.onBattleRefused?.(m.id, m.reason);
        return;
      case 'incoming':
        this.onIncoming?.({ from: m.from, units: m.units, hours: m.hours });
        return;
    }
  }

  /** Hand a whole battle to the city; once it has it, the region can forget it. */
  private async takeBattle(
    id: string,
    b: { input: BattleInput; from: number; late: boolean; away?: boolean },
  ): Promise<void> {
    if (this.battlesTaken.has(id)) return;
    this.battlesTaken.add(id);
    this.battlesWaiting.delete(id);
    const answer =
      (await this.city.battle?.(b.input, {
        from: b.from,
        id,
        late: b.late,
        ...(b.away ? { away: true } : {}),
      })) ?? 'later';
    if (answer !== 'later') {
      this.battlesDone.add(id);
      this.send({ t: 'battleSeen', id });
    } else {
      this.battlesTaken.delete(id);
      this.battlesWaiting.set(id, b);
    }
  }

  /** A force of this city's has set off against another city of the region (M35): it's told. */
  forceOut(to: number, units: number, hours: number): void {
    this.send({ t: 'forceOut', to, units, hours });
  }

  /** Send a battle fought against another city of the region (M35), to keep until it's seen. */
  sendBattle(to: number, input: BattleInput): string {
    const id = input.id.replace(/[^\w-]/g, '').slice(0, 40) || `b${Math.round(performance.now())}`;
    const parts = encodeBattle(input);
    parts.forEach((data, part) => this.send({ t: 'battle', to, id, part, parts: parts.length, data }));
    return id;
  }

  /** The latest save the region keeps of a city in it (M35: battles fought there are fought in it). */
  fetchSave(slot: number): Promise<SaveFile> {
    return fetchCitySave(this.connect, slot, this.opts.mayor);
  }

  /** The region's news into this city's sim. */
  private async take(view: RegionView): Promise<void> {
    this.view = view;
    if (this.slot)
      await this.city.command({ type: 'regionUpdate', update: regionUpdateFor(view, this.slot) });
    this.onChange?.();
  }

  /** Tell the region how this city stands (and, now and then, its picture and a save for visitors). */
  async reportNow(force = false, last = false): Promise<void> {
    if (this.state !== 'in' || !this.link) return;
    if (!last) for (const [id, b] of [...this.battlesWaiting]) await this.takeBattle(id, b);
    const now = performance.now();
    const report = await this.city.report();
    // Leaving, the save goes first and no picture is drawn (a slow device could take seconds over
    // it, and the page is going): the region keeps the last one.
    const thumb = !last && (force || now - this.lastThumb > 120_000) ? this.city.thumb?.() : null;
    if (thumb) this.lastThumb = now;
    this.send({ t: 'report', city: this.city.cityName(), report, ...(thumb ? { thumb } : {}) });
    if (force || now - this.lastSave > (this.opts.saveEvery ?? 300_000)) {
      this.lastSave = now;
      const save = await this.city.save();
      let parts: string[];
      try {
        parts = encodeSnapshot({ save, history: [], seq: -1, eventHash: 0 }, `${this.slot}`).parts;
      } catch {
        // Too big to keep for visitors (F8): the region still has the numbers and the picture.
        return;
      }
      const id = `${this.slot}-${Math.round(now)}`;
      parts.forEach((data, part) =>
        this.send({
          t: 'save',
          id,
          part,
          parts: parts.length,
          data,
          ...(last ? { last: true as const } : {}),
        }),
      );
    }
  }

  /** Set the region's war rules (M34): only its host's are taken. */
  setRules(rules: RegionWarRules): void {
    this.send({ t: 'rrules', rules });
  }

  /** Is this city the region's host (it made the region and sets its rules, M34)? */
  get isHost(): boolean {
    return !!this.slot && (this.view?.host ?? 1) === this.slot;
  }

  /** Pay into the region project: this city's sim takes the money, then the region hears of it. */
  async contribute(amount: number): Promise<CommandResult> {
    const r = await this.city.command({ type: 'contributeProject', amount });
    if (r.ok && r.cost > 0) this.send({ t: 'contribute', amount: r.cost });
    return r;
  }

  /** Leave the region: the city's last report and save go first (resolves once they're sent). */
  leave(): Promise<void> {
    if (this.state === 'closed') return Promise.resolve();
    // The save sent as the player leaves is the one the region keeps (a raid while away is fought in it).
    return this.reportNow(true, true).finally(() => {
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
