import { afterEach, describe, expect, it } from 'vitest';
import { RegionRoom, MemoryRegionStore, parseRegionMsg, type RegionConn } from '../region';
import { loopbackPair, type Link } from '../../src/net/link';
import { RegionLink, regionUpdateFor, type CityPort } from '../../src/net/regionLink';
import { Sim } from '../../src/sim/sim';
import { regionReport, type RegionReport } from '../../src/sim/systems/region';
import { PERSONALITY_IDS } from '../../src/data/war';
import { TICKS_PER_MONTH } from '../../src/sim/time';

/**
 * War in a shared region (M34): the region's host sets whether war is on and how far it may go;
 * the rules reach every city, which then raises forces. Others can't change them.
 */
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

describe('war rules in a shared region (M34)', () => {
  it('the host turns war on; every city gets the rules and a war state; a guest cannot change them', async () => {
    const room = regionRoom('WARRUL');
    const ada = Sim.create({ seed: 'ada', cityName: 'Adaville' });
    const sam = Sim.create({ seed: 'sam', cityName: 'Samford' });
    const join = async (sim: Sim, mayor: string, color: number, create = false) => {
      const l = new RegionLink(cityPort(sim), loopTo(room), {
        mayor,
        color,
        ...(create ? { create: { name: 'Two Rivers' } } : {}),
      });
      links.push(l);
      await l.start();
      return l;
    };
    const la = await join(ada, 'Ada', 0, true);
    const ls = await join(sam, 'Sam', 1);
    for (const l of [la, ls]) await l.reportNow(true);
    await flush();
    // Peace to begin with: no rules in the cities, no war state.
    expect(la.view!.rules).toEqual({ war: false, scale: 'skirmish' });
    expect(la.isHost).toBe(true);
    expect(ls.isHost).toBe(false);
    expect(ada.state.war).toBeUndefined();
    expect('rules' in sam.state.region).toBe(false);
    // A guest's rules are ignored.
    ls.setRules({ war: true, scale: 'total' });
    await flush();
    expect(ls.view!.rules.war).toBe(false);
    // The host's are taken, and reach both cities.
    la.setRules({ war: true, scale: 'war' });
    await flush();
    expect(ls.view!.rules).toEqual({ war: true, scale: 'war' });
    for (const sim of [ada, sam]) {
      expect(sim.state.region.rules).toEqual({ war: true, scale: 'war' });
      expect(sim.state.war).toBeDefined();
      expect(sim.stats().war).not.toBeNull();
    }
    // The other player's city is no computer rival; the simulated towns left are.
    const other = sam.state.region.neighbours.find((n) => n.player);
    expect(other?.rival).toBeUndefined();
    expect(sam.state.region.neighbours.filter((n) => !n.player).every((n) => !!n.rival)).toBe(true);
    // War off again: the rules go; what the cities built stays.
    la.setRules({ war: false, scale: 'skirmish' });
    await flush();
    expect('rules' in ada.state.region).toBe(false);
    expect(ada.state.war).toBeDefined();
  });

  it('the region room reads only sensible rules', () => {
    expect(parseRegionMsg(JSON.stringify({ t: 'rrules', rules: { war: true, scale: 'total' } }))).toEqual({
      t: 'rrules',
      rules: { war: true, scale: 'total' },
    });
    for (const bad of [{ war: 'yes', scale: 'war' }, { war: true, scale: 'nuclear' }, null, { war: true }])
      expect(parseRegionMsg(JSON.stringify({ t: 'rrules', rules: bad }))).toBeNull();
  });

  it('an older region (no rules in its view) means peace', () => {
    const view = {
      code: 'OLDREG',
      name: 'Old',
      kind: 'local' as const,
      cities: [],
      project: { name: 'x', goal: 1, total: 0, by: {}, funded: false, host: 0, built: false, power: 0 },
    };
    const u = regionUpdateFor(view as never, 1);
    expect('rules' in u).toBe(false);
  });
});

describe('rival neighbours (M34)', () => {
  it('give each computer neighbour a character and forces, without changing the neighbours themselves', () => {
    const peace = Sim.create({ seed: 'rivals-a' });
    const war = Sim.create({ seed: 'rivals-a', rivals: true });
    const strip = (s: Sim) => s.state.region.neighbours.map(({ rival: _r, ...n }) => n);
    expect(strip(war)).toEqual(strip(peace));
    const rivals = war.state.region.neighbours.map((n) => n.rival!);
    expect(rivals.every((r) => PERSONALITY_IDS.includes(r.personality))).toBe(true);
    expect(new Set(rivals.map((r) => r.personality)).size).toBe(rivals.length);
    expect(rivals.every((r) => r.forces > 0 && r.defences > 0)).toBe(true);
    expect(peace.state.region.neighbours.every((n) => !('rival' in n))).toBe(true);
  });

  it('arm month by month towards what their character keeps, the same on every run', () => {
    const a = Sim.create({ seed: 'rivals-b', rivals: true });
    const b = Sim.create({ seed: 'rivals-b', rivals: true });
    const before = a.state.region.neighbours.map((n) => n.rival!.forces);
    a.advance(6 * TICKS_PER_MONTH);
    b.advance(6 * TICKS_PER_MONTH);
    const after = a.state.region.neighbours.map((n) => n.rival!.forces);
    expect(after.some((f, i) => f > before[i]!)).toBe(true);
    expect(a.state.region.neighbours.map((n) => n.rival)).toEqual(
      b.state.region.neighbours.map((n) => n.rival),
    );
  });
});
