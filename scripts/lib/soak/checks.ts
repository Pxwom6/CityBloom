import { MAX_CITIES, REGION_LIMITS, type MemoryRegionStore } from '../../../relay/region';
import type { FriendsState } from '../../../relay/friendsWar';
import type { FriendWar, WarEvent } from '../../../relay/protocol';
import type { Command, CommandResult } from '../../../src/sim/commands';
import type { Sim } from '../../../src/sim/sim';
import type { BattleLog, Cover, SoakOptions } from './types';
import type { Player, Soak } from './world';

/**
 * What the soak watches (M39 step 10): every live battle's two runs and the room's verdict on them,
 * every battle taken once by its defender and reported once by its attacker, the cities' invariants,
 * the region's wars, pacts and vassals as the room keeps them against what each page and sim shows,
 * and what the room costs against Cloudflare's free plan. The verdict is in `verdict()`; the story
 * (`story.ts`) and the world (`world.ts`) only make things happen.
 */

type Meta = { friends?: FriendsState; history?: WarEvent[] };

/** What a city looked like just before a command, for those whose effect is checked (`Soak.patch` makes it). */
export interface Before {
  /** The month's ledger lines, a copy. */
  lines: Record<string, number>;
  /** Pacts the city's diplomacy held. */
  pacts: number;
  /** The live battle the city was hosting, and what it had already taken (buildings that fell, civic buildings wrecked). */
  hosted?: { id: string; collapsed: number[]; wrecked: number[] };
}

export function before(sim: Sim): Before {
  const w = sim.state.war;
  const hb = w?.battle;
  return {
    lines: { ...sim.state.economy.month },
    pacts: w?.diplomacy?.pacts.length ?? 0,
    ...(hb?.live
      ? {
          hosted: {
            id: hb.live.id,
            collapsed: [...hb.report.collapsed],
            wrecked: hb.report.civics.filter((c) => c.wrecked).map((c) => c.id),
          },
        }
      : {}),
  };
}

/** The free plan's daily limits (SPEC-4): requests, GB-s of duration, rows written, rows read. */
export const FREE_PLAN = { requests: 100_000, gbs: 13_000, rowsWritten: 100_000, rowsRead: 5_000_000 };
/** A Durable Object's memory in GB (128 MB): it is billed for as long as it is awake. */
const GB = 0.125;
/** An evening of play, hours: what the budget is judged for. */
const EVENING = 4;

export interface BudgetReport {
  hours: number;
  rows: number;
  messages: number;
  bytes: number;
  requests: number;
  gbs: number;
  /** Per hour of this play. */
  perHour: { rows: number; requests: number; gbs: number; messages: number };
  /** Hours of such play a day the plan carries across all rooms, by limit. */
  carries: { rows: number; requests: number; gbs: number; regionRows: number };
  /** The region's own daily row budget, and how much of it an evening of this play would take. */
  eveningShare: { rows: number; regionRows: number; requests: number; gbs: number };
  ok: boolean;
  lines: string[];
}

export class Checks {
  readonly battles = new Map<string, BattleLog>();
  readonly simEvents = new Map<string, number>();
  readonly history = new Map<number, WarEvent>();
  readonly pactsSeen = new Set<number>();
  readonly notices: string[] = [];
  private resolved = new Map<string, number>();
  readonly reported = new Map<string, number>();
  /** The ticket (`Soak.ticket`) of each application last made, by the key it is counted under. */
  private lastAt = new Map<string, number>();
  /** Forces the cities sent (name:expedition), and the forces called home. */
  readonly sent = new Map<string, { player: string; id: number; stamp: number }>();
  private recalled = new Set<string>();
  /** Was this force (name:expedition) called home, as a battle the region turned away leaves it? */
  wasRecalled(key: string): boolean {
    return this.recalled.has(key);
  }
  /** Treaties the room signed (found in its queues, or applied by a city), and the cities that applied each. */
  private treaties = new Map<string, { parties: [number, number]; appliedBy: Set<number> }>();
  /** Sides of live battles the room has handed over to their defences (battle:side). */
  private handed = new Set<string>();
  /** When (room ms) each battle row was stored for a city. */
  private rowAt = new Map<string, number>();
  /** Takes and reports the run excuses, and why (a battle the room ended with no one finishing it, a crash's loss). */
  readonly excused: string[] = [];
  /** Applications made again because a restore from an older save had lost the first. */
  rewinds = 0;
  /** Battles each defender took (any way), by name:id; and each attacker's reports by name:expedition. */
  readonly taken = new Map<string, string>();
  private pending = new Map<string, number>();
  private rows0 = 0;
  private begun = 0;
  private lastProgress = 0;
  private lastInvariants = 0;
  /** When (wall clock) each link was last in the region: its reconnecting runs on the wall clock in both modes. */
  private lastLink = new Map<string, number>();
  private warOpened = new Set<number>();
  /** Messages the room refused for the rate (the page's link saw the connection closed). */
  closedByRoom = 0;
  /** Records of live battles that stood in for the one the city was hosting, and what each took on top of the hosted part. */
  standIns = 0;
  readonly standInDamage: { id: string; player: string; buildings: number; wrecked: number }[] = [];

  constructor(private readonly w: Soak) {}

  private get meta(): Meta {
    return ((this.w.room as unknown as { meta: Meta | null }).meta ?? {}) as Meta;
  }
  private get store(): MemoryRegionStore {
    return (this.w.room as unknown as { store: MemoryRegionStore }).store;
  }

  begin(): void {
    this.begun = this.w.now();
    this.lastProgress = this.begun;
    this.lastInvariants = this.begun;
    this.rows0 = this.store.rowsWritten;
    this.countRows();
    for (const p of this.w.players) p.retired = { messages: 0, bytes: 0 };
    for (const p of this.w.players) if (p.page) p.page.link.sent = { messages: 0, bytes: 0 };
    this.harvest();
  }

