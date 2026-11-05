import { beforeAll, describe, expect, it } from 'vitest';
import {
  appendOrders,
  battleOrderOf,
  recordInput,
  stampLive,
  type StampedOrder,
} from '../../src/sim/battle/live';
import { Battle } from '../../src/sim/battle/battle';
import { S, TAG, type BattleInput } from '../../src/sim/battle/types';
import type { Command } from '../../src/sim/commands';
import { Sim } from '../../src/sim/sim';
import type { LiveCall } from '../../src/sim/systems/raids';
import { BATTLE_BUSY, BATTLE_TAKEN } from '../../src/sim/systems/raids';
import type { SaveFile } from '../../src/sim/save';
import { liveWorld, sendAgainst } from './liveTown';

/**
 * M39, step 3, the sim's side of a live battle (design call 4): the picture a friend's force fights
 * in, hosting it in the defender's sim up to the room's frontier, the room's orders taken once, a save
 * in the middle of it.
 */
let saves: { ada: SaveFile; sam: SaveFile };

beforeAll(() => {
  const { ada, sam } = liveWorld();
  saves = { ada: ada.sim.save(), sam: sam.sim.save() };
}, 120_000);

const load = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  return sim;
};

/** A friend’s call and the input Sam’s city makes of it. */
function call(): { ada: Sim; sam: Sim; call: LiveCall; input: BattleInput } {
  const ada = load(saves.ada);
  const sam = load(saves.sam);
  const sent = sendAgainst(ada, 2);
  const c: LiveCall = { id: `exp-test-${sent.id}`, from: 1, force: sent.force };
  const made = sam.query({ type: 'liveBattle', call: c }) as { input: BattleInput };
  return { ada, sam, call: c, input: made.input };
}

const host = (sam: Sim, input: BattleInput): ReturnType<Sim['dispatch']> =>
  sam.dispatch({ type: 'battleResolve', input: structuredClone(input), mode: 'live', from: 1 });
const live = (sam: Sim, id: string, allow: number, orders: StampedOrder[] = [], abort?: boolean) =>
  sam.dispatch({ type: 'battleLive', id, allow, orders, ...(abort ? { abort } : {}) } as Command);
const hb = (sam: Sim) => sam.state.war!.battle!;
const order = (
  seq: number,
  step: number,
  side: 0 | 1,
  kind: string,
  rest: Partial<StampedOrder> = {},
): StampedOrder => ({
  seq,
  step,
  side,
  kind,
  ...rest,
});
const standing = (input: BattleInput, tag: number) => {
  const out: number[] = [];
  for (let k = 0; k < input.layout.structs.length / S.stride; k++)
    if ((input.layout.structs[k * S.stride + S.tags]! & tag) !== 0) out.push(k);
  return out;
};

