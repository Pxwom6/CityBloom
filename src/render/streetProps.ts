import { Color, Group, Mesh, MeshLambertMaterial } from 'three';
import type { ClientWorld, NetChanges } from '../client/world';
import { ROAD_TYPES, type RoadTypeId } from '../data/roads';
import { CELL, ROWS, ZONE_C, ZONE_R } from '../data/zones';
import { GeoBuffer, mergeChunks, type GeoChunk } from './geoBuffer';

const CHUNK = 512;
/** Props stand between the street lamps (every 34 m from 12 m off the junction). */
const START = 12 + 17;
const STEP = 34;
/** Height of the pavement above the road's ground (roadStyle's sidewalk lift). */
const WALK = 0.34;
const TOWN = new Set<RoadTypeId>(['street', 'avenue', 'boulevard']);

const WOOD = new Color('#a87a52');
const IRON = new Color('#4a4f55');
const BIN = new Color('#4d7a58');
const LID = new Color('#3a3f44');
const STONE = new Color('#d9d3c6');
const BUSH = new Color('#5f9a4c');
const BUSH_TOP = new Color('#78b25a');

/** A frame on the pavement: u along the road, v away from it, y up. */
interface Frame {
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

/** A box in the frame, its five visible faces (no bottom), each wound to face out. */
function box(
  out: GeoBuffer,
  f: Frame,
  u0: number,
  u1: number,
  v0: number,
  v1: number,
  y0: number,
  y1: number,
  col: Color,
): void {
  const p = (u: number, v: number, y: number) => [
    f.x + f.tx * u + f.nx * v,
    f.y + y,
    f.z + f.tz * u + f.nz * v,
  ];
  const face = (a: number[], b: number[], c: number[], d: number[], ox: number, oy: number, oz: number) => {
    // Wind so the face's normal points along the outward direction (ox, oy, oz).
    const e1 = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!];
    const e2 = [c[0]! - a[0]!, c[1]! - a[1]!, c[2]! - a[2]!];
    const n = [
      e1[1]! * e2[2]! - e1[2]! * e2[1]!,
      e1[2]! * e2[0]! - e1[0]! * e2[2]!,
      e1[0]! * e2[1]! - e1[1]! * e2[0]!,
    ];
    if (n[0]! * ox + n[1]! * oy + n[2]! * oz >= 0) out.quad(a, b, c, d, col, false);
    else out.quad(a, d, c, b, col, false);
  };
  face(p(u0, v0, y1), p(u1, v0, y1), p(u1, v1, y1), p(u0, v1, y1), 0, 1, 0);
  face(p(u0, v0, y0), p(u1, v0, y0), p(u1, v0, y1), p(u0, v0, y1), -f.nx, 0, -f.nz);
  face(p(u0, v1, y0), p(u1, v1, y0), p(u1, v1, y1), p(u0, v1, y1), f.nx, 0, f.nz);
  face(p(u0, v0, y0), p(u0, v1, y0), p(u0, v1, y1), p(u0, v0, y1), -f.tx, 0, -f.tz);
  face(p(u1, v0, y0), p(u1, v1, y0), p(u1, v1, y1), p(u1, v0, y1), f.tx, 0, f.tz);
}

/** A bench facing the road, seat and back on two iron legs (about 40 triangles). */
function bench(out: GeoBuffer, f: Frame): void {
  for (const u of [-0.72, 0.72]) box(out, f, u - 0.05, u + 0.05, -0.2, 0.26, 0, 0.42, IRON);
  box(out, f, -0.9, 0.9, -0.22, 0.2, 0.42, 0.5, WOOD);
  box(out, f, -0.9, 0.9, 0.2, 0.28, 0.5, 0.95, WOOD);
}

/** A litter bin with a dark lid (20 triangles). */
function bin(out: GeoBuffer, f: Frame): void {
  box(out, f, -0.24, 0.24, -0.24, 0.24, 0, 0.85, BIN);
  box(out, f, -0.28, 0.28, -0.28, 0.28, 0.85, 0.95, LID);
}

/** A stone planter with a clipped shrub (30 triangles). */
function planter(out: GeoBuffer, f: Frame): void {
  box(out, f, -0.8, 0.8, -0.45, 0.45, 0, 0.5, STONE);
  box(out, f, -0.66, 0.66, -0.33, 0.33, 0.5, 1.0, BUSH);
  box(out, f, -0.45, 0.45, -0.22, 0.22, 1.0, 1.22, BUSH_TOP);
}

/**
 * Street furniture (M27): benches with bins and planters along the pavements of shopping streets,
 * and a bin now and then outside homes. Each road's pieces are merged into its 512 m chunk, one
 * mesh a chunk, rebuilt only when a road, its zoning or its bus stops change.
 */
export class StreetProps {
  readonly group = new Group();
  readonly material = new MeshLambertMaterial({ vertexColors: true });
  private elements = new Map<number, { chunk: number; geo: GeoChunk; count: number }>();
  private chunks = new Map<number, { mesh: Mesh | null; segs: Set<number> }>();
  /** What each road's props were placed for (its zoning along the frontage and its stops). */
  private keys = new Map<number, string>();
  private dirty = new Set<number>();
  private dirtyChunks = new Set<number>();
  private transitVersion = -1;
  private stopSegs = new Set<number>();
  count = 0;

  constructor(private world: ClientWorld) {
    this.group.name = 'street-props';
    for (const id of world.netState.segments.keys()) this.dirty.add(id);
    world.onNet((c: NetChanges) => {
      for (const id of c.segments) this.dirty.add(id);
      for (const id of c.blocks) {
        const b = world.netState.blocks.get(id);
        if (b) this.dirty.add(b.seg);
      }
    });
  }

