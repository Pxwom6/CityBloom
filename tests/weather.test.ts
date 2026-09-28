import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import type { WeatherKind } from '../src/data/climate';
import type { MapPreset } from '../src/data/world';
import { Sim } from '../src/sim/sim';
import { seasonAt } from '../src/sim/systems/weather';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';

/** Hours of each kind of weather, peak ground snow and the temperature range over `months`. */
function sample(sim: Sim, months: number) {
  const hours: Partial<Record<WeatherKind, number>> = {};
  const bySeason: Record<string, Partial<Record<WeatherKind, number>>> = {};
  let snow = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let h = 0; h < (months * TICKS_PER_MONTH) / TICKS_PER_HOUR; h++) {
    sim.advance(TICKS_PER_HOUR);
    const w = sim.state.weather;
    hours[w.kind] = (hours[w.kind] ?? 0) + 1;
    const season = seasonAt(w, sim.state.tick);
    (bySeason[season] ??= {})[w.kind] = (bySeason[season]![w.kind] ?? 0) + 1;
    snow = Math.max(snow, w.snow);
    min = Math.min(min, w.temp);
    max = Math.max(max, w.temp);
  }
  return { hours, bySeason, snow, min, max };
}

const empty = (preset: MapPreset, seed = 'wx') => Sim.create({ seed, preset, disasters: false });

describe('seasons and weather (M22)', () => {
  it('a new city starts in spring on a fair morning, and its weather is the same every time', () => {
    const a = empty('river');
    expect(dateOf(a.state.tick).month).toBe(2);
    expect(seasonAt(a.state.weather, a.state.tick)).toBe('spring');
    expect(a.state.weather).toMatchObject({
      kind: 'clear',
      climate: 'temperate',
      seasons: true,
      intensity: 2,
    });
    const b = empty('river');
    const seq = (s: Sim) => {
      const out: string[] = [];
      for (let h = 0; h < 24 * 20; h++) {
        s.advance(TICKS_PER_HOUR);
        out.push(`${s.state.weather.kind}:${s.state.weather.temp}`);
      }
      return out.join(' ');
    };
    const sa = seq(a);
    expect(sa).toBe(seq(b));
    // Twenty days of spring: some weather besides sunshine.
    expect(new Set(sa.split(' ').map((x) => x.split(':')[0])).size).toBeGreaterThan(2);
  });

  it('climates differ: alpine winters are snowy, maritime ones wet and mild', () => {
    const alpine = sample(empty('highlands'), 12);
    const maritime = sample(empty('coast'), 12);
    console.log(
      `[weather] alpine winter ${JSON.stringify(alpine.bySeason.winter)} ${alpine.min}…${alpine.max} °C; ` +
        `maritime winter ${JSON.stringify(maritime.bySeason.winter)} ${maritime.min}…${maritime.max} °C`,
    );
    expect(alpine.bySeason.winter?.snow ?? 0).toBeGreaterThan(4);
    expect(alpine.snow).toBeGreaterThan(0.5);
    expect(alpine.min).toBeLessThan(-5);
    expect(maritime.bySeason.winter?.snow ?? 0).toBeLessThan(alpine.bySeason.winter?.snow ?? 0);
    expect((maritime.bySeason.winter?.rain ?? 0) + (maritime.bySeason.winter?.storm ?? 0)).toBeGreaterThan(4);
    expect(maritime.min).toBeGreaterThan(alpine.min);
  });

  it('with seasons off there is no snow and no heatwave; with weather off it is always clear', () => {
    const mild = empty('highlands');
    mild.dispatch({ type: 'setWeather', seasons: false });
    const m = sample(mild, 12);
    expect(m.hours.snow ?? 0).toBe(0);
    expect(m.hours.heat ?? 0).toBe(0);
    expect(m.snow).toBe(0);
    // Always late spring: a cold alpine night can touch freezing, but never snow.
    expect(m.min).toBeGreaterThan(-3);
    const off = empty('lakes');
    expect(off.dispatch({ type: 'setWeather', intensity: 0 })).toMatchObject({ ok: true });
    const o = sample(off, 12);
    expect(Object.keys(o.hours)).toEqual(['clear']);
    // Seasons still turn: a continental winter is freezing even under clear skies.
    expect(o.min).toBeLessThan(-5);
  });

  it('older saves get weather and play on; the weather survives a save and load exactly', () => {
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect(old.state.weather).toMatchObject({ climate: expect.any(String), kind: 'clear', seasons: true });
    expect(old.state.rng.weather).toHaveLength(4);
    const pop = old.state.totals.population;
    old.advance(TICKS_PER_MONTH);
    expect(old.state.totals.population).toBeGreaterThan(pop * 0.9);
    const again = Sim.fromSave(JSON.parse(JSON.stringify(old.save())));
    expect(again.hash()).toBe(old.hash());
    old.advance(TICKS_PER_MONTH);
    again.advance(TICKS_PER_MONTH);
    expect(again.state.weather).toEqual(old.state.weather);
  });
});
