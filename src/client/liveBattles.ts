/**
 * Live battles between friends, the pages' side (M39, design calls 3–5, DESIGN §3.34). The region
 * room orders a battle between two players' cities: this is what each page does in it.
 *
 * - The defender's page hosts the battle in its own sim, as it hosts a computer raid. On the room's
 *   call (`bcall`) it asks its sim for the battle's input (`liveBattle`: the city's own picture and
 *   the friend's force), starts hosting it (`battleResolve` in live mode), and sends the input to the
 *   room (`binput`). From then on the sim plays only as far as the room's frontier, and this page feeds
 *   it the room's orders and frontier (`battleLive`).
 * - The attacker's page runs the same battle in a worker (`LiveRunner`), from the input the room
 *   gives it, and takes its report from that run.
 * - Both pages tell the room how far they have got (`bstep`, with their player's orders) at least
 *   every few seconds, and the battle's end step and hash (`bdone`); the room answers with the
 *   frontier and every stamped order (`ballow`), and ends it (`bend`).
 *
 * The page keeps the clock it is given and the city, store and runner it is handed, so tests run two
 * pages against a real room without a browser.
 */
import { LIVE } from '../../relay/protocol';
import type { LiveOrderIn, LiveRecord, RegionClientMsg, RegionRoomMsg } from '../../relay/region';
import { UNIT } from '../data/war';
import { awayBattleId, awayForce, type AwayCity } from '../sim/battle/away';
import { checkBattleInput } from '../sim/battle/check';
import { recordInput, type OrderRequest, type StampedOrder } from '../sim/battle/live';
import type { BattleFrame, BattleInput, ForceIn, OrderKind } from '../sim/battle/types';
import type { Command, CommandResult } from '../sim/commands';
import { canonicalStringify } from '../sim/serialize';
import type { SaveFile } from '../sim/save';
import type { Query } from '../sim/protocol';
import type { AwayResult } from '../sim/systems/expeditions';
import { LIVE_ALLOW_MAX } from '../sim/systems/raids';
import type { WarSummary } from '../sim/systems/war';
import { decodeBattle, encodeBattle } from '../net/snapshot';
import { inputOfRecord } from '../net/liveRecord';
import type { LiveSink } from '../net/regionLink';
import type { BattleRecord } from './battles';
import type { LiveEnd } from './liveRunner';

/** The city, as a live battle needs it: its sim, its saves, and a way to tell the player. */
export interface LiveCity {
  query<T>(q: Query): Promise<T>;
  preview(cmd: Command): Promise<CommandResult>;
  command(cmd: Command): Promise<CommandResult>;
  save(): Promise<SaveFile>;
  /** Save the city to its autosave (the battle just begun is kept if the page closes). */
  autosave?(): Promise<boolean>;
  cityName(): string;
  tick(): number;
  /** The speed buttons' setting: 0 is paused. */
  speed(): number;
  setSpeed(speed: 1): void;
  notice(key: string, text: string, tone: 'info' | 'bad' | 'ok'): void;
}

/** Where battles are kept to watch again. */
export interface LiveStore {
  keepTown(key: string, save: SaveFile): Promise<void>;
  keepBattle(record: BattleRecord): Promise<void>;
}

/** What a runner (the battle worker's live job, or one in-process) tells the page. */
export interface LiveRunnerHandlers {
  frame(step: number, frame: BattleFrame): void;
  done(end: LiveEnd): void;
  error(message: string): void;
}

/** A battle being run for the attacker: fed the room's orders and frontier, stopped when it's over. */
export interface LiveRunnerPort {
  feed(orders: readonly StampedOrder[], allow: number, rush?: boolean): void;
  stop(): void;
}

/** What a page needs from the world round it. */
export interface LiveEnv {
  now(): number;
  city: LiveCity;
  store: LiveStore;
  runner(input: BattleInput, on: LiveRunnerHandlers): LiveRunnerPort;
  /** The attacker's city takes its force's result (a `battleReport`): true if it did. */
  report(expedition: number, result: AwayResult & { replay?: string }): Promise<boolean>;
  /** Pin the force while its battle is with the region, or free it: false if it isn't fighting. */
  settle(expedition: number, on: boolean): Promise<boolean>;
  /** The latest save the region keeps of a friend's city (the town a replay is shown in). */
  fetchSave(slot: number): Promise<SaveFile>;
}

/** The region link, as live battles use it (a `RegionLink`). */
export interface LiveLink {
  readonly state: string;
  readonly slot: number;
  live: LiveSink | null;
  sendLive(m: RegionClientMsg): void;
}

/** What the attacker's page makes of its force's live battle. */
export type LiveAttack =
  /** Fought, and the force's result given to the city (`ok`: it took it). */
  | { kind: 'done'; ok: boolean }
  /** Not live: fight it the old way (the friend can't, or won't, fight live). */
  | { kind: 'fallback' }
  /** The region won't take this battle (its limits, or the battle wasn't the one asked for). */
  | { kind: 'refused'; reason: string; later?: number }
  /** No word for now: ask again after `ms`. */
  | { kind: 'wait'; ms: number };

/** A live battle, for the test API and the battle map. */
export interface LiveState {
  id: string;
  role: 'attacker' | 'defender';
  attacker: number;
  defender: number;
  /** The frontier the room gave, the step this page has run to, and whether its side is handed over. */
  allow: number;
  step: number;
  handed: boolean;
  /** This page's part of the battle is over (it reported its end). */
  ended: boolean;
  orders: number;
  queued: number;
  hashes: {
    mine: { step: number; hash: string } | null;
    room: { step: number; hash: string; agree: boolean; solo?: boolean; abandoned?: boolean } | null;
  };
  /** The two pages' runs ended differently (logged; each city keeps its own truth). */
  desync: boolean;
}

