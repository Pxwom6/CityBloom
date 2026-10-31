import { startRelay, type LocalRelay } from '../../../relay/local';
import { makeCode } from '../../../relay/protocol';
import { MemoryRegionStore, RegionRoom } from '../../../relay/region';
import { FakeClock } from '../../../relay/tests/harness';
import { webSocketLink, type Link } from '../../../src/net/link';
import { awayInput, awayResult, type AwayCity } from '../../../src/sim/battle/away';
import { Battle } from '../../../src/sim/battle/battle';
import { checkInvariants } from '../../../src/sim/invariants';
import { Rng } from '../../../src/sim/rng';
import type { SaveFile } from '../../../src/sim/save';
import { Sim } from '../../../src/sim/sim';
import { TICKS_PER_MONTH } from '../../../src/sim/time';
import { settle, friendsPage, type FwPage } from '../../../tests/war/friendsHarness';
import { flush, loopTo } from '../../../tests/war/liveHarness';
import { friend, liveTown, regionOf, type LiveTown } from '../../../tests/war/liveTown';
import { Bots } from './bots';
import { Checks } from './checks';
import { COVER_KEYS, sleep, type BattleLog, type Cover, type Failure, type SoakOptions } from './types';

/**
 * The soak's world (M39 step 10): four cities' pages in a region at war, each a sim, a `RegionLink`
 * and the live-battle, away-battle and friends'-war helpers a game has, against one region room. The
 * room is the local relay over real sockets and the wall clock (`real`), or the same class in this
 * process over loopback links with a clock the soak moves (`virtual`). One loop plays the cities'
 * ticks, the pages' turns, the bots (orders, answers, training, an ally's help), the checks and the
 * story's waits, a frame (125 ms of game time at 1×) at a time.
 */

export const NAMES = ['Ada', 'Sam', 'Kit', 'Lou'] as const;
const CITIES = ['Adaville', 'Samford', 'Kitburg', 'Louton'];
/** The seeds the M39 test towns were made on (a seed whose streets leave no room for a base would end the soak before it began). */
const SEEDS = ['ada-live', 'sam-live', 'kit-live', 'lou-live'];

/** Milliseconds of room time a frame stands for at 1× (a city tick). */
export const FRAME_MS = 125;

interface ClockLike {
  now(): number;
  advance(ms: number): void;
}

/** The battle worker's job for a friend's battle fought in the region's copy of its city (`src/client/battleWorker.ts`). */
interface AwayJob {
  type: string;
  id: number;
  city: AwayCity;
  save: SaveFile;
}

interface Waiter {
  what: string;
  pred: () => boolean;
  due: number;
  resolve: (ok: boolean) => void;
}

/** One of the four players: a city that may be open in a page, or closed (the tab shut, a reload on the way). */
export class Player {
  page: FwPage | null = null;
  sim!: Sim;
  slot = 0;
  secret = '';
  /** How many times the city was loaded again (a reload or a return): applications are counted by generation. */
  gen = 0;
  /** Connections to the region fail while this is set (an outage). */
  offline = false;
  /** Room ms the link has been in the region since (0: not in it). */
  upSince = 0;
  autosave: SaveFile | null = null;
  /** When (room ms) the autosave was made, and the one the city's present generation began from. */
  autosaveAt = 0;
  restoredAt = Infinity;
  town: LiveTown | null = null;
  /** The next proposals this player declines before it accepts one. */
  declineNext = 0;
  /** Messages and bytes sent by links this player has since closed. */
  retired = { messages: 0, bytes: 0 };
  links = new Set<Link>();
  /** Proposals being thought over (id → room ms to answer at). */
  thinking = new Map<string, number>();
  /** Where the orders in the battle on stand (battle id, steps to give them at, how many given). */
  commands: { id: string; at: number[]; given: number } | null = null;
  helpTried = new Set<string>();
  helpBooked = new Set<string>();
  helpWord = '';
  lastMonthLine = 0;
  constructor(
    readonly name: string,
    readonly idx: number,
  ) {}

  get city(): string {
    return CITIES[this.idx]!;
  }
  /** Open in a page that is in the region now. */
  get up(): boolean {
    return !!this.page && this.page.ticking && this.page.link.state === 'in';
  }
  get sent(): { messages: number; bytes: number } {
    const l = this.page?.link.sent ?? { messages: 0, bytes: 0 };
    return { messages: this.retired.messages + l.messages, bytes: this.retired.bytes + l.bytes };
  }
}

