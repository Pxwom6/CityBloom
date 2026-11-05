/**
 * Computer neighbours' towns (phase 5, M35), DESIGN.md §3.29. A computer neighbour is numbers in
 * the region (its population, forces and defences); to fight in it, the game grows it a real town:
 * from a seed of its own, on a map that suits its kind, by the careful balance mayor (on Easy), to
 * its population or TOWN.cap, whichever is less (a map that won't take a town within a year gives
 * way to a sister seed's, the same on every machine); then it builds its
 * military: an HQ, a barracks and depot by the highway, bunkers along the way in, anti-air in the
 * centre, coastal guns on a coast. Deterministic: the same neighbour grows the same town in every
 * browser. The page grows it once (in a worker) and keeps it.
 */
import { TOWN, RIVAL_MIX } from '../../data/battle';
import type { NeighbourKind } from '../../data/region';
import { UNIT, type Personality, type UnitKind } from '../../data/war';
import type { MapPreset } from '../../data/world';
import { S, TAG, type BattleLayout, type BattleUnitIn } from '../battle/types';
import { Rng } from '../rng';
import { Sim } from '../sim';
import type { RivalNeighbour } from '../systems/region';
import { startWar } from '../systems/war';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../time';
import { Player } from './mayor';

export interface TownSpec {
  /** The player's city's seed, and the neighbour's id, name, kind and character. */
  citySeed: string;
  neighbour: number;
  name: string;
  kind: NeighbourKind;
  personality: Personality;
  /** Residents to grow to (capped). */
  population: number;
  cap?: number;
}

/** The map a neighbour's town grows on, by its kind: industry in the hills, resorts on a coast. */
export const TOWN_PRESET: Record<NeighbourKind, MapPreset> = {
  industrial: 'highlands',
  suburb: 'river',
  resort: 'coast',
};

export const townSeed = (spec: TownSpec): string => `${spec.citySeed}:town:${spec.neighbour}`;

/** Seeds a town tries in turn: its own, then sisters if a map won't take a town. */
const SISTERS = ['', ':b', ':c'];

/** The size a town is grown to: its population, capped; at least a small town. */
export function townTarget(spec: TownSpec): number {
  return Math.max(800, Math.min(spec.population, spec.cap ?? TOWN.cap));
}

/** A key for a grown town: the same key, the same town. */
export function townKey(spec: TownSpec): string {
  return `${townSeed(spec)}|${spec.kind}|${spec.personality}|${townTarget(spec)}|v${TOWN.version}`;
}

/** Grow a neighbour's town and arm it. `progress` hears the population now and then. */
export function growRivalTown(spec: TownSpec, progress?: (population: number, months: number) => void): Sim {
  const target = townTarget(spec);
  let sim: Sim | null = null;
  let mayor: Player | null = null;
  for (let k = 0; k < SISTERS.length; k++) {
    sim = Sim.create({
      seed: townSeed(spec) + SISTERS[k]!,
      preset: k < SISTERS.length - 1 ? TOWN_PRESET[spec.kind] : 'river',
      cityName: spec.name,
      difficulty: 'easy',
      disasters: false,
      elections: false,
      region: false,
    });
    mayor = new Player('careful', sim);
    let next = 0;
    let stuck = false;
    while (sim.state.totals.population < target && sim.state.tick < 48 * TICKS_PER_MONTH) {
      mayor.play();
      sim.advance(6 * TICKS_PER_HOUR);
      if (progress && sim.state.tick >= next) {
        next = sim.state.tick + TICKS_PER_MONTH;
        progress(sim.state.totals.population, sim.state.tick / TICKS_PER_MONTH);
      }
      if (sim.state.tick >= 12 * TICKS_PER_MONTH && sim.state.totals.population < Math.min(1_000, target)) {
        stuck = true;
        break;
      }
    }
    if (!stuck) break;
  }
  // Its forces are paid for out of its own numbers (the region's), not its treasury.
  sim!.dispatch({ type: 'cheat', cheat: 'unlockAll' });
  sim!.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  armTown(sim!, mayor!, spec.personality);
  // Half a day for its posts to fill and its power to reach them.
  sim!.advance(TICKS_PER_HOUR * 12);
  return sim!;
}

