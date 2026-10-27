import { afterEach, describe, expect, it } from 'vitest';
import { RegionRoom, MemoryRegionStore, type RegionConn } from '../region';
import { loopbackPair, type Link } from '../../src/net/link';
import { RegionLink, type CityPort } from '../../src/net/regionLink';
import { RegionOps } from '../../src/client/ops';
import { Sim } from '../../src/sim/sim';
import { regionReport, type RegionReport } from '../../src/sim/systems/region';
import { intelSummary } from '../../src/sim/systems/intel';
import { dossierOf } from '../../src/sim/systems/regionOps';
import { readSaveFile } from '../../src/sim/save';
import { CIVIC } from '../../src/data/civic';
import { INTEL, SPY_OP } from '../../src/data/intel';
import { civicOnline } from '../../src/sim/world/civic';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, newSim, placeAlong, serveTown } from '../../tests/helpers';
import { until } from './harness';

/**
 * M37, step 9, end to end: two friends' cities in a region at war, each run headless in place as
 * its player's page would run it (`RegionLink`, and `RegionOps` for the sender's page). Ada's agents
 * go to Samford; the region rolls each with its own dice (fixed here), Ada's city takes the verdict
 * and Samford's city takes what the region decided, choosing for itself what a saboteur closes.
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

/** A served town big enough to staff its forces' buildings. */
function town(seed: string, name: string): { sim: Sim; place: (def: string) => number } {
  const sim = newSim({ seed, cityName: name, disasters: false });
  sim.state.cityName = name;
  const { streets } = buildTown(sim, { length: 800, streets: 7 });
  serveTown(sim);
  sim.advance(2 * TICKS_PER_MONTH);
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

async function friends() {
  const dice = { r: 0 };
  // Every save a city sends is kept (a real region keeps one every ten minutes).
  const room = new RegionRoom(
    '7SPIES',
    'local',
    new MemoryRegionStore(),
    { now: () => performance.now(), roll: () => dice.r },
    { saveEvery: 0 },
  );
  const ada = town('ada-spies', 'Adaville');
  const sam = town('sam-spies', 'Samford');
  const notices: string[] = [];
  const port = (sim: Sim): CityPort => ({
    command: async (cmd) => sim.dispatch(cmd),
    report: async (): Promise<RegionReport> => regionReport(sim),
    save: async () => sim.save(),
    cityName: () => sim.state.cityName,
    // As the game takes it (`Game.takeOp`): once, by the city's own sim.
    op: async (o) => {
      const r = sim.dispatch({ type: 'opResolve', ...o });
      return r.ok || r.reason === 'The city has taken that operation already' ? 'taken' : 'refused';
    },
  });
  const join = async (sim: Sim, mayor: string, color: number, extra: object = {}) => {
    // The test fast-forwards its cities: no fair clock here (fairClock.test.ts has its own).
    const l = new RegionLink(port(sim), loopTo(room), {
      mayor,
      color,
      saveEvery: 0,
      fairClock: false,
      ...extra,
    });
    l.onNotice = (t) => notices.push(`${mayor}: ${t}`);
    links.push(l);
    await l.start();
    await flush();
    return l;
  };
  const la = await join(ada.sim, 'Ada', 0, {
    create: { name: 'Two Rivers', rules: { war: true, scale: 'skirmish', supers: true } },
  });
  const ls = await join(sam.sim, 'Sam', 1);
  for (const s of [ada.sim, sam.sim]) {
    expect(s.state.war).toBeDefined();
    s.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    s.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  }
  // Ada's spy agency, with intelligence research as far as Stealth; Samford is a little way on in
  // Air research, and lets friends past its newcomer's shield (the test's say-so, as in M36's).
  ada.place('militaryhq');
  ada.sim.dispatch({ type: 'cheat', cheat: 'research', tiers: ['intel1', 'intel2', 'intel3'] });
  ada.place('spyagency');
  sam.place('militaryhq');
  sam.sim.dispatch({ type: 'cheat', cheat: 'research', tiers: ['air1', 'air2'] });
  ada.sim.advance(TICKS_PER_MONTH);
  sam.sim.advance(TICKS_PER_MONTH);
  expect(sam.sim.dispatch({ type: 'cheat', cheat: 'unshield' }).ok).toBe(true);
  await ls.reportNow(true);
  await la.reportNow(true);
  await flush();
  const samSlot = ls.slot;
  const friend = ada.sim.state.region.neighbours.find((n) => n.player?.slot === samSlot)!;
  expect(friend.player!.tiers).toEqual([0, 2, 0, 0, 0, 0]);
  // Ada's page: puts operations to the region and hands the verdicts back to the city.
  const ops = new RegionOps({
    command: async (cmd) => ada.sim.dispatch(cmd),
    post: (op) => la.sendOp(op, 2_000),
    fetchSave: (slot) => la.fetchSave(slot),
  });
  /** Sends an agent and steps Ada's city until it arrives, then lets Ada's page put it to the region. */
  const mission = async (op: 'reveal' | 'sabotage' | 'steal', extra: object = {}) => {
    const w = ada.sim.state.war!;
    for (let t = 0; t < 60 && (intelSummary(ada.sim)!.free ?? 0) <= 0; t++) ada.sim.advance(TICKS_PER_HOUR);
    const r = ada.sim.dispatch({ type: 'spyMission', neighbour: friend.id, op, ...extra });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    const id = r.ok ? r.created![0]! : -1;
    const m = () => w.intel!.missions.find((x) => x.id === id);
    for (let t = 0; t < 30 && m()?.state === 'out'; t++) ada.sim.advance(TICKS_PER_HOUR);
    expect(m()?.state).toBe('arrived');
    const waiting = intelSummary(ada.sim)!.regionOps;
    expect(waiting.map((o) => o.mission)).toEqual([id]);
    await ops.settle(waiting[0]!);
    await flush(100);
    return { id, m };
  };
  return { room, dice, ada, sam, la, ls, samSlot, friend, mission, notices };
}

/** Samford's working power plants, largest first. */
const plants = (sim: Sim) =>
  [...sim.state.civics.values()]
    .filter((c) => (CIVIC.get(c.def)?.output?.power ?? 0) > 0)
    .sort((a, b) => (CIVIC.get(b.def)!.output!.power ?? 0) - (CIVIC.get(a.def)!.output!.power ?? 0));

describe('M37 spies between friends, end to end', () => {
  it('a saboteur from Adaville closes Samford’s plant in Samford’s own sim, and both cities’ logs agree', async () => {
    const { ada, sam, mission, samSlot } = await friends();
    const plant = plants(sam.sim).find((c) => civicOnline(c))!;
    expect(plant).toBeDefined();
    const { m } = await mission('sabotage', { target: 'power' });
    // Ada's city: the agent did it, and comes home.
    expect(m()?.state).toBe('back');
    expect(m()?.outcome).toBe('success');
    expect(ada.sim.state.war!.intel!.results.at(-1)!.text).toMatch(/sabotaged Samford’s power plant/);
    // Samford's city, playing: its own largest working plant is closed for a day.
    await until(() => plant.damage > 0, 5_000, 'the plant to close');
    expect(plant.damage).toBe(INTEL.sabotageClosed);
    const log = sam.sim.state.war!.intel!.results.at(-1)!.text;
    expect(log).toBe(
      `Saboteurs from Adaville closed the ${CIVIC.get(plant.def)!.name.toLowerCase()} for a day`,
    );
    // Taken once: the region has forgotten it, and the city keeps its mark.
    expect(sam.sim.state.war!.taken?.some((k) => k.startsWith('1:op:op-'))).toBe(true);
    void samSlot;
  }, 240_000);

  it('a look round brings home Samford’s dossier from its save in the region; a caught spy is an incident on both sides', async () => {
    const { ada, sam, mission, samSlot, dice, notices, room } = await friends();
    await mission('reveal');
    const seen = ada.sim.state.war!.intel!.seen![samSlot]!;
    // As Samford's save in the region shows it.
    const want = dossierOf(readSaveFile(sam.sim.save()))!;
    expect(seen.tiers).toEqual(want.tiers);
    expect(seen.tiers).toEqual([0, 2, 0, 0, 0, 0]);
    expect(seen.defences).toEqual(want.defences);
    // The next is caught (the region's dice): Ada loses the agent, Samford logs the catch, and the
    // whole region hears of it.
    dice.r = 999;
    const caught = await mission('reveal');
    expect(caught.m()).toBeUndefined();
    expect(ada.sim.state.war!.intel!.results.at(-1)!.text).toMatch(/was caught in Samford: an incident/);
    await until(
      () => sam.sim.state.war!.intel?.results.at(-1)?.text === 'Your agents caught a spy from Adaville',
      5_000,
      'Samford to log the catch',
    );
    await until(
      () => notices.includes('Sam: A spy from Adaville was caught in Samford'),
      5_000,
      'the notice',
    );
    expect(notices).toContain('Ada: A spy from Adaville was caught in Samford');
    // Samford may answer Adaville now (it struck first).
    expect(room.view().cities.find((c) => c.slot === 1)!.raidedBy).toEqual([]);
    expect(room.view().cities.find((c) => c.slot === samSlot)!.raidedBy).toEqual([1]);
  }, 240_000);

  it('a theft banks a quarter of Air 1; turned away by the region, the agent comes home refunded', async () => {
    const { ada, mission, ls, friend } = await friends();
    await mission('steal', { branch: 'air' });
    expect(ada.sim.state.war!.research!.points.air1).toBe(Math.floor(300 * INTEL.stealShare));
    // A saboteur sets off while Samford's player is here; the player leaves before it arrives.
    const w = ada.sim.state.war!;
    for (let t = 0; t < 60 && (intelSummary(ada.sim)!.free ?? 0) <= 0; t++) ada.sim.advance(TICKS_PER_HOUR);
    const r = ada.sim.dispatch({ type: 'spyMission', neighbour: friend.id, op: 'sabotage', target: 'power' });
    expect(r.ok).toBe(true);
    const id = r.ok ? r.created![0]! : -1;
    const m = () => w.intel!.missions.find((x) => x.id === id)!;
    ls.leave();
    await flush(100);
    for (let t = 0; t < 30 && m().state === 'out'; t++) ada.sim.advance(TICKS_PER_HOUR);
    expect(m().state).toBe('arrived');
    // Ada's page puts it to the region, which turns it away: nothing happened, all is refunded.
    const before = ada.sim.state.treasury;
    const ops = new RegionOps({
      command: async (cmd) => ada.sim.dispatch(cmd),
      post: (op) => links[0]!.sendOp(op, 2_000),
      fetchSave: (slot) => links[0]!.fetchSave(slot),
    });
    await ops.settle(intelSummary(ada.sim)!.regionOps[0]!);
    expect(ada.sim.state.treasury - before).toBe(SPY_OP.sabotage.cost);
    expect(m().state).toBe('back');
    expect(m().outcome).toBeUndefined();
    expect(w.intel!.results.at(-1)!.text).toBe(
      `Agent ${m().agent} was turned back from Samford: Samford’s player isn’t here: saboteurs wait for them. The mission’s $45,000 is refunded`,
    );
  }, 240_000);
});