  // ---------------------------------------------------------------- what the pages tell

  /** Rows the room writes, by what they are for (the store counts them as a Durable Object's SQLite does). */
  readonly rowKinds = new Map<string, number>();
  private countRows(): void {
    const st = this.store;
    const count = (kind: string, run: () => void): void => {
      const before = st.rowsWritten;
      run();
      this.rowKinds.set(kind, (this.rowKinds.get(kind) ?? 0) + st.rowsWritten - before);
    };
    const meta = st.saveMeta.bind(st);
    st.saveMeta = (m) => count('the region record', () => meta(m));
    const city = st.saveCity.bind(st);
    st.saveCity = (slot, parts) => count('city saves for visitors', () => city(slot, parts));
    const battle = st.saveBattle.bind(st);
    st.saveBattle = (slot, k, parts) => {
      if (slot <= MAX_CITIES) this.rowAt.set(`${slot}:${k}`, this.w.now());
      count(slot > MAX_CITIES ? 'replays of live battles' : 'battles waiting for a city', () =>
        battle(slot, k, parts),
      );
    };
    const gone = st.deleteBattle.bind(st);
    st.deleteBattle = (slot, k) => count('battle rows deleted', () => gone(slot, k));
  }

  linkNotice(p: Player, text: string): void {
    this.notices.push(`${p.name}: ${text}`);
    if (this.notices.length > 400) this.notices.shift();
  }

  /** The sim's events of a frame, counted. */
  events(_p: Player, events: readonly { kind: string }[]): void {
    for (const e of events) this.simEvents.set(e.kind, (this.simEvents.get(e.kind) ?? 0) + 1);
  }

  /**
   * Was the player's city loaded again from a save older than `since` (a ticket), after it? What it did at
   * `since` is then gone from it (a crash does this: the page dies and comes back from its last autosave; a
   * reload or a return saves first, so it never does).
   */
  rewoundSince(p: Pick<Player, 'restores'>, since: number): boolean {
    return p.restores.some((r) => r.n > since && r.fromN < since);
  }

  /**
   * A command the city was asked to apply, and whether it did: a battle taken or a force's report twice is
   * a failure, unless a restore from an older save between the two lost the first (the soak's own crash).
   * `hosted` is the live battle the city was hosting when the command came, `was` the city's look before it,
   * `sim` the one that took the command (a page that has been replaced may still finish a command).
   */
  applied(
    p: Player,
    gen: number,
    cmd: Command,
    r: CommandResult,
    hosted?: string,
    was?: Before,
    sim: Sim = p.sim,
  ): void {
    const now = this.w.ticket();
    if (cmd.type === 'battleResolve' && r.ok) {
      const id = cmd.input.id;
      const key = `${p.name}:${id}`;
      const n = (this.resolved.get(key) ?? 0) + 1;
      this.resolved.set(key, n);
      const prev = this.lastAt.get(key);
      this.lastAt.set(key, now);
      this.taken.set(
        key,
        `${cmd.mode}${cmd.from !== undefined ? ` from ${cmd.from}` : ''} (generation ${gen})`,
      );
      // The record of a live battle this very city was hosting stands in for it (design: a reload, a crash
      // that took the end of the hosted battle with it, or a page that lost the room): the second application
      // is the first one finished. That is so only for a city that was loaded again since it began hosting the
      // battle, or whose player had a bad moment in it; anyone else taking a battle it is hosting has been
      // handed it twice.
      const standsIn = n > 1 && cmd.mode === 'instant' && hosted === id;
      if (standsIn) this.standIn(p, id, prev, was, sim);
      else if (cmd.mode !== 'live') this.w.covered('oldBattles');
      if (n > 1 && !standsIn) {
        if (prev !== undefined && this.rewoundSince(p, prev)) {
          this.rewinds++;
          this.w.note(
            `${p.name}'s city takes ${id} again: it came back from a save older than the first time`,
          );
        } else
          this.w.fail(
            'applied-twice',
            `${p.name}'s city took battle ${id} ${n} times (this one ${cmd.mode}, generation ${gen}) and was not restored from an older save in between`,
          );
      }
    } else if (cmd.type === 'sendForce' && r.ok) {
      const id = r.created?.[0];
      if (id !== undefined) this.sent.set(`${p.name}:${id}`, { player: p.name, id, stamp: now });
    } else if (cmd.type === 'recallForce' && r.ok) {
      this.w.covered('recalled');
      this.recalled.add(`${p.name}:${cmd.expedition}`);
      this.w.note(`${p.name}'s force ${cmd.expedition} is called home (the battle was turned away)`);
    } else if (cmd.type === 'battleReport' && r.ok) {
      const key = `${p.name}:${cmd.expedition}`;
      const n = (this.reported.get(key) ?? 0) + 1;
      this.reported.set(key, n);
      const prev = this.lastAt.get(`report:${key}`);
      this.lastAt.set(`report:${key}`, now);
      if (n > 1) {
        if (prev !== undefined && this.rewoundSince(p, prev)) {
          this.rewinds++;
          this.w.note(
            `${p.name}'s city takes the report of its force ${cmd.expedition} again: it came back from a save older than the first time`,
          );
        } else
          this.w.fail(
            'reported-twice',
            `${p.name}'s city took the report of its force ${cmd.expedition} ${n} times (generation ${gen}) and was not restored from an older save in between`,
          );
      }
    } else if (cmd.type === 'friendTreaty' && r.ok) this.treatyApplied(p, cmd, was, sim);
  }

