/**
 * A player's side of a room (M30): says hello, loads the city from a snapshot (or uploads it when
 * making the room), feeds the room's events to the sim, reports progress and hourly checksums,
 * keeps time when it's this game's turn to, sends commands and hands their results back, and
 * reconnects after a dropped connection without a reload. The same class drives a real game's
 * worker and a headless test player.
 */
import type { Command, CommandResult } from '../sim/commands';
import type { Applied } from '../sim/lockstep';
import { SPEED_TICKS_PER_SECOND } from '../sim/time';
import { MAX_CLOCK_STEP } from '../../relay/room';
import {
  PROTOCOL_VERSION,
  type AdminAction,
  type ClientMsg,
  type CreateRoom,
  type PlayerInfo,
  type Presence,
  type RoomInfo,
  type RoomMsg,
  type Speed,
} from '../../relay/protocol';
import type { SharedMessage } from '../client/simClient';
import type { SimDriver } from './driver';
import type { Permission } from '../sim/rules';
import type { Link } from './link';
import { decodeSnapshot, encodeSnapshot, SnapshotAssembler } from './snapshot';

export type SessionState = 'connecting' | 'joining' | 'playing' | 'reconnecting' | 'closed';

export interface SessionOptions {
  name: string;
  color: number;
  /** Make the room from the city the driver holds. */
  create?: CreateRoom;
  /** Come back as this player (a reloaded page), asking for the city afresh. */
  rejoin?: { id: number; secret: string };
  /** How often to report progress, and how often the pacer moves time (ms). */
  statusEvery?: number;
  clockEvery?: number;
  /** Is this game in front? (Background tabs don't keep time.) */
  visible?: () => boolean;
  now?: () => number;
  /** Game ticks a second at each speed (tests run the city faster than any player would). */
  ticksPerSecond?: readonly number[];
}

export interface NetNotice {
  text: string;
  kind: 'info' | 'warn' | 'chat';
  from?: number;
}

/** How many game ticks the pacer lets the city run ahead of the slowest player (3 s of play). */
export function leadTicks(speed: Speed, tps: readonly number[] = SPEED_TICKS_PER_SECOND): number {
  return Math.max(48, tps[speed]! * 3);
}

export class RoomSession {
  state: SessionState = 'connecting';
  you = 0;
  private secret = '';
  room: RoomInfo | null = null;
  players: PlayerInfo[] = [];
  /** The last event received, and how far the room lets the sims run. */
  lastSeq = -1;
  allowed = 0;
  /** Why the session ended, if it did. */
  error: string | null = null;
  /** Who the city is waiting for, if anyone ("Waiting for Sam…"). */
  waitingFor: string | null = null;

  private link: Link | null = null;
  private chain: Promise<void> = Promise.resolve();
  private assembler = new SnapshotAssembler();
  private nextRef = 1;
  private pending = new Map<number, (r: CommandResult) => void>();
  private sums: [number, string][] = [];
  private lastStatus = { tick: -1, at: 0, visible: true };
  private clockAcc = 0;
  private lastClock = 0;
  private lastAllowAt = 0;
  private timers: ReturnType<typeof setInterval>[] = [];
  private unsub: (() => void) | null = null;
  private retry = 0;
  private started: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private readonly now: () => number;
  /** Messages this player sent and their bytes (the network budget). */
  sent = { messages: 0, bytes: 0 };
  received = { messages: 0, bytes: 0 };

  /** Where the others are and what they're doing (M31), with when it was heard (ms). */
  readonly presence = new Map<number, Presence & { heard: number }>();
  onPing: ((from: number, at: [number, number]) => void) | null = null;
  onChange: (() => void) | null = null;
  onNotice: ((n: NetNotice) => void) | null = null;
  /** Every command the room ordered, once this sim applied it (for "who did what"). */
  onApplied: ((a: Applied) => void) | null = null;

  constructor(
    private readonly driver: SimDriver,
    private readonly connect: () => Promise<Link>,
    private readonly opts: SessionOptions,
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.tps = opts.ticksPerSecond ?? SPEED_TICKS_PER_SECOND;
    if (opts.rejoin) {
      this.you = opts.rejoin.id;
      this.secret = opts.rejoin.secret;
    }
  }

  /** Who this player is in the room (to rejoin after a reload). */
  get credentials(): { id: number; secret: string } | null {
    return this.you ? { id: this.you, secret: this.secret } : null;
  }

