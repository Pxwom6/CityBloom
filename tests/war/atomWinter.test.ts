import { beforeAll, describe, expect, it } from 'vitest';
import { ATOM, WINTER, WINTER_HOURS, WINTER_YEARS } from '../../src/data/atom';
import { CLIMATES, WEATHER, type ClimateId, type WeatherKind } from '../../src/data/climate';
import { TIER_KEYS } from '../../src/data/research';
import type { MapPreset } from '../../src/data/world';
import { checkInvariants, InvariantError } from '../../src/sim/invariants';
import { encodeState } from '../../src/sim/save';
import { Sim } from '../../src/sim/sim';
import { checksum, partHashes } from '../../src/sim/sync';
import { advise } from '../../src/sim/systems/advisors';
import { atomTick } from '../../src/sim/systems/atom';
import { regionMonth } from '../../src/sim/systems/region';
import {
  civicOutput,
  coldestDay,
  cityUse,
  powerOutlook,
  winterOutlook,
  winterSky,
} from '../../src/sim/systems/utilities';
import {
  initialWeather,
  maxWinterDepth,
  seasonAt,
  solarShare,
  startWinter,
  weatherHour,
  weatherSummary,
  weatherUse,
  winterDepth,
  winterTownDrag,
  winterYear,
  type WeatherState,
} from '../../src/sim/systems/weather';
import { dateOf, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { worldLook, WINTER_LOOK } from '../../src/render/weather';
import { weatherLines, winterBadge, winterBadgeShort } from '../../src/ui/weather';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';
import { clone, friendTakesPlace, rivals, warCity } from './economyHelpers';
import { labTown, ok } from './researchTown';

/**
 * M40, step 5, the nuclear winter (docs/plans/M40-design.md, call 13): a bomb that lands anywhere
 * darkens every city's sky. The winter's depth rises, holds and falls over six game years; it changes
 * values (the month's mean, the sun, where the snow line is, what a computer neighbour's town grows
 * by) and never a draw: the weather's dice and every spell's end are where they were.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;
/** Game hours into a winter by which it is at full depth (a little past the rise), and the most a young town's clock allows. */
const DEEP = WINTER.rise + 56;
const HOLD = WINTER.rise + 6;

/** A bare city with weather only (no town), `hours` into its life, and no disasters. */
function bare(preset: MapPreset = 'river', hours = 0, seed = 'wx'): Sim {
  const sim = Sim.create({ seed, preset, disasters: false });
  sim.testMode = true;
  sim.advance(hours * H);
  return sim;
}

/** A city in the hold of a winter of this `depth` that began `since` game hours ago (no event, no draw; `since` can't be more than its age). */
function winterIn(sim: Sim, depth = 1, since = DEEP, id = 'x'): Sim {
  (sim.state.weather.winters ??= []).push({ id, from: sim.state.tick - since * H, depth });
  return sim;
}

/** Every stream of dice the city keeps, and the war's: their states, to compare. */
function streams(sim: Sim): string {
  const out: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(sim.rng)) out[k] = r.getState();
  if (sim.state.war) out.war = sim.state.war.rng;
  return JSON.stringify(out);
}

const season = (sim: Sim) => seasonAt(sim.state.weather, sim.state.tick);

describe('M40: the winter’s shape', () => {
  const at = (w: WeatherState, hours: number, from = 100 * H) => winterDepth(w, from + hours * H);

  it('rises over 144 hours, holds for 576, falls over 1,008: 6 game years in all, then nothing', () => {
    expect(WINTER_HOURS).toBe(144 + 576 + 1_008);
    expect(WINTER_YEARS).toBe(6);
    const w = initialWeather('river');
    w.winters = [{ id: 'a', from: 100 * H, depth: 1 }];
    const d = (h: number) => at(w, h);
    expect(d(-50)).toBe(0);
    expect(d(0)).toBe(0);
    expect(d(72)).toBeCloseTo(0.5, 9);
    expect(d(144)).toBe(1);
    expect(d(144 + 300)).toBe(1);
    expect(d(144 + 575)).toBe(1);
    expect(d(144 + 576)).toBe(1);
    expect(d(144 + 576 + 504)).toBeCloseTo(0.5, 9);
    expect(d(WINTER_HOURS - 1)).toBeGreaterThan(0);
    expect(d(WINTER_HOURS - 1)).toBeLessThan(0.002);
    expect(d(WINTER_HOURS)).toBe(0);
    expect(d(WINTER_HOURS + 5_000)).toBe(0);
    // Up, level, down: nothing jumps or overshoots.
    let last = 0;
    let top = 0;
    for (let h = 0; h <= WINTER_HOURS; h += 12) {
      const v = d(h);
      expect(Math.abs(v - last)).toBeLessThan(0.1);
      top = Math.max(top, v);
      last = v;
    }
    expect(top).toBe(1);
  });

  it('is nothing in a city that never had one, and a lookup only', () => {
    const w = initialWeather('river');
    expect(w.winters).toBeUndefined();
    expect(winterDepth(w, 123_456)).toBe(0);
    expect(winterYear(w, 123_456)).toBe(0);
    expect(maxWinterDepth(w, 0, 1_000_000)).toBe(0);
    expect(winterTownDrag(Sim.create({ seed: 'a', disasters: false }))).toBe(0);
  });

  it('counts its years from the oldest winter in force, and the deepest it gets between two ticks', () => {
    const w = initialWeather('river');
    w.winters = [{ id: 'a', from: 0, depth: 1 }];
    const year = (h: number) => winterYear(w, h * H);
    expect([year(0), year(287), year(288), year(600), year(1_727), year(1_728), year(5_000)]).toEqual([
      1, 1, 2, 3, 6, 0, 0,
    ]);
    // The deepest between two ticks is at an end or where the rise, hold or fall begins.
    expect(maxWinterDepth(w, 0, 10 * H)).toBeCloseTo(10 / 144, 9);
    expect(maxWinterDepth(w, 10 * H, 100 * H)).toBeCloseTo(100 / 144, 9);
    expect(maxWinterDepth(w, 10 * H, 2_000 * H)).toBe(1);
    expect(maxWinterDepth(w, 1_000 * H, 1_100 * H)).toBeCloseTo(winterDepth(w, 1_000 * H), 9);
    expect(maxWinterDepth(w, 1_800 * H, 2_000 * H)).toBe(0);
    // A rise that begins inside the window and ends outside it is its last tick's.
    expect(maxWinterDepth(w, -50 * H, 20 * H)).toBeCloseTo(20 / 144, 9);
  });
});

