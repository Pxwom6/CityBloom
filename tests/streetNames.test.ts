import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { StreetNames } from '../src/client/names';
import type { ClientWorld } from '../src/client/world';
import { Network } from '../src/sim/world/network';
import type { Vec2 } from '../src/sim/geom';
import type { Command } from '../src/sim/commands';
import { checkInvariants } from '../src/sim/invariants';
import { TICKS_PER_HOUR } from '../src/sim/time';
import { EXTRA_STEMS, LEGACY_STEMS, STREET_STEMS, STREET_SUFFIX } from '../src/data/streetNames';
import { nameSegments, namesSeed, restyleName, stemOf, straightPairs } from '../src/sim/world/streetNames';
import type { NetworkState, RoadSegment } from '../src/sim/world/network';
import { connectPoint, newSim, road } from './helpers';

/**
 * P10: a street keeps its name. These read names the way a player meets them, through the
 * client's `StreetNames` (the inspector title, the map label), so they cover the whole path from
 * the sim to the screen.
 */

/** The client's street names for this city's network, built fresh each call (a stale one lies). */
function seen(sim: Sim): StreetNames {
  const st = sim.state.net;
  let v = 0;
  const world = {
    options: sim.state.options,
    netState: st,
    net: new Network(st, null, null),
    get netVersion() {
      return ++v;
    },
    districts: new Map(),
    districtAt: () => 0,
  } as unknown as ClientWorld;
  return new StreetNames(world);
}

/** Every segment's name, by id. */
function namesOf(sim: Sim): Map<number, string> {
  const n = seen(sim);
  return new Map([...sim.state.net.segments.keys()].map((id) => [id, n.street(id)]));
}

const stem = (name: string) => name.split(' ')[0]!;
const p = (x: number, z: number): Vec2 => ({ x, z });

/** The id of the road piece laid by a `road()` call that made exactly one piece. */
function piece(sim: Sim, points: Vec2[], type: Parameters<typeof road>[2] = 'street'): number {
  const r = road(sim, points, type);
  expect(r.created?.length).toBe(1);
  return r.created![0]!;
}

/** Ids of the segments that touch the node nearest (x, z). */
function segsAtPoint(sim: Sim, x: number, z: number): number[] {
  let best: { id: number; d: number } | null = null;
  for (const n of sim.state.net.nodes.values()) {
    const d = Math.hypot(n.x - x, n.z - z);
    if (!best || d < best.d) best = { id: n.id, d };
  }
  expect(best!.d).toBeLessThan(2);
  return sim.net.segmentsAt(best!.id);
}

/** Do `cmd`, then undo and redo it: names (and the city's hash) come back each time. */
function roundTrip(sim: Sim, cmd: Command) {
  const beforeNames = namesOf(sim);
  const beforeHash = sim.hash();
  const r = sim.dispatch(cmd);
  expect(r.ok, r.ok ? '' : r.reason).toBe(true);
  const afterNames = namesOf(sim);
  const afterHash = sim.hash();
  const u = sim.dispatch({ type: 'undo' });
  expect(u.ok, u.ok ? '' : u.reason).toBe(true);
  expect(namesOf(sim)).toEqual(beforeNames);
  expect(sim.hash()).toBe(beforeHash);
  const d = sim.dispatch({ type: 'redo' });
  expect(d.ok, d.ok ? '' : d.reason).toBe(true);
  expect(namesOf(sim)).toEqual(afterNames);
  expect(sim.hash()).toBe(afterHash);
  return { beforeNames, afterNames };
}

const SEEDS = ['a', 'b', 'c', 'd'];