export class Soak {
  readonly rng: Rng;
  readonly clock: ClockLike;
  readonly players: Player[] = NAMES.map((n, i) => new Player(n, i));
  readonly checks: Checks;
  readonly bots: Bots;
  /** Told when a live battle first shows (the story's disturbances use it). */
  onBattle: ((b: BattleLog) => void) | null = null;
  room!: RegionRoom;
  relay: LocalRelay | null = null;
  code = '';
  /** Room ms at the start of play, and the frames played. */
  start = 0;
  frameNo = 0;
  over = false;
  /** Past the minutes asked for: finishing what is under way, nothing new is begun. */
  draining = false;
  readonly failures: Failure[] = [];
  readonly misses: string[] = [];
  readonly journal: string[] = [];
  readonly cover = Object.fromEntries(COVER_KEYS.map((k) => [k, 0])) as Record<Cover, number>;
  /** Messages the pages sent, by kind, and their characters. */
  readonly sentKinds = new Map<string, number>();
  readonly sentBytes = new Map<string, number>();
  private waiters: Waiter[] = [];
  private timers: { at: number; fn: () => void | Promise<void> }[] = [];
  private seconds = 0;
  behind = 0;
  private rejections = 0;

  constructor(readonly opts: SoakOptions) {
    this.rng = Rng.fromSeed(opts.seed);
    this.clock =
      opts.mode === 'virtual' ? new FakeClock() : { now: () => Date.now(), advance: () => undefined };
    this.checks = new Checks(this);
    this.bots = new Bots(this);
  }

  // ---------------------------------------------------------------- clocks, notes and failures

  now(): number {
    return this.clock.now();
  }
  /** Minutes of room time since play began. */
  minutes(): number {
    return (this.now() - this.start) / 60_000;
  }
  stamp(): string {
    if (!this.start) return 'setup';
    const s = Math.max(0, Math.floor((this.now() - this.start) / 1000));
    return `${String(Math.floor(s / 60)).padStart(3, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  note(text: string): void {
    const line = `[${this.stamp()}] ${text}`;
    this.journal.push(line);
    this.opts.log(line);
  }
  fail(kind: string, text: string): void {
    // The same problem seen again and again is one failure with a count.
    const same = this.failures.find((f) => f.kind === kind && f.text === text);
    if (same) {
      same.times++;
      return;
    }
    this.failures.push({ at: this.now() - this.start, kind, text, times: 1 });
    this.note(`FAILURE ${kind}: ${text}`);
  }
  /** Something the story meant to do and couldn't (not a defect of the game: the soak's own coverage says if it mattered). */
  miss(text: string): void {
    this.misses.push(`[${this.stamp()}] ${text}`);
    this.note(`story: ${text}`);
  }
  covered(k: Cover, n = 1): void {
    this.cover[k] += n;
  }

  // ---------------------------------------------------------------- waiting and later

  /** Wait until `pred` holds (checked every frame), at most `ms` of room time. False if it never did or the soak ended. */
  until(what: string, pred: () => boolean, ms: number): Promise<boolean> {
    if (this.over) return Promise.resolve(false);
    return new Promise((resolve) => this.waiters.push({ what, pred, due: this.now() + ms, resolve }));
  }
  wait(ms: number): Promise<boolean> {
    const until = this.now() + ms;
    return this.until('a while', () => this.now() >= until, ms + FRAME_MS * 4).then(() => !this.over);
  }
  /** Run `fn` once `ms` of room time have passed. */
  later(ms: number, fn: () => void | Promise<void>): void {
    this.timers.push({ at: this.now() + ms, fn });
  }

  player(name: string): Player {
    return this.players.find((p) => p.name === name)!;
  }
  bySlot(slot: number): Player | undefined {
    return this.players.find((p) => p.slot === slot);
  }

  // ---------------------------------------------------------------- setting up

  private connector(p: Player, create: boolean): () => Promise<Link> {
    const inner =
      this.opts.mode === 'real'
        ? () =>
            webSocketLink(
              `ws://127.0.0.1:${this.relay!.port}/region/${this.code}${create ? '?create=1' : ''}`,
            )
        : loopTo(this.room);
    return async () => {
      if (p.offline) throw new Error('offline (the soak has cut this player off)');
      const link = await inner();
      p.links.add(link);
      const close = link.close.bind(link);
      link.close = () => {
        p.links.delete(link);
        close();
      };
      // What the pages send, by kind: the budget's breakdown (and where a flood comes from).
      const send = link.send.bind(link);
      link.send = (text) => {
        const t = /^\{"t":"([a-z]+)"/.exec(text)?.[1] ?? '?';
        this.sentKinds.set(t, (this.sentKinds.get(t) ?? 0) + 1);
        this.sentBytes.set(t, (this.sentBytes.get(t) ?? 0) + text.length);
        send(text);
      };
      return link;
    };
  }

