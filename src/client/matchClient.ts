/**
 * A quick match on the page (M43): the match as the region room tells it, the city's clock, the
 * scoreboard, emotes and chat, the last report with the city's hash, and the rematch. The room keeps
 * the clock and decides; this page runs its city towards the tick the time allows (the worker's
 * `matchClock`), sends its figures every few seconds, its last report as the match ends, and shows the
 * one result the room sends every page.
 *
 * A rematch founds a new city on the room's new seed: the page reloads into it (`?match=<invite>`),
 * keeping its place in the region (its slot and secret) in this tab's session storage; a peer-to-peer
 * host keeps the region's record there too and opens the region again from it.
 */
import { MATCH, matchScore, type MatchFigures, type MatchSettings } from '../data/match';
import { matchEndTick, type MatchPhase, type MatchRow, type MatchView } from '../../relay/match';
import type { RegionRoomMsg, RegionView } from '../../relay/region';
import type { MatchSink, RegionLink } from '../net/regionLink';
import type { RegionReport } from '../sim/systems/region';

/** What a tab keeps between the rounds of a match (session storage: this tab only). */
export interface MatchSession {
  invite: string;
  kind: 'online' | 'p2p';
  /** The city's place in the region, to come back to it as itself. */
  slot: number;
  secret: string;
  /** The player's city name, the same every round. */
  city: string;
  /** The round the next city is founded for. */
  round: number;
  /** A peer-to-peer host's region record (`RegionRoom.record()`), opened again after the reload. */
  hub?: unknown;
}

const SESSION_KEY = 'citybloom.match';

export function loadMatchSession(): MatchSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<MatchSession>;
    if (
      typeof s.invite !== 'string' ||
      (s.kind !== 'online' && s.kind !== 'p2p') ||
      typeof s.slot !== 'number' ||
      typeof s.secret !== 'string' ||
      typeof s.city !== 'string' ||
      typeof s.round !== 'number'
    )
      return null;
    return s as MatchSession;
  } catch {
    return null;
  }
}

export function saveMatchSession(s: MatchSession | null): void {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode: a rematch then joins as a new city */
  }
}

/** What the match needs of the game around it. */
export interface MatchHost {
  matchClock(clock: { startIn: number; endTick: number } | 'stop' | 'off'): void;
  hash(): Promise<string>;
  /** The city's tick and residents as the page last heard. */
  tick(): number;
  population(): number;
  /** The match's speed is the city's while it plays (the speed buttons show it). */
  showSpeed(playing: boolean): void;
  notify(): void;
  /** The room asked for the next round: reload into it. */
  rematch(next: MatchSession): void;
  /** Test builds: what the clock did, for a failing end-to-end test to print. */
  log?(line: string): void;
}

/** A recent emote or line of chat, shown for a few seconds. */
export interface MatchSaid {
  id: number;
  from: number;
  at: number;
  e?: number;
  text?: string;
}

export class MatchClient implements MatchSink {
  /** The match as the room last said (null outside a match). */
  info: MatchView | null = null;
  /** The region's view (names, colours, who is here). */
  region: RegionView | null = null;
  /** Each city's last counted figures, by slot (the room's score lines). */
  rows = new Map<number, MatchRow>();
  said: MatchSaid[] = [];
  /** Each city's latest picture, by slot (a match's views leave them out: they come as `mthumb`). */
  thumbs = new Map<number, string>();
  /** The round this city was founded for (0: not a match city). */
  round = 0;
  invite: string | null = null;
  kind: 'online' | 'p2p' | null = null;
  city = '';
  /** This page's clock (performance.now()): when the match starts and ends. */
  startAt = 0;
  endsAt = 0;
  /** Race: the tick the city first had the target. */
  reached?: number;
  /** The last report went, with this hash. */
  hash: string | null = null;
  /** The results card is open. */
  resultsOpen = false;
  /** The city was kept as an ordinary save (its slot's label). */
  kept: string | null = null;
  /** The match ended without a result (a peer-to-peer host left): why. */
  cut: string | null = null;
  private link: RegionLink | null = null;
  private clockOn = false;
  private stopped = false;
  private readySent = 0;
  private final = false;
  private finalGoing = false;
  private nextId = 1;
  private rematching = false;