describe('M40: winters add, and stop at the cap', () => {
  it('starts once for each id, with depth 1 for the first and half for one that begins inside another', () => {
    const sim = bare('river', 10);
    const w = sim.state.weather;
    expect(startWinter(sim, 'self:1')).toBe(true);
    expect(w.winters).toEqual([{ id: 'self:1', from: sim.state.tick, depth: 1 }]);
    expect(sim.events.filter((e) => e.kind === 'nuclearWinter')).toHaveLength(1);
    // The same id again is nothing: not a second winter, not a second event.
    expect(startWinter(sim, 'self:1')).toBe(false);
    expect(startWinter(sim, 'self:1', 0.3)).toBe(false);
    expect(w.winters).toHaveLength(1);
    expect(sim.events.filter((e) => e.kind === 'nuclearWinter')).toHaveLength(1);
    // Another bomb, while the first is rising: half as deep.
    sim.advance(5 * H);
    expect(startWinter(sim, 'a:1')).toBe(true);
    expect(w.winters![1]).toMatchObject({ id: 'a:1', depth: WINTER.later });
  });

  it('adds the winters in force, to at most 1.5; a winter that has run its course adds nothing', () => {
    const w = initialWeather('river');
    w.winters = [
      { id: 'a', from: 0, depth: 1 },
      { id: 'b', from: 50 * H, depth: 0.5 },
    ];
    // Both at full: 1.5, exactly the cap.
    expect(winterDepth(w, (50 + 144) * H)).toBeCloseTo(1.5, 9);
    // A third would take it past: the cap holds.
    w.winters.push({ id: 'c', from: 60 * H, depth: 0.5 });
    expect(winterDepth(w, (60 + 144) * H)).toBe(WINTER.cap);
    // Two years later only the later ones are left; once all are over, nothing.
    expect(winterDepth(w, (WINTER_HOURS + 40) * H)).toBeLessThan(winterDepth(w, 700 * H));
    expect(winterDepth(w, (WINTER_HOURS + 60 + 1) * H)).toBe(0);
    // Both ways round, the sum is the same.
    const flip = initialWeather('river');
    flip.winters = [...w.winters].reverse();
    for (const h of [10, 100, 400, 900, 1_500])
      expect(winterDepth(flip, h * H)).toBeCloseTo(winterDepth(w, h * H), 12);
  });

  it('a winter after the world has recovered is a first one again; a depth asked for is held to the cap', () => {
    const sim = bare('river', 3);
    const w = sim.state.weather;
    w.winters = [{ id: 'old', from: sim.state.tick - (WINTER_HOURS + 20) * H, depth: 1 }];
    expect(winterDepth(w, sim.state.tick)).toBe(0);
    expect(startWinter(sim, 'new')).toBe(true);
    expect(w.winters[1]!.depth).toBe(1);
    expect(startWinter(sim, 'big', 9)).toBe(true);
    expect(w.winters[2]!.depth).toBe(WINTER.cap);
    expect(startWinter(sim, 'none', 0)).toBe(false);
    expect(w.winters).toHaveLength(3);
  });
});

