import { describe, expect, it } from 'vitest';
import {
  CHALLENGE_TEMPLATES,
  CHALLENGE_TWISTS,
  SMALL_MAP,
  challengeFor,
  challengeMaxScore,
  challengeOptions,
  challengeScore,
  cleanChallengeDef,
  type ChallengeDef,
} from '../src/data/challenges';
import { Sim } from '../src/sim/sim';
import { readSaveFile, SAVE_VERSION } from '../src/sim/save';
import { scenarioSummary } from '../src/sim/systems/scenario';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, serveTown } from './helpers';

/**
 * M44: the weekly challenge. The generator makes the same challenge from the same week, every week
 * a valid one, with every template and twist turning up; a challenge city is founded from its options
 * alone and plays its twist (forbidden roads and stops, a small map, an early disaster, a tight
 * budget); its score is kept when it ends; a save keeps the challenge (v33).
 */
const weeks = (n: number) => Array.from({ length: n }, (_, k) => k + 40);

function city(def: ChallengeDef): Sim {
  const sim = Sim.create(challengeOptions(def, 'Tryton'));
  sim.testMode = true;
  return sim;
}

const weekWith = (twist: ChallengeDef['twist']) =>
  weeks(60)
    .map(challengeFor)
    .find((d) => d.twist === twist)!;

