import { beforeAll, describe, expect, it } from 'vitest';
import { LiveBattles, type LiveRunnerHandlers } from '../../src/client/liveBattles';
import { LiveRunner, pumpRun } from '../../src/client/liveRunner';
import { LiveStage, STAGE_FORCE } from '../../src/client/liveStage';
import type { BattleInput, ForceIn } from '../../src/sim/battle/types';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { Clock, flush } from './liveHarness';
import { armAda, friend, liveTown, regionOf } from './liveTown';

/**
 * M39, step 4: the stand-in for the region room that test builds use to stage a live battle in one page
 * (src/client/liveStage.ts). It plays the room with the room's own state machine, so the page code it
 * drives is the real one: an attacker's run with orders stamped and a hand-over, and a watched battle
 * paced by a hidden run. The e2e and the screenshots stand on it.
 */
let save: SaveFile;

beforeAll(() => {
  const ada = liveTown('stage-ada', 'Adaville');
  regionOf(ada.sim, [friend(2, 'Samford', 'Sam')]);
  armAda(ada);
  save = ada.sim.save();
}, 120_000);

/** The picture of this city a friend's force fights in, as `stageLive` makes it. */
function stagedInput(id: string): BattleInput {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  const force: ForceIn = {
    name: 'Samford',
    color: 0x2e86de,
    units: STAGE_FORCE.map((kind, k) => ({ id: k + 1, kind, hp: 1, x: 0, z: 0, base: -1 })),
    route: 'highway',
    target: 'military',
    stance: 'bold',
    readiness: 1,
  };
  const r = sim.query({ type: 'liveBattle', call: { id, from: 2, force } }) as
    { input: BattleInput } | { refused: string };
  if ('refused' in r) throw new Error(r.refused);
  return r.input;
}

/** A page's live battles with the stand-in as its room, the runner in-process, and a clock to move. */
function page(role: 'attacker' | 'watcher', input: BattleInput, hold?: number) {
  const clock = new Clock();
  const runs: { run: LiveRunner; on: LiveRunnerHandlers; shown: { step: number }; ended: boolean }[] = [];
  const live = new LiveBattles({
    now: clock.now,
    city: {
      query: async () => ({}) as never,
      preview: async () => ({ ok: false, reason: 'no sim here' }) as never,
      command: async () => ({ ok: false, reason: 'no sim here' }) as never,
      save: async () => save,
      cityName: () => 'Adaville',
      tick: () => 0,
      speed: () => 1,
      setSpeed: () => undefined,
      notice: () => undefined,
    },
    store: { keepTown: async () => undefined, keepBattle: async () => undefined },
    runner: (inp, on) => {
      const r = { run: new LiveRunner(inp, clock.now), on, shown: { step: -2 }, ended: false };
      runs.push(r);
      on.frame(0, r.run.frame());
      return {
        feed: (orders, allow, rush) => {
          r.run.feed(orders, allow);
          if (rush) r.run.rush();
        },
        stop: () => void (r.ended = true),
      };
    },
    report: async () => true,
    settle: async () => true,
    fetchSave: async () => save,
  });
  const stage =
    role === 'attacker'
      ? new LiveStage('attacker', 1, 1, 2, clock.now)
      : new LiveStage('watcher', 3, 2, 4, clock.now);
  if (hold !== undefined) stage.hold = hold;
  live.attach(stage);
  if (role === 'attacker') {
    live.stage(input, 1, 2);
    stage.beginAttacker(input);
  } else stage.beginWatched(input);
  /** The page's clock for `ticks` of 125 ms: the runner steps, the stand-in ticks, frames and messages cross. */
  const drive = async (ticks: number, each?: () => void) => {
    for (let k = 0; k < ticks; k++) {
      clock.advance(125);
      for (const r of runs) if (!r.ended) r.ended = pumpRun(r.run, r.shown, r.on);
      stage.tick();
      live.frame(null, []);
      await flush();
      each?.();
    }
  };
  return { clock, live, stage, drive, runs };
}

