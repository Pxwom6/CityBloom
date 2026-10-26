/**
 * Battles (phase 5, M35): the numbers a battle runs on. A battle is a simulation of its own
 * (src/sim/battle), fed by a frozen picture of the defending city, both forces and the players'
 * orders; its result reaches the city as commands. DESIGN.md §3.29, docs/DECISIONS.md "M35".
 */
import type { UnitKind } from './war';

export type BattleRoute = 'highway' | 'rail' | 'sea' | 'air';
export type BattleTarget = 'military' | 'industry' | 'power' | 'cityhall';
export type Stance = 'cautious' | 'bold';

export const BATTLE = {
  /** Game seconds a battle step stands for, and steps per city tick (a game minute). */
  dt: 0.5,
  stepsPerTick: 2,
  /** The longest a battle runs (steps): then the attackers pull out. */
  maxSteps: 1_440,
  /** Most units an attacking force may bring, defending units that take part, manned defences. */
  maxAttackers: 24,
  maxDefenders: 64,
  maxDefences: 48,
  /** Structures in a battle's picture of the city, at most, and the margin round what matters (m). */
  maxStructs: 4_000,
  margin: 300,
  /** Roads are kept as points this far apart (m); terrain as a grid of cells this wide. */
  pointStep: 12,
  cell: 32,
  /** Units look for something to shoot every few steps, in a grid of this size (m). */
  targetEvery: 4,
  unitCell: 64,
  /** Most targets a force aims at at once. */
  maxTargets: 6,
  /** Defending units find the attackers again every so many steps. */
  interceptEvery: 30,
  /** Off the road, land units go this share of their road speed, and slower on a slope. */
  offRoad: 0.6,
  steep: 0.25,
  /** Infantry ride trucks (one per four squads) to this far from a target, then walk. */
  dismount: 250,
  squadsPerTruck: 4,
  /** A unit hugging a standing building (within this many m, the building between it and the
   * shooter) turns away this share of each hit. */
  coverRange: 12,
  cover: { infantry: 0.4, vehicle: 0.2 },
  /** Chance a shot hits, before readiness: by what fires it. */
  accuracy: { land: 0.75, air: 0.7, sea: 0.65, defence: 0.85 },
  /** A share of heavy hits (siege ≥ 1) leaves a crater in a road within this many m. */
  craterChance: 0.15,
  craterRange: 10,
  /** A building under this share of its strength catches fire (homes and businesses) or closes
   * for repairs (city buildings). */
  fireBelow: 0.6,
  /** Defences: strength × this per shot, a shot every `reload` s, hit points. */
  defence: { attackPer: 8, reload: 3, hp: 600 },
  /** Steps × (1 − readiness) before the defenders' units leave their bases. */
  reaction: 120,
  /** Share of a force's strength lost at which it pulls back, by stance. */
  withdraw: { cautious: 0.3, bold: 0.6 } as Record<Stance, number>,
  /** Air units fly at this height (m) by kind, and circle a target at this radius. */
  flyHeight: 60,
  circle: 150,
  /** Structures' strength: per m² of footprint, × (1 + level × 0.5); military and city buildings
   * are built stronger. */
  hpPerM2: 0.6,
  hpMin: 80,
  military: 2,
  civic: 1.5,
} as const;

/** City damage from a battle: hours a hit city building is closed, a cratered road, rubble. */
export const WAR_DAMAGE = {
  /** A hit city building closes for up to this many hours; one knocked out for this many. */
  civicHours: 48,
  wreckHours: 96,
  roadHours: 12,
} as const;

/** Travel between cities (game hours, before modifiers), by route. */
export const ROUTES: Record<BattleRoute, { hours: number; name: string }> = {
  highway: { hours: 6, name: 'By road' },
  rail: { hours: 4, name: 'By rail' },
  sea: { hours: 10, name: 'By sea' },
  air: { hours: 1.5, name: 'By air' },
};

/** Without trucks infantry walk (slower); with a truck per four squads they ride. */
export const TRAVEL = { walking: 1.4, riding: 0.8, northSouth: 1.2 } as const;

/** Warning a city gets of a force on its way: an hour, and three more per working radar. */
export const WARNING = { base: 1, perRadar: 3, max: 6 } as const;

/** Skirmishes (M35's only scale): what they may strike, and how far in from the border. */
export const SKIRMISH = {
  targets: ['military', 'industry', 'power'] as BattleTarget[],
  /** Industry and power targets must lie this close to the force's way in (m). */
  border: 600,
  /** In a skirmish nothing changes hands, and no more than this many buildings fall. */
  maxCollapse: 12,
  maxWreck: 3,
} as const;

/** Computer neighbours' raids (M35): when they come, how big, and what they strike. */
export const RAIDS = {
  /**
   * Computer neighbours decide to raid on their own. Off until M35's battle view and war room land
   * (raids are tested through the `raidIn` cheat meanwhile), so a war city never meets a battle it
   * can't see.
   */
  decide: false,
  /** No raids on a city under this many residents or younger than this many months. */
  minPopulation: 3_000,
  minMonths: 12,
  /** Months between one neighbour's raids, and between any two. */
  gapEach: 6,
  gapAny: 2,
  /** A raid's chance an hour: aggression × strength ratio (capped) ÷ this. */
  perHour: 150,
  ratioCap: 2,
  /** Relations below `hostile` double it, above `friendly` quarter it; within `retaliate` months
   * of the player's own raid on it, four times. */
  hostile: -25,
  friendly: 25,
  retaliate: 3,
  /** A raid takes this share of the neighbour's forces (by personality, 0.3–0.5). */
  share: 0.4,
  /** A raided neighbour's relation drops this much. */
  relationHit: 20,
} as const;

/** What a computer neighbour's forces are made of, by personality (weights by kind). */
export const RIVAL_MIX: Record<string, Partial<Record<UnitKind, number>>> = {
  aggressive: { tank: 4, artillery: 2, infantry: 3, transport: 1 },
  cautious: { infantry: 4, artillery: 3, transport: 1 },
  mercantile: { drone: 4, infantry: 3, transport: 1 },
  honourable: { infantry: 3, tank: 2, artillery: 1, helicopter: 1, transport: 1 },
  treacherous: { helicopter: 3, drone: 3, tank: 2 },
};

/** What each personality raids. */
export const RIVAL_TARGET: Record<string, BattleTarget> = {
  aggressive: 'military',
  cautious: 'military',
  mercantile: 'industry',
  honourable: 'military',
  treacherous: 'power',
};

/** Computer neighbours' towns: grown from their seed by the balance mayor, at most this big. */
export const TOWN = { cap: 12_000, testCap: 1_500, version: 1 } as const;
