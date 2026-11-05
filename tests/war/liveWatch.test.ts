import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { TAG, S, type BattleInput } from '../../src/sim/battle/types';
import { Clock, closePages, driveUntil, flush, openPage, openRoom } from './liveHarness';
import { armAda, armSam, liveTown, sendAgainst } from './liveTown';

/**
 * M39, step 4: other cities watch a live battle (design call 8) and a player's orders are listed with
 * the room's stamp on them. Three pages through a real region room: Ada and Sam fight, Eve watches.
 */
afterEach(() => closePages());

let saves: { ada: SaveFile; sam: SaveFile; eve: SaveFile };

beforeAll(async () => {
  const clock = new Clock();
  const room = openRoom(clock);
  const adaTown = liveTown('ada-live', 'Adaville');
  const samTown = liveTown('sam-live', 'Samford');
  const eveTown = liveTown('eve-live', 'Evetown');
  await openPage({
    room,
    clock,
    sim: adaTown.sim,
    mayor: 'Ada',
    color: 0,
    create: { name: 'Two Rivers', rules: { war: true, scale: 'skirmish' } },
  });
  await openPage({ room, clock, sim: samTown.sim, mayor: 'Sam', color: 1 });
  await openPage({ room, clock, sim: eveTown.sim, mayor: 'Eve', color: 2 });
  armAda(adaTown);
  armSam(samTown);
  saves = { ada: adaTown.sim.save(), sam: samTown.sim.save(), eve: eveTown.sim.save() };
  closePages();
}, 240_000);

const loaded = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  return sim;
};

/** Ada, Sam and Eve in one room; Ada's force has arrived at Sam's city. */
async function setup() {
  const clock = new Clock();
  const room = openRoom(clock);
  const ada = await openPage({
    room,
    clock,
    sim: loaded(saves.ada),
    mayor: 'Ada',
    color: 0,
    create: { name: 'Two Rivers', rules: { war: true, scale: 'skirmish' } },
  });
  const sam = await openPage({ room, clock, sim: loaded(saves.sam), mayor: 'Sam', color: 1 });
  const eve = await openPage({ room, clock, sim: loaded(saves.eve), mayor: 'Eve', color: 2 });
  for (const p of [ada, sam, eve]) await p.link.reportNow(true);
  await flush();
  ada.ticking = false;
  eve.ticking = false;
  const sent = sendAgainst(ada.sim, sam.link.slot);
  return { clock, room, ada, sam, eve, expedition: sent.id };
}

const structsOf = (input: BattleInput) => input.layout.structs.length / S.stride;
const militaryOf = (input: BattleInput): number[] => {
  const out: number[] = [];
  for (let k = 0; k < structsOf(input); k++)
    if ((input.layout.structs[k * S.stride + S.tags]! & TAG.military) !== 0) out.push(k);
  return out;
};