describe('M39: the stand-in room', () => {
  it('stamps an attacker’s orders at the frontier, holds a battle still, hands a side over and gives it back', async () => {
    const input = stagedInput('stage-a');
    const p = page('attacker', input, 80);
    await flush();
    await p.drive(2);
    // It has begun, and is the attacker's.
    const v0 = p.live.view()!;
    expect(v0.role).toBe('attacker');
    expect(v0.id).toBe('stage-a');
    expect(v0.handed).toBe(false);
    // Held at step 80: the page runs up to it and waits there.
    await p.drive(80);
    const held = p.live.view()!;
    expect(held.step).toBe(80);
    expect(held.allow).toBe(80);
    await p.drive(8);
    expect(p.live.view()!.step).toBe(80);
    // An order given while held is stamped at the frontier, and listed as heard.
    expect(p.live.order({ kind: 'hold', units: [input.attacker.units[0]!.id] })).toBe(true);
    await p.drive(8);
    const e = p.live.orderLog()[0]!;
    expect(e).toMatchObject({ kind: 'hold', state: 'stamped', step: 80 });
    expect(p.stage.stamped).toHaveLength(1);
    // Handed over by the room: the page's own try at taking command back goes unanswered...
    expect(p.stage.handOver(1)).toBe(true);
    await p.drive(8);
    expect(p.live.view()!.handed).toBe(true);
    // ...until its player does it.
    p.live.rejoin();
    await p.drive(8);
    expect(p.live.view()!.handed).toBe(false);
    // Let go, the battle runs to its end: the page's run ends, and the room's word reaches it.
    p.stage.release();
    await p.drive(4_000, () => undefined);
    const end = p.live.view()!;
    expect(end.over).toBe(true);
    expect(end.run).not.toBeNull();
    expect(end.end).toMatchObject({ id: 'stage-a', agree: true });
    expect(end.run!.hash).toBe(end.end!.hash);
  }, 120_000);

  it('a watched battle goes on at the battle’s pace with nobody’s page in it, and ends', async () => {
    const input = stagedInput('stage-w');
    const p = page('watcher', input);
    await flush();
    // The page is told of it; it is not its own.
    expect(p.live.runningBattles()).toEqual([{ id: 'stage-w', from: 2, to: 4 }]);
    expect(p.live.view()).toBeNull();
    expect(p.live.watch('stage-w')).toBe(true);
    await p.drive(4);
    const v = p.live.view()!;
    expect(v.role).toBe('watcher');
    expect(v.handed).toBe(false);
    // The virtual players give orders: the watcher's run takes them too, and ends where the hidden one does.
    await p.drive(120);
    expect(p.stage.say(0, { kind: 'hold', units: [input.attacker.units[0]!.id] })).toBe(true);
    expect(p.stage.say(1, { kind: 'free' })).toBe(true);
    await p.drive(4_000);
    const end = p.live.view()!;
    expect(end.over).toBe(true);
    expect(end.orders).toBe(2);
    expect(end.end).toMatchObject({ id: 'stage-w', agree: true });
    expect(end.run!.hash).toBe(end.end!.hash);
    expect(p.live.runningBattles()).toEqual([]);
  }, 120_000);

  it('an ally’s force joins a watched battle: stamped at the frontier, in the frames as it arrives, in both runs', async () => {
    const input = stagedInput('stage-h');
    const p = page('watcher', input);
    await flush();
    expect(p.live.watch('stage-h')).toBe(true);
    await p.drive(40);
    expect(
      p.stage.addHelper({
        owner: 7,
        name: 'Kitburg',
        color: 0x33aa33,
        side: 1,
        units: ['tank', 'tank', 'infantry'],
        travel: 120,
      }),
    ).toBe(true);
    // (A second force from the same city is the room's to turn down.)
    expect(
      p.stage.addHelper({
        owner: 7,
        name: 'Kitburg',
        color: 0x33aa33,
        side: 1,
        units: ['tank'],
        travel: 120,
      }),
    ).toBe(false);
    await p.drive(4);
    const entry = p.stage.session!.helpers()[0]!;
    expect(entry.helper).toMatchObject({ owner: 7, side: 1, name: 'Kitburg' });
    // The page's run knows of it at once (whole, on its way), and has it on the map once it arrives.
    expect(p.live.view()!.frame!.helpers).toEqual([
      {
        owner: 7,
        name: 'Kitburg',
        color: 0x33aa33,
        side: 1,
        arrive: entry.helper!.arrive,
        alive: 3,
        total: 3,
      },
    ]);
    const onMap = () => p.live.view()!.frame!.units.filter((u) => u.owner === 7).length;
    expect(onMap()).toBe(0);
    await p.drive(300);
    expect(p.live.view()!.step).toBeGreaterThan(entry.helper!.arrive);
    expect(onMap()).toBeGreaterThan(0);
    // It ends alike in the hidden run that paces it and the page's, the allies' units reported by owner.
    await p.drive(4_000);
    const end = p.live.view()!;
    expect(end.over).toBe(true);
    expect(end.end).toMatchObject({ id: 'stage-h', agree: true });
    expect(end.run!.hash).toBe(end.end!.hash);
  }, 120_000);
});