/** A live battle somewhere in the region that this page is not in: it may be watched. */
export interface LiveRunning {
  id: string;
  from: number;
  to: number;
}

/** An order this page's player gave, as the battle map lists it: sent, and then stamped by the room. */
export interface OrderLogEntry {
  n: number;
  kind: OrderKind;
  /** How many units it names, or 'all' (the whole side). */
  units: number | 'all';
  target?: number;
  sentAt: number;
  /** The room's number for it and the step it applies at, once it has stamped it. */
  seq?: number;
  step?: number;
  /** `unheard`: sent a while ago and the room never stamped it (it was refused, or lost). */
  state: 'queued' | 'sent' | 'stamped' | 'unheard';
}

/**
 * The battle as the battle map sees it, whatever this page's part in it (M39, design call 6): its
 * input, the picture of it now (this page's own run; a defender's is its city's, passed in with the
 * frames), how far it has got, and how it ended once it has.
 */
export interface LiveView {
  role: 'attacker' | 'defender' | 'watcher';
  id: string;
  /** The attacker's and the defender's places in the region. */
  attacker: number;
  defender: number;
  input: BattleInput;
  frame: BattleFrame | null;
  step: number;
  allow: number;
  /** This page's side is handed over (never for a watcher). */
  handed: boolean;
  /** The battle is over, or this page's run of it is. */
  over: boolean;
  /** The room's word on the end. */
  end: End | null;
  /** Where this page's run of the battle ended, once it has. */
  run: { step: number; hash: string } | null;
  /** Orders stamped so far. */
  orders: number;
}

type End = Extract<RegionRoomMsg, { t: 'bend' }>;

/** A battle this page is watching: its input once the room has sent it, and the run being drawn. */
interface Watch {
  id: string;
  from: number | undefined;
  asked: number;
  attacker: number;
  defender: number;
  input: BattleInput | null;
  orders: StampedOrder[];
  allow: number;
  step: number;
  frame: BattleFrame | null;
  runner?: LiveRunnerPort;
  /** The page's run reached the battle's end. */
  run?: LiveEnd;
  end: End | null;
}

interface Session {
  id: string;
  role: 'attacker' | 'defender';
  from: number;
  to: number;
  /** The input as the room has it (decoded, before any order is added to it). */
  input: BattleInput;
  /** Every order the room stamped, in its numbering. */
  orders: StampedOrder[];
  allow: number;
  step: number;
  handed: boolean;
  rejoins: number;
  /** Own `free` orders sent and not seen come back yet (an unasked one is a handover). */
  frees: number;
  queued: { o: OrderRequest; e: OrderLogEntry }[];
  /** The orders this page's player gave, newest last (the battle map lists them). */
  log: OrderLogEntry[];
  sentAt: number;
  sentStep: number;
  /** When the page last looked after this battle (a long gap and the room has handed it over). */
  seenAt: number;
  mine: { step: number; hash: string } | null;
  mineAt: number;
  room: End | null;
  frame: BattleFrame | null;
  desync: boolean;
  finalized: boolean;
  nudged: boolean;
  /** The room has started the battle for this page (until then a defender is only waiting for its input to be taken). */
  started: boolean;
  /** The defender's commands to its sim, one after another (a command waits for the one before it). */
  chain: Promise<unknown>;
  /** The attacker's: its runner, how it ended, and the call it came from. */
  runner?: LiveRunnerPort;
  end?: LiveEnd;
  call?: Call;
}

/** An attacker's call, waiting for the room's word and then for the battle. */
interface Call {
  id: string;
  expedition: number;
  city: AwayCity;
  force: ForceIn;
  first: (a: First) => void;
  done: (a: LiveAttack) => void;
  /** The room has ended it, and its record follows (to be run here). */
  ended: End | null;
  started: boolean;
}

type First =
  | { kind: 'start' }
  | { kind: 'ended' }
  | { kind: 'off'; why: string; refused?: boolean; later?: number }
  | { kind: 'silent' };

/** How often a page tells the room how far it has got (ms), and at the least. */
const SEND_EVERY = 500;
const KEEPALIVE = 3_000;
/** An order sent and not stamped by now is shown as unheard (ms), and the log keeps this many. */
const UNHEARD = 8_000;
const LOG_KEEP = 12;
/** A watch the room never starts is given up after this long (ms). */
const WATCH_WAIT = 10_000;
/** A finished page waits this long for the room's word on the end (ms), then keeps what it has. */
const END_WAIT = 120_000;
/** A hosted battle the page can't find a session for is let go after this long (ms). */
const ORPHAN_WAIT = 20_000;
/** How many times a page takes command back by itself after a handover. */
const REJOIN_MAX = 3;
/** The room's answer to a call: its own twenty seconds for the defender, and some to spare. */
const CALL_WAIT = LIVE.call + 5_000;

/** Does a force bring a superweapon (the region counts such a battle in the target's day)? */
function bringsSuper(f: ForceIn): boolean {
  return f.units.some((u) => !!UNIT.get(u.kind)?.super);
}

/** Two forces are the same when what the battle uses of them is. */
function sameForce(a: ForceIn, b: ForceIn): boolean {
  const pick = (f: ForceIn) => ({
    units: f.units,
    route: f.route,
    target: f.target,
    stance: f.stance,
    readiness: f.readiness,
    mods: f.mods ?? null,
  });
  return canonicalStringify(pick(a)) === canonicalStringify(pick(b));
}

/** The id a defender's replay of a live battle is kept under (as a friend's raid's). */
function replayId(id: string): string {
  return `def-${id}`.slice(0, 60);
}

/** Which side of the battle a role is: the attacker's is 0, the defender's 1. */
const sideOf = (s: Session): 0 | 1 => (s.role === 'attacker' ? 0 : 1);

