/**
 * A city's place in a shared region (M32): it reports itself to the region now and then (offers,
 * people, deals, a small picture, and a save for visitors), takes in the others' news as a
 * `regionUpdate` command in its own sim, and pays into the region project. The city itself stays
 * single player: it runs at its own speed on its owner's machine.
 */
import type { Command, CommandResult } from '../sim/commands';
import type { RaidVerdict, RegionReport, RegionUpdate } from '../sim/systems/region';
import type { SaveFile } from '../sim/save';
import { PROTOCOL_VERSION, type FriendsClientMsg, type FriendsWelcome } from '../../relay/protocol';
import {
  FAIR,
  type LiveRecord,
  type OpOutcome,
  type RegionClientMsg,
  type RegionOp,
  type RegionRoomMsg,
  type RegionView,
} from '../../relay/region';
import type { Link } from './link';
import type { RegionWarRules, UnitKind } from '../data/war';
import type { SabotageTarget } from '../data/intel';
import type { Branch, TierKey } from '../data/research';
import { decodeBattle, decodeSnapshot, encodeBattle, encodeSnapshot } from './snapshot';
import { inputOfRecord } from './liveRecord';
import type { BattleInput } from '../sim/battle/types';
import { battleHasSuper } from '../sim/systems/regionOps';

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
  /**
   * An operation another city of the region made against this one (M37), as the region decided it:
   * `taken` (or `refused`, never to be taken) and the region forgets it; `later`: offered again.
   */
  op?(o: OpOn): Promise<BattleAnswer>;
}

/** An operation against this city, as the region passes it on (M37). */
export interface OpOn {
  from: number;
  id: string;
  op: RegionOp;
  outcome: OpOutcome;
  target?: SabotageTarget;
  late: boolean;
}

/** An operation this city sends the region (M37). */
export interface OpOut {
  to: number;
  id: string;
  op: RegionOp;
  target?: SabotageTarget;
  branch?: Branch;
}

/** What the region answered about an operation: kept (its outcome), turned away, or no word. */
export type OpSent =
  | { kept: true; outcome: OpOutcome; stole?: TierKey }
  | { kept: false; reason: string; later?: number }
  | null;

export type BattleAnswer = 'taken' | 'later' | 'refused';

/** Where a battle came from: the sending city's place, its id, kept while away; `away` (M36): the
 * player wasn't here when it came, so it does half the damage. */
export interface BattleMeta {
  from: number;
  id: string;
  late: boolean;
  away?: boolean;
  /** It brings a superweapon, and the region counted it so (M37). */
  super?: boolean;
}

/**
 * Whether the region would let the city in `slot` raid city `c` now (M36), as the room decides it:
 * not a neutral city, not a newcomer that hasn't raided it lately, not one raided out for the day.
 */
export function raidVerdict(
  view: RegionView,
  slot: number,
  c: RegionView['cities'][number],
  /** A war between the two is open (M39): the newcomer shield doesn't stand between cities at war. */
  atWar = false,
): RaidVerdict {
  const me = view.cities.find((x) => x.slot === slot);
  if (c.report?.shield === 'neutral') return 'neutral';
  if (c.report?.shield === 'new' && !atWar && !(me?.raidedBy ?? []).includes(c.slot)) return 'new';
  if (c.raidsLeft === 0) return 'spent';
  if (view.kind === 'p2p' && !c.online) return 'absent';
  return 'open';
}

/** What the room answered about a battle sent: kept, turned away (perhaps to fight again), or no word. */
export type BattleSent =
  | { kept: true }
  /** `again`: fight it again (at half strength); `later`: ask again after this many ms. */
  | { kept: false; reason: string; again: boolean; later?: number }
  | null;