describe('M40: what a winter does to the weather', () => {
  const PRESETS: [MapPreset, ClimateId][] = [
    ['river', 'temperate'],
    ['coast', 'maritime'],
    ['lakes', 'continental'],
    ['highlands', 'alpine'],
  ];

  /** Two copies of a city a year-and-a-bit on, one with a deep winter that began 200 hours ago; the weather's hours. */
  function year(preset: MapPreset, wild = true) {
    const a = bare(preset, 200);
    if (wild) a.dispatch({ type: 'setWeather', intensity: 3 });
    const b = clone(a);
    winterIn(b, 1, 200);
    expect(winterDepth(b.state.weather, b.state.tick)).toBe(1);
    // Every spell from here on is drawn under the winter (the one in hand ends now, in both).
    a.state.weather.until = a.state.tick;
    b.state.weather.until = b.state.tick;
    const hours: {
      season: string;
      a: { kind: WeatherKind; mean: number; solar: number };
      b: { kind: WeatherKind; mean: number; solar: number };
    }[] = [];
    for (let h = 0; h < 12 * 24; h++) {
      a.advance(H);
      b.advance(H);
      const wa = a.state.weather;
      const wb = b.state.weather;
      hours.push({
        season: season(a),
        a: { kind: wa.kind, mean: wa.mean, solar: solarShare(wa, a.state.tick) },
        b: { kind: wb.kind, mean: wb.mean, solar: solarShare(wb, b.state.tick) },
      });
    }
    expect(winterDepth(b.state.weather, b.state.tick)).toBe(1);
    return { a, b, hours };
  }

  for (const [preset, climate] of PRESETS)
    it(`${climate}: every month 18 °C colder, the sun 55 % weaker, and summer rain falls as snow`, () => {
      const { a, b, hours } = year(preset);
      expect(a.state.weather.climate).toBe(climate);
      // Colder by the chill, in every hour but the heatwaves (which the winter turns into mild, cloudy spells).
      let colder = 0;
      for (const h of hours) {
        if (h.a.kind === 'heat') continue;
        expect(Math.abs(h.a.mean - h.b.mean - WINTER.chill)).toBeLessThan(0.11);
        colder++;
      }
      expect(colder).toBeGreaterThan(200);
      // The sun gives 55 % less than the same weather and season would: the reader's formula, hour by hour.
      for (const h of hours) {
        const same =
          WEATHER.solar[h.b.kind] * WEATHER.solarSeason[h.season as keyof typeof WEATHER.solarSeason];
        expect(h.b.solar).toBeCloseTo(same * (1 - WINTER.solar), 9);
      }
      const sun = (k: 'a' | 'b') => hours.reduce((s, h) => s + h[k].solar, 0) / hours.length;
      expect(sun('b')).toBeLessThan(sun('a') * 0.5);
      // July snow: the summer's rain and storms are all snow, whatever the climate's usual summer.
      const summer = hours.filter((h) => h.season === 'summer');
      const wet = summer.filter((h) => h.a.kind === 'rain' || h.a.kind === 'storm').length;
      const snowing = summer.filter((h) => h.b.kind === 'snow').length;
      console.log(
        `[winter] ${climate}: summer hours of rain or storm without a winter ${wet}; snow with one ${snowing}; ` +
          `rain or storm with one ${summer.filter((h) => h.b.kind === 'rain' || h.b.kind === 'storm').length}`,
      );
      expect(wet).toBeGreaterThan(0);
      expect(summer.filter((h) => h.b.kind === 'rain' || h.b.kind === 'storm')).toHaveLength(0);
      expect(snowing).toBeGreaterThanOrEqual(wet);
      expect(b.state.weather.snow).toBeGreaterThan(0);
    });

  it('no heatwave comes under a deep winter, though the spell is drawn like any other', () => {
    const { hours } = year('lakes');
    const heat = hours.filter((h) => h.a.kind === 'heat').length;
    expect(heat).toBeGreaterThan(0);
    expect(hours.filter((h) => h.b.kind === 'heat')).toHaveLength(0);
    // Where there was a heatwave there is a cloudy, mild spell now.
    for (const h of hours) if (h.a.kind === 'heat') expect(h.b.kind).toBe('cloudy');
  });

  it('a weather-off city is chilled and dimmed too, and has no spells of any kind', () => {
    const calm = bare('lakes', 200);
    calm.dispatch({ type: 'setWeather', intensity: 0 });
    const cold = clone(calm);
    winterIn(cold, 1, 200);
    const seen = new Set<string>();
    let diff = 0;
    for (let h = 0; h < 12 * 24; h++) {
      calm.advance(H);
      cold.advance(H);
      const wa = calm.state.weather;
      const wb = cold.state.weather;
      seen.add(`${wa.kind}/${wb.kind}`);
      expect(wb.strength).toBe(0);
      expect(Math.abs(wa.mean - wb.mean - WINTER.chill)).toBeLessThan(0.11);
      expect(solarShare(wb, cold.state.tick)).toBeCloseTo(
        solarShare(wa, calm.state.tick) * (1 - WINTER.solar),
        9,
      );
      diff += wa.mean - wb.mean;
    }
    expect([...seen]).toEqual(['clear/clear']);
    expect(diff / (12 * 24)).toBeCloseTo(WINTER.chill, 0);
    expect(cold.state.weather.snow).toBe(0);
  });

  it('a seasons-off city is chilled and dimmed too: its fixed spring turns to a freezing one, and its rain to snow', () => {
    const mild = bare('highlands', 200);
    mild.dispatch({ type: 'setWeather', seasons: false, intensity: 3 });
    const cold = clone(mild);
    winterIn(cold, 1, 200);
    mild.state.weather.until = mild.state.tick;
    cold.state.weather.until = cold.state.tick;
    const kinds = new Set<string>();
    let snowing = 0;
    let rain = 0;
    for (let h = 0; h < 12 * 24; h++) {
      mild.advance(H);
      cold.advance(H);
      const wa = mild.state.weather;
      const wb = cold.state.weather;
      expect(Math.abs(wa.mean - wb.mean - WINTER.chill)).toBeLessThan(0.11);
      // (The same formula on the sky it has: a May's, as seasons are off.)
      expect(solarShare(wb, cold.state.tick)).toBeCloseTo(
        WEATHER.solar[wb.kind] * WEATHER.solarSeason[season(cold)] * (1 - WINTER.solar),
        9,
      );
      kinds.add(wb.kind);
      if (wb.kind === 'snow') snowing++;
      if (wa.kind === 'rain' || wa.kind === 'storm') rain++;
    }
    // Eight degrees in May less eighteen: rain that would have fallen as rain falls as snow.
    expect(rain).toBeGreaterThan(0);
    expect(snowing).toBeGreaterThanOrEqual(rain);
    expect(kinds.has('rain') || kinds.has('storm')).toBe(false);
    expect(cold.state.weather.mean).toBeLessThan(-5);
  });

  it('a winter easing in and out is cold in proportion: nothing at the start, 18 degrees through the hold, back by the end', () => {
    // The hour's weather read at a chosen point of a winter's course (the weather off, so no spell
    // stands between the calendar and the reading; nothing is stepped, so no dice are drawn).
    const sim = bare('river', 20);
    sim.dispatch({ type: 'setWeather', intensity: 0 });
    const w = sim.state.weather;
    const reading = (since?: number): number => {
      if (since === undefined) delete w.winters;
      else w.winters = [{ id: 'x', from: sim.state.tick - since * H, depth: 1 }];
      weatherHour(sim);
      return w.mean;
    };
    const calendar = reading();
    const course: [number, number][] = [
      [0, 0],
      [36, 0.25],
      [72, 0.5],
      [144, 1],
      [400, 1],
      [720, 1],
      [720 + 252, 0.75],
      [720 + 504, 0.5],
      [720 + 756, 0.25],
      [WINTER_HOURS - 10, 10 / 1008],
      [WINTER_HOURS, 0],
      [WINTER_HOURS + 500, 0],
    ];
    // (The mean is kept to a tenth of a degree, so two readings differ by up to a tenth beside the chill.)
    for (const [since, share] of course)
      expect(Math.abs(calendar - reading(since) - WINTER.chill * share), `${since} hours in`).toBeLessThan(
        0.11,
      );
    // (The winters list stays, as the record of what began: the depth is what falls away.)
    expect(w.winters).toHaveLength(1);
    expect(winterDepth(w, sim.state.tick)).toBe(0);
  });
});