describe('P10: a street keeps its name when it is cut', () => {
  for (const seed of SEEDS) {
    it(`both halves of a cut street keep its name (seed ${seed})`, () => {
      const sim = newSim({ seed });
      const c = connectPoint(sim);
      const S = piece(sim, [p(c.x + 20, c.z + 60), p(c.x + 420, c.z + 60)]);
      const name = namesOf(sim).get(S)!;
      expect(name).toMatch(/ (Street|Road|Way|Close|Row|Terrace)$/);

      const { afterNames } = roundTrip(sim, {
        type: 'buildRoad',
        road: 'street',
        points: [p(c.x + 200, c.z - 100), p(c.x + 200, c.z + 200)],
      });
      // The junction in the middle of S has four arms: S's two halves and the crossing's two.
      const arms = segsAtPoint(sim, c.x + 200, c.z + 60);
      expect(arms.length).toBe(4);
      const byDir = (ew: boolean) =>
        arms.filter((id) => {
          const s = sim.state.net.segments.get(id)!;
          const a = sim.state.net.nodes.get(s.a)!;
          const b = sim.state.net.nodes.get(s.b)!;
          return ew ? Math.abs(a.z - b.z) < 1 : Math.abs(a.x - b.x) < 1;
        });
      const ew = byDir(true);
      const ns = byDir(false);
      expect(ew.length).toBe(2);
      expect(ns.length).toBe(2);
      for (const id of ew) expect(afterNames.get(id)).toBe(name);
      // The crossing street is one street with a name of its own, on a stem not yet in use.
      const cross = afterNames.get(ns[0]!)!;
      expect(afterNames.get(ns[1]!)).toBe(cross);
      expect(stem(cross)).not.toBe(stem(name));
    });
  }

  it('a side street ending on a street gets a name of its own and leaves the street alone', () => {
    const sim = newSim({ seed: 'b' });
    const c = connectPoint(sim);
    const S = piece(sim, [p(c.x + 20, c.z + 60), p(c.x + 420, c.z + 60)]);
    road(sim, [p(c.x + 200, c.z - 100), p(c.x + 200, c.z + 200)]);
    const before = namesOf(sim);
    const name = before.get(S);
    void name;
    const { afterNames } = roundTrip(sim, {
      type: 'buildRoad',
      road: 'street',
      points: [p(c.x + 320, c.z + 260), p(c.x + 320, c.z + 60)],
    });
    // Everything that existed keeps its name (the half that was cut again carries it to both pieces).
    const arms = segsAtPoint(sim, c.x + 320, c.z + 60);
    expect(arms.length).toBe(3);
    const ewNames = new Set(
      arms
        .filter((id) => {
          const s = sim.state.net.segments.get(id)!;
          const a = sim.state.net.nodes.get(s.a)!;
          const b = sim.state.net.nodes.get(s.b)!;
          return Math.abs(a.z - b.z) < 1;
        })
        .map((id) => afterNames.get(id)),
    );
    expect(ewNames.size).toBe(1);
    for (const [id, nm] of before) if (sim.state.net.segments.has(id)) expect(afterNames.get(id)).toBe(nm);
    const t = arms.find((id) => {
      const s = sim.state.net.segments.get(id)!;
      const a = sim.state.net.nodes.get(s.a)!;
      const b = sim.state.net.nodes.get(s.b)!;
      return Math.abs(a.x - b.x) < 1;
    })!;
    expect(ewNames.has(afterNames.get(t))).toBe(false);
  });
});

describe('P10: a street keeps its name when it is extended', () => {
  function east(seed: string) {
    const sim = newSim({ seed });
    const c = connectPoint(sim);
    const S = piece(sim, [p(c.x + 20, c.z + 60), p(c.x + 420, c.z + 60)]);
    return { sim, c, S, name: namesOf(sim).get(S)! };
  }

  it('a piece straight on takes the street name', () => {
    const { sim, c, S, name } = east('c');
    const straight = piece(sim, [p(c.x + 420, c.z + 60), p(c.x + 620, c.z + 60)]);
    expect(namesOf(sim).get(straight)).toBe(name);
    expect(namesOf(sim).get(S)).toBe(name);
  });

  it('a piece deflected 20 degrees takes the street name', () => {
    const { sim, c, S, name } = east('c');
    const a = (20 * Math.PI) / 180;
    const bent = piece(sim, [
      p(c.x + 420, c.z + 60),
      p(c.x + 420 + 200 * Math.cos(a), c.z + 60 + 200 * Math.sin(a)),
    ]);
    expect(namesOf(sim).get(bent)).toBe(name);
    expect(namesOf(sim).get(S)).toBe(name);
  });

  it('a turn of 90 or 45 degrees, or a different road type, starts a new street', () => {
    for (const [dx, dz, type] of [
      [0, 200, 'street'],
      [141, 141, 'street'],
      [200, 0, 'avenue'],
    ] as const) {
      const { sim, c, S, name } = east('c');
      sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
      sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
      const next = piece(sim, [p(c.x + 420, c.z + 60), p(c.x + 420 + dx, c.z + 60 + dz)], type);
      const n = namesOf(sim);
      expect(n.get(S)).toBe(name);
      expect(stem(n.get(next)!), `${type} ${dx},${dz}`).not.toBe(stem(name));
    }
  });
});

