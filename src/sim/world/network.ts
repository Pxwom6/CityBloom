import { GRADING, ROAD_TYPES, roadHalfWidth, type RoadTypeId } from '../../data/roads';
import { CELL, CELL_OVERLAP_SHRINK, MAX_CELL_SLOPE, ROWS, ZONE_NONE } from '../../data/zones';
import { MAP_SIZE, SHORE_HEIGHT } from '../../data/world';
import { Curve, rectsOverlap, splitBezier, v2, type ORect, type Vec2 } from '../geom';
import { SpatialHash, type Box } from './spatial';
import type { Terrain } from '../terrain/terrain';
import { profileAt } from './grading';

export interface RoadNode {
  id: number;
  x: number;
  z: number;
}

export interface RoadSegment {
  id: number;
  a: number;
  b: number;
  cx: number;
  cz: number;
  type: RoadTypeId;
  /** Zone block ids on the left (+1) and right (−1) side, 0 if none. */
  left: number;
  right: number;
  /**
   * Road surface heights every GRADING.step metres, for a road carried on a viaduct over dry ground
   * (M13); absent for roads on the ground and for water bridges (derived from the terrain).
   */
  deck?: number[];
}

/**
 * Zone cells along one side of a segment: `cols` columns × ROWS rows of CELL-metre squares.
 * Cell (c, r) is stored at index c * ROWS + r. Column c is centred at arc length s0 + (c + ½)·CELL.
 */
export interface ZoneBlock {
  id: number;
  seg: number;
  side: 1 | -1;
  s0: number;
  cols: number;
  zone: Uint8Array;
  valid: Uint8Array;
  bld: Int32Array;
}

export interface NetworkState {
  nodes: Map<number, RoadNode>;
  segments: Map<number, RoadSegment>;
  blocks: Map<number, ZoneBlock>;
}

export interface NetworkHooks {
  nextId(): number;
  /** Is this rectangle blocked by something other than roads and zone cells (placed buildings)? */
  footprintBlocked(rect: ORect, ignoreBuilding: number): boolean;
  /** A building's cells moved to another block (segment split or upgrade). */
  buildingMoved(bld: number, block: number, col: number): void;
  /** A building lost its cells and must be demolished. */
  buildingLost(bld: number): void;
}

interface CellGeo {
  xs: Float64Array;
  zs: Float64Array;
  ang: Float64Array;
}

export const cellKey = (block: number, idx: number): number => block * 1024 + idx;
const keyBlock = (key: number): number => Math.floor(key / 1024);
const keyIdx = (key: number): number => key % 1024;

/**
 * The road graph and the zone blocks that hang off it, plus derived caches (adjacency, curves,
 * spatial indexes, cell positions). Derived data is rebuilt from the saved state on load.
 */
export class Network {
  readonly adj = new Map<number, number[]>();
  readonly curves = new Map<number, Curve>();
  readonly segHash = new SpatialHash(64);
  readonly cellHash = new SpatialHash(32);
  private cellGeo = new Map<number, CellGeo>();
  /** Diff tracking for the main-thread mirror. */
  readonly dirty = { nodes: new Set<number>(), segments: new Set<number>(), blocks: new Set<number>() };
  readonly removed = { nodes: new Set<number>(), segments: new Set<number>(), blocks: new Set<number>() };

  /**
   * The main thread builds a Network without terrain or hooks and only uses the geometry side
   * (curves, adjacency, cell positions, spatial queries) via the public index methods.
   */
  constructor(
    readonly st: NetworkState,
    private terrainOrNull: Terrain | null,
    private hooksOrNull: NetworkHooks | null,
  ) {
    this.rebuildDerived();
  }

  private get terrain(): Terrain {
    if (!this.terrainOrNull) throw new Error('Network has no terrain (client-side geometry only)');
    return this.terrainOrNull;
  }

  private get hooks(): NetworkHooks {
    if (!this.hooksOrNull) throw new Error('Network has no hooks (client-side geometry only)');
    return this.hooksOrNull;
  }

