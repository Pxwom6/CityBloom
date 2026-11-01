import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RegionRoom, MemoryRegionStore, type RegionConn } from '../../relay/region';
import { loopbackPair, type Link } from '../../src/net/link';
import { RegionLink, atomFor, type AtomSink, type CityPort } from '../../src/net/regionLink';
import { ATOM, atomStageNo, cleanRegionAtom, raceSlowWhy } from '../../src/data/atom';
import { TIER_KEYS } from '../../src/data/research';
import { Sim } from '../../src/sim/sim';
import { atomOf, atomReportField, atomStage } from '../../src/sim/systems/atom';
import { falloutOf } from '../../src/sim/systems/fallout';
import { regionReport, type RegionReport, type RegionUpdate } from '../../src/sim/systems/region';
import { startWinter } from '../../src/sim/systems/weather';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { newSim } from '../helpers';
import { clone } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40, step 9 (the sim's half): the race in the city's report (`RegionReport.atom`, built by
 * `atomReportField`) and what a city takes of a friend's (`applyRegionUpdate` into `PlayerNeighbour.atom`).
 * The room's half is `relay/tests/regionAtom.test.ts`.
 */

const M = TICKS_PER_MONTH;

/** A war city with no buildings of the race: facts set by hand (the stage follows from them). */
function warCity(): Sim {
  const sim = newSim({ rivals: true, disasters: false });
  expect(sim.state.war).toBeDefined();
  return sim;
}

const atomOfReport = (sim: Sim) => regionReport(sim).atom;

describe('M40: what a city’s report says of its race', () => {
  it('says nothing for a city at peace, and nothing for a war city that has not begun', () => {
    const peace = newSim({ disasters: false });
    expect(peace.state.war).toBeUndefined();
    expect(atomOfReport(peace)).toBeUndefined();
    expect('atom' in regionReport(peace)).toBe(false);
    const war = warCity();
    expect(atomOfReport(war)).toBeUndefined();
    expect('atom' in regionReport(war)).toBe(false);
    // Facts that make no race (the counts at nothing) say nothing either.
    atomOf(war);
    expect(atomOfReport(war)).toBeUndefined();
  });

  it('carries the stage’s number from the bomb built to the bomb used, with `fired` once it has left', () => {
    const sim = warCity();
    const a = atomOf(sim);
    const stage = () => atomOfReport(sim);
    a.bomb = { done: 100, paid: 2 };
    expect(stage()).toEqual({ stage: atomStageNo('bomb') });
    delete a.bomb;
    a.have = true;
    expect(stage()).toEqual({ stage: 5 });
    a.prep = { done: 0, to: 1 };
    expect(stage()).toEqual({ stage: 6 });
    delete a.have;
    delete a.prep;
    // Left a moment ago: in the air. A day on: used.
    a.fired = { tick: sim.state.tick, to: 1, name: 'Gravelford' };
    expect(atomStage(sim)).toBe('flying');
    expect(stage()).toEqual({ stage: 7, fired: true });
    sim.advance(ATOM.flight.hours * TICKS_PER_HOUR + 1);
    // (It landed on the neighbour it was aimed at, a day on: that raises the count the winter's reach reads.)
    expect(stage()).toEqual({ stage: 8, fired: true, boom: 1 });
    // The stage is the number `atomStageNo` gives, and the report reads as the room's reader does.
    const wire = JSON.parse(JSON.stringify(regionReport(sim)));
    expect(wire.atom.stage).toBe(atomStageNo(atomStage(sim)));
  });

  it('counts a bomb of the city’s anywhere that landed: the city struck, and its own on a computer neighbour', () => {
    const sim = warCity();
    const a = atomOf(sim);
    // Struck twice, one stopped by its dome.
    a.boom = 2;
    a.stopped = 1;
    expect(atomOfReport(sim)).toEqual({ stage: 0, boom: 2, hit: 2, stopped: 1 });
    // Its own bomb landed on a computer neighbour: that raises `boom` (its winter is `self:0`), not `hit`.
    startWinter(sim, 'self:0');
    expect(atomOfReport(sim)).toEqual({ stage: 0, boom: 3, hit: 2, stopped: 1 });
    // A bomb fired at a friend's city lands in that city's sim: nothing to count here.
    const friendly = warCity();
    atomOf(friendly).fired = {
      tick: -ATOM.flight.hours * TICKS_PER_HOUR,
      to: 1,
      name: 'Brookline',
      slot: 2,
      landed: true,
    };
    expect(atomOfReport(friendly)).toMatchObject({ stage: 8, fired: true });
    expect(atomOfReport(friendly)).not.toHaveProperty('boom');
    // Only a winter of its own bomb counts: the same winter from another city's bomb doesn't.
    const other = warCity();
    startWinter(other, 'brookline-1');
    expect(atomOfReport(other)).toBeUndefined();
  });

  it('carries the air that has crossed to each friend, by the side the friend stands on, rounded', () => {
    const sim = warCity();
    const [first, second] = sim.state.region.neighbours;
    // Two of the three neighbours are friends (a computer town gets its share by its record, not by the plume).
    first!.player = {
      slot: 3,
      mayor: 'Kit',
      color: 0,
      offers: {
        buy: { power: 0, water: 0, garbage: 0 },
        sell: { power: 0, water: 0, garbage: 0 },
      },
      workers: 0,
      jobs: 0,
      shoppers: 0,
      online: true,
    };
    second!.player = { ...first!.player, slot: 2 };
    const out = falloutOf(sim).out;
    out.north = 0;
    out.south = 0;
    out.west = 0;
    out[first!.side] = 12.345;
    out[second!.side] = 0.5;
    const plume = atomOfReport(sim)!.plume!;
    expect(plume).toEqual([
      { slot: 2, total: 0.5 },
      { slot: 3, total: 12.345 },
    ]);
    // Nothing has crossed to a friend: no entry, and with nothing else to say no race at all.
    out[first!.side] = 0;
    out[second!.side] = 0;
    expect(atomOfReport(sim)).toBeUndefined();
    // A computer neighbour has no slot to be told by.
    delete first!.player;
    delete second!.player;
    out[first!.side] = 9;
    expect(atomOfReport(sim)).toBeUndefined();
  });

  it('is a pure read: no state, no random stream, the same twice', () => {
    const sim = warCity();
    atomOf(sim).have = true;
    const before = sim.hash();
    const a = JSON.stringify(atomReportField(sim));
    expect(JSON.stringify(atomReportField(sim))).toBe(a);
    expect(sim.hash()).toBe(before);
  });
});

describe('M40: the report through a city with the race’s buildings', () => {
  let going: Sim;
  let plantOnly: Sim;
  let race: Sim;

  beforeAll(() => {
    const { sim, place } = labTown(0, { length: 800, streets: 7 });
    place('nuclear');
    sim.advance(M);
    ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
    const plant = place('enrichment');
    going = clone(sim);
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: plant });
    plantOnly = clone(sim);
    ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place('atomsilo') });
    sim.advance(M);
    race = sim;
  }, 300_000);

  it('follows the race from a plant going up to a bomb used, with the fuel while the bomb is to come', () => {
    expect(atomOfReport(going)).toEqual({ stage: 1 });
    // The plant finished and fuel made (the silo not yet placed).
    const fuelled = clone(plantOnly);
    ok(fuelled, { type: 'cheat', cheat: 'atom', stage: 'enriching' });
    expect(atomOfReport(fuelled)).toEqual({ stage: 2, fuel: 50 });
    const sim = clone(race);
    const rows: [string, number, number | undefined][] = [
      ['silo', 3, 100],
      ['bomb', 4, 100],
      ['ready', 5, undefined],
      ['preparing', 6, undefined],
      ['spent', 8, undefined],
    ];
    for (const [name, no, fuel] of rows) {
      ok(sim, { type: 'cheat', cheat: 'atom', stage: name as never });
      const r = atomOfReport(sim)!;
      expect(r.stage, name).toBe(no);
      expect(r.fuel, name).toBe(fuel);
      expect(r.fired, name).toBe(no === 8 ? true : undefined);
    }
    // The room reads exactly this.
    expect(JSON.parse(JSON.stringify(regionReport(sim))).atom).toMatchObject({ stage: 8, fired: true });
  });
});

