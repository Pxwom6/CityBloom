import { FRIENDS } from '../../relay/protocol';
import type { RegionConn, RegionLimits, RegionRoom } from '../../relay/region';
import type { RegionLink } from '../../src/net/regionLink';
import { AtomRegion } from '../../src/client/atomRegion';
import { RegionOps, resolveOp } from '../../src/client/ops';
import { ATOM } from '../../src/data/atom';
import { DOME, TIER_KEYS } from '../../src/data/research';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { atomHour, atomStage } from '../../src/sim/systems/atom';
import { friendOpsWaiting } from '../../src/sim/systems/regionOps';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { Clock, openRoom, BUSY } from './liveHarness';
import { friendsPage, friendOf, settle, type FwPage } from './friendsHarness';
import { labTown, ok } from './researchTown';

/**
 * M40 step 10's pages: three cities' pages against a real region room in Node, as `friendsHarness`
 * has two for M39. Each page has what a game has for the atom bomb among friends: the wars and treaties
 * (`FriendsWarClient`), the operations road (`RegionOps`, which puts a prepared bomb to the room), the
 * atom sink (`AtomRegion`) and the city taking an operation against it (`resolveOp`). The room's clock
 * is the test's (`Clock`), and its wait for a launch (`atomPrep`) is short or long as a test needs.
 * A city is a lab town with every tier researched, the nuclear plant, the enrichment plant, the silo
 * and the dome finished; a test sets the facts of its race and plays the hours it needs by hand.
 */

const M = TICKS_PER_MONTH;
const civic = (sim: Sim, def: string) => [...sim.state.civics.values()].find((c) => c.def === def)!;

export interface AtomPage extends FwPage {
  atom: AtomRegion;
  ops: RegionOps;
  /** How many strikes the city's sim took (a bomb from a friend, handed to `opResolve` and kept). */
  strikes: number;
  /** The region's notices as the player would see them as toasts. */
  toasts: string[];
  /** The player isn't able to take a strike now (the page answers `later`), as when the city is read-only or away. */
  hold: boolean;
  /**
   * The city's autosave as the game keeps it for the bomb: the city as the page last saved it after a strike was taken
   * here or a strike of this city's was kept by the room (null: not yet). A page that crashes comes back from this.
   */
  autosave: SaveFile | null;
}

export interface AtomWorld {
  clock: Clock;
  room: RegionRoom;
  ada: AtomPage;
  sam: AtomPage;
  cal: AtomPage;
  pages: AtomPage[];
}

/** Three saved cities, built once by a test file (a few seconds) and loaded afresh for each test. */
export interface AtomSaves {
  ada: SaveFile;
  sam: SaveFile;
  cal: SaveFile;
}

/**
 * The lab town the bomb's own tests use (`labTown(0, { length: 800, streets: 7 })`, the smallest that
 * crews the plant, silo and dome together), with every tier, the nuclear plant, the two buildings of
 * the race and the dome finished, and every computer neighbour dark for good (no raids or spies).
 */
export function baseTown(): Sim {
  const { sim, place } = labTown(0, { length: 800, streets: 7 });
  for (const n of sim.state.region.neighbours) if (n.rival) n.rival.blackout = { from: 0, until: 1e9 };
  place('nuclear');
  sim.advance(M);
  ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
  ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
  for (const def of ['enrichment', 'atomsilo', 'domeshield'])
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place(def) });
  sim.advance(3 * M);
  return sim;
}

/** Three cities made of one base town: other names and other winds (the seed), as three games would have. */
export function buildAtomSaves(base: Sim = baseTown()): AtomSaves {
  const save = base.save();
  const city = (name: string, seed: string): SaveFile => {
    const sim = Sim.fromSave(JSON.parse(JSON.stringify(save)) as SaveFile);
    sim.state.cityName = name;
    sim.state.options.seed = seed;
    return sim.save();
  };
  return {
    ada: city('Adaville', 'ada-atom'),
    sam: city('Samford', 'sam-atom'),
    cal: city('Calbury', 'cal-atom'),
  };
}

const loaded = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(JSON.parse(JSON.stringify(save)) as SaveFile);
  sim.testMode = true;
  return sim;
};

