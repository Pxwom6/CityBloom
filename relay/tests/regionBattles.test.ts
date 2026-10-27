import { afterEach, describe, expect, it } from 'vitest';
import { RegionRoom, MemoryRegionStore, parseRegionMsg, type RegionConn } from '../region';
import { loopbackPair, type Link } from '../../src/net/link';
import { RegionLink, type CityPort } from '../../src/net/regionLink';
import { Sim } from '../../src/sim/sim';
import { regionReport, type RegionReport } from '../../src/sim/systems/region';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { awayCity, awayInput, awayResult } from '../../src/sim/battle/away';
import { Battle } from '../../src/sim/battle/battle';
import { awayCaps, BATTLE_BUSY } from '../../src/sim/systems/raids';
import type { BattleInput } from '../../src/sim/battle/types';
import { SKIRMISH } from '../../src/data/battle';
import { BState } from '../../src/sim/world/buildings';
import { buildTown, newSim, placeAlong, serveTown } from '../../tests/helpers';

/**
 * Battles between friends' cities in a shared region (M35): a force raids a city whose player is
 * away; the battle is fought from the save the region keeps of it, and kept for it; when its player
 * comes back, its own sim takes the battle, the report matches what was broken, and the replay
 * plays out the same.
 */
function loopTo(room: RegionRoom): () => Promise<Link> {
  return async () => {
    const [mine, theirs] = loopbackPair();
    const conn: RegionConn = { send: (m) => theirs.send(JSON.stringify(m)), close: () => theirs.close() };
    room.open(conn);
    theirs.onmessage = (t) => room.message(conn, t);
    theirs.onclose = () => room.closed(conn);
    return mine;
  };
}

const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
let links: RegionLink[] = [];
afterEach(() => {
  for (const l of links) l.leave();
  links = [];
});

/** A town with services, grown a few months. */
function town(seed: string, name: string): { sim: Sim; place: (def: string) => number } {
  const sim = newSim({ seed, cityName: name, disasters: false });
  sim.state.cityName = name;
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(3 * TICKS_PER_MONTH);
  const segs = [...streets].reverse();
  const place = (def: string) => {
    for (const seg of segs)
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* next street */
      }
    throw new Error(`no room for ${def}`);
  };
  return { sim, place };
}

/** What a city has broken now: buildings in rubble, city buildings closed or wrecked, cratered roads. */
function broken(sim: Sim) {
  return {
    rubble: [...sim.state.buildings.values()]
      .filter((b) => b.state === BState.Rubble)
      .map((b) => b.id)
      .sort((a, b) => a - b),
    civics: [...sim.state.civics.values()]
      .filter((c) => c.damage > 0)
      .map((c) => c.id)
      .sort((a, b) => a - b),
    wrecked: [...sim.state.civics.values()]
      .filter((c) => c.wrecked)
      .map((c) => c.id)
      .sort((a, b) => a - b),
  };
}

/**
 * Two towns in a region at war, joined and armed: Ada with tanks, artillery and infantry, Sam with
 * an HQ and a bunker. What Sam's city takes when a battle comes in is recorded: a backdrop kept for
 * the replay, then the battle.
 */
async function regionAtWar() {
  const room = new RegionRoom('FIGHTS', 'local', new MemoryRegionStore(), { now: () => performance.now() });
  const ada = town('ada-war', 'Adaville');
  const sam = town('sam-war', 'Samford');
  // What Sam's city takes when a battle comes in: a backdrop kept for the replay, then the battle.
  const backdrops = new Map<string, ReturnType<Sim['save']>>();
  const taken: { input: BattleInput; late: boolean; away: boolean }[] = [];
  const port = (sim: Sim): CityPort => ({
    command: async (cmd) => sim.dispatch(cmd),
    report: async (): Promise<RegionReport> => regionReport(sim),
    save: async () => sim.save(),
    cityName: () => sim.state.cityName,
    battle: async (input, meta) => {
      backdrops.set(meta.id, sim.save());
      // As the game keeps it: one made while the player was away at its halved caps (M36).
      if (meta.away) input = awayCaps(input);
      taken.push({ input, late: meta.late, away: !!meta.away });
      // As the game sends it: who fought it, and whether the player was away (M36).
      const r = sim.dispatch({
        type: 'battleResolve',
        input,
        mode: meta.late ? 'instant' : 'watch',
        from: meta.from,
        ...(meta.away ? { away: true } : {}),
      });
      return r.ok ? 'taken' : r.reason === BATTLE_BUSY ? 'later' : 'refused';
    },
  });
  const join = async (sim: Sim, mayor: string, color: number, extra: object = {}) => {
    const l = new RegionLink(port(sim), loopTo(room), { mayor, color, saveEvery: 0, ...extra });
    links.push(l);
    await l.start();
    await flush();
    return l;
  };
  const la = await join(ada.sim, 'Ada', 0, {
    create: { name: 'Two Rivers', rules: { war: true, scale: 'skirmish' } },
  });
  const ls = await join(sam.sim, 'Sam', 1);
  // War is on in both: each builds its forces.
  for (const s of [ada.sim, sam.sim]) {
    expect(s.state.war).toBeDefined();
    s.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
  }
  ada.place('militaryhq');
  const depot = ada.place('vehicledepot');
  const barracks = ada.place('barracks');
  for (const kind of ['tank', 'tank', 'artillery'] as const)
    ada.sim.dispatch({ type: 'trainUnit', base: depot, kind });
  for (let k = 0; k < 3; k++) ada.sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  sam.place('militaryhq');
  sam.place('bunker');
  ada.sim.advance(7 * TICKS_PER_MONTH);
  sam.sim.advance(1 * TICKS_PER_MONTH);
  // Samford is a newcomer, which friends may raid only once it has raided them (M36): the test
  // lifts its shield, and both cities tell the region.
  expect(sam.sim.dispatch({ type: 'cheat', cheat: 'unshield' }).ok).toBe(true);
  await la.reportNow(true);
  await ls.reportNow(true);
  await flush();
  return { room, ada, sam, la, ls, backdrops, taken, join };
}