  /**
   * A record standing in for the hosted part of a live battle: allowed for a player who was disturbed in it or
   * whose city was loaded again since it began hosting it; what it took is measured.
   */
  private standIn(p: Player, id: string, prev: number | undefined, was: Before | undefined, sim: Sim): void {
    const disturbed = this.battles.get(id)?.disturbed.some((d) => d.name === p.name);
    const loadedAgain = prev !== undefined && p.restores.some((r) => r.n > prev);
    if (!disturbed && !loadedAgain) {
      this.w.fail(
        'applied-twice',
        `${p.name}'s city took the record of ${id} in place of the battle it was hosting, and neither was its player disturbed in that battle nor was the city loaded again since it began hosting it`,
      );
      return;
    }
    this.standIns++;
    // What the record took on top of the hosted part: a building or civic structure the hosted part had
    // already taken must not be taken again, and the battle's own report says which fell.
    const done = sim.state.war?.reports?.at(-1);
    const hosted = was?.hosted?.id === id ? was.hosted : undefined;
    const again =
      hosted && done
        ? {
            buildings: done.collapsed.filter((x) => hosted.collapsed.includes(x)).length,
            wrecked: done.civics.filter((c) => c.wrecked && hosted.wrecked.includes(c.id)).length,
          }
        : { buildings: 0, wrecked: 0 };
    this.standInDamage.push({ id, player: p.name, ...again });
    this.w.note(
      `${p.name}'s city takes the record of ${id} in place of the battle it was hosting` +
        (hosted
          ? ` (the hosted part had taken ${hosted.collapsed.length} buildings and wrecked ${hosted.wrecked.length}; the record took ${done?.collapsed.length ?? '?'} and wrecked ${done?.civics.filter((c) => c.wrecked).length ?? '?'}, ${again.buildings + again.wrecked} of them the same ones)`
          : ''),
    );
    if (again.buildings + again.wrecked > 0)
      this.w.fail(
        'damage-doubled',
        `${p.name}'s city took ${again.buildings} buildings and wrecked ${again.wrecked} civic structures in the record of ${id} that the hosted part of the same battle had taken already`,
      );
  }

  /**
   * A treaty a city applied: it is on the city's list of what it has taken, the money it carried reached the
   * ledger of this side (reparations as paid or received, a tribute as a pact), and the treaty is noted
   * so that it can be asked, at the end, whether both its cities took it.
   */
  private treatyApplied(
    p: Player,
    cmd: Extract<Command, { type: 'friendTreaty' }>,
    was: Before | undefined,
    sim: Sim,
  ): void {
    const key = `${cmd.slot}:treaty:${cmd.id}`;
    const w = sim.state.war;
    if (!w?.taken?.includes(key))
      this.w.fail(
        'treaty-not-applied',
        `${p.name}'s city said yes to treaty ${cmd.id} and did not put it on the list of the treaties it has taken`,
      );
    this.treaty(cmd.id, [p.slot, cmd.slot]).appliedBy.add(p.slot);
    if (!was) return;
    // The terms as this side reads them: the proposer's are written from its side, the other's are turned round.
    let out = 0;
    let inn = 0;
    let tributes = 0;
    let money = 0;
    for (const t of cmd.terms as { k: string; payer?: string; amount?: number }[]) {
      if (t.k === 'tribute') tributes++;
      if (t.k !== 'reparations' || typeof t.amount !== 'number') continue;
      money++;
      const pays = cmd.side === 'a' ? t.payer === 'us' : t.payer === 'them';
      if (pays) out -= t.amount;
      else inn += t.amount;
    }
    const now = sim.state.economy.month;
    const gotOut = (now.reparationsOut ?? 0) - (was.lines.reparationsOut ?? 0);
    const gotIn = (now.reparationsIn ?? 0) - (was.lines.reparationsIn ?? 0);
    // (Whole dollars are booked and the part of a dollar carried, so a term can be a dollar out.)
    if (Math.abs(gotOut - out) > money || Math.abs(gotIn - inn) > money)
      this.w.fail(
        'treaty-money',
        `${p.name}'s city took treaty ${cmd.id}: its ledger shows ${gotOut} paid out and ${gotIn} received in reparations, the terms say ${out} and ${inn}`,
      );
    const pacts = (w?.diplomacy?.pacts.length ?? 0) - was.pacts;
    if (pacts !== tributes)
      this.w.fail(
        'treaty-money',
        `${p.name}'s city took treaty ${cmd.id}: ${tributes} tribute terms made ${pacts} pacts in its diplomacy`,
      );
  }

  private treaty(id: string, parties: [number, number]) {
    let t = this.treaties.get(id);
    if (!t) this.treaties.set(id, (t = { parties, appliedBy: new Set() }));
    return t;
  }

  /** A player dropped, left or reloaded: every battle of theirs that is on is marked, so what it does to it is explained. */
  disturb(p: Player, what: string): void {
    for (const b of this.battles.values())
      if (!this.over(b) && (b.attacker === p.slot || b.defender === p.slot)) {
        if (!b.disturbed.length) this.w.covered('disturbedBattles');
        b.disturbed.push({ name: p.name, what, at: this.w.now() });
      }
  }

  /** Is anything waiting for this city, which a settled page would have taken (a treaty not yet seen, a battle kept for it)? */
  waitingFor(p: Player): boolean {
    if (!p.page) return false;
    if ((this.meta.friends?.queue[p.slot] ?? []).length) return true;
    for (const key of this.store.battles.keys()) if (key.startsWith(`${p.slot}:`)) return true;
    return false;
  }

  private over(b: BattleLog): boolean {
    for (const v of b.views.values()) if (v.state.hashes.room) return true;
    return false;
  }

  // ---------------------------------------------------------------- every frame and second