/**
 * A page of the game for the bomb: the wars and treaties, the operations road, the atom sink, the strike taken.
 * `onKeep` is told whenever the page saves the city for the room (`friendsPage`'s own); `afterTaken` runs
 * when the city has taken an operation and before the room is told (the game saves the city then: M40
 * step 13's soak keeps its autosave there, so a crash never loses a strike); `afterFired` runs when the room
 * has kept a strike of this city's and the city has fired the bomb (`RegionOps`' `keep`: the game saves the city
 * then too, so a crash never loses the firing).
 */
export async function atomPage(
  o: Parameters<typeof friendsPage>[0],
  clock: Pick<Clock, 'now'>,
  onKeep?: () => void,
  afterTaken?: () => void,
  afterFired?: () => void,
): Promise<AtomPage> {
  const sim = o.sim;
  const atom = new AtomRegion({
    command: async (cmd) => sim.dispatch(cmd),
    now: clock.now,
    changed: () => undefined,
  });
  let strikes = 0;
  const toasts: string[] = [];
  // (A strike kept while the player was away is offered in the welcome, before the page exists: the handler needs only these.)
  const ctl = { hold: false, autosave: null as SaveFile | null };
  let link!: RegionLink;
  const page = (await friendsPage(
    {
      ...o,
      link: { saveEvery: 1e12, ...o.link },
      // An operation against the city, as `Game.takeOp` takes it: the sim has it, and the city is saved before the room hears.
      op: async (opOn) => {
        if (ctl.hold) return 'later';
        if (!link.view?.cities.some((c) => c.slot === opOn.from)) return 'refused';
        const answer = await resolveOp({ command: async (cmd) => sim.dispatch(cmd) }, opOn);
        if (answer === 'taken') {
          strikes++;
          ctl.autosave = sim.save();
          afterTaken?.();
        }
        return answer;
      },
      beforeStart: (l) => {
        link = l;
        atom.attach(l);
        l.onNotice = (t) => void toasts.push(t);
        o.beforeStart?.(l);
      },
    },
    clock,
    onKeep,
  )) as AtomPage;
  page.atom = atom;
  page.toasts = toasts;
  Object.defineProperty(page, 'autosave', { get: () => ctl.autosave, enumerable: true });
  Object.defineProperty(page, 'hold', {
    get: () => ctl.hold,
    set: (v: boolean) => void (ctl.hold = v),
    enumerable: true,
  });
  page.ops = new RegionOps({
    command: async (cmd) => sim.dispatch(cmd),
    post: (op) => page.link.sendOp(op, 5_000),
    fetchSave: (slot) => page.link.fetchSave(slot),
    // As `Game.ops` does: a strike of this city's that the room kept is applied, and the city is saved then.
    keep: async () => {
      ctl.autosave = sim.save();
      afterFired?.();
      return true;
    },
  });
  Object.defineProperty(page, 'strikes', { get: () => strikes, enumerable: true });
  // What the game does with each frame: the operations waiting for the region, and the race's stage.
  const frames = page.frames.bind(page);
  page.frames = () => {
    frames();
    if (page.deaf) return;
    page.ops.check(friendOpsWaiting(sim));
    atom.frame(sim.state.war ? atomStage(sim) : undefined);
  };
  return page;
}

/** A fresh room and three pages open (Ada made the region, Sam is slot 2, Calbury 3), their cities as saved. */
export async function openAtomWorld(
  saves: AtomSaves,
  limits: Partial<RegionLimits> = {},
  clock: Clock = new Clock(),
): Promise<AtomWorld> {
  const room = openRoom(clock, { ...BUSY, ...limits });
  const sims = { ada: loaded(saves.ada), sam: loaded(saves.sam), cal: loaded(saves.cal) };
  const rules = { war: true, scale: 'total', supers: true, bomb: true } as never;
  const ada = await atomPage(
    { room, clock, sim: sims.ada, mayor: 'Ada', color: 0, create: { name: 'Three Rivers', rules } },
    clock,
  );
  const sam = await atomPage({ room, clock, sim: sims.sam, mayor: 'Sam', color: 1 }, clock);
  const cal = await atomPage({ room, clock, sim: sims.cal, mayor: 'Cal', color: 2 }, clock);
  const w: AtomWorld = { clock, room, ada, sam, cal, pages: [ada, sam, cal] };
  // Each has reported itself and been told of the others (the pages that opened first learn with the next report).
  for (let k = 0; k < 2; k++) await tick3(w);
  for (const p of w.pages) p.sim.dispatch({ type: 'cheat', cheat: 'unshield' });
  await tick3(w);
  // (The first frame of a page only learns where the city's race stands; a change after it is told to the room.)
  for (const p of w.pages) p.frames();
  return w;
}

