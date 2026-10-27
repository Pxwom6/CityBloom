import type { Sim } from '../../src/sim/sim';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, connectPoint, newSim, placeAlong, road, serveTown } from '../helpers';

/**
 * M37's test town: a served town at war with computer rivals (too weak to raid), money, a military
 * HQ and `labs` weapons labs, and `place(def)` to put a building on the first street with room.
 */
export function labTown(
  labs = 1,
  town: Parameters<typeof buildTown>[1] = {},
): { sim: Sim; place: (def: string) => number } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim, town);
  serveTown(sim);
  sim.advance(2 * TICKS_PER_MONTH);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  const segs = [...streets].reverse();
  const place = (def: string) => {
    for (const seg of segs)
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* the next street */
      }
    throw new Error(`no room for ${def}`);
  };
  // A street on past the avenue's end, with room for a research park.
  const c = connectPoint(sim);
  const end = town.length ?? 480;
  const east = road(sim, [
    { x: c.x + end, z: c.z },
    { x: c.x + end + 320, z: c.z },
  ]).created!;
  segs.push(...east);
  place('militaryhq');
  for (let k = 0; k < labs; k++) place('militarylab');
  // Neighbours too weak to raid: only research happens.
  for (const n of sim.state.region.neighbours)
    if (n.rival) sim.dispatch({ type: 'cheat', cheat: 'rival', neighbour: n.id, forces: 0.5, defences: 1 });
  sim.advance(TICKS_PER_MONTH);
  return { sim, place };
}

export const ok = (sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) => {
  const r = sim.dispatch(cmd);
  if (!r.ok) throw new Error(r.reason);
  return r;
};

export const refusal = (sim: Sim, cmd: Parameters<Sim['dispatch']>[0]) => {
  const r = sim.dispatch(cmd);
  return r.ok ? null : r.reason;
};
