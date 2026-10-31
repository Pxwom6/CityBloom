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
  /** Roads cratered at most (each closed for `WAR_DAMAGE.roadHours`). */
  maxCraters: 12,
  /** A raid on a friend whose player was away (M36): about half the damage. */
  awayCollapse: 6,
  awayWreck: 1,
} as const;

/** A force that has arrived and heard nothing of its battle (the page never fought it) comes home. */
export const FIGHT_TIMEOUT_HOURS = 72;
/**
 * A force whose battle with a friend's city is with the region (M36) waits for the region's answer
 * this long at most (30 game days: at the top speed about half an hour), then comes home.
 */
export const SETTLE_TIMEOUT_HOURS = 720;

/** Computer neighbours' raids (M35): when they come, how big, and what they strike. */
export const RAIDS = {
  /** Computer neighbours decide to raid on their own (the `raidIn` cheat brings one on in tests). */
  decide: true,
  /**
   * No raids on a city under this many residents or younger than this many months, unless it struck
   * a neighbour within `retaliate` months: that neighbour may answer.
   */
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
export const TOWN = { cap: 8_000, testCap: 1_500, version: 1 } as const;

/**
 * Battles, version 3 (M37): research's modifiers, as a battle accepts them. A domain's units take
 * hit points and attack multiplied (1–2), armour and evasion added (0–0.3, 0–0.5), and no unit's
 * armour goes above `armourMax`. A battle from outside with numbers beyond these is refused.
 */
export const BATTLE_MOD = {
  hp: [1, 2],
  attack: [1, 2],
  armour: [0, 0.3],
  evade: [0, 0.5],
  armourMax: 0.8,
} as const;

/**
 * Superweapons in battle (M37). A superweapon battle in a computer neighbour's town may knock down
 * more than a skirmish (`caps`; only the score and its forces carry over to the city); against a
 * friend the skirmish caps stand. Either way, once the caps leave none of its objectives able to
 * fall, a force that brought a superweapon pulls out. The robot leaves the road this close to its
 * objective (m, in a straight line) and walks there; the sky fortress launches what it carries this
 * close to its objective; a battle takes this many carried units at most, beyond
 * `BATTLE.maxAttackers`, with ids −(`carriedId` + k).
 */
export const SUPER = {
  caps: { maxCollapse: 24, maxWreck: 5 },
  free: 500,
  launch: 600,
  maxCarried: 16,
  carriedId: 1000,
} as const;

/**
 * Interceptor batteries (M37) stop heavy shots (siege ≥ 1) aimed at buildings: shells fired from at
 * least this far (m), and bombs dropped from the air. Their reach, chance and cooldown are the
 * battery's own (`MilitaryInfo.intercept`).
 */
export const INTERCEPT = { from: 150 } as const;