  private readonly tps: readonly number[];

  /** Connect and get into the city; resolves once this game is playing, rejects with the reason. */
  start(): Promise<void> {
    this.unsub = this.driver.onShared((m) => this.fromSim(m));
    const p = new Promise<void>((resolve, reject) => (this.started = { resolve, reject }));
    void this.open(!!this.opts.rejoin);
    // A second between progress reports and half a second between clock moves: well inside the
    // three-second lead, and few enough messages for an online room's free plan (M33).
    this.timers.push(setInterval(() => this.statusTick(), this.opts.statusEvery ?? 1000));
    this.timers.push(setInterval(() => this.clockTick(), this.opts.clockEvery ?? 500));
    return p;
  }

  get me(): PlayerInfo | undefined {
    return this.players.find((p) => p.id === this.you);
  }

  get isHost(): boolean {
    return !!this.me?.host;
  }

  get isPacer(): boolean {
    return !!this.room && this.room.pacer === this.you;
  }

  private changed(): void {
    this.onChange?.();
  }

  private notice(text: string, kind: NetNotice['kind'] = 'info', from?: number): void {
    this.onNotice?.({ text, kind, ...(from ? { from } : {}) });
  }

  private async open(rejoin: boolean): Promise<void> {
    try {
      const link = await this.connect();
      if (this.state === 'closed') return link.close();
      this.link = link;
      link.onmessage = (t) => {
        this.received.messages++;
        this.received.bytes += t.length;
        if (t === 'pong') return;
        let m: RoomMsg;
        try {
          m = JSON.parse(t) as RoomMsg;
        } catch {
          return;
        }
        this.chain = this.chain.then(() => this.receive(m)).catch((err: unknown) => this.fail(String(err)));
      };
      // After any messages still being handled (an error comes just before its close).
      link.onclose = (why) => {
        this.chain = this.chain.then(() => this.dropped(why));
      };
      this.retry = 0;
      this.send({
        t: 'hello',
        v: PROTOCOL_VERSION,
        name: this.opts.name,
        color: this.opts.color,
        ...(this.opts.create && !rejoin ? { create: this.opts.create } : {}),
        ...(rejoin
          ? { rejoin: { id: this.you, secret: this.secret, seq: this.loadedOnce ? this.lastSeq : -2 } }
          : {}),
      });
    } catch (err) {
      if (rejoin && this.loadedOnce) return this.dropped(err instanceof Error ? err.message : String(err));
      this.fail(`Couldn't reach the room (${err instanceof Error ? err.message : String(err)})`);
    }
  }

  private dropped(why: string): void {
    this.link = null;
    if (this.state === 'closed') return;
    if (!this.you) return this.fail(`The connection closed: ${why}`);
    if (this.state !== 'reconnecting') this.notice('Reconnecting…', 'warn');
    this.state = 'reconnecting';
    this.changed();
    const wait = Math.min(15_000, 500 * 2 ** this.retry++);
    setTimeout(() => {
      if (this.state === 'reconnecting') void this.open(true);
    }, wait);
  }

