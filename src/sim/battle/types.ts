/**
 * Battles (phase 5, M35): what goes into one and what comes out. A battle is a simulation of its
 * own: given the same input it plays out the same on every machine and in every browser, and its
 * result reaches the defending city as commands to that city's own sim. DESIGN.md §3.29.
 */
import type { BattleRoute, BattleTarget, Stance } from '../../data/battle';
import type { BattleMod } from '../../data/research';
import type { UnitDomain, UnitKind } from '../../data/war';

/**
 * Bumped whenever the same input could play out differently. Version 3 (M37) adds research's
 * modifiers, interceptors, the dome's pool and the superweapons, every one an optional field whose
 * code runs only when it's there; version 2 (M35–M36) is still read, and a battle using nothing of
 * version 3 is stamped 2 (`stampBattle`), so it plays and saves exactly as it did.
 *
 * `BATTLE_VERSION` stays the version 3 of M37: every builder starts its input there and
 * `stampBattle` settles the version the input needs (2, 3 or 4). The newest this build reads is
 * `BATTLE_V4`.
 */
export const BATTLE_VERSION = 3;
/** The oldest version still read. */
export const BATTLE_V2 = 2;
/**
 * Version 4 (M39, war with friends): orders given while a battle runs (focus, guard, hold, free and
 * a withdrawal by units) and helpers (allied forces that join at a step, each with its owner). An
 * input is stamped 4 only when it uses one of them; whatever doesn't plays and hashes as ever.
 */
export const BATTLE_V4 = 4;

/**
 * Who a unit belongs to (version 4): the force in `attacker` is owner 0, the defender's own units
 * (`layout.defenders`) owner −1, and each helper brings its own owner (1–255: the caller picks, say
 * the helper city's place in the region plus one).
 */
export const OWNER_ATTACKER = 0;
export const OWNER_DEFENDER = -1;

/** Research's battle modifiers by domain (M37). */
export type BattleMods = Partial<Record<UnitDomain, BattleMod>>;

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
  /** An interceptor battery (version 3: tags 0–2047). */
  intercept: 1024,
} as const;
/** Tags a structure may carry in a version 2 battle, and in version 3. */
export const TAGS_V2 = 1023;
export const TAGS_V3 = 2047;

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
  /** Version 3: the attacker (its id) that carries it in, launched near the objective (drones). */
  from?: number;
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
  /** Version 3: the defenders' research modifiers by domain. */
  mods?: BattleMods;
  /** Version 3: the dome shield's pool, raised over the city: hits on buildings land on it first. */
  dome?: number;
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
  /** Version 3: the attackers' research modifiers by domain. */
  mods?: BattleMods;
}

/** What an order may say (version 4 adds all but the first). */
export type OrderKind = 'withdraw' | 'focus' | 'guard' | 'hold' | 'free';

/**
 * An order given during a battle: it applies at the start of `step`, in input order. M35's is
 * `{step, side: 0, kind: 'withdraw'}` (the whole attacking side pulls out). Version 4 (M39):
 * `units` are the battle's own unit ids on that side (none: every unit of the side; a unit that's
 * dead or gone is skipped), and `target` is a structure's index in the layout (`focus` by the
 * attackers, `guard`) or an attacking unit's id (`focus` by the defenders). An order whose units
 * are gone or whose target has fallen does nothing. `focus` (side 0: the next objective of those
 * units; side 1: the defending units and every gun prefer that attacker when they choose),
 * `guard` (side 1: the units go to that structure and stay near it), `hold` (stop moving, only
 * fire), `free` (back to the battle's own judgement), `withdraw` (side 0: those units pull out;
 * with no `units`, all of them).
 */
export interface BattleOrder {
  step: number;
  side: Side;
  kind: OrderKind;
  units?: number[];
  target?: number;
}

