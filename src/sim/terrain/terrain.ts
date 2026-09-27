import { GRID_CELL, GRID_RES, HEIGHT_RES, HEIGHT_STEP, MAP_SIZE, SHORE_HEIGHT } from '../../data/world';
import type { MapPreset } from '../../data/world';
import { TERRAIN_VERSION, TerrainGen, generateTerrain, sampleHeights } from './generate';

/**
 * Terrain derived from the seed: heights and static resource grids, regenerated on load. Earthworks
 * (M13) are kept as a saved per-sample delta on top: `heights` = `base` + delta.
 */
export class Terrain {
  readonly gen: TerrainGen;
  readonly heights: Float32Array;
  /** Heights as generated from the seed, before any earthworks. */
  readonly base: Float32Array;
  readonly groundwater: Uint8Array;
  readonly ore: Uint8Array;
  readonly oil: Uint8Array;
  readonly initialTrees: Uint8Array;

  constructor(seed: string, preset: MapPreset, version = TERRAIN_VERSION) {
    this.gen = TerrainGen.create(seed, preset, version);
    const data = generateTerrain(this.gen);
    this.heights = data.heights;
    this.base = data.heights.slice();
    this.groundwater = data.groundwater;
    this.ore = data.ore;
    this.oil = data.oil;
    this.initialTrees = data.trees;
  }

  /** Lay saved earthworks over the generated ground. */
  applyDelta(delta: Float32Array): void {
    for (let i = 0; i < this.heights.length; i++) this.heights[i] = this.base[i]! + delta[i]!;
  }

  heightAt(x: number, z: number): number {
    return sampleHeights(this.heights, x, z);
  }

  /** Gradient magnitude (rise over run) at a point, sampled over ±4 m. */
  slopeAt(x: number, z: number): number {
    const dx = this.heightAt(x + 4, z) - this.heightAt(x - 4, z);
    const dz = this.heightAt(x, z + 4) - this.heightAt(x, z - 4);
    return Math.hypot(dx, dz) / 8;
  }

  isWater(x: number, z: number): boolean {
    return this.heightAt(x, z) < SHORE_HEIGHT;
  }

  static inBounds(x: number, z: number, margin = 0): boolean {
    return x >= margin && z >= margin && x <= MAP_SIZE - margin && z <= MAP_SIZE - margin;
  }

  static gridIndex(x: number, z: number): number {
    const i = Math.min(GRID_RES - 1, Math.max(0, Math.floor(x / GRID_CELL)));
    const j = Math.min(GRID_RES - 1, Math.max(0, Math.floor(z / GRID_CELL)));
    return j * GRID_RES + i;
  }
}

export { HEIGHT_RES, HEIGHT_STEP };