describe('M39: watching a live battle', () => {
  it('a third city is told of the battle, watches it run, and sees it end alike', async () => {
    const { clock, ada, sam, eve, expedition } = await setup();
    // Nothing on yet; nothing to watch, and a made-up battle is no battle.
    expect(eve.live.runningBattles()).toEqual([]);
    expect(eve.live.watch('nope')).toBe(false);
    expect(eve.live.view()).toBeNull();
    let over = false;
    const told: string[] = [];
    eve.live.onSpectacle = (b) => told.push(b.id);
    void ada.away.fight(expedition).then(() => (over = true));
    // The room names the battle to the city that is not in it, not to the two that are.
    expect(
      await driveUntil([ada, sam, eve], clock, () => eve.live.runningBattles().length === 1, 2_000),
    ).toBe(true);
    const b = eve.live.runningBattles()[0]!;
    expect(told).toEqual([b.id]);
    expect([b.from, b.to]).toEqual([ada.link.slot, sam.link.slot]);
    expect(ada.live.runningBattles()).toEqual([]);
    expect(sam.live.runningBattles()).toEqual([]);
    // A fighter cannot watch (it is in one), and a watcher can give no orders.
    expect(ada.live.watch(b.id)).toBe(false);
    expect(eve.live.order({ kind: 'hold' })).toBe(false);
    // Eve watches: the room sends the input, and her page runs the same battle.
    expect(eve.live.watch(b.id)).toBe(true);
    expect(eve.live.watchingId()).toBe(b.id);
    expect(await driveUntil([ada, sam, eve], clock, () => eve.live.view() !== null, 500)).toBe(true);
    const v0 = eve.live.view()!;
    expect(v0.role).toBe('watcher');
    expect(v0.id).toBe(b.id);
    expect(v0.input.attacker.name).toBe('Adaville');
    expect(v0.handed).toBe(false);
    // Orders from both players while she watches: she sees them too.
    let gave = false;
    const each = () => {
      const d = sam.live.state();
      if (gave || !d || d.step < 60) return;
      gave = true;
      const input = sam.live.input()!;
      ada.live.order({ kind: 'hold', units: [input.attacker.units[0]!.id] });
      sam.live.order({
        kind: 'guard',
        units: input.layout.defenders.slice(0, 2).map((u) => u.id),
        target: militaryOf(input)[0]!,
      });
    };
    expect(await driveUntil([ada, sam, eve], clock, () => over, 5_000, each)).toBe(true);
    // Her page's run ended where theirs did, and the room's word reached her.
    const mine = sam.live.state()!.hashes.mine!;
    for (let k = 0; k < 40 && !eve.live.view()?.run; k++) {
      eve.pumpRuns();
      eve.frames();
      await flush();
    }
    const v = eve.live.view()!;
    expect(v.over).toBe(true);
    expect(v.run).toEqual(mine);
    expect(v.end).toMatchObject({ id: b.id, agree: true });
    expect(v.orders).toBe(sam.live.state()!.orders);
    expect(v.orders).toBeGreaterThanOrEqual(2);
    // The battle is no longer on the region's list, and she can stop watching.
    expect(eve.live.runningBattles()).toEqual([]);
    expect(v.frame?.outcome).not.toBeNull();
    eve.live.unwatch();
    expect(eve.live.view()).toBeNull();
    expect(eve.live.watchingId()).toBeNull();
  }, 240_000);

  it('a city that starts watching late is given the orders so far and catches up', async () => {
    const { clock, ada, sam, eve, expedition } = await setup();
    let over = false;
    void ada.away.fight(expedition).then(() => (over = true));
    let gave = false;
    const each = () => {
      const d = sam.live.state();
      const input = sam.live.input();
      if (gave || !d || !input || d.step < 40) return;
      gave = true;
      ada.live.order({ kind: 'hold' });
      sam.live.order({ kind: 'focus', target: input.attacker.units[0]!.id });
    };
    // On past the orders, before she looks.
    expect(
      await driveUntil([ada, sam, eve], clock, () => (sam.live.state()?.step ?? 0) >= 140, 3_000, each),
    ).toBe(true);
    expect(eve.live.watch(eve.live.runningBattles()[0]!.id)).toBe(true);
    expect(await driveUntil([ada, sam, eve], clock, () => over, 5_000)).toBe(true);
    for (let k = 0; k < 60 && !eve.live.view()?.run; k++) {
      eve.pumpRuns();
      eve.frames();
      await flush();
    }
    expect(eve.live.view()!.run).toEqual(sam.live.state()!.hashes.mine);
    expect(eve.live.view()!.orders).toBeGreaterThanOrEqual(2);
  }, 240_000);

  it('lists a player’s orders and the room’s stamp on each', async () => {
    const { clock, ada, sam, expedition } = await setup();
    let over = false;
    void ada.away.fight(expedition).then(() => (over = true));
    expect(await driveUntil([ada, sam], clock, () => (ada.live.state()?.step ?? 0) >= 20, 2_000)).toBe(true);
    expect(ada.live.orderLog()).toEqual([]);
    expect(ada.live.order({ kind: 'hold', units: [ada.live.input()!.attacker.units[0]!.id] })).toBe(true);
    expect(ada.live.order({ kind: 'free' })).toBe(true);
    // Given, not yet heard.
    const first = ada.live.orderLog();
    expect(first.map((e) => e.kind)).toEqual(['hold', 'free']);
    expect(first[0]).toMatchObject({ units: 1 });
    expect(first[1]).toMatchObject({ units: 'all' });
    expect(['queued', 'sent']).toContain(first[0]!.state);
    expect(
      await driveUntil([ada, sam], clock, () => ada.live.orderLog().every((e) => e.state === 'stamped'), 200),
    ).toBe(true);
    const log = ada.live.orderLog();
    // The room numbered them in order, and put them at its frontier.
    expect(log[0]!.seq).toBeLessThan(log[1]!.seq!);
    expect(log[0]!.step).toBeGreaterThanOrEqual(20);
    // The order that mattered stays listed after the battle.
    expect(await driveUntil([ada, sam], clock, () => over, 5_000)).toBe(true);
    expect(ada.live.orderLog().map((e) => e.kind)).toEqual(['hold', 'free']);
    expect(ada.live.view()!.over).toBe(true);
    expect(ada.live.view()!.run).toEqual(ada.live.state()!.hashes.mine);
  }, 240_000);
});
