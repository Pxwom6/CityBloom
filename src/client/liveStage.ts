/**
 * A stand-in for the region room, for one page (M39 step 4, test builds): a live battle staged in a
 * page with no second player, so the battle map can be seen and driven alone, in screenshots and in
 * the e2e. It plays the room's part for the one battle with the room's own state machine
 * (`LiveSession`, relay/live.ts): the page's reports pace it, its orders are stamped at the frontier
 * and sent back at once, a side nobody plays is handed over to the battle's own judgement, and the
 * end is the page's own. A watched battle has no page of the player's in it: a hidden run of the
 * same battle stands in for the two combatants' pages and moves the frontier at the battle's pace.
 *
 * It is a `LiveLink`, so `LiveBattles.attach(stage)` is all the page needs; the page code that handles
 * the room's messages is the real one. Nothing here reaches the network.
 */
import { LiveSession, cleanLiveOrder, type LiveOrder, type LiveSide } from '../../relay/live';
import { LIVE } from '../../relay/protocol';
import type { RegionClientMsg, RegionRoomMsg } from '../../relay/region';
import type { LiveSink } from '../net/regionLink';
import { decodeBattle, encodeBattle } from '../net/snapshot';
import type { OrderRequest } from '../sim/battle/live';
import type { BattleInput } from '../sim/battle/types';
import type { LiveLink } from './liveBattles';
import { LiveRunner } from './liveRunner';

export type StageRole = 'attacker' | 'defender' | 'watcher';

export class LiveStage implements LiveLink {
  state = 'in';
  live: LiveSink | null = null;
  /** The battle being staged: the room's state for it, and the page's side (null for a watcher). */
  session: LiveSession | null = null;
  side: LiveSide | null;
  /** The sides nobody plays here: they keep pace with the page (or the hidden run) and give no orders unless told to. */
  private readonly virtual: LiveSide[];
  /** The input as the defender's page sent it (parts), once it has. */
  private parts: string[] = [];
  /** How many `bjoin`s the stand-in leaves unanswered (a handover that stays handed over for a while). */
  ignoreJoins = 0;
  /** The hidden run that paces a watched battle (and learns how it ends). */
  private ghost: LiveRunner | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ended = false;
  /** Orders the stand-in stamped, as the page's test API reports them. */
  readonly stamped: LiveOrder[] = [];

  constructor(
    readonly role: StageRole,
    /** This page's place in the stand-in's region. */
    readonly slot: number,
    readonly from: number,
    readonly to: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.side = role === 'attacker' ? 0 : role === 'defender' ? 1 : null;
    this.virtual = role === 'attacker' ? [1] : role === 'defender' ? [0] : [0, 1];
  }

  /** Stop the stand-in's clock. */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ to the page

  private tell(m: RegionRoomMsg): void {
    // (Never in the middle of the page's own call: the room's answer comes after it.)
    queueMicrotask(() => this.live?.message(m));
  }