/** The region's news as this city's `regionUpdate` (pure: tested on its own). */
export function regionUpdateFor(
  view: RegionView,
  slot: number,
  /** The places of the cities this one has an open war with (M39). */
  atWar: ReadonlySet<number> = new Set(),
): RegionUpdate {
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
      // War (M36): whether the region would let this city raid it now, as the region decides.
      ...(view.rules?.war ? { raid: raidVerdict(view, slot, c, atWar.has(c.slot)) } : {}),
      // War (M37): a coast to sail to, its research tiers and its counter-intelligence.
      ...(view.rules?.war && c.report!.coast ? { coast: true as const } : {}),
      ...(view.rules?.war && c.report!.tiers ? { tiers: [...c.report!.tiers] } : {}),
      ...(view.rules?.war && c.report!.counter !== undefined ? { counter: c.report!.counter } : {}),
      // War (M39): what this city says it pays this one as its vassal.
      ...(view.rules?.war && c.report!.dues?.slot === slot ? { dues: c.report!.dues.amount } : {}),
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

/**
 * The cap the region's fair clock puts on this city's war clock (M37, design call 15): the hours the
 * region has seen it play at 1×, and a bank of two game days; none where war is off or before the
 * region has heard the city's clock.
 */
export function fairCap(view: RegionView, slot: number): number | null {
  if (!view.rules?.war) return null;
  const fair = view.cities.find((c) => c.slot === slot)?.fair;
  return fair === undefined ? null : Math.floor(fair) + FAIR.bank;
}

/**
 * What takes the region's live-battle messages (M39, `src/client/liveBattles.ts`): every one of the
 * room's `bcall`, `bliveoff`, `bstart`, `ballow`, `bend`, `blivenow` and `breplaydata`, and the
 * moment the link is in the region (again), when a battle in progress is taken up afresh.
 */
export interface LiveSink {
  message(m: RegionRoomMsg): void;
  welcome(): void;
}

/**
 * What takes the region's messages about wars and treaties between friends (M39,
 * `src/client/friendsWar.ts`): the room's `war`, `wrefused`, `tprop`, `tsign`, `trefused`, `pacts` and
 * `history`, what the room says about them on joining (`welcome`), and the moment the region's view of
 * the cities changes (`viewChanged`: a friend that wasn't a neighbour yet may be one now).
 */
export interface FriendsSink {
  message(m: RegionRoomMsg): void;
  welcome(info: FriendsWelcome | undefined): void;
  viewChanged(): void;
}

/** The id the room knows a battle by: its own id, cut down to what the room keeps. */
export function roomBattleId(id: string): string {
  return (
    String(id)
      .replace(/[^\w-]/g, '')
      .slice(0, 40) || 'battle'
  );
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
  /**
   * The region's fair clock caps the city's war clock (M37): on unless a test that fast-forwards its
   * cities far past the region's 1× pace turns it off.
   */
  fairClock?: boolean;
}

export class RegionLink {
  state: 'connecting' | 'in' | 'reconnecting' | 'closed' = 'connecting';
  slot = 0;
  secret = '';
  view: RegionView | null = null;
  error: string | null = null;
  /** The region shut for good (its host's browser left it, F10): the city's place there is gone. */
  gone = false;
  /** No region has this code (any more): a city bound to it should let it go (M37). */
  missing = false;
  private link: Link | null = null;
  private misses = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private started: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private retry = 0;
  private lastSave = 0;
  private lastThumb = 0;
  onChange: (() => void) | null = null;
  onNotice: ((text: string) => void) | null = null;
  /** Live battles with friends (M39): who takes the room's messages about them. */
  live: LiveSink | null = null;
  /** Wars and treaties with friends (M39): who takes the room's messages about them. */
  friends: FriendsSink | null = null;
  /** The region's replays (M39 step 7): sees every message first, and takes the records it asked for. */
  replays: { message(m: RegionRoomMsg): boolean } | null = null;
  /** The places of the cities this one has an open war with (M39): set by `friends`, read when the region's news is taken. */
  atWar: ReadonlySet<number> = new Set();
  /** The region keeps a battle this city sent (M35), and another city's force is on its way here. */
  onBattleKept: ((id: string) => void) | null = null;
  /** The region turned a battle away (M36: its target has taken the day's raids). */
  onBattleRefused: ((id: string, reason: string) => void) | null = null;
  onIncoming:
    ((m: { from: number; units: number; hours: number; super?: UnitKind; gate?: boolean }) => void) | null =
    null;
  /** Operations against this city taken already and acknowledged, by `sender:id` (M37). */
  private opsDone = new Set<string>();
  private opsTaking = new Set<string>();
  /** Operations sent, waiting for the region's answer, by id (M37). */
  private opWaits = new Map<string, (a: OpSent) => void>();
  /** The war-clock cap last given the city (M37): undefined until the region first says. */
  private cap: number | null | undefined = undefined;
  /**
   * Battles coming in, in parts, and those taken already (M35); all by `sender:id` (M36: two
   * cities' battles may share an id).
   */
  private battlesIn = new Map<string, (string | null)[]>();
  private battlesTaken = new Set<string>();
  /** Taken and acknowledged: offered again (the word was lost), they're acknowledged again. */
  private battlesDone = new Set<string>();
  /** Battles the city couldn't take yet (one was on already): tried again with each report. */
  private battlesWaiting = new Map<
    string,
    { id: string; input: BattleInput; from: number; late: boolean; away?: boolean; super?: boolean }
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

  /** A live battle's message to the region (M39): dropped while the link is down (the page asks again on its return). */
  sendLive(m: RegionClientMsg): void {
    if (this.state === 'in') this.send(m);
  }

  /** A word about a war or a treaty to the region (M39): dropped while the link is down. Whether it went. */
  sendFriends(m: FriendsClientMsg): boolean {
    if (this.state !== 'in' || !this.link) return false;
    this.send(m);
    return true;
  }

  /** The region's latest news into this city's sim again: something this page knows has changed what it says (a war opened). */
  refresh(): void {
    if (this.view && this.state === 'in') void this.take(this.view);
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
    if (this.replays?.message(m)) return;
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
        this.live?.welcome();
        this.friends?.welcome(m.friends);
        return;
      case 'region':
        await this.take(m.region);
        return;
      case 'notice':
        this.onNotice?.(m.text);
        return;
      case 'error':
        if (m.code === 'closed') this.gone = true;
        // No region by that code (it expired): a city bound to it is in it no more (M37).
        if (m.code === 'no-region') this.missing = true;
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
        if (this.battlesDone.has(key)) return this.send({ t: 'battleSeen', id: m.id, from: m.from });
        if (this.battlesTaken.has(key)) return;
        let input: BattleInput;
        try {
          // A live battle this city's player wasn't here to see the end of (M39): the room's record,
          // the input and the orders stamped in it; the city takes it as any late battle.
          input = m.live
            ? inputOfRecord(JSON.parse((list as string[]).join('')) as LiveRecord)
            : decodeBattle(list as string[]);
        } catch {
          // Unreadable: it never will be, so the region needn't keep offering it.
          this.send({ t: 'battleSeen', id: m.id, from: m.from });
          return;
        }
        await this.takeBattle({
          id: m.id,
          input,
          from: m.from,
          late: m.late,
          ...(m.away ? { away: true } : {}),
          ...(m.super ? { super: true } : {}),
        });
        return;
      }
      case 'opKept':
        this.opAnswered(m.id, {
          kept: true,
          outcome: m.outcome,
          ...(m.stole ? { stole: m.stole } : {}),
        });
        return;
      case 'opRefused':
        this.opAnswered(m.id, {
          kept: false,
          reason: m.reason,
          ...(typeof m.later === 'number' ? { later: m.later } : {}),
        });
        return;
      case 'opOn':
        return this.takeOp({
          from: m.from,
          id: m.id,
          op: m.op,
          outcome: m.outcome,
          ...(m.target ? { target: m.target } : {}),
          late: m.late,
        });
      case 'battleKept':
        this.answered(m.id, { kept: true });
        this.onBattleKept?.(m.id);
        return;
      case 'battleRefused':
        this.answered(m.id, {
          kept: false,
          reason: m.reason,
          again: m.again === true,
          ...(typeof m.later === 'number' ? { later: m.later } : {}),
        });
        this.onBattleRefused?.(m.id, m.reason);
        return;
      case 'war':
      case 'wrefused':
      case 'tprop':
      case 'tsign':
      case 'trefused':
      case 'pacts':
      case 'history':
        this.friends?.message(m);
        return;
      case 'bcall':
      case 'bliveoff':
      case 'bstart':
      case 'ballow':
      case 'bend':
      case 'blivenow':
      case 'breplaydata':
      case 'bhelpoff':
        this.live?.message(m);
        return;
      case 'incoming':
        this.onIncoming?.({
          from: m.from,
          units: m.units,
          hours: m.hours,
          ...(m.super ? { super: m.super } : {}),
          ...(m.gate ? { gate: true } : {}),
        });
        return;
    }
  }

  /**
   * An operation against this city (M37): its own sim takes it once; then the region can forget it.
   * Offered again (the word was lost), it's only acknowledged.
   */
  private async takeOp(o: OpOn): Promise<void> {
    const key = `${o.from}:${o.id}`;
    if (this.opsDone.has(key)) return this.send({ t: 'opSeen', id: o.id, from: o.from });
    if (this.opsTaking.has(key)) return;
    this.opsTaking.add(key);
    try {
      const answer = (await this.city.op?.(o)) ?? 'later';
      if (answer === 'later') return;
      this.opsDone.add(key);
      this.send({ t: 'opSeen', id: o.id, from: o.from });
    } finally {
      this.opsTaking.delete(key);
    }
  }

  /**
   * Put an operation to the region (M37): its spy's verdict, or the blackout tower's. The promise is
   * the region's answer, or null when none came within `wait` ms (the link is down: ask again later
   * with the same id, and the region gives the same answer).
   */
  sendOp(op: OpOut, wait = 30_000): Promise<OpSent> {
    const answer = new Promise<OpSent>((resolve) => {
      const timer = setTimeout(() => {
        if (this.opWaits.get(op.id) === settle) this.opWaits.delete(op.id);
        resolve(null);
      }, wait);
      const settle = (a: OpSent) => {
        clearTimeout(timer);
        resolve(a);
      };
      this.opWaits.get(op.id)?.(null);
      this.opWaits.set(op.id, settle);
    });
    if (!this.link) this.opAnswered(op.id, null);
    else
      this.send({
        t: 'op',
        to: op.to,
        id: op.id,
        op: op.op,
        ...(op.target ? { target: op.target } : {}),
        ...(op.branch ? { branch: op.branch } : {}),
      });
    return answer;
  }

  private opAnswered(id: string, a: OpSent): void {
    const w = this.opWaits.get(id);
    if (!w) return;
    this.opWaits.delete(id);
    w(a);
  }

  /** Hand a whole battle to the city; once it has it, the region can forget it. */
  private async takeBattle(b: {
    id: string;
    input: BattleInput;
    from: number;
    late: boolean;
    away?: boolean;
    super?: boolean;
  }): Promise<void> {
    const key = `${b.from}:${b.id}`;
    if (this.battlesTaken.has(key)) return;
    this.battlesTaken.add(key);
    this.battlesWaiting.delete(key);
    const answer =
      (await this.city.battle?.(b.input, {
        from: b.from,
        id: b.id,
        late: b.late,
        ...(b.away ? { away: true } : {}),
        ...(b.super ? { super: true } : {}),
      })) ?? 'later';
    if (answer !== 'later') {
      this.battlesDone.add(key);
      this.send({ t: 'battleSeen', id: b.id, from: b.from });
    } else {
      this.battlesTaken.delete(key);
      this.battlesWaiting.set(key, b);
    }
  }

  /**
   * A force of this city's has set off against another city of the region (M35): it's told, with
   * the superweapon it brings and whether it comes through the express gate (M37).
   */
  forceOut(to: number, units: number, hours: number, extra: { super?: UnitKind; gate?: boolean } = {}): void {
    this.send({
      t: 'forceOut',
      to,
      units,
      hours,
      ...(extra.super ? { super: extra.super } : {}),
      ...(extra.gate ? { gate: true as const } : {}),
    });
  }

  /** The id the room knows a battle by. */
  static battleId(input: BattleInput): string {
    return roomBattleId(input.id);
  }

  /**
   * Send a battle fought against another city of the region (M35), to keep until it's seen; `away`
   * (M36): fought at half strength, as against a player who isn't here. The promise is the room's
   * answer, or null when none came within `wait` ms (the link is down: send it again later).
   */
  sendBattle(to: number, input: BattleInput, away = false, wait = 30_000): Promise<BattleSent> {
    const id = RegionLink.battleId(input);
    const parts = encodeBattle(input);
    // A battle bringing a superweapon says so (M37): the region counts it, and the target's sim
    // takes nothing from one it didn't.
    const sup = battleHasSuper(input);
    const answer = new Promise<BattleSent>((resolve) => {
      const timer = setTimeout(() => {
        if (this.battleWaits.get(id) === settle) this.battleWaits.delete(id);
        resolve(null);
      }, wait);
      const settle = (a: BattleSent) => {
        clearTimeout(timer);
        resolve(a);
      };
      this.battleWaits.get(id)?.(null);
      this.battleWaits.set(id, settle);
    });
    if (!this.link) this.answered(id, null);
    else
      parts.forEach((data, part) =>
        this.send({
          t: 'battle',
          to,
          id,
          part,
          parts: parts.length,
          data,
          ...(away ? { away: true } : {}),
          ...(sup ? { super: true as const } : {}),
        }),
      );
    return answer;
  }

  private battleWaits = new Map<string, (a: BattleSent) => void>();

  private answered(id: string, a: BattleSent): void {
    const w = this.battleWaits.get(id);
    if (!w) return;
    this.battleWaits.delete(id);
    w(a);
  }

  /** The latest save the region keeps of a city in it (M35: battles fought there are fought in it). */
  fetchSave(slot: number): Promise<SaveFile> {
    return fetchCitySave(this.connect, slot, this.opts.mayor);
  }

  /** The region's news into this city's sim. */
  private async take(view: RegionView): Promise<void> {
    this.view = view;
    if (this.slot) {
      const update = this.city.command({
        type: 'regionUpdate',
        update: regionUpdateFor(view, this.slot, this.atWar),
      });
      // The fair clock (M37): the city's war clock may run this far, told again once it moves by an
      // hour or more (or comes off, where war is off). The first word on a link is always told: a cap
      // the city saved from before (war turned off meanwhile) mustn't hold it for good.
      const cap = this.opts.fairClock === false ? null : fairCap(view, this.slot);
      const moved =
        this.cap === undefined ||
        (cap === null ? this.cap !== null : this.cap === null || cap - this.cap >= 1 || cap < this.cap);
      if (moved) {
        this.cap = cap;
        void this.city.command({ type: 'warClock', cap });
      }
      await update;
      // A friend that wasn't a neighbour yet may be one now: what the region said of it is applied.
      this.friends?.viewChanged();
    }
    this.onChange?.();
  }

  /** Tell the region how this city stands (and, now and then, its picture and a save for visitors). */
  async reportNow(force = false, last = false): Promise<void> {
    if (this.state !== 'in' || !this.link) return;
    if (!last) for (const b of [...this.battlesWaiting.values()]) await this.takeBattle(b);
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
