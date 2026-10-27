/**
 * An expedition's battle (M35): the city's force against a neighbour's town. The page holds the
 * town (src/sim/ai/town.ts) and calls these: the battle's input from the city, the expedition and
 * the town; then, once it's been fought, what goes back to the city as `battleReport`. Pure and
 * deterministic, so every machine that fights the same expedition gets the same result.
 */
import { SKIRMISH, SUPER } from '../../data/battle';
import { UNIT, type UnitKind } from '../../data/war';
import type { NeighbourKind, NeighbourSide } from '../../data/region';
import { rivalMods } from '../ai/tech';
import { rivalDefence } from '../ai/town';
import type { Sim } from '../sim';
import type { AwayResult, Expedition } from '../systems/expeditions';
import { neighbourColour } from '../systems/raids';
import { researchEffect, researchMods } from '../systems/research';
import { rivalBlackedOut } from '../systems/supers';
import { BLACKOUT } from '../../data/research';
import type { RivalNeighbour } from '../systems/region';
import type { Battle } from './battle';
import { battleLayout } from './layout';
import { fnv1a } from '../hash';
import { BATTLE_VERSION, S, type BattleInput, type BattleMods, type BattleUnitIn } from './types';
import { stampBattle } from './version';

/** From the town's side, where the city's force comes from. */
const OPPOSITE: Record<NeighbourSide, NeighbourSide> = { north: 'south', south: 'north', west: 'west' };

/** What an expedition's battle needs to know of the city that sent it (all plain data). */
export interface AwayCity {
  seed: string;
  cityName: string;
  readiness: number;
  expedition: Pick<Expedition, 'id' | 'route' | 'target' | 'stance'>;
  units: { id: number; kind: UnitKind; hp: number }[];
  /** Its research's battle modifiers (M37), when it has any. */
  mods?: BattleMods;
  neighbour: {
    id: number;
    name: string;
    side: NeighbourSide;
    kind: NeighbourKind;
    population: number;
    rival: RivalNeighbour | null;
    /** A friend's city in a shared region: its place there (the battle is fought in its save). */
    slot: number | null;
    colour: number;
    /** A friend whose player isn't here (M36): the raid does half the damage. */
    absent?: boolean;
    /** A computer neighbour's posts manned this much (M37: blacked out by the city's tower). */
    manning?: number;
  };
}

/** The city's side of an expedition, from its sim. */
export function awayCity(city: Sim, e: Expedition): AwayCity {
  const s = city.state;
  const w = s.war!;
  const n = s.region.neighbours.find((x) => x.id === e.to)!;
  const mods = researchMods(city);
  // A town blacked out by the city's tower mans its guns at a third (M37).
  const manning = n.rival && !n.player && rivalBlackedOut(city, n) ? BLACKOUT.manning : 1;
  return {
    seed: s.options.seed,
    cityName: s.options.cityName,
    // Forward supply (M37) keeps a force away readier.
    readiness: Math.min(1, w.readiness + researchEffect(city, 'forwardReadiness')),
    expedition: { id: e.id, route: e.route, target: e.target, stance: e.stance },
    units: e.units.flatMap((id) => {
      const u = w.units.get(id);
      return u ? [{ id, kind: u.kind, hp: u.hp }] : [];
    }),
    ...(Object.keys(mods).length ? { mods } : {}),
    neighbour: {
      id: n.id,
      name: n.name,
      side: n.side,
      kind: n.kind,
      population: n.population,
      rival: n.rival ? { ...n.rival } : null,
      slot: n.player?.slot ?? null,
      colour: n.player?.color ?? neighbourColour(city, n.id),
      ...(n.player && !n.player.online ? { absent: true } : {}),
      ...(manning < 1 ? { manning } : {}),
    },
  };
}

/** An expedition's battle's id: the same however often it's fought (the region keeps one of each). */
export function awayBattleId(seed: string, expedition: number): string {
  return `exp-${fnv1a(seed).slice(0, 8)}-${expedition}`;
}

/** The battle an expedition fights in the town it raids. */
export function awayInput(city: AwayCity, town: Sim): BattleInput {
  const e = city.expedition;
  const n = city.neighbour;
  const seed = `${city.seed}:battle:${e.id}`;
  const layout = battleLayout(town, { target: e.target, from: OPPOSITE[n.side] });
  if (n.rival) {
    rivalDefence(layout, n.rival, seed);
    const man = n.manning;
    if (man !== undefined && man < 1)
      for (let k = 0; k < layout.structs.length / S.stride; k++) {
        const i = k * S.stride + S.manned;
        layout.structs[i] = Math.round(layout.structs[i]! * man * 1000) / 1000;
      }
    // A computer neighbour's defenders fight with its tech (M37: none until its tech arrives).
    const theirs = rivalMods(n.rival);
    if (theirs) layout.mods = theirs;
    else delete layout.mods;
  }
  const units: BattleUnitIn[] = city.units.map((u) => ({
    id: u.id,
    kind: u.kind,
    hp: u.hp,
    x: 0,
    z: 0,
    base: -1,
  }));
  // A sky fortress brings what it carries (M37), launched over the town: ids −(1000 + k).
  let carried = 0;
  for (const u of city.units) {
    const c = UNIT.get(u.kind)?.stats.carries;
    for (let k = 0; c && k < c.n && carried < SUPER.maxCarried; k++, carried++)
      units.push({ id: -(SUPER.carriedId + carried), kind: c.kind, hp: 1, x: 0, z: 0, base: -1, from: u.id });
  }
  // A superweapon in a computer neighbour's town may knock down more; a friend keeps a skirmish's caps.
  const superweapon = city.units.some((u) => !!UNIT.get(u.kind)?.super);
  return stampBattle({
    v: BATTLE_VERSION,
    // Unique across the cities of a region: the city's seed, hashed, and the expedition.
    id: awayBattleId(city.seed, e.id),
    seed,
    scale: 'skirmish',
    layout,
    attacker: {
      name: city.cityName,
      color: 0x3a78c8,
      units,
      route: e.route,
      target: e.target,
      stance: e.stance,
      readiness: city.readiness,
      ...(city.mods ? { mods: city.mods } : {}),
    },
    defender: { name: n.name, color: n.colour },
    orders: [],
    // A friend away when the raid comes takes half the damage (M36), as its own sim will hold it to.
    caps: n.absent
      ? { maxCollapse: SKIRMISH.awayCollapse, maxWreck: SKIRMISH.awayWreck }
      : superweapon && n.slot === null
        ? { ...SUPER.caps }
        : { maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck },
  });
}

/** What the city hears of a fought expedition. */
export function awayResult(input: BattleInput, b: Battle): AwayResult {
  const r = b.result();
  let theirLost = 0;
  let theirStrength = 0;
  for (const u of r.units) {
    if (u.side !== 1) continue;
    const s = UNIT.get(u.kind)?.strength ?? 1;
    theirStrength += s;
    if (u.out) theirLost += s;
  }
  const guns = new Set<number>();
  const L = input.layout;
  for (let k = 0; k < L.structs.length / S.stride; k++)
    if (L.structs[k * S.stride + S.gun]! > 0) guns.add(L.structs[k * S.stride + S.id]!);
  return {
    outcome: r.outcome,
    units: r.units.filter((u) => u.side === 0).map((u) => ({ id: u.id, hp: u.hp, out: u.out })),
    theirLost,
    theirStrength,
    defencesLost: r.destroyed.filter((id) => guns.has(id)).length,
    destroyed: r.destroyed.length,
    damaged: r.damaged.length,
    objectives: r.objectives,
    hash: r.hash,
  };
}
