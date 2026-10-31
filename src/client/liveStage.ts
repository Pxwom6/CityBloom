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
import { LIVE, helpTravelOf, helpUnitId } from '../../relay/protocol';
import type { RegionClientMsg, RegionRoomMsg } from '../../relay/region';
import type { UnitKind } from '../data/war';
import type { Game } from '../game';
import type { LiveSink } from '../net/regionLink';
import { encodeBattle } from '../net/snapshot';
import type { OrderRequest } from '../sim/battle/live';
import type { BattleInput, ForceIn } from '../sim/battle/types';
import type { RegionUpdate } from '../sim/systems/region';
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
  /** The frontier is kept from passing this step (a battle held still for a picture), until released. */
  hold: number | null = null;
  /** The page's last report of its step. */
  private lastStep = 0;
  /** Orders the stand-in stamped, as the page's test API reports them. */
  readonly stamped: LiveOrder[] = [];
  /** Help the page sends (step 6) fights for this side, takes this many steps to arrive (null: the room's own), and is called this. */
  helpSide: LiveSide = 0;
  helpTravel: number | null = null;
  cityName = 'Your city';

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
      case 'bhelp':
        return this.onHelp(m);
      default:
        return;
    }
  }

  /**
   * The page sends its own force to help (M39 step 6): the stand-in puts it in as the room would, on
   * the side `helpSide` (the ally's; no pacts here to say), `helpTravel` steps from the frontier.
   */
  private onHelp(m: Extract<RegionClientMsg, { t: 'bhelp' }>): void {
    const s = this.session;
    if (!s || s.id !== m.id || this.ended) return;
    const route = m.route ?? 'highway';
    const put = s.help(
      this.helpSide,
      { slot: this.slot, name: this.cityName, color: 0x3a78c8 },
      { units: m.units, route, ...(m.mods ? { mods: m.mods } : {}) },
      this.helpTravel ?? helpTravelOf(route) ?? Number.NaN,
    );
    if (!put.entry) return this.tell({ t: 'bhelpoff', id: s.id, why: put.refused });
    this.stamped.push(put.entry);
    this.ghost?.feed([put.entry], s.allow);
    this.tell({ t: 'ballow', id: s.id, allow: s.allow, ords: [put.entry] });
  }

  /**
   * Another city's allied force joins the battle (M39 step 6, for a picture of help arriving): stamped at
   * the frontier like any, `travel` steps from it. False when the battle is over, full of help, or not here.
   */
  addHelper(opts: {
    owner: number;
    name: string;
    color: number;
    side: LiveSide;
    units: UnitKind[];
    travel?: number;
  }): boolean {
    const s = this.session;
    if (!s || this.ended) return false;
    const put = s.help(
      opts.side,
      { slot: opts.owner, name: opts.name, color: opts.color },
      {
        units: opts.units.map((kind, k) => ({ id: helpUnitId(opts.owner, k), kind, hp: 1 })),
        route: 'highway',
      },
      opts.travel ?? this.helpTravel ?? LIVE.helpTravel.highway,
    );
    if (!put.entry) return false;
    this.stamped.push(put.entry);
    this.ghost?.feed([put.entry], s.allow);
    this.tell({ t: 'ballow', id: s.id, allow: s.allow, ords: [put.entry] });
    return true;
  }

  private onStep(m: Extract<RegionClientMsg, { t: 'bstep' }>): void {
    const s = this.session;
    if (!s || s.id !== m.id || this.side === null || this.ended) return;
    const t = this.now();
    this.lastStep = m.step;
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
    const moved = this.pace(s, t);
    if (moved || ords.length)
      this.tell({ t: 'ballow', id: s.id, allow: s.allow, ...(ords.length ? { ords } : {}) });
  }

  /** The room's pacing, but never past a hold. */
  private pace(s: LiveSession, t: number): boolean {
    const before = s.allow;
    s.pace(t);
    if (this.hold !== null && s.allow > this.hold) s.allow = Math.max(before, Math.min(s.allow, this.hold));
    return s.allow > before;
  }

  /** Let a held battle go on (the frontier moves on from where the page is). */
  release(): void {
    this.hold = null;
    const s = this.session;
    if (!s || this.ended) return;
    const t = this.now();
    if (this.side !== null) s.report(this.side, this.lastStep, t);
    for (const v of this.virtual) s.report(v, this.ghost ? this.ghost.step : this.lastStep, t);
    if (this.pace(s, t)) this.tell({ t: 'ballow', id: s.id, allow: s.allow });
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
  tick(): void {
    const s = this.session;
    const g = this.ghost;
    if (!s || !g || this.ended) return;
    const t = this.now();
    g.feed([], s.allow);
    g.pump();
    // The virtual combatants are with it, step for step.
    for (const i of this.virtual) s.report(i, g.step, t);
    if (this.pace(s, t)) this.tell({ t: 'ballow', id: s.id, allow: s.allow });
    const end = g.end();
    if (end) {
      for (const i of this.virtual) s.finish(i, end.step, end.hash, t);
      this.finishIfOver();
    }
  }
}