  constructor(private readonly host: MatchHost) {}

  /** This round started without this city (it was still reloading into it): it sits the round out. */
  get sittingOut(): boolean {
    const p = this.info?.players.find((x) => x.slot === this.slot);
    return !!p?.out && this.info?.phase !== 'over' && this.info?.round === this.round;
  }

  /** This page's city is in a quick match. */
  get active(): boolean {
    return this.round > 0;
  }

  get phase(): MatchPhase | null {
    return this.info?.phase ?? null;
  }

  get settings(): MatchSettings | null {
    return this.info?.settings ?? null;
  }

  /** The tick the city stops at. */
  get endTick(): number {
    return this.info ? matchEndTick(this.info.settings) : Infinity;
  }

  /** A match city is founded for this round of the match at this invite. */
  begin(o: { invite: string; kind: 'online' | 'p2p'; round: number; city: string }): void {
    this.invite = o.invite;
    this.kind = o.kind;
    this.round = o.round;
    this.city = o.city;
  }

  attach(link: RegionLink): void {
    this.link = link;
    link.match = this;
  }

  detach(): void {
    if (this.link) this.link.match = null;
    this.link = null;
  }

  /** The city's place in the region, as the link has it. */
  get slot(): number {
    return this.link?.slot ?? 0;
  }

  get isHost(): boolean {
    return !!this.link?.isHost;
  }

  /** Ms left on the timer (the countdown before the start: negative is not yet started). */
  timeLeft(now = performance.now()): number {
    return Math.max(0, this.endsAt - Math.max(now, this.startAt));
  }

  /** Why a command can't be given now, or null (the city is built only while the match plays). */
  refusal(now = performance.now()): string | null {
    if (!this.active || this.kept) return null;
    const p = this.phase;
    if (this.sittingOut) return 'This round started without you: you’ll be in the next one';
    if (!p || p === 'lobby' || p === 'countdown' || (p === 'playing' && now < this.startAt))
      return 'The match hasn’t started yet: wait for the countdown';
    if (p === 'final' || p === 'over' || this.host.tick() >= this.endTick) return 'The match is over';
    return null;
  }

  // ---- The room's word ---------------------------------------------------------------------------

  view(v: RegionView): void {
    const m = v.match;
    if (!m) return;
    // Pictures: the welcome's are kept, and put back into later views (which leave them out).
    for (const c of v.cities) {
      if (c.thumb) this.thumbs.set(c.slot, c.thumb);
      else c.thumb = this.thumbs.get(c.slot) ?? null;
    }
    this.region = v;
    const was = this.info;
    // Views come in the order the room sent them; an older round's is stale.
    if (m.round < this.round) return;
    this.info = m;
    if (m.round > this.round) {
      if (m.phase === 'lobby') this.toNextRound(m);
      return this.host.notify();
    }
    const now = performance.now();
    if (m.phase !== was?.phase)
      this.host.log?.(`phase ${m.phase} (round ${m.round}, tick ${this.host.tick()})`);
    if (m.phase === 'lobby' && this.link && this.readySent !== m.round) {
      if (this.link.sendMatch({ t: 'mready', round: m.round })) this.readySent = m.round;
    }
    if (
      (m.phase === 'countdown' || m.phase === 'playing') &&
      !this.clockOn &&
      m.startIn !== undefined &&
      !this.sittingOut
    ) {
      this.clockOn = true;
      this.startAt = now + m.startIn;
      this.endsAt = now + (m.endsIn ?? 0);
      this.host.matchClock({ startIn: m.startIn, endTick: this.endTick });
      this.host.log?.(
        `clock: starts in ${Math.round(m.startIn)} ms, ends in ${Math.round(m.endsIn ?? 0)} ms`,
      );
    }
    if (this.clockOn && m.phase === 'playing' && m.endsIn !== undefined) this.correct(now + m.endsIn);
    // Stopped early (a Race won, or only one city left): the city holds where it is.
    if (m.phase === 'final' && m.endedBy !== 'time' && !this.stopped) {
      this.stopped = true;
      this.host.matchClock('stop');
    }
    if (m.phase === 'final' || m.phase === 'over') {
      this.host.showSpeed(false);
      void this.sendFinal();
    }
    if (m.phase === 'over' && was?.phase !== 'over') this.resultsOpen = true;
    this.host.notify();
  }

