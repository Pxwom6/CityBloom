/**
 * The battle worker (M35): grows computer neighbours' towns and fights expeditions' battles off the
 * page's thread and the city's worker. Given a town it already has (from the page's store), it
 * fights at once; otherwise it grows the town first, reporting progress, and hands the town back to
 * keep. Everything here is the sim's own pure code, so the result is the same on every machine.
 */
import { growRivalTown, type TownSpec } from '../sim/ai/town';
import { awayInput, awayResult, type AwayCity } from '../sim/battle/away';
import { Battle } from '../sim/battle/battle';
import type { StampedOrder } from '../sim/battle/live';
import type { BattleFrame, BattleInput } from '../sim/battle/types';
import type { SaveFile } from '../sim/save';
import { Sim } from '../sim/sim';
import type { AwayResult } from '../sim/systems/expeditions';
import { LiveRunner, pumpRun, type LiveEnd } from './liveRunner';

export type BattleJob =
  | { type: 'away'; id: number; spec: TownSpec; city: AwayCity; town: SaveFile | null }
  /** A friend's city (M35): fought in the save the region keeps of it. */
  | { type: 'awayCity'; id: number; city: AwayCity; save: SaveFile }
  | { type: 'town'; id: number; spec: TownSpec }
  /**
   * A live battle with a friend (M39): run `input` at the battle's pace, and be fed the room's orders
   * and frontier as they come (`liveFeed`, with `rush` once the room has ended it: run it out at once).
   */
  | { type: 'live'; id: number; input: BattleInput }
  | { type: 'liveFeed'; id: number; orders: StampedOrder[]; allow: number; rush?: boolean }
  | { type: 'liveStop'; id: number };

export type BattleJobReply =
  | { type: 'progress'; id: number; population: number; months: number }
  | { type: 'away'; id: number; input: BattleInput; result: AwayResult; town: SaveFile | null }
  | { type: 'town'; id: number; town: SaveFile }
  | { type: 'error'; id: number; message: string }
  /** A live battle's picture now, and how it ended. */
  | { type: 'liveFrame'; id: number; step: number; frame: BattleFrame }
  | { type: 'liveDone'; id: number; end: LiveEnd };

const post = (m: BattleJobReply) => (self as unknown as Worker).postMessage(m);

function grow(id: number, spec: TownSpec): Sim {
  return growRivalTown(spec, (population, months) => post({ type: 'progress', id, population, months }));
}

/** The live battles being run, by job. */
const lives = new Map<
  number,
  { run: LiveRunner; timer: ReturnType<typeof setInterval>; shown: { step: number } }
>();

/** Run what is due of a live battle, show it every other step, and say so when it ends. */
function pumpLive(id: number): void {
  const l = lives.get(id);
  if (!l) return;
  try {
    const over = pumpRun(l.run, l.shown, {
      frame: (step, frame) => post({ type: 'liveFrame', id, step, frame }),
      done: (end) => post({ type: 'liveDone', id, end }),
    });
    if (over) {
      clearInterval(l.timer);
      lives.delete(id);
    }
  } catch (err) {
    clearInterval(l.timer);
    lives.delete(id);
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (ev: MessageEvent<BattleJob>) => {
  const job = ev.data;
  try {
    if (job.type === 'live') {
      const run = new LiveRunner(job.input, () => performance.now());
      lives.set(job.id, { run, timer: setInterval(() => pumpLive(job.id), 40), shown: { step: -2 } });
      post({ type: 'liveFrame', id: job.id, step: 0, frame: run.frame() });
      return;
    }
    if (job.type === 'liveFeed') {
      const l = lives.get(job.id);
      if (!l) return;
      l.run.feed(job.orders, job.allow);
      if (job.rush) l.run.rush();
      pumpLive(job.id);
      return;
    }
    if (job.type === 'liveStop') {
      const l = lives.get(job.id);
      if (l) clearInterval(l.timer);
      lives.delete(job.id);
      return;
    }
    if (job.type === 'town') {
      post({ type: 'town', id: job.id, town: grow(job.id, job.spec).save() });
      return;
    }
    if (job.type === 'awayCity') {
      // The friend's city as the region keeps it, without a battle of its own going on (its replay
      // shows only this one), and kept as such for watching again.
      const town = Sim.fromSave(job.save);
      if (town.state.war?.battle) {
        delete town.state.war.battle;
        town.battleRun = null;
      }
      const input = awayInput(job.city, town);
      post({
        type: 'away',
        id: job.id,
        input,
        result: awayResult(input, Battle.run(structuredClone(input))),
        town: town.save(),
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