describe('M40: a winter draws nothing', () => {
  it('the weather’s dice are in the same state at every tick of a year, with a winter or without', () => {
    const a = bare('lakes', 200);
    a.dispatch({ type: 'setWeather', intensity: 3 });
    const b = clone(a);
    winterIn(b, 1, 200);
    const c = clone(a);
    winterIn(c, 1, 200);
    winterIn(c, 0.5, 190, 'y');
    let kinds = 0;
    for (let t = 0; t < 12 * M; t++) {
      a.step();
      b.step();
      c.step();
      const sa = a.rng.weather.getState();
      for (const s of [b, c]) {
        const sb = s.rng.weather.getState();
        if (sb.some((v, i) => v !== sa[i]))
          throw new Error(`the weather's dice differ at tick ${a.state.tick}`);
        if (s.state.weather.until !== a.state.weather.until)
          throw new Error(`a spell ends at another tick at ${a.state.tick}`);
      }
      if (b.state.weather.kind !== a.state.weather.kind) kinds++;
    }
    // (Not vacuous: the weather itself was different for much of the year.)
    expect(kinds).toBeGreaterThan(500);
    expect(streams(b)).toBe(streams(a));
    expect(streams(c)).toBe(streams(a));
  });

  it('every spell draws the same number of times at any depth, in any season, and ends at the same tick', () => {
    const depths = [0, 0.1, 0.3, 1, 1.5];
    const sims = depths.map((d) => {
      const sim = bare('lakes', 10);
      sim.dispatch({ type: 'setWeather', intensity: 3 });
      return { d, sim };
    });
    let differ = 0;
    let drawn = 0;
    // 600 spells, a few hours apart: every season, many years.
    for (let i = 0; i < 600; i++) {
      const tick = sims[0]!.sim.state.tick + i * 37 * H + (i % 7) * 11;
      for (const { d, sim } of sims) {
        sim.state.tick = tick;
        const w = sim.state.weather;
        if (d > 0) w.winters = [{ id: 'x', from: tick - DEEP * H, depth: d }];
        else delete w.winters;
        w.until = tick;
        weatherHour(sim);
      }
      const ref = sims[0]!;
      const states = sims.map((s) => JSON.stringify(s.sim.rng.weather.getState()));
      for (const s of states) expect(s).toBe(states[0]);
      for (const s of sims) {
        expect(s.sim.state.weather.until).toBe(ref.sim.state.weather.until);
        expect(s.sim.state.weather.kind === 'clear').toBe(ref.sim.state.weather.kind === 'clear');
      }
      if (sims.some((s) => s.sim.state.weather.kind !== ref.sim.state.weather.kind)) differ++;
      drawn++;
    }
    expect(drawn).toBe(600);
    // (And the winters did change what the spells were, for a good many of them.)
    expect(differ).toBeGreaterThan(100);
  });

  it('a city that never has a winter has no `winters` key through a year of weather, hashed or saved', () => {
    const sim = newSim({ disasters: false });
    sim.advance(12 * M);
    expect(sim.state.weather).not.toHaveProperty('winters');
    expect(JSON.stringify(encodeState(sim.state))).not.toContain('winters');
    expect(Object.keys(weatherSummary(sim))).not.toContain('winters');
    const before = checksum(sim);
    startWinter(sim, 'x');
    expect(checksum(sim)).not.toBe(before);
  });
});

