import { REGION_LIMITS, type MemoryRegionStore } from '../../../relay/region';
import type { FriendsState } from '../../../relay/friendsWar';
import type { FriendWar, WarEvent } from '../../../relay/protocol';
import type { Command, CommandResult } from '../../../src/sim/commands';
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
  /** When (room ms) each application was first made, by the key it is counted under. */
  private firstAt = new Map<string, number>();
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
  /** Records of live battles that stood in for the one the city was hosting. */
  standIns = 0;

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
    st.saveBattle = (slot, k, parts) =>
      count(slot >= 5 ? 'replays of live battles' : 'battles waiting for a city', () =>
        battle(slot, k, parts),
      );
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

  /** A command the city was asked to apply, and whether it did: a battle taken or a force's report twice is a failure. */
  applied(p: Player, gen: number, cmd: Command, r: CommandResult, hosted?: string): void {
    if (cmd.type === 'battleResolve' && r.ok) {
      const key = `${p.name}:${cmd.input.id}`;
      const n = (this.resolved.get(key) ?? 0) + 1;
      this.resolved.set(key, n);
      const first = this.firstAt.get(key) ?? this.w.now();
      this.firstAt.set(key, first);
      this.taken.set(
        key,
        `${cmd.mode}${cmd.from !== undefined ? ` from ${cmd.from}` : ''} (generation ${gen})`,
      );
      // The record of a live battle this very city was hosting stands in for it (design: a reload, or a page
      // that lost the room): the second application is the first one finished, and is counted apart.
      const standsIn = n > 1 && cmd.mode === 'instant' && hosted === cmd.input.id;
      if (standsIn) {
        this.standIns++;
        this.w.note(
          `${p.name}'s city takes the record of ${cmd.input.id} in place of the battle it was hosting`,
        );
      } else if (cmd.mode !== 'live') this.w.covered('oldBattles');
      // A city that came back from an autosave older than the first time it took the battle has lost that.
      const rewound = n > 1 && first > p.restoredAt;
      if (rewound && !standsIn)
        this.w.note(`${p.name}'s city takes ${cmd.input.id} again: its autosave was older than the first`);
      if (n > 1 && !standsIn && !rewound)
        this.w.fail(
          'applied-twice',
          `${p.name}'s city took battle ${cmd.input.id} ${n} times (this one ${cmd.mode}, generation ${gen})`,
        );
    } else if (cmd.type === 'recallForce' && r.ok) {
      this.w.covered('recalled');
      this.w.note(`${p.name}'s force ${cmd.expedition} is called home (the battle was turned away)`);
    } else if (cmd.type === 'battleReport' && r.ok) {
      const key = `${p.name}:${cmd.expedition}`;
      const n = (this.reported.get(key) ?? 0) + 1;
      this.reported.set(key, n);
      const first = this.firstAt.get(`report:${key}`) ?? this.w.now();
      this.firstAt.set(`report:${key}`, first);
      if (n > 1 && first > p.restoredAt)
        this.w.note(
          `${p.name}'s city takes the report of its force ${cmd.expedition} again: its autosave was older than the first`,
        );
      else if (n > 1)
        this.w.fail(
          'reported-twice',
          `${p.name}'s city took the report of its force ${cmd.expedition} ${n} times (generation ${gen})`,
        );
    }
  }

  /** A player dropped, left or reloaded: every battle of theirs that is on is marked, so what it does to it is explained. */
  disturb(p: Player, what: string): void {
    for (const b of this.battles.values())
      if (!this.over(b) && (b.attacker === p.slot || b.defender === p.slot))
        b.disturbed.push({ name: p.name, what, at: this.w.now() });
  }

  private over(b: BattleLog): boolean {
    for (const v of b.views.values()) if (v.state.hashes.room) return true;
    return false;
  }

  // ---------------------------------------------------------------- every frame and second

  frame(): void {
    const now = this.w.now();
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
      if (st.handed && !had?.state.handed) {
        this.w.covered('handovers');
        this.w.note(`${p.name}'s side of ${st.id} is handed over to its defences`);
      }
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

  /** The run is over and everything that could finish has: judge every battle and every application. */
  finish(): void {
    this.harvest();
    this.consistency();
    for (const b of this.battles.values()) this.judge(b);
    // A force that reached a battle was reported once; a battle the city took was taken once (the guards say twice).
    for (const b of this.battles.values()) {
      if (!b.judged || b.judged.problem) continue;
      const d = this.w.bySlot(b.defender);
      const a = this.w.bySlot(b.attacker);
      if (d && !this.taken.has(`${d.name}:${b.id}`) && !b.disturbed.length)
        this.w.fail('not-applied', `${b.defenderName}'s city never took live battle ${b.id}`);
      else if (d && !this.taken.has(`${d.name}:${b.id}`))
        this.w.note(`${b.defenderName}'s city did not take ${b.id} (it was disturbed during it)`);
      if (a && a.page) {
        const city = a.sim.state.war?.expeditions ?? [];
        // Reports are counted by the attacker's city; the expedition of this battle ends with `exp-<seed>-<n>`.
        const n = Number(/-(\d+)$/.exec(b.id)?.[1] ?? -1);
        const reports = this.reported.get(`${a.name}:${n}`) ?? 0;
        const stillOut = city.some((e) => e.id === n && e.state === 'fighting');
        if (reports === 0 && !stillOut && !b.disturbed.length)
          this.w.fail(
            'not-reported',
            `${b.attackerName}'s city never took the report of its force in ${b.id}`,
          );
        else if (reports === 0 && !stillOut)
          this.w.note(`${b.attackerName}'s force in ${b.id} was not reported (it was disturbed during it)`);
      }
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
      if (room.agree === false) hard.push('the room saw the two cities’ runs end differently');
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
    // An evening of this play must take at most half of any daily allowance, and fit the region's own row budget.
    const day = {
      rows: per.rows * 24,
      requests: per.requests * 24,
      gbs: per.gbs * 24,
    };
    const used = (this.w.room as unknown as { budget: { used(n: number): number } }).budget.used(
      this.w.now(),
    );
    const ok = share.rows <= 0.5 && share.regionRows <= 1 && share.requests <= 0.5 && share.gbs <= 0.5;
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
  if (m >= 25) need.push(['vassalDues', 1], ['helpBooked', 1]);
  if (o.disturb && m >= 8) need.push(['drops', 1], ['reloads', 1]);
  if (o.disturb && m >= 15) need.push(['leaves', 1], ['outages', 1]);
  return need;
}
