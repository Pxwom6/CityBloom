import type { WeatherIntensity, WeatherKind } from '../data/climate';
import type { DealDirection, DealResource } from '../data/region';
import type { Branch, DomeMode, TierKey } from '../data/research';
import type { SabotageTarget, SpyOp } from '../data/intel';
import type { PromiseId } from '../data/elections';
import type { RoadTypeId } from '../data/roads';
import type { ZoneLetter } from '../data/zones';
import type { Vec2 } from './geom';
import type { Dept } from '../data/economy';
import type { DisasterKind } from './systems/disasters';
import type { PolicyId } from '../data/policies';
import type { TerraformMode } from '../data/terraform';
import type { MapBrush } from '../data/mapEditor';
import type { ClimateId } from '../data/climate';
import type { BattleRoute, BattleTarget, Stance } from '../data/battle';
import type { AwayResult } from './systems/expeditions';
import type { BattleInput } from './battle/types';
import type { RegionUpdate } from './systems/region';
import type { Dossier, MissionOutcome, OpInput } from './systems/regionOps';
import type { UnitKind } from '../data/war';
import type { DeclaredScale, Term } from '../data/diplomacy';

export type ZoneArea = { kind: 'brush'; points: Vec2[]; radius: number } | { kind: 'segment'; id: number };
export type BulldozeTarget =
  | { kind: 'segment'; id: number }
  | { kind: 'building'; id: number }
  | { kind: 'civic'; id: number }
  | { kind: 'stop'; id: number };

