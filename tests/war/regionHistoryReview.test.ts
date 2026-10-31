import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FRIENDS } from '../../relay/protocol';
import { FriendsWarClient } from '../../src/client/friendsWar';
import { STATE_WORDS, historyState } from '../../src/client/regionHistory';
import { Clock, closePages } from './liveHarness';
import { buildSaves, friendsPage, openWorld, settle, tickRoom, type Saves } from './friendsHarness';
import { wallClock } from '../../src/net/p2p';

/**
 * M39 step 7's review: the region's war history through a real room and two pages, where the clock
 * is not whole milliseconds (a region hosted in a browser) and where a page is slow to take the
 * room's welcome while the room goes on talking.
 */
afterEach(() => closePages());

let plain: Saves;

beforeAll(async () => {
  plain = await buildSaves(false);
  closePages();
}, 300_000);

/** A clock like `performance.now()`: fractions of a millisecond, counted from some start. */
class FractionalClock extends Clock {
  override now = (): number => this.t + 0.7000000477;
}

describe('M39 step 7 review: the clock of a region hosted in a browser', () => {
  it('is real time in whole milliseconds that never goes back, not the page’s uptime', () => {
    const a = wallClock();
    const b = wallClock();
    expect(Number.isInteger(a) && Number.isInteger(b)).toBe(true);
    expect(b).toBeGreaterThanOrEqual(a);
    // Within a few seconds of the wall clock (the epoch), so the history’s dates are the real ones.
    expect(Math.abs(b - Date.now())).toBeLessThan(5_000);
  });
});

describe('M39 step 7 review: the history on a room whose clock has fractions', () => {
  it('keeps every event a room on a fractional clock writes, with their times', async () => {
    const clock = new FractionalClock();
    clock.t = 5372; // a host that opened its page a few seconds ago, counted from the page's load
    const w = await openWorld(plain, clock);
    const { ada, sam } = w;
    expect(ada.fw.declare(sam.link.slot, 'war', 'Your border')).toBe(true);
    await settle();
    clock.advance(FRIENDS.warning + 1_000);
    await tickRoom(w);
    for (const p of [ada, sam]) {
      const h = p.fw.view().history;
      expect(h.map((e) => e.kind)).toEqual(expect.arrayContaining(['declared', 'opened']));
      for (const e of h) expect(Number.isInteger(e.at)).toBe(true);
    }
  }, 120_000);
});

describe('M39 step 7 review: a page slow to take the welcome', () => {
  it('loses nothing the room says meanwhile: a proposal waiting for it, a war declared, the history', async () => {
    const w = await openWorld(plain);
    const { ada, sam } = w;
    const [A, S] = [ada.link.slot, sam.link.slot];
    // Sam’s page is closed; Ada puts a treaty to it, which the room keeps for Sam.
    const { slot, secret } = sam.link;
    await sam.link.leave();
    await settle();
    expect(ada.fw.propose(S, [{ k: 'nonAggression', months: 6 }]).sent).toBe(true);
    await settle();
    // It comes back, but takes its time answering the welcome (the picture and the save of the city).
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const coming = friendsPage(
      {
        room: w.room,
        clock: w.clock,
        sim: sam.sim,
        mayor: 'Sam',
        color: 1,
        rejoin: { slot, secret },
        reportGate: gate,
      },
      w.clock,
    );
    await settle(8);
    // Meanwhile the room goes on: the proposal it keeps for Sam follows its welcome, and Ada declares war.
    expect(ada.fw.declare(S, 'war', 'Your border')).toBe(true);
    await settle(8);
    open();
    const back = await coming;
    await settle(8);
    const v = back.fw.view();
    expect(v.incoming).toHaveLength(1);
    expect(v.incoming[0]!.with).toBe(A);
    expect(v.wars).toHaveLength(1);
    expect(v.wars[0]).toMatchObject({ a: A, b: S, state: 'declared' });
    expect(v.history.map((e) => e.kind)).toContain('declared');
    // The sim has the war too (mirrored once the welcome was taken).
    expect(back.sim.state.war!.diplomacy!.wars.some((x) => x.friend?.slot === A)).toBe(true);
  }, 120_000);
});

describe('M39 step 7 review: a region of an older version', () => {
  const client = () =>
    new FriendsWarClient({
      command: async () => ({ ok: true, cost: 0 }) as never,
      query: async () => ({}) as never,
      keep: async () => true,
      notice: () => undefined,
      now: () => 0,
      changed: () => undefined,
    });

  it('says it keeps no history, instead of "asking the region" for ever', () => {
    const fw = client();
    // Before the room's welcome: the page is still asking.
    expect(fw.snapshot()).toMatchObject({ synced: false, unsupported: false });
    // A room on protocol 5 welcomes with no word on friends.
    fw.welcome(undefined);
    const snap = fw.snapshot();
    expect(snap).toMatchObject({ synced: false, unsupported: true });
    const state = historyState({
      inRegion: true,
      warOn: true,
      events: snap.history.length,
      synced: snap.synced,
      unsupported: snap.unsupported,
    });
    expect(state).toBe('unsupported');
    expect(STATE_WORDS.unsupported).toMatch(/older version/);
    // Leaving the region forgets it.
    fw.detach();
    expect(fw.snapshot().unsupported).toBe(false);
  });
});
