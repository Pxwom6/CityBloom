/**
 * A run fetched from the board replays to the city it was played as (phase 6 end). Every served
 * challenge used to be read as the owner's pin (`pinned: true`, part of the city's options), so on an
 * ordinary week, the generator's, an honest run replayed to another city and the first browser to check
 * it dropped it from the board. The playthrough's four-year run on week 46 found it; M44's tests only
 * ever used pinned weeks.
 */
import { describe, expect, it } from 'vitest';
import { ChallengeClient, packRun } from '../src/client/challenge';
import { challengeFor, challengeOptions, cleanChallengeDef, type ChallengeDef } from '../src/data/challenges';
import { CHALLENGE_TOWN, replayRun, type RunEntry } from '../src/sim/runReplay';
import { Sim } from '../src/sim/sim';
import { challengeScoreNow } from '../src/sim/systems/scenario';

/** A short run of a challenge: a street and homes at the start, then a few days played. */
async function playRun(def: ChallengeDef) {
  const sim = Sim.create(challengeOptions(def, CHALLENGE_TOWN));
  const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
  const entries: RunEntry[] = [];
  const give = (cmd: Parameters<Sim['dispatch']>[0]) => {
    if (sim.dispatch(cmd).ok) entries.push({ tick: sim.tick, cmd });
  };
  for (const d of [1, -1]) {
    give({
      type: 'buildRoad',
      road: 'street',
      points: [
        { x: n.x, z: n.z },
        { x: n.x + 300 * d, z: n.z },
      ],
    });
    if (entries.length) {
      give({
        type: 'zone',
        zone: 'R',
        area: {
          kind: 'brush',
          points: [
            { x: n.x + 40 * d, z: n.z - 20 },
            { x: n.x + 280 * d, z: n.z - 20 },
          ],
          radius: 20,
        },
      });
      break;
    }
  }
  expect(entries.length).toBe(2);
  for (let i = 0; i < 3000; i++) sim.step();
  return { entries, end: sim.tick, hash: sim.hash(), score: challengeScoreNow(sim) };
}

/** The board's answer to /challenge/run, as the relay serves it (its def: `ChallengeBoard.challenge`). */
function board(week: number, def: ChallengeDef, run: Awaited<ReturnType<typeof playRun>>, packed: string) {
  return new ChallengeClient(
    'https://board.test',
    (async () =>
      new Response(
        JSON.stringify({ id: 7, week, name: 'Ada', score: run.score, hash: run.hash, run: packed, def }),
        { status: 200 },
      )) as typeof fetch,
  );
}

describe('a run fetched from the board', () => {
  it('replays to the same city on an ordinary week (the generator’s challenge)', async () => {
    const week = 46;
    const def = challengeFor(week);
    const run = await playRun(def);
    const fetched = await board(week, def, run, await packRun(run.entries, run.end)).fetchRun(7);
    expect(fetched.run.def).toEqual(def);
    expect(replayRun(fetched.run)).toMatchObject({ ok: true, hash: run.hash });
  });

  it('replays to the same city on a week the owner pinned', async () => {
    const week = 46;
    const pin = cleanChallengeDef({ ...challengeFor(week), name: 'Six-month town', months: 6 }, week)!;
    expect(pin.pinned).toBe(true);
    const run = await playRun(pin);
    const fetched = await board(week, pin, run, await packRun(run.entries, run.end)).fetchRun(7);
    expect(fetched.run.def.pinned).toBe(true);
    expect(replayRun(fetched.run)).toMatchObject({ ok: true, hash: run.hash });
  });
});