/**
 * An allied force that joins a battle (version 4). On side 0 its units come in at `arrive` (a
 * step) by `route` (the attacking force's own when absent) like the attackers and fight as
 * attackers under their stance; on side 1 they come in at `arrive` at the city's way in nearest
 * `route` (the layout's first when absent) and fight as defenders. Its units' ids must not repeat
 * on their side's (the main force's, or `layout.defenders`'): the region room numbers them in a range
 * above any id a city's sim mints (`helpUnitId`, relay/protocol.ts), where it carries them in orders too.
 * No superweapons and nothing carried; `base` −1. A helper's units count with their side's
 * strength: an attacking helper's with the force's (the army withdraws as one, at the stance's
 * share lost, and a unit sent home by `withdraw` isn't counted lost); a defending one's with the
 * defence, which never withdraws. A helper may be added while the battle runs (`at`, the step it was
 * stamped at; `input.helpers` is read as the battle goes) and joins exactly as one given up front.
 */
export interface BattleHelper {
  /** 1–255, and not another helper's (0 is the attacking force, −1 the defender's own units). */
  owner: number;
  name: string;
  color: number;
  side: Side;
  units: BattleUnitIn[];
  arrive: number;
  route?: BattleRoute;
  /** Its own research's modifiers (the main force's don't pass to it). */
  mods?: BattleMods;
  /**
   * The step the helper was added at: a helper the region room stamps while the battle runs comes
   * with the frontier it was stamped at, and the battle takes it up when it reaches that step (its
   * units wait at the way in from then, as an up-front helper's wait from the start), so every page
   * that fights the battle takes it at the same step, whenever its entry reached the page. Absent:
   * from the start. `arrive` is never before it.
   */
  at?: number;
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
  /** Version 4: allied forces that join while the battle runs (at most three). */
  helpers?: BattleHelper[];
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
  /** A unit knocked out (a puff of smoke and a wreck), or gone off the map; an ally's (version 4's helper) says whose. */
  | { k: 'out'; side: Side; unit: number; kind: UnitKind; owner?: number }
  | { k: 'left'; side: Side; unit: number }
  /** Version 3: the dome's pool is spent (the dome pops). */
  | { k: 'dome'; left: 0 }
  | { k: 'end'; outcome: Outcome };

export interface BattleResult {
  outcome: Outcome;
  steps: number;
  hash: string;
  /**
   * Every unit that went in: its health after (0 when knocked out), and whether it's out. A
   * version 4 battle adds each unit's `owner` (`OWNER_ATTACKER`, `OWNER_DEFENDER` or a helper's),
   * so each owner's losses can be counted; a unit with no `owner` is its side's own (0 and −1).
   */
  units: { side: Side; id: number; kind: UnitKind; hp: number; out: boolean; owner?: number }[];
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
  /** 0 moving, 1 firing or holding, 2 knocked out (a wreck where it stopped), 3 dived (the whale,
   * under water: it can't be hit). */
  state: 0 | 1 | 2 | 3;
  /** Version 4: whose it is (as in `BattleResult.units`). */
  owner?: number;
}

/**
 * A shot fired this tick, for tracers and shell arcs; `kind` 0 gun, 1 shell, 2 flak, 3 a shell or
 * bomb stopped by an interceptor (it ends in a puff at x1, y1, z1, high over its target).
 */
export interface BattleShot {
  x0: number;
  z0: number;
  y0: number;
  x1: number;
  z1: number;
  y1: number;
  kind: 0 | 1 | 2 | 3;
  hit: boolean;
}

/** The battle on screen this tick. */
export interface BattleFrame {
  id: string;
  step: number;
  maxSteps: number;
  units: BattleUnitView[];
  /**
   * Version 4 (for the battle map): the defending units still mobilising at their bases (not in
   * `units` until they set off), so they can be ordered before they are on the road.
   */
  waiting?: BattleUnitView[];
  shots: BattleShot[];
  sides: { name: string; color: number; alive: number; total: number }[];
  /** Structures aimed at, with their health (0–1). */
  targets: { id: number; x: number; z: number; hp: number }[];
  /**
   * Every structure of the layout, one digit each in layout order (M39, for the battle map): 0
   * standing, 1 damaged (on fire, or closed for repairs), 2 fallen.
   */
  structs?: string;
  outcome: Outcome | null;
  /** Version 3: the dome's pool left (0–1), in a battle under a dome. */
  dome?: number;
  /** Version 4: the helpers, and how many of their units are still in it (on the way or fighting). */
  helpers?: {
    owner: number;
    name: string;
    color: number;
    side: Side;
    arrive: number;
    alive: number;
    total: number;
  }[];
}
