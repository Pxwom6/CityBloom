import { RegionRoom, MemoryRegionStore, type RegionConn, type RegionLimits } from '../../relay/region';
import { loopbackPair, type Link } from '../../src/net/link';
import { RegionLink, type CityPort } from '../../src/net/regionLink';
import { AwayBattles } from '../../src/client/battles';
import type { BattleRecord } from '../../src/client/battles';
import { LiveBattles, type LiveRunnerHandlers } from '../../src/client/liveBattles';
import { LiveRunner, pumpRun } from '../../src/client/liveRunner';
import { awayCity } from '../../src/sim/battle/away';
import type { BattleInput } from '../../src/sim/battle/types';
import type { SaveFile } from '../../src/sim/save';
import type { Sim } from '../../src/sim/sim';
import { regionReport, type RegionReport } from '../../src/sim/systems/region';
import { BATTLE_BUSY, awayCaps } from '../../src/sim/systems/raids';

/**
 * Two pages of M39's live battles against a real region room, in Node: each is a city's sim, a
 * `RegionLink` to the room, and the `LiveBattles` a `Game` would have, with the battle worker's runner
 * done in-process and a clock the test moves. `drive()` is the game's clock: the defender's sim ticks
 * (8 a second at 1×, two battle steps each), the attacker's runner steps at its pace, frames reach the
 * pages, and messages cross the room.
 */
