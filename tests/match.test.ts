import { describe, expect, it } from 'vitest';
import {
  MATCH,
  cleanMatchSettings,
  defaultMatch,
  matchScore,
  matchScoreText,
  matchSeed,
} from '../src/data/match';
import { makeSaveFile, readSaveFile } from '../src/sim/save';
import { regionReport } from '../src/sim/systems/region';
import { Sim } from '../src/sim/sim';
import { buildTown, serveTown } from './helpers';

const FAST = MATCH.fastStart;

/** A serviced, zoned town on a fixed map, with or without the fast start. */
function town(match: boolean): Sim {
  const sim = Sim.create({
    seed: 'matchtown',
    preset: 'river',
    disasters: false,
    elections: false,
    region: false,
    ...(match ? { match: { ...FAST } } : {}),
  });
  buildTown(sim, { zone: true });
  serveTown(sim);
  return sim;
}

describe('quick match (M43): settings, scores and the fast start', () => {
  it('cleans settings from the wire, allowing one minute only in test builds', () => {
    const ok = { ...defaultMatch('mab12c'), mode: 'rich', minutes: 15 };
    expect(cleanMatchSettings(ok)).toMatchObject({ mode: 'rich', minutes: 15, seed: 'mab12c', chat: false });
    expect(cleanMatchSettings({ ...ok, minutes: 1 })).toBeNull();
    expect(cleanMatchSettings({ ...ok, minutes: 1 }, true)?.minutes).toBe(1);
    expect(cleanMatchSettings({ ...ok, mode: 'war' })).toBeNull();
    expect(cleanMatchSettings({ ...ok, seed: 'NOT OK!' })).toBeNull();
    expect(cleanMatchSettings({ ...ok, preset: 'moon' })).toBeNull();
    // A target that isn't offered falls back to the default.
    expect(cleanMatchSettings({ ...ok, target: 123 })?.target).toBe(MATCH.raceTarget);
    expect(cleanMatchSettings(null)).toBeNull();
    // Seeds the page makes are ones the settings take.
    let k = 0;
    const seed = matchSeed(() => (k++ * 0.37) % 1);
    expect(cleanMatchSettings({ ...ok, seed })?.seed).toBe(seed);
  });

  it('scores each mode, and says it plainly', () => {
    const s = { minPop: 2000 };
    const a = { population: 12_000, treasury: 300_000, assets: 120_000, approval: 70 };
    const b = { population: 9_000, treasury: 500_000, assets: 60_000, approval: 85 };
    const tiny = { population: 500, treasury: 900_000, assets: 0, approval: 99 };
    expect(matchScore('race', a, s)).toBeGreaterThan(matchScore('race', b, s));
    expect(matchScore('rich', b, s)).toBeGreaterThan(matchScore('rich', a, s));
    expect(matchScore('happy', b, s)).toBeGreaterThan(matchScore('happy', a, s));
    // Below the minimum population a town can't win Happy town, however happy.
    expect(matchScore('happy', tiny, s)).toBe(0);
    expect(matchScore('mixed', a, s)).toBe(Math.round(120 + 700 + 420));
    expect(matchScoreText('race', a, s)).toBe('12,000 residents');
    expect(matchScoreText('rich', a, s)).toBe('$420,000');
    expect(matchScoreText('happy', tiny, s)).toBe('500 of 2,000 residents');
    expect(matchScoreText('happy', b, s)).toBe('85 % happy');
  });

  it('starts a match city with more money, grows it faster, and opens unlocks sooner', () => {
    const plain = town(false);
    const fast = town(true);
    expect(fast.state.treasury).toBeGreaterThan(plain.state.treasury);
    // A game day on: the fast town has filled its zones while the ordinary one is a quarter there.
    for (let t = 0; t < 1440; t++) {
      plain.step();
      fast.step();
    }
    expect(fast.state.totals.population).toBeGreaterThan(plain.state.totals.population * 2);
    // A short unlock path: a quarter of the population opens what a full one would.
    // (`reached`: unlocks and taller buildings both go by it; the test town's services are unlocked by cheat.)
    const peak = fast.state.progress.peak;
    expect(plain.reached(4 * plain.state.progress.peak + 1000)).toBe(false);
    expect(fast.reached(Math.floor(peak / FAST.unlock))).toBe(true);
    expect(fast.reached(Math.ceil((peak + 10) / FAST.unlock))).toBe(false);
    // Its region report carries the match's figures.
    const r = regionReport(fast);
    expect(r.match).toMatchObject({ tick: fast.state.tick, treasury: Math.round(fast.state.treasury) });
    expect(r.match!.approval).toBeGreaterThanOrEqual(0);
    expect(r.match!.approval).toBeLessThanOrEqual(100);
    expect(regionReport(plain).match).toBeUndefined();
  });

  it('is deterministic, keeps its fast start in a save, and loses it when kept as an ordinary city', () => {
    const a = town(true);
    const b = town(true);
    for (let t = 0; t < 1440; t++) {
      a.step();
      b.step();
    }
    expect(a.hash()).toBe(b.hash());
    const file = makeSaveFile(a.state, a.state.totals.population, 'now');
    expect(readSaveFile(file).options.match).toEqual(FAST);
    const kept = Sim.fromSave(file);
    expect(kept.hash()).toBe(a.hash());
    expect(kept.dispatch({ type: 'endMatch' }).ok).toBe(true);
    expect(kept.state.options.match).toBeUndefined();
    expect(kept.dispatch({ type: 'endMatch' }).ok).toBe(false);
    // An ordinary city's options are untouched (no key at all).
    expect('match' in town(false).state.options).toBe(false);
  });
});