describe('M44 the weekly challenge', () => {
  it('makes the same challenge from the same week, a valid one every week, with variety', () => {
    const seen = { t: new Set<string>(), w: new Set<string>(), p: new Set<string>() };
    for (const w of weeks(52)) {
      const a = challengeFor(w);
      expect(JSON.stringify(challengeFor(w))).toBe(JSON.stringify(a));
      expect(a.week).toBe(w);
      expect(a.goals.length).toBeGreaterThan(0);
      expect(a.months).toBeGreaterThanOrEqual(12);
      // The owner's pin is checked by the same rules: a generated challenge passes them.
      const back = cleanChallengeDef(a, w);
      expect(back).not.toBeNull();
      expect(back!.goals).toEqual(a.goals);
      seen.t.add(a.template);
      seen.w.add(a.twist);
      seen.p.add(a.preset);
      // Neighbouring weeks differ (the template rotates every week).
      expect(challengeFor(w + 1).template).not.toBe(a.template);
    }
    expect([...seen.t].sort()).toEqual([...CHALLENGE_TEMPLATES].sort());
    expect([...seen.w].sort()).toEqual([...CHALLENGE_TWISTS].sort());
    expect(seen.p.size).toBeGreaterThanOrEqual(3);
  });

  it('refuses a pin that isn’t a challenge', () => {
    const ok = challengeFor(45);
    expect(cleanChallengeDef({ ...ok, goals: [] }, 45)).toBeNull();
    expect(cleanChallengeDef({ ...ok, seed: 'BAD SEED' }, 45)).toBeNull();
    expect(cleanChallengeDef({ ...ok, goals: [{ measure: 'warWon', min: 1, label: 'x' }] }, 45)).toBeNull();
    expect(cleanChallengeDef({ ...ok, name: 'x'.repeat(200) }, 45)).toBeNull();
    expect(cleanChallengeDef('nope', 45)).toBeNull();
  });

  it('cleans a pin to the same challenge every time, with its own twist only', () => {
    // A pin is cleaned by the board as it's kept, as it's served and as a city is founded on it: each
    // must give the same challenge, or a run wouldn't replay on the board.
    for (const week of weeks(12)) {
      const once = cleanChallengeDef({ ...challengeFor(week), months: 12 }, week)!;
      expect(once).not.toBeNull();
      expect(cleanChallengeDef(JSON.parse(JSON.stringify(once)), week)).toEqual(once);
      expect(JSON.stringify(cleanChallengeDef(once, week))).toBe(JSON.stringify(once));
    }
    // A week whose own challenge has an early disaster: a pin without that twist doesn't inherit it.
    const quake = weeks(30).find((w) => challengeFor(w).twist === 'disaster')!;
    const calm = cleanChallengeDef({ ...challengeFor(quake), twist: 'none', disaster: undefined }, quake)!;
    expect(calm.disaster).toBeUndefined();
  });

  it('scores goals’ progress, the win with months left, and the extra, within its maximum', () => {
    const def = {
      goals: [{ measure: 'population', min: 2000, label: '' }],
      extra: { measure: 'population', perMille: 200, cap: 4000, label: '' },
      months: 36,
    } as Pick<ChallengeDef, 'goals' | 'extra' | 'months'>;
    expect(challengeScore(def, [1000], 1000, false, 36)).toBe(500 + 200);
    expect(challengeScore(def, [2500], 2500, true, 20)).toBe(1000 + 2000 + 1600 + 500);
    expect(challengeScore(def, [2500], 999_999, true, 0)).toBeLessThanOrEqual(challengeMaxScore(def));
    const max = {
      goals: [{ measure: 'pollution', max: 8, label: '' }],
      extra: def.extra,
      months: 36,
    } as typeof def;
    expect(challengeScore(max, [16], 0, false, 36)).toBe(500);
  });

  it('gives nothing for an empty town’s approval or bank balance: other goals count as far as it has grown', () => {
    const happy = challengeFor(weeks(10).find((w) => challengeFor(w).template === 'happy')!);
    // An empty town: approval reads high, nobody lives there.
    expect(challengeScore(happy, [55, 0], 55, false, happy.months)).toBe(0);
    // Half grown: approval counts half, and so does its extra.
    const pop = happy.goals[1]!.min!;
    const half = challengeScore(happy, [60, pop / 2], 60, false, happy.months);
    expect(half).toBe(Math.floor(((0.5 + 0.5) / 2) * 1000) + Math.floor(1800 * 0.5));
    // Grown: everything counts.
    expect(challengeScore(happy, [60, pop], 60, false, happy.months)).toBe(1000 + 1800);
    const books = challengeFor(weeks(10).find((w) => challengeFor(w).template === 'books')!);
    expect(challengeScore(books, [60_000, 0], 60_000, false, books.months)).toBe(0);
  });

  it('founds a challenge city from its options alone, with its money, and begins it', () => {
    const def = weekWith('budget');
    const a = city(def);
    const b = city(def);
    expect(a.hash()).toBe(b.hash());
    expect(a.state.treasury).toBe(def.funds);
    expect(a.state.scenario).toMatchObject({ id: def.id, status: 'playing' });
    expect(a.state.scenario!.center).toBeDefined();
    const sum = scenarioSummary(a)!;
    expect(sum.challenge).toMatchObject({ week: def.week, final: false });
    expect(sum.goals.length).toBe(def.goals.length);
  });

  it('plays its twists: forbidden roads, no bus stops, a small map', () => {
    const noHw = city(weekWith('noHighway'));
    const c = noHw.state.scenario!.center!;
    const r = noHw.dispatch({ type: 'buildRoad', road: 'motorway', points: [c, { x: c.x + 200, z: c.z }] });
    expect(r).toMatchObject({ ok: false, reason: 'No city highways in this challenge' });

    const rail = city(weekWith('railOnly'));
    const rc = rail.state.scenario!.center!;
    expect(
      rail.dispatch({ type: 'buildRoad', road: 'avenue', points: [rc, { x: rc.x + 300, z: rc.z }] }).ok,
    ).toBe(true);
    expect(rail.dispatch({ type: 'placeStop', x: rc.x + 150, z: rc.z + 8 })).toMatchObject({
      ok: false,
      reason: 'No bus stops in this challenge',
    });

    const small = city(weekWith('smallMap'));
    const sc = small.state.scenario!.center!;
    expect(
      small.dispatch({ type: 'buildRoad', road: 'street', points: [sc, { x: sc.x + 200, z: sc.z }] }).ok,
    ).toBe(true);
    const far = small.dispatch({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: sc.x + 200, z: sc.z },
        { x: sc.x + SMALL_MAP + 100, z: sc.z },
      ],
    });
    expect(far).toMatchObject({
      ok: false,
      reason: `Only within ${SMALL_MAP} m of where the highway comes in in this challenge`,
    });
    // An ordinary city is untouched by all of it.
    const plain = Sim.create({ seed: small.state.options.seed, preset: small.state.options.preset });
    const pc = plain.state.net.nodes.get(plain.state.highway.connect)!;
    expect(
      plain.dispatch({
        type: 'buildRoad',
        road: 'street',
        points: [pc, { x: pc.x + SMALL_MAP + 300, z: pc.z }],
      }).ok,
    ).toBe(true);
  });

  it('strikes with its early disaster, keeps its score at the end, and keeps the challenge in a save (v33)', () => {
    // (An out-of-reach goal and six months, so it runs to the end of its time.)
    const def = {
      ...weekWith('disaster'),
      months: 6,
      goals: [{ measure: 'population' as const, min: 1_000_000, label: 'A million residents' }],
      disaster: { month: 2, kind: 'earthquake' as const },
    };
    const sim = city(def);
    // A serviced town, so the quake has homes to hit.
    buildTown(sim, { zone: true });
    serveTown(sim);
    let struck = false;
    for (let m = 0; m < 8 && sim.state.scenario!.status === 'playing'; m++) {
      sim.advance(TICKS_PER_MONTH);
      struck ||= sim.state.disasters.length > 0 || !!sim.state.scenario!.disasterDone;
    }
    expect(sim.state.scenario).toMatchObject({ status: 'lost', reason: 'time' });
    expect(sim.state.scenario!.score).toBeGreaterThan(0);
    expect(scenarioSummary(sim)!.challenge).toMatchObject({ final: true, score: sim.state.scenario!.score });
    expect(sim.state.totals.population).toBeGreaterThan(0);
    expect(struck).toBe(true);
    expect(sim.state.scenario!.disasterDone).toBe(true);
    const file = sim.save('now');
    expect(file.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(33);
    const back = Sim.fromSave(file);
    expect(back.hash()).toBe(sim.hash());
    expect(back.state.options.challenge?.id).toBe(def.id);
    // A v32 save reads as v33 with nothing else changed.
    const old = { ...back.save('now'), version: 32 };
    expect(readSaveFile(old).version).toBe(33);
    expect(Sim.fromSave(old).hash()).toBe(back.hash());
  });
});