export class Clock {
  // Midday UTC on some day, so a test's day doesn't end under it.
  t = 1_800_000_000_000 + 12 * 3_600_000;
  now = (): number => this.t;
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Messages in flight arrive. */
export const flush = () => new Promise<void>((r) => setImmediate(r));

/** A room's limits for a test that sends far more than two messages a second. */
export const BUSY: Partial<RegionLimits> = { rate: 1_000, burst: 100_000 };

export function loopTo(room: RegionRoom): () => Promise<Link> {
  return async () => {
    const [mine, theirs] = loopbackPair();
    const conn: RegionConn = { send: (m) => theirs.send(JSON.stringify(m)), close: () => theirs.close() };
    room.open(conn);
    theirs.onmessage = (t) => room.message(conn, t);
    theirs.onclose = () => room.closed(conn);
    return mine;
  };
}

export function openRoom(clock: Clock, limits: Partial<RegionLimits> = BUSY, code = '7LIVE2'): RegionRoom {
  return new RegionRoom(code, 'local', new MemoryRegionStore(), { now: clock.now }, limits);
}

interface Run {
  run: LiveRunner;
  on: LiveRunnerHandlers;
  shown: { step: number };
  stopped: boolean;
  ended: boolean;
}

export interface Page {
  name: string;
  sim: Sim;
  link: RegionLink;
  live: LiveBattles;
  away: AwayBattles;
  /** The attacker's runners, in-process. */
  runs: Run[];
  /** What the page kept to watch again: towns by key, battles. */
  kept: { towns: Map<string, SaveFile>; battles: BattleRecord[] };
  /** Battles the city took by the old way (or late): the input, and how. */
  taken: { input: BattleInput; late: boolean; from: number }[];
  /** The sim ticks in `drive` (a city that is playing), or is left as it is. */
  ticking: boolean;
  /** Frames not sent to the live battles (a page that has stopped looking). */
  deaf: boolean;
  /** Things a test lets happen at a moment of the page's answering a call. */
  hooks: { autosave?: () => Promise<void> };
  /** Tell the live battles what the sim did this tick (a page that is looking). */
  frames(): void;
  pumpRuns(): void;
}

export async function openPage(o: {
  room: RegionRoom;
  clock: Clock;
  sim: Sim;
  mayor: string;
  color: number;
  create?: { name: string; rules: { war: boolean; scale: 'skirmish'; supers?: true } };
  rejoin?: { slot: number; secret: string };
  /** A page's own parts that must be on the link before it says hello (M39 step 5b: wars between friends). */
  beforeStart?: (link: RegionLink) => void;
}): Promise<Page> {
  const { sim, clock } = o;
  const taken: Page['taken'] = [];
  const kept: Page['kept'] = { towns: new Map(), battles: [] };
  const port: CityPort = {
    command: async (cmd) => sim.dispatch(cmd),
    report: async (): Promise<RegionReport> => regionReport(sim),
    save: async () => sim.save(),
    cityName: () => sim.state.cityName,
    battle: async (input, meta) => {
      if (meta.away) input = awayCaps(input);
      taken.push({ input, late: meta.late, from: meta.from });
      const r = sim.dispatch({
        type: 'battleResolve',
        input,
        mode: meta.late ? 'instant' : 'watch',
        from: meta.from,
        ...(meta.super ? { super: true } : {}),
      });
      return r.ok ? 'taken' : r.reason === BATTLE_BUSY ? 'later' : 'refused';
    },
  };
  const link = new RegionLink(port, loopTo(o.room), {
    mayor: o.mayor,
    color: o.color,
    saveEvery: 0,
    fairClock: false,
    reportEvery: 1_000_000,
    ...(o.create ? { create: o.create } : {}),
    ...(o.rejoin ? { rejoin: o.rejoin } : {}),
  });
  const runs: Run[] = [];
  const live = new LiveBattles({
    now: clock.now,
    city: {
      query: async (q) => sim.query(q) as never,
      preview: async (cmd) => sim.preview(cmd),
      command: async (cmd) => sim.dispatch(cmd),
      save: async () => sim.save(),
      autosave: async () => {
        await page.hooks.autosave?.();
        return true;
      },
      cityName: () => sim.state.cityName,
      tick: () => sim.state.tick,
      speed: () => 1,
      setSpeed: () => undefined,
      notice: () => undefined,
    },
    store: {
      keepTown: async (key, save) => void kept.towns.set(key, save),
      keepBattle: async (r) => void kept.battles.push(r),
    },
    runner: (input, on) => {
      const r: Run = {
        run: new LiveRunner(input, clock.now),
        on,
        shown: { step: -2 },
        stopped: false,
        ended: false,
      };
      runs.push(r);
      on.frame(0, r.run.frame());
      return {
        feed: (orders, allow, rush) => {
          r.run.feed(orders, allow);
          if (rush) r.run.rush();
        },
        stop: () => void (r.stopped = true),
      };
    },
    report: async (expedition, result) => sim.dispatch({ type: 'battleReport', expedition, result }).ok,
    settle: async (expedition, on) => sim.dispatch({ type: 'battleSettling', expedition, on }).ok,
    fetchSave: (slot) => link.fetchSave(slot),
  });
  live.attach(link);
  const away = new AwayBattles({
    query: async (q) => sim.query(q) as never,
    report: async (expedition, result) => sim.dispatch({ type: 'battleReport', expedition, result }).ok,
    tick: () => sim.state.tick,
    changed: () => undefined,
    fetchSave: (slot) => link.fetchSave(slot),
    postBattle: (slot, input, away) => link.sendBattle(slot, input, away, 2_000),
    mayStrike: () => null,
    recall: async (expedition) => void sim.dispatch({ type: 'recallForce', expedition }),
    settle: async (expedition, on) => sim.dispatch({ type: 'battleSettling', expedition, on }).ok,
    live: (city, expedition) => live.attack(city, expedition),
  });
  const page: Page = {
    name: o.mayor,
    sim,
    link,
    live,
    away,
    runs,
    kept,
    taken,
    ticking: true,
    deaf: false,
    hooks: {},
    frames() {
      if (page.deaf) return;
      const war = sim.state.war?.battle ? (sim.stats().war ?? null) : null;
      live.frame(war, sim.events.splice(0));
    },
    pumpRuns() {
      for (const r of runs) {
        if (r.stopped || r.ended) continue;
        r.ended = pumpRun(r.run, r.shown, r.on);
      }
    },
  };
  links.push(link);
  o.beforeStart?.(link);
  await link.start();
  await flush();
  return page;
}

const links: RegionLink[] = [];
/** Close every link a test opened. */
export function closePages(): void {
  for (const l of links.splice(0)) l.leave();
}

/**
 * The game's clock for a while: `ticks` of the city's (at 1×: 8 a second, 125 ms each), and what
 * happens in each: the city's sim ticks, the attacker's runner steps at its pace, frames reach the
 * pages (which tell the room how far they have got), and the messages cross. `each` runs after a tick.
 */
export async function drive(
  pages: Page[],
  ticks: number,
  clock: Clock,
  each?: (tick: number) => void | Promise<void>,
  ms = 125,
): Promise<void> {
  for (let k = 0; k < ticks; k++) {
    clock.advance(ms);
    for (const p of pages) if (p.ticking) p.sim.step();
    for (const p of pages) p.pumpRuns();
    for (const p of pages) p.frames();
    await flush();
    await each?.(k);
  }
}

/** Drive until `done` (checked after each tick), at most `max` ticks; false if it never was. */
export async function driveUntil(
  pages: Page[],
  clock: Clock,
  done: () => boolean,
  max = 6_000,
  each?: (tick: number) => void | Promise<void>,
): Promise<boolean> {
  for (let k = 0; k < max; k++) {
    await drive(pages, 1, clock);
    await each?.(k);
    if (done()) return true;
  }
  return false;
}

export { awayCity };
