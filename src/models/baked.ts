/**
 * A converted model as the game loads it, and the tags its triangles carry. This module has no
 * imports: the game reads converted models without the GLB reader or the checker.
 */

/** Triangle flags. */
export const TRI_FAR = 1; // also drawn in the far version
export const TRI_NEAR = 2; // drawn in the near version
export const TRI_PARTY_POS = 4; // hidden when another copy stands against the +x side (rows)
export const TRI_PARTY_NEG = 8; // … the −x side
export const TRI_GROUND = 16; // a flat surface on the ground (lawn, paving, water)
export const TRI_SKY = 32; // also drawn in the skyline version (the whole-city view)
/** A face of a sheet drawn from both sides (the other side is another triangle). */
export const TRI_TWO_SIDED = 64;

/**
 * What the distant versions keep (m). `part`: a part's second-largest dimension, how big it looks
 * face on. A long thin part (a parapet, a cornice, a post) also stays if it is at least `long`
 * by `thin`: such lines read from far off (on the ground, `line` long: a pitch's touchlines). A
 * broad flat part of `sheet` square metres (solar panels on a roof) stays for its colour.
 * Far drops fittings and frames; the skyline keeps big
 * shapes and flat window panes. Whatever holds up a part that stays, stays too.
 */
export const FAR_KEEP = { part: 0.5, pane: 0.5, ground: 1, long: 2.5, thin: 0.2, line: 8, sheet: 2 };
export const SKY_KEEP = { part: 2.2, pane: 0.9, ground: 6, long: 8, thin: 0.5, line: 30, sheet: 10 };

/** What lights a window unit: windows and bands at random per copy, shopfronts nearly always, and
 *  big glazed volumes (a glass tower, an atrium, a conservatory) with a soft steady glow. A long
 *  window is lit in runs, with glass that never lights between them (`UNIT_DARK`, model batch 3). */
export const UNIT_WINDOW = 0;
export const UNIT_SHOP = 1;
export const UNIT_BAND = 2;
export const UNIT_GLOW = 3;
export const UNIT_DARK = 4;

export interface BakedModel {
  /** File name without `.glb`. */
  id: string;
  kind: 'zoned' | 'civic' | 'annex';
  /** The zoned type, civic building or add-on module it stands for, and which design of it. */
  def: string;
  design: number;
  /** Footprint (m): along the road and away from it; and the height of the tallest part. */
  w: number;
  d: number;
  h: number;
  /** How far parts reach past the footprint at the front (−z), back, and sides. */
  over: { front: number; back: number; side: number };
  /** Walls run the full width: copies in a row share party walls. */
  party: boolean;
  /** Unique vertices, and three indices per triangle (counter-clockwise from outside). */
  positions: Float32Array;
  index: Uint32Array;
  /**
   * Per triangle: role (index into ROLES), flags, window unit (0 = none, else unit + 1), and the
   * group the game drives that it belongs to (0 = none, else an index + 1 into DRIVEN_GROUPS).
   */
  triRole: Uint8Array;
  triFlags: Uint8Array;
  triUnit: Uint16Array;
  triGroup: Uint8Array;
  /** The file's colour for each role it uses, linear RGB (role index → colour). */
  colors: Record<number, [number, number, number]>;
  /** Kind of each window unit. */
  units: Uint8Array;
  /**
   * Civic sites: where something stands more than head high (or a tree will), one bit per square metre of the
   * site, row by row from its −x, −z corner (so add-on annexes can find a clear spot). Empty for
   * other models.
   */
  occupied: Uint8Array;
  /**
   * Civic sites: ground to keep clear, the same way: the roads in, and the approach to every
   * door and garage door. Empty for other models.
   */
  approach: Uint8Array;
  /** tree_spot markers: x, y (ground), z each. */
  trees: number[];
  /** Tops of smoke_stack parts: x, y, z each. */
  stacks: number[];
  /** Triangles in the file, drawn near, and drawn far. */
  counts: { file: number; near: number; far: number; sky: number };
}

/** Groups whose parts the game moves, scales or holds back as one. */
export const DRIVEN_GROUPS = ['mound', 'rotor', 'wheel_rotor', 'rocket', 'receiver', 'pumpjack_beam'];

/** A unit's roles (unit spec v1, PROMPTS-WAR.md), in the order baked unit triangles index them. */
export const UNIT_ROLES = [
  'body',
  'body_alt',
  'trim',
  'metal',
  'rubber',
  'glass',
  'accent',
  'light',
  'wood',
  'grass',
] as const;
export type UnitRole = (typeof UNIT_ROLES)[number];

/**
 * A unit as the game loads it (war, M34; unit spec v1): its triangles in model space (metres, y up,
 * the front along −z, the origin on the ground under its middle, or at a ship's waterline), tagged
 * by role and by the moving part they belong to, with each part's pivot so the game can turn
 * turrets, barrels, rotors, propellers, wheels, tracks, hatches, ramps, dishes, keys and limbs.
 */
export interface BakedUnit {
  /** File name without `.glb` (`unit-tank`). */
  id: string;
  /** The unit kind it stands for (`tank`; src/data/war.ts). */
  kind: string;
  /** Length (along z), width (x) and height above 0, as built; and how far its hull goes below 0. */
  size: [number, number, number];
  depth: number;
  /** Unique vertices, and three indices per triangle (counter-clockwise from outside). */
  positions: Float32Array;
  index: Uint32Array;
  /** Per triangle: role (index into UNIT_ROLES), part (0 = the body, k = parts[k − 1]), kept far (1). */
  triRole: Uint8Array;
  triPart: Uint8Array;
  triFar: Uint8Array;
  /** The file's colour for each role it uses, linear RGB (role index → colour). */
  colors: Record<number, [number, number, number]>;
  /**
   * Moving parts by their spec names (`turret`, `barrel`, `rotor`, `wheel`…), each with its parent
   * (0 = the body, k = parts[k − 1]: a barrel turns with its turret) and the point it turns about.
   */
  parts: { name: string; parent: number; pivot: [number, number, number] }[];
  /** Where it fires from (muzzle cubes, not drawn) and where engine smoke comes out, by part. */
  muzzles: { part: number; at: [number, number, number] }[];
  exhausts: { part: number; at: [number, number, number] }[];
  /** Triangles in the file, drawn near, and drawn far. */
  counts: { file: number; near: number; far: number };
}