describe('P10: joining streets does not rename either', () => {
  function gap(seed: string) {
    const sim = newSim({ seed });
    const c = connectPoint(sim);
    const A = piece(sim, [p(c.x + 20, c.z + 60), p(c.x + 220, c.z + 60)]);
    const B = piece(sim, [p(c.x + 320, c.z + 60), p(c.x + 520, c.z + 60)]);
    const n = namesOf(sim);
    return { sim, c, A, B, nameA: n.get(A)!, nameB: n.get(B)! };
  }

  it('a piece drawn from A takes A name; A and B keep theirs', () => {
    const { sim, c, A, B, nameA, nameB } = gap('d');
    expect(nameB).not.toBe(nameA);
    const { beforeNames, afterNames } = roundTrip(sim, {
      type: 'buildRoad',
      road: 'street',
      points: [p(c.x + 220, c.z + 60), p(c.x + 320, c.z + 60)],
    });
    expect(afterNames.get(A)).toBe(nameA);
    expect(afterNames.get(B)).toBe(nameB);
    const join = [...afterNames.keys()].find((id) => !beforeNames.has(id))!;
    expect(afterNames.get(join)).toBe(nameA);
  });

  it('a piece drawn from B takes B name', () => {
    const { sim, c, A, B, nameA, nameB } = gap('d');
    const join = piece(sim, [p(c.x + 320, c.z + 60), p(c.x + 220, c.z + 60)]);
    const n = namesOf(sim);
    expect(n.get(A)).toBe(nameA);
    expect(n.get(B)).toBe(nameB);
    expect(n.get(join)).toBe(nameB);
  });

  it('bulldozing the middle of a street and rebuilding the gap brings its name back', () => {
    const sim = newSim({ seed: 'e' });
    const c = connectPoint(sim);
    const S1 = piece(sim, [p(c.x + 20, c.z + 60), p(c.x + 220, c.z + 60)]);
    const S2 = piece(sim, [p(c.x + 220, c.z + 60), p(c.x + 420, c.z + 60)]);
    const S3 = piece(sim, [p(c.x + 420, c.z + 60), p(c.x + 620, c.z + 60)]);
    const name = namesOf(sim).get(S1)!;
    expect(namesOf(sim).get(S2)).toBe(name);
    expect(namesOf(sim).get(S3)).toBe(name);
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: S2 } }).ok).toBe(true);
    // The far piece is still the same street.
    expect(namesOf(sim).get(S1)).toBe(name);
    expect(namesOf(sim).get(S3)).toBe(name);
    const gapPiece = piece(sim, [p(c.x + 220, c.z + 60), p(c.x + 420, c.z + 60)]);
    expect(namesOf(sim).get(gapPiece)).toBe(name);
  });
});

