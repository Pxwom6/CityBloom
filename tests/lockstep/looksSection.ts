/**
 * Players' own buildings across browsers (M46): the `looks` section of the determinism run. A small
 * town gets a landmark wearing a model, a pocket park placed wearing one, a fire station given one
 * and then another, one taken off again and one put back by undo; then a month played, saved and
 * loaded. The sim only ever holds a model's hash, but it decides what the city is (a landmark works
 * as a park of its size), so every browser must give Node's hashes, and the save must load to the
 * same city.
 */
import type { Command, CommandResult } from '../../src/sim/commands';
import { checkInvariants } from '../../src/sim/invariants';
import { Sim } from '../../src/sim/sim';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, placeAlong } from '../helpers';

const A = '0123456789abcdef';
const B = 'c581231f80504240';

export function runLooksSection(note: (cmd: Command, r: CommandResult) => CommandResult): string[] {
  const sim = Sim.create({ seed: 'looks-xb', preset: 'river' });
  sim.testMode = true;
  const go = (cmd: Command) => note(cmd, sim.dispatch(cmd));
  go({ type: 'cheat', cheat: 'addMoney', amount: 250_000 });
  const town = buildTown(sim, { length: 420, streets: 3 });
  placeAlong(sim, 'coal', town.streets[0]!);
  placeAlong(sim, 'pump', town.streets.at(-1)!);
  const out: string[] = [];
  // A building placed wearing a model: where `placeAlong` finds it fits, cleared, then placed again with one.
  const placeWith = (def: string, street: number, look: string): number => {
    const id = placeAlong(sim, def, street);
    const c = sim.state.civics.get(id)!;
    const pose = { x: c.x, z: c.z, angle: c.angle, side: c.side };
    go({ type: 'bulldoze', target: { kind: 'civic', id } });
    const r = go({ type: 'placeBuilding', def, ...pose, look });
    return r.ok ? r.created![0]! : -1;
  };
  const landmark = placeWith('landmark2', town.streets[1]!, A);
  const park = placeWith('park_small', town.streets[2]!, B);
  const fire = placeAlong(sim, 'firestation', town.streets[0]!);
  go({ type: 'setLook', civic: fire, look: A });
  go({ type: 'setLook', civic: fire, look: B });
  go({ type: 'setLook', civic: park, look: null });
  // Undone: the park wears its model again.
  go({ type: 'undo' });
  out.push(
    [landmark, park, fire].map((id) => `${id}:${sim.state.civics.get(id)?.look ?? '-'}`).join(' '),
    sim.hash(),
  );
  sim.advance(TICKS_PER_MONTH);
  checkInvariants(sim);
  out.push(sim.hash());
  const back = Sim.fromSave(JSON.parse(JSON.stringify(sim.save('Looks', true))) as ReturnType<Sim['save']>);
  back.advance(TICKS_PER_MONTH);
  sim.advance(TICKS_PER_MONTH);
  out.push(`${back.hash()} ${sim.hash()}`);
  return out;
}
