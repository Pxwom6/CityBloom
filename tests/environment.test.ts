import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BState, type Building } from '../src/sim/world/buildings';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { fieldAt, windAngle } from '../src/sim/systems/pollution';
import { sicknessRate } from '../src/sim/systems/health';
import { ZONE_I, ZONE_R } from '../src/data/zones';
import { buildTown, newSim, placeAlong, roadsidePose, serveTown } from './helpers';
import { CIVIC } from '../src/data/civic';
import { windStreet } from './envTown';

function homes(sim: Sim, pick: (b: Building) => boolean): Building[] {
  return [...sim.state.buildings.values()].filter(
    (b) => b.state === BState.Active && b.zone === ZONE_R && b.pop > 0 && pick(b),
  );
}

function avg(
  list: Building[],
  f: (b: Building) => number,
  weight: (b: Building) => number = () => 1,
): number {
  const w = list.reduce((s, b) => s + weight(b), 0);
  return w ? list.reduce((s, b) => s + f(b) * weight(b), 0) / w : 0;
}

/** Upwind and downwind homes of the wind street (the plants sit level with its middle). */
function sides(sim: Sim, plants: number[]) {
  const zc = plants.map((id) => sim.state.civics.get(id)?.z ?? 0).reduce((a, b) => a + b, 0) / plants.length;
  const air = (b: Building) => fieldAt(sim.state.airPollution, b.x, b.z);
  const sick = (b: Building) => b.sick / b.pop;
  const rate = (b: Building) => sicknessRate(sim, b);
  const up = homes(sim, (b) => b.z < zc - 80);
  const down = homes(sim, (b) => b.z > zc + 80);
  return {
    up: { air: avg(up, air), sick: avg(up, sick, (b) => b.pop), rate: avg(up, rate), n: up.length },
    down: { air: avg(down, air), sick: avg(down, sick, (b) => b.pop), rate: avg(down, rate), n: down.length },
  };
}

describe('air pollution', () => {
  it('drifts downwind from a coal plant', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    const coal = [...sim.state.civics.values()].find((c) => c.def === 'coal')!;
    const a = windAngle(sim.state.options.seed, sim.state.tick);
    const along = (d: number) =>
      fieldAt(sim.state.airPollution, coal.x + Math.cos(a) * d, coal.z + Math.sin(a) * d);
    const down = [80, 120, 160].map(along).reduce((s, v) => s + v, 0);
    const up = [-80, -120, -160].map(along).reduce((s, v) => s + v, 0);
    expect(along(0)).toBeGreaterThan(0.2);
    expect(down).toBeGreaterThan(up * 2);
  });

  it('a polluting district harms health downwind, and switching to clean power helps', () => {
    // Without neighbours (M23), whose commuters' traffic adds a little smoke of its own upwind.
    const sim = newSim({ region: false });
    const t = windStreet(sim);
    sim.advance(TICKS_PER_MONTH * 4);
    const before = sides(sim, t.plants);
    expect(before.up.n).toBeGreaterThan(5);
    expect(before.down.n).toBeGreaterThan(5);
    expect(before.down.air).toBeGreaterThan(before.up.air * 5);
    // Residents downwind fall sick several times as often (a clinic nearby treats them).
    expect(before.down.rate).toBeGreaterThan(before.up.rate * 2.5);
    expect(before.down.sick).toBeGreaterThan(before.up.sick * 1.5);
    // A downwind home explains why its residents are unhappy.
    const dh = homes(sim, (b) => fieldAt(sim.state.airPollution, b.x, b.z) > 0.05)[0]!;
    expect(sim.buildingDetails(dh.id)!.factors.some((f) => /polluted air/i.test(f.label))).toBe(true);
    // Replace the coal plants with wind turbines on the avenue.
    const plants = [...t.plants];
    for (const id of plants)
      expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id } }).ok).toBe(true);
    const avenue = [...sim.state.net.segments.values()].filter((s) => s.type === 'avenue');
    let turbines = 0;
    for (const s of avenue)
      for (let k = 0; k < 4; k++) {
        try {
          placeAlong(sim, 'wind', s.id);
          turbines++;
        } catch {
          break;
        }
      }
    expect(turbines).toBeGreaterThan(1);
    sim.advance(TICKS_PER_MONTH * 2);
    expect(sim.state.utilityStats.power.unserved).toBe(0);
    const zc = t.mid.z;
    const after = homes(sim, (b) => b.z > zc + 110);
    expect(avg(after, (b) => fieldAt(sim.state.airPollution, b.x, b.z))).toBeLessThan(before.down.air * 0.3);
    expect(avg(after, (b) => sicknessRate(sim, b))).toBeLessThan(before.down.rate * 0.5);
  });

  it('a park between the plant and the homes soaks up some of the pollution', () => {
    const run = (park: boolean) => {
      const sim = newSim();
      const t = windStreet(sim);
      const plant = sim.state.civics.get(t.plants[0]!)!;
      if (park) {
        // Just downwind of the plants, on the same side of the homes' street.
        const target = { x: plant.x, z: plant.z + 70 };
        const hit = sim.net.nearestSegment(target, 80)!;
        const pose = roadsidePose(sim, hit.seg, hit.s, plant.side, CIVIC.get('park_large')!.d);
        const r = sim.dispatch({ type: 'placeBuilding', def: 'park_large', ...pose });
        expect(r.ok).toBe(true);
      }
      sim.advance(TICKS_PER_MONTH * 3);
      const down = homes(sim, (b) => b.z > plant.z + 110);
      return avg(down, (b) => fieldAt(sim.state.airPollution, b.x, b.z));
    };
    expect(run(true)).toBeLessThan(run(false) * 0.8);
  });
});

