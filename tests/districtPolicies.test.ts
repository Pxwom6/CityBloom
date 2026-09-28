import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { ZONE_R } from '../src/data/zones';
import { Sim } from '../src/sim/sim';
import { districtAt } from '../src/sim/systems/districts';
import { garbageRate } from '../src/sim/systems/garbage';
import { BState } from '../src/sim/world/buildings';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, connectPoint, newSim, road, serveTown } from './helpers';
import { freightTown } from './freightTown';

/** A district painted along a brush, returning its id. */
function district(
  sim: Sim,
  name: string,
  a: { x: number; z: number },
  b: { x: number; z: number },
  radius: number,
) {
  const r = sim.dispatch({ type: 'createDistrict', name });
  if (!r.ok) throw new Error(r.reason);
  const id = r.created![0]!;
  const p = sim.dispatch({
    type: 'paintDistrict',
    district: id,
    area: { kind: 'brush', points: [a, b], radius },
  });
  if (!p.ok) throw new Error(p.reason);
  return id;
}

const clone = (sim: Sim) => Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));

describe('district policies (M21)', () => {
  it('a heavy-traffic ban sends the estate’s trucks round the homes, and changes nothing else', () => {
    const sim = newSim({ seed: 'goods' });
    const t = freightTown(sim);
    const at = (dx: number, dz: number) => ({ x: t.c.x + dx, z: t.c.z + dz });
    // A back road round the homes, and the homes as a district.
    road(sim, [at(45, 0), at(45, 230)]);
    road(sim, [at(45, 230), at(360, 230)]);
    road(sim, [at(360, 230), at(360, 0)]);
    const homes = district(sim, 'Hometown', at(130, 0), at(270, 0), 130);
    sim.advance(5 * TICKS_PER_MONTH);
    sim.finishMatching();
    const control = clone(sim);
    const r = sim.dispatch({
      type: 'setDistrictPolicy',
      district: homes,
      policy: 'heavyTrafficBan',
      on: true,
    });
    expect(r.ok).toBe(true);
    sim.advance(2 * TICKS_PER_MONTH);
    control.advance(2 * TICKS_PER_MONTH);
    const seg = (s: Sim, p: { x: number; z: number }) => s.net.nearestSegment(p, 3)!.seg;
    const vol = (s: Sim, p: { x: number; z: number }) => s.state.traffic.get(seg(s, p)) ?? 0;
    const inside = at(200, 0);
    const back = at(200, 230);
    const east = at(700, 0);
    expect(districtAt(sim.state.districtCells, inside.x, inside.z)).toBe(homes);
    expect(districtAt(sim.state.districtCells, back.x, back.z)).toBe(0);
    console.log(
      `[ban] avenue in the district ${Math.round(vol(control, inside))} → ${Math.round(vol(sim, inside))}, ` +
        `back road ${Math.round(vol(control, back))} → ${Math.round(vol(sim, back))}, ` +
        `avenue east ${Math.round(vol(control, east))} → ${Math.round(vol(sim, east))}, ` +
        `highway link ${Math.round(control.state.traffic.get(control.state.highway.segment) ?? 0)} → ${Math.round(sim.state.traffic.get(sim.state.highway.segment) ?? 0)}`,
    );
    // The district's avenue loses its trucks to the back road outside it...
    expect(vol(sim, inside)).toBeLessThan(vol(control, inside) * 0.9);
    expect(vol(sim, back)).toBeGreaterThan(vol(control, back) + 100);
    // ...and the rest of the city carries what it did: the avenue beyond, the link to the region.
    expect(Math.abs(vol(sim, east) / vol(control, east) - 1)).toBeLessThan(0.05);
    const link = (s: Sim) => s.state.traffic.get(s.state.highway.segment) ?? 0;
    expect(Math.abs(link(sim) / link(control) - 1)).toBeLessThan(0.05);
  });

  it('recycling in one district: less garbage there, the same elsewhere, at its share of the cost', () => {
    const sim = newSim({ seed: 'recyc' });
    serveTown(sim);
    buildTown(sim);
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.advance(3 * TICKS_PER_MONTH);
    const c = connectPoint(sim);
    const west = district(sim, 'West', { x: c.x + 20, z: c.z }, { x: c.x + 200, z: c.z }, 190);
    const eastId = district(sim, 'East', { x: c.x + 300, z: c.z }, { x: c.x + 480, z: c.z }, 190);
    const made = (s: Sim, d: number) => {
      let g = 0;
      for (const b of s.state.buildings.values())
        if (districtAt(s.state.districtCells, b.x, b.z) === d) g += garbageRate(s, b);
      return g;
    };
    const control = clone(sim);
    expect(
      sim.dispatch({ type: 'setDistrictPolicy', district: west, policy: 'recycling', on: true }).ok,
    ).toBe(true);
    sim.advance(TICKS_PER_MONTH);
    control.advance(TICKS_PER_MONTH);
    const w = made(sim, west) / made(control, west);
    const e = made(sim, eastId) / made(control, eastId);
    console.log(`[recycling] garbage made: West ×${w.toFixed(2)}, East ×${e.toFixed(2)}`);
    expect(w).toBeLessThan(0.85);
    expect(Math.abs(e - 1)).toBeLessThan(0.05);
    // The district pays its residents' share of what the scheme would cost the whole city.
    const reports = sim.query({ type: 'districts' }) as {
      id: number;
      population: number;
      policies: number;
    }[];
    const rw = reports.find((x) => x.id === west)!;
    const share = rw.population / sim.state.totals.population;
    expect(rw.policies).toBeGreaterThan(0);
    expect(rw.policies).toBeCloseTo((120 + 0.02 * sim.state.totals.population) * share, -1);
    expect(reports.find((x) => x.id === eastId)!.policies).toBe(0);
  });

  it('a heritage district keeps its buildings as they are, and the rest of the city goes on as before', () => {
    // Castlebridge (the Big Game scenario's city): its newest street is still filling in and rebuilding.
    const sim = Sim.fromSave(decodeSave(readFileSync('public/scenarios/stadium.citybloom')));
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const old = district(sim, 'Old Town', { x: 888, z: 1370 }, { x: 888, z: 1470 }, 40);
    const control = clone(sim);
    expect(sim.dispatch({ type: 'setDistrictPolicy', district: old, policy: 'heritage', on: true }).ok).toBe(
      true,
    );
    const sig = (b: { def: string; level: number; density: number }) => `${b.def}:${b.level}:${b.density}`;
    const before = new Map([...sim.state.buildings.values()].map((b) => [b.id, sig(b)]));
    const inOld = (s: Sim, b: { x: number; z: number }) =>
      districtAt(s.state.districtCells, b.x, b.z) === old;
    expect([...sim.state.buildings.values()].filter((b) => inOld(sim, b)).length).toBeGreaterThan(10);
    sim.advance(4 * TICKS_PER_MONTH);
    control.advance(4 * TICKS_PER_MONTH);
    const changed = (s: Sim, inside: boolean) => {
      let n = 0;
      for (const b of s.state.buildings.values()) {
        const was = before.get(b.id);
        if (inOld(s, b) === inside && b.state === BState.Active && was !== undefined && was !== sig(b)) n++;
      }
      return n;
    };
    const popOutside = (s: Sim) => {
      let n = 0;
      for (const b of s.state.buildings.values()) if (b.zone === ZONE_R && !inOld(s, b)) n += b.pop;
      return n;
    };
    const lv = (s: Sim) => {
      let sum = 0;
      let n = 0;
      s.state.districtCells.forEach((d, k) => {
        if (d === old) {
          sum += s.state.landValue[k]!;
          n++;
        }
      });
      return sum / n;
    };
    console.log(
      `[heritage] rebuilt in Old Town: ${changed(sim, true)} (left alone: ${changed(control, true)}); ` +
        `elsewhere: ${changed(sim, false)} (${changed(control, false)}); residents elsewhere ${popOutside(sim)} ` +
        `(${popOutside(control)}); land value in Old Town ${lv(control).toFixed(3)} → ${lv(sim).toFixed(3)}`,
    );
    // Left alone, the street rebuilds; as a heritage district, nothing in it changes...
    expect(changed(control, true)).toBeGreaterThanOrEqual(8);
    expect(changed(sim, true)).toBe(0);
    // ...its land value rises with the charm, and outside it the city is as it would have been.
    expect(lv(sim)).toBeGreaterThan(lv(control) + 0.02);
    expect(Math.abs(changed(sim, false) - changed(control, false))).toBeLessThanOrEqual(2);
    expect(Math.abs(popOutside(sim) / popOutside(control) - 1)).toBeLessThan(0.02);
  });
});
