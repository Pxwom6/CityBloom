import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { UNIT } from '../../src/data/war';
import { PROTOCOL_VERSION } from '../../relay/protocol';
import type { RegionConn, RegionRoomMsg } from '../../relay/region';
import { encodeBattle } from '../../src/net/snapshot';
import { awayBattleId, awayCity, awayInput } from '../../src/sim/battle/away';
import { Battle } from '../../src/sim/battle/battle';
import { S, TAG, type BattleInput } from '../../src/sim/battle/types';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import type { BattleReport } from '../../src/sim/systems/raids';
import { Clock, closePages, driveUntil, flush, openPage, openRoom, type Page } from './liveHarness';
import { armAda, armSam, liveTown, sendAgainst } from './liveTown';

/**
 * M39, step 3: live battles between two players' pages through the region room (design calls 3-5).
 * Two cities with a `RegionLink` each, a real room, and the `LiveBattles` a game would have; the
 * battle worker's runner is done in-process. No browser.
 */
afterEach(() => closePages());

/** The two armed cities, built once (a few seconds) and loaded afresh for each test. */
let saves: { ada: SaveFile; sam: SaveFile };

beforeAll(async () => {
  const clock = new Clock();
  const room = openRoom(clock);
  const adaTown = liveTown('ada-live', 'Adaville');
  const samTown = liveTown('sam-live', 'Samford');
  await openPage({
    room,
    clock,
    sim: adaTown.sim,
    mayor: 'Ada',
    color: 0,
    create: { name: 'Two Rivers', rules: { war: true, scale: 'skirmish' } },
  });
  await openPage({ room, clock, sim: samTown.sim, mayor: 'Sam', color: 1 });
  expect(adaTown.sim.state.war).toBeDefined();
  expect(samTown.sim.state.war).toBeDefined();
  armAda(adaTown);
  armSam(samTown);
  saves = { ada: adaTown.sim.save(), sam: samTown.sim.save() };
  closePages();
}, 180_000);

const loaded = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  return sim;
};

/** A room with Ada's and Sam's pages open (Sam's a raw protocol 5 page if `v5`), the cities as they were built. */
async function setup(opts: { v5?: boolean } = {}) {
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
  const sam = opts.v5
    ? null
    : await openPage({ room, clock, sim: loaded(saves.sam), mayor: 'Sam', color: 1 });
  await ada.link.reportNow(true);
  await sam?.link.reportNow(true);
  await flush();
  // Ada's city is not played in the tests (only its force fights).
  ada.ticking = false;
  return { clock, room, ada, sam: sam! };
}

/** Both pages open, and Ada's force has arrived at Sam's city. */
async function fight() {
  const w = await setup();
  const sent = sendAgainst(w.ada.sim, w.sam.link.slot);
  return { ...w, expedition: sent.id, force: sent.force, city: sent.city };
}

const structsOf = (input: BattleInput) => input.layout.structs.length / S.stride;
const standing = (input: BattleInput, tag: number) => {
  const out: number[] = [];
  for (let k = 0; k < structsOf(input); k++)
    if ((input.layout.structs[k * S.stride + S.tags]! & tag) !== 0) out.push(k);
  return out;
};

/** What a battle report says happened (without when). */
const damage = (r: BattleReport) => ({
  outcome: r.outcome,
  collapsed: r.collapsed,
  civics: r.civics,
  craters: r.craters,
  lost: r.lost,
  theirLost: r.theirLost,
  theirTotal: r.theirTotal,
  homeless: r.homeless,
});

/** Orders from both players as a battle goes on: the first once it has begun, the second a while on. */
function scripted(ada: Page, sam: Page) {
  let gave = 0;
  return () => {
    const input = sam.live.input();
    const d = sam.live.state();
    if (!input || !d) return;
    if (gave === 0 && d.step >= 40) {
      const mil = standing(input, TAG.military);
      const mine = input.layout.defenders.map((u) => u.id);
      expect(ada.live.order({ kind: 'hold', units: [input.attacker.units[0]!.id] })).toBe(true);
      expect(sam.live.order({ kind: 'guard', units: mine.slice(0, 2), target: mil[0]! })).toBe(true);
      gave = 1;
    } else if (gave === 1 && d.step >= 120) {
      expect(sam.live.order({ kind: 'focus', target: input.attacker.units[0]!.id })).toBe(true);
      expect(ada.live.order({ kind: 'free' })).toBe(true);
      gave = 2;
    }
  };
}

/** The battle again from a final record: a plain run, with no one to command. */
const rerun = (input: BattleInput) => Battle.run(structuredClone(input));