  frame(): void {
    const now = this.w.now();
    // The room hands a combatant's side to its defences when the combatant falls silent or its last connection
    // goes: counted from the room's own sessions (a page that was away does not see it happen).
    const lives = (
      this.w.room as unknown as { lives?: Map<string, { s: { id: string; handed(): number[] } }> }
    ).lives;
    for (const r of lives?.values() ?? [])
      for (const side of r.s.handed()) {
        const key = `${r.s.id}:${side}`;
        if (this.handed.has(key)) continue;
        this.handed.add(key);
        this.w.covered('handovers');
        this.w.note(`the room hands side ${side} of ${r.s.id} over to its defences`);
      }
    for (const p of this.w.players) {
      const st = p.page?.live.state();
      if (!st) continue;
      let b = this.battles.get(st.id);
      if (!b) {
        b = {
          id: st.id,
          attacker: st.attacker,
          defender: st.defender,
          attackerName: this.w.bySlot(st.attacker)?.name ?? `city ${st.attacker}`,
          defenderName: this.w.bySlot(st.defender)?.name ?? `city ${st.defender}`,
          began: now,
          lastSeen: now,
          views: new Map(),
          disturbed: [],
          orders: { attacker: 0, defender: 0 },
          helpedBy: [],
        };
        this.battles.set(st.id, b);
        this.w.onBattle?.(b);
        this.w.covered('liveBattles');
        this.w.note(`live battle ${st.id}: ${b.attackerName} attacks ${b.defenderName}`);
      }
      const had = b.views.get(p.slot);
      b.views.set(p.slot, { slot: p.slot, role: st.role, state: st, seen: now });
      if (!st.ended) b.lastSeen = now;
      if (st.handed && !had?.state.handed)
        this.w.note(`${p.name}'s side of ${st.id} is handed over to its defences`);
      if (st.ended && !had?.state.ended)
        this.w.note(`${p.name}'s run of ${st.id} ended at step ${st.hashes.mine?.step}`);
      if (st.hashes.room && !had?.state.hashes.room)
        this.w.note(
          `the room's verdict on ${st.id}: ${st.hashes.room.agree ? 'agree' : 'DISAGREE'}${st.hashes.room.solo ? ' (solo)' : ''}${st.hashes.room.abandoned ? ' (abandoned)' : ''}`,
        );
    }
  }

  second(): void {
    const w = this.w;
    const now = w.now();
    this.harvest();
    this.queueSeen();
    this.consistency();
    this.links();
    this.dues();
    this.forces();
    this.rate(now);
    // The cities' invariants (the sims check them every tick in test mode, so a break has thrown already).
    if (now - this.lastInvariants >= 30_000) {
      this.lastInvariants = now;
      w.invariants();
    }
    if (now - this.lastProgress >= 5 * 60_000) {
      this.lastProgress = now;
      w.note(this.progress());
      w.opts.onProgress?.(w);
    }
  }

  private progress(): string {
    const w = this.w;
    const live = [...this.battles.values()].filter((b) => !this.over(b)).length;
    const messages = w.players.reduce((n, p) => n + p.sent.messages, 0);
    const ticks = w.players.map((p) => `${p.name}:${p.page ? p.sim.state.tick : 'away'}`).join(' ');
    return `progress: ${this.battles.size} live battles (${live} on), ${w.cover.raids} raids, ${w.cover.orders} orders, ${messages} messages, ${this.store.rowsWritten - this.rows0} rows, ${w.failures.length} failures; ticks ${ticks}`;
  }

  /** The room's war history and pacts, read as they come (the room keeps the last hundred events). */
  private harvest(): void {
    const w = this.w;
    const m = this.meta;
    for (const e of m.history ?? []) {
      if (this.history.has(e.id)) {
        // An event with an id seen again replaces the first (a battle gains its outcome).
        if (e.outcome && !this.history.get(e.id)!.outcome) w.note(`region: ${e.text}`);
        this.history.set(e.id, e);
        continue;
      }
      this.history.set(e.id, e);
      const k = e.kind;
      if (k === 'declared') w.covered('declared');
      else if (k === 'opened') w.covered('warsOpened');
      else if (k === 'treaty') w.covered('treaties');
      else if (k === 'capitulated') w.covered('capitulations');
      else if (k === 'vassal') w.covered('conquests');
      else if (k === 'freed') w.covered('freed');
      if (k !== 'battle') w.note(`region: ${e.text}`);
    }
    for (const p of m.friends?.pacts ?? []) {
      if (this.pactsSeen.has(p.id)) continue;
      this.pactsSeen.add(p.id);
      w.covered('pacts');
    }
    for (const x of m.friends?.wars ?? []) if (x.state === 'open') this.warOpened.add(x.id);
  }

  /** The treaties waiting in the room's queues for a city to say it has seen them: every treaty signed shows there until then. */
  private queueSeen(): void {
    for (const q of Object.values(this.meta.friends?.queue ?? {}))
      for (const t of q) this.treaty(t.id, [t.a, t.b]);
  }

  /** Each city's forces out, by name:id, and the state they were last seen in (a change is noted). */
  private seenForces = new Map<string, string>();
  private forces(): void {
    const seen = new Set<string>();
    for (const p of this.w.players) {
      if (!p.page) continue;
      for (const e of p.sim.state.war?.expeditions ?? []) {
        const key = `${p.name}:${e.id}`;
        seen.add(key);
        const was = this.seenForces.get(key);
        const now = `${e.state}${e.settling ? ' (with the region)' : ''}`;
        if (was !== now) {
          this.seenForces.set(key, now);
          this.w.note(`${p.name}'s force ${e.id} (${e.name}${e.help ? ', help' : ''}) is ${now}`);
        }
      }
    }
    for (const key of [...this.seenForces.keys()])
      if (!seen.has(key) && this.w.players.find((p) => key.startsWith(`${p.name}:`))?.page) {
        this.seenForces.delete(key);
        this.w.note(`${key.replace(':', "'s force ")} is home`);
      }
  }