describe('M40: heating stays bounded in a deep winter, in every climate', () => {
  const PRESETS: MapPreset[] = ['river', 'coast', 'lakes', 'highlands'];

  it('no zone asks more than its saturated heating, which is under twice any climate’s coldest January', () => {
    for (const id of Object.keys(CLIMATES) as ClimateId[]) {
      const w = initialWeather('river', 0, id);
      const january = (depth: number) => coldestDay(w, depth);
      const use = (mean: number) => weatherUse({ ...w, mean });
      const normal = use(january(0)).power;
      for (const depth of [0.5, 1, 1.5]) {
        const deep = use(january(depth)).power;
        for (const z of ['R', 'C', 'I'] as const) {
          // The clamp: heating saturates, so a deeper winter asks no more than 1 + the zone's heating.
          expect(deep[z]).toBeLessThanOrEqual(1 + WEATHER.heating[z] + 1e-12);
          expect(deep[z]).toBeGreaterThanOrEqual(normal[z] - 1e-12);
          expect(deep[z]).toBeLessThan(2 * normal[z]);
        }
      }
    }
  });

  it('a town in the coldest January of its winter needs under twice what it needs in the same January without one', () => {
    for (const preset of PRESETS) {
      const sim = newSim({ seed: 'wx', preset, disasters: false });
      buildTown(sim);
      serveTown(sim);
      sim.advance(3 * M);
      const w = sim.state.weather;
      const quiet = cityUse(sim, 'power', weatherUse({ ...w, mean: coldestDay(w, 0) }));
      const mild = cityUse(sim, 'power', weatherUse({ ...w, mean: 14 }));
      expect(quiet).toBeGreaterThan(mild);
      for (const depth of [1, 1.5]) {
        const need = cityUse(sim, 'power', weatherUse({ ...w, mean: coldestDay(w, depth) }));
        expect(need).toBeLessThan(2 * quiet);
        expect(need).toBeLessThan(1.7 * mild);
      }
    }
  });
});

