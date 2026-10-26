/**
 * Battles (phase 5, M35): what goes into one and what comes out. A battle is a simulation of its
 * own: given the same input it plays out the same on every machine and in every browser, and its
 * result reaches the defending city as commands to that city's own sim. DESIGN.md §3.29.
 */
import type { BattleRoute, BattleTarget, Stance } from '../../data/battle';
import type { UnitKind } from '../../data/war';

/** Bumped whenever the same input could play out differently. */
export const BATTLE_VERSION = 1;

export type Side = 0 | 1; // attacker, defender

/** What a structure is, as bits. */
export const TAG = {
  home: 1,
  job: 2,
  industry: 4,
  power: 8,
  military: 16,
  defence: 32,
  shelter: 64,
  hq: 128,
  base: 256,
  civic: 512,
} as const;

/** Domains a gun fires at, as bits. */
export const DOMAIN_BIT = { land: 1, air: 2, sea: 4 } as const;

/** Packed numbers per structure in `BattleLayout.structs`. */
export const S = {
  id: 0,
  tags: 1,
  x: 2,
  z: 3,
  /** Half its footprint's longer and shorter sides (m). */
  r: 4,
  rIn: 5,
  hp: 6,
  /** The road it stands by (an index into `edges`, or −1) and how far along it (m). */
  edge: 7,
  at: 8,
  /** A defence's gun: strength (0 for none), reach (m) and the domains it fires at (bits); and the
   * share of its posts manned. */
  gun: 9,
  range: 10,
  against: 11,
  manned: 12,
  /** The road segment it fronts in the city (for craters), or −1. */
  seg: 13,
  stride: 14,
} as const;

/** Packed numbers per road in `BattleLayout.edges`. */
export const E = { a: 0, b: 1, len: 2, pt: 3, n: 4, seg: 5, stride: 6 } as const;

/** Terrain classes in `BattleLayout.grid.cells`. */
export const CELL_LAND = 0;
export const CELL_STEEP = 1;
export const CELL_SHALLOW = 2;
export const CELL_DEEP = 3;

/** Where a force comes into the city, by route. */
export interface BattleEntry {
  route: BattleRoute;
  x: number;
  z: number;
  /** The road it arrives on (land routes), or −1. */
  edge: number;
  at: number;
}

/** A unit as it goes in: where it stands (a defender's base) and its health (0–1). */
export interface BattleUnitIn {
  id: number;
  kind: UnitKind;
  hp: number;
  x: number;
  z: number;
  /** The structure it's based at (defenders), or −1. */
  base: number;
}

/**
 * The defending city as a battle sees it, frozen when the battle starts: the roads (nodes, and
 * edges with points every few metres), the structures near what matters, a terrain grid, the
 * ways in, and the defenders' units. Everything in id order, so the same city gives the same
 * picture on every machine.
 */
export interface BattleLayout {
  v: number;
  city: string;
  tick: number;
  box: [number, number, number, number];
  nodes: number[];
  edges: number[];
  pts: number[];
  structs: number[];
  /** Names of the city buildings among the structures, for reports. */
  names: [number, string][];
  grid: { x0: number; z0: number; nx: number; nz: number; cells: number[] };
  entries: BattleEntry[];
  defenders: BattleUnitIn[];
  readiness: number;
}

/** A force going in. */
export interface ForceIn {
  name: string;
  color: number;
  units: BattleUnitIn[];
  route: BattleRoute;
  target: BattleTarget;
  stance: Stance;
  readiness: number;
}

/** An order given during a battle (M39 adds live orders; M35 has none). */
export interface BattleOrder {
  step: number;
  side: Side;
  kind: 'withdraw';
}

export interface BattleInput {
  v: number;
  id: string;
  seed: string;
  scale: 'skirmish';
  layout: BattleLayout;
  attacker: ForceIn;
  defender: { name: string; color: number };
  orders: BattleOrder[];
  caps: { maxCollapse: number; maxWreck: number };
}

export type Outcome = 'raided' | 'repelled' | 'withdrew';

/** What happens, as it happens: the city turns these into damage. */
export type BattleEvent =
  /** A structure under `fireBelow` of its strength: a home or business burns, a city building closes. */
  | { k: 'damaged'; s: number }
  /** A structure knocked down: rubble, or a city building wrecked. */
  | { k: 'destroyed'; s: number }
  /** A road cratered (the city's segment id). */
  | { k: 'crater'; seg: number }
  /** A unit knocked out (a puff of smoke and a wreck), or gone off the map. */
  | { k: 'out'; side: Side; unit: number; kind: UnitKind }
  | { k: 'left'; side: Side; unit: number }
  | { k: 'end'; outcome: Outcome };

export interface BattleResult {
  outcome: Outcome;
  steps: number;
  hash: string;
  /** Every unit that went in: its health after (0 when knocked out), and whether it's out. */
  units: { side: Side; id: number; kind: UnitKind; hp: number; out: boolean }[];
  damaged: number[];
  destroyed: number[];
  craters: number[];
  /** Objectives knocked down, of those aimed at. */
  objectives: { aimed: number; down: number };
}

/** A unit as drawn: where it is and what it's doing (frames for the renderer). */
export interface BattleUnitView {
  id: number;
  kind: UnitKind;
  side: Side;
  x: number;
  z: number;
  /** Height above the ground (aircraft), facing, and its turret's turn from the body. */
  y: number;
  yaw: number;
  aim: number;
  hp: number;
  /** 0 moving, 1 firing or holding, 2 knocked out (a wreck where it stopped). */
  state: 0 | 1 | 2;
}

/** A shot fired this tick, for tracers and shell arcs; `kind` 0 gun, 1 shell, 2 flak. */
export interface BattleShot {
  x0: number;
  z0: number;
  y0: number;
  x1: number;
  z1: number;
  y1: number;
  kind: 0 | 1 | 2;
  hit: boolean;
}

/** The battle on screen this tick. */
export interface BattleFrame {
  id: string;
  step: number;
  maxSteps: number;
  units: BattleUnitView[];
  shots: BattleShot[];
  sides: { name: string; color: number; alive: number; total: number }[];
  /** Structures aimed at, with their health (0–1). */
  targets: { id: number; x: number; z: number; hp: number }[];
  outcome: Outcome | null;
}