/** A force of every sort a battle can show, for a staged battle. */
export const STAGE_FORCE: UnitKind[] = [
  'tank',
  'tank',
  'tank',
  'heavytank',
  'artillery',
  'artillery',
  'infantry',
  'infantry',
  'infantry',
  'transport',
  'helicopter',
  'helicopter',
  'fighter',
  'bomber',
];

/** The stand-in being played with now (a page has at most one). */
let current: LiveStage | null = null;
let serial = 0;

export const stageNow = (): LiveStage | null => current;

/**
 * Stage a live battle in this page with no second player (test builds only; `stageLive` in the test
 * API). The page needs war on; a friend's city (Samford, place 2) is made up in its region so the
 * city's own sim can host the battle. As the defender the real path runs: the sim hosts, the stand-in
 * plays the room. As the attacker or a watcher the battle is a picture of this city's own, run in the
 * battle worker. Null when it started, else why not.
 */
export async function stageLive(
  game: Game,
  role: StageRole,
  opts: { units?: UnitKind[]; hold?: number; helpSide?: LiveSide; helpTravel?: number } = {},
): Promise<string | null> {
  const units = opts.units ?? STAGE_FORCE;
  if (!game.world.stats.war) return 'War is off in this city';
  const was = game.live.view();
  if (was && !was.over && was.role !== 'watcher') return 'A live battle is on';
  current?.stop();
  game.live.detach();
  // A friend: the first town that is not a player's becomes Samford, the neighbour of a region.
  const none = { power: 0, water: 0, garbage: 0 };
  const update: RegionUpdate = {
    cities: [
      {
        slot: 2,
        name: 'Samford',
        mayor: 'Sam',
        color: 1,
        population: 4_000,
        kind: 'suburb',
        offers: { buy: { ...none }, sell: { ...none } },
        workers: 0,
        jobs: 0,
        shoppers: 0,
        online: true,
        raid: 'open',
      },
    ],
    contracts: [],
    project: null,
  };
  const r = await game.dispatch({ type: 'regionUpdate', update });
  if (!r.ok) return r.reason;
  const id = `stage-${++serial}`;
  const force: ForceIn = {
    name: 'Samford',
    color: 0x2e86de,
    units: units.map((kind, k) => ({ id: k + 1, kind, hp: 1, x: 0, z: 0, base: -1 })),
    route: 'highway',
    target: 'military',
    stance: 'bold',
    readiness: 1,
  };
  if (role === 'defender') {
    const stage = new LiveStage('defender', 1, 2, 1);
    stage.hold = opts.hold ?? null;
    current = stage;
    game.live.attach(stage);
    // The real call, as the room would pass it on.
    game.live.message({ t: 'bcall', id, from: 2, force });
    return null;
  }
  // A picture of this city's own, which the page runs (the attacker's way, or a spectator's).
  const made = await game.client.query<{ input: BattleInput } | { refused: string }>({
    type: 'liveBattle',
    call: { id, from: 2, force },
  });
  if ('refused' in made) return made.refused;
  const input = made.input;
  const here = game.world.stats.cityName;
  if (role === 'attacker') {
    input.attacker.name = here;
    input.attacker.color = 0x3a78c8;
    input.defender.name = 'Samford';
    input.defender.color = 0x2e86de;
    const stage = new LiveStage('attacker', 1, 1, 2);
    stage.hold = opts.hold ?? null;
    current = stage;
    game.live.attach(stage);
    game.live.stage(input, 1, 2);
    stage.beginAttacker(input);
    return null;
  }
  input.attacker.name = 'Samford';
  input.defender.name = 'Riverton';
  input.defender.color = 0x5aa05a;
  const stage = new LiveStage('watcher', 3, 2, 4);
  stage.hold = opts.hold ?? null;
  stage.cityName = here;
  stage.helpSide = opts.helpSide ?? 0;
  stage.helpTravel = opts.helpTravel ?? null;
  current = stage;
  game.live.attach(stage);
  stage.beginWatched(input);
  return null;
}