export class LiveBattles implements LiveSink {
  private link: LiveLink | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly calls = new Map<string, Call>();
  /** Calls from friends being answered (their sim is asked, a save is made), by id. */
  private readonly answering = new Set<string>();
  private war: WarSummary | null = null;
  /** The battle that ended last (what a panel shows after it). */
  private last: LiveState | null = null;
  private orphan: { id: string; since: number; asked: boolean } | null = null;
  /** Battles on in the region that this page is not in (from the room's `blivenow`), by id. */
  private readonly running = new Map<string, LiveRunning>();
  private watching: Watch | null = null;
  /** The battle that ended last, as the map shows it afterwards. */
  private lastView: LiveView | null = null;
  private logSeq = 0;
  /** Called when something a panel shows has changed. */
  onChange: (() => void) | null = null;
  /** Called when a battle between two other cities begins in the region (a chance to watch it). */
  onSpectacle: ((b: LiveRunning) => void) | null = null;

  constructor(private readonly env: LiveEnv) {}

  // ------------------------------------------------------------------ wiring

  /** The region link this page's battles go through. */
  attach(link: LiveLink): void {
    this.link = link;
    link.live = this;
  }

  /** The city has left its region: whatever is in progress goes on alone. */
  detach(): void {
    const link = this.link;
    if (link?.live === this) link.live = null;
    this.link = null;
    for (const s of [...this.sessions.values()]) this.release(s);
    for (const c of [...this.calls.values()]) this.endCall(c, { kind: 'wait', ms: 20_000 });
    this.stopWatching();
    this.running.clear();
    this.onChange?.();
  }

  private send(m: RegionClientMsg): void {
    this.link?.sendLive(m);
  }

  private get now(): number {
    return this.env.now();
  }

  // ------------------------------------------------------------------ what the page asks

  /** The battle this page is in now, if it is (one at a time). */
  private get active(): Session | undefined {
    for (const s of this.sessions.values()) if (!s.finalized) return s;
    return undefined;
  }

  /** The battle as the test API and the battle map see it. */
  state(): LiveState | null {
    const s = this.active;
    return s ? this.stateOf(s) : this.last;
  }

  private stateOf(s: Session): LiveState {
    return {
      id: s.id,
      role: s.role,
      attacker: s.from,
      defender: s.to,
      allow: s.allow,
      step: this.stepOf(s),
      handed: s.handed,
      ended: !!s.mine,
      orders: s.orders.length,
      queued: s.queued.length,
      hashes: {
        mine: s.mine ? { ...s.mine } : null,
        room: s.room
          ? {
              step: s.room.step,
              hash: s.room.hash,
              agree: s.room.agree,
              ...(s.room.solo ? { solo: true } : {}),
              ...(s.room.abandoned ? { abandoned: true } : {}),
            }
          : null,
      },
      desync: s.desync,
    };
  }

  /** The battle on now, as the room gave it (before any order): the picture the battle map draws on. */
  input(): BattleInput | null {
    return this.active?.input ?? null;
  }

  /** The battle on now, as the last frame drew it (the attacker's picture of it). */
  picture(): BattleFrame | null {
    return this.active?.frame ?? this.watching?.frame ?? null;
  }

  /**
   * The battle the map shows: the one this page fights, else the one it watches, else the one that
   * ended last (until another begins). Null when there is none, or a watch the room hasn't started.
   */
  view(): LiveView | null {
    const s = this.active;
    if (s) return this.viewOf(s);
    const w = this.watching;
    if (w) return w.input ? this.watchView(w) : null;
    return this.lastView;
  }

  private viewOf(s: Session): LiveView {
    return {
      role: s.role,
      id: s.id,
      attacker: s.from,
      defender: s.to,
      input: s.input,
      frame: s.frame,
      step: this.stepOf(s),
      allow: s.allow,
      handed: s.handed,
      over: !!s.mine || s.finalized,
      end: s.room,
      run: s.mine ? { ...s.mine } : null,
      orders: s.orders.length,
    };
  }

  private watchView(w: Watch): LiveView {
    return {
      role: 'watcher',
      id: w.id,
      attacker: w.attacker,
      defender: w.defender,
      input: w.input!,
      frame: w.frame,
      step: w.run?.step ?? w.step,
      allow: w.allow,
      handed: false,
      over: !!w.run,
      end: w.end,
      run: w.run ? { step: w.run.step, hash: w.run.hash } : null,
      orders: w.orders.length,
    };
  }

  /** What this page's player ordered in the battle on now (or the last), newest last. */
  orderLog(): readonly OrderLogEntry[] {
    return this.active?.log ?? this.lastLog ?? [];
  }
  private lastLog: OrderLogEntry[] | null = null;

  /** Battles on in the region that this page is not in (it may watch them). */
  runningBattles(): LiveRunning[] {
    return [...this.running.values()];
  }

  /** The battle this page is watching, if it is. */
  watchingId(): string | null {
    return this.watching?.id ?? null;
  }

  /**
   * Give an order to this page's side of the battle (M39, design call 6): it goes to the room with the
   * next report, which stamps it at the frontier. False when there is no battle to give it in.
   */
  order(req: OrderRequest): boolean {
    const s = this.active;
    if (!s || s.mine || !req || typeof req.kind !== 'string') return false;
    const o: OrderRequest = { kind: req.kind };
    if (req.units !== undefined) o.units = req.units.slice(0, LIVE.units);
    if (req.target !== undefined) o.target = req.target;
    const e: OrderLogEntry = {
      n: ++this.logSeq,
      kind: o.kind,
      units: o.units ? o.units.length : 'all',
      ...(o.target !== undefined ? { target: o.target } : {}),
      sentAt: this.now,
      state: 'queued',
    };
    s.log.push(e);
    if (s.log.length > LOG_KEEP) s.log.splice(0, s.log.length - LOG_KEEP);
    s.queued.push({ o, e });
    if (o.kind === 'free') s.frees++;
    this.onChange?.();
    this.pump();
    return true;
  }