  message(m: RegionRoomMsg): boolean {
    switch (m.t) {
      case 'mscores':
        if (m.round === this.info?.round) {
          for (const r of m.rows) this.rows.set(r.slot, r);
          if (m.left !== undefined) this.correct(performance.now() + m.left);
        }
        this.host.notify();
        return true;
      case 'mthumb': {
        this.thumbs.set(m.slot, m.thumb);
        const c = this.region?.cities.find((x) => x.slot === m.slot);
        if (c) c.thumb = m.thumb;
        this.host.notify();
        return true;
      }
      case 'memote':
      case 'mchat': {
        const now = performance.now();
        this.said = this.said.filter((s) => now - s.at < 30_000).slice(-20);
        this.said.push({
          id: this.nextId++,
          from: m.from,
          at: now,
          ...(m.t === 'memote' ? { e: m.e } : { text: m.text }),
        });
        this.host.notify();
        return true;
      }
      default:
        return false;
    }
  }

  extend(r: RegionReport): RegionReport {
    if (!r.match || !this.active) return r;
    const reached = this.reached !== undefined && this.reached <= r.match.tick ? this.reached : undefined;
    return {
      ...r,
      match: {
        ...r.match,
        round: this.round,
        ...(reached !== undefined ? { reached } : {}),
        ...(this.final && this.hash ? { final: true as const, hash: this.hash } : {}),
      },
    };
  }

  // ---- The page's part --------------------------------------------------------------------------

  /** Each frame: the clock on screen, Race's target reached, the end of the timer. */
  frame(tick: number, population: number): void {
    if (!this.active || !this.info || this.kept) return;
    const now = performance.now();
    const playing = this.info.phase === 'playing' && now >= this.startAt && tick < this.endTick;
    this.host.showSpeed(playing);
    const s = this.info.settings;
    if (s.mode === 'race' && this.reached === undefined && population >= s.target && this.clockOn) {
      this.reached = tick;
      // Said at once, not at the next report: the first to the target ends the match.
      void this.link?.reportNow();
    }
    if (this.clockOn && tick >= this.endTick) void this.sendFinal();
  }

  /**
   * The last report: once the city has stopped (at the timer's last tick, or where a Race's end found
   * it), with its state hash, so every page's result lists the same hashes.
   */
  private async sendFinal(): Promise<void> {
    if (this.final || this.finalGoing || !this.link || !this.clockOn) return;
    const m = this.info;
    if (!m) return;
    // At the timer's end the city may still be catching up to its last tick: wait for it.
    if (!this.stopped && this.host.tick() < this.endTick) return;
    this.finalGoing = true;
    try {
      this.hash = await this.host.hash();
      this.final = true;
      this.host.log?.(
        `last report: tick ${this.host.tick()}, hash ${this.hash}, room phase ${this.info?.phase}, link ${this.link.state}`,
      );
      await this.link.reportNow(true);
      this.host.log?.('last report sent');
    } finally {
      this.finalGoing = false;
    }
    this.host.notify();
  }

  /**
   * The room says the timer ends at `end` (this page's clock, as the word arrived): a page that took
   * the countdown late (a busy main thread) moves its clock up to it. Only ever earlier: a word that
   * arrived late itself says less time is gone than is.
   */
  private correct(end: number): void {
    if (!this.clockOn || this.stopped || end >= this.endsAt - 100) return;
    const shift = this.endsAt - end;
    this.host.log?.(`clock moved up ${Math.round(shift)} ms`);
    this.startAt -= shift;
    this.endsAt = end;
    this.host.matchClock({ startIn: this.startAt - performance.now(), endTick: this.endTick });
  }

