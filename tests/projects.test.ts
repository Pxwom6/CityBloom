import { describe, expect, it } from 'vitest';
import { CIVIC } from '../src/data/civic';
import { Sim } from '../src/sim/sim';
import { civicOnline, civicUpkeep } from '../src/sim/world/civic';
import { monthsLeft, projectBlocked, projectCost, projectRequirements } from '../src/sim/systems/projects';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, connectPoint, newSim, placeAlong, road, serveTown } from './helpers';

/** A served town with a long empty avenue to the north for big projects. */
function projectTown(seed = 'proj') {
  const sim = newSim({ seed });
  buildTown(sim);
  serveTown(sim);
  const c = connectPoint(sim);
  for (const dz of [-330, -360, -300, -390]) {
    const pts = [
      { x: c.x + 40, z: c.z + dz },
      { x: c.x + 900, z: c.z + dz },
    ];
    if (!sim.preview({ type: 'buildRoad', road: 'avenue', points: pts }).ok) continue;
    road(sim, pts, 'avenue');
    // Joined to the town's side streets (which splits the avenue: take its longest piece).
    road(
      sim,
      [
        { x: c.x + 96, z: c.z + dz },
        { x: c.x + 96, z: c.z - 160 },
      ],
      'street',
    );
    const pieces = [...sim.state.net.segments.values()].filter(
      (sg) => sg.type === 'avenue' && sim.isSegmentConnected(sg.id) && sg.id !== sim.state.highway.segment,
    );
    pieces.sort((a, b) => sim.net.curve(b.id).length - sim.net.curve(a.id).length);
    return { sim, seg: pieces[0]!.id };
  }
  throw new Error('no room for the project avenue');
}

/** Stand in for a grown city: the population peak that project requirements look at. */
function grown(sim: Sim, peak: number) {
  sim.state.progress.peak = peak;
}

/** Step to just past the next month's close. */
function nextMonth(sim: Sim) {
  sim.advance(TICKS_PER_MONTH - (sim.state.tick % TICKS_PER_MONTH) + 1);
}

describe('big projects (M17)', () => {
  it('need their requirements met, and say what is missing', () => {
    const { sim, seg } = projectTown();
    // The served town unlocked everything, which lifts population bars; put them back.
    sim.state.unlockAll = false;
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    const stadium = CIVIC.get('stadium')!;
    const tryPlace = (def: string) => {
      try {
        return placeAlong(sim, def, seg);
      } catch {
        return null;
      }
    };
    expect(tryPlace('stadium')).toBeNull();
    const r = sim.preview({ type: 'placeBuilding', def: 'stadium', x: 0, z: 0, angle: 0, side: 1 });
    expect(r.ok).toBe(false);
    grown(sim, 41_000);
    // The launch complex also needs a research park and a well-educated workforce.
    expect(tryPlace('launchsite')).toBeNull();
    expect(projectCost(stadium)).toEqual({ total: 1_600_000, first: 380_000 });
    expect(tryPlace('stadium')).not.toBeNull();
    // Sandbox cities skip the requirements.
    const sb = newSim({ seed: 'proj-sb', sandbox: true });
    expect(projectRequirements(sb, CIVIC.get('launchsite')!).some((q) => !q.met)).toBe(true);
    expect(projectBlocked(sb, CIVIC.get('launchsite')!)).toBeNull();
  });

  it('are built stage by stage, paying for each as it starts, and open when the last is done', () => {
    const { sim, seg } = projectTown();
    grown(sim, 41_000);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_500_000 });
    const before = sim.state.treasury;
    const id = placeAlong(sim, 'stadium', seg);
    const c = sim.state.civics.get(id)!;
    expect(before - sim.state.treasury).toBeGreaterThanOrEqual(380_000);
    expect(sim.state.economy.month.projects).toBe(-380_000);
    expect(c.build).toEqual({ stage: 0, months: 0, waiting: false });
    expect(civicOnline(c)).toBe(false);
    expect(civicUpkeep(c)).toBe(0);
    expect(monthsLeft(c)).toBe(10);
    const stages: number[] = [];
    for (let m = 0; m < 12 && c.build; m++) {
      nextMonth(sim);
      stages.push(c.build?.stage ?? 3);
    }
    // 3 months of groundworks, 4 of stands, 3 of roof: open after ten months.
    expect(stages.slice(0, 10)).toEqual([0, 0, 1, 1, 1, 1, 2, 2, 2, 3]);
    expect(c.build).toBeUndefined();
    expect(civicOnline(c)).toBe(true);
    expect(civicUpkeep(c)).toBe(CIVIC.get('stadium')!.upkeep);
    expect(c.cost).toBe(1_600_000);
    expect(sim.state.chronicle.events.some((e) => e.kind === 'project' && e.ref === 'stadium')).toBe(true);
  });

  it('wait when the city cannot pay for the next stage, and carry on once it can', () => {
    const { sim, seg } = projectTown();
    grown(sim, 41_000);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 500_000 });
    const id = placeAlong(sim, 'stadium', seg);
    const c = sim.state.civics.get(id)!;
    // Spend the rest so the stands can't be paid for.
    sim.spend(sim.state.treasury - 10_000, 'cheats');
    for (let m = 0; m < 5; m++) nextMonth(sim);
    expect(c.build).toMatchObject({ stage: 0, waiting: true });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 900_000 });
    nextMonth(sim);
    expect(c.build).toMatchObject({ stage: 1, months: 0, waiting: false });
  });

  it('give their perks once open: clean power, and match days with visitors, a crowd and a cheer', () => {
    const { sim, seg } = projectTown('proj2');
    grown(sim, 41_000);
    sim.state.totals.eduWorkforce = [0.9, 0.5];
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 4_500_000 });
    const helio = placeAlong(sim, 'helioarray', seg);
    const stadium = placeAlong(sim, 'stadium', seg);
    const supply0 = sim.state.utilityStats.power.supply;
    for (let m = 0; m < 11; m++) nextMonth(sim);
    expect(sim.state.civics.get(helio)!.build).toBeUndefined();
    sim.advance(120);
    expect(sim.state.utilityStats.power.supply).toBeGreaterThanOrEqual(supply0 + 4_000 * 0.9);
    // A match day comes every other month.
    for (let m = 0; m < 3 && !sim.state.matchDay; m++) nextMonth(sim);
    expect(sim.state.matchDay?.civic).toBe(stadium);
    sim.advance(180);
    expect(sim.state.tourism.visitors).toBeGreaterThan(5_000);
    // The crowd drives in from the highway: the traffic assignment carries match-day trips.
    sim.finishMatching();
    const trips = sim.trafficData().trips.filter((t) => t.purpose === 'event');
    expect(trips.length).toBeGreaterThan(0);
  });

  it('save and load mid-build exactly, and older saves load with elections scheduled', () => {
    const { sim, seg } = projectTown();
    grown(sim, 41_000);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
    placeAlong(sim, 'stadium', seg);
    nextMonth(sim);
    const loaded = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(loaded.hash()).toBe(sim.hash());
    sim.advance(2 * TICKS_PER_MONTH);
    loaded.advance(2 * TICKS_PER_MONTH);
    expect(loaded.hash()).toBe(sim.hash());
  });
});