  /** Take command of this page's side again after the room handed it over. */
  rejoin(): void {
    const s = this.active;
    if (s && !s.mine) this.send({ t: 'bjoin', id: s.id });
  }

  // ------------------------------------------------------------------ the page's clock

  /** The city's latest war figures and events (called with every frame the sim sends). */
  frame(
    war: WarSummary | null,
    events?: readonly { kind: string; id: number; info?: Record<string, number | string> }[],
    picture?: BattleFrame | null,
  ): void {
    this.war = war;
    // The battle the city's own sim hosts is drawn from its frames.
    const own = picture ? this.sessions.get(picture.id) : undefined;
    if (own && own.role === 'defender') own.frame = picture!;
    for (const e of events ?? [])
      if (e.kind === 'battleEnded' && typeof e.info?.live === 'string')
        this.hostedEnd(e.info.live, Number(e.info.step), String(e.info.hash));
    const live = war?.battle?.live;
    const s = live ? this.sessions.get(live.id) : undefined;
    if (s) {
      this.orphan = null;
      this.keepRunning(s);
    } else if (live && !this.answering.has(live.id)) this.orphaned(live.id);
    else this.orphan = null;
    this.pump();
  }

  /** A paused city holds up both players: it runs at normal speed for as long as the battle lasts. */
  private keepRunning(s: Session): void {
    if (this.env.city.speed() !== 0) return;
    this.env.city.setSpeed(1);
    if (!s.nudged) {
      s.nudged = true;
      this.env.city.notice(
        `live-speed:${s.id}`,
        'The city runs at normal speed while a live battle lasts: your friend is waiting on it.',
        'info',
      );
    }
  }

  /**
   * A battle this city's sim is hosting that this page has no part in (it was reloaded): the room is
   * asked to take it up again; if the room has no such battle, or no region is there, the battle is
   * let run on its own.
   */
  private orphaned(id: string): void {
    const t = this.now;
    if (this.orphan?.id !== id) this.orphan = { id, since: t, asked: false };
    const o = this.orphan;
    if (!o.asked && this.link?.state === 'in') {
      o.asked = true;
      this.send({ t: 'bjoin', id });
    }
    if (t - o.since >= ORPHAN_WAIT) {
      this.orphan = null;
      void this.free(id);
    }
  }

  /** Let a hosted live battle run to its end alone (what's been ordered stands, the rest is the battle's own). */
  private free(id: string): Promise<CommandResult> {
    return this.env.city.command({ type: 'battleLive', id, allow: LIVE_ALLOW_MAX, orders: [] });
  }

  /** The page's turn: tell the room how far each battle has got, with the orders given since. */
  pump(): void {
    const t = this.now;
    const w = this.watching;
    if (w && !w.input && t - w.asked >= WATCH_WAIT) {
      this.env.city.notice(
        'live-watch',
        'That battle could not be watched: the region did not start it.',
        'bad',
      );
      this.stopWatching();
      this.onChange?.();
    }
    for (const s of [...this.sessions.values()]) {
      for (const e of s.log) if (e.state === 'sent' && t - e.sentAt >= UNHEARD) e.state = 'unheard';
      if (s.finalized || !s.started) continue;
      const gap = t - s.seenAt;
      s.seenAt = t;
      if (s.mine) {
        if (s.room) continue;
        // Waiting for the room's word on the end: a word to it now and then (it notices a battle one
        // side has left only when something reaches it), and at the last the page keeps what it has.
        if (t - s.sentAt >= KEEPALIVE) {
          this.send({ t: 'bstep', id: s.id, step: s.mine.step });
          s.sentAt = t;
        }
        if (t - s.mineAt >= END_WAIT) void this.finalize(s);
        continue;
      }
      const step = this.stepOf(s);
      const orders = s.queued.length > 0;
      const due =
        t - s.sentAt >= KEEPALIVE || (t - s.sentAt >= SEND_EVERY && (step !== s.sentStep || orders));
      if (!due) continue;
      // This page was away from its battle long enough for the room to have handed its side over:
      // it takes command again first (the room starts its count afresh), then reports.
      if (gap >= LIVE.silent - 2_000 && s.rejoins < REJOIN_MAX) {
        s.rejoins++;
        this.send({ t: 'bjoin', id: s.id });
      }
      const sent = s.queued.splice(0, LIVE.perMessage);
      for (const q of sent) {
        q.e.state = 'sent';
        q.e.sentAt = t;
      }
      const out: LiveOrderIn[] = sent.map((q) => q.o);
      this.send({ t: 'bstep', id: s.id, step, ...(out.length ? { orders: out } : {}) });
      s.sentAt = t;
      s.sentStep = step;
    }
  }

  private stepOf(s: Session): number {
    if (s.mine) return s.mine.step;
    if (s.role === 'attacker') return s.step;
    const live = this.war?.battle?.live;
    return live?.id === s.id ? live.step : s.step;
  }

  // ------------------------------------------------------------------ the room's messages

  /** Every live message from the region (a `RegionLink` passes them here). */
  message(m: RegionRoomMsg): void {
    switch (m.t) {
      case 'bcall':
        void this.onCall(m).catch(() => this.send({ t: 'bdecline', id: m.id }));
        return;
      case 'bliveoff':
        this.onOff(m);
        return;
      case 'bstart':
        void this.onStart(m).catch(() => undefined);
        return;
      case 'ballow':
        this.onAllow(m);
        return;
      case 'bend':
        this.running.delete(m.id);
        this.onEnd(m);
        this.onChange?.();
        return;
      case 'blivenow':
        this.onNow(m);
        return;
      case 'breplaydata':
        this.onRecord(m.id, m.record);
        return;
      default:
        return;
    }
  }