describe('M39: live battles between pages', () => {
  it('a friend’s force fights its battle live, both commanding: both runs end alike, and so do the reports', async () => {
    const w = await fight();
    const { clock, ada, sam } = w;
    let over = false;
    void ada.away.fight(w.expedition).then(() => (over = true));
    expect(await driveUntil([ada, sam], clock, () => over, 5_000, scripted(ada, sam))).toBe(true);
    const a = ada.live.state()!;
    const d = sam.live.state()!;
    expect(a.ended && d.ended).toBe(true);
    // Both ran the battle to the same end, and the room saw it.
    expect(a.hashes.mine).toEqual(d.hashes.mine);
    expect(a.hashes.room).toMatchObject({ agree: true, ...d.hashes.mine });
    expect(a.desync || d.desync).toBe(false);
    expect(a.orders).toBe(d.orders);
    expect(a.orders).toBeGreaterThanOrEqual(4);
    // Each page kept the battle as it was fought: the same input with the same orders in it.
    const id = a.id;
    const theirs = ada.kept.battles.find((b) => b.id === id)!;
    const mine = sam.kept.battles.find((b) => b.id === `def-${id}`)!;
    expect(theirs.input.orders.length).toBe(a.orders);
    expect(mine.input.orders).toEqual(theirs.input.orders);
    expect(mine.input.v).toBe(4);
    // Run again with nobody to command it, the record gives the very hash both pages reported.
    const again = rerun(mine.input);
    expect(again.hash()).toBe(d.hashes.mine!.hash);
    expect(again.step).toBe(d.hashes.mine!.step);
    // And the orders mattered: without them it is another battle.
    expect(rerun({ ...mine.input, orders: [] }).hash()).not.toBe(again.hash());
    // The defender's damage is what its sim does with the record on the city as it stood.
    const backdrop = sam.kept.towns.get(`replay:def-${id}`)!;
    expect(backdrop).toBeDefined();
    const fresh = Sim.fromSave(backdrop);
    expect(fresh.dispatch({ type: 'battleResolve', input: mine.input, mode: 'instant', from: 1 }).ok).toBe(
      true,
    );
    const hosted = sam.sim.state.war!.reports!.at(-1)!;
    const replay = fresh.state.war!.reports!.at(-1)!;
    expect(hosted.replay).toBe(`def-${id}`);
    expect(damage(hosted)).toEqual(damage(replay));
    // The losses: the attacker's report counts the units that fell, as the battle's own result does.
    const result = again.result();
    const out = (side: number) => result.units.filter((u) => u.side === side && u.out);
    const byKind = (list: { kind: string }[]) => {
      const n: Record<string, number> = {};
      for (const u of list) n[u.kind] = (n[u.kind] ?? 0) + 1;
      return n;
    };
    const mineReport = ada.sim.state.war!.reports!.at(-1)!;
    expect(mineReport.ours).toBe(true);
    expect(mineReport.lost).toEqual(byKind(out(0)));
    expect(hosted.lost).toEqual(byKind(out(1)));
    expect(hosted.theirLost).toBe(out(0).length);
    expect(mineReport.theirLost).toBe(
      Math.round(out(1).reduce((n, u) => n + (UNIT.get(u.kind)?.strength ?? 1), 0)),
    );
    // Something was lost on both sides, or this proves little.
    expect(out(0).length + out(1).length).toBeGreaterThan(0);
    // The force is back to the way home, the city's hosted battle is over.
    expect(sam.sim.state.war!.battle).toBeUndefined();
    expect(ada.sim.state.war!.expeditions?.[0]?.state).toBe('back');
  }, 120_000);

  it('a defender page that stops reporting is handed over, and the battle still ends alike on both sides', async () => {
    const { clock, ada, sam, expedition } = await fight();
    let over = false;
    void ada.away.fight(expedition).then(() => (over = true));
    expect(
      await driveUntil(
        [ada, sam],
        clock,
        () => (sam.live.state()?.step ?? 0) >= 60,
        2_000,
        scripted(ada, sam),
      ),
    ).toBe(true);
    // Sam's page freezes (a tab the browser put to sleep): its sim stops, nothing is reported. Ada goes on
    // alone once the room has given up on it (ten seconds), and the battle ends.
    sam.deaf = true;
    sam.ticking = false;
    expect(await driveUntil([ada, sam], clock, () => over, 3_000)).toBe(true);
    const a = ada.live.state()!;
    expect(a.hashes.room).toMatchObject({ solo: true });
    // The room stamped a `free` for Sam's side, and Sam's page has it (and the end).
    const handover = sam.live.state()!;
    expect(handover.ended).toBe(false);
    expect(handover.hashes.room).toMatchObject({ solo: true, hash: a.hashes.mine!.hash });
    // Sam's page comes round: its sim plays the battle out on what it was told.
    sam.deaf = false;
    sam.ticking = true;
    expect(await driveUntil([ada, sam], clock, () => !!sam.live.state()?.ended, 2_000)).toBe(true);
    const d = sam.live.state()!;
    expect(d.hashes.mine).toEqual(a.hashes.mine);
    const theirs = ada.kept.battles.find((b) => b.id === a.id)!;
    const mine = sam.kept.battles.find((b) => b.id === `def-${a.id}`)!;
    expect(mine.input.orders).toEqual(theirs.input.orders);
    expect(mine.input.orders.some((o) => o.kind === 'free' && o.side === 1)).toBe(true);
    expect(rerun(mine.input).hash()).toBe(a.hashes.mine!.hash);
    expect(sam.sim.state.war!.battle).toBeUndefined();
    // The same battle is what each city took: its losses are the attacker's, counted twice.
    const hosted = sam.sim.state.war!.reports!.at(-1)!;
    expect(hosted.theirLost).toBe(
      Object.values(ada.sim.state.war!.reports!.at(-1)!.lost).reduce((n, v) => n + v!, 0),
    );
  }, 120_000);

  it('a defender whose connection drops is handed over, and takes command again when it is back', async () => {
    const { clock, ada, sam, expedition } = await fight();
    let over = false;
    void ada.away.fight(expedition).then(() => (over = true));
    expect(
      await driveUntil(
        [ada, sam],
        clock,
        () => (sam.live.state()?.step ?? 0) >= 60,
        2_000,
        scripted(ada, sam),
      ),
    ).toBe(true);
    sam.link.dropForTest();
    // (The link reconnects by itself after half a second of real time.)
    await new Promise((r) => setTimeout(r, 800));
    await flush();
    expect(await driveUntil([ada, sam], clock, () => over, 3_000)).toBe(true);
    const a = ada.live.state()!;
    const d = sam.live.state()!;
    expect(d.hashes.mine).toEqual(a.hashes.mine);
    expect(d.handed).toBe(false);
    // Its forces were handed over for a moment (the room's `free`), then it commanded them again.
    const mine = sam.kept.battles.find((b) => b.id === `def-${a.id}`)!;
    expect(mine.input.orders.filter((o) => o.kind === 'free' && o.side === 1)).toHaveLength(1);
    expect(rerun(mine.input).hash()).toBe(a.hashes.mine!.hash);
  }, 120_000);

  it('a defender who is away at the end gets the record later and resolves it to the same hash', async () => {
    const { clock, room, ada, sam, expedition } = await fight();
    let over = false;
    void ada.away.fight(expedition).then(() => (over = true));
    expect(
      await driveUntil(
        [ada, sam],
        clock,
        () => (sam.live.state()?.step ?? 0) >= 60,
        2_000,
        scripted(ada, sam),
      ),
    ).toBe(true);
    const id = ada.live.state()!.id;
    const backdrop = sam.kept.towns.get(`replay:def-${id}`)!;
    const { slot, secret } = sam.link;
    // Sam closes the game. Ada's force fights on alone and the battle ends.
    await sam.link.leave();
    sam.ticking = false;
    sam.deaf = true;
    expect(await driveUntil([ada], clock, () => over, 3_000)).toBe(true);
    const a = ada.live.state()!;
    expect(a.hashes.room).toMatchObject({ solo: true });
    // Later Sam opens the game on the city as it was saved before the battle.
    const back = await openPage({
      room,
      clock,
      sim: loaded(backdrop),
      mayor: 'Sam',
      color: 1,
      rejoin: { slot, secret },
    });
    await flush();
    expect(back.taken).toHaveLength(1);
    expect(back.taken[0]).toMatchObject({ late: true, from: ada.link.slot });
    const ended = back.sim.events.find((e) => e.kind === 'battleEnded')!;
    expect(ended.info!.hash).toBe(a.hashes.mine!.hash);
    expect(ended.info!.step).toBe(a.hashes.mine!.step);
    expect(back.sim.state.war!.battle).toBeUndefined();
    // It took the orders in the record: without them it is another battle.
    const input = back.taken[0]!.input;
    expect(input.orders.length).toBe(a.orders);
    expect(rerun({ ...input, orders: [] }).hash()).not.toBe(a.hashes.mine!.hash);
  }, 120_000);

  it('a friend whose page is on protocol 5 gets today’s way, and nothing live is said to it', async () => {
    const { room, ada } = await setup({ v5: true });
    // Sam's page is an older one: protocol 5, no live battles.
    const got: RegionRoomMsg[] = [];
    const conn: RegionConn = { send: (m) => void got.push(m), close: () => undefined };
    room.open(conn);
    const say = (m: object) => room.message(conn, JSON.stringify(m));
    say({ t: 'rhello', v: 5, mayor: 'Sam', color: 1, city: 'Samford' });
    const slot = (got.find((m) => m.t === 'rwelcome') as Extract<RegionRoomMsg, { t: 'rwelcome' }>).slot;
    expect(slot).toBe(2);
    say({
      t: 'report',
      city: 'Samford',
      report: {
        population: 5_000,
        kind: 'suburb',
        workers: 10,
        jobs: 10,
        shoppers: 5,
        offers: { buy: { power: 0, water: 0, garbage: 0 }, sell: { power: 0, water: 0, garbage: 0 } },
        deals: [],
        projectBuilt: false,
        tiers: [0, 0, 0, 0, 0, 0],
        counter: 0,
        clock: 100,
      },
    });
    await ada.link.reportNow(true);
    await flush();
    const sent = sendAgainst(ada.sim, slot);
    const answer = await ada.live.attack(sent.city, sent.id);
    expect(answer).toEqual({ kind: 'fallback' });
    // The force is free again for the old way, and the old page heard nothing of a live battle.
    expect(ada.sim.state.war!.expeditions![0]!.settling).toBeUndefined();
    expect(got.filter((m) => m.t.startsWith('b') && m.t !== 'battle')).toEqual([]);
    // The old way works as it did: the battle is put to the region, which keeps it for the old page.
    const town = loaded(saves.sam);
    const input = awayInput(sent.city, town);
    expect(await ada.link.sendBattle(slot, input, false, 2_000)).toEqual({ kept: true });
    await flush();
    const battle = got.find((m) => m.t === 'battle') as Extract<RegionRoomMsg, { t: 'battle' }>;
    expect(battle).toBeDefined();
    expect(battle.live).toBeUndefined();
  }, 120_000);

  it('goes the old way when the defender can’t take it now, and says why when the region won’t', async () => {
    const { clock, ada, sam } = await fight();
    const sent = ada.sim.state.war!.expeditions![0]!;
    const city = awayCity(ada.sim, sent);
    // A computer neighbour’s raid is on in Sam’s city: its page declines the call.
    sam.sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 });
    for (let t = 0; t < 5 && !sam.sim.state.war!.battle; t++) sam.sim.step();
    expect(sam.sim.state.war!.battle).toBeDefined();
    const busy = ada.live.attack(city, sent.id);
    await driveUntil([ada, sam], clock, () => false, 3);
    expect(await busy).toEqual({ kind: 'fallback' });
    expect(ada.sim.state.war!.expeditions![0]!.settling).toBeUndefined();
    expect(sam.sim.state.war!.battle!.live).toBeUndefined();
    expect(sam.live.state()).toBeNull();
    // The region turns a battle against a neutral city away, and the page says so.
    expect(sam.sim.dispatch({ type: 'setNeutral', on: true }).ok).toBe(true);
    await sam.link.reportNow(true);
    await flush();
    const refused = ada.live.attack(city, sent.id);
    await driveUntil([ada, sam], clock, () => false, 3);
    const r = await refused;
    expect(r.kind).toBe('refused');
    expect(r).toMatchObject({ reason: expect.stringMatching(/neutral/) });
    expect(ada.sim.state.war!.expeditions![0]!.settling).toBeUndefined();
  }, 120_000);

  it('drops the battle it set up when the region turns the call down after all', async () => {
    const { clock, ada, sam } = await fight();
    const sent = ada.sim.state.war!.expeditions![0]!;
    const city = awayCity(ada.sim, sent);
    // Between Sam’s page hosting the battle and the room hearing of it, Sam’s city goes neutral.
    sam.hooks.autosave = async () => {
      sam.sim.dispatch({ type: 'setNeutral', on: true });
      await sam.link.reportNow(true);
    };
    const refused = ada.live.attack(city, sent.id);
    await driveUntil([ada, sam], clock, () => false, 5);
    expect((await refused).kind).toBe('refused');
    expect(sam.sim.state.war!.battle).toBeUndefined();
    expect(sam.sim.state.war!.taken ?? []).toEqual([]);
    expect(sam.live.state()).toBeNull();
  }, 120_000);

  it('an attacker who is away at the end gets the record when it asks again, runs it, and reports the same losses', async () => {
    const { clock, room, ada, sam, expedition } = await fight();
    // Ada's city as it is with the force at Sam's gates, kept for when the player comes back.
    const adaSave = ada.sim.save();
    void ada.away.fight(expedition);
    expect(
      await driveUntil(
        [ada, sam],
        clock,
        () => (sam.live.state()?.step ?? 0) >= 60,
        2_000,
        scripted(ada, sam),
      ),
    ).toBe(true);
    const { slot, secret } = ada.link;
    // Ada closes the game; Sam's city carries on alone and the battle ends.
    await ada.link.leave();
    ada.deaf = true;
    expect(await driveUntil([sam], clock, () => !!sam.live.state()?.ended, 4_000)).toBe(true);
    const d = sam.live.state()!;
    expect(d.hashes.room).toMatchObject({ solo: true });
    // Ada opens the game again on that save: the force is still at the gates, and it asks again.
    const back = await openPage({
      room,
      clock,
      sim: loaded(adaSave),
      mayor: 'Ada',
      color: 0,
      rejoin: { slot, secret },
    });
    back.ticking = false;
    await flush();
    let done = false;
    void back.away.fight(expedition).then(() => (done = true));
    expect(await driveUntil([back], clock, () => done, 500)).toBe(true);
    // The battle was run again from the room's record, and came out as it did for Sam.
    const record = back.kept.battles.find((b) => b.id === d.id)!;
    expect(rerun(record.input).hash()).toBe(d.hashes.mine!.hash);
    expect(record.result).toMatchObject({ hash: d.hashes.mine!.hash });
    const report = back.sim.state.war!.reports!.at(-1)!;
    const result = rerun(record.input).result();
    const lost: Record<string, number> = {};
    for (const u of result.units) if (u.side === 0 && u.out) lost[u.kind] = (lost[u.kind] ?? 0) + 1;
    expect(report.lost).toEqual(lost);
    expect(back.sim.state.war!.expeditions![0]!.state).toBe('back');
    // Sam's city took the very same losses as its own.
    const hosted = sam.sim.state.war!.reports!.at(-1)!;
    expect(hosted.theirLost).toBe(Object.values(lost).reduce((n, v) => n + v, 0));
  }, 120_000);

  it('turns down a battle that is not the one its force was sent to fight', async () => {
    const { room, ada } = await setup({ v5: true });
    // Sam is a raw page that speaks protocol 6 and answers the call with another battle.
    const got: RegionRoomMsg[] = [];
    const conn: RegionConn = { send: (m) => void got.push(m), close: () => undefined };
    room.open(conn);
    const say = (m: object) => room.message(conn, JSON.stringify(m));
    say({ t: 'rhello', v: PROTOCOL_VERSION, mayor: 'Sam', color: 1, city: 'Samford' });
    say({
      t: 'report',
      city: 'Samford',
      report: {
        population: 5_000,
        kind: 'suburb',
        workers: 10,
        jobs: 10,
        shoppers: 5,
        offers: { buy: { power: 0, water: 0, garbage: 0 }, sell: { power: 0, water: 0, garbage: 0 } },
        deals: [],
        projectBuilt: false,
        tiers: [0, 0, 0, 0, 0, 0],
        counter: 0,
        clock: 100,
      },
    });
    await ada.link.reportNow(true);
    await flush();
    const sent = sendAgainst(ada.sim, 2);
    // The battle Sam's sim would make for a smaller force, passed off as Ada's.
    const samSim = loaded(saves.sam);
    const smaller = { ...sent.force, units: sent.force.units.slice(0, 1) };
    const made = samSim.query({
      type: 'liveBattle',
      call: { id: awayBattleId(sent.city.seed, sent.id), from: 1, force: smaller },
    }) as { input: BattleInput };
    const answer = ada.live.attack(sent.city, sent.id);
    await flush();
    const call = got.find((m) => m.t === 'bcall') as Extract<RegionRoomMsg, { t: 'bcall' }>;
    expect(call).toBeDefined();
    encodeBattle(made.input).forEach((data, part, all) =>
      say({ t: 'binput', id: call.id, part, parts: all.length, data }),
    );
    const r = await answer;
    expect(r).toMatchObject({ kind: 'refused', reason: expect.stringMatching(/not the one/) });
    // The force isn't held to the battle any more, and nothing runs.
    expect(ada.sim.state.war!.expeditions![0]!.settling).toBeUndefined();
    expect(ada.runs).toHaveLength(0);
  }, 120_000);
});