describe('M40: what a city takes in of a friend’s race', () => {
  const none = { power: 0, water: 0, garbage: 0 };
  const update = (atom?: unknown): RegionUpdate => ({
    cities: [
      {
        slot: 2,
        name: 'Brookside',
        mayor: 'Sam',
        color: 1,
        population: 5_000,
        kind: 'suburb',
        offers: { buy: { ...none }, sell: { ...none } },
        workers: 0,
        jobs: 0,
        shoppers: 0,
        online: true,
        raid: 'open',
        ...(atom ? { atom: atom as never } : {}),
      },
    ],
    contracts: [],
    project: null,
    rules: { war: true, scale: 'total', supers: true, bomb: true },
  });
  const friend = (sim: Sim) => sim.state.region.neighbours.find((n) => n.player)!;

  it('keeps it on the neighbour, cleaned, and forgets it when the friend says none', () => {
    const sim = warCity();
    ok(sim, { type: 'regionUpdate', update: update({ stage: 5, boom: 1, plume: 4.5, extra: 1 }) });
    expect(friend(sim).player!.atom).toEqual({ stage: 5, boom: 1, plume: 4.5 });
    // A friend with its bomb ready can still be slowed: the silo closes and the launch starts again.
    expect(raceSlowWhy(friend(sim))).toBeNull();
    ok(sim, { type: 'regionUpdate', update: update({ stage: 3, fuel: 40 }) });
    expect(friend(sim).player!.atom).toEqual({ stage: 3, fuel: 40 });
    expect(raceSlowWhy(friend(sim))).toBeNull();
    ok(sim, { type: 'regionUpdate', update: update() });
    expect(friend(sim).player).not.toHaveProperty('atom');
    expect(raceSlowWhy(friend(sim))).toBe('Brookside isn’t racing for the atom bomb');
  });

  it('drops what is not a race, without refusing the rest of the news', () => {
    const sim = warCity();
    for (const bad of [
      { stage: 9 },
      { stage: 3, fuel: 200 },
      { stage: 3, plume: -1 },
      { stage: 3, fired: false },
    ]) {
      ok(sim, { type: 'regionUpdate', update: update(bad) });
      expect(friend(sim).player!.atom, JSON.stringify(bad)).toBeUndefined();
      expect(friend(sim).name).toBe('Brookside');
      expect(cleanRegionAtom(bad)).toBeNull();
    }
  });

  it('changes nothing in a city when the friend has no race to tell of (the hashes agree with the old shape)', () => {
    const a = warCity();
    const b = warCity();
    ok(a, { type: 'regionUpdate', update: update() });
    ok(b, { type: 'regionUpdate', update: update() });
    expect(a.hash()).toBe(b.hash());
    ok(b, { type: 'regionUpdate', update: update({ stage: 2 }) });
    expect(a.hash()).not.toBe(b.hash());
  });

  it('is cut to this city’s own plume by the page that passes it on', () => {
    const atom = {
      stage: 8,
      fired: true as const,
      boom: 1,
      plume: [
        { slot: 1, total: 12.5 },
        { slot: 2, total: 3 },
      ],
    };
    expect(atomFor(atom, 1)).toEqual({ stage: 8, fired: true, boom: 1, plume: 12.5 });
    expect(atomFor(atom, 2)).toEqual({ stage: 8, fired: true, boom: 1, plume: 3 });
    expect(atomFor(atom, 3)).toEqual({ stage: 8, fired: true, boom: 1 });
  });
});

