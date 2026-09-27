import { Group, Mesh, MeshLambertMaterial } from 'three';
import type { ClientWorld, NetChanges } from '../client/world';
import { Curve, angleOf, v2, type Vec2 } from '../sim/geom';
import { GeoBuffer, mergeChunks, type GeoChunk } from './geoBuffer';
import { buildBridgeStructure, buildJunction, buildSegmentRibbon, type Approach } from './roadMesh';
import { deckAt } from '../sim/world/bridge';
import { ROAD_STYLES } from './roadStyle';

const CHUNK = 512;

interface Element {
  chunk: number;
  geo: GeoChunk;
}

/**
 * Roads as chunk-merged meshes: each segment ribbon and junction is built once and merged into
 * its 256 m chunk; only chunks touched by a change are rebuilt.
 */
export class RoadRenderer {
  readonly group = new Group();
  readonly material = new MeshLambertMaterial({
    vertexColors: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  private elements = new Map<string, Element>();
  private chunks = new Map<number, { mesh: Mesh | null; keys: Set<string> }>();
  private dirtyChunks = new Set<number>();
  private dirtySegs = new Set<number>();
  private dirtyNodes = new Set<number>();
  private h: (x: number, z: number) => number;

  constructor(private world: ClientWorld) {
    this.h = (x, z) => Math.max(world.heightAt(x, z), 0);
    for (const id of world.netState.segments.keys()) this.dirtySegs.add(id);
    for (const id of world.netState.nodes.keys()) this.dirtyNodes.add(id);
    world.onNet((c) => this.onChanges(c));
    this.buildRegionalHighway();
    this.flush();
  }

  private onChanges(c: NetChanges): void {
    const st = this.world.netState;
    for (const id of c.segments) {
      this.dirtySegs.add(id);
      const s = st.segments.get(id);
      if (s) {
        this.dirtyNodes.add(s.a);
        this.dirtyNodes.add(s.b);
      }
    }
    for (const id of c.nodes) {
      this.dirtyNodes.add(id);
      // A node's degree changes the trims of all its segments.
      for (const sid of this.world.net.segmentsAt(id)) this.dirtySegs.add(sid);
    }
    this.flush();
  }

  /** Trim distance at a node for each incident segment, or 0 where the road simply continues. */
  private nodeLayout(nodeId: number): { trims: Map<number, number>; approaches: Approach[] } | null {
    const net = this.world.net;
    const node = this.world.netState.nodes.get(nodeId);
    if (!node) return null;
    const segs = net.segmentsAt(nodeId);
    const trims = new Map<number, number>();
    if (nodeId === this.world.highway.outside) {
      // Tuck the connector under the regional highway instead of overlapping it.
      for (const sid of segs) trims.set(sid, ROAD_STYLES.highway.totalHalf);
      return { trims, approaches: [] };
    }
    if (segs.length < 2) return { trims, approaches: [] };
    const items = segs.map((sid) => {
      const d = net.directionAt(sid, nodeId);
      return { sid, dir: d, ang: angleOf(d), style: ROAD_STYLES[net.segment(sid).type] };
    });
    items.sort((a, b) => a.ang - b.ang);
    const gaps = items.map((it, i) => {
      const next = items[(i + 1) % items.length]!;
      let g = next.ang - it.ang;
      if (g <= 0) g += Math.PI * 2;
      return g;
    });
    const sameType = items.every((it) => it.style === items[0]!.style);
    if (items.length === 2 && sameType && Math.min(gaps[0]!, gaps[1]!) > (150 * Math.PI) / 180)
      return { trims, approaches: [] };
    const maxHalf = Math.max(...items.map((i) => i.style.totalHalf));
    const approaches: Approach[] = [];
    items.forEach((it, i) => {
      const gap = Math.min(gaps[i]!, gaps[(i - 1 + items.length) % items.length]!);
      const trim = Math.min(
        maxHalf * 3,
        Math.max(maxHalf, maxHalf / Math.tan(Math.min(gap, Math.PI * 0.999) / 2)),
      );
      const curve = net.curve(it.sid);
      const seg = net.segment(it.sid);
      const t = Math.min(trim, curve.length * 0.45);
      trims.set(it.sid, t);
      const s = seg.a === nodeId ? t : curve.length - t;
      const p = curve.pointAt(s);
      const tan = curve.tangentAt(s);
      const dir = seg.a === nodeId ? tan : v2(-tan.x, -tan.z);
      approaches.push({ p, dir, style: it.style });
    });
    return { trims, approaches };
  }

  private setElement(key: string, anchor: Vec2, buf: GeoBuffer | null): void {
    const old = this.elements.get(key);
    if (old) {
      this.chunks.get(old.chunk)?.keys.delete(key);
      this.dirtyChunks.add(old.chunk);
      this.elements.delete(key);
    }
    if (!buf || buf.n === 0) return;
    const chunk = Math.floor(anchor.x / CHUNK) * 1000 + Math.floor(anchor.z / CHUNK);
    this.elements.set(key, { chunk, geo: buf.trimmed() });
    let c = this.chunks.get(chunk);
    if (!c) this.chunks.set(chunk, (c = { mesh: null, keys: new Set() }));
    c.keys.add(key);
    this.dirtyChunks.add(chunk);
  }

  private flush(): void {
    const st = this.world.netState;
    const net = this.world.net;
    const layouts = new Map<number, ReturnType<RoadRenderer['nodeLayout']>>();
    const layoutOf = (n: number) => {
      if (!layouts.has(n)) layouts.set(n, this.nodeLayout(n));
      return layouts.get(n)!;
    };
    for (const id of this.dirtySegs) {
      const seg = st.segments.get(id);
      if (!seg) {
        this.setElement(`s${id}`, v2(0, 0), null);
        continue;
      }
      const curve = net.curve(id);
      const ta = layoutOf(seg.a)?.trims.get(id) ?? 0;
      const tb = layoutOf(seg.b)?.trims.get(id) ?? 0;
      const buf = new GeoBuffer(2048);
      const deck = this.world.deck(id);
      const deckFn = deck ? (s: number) => deckAt(deck, s) : undefined;
      buildSegmentRibbon(buf, curve, ROAD_STYLES[seg.type], ta, curve.length - tb, this.h, deckFn);
      if (deck && deckFn) buildBridgeStructure(buf, curve, ROAD_STYLES[seg.type], this.h, deckFn);
      this.setElement(`s${id}`, curve.pointAt(curve.length / 2), buf);
    }
    for (const id of this.dirtyNodes) {
      const node = st.nodes.get(id);
      const layout = node ? layoutOf(id) : null;
      if (!node || !layout || layout.approaches.length < 2) {
        this.setElement(`n${id}`, v2(0, 0), null);
        continue;
      }
      const buf = new GeoBuffer(256);
      buildJunction(buf, v2(node.x, node.z), layout.approaches, this.h);
      this.setElement(`n${id}`, v2(node.x, node.z), buf);
    }
    this.dirtySegs.clear();
    this.dirtyNodes.clear();
    for (const ck of this.dirtyChunks) {
      const c = this.chunks.get(ck);
      if (!c) continue;
      if (c.mesh) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        c.mesh = null;
      }
      if (!c.keys.size) continue;
      const parts = [...c.keys].sort().map((k) => this.elements.get(k)!.geo);
      const mesh = new Mesh(mergeChunks(parts), this.material);
      mesh.receiveShadow = true;
      mesh.name = `roads-${ck}`;
      c.mesh = mesh;
      this.group.add(mesh);
    }
    this.dirtyChunks.clear();
  }

  /** The ground moved in `box` (earthworks, M13): redrape the roads and junctions there. */
  refresh(box: { minX: number; minZ: number; maxX: number; maxZ: number }): void {
    for (const id of this.world.net.segHash.query(box)) {
      this.dirtySegs.add(id);
      const s = this.world.netState.segments.get(id);
      if (s) {
        this.dirtyNodes.add(s.a);
        this.dirtyNodes.add(s.b);
      }
    }
    this.flush();
  }

  /** The regional highway running north–south outside the map (scenery). */
  private buildRegionalHighway(): void {
    const hw = this.world.gen.params.highway;
    const buf = new GeoBuffer(8192);
    const style = ROAD_STYLES.highway;
    const z0 = -3000;
    const z1 = 2048 + 3000;
    const step = 400;
    for (let z = z0; z < z1; z += step) {
      const curve = new Curve(v2(hw.lineX, z), v2(hw.lineX, z + step / 2), v2(hw.lineX, z + step));
      buildSegmentRibbon(buf, curve, style, 0, curve.length, this.h);
    }
    const mesh = new Mesh(mergeChunks([buf.trimmed()]), this.material);
    mesh.receiveShadow = true;
    mesh.name = 'regional-highway';
    this.group.add(mesh);
  }

  /** Is (x, z) on a road corridor? Used to keep trees off roads. */
  onRoad(x: number, z: number, margin = 1): boolean {
    const hit = this.world.net.nearestSegment({ x, z }, 16 + margin);
    if (!hit) return false;
    return hit.d <= this.world.net.halfWidth(hit.seg) + margin;
  }
}