/** Every player (and test, debug, replay) action is one of these. DESIGN.md §1.4. */
export type Command =
  | { type: 'cheat'; cheat: 'addMoney'; amount: number }
  | { type: 'renameCity'; name: string }
  /** points = [a, c, b, c, b, ...] (anchors and quadratic control points) or [a, b] for a straight road. */
  /** `oneway`: the new road runs one way, as drawn (M19). */
  | { type: 'buildRoad'; road: RoadTypeId; points: Vec2[]; oneway?: boolean }
  | { type: 'bulldoze'; target: BulldozeTarget }
  /** Place a bus stop beside the road nearest (x, z), or a tram stop on a road with tram track (M20). */
  | { type: 'placeStop'; x: number; z: number; tram?: boolean }
  /** Change a road segment to another type in place. */
  | { type: 'upgradeRoad'; seg: number; road: RoadTypeId }
  /** Make a road one-way (1: from its start to its end, -1: the other way) or two-way (0) (M19). */
  | { type: 'setOneWay'; seg: number; dir: 0 | 1 | -1 }
  /** Lay (`on`) or take up tram track along a road (M20); `stroke` groups a drag into one undo step. */
  | { type: 'setTram'; seg: number; on: boolean; stroke?: number }
  /** A roundabout on a junction (`node`) or a road (`at`), with the ring's radius (M19). */
  | { type: 'roundabout'; node?: number; at?: Vec2; radius?: number }
  | { type: 'removeRoundabout'; node: number }
  /** `stroke` groups several paint commands from one drag into a single undo step. */
  | { type: 'zone'; zone: ZoneLetter | 'none'; area: ZoneArea; stroke?: number }
  /** Take back the last action, or put back the last one taken back (M14). */
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'setTax'; zone: 'R' | 'C' | 'I'; wealth: 0 | 1 | 2 | 'all'; rate: number }
  | { type: 'setFunding'; dept: Dept; pct: number }
  | { type: 'takeLoan'; amount: number }
  /** Elections (M17): make or withdraw a campaign promise. */
  | { type: 'promise'; promise: PromiseId; on: boolean }
  | { type: 'repayLoan'; id: number }
  /** Place a civic building: centre, road tangent angle and which side of the road it stands on. */
  | { type: 'placeBuilding'; def: string; x: number; z: number; angle: number; side: 1 | -1 }
  | { type: 'cheat'; cheat: 'unlockAll' }
  /** Start a fire in a building (debug panel, tests). */
  | { type: 'cheat'; cheat: 'ignite'; id: number }
  /** Test mode only: bring the next vote to `months` months away (e2e). */
  | { type: 'cheat'; cheat: 'electionIn'; months: number }
  /** Test mode: take the regional rail link away, as an old city whose edge was full had none. */
  | { type: 'cheat'; cheat: 'removeRailLink' }
  /**
   * Test mode only (M35): a computer neighbour (the first rival, or `neighbour`) sets off to raid the
   * city now, arriving in `hours` (0: the battle begins at once).
   */
  | {
      type: 'cheat';
      cheat: 'raidIn';
      hours: number;
      neighbour?: number;
      seat?: boolean;
      /** M37: the raiders themselves (a heavy battle staged for measuring), 24 at most. */
      units?: UnitKind[];
    }
  /** Test mode (M36): a computer neighbour puts these terms to the city. */
  | { type: 'cheat'; cheat: 'proposal'; neighbour: number; terms: Term[] }
  /** Test mode (M36): the city falls to a computer neighbour at once. */
  | { type: 'cheat'; cheat: 'fall'; neighbour: number }
  /** Test mode (M36): friends may raid the city though it's a newcomer. */
  | { type: 'cheat'; cheat: 'unshield' }
  /** Test mode (M37): research points poured into the queue, or tiers done at once (scripted tests). */
  | { type: 'cheat'; cheat: 'researchPoints'; points: number }
  | { type: 'cheat'; cheat: 'research'; tiers: TierKey[] }
  /** Test mode (M37): every superweapon wound up at once, and the superweapon buildings charged. */
  | { type: 'cheat'; cheat: 'superReady' }
  /** Test mode (M37): a project building's stages done at once. */
  | { type: 'cheat'; cheat: 'finishStages'; civic: number }
  /** Test mode (M37): a computer neighbour's spy arrives now; a computer neighbour's tech set. */
  | { type: 'cheat'; cheat: 'spyIn'; neighbour: number; op: SpyOp; target?: SabotageTarget }
  | { type: 'cheat'; cheat: 'rivalTech'; neighbour: number; tech: number }
  /** Test mode only (M35): set a computer neighbour's forces and defences (e2e battles to win). */
  | { type: 'cheat'; cheat: 'rival'; neighbour: number; forces: number; defences: number }
  /** Start a disaster at a point (the disasters menu). `size` and `heading` are for tests. */
  | { type: 'disaster'; kind: DisasterKind; at: Vec2; size?: number; heading?: number }
  /** Random disasters on or off. */
  | { type: 'setDisasters'; on: boolean }
  /** Seasons on or off and how wild the weather is (M22). */
  | { type: 'setWeather'; seasons?: boolean; intensity?: WeatherIntensity }
  /** Sign, change or end (amount 0) a deal with a neighbouring town (M23). */
  | { type: 'setDeal'; neighbour: number; resource: DealResource; direction: DealDirection; amount: number }
  /** Test mode only: set the weather now for `hours` (e2e and dev scenes). */
  | { type: 'cheat'; cheat: 'weather'; kind: WeatherKind; strength: number; hours: number }
  | { type: 'setElections'; on: boolean }
  /** Begin a scenario (M18) on the loaded starting city. */
  | { type: 'startScenario'; id: string }
  /** Enact or repeal a policy. */
  | { type: 'setPolicy'; id: PolicyId; on: boolean }
  /** Pick up a civic building and put it down elsewhere, keeping its add-ons (M14). */
  | { type: 'moveBuilding'; id: number; x: number; z: number; angle: number; side: 1 | -1 }
  /** Districts (M21): name a new one; paint (0 erases) with a brush, a drag as one undo step. */
  | { type: 'createDistrict'; name: string }
  | {
      type: 'paintDistrict';
      district: number;
      area: { kind: 'brush'; points: Vec2[]; radius: number };
      stroke?: number;
    }
  | { type: 'renameDistrict'; district: number; name: string }
  | { type: 'removeDistrict'; district: number }
  /** Put a policy in force in one district, or lift it (M21). */
  | { type: 'setDistrictPolicy'; district: number; policy: PolicyId; on: boolean }
  /**
   * A regional rail link for a city without one (Phase 2 review): the mainline link coming in at
   * `z` on the west edge, with its junction building.
   */
  | { type: 'buildRailLink'; z: number }
  /**
   * Terraforming (M24): raise, lower, level (to `level` metres) or smooth the ground with a round
   * brush along `points`; `stroke` groups a drag into one undo step.
   */
  | {
      type: 'terraform';
      mode: TerraformMode;
      points: Vec2[];
      radius: number;
      level?: number;
      stroke?: number;
    }
  /**
   * The map editor (M24): a brush along `points` (sculpt, water, forests, ore and oil); `level` is
   * the height the level brush flattens to; `stroke` groups a drag into one undo step.
   */
  | {
      type: 'editMap';
      brush: MapBrush;
      points: Vec2[];
      radius: number;
      strength?: number;
      level?: number;
      stroke?: number;
    }
  /** Where the highway or railway comes in on the map's west edge (null: no railway). */
  | { type: 'setMapEntry'; entry: 'highway' | 'rail'; z: number | null }
  | { type: 'setMapInfo'; name?: string; climate?: ClimateId }
  /**
   * A shared region's news (M32): the other cities in the neighbours' places, the deals they signed
   * with this city, and the region project's progress. Sent by the page from the region room.
   */
  | { type: 'regionUpdate'; update: RegionUpdate }
  /** Pay into the shared region's project (M32). */
  | { type: 'contributeProject'; amount: number }
  /** Add a module (extra engines, beds, classrooms, buses...) to a civic building. */
  | { type: 'addModule'; civic: number; module: string }
  /** War (M34): train a unit at a military building, call training off, or stand a unit down. */
  | { type: 'trainUnit'; base: number; kind: UnitKind }
  /** Battles (M35): send a force to raid a neighbour, or call it back before it arrives. */
  | {
      type: 'sendForce';
      units: number[];
      to: number;
      route: BattleRoute;
      target: BattleTarget;
      stance: Stance;
      /** Send it even though it breaks a pact (M36; the page asks first). */
      breakPact?: boolean;
      /** Through the express gate (M37): there in an hour. */
      gate?: boolean;
    }
  | { type: 'recallForce'; expedition: number }
  /** The page's account of an expedition's battle, fought in the other town (page only). */
  | { type: 'battleReport'; expedition: number; result: AwayResult }
  /** A force's battle with a friend's city is with the region: pinned until it answers (page only, M36). */
  | { type: 'battleSettling'; expedition: number; on: boolean }
  /** Host a battle fought elsewhere: watch it play out, or take its result at once (page only). */
  | {
      type: 'battleResolve';
      input: BattleInput;
      mode: 'watch' | 'instant';
      replay?: string;
      /** A friend's city that fought it (its place in the region), and whether the player was away (M36). */
      from?: number;
      away?: boolean;
      /** The region flagged it as bringing a superweapon, and counted it so (M37). */
      super?: boolean;
    }
  | { type: 'cancelTraining'; order: number }
  | { type: 'disbandUnit'; unit: number }
  /** War bonds (M34): borrow from the residents, or pay one off early. */
  | { type: 'issueBond'; amount: number }
  | { type: 'repayBond'; id: number }
  /**
   * Diplomacy (M36): declare war on a computer neighbour, put terms to it or answer its own, take a
   * proposal back, end a pact, buy an occupied district back, or stand neutral.
   */
  | { type: 'declareWar'; neighbour: number; scale: DeclaredScale; reason: string; breakPact?: boolean }
  | { type: 'propose'; neighbour: number; terms: Term[]; counters?: number }
  | { type: 'answerProposal'; proposal: number; accept: boolean }
  | { type: 'withdrawProposal'; proposal: number }
  | { type: 'endPact'; pact: number; breakPact?: boolean }
  | { type: 'buyBack'; pact: number }
  | { type: 'setNeutral'; on: boolean }
  /** Weapons research (M37): put a tier in the labs' queue, or take it out. */
  | { type: 'queueResearch'; key: TierKey }
  | { type: 'unqueueResearch'; key: TierKey }
  /** A prototype's trial at a proving ground (M37), or calling it off. */
  | { type: 'startTrial'; ground: number; kind: UnitKind }
  | { type: 'stopTrial'; ground: number }
  /** The superweapon buildings (M37): the dome's mode, and the blackout tower aimed at a rival. */
  | { type: 'setDome'; mode: DomeMode }
  | { type: 'useBlackout'; neighbour: number; breakPact?: boolean }
  /** Send an agent (M37): look round a rival, sabotage its power or depot, or steal its research. */
  | {
      type: 'spyMission';
      neighbour: number;
      op: SpyOp;
      target?: SabotageTarget;
      branch?: Branch;
      breakPact?: boolean;
    }
  /**
   * Operations between friends (M37, page only): an operation of the city's pinned while the region
   * decides on it, the region's verdict on it, an operation against the city as the region decided
   * it, and the cap the region's fair clock puts on the war clock.
   */
  | { type: 'spySettling'; mission: number; on: boolean }
  | {
      type: 'missionResult';
      mission: number;
      outcome: MissionOutcome;
      stole?: TierKey;
      dossier?: Dossier;
      reason?: string;
    }
  | ({ type: 'opResolve' } & OpInput)
  | { type: 'warClock'; cap: number | null };

