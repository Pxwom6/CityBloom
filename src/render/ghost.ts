import {
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  type Material,
} from 'three';
import { GRADING, type RoadTypeId } from '../data/roads';
import { Curve, v2, type Vec2 } from '../sim/geom';
import { profileAt } from '../sim/world/grading';
import { GeoBuffer, mergeChunks } from './geoBuffer';
import { ROAD_STYLES } from './roadStyle';
import { RoadTint, type RoadTintPiece } from './roadTint';

const OK = new Color('#3fa7ff');
const BAD = new Color('#ff4d4d');
const WARN = new Color('#ffb020');
const VIADUCT = new Color('#a98bff');
const CUT = new Color('#c8894f');
const FILL = new Color('#f4f1e6');

/** A road piece's graded profile from a build preview (M13), for the ghost. */
export interface GhostProfile {
  step: number;
  h: number[];
  ground: number[];
  raised: number[];
  /** Sample where grading failed, or −1. */
  fail: number;
}

/** Translucent tool feedback: road ghosts, highlights, brush and snap markers. */
export class GhostRenderer {
  readonly group = new Group();
  private roadMesh: Mesh | null = null;
  private highlight: Mesh | null = null;
  private roadMat = new MeshBasicMaterial({
    color: OK,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  });
  private hiMat = new MeshBasicMaterial({
    color: BAD,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  });
  private coverage: RoadTint;
  private brush: Mesh;
  private snap: Mesh;
  private marker: Mesh;

