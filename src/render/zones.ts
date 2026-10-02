import { BufferAttribute, Color, Group, Mesh, MeshLambertMaterial } from 'three';
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

/** Width of the outline round a zoned area in the subtle look (m). */
const EDGE = 0.45;

type Part = 'zoned' | 'grid' | 'fill' | 'edge';
const PARTS: Part[] = ['zoned', 'grid', 'fill', 'edge'];
/** Meshes a chunk: the full look's two, and the subtle look's tint and outline in one (M27). */
type Layer = 'zoned' | 'grid' | 'subtle';
const LAYERS: Record<Layer, Part[]> = { zoned: ['zoned'], grid: ['grid'], subtle: ['fill', 'edge'] };
/** The subtle look's opacity, a vertex's own: the faint tint, and the outline round it. */
const ALPHA: Partial<Record<Part, number>> = { fill: 0.14, edge: 0.5 };
const SIDES = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
] as const;

/**
 * Zone cells as tinted ground, chunk-merged. Empty zoned land is shown subtly, a faint tint with
 * an outline round each zoned area (M27: not graph paper); while a zoning tool is out it is shown
 * in full, cell by cell, with the unzoned cells (the zoning grid) too.
 */
export class ZoneRenderer {
  readonly group = new Group();
  /** Opacity from each vertex's colour (RGBA). */
  private subtleMat = new MeshLambertMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -3,
  });
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
  private blockGeo = new Map<number, { chunk: number } & Record<Part, GeoChunk | null>>();
  private chunks = new Map<number, Record<Layer, Mesh | null> & { blocks: Set<number> }>();
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
    for (const c of this.chunks.values())
      for (const layer of ['zoned', 'grid', 'subtle'] as const)
        if (c[layer]) c[layer]!.visible = this.shown(layer);
  }

  /** Each layer is shown in one look: cell by cell while zoning, subtle otherwise. */
  private shown(layer: Layer): boolean {
    return layer === 'subtle' ? !this.showGrid : this.showGrid;
  }

  /** Triangles and whether they're shown, per part (tests: which look is on). */
  stats(): Record<Part, { tris: number; shown: boolean }> {
    const out = {} as Record<Part, { tris: number; shown: boolean }>;
    for (const part of PARTS) {
      let tris = 0;
      for (const g of this.blockGeo.values()) tris += (g[part]?.pos.length ?? 0) / 9;
      out[part] = {
        tris: Math.round(tris),
        shown: this.shown(part === 'fill' || part === 'edge' ? 'subtle' : part),
      };
    }
    return out;
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

  private buildBlock(id: number): ({ chunk: number } & Record<Part, GeoChunk | null>) | null {
    const b = this.world.netState.blocks.get(id);
    if (!b) return null;
    const net = this.world.net;
    const buf: Record<Part, GeoBuffer> = {
      zoned: new GeoBuffer(256),
      grid: new GeoBuffer(256),
      fill: new GeoBuffer(256),
      edge: new GeoBuffer(256),
    };
    let cx = 0;
    let cz = 0;
    let count = 0;
    const empty = (i: number) => b.valid[i] && !b.bld[i];
    for (let i = 0; i < b.cols * ROWS; i++) {
      if (!empty(i)) continue;
      const r = net.cellRect(b.id, i, 0);
      const c = Math.cos(r.angle);
      const s = Math.sin(r.angle);
      const at = (u: number, v: number) => {
        const x = r.x + u * c - v * s;
        const z = r.z + u * s + v * c;
        return [x, Math.max(0, this.world.heightAt(x, z)) + 0.12, z];
      };
      const zone = b.zone[i]!;
      const h = CELL / 2;
      if (zone) {
        const col = ZONE_COLOURS[zone]!;
        const hi = h - INSET;
        buf.zoned.quad(at(-hi, -hi), at(hi, -hi), at(hi, hi), at(-hi, hi), col);
        // Subtle: a faint tint over the whole cell…
        buf.fill.quad(at(-h, -h), at(h, -h), at(h, h), at(-h, h), col);
        // … and an outline on the sides where the zoned area ends. Columns run along the road
        // (+u); rows step away from it, which is −v on the left side and +v on the right.
        const col0 = Math.floor(i / ROWS);
        const row0 = i % ROWS;
        const open = SIDES.map(([du, dr]) => {
          const nc = col0 + du;
          const nr = row0 + dr;
          const ni = nc * ROWS + nr;
          return !(nc >= 0 && nc < b.cols && nr >= 0 && nr < ROWS && empty(ni) && b.zone[ni] === zone);
        });
        SIDES.forEach(([du, dr], k) => {
          if (!open[k]) return;
          // A strip along that side, wound like the cell so it faces up; the strips across the
          // road stop short of the ones along it so the corners aren't painted twice.
          const d = du || -dr * b.side;
          const lo = d > 0 ? h - EDGE : -h;
          const hi = d > 0 ? h : -h + EDGE;
          if (du) buf.edge.quad(at(lo, -h), at(hi, -h), at(hi, h), at(lo, h), col);
          else {
            const u0 = open[0] ? -h + EDGE : -h;
            const u1 = open[1] ? h - EDGE : h;
            buf.edge.quad(at(u0, lo), at(u1, lo), at(u1, hi), at(u0, hi), col);
          }
        });
      } else {
        const hi = h - INSET;
        buf.grid.quad(at(-hi, -hi), at(hi, -hi), at(hi, hi), at(-hi, hi), EMPTY);
      }
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
    const out = { chunk } as { chunk: number } & Record<Part, GeoChunk | null>;
    for (const part of PARTS) out[part] = buf[part].n ? buf[part].trimmed() : null;
    return out;
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
      if (!c) this.chunks.set(geo.chunk, (c = { zoned: null, grid: null, subtle: null, blocks: new Set() }));
      c.blocks.add(id);
      this.dirtyChunks.add(geo.chunk);
    }
    this.dirtyBlocks.clear();
    for (const ck of this.dirtyChunks) {
      const c = this.chunks.get(ck);
      if (!c) continue;
      for (const layer of ['zoned', 'grid', 'subtle'] as const) {
        const m = c[layer];
        if (m) {
          this.group.remove(m);
          m.geometry.dispose();
          c[layer] = null;
        }
        const pieces: { geo: GeoChunk; alpha: number }[] = [];
        for (const id of [...c.blocks].sort((a, b) => a - b))
          for (const part of LAYERS[layer]) {
            const geo = this.blockGeo.get(id)![part];
            if (geo) pieces.push({ geo, alpha: ALPHA[part] ?? 1 });
          }
        if (!pieces.length) continue;
        const geometry = mergeChunks(pieces.map((p) => p.geo));
        if (layer === 'subtle') {
          // RGBA: each piece's own opacity, so the tint and its outline are one draw.
          const rgb = geometry.attributes.color!.array as Float32Array;
          const rgba = new Float32Array((rgb.length / 3) * 4);
          let v = 0;
          for (const p of pieces)
            for (let k = 0; k < p.geo.pos.length / 3; k++, v++) {
              rgba[v * 4] = rgb[v * 3]!;
              rgba[v * 4 + 1] = rgb[v * 3 + 1]!;
              rgba[v * 4 + 2] = rgb[v * 3 + 2]!;
              rgba[v * 4 + 3] = p.alpha;
            }
          geometry.setAttribute('color', new BufferAttribute(rgba, 4));
        }
        const mat = { zoned: this.zonedMat, grid: this.gridMat, subtle: this.subtleMat }[layer];
        const mesh = new Mesh(geometry, mat);
        mesh.renderOrder = 2;
        mesh.receiveShadow = true;
        mesh.visible = this.shown(layer);
        mesh.name = `zones-${layer}-${ck}`;
        c[layer] = mesh;
        this.group.add(mesh);
      }
    }
    this.dirtyChunks.clear();
  }
}
