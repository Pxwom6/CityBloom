/**
 * A page's copy of the region's bomb record is never put back by an older one (M40 step 13, found by the
 * region soak's atom act).
 *
 * The target's connection is down when the bomb lands in its city, and comes back. The welcome handler of
 * `RegionLink` (src/net/regionLink.ts, case 'rwelcome') used to do `await this.take(...)`, `await
 * this.reportNow(true)` (the report is sent, then the whole city is saved: a worker round trip) and only then
 * hand the welcome's `atoms` and `winters` to the AtomRegion. The report is what tells the room the bomb fell
 * (`hit`); the room adds the mark `boom` to its record and sends `{t:'atoms'}` to every page, and that message
 * was handled while the welcome handler was still waiting for the save: the welcome's older copy of the record
 * (without `boom`) then overwrote it, and the page kept the record without the mark of the bomb that fell on its
 * own city until the record next changed or the page was reloaded. The winters have the same shape. The
 * welcome's copy is now applied first thing, in the order the room sent it. This is the whole path through a
 * real room; `atomWelcomeOrder.test.ts` holds the same ordering with the room's messages delivered by hand.
 *
 * Found by the soak's atom act with the target losing its network for 19 s in the countdown (the bomb landed while
 * it was away): `region: Lou's page keeps the bomb's record ["2:ready","2:fired"], the room
 * ["2:ready","2:fired","4:boom"]`, standing for eleven minutes until the page was reloaded.
 */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { ATOM } from '../../src/data/atom';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { closePages } from './liveHarness';
import { settle } from './friendsHarness';
import {
  baseTown,
  buildAtomSaves,
  finishPrep,
  openAtomWorld,
  prepare,
  tick3,
  totalWar,
  type AtomSaves,
} from './atomFriendsHarness';

vi.setConfig({ testTimeout: 240_000 });
afterEach(() => closePages());
let saves: AtomSaves;
beforeAll(() => {
  saves = buildAtomSaves(baseTown());
}, 600_000);

it("a target that was offline when the bomb landed has the room's whole record when it comes back", async () => {
  const w = await openAtomWorld(saves, { atomPrep: 60_000 });
  const { ada, sam, clock } = w;
  await totalWar(w, ada, sam);
  prepare(ada, sam);
  ada.frames();
  await settle(8);
  clock.advance(61_000);
  await tick3(w);
  finishPrep(ada);
  ada.frames();
  await settle(8);
  expect(sam.strikes).toBe(1);
  // Samford's connection drops; the bomb lands in its city while it is away from the region.
  sam.link.dropForTest();
  sam.sim.advance(ATOM.flight.hours * TICKS_PER_HOUR + 40 * TICKS_PER_HOUR);
  await new Promise((r) => setTimeout(r, 1_500));
  await settle(16);
  await tick3(w);
  // The room's record has the bomb that fell (a mark `boom` for Samford), and Samford's page has the same marks.
  expect(ada.atom.atoms.map((m) => m.kind)).toContain('boom');
  expect(sam.atom.atoms.map((m) => m.kind)).toEqual(ada.atom.atoms.map((m) => m.kind));
  expect(sam.atom.atoms).toEqual(ada.atom.atoms);
});
