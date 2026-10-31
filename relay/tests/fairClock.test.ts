import { afterEach, describe, expect, it } from 'vitest';
import {
  FAIR,
  MemoryRegionStore,
  REGION_LIMITS,
  RegionRoom,
  type RegionConn,
  type RegionRoomMsg,
  type RegionView,
} from '../region';
import { PROTOCOL_VERSION } from '../protocol';
import { loopbackPair, type Link } from '../../src/net/link';
import { RegionLink, fairCap, type CityPort } from '../../src/net/regionLink';
import { regionReport, type RegionReport } from '../../src/sim/systems/region';
import type { Sim } from '../../src/sim/sim';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { labTown } from '../../tests/war/researchTown';
import { FakeClock } from './harness';

/**
 * M37, step 10: the region's fair clock (design call 15). The room starts each war city's fair clock
 * at the war clock in its first report and moves it on at 1× (a game hour every 7.5 s) for the time
 * between its reports, two minutes at most, and only while the city is connected; it's written with
 * the region's five-minute keep. The city's page caps the war clock at the fair clock and a two-day
 * bank, so a city at 3× holds its training and research at the cap and catches up as it moves.
 */

interface Raw {
  got: RegionRoomMsg[];
  conn: RegionConn;
  say(m: object): void;
}

function raw(region: RegionRoom): Raw {
  const r: Raw = {
    got: [],
    conn: null as unknown as RegionConn,
    say: (m) => region.message(r.conn, JSON.stringify(m)),
  };
  r.conn = { send: (m) => r.got.push(m), close: () => undefined };
  region.open(r.conn);
  return r;
}

const report = (clock?: number) => ({
  t: 'report',
  city: 'Adaton',
  report: {
    population: 3_000,
    kind: 'suburb',
    workers: 10,
    jobs: 10,
    shoppers: 5,
    offers: { buy: { power: 0, water: 0, garbage: 0 }, sell: { power: 0, water: 0, garbage: 0 } },
    deals: [],
    projectBuilt: false,
    ...(clock === undefined ? {} : { tiers: [0, 0, 0, 0, 0, 0], counter: 50, clock }),
  },
});

const view = (r: Raw): RegionView =>
  (r.got.filter((m) => m.t === 'region').at(-1) as { region: RegionView }).region;
const fair = (r: Raw, slot = 1) => view(r).cities.find((c) => c.slot === slot)!.fair;

function region(store = new MemoryRegionStore()) {
  const clock = new FakeClock();
  const room = new RegionRoom('7FAIRC', 'local', store, clock);
  const ada = raw(room);
  ada.say({
    t: 'rhello',
    v: PROTOCOL_VERSION,
    mayor: 'Ada',
    color: 0,
    city: 'Adaton',
    create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } },
  });
  const secret = (ada.got.find((m) => m.t === 'rwelcome') as { secret: string }).secret;
  return { clock, room, store, ada, secret };
}

describe('M37 the region’s fair clock', () => {
  it('starts at the city’s war clock and moves on at 1× while its player is here', () => {
    const { clock, ada } = region();
    ada.say(report(100));
    expect(fair(ada)).toBe(100);
    // Ten minutes of play, reporting every half minute: 80 game hours at 1×.
    for (let k = 0; k < 20; k++) {
      clock.advance(30_000);
      ada.say(report(100 + 12 * (k + 1)));
    }
    expect(fair(ada)).toBe(100 + 600_000 / FAIR.msPerHour);
    // However fast the city runs, the fair clock is the region's: its own clock doesn't move it.
    ada.say(report(10_000));
    expect(fair(ada)).toBe(180);
    // Ten minutes silent on an open connection count two minutes at most.
    clock.advance(10 * 60_000);
    ada.say(report(10_000));
    expect(fair(ada)).toBe(180 + FAIR.gapMax / FAIR.msPerHour);
  });

  it('doesn’t count the time a city is away, and is kept in the region’s record without rows of its own', () => {
    const { clock, room, store, ada, secret } = region();
    ada.say(report(50));
    const before = store.rowsWritten;
    for (let k = 0; k < 20; k++) {
      clock.advance(30_000);
      ada.say(report(50));
    }
    // Ten minutes of reports: written with the five-minute keep, not a row each.
    expect(store.rowsWritten - before).toBeLessThanOrEqual(Math.ceil(600_000 / REGION_LIMITS.keepEvery) + 1);
    expect(fair(ada)).toBe(130);
    // Ada leaves for an hour: the record is written as the region empties, and the hour isn't play.
    room.closed(ada.conn);
    clock.advance(3600_000);
    const back = raw(room);
    back.say({
      t: 'rhello',
      v: PROTOCOL_VERSION,
      mayor: 'Ada',
      color: 0,
      city: 'Adaton',
      rejoin: { slot: 1, secret },
    });
    clock.advance(30_000);
    back.say(report(50));
    expect(fair(back)).toBe(134);
    // A new object over the same store carries on from the record.
    room.closed(back.conn);
    const again = new RegionRoom('7FAIRC', 'local', store, clock);
    const a2 = raw(again);
    a2.say({
      t: 'rhello',
      v: PROTOCOL_VERSION,
      mayor: 'Ada',
      color: 0,
      city: 'Adaton',
      rejoin: { slot: 1, secret },
    });
    expect(fair(a2)).toBe(134);
    // A city at peace (no war clock) has none.
    const { ada: calm } = region();
    calm.say(report());
    expect(fair(calm)).toBeUndefined();
  });
});