  /** The link is in the region (again): a battle in progress is taken up afresh. */
  welcome(): void {
    // (The room names the battles on now again, and a battle watched is asked for again.)
    this.running.clear();
    const w = this.watching;
    if (w) {
      w.asked = this.now;
      this.send({ t: 'bwatch', id: w.id, ...(w.from !== undefined ? { from: w.from } : {}) });
    }
    for (const s of this.sessions.values())
      if (!s.finalized && !s.mine) {
        s.seenAt = this.now;
        this.send({ t: 'bjoin', id: s.id });
      }
    for (const c of this.calls.values())
      if (!c.started)
        this.send({
          t: 'blive',
          to: c.city.neighbour.slot!,
          id: c.id,
          force: c.force,
          ...(bringsSuper(c.force) ? { super: true as const } : {}),
        });
    this.orphan = null;
  }

  // ------------------------------------------------------------------ the defender

  /**
   * A friend's force asks for a live battle in this city. The sim is asked for its input; if it can
   * take it (no other battle on) it starts hosting, and the input goes to the room.
   */
  private async onCall(m: Extract<RegionRoomMsg, { t: 'bcall' }>): Promise<void> {
    if (this.sessions.has(m.id) || this.answering.has(m.id)) return;
    this.answering.add(m.id);
    const city = this.env.city;
    try {
      const decline = () => this.send({ t: 'bdecline', id: m.id });
      const made = await city.query<{ input: BattleInput } | { refused: string }>({
        type: 'liveBattle',
        call: { id: m.id, from: m.from, force: m.force as ForceIn, ...(m.super ? { super: true } : {}) },
      });
      if (!('input' in made)) return decline();
      const input = made.input;
      const parts = encodeBattle(input);
      if (parts.length > LIVE.inputParts) return decline();
      const cmd = this.hosting(input, m.from, !!m.super);
      if (!(await city.preview(cmd)).ok) return decline();
      // The city as it stands as the battle begins is the replay's backdrop.
      await this.keepBackdrop(input.id);
      const r = await city.command(cmd);
      if (!r.ok) return decline();
      const s = this.session('defender', input, m.from, this.link?.slot ?? 0);
      this.sessions.set(s.id, s);
      this.keepRunning(s);
      // Saved before the room is told, so a page that closes keeps the battle it began.
      await city.autosave?.().catch(() => false);
      parts.forEach((data, part) => this.send({ t: 'binput', id: m.id, part, parts: parts.length, data }));
      this.onChange?.();
    } finally {
      this.answering.delete(m.id);
    }
  }

  private hosting(input: BattleInput, from: number, sup: boolean): Command {
    return {
      type: 'battleResolve',
      input: structuredClone(input),
      mode: 'live',
      replay: replayId(input.id),
      from,
      ...(sup ? { super: true } : {}),
    };
  }

  private async keepBackdrop(id: string): Promise<void> {
    try {
      await this.env.store.keepTown(`replay:${replayId(id)}`, await this.env.city.save());
    } catch {
      /* the replay is a nicety: the battle still counts */
    }
  }

  private session(role: 'attacker' | 'defender', input: BattleInput, from: number, to: number): Session {
    const t = this.now;
    return {
      id: input.id,
      role,
      from,
      to,
      input,
      orders: [],
      allow: 0,
      step: 0,
      handed: false,
      rejoins: 0,
      frees: 0,
      queued: [],
      log: [],
      sentAt: t,
      sentStep: -1,
      seenAt: t,
      mine: null,
      mineAt: 0,
      room: null,
      frame: null,
      desync: false,
      finalized: false,
      nudged: false,
      started: false,
      chain: Promise.resolve(),
    };
  }

  /** A command to the sim for a defender's battle, after those before it. */
  private command(s: Session, cmd: Command): Promise<CommandResult> {
    const done = s.chain.then(() => this.env.city.command(cmd));
    s.chain = done.catch(() => undefined);
    return done;
  }

  /** The room's word that the battle begins (or that this page is back in it). */
  private async onStart(m: Extract<RegionRoomMsg, { t: 'bstart' }>): Promise<void> {
    if (m.role === 'watcher') return this.onWatchStart(m);
    let s = this.sessions.get(m.id);
    const start = { handed: m.handed };
    if (m.role === 'defender') {
      if (!s) {
        // Back in a battle it has no session for (the page was reloaded): the sim may still host it.
        const input = decodeBattle(m.input);
        if (input.id !== m.id) return;
        s = this.session('defender', input, m.attacker, m.defender);
        this.sessions.set(s.id, s);
        this.orphan = null;
        if (this.war?.battle?.live?.id !== m.id) {
          const mine = s;
          void this.command(mine, this.hosting(input, m.attacker, false)).then((r) => {
            // The city can't take it (another battle is on): this page has no part in it.
            if (!r.ok) this.sessions.delete(mine.id);
          });
        }
      }
      this.take(s, m.orders, m.allow, start);
      return;
    }
    if (s) return this.take(s, m.orders, m.allow, start);
    // The attacker's: the battle this page called for.
    const call = this.calls.get(m.id);
    if (!call || call.started) return;
    const input = decodeBattle(m.input);
    // The input is the friend's: this page runs it only if it is the battle it asked for.
    if (checkBattleInput(input) || input.id !== m.id || !sameForce(call.force, input.attacker)) {
      this.env.city.notice(
        `live-bad:${m.id}`,
        'A friend’s battle was not the one your force went to fight: your force is called home.',
        'bad',
      );
      call.first({ kind: 'off', why: 'the battle was not the one it was sent to', refused: true });
      return;
    }
    call.started = true;
    const mine = this.session('attacker', input, m.attacker, m.defender);
    mine.call = call;
    this.sessions.set(mine.id, mine);
    this.run(mine);
    this.take(mine, m.orders, m.allow, start);
    call.first({ kind: 'start' });
  }