  /** The lowest the message allowance of any connection has been (tokens; the room drops a message at under one). */
  rateMin = Infinity;
  /**
   * Each connection may send two messages a second after a burst of sixty (F8); a connection under one token
   * has had messages dropped. The room's own buckets are read: nothing is asked of the pages.
   */
  private rate(now: number): void {
    const conns = (
      this.w.room as unknown as { conns: Map<unknown, { slot: number; all: { has(n: number): boolean } }> }
    ).conns;
    for (const st of conns.values()) {
      st.all.has(now);
      const tokens = (st.all as unknown as { tokens: number }).tokens;
      if (tokens < this.rateMin) this.rateMin = tokens;
      if (tokens < 1)
        this.w.fail(
          'rate',
          `city ${st.slot}'s connection ran out of its message allowance (2 a second): the room drops what it sends`,
        );
    }
  }

  /** A vassal's dues reach the overlord's ledger at a month's close. */
  private dues(): void {
    for (const p of this.w.players) {
      if (!p.page) continue;
      const h = p.sim.state.economy.history;
      if (h.length === p.lastMonthLine) continue;
      p.lastMonthLine = h.length;
      const v = h.at(-1)?.lines.vassals ?? 0;
      if (v > 0) {
        this.w.covered('vassalDues');
        this.w.note(`${p.name}'s ledger: $${v} from its vassal this month`);
      }
    }
  }

  /** A link the room closed for good, or one that stayed down: a page that cannot be in the region. */
  private links(): void {
    const now = performance.now();
    for (const p of this.w.players) {
      const pg = p.page;
      if (!pg?.ticking) continue;
      const st = pg.link.state;
      if (st === 'closed') {
        this.closedByRoom++;
        this.w.fail('link', `${p.name}'s link to the region closed: ${pg.link.error ?? 'no reason'}`);
        pg.ticking = false;
      } else if (st === 'in' || p.offline) this.lastLink.set(p.name, now);
      else if (now - (this.lastLink.get(p.name) ?? now) > 60_000)
        this.w.fail('link', `${p.name}'s link has been ${st} for more than a minute with no outage`);
    }
  }

  // ---------------------------------------------------------------- the region's view

  /**
   * The region as the room keeps it against what each page and its sim show. A difference is a problem
   * only if it stays (messages are in flight for a moment, and a page that has just come back is catching up).
   */
  private consistency(): void {
    const w = this.w;
    const now = w.now();
    const fs = this.meta.friends;
    const problems: string[] = [];
    const roomWars = (fs?.wars ?? []).filter((x) => x.state !== 'ended');
    const settled = (p: Player) => p.up && now - p.upSince > 20_000;
    const word = (x: FriendWar) => `${x.state}${x.scale}`;
    for (const p of w.players) {
      if (!settled(p) || !p.page) continue;
      const v = p.page.fw.view();
      const mine = roomWars.filter((x) => x.a === p.slot || x.b === p.slot);
      for (const x of mine) {
        const y = v.wars.find((z) => z.id === x.id);
        if (!y) problems.push(`${p.name}'s page has no war ${x.id} (${word(x)}) that the room keeps`);
        else {
          if (y.state !== x.state)
            problems.push(`${p.name}'s page: war ${x.id} is ${y.state}, the room says ${x.state}`);
          if (!x.hold && !y.hold && Math.abs(y.score - x.score) > 0.05)
            problems.push(`${p.name}'s page: war ${x.id} score ${y.score}, the room says ${x.score}`);
          if (!!x.hold !== !!y.hold)
            problems.push(`${p.name}'s page: war ${x.id} hold ${!!y.hold}, the room says ${!!x.hold}`);
        }
        // The city's sim mirrors it.
        const other = x.a === p.slot ? x.b : x.a;
        const mirror = p.sim.state.war?.diplomacy?.wars.find((m) => m.friend?.slot === other);
        if (!mirror) problems.push(`${p.name}'s city has no mirror of war ${x.id}`);
        else if (mirror.friend!.room !== x.id || mirror.friend!.state !== x.state)
          problems.push(
            `${p.name}'s city: war ${x.id} is ${mirror.friend!.room === x.id ? mirror.friend!.state : `another war (${mirror.friend!.room})`}, the room says ${x.state}`,
          );
      }
      // (A page keeps the wars of other cities too, as its welcome listed them, and hears no more of them: they mean nothing to it.)
      for (const y of v.wars)
        if (y.state !== 'ended' && (y.a === p.slot || y.b === p.slot) && !mine.some((x) => x.id === y.id))
          problems.push(`${p.name}'s page shows war ${y.id} (${y.state}) that the room does not keep`);
      for (const m of p.sim.state.war?.diplomacy?.wars ?? [])
        if (m.friend && !mine.some((x) => x.id === m.friend!.room))
          problems.push(`${p.name}'s city mirrors war ${m.friend.room} that the room does not keep`);
      // Pacts and vassals are told to everyone.
      const pacts = (fs?.pacts ?? []).map((x) => `${x.id}:${x.kind}:${x.a}-${x.b}`).sort();
      const seen = v.pacts.map((x) => `${x.id}:${x.kind}:${x.a}-${x.b}`).sort();
      if (pacts.join() !== seen.join())
        problems.push(`${p.name}'s page lists pacts [${seen}], the room [${pacts}]`);
      const vas = (fs?.vassals ?? []).map((x) => `${x.vassal}>${x.overlord}`).sort();
      const vseen = v.vassals.map((x) => `${x.vassal}>${x.overlord}`).sort();
      if (vas.join() !== vseen.join())
        problems.push(`${p.name}'s page lists vassals [${vseen}], the room [${vas}]`);
      // The latest of the region's war history reached it (every page is told each event as it happens).
      const mineIds = new Set(v.history.map((e) => e.id));
      for (const e of (this.meta.history ?? []).slice(-8))
        if (!mineIds.has(e.id))
          problems.push(`${p.name}'s page has not heard of event ${e.id} (${e.kind}: ${e.text})`);
      // The city's own mirror of the pacts (the sim's, by the region's number): what the page shows is only
      // the room's message echoed, the city is what the game plays on.
      const slotOf = (neighbour: number) =>
        p.sim.state.region.neighbours.find((n) => n.id === neighbour)?.player?.slot ?? 0;
      const kept = (fs?.pacts ?? [])
        .filter((x) => x.a === p.slot || x.b === p.slot)
        .map((x) => `${x.id}:${x.kind}:${x.a === p.slot ? x.b : x.a}`)
        .sort();
      const mirrored = (p.sim.state.war?.diplomacy?.pacts ?? [])
        .filter((x) => x.room !== undefined)
        .map((x) => `${x.room}:${x.term.k}:${slotOf(x.with)}`)
        .sort();
      if (kept.join() !== mirrored.join())
        problems.push(
          `${p.name}'s city holds pacts [${mirrored}], the room [${kept}] (number:kind:the other city)`,
        );
      // And the vassals that pay it: the room's list of those whose overlord this city is.
      const subjects = (fs?.vassals ?? [])
        .filter((x) => x.overlord === p.slot)
        .map((x) => x.vassal)
        .sort();
      const held = (p.sim.state.war?.diplomacy?.subjects ?? []).map((x) => slotOf(x.with)).sort();
      if (subjects.join() !== held.join())
        problems.push(`${p.name}'s city has vassals [${held}], the room says [${subjects}]`);
      // Its own city: a vassal's overlord, from the room's list.
      const link = (fs?.vassals ?? []).find((x) => x.vassal === p.slot);
      const dv = p.sim.state.war?.diplomacy?.vassal;
      const overlord = dv
        ? p.sim.state.region.neighbours.find((n) => n.id === dv.overlord)?.player?.slot
        : undefined;
      if (link?.overlord !== overlord)
        problems.push(
          `${p.name}'s city has ${overlord ? `city ${overlord}` : 'no one'} for an overlord, the room says ${link ? `city ${link.overlord}` : 'no one'}`,
        );
    }
    const next = new Map<string, number>();
    for (const t of problems) {
      const first = this.pending.get(t) ?? now;
      next.set(t, first);
      if (now - first > 25_000) w.fail('region', t);
    }
    this.pending = next;
  }

