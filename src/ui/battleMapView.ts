/**
 * The battle map's arithmetic (M39, design call 6): where the battle's metres go on the canvas and
 * back, what a click or a dragged box lands on, and what an order button means for the units chosen.
 * Pure, so the map's behaviour is tested without a canvas; `battleMapDraw.ts` draws and
 * `BattleMap.tsx` is the panel round it.
 */
import { BATTLE } from '../data/battle';
import type { Game } from '../game';
import type { LiveView } from '../client/liveBattles';
import type { OrderRequest } from '../sim/battle/live';
import {
  E,
  S,
  TAG,
  type BattleFrame,
  type BattleLayout,
  type BattleUnitView,
  type Side,
} from '../sim/battle/types';

/** A rectangle of the battle's ground, in metres. */
export interface Bounds {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** The canvas's window on the ground: `px = (x − left) · scale`, `py = (z − top) · scale`. */
export interface MapView {
  scale: number;
  left: number;
  top: number;
  w: number;
  h: number;
}

/** How far in the map zooms (1 is the whole battle area in view). */
export const ZOOM = { min: 1, max: 6, step: 1.5 } as const;

/** Most unit ids an order names (the region room's limit, `LIVE.units`). */
export const ORDER_UNITS = 64;

/** The battle's area: the layout's box, and a way in just outside it, with a margin. */
export function mapBounds(layout: BattleLayout): Bounds {
  const [bx0, bz0, bx1, bz1] = layout.box;
  let x0 = bx0;
  let z0 = bz0;
  let x1 = bx1;
  let z1 = bz1;
  // A way in a little outside the box (an aircraft's, a ship's) is brought in; one far off is shown
  // at the edge instead (`edgeMark`).
  const reach = 160;
  for (const e of layout.entries) {
    if (e.x < bx0 - reach || e.x > bx1 + reach || e.z < bz0 - reach || e.z > bz1 + reach) continue;
    x0 = Math.min(x0, e.x);
    z0 = Math.min(z0, e.z);
    x1 = Math.max(x1, e.x);
    z1 = Math.max(z1, e.z);
  }
  // Never a sliver: at least 240 m each way, round the middle.
  const min = 240;
  if (x1 - x0 < min) {
    const c = (x0 + x1) / 2;
    x0 = c - min / 2;
    x1 = c + min / 2;
  }
  if (z1 - z0 < min) {
    const c = (z0 + z1) / 2;
    z0 = c - min / 2;
    z1 = c + min / 2;
  }
  const pad = 0.04;
  const px = (x1 - x0) * pad;
  const pz = (z1 - z0) * pad;
  return { x0: x0 - px, z0: z0 - pz, x1: x1 + px, z1: z1 + pz };
}

/** The view that shows `b` whole in a canvas of `w` × `h` pixels, zoomed `zoom` times about `centre`. */
export function fitView(
  b: Bounds,
  w: number,
  h: number,
  zoom = 1,
  centre: { x: number; z: number } | null = null,
): MapView {
  const bw = Math.max(1, b.x1 - b.x0);
  const bh = Math.max(1, b.z1 - b.z0);
  const base = Math.min(w / bw, h / bh);
  const z = Math.min(ZOOM.max, Math.max(ZOOM.min, zoom));
  const scale = base * z;
  // The centre stays where the view can reach: the area's own edges bound it.
  const viewW = w / scale;
  const viewH = h / scale;
  const cx = clampCentre(centre?.x ?? (b.x0 + b.x1) / 2, b.x0, b.x1, viewW);
  const cz = clampCentre(centre?.z ?? (b.z0 + b.z1) / 2, b.z0, b.z1, viewH);
  return { scale, left: cx - viewW / 2, top: cz - viewH / 2, w, h };
}

function clampCentre(c: number, lo: number, hi: number, view: number): number {
  // A view wider than the area sits in the area's middle.
  if (view >= hi - lo) return (lo + hi) / 2;
  return Math.min(hi - view / 2, Math.max(lo + view / 2, c));
}

export const toScreen = (v: MapView, x: number, z: number): { x: number; y: number } => ({
  x: (x - v.left) * v.scale,
  y: (z - v.top) * v.scale,
});

export const toWorld = (v: MapView, px: number, py: number): { x: number; z: number } => ({
  x: px / v.scale + v.left,
  z: py / v.scale + v.top,
});

/** The centre of a view, in metres. */
export const viewCentre = (v: MapView): { x: number; z: number } => toWorld(v, v.w / 2, v.h / 2);

/** One zoom button press: in (+1) or out (−1), kept within the zoom's range. */
export function zoomBy(zoom: number, dir: 1 | -1): number {
  const next = dir > 0 ? zoom * ZOOM.step : zoom / ZOOM.step;
  return Math.min(ZOOM.max, Math.max(ZOOM.min, Math.round(next * 100) / 100));
}

/**
 * Where a way in far outside the view is shown: on the canvas's edge, on the line from the middle
 * towards it. Null when the way in is on the canvas.
 */
export function edgeMark(
  v: MapView,
  x: number,
  z: number,
  inset = 14,
): { x: number; y: number; angle: number } | null {
  const p = toScreen(v, x, z);
  if (p.x >= 0 && p.x <= v.w && p.y >= 0 && p.y <= v.h) return null;
  const cx = v.w / 2;
  const cy = v.h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  const sx = dx === 0 ? Infinity : (cx - inset) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (cy - inset) / Math.abs(dy);
  const k = Math.min(sx, sy);
  return { x: cx + dx * k, y: cy + dy * k, angle: Math.atan2(dy, dx) };
}

// ----------------------------------------------------------------------------- structures

/** What a structure is, for its colour and mark (the strongest of its tags). */
export type StructKind =
  'hq' | 'base' | 'defence' | 'intercept' | 'power' | 'industry' | 'civic' | 'shelter' | 'job' | 'home';

export function structKind(tags: number): StructKind {
  if (tags & TAG.hq) return 'hq';
  if (tags & TAG.defence) return 'defence';
  if (tags & TAG.base || tags & TAG.military) return 'base';
  if (tags & TAG.intercept) return 'intercept';
  if (tags & TAG.power) return 'power';
  if (tags & TAG.industry) return 'industry';
  if (tags & TAG.civic) return 'civic';
  if (tags & TAG.shelter) return 'shelter';
  if (tags & TAG.job) return 'job';
  return 'home';
}

/** A structure of the layout, unpacked (the index is the one orders name). */
export interface MapStruct {
  k: number;
  id: number;
  kind: StructKind;
  x: number;
  z: number;
  /** Half its footprint's longer and shorter sides (m). */
  r: number;
  rIn: number;
  gun: boolean;
}

export function structsOf(layout: BattleLayout): MapStruct[] {
  const out: MapStruct[] = [];
  const n = Math.floor(layout.structs.length / S.stride);
  for (let k = 0; k < n; k++) {
    const o = k * S.stride;
    out.push({
      k,
      id: layout.structs[o + S.id]!,
      kind: structKind(layout.structs[o + S.tags]!),
      x: layout.structs[o + S.x]!,
      z: layout.structs[o + S.z]!,
      r: layout.structs[o + S.r]!,
      rIn: layout.structs[o + S.rIn]!,
      gun: layout.structs[o + S.gun]! > 0,
    });
  }
  return out;
}

/** How a structure stands: from the frame's digits (all standing before the first frame). */
export type StructState = 0 | 1 | 2;

export function structStates(frame: BattleFrame | null, count: number): StructState[] {
  const text = frame?.structs ?? '';
  const out: StructState[] = new Array(count);
  for (let k = 0; k < count; k++) {
    const c = text.charCodeAt(k) - 48;
    out[k] = c === 1 ? 1 : c === 2 ? 2 : 0;
  }
  return out;
}

/** The roads as polylines (in metres): one flat x, z list per edge. */
export function roadLines(layout: BattleLayout): number[][] {
  const out: number[][] = [];
  const n = Math.floor(layout.edges.length / E.stride);
  for (let e = 0; e < n; e++) {
    const o = e * E.stride;
    const start = layout.edges[o + E.pt]!;
    const count = layout.edges[o + E.n]!;
    const line: number[] = [];
    for (let k = 0; k < count; k++) line.push(layout.pts[(start + k) * 2]!, layout.pts[(start + k) * 2 + 1]!);
    out.push(line);
  }
  return out;
}

/** Half a structure's size on the canvas, never under a few pixels so it can be clicked. */
export function structRadiusPx(v: MapView, s: MapStruct, minPx = 3.5): number {
  return Math.max(minPx, ((s.r + s.rIn) / 2) * v.scale);
}

/**
 * The structure under a point, if any: the nearest whose mark the point is in (a few pixels of
 * slack). `standing` leaves out those that have fallen (an order's target).
 */
export function structAt(
  v: MapView,
  structs: readonly MapStruct[],
  states: readonly StructState[],
  px: number,
  py: number,
  slack = 4,
  standing = false,
): MapStruct | null {
  let best: MapStruct | null = null;
  let bestD = Infinity;
  for (const s of structs) {
    if (standing && states[s.k] === 2) continue;
    const p = toScreen(v, s.x, s.z);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d > structRadiusPx(v, s) + slack) continue;
    // Guns and objectives first when marks overlap; then the nearest.
    const weight = d - (s.gun ? 1.5 : 0);
    if (weight < bestD) {
      bestD = weight;
      best = s;
    }
  }
  return best;
}

