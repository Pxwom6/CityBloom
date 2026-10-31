import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Battle } from '../../src/sim/battle/battle';
import { checkBattleInput } from '../../src/sim/battle/check';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { Clock, closePages, driveUntil, flush, openRoom, type Page } from './liveHarness';
import { armAda, armSam, liveTown, sendAgainst, type LiveTown } from './liveTown';
import { friendOf, friendsPage, settle, type FwPage } from './friendsHarness';

/**
 * M39 step 6: an ally sending help into a live battle, three pages against a real region room in Node
 * (design call 7). Ada's force attacks Sam's city; Kit, Sam's ally, sends tanks while it is on. The two
 * combatants' runs take the room's entry for the help in the order it was stamped and agree on the hash;
 * Kit's page watches the battle, and when it is over its losses come from the battle's own result and are
 * booked in its city once.
 */
afterEach(() => closePages());

/** Kit's army: an HQ, a depot and tanks (war must be on). */
function armKit(kit: LiveTown): void {
  kit.sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
  kit.place('militaryhq');
  const depot = kit.place('vehicledepot');
  for (let k = 0; k < 4; k++) kit.sim.dispatch({ type: 'trainUnit', base: depot, kind: 'tank' });
  kit.sim.advance(6 * TICKS_PER_MONTH);
}

let saves: { ada: SaveFile; sam: SaveFile; kit: SaveFile };

beforeAll(async () => {
  const clock = new Clock();
  const room = openRoom(clock);
  const ada = liveTown('ada-live', 'Adaville');
  const sam = liveTown('sam-live', 'Samford');
  const kit = liveTown('kit-live', 'Kitburg');
  const pages = [
    await friendsPage(
      {
        room,
        clock,
        sim: ada.sim,
        mayor: 'Ada',
        color: 0,
        create: { name: 'Three Rivers', rules: { war: true, scale: 'total', supers: true } as never },
      },
      clock,
    ),
    await friendsPage({ room, clock, sim: sam.sim, mayor: 'Sam', color: 1 }, clock),
    await friendsPage({ room, clock, sim: kit.sim, mayor: 'Kit', color: 2 }, clock),
  ];
  armAda(ada);
  armSam(sam);
  armKit(kit);
  kit.sim.dispatch({ type: 'cheat', cheat: 'unshield' });
  saves = { ada: ada.sim.save(), sam: sam.sim.save(), kit: kit.sim.save() };
  for (const p of pages) p.link.leave();
  closePages();
}, 240_000);

const loaded = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  return sim;
};

interface World {
  clock: Clock;
  room: ReturnType<typeof openRoom>;
  ada: FwPage;
  sam: FwPage;
  kit: FwPage;
}

/** Three pages in a region at war: Ada made it, Sam is slot 2, Kit slot 3; Kit and Sam are allies. */
async function setup(opts: { alliance?: 'alliance' | 'defensivePact' | null } = {}): Promise<World> {
  const clock = new Clock();
  const room = openRoom(clock);
  const ada = await friendsPage(
    {
      room,
      clock,
      sim: loaded(saves.ada),
      mayor: 'Ada',
      color: 0,
      create: { name: 'Three Rivers', rules: { war: true, scale: 'total', supers: true } as never },
    },
    clock,
  );
  const sam = await friendsPage({ room, clock, sim: loaded(saves.sam), mayor: 'Sam', color: 1 }, clock);
  const kit = await friendsPage({ room, clock, sim: loaded(saves.kit), mayor: 'Kit', color: 2 }, clock);
  for (const p of [ada, sam, kit]) await p.link.reportNow(true);
  for (const p of [ada, sam, kit]) await p.link.reportNow(true);
  await settle();
  // Ada's city is not played (only its force fights).
  ada.ticking = false;
  if (opts.alliance !== null) {
    const kind = opts.alliance ?? 'alliance';
    expect(kit.fw.propose(sam.link.slot, [{ k: kind }]).sent).toBe(true);
    await settle();
    const waiting = sam.fw.view().incoming;
    expect(waiting).toHaveLength(1);
    expect(await sam.fw.answer(waiting[0]!.id, true)).toBeNull();
    await settle();
  }
  return { clock, room, ada, sam, kit };
}

/** Ada's whole force against Sam's city, arrived and ready to fight live. */
function attack(w: World) {
  const sent = sendAgainst(w.ada.sim, w.sam.link.slot);
  return { expedition: sent.id };
}

/** Ada holds her whole force at the way in: the battle lasts, with the allies' tanks to meet it. */
function holdAll(ada: Page) {
  let gave = false;
  return () => {
    if (gave || (ada.live.state()?.step ?? 0) < 8) return;
    gave = ada.live.order({ kind: 'hold' });
  };
}

/** The units of Kit's city at home. */
const atHome = (kit: Page) => [...kit.sim.state.war!.units.values()].filter((u) => !u.away);

/** The kinds of Kit's units that a tank is. */
const tanks = (kit: Page, n: number) =>
  atHome(kit)
    .filter((u) => u.kind === 'tank')
    .slice(0, n)
    .map((u) => ({ id: u.id, kind: u.kind }));