  /** The options of the pages' links: the game's own pace of reports and saves in real mode, the soak's in virtual. */
  private linkOptions() {
    return this.opts.mode === 'real'
      ? { reportEvery: 30_000, saveEvery: 300_000, fairClock: this.opts.fairClock }
      : { reportEvery: 2_000_000_000, saveEvery: 2_000_000_000, fairClock: false };
  }

  /** A city's page in the region: the first player makes the region; a returning one rejoins with its credentials. */
  private async open(p: Player, sim: Sim, first = false): Promise<void> {
    this.patch(p, sim);
    p.sim = sim;
    const rejoin = p.slot && p.secret ? { slot: p.slot, secret: p.secret } : undefined;
    const page = await friendsPage(
      {
        connect: this.connector(p, first),
        clock: this.clock,
        sim,
        mayor: p.name,
        color: p.idx,
        ...(first
          ? { create: { name: 'Four Rivers', rules: { war: true, scale: 'total' as const } } as never }
          : {}),
        ...(rejoin ? { rejoin } : {}),
        link: this.linkOptions(),
      },
      this.clock,
      () => this.autosave(p),
    );
    p.page = page;
    p.slot = page.link.slot;
    p.secret = page.link.secret;
    p.upSince = this.now();
    page.hooks.autosave = async () => this.autosave(p);
    page.link.onNotice = (text) => this.checks.linkNotice(p, text);
    // The old way (a friend that cannot fight live, or is busy in another battle): the battle worker's job, done here.
    (page.away as unknown as { run: (job: AwayJob) => Promise<unknown> }).run = async (job) => {
      if (job.type !== 'awayCity')
        return { type: 'error', id: job.id, message: 'the soak runs only a friend’s battle' };
      const town = Sim.fromSave(job.save);
      if (town.state.war?.battle) {
        delete town.state.war.battle;
        town.battleRun = null;
      }
      const input = awayInput(job.city, town);
      return {
        type: 'away',
        id: job.id,
        input,
        result: awayResult(input, Battle.run(structuredClone(input))),
        town: town.save(),
      };
    };
    // What the region made of a force that came to a friend's city: a battle fought, or why not and when to ask again.
    const attack = page.live.attack.bind(page.live);
    page.live.attack = async (city, expedition) => {
      const r = await attack(city, expedition);
      const how =
        r.kind === 'done'
          ? `fought it (${r.ok ? 'taken' : 'not taken'})`
          : r.kind === 'fallback'
            ? 'goes the old way'
            : r.kind === 'wait'
              ? `must wait ${Math.round(r.ms / 1000)} s`
              : `is turned away: ${r.reason}${r.later !== undefined ? ` (try again in ${Math.round(r.later / 1000)} s)` : ''}`;
      this.note(`${p.name}'s force ${expedition} against ${city.neighbour.name} ${how}`);
      return r;
    };
    const frames = page.frames.bind(page);
    page.frames = () => {
      this.checks.events(p, page.sim.events);
      frames();
    };
  }

  /** The city saved to its autosave (the game does so every five minutes, and as a battle begins or a treaty is applied). */
  private autosave(p: Player): void {
    if (!p.page) return;
    p.autosave = p.page.sim.save();
    p.autosaveAt = this.now();
  }

  /** Count what the city is asked to apply (a battle taken, a force's report) so doing either twice shows. */
  private patch(p: Player, sim: Sim): void {
    const dispatch = sim.dispatch.bind(sim);
    const gen = p.gen;
    sim.dispatch = ((cmd: Parameters<Sim['dispatch']>[0]) => {
      // The live battle this city hosts, before the command: a record of it may stand in for it (reload, lost room).
      const hosted = sim.state.war?.battle?.live?.id;
      const r = dispatch(cmd);
      this.checks.applied(p, gen, cmd, r, hosted);
      return r;
    }) as Sim['dispatch'];
  }