describe('M39: the sim’s side of a live battle', () => {
  it('makes the friend’s battle of its own picture: version 4, the friend’s force, nothing changed', () => {
    const { sam, input, call: c } = call();
    expect(input.v).toBe(4);
    expect(input.layout.v).toBe(4);
    expect(input.id).toBe(c.id);
    expect(input.orders).toEqual([]);
    expect(input.attacker.name).toBe('Adaville');
    expect(input.attacker.units.map((u) => [u.id, u.kind])).toEqual(c.force.units.map((u) => [u.id, u.kind]));
    expect(input.defender.name).toBe('Samford');
    // The defenders are this city’s own units, by their ids.
    expect(input.layout.defenders.length).toBeGreaterThan(0);
    for (const u of input.layout.defenders) expect(sam.state.war!.units.has(u.id)).toBe(true);
    // A query changes nothing.
    expect(sam.state.war!.battle).toBeUndefined();
    expect(sam.state.war!.taken ?? []).toEqual([]);
    // Asking again gives the same battle.
    const again = (sam.query({ type: 'liveBattle', call: c }) as { input: BattleInput }).input;
    expect(again).toEqual(input);
  });

  it('refuses what the city can’t take', () => {
    const { sam, call: c, input } = call();
    const ask = (x: LiveCall) => sam.query({ type: 'liveBattle', call: x }) as { refused?: string };
    expect(ask({ ...c, from: 3 }).refused).toMatch(/doesn’t know/);
    expect(ask({ ...c, force: { ...c.force, target: 'moon' as never } }).refused).toMatch(
      /could not be read/,
    );
    expect(ask({ ...c, force: { ...c.force, units: [] } }).refused).toMatch(/could not be read/);
    expect(ask({ ...c, force: { ...c.force, units: [null as never] } }).refused).toMatch(/could not be read/);
    expect(ask({ ...c, force: { ...c.force, stance: 'rude' as never } }).refused).toMatch(
      /could not be read/,
    );
    expect(host(sam, input).ok).toBe(true);
    // One battle at a time, and a battle once.
    expect(ask(c).refused).toBe(BATTLE_BUSY);
    live(sam, input.id, 100);
    for (let t = 0; t < 1200 && sam.state.war!.battle; t++) {
      live(sam, input.id, 100_000);
      sam.step();
    }
    expect(sam.state.war!.battle).toBeUndefined();
    expect(ask(c).refused).toBe(BATTLE_TAKEN);
  });

  it('hosts the battle only as far as the room lets it, and the room’s word is taken once', () => {
    const { sam, input } = call();
    expect(host(sam, input).ok).toBe(true);
    expect(hb(sam).live).toMatchObject({ id: input.id, from: 1, allow: 0, seq: 0 });
    // Not begun: the city has not felt it.
    for (let t = 0; t < 30; t++) sam.step();
    expect(hb(sam).step).toBe(0);
    expect(sam.events.some((e) => e.kind === 'battleStarted')).toBe(false);
    // The frontier moves the battle, two steps a tick, never to it.
    const mil = standing(input, TAG.military);
    expect(
      live(sam, input.id, 41, [
        order(1, 20, 1, 'guard', { units: [input.layout.defenders[0]!.id], target: mil[0]! }),
      ]).ok,
    ).toBe(true);
    expect(sam.events.filter((e) => e.kind === 'battleStarted')).toHaveLength(1);
    for (let t = 0; t < 100; t++) sam.step();
    expect(hb(sam).step).toBe(41);
    // It never goes back, and the same order sent again is taken once.
    expect(
      live(sam, input.id, 10, [
        order(1, 20, 1, 'guard', { units: [input.layout.defenders[0]!.id], target: mil[0]! }),
      ]).ok,
    ).toBe(true);
    expect(hb(sam).live!.allow).toBe(41);
    expect(hb(sam).input.orders).toHaveLength(1);
    expect(hb(sam).live!.seq).toBe(1);
    // Orders taken in their numbers, whatever order they came in; one that isn't sound is left out (its number is seen).
    live(sam, input.id, 60, [
      order(4, 50, 0, 'hold'),
      order(3, 50, 1, 'nonsense'),
      order(2, 45, 1, 'guard', { target: 99_999 }),
      order(5, 50, 1, 'free'),
    ]);
    expect(hb(sam).input.orders.map((o) => o.kind)).toEqual(['guard', 'hold', 'free']);
    expect(hb(sam).live!.seq).toBe(5);
    // A bad frontier, or a battle that isn't here, changes nothing.
    expect(live(sam, input.id, -1).ok).toBe(false);
    expect(live(sam, input.id, 1.5).ok).toBe(false);
    expect(live(sam, 'other', 100).ok).toBe(false);
    expect(hb(sam).live!.allow).toBe(60);
  });

  it('plays a live battle to the very hash a plain run of the final record gives', () => {
    const { sam, input } = call();
    host(sam, input);
    const mine = input.layout.defenders.map((u) => u.id);
    const mil = standing(input, TAG.military);
    // Orders stamped as the room would: at the frontier as it was.
    const log = [
      order(1, 32, 1, 'guard', { units: mine.slice(0, 2), target: mil[0]! }),
      order(2, 64, 0, 'hold', { units: [input.attacker.units[0]!.id] }),
      order(3, 96, 1, 'focus', { target: input.attacker.units[1]!.id }),
      order(4, 128, 0, 'free'),
    ];
    let allow = 0;
    for (let t = 0; t < 2000 && sam.state.war!.battle; t++) {
      // The room's frontier runs ahead of the battle by 32 steps; each order arrives before its step.
      const next = Math.min(hb(sam).step + 32, 100_000);
      if (next > allow) {
        allow = next;
        live(
          sam,
          input.id,
          allow,
          log.filter((o) => o.step <= allow),
        );
      }
      sam.step();
    }
    expect(sam.state.war!.battle).toBeUndefined();
    const end = sam.events.find((e) => e.kind === 'battleEnded')!;
    expect(end.info!.live).toBe(input.id);
    const again = Battle.run(recordInput(input, log));
    expect(end.info!.hash).toBe(again.hash());
    expect(end.info!.step).toBe(again.step);
    // The orders mattered.
    expect(Battle.run(stampLive(structuredClone(input))).hash()).not.toBe(again.hash());
  });

  it('drops a battle that never began, and not one that has', () => {
    const { sam, input, call: c } = call();
    host(sam, input);
    for (let t = 0; t < 10; t++) sam.step();
    expect(live(sam, input.id, 0, [], true).ok).toBe(true);
    expect(sam.state.war!.battle).toBeUndefined();
    // As if it had not been offered: it can be taken again.
    expect((sam.query({ type: 'liveBattle', call: c }) as { input?: BattleInput }).input).toBeDefined();
    expect(host(sam, input).ok).toBe(true);
    live(sam, input.id, 32);
    expect(live(sam, input.id, 0, [], true).ok).toBe(false);
    expect(sam.state.war!.battle).toBeDefined();
  });

  it('keeps the battle through a save: the frontier, the orders, and the very same course', () => {
    const { sam, input } = call();
    host(sam, input);
    const mil = standing(input, TAG.military);
    const log = [
      order(1, 32, 1, 'guard', {
        units: input.layout.defenders.slice(0, 2).map((u) => u.id),
        target: mil[0]!,
      }),
      order(2, 64, 0, 'hold'),
    ];
    live(sam, input.id, 96, log);
    for (let t = 0; t < 60; t++) sam.step();
    expect(hb(sam).step).toBe(96);
    // The city is saved there and loaded again: the battle is where it was, held at the same frontier.
    const back = load(sam.save());
    expect(hb(back).step).toBe(96);
    expect(hb(back).live).toMatchObject({ id: input.id, allow: 96, seq: 2, begun: true });
    expect(hb(back).input.orders).toHaveLength(2);
    for (let t = 0; t < 20; t++) back.step();
    expect(hb(back).step).toBe(96);
    // On from there, both ways, ends alike.
    const run = (s: Sim) => {
      for (let t = 0; t < 2000 && s.state.war!.battle; t++) {
        live(s, input.id, 100_000);
        s.step();
      }
      return s.events.filter((e) => e.kind === 'battleEnded').at(-1)!.info!.hash;
    };
    expect(run(back)).toBe(run(sam));
  });

  it('takes a record of the battle it hosts in place of the part it hosts (a page that was reloaded)', () => {
    const { sam, input } = call();
    host(sam, input);
    const log = [order(1, 32, 0, 'hold')];
    live(sam, input.id, 64, log);
    for (let t = 0; t < 40; t++) sam.step();
    // The room’s record arrives for a battle the city hosts: instead of waiting for a page that’s gone.
    const record = recordInput(input, log);
    expect(sam.dispatch({ type: 'battleResolve', input: record, mode: 'instant', from: 1 }).ok).toBe(true);
    expect(sam.state.war!.battle).toBeUndefined();
    const end = sam.events.filter((e) => e.kind === 'battleEnded').at(-1)!;
    expect(end.info!.hash).toBe(Battle.run(structuredClone(record)).hash());
    // And only once.
    expect(sam.dispatch({ type: 'battleResolve', input: record, mode: 'instant', from: 1 }).ok).toBe(false);
  });

  it('refuses a live battle that isn’t a friend’s, or isn’t version 4', () => {
    const { sam, input } = call();
    expect(sam.dispatch({ type: 'battleResolve', input: structuredClone(input), mode: 'live' }).ok).toBe(
      false,
    );
    const old = structuredClone(input);
    old.v = 3;
    old.layout.v = 3;
    expect(sam.dispatch({ type: 'battleResolve', input: old, mode: 'live', from: 1 }).ok).toBe(false);
    expect(sam.state.war!.battle).toBeUndefined();
  });

  it('reads the room’s orders alike everywhere', () => {
    const { input } = call();
    const mil = standing(input, TAG.military);
    const a = structuredClone(input);
    const b = structuredClone(input);
    const log = [
      order(2, 40, 0, 'focus', { target: mil[0]! }),
      order(1, 40, 1, 'hold'),
      order(3, 40, 1, 'guard', { target: 99_999 }),
      order(4, 40, 0, 'withdraw', { units: [input.attacker.units[0]!.id] }),
    ];
    expect(appendOrders(a, 0, log)).toBe(4);
    // In pieces, in any order within one, and told again: the same list.
    let seen = appendOrders(b, 0, [log[1]!, log[0]!]);
    expect(seen).toBe(2);
    seen = appendOrders(b, seen, [log[3]!, log[2]!]);
    expect(seen).toBe(4);
    expect(appendOrders(b, seen, log)).toBe(4);
    expect(b.orders).toEqual(a.orders);
    expect(a.orders.map((o) => o.kind)).toEqual(['hold', 'focus', 'withdraw']);
    expect(appendOrders(a, 4, log)).toBe(4);
    expect(a.orders).toHaveLength(3);
    // A shape that isn't an order is no order.
    expect(battleOrderOf({ seq: 1, step: 1.5, side: 0, kind: 'hold' })).toBeNull();
    expect(battleOrderOf({ seq: 1, step: 1, side: 2 as never, kind: 'hold' })).toBeNull();
    expect(battleOrderOf({ seq: 1, step: 1, side: 0, kind: 'surrender' })).toBeNull();
    expect(battleOrderOf({ seq: 1, step: 1, side: 0, kind: 'hold', units: 'all' as never })).toBeNull();
  });
});