  /** The attacker's run of its battle, in the worker (or whatever the page runs it in). */
  private run(s: Session): void {
    s.runner = this.env.runner(structuredClone(s.input), {
      frame: (step, frame) => {
        s.step = step;
        s.frame = frame;
        this.onChange?.();
        this.pump();
      },
      done: (end) => this.runDone(s, end),
      error: () => this.giveUp(s),
    });
  }

  /**
   * Orders and the frontier from the room, taken into the battle this page runs. At a start (`start`:
   * the sides the room has handed over) it says whether this page is in command.
   */
  private take(
    s: Session,
    orders: readonly StampedOrder[],
    allow: number,
    start?: { handed: readonly number[] },
  ): void {
    if (start) s.started = true;
    const known = new Set(s.orders.map((o) => o.seq));
    const fresh = orders.filter((o) => !known.has(o.seq));
    s.orders.push(...fresh);
    s.orders.sort((a, b) => a.seq - b.seq);
    if (allow > s.allow) s.allow = allow;
    const side = sideOf(s);
    if (start) s.handed = start.handed.includes(side);
    // The room's stamp on an order this page's player gave: the map's list shows it as heard.
    for (const o of fresh) {
      if (o.side !== side) continue;
      const e = s.log.find((x) => x.state === 'sent' && x.kind === o.kind);
      if (e) {
        e.state = 'stamped';
        e.seq = o.seq;
        e.step = o.step;
      }
    }
    // A `free` for this side that its player didn't ask for is the room handing it over (as it
    // happens; at a start the room says which sides are handed over).
    if (!start)
      for (const o of fresh)
        if (o.side === side && o.kind === 'free') {
          if (s.frees > 0) s.frees--;
          else if (!s.handed) this.handedOver(s);
        }
    if (s.role === 'attacker') s.runner?.feed(fresh, s.allow);
    else void this.command(s, { type: 'battleLive', id: s.id, allow: s.allow, orders: fresh });
    this.onChange?.();
  }

  /** The room handed this page's side over (it had been quiet): it takes command again at once, a few times. */
  private handedOver(s: Session): void {
    s.handed = true;
    if (s.rejoins >= REJOIN_MAX) {
      this.env.city.notice(
        `live-handed:${s.id}`,
        'Your forces are fighting on their own: your page fell quiet for too long.',
        'bad',
      );
      return;
    }
    s.rejoins++;
    this.send({ t: 'bjoin', id: s.id });
  }

  private onAllow(m: Extract<RegionRoomMsg, { t: 'ballow' }>): void {
    const s = this.sessions.get(m.id);
    if (s && !s.finalized) this.take(s, m.ords ?? [], m.allow);
    else if (this.watching?.id === m.id) this.takeWatch(this.watching, m.ords ?? [], m.allow);
  }

  /** The room turned a call off, or says it has no such battle. */
  private onOff(m: Extract<RegionRoomMsg, { t: 'bliveoff' }>): void {
    const call = this.calls.get(m.id);
    if (call && !call.started) {
      call.first({
        kind: 'off',
        why: m.why,
        ...(m.refused ? { refused: true } : {}),
        ...(typeof m.later === 'number' ? { later: m.later } : {}),
      });
      return;
    }
    const s = this.sessions.get(m.id);
    if (s && !s.finalized) {
      // A battle the region doesn't have (it was over, or the room restarted): carry on with what this page has.
      if (m.gone) return this.release(s);
      // The call came to nothing before it began: the battle the sim set up is dropped.
      if (s.role === 'defender' && s.allow === 0) {
        this.sessions.delete(s.id);
        void this.command(s, { type: 'battleLive', id: s.id, allow: 0, orders: [], abort: true });
        this.onChange?.();
      }
      return;
    }
    // A hosted battle whose room has gone: let it run out.
    if (m.gone && this.war?.battle?.live?.id === m.id) void this.free(m.id);
  }

  /** The hosted battle in this city's sim has ended: its step and hash go to the room. */
  private hostedEnd(id: string, step: number, hash: string): void {
    const s = this.sessions.get(id);
    if (!s || s.mine) return;
    s.mine = { step, hash };
    s.mineAt = this.now;
    s.sentAt = this.now;
    this.send({ t: 'bdone', id, step, hash });
    if (s.room) void this.finalize(s);
    this.onChange?.();
  }

  /** The room ends the battle. */
  private onEnd(m: End): void {
    const w = this.watching;
    if (w && w.id === m.id) {
      w.end = m;
      // Run out to the end at once: the room's frontier has nothing more to say.
      w.runner?.feed([], LIVE_ALLOW_MAX, true);
    }
    const s = this.sessions.get(m.id);
    if (s) {
      s.room = m;
      if (m.agree === false) {
        s.desync = true;
        console.warn(`[live] ${m.id}: the two cities’ runs ended differently`, m);
      }
      // Its own run still to finish (the room ended it, or the other side did): it runs out alone.
      if (s.mine) void this.finalize(s);
      else this.release(s);
      this.onChange?.();
      return;
    }
    // Over before this page asked for it (it was away): its record follows, to be run.
    const call = this.calls.get(m.id);
    if (call && !call.started) {
      call.ended = m;
      call.first({ kind: 'ended' });
    }
  }

  /** A battle this page can't follow any more: it runs on alone to its end. */
  private release(s: Session): void {
    if (s.finalized || s.mine) return;
    if (s.role === 'defender')
      void this.command(s, { type: 'battleLive', id: s.id, allow: LIVE_ALLOW_MAX, orders: [] });
    else s.runner?.feed([], LIVE_ALLOW_MAX, true);
  }