describe('M39 step 6: allies send help into a live battle', () => {
  it('the help is stamped into the log, both combatants take it and agree, and the ally’s losses are booked once', async () => {
    const w = await setup();
    const { clock, ada, sam, kit } = w;
    const { expedition } = attack(w);
    let over = false;
    void ada.away.fight(expedition).then(() => (over = true));
    const hold = holdAll(ada);
    // The battle is on, and Kit's page is told so (it may watch, and help).
    expect(
      await driveUntil([ada, sam, kit], clock, () => (sam.live.state()?.step ?? 0) >= 40, 3_000, hold),
    ).toBe(true);
    const battle = ada.live.state()!.id;
    expect(kit.live.runningBattles().map((b) => b.id)).toEqual([battle]);
    // (Worn tanks: they go at half strength, and some may not come back.)
    for (const u of tanks(kit, 3)) kit.sim.state.war!.units.get(u.id)!.hp = 0.5;
    const sentUnits = tanks(kit, 3);
    const n = sentUnits.length;
    expect(n).toBeGreaterThanOrEqual(2);
    const away = (id: number) => kit.sim.state.war!.units.get(id)?.away;
    const ally = friendOf(kit, sam.link.slot);
    expect(await kit.live.sendHelp(battle, ally.id, sentUnits)).toBeNull();
    // Kit's units are away and pinned the moment they are sent.
    const exp = kit.sim.state.war!.expeditions!.find((e) => e.help)!;
    expect(exp).toMatchObject({ state: 'fighting', settling: true, help: { battle }, to: ally.id });
    for (const u of sentUnits) expect(away(u.id)).toBe(exp.id);
    expect(kit.live.helping()).toMatchObject({ state: 'asked', units: n });
    // The room stamps it; Kit's page sees the entry in the log it watches, and it is on its way.
    await driveUntil([ada, sam, kit], clock, () => kit.live.helping()?.state === 'on', 200);
    const on = kit.live.helping()!;
    expect(on).toMatchObject({ state: 'on', side: 1, units: n });
    expect(on.arrive! - 480).toBeGreaterThanOrEqual(40);
    // It arrives, fights, and the battle ends.
    const seen = new Set<string>();
    expect(
      await driveUntil(
        [ada, sam, kit],
        clock,
        () => over && kit.live.helping()?.state === 'done',
        6_000,
        () => {
          seen.add(kit.live.helping()!.state);
        },
      ),
    ).toBe(true);
    expect([...seen]).toEqual(expect.arrayContaining(['on', 'fighting', 'done']));
    // The two combatants ran the same battle, help and all.
    const a = ada.live.state()!;
    const d = sam.live.state()!;
    expect(a.hashes.mine).toEqual(d.hashes.mine);
    expect(a.hashes.room).toMatchObject({ agree: true });
    expect(a.desync || d.desync).toBe(false);
    const theirs = ada.kept.battles.find((b) => b.id === battle)!.input;
    const mine = sam.kept.battles.find((b) => b.id === `def-${battle}`)!.input;
    expect(mine.helpers).toEqual(theirs.helpers);
    expect(mine.helpers).toHaveLength(1);
    expect(mine.helpers![0]).toMatchObject({ owner: kit.link.slot, side: 1, name: 'Kitburg' });
    expect(mine.helpers![0]!.at).toBeGreaterThanOrEqual(40);
    expect(mine.helpers![0]!.arrive).toBe(on.arrive);
    expect(checkBattleInput(mine)).toBeNull();
    // The battle as recorded plays to the hash both pages reported, and the helper's tanks were in it.
    const again = Battle.run(structuredClone(mine));
    expect(again.hash()).toBe(d.hashes.mine!.hash);
    const owned = again.result().units.filter((u) => u.owner === kit.link.slot);
    expect(owned).toHaveLength(n);
    // Kit's page watched the same battle: its losses are the record's, and booked in its city once.
    const lost = owned.filter((u) => u.out).length;
    expect(kit.live.helping()).toMatchObject({ state: 'done', lost });
    // (Worn tanks: some did not come back.)
    expect(lost).toBeGreaterThan(0);
    const back = kit.sim.state.war!.expeditions?.find((e) => e.help);
    // A force with nothing left of it is gone at once; the rest are on their way home.
    if (lost < n) {
      expect(back!.state).toBe('back');
      expect(back!.units).toHaveLength(n - lost);
    } else expect(back).toBeUndefined();
    expect(kit.sim.state.war!.reports!.at(-1)).toMatchObject({ help: true, ours: true, other: 'Samford' });
    expect(Object.values(kit.sim.state.war!.reports!.at(-1)!.lost).reduce((n, v) => n + (v ?? 0), 0)).toBe(
      lost,
    );
    // A second report of the same battle changes nothing: it is applied once.
    const unitsNow = kit.sim.state.war!.units.size;
    expect(
      kit.sim.dispatch({ type: 'helpEnd', expedition: exp.id, result: { outcome: 'repelled', units: [] } })
        .ok,
    ).toBe(false);
    expect(kit.sim.state.war!.units.size).toBe(unitsNow);
    for (const u of owned) {
      const simId = sentUnits[u.id - kit.link.slot * 10_000]!.id;
      if (u.out) expect(kit.sim.state.war!.units.has(simId)).toBe(false);
      else expect(kit.sim.state.war!.units.get(simId)!.hp).toBeLessThanOrEqual(1);
    }
    // They come home after a while, not all at once.
    for (let t = 0; t < 3 * TICKS_PER_HOUR; t++) kit.sim.step();
    expect(kit.sim.state.war!.expeditions).toBeUndefined();
    for (const u of sentUnits) if (kit.sim.state.war!.units.has(u.id)) expect(away(u.id)).toBeUndefined();
    // The defender's city counts its own units lost, not the ally's (whose ids may be any city unit's).
    const own = again.result().units.filter((u) => u.owner === -1 && u.out).length;
    const hosted = sam.sim.state.war!.reports!.at(-1)!;
    expect(Object.values(hosted.lost).reduce((n, v) => n + (v ?? 0), 0)).toBe(own);
  }, 240_000);

  it('a battle that ends before the force can get there: no part in it, no report, the force comes home as it went', async () => {
    const w = await setup();
    const { clock, ada, sam, kit } = w;
    const { expedition } = attack(w);
    let over = false;
    void ada.away.fight(expedition).then(() => (over = true));
    // (No hold: Ada's force fights its way in, and the battle is over inside half a minute.)
    expect(await driveUntil([ada, sam, kit], clock, () => (sam.live.state()?.step ?? 0) >= 40, 3_000)).toBe(
      true,
    );
    const battle = ada.live.state()!.id;
    const sent = tanks(kit, 2);
    expect(await kit.live.sendHelp(battle, friendOf(kit, sam.link.slot).id, sent)).toBeNull();
    expect(
      await driveUntil([ada, sam, kit], clock, () => over && kit.live.helping()?.state === 'done', 6_000),
    ).toBe(true);
    const h = kit.live.helping()!;
    expect(h.arrive!).toBeGreaterThan(ada.live.state()!.hashes.mine!.step);
    expect(h).toMatchObject({ state: 'done', late: true, lost: 0 });
    // The force was still on its way when the battle ended: untouched in its result, no report in its city.
    const record = sam.kept.battles.find((b) => b.id === `def-${battle}`)!.input;
    const theirs = Battle.run(structuredClone(record))
      .result()
      .units.filter((u) => u.owner === kit.link.slot);
    expect(theirs.every((u) => !u.out && u.hp === 1)).toBe(true);
    expect(kit.sim.state.war!.reports?.some((r) => r.help)).toBeFalsy();
    for (let t = 0; t < 3 * TICKS_PER_HOUR; t++) kit.sim.step();
    expect(kit.sim.state.war!.expeditions).toBeUndefined();
    for (const u of sent) expect(kit.sim.state.war!.units.get(u.id)!.away).toBeUndefined();
  }, 240_000);

  it('without a pact the room turns the help down and the force comes home as it went', async () => {
    const w = await setup({ alliance: null });
    const { clock, ada, sam, kit } = w;
    const { expedition } = attack(w);
    void ada.away.fight(expedition);
    expect(
      await driveUntil(
        [ada, sam, kit],
        clock,
        () => (sam.live.state()?.step ?? 0) >= 20,
        3_000,
        holdAll(ada),
      ),
    ).toBe(true);
    const battle = ada.live.state()!.id;
    const sent = tanks(kit, 2);
    expect(await kit.live.sendHelp(battle, friendOf(kit, sam.link.slot).id, sent)).toBeNull();
    expect(await driveUntil([ada, sam, kit], clock, () => kit.live.helping()?.state === 'refused', 200)).toBe(
      true,
    );
    expect(kit.live.helping()!.reason).toMatch(/Only an ally can send help/);
    // Called home at once, losing nothing; the battle has no helper.
    for (let t = 0; t < 3 * TICKS_PER_HOUR; t++) kit.sim.step();
    expect(kit.sim.state.war!.expeditions).toBeUndefined();
    for (const u of sent) expect(kit.sim.state.war!.units.get(u.id)!.away).toBeUndefined();
    expect(sam.live.input()!.helpers ?? []).toHaveLength(0);
  }, 240_000);

  it('a force the page lost track of (the page was reloaded) is called home by the next frame', async () => {
    const w = await setup();
    const { kit, sam } = w;
    const two = tanks(kit, 2);
    const sent = kit.sim.dispatch({
      type: 'helpSend',
      units: two.map((u) => u.id),
      to: friendOf(kit, sam.link.slot).id,
      battle: 'exp-x-1',
      route: 'highway',
    });
    expect(sent.ok).toBe(true);
    for (const u of two) expect(kit.sim.state.war!.units.get(u.id)!.away).toBeDefined();
    kit.live.frame(kit.sim.stats().war ?? null, []);
    await flush();
    expect(kit.sim.state.war!.expeditions![0]!.state).toBe('back');
    for (let t = 0; t < 3 * TICKS_PER_HOUR; t++) kit.sim.step();
    for (const u of two) expect(kit.sim.state.war!.units.get(u.id)!.away).toBeUndefined();
  }, 240_000);
});
