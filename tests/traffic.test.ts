import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BState } from '../src/sim/world/buildings';
import { TICKS_PER_HOUR, TICKS_PER_MONTH, ticksUntilHour } from '../src/sim/time';
import { segVC } from '../src/sim/systems/traffic';
import { segSpeed } from '../src/sim/systems/vehicles';
import { ROAD_TYPES } from '../src/data/roads';
import { buildTown, newSim, placeAlong, road, serveTown } from './helpers';
import { TRANSIT } from '../src/data/balance';
import { twoDistricts } from './trafficTown';

function avgCommute(sim: Sim): number {
  let n = 0;
  let t = 0;
  for (const b of sim.state.buildings.values()) {
    if (b.state !== BState.Active || b.employed <= 0) continue;
    n += b.employed;
    t += b.commute * b.employed;
  }
  return n ? t / n : 0;
}

function totalVolume(sim: Sim): number {
  let v = 0;
  for (const x of sim.state.traffic.values()) v += x;
  return v;
}

/** Advance to the next time the clock reads `hour`:00. */
function advanceToHour(sim: Sim, hour: number): void {
  sim.advance(ticksUntilHour(sim.state.tick, hour));
}

describe('traffic', () => {
  it('grows with the city and loads the roads people actually use', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH);
    const early = totalVolume(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    const later = totalVolume(sim);
    expect(early).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(early * 1.8);
    // Every loaded segment exists; the busiest ones are town roads, not the empty highway spur.
    for (const id of sim.state.traffic.keys()) expect(sim.state.net.segments.has(id)).toBe(true);
    const busiest = [...sim.state.traffic].sort((a, b) => b[1] - a[1])[0]!;
    expect(['avenue', 'street']).toContain(sim.state.net.segments.get(busiest[0])!.type);
  });

  it('a narrow link between homes and jobs jams at rush hour, and a bypass relieves it', () => {
    const sim = newSim();
    const t = twoDistricts(sim, 'dirt');
    sim.advance(TICKS_PER_MONTH * 5);
    const jam = segVC(sim, t.link, 1);
    const before = avgCommute(sim);
    expect(jam).toBeGreaterThan(1.5);
    expect(before).toBeGreaterThan(5 * 60);
    t.bypass();
    sim.advance(TICKS_PER_MONTH * 2);
    expect(segVC(sim, t.link, 1)).toBeLessThan(jam * 0.7);
    expect(avgCommute(sim)).toBeLessThan(before * 0.6);
  });

  it('congestion peaks at rush hour and service vehicles are slowed by it', () => {
    const sim = newSim();
    const t = twoDistricts(sim, 'dirt');
    sim.advance(TICKS_PER_MONTH * 5);
    const free = ROAD_TYPES.dirt.speed / 3.6;
    advanceToHour(sim, 8);
    const rush = segSpeed(sim, t.link);
    advanceToHour(sim, 3);
    const night = segSpeed(sim, t.link);
    expect(rush).toBeLessThan(free * 0.5);
    expect(night).toBeGreaterThan(free * 0.9);
  });

  it('freight runs from industry to shops and out to the highway', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 3);
    expect(sim.state.traffic.get(sim.state.highway.segment) ?? 0).toBeGreaterThan(0);
    const kinds = new Set(sim.tripSamples.map((s) => s.purpose));
    expect(kinds.has('work')).toBe(true);
    expect(kinds.has('shop')).toBe(true);
    expect(kinds.has('freight') || kinds.has('export') || kinds.has('import')).toBe(true);
  });

  it('visible trips follow connected roads from one building to another', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    expect(sim.tripSamples.length).toBeGreaterThan(20);
    const at = (seg: number, s: number) => sim.net.curve(seg).pointAt(s);
    for (const trip of sim.tripSamples) {
      expect(trip.legs.length).toBeGreaterThan(0);
      for (let i = 1; i < trip.legs.length; i++) {
        const a = trip.legs[i - 1]!;
        const b = trip.legs[i]!;
        const pa = at(a.seg, a.s1);
        const pb = at(b.seg, b.s0);
        expect(Math.hypot(pa.x - pb.x, pa.z - pb.z)).toBeLessThan(1);
      }
      if (trip.purpose === 'work' || trip.purpose === 'shop') {
        const from = sim.state.buildings.get(trip.from)!;
        const acc = sim.buildingAccess(from)!;
        expect(trip.legs[0]!.seg).toBe(acc.seg);
        expect(trip.legs[0]!.s0).toBeCloseTo(acc.s, 3);
      }
    }
  });

  it('upgrading a street keeps what is built along it, costs the difference and can be undone', () => {
    const sim = newSim();
    const town = buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    // The side street piece with the most buildings along it.
    const onSeg = (id: number) => {
      const seg = sim.state.net.segments.get(id)!;
      const out = new Set<number>();
      for (const bid of [seg.left, seg.right]) {
        const bl = bid ? sim.state.net.blocks.get(bid) : undefined;
        if (bl) for (const x of bl.bld) if (x) out.add(x);
      }
      return [...out];
    };
    const segId = [...town.streets]
      .filter((id) => sim.state.net.segments.has(id))
      .sort((a, b) => onSeg(b).length - onSeg(a).length)[0]!;
    const before = onSeg(segId);
    expect(before.length).toBeGreaterThan(4);
    const curve = sim.net.curve(segId);
    const dist = (id: number) => {
      const b = sim.state.buildings.get(id)!;
      return curve.project({ x: b.x, z: b.z }).d;
    };
    const d0 = new Map(before.map((id) => [id, dist(id)]));
    const t0 = sim.state.treasury;
    const preview = sim.preview({ type: 'upgradeRoad', seg: segId, road: 'avenue' });
    expect(preview.ok).toBe(true);
    const r = sim.dispatch({ type: 'upgradeRoad', seg: segId, road: 'avenue' });
    expect(r.ok).toBe(true);
    // The difference in road price, plus earthworks to widen its formation (M13).
    const earth = (r.info as { earth: { cost: number } | null }).earth?.cost ?? 0;
    const expected =
      Math.round(curve.length * (ROAD_TYPES.avenue.costPerMetre - ROAD_TYPES.street.costPerMetre)) + earth;
    expect(t0 - sim.state.treasury).toBe(expected);
    expect(sim.state.net.segments.get(segId)!.type).toBe('avenue');
    const kept = before.filter((id) => sim.state.buildings.has(id));
    expect(kept.length).toBeGreaterThanOrEqual(Math.ceil(before.length * 0.6));
    for (const id of kept) expect(dist(id)).toBeGreaterThan(d0.get(id)! + 3);
    // Same type again is refused; undo restores the street and refunds.
    expect(sim.dispatch({ type: 'upgradeRoad', seg: segId, road: 'avenue' }).ok).toBe(false);
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.net.segments.get(segId)!.type).toBe('street');
    expect(sim.state.treasury).toBe(t0);
  });

  it('upgrading the bottleneck relieves the jam', () => {
    const sim = newSim();
    const t = twoDistricts(sim, 'dirt');
    sim.advance(TICKS_PER_MONTH * 5);
    const jam = segVC(sim, t.link, 1);
    const before = avgCommute(sim);
    expect(sim.dispatch({ type: 'upgradeRoad', seg: t.link, road: 'avenue' }).ok).toBe(true);
    sim.advance(TICKS_PER_MONTH * 2);
    expect(segVC(sim, t.link, 1)).toBeLessThan(jam * 0.4);
    expect(avgCommute(sim)).toBeLessThan(before * 0.6);
  });

  it('a bus line takes cars off a jammed link and cuts commutes', () => {
    const sim = newSim();
    const t = twoDistricts(sim, 'dirt');
    // Commutes wobble by ±2 % from one sample to the next, so compare averages over a while.
    const meanCommute = (months: number) => {
      let sum = 0;
      for (let k = 0; k < 8; k++) {
        sim.advance((TICKS_PER_MONTH * months) / 8);
        sum += avgCommute(sim);
      }
      return sum / 8;
    };
    sim.advance(TICKS_PER_MONTH * 4);
    const before = meanCommute(1);
    const jam = segVC(sim, t.link, 1);
    expect(sim.lines().length).toBe(0);
    expect(t.buses().length).toBeGreaterThanOrEqual(6);
    sim.advance(TICKS_PER_MONTH);
    const after = meanCommute(2);
    const lines = sim.lines();
    expect(lines.length).toBe(1);
    const riders = sim.state.transit.riders.get(lines[0]!.depot) ?? 0;
    expect(riders).toBeGreaterThan(500);
    // Mostly by taking cars off the jammed link; door-to-door, riders also walk and wait.
    expect(segVC(sim, t.link, 1)).toBeLessThan(jam * 0.85);
    expect(after).toBeLessThan(before * 0.985);
  });

  it('bus stops snap to roads, cost money, can be undone, and follow their road', () => {
    const sim = newSim();
    buildTown(sim);
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const c = { x: 24, z: sim.state.net.nodes.get(sim.state.highway.connect)!.z };
    expect(sim.dispatch({ type: 'placeStop', x: c.x + 150, z: c.z - 60 }).ok).toBe(false); // mid-block
    const t0 = sim.state.treasury;
    const r = sim.dispatch({ type: 'placeStop', x: c.x + 150, z: c.z + 6 });
    if (!r.ok) throw new Error(r.reason);
    const id = r.created![0]!;
    expect(t0 - sim.state.treasury).toBe(TRANSIT.stopCost);
    const stop = sim.state.transit.stops.get(id)!;
    expect(sim.net.curve(stop.seg).project({ x: stop.x, z: stop.z }).d).toBeLessThan(0.5);
    expect(sim.dispatch({ type: 'placeStop', x: c.x + 160, z: c.z + 6 }).ok).toBe(false); // too close
    expect(sim.dispatch({ type: 'undo' }).ok).toBe(true);
    expect(sim.state.transit.stops.has(id)).toBe(false);
    expect(sim.state.treasury).toBe(t0);
    // A stop on a road that gets split moves to the piece it stands on; bulldozed roads take it.
    const r2 = sim.dispatch({ type: 'placeStop', x: c.x + 150, z: c.z + 6 });
    if (!r2.ok) throw new Error(r2.reason);
    const id2 = r2.created![0]!;
    const segBefore = sim.state.transit.stops.get(id2)!.seg;
    road(sim, [
      { x: c.x + 170, z: c.z - 60 },
      { x: c.x + 170, z: c.z + 60 },
    ]);
    const moved = sim.state.transit.stops.get(id2)!;
    expect(sim.state.net.segments.has(moved.seg)).toBe(true);
    expect(moved.seg === segBefore || !sim.state.net.segments.has(segBefore)).toBe(true);
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'segment', id: moved.seg } }).ok).toBe(true);
    expect(sim.state.transit.stops.has(id2)).toBe(false);
  });

  it('saves keep the traffic exactly', () => {
    const sim = Sim.create({ seed: 'citybloom', preset: 'river' });
    sim.testMode = true;
    const town = buildTown(sim);
    serveTown(sim);
    placeAlong(sim, 'busdepot', town.avenue[town.avenue.length - 1]!);
    const hz = sim.state.net.nodes.get(sim.state.highway.connect)!.z;
    for (const x of [120, 300, 440]) sim.dispatch({ type: 'placeStop', x, z: hz + 6 });
    expect(sim.state.transit.stops.size).toBe(3);
    sim.advance(TICKS_PER_MONTH + 331);
    expect(sim.lines().length).toBe(1);
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    sim.advance(TICKS_PER_HOUR * 7);
    loaded.advance(TICKS_PER_HOUR * 7);
    expect(loaded.hash()).toBe(sim.hash());
  });
});
