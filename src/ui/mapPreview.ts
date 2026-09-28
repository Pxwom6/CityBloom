import { TerrainGen, sampleHeights } from '../sim/terrain/generate';
import { unpackHeights, type MapData } from '../sim/terrain/customMap';
import { GRID_CELL, GRID_RES, MAP_SIZE, SHORE_HEIGHT, WATER_LEVEL, type MapPreset } from '../data/world';

/** Colours of the new-game map preview: water, beach, meadow to hilltop, forest. */
const WATER: [number, number, number] = [86, 150, 196];
const DEEP: [number, number, number] = [58, 118, 170];
const SAND: [number, number, number] = [222, 208, 164];
const LOW: [number, number, number] = [132, 178, 102];
const HIGH: [number, number, number] = [168, 160, 122];
const FOREST: [number, number, number] = [72, 128, 72];

const mix = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i]! - v) * t);

/**
 * Paint a small top-down map of a seed and preset (the same generator the sim uses), with the
 * highway entrance marked on the west edge. Returns the time it took, in ms.
 */
export function drawMapPreview(canvas: HTMLCanvasElement, seed: string, preset: MapPreset): number {
  const gen = TerrainGen.create(seed, preset);
  return paint(
    canvas,
    (x, z) => gen.height(x, z),
    (x, z) => gen.forestNoise(x, z),
    gen.params.highway.connectZ,
    null,
  );
}

/** The same for a custom map (M24): its own ground and forests, and its railway entry too. */
export function drawCustomMapPreview(canvas: HTMLCanvasElement, map: MapData): number {
  const heights = unpackHeights(map.heights);
  return paint(
    canvas,
    (x, z) => sampleHeights(heights, x, z),
    (x, z) => {
      const i = Math.min(GRID_RES - 1, Math.floor(x / GRID_CELL));
      const j = Math.min(GRID_RES - 1, Math.floor(z / GRID_CELL));
      return 0.45 + (map.trees[j * GRID_RES + i]! / 255) * 0.5;
    },
    map.highwayZ,
    map.railZ,
  );
}

function paint(
  canvas: HTMLCanvasElement,
  height: (x: number, z: number) => number,
  forest: (x: number, z: number) => number,
  highwayZ: number,
  railZ: number | null,
): number {
  const t0 = performance.now();
  const n = canvas.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const step = MAP_SIZE / n;
  const h = new Float32Array((n + 1) * (n + 1));
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) h[j * (n + 1) + i] = height(i * step, j * step);
  const img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const y = h[j * (n + 1) + i]!;
      let c: number[];
      if (y < WATER_LEVEL) c = mix(WATER, DEEP, Math.min(1, (WATER_LEVEL - y) / 6));
      else if (y < SHORE_HEIGHT + 0.8) c = SAND;
      else {
        c = mix(LOW, HIGH, Math.min(1, y / 90));
        const x = (i + 0.5) * step;
        const z = (j + 0.5) * step;
        const f = forest(x, z);
        if (y > 1.6 && f > 0.45) c = mix(c, FOREST, Math.min(1, (f - 0.45) * 2.5));
        // Light from the north-west.
        const shade = (h[j * (n + 1) + i + 1]! - y + h[(j + 1) * (n + 1) + i]! - y) / step;
        const k = Math.max(0.7, Math.min(1.25, 1 - shade * 1.6));
        c = c.map((v) => v * k);
      }
      const o = (j * n + i) * 4;
      img.data[o] = c[0]!;
      img.data[o + 1] = c[1]!;
      img.data[o + 2] = c[2]!;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // The highway comes in from the west (and the railway, on a custom map).
  const arrow = (z: number, colour: string) => {
    const cz = (z / MAP_SIZE) * n;
    ctx.fillStyle = colour;
    ctx.fillRect(0, cz - 1.5, n * 0.04, 3);
    ctx.beginPath();
    ctx.moveTo(n * 0.04, cz - 5);
    ctx.lineTo(n * 0.04 + 7, cz);
    ctx.lineTo(n * 0.04, cz + 5);
    ctx.fill();
  };
  arrow(highwayZ, '#4d5560');
  if (railZ !== null) arrow(railZ, '#8a6a45');
  return performance.now() - t0;
}
