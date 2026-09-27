import { describe, expect, it } from 'vitest';
import type { Sim } from '../src/sim/sim';
import { CIVIC } from '../src/data/civic';
import { MILESTONES } from '../src/data/progression';
import { unlocksAt } from '../src/data/unlocks';
import { MODULES } from '../src/data/modules';
import { POLICIES } from '../src/data/policies';
import { ROAD_TYPES } from '../src/data/roads';
import { DENSITY_UNLOCK_POPULATION } from '../src/data/buildings';
import { LOAN_OPTIONS } from '../src/data/economy';
import { educationCap } from '../src/sim/systems/health';
import { extractionPerDay, specialisationIncome } from '../src/sim/systems/specialisations';
import { monthlyRates } from '../src/sim/systems/economy';
import { ZONE_I } from '../src/data/zones';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, connectPoint, newSim, placeAlong, road, serveTown } from './helpers';
import { progressHour } from '../src/sim/systems/progress';

function servedTown(): { sim: Sim } {
  const sim = newSim();
  buildTown(sim);
  serveTown(sim);
  sim.advance(TICKS_PER_MONTH);
  return { sim };
}

/** Place a civic building beside any road with room (throws if none will take it). */
function place(sim: Sim, def: string): number {
  for (const seg of [...sim.state.net.segments.keys()].sort((a, b) => a - b)) {
    if (seg === sim.state.highway.segment) continue;
    try {
      return placeAlong(sim, def, seg);
    } catch {
      // Try the next road.
    }
  }
  throw new Error(`nowhere to place ${def}`);
}

describe('progression', () => {
  it('every milestone up to a metropolis unlocks something new', () => {
    // The first milestone is the start; every later one brings a batch.
    for (const m of MILESTONES.slice(1)) expect(unlocksAt(m.population).length, m.name).toBeGreaterThan(0);
    // Nothing unlocks between milestones.
    const all = new Set<number>([
      ...[...CIVIC.values()].map((d) => d.unlockPopulation),
      ...MODULES.map((m) => m.unlockPopulation),
      ...POLICIES.map((p) => p.unlockPopulation),
      ...LOAN_OPTIONS.map((l) => l.unlockPopulation),
      ...Object.values(ROAD_TYPES).map((r) => r.unlockPopulation),
      ...Object.values(DENSITY_UNLOCK_POPULATION),
    ]);
    for (const p of all)
      expect(
        MILESTONES.some((m) => m.population === p),
        `threshold ${p}`,
      ).toBe(true);
    // Regular steps: never more than 2.5× the previous milestone.
    for (let i = 2; i < MILESTONES.length; i++)
      expect(MILESTONES[i]!.population / MILESTONES[i - 1]!.population).toBeLessThanOrEqual(2.5);
  });

  it('milestones are announced once, and unlocks stay unlocked if the city shrinks', () => {
    const sim = newSim();
    buildTown(sim);
    const hour = (pop: number) => {
      sim.state.totals.population = pop;
      progressHour(sim);
      const ids = sim.events.filter((e) => e.kind === 'milestone').map((e) => e.id);
      sim.events.length = 0;
      return ids;
    };
    expect(hour(700)).toEqual([]);
    expect(hour(850)).toEqual([1]);
    expect(hour(900)).toEqual([]);
    // A jump past two thresholds announces both.
    expect(hour(5_200)).toEqual([2, 3]);
    expect(sim.state.progress.peak).toBe(5_200);
    // The city shrinks: what it unlocked stays unlocked.
    sim.state.totals.population = 300;
    expect(sim.isUnlocked(5_000)).toBe(true);
    expect(sim.isUnlocked(10_000)).toBe(false);
    expect(hour(300)).toEqual([]);
  });
});

describe('service modules', () => {
  it('add engines and upkeep to a fire station, once each, where they fit', () => {
    const { sim } = servedTown();
    const fs = [...sim.state.civics.values()].find((c) => c.def === 'firestation')!;
    const pool = [...sim.state.civics.values()].find((c) => c.def === 'pump')!;
    const before = sim.civicDetails(fs.id)!;
    const upkeep0 = monthlyRates(sim)['upkeep:fire']!;
    expect(sim.dispatch({ type: 'addModule', civic: pool.id, module: 'engineBay' }).ok).toBe(false);
    const money = sim.state.treasury;
    expect(sim.dispatch({ type: 'addModule', civic: fs.id, module: 'engineBay' }).ok).toBe(true);
    expect(sim.state.treasury).toBe(money - MODULES.find((m) => m.id === 'engineBay')!.cost);
    expect(sim.dispatch({ type: 'addModule', civic: fs.id, module: 'engineBay' }).ok).toBe(false);
    const after = sim.civicDetails(fs.id)!;
    expect(after.service!.vehicles).toBe(before.service!.vehicles + 2);
    expect(monthlyRates(sim)['upkeep:fire']!).toBeLessThan(upkeep0);
  });

  it('extra classrooms seat more pupils', () => {
    const { sim } = servedTown();
    const school = [...sim.state.civics.values()].find((c) => c.def === 'primary')!;
    const seats0 = sim.civicDetails(school.id)!.service!.seats;
    expect(sim.dispatch({ type: 'addModule', civic: school.id, module: 'classrooms' }).ok).toBe(true);
    expect(sim.civicDetails(school.id)!.service!.seats).toBe(seats0 + 150);
  });
});

