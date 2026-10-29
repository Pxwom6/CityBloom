/**
 * A live battle between two players' cities (M39, design call 3), as the region room keeps it: the
 * state machine alone, with no connections and no clock of its own (every method is given `now`),
 * so the room can run it wherever it runs and tests can drive it step by step.
 *
 * The room orders a battle as a room orders a city. A page may run while its step is below the
 * frontier (`allow`); an order stamped at step s applies as the battle's step s begins; the frontier
 * is the slowest combatant's last reported step plus `LIVE.lead`, and never moves back. A combatant
 * who falls silent (or whose connection closes) is handed over: the room stamps a `free` order for
 * its side (the battle's own judgement takes its units back), refuses its later orders, and paces by
 * the other combatant alone, until it comes back and takes command again (`rejoin`).
 *
 * The room never reads a battle: the input is opaque, and an order is only checked for shape.
 */
import { LIVE } from './protocol';

/** The battle's own numbering of its sides: the attacker is 0, the defender 1. */
export type LiveSide = 0 | 1;

/** An order as a combatant sends it: the room adds its side and stamps its step. */
export interface LiveOrderIn {
  kind: string;
  /** The battle's unit ids it names (none: the whole side's). */
  units?: number[];
  /** A structure or a unit, by the battle's own numbering. */
  target?: number;
}

/** An order as stamped: its place in the session's log, the step it applies at, and whose it is. */
export interface LiveOrder extends LiveOrderIn {
  seq: number;
  step: number;
  side: LiveSide;
}

/**
 * What the room keeps of a finished battle: enough to run it again (the defender's input and the
 * orders stamped in it), and how it ended. Versioned; the pages turn it into a battle input.
 */
export interface LiveRecord {
  v: 1;
  id: string;
  /** The attacker's and the defender's slots. */
  from: number;
  to: number;
  /** The defender's battle input, in the parts it came in. */
  input: string[];
  orders: LiveOrder[];
  end: LiveEnd;
}

/** How a battle ended: the step and `hash()` both pages reported, and whether they agree. */
export interface LiveEnd {
  step: number;
  hash: string;
  agree: boolean;
  /** Only one combatant reported (the other was handed over): nothing to compare it with. */
  solo?: true;
  /** Nobody spoke for a minute: the record is the input and the orders so far. */
  abandoned?: true;
}

const KIND = /^[a-z]{2,16}$/;

const whole = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * An order's shape, or null: a kind in lower case, whole-number units and target (a unit's id may be
 * negative: the defender's `focus` on a drone a sky fortress carries). Other keys are dropped.
 */
export function cleanLiveOrder(o: unknown): LiveOrderIn | null {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (typeof r.kind !== 'string' || !KIND.test(r.kind)) return null;
  const out: LiveOrderIn = { kind: r.kind };
  if (r.units !== undefined) {
    if (!Array.isArray(r.units) || r.units.length > LIVE.units) return null;
    for (const u of r.units) if (!whole(u, -1e6, 1e6)) return null;
    out.units = [...(r.units as number[])];
  }
  if (r.target !== undefined) {
    if (!whole(r.target, -1e6, 1e6)) return null;
    out.target = r.target;
  }
  return out;
}

/** Does a JSON value stay within `limit` levels (for the opaque force a call carries)? */
export function withinDepth(v: unknown, limit = 12, depth = 0): boolean {
  if (depth > limit) return false;
  if (Array.isArray(v)) return v.every((x) => withinDepth(x, limit, depth + 1));
  if (v && typeof v === 'object') return Object.values(v).every((x) => withinDepth(x, limit, depth + 1));
  return true;
}

interface SideState {
  slot: number;
  /** Steps its page has run, as it last said (never past the frontier). */
  step: number;
  /** When it last spoke in this battle (ms). */
  heard: number;
  /** Handed over to the battle's own judgement. */
  handed: boolean;
  /** Handed over, but its page has spoken since (it's slow, or on its way back): its steps count again. */
  back: boolean;
  /** Its page reached the battle's end. */
  done?: { step: number; hash: string };
}

export class LiveSession {
  state: 'calling' | 'running' = 'calling';
  /** The defender's battle input, as it sent it. */
  input: string[] = [];
  /** Pages may run steps below this. */
  allow = 0;
  /** Stamped orders, in the order they were stamped (`seq` from 1). */
  readonly orders: LiveOrder[] = [];
  readonly sides: [SideState, SideState];

  constructor(
    readonly id: string,
    readonly from: number,
    readonly to: number,
    /** The attacker's force, as it sent it (the defender builds the battle round it). */
    readonly force: unknown,
    /** The battle brings a superweapon (counted in the target's day). */
    readonly superweapon: boolean,
    /** When the call was made (ms). */
    readonly called: number,
  ) {
    const side = (slot: number): SideState => ({ slot, step: 0, heard: called, handed: false, back: false });
    this.sides = [side(from), side(to)];
  }

  /** Which side a city is on, or -1. */
  sideOf(slot: number): LiveSide | -1 {
    return this.sides[0].slot === slot ? 0 : this.sides[1].slot === slot ? 1 : -1;
  }

  /** The defender's input is in: the battle begins, both sides at step 0. */
  start(input: string[], now: number): void {
    this.state = 'running';
    this.input = input;
    this.allow = LIVE.lead;
    for (const s of this.sides) {
      s.step = 0;
      s.heard = now;
    }
  }

