import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BState, type Building } from '../src/sim/world/buildings';
import { HOURLY_AT, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { EDUCATION, HAPPINESS } from '../src/data/balance';
import { CIVIC } from '../src/data/civic';
import { ZONE_R } from '../src/data/zones';
import { landValueAt } from '../src/sim/systems/landValue';
import { maxWealth } from '../src/sim/systems/growth';
import { happinessFactors } from '../src/sim/systems/happiness';
import { thoughts } from '../src/sim/systems/thoughts';
import { buildTown, connectPoint, newSim, placeAlong, road, serveTown } from './helpers';

function active(sim: Sim): Building[] {
  return [...sim.state.buildings.values()].filter((b) => b.state === BState.Active);
}

function withoutCivic(sim: Sim, def: string): void {
  for (const c of [...sim.state.civics.values()])
    if (c.def === def)
      expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: c.id } }).ok).toBe(true);
}

function crimeTotal(sim: Sim): number {
  return sim.state.crime.reduce((s, v) => s + v, 0);
}

/** A long street east of the highway with a fire station near its west end. */
function stationOnStreet(sim: Sim): { station: number; street: number[]; c: { x: number; z: number } } {
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 100_000 });
  const c = connectPoint(sim);
  const street = road(sim, [c, { x: c.x + 560, z: c.z }], 'street').created!;
  const station = placeAlong(sim, 'firestation', street[0]!);
  sim.advance(TICKS_PER_HOUR);
  return { station, street, c };
}

describe('service coverage', () => {
  it('follows the roads, not the straight-line distance', () => {
    const sim = newSim();
    const { station, c } = stationOnStreet(sim);
    const st = sim.state.civics.get(station)!;
    const near = sim.serviceCoverageNear(st.x, c.z, 'fire');
    const mid = sim.serviceCoverageNear(st.x + 380, c.z, 'fire');
    const far = sim.serviceCoverageNear(c.x + 556, c.z, 'fire');
    expect(near).toBeGreaterThan(0.95);
    expect(mid).toBeLessThan(near);
    expect(far).toBeLessThan(mid);
    // A parallel street 110 m away is close as the crow flies but not linked by road: no cover.
    const side = road(sim, [
      { x: st.x + 10, z: c.z + 110 },
      { x: st.x + 260, z: c.z + 110 },
    ]).created!;
    sim.advance(TICKS_PER_HOUR);
    expect(sim.serviceCoverageNear(st.x + 80, c.z + 110, 'fire')).toBe(0);
    // Link it with a short street and it is covered.
    const seg = sim.state.net.segments.get(side[0]!)!;
    const end = sim.state.net.nodes.get(seg.a)!;
    road(sim, [
      { x: end.x, z: end.z },
      { x: end.x, z: c.z },
    ]);
    sim.advance(TICKS_PER_HOUR);
    expect(sim.serviceCoverageNear(st.x + 80, c.z + 110, 'fire')).toBeGreaterThan(0.5);
    // The data map shows the same: road cells near the station light up, the far end fades.
    const map = sim.query({ type: 'overlay', map: 'fire' }) as { values: Float32Array };
    const at = (x: number, z: number) => map.values[Math.floor(z / 16) * 128 + Math.floor(x / 16)]!;
    expect(at(st.x, c.z)).toBeGreaterThan(at(c.x + 552, c.z));
  });

  it('shrinks when the department is underfunded', () => {
    const sim = newSim();
    const { station, c } = stationOnStreet(sim);
    const st = sim.state.civics.get(station)!;
    const before = sim.serviceCoverageNear(st.x + 380, c.z, 'fire');
    expect(sim.dispatch({ type: 'setFunding', dept: 'fire', pct: 50 }).ok).toBe(true);
    const after = sim.serviceCoverageNear(st.x + 380, c.z, 'fire');
    expect(after).toBeLessThan(before * 0.8);
  });

  it('a school fills its seats with the nearest children first', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.dispatch({ type: 'setFunding', dept: 'education', pct: 50 });
    sim.advance(TICKS_PER_MONTH * 4);
    const school = [...sim.state.civics.values()].find((c) => c.def === 'primary')!;
    const homes = active(sim)
      .filter((b) => b.zone === ZONE_R && b.pop > 0)
      .sort(
        (a, b) => Math.hypot(a.x - school.x, a.z - school.z) - Math.hypot(b.x - school.x, b.z - school.z),
      );
    // More primary pupils than the (half-funded) school has seats.
    const pupils = homes.reduce((s, b) => s + b.pop * EDUCATION.pupils[0]!, 0);
    expect(pupils).toBeGreaterThan(CIVIC.get('primary')!.service!.capacity! * sim.fundingEff('education'));
    // Primary places (seat1: the share of a home's primary pupils with a seat) go nearest first: the
    // nearest quarter of homes are all seated, the farthest mostly not, and their education
    // coverage follows. (Seats go by road distance; this ranks homes by straight-line distance.)
    const avg = (xs: Building[], f: (b: Building) => number) => xs.reduce((s, b) => s + f(b), 0) / xs.length;
    const k = Math.floor(homes.length / 4);
    const [near, far] = [homes.slice(0, k), homes.slice(-k)];
    expect(avg(near, (b) => b.seat1)).toBeGreaterThan(0.95);
    expect(avg(far, (b) => b.seat1)).toBeLessThan(0.5);
    expect(avg(near, (b) => b.covEdu)).toBeGreaterThan(avg(far, (b) => b.covEdu) * 2);
  });
});