describe('health', () => {
  it('clinics treat the sick; without care sickness lingers and hurts', () => {
    const run = (care: boolean) => {
      const sim = newSim();
      const t = windStreet(sim);
      if (!care)
        for (const c of [...sim.state.civics.values()])
          if (c.def === 'clinic') sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: c.id } });
      sim.advance(TICKS_PER_MONTH * 4);
      const down = homes(sim, (b) => b.z > t.mid.z + 60);
      const untreated = down.reduce((s, b) => s + b.sick * (1 - b.treated), 0);
      const treated = down.reduce((s, b) => s + b.sick * b.treated, 0);
      return { sim, down, untreated, treated };
    };
    const withCare = run(true);
    const without = run(false);
    expect(withCare.treated).toBeGreaterThan(0);
    expect(without.treated).toBe(0);
    expect(without.untreated).toBeGreaterThan(withCare.untreated * 1.5);
    const sickHome = [...without.down].sort((a, b) => b.sick / b.pop - a.sick / a.pop)[0]!;
    expect(
      without.sim.buildingDetails(sickHome.id)!.factors.some((f) => /sick residents/i.test(f.label)),
    ).toBe(true);
  });
});

describe('education', () => {
  it('schools raise education, and an educated workforce retools industry', () => {
    const run = (schools: boolean) => {
      const sim = newSim();
      buildTown(sim);
      serveTown(sim);
      if (!schools)
        for (const c of [...sim.state.civics.values()])
          if (c.def === 'primary') sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: c.id } });
      sim.advance(TICKS_PER_MONTH * 9);
      const tiers = [0, 0, 0];
      for (const b of sim.state.buildings.values())
        if (b.zone === ZONE_I && b.state === BState.Active) tiers[b.wealth]!++;
      return { edu: sim.state.totals.eduWorkforce[0], tiers };
    };
    const taught = run(true);
    const not = run(false);
    expect(taught.edu).toBeGreaterThan(0.4);
    expect(not.edu).toBeLessThan(0.35);
    expect(taught.tiers[1]! + taught.tiers[2]!).toBeGreaterThan(5);
    expect(not.tiers[1]! + not.tiers[2]!).toBe(0);
  });

  it('saves keep pollution, sickness and education exactly', () => {
    const sim = Sim.create({ seed: 'citybloom', preset: 'river' });
    sim.testMode = true;
    windStreet(sim);
    sim.advance(TICKS_PER_MONTH * 2 + 77);
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    sim.advance(400);
    loaded.advance(400);
    expect(loaded.hash()).toBe(sim.hash());
  });
});
