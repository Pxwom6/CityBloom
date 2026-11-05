import { FriendsWarClient } from '../../src/client/friendsWar';
import type { FriendWar } from '../../relay/protocol';
import type { RegionRoom } from '../../relay/region';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { Clock, flush, openPage, openRoom, type Page } from './liveHarness';
import { armAda, armSam, liveTown } from './liveTown';

/**
 * M39 step 5b's pages: two cities' pages against a real region room in Node, each with what a game
 * has for wars and treaties between friends (`FriendsWarClient`) beside the live battles of step 3.
 * The room's clock is the test's (`Clock`); a sim moves only when a test advances it or drives it.
 */

export interface FwPage extends Page {
  fw: FriendsWarClient;
  /** Every notice the page showed, and how many times it saved the city for the room. */
  notices: string[];
  kept: Page['kept'] & { readonly saves: number };
}

/** Messages and the page's chain of promises settle. */
export async function settle(n = 4): Promise<void> {
  for (let k = 0; k < n; k++) await flush();
}

/** A page of the game: the helper that has the wars and treaties with friends, attached before the link says hello. */
export async function friendsPage(
  o: Parameters<typeof openPage>[0],
  clock: Pick<Clock, 'now'>,
  /** Told whenever the page saves the city for the room (a game keeps its autosave then: M39 step 10's crashes start from it). */
  onKeep?: () => void,
): Promise<FwPage> {
  const notices: string[] = [];
  let saves = 0;
  const fw = new FriendsWarClient({
    command: async (cmd) => o.sim.dispatch(cmd),
    query: async <T>(q: Parameters<Sim['query']>[0]) => o.sim.query(q) as T,
    keep: async () => {
      saves++;
      onKeep?.();
      return true;
    },
    notice: (_key, text) => void notices.push(text),
    now: clock.now,
    changed: () => undefined,
  });
  const page = await openPage({
    ...o,
    beforeStart: (link) => {
      fw.attach(link);
      o.beforeStart?.(link);
    },
  });
  const p = page as FwPage;
  p.notices = notices;
  p.fw = fw;
  Object.defineProperty(p.kept, 'saves', { get: () => saves, enumerable: true });
  // The events a page's frames carry are told to `fw` first (the game does that when a frame arrives).
  const frames = page.frames.bind(page);
  page.frames = () => {
    fw.events(page.sim.events.slice());
    frames();
  };
  return p;
}

export interface World {
  clock: Clock;
  room: RegionRoom;
  ada: FwPage;
  sam: FwPage;
}

/** Two saved cities, built once by a test file (a few seconds each) and loaded afresh for each test. */
export interface Saves {
  ada: SaveFile;
  sam: SaveFile;
}

/** Ada's and Sam's towns in a region at war, saved: plain towns, or armed ones with forces and defences. */
export async function buildSaves(armed: boolean): Promise<Saves> {
  const clock = new Clock();
  const room = openRoom(clock);
  const ada = liveTown('ada-live', 'Adaville');
  const sam = liveTown('sam-live', 'Samford');
  const a = await openPage({
    room,
    clock,
    sim: ada.sim,
    mayor: 'Ada',
    color: 0,
    create: { name: 'Two Rivers', rules: { war: true, scale: 'total', supers: true } as never },
  });
  const s = await openPage({ room, clock, sim: sam.sim, mayor: 'Sam', color: 1 });
  if (armed) {
    armAda(ada);
    armSam(sam);
  } else {
    // Settled for a month so each has taxes to speak of.
    ada.sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    sam.sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    sam.sim.dispatch({ type: 'cheat', cheat: 'unshield' });
    ada.sim.dispatch({ type: 'cheat', cheat: 'unshield' });
  }
  const saves = { ada: ada.sim.save(), sam: sam.sim.save() };
  a.link.leave();
  s.link.leave();
  return saves;
}

const loaded = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  return sim;
};

/** A fresh room with Ada's and Sam's pages open (Ada made the region; Sam is slot 2), their cities as saved. */
export async function openWorld(saves: Saves, clock: Clock = new Clock()): Promise<World> {
  const room = openRoom(clock);
  const ada = await friendsPage(
    {
      room,
      clock,
      sim: loaded(saves.ada),
      mayor: 'Ada',
      color: 0,
      create: { name: 'Two Rivers', rules: { war: true, scale: 'total', supers: true } as never },
    },
    clock,
  );
  const sam = await friendsPage({ room, clock, sim: loaded(saves.sam), mayor: 'Sam', color: 1 }, clock);
  // Each has reported itself (the room knows the other as a neighbour), and told the other's sim so.
  await ada.link.reportNow(true);
  await sam.link.reportNow(true);
  await settle();
  // The pages that opened before the other joined learn of each other with the next report.
  await ada.link.reportNow(true);
  await settle();
  return { clock, room, ada, sam };
}

/** The neighbour in a city's sim that is the other's. */
export const friendOf = (page: Page, slot: number) =>
  page.sim.state.region.neighbours.find((n) => n.player?.slot === slot)!;

/** The mirror of the war with a friend, in a city's sim. */
export const mirrorWar = (page: Page, slot: number) =>
  page.sim.state.war?.diplomacy?.wars.find((w) => w.with === friendOf(page, slot).id);

/** Make the room notice that time has passed: a report is a message, and every message looks at the clock. */
export async function tickRoom(w: Pick<World, 'ada' | 'sam'>): Promise<void> {
  await w.ada.link.reportNow(true);
  await w.sam.link.reportNow(true);
  await settle();
}

type RoomPoke = { meta: { friends?: { wars: FriendWar[] } } };
/** Set up a lost war: the room's war between the two, its score changed by hand (the room's own tests play the battles). */
export function pokeWar(room: RegionRoom, fn: (w: FriendWar) => void): void {
  const meta = (room as unknown as RoomPoke).meta;
  for (const w of meta.friends?.wars ?? []) fn(w);
}