// ---------------------------------------------------------------- a city's page

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

const port = (sim: Sim): CityPort => ({
  command: async (cmd) => sim.dispatch(cmd),
  report: async (): Promise<RegionReport> => regionReport(sim),
  save: async () => sim.save(),
  cityName: () => sim.state.cityName,
});

describe('M37 the fair clock on a city’s page', () => {
  it('a city at 3× holds training and research at the cap, and catches up as the region’s clock moves', async () => {
    const clock = new FakeClock();
    const room = new RegionRoom('7FAIR3', 'local', new MemoryRegionStore(), clock);
    const { sim, place } = labTown(1);
    const barracks = place('barracks');
    sim.advance(24 * TICKS_PER_HOUR);
    const w = sim.state.war!;
    sim.dispatch({ type: 'queueResearch', key: 'land1' });
    for (let k = 0; k < 4; k++) sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
    const link = new RegionLink(port(sim), loopTo(room), {
      mayor: 'Ada',
      color: 0,
      saveEvery: 0,
      create: { name: 'Vale', rules: { war: true, scale: 'skirmish' } },
    });
    links.push(link);
    await link.start();
    await flush();
    // The region heard the city's clock: two days' bank from there.
    const c0 = w.clock;
    expect(link.view!.cities[0]!.fair).toBe(c0);
    expect(fairCap(link.view!, link.slot)).toBe(c0 + FAIR.bank);
    expect(w.clockCap).toBe(c0 + FAIR.bank);
    // Played at 3× for a game week in a few minutes: held at the cap.
    sim.advance(7 * 24 * TICKS_PER_HOUR);
    expect(w.clock).toBe(c0 + FAIR.bank);
    const held = { points: w.research!.points.land1 ?? 0, done: [...w.orders.values()].map((o) => o.done) };
    sim.advance(24 * TICKS_PER_HOUR);
    expect(w.research!.points.land1 ?? 0).toBe(held.points);
    expect([...w.orders.values()].map((o) => o.done)).toEqual(held.done);
    // Five minutes of real time, reporting every half minute: forty game hours at 1×.
    for (let k = 0; k < 10; k++) {
      clock.advance(30_000);
      await link.reportNow();
      await flush(5);
    }
    expect(w.clockCap).toBe(c0 + FAIR.bank + 40);
    sim.advance(3 * 24 * TICKS_PER_HOUR);
    expect(w.clock).toBe(c0 + FAIR.bank + 40);
    expect(w.research!.done.includes('land1') || (w.research!.points.land1 ?? 0) > held.points).toBe(true);
  }, 120_000);

  it('a cap the city saved from before is lifted where the region it joins has no war', async () => {
    const clock = new FakeClock();
    const room = new RegionRoom('7FAIRP', 'local', new MemoryRegionStore(), clock);
    const { sim } = labTown(1);
    const w = sim.state.war!;
    // Saved under a war region's cap; that region turned to peace (or this is another) meanwhile.
    expect(sim.dispatch({ type: 'warClock', cap: w.clock }).ok).toBe(true);
    const link = new RegionLink(port(sim), loopTo(room), {
      mayor: 'Ada',
      color: 0,
      saveEvery: 0,
      create: { name: 'Calm', rules: { war: false, scale: 'skirmish' } },
    });
    links.push(link);
    await link.start();
    await flush();
    // The first word on a new link is always told: no cap, so the war clock runs again.
    expect(w.clockCap).toBeUndefined();
    const before = w.clock;
    sim.advance(5 * TICKS_PER_HOUR);
    expect(w.clock).toBeGreaterThan(before);
  }, 120_000);
});
