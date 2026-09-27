import { Color, Group, Mesh, MeshLambertMaterial } from 'three';
import type { ClientWorld, NetChanges } from '../client/world';
import { CELL, ROWS, ZONE_C, ZONE_I, ZONE_R } from '../data/zones';
import { GeoBuffer, mergeChunks, type GeoChunk } from './geoBuffer';

const CHUNK = 512;
const INSET = 0.45;

export const ZONE_COLOURS: Record<number, Color> = {
  [ZONE_R]: new Color('#58c27d'),
  [ZONE_C]: new Color('#4d9bf5'),
  [ZONE_I]: new Color('#f3b93a'),
};
const EMPTY = new Color('#f4f1e6');

/**
 * Zone cells as tinted ground quads, chunk-merged. Zoned empty cells are always shown; unzoned
 * valid cells (the zoning grid) only while a zoning tool is active.
 */
export class ZoneRenderer {
  readonly group = new Group();
  private zonedMat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  private gridMat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  private blockGeo = new Map<number, { chunk: number; zoned: GeoChunk | null; grid: GeoChunk | null }>();
  private chunks = new Map<number, { zoned: Mesh | null; grid: Mesh | null; blocks: Set<number> }>();
  private dirtyBlocks = new Set<number>();
  private dirtyChunks = new Set<number>();
  private showGrid = false;

  constructor(private world: ClientWorld) {
    for (const id of world.netState.blocks.keys()) this.dirtyBlocks.add(id);
    world.onNet((c: NetChanges) => {
      for (const id of c.blocks) this.dirtyBlocks.add(id);
      this.flush();
    });
    this.flush();
  }

  setGridVisible(on: boolean): void {
    this.showGrid = on;
    for (const c of this.chunks.values()) if (c.grid) c.grid.visible = on;
  }

  /** The ground moved in `box` (earthworks, M13): redrape the zone blocks there. */
  refresh(box: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    const m = 48; // blocks reach this far from their road's centre line
    const grown = { minX: box.minX - m, minZ: box.minZ - m, maxX: box.maxX + m, maxZ: box.maxZ + m };
    for (const id of this.world.net.segHash.query(grown)) {
      const s = this.world.netState.segments.get(id);
      if (s?.left) this.dirtyBlocks.add(s.left);
      if (s?.right) this.dirtyBlocks.add(s.right);
    }
    this.flush();
  }

  private buildBlock(id: number): { chunk: number; zoned: GeoChunk | null; grid: GeoChunk | null } | null {
    const b = this.world.netState.blocks.get(id);
    if (!b) return null;
    const net = this.world.net;
    const zoned = new GeoBuffer(256);
    const grid = new GeoBuffer(256);
    const h = CELL / 2 - INSET;
    let cx = 0;
    let cz = 0;
    let count = 0;
    for (let i = 0; i < b.cols * ROWS; i++) {
      if (!b.valid[i] || b.bld[i]) continue;
      const r = net.cellRect(b.id, i, 0);
      const c = Math.cos(r.angle);
      const s = Math.sin(r.angle);
      const corner = (u: number, v: number) => {
        const x = r.x + (u * c - v * s) * h;
        const z = r.z + (u * s + v * c) * h;
        return [x, Math.max(0, this.world.heightAt(x, z)) + 0.12, z];
      };
      const target = b.zone[i] ? zoned : grid;
      const col = b.zone[i] ? ZONE_COLOURS[b.zone[i]!]! : EMPTY;
      target.quad(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), col);
      cx += r.x;
      cz += r.z;
      count++;
    }
    if (!count) {
      const mid = net.cellCenter(b.id, 0);
      cx = mid.x;
      cz = mid.z;
      count = 1;
    }
    const chunk = Math.floor(cx / count / CHUNK) * 1000 + Math.floor(cz / count / CHUNK);
    return { chunk, zoned: zoned.n ? zoned.trimmed() : null, grid: grid.n ? grid.trimmed() : null };
  }

  private flush(): void {
    for (const id of this.dirtyBlocks) {
      const old = this.blockGeo.get(id);
      if (old) {
        this.chunks.get(old.chunk)?.blocks.delete(id);
        this.dirtyChunks.add(old.chunk);
        this.blockGeo.delete(id);
      }
      const geo = this.buildBlock(id);
      if (!geo) continue;
      this.blockGeo.set(id, geo);
      let c = this.chunks.get(geo.chunk);
      if (!c) this.chunks.set(geo.chunk, (c = { zoned: null, grid: null, blocks: new Set() }));
      c.blocks.add(id);
      this.dirtyChunks.add(geo.chunk);
    }
    this.dirtyBlocks.clear();
    for (const ck of this.dirtyChunks) {
      const c = this.chunks.get(ck);
      if (!c) continue;
      for (const key of ['zoned', 'grid'] as const) {
        const m = c[key];
        if (m) {
          this.group.remove(m);
          m.geometry.dispose();
          c[key] = null;
        }
        const parts = [...c.blocks]
          .sort((a, b) => a - b)
          .map((id) => this.blockGeo.get(id)![key])
          .filter((g): g is GeoChunk => !!g);
        if (!parts.length) continue;
        const mesh = new Mesh(mergeChunks(parts), key === 'zoned' ? this.zonedMat : this.gridMat);
        mesh.renderOrder = 2;
        mesh.receiveShadow = true;
        mesh.visible = key === 'zoned' || this.showGrid;
        mesh.name = `zones-${key}-${ck}`;
        c[key] = mesh;
        this.group.add(mesh);
      }
    }
    this.dirtyChunks.clear();
  }
}
