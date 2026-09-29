import type { WeatherIntensity, WeatherKind } from '../data/climate';
import type { DealDirection, DealResource } from '../data/region';
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
  /** Add a module (extra engines, beds, classrooms, buses...) to a civic building. */
  | { type: 'addModule'; civic: number; module: string };

export type CommandType = Command['type'];

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
}

export const ok = (cost = 0, extra: Partial<CommandOk> = {}): CommandOk => ({ ok: true, cost, ...extra });
export const fail = (reason: string, extra: Partial<CommandErr> = {}): CommandErr => ({
  ok: false,
  reason,
  ...extra,
});