/** Ada's force raids Sam's city: fought by Ada's page in the region's save of it, reported, sent on. */
async function raidFriend(ada: { sim: Sim }, la: RegionLink, samSlot: number) {
  // Ada's force sets off for Sam's city and arrives.
  await la.reportNow(true);
  await flush();
  const neighbour = ada.sim.state.region.neighbours.find((n) => n.player?.slot === samSlot)!;
  expect(neighbour).toBeDefined();
  const units = [...ada.sim.state.war!.units.values()].map((u) => u.id);
  expect(units.length).toBeGreaterThanOrEqual(5);
  const sent = ada.sim.dispatch({
    type: 'sendForce',
    units,
    to: neighbour.id,
    route: 'highway',
    target: 'military',
    stance: 'bold',
  });
  expect(sent.ok).toBe(true);
  const fighting = () => ada.sim.state.war!.expeditions?.find((x) => x.state === 'fighting');
  for (let t = 0; t < 24 * TICKS_PER_HOUR && !fighting(); t++) ada.sim.step();
  const e = fighting()!;
  expect(e.slot).toBe(samSlot);
  // Ada's page: fought in the save the region keeps of Sam's city, reported, passed on.
  const save = await la.fetchSave(samSlot);
  const theirs = Sim.fromSave(save);
  const away = awayCity(ada.sim, e);
  const input = awayInput(away, theirs);
  const result = awayResult(input, Battle.run(structuredClone(input)));
  // As the page does (M36): the region keeps it first, then Ada's city takes the result.
  const answer = await la.sendBattle(samSlot, input, !!away.neighbour.absent, 2_000);
  expect(answer).toEqual({ kept: true });
  expect(
    ada.sim.dispatch({ type: 'battleReport', expedition: e.id, result: { ...result, replay: input.id } }).ok,
  ).toBe(true);
  await flush();
  return { input, result, theirs };
}

/** The battles the region keeps for a city. */
const pendingFor = (room: RegionRoom, slot: number) =>
  (room as unknown as { meta: { cities: { slot: number; pending?: unknown[] }[] } }).meta.cities.find(
    (c) => c.slot === slot,
  )!.pending;

