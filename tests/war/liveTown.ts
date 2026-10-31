import { awayCity, awayForce, type AwayCity } from '../../src/sim/battle/away';
import type { ForceIn } from '../../src/sim/battle/types';
import { Sim } from '../../src/sim/sim';
import type { RegionUpdate } from '../../src/sim/systems/region';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';

/**
 * M39's test towns: two served towns in a region at war, each
 * knowing the other as a friend in a region at war. Ada has an HQ, a depot and barracks and trained
 * tanks, artillery and infantry; Sam an HQ and a bunker. `friend()` is the region's word about a
 * city, as `regionUpdate` carries it.
 */
export interface LiveTown {
  sim: Sim;
  place: (def: string) => number;
}

export function liveTown(seed: string, name: string): LiveTown {
  const sim = newSim({ seed, cityName: name, disasters: false });
  sim.state.cityName = name;
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(3 * TICKS_PER_MONTH);
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
  return { sim, place };
}

const NONE = { power: 0, water: 0, garbage: 0 };

/** A city of the region as the region reports it to another. */
export function friend(slot: number, name: string, mayor: string, extra: object = {}) {
  return {
    slot,
    name,
    mayor,
    color: slot - 1,
    population: 4_000,
    kind: 'suburb' as const,
    offers: { buy: { ...NONE }, sell: { ...NONE } },
    workers: 0,
    jobs: 0,
    shoppers: 0,
    online: true,
    raid: 'open' as const,
    tiers: [0, 0, 0, 0, 0, 0],
    counter: 0,
    ...extra,
  };
}

/** Tell a city of the region's cities (and that war is on), as the region link does. */
export function regionOf(sim: Sim, cities: ReturnType<typeof friend>[]): void {
  const update: RegionUpdate = {
    cities,
    contracts: [],
    project: null,
    rules: { war: true, scale: 'skirmish', supers: true },
  };
  const r = sim.dispatch({ type: 'regionUpdate', update });
  if (!r.ok) throw new Error(r.reason);
}

/** Ada's army: an HQ, a depot and barracks, and tanks, artillery and infantry trained (war must be on). */
export function armAda(ada: LiveTown): void {
  ada.sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
  ada.place('militaryhq');
  const depot = ada.place('vehicledepot');
  const barracks = ada.place('barracks');
  for (const kind of ['tank', 'tank', 'artillery'] as const)
    ada.sim.dispatch({ type: 'trainUnit', base: depot, kind });
  for (let k = 0; k < 3; k++) ada.sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  ada.sim.advance(7 * TICKS_PER_MONTH);
}

/** Sam's defences: an HQ, a bunker, infantry and tanks (war must be on); a newcomer friends may raid by test leave. */
export function armSam(sam: LiveTown): void {
  sam.sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 1_000_000 });
  sam.place('militaryhq');
  sam.place('bunker');
  const barracks = sam.place('barracks');
  const depot = sam.place('vehicledepot');
  for (let k = 0; k < 3; k++) sam.sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  for (let k = 0; k < 2; k++) sam.sim.dispatch({ type: 'trainUnit', base: depot, kind: 'tank' });
  sam.sim.advance(5 * TICKS_PER_MONTH);
  sam.sim.dispatch({ type: 'cheat', cheat: 'unshield' });
}

/** Ada and Sam: armed, at war, each with the other for a friend (Ada is city 1, Sam city 2). */
export function liveWorld(seeds: [string, string] = ['ada-live', 'sam-live']) {
  const ada = liveTown(seeds[0], 'Adaville');
  const sam = liveTown(seeds[1], 'Samford');
  // War is on once the region says so; then the cities arm.
  regionOf(ada.sim, [friend(2, 'Samford', 'Sam')]);
  regionOf(sam.sim, [friend(1, 'Adaville', 'Ada')]);
  armAda(ada);
  armSam(sam);
  return { ada, sam };
}

/** Ada's force against Sam's city: sent and arrived (`fighting`). */
export function sendAgainst(ada: Sim, samSlot = 2): { city: AwayCity; force: ForceIn; id: number } {
  const neighbour = ada.state.region.neighbours.find((n) => n.player?.slot === samSlot)!;
  const units = [...ada.state.war!.units.values()].map((u) => u.id);
  const sent = ada.dispatch({
    type: 'sendForce',
    units,
    to: neighbour.id,
    route: 'highway',
    target: 'military',
    stance: 'bold',
  });
  if (!sent.ok) throw new Error(sent.reason);
  const fighting = () => ada.state.war!.expeditions?.find((x) => x.state === 'fighting');
  for (let t = 0; t < 24 * TICKS_PER_HOUR && !fighting(); t++) ada.step();
  const e = fighting();
  if (!e) throw new Error('the force never arrived');
  const city = awayCity(ada, e);
  return { city, force: awayForce(city), id: e.id };
}