  private async build(): Promise<void> {
    this.note('four cities are being built and armed');
    for (const p of this.players) {
      const town = liveTown(SEEDS[p.idx]!, p.city);
      p.town = town;
      p.sim = town.sim;
    }
    // War is on once the region says so; then the cities arm (with a neighbour to say it, until the real ones come).
    for (const p of this.players) {
      regionOf(p.sim, [friend(((p.idx + 1) % 4) + 1, 'Elsewhere', 'Nobody')]);
      this.arm(p);
    }
  }

  /**
   * Bases, forces and defences for a city (money by the test cheat; training takes the game months it takes).
   * The cast: Ada and Sam are alike and middling, Kit is strong and Lou weak, so the story's total war
   * (Kit takes Louton's seat of power) can end as it should in the three raids a day the region allows.
   */
  private arm(p: Player): void {
    const { sim, town } = p;
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_500_000 });
    town!.place('militaryhq');
    if (p.name !== 'Lou') town!.place('bunker');
    const barracks = town!.place('barracks');
    const depot = town!.place('vehicledepot');
    const [tanks, infantry, guns] = { Ada: [3, 3, 1], Sam: [2, 5, 1], Kit: [6, 6, 3], Lou: [1, 3, 0] }[
      p.name
    ]!;
    for (let k = 0; k < tanks; k++) sim.dispatch({ type: 'trainUnit', base: depot, kind: 'tank' });
    for (let k = 0; k < infantry; k++) sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    for (let k = 0; k < guns; k++) sim.dispatch({ type: 'trainUnit', base: depot, kind: 'artillery' });
    sim.advance((p.name === 'Kit' ? 14 : 8) * TICKS_PER_MONTH);
    sim.dispatch({ type: 'cheat', cheat: 'unshield' });
  }

  async setup(): Promise<void> {
    if (this.opts.mode === 'real') {
      this.relay = await startRelay(this.opts.port ?? 0);
      this.code = makeCode('online');
    } else {
      this.code = makeCode('online');
      this.room = new RegionRoom(this.code, 'local', new MemoryRegionStore(), this.clock as FakeClock, {});
    }
    await this.build();
    for (const p of this.players) {
      await this.open(p, p.sim, p.idx === 0);
      if (p.idx === 0 && this.opts.mode === 'real') this.room = this.relay!.regions.get(this.code)!;
      this.note(`${p.name} (${p.city}) is in the region as city ${p.slot}`);
    }
    // Each has reported itself; each city's sim then learns of the others with the next reports.
    for (const round of [0, 1])
      for (const p of this.players) {
        await p.page!.link.reportNow(true);
        if (round === 1) await settle(2);
      }
    await this.pace(4);
    for (const p of this.players) {
      const n = p.sim.state.region.neighbours.filter((x) => x.player).length;
      if (n !== 3) this.fail('setup', `${p.name}'s city knows ${n} friends, not three`);
    }
    this.start = this.now();
    this.checks.begin();
  }

  /** Let messages cross: a few passes of the event loop, or (real) a little of the wall clock. */
  private async pace(n = 1): Promise<void> {
    for (let k = 0; k < n; k++) {
      if (this.opts.mode === 'real') await sleep(25);
      else await flush();
    }
  }

  // ---------------------------------------------------------------- the loop

  /** Play frames until `done`. */
  async loop(done: () => boolean): Promise<void> {
    const real = this.opts.mode === 'real';
    const period = FRAME_MS / this.opts.speed;
    let next = performance.now() + period;
    while (!done()) {
      await this.frame();
      if (real) {
        const wait = next - performance.now();
        if (wait > 1) await sleep(wait);
        else if (wait < -2_000) {
          // The machine could not keep the cities' pace: it is said once, not made up for in a burst.
          this.behind++;
          next = performance.now();
        } else await sleep(0);
        next += period;
      } else {
        this.clock.advance(period);
        await flush();
        // A link that is coming back does so on the wall clock (the page's own timer): the room's time
        // is held to it meanwhile, so a dropped connection is as long as it would be for a player.
        if (this.players.some((p) => p.page?.ticking && p.page.link.state !== 'in')) await sleep(period);
      }
    }
  }

  private async frame(): Promise<void> {
    this.frameNo++;
    for (const p of this.players) {
      const pg = p.page;
      if (!pg?.ticking) continue;
      for (let k = 0; k < this.opts.speed; k++) {
        try {
          pg.sim.step();
        } catch (e) {
          this.fail(
            'sim',
            `${p.name}'s city threw on tick ${pg.sim.state.tick}: ${e instanceof Error ? e.message : String(e)}`,
          );
          pg.ticking = false;
          break;
        }
      }
    }
    for (const p of this.players) {
      const pg = p.page;
      if (!pg?.ticking) continue;
      try {
        pg.pumpRuns();
        pg.frames();
      } catch (e) {
        this.fail(
          'page',
          `${p.name}'s page threw: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`,
        );
      }
    }
    this.checks.frame();
    this.bots.frame();
    // Once a second of room time.
    const sec = Math.floor((this.now() - this.start) / 1000);
    if (sec !== this.seconds) {
      this.seconds = sec;
      this.second();
    }
    // Timers, then waiters.
    for (const t of [...this.timers])
      if (this.now() >= t.at) {
        this.timers.splice(this.timers.indexOf(t), 1);
        try {
          await t.fn();
        } catch (e) {
          this.fail('timer', e instanceof Error ? (e.stack ?? e.message) : String(e));
        }
      }
    for (const w of [...this.waiters]) {
      let ok = false;
      try {
        ok = w.pred();
      } catch (e) {
        this.fail('story', `waiting for ${w.what}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (ok || this.now() >= w.due || this.over) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(ok);
      }
    }
  }

  /** The things that happen once a second: the pages' wars pump, the bots, the checks. */
  private second(): void {
    for (const p of this.players) {
      const pg = p.page;
      if (!pg?.ticking) continue;
      pg.fw.pump();
      // (The pages' own timers run on the wall clock: in virtual mode the soak sends their reports, at the game's pace.)
      if (this.opts.mode === 'virtual' && (this.seconds + p.idx * 7) % 30 === 0)
        void pg.link.reportNow((this.seconds + p.idx * 7) % 300 === 0);
      // Forces that have arrived at a friend's town fight their battles (the game does this with each frame).
      const exps = pg.sim.state.war?.expeditions;
      // (Once time is up, only the forces already at a battle fight it: none that are still on the road begin another.)
      const due = this.draining ? exps?.filter((e) => e.state === 'fighting') : exps;
      if (due?.length)
        pg.away.check(
          due.map((e) => ({ id: e.id, state: e.state, ...(e.help ? { help: e.help.battle } : {}) })),
        );
    }
    for (const p of this.players)
      if (p.page?.ticking && this.now() - p.autosaveAt >= 300_000) this.autosave(p);
    this.bots.second(this.seconds);
    this.checks.second();
  }

  // ---------------------------------------------------------------- what players do to their pages

  /** A word with the room's side: the player's connection drops and comes back by itself. */
  drop(p: Player): void {
    if (!p.up) return;
    this.covered('drops');
    this.checks.disturb(p, 'dropped');
    this.note(`${p.name}'s connection drops`);
    p.page!.link.dropForTest();
  }

  /** The player's network goes for `ms` of room time (in virtual mode the wall clock too): nothing connects until it is back. */
  outage(p: Player, ms: number): void {
    if (!p.up) return;
    this.covered('outages');
    this.checks.disturb(p, 'outage');
    this.note(`${p.name} loses the network for ${Math.round(ms / 1000)} s`);
    p.offline = true;
    p.page!.link.dropForTest();
    this.later(ms, () => {
      p.offline = false;
      this.note(`${p.name}'s network is back`);
    });
  }

  /** The tab closes: the city's last report and save go to the room, and the city stops. */
  async leave(p: Player, why: string): Promise<SaveFile | null> {
    const pg = p.page;
    if (!pg) return null;
    this.checks.disturb(p, why);
    this.note(`${p.name} ${why}`);
    pg.ticking = false;
    this.autosave(p);
    await pg.link.leave();
    p.retired.messages += pg.link.sent.messages;
    p.retired.bytes += pg.link.sent.bytes;
    p.page = null;
    p.upSince = 0;
    return p.autosave;
  }

  /** The tab opens again: the city is loaded from its save and rejoins the region with its place. */
  async comeBack(p: Player): Promise<void> {
    if (p.page || this.over) return;
    p.offline = false;
    p.gen++;
    p.restoredAt = p.autosaveAt;
    const sim = Sim.fromSave(p.autosave!);
    sim.testMode = true;
    this.note(`${p.name} comes back (the city loaded from its save)`);
    try {
      await this.open(p, sim);
    } catch (e) {
      this.fail('rejoin', `${p.name} could not rejoin: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The page dies with no goodbye and comes back from its last autosave after `ms`: the room is only told
   * the connection closed, and what the city did since the autosave is lost.
   */
  async crash(p: Player, ms: number): Promise<void> {
    const pg = p.page;
    if (!p.up || !pg) return;
    this.covered('crashes');
    this.checks.disturb(p, 'crashed');
    const ago = Math.round((this.now() - p.autosaveAt) / 1000);
    this.note(`${p.name}'s page crashes (the last autosave is ${ago} s old)`);
    pg.ticking = false;
    // The link cannot say goodbye: it is cut first, then closed (a link that is not in the region sends nothing).
    p.offline = true;
    pg.link.dropForTest();
    await pg.link.leave();
    p.retired.messages += pg.link.sent.messages;
    p.retired.bytes += pg.link.sent.bytes;
    p.page = null;
    p.upSince = 0;
    this.later(ms, () => this.comeBack(p));
  }

  /** A reload: the tab closes and opens again at once. */
  async reload(p: Player): Promise<void> {
    if (!p.up) return;
    this.covered('reloads');
    await this.leave(p, 'reloads the page');
    await this.comeBack(p);
  }

  /** The player is away for `ms` of room time. */
  async away(p: Player, ms: number): Promise<void> {
    if (!p.up) return;
    this.covered('leaves');
    await this.leave(p, `leaves for ${Math.round(ms / 1000)} s`);
    this.later(ms, () => this.comeBack(p));
  }

  // ---------------------------------------------------------------- the run

  async run(story: (w: Soak) => Promise<void>, disturbances: (w: Soak) => void): Promise<void> {
    const crashed = (e: unknown) => {
      this.rejections++;
      this.fail('unhandled', e instanceof Error ? (e.stack ?? e.message) : String(e));
    };
    process.on('unhandledRejection', crashed);
    process.on('uncaughtException', crashed);
    try {
      await this.setup();
      const end = this.start + this.opts.minutes * 60_000;
      void story(this).catch((e) =>
        this.fail('story', e instanceof Error ? (e.stack ?? e.message) : String(e)),
      );
      if (this.opts.disturb) disturbances(this);
      await this.loop(() => this.now() >= end);
      await this.drain();
    } finally {
      process.off('unhandledRejection', crashed);
      process.off('uncaughtException', crashed);
    }
  }

  /** Past the time asked for: everyone comes back, nothing new begins, and what is on finishes (three minutes at most). */
  private async drain(): Promise<void> {
    this.draining = true;
    this.over = true;
    this.note('time is up: finishing what is under way');
    for (const p of this.players) {
      p.offline = false;
      if (!p.page) await this.comeBack(p);
    }
    const until = this.now() + 180_000;
    const busy = () =>
      this.players.some((p) => {
        const s = p.page?.live.state();
        const exp = p.sim.state.war?.expeditions?.some((e) => e.state === 'fighting');
        return (s && !s.ended) || exp || p.sim.state.war?.battle;
      });
    let quiet = 0;
    await this.loop(() => {
      quiet = busy() ? 0 : quiet + 1;
      return this.now() >= until || quiet > 160;
    });
    // A last word from every page, and the room's.
    for (const p of this.players) await p.page?.link.reportNow(true);
    await this.pace(6);
    await this.loop(() => this.frameNo % 48 === 0);
    this.checks.finish();
  }

  /** Everyone leaves and the relay closes. */
  async close(): Promise<void> {
    for (const p of this.players) {
      try {
        if (p.page) {
          p.retired.messages += p.page.link.sent.messages;
          p.retired.bytes += p.page.link.sent.bytes;
          void p.page.link.leave();
        }
      } catch {
        /* closing */
      }
    }
    await sleep(50);
    await this.relay?.close();
  }

  /** The battle log for an id (made if a page shows it first). */
  battle(id: string): BattleLog | undefined {
    return this.checks.battles.get(id);
  }

  invariants(): void {
    for (const p of this.players)
      if (p.page)
        try {
          checkInvariants(p.page.sim);
        } catch (e) {
          this.fail('invariant', `${p.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
  }
}