describe('incidents and dispatch', () => {
  it('fire engines drive to a fire and put it out', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    const target = active(sim).find((b) => b.covFire > 0.8 && b.fire === 0)!;
    expect(sim.dispatch({ type: 'cheat', cheat: 'ignite', id: target.id }).ok).toBe(true);
    const engine = [...sim.state.vehicles.values()].find((v) => v.kind === 'fire' && v.target === target.id);
    expect(engine).toBeDefined();
    let arrived = false;
    for (let k = 0; k < 60 && target.fire > 0; k++) {
      sim.advance(10);
      if (sim.state.vehicles.get(engine!.id)?.phase === 'work') arrived = true;
    }
    expect(arrived).toBe(true);
    expect(target.fire).toBe(0);
    expect(sim.state.buildings.get(target.id)!.state).toBe(BState.Active);
    // The engine drives home and parks.
    sim.advance(TICKS_PER_HOUR * 3);
    expect([...sim.state.vehicles.values()].some((v) => v.id === engine!.id)).toBe(false);
  });

  it('without a fire station a fire spreads and leaves rubble, which is cleared later', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    withoutCivic(sim, 'firestation');
    sim.advance(TICKS_PER_MONTH * 2);
    // Light the building with the most close neighbours.
    const list = active(sim);
    const neighbours = (b: Building) =>
      list.filter((o) => o !== b && Math.hypot(o.x - b.x, o.z - b.z) < 28).length;
    const target = list.sort((a, b) => neighbours(b) - neighbours(a))[0]!;
    sim.events = [];
    sim.dispatch({ type: 'cheat', cheat: 'ignite', id: target.id });
    sim.advance(TICKS_PER_HOUR * 20);
    expect(sim.state.buildings.get(target.id)!.state).toBe(BState.Rubble);
    const burned = new Set(sim.events.filter((e) => e.kind === 'fire').map((e) => e.id));
    expect(burned.size).toBeGreaterThan(1);
    expect(sim.buildingDetails(target.id)).not.toBeNull();
    sim.advance(TICKS_PER_HOUR * 40);
    expect(sim.state.buildings.has(target.id)).toBe(false);
  });

  it('police answer crimes, and a city without them sees crime build up', () => {
    const run = (police: boolean) => {
      const sim = newSim();
      buildTown(sim);
      serveTown(sim);
      if (!police) withoutCivic(sim, 'police');
      let sawCar = false;
      for (let d = 0; d < 4 * 24; d++) {
        sim.advance(30 * 2);
        if ([...sim.state.vehicles.values()].some((v) => v.kind === 'police')) sawCar = true;
      }
      const stopped = sim.events.filter((e) => e.kind === 'crimeStopped').length;
      return { sim, sawCar, stopped, crime: crimeTotal(sim) };
    };
    const good = run(true);
    const bad = run(false);
    expect(good.sawCar).toBe(true);
    expect(good.stopped).toBeGreaterThan(0);
    expect(bad.sawCar).toBe(false);
    expect(bad.crime).toBeGreaterThan(good.crime * 2 + 0.5);
    const hit = active(bad.sim).find((b) => bad.sim.crimeAt(b.x, b.z) > 0.1);
    expect(hit).toBeDefined();
    expect(bad.sim.buildingDetails(hit!.id)!.factors.some((f) => /crime/i.test(f.label))).toBe(true);
  });

  it('ambulances reach emergencies', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    sim.events = [];
    let sawAmbulance = false;
    for (let k = 0; k < 48; k++) {
      sim.advance(TICKS_PER_HOUR);
      if ([...sim.state.vehicles.values()].some((v) => v.kind === 'ambulance')) sawAmbulance = true;
    }
    expect(sawAmbulance).toBe(true);
    expect(sim.events.some((e) => e.kind === 'patientSaved')).toBe(true);
  });
});