/** The town's military: where it would put it, as a player would. */
export function armTown(sim: Sim, mayor: Player, personality: Personality): void {
  startWar(sim);
  const s = sim.state;
  const hw = s.net.nodes.get(s.highway.connect)!;
  // The middle of the town: its buildings' centre.
  let cx = 0;
  let cz = 0;
  let n = 0;
  for (const b of s.buildings.values()) {
    cx += b.x;
    cz += b.z;
    n++;
  }
  const centre = n ? { x: cx / n, z: cz / n } : { x: hw.x, z: hw.z };
  const towards = (k: number) => ({ x: hw.x + (centre.x - hw.x) * k, z: hw.z + (centre.z - hw.z) * k });
  mayor.placeNear('militaryhq', centre, 900);
  mayor.placeNear('barracks', towards(0.35), 900);
  mayor.placeNear('vehicledepot', towards(0.45), 900);
  const bunkers = personality === 'cautious' ? 8 : personality === 'mercantile' ? 4 : 6;
  for (let k = 0; k < bunkers; k++) mayor.placeNear('bunker', towards(0.1 + (k * 0.6) / bunkers), 600);
  for (let k = 0; k < (personality === 'cautious' ? 4 : 2); k++)
    mayor.placeNear('antiair', { x: centre.x + (k - 0.5) * 120, z: centre.z }, 700);
  if (s.options.preset === 'coast') for (let k = 0; k < 2; k++) mayor.placeNear('coastalgun', centre, 1400);
  if (personality === 'aggressive' || personality === 'honourable')
    mayor.placeNear('airfield', towards(0.7), 1200);
}

/**
 * A computer neighbour's defence of its town in a battle: its forces at home as units at its bases
 * (by its character's mix, its strength's worth), and its defences' points manning its guns.
 */
export function rivalDefence(layout: BattleLayout, rival: RivalNeighbour, seed: string): void {
  const rng = Rng.fromSeed(`${seed}:defence`);
  const mix = RIVAL_MIX[rival.personality] ?? RIVAL_MIX.honourable!;
  const kinds = (Object.keys(mix) as UnitKind[]).sort();
  const total = kinds.reduce((a, k) => a + mix[k]!, 0);
  const structs = layout.structs.length / S.stride;
  const bases: number[] = [];
  const guns: number[] = [];
  for (let k = 0; k < structs; k++) {
    const tags = layout.structs[k * S.stride + S.tags]!;
    if (tags & TAG.base) bases.push(k);
    if (layout.structs[k * S.stride + S.gun]! > 0) guns.push(k);
  }
  if (!bases.length)
    for (let k = 0; k < structs; k++)
      if (layout.structs[k * S.stride + S.tags]! & TAG.military) bases.push(k);
  // The guns are manned by the defences' points: three to a gun, all of them at most.
  const manned = guns.length ? Math.min(1, rival.defences / (3 * guns.length)) : 0;
  for (const k of guns) layout.structs[k * S.stride + S.manned] = Math.round(manned * 1000) / 1000;
  const units: BattleUnitIn[] = [];
  let budget = rival.forces;
  for (let guard = 0; guard < 400 && units.length < 64 && budget > 0.5 && bases.length; guard++) {
    let pick = rng.next() * total;
    let kind = kinds[0]!;
    for (const k of kinds) {
      pick -= mix[k]!;
      if (pick < 0) {
        kind = k;
        break;
      }
    }
    const cost = UNIT.get(kind)!.strength;
    if (cost > budget + 0.5) {
      if (units.length) break;
      continue;
    }
    const b = bases[units.length % bases.length]!;
    units.push({
      id: 1 + units.length,
      kind,
      hp: 1,
      x: layout.structs[b * S.stride + S.x]!,
      z: layout.structs[b * S.stride + S.z]!,
      base: b,
    });
    budget -= cost;
  }
  layout.defenders = units;
  layout.readiness = 0.7;
}
