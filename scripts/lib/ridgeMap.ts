// The Terraces scenario's map (M24): a hand-shaped map in the map editor's format. A small shelf of
// flat land where the highway comes in, walled in by slopes too steep for lots or streets, rolling
// uplands above them, and a broad valley with a river beyond the ridge to the east.
import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP } from '../../src/data/world';
import { Noise2D, smoothstep } from '../../src/sim/terrain/noise';
import { MAP_FORMAT, autoRailZ, packHeights, type MapData } from '../../src/sim/terrain/customMap';

export const RIDGE = {
  highwayZ: 1024,
  /** The shelf by the highway: flat, 8 m up, a rounded box this far out and to each side. */
  shelf: { x: 560, z: 360, h: 8 },
  /** The saddle in the ridge between the shelf and the valley, and the valley floor beyond. */
  saddle: { x0: 560, x1: 900, h: 58, halfWidth: 110 },
  valley: { x: 900, h: 10 },
  river: { x: 1760 },
};

export function ridgeHeight(x: number, z: number, n1: Noise2D, n2: Noise2D): number {
  const { highwayZ: hz, shelf, saddle, valley, river } = RIDGE;
  const dx = Math.max(0, x - shelf.x);
  const dz = Math.max(0, Math.abs(z - hz) - shelf.z);
  const out = Math.hypot(dx, dz);
  // Steep banks (about 1 in 3) from the shelf up to rolling uplands.
  const uplands = 72 + 12 * n1.fbm(x / 420, z / 420, 3) + 3 * n2.fbm(x / 90, z / 90, 2);
  let h = shelf.h + (uplands - shelf.h) * smoothstep(0, 150, out);
  // The saddle: a dip in the ridge straight east of the shelf, too steep for a street to climb.
  const across = Math.abs(z - hz);
  if (x > saddle.x0 - 40 && x < valley.x + 260) {
    const w = 1 - smoothstep(saddle.halfWidth * 0.6, saddle.halfWidth * 1.6, across);
    const along = Math.min(1, Math.max(0, (x - saddle.x0) / (saddle.x1 - saddle.x0)));
    // Up from the shelf, a crest in the middle, and down to the valley.
    const crest = saddle.h * Math.sin(Math.PI * along) ** 0.6 + shelf.h * (1 - along) + valley.h * along;
    h += (Math.min(h, crest) - h) * w;
  }
  // The valley beyond the ridge, broad and flat, with its river.
  const v = smoothstep(valley.x, valley.x + 160, x);
  h += (valley.h + 2 * n2.fbm(x / 200, z / 200, 2) - h) * v;
  const r = Math.abs(x - (river.x + 70 * Math.sin(z / 260)));
  if (r < 70) h = Math.min(h, -4 + (r / 70) * 14);
  return h;
}

export function ridgeMap(): MapData {
  const n1 = new Noise2D('ridgeholm:hills');
  const n2 = new Noise2D('ridgeholm:detail');
  const nf = new Noise2D('ridgeholm:forest');
  const no = new Noise2D('ridgeholm:ore');
  const hz = RIDGE.highwayZ;
  const height = (x: number, z: number) => ridgeHeight(x, z, n1, n2);
  const heights = new Float32Array(HEIGHT_RES * HEIGHT_RES);
  for (let j = 0; j < HEIGHT_RES; j++)
    for (let i = 0; i < HEIGHT_RES; i++)
      heights[j * HEIGHT_RES + i] = height(i * HEIGHT_STEP, j * HEIGHT_STEP);
  const n = GRID_RES * GRID_RES;
  const trees = new Uint8Array(n);
  const ore = new Uint8Array(n);
  const oil = new Uint8Array(n);
  for (let j = 0; j < GRID_RES; j++)
    for (let i = 0; i < GRID_RES; i++) {
      const x = (i + 0.5) * GRID_CELL;
      const z = (j + 0.5) * GRID_CELL;
      const h = height(x, z);
      const k = j * GRID_RES + i;
      if (h > 14 && h < 90) trees[k] = Math.round(255 * smoothstep(0.05, 0.4, nf.fbm(x / 300, z / 300, 3)));
      if (h > 30) ore[k] = Math.round(255 * smoothstep(0.35, 0.6, no.fbm(x / 260, z / 260, 3)));
    }
  return {
    format: MAP_FORMAT,
    name: 'Ridgeholm Hills',
    seed: 'ridgeholm',
    preset: 'highlands',
    climate: 'temperate',
    heights: packHeights(heights),
    trees,
    ore,
    oil,
    highwayZ: hz,
    railZ: autoRailZ(heights, hz),
  };
}