describe('P10: upgrading a street keeps its stem', () => {
  it('an upgraded half takes an avenue suffix on the same stem, and undo brings the old name back', () => {
    const sim = newSim({ seed: 'f' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    const c = connectPoint(sim);
    piece(sim, [p(c.x + 20, c.z + 60), p(c.x + 420, c.z + 60)]);
    road(sim, [p(c.x + 200, c.z - 100), p(c.x + 200, c.z + 200)]);
    const arms = segsAtPoint(sim, c.x + 200, c.z + 60);
    const halves = arms.filter((id) => {
      const s = sim.state.net.segments.get(id)!;
      const a = sim.state.net.nodes.get(s.a)!;
      const b = sim.state.net.nodes.get(s.b)!;
      return Math.abs(a.z - b.z) < 1;
    });
    expect(halves.length).toBe(2);
    const before = namesOf(sim);
    const name = before.get(halves[0]!)!;
    expect(before.get(halves[1]!)).toBe(name);

    const { afterNames } = roundTrip(sim, { type: 'upgradeRoad', seg: halves[0]!, road: 'avenue' });
    const up = afterNames.get(halves[0]!)!;
    expect(stem(up)).toBe(stem(name));
    expect(up).toMatch(/ (Avenue|Parade)$/);
    expect(afterNames.get(halves[1]!)).toBe(name);

    // Upgrading the other half too leaves one name on both.
    sim.dispatch({ type: 'upgradeRoad', seg: halves[1]!, road: 'avenue' });
    const both = namesOf(sim);
    expect(both.get(halves[1]!)).toBe(up);
    expect(both.get(halves[0]!)).toBe(up);
  });
});

describe('P10: new streets avoid stems already in use', () => {
  it('sixty separate streets get sixty names with at most one repeated stem', () => {
    const sim = newSim({ seed: 'citybloom', sandbox: true });
    const c = connectPoint(sim);
    // A grid of short streets that touch nothing; any the ground refuses are skipped.
    const streets: number[] = [];
    for (let row = 0; row < 14 && streets.length < 60; row++)
      for (let col = 0; col < 10 && streets.length < 60; col++) {
        const x = c.x + 40 + col * 110;
        const z = c.z - 400 + row * 110;
        const r = sim.dispatch({ type: 'buildRoad', road: 'street', points: [p(x, z), p(x + 70, z)] });
        if (r.ok) streets.push(r.created![0]!);
      }
    expect(streets.length).toBe(60);
    const names = namesOf(sim);
    const used = new Set(streets.map((id) => names.get(id)!));
    expect(used.size).toBe(streets.length);
    const stems = new Map<string, number>();
    for (const nm of new Set([...names.values()].filter((nm) => nm !== 'Regional Highway')))
      stems.set(stem(nm), (stems.get(stem(nm)) ?? 0) + 1);
    const repeated = [...stems.values()].filter((n) => n > 1).length;
    expect(repeated).toBeLessThanOrEqual(1);
  });
});

describe('P10: names are deterministic and saved', () => {
  function play(seed: string): Sim {
    const sim = newSim({ seed });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    const c = connectPoint(sim);
    road(sim, [p(c.x + 20, c.z + 60), p(c.x + 420, c.z + 60)]);
    road(sim, [p(c.x + 200, c.z - 100), p(c.x + 200, c.z + 200)]);
    road(sim, [p(c.x + 420, c.z + 60), p(c.x + 620, c.z + 90)]);
    road(sim, [p(c.x + 320, c.z + 260), p(c.x + 320, c.z + 100)], 'avenue');
    return sim;
  }

  it('the same commands give the same names and hash', () => {
    const a = play('g');
    const b = play('g');
    expect(namesOf(a)).toEqual(namesOf(b));
    expect(a.hash()).toBe(b.hash());
  });

  it('a saved city keeps its names, and plays on identically', () => {
    const a = play('g');
    const names = namesOf(a);
    const b = Sim.fromSave(JSON.parse(JSON.stringify(a.save())));
    b.testMode = true;
    expect(namesOf(b)).toEqual(names);
    expect(b.hash()).toBe(a.hash());
    a.advance(24 * TICKS_PER_HOUR);
    b.advance(24 * TICKS_PER_HOUR);
    expect(b.hash()).toBe(a.hash());
    expect(namesOf(b)).toEqual(namesOf(a));
    checkInvariants(b);
  });

  it('the railway link, placed again later, is named', () => {
    const sim = newSim({ seed: 'goods' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
    const rail = sim.state.railway;
    expect(rail).toBeTruthy();
    expect(namesOf(sim).get(rail!.segment)).toMatch(/ Main Line$/);
    const z = sim.state.net.nodes.get(rail!.outside)!.z;
    sim.dispatch({ type: 'cheat', cheat: 'removeRailLink' });
    expect(sim.state.net.segments.has(rail!.segment)).toBe(false);
    const r = sim.dispatch({ type: 'buildRailLink', z });
    expect(r.ok, r.ok ? '' : r.reason).toBe(true);
    const seg = sim.state.railway!.segment;
    expect(namesOf(sim).get(seg)).toMatch(/ Main Line$/);
  });
});

describe('P10: the name lists', () => {
  it('are frozen where the migration needs them, and have no repeated stem', () => {
    expect(LEGACY_STEMS).toHaveLength(60);
    expect(LEGACY_STEMS[0]).toBe('Maple');
    expect(LEGACY_STEMS[59]).toBe('Oak');
    expect(STREET_STEMS.slice(0, 60)).toEqual(LEGACY_STEMS);
    expect(STREET_STEMS).toHaveLength(LEGACY_STEMS.length + EXTRA_STEMS.length);
    expect(new Set(STREET_STEMS).size).toBe(STREET_STEMS.length);
    for (const stem of STREET_STEMS) expect(stem, 'one word').toMatch(/^[A-Z][a-z]+$/);
    expect(STREET_SUFFIX.street).toEqual(['Street', 'Road', 'Way', 'Close', 'Row', 'Terrace']);
    expect(STREET_SUFFIX.avenue).toEqual(['Avenue', 'Parade']);
  });

  it('restyle a name for a new road type, keeping the stem', () => {
    expect(restyleName('Maple Street', 'street', 'avenue')).toBe('Maple Avenue');
    expect(restyleName('Maple Terrace', 'street', 'avenue')).toBe('Maple Parade');
    expect(restyleName('Maple Road', 'street', 'avenue')).toBe('Maple Parade');
    expect(restyleName('Maple Way', 'street', 'avenue')).toBe('Maple Avenue');
    expect(restyleName('Maple Parade', 'avenue', 'street')).toBe('Maple Road');
    expect(restyleName('Maple Avenue', 'avenue', 'boulevard')).toBe('Maple Boulevard');
    // A suffix the old type does not have is left alone.
    expect(restyleName('Maple Street 7', 'street', 'avenue')).toBe('Maple Street 7');
    expect(restyleName('Maple Street', 'street', 'street')).toBe('Maple Street');
    expect(stemOf('Maple Main Line')).toBe('Maple');
  });
});

describe('P10: naming a network', () => {
  /** `n` separate straight pieces of street, 100 m apart, in a hand-made network. */
  function lonelyStreets(n: number): { net: Network; ids: number[] } {
    const st: NetworkState = { nodes: new Map(), segments: new Map(), blocks: new Map() };
    const ids: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = 100 + (i % 20) * 100;
      const z = 100 + Math.floor(i / 20) * 100;
      st.nodes.set(2 * i + 1, { id: 2 * i + 1, x, z });
      st.nodes.set(2 * i + 2, { id: 2 * i + 2, x: x + 60, z });
      const seg: RoadSegment = {
        id: 1000 + i,
        a: 2 * i + 1,
        b: 2 * i + 2,
        cx: x + 30,
        cz: z,
        type: 'street',
        left: 0,
        right: 0,
      };
      st.segments.set(seg.id, seg);
      ids.push(seg.id);
    }
    return { net: new Network(st, null, null), ids };
  }

  it('gives 130 streets no repeated name, and no repeated stem until the stems run out', () => {
    const { net, ids } = lonelyStreets(130);
    const seed = namesSeed('some seed');
    // One at a time, as a player builds them.
    for (const id of ids) nameSegments(net, seed, [id]);
    const names = ids.map((id) => net.st.segments.get(id)!.name!);
    expect(new Set(names).size).toBe(130);
    expect(new Set(names.slice(0, STREET_STEMS.length).map(stemOf)).size).toBe(STREET_STEMS.length);
    const uses = new Map<string, number>();
    for (const n of names) uses.set(stemOf(n), (uses.get(stemOf(n)) ?? 0) + 1);
    expect(Math.max(...uses.values())).toBeLessThanOrEqual(2);
  });

  it('names the same network the same way every time, in one go or bit by bit', () => {
    const seed = namesSeed('another seed');
    const a = lonelyStreets(40);
    const b = lonelyStreets(40);
    nameSegments(a.net, seed, a.ids);
    for (const id of b.ids) nameSegments(b.net, seed, [id]);
    expect(a.ids.map((id) => a.net.st.segments.get(id)!.name)).toEqual(
      b.ids.map((id) => b.net.st.segments.get(id)!.name),
    );
  });

  it('leaves a named segment alone', () => {
    const { net, ids } = lonelyStreets(3);
    net.st.segments.get(ids[1]!)!.name = 'Keep Close';
    nameSegments(net, namesSeed('x'), ids);
    expect(net.st.segments.get(ids[1]!)!.name).toBe('Keep Close');
    expect(net.st.segments.get(ids[0]!)!.name).toMatch(/ (Street|Road|Way|Close|Row|Terrace)$/);
  });

  it('pairs the pieces that carry straight on at a junction', () => {
    const sim = newSim({ seed: 'h' });
    const c = connectPoint(sim);
    piece(sim, [p(c.x + 20, c.z + 60), p(c.x + 420, c.z + 60)]);
    road(sim, [p(c.x + 200, c.z - 100), p(c.x + 200, c.z + 200)]);
    const arms = segsAtPoint(sim, c.x + 200, c.z + 60);
    let junction = -1;
    for (const n of sim.state.net.nodes.values())
      if (sim.net.segmentsAt(n.id).length === 4 && sim.net.segmentsAt(n.id).every((id) => arms.includes(id)))
        junction = n.id;
    expect(junction).toBeGreaterThan(0);
    const pairs = straightPairs(sim.net, junction);
    expect(pairs).toHaveLength(2);
    for (const [x, z] of pairs) {
      const sx = sim.state.net.segments.get(x)!;
      const sz = sim.state.net.segments.get(z)!;
      // Each pair is two halves of one road: both run along the same axis.
      const axis = (s: RoadSegment) =>
        Math.abs(sim.state.net.nodes.get(s.a)!.z - sim.state.net.nodes.get(s.b)!.z) < 1 ? 'ew' : 'ns';
      expect(axis(sx)).toBe(axis(sz));
    }
  });
});