  rebuildDerived(): void {
    this.adj.clear();
    this.curves.clear();
    this.segHash.clear();
    this.cellHash.clear();
    this.cellGeo.clear();
    for (const n of this.st.nodes.values()) this.adj.set(n.id, []);
    for (const s of this.st.segments.values()) this.indexSegment(s);
    for (const b of this.st.blocks.values()) this.indexBlock(b);
  }

  // ------------------------------------------------------------------ queries

  node(id: number): RoadNode {
    const n = this.st.nodes.get(id);
    if (!n) throw new Error(`no node ${id}`);
    return n;
  }

  segment(id: number): RoadSegment {
    const s = this.st.segments.get(id);
    if (!s) throw new Error(`no segment ${id}`);
    return s;
  }

  curve(id: number): Curve {
    const c = this.curves.get(id);
    if (!c) throw new Error(`no curve ${id}`);
    return c;
  }

  halfWidth(segId: number): number {
    return roadHalfWidth(this.segment(segId).type);
  }

  segmentsAt(nodeId: number): number[] {
    return this.adj.get(nodeId) ?? [];
  }

  /** Unit direction of a segment leaving the given end node. */
  directionAt(segId: number, nodeId: number): Vec2 {
    const s = this.segment(segId);
    const a = this.node(s.a);
    const b = this.node(s.b);
    let dx: number;
    let dz: number;
    if (s.a === nodeId) {
      dx = s.cx - a.x;
      dz = s.cz - a.z;
      if (Math.hypot(dx, dz) < 1e-6) {
        dx = b.x - a.x;
        dz = b.z - a.z;
      }
    } else {
      dx = s.cx - b.x;
      dz = s.cz - b.z;
      if (Math.hypot(dx, dz) < 1e-6) {
        dx = a.x - b.x;
        dz = a.z - b.z;
      }
    }
    const l = Math.hypot(dx, dz) || 1;
    return { x: dx / l, z: dz / l };
  }

  /** Nodes inside a box. */
  nodesIn(box: { minX: number; minZ: number; maxX: number; maxZ: number }): RoadNode[] {
    const out: RoadNode[] = [];
    for (const n of this.st.nodes.values())
      if (n.x >= box.minX && n.x <= box.maxX && n.z >= box.minZ && n.z <= box.maxZ) out.push(n);
    return out;
  }