  /** The room's `bstart` for the page (or the watcher). */
  private start(role: StageRole): RegionRoomMsg {
    const s = this.session!;
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

  // ------------------------------------------------------------------ beginning

  /** The page is the attacker, in `input` (its run has been staged on the page: `LiveBattles.stage`). */
  beginAttacker(input: BattleInput): void {
    this.open(input);
    this.tell(this.start('attacker'));
  }

  /** The page is a watcher: two cities are fighting, and neither is this one. */
  beginWatched(input: BattleInput): void {
    this.open(input);
    this.ghost = new LiveRunner(structuredClone(input), this.now);
    this.timer = setInterval(() => this.tick(), 100);
    this.tell({ t: 'blivenow', id: input.id, from: this.from, to: this.to });
  }

  private open(input: BattleInput): void {
    const s = new LiveSession(input.id, this.from, this.to, null, false, this.now());
    s.start(encodeBattle(input), this.now());
    this.session = s;
  }

  // ------------------------------------------------------------------ from the page

  /** A message the page sends the room (`RegionLink.sendLive`). */
  sendLive(m: RegionClientMsg): void {
    switch (m.t) {
      case 'binput': {
        if (this.role !== 'defender') return;
        this.parts[m.part] = m.data;
        if (this.parts.filter((p) => p !== undefined).length < m.parts) return;
        // The defender's input is in: the battle begins, the attacker's side nobody's.
        const s = new LiveSession(m.id, this.from, this.to, null, false, this.now());
        s.start(this.parts, this.now());
        this.session = s;
        this.tell(this.start('defender'));
        return;
      }
      case 'bstep':
        return this.onStep(m);
      case 'bdone':
        return this.onDone(m);
      case 'bjoin': {
        const s = this.session;
        if (!s || this.side === null) return;
        if (this.ignoreJoins > 0) {
          this.ignoreJoins--;
          return;
        }
        s.rejoin(this.side, this.now());
        this.tell(this.start(this.role));
        return;
      }
      case 'bwatch':
        if (this.role === 'watcher' && this.session) this.tell(this.start('watcher'));
        return;
      default:
        return;
    }
  }

  private onStep(m: Extract<RegionClientMsg, { t: 'bstep' }>): void {
    const s = this.session;
    if (!s || s.id !== m.id || this.side === null || this.ended) return;
    const t = this.now();
    s.report(this.side, m.step, t);
    for (const v of this.virtual) s.report(v, m.step, t);
    let ords: LiveOrder[] = [];
    if (m.orders?.length) {
      const list = m.orders.flatMap((o) => {
        const c = cleanLiveOrder(o);
        return c ? [c] : [];
      });
      ords = s.stamp(this.side, list.slice(0, LIVE.perMessage)).stamped;
    }
    this.stamped.push(...ords);
    const moved = s.pace(t);
    if (moved || ords.length)
      this.tell({ t: 'ballow', id: s.id, allow: s.allow, ...(ords.length ? { ords } : {}) });
  }

  private onDone(m: Extract<RegionClientMsg, { t: 'bdone' }>): void {
    const s = this.session;
    if (!s || s.id !== m.id || this.side === null) return;
    s.finish(this.side, m.step, m.hash, this.now());
    for (const v of this.virtual) s.finish(v, m.step, m.hash, this.now());
    this.finishIfOver();
  }

  private finishIfOver(): void {
    const s = this.session!;
    const end = s.ending(this.now());
    if (!end || this.ended) return;
    this.ended = true;
    this.stop();
    this.tell({ t: 'bend', id: s.id, from: s.from, to: s.to, ...end });
  }

  // ------------------------------------------------------------------ the stand-in's own doings

  /**
   * The room hands the page's side over (as it does a page that fell quiet): its forces go back to the
   * battle's judgement. The next `ignore` rejoins the page asks for go unanswered, so it stays handed
   * over until its player takes command again with the button.
   */
  handOver(ignore = 1): boolean {
    const s = this.session;
    if (!s || this.side === null || this.ended) return false;
    const o = s.handover(this.side);
    if (!o) return false;
    this.ignoreJoins = ignore;
    this.stamped.push(o);
    this.tell({ t: 'ballow', id: s.id, allow: s.allow, ords: [o] });
    return true;
  }

  /** The other combatant (a player nobody here is) gives an order, stamped at the frontier. */
  say(side: LiveSide, req: OrderRequest): boolean {
    const s = this.session;
    if (!s || this.ended) return false;
    const r = s.stamp(side, [req]);
    if (!r.stamped.length) return false;
    this.stamped.push(...r.stamped);
    this.ghost?.feed(r.stamped, s.allow);
    this.tell({ t: 'ballow', id: s.id, allow: s.allow, ords: r.stamped });
    return true;
  }

  /**
   * The clock of a watched battle: the hidden run follows the frontier at the battle's pace, the two
   * virtual combatants report its step, and the frontier follows them.
   */
  private tick(): void {
    const s = this.session;
    const g = this.ghost;
    if (!s || !g || this.ended) return;
    const t = this.now();
    g.feed([], s.allow);
    g.pump();
    // The virtual combatants are with it, step for step.
    for (const i of this.virtual) s.report(i, g.step, t);
    if (s.pace(t)) this.tell({ t: 'ballow', id: s.id, allow: s.allow });
    const end = g.end();
    if (end) {
      for (const i of this.virtual) s.finish(i, end.step, end.hash, t);
      this.finishIfOver();
    }
  }
}

/** The input a staged battle was made from, as the page would get it from the room (for tests). */
export const stagedInput = (parts: string[]): BattleInput => decodeBattle(parts);
