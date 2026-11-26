/**
 * Clearer first problems (M42): homes without power warn, with a countdown, a day and more before the
 * first empties; a town without services is told plainly it will shrink, and what to build first.
 */
import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { advise } from '../src/sim/systems/advisors';
import { BState } from '../src/sim/world/buildings';
import { TICKS_PER_HOUR } from '../src/sim/time';
import { buildTown, serveTown } from './helpers';

function grownTown(services: boolean): { sim: Sim; civics: number[] } {
  const sim = Sim.create({ seed: 'warn42', preset: 'river', disasters: false });
  sim.testMode = true;
  buildTown(sim);
  const { civics } = serveTown(sim, services);
  sim.advance(TICKS_PER_HOUR * 24 * 6);
  return { sim, civics };
}

/** Homes that have emptied (abandoned) so far. */
const emptied = (sim: Sim) =>
  new Set(
    [...sim.state.buildings.values()]
      .filter((b) => b.state === BState.Abandoned && b.zone === 1)
      .map((b) => b.id),
  );

describe('warnings before homes empty', () => {
  it('counts down plainly from the first hours without power, before the first home empties', () => {
    const { sim, civics } = grownTown(true);
    expect(sim.state.totals.population).toBeGreaterThan(100);
    const plant = civics.find((id) => sim.state.civics.get(id)?.def === 'coal')!;
    expect(sim.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: plant } }).ok).toBe(true);
    sim.advance(TICKS_PER_HOUR * 2);
    const first = advise(sim).find((a) => a.emptying?.why === 'utility');
    expect(first?.title).toMatch(/without power/);
    expect(first!.text).toMatch(/the first will start to empty in about/);
    // (A home already in decline for other reasons may have less than the two days.)
    expect(first!.emptying!.hours).toBeGreaterThan(0);
    // Hour by hour until the first home goes: the warning stood all along, counting down.
    // (Homes that had already emptied for other reasons don't count.)
    const before = emptied(sim);
    const newlyEmptied = () => [...emptied(sim)].some((id) => !before.has(id));
    let warnedAt: number | null = null;
    let last = Infinity;
    for (let h = 0; h < 72 && !newlyEmptied(); h++) {
      const a = advise(sim).find((x) => x.emptying?.why === 'utility');
      expect(a, `hour ${h}`).toBeDefined();
      expect(a!.emptying!.hours).toBeLessThanOrEqual(last);
      last = a!.emptying!.hours;
      if (warnedAt === null && a!.emptying!.hours <= 24) warnedAt = h;
      sim.advance(TICKS_PER_HOUR);
    }
    expect(newlyEmptied()).toBe(true);
    expect(warnedAt).not.toBeNull();
    expect(last).toBeLessThanOrEqual(1);
  });

  it('tells a town without services it will shrink, and what to build first', () => {
    const { sim } = grownTown(false);
    let found: ReturnType<typeof advise>[number] | undefined;
    for (let d = 0; d < 20 && !found; d++) {
      sim.advance(TICKS_PER_HOUR * 12);
      found = advise(sim).find((a) => a.emptying?.why === 'services');
    }
    expect(found, `population ${sim.state.totals.population}`).toBeDefined();
    expect(found!.title).toBe('The town will shrink without services');
    expect(found!.text).toMatch(/Build a fire station first\./);
    expect(found!.text).toMatch(/start to empty (in about|within)/);
  });
});