  nearestNode(p: Vec2, tol: number): RoadNode | null {
    let best: RoadNode | null = null;
    let bd = tol;
    for (const n of this.st.nodes.values()) {
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d <= bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  /** Nearest segment within tol of p (centre line). */
  nearestSegment(
    p: Vec2,
    tol: number,
    filter?: (id: number) => boolean,
  ): { seg: number; s: number; d: number; x: number; z: number } | null {
    let best: { seg: number; s: number; d: number; x: number; z: number } | null = null;
    for (const id of this.segHash.queryPoint(p.x, p.z, tol + 1)) {
      if (filter && !filter(id)) continue;
      const pr = this.curve(id).project(p);
      if (pr.d <= tol && (!best || pr.d < best.d)) best = { seg: id, s: pr.s, d: pr.d, x: pr.x, z: pr.z };
    }
    return best;
  }

  // ------------------------------------------------------------------ indexing

  indexSegment(s: RoadSegment): void {
    const a = this.node(s.a);
    const b = this.node(s.b);
    const curve = new Curve(v2(a.x, a.z), v2(s.cx, s.cz), v2(b.x, b.z));
    this.curves.set(s.id, curve);
    this.segHash.insert(s.id, curve.bbox(roadHalfWidth(s.type)));
    for (const n of [s.a, s.b]) {
      const list = this.adj.get(n) ?? [];
      if (!list.includes(s.id)) list.push(s.id);
      list.sort((x, y) => x - y);
      this.adj.set(n, list);
    }
  }

  unindexSegment(s: RoadSegment): void {
    this.curves.delete(s.id);
    this.segHash.remove(s.id);
    for (const n of [s.a, s.b]) {
      const list = this.adj.get(n);
      if (list)
        this.adj.set(
          n,
          list.filter((x) => x !== s.id),
        );
    }
  }

  indexBlock(b: ZoneBlock): void {
    const seg = this.segment(b.seg);
    const curve = this.curve(b.seg);
    const hw = roadHalfWidth(seg.type);
    const n = b.cols * ROWS;
    const geo: CellGeo = { xs: new Float64Array(n), zs: new Float64Array(n), ang: new Float64Array(n) };
    for (let c = 0; c < b.cols; c++) {
      const s = b.s0 + (c + 0.5) * CELL;
      const p = curve.pointAt(s);
      const t = curve.tangentAt(s);
      // Left normal of the tangent (x/z plane, y up): (t.z, −t.x).
      const nx = t.z * b.side;
      const nz = -t.x * b.side;
      const ang = Math.atan2(t.z, t.x);
      for (let r = 0; r < ROWS; r++) {
        const off = hw + (r + 0.5) * CELL;
        const i = c * ROWS + r;
        geo.xs[i] = p.x + nx * off;
        geo.zs[i] = p.z + nz * off;
        geo.ang[i] = ang;
        this.cellHash.insert(cellKey(b.id, i), {
          minX: geo.xs[i]! - 1,
          minZ: geo.zs[i]! - 1,
          maxX: geo.xs[i]! + 1,
          maxZ: geo.zs[i]! + 1,
        });
      }
    }
    this.cellGeo.set(b.id, geo);
  }

  unindexBlock(b: ZoneBlock): void {
    const n = b.cols * ROWS;
    for (let i = 0; i < n; i++) this.cellHash.remove(cellKey(b.id, i));
    this.cellGeo.delete(b.id);
  }

  cellCenter(blockId: number, idx: number): Vec2 {
    const g = this.cellGeo.get(blockId)!;
    return { x: g.xs[idx]!, z: g.zs[idx]! };
  }

  cellAngle(blockId: number, idx: number): number {
    return this.cellGeo.get(blockId)!.ang[idx]!;
  }

  cellRect(blockId: number, idx: number, shrink = CELL_OVERLAP_SHRINK): ORect {
    const g = this.cellGeo.get(blockId)!;
    const h = CELL / 2 - shrink;
    return { x: g.xs[idx]!, z: g.zs[idx]!, hw: h, hd: h, angle: g.ang[idx]! };
  }

  // ------------------------------------------------------------------ mutation

  createNode(x: number, z: number): RoadNode {
    const n: RoadNode = { id: this.hooks.nextId(), x, z };
    this.st.nodes.set(n.id, n);
    this.adj.set(n.id, []);
    this.dirty.nodes.add(n.id);
    return n;
  }

  removeNodeIfOrphan(id: number): void {
    if ((this.adj.get(id)?.length ?? 0) > 0) return;
    if (!this.st.nodes.has(id)) return;
    this.st.nodes.delete(id);
    this.adj.delete(id);
    this.dirty.nodes.delete(id);
    this.removed.nodes.add(id);
  }

  /**
   * Add a segment. `layouts` optionally gives each side's column phase (s0) and count; otherwise
   * columns are centred along the segment. Pass `zoned: false` for segments without zoning.
   */
  createSegment(
    a: number,
    b: number,
    c: Vec2,
    type: RoadTypeId,
    opts: {
      id?: number;
      zoned?: boolean;
      layouts?: { left?: [number, number]; right?: [number, number] };
    } = {},
  ): RoadSegment {
    const seg: RoadSegment = {
      id: opts.id ?? this.hooks.nextId(),
      a,
      b,
      cx: c.x,
      cz: c.z,
      type,
      left: 0,
      right: 0,
    };
    this.st.segments.set(seg.id, seg);
    this.indexSegment(seg);
    this.dirty.segments.add(seg.id);
    this.dirty.nodes.add(a);
    this.dirty.nodes.add(b);
    if (opts.zoned !== false && ROAD_TYPES[type].buildable) {
      const len = this.curve(seg.id).length;
      for (const side of [1, -1] as const) {
        const given = side === 1 ? opts.layouts?.left : opts.layouts?.right;
        let s0: number;
        let cols: number;
        if (given) [s0, cols] = given;
        else {
          cols = Math.max(0, Math.floor(len / CELL));
          s0 = (len - cols * CELL) / 2;
        }
        if (cols <= 0) continue;
        const block: ZoneBlock = {
          id: this.hooks.nextId(),
          seg: seg.id,
          side,
          s0,
          cols,
          zone: new Uint8Array(cols * ROWS),
          valid: new Uint8Array(cols * ROWS),
          bld: new Int32Array(cols * ROWS),
        };
        this.st.blocks.set(block.id, block);
        this.indexBlock(block);
        this.dirty.blocks.add(block.id);
        if (side === 1) seg.left = block.id;
        else seg.right = block.id;
      }
    }
    return seg;
  }

  /** Remove a segment and its blocks. Buildings still on the blocks are reported as lost. */
  removeSegment(id: number): void {
    const seg = this.segment(id);
    for (const bid of [seg.left, seg.right]) {
      if (!bid) continue;
      const block = this.st.blocks.get(bid)!;
      const lost = new Set<number>();
      for (const b of block.bld) if (b) lost.add(b);
      this.unindexBlock(block);
      this.st.blocks.delete(bid);
      this.dirty.blocks.delete(bid);
      this.removed.blocks.add(bid);
      for (const b of [...lost].sort((x, y) => x - y)) this.hooks.buildingLost(b);
    }
    this.unindexSegment(seg);
    this.st.segments.delete(id);
    this.dirty.segments.delete(id);
    this.removed.segments.add(id);
    this.dirty.nodes.add(seg.a);
    this.dirty.nodes.add(seg.b);
  }

  /**
   * Split a segment at arc length s into two, keeping the zone grid phase so cells, zones and
   * buildings carry over exactly. Returns the new node and the two halves (a→N, N→b).
   */
  splitSegment(
    id: number,
    s: number,
    ids?: { node?: number; first?: number; second?: number },
  ): { node: RoadNode; first: RoadSegment; second: RoadSegment } {
    const seg = this.segment(id);
    const curve = this.curve(id);
    const t = curve.tAt(s);
    const A = this.node(seg.a);
    const B = this.node(seg.b);
    const halves = splitBezier(v2(A.x, A.z), v2(seg.cx, seg.cz), v2(B.x, B.z), t);
    const p = halves.left[2];
    const node: RoadNode = { id: ids?.node ?? this.hooks.nextId(), x: p.x, z: p.z };
    this.st.nodes.set(node.id, node);
    this.adj.set(node.id, []);
    this.dirty.nodes.add(node.id);
    const len2 = curve.length - s;

    const layouts: {
      first: { left?: [number, number]; right?: [number, number] };
      second: { left?: [number, number]; right?: [number, number] };
    } = {
      first: {},
      second: {},
    };
    const old: { side: 1 | -1; block: ZoneBlock | undefined }[] = [
      { side: 1, block: seg.left ? this.st.blocks.get(seg.left) : undefined },
      { side: -1, block: seg.right ? this.st.blocks.get(seg.right) : undefined },
    ];
    for (const { side, block } of old) {
      const key = side === 1 ? 'left' : 'right';
      const s0 = block ? block.s0 : (curve.length - Math.floor(curve.length / CELL) * CELL) / 2;
      const cols1 = Math.max(0, Math.floor((s - s0) / CELL + 1e-6));
      const cFirst = Math.ceil((s - s0) / CELL - 1e-6);
      const s02 = s0 + cFirst * CELL - s;
      const cols2 = Math.max(0, Math.floor((len2 - s02) / CELL + 1e-6));
      layouts.first[key] = [s0, cols1];
      layouts.second[key] = [s02, cols2];
    }

    // Detach the old blocks' buildings before removal so they are not demolished.
    const transfers: { side: 1 | -1; block: ZoneBlock }[] = [];
    for (const { side, block } of old)
      if (block)
        transfers.push({
          side,
          block: { ...block, zone: block.zone.slice(), valid: block.valid.slice(), bld: block.bld.slice() },
        });
    for (const { block } of old) if (block) block.bld.fill(0);
    this.removeSegment(id);

    const first = this.createSegment(seg.a, node.id, halves.left[1], seg.type, {
      id: ids?.first,
      layouts: layouts.first,
      zoned: seg.left !== 0 || seg.right !== 0,
    });
    const second = this.createSegment(node.id, seg.b, halves.right[1], seg.type, {
      id: ids?.second,
      layouts: layouts.second,
      zoned: seg.left !== 0 || seg.right !== 0,
    });
    if (seg.deck) {
      first.deck = resampleDeck(seg.deck, 0, s);
      second.deck = resampleDeck(seg.deck, s, curve.length);
    }

    for (const { side, block } of transfers) {
      const b1 = this.st.blocks.get(side === 1 ? first.left : first.right);
      const b2 = this.st.blocks.get(side === 1 ? second.left : second.right);
      const cFirst = Math.ceil((s - block.s0) / CELL - 1e-6);
      const moved = new Map<number, { block: number; col: number }>();
      for (let c = 0; c < block.cols; c++) {
        let target: ZoneBlock | undefined;
        let nc: number;
        if (b1 && c < b1.cols) {
          target = b1;
          nc = c;
        } else {
          target = b2;
          nc = c - cFirst;
          if (!b2 || nc < 0 || nc >= b2.cols) target = undefined;
        }
        for (let r = 0; r < ROWS; r++) {
          const oi = c * ROWS + r;
          const bld = block.bld[oi]!;
          if (!target) {
            if (bld) moved.set(bld, { block: -1, col: -1 });
            continue;
          }
          const ni = nc * ROWS + r;
          target.zone[ni] = block.zone[oi]!;
          target.valid[ni] = block.valid[oi]!;
          target.bld[ni] = bld;
          if (bld && !moved.has(bld)) moved.set(bld, { block: target.id, col: nc });
          else if (bld && moved.get(bld)!.block !== target.id) moved.set(bld, { block: -1, col: -1 });
        }
      }
      for (const [bld, m] of [...moved.entries()].sort((x, y) => x[0] - y[0])) {
        if (m.block < 0) this.clearBuildingCells(bld);
        if (m.block < 0) this.hooks.buildingLost(bld);
        else this.hooks.buildingMoved(bld, m.block, m.col);
      }
    }
    return { node, first, second };
  }

  /**
   * Undo a split: merge `first` (a→N) and `second` (N→b) back into the original segment, carrying
   * zones and buildings across. Returns false if the halves changed since.
   */
  mergeSplit(rec: {
    original: {
      id: number;
      a: number;
      b: number;
      cx: number;
      cz: number;
      type: RoadTypeId;
      layouts: { left?: [number, number]; right?: [number, number] };
      deck?: number[];
    };
    node: number;
    first: number;
    second: number;
  }): boolean {
    const first = this.st.segments.get(rec.first);
    const second = this.st.segments.get(rec.second);
    if (!first || !second) return false;
    const deg = this.segmentsAt(rec.node);
    if (deg.length !== 2 || !deg.includes(rec.first) || !deg.includes(rec.second)) return false;
    if (first.a !== rec.original.a || second.b !== rec.original.b) return false;
    const sSplit = this.curve(rec.first).length;
    const snap = (bid: number) => {
      const b = bid ? this.st.blocks.get(bid) : undefined;
      if (!b) return undefined;
      const copy = { ...b, zone: b.zone.slice(), valid: b.valid.slice(), bld: b.bld.slice() };
      b.bld.fill(0);
      return copy;
    };
    const parts = {
      left: [snap(first.left), snap(second.left)] as const,
      right: [snap(first.right), snap(second.right)] as const,
    };
    this.removeSegment(rec.first);
    this.removeSegment(rec.second);
    const o = rec.original;
    const merged = this.createSegment(o.a, o.b, v2(o.cx, o.cz), o.type, {
      id: o.id,
      layouts: o.layouts,
      zoned: !!(o.layouts.left || o.layouts.right),
    });
    if (o.deck) merged.deck = o.deck.slice();
    this.removeNodeIfOrphan(rec.node);
    const moved = new Map<number, { block: number; col: number } | null>();
    for (const side of ['left', 'right'] as const) {
      const target = this.st.blocks.get(side === 'left' ? merged.left : merged.right);
      const [b1, b2] = parts[side];
      if (!target) {
        for (const b of [b1, b2]) if (b) for (const x of b.bld) if (x) moved.set(x, null);
        continue;
      }
      const cFirst = Math.ceil((sSplit - target.s0) / CELL - 1e-6);
      const copyFrom = (src: ZoneBlock | undefined, offset: number) => {
        if (!src) return;
        for (let c = 0; c < src.cols; c++) {
          const nc = c + offset;
          for (let r = 0; r < ROWS; r++) {
            const oi = c * ROWS + r;
            const bld = src.bld[oi]!;
            if (nc < 0 || nc >= target.cols) {
              if (bld) moved.set(bld, null);
              continue;
            }
            const ni = nc * ROWS + r;
            target.zone[ni] = src.zone[oi]!;
            target.valid[ni] = src.valid[oi]!;
            target.bld[ni] = bld;
            if (bld && !moved.has(bld)) moved.set(bld, { block: target.id, col: nc });
          }
        }
      };
      copyFrom(b1, 0);
      copyFrom(b2, cFirst);
    }
    for (const [bld, m] of [...moved.entries()].sort((x, y) => x[0] - y[0])) {
      if (m) this.hooks.buildingMoved(bld, m.block, m.col);
      else {
        this.clearBuildingCells(bld);
        this.hooks.buildingLost(bld);
      }
    }
    return true;
  }

  /** Change a segment's road type in place, keeping its blocks' cell indices. */
  setSegmentType(id: number, type: RoadTypeId): void {
    const seg = this.segment(id);
    for (const bid of [seg.left, seg.right]) if (bid) this.unindexBlock(this.st.blocks.get(bid)!);
    this.unindexSegment(seg);
    seg.type = type;
    this.indexSegment(seg);
    for (const bid of [seg.left, seg.right]) if (bid) this.indexBlock(this.st.blocks.get(bid)!);
    this.dirty.segments.add(id);
    for (const bid of [seg.left, seg.right]) if (bid) this.dirty.blocks.add(bid);
  }

  clearBuildingCells(bld: number): void {
    for (const b of this.st.blocks.values()) {
      let hit = false;
      for (let i = 0; i < b.bld.length; i++) {
        if (b.bld[i] === bld) {
          b.bld[i] = 0;
          hit = true;
        }
      }
      if (hit) this.dirty.blocks.add(b.id);
    }
  }

  // ------------------------------------------------------------------ cell validity

  /** Validity that doesn't depend on other cells: bounds, water, slope, roads, placed buildings. */
  cellStaticValid(blockId: number, idx: number): boolean {
    const r = this.cellRect(blockId, idx, 0);
    const h = CELL / 2;
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    const pts: Vec2[] = [{ x: r.x, z: r.z }];
    for (const [u, v] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const) {
      pts.push({ x: r.x + (u * c - v * s) * (h - 0.5), z: r.z + (u * s + v * c) * (h - 0.5) });
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      if (p.x < 0 || p.z < 0 || p.x > MAP_SIZE || p.z > MAP_SIZE) return false;
      const y = this.terrain.heightAt(p.x, p.z);
      if (y < SHORE_HEIGHT) return false;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    if ((hi - lo) / (CELL * Math.SQRT2) > MAX_CELL_SLOPE) return false;
    for (const sid of this.segHash.queryPoint(r.x, r.z, CELL)) {
      const hw = this.halfWidth(sid);
      const curve = this.curve(sid);
      for (const p of pts) if (curve.project(p).d < hw - 0.05) return false;
    }
    const bld = this.st.blocks.get(blockId)!.bld[idx]!;
    if (this.hooks.footprintBlocked(this.cellRect(blockId, idx), bld)) return false;
    return true;
  }

  /**
   * Recompute validity for every cell centred in `box`, in priority order (occupied cells first,
   * then lower rows, older blocks, lower columns). Cells outside the box are fixed obstacles.
   * Cells that become invalid lose their zoning; occupied cells that fail static checks report
   * their buildings as lost.
   */
  revalidate(box: Box): void {
    const keys = this.cellHash.query(box);
    const inBox = new Set(keys);
    const rank = (k: number) => {
      const b = this.st.blocks.get(keyBlock(k))!;
      const i = keyIdx(k);
      const occupied = b.bld[i] ? 0 : 1;
      return [occupied, i % ROWS, b.id, Math.floor(i / ROWS)];
    };
    const order = keys
      .map((k) => ({ k, r: rank(k) }))
      .sort((x, y) => x.r[0]! - y.r[0]! || x.r[1]! - y.r[1]! || x.r[2]! - y.r[2]! || x.r[3]! - y.r[3]!);
    const accepted = new Set<number>();
    const lost = new Set<number>();
    for (const { k } of order) {
      const bid = keyBlock(k);
      const i = keyIdx(k);
      const b = this.st.blocks.get(bid)!;
      let ok = this.cellStaticValid(bid, i);
      if (ok) {
        const rect = this.cellRect(bid, i);
        for (const other of this.cellHash.queryPoint(rect.x, rect.z, CELL * 1.5)) {
          if (other === k) continue;
          const obid = keyBlock(other);
          const oi = keyIdx(other);
          const ob = this.st.blocks.get(obid)!;
          const blocking = inBox.has(other) ? accepted.has(other) : ob.valid[oi] === 1;
          if (!blocking) continue;
          if (ob.bld[oi] && ob.bld[oi] === b.bld[i]) continue; // same building
          if (rectsOverlap(rect, this.cellRect(obid, oi))) {
            ok = false;
            break;
          }
        }
      }
      const was = b.valid[i];
      if (ok) accepted.add(k);
      b.valid[i] = ok ? 1 : 0;
      if (!ok && b.zone[i] !== ZONE_NONE) b.zone[i] = ZONE_NONE;
      if (!ok && b.bld[i]) lost.add(b.bld[i]!);
      if (was !== b.valid[i]) this.dirty.blocks.add(bid);
    }
    for (const bld of [...lost].sort((x, y) => x - y)) {
      this.clearBuildingCells(bld);
      this.hooks.buildingLost(bld);
    }
  }

  /** Cell keys (block·1024 + index) whose centres lie within `r` of any point on the path. */
  cellsNearPath(points: Vec2[], r: number): number[] {
    const out = new Set<number>();
    const pts = points.length === 1 ? [points[0]!, points[0]!] : points;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      const box = {
        minX: Math.min(a.x, b.x) - r,
        minZ: Math.min(a.z, b.z) - r,
        maxX: Math.max(a.x, b.x) + r,
        maxZ: Math.max(a.z, b.z) + r,
      };
      for (const key of this.cellHash.query(box)) {
        const c = this.cellCenter(keyBlock(key), keyIdx(key));
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((c.x - a.x) * dx + (c.z - a.z) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(a.x + dx * t - c.x, a.z + dz * t - c.z) <= r) out.add(key);
      }
    }
    return [...out].sort((x, y) => x - y);
  }

  /** Box around a segment's corridor plus its zone depth. */
  segmentInfluenceBox(segId: number): Box {
    return this.curve(segId).bbox(this.halfWidth(segId) + ROWS * CELL + CELL);
  }

  totalLength(filter?: (s: RoadSegment) => boolean): number {
    let sum = 0;
    for (const s of this.st.segments.values()) if (!filter || filter(s)) sum += this.curve(s.id).length;
    return sum;
  }
}

export { keyBlock, keyIdx };

/** The stretch [s0, s1] of a viaduct's deck heights, resampled from its own start (M13). */
function resampleDeck(deck: number[], s0: number, s1: number): number[] {
  const step = GRADING.step;
  const n = Math.max(2, Math.ceil((s1 - s0) / step - 1e-6) + 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++)
    out.push(Math.round(profileAt({ step, h: deck }, s0 + Math.min(s1 - s0, i * step)) * 100) / 100);
  return out;
}
