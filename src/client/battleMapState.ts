/**
 * What the battle map remembers between its pictures (M39, design call 6): the units chosen, the order
 * waiting for its target, how far it is zoomed, and what it last told the player. A plain object on
 * the `Game`, so the panel, the keyboard and the test API all see the same thing.
 */
import type { BattleFrame } from '../sim/battle/types';
import type { OrderChoice } from '../ui/battleMapView';

export class BattleMapState {
  /** The battle these belong to (a new battle starts afresh). */
  battleId: string | null = null;
  selected: number[] = [];
  /** The whole side is chosen (the All button), including units not on the map yet. */
  all = false;
  armed: OrderChoice | null = null;
  zoom = 1;
  centre: { x: number; z: number } | null = null;
  /** What the map last said about an order (a problem with it, or that it was sent). */
  note: string | null = null;
  /** The canvas as drawn (test API). */
  canvas = { w: 0, h: 0 };
  /** The last picture of the battle the map was given, kept for after the battle is gone from the city. */
  lastFrame: BattleFrame | null = null;
  /** The step this page has been held at the room's frontier since (ms), for "waiting for …". */
  heldSince: number | null = null;

  /** Start afresh for a battle (or keep what is there if it is the same one). */
  forBattle(id: string | null): void {
    if (this.battleId === id) return;
    this.battleId = id;
    this.selected = [];
    this.all = false;
    this.armed = null;
    this.zoom = 1;
    this.centre = null;
    this.note = null;
    this.lastFrame = null;
    this.heldSince = null;
  }
}