describe('specialisations', () => {
  it('landmarks draw visitors who spend money and shop; hotels keep them overnight; one of each landmark', () => {
    const { sim } = servedTown();
    // Enough for both buildings and any level pads they need (the budget isn't under test here).
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 60_000 });
    place(sim, 'clocktower');
    sim.advance(TICKS_PER_HOUR);
    const dayOnly = sim.state.tourism;
    expect(dayOnly.visitors).toBeGreaterThan(200);
    expect(dayOnly.overnight).toBe(0);
    place(sim, 'hotel');
    sim.advance(TICKS_PER_HOUR);
    const t = sim.state.tourism;
    expect(t.overnight).toBeGreaterThan(0);
    expect(t.overnight).toBeLessThanOrEqual(400);
    const income = specialisationIncome(sim);
    expect(income.tourism).toBeGreaterThan(dayOnly.visitors * 3);
    expect(sim.state.demand.factors.C.some((f) => /visitors/i.test(f.label))).toBe(true);
    expect(() => place(sim, 'clocktower')).toThrow();
    // The tourism campaign brings half as many again.
    sim.dispatch({ type: 'setPolicy', id: 'tourismCampaign', on: true });
    sim.advance(TICKS_PER_HOUR);
    expect(sim.state.tourism.visitors).toBeGreaterThan(t.visitors * 1.4);
  });

  it('an oil well must stand on oil; it pumps, sells and slowly runs dry', () => {
    const sim = newSim();
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    const c = connectPoint(sim);
    // Ore lies up in the hills, not by the highway.
    const street = road(sim, [c, { x: c.x + 400, z: c.z }]).created![0]!;
    expect(() => placeAlong(sim, 'oremine', street)).toThrow();
    const well = placeAlong(sim, 'oilwell', street);
    const w = sim.state.civics.get(well)!;
    const perDay = extractionPerDay(sim, w);
    expect(perDay).toBeGreaterThan(5);
    sim.advance(TICKS_PER_MONTH);
    expect(w.stored).toBeGreaterThan(perDay * 0.9);
    const e = sim.state.economy;
    const sold = (e.month.resources ?? 0) + e.history.reduce((a, m) => a + (m.lines.resources ?? 0), 0);
    expect(sold).toBeGreaterThan(0);
    w.stored = CIVIC.get('oilwell')!.resource!.reserve;
    expect(extractionPerDay(sim, w)).toBeLessThan(perDay * 0.3);
  });

  it('a freight terminal earns on industry and lifts industrial demand', () => {
    const { sim } = servedTown();
    expect(specialisationIncome(sim).trade ?? 0).toBe(0);
    place(sim, 'freighthub');
    sim.advance(TICKS_PER_HOUR);
    expect(specialisationIncome(sim).trade).toBeGreaterThan(0);
    expect(sim.state.demand.factors.I.find((f) => /freight/i.test(f.label))?.value).toBeGreaterThan(0.1);
  });

  it('a research park needs a university and lowers the bar for high-tech industry', () => {
    const { sim } = servedTown();
    expect(() => place(sim, 'techpark')).toThrow();
    sim.state.totals.eduWorkforce = [0.8, 0.25];
    expect(educationCap(sim, ZONE_I, 0.35)).toBe(1);
    // An open street north of town for the campus.
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 300_000 });
    const c = connectPoint(sim);
    road(sim, [
      { x: c.x + 40, z: c.z - 180 },
      { x: c.x + 440, z: c.z - 180 },
    ]);
    place(sim, 'university');
    place(sim, 'techpark');
    expect(educationCap(sim, ZONE_I, 0.35)).toBe(2);
  });
});

describe('achievements', () => {
  it('are earned once for real goals, and not in sandbox mode', () => {
    const { sim } = servedTown();
    sim.advance(TICKS_PER_MONTH);
    expect(sim.state.totals.population).toBeGreaterThan(500);
    const got = sim.state.progress.achievements;
    expect(got.firstStreet).toBeDefined();
    expect(got.lightsOn).toBeDefined();
    expect(got.nestEgg).toBeUndefined();
    const first = got.firstStreet;
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 600_000 });
    sim.advance(TICKS_PER_HOUR);
    expect(sim.state.progress.achievements.nestEgg).toBeDefined();
    expect(sim.state.progress.achievements.firstStreet).toBe(first);
    const sandbox = newSim({ sandbox: true });
    buildTown(sandbox);
    sandbox.advance(TICKS_PER_HOUR * 2);
    expect(Object.keys(sandbox.state.progress.achievements)).toEqual([]);
  });
});