describe('M40: where a winter starts', () => {
  const PLANT = 'enrichment';
  const SILO = 'atomsilo';
  let base: Sim;
  let rivalId: number;

  beforeAll(() => {
    const { sim, place } = labTown(0, { length: 800, streets: 7 });
    for (const n of rivals(sim)) n.rival!.blackout = { from: 0, until: 1e9 };
    place('nuclear');
    sim.advance(M);
    ok(sim, { type: 'cheat', cheat: 'research', tiers: [...TIER_KEYS] });
    ok(sim, { type: 'cheat', cheat: 'addMoney', amount: 60_000_000 });
    for (const def of [PLANT, SILO]) ok(sim, { type: 'cheat', cheat: 'finishStages', civic: place(def) });
    sim.advance(3 * M);
    base = sim;
    rivalId = rivals(sim)[0]!.id;
  }, 180_000);

  const atom = (sim: Sim) => sim.state.war!.atom!;
  const winters = (sim: Sim) => sim.state.weather.winters;
  const events = (sim: Sim, kind: string) => sim.events.filter((e) => e.kind === kind);

  /** The atom system alone, tick by tick, until the blast is over. */
  function blast(sim: Sim): void {
    for (let n = 0; n < 2_000 && !atom(sim).impact?.over; n++) {
      sim.state.tick++;
      atomTick(sim);
    }
    expect(atom(sim).impact?.over, 'the blast ended').toBe(true);
  }

  /** A bomb lands at once and its blast is dealt out. */
  function strike(sim: Sim): void {
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    atomTick(sim);
    expect(atom(sim).impact?.over).toBeUndefined();
    blast(sim);
  }

  it('a bomb that lands in the city starts a winter when the blast is over, named for the bomb', () => {
    const sim = clone(base);
    expect(winters(sim)).toBeUndefined();
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 0 });
    atomTick(sim);
    // (The blast is dealt out over some ticks; the winter waits for the last.)
    expect(atom(sim).impact?.over).toBeUndefined();
    expect(winters(sim)).toBeUndefined();
    blast(sim);
    const landed = sim.state.tick;
    expect(winters(sim)).toEqual([{ id: 'self:1', from: landed, depth: 1 }]);
    expect(atom(sim).boom).toBe(1);
    expect(events(sim, 'nuclearWinter')).toHaveLength(1);
    expect(events(sim, 'nuclearWinter')[0]!.info).toMatchObject({ depth: 1 });
    // Idempotent: ticks of the atom system after the blast start nothing.
    for (let k = 0; k < 20; k++) {
      sim.state.tick++;
      atomTick(sim);
    }
    expect(winters(sim)).toHaveLength(1);
    expect(events(sim, 'nuclearWinter')).toHaveLength(1);
    // And it is a winter in the weather: nothing at the landing, the deep cold a few game days on.
    expect(winterDepth(sim.state.weather, landed)).toBe(0);
    expect(winterDepth(sim.state.weather, landed + DEEP * H)).toBe(1);
  });

  it('a second bomb inside the winter adds half a winter on top of the first', () => {
    const sim = clone(base);
    strike(sim);
    sim.state.tick += 20 * H;
    strike(sim);
    expect(winters(sim)!.map((e) => [e.id, e.depth])).toEqual([
      ['self:1', 1],
      ['self:2', WINTER.later],
    ]);
    // At the bottom of both they add up to the cap.
    const w = sim.state.weather;
    expect(winterDepth(w, sim.state.tick + DEEP * H)).toBeCloseTo(WINTER.cap, 9);
  });

  it('a bomb still in the air starts nothing yet', () => {
    const sim = clone(base);
    ok(sim, { type: 'cheat', cheat: 'bombIn', hours: 12 });
    atomTick(sim);
    expect(atom(sim).inbound).toBeDefined();
    expect(winters(sim)).toBeUndefined();
  });

  it('the city’s own bomb, when it lands on a computer neighbour, starts the winter in the city that fired it', () => {
    const sim = clone(base);
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'flying', to: rivalId });
    const f = atom(sim).fired!;
    expect(winters(sim)).toBeUndefined();
    sim.advance(ATOM.flight.hours * H - 1);
    expect(atom(sim).fired!.landed).toBeUndefined();
    expect(winters(sim)).toBeUndefined();
    sim.advance(1);
    expect(sim.state.tick).toBe(f.tick + ATOM.flight.hours * H);
    expect(atom(sim).fired!.landed).toBe(true);
    expect(winters(sim)).toEqual([{ id: 'self:0', from: sim.state.tick, depth: 1 }]);
    expect(events(sim, 'nuclearWinter')).toHaveLength(1);
    // The bomb fell elsewhere: the city itself was not hit.
    expect(atom(sim).boom).toBe(0);
    expect(atom(sim).impact).toBeUndefined();
  });

  it('a flight at a neighbour that is gone lands nothing, and so starts no winter', () => {
    const sim = clone(base);
    ok(sim, { type: 'cheat', cheat: 'atom', stage: 'flying', to: rivalId });
    sim.state.region.neighbours = sim.state.region.neighbours.filter((n) => n.id !== rivalId);
    sim.advance(ATOM.flight.hours * H + 1);
    expect(atom(sim).fired!.landed).toBe(true);
    expect(winters(sim)).toBeUndefined();
  });

  it('a strike with its winter draws from no stream of dice, the weather’s and the war’s included', () => {
    const struck = clone(base);
    const before = streams(struck);
    expect(before).toBe(streams(base));
    strike(struck);
    expect(winters(struck)).toHaveLength(1);
    expect(streams(struck)).toBe(before);
  });

  it('every computer neighbour’s town grows slower while it lasts, by a value and not a draw; a friend’s city is not touched', () => {
    const calm = warCity();
    friendTakesPlace(calm);
    // (Old enough for a winter at full depth.)
    calm.advance(HOLD * H);
    const cold = clone(calm);
    winterIn(cold, 1, HOLD);
    const bystanders = rivals(calm);
    expect(bystanders.length).toBeGreaterThan(0);
    const players = calm.state.region.neighbours.filter((n) => n.player);
    expect(players).toHaveLength(1);
    const before = bystanders.map((n) => n.population);
    const popBefore = players.map((n) => n.population);
    regionMonth(calm);
    regionMonth(cold);
    expect(winterTownDrag(cold)).toBeCloseTo(WINTER.townDrag, 9);
    expect(winterTownDrag(calm)).toBe(0);
    for (const [i, n] of rivals(cold).entries()) {
      const calmer = rivals(calm)[i]!;
      expect(n.trend).toBe(calmer.trend);
      expect(n.population).toBe(Math.round(before[i]! * (1 + n.trend - WINTER.townDrag)));
      expect(calmer.population).toBe(Math.round(before[i]! * (1 + calmer.trend)));
      expect(n.population).toBeLessThan(calmer.population);
    }
    // The dice are where they were; a friend's city grows on its own machine.
    expect(streams(cold)).toBe(streams(calm));
    expect(cold.state.region.neighbours.filter((n) => n.player).map((n) => n.population)).toEqual(popBefore);
    // A depth of a half drags by half as much, and the drag follows the winter down.
    const half = clone(calm);
    winterIn(half, 0.5, HOLD);
    expect(winterTownDrag(half)).toBeCloseTo(WINTER.townDrag / 2, 9);
    // (A winter long over, set by hand: the drag is read, nothing steps.)
    const gone = clone(calm);
    gone.state.weather.winters = [{ id: 'x', from: gone.state.tick - (WINTER_HOURS + 5) * H, depth: 1 }];
    expect(winterTownDrag(gone)).toBe(0);
  });
});

