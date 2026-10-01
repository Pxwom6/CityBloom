import { Group, Mesh, MeshLambertMaterial } from 'three';
import type { ClientWorld, NetChanges } from '../client/world';
import { Curve, angleOf, v2, type Vec2 } from '../sim/geom';
import { GeoBuffer, mergeChunks, type GeoChunk } from './geoBuffer';
import {
  buildBridgeStructure,
  buildJunction,
  buildJunctionPaint,
  buildLevelCrossing,
  type BarrierArm,
  buildRoundabout,
  buildSegmentRibbon,
  buildTramJunction,
  buildTramTrack,
  type Approach,
  ZEBRA,
} from './roadMesh';
import { ZONE_C } from '../data/zones';
import { JUNCTION } from '../data/balance';
import { ROAD_TYPES, isRail } from '../data/roads';
import { deckAt } from '../sim/world/bridge';
import { RAIL_TRACK_OFFSET, ROAD_STYLES, tramOffset } from './roadStyle';
import { GRADE_GLSL, ROAD_SNOW_GLSL, SNOW_NOISE_GLSL, type WeatherUniforms } from './weather';

/**
 * The regional railway (M20) runs north–south this far east of the regional highway's line, off the
 * map's west edge; the link into the map leaves it on a curve of this radius.
 */