/** Every page reports (the room looks at the clock with each message) and the messages settle. */
export async function tick3(w: Pick<AtomWorld, 'pages'>): Promise<void> {
  for (const p of w.pages) await p.link.reportNow(true);
  await settle();
}

/** `from` declares a total war on `to` and the warning runs out: the war is open in both cities. */
export async function totalWar(w: AtomWorld, from: AtomPage, to: AtomPage): Promise<void> {
  expectTrue(from.fw.declare(to.link.slot, 'total', 'The race'), 'the declaration was sent');
  await settle();
  w.clock.advance(FRIENDS.warning + 1_000);
  await tick3(w);
}

function expectTrue(v: boolean, what: string): void {
  if (!v) throw new Error(`Expected: ${what}`);
}

/** The crews are in and the power is on: the plant, silo and dome work at full rate. */
export function crewed(sim: Sim): void {
  for (const def of ['enrichment', 'atomsilo', 'domeshield']) {
    civic(sim, def).staff = 1;
    civic(sim, def).powered = 1;
  }
}

/** The dome is charged (its hours made) and in the mode that stops a bomb. */
export function chargeDome(sim: Sim): void {
  crewed(sim);
  const supers = (sim.state.war!.supers ??= {});
  supers.dome = { ...(supers.dome ?? { hours: 0, mode: 'all' }), hours: DOME.chargeHours, mode: 'all' };
}

/**
 * The city's bomb is finished and a launch at the friend is half prepared (facts set by the test
 * cheat) with the crews in: its stage is now `preparing`, which its page tells the room at its next frame.
 */
export function prepare(page: AtomPage, at: AtomPage): void {
  const to = friendOf(page, at.link.slot).id;
  ok(page.sim, { type: 'cheat', cheat: 'atom', stage: 'preparing', to });
  crewed(page.sim);
}

/**
 * The rest of the preparation is played out hour by hour; when it ends the bomb is put to the room (a total
 * war must be open with the friend for that), and the page puts it there at its next frame.
 */
export function finishPrep(page: AtomPage): void {
  const sim = page.sim;
  for (let k = 0; k < ATOM.launch.prepHours && !sim.state.war!.atom!.prep!.send; k++) atomHour(sim);
}

/** The page of a city that left and comes back: the same sim, its place in the region kept by its secret. */
export async function returnPage(
  w: AtomWorld,
  was: AtomPage,
  mayor: string,
  color: number,
): Promise<AtomPage> {
  const page = await atomPage(
    {
      room: w.room,
      clock: w.clock,
      sim: was.sim,
      mayor,
      color,
      rejoin: { slot: was.link.slot, secret: was.link.secret },
    },
    w.clock,
  );
  w.pages.splice(w.pages.indexOf(was), 1, page);
  await settle(8);
  return page;
}

/**
 * A page of the game as it was before the bomb (protocol 6) takes a city's place in the room: a raw
 * connection that says hello for it and listens, as the room's own tests do. The room treats the city
 * as here, on a version that can neither race for the bomb nor be struck by it.
 */
export function olderPage(w: AtomWorld, was: AtomPage, mayor: string, color: number): RegionConn {
  const conn: RegionConn = { send: () => undefined, close: () => undefined };
  w.room.open(conn);
  w.room.message(
    conn,
    JSON.stringify({
      t: 'rhello',
      v: 6,
      mayor,
      color,
      city: was.sim.state.cityName,
      rejoin: { slot: was.link.slot, secret: was.link.secret },
    }),
  );
  return conn;
}
