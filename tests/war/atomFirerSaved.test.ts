/**
 * A firer that crashes after the room keeps its strike still has fired (M40 step 13, found by the region soak).
 *
 * The room keeps one atom strike a city, ever, and says so at once (`opKept`). The firer's page then applies the
 * answer to its sim (`missionResult`: the bomb is `fired`, the city a pariah with no reputation), but nothing saved
 * the city then: a page that crashed came back from its last autosave, a city that had not fired and was no pariah,
 * while the room held its bomb as used for good and every later send was refused. A city that takes a strike has
 * always been saved before the room is told (`Game.takeOp`); the firer is saved right after it has applied the
 * answer (`RegionOps`' `keep`, the game's autosave).
 */
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { KEEP_GAP, KEEP_TRIES, RegionOps } from '../../src/client/ops';
import type { OpSent } from '../../src/net/regionLink';
import { fail, ok } from '../../src/sim/commands';
import { Sim } from '../../src/sim/sim';
import type { SaveFile } from '../../src/sim/save';
import { isPariah, reputationOf } from '../../src/sim/systems/diplomacy';
import type { FriendOp, FriendOpWaiting } from '../../src/sim/systems/regionOps';
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

/** The city as a page that crashed and came back would load it. */
const comeBack = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(JSON.parse(JSON.stringify(save)) as SaveFile);
  sim.testMode = true;
  return sim;
};

it('a firer restored from its latest autosave still holds that it fired, a pariah with no reputation', async () => {
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
  // The room kept the strike and the target's city took it; the firer's sim applied the room's answer.
  expect(sam.strikes).toBe(1);
  expect(ada.sim.state.war!.atom!.fired?.slot).toBe(sam.link.slot);
  expect(isPariah(ada.sim)).toBe(true);
  // Ada's page crashes now and comes back from the last autosave it made.
  expect(ada.autosave, 'the page saved the city after the room kept its strike').not.toBeNull();
  const back = comeBack(ada.autosave!);
  expect(back.state.war!.atom!.fired?.slot).toBe(sam.link.slot);
  expect(isPariah(back)).toBe(true);
  expect(reputationOf(back)).toBe(0);
});

it('a strike the room turned away is not saved as a firing', async () => {
  // The room wants its own twenty minutes of preparation: the bomb is sent too early and stays in the silo.
  const w = await openAtomWorld(saves, { atomPrep: 3_600_000 });
  const { ada, sam } = w;
  await totalWar(w, ada, sam);
  prepare(ada, sam);
  ada.frames();
  await settle(8);
  finishPrep(ada);
  ada.frames();
  await settle(8);
  expect(sam.strikes).toBe(0);
  expect(ada.sim.state.war!.atom!.fired).toBeUndefined();
  expect(ada.autosave).toBeNull();
});

// ---- RegionOps on its own: when it saves the city, and how it copes when the save does not happen at once ----

const waiting = (op: FriendOp): FriendOpWaiting => ({
  mission: 7,
  key: `k-${op}`,
  slot: 2,
  op,
  settling: true,
});

/** An operations helper with a recording host: `keep` answers from `keeps` in turn (then true). */
function ops(o: { kept: OpSent; ok?: boolean; keeps?: (boolean | 'throw')[] }) {
  const calls = { commands: [] as string[], keeps: 0 };
  const keeps = [...(o.keeps ?? [])];
  const helper = new RegionOps({
    command: async (cmd) => {
      calls.commands.push(cmd.type);
      return o.ok === false ? fail('No such operation waiting for the region') : ok(0);
    },
    post: async () => o.kept,
    fetchSave: () => Promise.reject(new Error('not needed')),
    keep: async () => {
      calls.keeps++;
      const next = keeps.shift() ?? true;
      if (next === 'throw') throw new Error('the save failed');
      return next;
    },
  });
  return { helper, calls };
}

it('saves the city after the region kept an atom strike and the city applied it', async () => {
  const { helper, calls } = ops({ kept: { kept: true, outcome: 'success' } });
  await helper.settle(waiting('atom'));
  expect(calls.commands).toEqual(['missionResult']);
  expect(calls.keeps).toBe(1);
});

it('does not save for a strike the region turned away, or one the city could not apply', async () => {
  const away = ops({ kept: { kept: false, reason: 'no total war is open' } });
  await away.helper.settle(waiting('atom'));
  expect(away.calls.commands).toEqual(['missionResult']);
  expect(away.calls.keeps).toBe(0);
  const unapplied = ops({ kept: { kept: true, outcome: 'success' }, ok: false });
  await unapplied.helper.settle(waiting('atom'));
  expect(unapplied.calls.keeps).toBe(0);
  const none = ops({ kept: null });
  await none.helper.settle(waiting('atom'));
  expect(none.calls.keeps).toBe(0);
});

it('does not save for the other operations (an agent’s look round has no bomb in it)', async () => {
  const { helper, calls } = ops({ kept: { kept: true, outcome: 'success' } });
  await helper.settle(waiting('reveal'));
  await helper.settle(waiting('blackout'));
  expect(calls.commands).toEqual(['missionResult', 'missionResult']);
  expect(calls.keeps).toBe(0);
});

it('tries the save again when one is already under way, and does not trip over a save that fails', async () => {
  vi.useFakeTimers();
  try {
    // A save under way says no twice (the game's `saving`), then saves.
    const busy = ops({ kept: { kept: true, outcome: 'success' }, keeps: [false, false, true] });
    const done = busy.helper.settle(waiting('atom'));
    await vi.advanceTimersByTimeAsync(KEEP_GAP * KEEP_TRIES);
    await done;
    expect(busy.calls.keeps).toBe(3);
    // A save that throws is tried again as well, and in the end gives up without an error: the autosave makes it good.
    const broken = ops({
      kept: { kept: true, outcome: 'success' },
      keeps: ['throw', 'throw', 'throw', 'throw', 'throw', 'throw'],
    });
    const gone = broken.helper.settle(waiting('atom'));
    await vi.advanceTimersByTimeAsync(KEEP_GAP * KEEP_TRIES);
    await expect(gone).resolves.toBeUndefined();
    expect(broken.calls.keeps).toBe(KEEP_TRIES);
  } finally {
    vi.useRealTimers();
  }
});