export type CommandType = Command['type'];

/**
 * Every command type, written out so the compiler checks the list against `Command`: a new type
 * fails to compile until it's added here (and to the room's checks in `commandCheck.ts`).
 */
const COMMAND_KINDS = {
  cheat: true,
  renameCity: true,
  buildRoad: true,
  bulldoze: true,
  placeStop: true,
  upgradeRoad: true,
  setOneWay: true,
  setTram: true,
  roundabout: true,
  removeRoundabout: true,
  zone: true,
  undo: true,
  redo: true,
  setTax: true,
  setFunding: true,
  takeLoan: true,
  promise: true,
  repayLoan: true,
  placeBuilding: true,
  disaster: true,
  setDisasters: true,
  setWeather: true,
  setDeal: true,
  setElections: true,
  startScenario: true,
  setPolicy: true,
  moveBuilding: true,
  createDistrict: true,
  paintDistrict: true,
  renameDistrict: true,
  removeDistrict: true,
  setDistrictPolicy: true,
  buildRailLink: true,
  terraform: true,
  editMap: true,
  setMapEntry: true,
  setMapInfo: true,
  regionUpdate: true,
  contributeProject: true,
  addModule: true,
  trainUnit: true,
  sendForce: true,
  recallForce: true,
  battleReport: true,
  battleSettling: true,
  battleResolve: true,
  cancelTraining: true,
  disbandUnit: true,
  issueBond: true,
  repayBond: true,
  declareWar: true,
  propose: true,
  answerProposal: true,
  withdrawProposal: true,
  endPact: true,
  buyBack: true,
  setNeutral: true,
  queueResearch: true,
  unqueueResearch: true,
  startTrial: true,
  stopTrial: true,
  setDome: true,
  useBlackout: true,
  spyMission: true,
  spySettling: true,
  missionResult: true,
  opResolve: true,
  warClock: true,
} as const satisfies Record<CommandType, true>;

export const COMMAND_TYPES = Object.keys(COMMAND_KINDS) as CommandType[];

export interface CommandOk {
  ok: true;
  cost: number;
  /** Ids of anything created, for undo and for callers that need them. */
  created?: number[];
  info?: Record<string, unknown>;
}
export interface CommandErr {
  ok: false;
  reason: string;
  at?: Vec2;
  info?: Record<string, unknown>;
}
export type CommandResult = CommandOk | CommandErr;

export interface CommandLogEntry {
  tick: number;
  cmd: Command;
  /** The player who issued it, in a shared city (M29); absent for player 0. */
  by?: number;
}

export const ok = (cost = 0, extra: Partial<CommandOk> = {}): CommandOk => ({ ok: true, cost, ...extra });
export const fail = (reason: string, extra: Partial<CommandErr> = {}): CommandErr => ({
  ok: false,
  reason,
  ...extra,
});
