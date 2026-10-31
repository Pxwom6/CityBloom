import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { LIVE } from '../../relay/protocol';
import { RegionReplays, replayRecordId, replayTownKey } from '../../src/client/regionReplays';
import { historyRows, replayKey, replayVerdict } from '../../src/client/regionHistory';
import type { BattleRecord } from '../../src/client/battles';
import { Battle } from '../../src/sim/battle/battle';
import { S, TAG, type BattleInput } from '../../src/sim/battle/types';
import type { SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { friendsPage, type FwPage } from './friendsHarness';
import { Clock, closePages, driveUntil, flush, openPage, openRoom } from './liveHarness';
import { armAda, armSam, liveTown, sendAgainst } from './liveTown';

/**
 * M39 step 7, design calls 8 and 10: the region keeps the last live battles it saw end, and any city of
 * the region can fetch one and watch it again. Four pages through a real region room in Node: Ada's
 * force fights Sam's city live (both give orders), Eve looks on, Fay arrives after it is over.
 * A replay fetched from the room has to run again to the very end the combatants reached.
 */
afterEach(() => closePages());

let saves: { ada: SaveFile; sam: SaveFile; eve: SaveFile; fay: SaveFile };

beforeAll(async () => {
  const clock = new Clock();
  const room = openRoom(clock);
  const adaTown = liveTown('ada-live', 'Adaville');
  const samTown = liveTown('sam-live', 'Samford');
  const eveTown = liveTown('eve-live', 'Evetown');
  const fayTown = liveTown('fay-live', 'Faytown');
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
  await openPage({ room, clock, sim: fayTown.sim, mayor: 'Fay', color: 3 });
  armAda(adaTown);
  armSam(samTown);
  saves = {
    ada: adaTown.sim.save(),
    sam: samTown.sim.save(),
    eve: eveTown.sim.save(),
    fay: fayTown.sim.save(),
  };
  closePages();
}, 300_000);

const loaded = (save: SaveFile): Sim => {
  const sim = Sim.fromSave(save);
  sim.testMode = true;
  return sim;
};

type Desked = FwPage & { desk: RegionReplays };

/** A page with what a game has for the region's history and replays, as the browser would keep them. */
async function page(
  room: ReturnType<typeof openRoom>,
  clock: Clock,
  save: SaveFile,
  mayor: string,
  color: number,
  create?: Parameters<typeof openPage>[0]['create'],
): Promise<Desked> {
  const self = {} as { page: Desked };
  const desk = new RegionReplays({
    cityName: () => self.page.sim.state.cityName,
    tick: () => self.page.sim.state.tick,
    now: clock.now,
    loadTown: async (key) => self.page.kept.towns.get(key) ?? null,
    keepTown: async (key, town) => void self.page.kept.towns.set(key, town),
    keepBattle: async (r) => void self.page.kept.battles.push(r),
    changed: () => undefined,
  });
  const p = (await friendsPage(
    {
      room,
      clock,
      sim: loaded(save),
      mayor,
      color,
      ...(create ? { create } : {}),
      beforeStart: (l) => desk.attach(l),
    },
    clock,
  )) as Desked;
  self.page = p;
  p.desk = desk;
  return p;
}

const structsOf = (input: BattleInput) => input.layout.structs.length / S.stride;
const militaryOf = (input: BattleInput): number[] => {
  const out: number[] = [];
  for (let k = 0; k < structsOf(input); k++)
    if ((input.layout.structs[k * S.stride + S.tags]! & TAG.military) !== 0) out.push(k);
  return out;
};

/** The battle run again, by itself, to its end. */
function rerun(input: BattleInput): { step: number; hash: string; outcome: string } {
  const run = new Battle(structuredClone(input));
  while (!run.outcome) run.tick();
  const r = run.result();
  return { step: r.steps, hash: r.hash, outcome: r.outcome };
}

/** The battle as the viewer plays it: hosted by the town's own sim, to its end. */
function viewed(town: SaveFile, input: BattleInput): { step: number; hash: string } {
  const sim = loaded(town);
  const r = sim.dispatch({ type: 'battleResolve', input: structuredClone(input), mode: 'watch' });
  if (!r.ok) throw new Error(`the viewer could not host it: ${r.reason}`);
  for (let k = 0; k < 4_000; k++) {
    sim.step();
    for (const e of sim.events.splice(0))
      if (e.kind === 'battleEnded') return { step: Number(e.info!.step), hash: String(e.info!.hash) };
  }
  throw new Error('the viewer never saw the battle end');
}

/** Ada, Sam and Eve in one room; Ada's force fights Sam's city live, orders from both, to its end. */
async function fought() {
  const clock = new Clock();
  const room = openRoom(clock);
  const ada = await page(room, clock, saves.ada, 'Ada', 0, {
    name: 'Two Rivers',
    rules: { war: true, scale: 'skirmish' },
  });
  const sam = await page(room, clock, saves.sam, 'Sam', 1);
  const eve = await page(room, clock, saves.eve, 'Eve', 2);
  for (const p of [ada, sam, eve]) await p.link.reportNow(true);
  await flush();
  ada.ticking = false;
  eve.ticking = false;
  const sent = sendAgainst(ada.sim, sam.link.slot);
  let over = false;
  void ada.away.fight(sent.id).then(() => (over = true));
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
  expect(await driveUntil([ada, sam, eve], clock, () => over, 6_000, each)).toBe(true);
  // The ends cross the room, and the history lines are written.
  expect(
    await driveUntil(
      [ada, sam, eve],
      clock,
      () => [ada, sam, eve].every((p) => p.desk.list().length === 1),
      200,
    ),
  ).toBe(true);
  return { clock, room, ada, sam, eve };
}

describe('M39 step 7: replays from the region', () => {
  it('a city that looked on is told the region keeps the battle, lists it in the history, and fetches it', async () => {
    const { ada, sam, eve } = await fought();
    // Everyone knows the region keeps it, as the room's own end says.
    const ref = eve.desk.list()[0]!;
    expect([ref.from, ref.to]).toEqual([ada.link.slot, sam.link.slot]);
    expect(ref.agree).toBe(true);
    expect(ref.step).toBeGreaterThan(100);
    expect(sam.live.state()!.hashes.mine).toEqual({ step: ref.step, hash: ref.hash });
    expect(ada.desk.list()).toEqual([ref]);
    expect(sam.desk.list()).toEqual([ref]);

    // The history list has the battle as a live one, with its replay to watch.
    const rows = historyRows(eve.fw.view().history, eve.desk.list());
    const row = rows.find((r) => r.group === 'battles')!;
    expect(row).toBeTruthy();
    expect(row.live).toBe(true);
    expect(row.replay).toEqual(ref);
    expect(row.text).toContain('Adaville');
    expect(row.text).toContain('Samford');

    // Eve fetches it: the record and Samford's town, kept in her browser for the viewer.
    const got = await eve.desk.prepare(ref);
    expect(got).toEqual({ ok: true, id: replayRecordId(ref.from, ref.id) });
    const rec: BattleRecord = eve.kept.battles.find((b) => b.id === replayRecordId(ref.from, ref.id))!;
    expect(rec).toBeTruthy();
    expect(rec.townKey).toBe(replayTownKey(ref.from, ref.id));
    expect(eve.kept.towns.has(rec.townKey!)).toBe(true);
    expect(rec.region).toEqual({ expect: { step: ref.step, hash: ref.hash } });
    expect(rec.input.attacker.name).toBe('Adaville');
    expect(rec.input.defender.name).toBe('Samford');
    // The orders both players gave are in it, as the room stamped them.
    expect(rec.input.orders.length).toBeGreaterThanOrEqual(2);
    expect(rec.input.orders.some((o) => o.side === 0)).toBe(true);
    expect(rec.input.orders.some((o) => o.side === 1)).toBe(true);
    // Nothing is left half done.
    expect(eve.desk.statusOf(ref.from, ref.id)).toBeUndefined();

    // The battle, run again by itself, ends where the combatants' did: the same step and the same hash.
    const again = rerun(rec.input);
    expect({ step: again.step, hash: again.hash }).toEqual({ step: ref.step, hash: ref.hash });
    // And as the viewer plays it, in the town the region had saved of Samford: the same.
    const seen = viewed(eve.kept.towns.get(rec.townKey!)!, rec.input);
    expect(replayVerdict(rec.region!.expect!, seen)).toBe('checked');
  }, 300_000);

  it('a town that has changed since is said to differ, not passed off as the battle', async () => {
    const { eve } = await fought();
    const ref = eve.desk.list()[0]!;
    expect((await eve.desk.prepare(ref)).ok).toBe(true);
    const rec = eve.kept.battles.find((b) => b.id === replayRecordId(ref.from, ref.id))!;
    // Samford disbanded its army since the region saved its city: Samford's own orders find nothing to command.
    const town = loaded(eve.kept.towns.get(rec.townKey!)!);
    for (const u of [...town.state.war!.units.values()]) town.dispatch({ type: 'disbandUnit', unit: u.id });
    const seen = viewed(town.save(), rec.input);
    expect(replayVerdict(rec.region!.expect!, seen)).toBe('differs');
  }, 300_000);

  it('the two fighters watch it in their own copies of the town, and a late arrival is told of it on joining', async () => {
    const { clock, room, ada, sam, eve } = await fought();
    const ref = eve.desk.list()[0]!;
    // Samford kept its city as the battle began; Adaville kept the town it fought in.
    const mine = await sam.desk.prepare(ref);
    expect(mine.ok).toBe(true);
    const mineRec = sam.kept.battles.find((b) => b.id === replayRecordId(ref.from, ref.id))!;
    expect(
      replayVerdict(mineRec.region!.expect!, viewed(sam.kept.towns.get(mineRec.townKey!)!, mineRec.input)),
    ).toBe('checked');
    const theirs = await ada.desk.prepare(ref);
    expect(theirs.ok).toBe(true);
    const theirRec = ada.kept.battles.find((b) => b.id === replayRecordId(ref.from, ref.id))!;
    expect(
      replayVerdict(theirRec.region!.expect!, viewed(ada.kept.towns.get(theirRec.townKey!)!, theirRec.input)),
    ).toBe('checked');
    // Both fetched the same battle (the room has one record).
    expect(mineRec.input).toEqual(theirRec.input);

    // Fay joins after it is over: the welcome lists the replay and the history, and she can watch it.
    const fay = await page(room, clock, saves.fay, 'Fay', 3);
    await fay.link.reportNow(true);
    await flush();
    expect(fay.desk.list()).toEqual([ref]);
    const row = historyRows(fay.fw.view().history, fay.desk.list()).find((r) => r.group === 'battles')!;
    expect(row.replay).toEqual(ref);
    const got = await fay.desk.prepare(ref);
    expect(got.ok).toBe(true);
    const rec = fay.kept.battles.at(-1)!;
    expect(rec.input).toEqual(mineRec.input);
    expect(rec.region!.expect).toEqual({ step: ref.step, hash: ref.hash });
  }, 300_000);

  it('asking for a battle the region does not keep fails in words, and the list forgets it', async () => {
    const { eve } = await fought();
    const ref = { ...eve.desk.list()[0]!, id: 'not-kept' };
    // (A battle the page thinks is kept, that the room has dropped.)
    const bend = { t: 'bend' as const, ...ref };
    eve.desk.message(bend);
    expect(eve.desk.list().map((r) => r.id)).toContain('not-kept');
    const got = await eve.desk.prepare(ref, 60);
    expect(got.ok).toBe(false);
    expect(got).toMatchObject({ why: expect.stringContaining('may not keep it') });
    expect(eve.desk.statusOf(ref.from, ref.id)).toMatchObject({ state: 'error' });
    expect(eve.desk.list().map((r) => r.id)).not.toContain('not-kept');
    // Nothing was kept for a battle that never came.
    expect(eve.kept.battles.some((b) => b.id === replayRecordId(ref.from, 'not-kept'))).toBe(false);
  }, 300_000);

  it('the region keeps only the last battles, and the page’s list says the same', async () => {
    const { eve } = await fought();
    // The page mirrors the room’s cap on what it keeps.
    for (let k = 0; k < LIVE.replays + 3; k++)
      eve.desk.message({ t: 'bend', id: `old-${k}`, from: 1, to: 2, step: 10, hash: 'ab', agree: true });
    expect(eve.desk.list()).toHaveLength(LIVE.replays);
    expect(eve.desk.list().some((r) => replayKey(r.from, r.id) === replayKey(1, 'old-0'))).toBe(false);
  }, 300_000);
});