export const REGIONAL_RAIL_DX = 48;
export const REGIONAL_RAIL_CURVE = 60;

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

  /**
   * Snow on each road, looked up by the id every vertex carries, and wet asphalt (M22). Called
   * once by the renderer before the first frame.
   */
  useWeather(u: WeatherUniforms): void {
    const m = this.material;
    m.customProgramCacheKey = () => 'road-weather';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aTag;
uniform sampler2D uRoadSnow;
varying float vRoadSnow;
varying vec3 vWPos;
varying float vUp;
${ROAD_SNOW_GLSL}`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vRoadSnow = roadSnowAt(aTag);
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
vUp = normalize(mat3(modelMatrix) * objectNormal).y;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uWet;
uniform vec2 uGrade;
varying float vRoadSnow;
varying vec3 vWPos;
varying float vUp;
${SNOW_NOISE_GLSL}
${GRADE_GLSL}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
{
  float up = smoothstep(0.5, 0.85, vUp);
  // Wet asphalt: darker and a little blue.
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.7, 0.73, 0.79), uWet * up);
  // Snow: patchy at first, then packed grey slush that still reads as road against white fields.
  float n = wNoise(vWPos.xz * 0.3) * 0.6 + wNoise(vWPos.xz * 1.6) * 0.4;
  float cover = smoothstep(0.0, 0.5, vRoadSnow * 1.7 - n * 0.65) * up;
  vec3 slush = vec3(0.76, 0.78, 0.81) * (0.92 + 0.08 * n);
  diffuseColor.rgb = mix(diffuseColor.rgb, slush, cover * 0.85);
  diffuseColor.rgb = weatherGrade(diffuseColor.rgb);
}`,
        );
    };
    m.needsUpdate = true;
  }

  constructor(private world: ClientWorld) {
    this.h = (x, z) => Math.max(world.heightAt(x, z), 0);
    for (const id of world.netState.segments.keys()) this.dirtySegs.add(id);
    for (const id of world.netState.nodes.keys()) this.dirtyNodes.add(id);
    world.onNet((c) => this.onChanges(c));
    // A rail link laid (or undone) after loading (Phase 2 review): its scenery past the edge too.
    world.onRailway(() => {
      const old = this.group.getObjectByName('regional-railway') as Mesh | undefined;
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
      }
      this.buildRegionalRailway();
      if (world.railway) {
        this.dirtyNodes.add(world.railway.outside);
        this.dirtySegs.add(world.railway.segment);
        this.flush();
      }
    });
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
  private nodeLayout(nodeId: number): {
    trims: Map<number, number>;
    approaches: Approach[];
    ring?: number;
    /** Approaches painted with a zebra crossing, or a give-way line (M27). */
    zebra?: Set<number>;
    giveWay?: Set<number>;
  } | null {
    const net = this.world.net;
    const node = this.world.netState.nodes.get(nodeId);
    if (!node) return null;
    const segs = net.segmentsAt(nodeId);
    const trims = new Map<number, number>();
    if (node.roundabout) {
      // Roads stop where their edges meet the ring (M19).
      const outer = node.roundabout + JUNCTION.ringWidth / 2;
      const approaches: Approach[] = [];
      for (const sid of segs) {
        const style = ROAD_STYLES[net.segment(sid).type];
        const curve = net.curve(sid);
        const t = Math.min(curve.length * 0.45, Math.sqrt(Math.max(1, outer ** 2 - style.asphaltHalf ** 2)));
        trims.set(sid, t);
        const seg = net.segment(sid);
        const s = seg.a === nodeId ? t : curve.length - t;
        const tan = curve.tangentAt(s);
        approaches.push({ p: curve.pointAt(s), dir: seg.a === nodeId ? tan : v2(-tan.x, -tan.z), style });
      }
      return { trims, approaches, ring: node.roundabout };
    }
    if (nodeId === this.world.highway.outside) {
      // Tuck the connector under the regional highway instead of overlapping it.
      for (const sid of segs) trims.set(sid, ROAD_STYLES.highway.totalHalf);
      return { trims, approaches: [] };
    }
    if (nodeId === this.world.railway?.outside) {
      // The rail link stops where it curves into the regional railway (drawn as scenery).
      for (const sid of segs) trims.set(sid, REGIONAL_RAIL_DX + REGIONAL_RAIL_CURVE);
      return { trims, approaches: [] };
    }
    if (segs.length < 2) return { trims, approaches: [] };
    // Railway joints and switches (M20): the tracks simply run on into each other.
    if (segs.every((sid) => isRail(net.segment(sid).type))) return { trims, approaches: [] };
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
      approaches.push({ p, dir, style: it.style, seg: it.sid });
    });
    return { trims, approaches, ...this.junctionPaint(approaches, trims) };
  }

  /**
   * Which approaches get a zebra crossing (M27): every town road into a busy junction, one of
   * three or more town roads where an avenue or boulevard meets, or a crossroads by the shops.
   * Elsewhere a side road narrower than the road it joins gets a give-way line.
   */
  private junctionPaint(
    approaches: Approach[],
    trims: Map<number, number>,
  ): { zebra: Set<number>; giveWay: Set<number> } {
    const zebra = new Set<number>();
    const giveWay = new Set<number>();
    const roads = approaches.filter((a) => a.style.town && a.seg !== undefined);
    if (roads.length < 3 || approaches.some((a) => a.style.rail)) return { zebra, giveWay };
    const st = this.world.netState;
    const net = this.world.net;
    const shops = roads.some((a) => {
      const s = st.segments.get(a.seg!);
      return [s?.left, s?.right].some((b) => b !== undefined && !!st.blocks.get(b)?.zone.includes(ZONE_C));
    });
    const busy = roads.some((a) => a.style.medianHalf > 0) || (roads.length >= 4 && shops);
    const widest = Math.max(...roads.map((a) => a.style.asphaltHalf));
    for (const a of roads) {
      const id = a.seg!;
      if (busy) {
        // Only where the road is long enough to hold a crossing at both ends.
        if (net.curve(id).length - 2 * (trims.get(id) ?? 0) >= 2 * (ZEBRA.stop + 2) && !this.world.deck(id))
          zebra.add(id);
      } else if (a.style.asphaltHalf < widest) giveWay.add(id);
    }
    return { zebra, giveWay };
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
    // Each vertex carries its road's or junction's id, for snow per road (M22).
    const geo: GeoChunk = buf.trimmed();
    geo.tag = new Float32Array(buf.n).fill(Number(key.slice(1)));
    this.elements.set(key, { chunk, geo });
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
      const oneway = seg.oneway ? { dir: seg.oneway, lanes: ROAD_TYPES[seg.type].lanes } : undefined;
      // Lane markings stop short of a junction's crossing or give-way line (M27).
      const clear = (n: number): number => {
        const l = layoutOf(n);
        return l?.zebra?.has(id) ? ZEBRA.stop + 0.9 : l?.giveWay?.has(id) ? 1.4 : 1;
      };
      buildSegmentRibbon(buf, curve, ROAD_STYLES[seg.type], ta, curve.length - tb, this.h, deckFn, oneway, [
        clear(seg.a),
        clear(seg.b),
      ]);
      if (deck && deckFn) buildBridgeStructure(buf, curve, ROAD_STYLES[seg.type], this.h, deckFn);
      if (seg.tram && ROAD_TYPES[seg.type].tram) {
        const hs = deckFn
          ? (x: number, z: number) => Math.max(this.h(x, z), deckFn(curve.project({ x, z }).s))
          : this.h;
        buildTramTrack(buf, curve, ROAD_STYLES[seg.type], ta, curve.length - tb, hs, tramOffset(seg.type));
      }
      this.setElement(`s${id}`, curve.pointAt(curve.length / 2), buf);
    }
    for (const id of this.dirtyNodes) {
      const node = st.nodes.get(id);
      const layout = node ? layoutOf(id) : null;
      if (this.crossings.delete(id)) this.crossingVersion++;
      if (node && layout?.ring) {
        const buf = new GeoBuffer(4096);
        const style =
          ROAD_STYLES[layout.approaches.some((a) => a.style === ROAD_STYLES.avenue) ? 'avenue' : 'street'];
        buildRoundabout(
          buf,
          v2(node.x, node.z),
          layout.ring,
          JUNCTION.ringWidth,
          layout.approaches,
          style,
          this.h,
        );
        this.setElement(`n${id}`, v2(node.x, node.z), buf);
        continue;
      }
      if (!node || !layout || layout.approaches.length < 2) {
        this.setElement(`n${id}`, v2(0, 0), null);
        continue;
      }
      const buf = new GeoBuffer(256);
      const centre = v2(node.x, node.z);
      buildJunction(buf, centre, layout.approaches, this.h);
      if (layout.zebra && layout.giveWay)
        buildJunctionPaint(buf, layout.approaches, this.h, layout.zebra, layout.giveWay);
      this.decorateJunction(buf, centre, layout.approaches, id);
      this.setElement(`n${id}`, centre, buf);
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

  /** Level crossings' barrier arms by node (drawn moving by render/crossings.ts), and a change count. */
  readonly crossings = new Map<number, BarrierArm[]>();
  crossingVersion = 0;

  /** Level crossings and tram track through a junction (M20). */
  private decorateJunction(buf: GeoBuffer, centre: Vec2, approaches: Approach[], node: number): void {
    const st = this.world.netState;
    const rail = approaches.filter((a) => a.style.rail);
    const roads = approaches.filter((a) => !a.style.rail);
    if (rail.length === 2 && roads.length) {
      const arms: BarrierArm[] = [];
      buildLevelCrossing(buf, [rail[0]!, rail[1]!], roads, RAIL_TRACK_OFFSET, this.h, arms);
      this.crossings.set(node, arms);
      this.crossingVersion++;
    }
    const tram = roads.filter((a) => a.seg !== undefined && st.segments.get(a.seg)?.tram);
    if (tram.length < 2) return;
    // Pair the tracked roads straightest first: each carries on into the one most nearly opposite.
    const cands: { i: number; j: number; turn: number }[] = [];
    for (let i = 0; i < tram.length; i++)
      for (let j = i + 1; j < tram.length; j++) {
        const dot = tram[i]!.dir.x * tram[j]!.dir.x + tram[i]!.dir.z * tram[j]!.dir.z;
        cands.push({ i, j, turn: dot });
      }
    cands.sort((a, b) => a.turn - b.turn || a.i - b.i || a.j - b.j);
    const used = new Set<number>();
    const pairs: Parameters<typeof buildTramJunction>[2] = [];
    for (const c of cands) {
      if (used.has(c.i) || used.has(c.j) || c.turn > 0.5) continue;
      used.add(c.i);
      used.add(c.j);
      const off = (a: Approach) => tramOffset(st.segments.get(a.seg!)!.type);
      pairs.push([
        { a: tram[c.i]!, offset: off(tram[c.i]!) },
        { a: tram[c.j]!, offset: off(tram[c.j]!) },
      ]);
    }
    if (pairs.length) buildTramJunction(buf, centre, pairs, this.h);
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
    this.buildRegionalRailway();
  }

  /**
   * The regional railway (M20, scenery): north–south between the regional highway and the map,
   * running away from the highway's connector, with the link into the map curving off it.
   */
  private buildRegionalRailway(): void {
    const r = this.world.railway;
    const link = r ? this.world.netState.nodes.get(r.outside) : undefined;
    if (!r || !link) return;
    const hw = this.world.gen.params.highway;
    const x = hw.lineX + REGIONAL_RAIL_DX;
    const away = Math.sign(link.z - hw.connectZ) || 1;
    const rad = REGIONAL_RAIL_CURVE;
    const buf = new GeoBuffer(8192);
    const style = ROAD_STYLES.rail;
    const bend = new Curve(v2(x + rad, link.z), v2(x, link.z), v2(x, link.z + away * rad));
    buildSegmentRibbon(buf, bend, style, 0, bend.length, this.h);
    const end = away > 0 ? 2048 + 3000 : -3000;
    const step = 400 * away;
    for (let z = link.z + away * rad; away > 0 ? z < end : z > end; z += step) {
      const curve = new Curve(v2(x, z), v2(x, z + step / 2), v2(x, z + step));
      buildSegmentRibbon(buf, curve, style, 0, curve.length, this.h);
    }
    const mesh = new Mesh(mergeChunks([buf.trimmed()]), this.material);
    mesh.receiveShadow = true;
    mesh.name = 'regional-railway';
    this.group.add(mesh);
  }

  /** Is (x, z) on a road corridor? Used to keep trees off roads. */
  onRoad(x: number, z: number, margin = 1): boolean {
    const hit = this.world.net.nearestSegment({ x, z }, 16 + margin);
    if (!hit) return false;
    return hit.d <= this.world.net.halfWidth(hit.seg) + margin;
  }
}