// ----------------------------------------------------------------------------- units

/** A unit's mark is this many pixels across at least (a tap lands on it). */
export const UNIT_PX = 9;

/** Units in a frame that are still fighting (not knocked out). */
export const standingUnit = (u: BattleUnitView): boolean => u.state !== 2;

/** The unit under a point: the nearest within `radius` pixels (`slack` more). */
export function unitAt(
  v: MapView,
  units: readonly BattleUnitView[],
  px: number,
  py: number,
  keep: (u: BattleUnitView) => boolean = standingUnit,
  radius = UNIT_PX,
  slack = 5,
): BattleUnitView | null {
  let best: BattleUnitView | null = null;
  let bestD = radius + slack;
  for (const u of units) {
    if (!keep(u)) continue;
    const p = toScreen(v, u.x, u.z);
    const d = Math.hypot(p.x - px, p.y - py);
    if (d <= bestD) {
      bestD = d;
      best = u;
    }
  }
  return best;
}

/** The units whose marks are inside the box dragged from one corner to the other. */
export function unitsInBox(
  v: MapView,
  units: readonly BattleUnitView[],
  ax: number,
  ay: number,
  bx: number,
  by: number,
  keep: (u: BattleUnitView) => boolean = standingUnit,
): BattleUnitView[] {
  const x0 = Math.min(ax, bx);
  const x1 = Math.max(ax, bx);
  const y0 = Math.min(ay, by);
  const y1 = Math.max(ay, by);
  return units.filter((u) => {
    if (!keep(u)) return false;
    const p = toScreen(v, u.x, u.z);
    return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  });
}

