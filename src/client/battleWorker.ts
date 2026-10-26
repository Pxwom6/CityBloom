/**
 * The battle worker (M35): grows computer neighbours' towns and fights expeditions' battles off the
 * page's thread and the city's worker. Given a town it already has (from the page's store), it
 * fights at once; otherwise it grows the town first, reporting progress, and hands the town back to
 * keep. Everything here is the sim's own pure code, so the result is the same on every machine.
 */
import { growRivalTown, type TownSpec } from '../sim/ai/town';
import { awayInput, awayResult, type AwayCity } from '../sim/battle/away';
import { Battle } from '../sim/battle/battle';
import type { BattleInput } from '../sim/battle/types';
import type { SaveFile } from '../sim/save';
import { Sim } from '../sim/sim';
import type { AwayResult } from '../sim/systems/expeditions';

export type BattleJob =
  | { type: 'away'; id: number; spec: TownSpec; city: AwayCity; town: SaveFile | null }
  /** A friend's city (M35): fought in the save the region keeps of it. */
  | { type: 'awayCity'; id: number; city: AwayCity; save: SaveFile }
  | { type: 'town'; id: number; spec: TownSpec };

export type BattleJobReply =
  | { type: 'progress'; id: number; population: number; months: number }
  | { type: 'away'; id: number; input: BattleInput; result: AwayResult; town: SaveFile | null }
  | { type: 'town'; id: number; town: SaveFile }
  | { type: 'error'; id: number; message: string };

const post = (m: BattleJobReply) => (self as unknown as Worker).postMessage(m);

function grow(id: number, spec: TownSpec): Sim {
  return growRivalTown(spec, (population, months) => post({ type: 'progress', id, population, months }));
}

self.onmessage = (ev: MessageEvent<BattleJob>) => {
  const job = ev.data;
  try {
    if (job.type === 'town') {
      post({ type: 'town', id: job.id, town: grow(job.id, job.spec).save() });
      return;
    }
    if (job.type === 'awayCity') {
      const input = awayInput(job.city, Sim.fromSave(job.save));
      post({
        type: 'away',
        id: job.id,
        input,
        result: awayResult(input, Battle.run(structuredClone(input))),
        town: null,
      });
      return;
    }
    const town = job.town ? Sim.fromSave(job.town) : grow(job.id, job.spec);
    const input = awayInput(job.city, town);
    const battle = Battle.run(structuredClone(input));
    post({
      type: 'away',
      id: job.id,
      input,
      result: awayResult(input, battle),
      town: job.town ? null : town.save(),
    });
  } catch (err) {
    post({ type: 'error', id: job.id, message: err instanceof Error ? err.message : String(err) });
  }
};