  /** The attacker's run failed: the force asks again later. */
  private giveUp(s: Session): void {
    if (s.finalized) return;
    s.finalized = true;
    s.runner?.stop();
    this.sessions.delete(s.id);
    if (s.call) this.endCall(s.call, { kind: 'wait', ms: 30_000 });
  }

  /** The room's record of a battle that is over: run to the end here, and reported. */
  private onRecord(id: string, record: LiveRecord): void {
    const call = this.calls.get(id);
    if (!call && this.war?.battle?.live?.id === id && !this.sessions.has(id)) return this.takeRecord(record);
    if (!call || call.started) return;
    call.started = true;
    const unreadable = () => this.refuse(call, 'the region’s record of that battle could not be read');
    let input: BattleInput;
    try {
      input = inputOfRecord(record);
    } catch {
      return unreadable();
    }
    if (checkBattleInput(input) || !sameForce(call.force, input.attacker)) return unreadable();
    const s = this.session('attacker', input, record.from, record.to);
    s.call = call;
    s.room = call.ended;
    s.orders = record.orders.map((o) => ({ ...o }));
    s.allow = LIVE_ALLOW_MAX;
    this.sessions.set(s.id, s);
    // The battle is over: nothing waits on the room, so this runs it out at once.
    s.runner = this.env.runner(structuredClone(input), {
      frame: () => undefined,
      done: (end) => this.runDone(s, end),
      error: () => this.giveUp(s),
    });
    s.runner.feed([], LIVE_ALLOW_MAX, true);
  }

  /**
   * The room's record of a battle this city hosts and this page has lost (the page was reloaded, and the
   * battle is over): the city takes the battle as it was fought, in place of the part it hosts.
   */
  private takeRecord(record: LiveRecord): void {
    let input: BattleInput;
    try {
      input = inputOfRecord(record);
    } catch {
      return void this.free(record.id);
    }
    void this.env.city
      .command({
        type: 'battleResolve',
        input,
        mode: 'instant',
        replay: replayId(record.id),
        from: record.from,
      })
      .then((r) => (r.ok ? undefined : this.free(record.id)));
  }

  // ------------------------------------------------------------------ the attacker

  /**
   * Fight an arrived force's battle live (M39, design call 5): ask the region for it, and if the
   * friend's page takes the call, run it in step with theirs and report what it did to the force. The
   * promise ends with the battle (or at once, if it won't be live).
   */
  async attack(city: AwayCity, expedition: number): Promise<LiveAttack> {
    const link = this.link;
    const slot = city.neighbour.slot;
    // (A friend whose player isn't here has no one to fight live: the old way, at half strength.)
    if (!link || link.state !== 'in' || slot === null || city.neighbour.absent) return { kind: 'fallback' };
    const id = awayBattleId(city.seed, expedition);
    if (this.calls.has(id)) return { kind: 'wait', ms: 5_000 };
    // Pinned while the region has the battle, as the old way pins it: it can't be called back.
    if (!(await this.env.settle(expedition, true))) return { kind: 'wait', ms: 60_000 };
    const force = awayForce(city);
    let resolveDone!: (a: LiveAttack) => void;
    const done = new Promise<LiveAttack>((resolve) => (resolveDone = resolve));
    const call: Call = {
      id,
      expedition,
      city,
      force,
      started: false,
      ended: null,
      first: () => undefined,
      done: resolveDone,
    };
    this.calls.set(id, call);
    const first = new Promise<First>((resolve) => {
      const timer = setTimeout(() => resolve({ kind: 'silent' }), CALL_WAIT);
      call.first = (a) => {
        clearTimeout(timer);
        resolve(a);
      };
    });
    this.send({
      t: 'blive',
      to: slot,
      id,
      force,
      ...(bringsSuper(force) ? { super: true as const } : {}),
    });
    const a = await first;
    // (Whatever the first word, a late second one means nothing to this call.)
    call.first = () => undefined;
    switch (a.kind) {
      case 'start':
      case 'ended':
        // Running, or over already (its record follows, and is run here): until it's reported.
        return done;
      case 'silent':
        this.calls.delete(id);
        return { kind: 'wait', ms: 20_000 };
      case 'off':
        this.calls.delete(id);
        // The old way pins the force itself, when it has the battle to put.
        await this.env.settle(expedition, false);
        return a.refused
          ? { kind: 'refused', reason: a.why, ...(a.later !== undefined ? { later: a.later } : {}) }
          : { kind: 'fallback' };
    }
  }

  /** The attacker's run has reached the battle's end. */
  private runDone(s: Session, end: LiveEnd): void {
    s.end = end;
    s.mine = { step: end.step, hash: end.hash };
    s.mineAt = this.now;
    s.sentAt = this.now;
    s.step = end.step;
    s.runner?.stop();
    // (A battle run out from the room's record has nobody to tell.)
    if (!s.room) this.send({ t: 'bdone', id: s.id, step: end.step, hash: end.hash });
    // With no region any more, nobody will say it ended: the force still has its result.
    if (s.room || !this.link) void this.finalize(s);
    this.onChange?.();
  }

  /** The battle can't be taken: the force is let go of (and so can be called home), and told why. */
  private refuse(c: Call, reason: string): void {
    void this.env
      .settle(c.expedition, false)
      .catch(() => false)
      .then(() => this.endCall(c, { kind: 'refused', reason }));
  }

  private endCall(c: Call, a: LiveAttack): void {
    this.calls.delete(c.id);
    c.done(a);
  }

  // ------------------------------------------------------------------ the others' battles