/** The units a player may order: their side's, still fighting. */
export const ownUnits = (frame: BattleFrame | null, side: Side): BattleUnitView[] =>
  (frame?.units ?? []).filter((u) => u.side === side && standingUnit(u));

/** A selection after the battle moved on: the ids still among a side's fighting units. */
export function pruneSelection(selected: Iterable<number>, frame: BattleFrame | null, side: Side): number[] {
  const alive = new Set(ownUnits(frame, side).map((u) => u.id));
  return [...selected].filter((id) => alive.has(id));
}

/** Add a click's unit to a selection (shift/ctrl: toggle it), or replace the selection with it. */
export function clickSelect(selected: readonly number[], id: number, toggle: boolean): number[] {
  if (!toggle) return [id];
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

// ----------------------------------------------------------------------------- orders

export type OrderChoice = 'focus' | 'guard' | 'hold' | 'free' | 'withdraw';

/** The order buttons a side has, in the order they are shown. */
export function ordersFor(side: Side): OrderChoice[] {
  return side === 0 ? ['focus', 'hold', 'free', 'withdraw'] : ['focus', 'guard', 'hold', 'free'];
}

export const ORDER_NAMES: Record<OrderChoice, string> = {
  focus: 'Focus',
  guard: 'Guard',
  hold: 'Hold',
  free: 'Free',
  withdraw: 'Withdraw',
};

/** What the order does, in a few words (the buttons' titles). */
export function orderHelp(choice: OrderChoice, side: Side): string {
  switch (choice) {
    case 'focus':
      return side === 0
        ? 'Make a building the chosen units’ next objective: click it on the map'
        : 'Have the chosen units and the guns shoot one attacker first: click it on the map';
    case 'guard':
      return 'Send the chosen units to a building and keep them near it: click it on the map';
    case 'hold':
      return 'The chosen units stop where they are and only fire';
    case 'free':
      return 'Back to the battle’s own judgement: they go where it takes them';
    case 'withdraw':
      return 'The chosen units pull out of the battle';
  }
}

/** Does the order need a click on the map after the button (a building, or an attacker)? */
export const needsTarget = (choice: OrderChoice): boolean => choice === 'focus' || choice === 'guard';

/** What the click after Focus or Guard must land on. */
export function targetOf(choice: OrderChoice, side: Side): 'structure' | 'attacker' | null {
  if (choice === 'guard') return 'structure';
  if (choice === 'focus') return side === 0 ? 'structure' : 'attacker';
  return null;
}

/** The sentence on the map while an order waits for its target. */
export function armedHint(choice: OrderChoice, side: Side): string {
  return targetOf(choice, side) === 'attacker'
    ? `${ORDER_NAMES[choice]}: click an attacker on the map`
    : `${ORDER_NAMES[choice]}: click a building on the map`;
}

/**
 * The orders to send for a button: the chosen units (all of the side's own, if they are all chosen:
 * the order then names none and the whole side obeys), and the target a click gave. `problem` says
 * what is missing, in words for the player.
 */
export function buildOrders(
  choice: OrderChoice,
  side: Side,
  selected: readonly number[],
  own: readonly number[],
  target?: number,
): { orders: OrderRequest[] } | { problem: string } {
  if (side === 1 && choice === 'withdraw') return { problem: 'Only attackers can withdraw' };
  if (side === 0 && choice === 'guard') return { problem: 'Only defenders can guard a building' };
  const ids = selected.filter((id) => own.includes(id));
  if (!ids.length) return { problem: 'Choose some units first' };
  if (needsTarget(choice) && target === undefined)
    return { problem: targetOf(choice, side) === 'attacker' ? 'Click an attacker' : 'Click a building' };
  const all = own.length > 0 && own.every((id) => ids.includes(id));
  const base: Pick<OrderRequest, 'kind' | 'target'> = {
    kind: choice,
    ...(needsTarget(choice) ? { target } : {}),
  };
  if (all) return { orders: [base] };
  const orders: OrderRequest[] = [];
  for (let k = 0; k < ids.length; k += ORDER_UNITS)
    orders.push({ ...base, units: ids.slice(k, k + ORDER_UNITS) });
  return { orders };
}

// ----------------------------------------------------------------------------- the clock

/** Seconds into the battle: a step is half a second of it. */
export const battleSeconds = (step: number): number => step * BATTLE.dt;

/** "1:05": minutes and seconds of battle time. */
export function battleClock(step: number): string {
  const s = Math.floor(battleSeconds(step));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ----------------------------------------------------------------------------- the battle shown

/** The side this page commands in a battle: null for a watcher. */
export const sideOfView = (v: LiveView | null): Side | null =>
  v?.role === 'attacker' ? 0 : v?.role === 'defender' ? 1 : null;

/** The picture of the battle the map draws: the page's own run, or the city's frames for a defender. */
export function pictureOf(game: Game, v: LiveView | null): BattleFrame | null {
  const f = v?.frame ?? (v?.role === 'defender' && game.world.battle?.id === v.id ? game.world.battle : null);
  if (f) game.battleMap.lastFrame = f;
  return f ?? game.battleMap.lastFrame;
}