  private fail(text: string): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    this.error = text;
    this.started?.reject(new Error(text));
    this.started = null;
    this.stopTimers();
    for (const r of this.pending.values()) r({ ok: false, reason: 'Not connected to the room' });
    this.pending.clear();
    this.changed();
  }

  private stopTimers(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private send(m: ClientMsg): void {
    if (!this.link) return;
    const t = JSON.stringify(m);
    this.sent.messages++;
    this.sent.bytes += t.length;
    this.link.send(t);
  }

  private playing(): void {
    if (this.state !== 'playing') {
      const back = this.state === 'reconnecting';
      this.state = 'playing';
      if (back) this.notice('Back in the room');
      this.started?.resolve();
      this.started = null;
      this.changed();
    }
  }

  // ---------------------------------------------------------------- from the room

  private async receive(m: RoomMsg): Promise<void> {
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        this.secret = m.secret;
        this.room = m.room;
        this.players = m.players;
        if (m.join === 'upload') this.upload();
        else if (m.join === 'snapshot') {
          this.state = 'joining';
          this.changed();
        } else this.playing();
        return;
      case 'ev':
        for (const e of m.list) if (e.seq > this.lastSeq) this.lastSeq = e.seq;
        if (m.allow !== this.allowed) this.lastAllowAt = this.now();
        this.allowed = m.allow;
        this.driver.stamped(m.list, m.allow);
        if (this.state === 'joining' && this.loadedOnce) this.playing();
        return;
      case 'snap': {
        const parts = this.assembler.add(m.meta, m.part, m.data);
        if (!parts) return;
        const snap = decodeSnapshot(parts);
        await this.driver.loadShared(snap, this.you, m.reason === 'resync' || this.loadedOnce);
        this.lastSeq = snap.seq;
        this.loadedOnce = true;
        return;
      }
      case 'players': {
        const before = new Map(this.players.map((p) => [p.id, p]));
        this.players = m.list;
        for (const p of m.list) if (!p.online) this.presence.delete(p.id);
        for (const p of m.list) {
          const was = before.get(p.id);
          if (p.id === this.you) continue;
          if (was && was.online && !p.online) this.notice(`${p.name} left`);
          else if (was && !was.online && p.online) this.notice(`${p.name} is back`);
          else if (was?.joining && !p.joining && p.online) this.notice(`${p.name} joined`);
        }
        this.changed();
        return;
      }
      case 'here': {
        const { t: _t, from, ...rest } = m;
        this.presence.set(from, { ...rest, heard: this.now() });
        return;
      }
      case 'ping':
        this.onPing?.(m.from, m.at);
        return;
      case 'ticks':
        for (const [id, tick] of m.ticks) {
          const p = this.players.find((x) => x.id === id);
          if (p) p.tick = tick;
        }
        return;
      case 'room':
        this.room = m.room;
        this.changed();
        return;
      case 'resync':
        this.notice(m.player === this.you ? 'Your game fell out of step; catching up' : m.text, 'warn');
        if (m.player === this.you) {
          this.state = 'joining';
          this.changed();
        }
        return;
      case 'refused': {
        const r = this.pending.get(m.ref);
        this.pending.delete(m.ref);
        r?.({ ok: false, reason: m.reason });
        return;
      }
      case 'chat':
        this.notice(m.text, 'chat', m.from);
        return;
      case 'notice':
        this.notice(m.text);
        return;
      case 'error':
        this.fail(m.text);
        this.link?.close();
        return;
    }
  }

  private loadedOnce = false;

  /** Making the room: this game shares its city, which sends it up as the room's first snapshot. */
  private upload(): void {
    this.loadedOnce = true;
    this.state = 'joining';
    this.driver.share(this.you, -1);
  }

  // ---------------------------------------------------------------- from the sim

  private fromSim(m: SharedMessage): void {
    switch (m.type) {
      case 'checksum':
        this.sums.push([m.tick, m.sum]);
        if (this.sums.length > 64) this.sums.shift();
        return;
      case 'applied':
        for (const a of m.list) {
          if (a.ev.kind !== 'cmd') continue;
          if (a.ev.by === this.you && a.ev.ref !== undefined) {
            const r = this.pending.get(a.ev.ref);
            this.pending.delete(a.ev.ref);
            r?.(a.result!);
          }
          try {
            this.onApplied?.(a);
          } catch {
            /* what the page shows of it; the next commands' results still go back */
          }
        }
        return;
      case 'snapshot': {
        const id = m.reason === 'upload' ? `${this.you}-up` : `${this.you}-${m.tick}`;
        const { meta, parts } = encodeSnapshot(m.snapshot, id);
        parts.forEach((data, part) => this.send({ t: 'snap', meta, part, data }));
        return;
      }
      case 'late':
        // An event for a tick already passed: this game can't agree any more. The hourly checksum
        // will show it within the hour and the room will resync it.
        return;
      case 'monthHashes':
        return;
    }
  }

  // ---------------------------------------------------------------- timers

  private statusTick(): void {
    if (!this.link || (this.state !== 'playing' && this.state !== 'joining')) return;
    const tick = this.driver.tick;
    const visible = this.opts.visible?.() ?? true;
    const now = this.now();
    const quiet = tick === this.lastStatus.tick && visible === this.lastStatus.visible && !this.sums.length;
    // Report while the city runs; when it stands still, only a keep-alive now and then, which an
    // online room answers without waking up.
    // While joining, keep the room hearing from us (it checks on a stalled snapshot as messages come).
    if (quiet && this.state === 'joining' && now - this.lastStatus.at > 2000) {
      this.lastStatus.at = now;
      this.send({ t: 'status', tick, visible });
      return;
    }
    if (quiet) {
      if (now - this.lastStatus.at > 25_000) {
        this.lastStatus.at = now;
        this.link.send('ping');
      }
      return;
    }
    this.lastStatus = { tick, at: now, visible };
    const sums = this.sums.splice(0);
    this.send({ t: 'status', tick, visible, ...(sums.length ? { sums } : {}) });
    this.updateWaiting(now);
  }

  /** The pacer moves time on, at the room's speed, never more than a lead ahead of the slowest player. */
  private clockTick(): void {
    const now = this.now();
    const room = this.room;
    if (!room || !this.isPacer || room.speed === 0 || this.state !== 'playing' || !this.link) {
      this.lastClock = now;
      this.clockAcc = 0;
      return;
    }
    this.clockAcc += ((now - this.lastClock) / 1000) * this.tps[room.speed]!;
    this.lastClock = now;
    const n = Math.floor(this.clockAcc);
    if (n < 1) return;
    let slowest = this.driver.tick;
    for (const p of this.players)
      // Not waited for: players catching up, and games in a background tab (the browser slows them
      // right down); they catch up when they come back.
      if (p.online && !p.joining && p.visible && p.id !== this.you) slowest = Math.min(slowest, p.tick);
    const lead = leadTicks(room.speed, this.tps);
    const target = Math.min(this.allowed + n, slowest + lead, this.allowed + MAX_CLOCK_STEP);
    if (target <= this.allowed) {
      // Waiting: don't bank the time, or the city would race to catch up afterwards.
      this.clockAcc = Math.min(this.clockAcc, 2);
      return;
    }
    this.clockAcc -= target - this.allowed;
    this.allowed = target;
    this.lastAllowAt = now;
    this.send({ t: 'clock', allow: target });
  }

  private updateWaiting(now: number): void {
    const speed = this.room?.speed ?? 0;
    let who: string | null = null;
    if (speed > 0 && this.state === 'playing' && now - this.lastAllowAt > 1500) {
      let slow: PlayerInfo | null = null;
      for (const p of this.players)
        if (p.online && !p.joining && p.visible && p.id !== this.you && (!slow || p.tick < slow.tick))
          slow = p;
      if (slow && slow.tick < this.allowed - leadTicks(speed, this.tps) / 2) who = slow.name;
    }
    if (who !== this.waitingFor) {
      this.waitingFor = who;
      this.changed();
    }
  }

  // ---------------------------------------------------------------- the player's actions

  /** Send a command for the room to order; resolves with the sim's result once applied here. */
  command(cmd: Command): Promise<CommandResult> {
    if (!this.link || this.state === 'closed')
      return Promise.resolve({
        ok: false,
        reason: this.state === 'reconnecting' ? 'Reconnecting…' : 'Not connected to the room',
      });
    const ref = this.nextRef++;
    return new Promise((resolve) => {
      this.pending.set(ref, resolve);
      this.send({ t: 'cmd', ref, cmd: cmd as unknown as { type: string } });
    });
  }

  /** Tell the others where this player is and what they're doing (the caller keeps it sparing). */
  sendPresence(p: Presence): void {
    if (this.state === 'playing') this.send({ t: 'here', ...p });
  }

  ping(at: [number, number]): void {
    this.send({ t: 'ping', at });
  }

  setSpeed(speed: Speed): void {
    this.send({ t: 'speed', speed });
  }

  chat(text: string): void {
    this.send({ t: 'chat', text });
  }

  /** The host: what a player may do, or the spending limit (M31). */
  setPermissions(player: number, perms: Permission[]): void {
    this.send({ t: 'rules', player, perms });
  }

  setSpendLimit(limit: number | null): void {
    this.send({ t: 'rules', spendLimit: limit });
  }

  admin(action: AdminAction, player?: number): void {
    this.send({ t: 'admin', action, ...(player ? { player } : {}) });
  }

  /** Leave the room (the city carries on for the others). */
  leave(): void {
    if (this.state === 'closed') return;
    this.send({ t: 'bye' });
    this.state = 'closed';
    this.stopTimers();
    this.unsub?.();
    this.link?.close();
    this.link = null;
    this.driver.unshare();
    this.changed();
  }

  /** For tests: drop the connection as a network would (the session reconnects by itself). */
  dropForTest(): void {
    const l = this.link;
    if (!l) return;
    l.close();
    this.dropped('dropped for a test');
  }
}