  /** Close up only, and their shadows closer still. */
  update(cameraDistance: number, on: boolean): void {
    if (this.transitVersion !== this.world.transitVersion) {
      this.transitVersion = this.world.transitVersion;
      const now = new Set([...this.world.stops.values()].map((s) => s.seg));
      for (const id of now) if (!this.stopSegs.has(id)) this.dirty.add(id);
      for (const id of this.stopSegs) if (!now.has(id)) this.dirty.add(id);
      this.stopSegs = now;
    }
    if (this.dirty.size) this.flush();
    this.group.visible = on && cameraDistance < 900;
    for (const c of this.chunks.values()) if (c.mesh) c.mesh.castShadow = cameraDistance < 450;
  }

  /** The props' key for a road: its type, length, zoning along both frontages and stops. */
  private key(id: number): string | null {
    const st = this.world.netState;
    const seg = st.segments.get(id);
    if (!seg || !TOWN.has(seg.type) || this.world.deck(id)) return null;
    const front = (b?: number) => {
      const blk = b !== undefined ? st.blocks.get(b) : undefined;
      if (!blk) return '';
      let s = `${blk.s0.toFixed(1)}:`;
      for (let c = 0; c < blk.cols; c++) s += blk.valid[c * ROWS] ? blk.zone[c * ROWS] : '-';
      return s;
    };
    const stops = [...this.world.stops.values()]
      .filter((s) => s.seg === id)
      .map((s) => s.s.toFixed(0))
      .join(',');
    return `${seg.type}|${this.world.net.curve(id).length.toFixed(1)}|${front(seg.left)}|${front(seg.right)}|${stops}`;
  }

  private flush(): void {
    for (const id of this.dirty) {
      const key = this.key(id);
      if (key === (this.keys.get(id) ?? null) && (key === null || this.elements.has(id))) continue;
      const old = this.elements.get(id);
      if (old) {
        this.chunks.get(old.chunk)?.segs.delete(id);
        this.dirtyChunks.add(old.chunk);
        this.elements.delete(id);
      }
      if (key === null) {
        this.keys.delete(id);
        continue;
      }
      this.keys.set(id, key);
      const built = this.build(id);
      if (!built) continue;
      this.elements.set(id, built);
      let c = this.chunks.get(built.chunk);
      if (!c) this.chunks.set(built.chunk, (c = { mesh: null, segs: new Set() }));
      c.segs.add(id);
      this.dirtyChunks.add(built.chunk);
    }
    this.dirty.clear();
    for (const ck of this.dirtyChunks) {
      const c = this.chunks.get(ck);
      if (!c) continue;
      if (c.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh = null;
      }
      if (!c.segs.size) continue;
      const parts = [...c.segs].sort((a, b) => a - b).map((id) => this.elements.get(id)!.geo);
      const mesh = new Mesh(mergeChunks(parts), this.material);
      mesh.name = `street-props-${ck}`;
      mesh.receiveShadow = true;
      c.mesh = mesh;
      this.group.add(mesh);
    }
    this.dirtyChunks.clear();
    this.count = 0;
    for (const e of this.elements.values()) this.count += e.count;
  }

  private build(id: number): { chunk: number; geo: GeoChunk; count: number } | null {
    const w = this.world;
    const st = w.netState;
    const seg = st.segments.get(id)!;
    const t = ROAD_TYPES[seg.type];
    const curve = w.net.curve(id);
    const stops = [...w.stops.values()].filter((s) => s.seg === id).map((s) => s.s);
    const wide = seg.type !== 'street';
    const buf = new GeoBuffer(1024);
    let count = 0;
    for (const side of [1, -1] as const) {
      const blk = st.blocks.get((side === 1 ? seg.left : seg.right) ?? -1);
      if (!blk) continue;
      // Along the pavement's back, the bench's back to the lots.
      const v = t.width / 2 + t.sidewalk - 0.55;
      for (let k = 0, d = START; d < curve.length - START + STEP / 2 - 6; k++, d += STEP) {
        // The zone of the frontage cell here.
        const c = Math.floor((d - blk.s0) / CELL);
        if (c < 0 || c >= blk.cols || !blk.valid[c * ROWS]) continue;
        const zone = blk.zone[c * ROWS];
        if (stops.some((s) => Math.abs(s - d) < 8)) continue;
        const j = k + (side === 1 ? 0 : 1);
        let what: 'bench' | 'planter' | 'bin' | null = null;
        if (zone === ZONE_C) what = j % 2 === 0 ? 'bench' : wide ? 'planter' : 'bin';
        else if (zone === ZONE_R) what = j % 3 === 1 ? 'bin' : null;
        if (!what) continue;
        const pt = curve.pointAt(d);
        const tan = curve.tangentAt(d);
        // Away from the road on this side (a block's left is along (t.z, −t.x)).
        const nx = tan.z * side;
        const nz = -tan.x * side;
        const x = pt.x + nx * v;
        const z = pt.z + nz * v;
        const f: Frame = { x, y: w.roadHeight(id, d, pt.x, pt.z) + WALK, z, tx: tan.x, tz: tan.z, nx, nz };
        if (what === 'bench') {
          bench(buf, f);
          bin(buf, { ...f, x: x + tan.x * 1.6, z: z + tan.z * 1.6 });
          count += 2;
        } else if (what === 'planter') {
          planter(buf, f);
          count++;
        } else {
          bin(buf, f);
          count++;
        }
      }
    }
    if (!buf.n) return null;
    const mid = curve.pointAt(curve.length / 2);
    return { chunk: Math.floor(mid.x / CHUNK) * 1000 + Math.floor(mid.z / CHUNK), geo: buf.trimmed(), count };
  }
}