describe('battles between friends (M35)', () => {
  it('a raid on an absent friend is kept for them, taken when they come back, and reported as it happened', async () => {
    const w = await regionAtWar();
    const { room, ada, sam, la, backdrops, taken, join } = w;
    let ls = w.ls;
    const kept: string[] = [];
    la.onBattleKept = (id) => kept.push(id);
    // Sam leaves: the city as it was left is what the region keeps.
    const samSlot = ls.slot;
    const secret = ls.secret;
    ls.leave();
    links = links.filter((l) => l !== ls);
    await flush();
    const { input, result, theirs } = await raidFriend(ada, la, samSlot);
    // Fought in the city as Sam left it: Sam's HQ and bunker are there to aim at.
    expect(theirs.state.tick).toBe(sam.sim.state.tick);
    expect(Battle.run(structuredClone(input)).result().objectives.aimed).toBeGreaterThan(0);
    // The region keeps it for Sam.
    const pending = () => pendingFor(room, samSlot);
    expect(pending()).toHaveLength(1);
    // Sam comes back: the battle comes with the welcome, and Sam's own sim takes it at once.
    const before = broken(sam.sim);
    ls = await join(sam.sim, 'Sam', 1, { rejoin: { slot: samSlot, secret } });
    await flush(100);
    expect(taken).toHaveLength(1);
    expect(taken[0]!.late).toBe(true);
    // Made while Sam was away: half the damage, on both sides alike (M36).
    expect(taken[0]!.away).toBe(true);
    expect(input.caps.maxCollapse).toBe(SKIRMISH.awayCollapse);
    expect(pending()).toBeUndefined();
    const report = sam.sim.state.war!.reports!.at(-1)!;
    expect(report.absent).toBe(true);
    expect(report.other).toBe(ada.sim.state.cityName);
    expect(report.outcome).toBe(result.outcome);
    expect(
      report.collapsed.length + report.civics.length + Object.keys(report.lost).length + report.theirLost,
    ).toBeGreaterThan(0);
    // The report is what was broken.
    const after = broken(sam.sim);
    const newRubble = after.rubble.filter((id) => !before.rubble.includes(id));
    expect([...report.collapsed].sort((a, b) => a - b)).toEqual(newRubble);
    expect(
      report.civics
        .filter((c) => c.wrecked)
        .map((c) => c.id)
        .sort((a, b) => a - b),
    ).toEqual(after.wrecked.filter((id) => !before.wrecked.includes(id)));
    for (const c of report.civics) expect(after.civics).toContain(c.id);
    // Sam's units knocked out are gone; Ada's attackers lost match on both sides.
    expect(report.theirLost).toBe(result.units.filter((u) => u.out).length);
    // The replay: the city as it was, the battle played out a tick at a time, ends the same.
    const replay = Sim.fromSave(backdrops.values().next().value!);
    expect(replay.dispatch({ type: 'battleResolve', input: taken[0]!.input, mode: 'watch' }).ok).toBe(true);
    for (let t = 0; t < 2_000 && replay.state.war!.battle; t++) replay.step();
    const r2 = replay.state.war!.reports!.at(-1)!;
    expect(r2.collapsed).toEqual(report.collapsed);
    expect(r2.civics).toEqual(report.civics);
    expect(r2.lost).toEqual(report.lost);
    // The region told Ada it kept the battle. Sent again (as after a lost word), Sam's city knows
    // it: the region forgets it again and nothing more happens to the city.
    expect(kept).toEqual([input.id]);
    const reports = sam.sim.state.war!.reports!.length;
    const hash = sam.sim.hash();
    const left = room.view().cities.find((c) => c.slot === samSlot)!.raidsLeft;
    // Acknowledged again, not kept again, and not counted again against Sam's raids for the day.
    expect(await la.sendBattle(samSlot, input, true, 2_000)).toEqual({ kept: true });
    await flush(100);
    expect(pendingFor(room, samSlot)).toBeUndefined();
    expect(room.view().cities.find((c) => c.slot === samSlot)!.raidsLeft).toBe(left);
    expect(sam.sim.state.war!.reports!.length).toBe(reports);
    expect(sam.sim.hash()).toBe(hash);
  }, 240_000);

  it('a raid that comes while the city is fighting another waits, and is taken once that one ends', async () => {
    const { room, ada, sam, la, ls, taken } = await regionAtWar();
    const samSlot = ls.slot;
    // A computer neighbour's raid is on in Samford when Ada's battle arrives.
    expect(sam.sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 }).ok).toBe(true);
    expect(sam.sim.state.war!.battle).toBeDefined();
    await raidFriend(ada, la, samSlot);
    await flush(100);
    expect(taken).toHaveLength(1);
    expect(taken[0]!.late).toBe(false);
    expect(pendingFor(room, samSlot)).toHaveLength(1);
    // That battle ends; with the next report the city takes Ada's, to watch as it happens.
    for (let t = 0; t < 24 * TICKS_PER_HOUR && sam.sim.state.war!.battle; t++) sam.sim.step();
    expect(sam.sim.state.war!.battle).toBeUndefined();
    await ls.reportNow();
    await flush(100);
    expect(taken).toHaveLength(2);
    expect(pendingFor(room, samSlot)).toBeUndefined();
    expect(sam.sim.state.war!.battle?.input.attacker.name).toBe('Adaville');
  }, 240_000);

  it('the room reads only sensible battle messages', () => {
    const ok = { t: 'battle', to: 2, id: 'exp-1a2b3c4d-55', part: 0, parts: 1, data: 'abc' };
    expect(parseRegionMsg(JSON.stringify(ok))).toEqual(ok);
    for (const bad of [
      { ...ok, to: 0 },
      { ...ok, id: 'has spaces' },
      { ...ok, parts: 99 },
      { ...ok, part: 1 },
      { ...ok, data: 5 },
    ])
      expect(parseRegionMsg(JSON.stringify(bad))).toBeNull();
    expect(parseRegionMsg(JSON.stringify({ t: 'battleSeen', id: 'exp-1' }))).toEqual({
      t: 'battleSeen',
      id: 'exp-1',
    });
  });
});