describe('happiness, land value and wealth', () => {
  it('every building can explain its mood: base plus its named factors', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    // Just after the hourly mood pass, when every stored mood is up to date.
    sim.advance(TICKS_PER_MONTH * 2 + HOURLY_AT.happiness + 1);
    const list = active(sim);
    expect(list.length).toBeGreaterThan(50);
    for (const b of list) {
      const d = sim.buildingDetails(b.id)!;
      expect(d.factors.length).toBeGreaterThan(2);
      for (const f of d.factors) expect(f.label.length).toBeGreaterThan(3);
      const sum = d.base + d.factors.reduce((s, f) => s + f.value, 0);
      expect(Math.abs(Math.max(0, Math.min(1, sum)) - d.happiness)).toBeLessThan(0.01);
    }
    expect(list.every((b) => b.happiness >= 0 && b.happiness <= 1)).toBe(true);
  });

  it('a home with only primary places is told which places it lacks, not that no school is near (P25)', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim); // one primary school
    sim.advance(TICKS_PER_MONTH * 3);
    const homes = active(sim).filter(
      (b) => b.zone === ZONE_R && b.pop > 0 && b.seat1 > 0.99 && b.seat2 === 0 && b.seat3 === 0,
    );
    expect(homes.length).toBeGreaterThan(5);
    const labels = homes.flatMap((b) => sim.buildingDetails(b.id)!.factors.map((f) => f.label));
    expect(labels).not.toContain('No school nearby');
    expect(labels).toContain('No high school places nearby');
  });

  it('the school label names what is missing and the mood value stays what it was (P25)', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH);
    const b = active(sim).find((x) => x.zone === ZONE_R && x.pop > 0)!;
    b.wealth = 1;
    const cases: { seats: [number, number, number]; cov: number; label: string }[] = [
      { seats: [0, 0, 0], cov: 0, label: 'No primary school places nearby' },
      { seats: [0.4, 1, 1], cov: 0.3, label: 'Primary school is full' },
      { seats: [1, 0.5, 0], cov: 0.3, label: 'No university places nearby' },
      { seats: [1, 0, 0], cov: 0.25, label: 'No high school places nearby' },
      { seats: [1, 0.3, 0.3], cov: 0.45, label: 'High school is full' },
      { seats: [1, 1, 0.5], cov: 0.7, label: 'School nearby' },
    ];
    for (const c of cases) {
      [b.seat1, b.seat2, b.seat3] = c.seats;
      b.covEdu = c.cov;
      const f = happinessFactors(sim, b).find((x) => /school|places|university/i.test(x.label))!;
      expect(f.label, JSON.stringify(c)).toBe(c.label);
      // Labels only: the number is the old coverage maths.
      const v =
        HAPPINESS.serviceGain * c.cov - HAPPINESS.serviceLoss * (1 - c.cov) * HAPPINESS.serviceExpect[1]!;
      expect(f.value).toBeCloseTo(v, 2); // factor values are rounded to thousandths
    }
  });

  it('residents only complain about the school level they lack (P25)', () => {
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH * 2);
    for (const b of active(sim)) {
      if (b.zone !== ZONE_R) continue;
      b.wealth = 2;
      [b.seat1, b.seat2, b.seat3] = [1, 0, 0];
      b.covEdu = 0.25;
    }
    const said = thoughts(sim, 1000).map((t) => t.text);
    expect(said.some((t) => /high school/i.test(t))).toBe(true);
    expect(said.filter((t) => /youngest|nowhere to learn/i.test(t))).toEqual([]);
  });

  it('services lift approval and land value; without them the wealthy stay away', () => {
    const run = (services: boolean) => {
      const sim = newSim();
      buildTown(sim);
      serveTown(sim, services);
      sim.advance(TICKS_PER_MONTH * 3);
      const list = active(sim).filter((b) => b.zone === ZONE_R);
      const lv = list.reduce((s, b) => s + landValueAt(sim, b.x, b.z), 0) / list.length;
      return { sim, lv, approval: sim.state.totals.approval, list };
    };
    const good = run(true);
    const bad = run(false);
    expect(good.approval).toBeGreaterThan(bad.approval + 0.1);
    expect(good.lv).toBeGreaterThan(bad.lv);
    // No top-wealth homes where fire, police and health can't reach.
    expect(bad.list.filter((b) => b.wealth === 2).length).toBe(0);
    for (const b of bad.list.slice(0, 20)) {
      const acc = bad.sim.buildingAccess(b)!;
      expect(maxWealth(bad.sim, acc.seg, acc.s)).toBeLessThan(2);
    }
    const d = bad.sim.buildingDetails(bad.list[0]!.id)!;
    expect(d.factors.some((f) => /no fire station/i.test(f.label))).toBe(true);
    expect(d.factors.some((f) => /no police/i.test(f.label))).toBe(true);
  });

  it('wealthier residents expect more from services', () => {
    // Same coverage gap, bigger penalty for wealthier homes.
    const exp = HAPPINESS.serviceExpect;
    expect(exp[2]!).toBeGreaterThan(exp[1]!);
    expect(exp[1]!).toBeGreaterThan(exp[0]!);
    const sim = newSim();
    buildTown(sim);
    serveTown(sim, false);
    sim.advance(TICKS_PER_MONTH);
    const b = active(sim).find((x) => x.zone === ZONE_R)!;
    const loss = (wealth: 0 | 1 | 2) => {
      const saved = b.wealth;
      b.wealth = wealth;
      const d = sim.buildingDetails(b.id)!;
      b.wealth = saved;
      return d.factors.filter((f) => /^No /.test(f.label)).reduce((s, f) => s + f.value, 0);
    };
    expect(loss(0)).toBeLessThan(0);
    expect(loss(2)).toBeLessThan(loss(1));
    expect(loss(1)).toBeLessThan(loss(0));
  });

  it('saves taken mid-fire, just after a new station, reload exactly', () => {
    const opts = { seed: 'citybloom', preset: 'river' as const };
    const sim = Sim.create(opts);
    sim.testMode = true;
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH + 17);
    const b = active(sim)[3]!;
    sim.dispatch({ type: 'cheat', cheat: 'ignite', id: b.id });
    // A new station mid-hour: coverage must not depend on when it was last computed.
    const ave = [...sim.state.net.segments.values()].find((s) => s.type === 'avenue')!;
    placeAlong(sim, 'police', ave.id);
    sim.advance(23);
    const save = JSON.parse(JSON.stringify(sim.save()));
    const loaded = Sim.fromSave(save);
    expect(loaded.hash()).toBe(sim.hash());
    sim.advance(TICKS_PER_HOUR * 5 + 7);
    loaded.advance(TICKS_PER_HOUR * 5 + 7);
    expect(loaded.hash()).toBe(sim.hash());
  });
});
