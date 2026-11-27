/**
 * A weekly challenge's run across browsers (M44): the `challenge` section of the determinism run. A
 * short challenge city (six months, an owner's pin on a map the tests know) is laid out as a player
 * would (roads, zones, power and water, no cheats), saved part-way (a save settles the city), and
 * played to its end with every command it took recorded, as the worker records a run; the run is
 * frozen the tick the challenge ends, then replayed from the challenge alone. Every browser must give
 * the hashes, the score and the replay Node does: the board's honesty rests on a run replaying alike
 * on any player's machine.
 */
import { challengeFor, challengeOptions, cleanChallengeDef } from '../../src/data/challenges';
import type { Command, CommandResult } from '../../src/sim/commands';
import { checkInvariants } from '../../src/sim/invariants';
import { CHALLENGE_TOWN, RUN_VERSION, replayRun, type RunEntry } from '../../src/sim/runReplay';
import { Sim } from '../../src/sim/sim';
import { challengeScoreNow } from '../../src/sim/systems/scenario';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, placeAlong } from '../helpers';

export function runChallengeSection(note: (cmd: Command, r: CommandResult) => CommandResult): string[] {
  const def = cleanChallengeDef(
    {
      ...challengeFor(46),
      name: 'Cross-browser town',
      seed: 'cl13',
      preset: 'lakes',
      twist: 'none',
      months: 6,
      funds: 90_000,
    },
    46,
  )!;
  const sim = Sim.create(challengeOptions(def, CHALLENGE_TOWN));
  // The run, as the worker records it (only what the city took; refused tries aren't noted either).
  const entries: RunEntry[] = [];
  const dispatch = sim.dispatch.bind(sim);
  sim.dispatch = (cmd: Command, ...rest) => {
    const tick = sim.state.tick;
    const r = dispatch(cmd, ...rest);
    if (r.ok) {
      note(cmd, r);
      entries.push({ tick, cmd: JSON.parse(JSON.stringify(cmd)) as Command });
    }
    return r;
  };
  const town = buildTown(sim, { length: 380, streets: 3 });
  placeAlong(sim, 'coal', town.streets[0]!);
  placeAlong(sim, 'pump', town.streets.at(-1)!);
  const out: string[] = [];
  sim.advance(TICKS_PER_MONTH);
  out.push(sim.hash());
  // A save part-way settles the city: the replay settles there too.
  sim.save('', true);
  entries.push({ tick: sim.state.tick, settle: true });
  sim.dispatch({ type: 'setTax', zone: 'R', wealth: 'all', rate: 0.1 } as Command);
  while (sim.state.scenario!.status === 'playing') sim.step();
  checkInvariants(sim);
  const run = {
    v: RUN_VERSION,
    week: def.week,
    def,
    entries,
    end: sim.state.tick,
    hash: sim.hash(),
    score: challengeScoreNow(sim),
  };
  out.push(`${sim.state.scenario!.status} ${run.end} ${run.hash} ${run.score} ${entries.length}`);
  const back = replayRun(JSON.parse(JSON.stringify(run)) as typeof run);
  out.push(`${back.ok} ${back.hash} ${back.score} ${back.tick}`);
  return out;
}
