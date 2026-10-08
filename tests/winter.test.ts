import { describe, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { weatherSummary } from '../src/sim/systems/weather';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, placeAlong, serveTown } from './helpers';
import { advise } from '../src/sim/systems/advisors';
import { winterOutlook } from '../src/sim/systems/utilities';
import { WEATHER } from '../src/data/climate';
import { FUNDING_MAX, FUNDING_MIN } from '../src/data/economy';

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

describe('the winter forecast (PR #14 review)', () => {
  // The review's balance run went 181 MW short for 14 hours in its third December: the careful mayor
  // had built just enough to clear the warning, and a cold spell (up to 4 °C under the month's
  // mean) with solar at its snowy winter output took the rest.
  it('a city built to just clear the warning stays powered through a winter of cold spells', () => {
    const sim = alpineTown();
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 200_000 });
    // Some of its power from the sun.
    const sunny = [...sim.state.net.segments.values()].find((s) => {
      try {
        placeAlong(sim, 'solar', s.id);
        return true;
      } catch {
        return false;
      }
    });
    expect(sunny).toBeDefined();
    // Grown through the summer, to October: winter is two months off.
    while (dateOf(sim.state.tick).month !== 9) sim.advance(TICKS_PER_HOUR * 6);
    expect(winterOutlook(sim)!.months).toBe(2);
    // Power funded as little as clears the warning, as a mayor tuning to the advisor would.
    const warns = () => advise(sim).some((a) => a.title === 'Winter will need more power');
    let lo = FUNDING_MIN;
    let hi = FUNDING_MAX;
    sim.dispatch({ type: 'setFunding', dept: 'power', pct: hi });
    sim.advance(TICKS_PER_HOUR);
    expect(warns()).toBe(false);
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      sim.dispatch({ type: 'setFunding', dept: 'power', pct: mid });
      sim.advance(TICKS_PER_HOUR);
      if (warns()) lo = mid;
      else hi = mid;
    }
    sim.dispatch({ type: 'setFunding', dept: 'power', pct: hi });
    console.log(
      `[forecast] October: funding ${hi} % clears the warning; ${JSON.stringify(winterOutlook(sim))}`,
    );
    // December to February, every spell as cold as spells come, and snowing (solar at its lowest).
    let worst = 0;
    let short = 0;
    while (dateOf(sim.state.tick).month !== 11) sim.advance(TICKS_PER_HOUR);
    while (dateOf(sim.state.tick).month !== 2) {
      const w = sim.state.weather;
      w.offset = WEATHER.offset[0];
      w.kind = 'snow';
      w.strength = 0.5;
      w.until = sim.state.tick + TICKS_PER_HOUR * 24;
      sim.advance(TICKS_PER_HOUR);
      const u = sim.state.utilityStats.power;
      worst = Math.max(worst, u.unserved);
      if (u.unserved > 0) short++;
    }
    console.log(`[forecast] winter: ${short} h short, up to ${worst} buildings without power`);
    expect(worst).toBe(0);
  });
});