  /** Is a side's page holding the frontier back? Not once it's done, nor while it's handed over and quiet. */
  private pacing(s: SideState, now: number): boolean {
    return !s.done && (!s.handed || (s.back && now - s.heard < LIVE.silent));
  }

  /** A handed-over side that has said nothing since (and isn't finishing): the battle goes on without it. */
  private gone(s: SideState, now: number): boolean {
    return s.handed && !s.done && !this.pacing(s, now);
  }

  /** A combatant's progress: how many steps its page has run. */
  report(i: LiveSide, step: number, now: number): void {
    const s = this.sides[i];
    s.heard = now;
    if (s.handed) s.back = true;
    s.step = Math.max(s.step, Math.min(step, this.allow));
  }

  /** Move the frontier to the slowest page's step plus the lead; true if it moved (never back). */
  pace(now: number): boolean {
    const racing = this.sides.filter((s) => this.pacing(s, now));
    if (!racing.length) return false;
    const next = Math.min(...racing.map((s) => s.step)) + LIVE.lead;
    if (next <= this.allow) return false;
    this.allow = next;
    return true;
  }

  private at(step: number, side: LiveSide): number {
    let n = 0;
    for (const o of this.orders) if (o.step === step && o.side === side) n++;
    return n;
  }

  /**
   * Stamp a combatant's orders at the frontier, in the order they came. What can't be stamped is
   * said in `refused` (the rest of the message with it).
   */
  stamp(i: LiveSide, list: LiveOrderIn[]): { stamped: LiveOrder[]; refused: string | null } {
    const s = this.sides[i];
    if (this.state !== 'running') return { stamped: [], refused: 'That battle hasn’t started' };
    if (s.handed)
      return { stamped: [], refused: 'Your forces are fighting on their own now: rejoin to command them' };
    if (s.done) return { stamped: [], refused: 'Your battle is over' };
    const stamped: LiveOrder[] = [];
    for (const o of list) {
      if (this.orders.length >= LIVE.maxOrders - LIVE.reserve)
        return { stamped, refused: 'This battle takes no more orders' };
      if (this.at(this.allow, i) >= LIVE.perStep)
        return { stamped, refused: 'Too many orders at once: give the rest in a moment' };
      const order: LiveOrder = { ...o, seq: this.orders.length + 1, step: this.allow, side: i };
      this.orders.push(order);
      stamped.push(order);
    }
    return { stamped, refused: null };
  }

  /** Sides to hand over for silence now. */
  quiet(now: number): LiveSide[] {
    const out: LiveSide[] = [];
    for (const i of [0, 1] as const) {
      const s = this.sides[i];
      if (!s.handed && !s.done && now - s.heard >= LIVE.silent) out.push(i);
    }
    return out;
  }

  /**
   * A side is handed over: the room stamps a `free` for it at the frontier (a step on if that side's
   * orders there are full) so its units go back to the battle's own judgement. Null when the log has
   * no room left (the side is handed over all the same).
   */
  handover(i: LiveSide): LiveOrder | null {
    const s = this.sides[i];
    if (s.handed) return null;
    s.handed = true;
    s.back = false;
    if (this.orders.length >= LIVE.maxOrders) return null;
    const step = this.at(this.allow, i) >= LIVE.perStep ? this.allow + 1 : this.allow;
    const order: LiveOrder = { kind: 'free', seq: this.orders.length + 1, step, side: i };
    this.orders.push(order);
    return order;
  }

  /** A handed-over combatant is back (its page starts the battle again from the input): in command. */
  rejoin(i: LiveSide, now: number): void {
    const s = this.sides[i];
    s.handed = false;
    s.back = false;
    s.step = 0;
    s.heard = now;
    delete s.done;
  }

  /** A combatant's page reached the battle's end. */
  finish(i: LiveSide, step: number, hash: string, now: number): void {
    const s = this.sides[i];
    s.heard = now;
    s.done = { step, hash };
  }

  /**
   * How it ends, once every combatant has either reported the end or been left behind (and one has
   * reported): the defender's step and hash stand (its run is the truth for its city), and whether
   * the two agree when both reported.
   */
  ending(now: number): LiveEnd | null {
    const [a, d] = this.sides;
    const settled = (s: SideState) => !!s.done || this.gone(s, now);
    if (!settled(a) || !settled(d) || (!a.done && !d.done)) return null;
    const both = !!a.done && !!d.done;
    const mine = (d.done ?? a.done)!;
    return {
      step: mine.step,
      hash: mine.hash,
      agree: both ? a.done!.step === d.done!.step && a.done!.hash === d.done!.hash : true,
      ...(both ? {} : { solo: true as const }),
    };
  }

  /** Has nobody spoken for the abandon time? */
  abandoned(now: number): boolean {
    return now - Math.max(this.sides[0].heard, this.sides[1].heard) >= LIVE.abandon;
  }

  /** How far either page got. */
  get furthest(): number {
    return Math.max(this.sides[0].step, this.sides[1].step);
  }

  /** The sides handed over now. */
  handed(): LiveSide[] {
    return ([0, 1] as const).filter((i) => this.sides[i].handed);
  }
}