  /** Each city's figures and score, best first (the scoreboard); `me` marks this city. */
  standings(): {
    slot: number;
    name: string;
    color: number;
    fig: MatchFigures | null;
    score: number;
    me: boolean;
    out: boolean;
    online: boolean;
  }[] {
    const s = this.info?.settings;
    if (!s || !this.region) return [];
    const out = new Set((this.info?.players ?? []).filter((p) => p.out).map((p) => p.slot));
    return this.region.cities
      .map((c) => {
        const r = this.rows.get(c.slot);
        const fig = r
          ? { population: r.population, treasury: r.treasury, assets: r.assets, approval: r.approval }
          : null;
        return {
          slot: c.slot,
          name: c.name,
          color: c.color,
          fig,
          score: fig ? matchScore(s.mode, fig, s) : -Infinity,
          me: c.slot === this.slot,
          out: out.has(c.slot),
          online: c.online,
        };
      })
      .sort((a, b) => Number(a.out) - Number(b.out) || b.score - a.score || a.slot - b.slot);
  }

  /** The host asks for a rematch on a new seed (with any changes to the settings). */
  requestRematch(settings?: MatchSettings): boolean {
    return !!this.link?.sendMatch({ t: 'mnext', ...(settings ? { settings } : {}) });
  }

  start(): boolean {
    return !!this.link?.sendMatch({ t: 'mstart' });
  }

  setSettings(settings: MatchSettings): boolean {
    return !!this.link?.sendMatch({ t: 'mset', settings });
  }

  emote(e: number): boolean {
    return !!this.link?.sendMatch({ t: 'emote', e });
  }

  chat(text: string): boolean {
    return !!this.link?.sendMatch({ t: 'mchat', text });
  }

  /** The player leaves the match (out; it goes on without them). */
  leave(): void {
    // After the result too: a rematch then doesn't wait for this city.
    if (this.phase) this.link?.sendMatch({ t: 'mleave' });
    saveMatchSession(null);
  }

  /** The region went (a peer-to-peer host left): the match ends here with the scores as they were. */
  closed(why: string): void {
    if (!this.active || this.phase === 'over' || this.kept) return;
    this.cut = why;
    this.resultsOpen = true;
    this.host.matchClock('stop');
    this.host.showSpeed(false);
    this.host.notify();
  }

  /** The city is kept as an ordinary one: no more match (its fast start goes, its speed is the player's). */
  keptAs(label: string): void {
    this.kept = label;
    this.host.matchClock('off');
    this.host.notify();
  }

  private toNextRound(m: MatchView): void {
    if (this.rematching || !this.link?.slot || !this.invite || !this.kind) return;
    this.rematching = true;
    this.host.rematch({
      invite: this.invite,
      kind: this.kind,
      slot: this.link.slot,
      secret: this.link.secret,
      city: this.city,
      round: m.round,
    });
  }
}

/** The countdown to show: seconds before the start, or the last minute's seconds (else null). */
export function countdownShown(
  c: MatchClient,
  now = performance.now(),
): { kind: 'start' | 'end'; s: number } | null {
  if (!c.active || c.kept) return null;
  if ((c.phase === 'countdown' || c.phase === 'playing') && now < c.startAt)
    return { kind: 'start', s: Math.ceil((c.startAt - now) / 1000) };
  if (c.phase === 'playing') {
    const left = c.timeLeft(now);
    if (left > 0 && left <= 60_000) return { kind: 'end', s: Math.ceil(left / 1000) };
  }
  return null;
}

/** "12:05", the timer as the scoreboard shows it. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The fixed emotes, for the buttons and what others sent. */
export const EMOTES = MATCH.emotes;
