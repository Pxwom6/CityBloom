import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../../src/client/saves';
import { SAVE_VERSION, migrations, type SaveFile } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { advise } from '../../src/sim/systems/advisors';
import { seasonEase } from '../../src/sim/systems/weather';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';

/**
 * A city from before seasons had power for mild weather all year (Ashton: 420 units for 414 of
 * demand, needing about 510 in its first January). Its first winter now spares it heating, which
 * eases in by the next; it's told so on loading, and the advisor says what a winter will need.
 * Tested on a continental map (cold winters), with the town's power cut to Ashton's margin.
 */
function coldTown(grace: boolean, funding?: number): Sim {
  const sim = Sim.fromSave(decodeSave(readFileSync('Saves/legacy/v19-lakes.citybloom')));
  expect(sim.state.weather.climate).toBe('continental');
  if (!grace) delete sim.state.weather.grace;
  sim.testMode = true;
  sim.dispatch({ type: 'setDisasters', on: false });
  sim.advance(TICKS_PER_HOUR);
  // Power for the demand it was built for (without heating) and 3 % more, as Ashton had.
  const u = sim.state.utilityStats.power;
  const pct = funding ?? Math.round(((u.demand * 1.03) / u.supply) * 100);
  expect(sim.dispatch({ type: 'setFunding', dept: 'power', pct }).ok).toBe(true);
  return sim;
}

/** Through the winter ahead: the most demand against supply, and the most buildings without power. */
function winter(sim: Sim): { demand: number; supply: number; dark: number; active: number } {
  let demand = 0;
  let dark = 0;
  let active = 0;
  let supply = Infinity;
  const end = sim.state.tick + 5 * TICKS_PER_MONTH;
  while (sim.state.tick < end) {
    sim.advance(6 * TICKS_PER_HOUR);
    demand = Math.max(demand, sim.state.utilityStats.power.demand);
    supply = Math.min(supply, sim.state.utilityStats.power.supply);
    let d = 0;
    let a = 0;
    for (const b of sim.state.buildings.values()) {
      if (b.state !== BState.Active) continue;
      a++;
      if (b.power <= 0) d++;
    }
    dark = Math.max(dark, d);
    active = Math.max(active, a);
  }
  return { demand, supply, dark, active };
}

describe('seasons for a city from before them (Phase 2 review)', () => {
  it('its first winter spares it heating, with fair warning; heating counts in full by the next', () => {
    const save = decodeSave(readFileSync('Saves/legacy/v19-lakes.citybloom'));
    const loaded = Sim.fromSave(save);
    const g = loaded.state.weather.grace!;
    expect(g.from).toBe(loaded.state.tick);
    // Loaded in December: spared through this winter, easing in from March to next December.
    expect(dateOf(g.from).month).toBe(11);
    expect(dateOf(g.start).month).toBe(2);
    expect(dateOf(g.until).month).toBe(11);
    expect(g.until - g.start).toBe(9 * TICKS_PER_MONTH);
    expect(loaded.events.some((e) => e.kind === 'seasonsNew')).toBe(true);

    const spared = coldTown(true);
    const autumn = spared.state.utilityStats.power.demand;
    const note = advise(spared).find((a) => a.title === 'Seasons are new here');
    expect(note?.text).toMatch(/counts for 0 % now/);
    const funding = spared.state.economy.funding.power;
    const easy = winter(spared);
    const harsh = winter(coldTown(false, funding));
    console.log(
      `[heating] ${Math.round(easy.supply)} units of power for ${Math.round(autumn)} of autumn demand; first winter with the grace ${Math.round(easy.demand)} (${easy.dark} of ${easy.active} buildings dark), without ${Math.round(harsh.demand)} (${harsh.dark} dark)`,
    );
    // Without it the first winter asks a fifth more power than the town has, and buildings go dark;
    // with it, heating asks nothing more and none do.
    expect(harsh.demand).toBeGreaterThan(harsh.supply * 1.2);
    expect(harsh.dark).toBeGreaterThan(0);
    expect(easy.demand).toBeLessThanOrEqual(easy.supply);
    expect(easy.dark).toBe(0);
    // Heating eases in over the year, and counts in full from the next winter.
    spared.advance(g.start + 3 * TICKS_PER_MONTH - spared.state.tick);
    expect(seasonEase(spared.state.weather, spared.state.tick)).toBeCloseTo(1 / 3, 1);
    spared.advance(g.until + TICKS_PER_HOUR * 2 - spared.state.tick);
    expect(spared.state.weather.grace).toBeUndefined();
    expect(seasonEase(spared.state.weather, spared.state.tick)).toBe(1);
  });

  it(`saves from v20 on keep their seasons as they were; v${SAVE_VERSION} saves carry the grace`, () => {
    // A city that already had seasons gets no grace.
    const v20 = Sim.fromSave(decodeSave(readFileSync('Saves/legacy/v20-lakes.citybloom')));
    expect(v20.state.weather.grace).toBeUndefined();
    expect(migrations[22]).toBeTypeOf('function');
    // A city in its grace keeps it through a save and load.
    const sim = Sim.fromSave(decodeSave(readFileSync('Saves/legacy/v19-lakes.citybloom')));
    sim.advance(TICKS_PER_MONTH);
    const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())) as SaveFile);
    expect(back.state.weather.grace).toEqual(sim.state.weather.grace);
    expect(back.hash()).toBe(sim.hash());
  });
});