  // ---------------------------------------------------------------- the end

  /** The room's verdict on a live battle, from whichever page heard it. */
  private verdict(b: BattleLog) {
    return b.views.get(b.attacker)?.state.hashes.room ?? b.views.get(b.defender)?.state.hashes.room ?? null;
  }

  private excuse(text: string): void {
    this.excused.push(text);
    this.w.note(`excused: ${text}`);
  }

  /**
   * The run is over and everything that could finish has (every city is back in its page): judge every
   * battle and every application. Nothing is excused for a disturbance as such; what is excused is a
   * battle the room itself ended with no one finishing it, and an application a restore from an older
   * save (a crash) lost, each said in the log.
   */
  finish(): void {
    const w = this.w;
    this.harvest();
    this.queueSeen();
    this.consistency();
    for (const b of this.battles.values()) this.judge(b);
    for (const p of w.players)
      if (!p.page) w.fail('away-at-end', `${p.name}'s city was not in its page at the end`);
    this.applications();
    this.forcesEnd();
    this.treatiesEnd();
    this.rowsEnd();
  }

  /** Every live battle was taken by its defender (and kept: not lost to a restore); its attacker's force is judged apart (`forcesEnd`). */
  private applications(): void {
    const w = this.w;
    for (const b of this.battles.values()) {
      if (!b.judged || b.judged.problem) continue;
      const d = w.bySlot(b.defender);
      if (!d?.page) continue;
      const key = `${d.name}:${b.id}`;
      if (!this.taken.has(key)) {
        if (this.verdict(b)?.abandoned)
          this.excuse(
            `${b.defenderName}'s city did not take ${b.id}: the room ended it with no one finishing it`,
          );
        else
          w.fail(
            'not-applied',
            `${b.defenderName}'s city never took live battle ${b.id}${b.disturbed.length ? ` (disturbed in it: ${b.disturbed.map((x) => `${x.name} ${x.what}`).join(', ')})` : ''}`,
          );
      } else if (this.rewoundSince(d, this.lastAt.get(key) ?? 0))
        this.excuse(
          `${b.defenderName}'s city took ${b.id}, and a restore from an older save lost that; it was not taken again`,
        );
    }
  }

  /**
   * Every force a city sent was reported or called home, is still on its way, or is still fighting when
   * time ran out; one that vanished with neither report nor recall is lost. A force that is fighting although
   * its live battle is over was never reported.
   */
  private forcesEnd(): void {
    const w = this.w;
    const liveOf = new Map<string, BattleLog>();
    for (const b of this.battles.values()) {
      const a = w.bySlot(b.attacker);
      const n = /-(\d+)$/.exec(b.id)?.[1];
      if (a && n) liveOf.set(`${a.name}:${n}`, b);
    }
    let out = 0;
    let fighting = 0;
    for (const [key, f] of this.sent) {
      const p = w.player(f.player);
      if (!p.page) continue;
      const e = p.sim.state.war?.expeditions?.find((x) => x.id === f.id);
      const battle = liveOf.get(key);
      const where = battle ? ` (its battle was ${battle.id})` : '';
      if (e) {
        if (e.state === 'back') continue;
        if (e.state === 'out') {
          out++;
          continue;
        }
        if (battle && this.over(battle) && !this.verdict(battle)?.abandoned)
          w.fail(
            'not-reported',
            `${p.name}'s force ${f.id} is still fighting although its battle is over${where}`,
          );
        else fighting++;
        continue;
      }
      if (this.reported.has(key) || this.recalled.has(key)) {
        // It came home. A report that a restore from an older save lost would have brought it back to the city.
        continue;
      }
      if (this.rewoundSince(p, f.stamp))
        this.excuse(`${p.name}'s force ${f.id} was sent and the city came back from a save older than that`);
      else if (battle && this.verdict(battle)?.abandoned)
        this.excuse(
          `${p.name}'s force ${f.id} has no report: the room ended its battle with no one finishing it`,
        );
      else
        w.fail(
          'not-reported',
          `${p.name}'s force ${f.id} left the city and was never reported nor called home${where}`,
        );
    }
    if (out || fighting)
      w.note(
        `at the end ${out} forces were still on their way and ${fighting} still fighting (time ran out)`,
      );
  }

