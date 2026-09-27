import type { PromiseId } from '../data/elections';
import type { RoadTypeId } from '../data/roads';
import type { ZoneLetter } from '../data/zones';
import type { Vec2 } from './geom';
import type { Dept } from '../data/economy';
import type { DisasterKind } from './systems/disasters';
import type { PolicyId } from '../data/policies';

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
  | { type: 'buildRoad'; road: RoadTypeId; points: Vec2[] }
  | { type: 'bulldoze'; target: BulldozeTarget }
  /** Place a bus stop beside the road nearest (x, z). */
  | { type: 'placeStop'; x: number; z: number }
  /** Change a road segment to another type in place. */
  | { type: 'upgradeRoad'; seg: number; road: RoadTypeId }
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
  /** Start a disaster at a point (the disasters menu). `size` and `heading` are for tests. */
  | { type: 'disaster'; kind: DisasterKind; at: Vec2; size?: number; heading?: number }
  /** Random disasters on or off. */
  | { type: 'setDisasters'; on: boolean }
  /** Enact or repeal a policy. */
  | { type: 'setPolicy'; id: PolicyId; on: boolean }
  /** Pick up a civic building and put it down elsewhere, keeping its add-ons (M14). */
  | { type: 'moveBuilding'; id: number; x: number; z: number; angle: number; side: 1 | -1 }
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
