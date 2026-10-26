/**
 * A battle's effects on screen (M35): tracers from guns, shells arcing over, flak bursting, smoke
 * puffs where shots land and where units are knocked out, and smoke over wrecks. Toy-like: bright
 * streaks and soft grey puffs, no blood. Built from each battle frame's shots (src/sim/battle) and
 * animated on the page's clock between frames. Nothing is made until a battle is on.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';
import type { ClientWorld } from '../client/world';
import type { BattleShot } from '../sim/battle/types';

const MAX_LINES = 160;
const MAX_PUFFS = 400;
/** Seconds on screen: a tracer, a shell's flight, a puff. */
const TRACER = 0.22;
const SHELL = 0.7;
const PUFF = 1.8;

const PUFF_VERT = /* glsl */ `
attribute float aSize;
attribute float aAge;
attribute float aDark;
uniform float uPixel;
varying float vAge;
varying float vDark;
void main() {
  vAge = aAge;
  vDark = aDark;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (0.5 + aAge * 1.6) * uPixel / -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const PUFF_FRAG = /* glsl */ `
varying float vAge;
varying float vDark;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float a = (1.0 - r) * (1.0 - vAge) * 0.75;
  vec3 c = mix(vec3(0.86, 0.85, 0.82), vec3(0.32, 0.31, 0.3), vDark);
  // A warm core at first: the flash of the hit.
  c = mix(c, vec3(1.0, 0.78, 0.35), max(0.0, 1.0 - vAge * 5.0) * (1.0 - r));
  gl_FragColor = vec4(c, a);
}
`;

interface Tracer extends BattleShot {
  born: number;
}

interface Puff {
  x: number;
  y: number;
  z: number;
  born: number;
  size: number;
  dark: number;
  rise: number;
}

export class BattleEffects {
  readonly group = new Group();
  private lines: LineSegments;
  private puffs: Points;
  private tracers: Tracer[] = [];
  private puffList: Puff[] = [];
  private version = -1;
  private wrecks = new Set<string>();
  private lastWreckSmoke = 0;
  /** Shots and puffs on screen last update (tests and stats). */
  counts = { tracers: 0, puffs: 0 };

  constructor(private world: ClientWorld) {
    const lg = new BufferGeometry();
    lg.setAttribute('position', new BufferAttribute(new Float32Array(MAX_LINES * 6), 3));
    lg.setAttribute('color', new BufferAttribute(new Float32Array(MAX_LINES * 6), 3));
    lg.setDrawRange(0, 0);
    this.lines = new LineSegments(
      lg,
      new LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 9;
    const pg = new BufferGeometry();
    pg.setAttribute('position', new BufferAttribute(new Float32Array(MAX_PUFFS * 3), 3));
    pg.setAttribute('aSize', new BufferAttribute(new Float32Array(MAX_PUFFS), 1));
    pg.setAttribute('aAge', new BufferAttribute(new Float32Array(MAX_PUFFS), 1));
    pg.setAttribute('aDark', new BufferAttribute(new Float32Array(MAX_PUFFS), 1));
    pg.setDrawRange(0, 0);
    this.puffs = new Points(
      pg,
      new ShaderMaterial({
        vertexShader: PUFF_VERT,
        fragmentShader: PUFF_FRAG,
        uniforms: { uPixel: { value: 600 } },
        transparent: true,
        depthWrite: false,
        blending: NormalBlending,
      }),
    );
    this.puffs.frustumCulled = false;
    this.puffs.renderOrder = 8;
    this.group.add(this.puffs, this.lines);
    this.group.name = 'battle';
  }

  private ground(x: number, z: number): number {
    return this.world.heightAt(x, z);
  }

  private puff(x: number, y: number, z: number, now: number, size: number, dark: number, rise = 4): void {
    if (this.puffList.length >= MAX_PUFFS) this.puffList.shift();
    this.puffList.push({ x, y, z, born: now, size, dark, rise });
  }

  /** Take in a new frame's shots and knock-outs. */
  private ingest(now: number): void {
    const w = this.world;
    const f = w.battle;
    if (!f) return;
    const prev = new Map((w.battlePrev?.units ?? []).map((u) => [`${u.side}:${u.id}`, u.state]));
    for (const s of f.shots) {
      const y0 = this.ground(s.x0, s.z0) + s.y0;
      const y1 = this.ground(s.x1, s.z1) + s.y1;
      this.tracers.push({ ...s, y0, y1, born: now });
      // Hits land in a puff (after the shell's flight); misses kick up a smaller one nearby.
      const delay = s.kind === 1 ? SHELL : TRACER * 0.5;
      const size = s.kind === 1 ? 9 : s.kind === 2 ? 5 : 2.6; // metres
      if (s.hit) this.puff(s.x1, y1 + 1, s.z1, now + delay, size, s.kind === 2 ? 0.1 : 0.45);
      else if (s.kind === 1) this.puff(s.x1 + 6, y1, s.z1 - 4, now + delay, size * 0.6, 0.25);
    }
    if (this.tracers.length > MAX_LINES) this.tracers.splice(0, this.tracers.length - MAX_LINES);
    for (const u of f.units) {
      const key = `${u.side}:${u.id}`;
      if (u.state === 2 && prev.get(key) !== 2 && !this.wrecks.has(key)) {
        // Knocked out: a puff of smoke, and a wreck that smoulders.
        const y = this.ground(u.x, u.z) + u.y;
        this.puff(u.x, y + 2, u.z, now, 14, 0.7, 6);
        this.puff(u.x + 1.5, y + 3, u.z - 1, now + 0.15, 11, 0.55, 8);
      }
      if (u.state === 2) this.wrecks.add(key);
    }
  }

  update(now: number, pixel: number): void {
    const w = this.world;
    if (!w.battle && !this.tracers.length && !this.puffList.length) {
      this.lines.geometry.setDrawRange(0, 0);
      this.puffs.geometry.setDrawRange(0, 0);
      this.counts = { tracers: 0, puffs: 0 };
      if (!w.battle) this.wrecks.clear();
      return;
    }
    if (w.battleVersion !== this.version) {
      this.version = w.battleVersion;
      this.ingest(now);
    }
    // Wrecks smoulder: a dark puff over each now and then.
    if (w.battle && now - this.lastWreckSmoke > 0.5) {
      this.lastWreckSmoke = now;
      for (const u of w.battle.units)
        if (u.state === 2) this.puff(u.x, this.ground(u.x, u.z) + u.y + 2, u.z, now, 7, 0.8, 10);
    }
    // Tracers and shells.
    this.tracers = this.tracers.filter((t) => now - t.born < (t.kind === 1 ? SHELL : TRACER));
    const pos = this.lines.geometry.getAttribute('position') as BufferAttribute;
    const col = this.lines.geometry.getAttribute('color') as BufferAttribute;
    let n = 0;
    for (const t of this.tracers) {
      if (n >= MAX_LINES) break;
      const life = t.kind === 1 ? SHELL : TRACER;
      const a = Math.min(1, (now - t.born) / life);
      let x0: number, y0: number, z0: number, x1: number, y1: number, z1: number;
      if (t.kind === 1) {
        // A shell: a short bright dash along an arc.
        const at = (k: number) => {
          const h = Math.hypot(t.x1 - t.x0, t.z1 - t.z0) * 0.25;
          return [
            t.x0 + (t.x1 - t.x0) * k,
            t.y0 + (t.y1 - t.y0) * k + 4 * h * k * (1 - k),
            t.z0 + (t.z1 - t.z0) * k,
          ] as const;
        };
        [x0, y0, z0] = at(Math.max(0, a - 0.08));
        [x1, y1, z1] = at(a);
      } else {
        // A tracer: a streak flying from the muzzle to the target.
        const k0 = Math.max(0, a - 0.35);
        x0 = t.x0 + (t.x1 - t.x0) * k0;
        y0 = t.y0 + (t.y1 - t.y0) * k0;
        z0 = t.z0 + (t.z1 - t.z0) * k0;
        x1 = t.x0 + (t.x1 - t.x0) * a;
        y1 = t.y0 + (t.y1 - t.y0) * a;
        z1 = t.z0 + (t.z1 - t.z0) * a;
      }
      pos.setXYZ(n * 2, x0, y0, z0);
      pos.setXYZ(n * 2 + 1, x1, y1, z1);
      const [r, g, b] = t.kind === 2 ? [0.7, 0.9, 1] : t.kind === 1 ? [1, 0.75, 0.35] : [1, 0.9, 0.55];
      const fade = 1 - a * 0.5;
      col.setXYZ(n * 2, r * fade * 0.4, g * fade * 0.4, b * fade * 0.4);
      col.setXYZ(n * 2 + 1, r * fade, g * fade, b * fade);
      n++;
    }
    pos.needsUpdate = col.needsUpdate = true;
    this.lines.geometry.setDrawRange(0, n * 2);
    // Puffs.
    this.puffList = this.puffList.filter((p) => now - p.born < PUFF);
    const pp = this.puffs.geometry.getAttribute('position') as BufferAttribute;
    const ps = this.puffs.geometry.getAttribute('aSize') as BufferAttribute;
    const pa = this.puffs.geometry.getAttribute('aAge') as BufferAttribute;
    const pd = this.puffs.geometry.getAttribute('aDark') as BufferAttribute;
    let m = 0;
    for (const p of this.puffList) {
      const age = (now - p.born) / PUFF;
      if (age < 0) continue;
      pp.setXYZ(m, p.x, p.y + p.rise * age, p.z);
      ps.setX(m, p.size);
      pa.setX(m, age);
      pd.setX(m, p.dark);
      m++;
    }
    pp.needsUpdate = ps.needsUpdate = pa.needsUpdate = pd.needsUpdate = true;
    this.puffs.geometry.setDrawRange(0, m);
    (this.puffs.material as ShaderMaterial).uniforms.uPixel!.value = pixel;
    this.counts = { tracers: n, puffs: m };
  }
}
