import { describe, expect, it } from 'vitest';
import { challengeFor, challengeOptions, type ChallengeDef } from '../src/data/challenges';
import type { Command } from '../src/sim/commands';
import {
  CHALLENGE_TOWN,
  RUN_VERSION,
  replayRun,
  runProblem,
  type ChallengeRun,
  type RunEntry,
} from '../src/sim/runReplay';
import { Sim } from '../src/sim/sim';
import { challengeScoreNow } from '../src/sim/systems/scenario';
import { TICKS_PER_MONTH } from '../src/sim/time';

/**
 * M44: a weekly challenge's run replays to the same city. A run recorded as the worker records one
 * (each command the city took, and each save, at its tick) comes back to the same hash and score from
 * the challenge alone; a forged hash or score, a cheat, or entries out of order are caught; nothing
 * typed by a player goes into one.
 */
function recorder(def: ChallengeDef) {
  const sim = Sim.create(challengeOptions(def, CHALLENGE_TOWN));
  const entries: RunEntry[] = [];
  return {
    sim,
    entries,
    act(cmd: Command) {
      const tick = sim.tick;
      const r = sim.dispatch(cmd);
      if (r.ok) entries.push({ tick, cmd: JSON.parse(JSON.stringify(cmd)) as Command });
      return r;
    },
    save() {
      sim.save('', true);
      entries.push({ tick: sim.tick, settle: true });
    },
    run(): ChallengeRun {
      return {
        v: RUN_VERSION,
        week: def.week,
        def,
        entries: [...entries],
        end: sim.tick,
        hash: sim.hash(),
        score: challengeScoreNow(sim),
      };
    },
  };
}

function playSome(def: ChallengeDef) {
  const r = recorder(def);
  const c = r.sim.state.scenario!.center!;
  r.act({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 360, z: c.z }] });
  for (const x of [c.x + 120, c.x + 240])
    r.act({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x, z: c.z - 150 },
        { x, z: c.z + 150 },
      ],
    });
  r.act({
    type: 'zone',
    zone: 'R',
    area: {
      kind: 'brush',
      points: [
        { x: c.x + 20, z: c.z - 90 },
        { x: c.x + 340, z: c.z - 90 },
      ],
      radius: 60,
    },
  });
  r.act({
    type: 'zone',
    zone: 'C',
    area: {
      kind: 'brush',
      points: [
        { x: c.x + 20, z: c.z + 20 },
        { x: c.x + 340, z: c.z + 20 },
      ],
      radius: 20,
    },
  });
  r.sim.advance(TICKS_PER_MONTH / 3);
  // A save part-way (it settles the city: the replay must settle there too).
  r.save();
  r.act({
    type: 'zone',
    zone: 'I',
    area: {
      kind: 'brush',
      points: [
        { x: c.x + 200, z: c.z + 100 },
        { x: c.x + 340, z: c.z + 100 },
      ],
      radius: 40,
    },
  });
  r.act({ type: 'setTax', zone: 'R', wealth: 'all', rate: 0.1 } as Command);
  r.sim.advance(TICKS_PER_MONTH);
  r.act({ type: 'undo' });
  r.sim.advance(TICKS_PER_MONTH / 2);
  return r;
}

describe('M44 a challenge run replays to the same city', () => {
  const def = challengeFor(46);

  it('comes back to the same hash and score, save points and undo included', () => {
    const r = playSome(def);
    const run = r.run();
    expect(run.entries.some((e) => 'settle' in e)).toBe(true);
    expect(runProblem(run)).toBeNull();
    const back = replayRun(run);
    expect(back).toMatchObject({ ok: true, hash: run.hash, score: run.score, tick: run.end });
    // And through JSON, as it travels.
    expect(replayRun(JSON.parse(JSON.stringify(run)) as ChallengeRun).ok).toBe(true);
  });

  it('catches a forged hash or score, a cheat, and entries out of order', () => {
    const run = playSome(def).run();
    expect(replayRun({ ...run, hash: 'deadbeef' })).toMatchObject({
      ok: false,
      why: 'The replay came to another city',
    });
    expect(replayRun({ ...run, score: run.score + 500 })).toMatchObject({
      ok: false,
      why: 'The replay came to another score',
    });
    const cheat = {
      ...run,
      entries: [
        { tick: 0, cmd: { type: 'cheat', cheat: 'addMoney', amount: 1e6 } as Command },
        ...run.entries,
      ],
    };
    expect(runProblem(cheat)).toMatch(/no player could give/);
    expect(replayRun(cheat).ok).toBe(false);
    const shuffled = { ...run, entries: [...run.entries].reverse() };
    expect(runProblem(shuffled)).toBe('Entries out of order');
    expect(runProblem({ ...run, week: run.week + 1 })).toBe('A run of another week');
    expect(runProblem({ ...run, end: 10_000_000 })).toBe('An end past the challenge');
  });

  it('freezes the run where the challenge ended: playing on afterwards doesn’t change what replays', () => {
    // A short challenge (as an owner's pin might be), played to its end and on.
    const short = { ...def, months: 2, goals: [{ ...def.goals[0]!, min: 1e9 }] } as ChallengeDef;
    const r = playSome(short);
    while (r.sim.state.scenario!.status === 'playing') r.sim.step();
    // What the worker keeps at that moment (`freezeRun`).
    const frozen = { ...r.run(), entries: [...r.entries] };
    expect(r.sim.state.scenario!.status).toBe('lost');
    // Playing on: more commands, more months; the score stays as it ended.
    const c = r.sim.state.scenario!.center!;
    r.act({ type: 'buildRoad', road: 'street', points: [c, { x: c.x, z: c.z + 200 }] });
    r.sim.advance(TICKS_PER_MONTH);
    expect(challengeScoreNow(r.sim)).toBe(frozen.score);
    expect(r.entries.length).toBeGreaterThan(frozen.entries.length);
    expect(replayRun(frozen)).toMatchObject({ ok: true, tick: frozen.end, score: frozen.score });
  });

  it('keeps names a player types out of a challenge city', () => {
    const r = recorder(def);
    expect(r.act({ type: 'renameCity', name: 'Rudeville' })).toMatchObject({ ok: false });
    r.act({ type: 'createDistrict', name: 'Something rude' });
    expect([...r.sim.state.districts.values()].map((d) => d.name)).toEqual(['District 1']);
    expect(r.act({ type: 'renameDistrict', district: 1, name: 'Rude' })).toMatchObject({ ok: false });
    expect(r.sim.state.cityName).toBe(CHALLENGE_TOWN);
    // An ordinary city is named as its player likes.
    const plain = Sim.create({ seed: 'x' });
    expect(plain.dispatch({ type: 'renameCity', name: 'Bloomfield' }).ok).toBe(true);
  });
});