  constructor(private heightAt: (x: number, z: number) => number) {
    this.coverage = new RoadTint(heightAt, 'sequential', 0.8, 0.01);
    this.group.add(this.coverage.group);
    const ringMat = (c: Color, o: number): Material =>
      new MeshBasicMaterial({
        color: c,
        transparent: true,
        opacity: o,
        depthWrite: false,
        side: DoubleSide,
        depthTest: false,
      });
    this.brush = new Mesh(
      new RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2),
      ringMat(new Color('#ffffff'), 0.8),
    );
    this.snap = new Mesh(
      new RingGeometry(1.8, 2.6, 24).rotateX(-Math.PI / 2),
      ringMat(new Color('#ffe066'), 0.95),
    );
    this.marker = new Mesh(new RingGeometry(2.5, 4, 24).rotateX(-Math.PI / 2), ringMat(BAD, 0.9));
    for (const m of [this.brush, this.snap, this.marker]) {
      m.visible = false;
      m.renderOrder = 20;
      this.group.add(m);
    }
  }

  private y(x: number, z: number): number {
    return Math.max(0, this.heightAt(x, z));
  }

  private ribbon(pieces: { a: Vec2; c: Vec2; b: Vec2 }[], half: number): BufferGeometry | null {
    const buf = new GeoBuffer(512);
    const col = new Color('#ffffff');
    for (const p of pieces) {
      const curve = new Curve(p.a, p.c, p.b);
      const n = Math.max(1, Math.ceil(curve.length / 3));
      for (let i = 0; i < n; i++) {
        const s0 = (curve.length * i) / n;
        const s1 = (curve.length * (i + 1)) / n;
        const a = curve.pointAt(s0);
        const b = curve.pointAt(s1);
        const ta = curve.tangentAt(s0);
        const tb = curve.tangentAt(s1);
        const pt = (p: Vec2, t: Vec2, o: number) => {
          const x = p.x + t.z * o;
          const z = p.z - t.x * o;
          return [x, this.y(x, z) + 0.5, z];
        };
        buf.quad(pt(a, ta, -half), pt(a, ta, half), pt(b, tb, half), pt(b, tb, -half), col);
      }
    }
    return buf.n ? mergeChunks([buf.trimmed()]) : null;
  }

  showRoad(
    pieces: { a: Vec2; c: Vec2; b: Vec2 }[] | null,
    type: RoadTypeId,
    state: 'ok' | 'bad' | 'pending',
    grade?: { limit: number; pieces: (GhostProfile | null)[] } | null,
  ): void {
    if (this.roadMesh) {
      this.group.remove(this.roadMesh);
      this.roadMesh.geometry.dispose();
      this.roadMesh = null;
    }
    if (!pieces || !pieces.length) return;
    const graded =
      grade && grade.pieces.some((p) => p) && (state !== 'bad' || grade.pieces.some((p) => p && p.fail >= 0));
    if (graded) {
      const geo = this.gradedRibbon(pieces, ROAD_STYLES[type].totalHalf, grade);
      if (!geo) return;
      this.roadMesh = new Mesh(geo, this.gradedMat);
      this.roadMesh.renderOrder = 10;
      this.group.add(this.roadMesh);
      return;
    }
    const geo = this.ribbon(pieces, ROAD_STYLES[type].totalHalf);
    if (!geo) return;
    this.roadMat.color.copy(state === 'ok' ? OK : state === 'bad' ? BAD : WARN);
    this.roadMesh = new Mesh(geo, this.roadMat);
    this.roadMesh.renderOrder = 10;
    this.group.add(this.roadMesh);
  }

  /** Last graded ghost: how many quads were drawn in each colour (for tests). */
  gradeStats = { ok: 0, warn: 0, bad: 0, viaduct: 0, posts: 0 };

  private gradedMat = new MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    // Seen through hills: a cutting's road runs below today's ground.
    depthTest: false,
  });

  /**
   * The ghost of a graded road (M13): at the height the road will be built, coloured by how steep
   * it climbs against its type's limit (blue, turning amber near it, red where it's too steep;
   * violet on a viaduct), with posts down to the ground where it's cut or filled.
   */
  private gradedRibbon(
    pieces: { a: Vec2; c: Vec2; b: Vec2 }[],
    half: number,
    grade: { limit: number; pieces: (GhostProfile | null)[] },
  ): BufferGeometry | null {
    const buf = new GeoBuffer(1024);
    const stats = { ok: 0, warn: 0, bad: 0, viaduct: 0, posts: 0 };
    const col = new Color();
    pieces.forEach((p, k) => {
      const prof = grade.pieces[k] ?? null;
      const curve = new Curve(p.a, p.c, p.b);
      const L = curve.length;
      // Too-steep samples: a cutting deeper than allowed, a viaduct at an end; else all of a
      // failing piece (its ends are further apart in height than it can climb).
      let bad: (i: number) => boolean = () => false;
      if (prof && prof.fail >= 0) {
        const n = prof.h.length;
        const flagged = prof.h.map(
          (h, i) =>
            prof.ground[i]! - h > GRADING.maxCut ||
            (!!prof.raised[i] && (prof.raised[0] || prof.raised[n - 1])) ||
            false,
        );
        bad = flagged.some((f) => f) ? (i) => !!flagged[i] : () => true;
      }
      const hAt = (s: number, x: number, z: number) => (prof ? profileAt(prof, s) : this.y(x, z)) + 0.5;
      const n = Math.max(1, Math.ceil(L / 3));
      for (let i = 0; i < n; i++) {
        const s0 = (L * i) / n;
        const s1 = (L * (i + 1)) / n;
        const a = curve.pointAt(s0);
        const b = curve.pointAt(s1);
        const ta = curve.tangentAt(s0);
        const tb = curve.tangentAt(s1);
        const pt = (q: Vec2, t: Vec2, o: number, s: number) => {
          const x = q.x + t.z * o;
          const z = q.z - t.x * o;
          return [x, hAt(s, q.x, q.z), z];
        };
        const si = prof ? Math.min(prof.h.length - 1, Math.round((s0 + s1) / 2 / prof.step)) : 0;
        if (prof && bad(si)) {
          col.copy(BAD);
          stats.bad++;
        } else if (prof && prof.raised[si]) {
          col.copy(VIADUCT);
          stats.viaduct++;
        } else {
          // Grade over about 8 m around this stretch.
          const m = (s0 + s1) / 2;
          const g = prof
            ? Math.abs(profileAt(prof, Math.min(L, m + 4)) - profileAt(prof, Math.max(0, m - 4))) /
              (Math.min(L, m + 4) - Math.max(0, m - 4) || 1)
            : 0;
          const t = Math.min(1, Math.max(0, (g / grade.limit - 0.55) / 0.45));
          col.copy(OK).lerp(WARN, t);
          if (t > 0.5) stats.warn++;
          else stats.ok++;
        }
        buf.quad(pt(a, ta, -half, s0), pt(a, ta, half, s0), pt(b, tb, half, s1), pt(b, tb, -half, s1), col);
      }
      // Posts from the road down (fill) or up (cut) to today's ground, every 12 m.
      if (prof)
        for (let s = 6; s < L - 3; s += 12) {
          const q = curve.pointAt(s);
          const t = curve.tangentAt(s);
          const top = hAt(s, q.x, q.z) - 0.5;
          const ground = Math.max(0, this.y(q.x, q.z));
          if (Math.abs(top - ground) < 1) continue;
          col.copy(top > ground ? FILL : CUT);
          const w = 0.5;
          const x0 = q.x - t.x * w;
          const z0 = q.z - t.z * w;
          const x1 = q.x + t.x * w;
          const z1 = q.z + t.z * w;
          buf.quad([x0, ground, z0], [x1, ground, z1], [x1, top, z1], [x0, top, z0], col, false);
          buf.quad([x1, ground, z1], [x0, ground, z0], [x0, top, z0], [x1, top, z1], col, false);
          stats.posts++;
        }
    });
    this.gradeStats = stats;
    return buf.n ? mergeChunks([buf.trimmed()]) : null;
  }

  highlightSegment(curve: Curve | null, half: number, color: 'bad' | 'ok' = 'bad'): void {
    if (this.highlight) {
      this.group.remove(this.highlight);
      this.highlight.geometry.dispose();
      this.highlight = null;
    }
    if (!curve) return;
    const geo = this.ribbon([{ a: curve.a, c: curve.c, b: curve.b }], half + 0.6);
    if (!geo) return;
    this.hiMat.color.copy(color === 'bad' ? BAD : OK);
    this.highlight = new Mesh(geo, this.hiMat);
    this.highlight.renderOrder = 11;
    this.group.add(this.highlight);
  }

  private selection: Mesh | null = null;
  private selMat = new MeshBasicMaterial({
    color: new Color('#ffd23f'),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: false,
  });

  /** Outline around a selected footprint (oriented rectangle). */
  showSelection(r: { x: number; z: number; hw: number; hd: number; angle: number } | null): void {
    if (this.selection) {
      this.group.remove(this.selection);
      this.selection.geometry.dispose();
      this.selection = null;
    }
    if (!r) return;
    const buf = new GeoBuffer(64);
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    const w = 0.7;
    const pt = (u: number, v: number) => {
      const x = r.x + u * c - v * s;
      const z = r.z + u * s + v * c;
      return [x, this.y(x, z) + 0.6, z];
    };
    const hw = r.hw + 0.8;
    const hd = r.hd + 0.8;
    const col = new Color('#ffffff');
    buf.quad(pt(-hw, -hd), pt(hw, -hd), pt(hw, -hd + w), pt(-hw, -hd + w), col);
    buf.quad(pt(-hw, hd - w), pt(hw, hd - w), pt(hw, hd), pt(-hw, hd), col);
    buf.quad(pt(-hw, -hd), pt(-hw + w, -hd), pt(-hw + w, hd), pt(-hw, hd), col);
    buf.quad(pt(hw - w, -hd), pt(hw, -hd), pt(hw, hd), pt(hw - w, hd), col);
    this.selection = new Mesh(mergeChunks([buf.trimmed()]), this.selMat);
    this.selection.renderOrder = 30;
    this.group.add(this.selection);
  }

  private footprint: Mesh | null = null;
  private fpMat = new MeshBasicMaterial({
    color: OK,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -8,
  });

  /** Translucent box over a footprint for building placement. */
  showFootprint(
    r: { x: number; z: number; hw: number; hd: number; angle: number } | null,
    state: 'ok' | 'bad' | 'pending',
    height = 6,
  ): void {
    if (this.footprint) {
      this.group.remove(this.footprint);
      this.footprint.geometry.dispose();
      this.footprint = null;
    }
    if (!r) return;
    const buf = new GeoBuffer(64);
    const c = Math.cos(r.angle);
    const s = Math.sin(r.angle);
    const base = Math.max(
      ...[-1, 1].flatMap((u) =>
        [-1, 1].map((v) => this.y(r.x + u * r.hw * c - v * r.hd * s, r.z + u * r.hw * s + v * r.hd * c)),
      ),
    );
    const pt = (u: number, v: number, y: number) => [r.x + u * c - v * s, base + y, r.z + u * s + v * c];
    const col = new Color('#ffffff');
    const { hw, hd } = r;
    buf.quad(pt(-hw, -hd, height), pt(-hw, hd, height), pt(hw, hd, height), pt(hw, -hd, height), col);
    buf.quad(pt(-hw, -hd, 0), pt(-hw, -hd, height), pt(hw, -hd, height), pt(hw, -hd, 0), col, false);
    buf.quad(pt(hw, hd, 0), pt(hw, hd, height), pt(-hw, hd, height), pt(-hw, hd, 0), col, false);
    buf.quad(pt(-hw, hd, 0), pt(-hw, hd, height), pt(-hw, -hd, height), pt(-hw, -hd, 0), col, false);
    buf.quad(pt(hw, -hd, 0), pt(hw, -hd, height), pt(hw, hd, height), pt(hw, hd, 0), col, false);
    this.fpMat.color.copy(state === 'ok' ? OK : state === 'bad' ? BAD : WARN);
    this.footprint = new Mesh(mergeChunks([buf.trimmed()]), this.fpMat);
    this.footprint.renderOrder = 12;
    this.group.add(this.footprint);
  }

  /** Coverage preview for a service building: road ribbons shaded by coverage (0..1 samples). */
  showCoverage(list: RoadTintPiece[] | null): void {
    this.coverage.show(list);
  }

  get coveragePieces(): number {
    return this.coverage.pieces;
  }

  showBrush(p: Vec2 | null, radius: number, color = '#ffffff'): void {
    this.brush.visible = !!p;
    if (!p) return;
    this.brush.position.set(p.x, this.y(p.x, p.z) + 0.6, p.z);
    this.brush.scale.setScalar(radius);
    (this.brush.material as MeshBasicMaterial).color.set(color);
  }

  showSnap(p: Vec2 | null): void {
    this.snap.visible = !!p;
    if (p) this.snap.position.set(p.x, this.y(p.x, p.z) + 0.8, p.z);
  }

  showMarker(p: Vec2 | null): void {
    this.marker.visible = !!p;
    if (p) this.marker.position.set(p.x, this.y(p.x, p.z) + 0.9, p.z);
  }

  clear(): void {
    this.showRoad(null, 'street', 'ok');
    this.showFootprint(null, 'ok');
    this.showCoverage(null);
    this.highlightSegment(null, 0);
    this.showBrush(null, 1);
    this.showSnap(null);
    this.showMarker(null);
  }
}

export { v2 };