  /** The room names a battle on now: a chance to watch it, unless this page is in it. */
  private onNow(m: Extract<RegionRoomMsg, { t: 'blivenow' }>): void {
    const mine = this.link?.slot ?? 0;
    if (m.from === mine || m.to === mine || this.running.has(m.id)) return;
    const b: LiveRunning = { id: m.id, from: m.from, to: m.to };
    this.running.set(b.id, b);
    this.onSpectacle?.(b);
    this.onChange?.();
  }

  /**
   * Watch a battle between two other cities (M39, design call 8): the room sends its input, the orders so
   * far and then what follows, and this page runs it (the same runner as an attacker's) to draw it. False
   * when there is nothing to watch it with: no region, a battle of this page's own on, or an unknown id.
   */
  watch(id: string): boolean {
    const link = this.link;
    if (!link || link.state !== 'in' || this.active) return false;
    const b = this.running.get(id);
    if (!b) return false;
    if (this.watching?.id === id) return true;
    this.stopWatching();
    this.watching = {
      id,
      from: b.from,
      asked: this.now,
      attacker: b.from,
      defender: b.to,
      input: null,
      orders: [],
      allow: 0,
      step: 0,
      frame: null,
      end: null,
    };
    this.send({ t: 'bwatch', id, from: b.from });
    this.onChange?.();
    return true;
  }

  /** Stop watching: the room is told, and the run stops. */
  unwatch(): void {
    const w = this.watching;
    if (!w) return;
    this.send({ t: 'bunwatch', id: w.id, ...(w.from !== undefined ? { from: w.from } : {}) });
    this.stopWatching();
    this.onChange?.();
  }

  private stopWatching(): void {
    this.watching?.runner?.stop();
    this.watching = null;
  }

  /** The room starts the battle this page asked to watch. */
  private onWatchStart(m: Extract<RegionRoomMsg, { t: 'bstart' }>): void {
    const w = this.watching;
    if (!w || w.id !== m.id) {
      // Not (or no longer) watched: the room is told to stop sending it.
      this.send({ t: 'bunwatch', id: m.id });
      return;
    }
    if (!w.runner) {
      let input: BattleInput;
      try {
        input = decodeBattle(m.input);
      } catch {
        input = null as never;
      }
      if (!input || input.id !== m.id || checkBattleInput(input)) {
        this.env.city.notice('live-watch', 'That battle could not be read, so it is not watched.', 'bad');
        this.unwatch();
        return;
      }
      w.input = input;
      w.attacker = m.attacker;
      w.defender = m.defender;
      w.runner = this.env.runner(structuredClone(input), {
        frame: (step, frame) => {
          w.step = step;
          w.frame = frame;
          this.onChange?.();
        },
        done: (end) => {
          w.run = end;
          w.runner?.stop();
          this.onChange?.();
        },
        error: () => {
          this.env.city.notice('live-watch', 'Watching that battle stopped: the run failed.', 'bad');
          if (this.watching === w) this.unwatch();
        },
      });
    }
    this.takeWatch(w, m.orders, m.allow);
  }

  /** Orders and the frontier for the battle being watched. */
  private takeWatch(w: Watch, orders: readonly StampedOrder[], allow: number): void {
    const known = new Set(w.orders.map((o) => o.seq));
    const fresh = orders.filter((o) => !known.has(o.seq));
    w.orders.push(...fresh);
    w.orders.sort((a, b) => a.seq - b.seq);
    if (allow > w.allow) w.allow = allow;
    w.runner?.feed(fresh, w.allow, w.end !== null);
    this.onChange?.();
  }

  // ------------------------------------------------------------------ a stand-in for tests

  /**
   * This page's side of a battle with no call or expedition behind it (the test stand-in,
   * `liveStage.ts`): the attacker's run of `input`, started like any other once the stand-in's room
   * sends its `bstart`. Nothing is reported to a force.
   */
  stage(input: BattleInput, from: number, to: number): void {
    const s = this.session('attacker', input, from, to);
    this.sessions.set(s.id, s);
    this.lastView = null;
    this.run(s);
    this.onChange?.();
  }

  // ------------------------------------------------------------------ the end

  /** Both the room and this page have the battle's end: keep it, and give the force (or city) its due. */
  private async finalize(s: Session): Promise<void> {
    if (s.finalized) return;
    s.finalized = true;
    this.last = this.stateOf(s);
    this.lastView = { ...this.viewOf(s), over: true };
    this.lastLog = s.log;
    const input = recordInput(s.input, s.orders);
    if (s.role === 'defender') {
      await this.env.store
        .keepBattle({
          id: replayId(s.id),
          city: this.env.city.cityName(),
          other: s.input.attacker.name,
          tick: this.env.city.tick(),
          input,
          townKey: `replay:${replayId(s.id)}`,
          savedAt: new Date().toISOString(),
        })
        .catch(() => undefined);
    } else if (s.call && s.end) {
      const call = s.call;
      const friend = call.city.neighbour;
      const key = `player:${s.id}`;
      // The friend's town, for the replay (best effort: without it the battle is not shown again).
      void this.env.fetchSave(friend.slot!).then(
        (save) => this.env.store.keepTown(key, save),
        () => undefined,
      );
      await this.env.store
        .keepBattle({
          id: s.id,
          city: call.city.cityName,
          other: friend.name,
          tick: this.env.city.tick(),
          input,
          townKey: key,
          savedAt: new Date().toISOString(),
          postTo: friend.slot!,
          posted: true,
          expedition: call.expedition,
          result: { ...s.end.result, replay: s.id },
        })
        .catch(() => undefined);
      const ok = await this.env.report(call.expedition, { ...s.end.result, replay: s.id }).catch(() => false);
      this.endCall(call, { kind: 'done', ok });
    }
    this.sessions.delete(s.id);
    this.onChange?.();
  }
}
