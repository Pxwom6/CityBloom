import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { weatherSummary } from '../src/sim/systems/weather';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, placeAlong, serveTown } from './helpers';

const clone = (sim: Sim) => Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));

/** The standard test town on the alpine highlands, grown and served. */
function alpineTown(): Sim {
  const sim = Sim.create({ seed: 'wx', preset: 'highlands', disasters: false });
  buildTown(sim);
  serveTown(sim);
  return sim;
}

/** A month's averages, sampled hourly. */
function month(sim: Sim) {
  let power = 0;
  let snowy = 0;
  let commute = 0;
  let n = 0;
  for (let h = 0; h < TICKS_PER_MONTH / TICKS_PER_HOUR; h++) {
    sim.advance(TICKS_PER_HOUR);
    power += sim.state.utilityStats.power.demand;
    snowy += weatherSummary(sim).roadsSnowy;
    commute += sim.stats().avgCommute;
    n++;
  }
  return { power: power / n, snowy: snowy / n, commute: commute / n, pop: sim.state.totals.population };
}

describe('winter (M22)', () => {
  // One town followed from spring into winter; the plough test forks it in December.
  const sim = alpineTown();
  const months: ReturnType<typeof month>[] = [];
  let december: Sim | null = null;

  it('heating raises power demand in winter: the same town needs a quarter more power in January than in July', () => {
    for (let m = 0; m < 11; m++) {
      if (dateOf(sim.state.tick + 60).month === 11) december = clone(sim);
      months.push(month(sim));
    }
    const july = months[4]!;
    const january = months[10]!;
    console.log(
      `[winter] July ${july.power.toFixed(0)} MW for ${july.pop} residents; January ${january.power.toFixed(0)} MW for ${january.pop}`,
    );
    expect(Math.abs(january.pop - july.pop) / july.pop).toBeLessThan(0.05);
    expect(january.power / january.pop).toBeGreaterThan((1.2 * july.power) / july.pop);
  });

  it('snow slows traffic until a public works depot’s ploughs clear it', () => {
    expect(december).not.toBeNull();
    const without = december!;
    const withDepot = clone(without);
    const street = [...withDepot.state.net.segments.values()].find((s) => {
      try {
        placeAlong(withDepot, 'works', s.id);
        return true;
      } catch {
        return false;
      }
    });
    expect(street).toBeDefined();
    const a = [month(without), month(without)];
    const b = [month(withDepot), month(withDepot)];
    const summer = months[4]!.commute;
    console.log(
      `[winter] Dec–Jan roads snowy ${a.map((x) => (x.snowy * 100).toFixed(0)).join('/')} % without ploughs, ` +
        `${b.map((x) => (x.snowy * 100).toFixed(0)).join('/')} % with; commute ${a.map((x) => x.commute.toFixed(0)).join('/')} s vs ` +
        `${b.map((x) => x.commute.toFixed(0)).join('/')} s (July ${summer.toFixed(0)} s)`,
    );
    // Snow lies on the roads and slows commutes...
    expect(a[1]!.snowy).toBeGreaterThan(0.5);
    expect(a[1]!.commute).toBeGreaterThan(summer * 1.1);
    // ...and ploughs clear it: fewer snowy roads and shorter commutes, the same weather.
    expect(withDepot.state.weather).toEqual(without.state.weather);
    expect(b[1]!.snowy).toBeLessThan(a[1]!.snowy * 0.8);
    expect(b[1]!.commute).toBeLessThan(a[1]!.commute * 0.95);
    const cleared = [...withDepot.state.civics.values()].find((c) => c.def === 'works')!;
    expect(cleared.lastDay + cleared.processedToday).toBeGreaterThan(0);
  });
});