  /** Every treaty the room signed was taken by both its cities, and none waits for a city that is here. */
  private treatiesEnd(): void {
    const w = this.w;
    for (const [id, t] of this.treaties)
      for (const slot of t.parties) {
        const p = w.bySlot(slot);
        if (p?.page && !t.appliedBy.has(slot))
          w.fail(
            'treaty-one-sided',
            `treaty ${id} between cities ${t.parties.join(' and ')} was never applied by ${p.name}'s city`,
          );
      }
    const signed = [...this.history.values()].filter((e) => e.kind === 'treaty').length;
    if (signed > this.treaties.size)
      w.fail(
        'treaty-one-sided',
        `the room signed ${signed} treaties and only ${this.treaties.size} were ever seen in its queues or applied by a city`,
      );
    for (const [slot, q] of Object.entries(this.meta.friends?.queue ?? {})) {
      const p = w.bySlot(Number(slot));
      if (p?.page && q.length)
        w.fail(
          'treaty-one-sided',
          `the room still waits for ${p.name}'s city to say it has seen ${q.map((t) => t.id).join(', ')}`,
        );
    }
  }

  /** No battle is kept in the room for a city that has been here for a while. */
  private rowsEnd(): void {
    const w = this.w;
    const now = w.now();
    for (const key of this.store.battles.keys()) {
      const slot = Number(key.split(':')[0]);
      if (slot > MAX_CITIES) continue;
      const p = w.bySlot(slot);
      const waited = now - (this.rowAt.get(key) ?? now);
      if (p?.page && waited > 90_000)
        w.fail(
          'unclaimed-battle',
          `battle ${key} has waited ${Math.round(waited / 1000)} s in the room for ${p.name}, whose city is in the region`,
        );
    }
  }

  private judge(b: BattleLog): void {
    if (b.judged) return;
    const att = b.views.get(b.attacker);
    const def = b.views.get(b.defender);
    const room = att?.state.hashes.room ?? def?.state.hashes.room ?? null;
    const hard: string[] = [];
    const soft: string[] = [];
    // One side finished the battle while the other was away: the room ended it with the one verdict it had
    // (`solo`), and the side that came back ran its battle out alone with the orders it had been sent. That
    // is a disagreement a disturbance explains; any other is a failure.
    const left = !!room && (room.solo || room.abandoned) && b.disturbed.length > 0;
    if (!room) soft.push('the room gave no verdict');
    else {
      // (A battle nobody finished has no runs to disagree: the room's `agree: false` there only says so.)
      if (room.agree === false && !room.abandoned)
        hard.push('the room saw the two cities’ runs end differently');
      if (room.solo) soft.push('only one city finished it');
      if (room.abandoned) soft.push('nobody finished it');
    }
    const differ: string[] = [];
    for (const [who, v] of [
      [b.attackerName, att],
      [b.defenderName, def],
    ] as const) {
      if (!v) soft.push(`${who}'s page never showed it`);
      else {
        if (v.state.desync) differ.push(`${who}'s page logged that the runs ended differently`);
        if (!v.state.ended || !v.state.hashes.mine) soft.push(`${who}'s run did not end`);
      }
    }
    const am = att?.state.hashes.mine;
    const dm = def?.state.hashes.mine;
    if (am && dm && (am.hash !== dm.hash || am.step !== dm.step))
      differ.push(
        `the two runs ended differently (${b.attackerName} step ${am.step} ${am.hash}, ${b.defenderName} step ${dm.step} ${dm.hash})`,
      );
    (left ? soft : hard).push(...differ);
    if (hard.length) {
      b.judged = { ok: false, problem: hard.join('; ') };
      this.w.fail('desync', `live battle ${b.id}: ${hard.join('; ')}`);
    } else if (soft.length) {
      if (b.disturbed.length) {
        b.judged = {
          ok: true,
          explained: `${soft.join('; ')} (${b.disturbed.map((d) => `${d.name} ${d.what}`).join(', ')})`,
        };
        this.w.note(`battle ${b.id} explained: ${b.judged.explained}`);
      } else {
        b.judged = { ok: false, problem: soft.join('; ') };
        this.w.fail('battle', `live battle ${b.id}: ${soft.join('; ')}, and no one was disturbed in it`);
      }
    } else b.judged = { ok: true };
  }

  // ---------------------------------------------------------------- the free plan