describe('M40: the forecast, the advisors and the page agree with the winter', () => {
  /** The test town on the alpine highlands, served, with solar plants, grown to October of its first year. */
  function town(): Sim {
    const sim = newSim({ seed: 'wx', preset: 'highlands', disasters: false });
    buildTown(sim);
    serveTown(sim);
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
    let solar = 0;
    for (const seg of [...sim.state.net.segments.values()].filter((s) => s.type === 'street'))
      try {
        placeAlong(sim, 'solar', seg.id);
        if (++solar === 2) break;
      } catch {
        /* no room here */
      }
    expect(solar).toBeGreaterThan(0);
    toMonth(sim, 9);
    return sim;
  }

  /** Forward to the first hour of a month (0 = January) on the calendar. */
  function toMonth(sim: Sim, month: number): void {
    while (dateOf(sim.state.tick).month !== month) sim.advance(H);
  }

  it('the winter forecast counts on the dimmer sun and the colder day the winter will bring', () => {
    const sim = town();
    // October: two months to the winter season.
    const plain = winterOutlook(sim)!;
    expect(plain.months).toBe(2);
    const w = sim.state.weather;
    // The nuclear winter, in its hold, with a good way still to run.
    winterIn(sim, 1, HOLD);
    const dark = winterOutlook(sim)!;
    expect(dark.months).toBe(2);
    expect(dark.have).toBeLessThan(plain.have);
    expect(dark.need).toBeGreaterThanOrEqual(plain.need);
    // The solar plants count for 45 % of what they did in the plain forecast's snowy winter sky.
    const solar = [...sim.state.civics.values()].filter((c) => c.def === 'solar');
    const plainSolar = solar.reduce((a, c) => a + civicOutput(sim, c, 'power', winterSky(0)), 0);
    const darkSolar = solar.reduce((a, c) => a + civicOutput(sim, c, 'power', winterSky(1)), 0);
    expect(darkSolar).toBeCloseTo(plainSolar * (1 - WINTER.solar), 6);
    expect(plain.have - dark.have).toBeCloseTo(plainSolar - darkSolar, 6);
    // And what it counts on is what comes: January in the hold, the coldest spell and snow, hour by hour.
    toMonth(sim, 0);
    w.kind = 'snow';
    w.strength = 0.5;
    w.offset = WEATHER.offset[0];
    w.until = sim.state.tick + 4 * H;
    sim.advance(H);
    const depth = winterDepth(w, sim.state.tick);
    expect(depth).toBe(1);
    const sky = winterSky(depth);
    for (const c of solar)
      expect(civicOutput(sim, c, 'power')).toBeCloseTo(civicOutput(sim, c, 'power', sky), 9);
    const actual = cityUse(sim, 'power', weatherUse(w, sim.state.tick));
    const forecast = powerOutlook(sim, coldestDay(w, depth), sim.state.tick, depth);
    expect(actual).toBeCloseTo(forecast.need, 6);
  });

  it('a winter that will be over by the time the winter season comes changes the forecast not at all', () => {
    const sim = town();
    const plain = winterOutlook(sim)!;
    // 30 hours left to run, and the season is two months (48 hours) off (a winter set by hand, as old as that).
    sim.state.weather.winters = [{ id: 'x', from: sim.state.tick - (WINTER_HOURS - 30) * H, depth: 1 }];
    expect(winterDepth(sim.state.weather, sim.state.tick)).toBeGreaterThan(0);
    expect(winterOutlook(sim)).toEqual(plain);
    // And with seasons off there is no forecast, winter or not.
    sim.dispatch({ type: 'setWeather', seasons: false });
    expect(winterOutlook(sim)).toBeNull();
  });

  it('the energy advisor says solar is down and heating is up, as soon as the winter bites, and not before', () => {
    const sim = town();
    sim.advance(H);
    const line = () => advise(sim).find((a) => a.title === 'Nuclear winter');
    expect(line()).toBeUndefined();
    winterIn(sim, 1, HOLD);
    sim.advance(H);
    const a = line()!;
    expect(a).toBeDefined();
    expect(a.advisor).toBe('utilities');
    expect(a.map).toBe('power');
    expect(a.text).toContain(`Solar is down ${Math.round(WINTER.solar * 100)} %; heating is up`);
    // Without a solar plant it still talks of heating.
    for (const c of [...sim.state.civics.values()]) if (c.def === 'solar') sim.state.civics.delete(c.id);
    expect(line()!.text).toMatch(/^Heating is up/);
    // Barely begun: nothing to say yet.
    const early = town();
    startWinter(early, 'x');
    early.advance(H);
    expect(advise(early).find((x) => x.title === 'Nuclear winter')).toBeUndefined();
  });

  it('the page is told how deep it is (0 to 1), which year it is, and not the list of winters', () => {
    const sim = bare('river', 320);
    expect(weatherSummary(sim)).toMatchObject({ winter: 0, winterDepth: 0, winterYear: 0 });
    winterIn(sim, 1, 300);
    const s = weatherSummary(sim);
    expect(s).toMatchObject({ winter: 1, winterDepth: 1, winterYear: 2 });
    expect(s).not.toHaveProperty('winters');
    // Two at once: the look stays at 1, the words know it is deeper.
    winterIn(sim, 0.5, 300, 'y');
    expect(weatherSummary(sim)).toMatchObject({ winter: 1, winterDepth: 1.5 });
    // The cached summary follows a winter begun inside the same hour.
    const fresh = bare('river', 20);
    expect(weatherSummary(fresh).winterYear).toBe(0);
    startWinter(fresh, 'z');
    expect(fresh.stats().weather.winterYear).toBe(1);
  });

  it('the top bar badge and the weather tooltip say the year and the cold, and the look goes grey and snowy in July', () => {
    const sim = bare('river', 320);
    winterIn(sim, 1, 300);
    sim.advance(H);
    const w = weatherSummary(sim);
    expect(winterBadge(w)).toBe(`Nuclear winter, year 2 of 6, ${Math.round(w.temp)} °C`);
    expect(winterBadgeShort(w)).toBe('Winter 2/6');
    const lines = weatherLines(w).join('\n');
    expect(lines).toContain('Nuclear winter, year 2 of 6');
    expect(lines).toContain(`${WINTER.chill} °C colder`);
    expect(lines).toContain('solar plants give 55 % less');
    // The same sky in July: winter colours and snow whatever the calendar says.
    const summer = { ...w, season: 'summer' as const, seasons: true, snow: 0 };
    const look = (weather: typeof w, month = 6) =>
      worldLook({ stats: { weather }, displayTick: month * M + 12 * H } as never);
    const cold = look(summer);
    expect(cold.winter).toBe(1);
    expect(cold.season[3]).toBeCloseTo(1, 9);
    expect(cold.snow).toBeCloseTo(WINTER_LOOK.snow, 9);
    // Half-way down it is half way to winter's colours, and the ground's own snow is never taken away.
    const half = look({ ...summer, winter: 0.5, snow: 0.95 });
    expect(half.season[3]).toBeGreaterThan(0.45);
    expect(half.season[3]).toBeLessThan(0.55);
    expect(half.snow).toBe(0.95);
    // No winter: the calendar's look exactly.
    const plain = look({ ...summer, winter: 0 });
    expect(plain.winter).toBe(0);
    expect(plain.snow).toBe(0);
    expect(plain.season[3]).toBe(0);
  });
});