// ---- Through the real link and room ---------------------------------------------------------------

function regionRoom(code: string): RegionRoom {
  return new RegionRoom(code, 'local', new MemoryRegionStore(), { now: () => performance.now() });
}

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

function cityPort(sim: Sim): CityPort {
  return {
    command: async (cmd) => sim.dispatch(cmd),
    report: async (): Promise<RegionReport> => regionReport(sim),
    save: async () => sim.save(),
    cityName: () => sim.state.cityName,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 30));
let links: RegionLink[] = [];
afterEach(() => {
  for (const l of links) l.leave();
  links = [];
});

describe('M40: a race through the link and the room', () => {
  it('reaches the other city as its neighbour’s race, the winters and the record reach the sink, and a quiet city is left alone', async () => {
    const room = regionRoom('ATOMRG');
    const ada = Sim.create({ seed: 'ada', cityName: 'Adaville', rivals: true });
    const sam = Sim.create({ seed: 'sam', cityName: 'Samford', rivals: true });
    const join = async (sim: Sim, mayor: string, color: number, create = false) => {
      const l = new RegionLink(cityPort(sim), loopTo(room), {
        mayor,
        color,
        fairClock: false,
        ...(create
          ? { create: { name: 'Two Rivers', rules: { war: true, scale: 'total', supers: true, bomb: true } } }
          : {}),
      });
      links.push(l);
      await l.start();
      return l;
    };
    const la = await join(ada, 'Ada', 0, true);
    const heard: string[] = [];
    const sink: AtomSink = {
      message: (m) => heard.push(m.t),
      welcome: (info) => heard.push(`welcome ${info.atoms?.length ?? '-'} ${info.winters?.length ?? '-'}`),
    };
    la.atom = sink;
    const ls = await join(sam, 'Sam', 1);
    for (const l of [la, ls]) await l.reportNow(true);
    await flush();
    // Peace in the race: Samford is a neighbour with nothing to tell.
    const friend = (s: Sim) => s.state.region.neighbours.find((n) => n.player)!;
    expect(friend(ada).player).not.toHaveProperty('atom');
    // Samford finishes the bomb: Adaville hears of it in its neighbour, and the room notes it.
    atomOf(sam).have = true;
    await ls.reportNow();
    await flush();
    expect(friend(ada).player!.atom).toEqual({ stage: 5 });
    expect(heard).toContain('atoms');
    // A bomb falls on Samford and its dome stops another: the room begins the winter for Adaville.
    const a = atomOf(sam);
    a.boom = 1;
    a.stopped = 1;
    await ls.reportNow();
    await flush();
    expect(friend(ada).player!.atom).toEqual({ stage: 5, boom: 1, hit: 1, stopped: 1 });
    expect(heard).toContain('winters');
    expect(la.view).toBeTruthy();
  });
});