  budget(): BudgetReport {
    const w = this.w;
    const secs = Math.max(1, (w.now() - this.begun) / 1000);
    const hours = secs / 3600;
    const rows = this.store.rowsWritten - this.rows0;
    const messages = w.players.reduce((n, p) => n + p.sent.messages, 0);
    const bytes = w.players.reduce((n, p) => n + p.sent.bytes, 0);
    const requests = messages / 20;
    // The region's object is awake as long as anything is sent to it (reports come every few seconds).
    const gbs = secs * GB;
    const per = {
      rows: rows / hours,
      requests: requests / hours,
      gbs: gbs / hours,
      messages: messages / hours,
    };
    const regionRows = REGION_LIMITS.dailyRows;
    const carries = {
      rows: FREE_PLAN.rowsWritten / per.rows,
      requests: FREE_PLAN.requests / per.requests,
      gbs: FREE_PLAN.gbs / per.gbs,
      regionRows: regionRows / per.rows,
    };
    const share = {
      rows: (per.rows * EVENING) / FREE_PLAN.rowsWritten,
      regionRows: (per.rows * EVENING) / regionRows,
      requests: (per.requests * EVENING) / FREE_PLAN.requests,
      gbs: (per.gbs * EVENING) / FREE_PLAN.gbs,
    };
    // An evening of this play must take at most half of any daily allowance, the region's own row budget
    // (what the room stops writing at, and refuses battles past) among them.
    const day = {
      rows: per.rows * 24,
      requests: per.requests * 24,
      gbs: per.gbs * 24,
    };
    const used = (this.w.room as unknown as { budget: { used(n: number): number } }).budget.used(
      this.w.now(),
    );
    const ok = share.rows <= 0.5 && share.regionRows <= 0.5 && share.requests <= 0.5 && share.gbs <= 0.5;
    const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
    const lines = [
      `the room over ${hours.toFixed(2)} h of room time (${secs.toFixed(0)} s)`,
      `  rows written: ${rows} (${per.rows.toFixed(0)} an hour); an evening of ${EVENING} h = ${pct(share.regionRows)} of the region's own ${regionRows} a day, ${pct(share.rows)} of the plan's ${FREE_PLAN.rowsWritten}`,
      `  requests: ${messages} incoming messages = ${requests.toFixed(0)} requests (${per.requests.toFixed(0)} an hour); an evening = ${pct(share.requests)} of ${FREE_PLAN.requests}`,
      `  bytes sent by the pages: ${(bytes / 1024).toFixed(0)} KB (${(bytes / 1024 / hours).toFixed(0)} KB an hour)`,
      `  rows by kind: ${[...this.rowKinds].map(([k, n]) => `${k} ${n}`).join(', ')}`,
      `  messages by kind: ${[...w.sentKinds]
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(', ')}`,
      `  duration: awake the whole time at 128 MB = ${gbs.toFixed(0)} GB-s (${per.gbs.toFixed(0)} an hour); an evening = ${pct(share.gbs)} of ${FREE_PLAN.gbs}`,
      `  continuously for 24 h this would be ${day.rows.toFixed(0)} rows (${pct(day.rows / FREE_PLAN.rowsWritten)} of the plan, ${pct(day.rows / regionRows)} of the region's own ${regionRows}), ${day.requests.toFixed(0)} requests (${pct(day.requests / FREE_PLAN.requests)}), ${day.gbs.toFixed(0)} GB-s (${pct(day.gbs / FREE_PLAN.gbs)})`,
      `  the region's own row budget used by the run: ${used} of ${regionRows}; the lowest message allowance any connection fell to: ${this.rateMin === Infinity ? 'unknown' : this.rateMin.toFixed(1)} of ${REGION_LIMITS.burst} tokens`,
      `  the plan carries about ${Math.floor(Math.min(carries.rows, carries.requests, carries.gbs))} such hours a day across all regions (rows ${carries.rows.toFixed(0)}, requests ${carries.requests.toFixed(0)}, duration ${carries.gbs.toFixed(0)}); one region's own row budget carries ${carries.regionRows.toFixed(1)} h`,
    ];
    return {
      hours,
      rows,
      messages,
      bytes,
      requests,
      gbs,
      perHour: per,
      carries,
      eveningShare: share,
      ok,
      lines,
    };
  }
}

/** What a run of this length and story must have covered for its pass to mean anything. */
export function required(o: SoakOptions): [Cover, number][] {
  const m = o.minutes;
  const need: [Cover, number][] = [
    ['raids', 1],
    ['liveBattles', 1],
    ['orders', 2],
  ];
  if (o.story === 'short') {
    if (o.disturb) need.push(['drops', 1]);
    return need;
  }
  if (m >= 8) need.push(['declared', 1], ['warsOpened', 1], ['treaties', 1], ['pacts', 1]);
  if (m >= 10) need.push(['helpSent', 1], ['liveBattles', 3], ['raids', 3]);
  if (m >= 20) need.push(['conquests', 1]);
  if (m >= 25) need.push(['vassalDues', 1]);
  // (A force sent to help is often late: the battle is over before it can get there.)
  if (m >= 60) need.push(['helpBooked', 1]);
  if (o.disturb && m >= 8) need.push(['drops', 1], ['reloads', 1]);
  if (o.disturb && m >= 15) need.push(['leaves', 1], ['outages', 1]);
  // A long run must have had a combatant disturbed in a live battle, and the room hand a side over.
  if (o.disturb && m >= 60) need.push(['disturbedBattles', 1], ['handovers', 1]);
  // A force that arrived while its defender was away is fought the old way, and the defender takes the battle on its return.
  if (o.disturb && m >= 30) need.push(['oldBattles', 1]);
  if (o.crash && m >= 25) need.push(['crashes', 1]);
  return need;
}

/**
 * What a run of this length cannot have covered, by the same thresholds as `required`: a pass of a
 * run shorter than the story's arc says so in its banner, so it is not mistaken for the full soak.
 */
export function notCoveredByLength(o: SoakOptions): string[] {
  if (o.story === 'short') return [];
  const m = o.minutes;
  const out: string[] = [];
  if (m < 8) out.push('a declared war, a treaty and pacts (8 minutes)');
  if (m < 10) out.push('an ally’s help and three live battles (10 minutes)');
  if (m < 20) out.push('a conquest (20 minutes)');
  if (m < 25) out.push('a vassal’s dues (25 minutes)');
  if (o.disturb && m < 15) out.push('a player away, and a network outage (15 minutes)');
  if (m < 60)
    out.push(
      'a force that came home from helping, a combatant disturbed in a battle, a handover (60 minutes)',
    );
  return out;
}