describe('M40: saves, checks and sync', () => {
  it('a city saved mid-winter loads the same and plays on to the same winter, month by month', () => {
    const sim = newSim({ seed: 'wx', preset: 'lakes', disasters: false });
    buildTown(sim);
    serveTown(sim);
    sim.advance(2 * M);
    startWinter(sim, 'self:1');
    sim.advance(30 * H);
    startWinter(sim, 'a:2');
    sim.advance(60 * H);
    expect(sim.state.weather.winters).toHaveLength(2);
    expect(winterDepth(sim.state.weather, sim.state.tick)).toBeGreaterThan(0.3);
    const copy = clone(sim);
    expect(copy.state.weather.winters).toEqual(sim.state.weather.winters);
    expect(partHashes(copy)).toEqual(partHashes(sim));
    expect(checksum(copy)).toBe(checksum(sim));
    for (let m = 0; m < 4; m++) {
      sim.advance(M);
      copy.advance(M);
      expect(copy.state.weather).toEqual(sim.state.weather);
      expect(partHashes(copy)).toEqual(partHashes(sim));
    }
    // A winter begun in the copy and the original from the same moment is the same winter.
    startWinter(sim, 'b:3');
    startWinter(copy, 'b:3');
    expect(partHashes(copy)).toEqual(partHashes(sim));
  });

  it('the weather part of the state (and the checksum) holds the winters only once there are some', () => {
    const a = newSim({ disasters: false });
    const b = clone(a);
    expect(partHashes(b)).toEqual(partHashes(a));
    startWinter(b, 'x');
    const pa = partHashes(a);
    const pb = partHashes(b);
    expect(pb.weather).not.toBe(pa.weather);
    for (const k of Object.keys(pa)) if (k !== 'weather' && k !== 'rng') expect(pb[k], k).toBe(pa[k]);
    expect(checksum(b)).not.toBe(checksum(a));
  });

  it('the invariants hold a winter to a start in the past, a depth in range and a name of its own', () => {
    const sim = newSim({ disasters: false });
    sim.advance(5 * H);
    const w = sim.state.weather;
    startWinter(sim, 'a');
    expect(() => checkInvariants(sim)).not.toThrow();
    const bad = (winters: NonNullable<WeatherState['winters']>) => {
      w.winters = winters;
      return () => checkInvariants(sim);
    };
    const t = sim.state.tick;
    expect(bad([{ id: 'a', from: t, depth: 1 }])).not.toThrow();
    expect(
      bad([
        { id: 'a', from: t, depth: 1 },
        { id: 'a', from: t, depth: 0.5 },
      ]),
    ).toThrow(InvariantError);
    expect(bad([{ id: '', from: t, depth: 1 }])).toThrow(InvariantError);
    expect(bad([{ id: 'a', from: t + 1, depth: 1 }])).toThrow(InvariantError);
    expect(bad([{ id: 'a', from: -1, depth: 1 }])).toThrow(InvariantError);
    expect(bad([{ id: 'a', from: t, depth: 0 }])).toThrow(InvariantError);
    expect(bad([{ id: 'a', from: t, depth: WINTER.cap + 0.1 }])).toThrow(InvariantError);
    expect(bad([{ id: 'a', from: t, depth: NaN }])).toThrow(InvariantError);
  });
});
