import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  NormalBlending,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { ClientWorld } from '../client/world';
import { DISASTERS } from '../data/balance';
import { floodLevel, impactTick, tornadoAt, type Disaster } from '../sim/systems/disasters';
import { RoadTint } from './roadTint';

const DUST_BURSTS = 64;
const DUST_PER = 26;
const FUNNEL = 1800;
const DEBRIS = 260;
const CLOUD = 90;
const TRAIL = 60;
const MAX_BARRIERS = 400;

const DUST_VERT = /* glsl */ `
  attribute vec4 aSeed;   // dx, dz, rise, size
  attribute float aBirth;
  uniform float uTime;
  uniform float uPixel;
  uniform float uDur;
  varying float vLife;
  void main() {
    float life = (uTime - aBirth) / uDur;
    vLife = life;
    float k = 1.0 - exp(-life * 4.0);
    vec3 p = position + vec3(aSeed.x * k, aSeed.z * k, aSeed.y * k);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (life < 0.0 || life > 1.0) ? 0.0 : aSeed.w * (1.0 + 2.2 * k) * uPixel / max(1.0, -mv.z);
  }
`;
const DUST_FRAG = /* glsl */ `
  uniform float uLight;
  varying float vLife;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5 || vLife < 0.0 || vLife > 1.0) discard;
    float a = smoothstep(0.5, 0.05, d) * smoothstep(0.0, 0.06, vLife) * (1.0 - vLife) * 0.7;
    // Dust takes the light of the hour (M26): pale by day, dim at night.
    gl_FragColor = vec4(mix(vec3(0.55, 0.49, 0.41), vec3(0.72, 0.68, 0.62), vLife) * uLight, a);
  }
`;

/** The funnel: particles on a widening helix around a moving centre. */
const FUNNEL_VERT = /* glsl */ `
  attribute vec4 aSeed;  // height fraction, angle, radius jitter, speed
  uniform float uTime;
  uniform float uPixel;
  uniform vec3 uCentre;
  uniform float uHeight;
  uniform float uWidth;
  uniform float uFade;
  varying float vH;
  varying float vA;
  void main() {
    float h = aSeed.x;
    vH = h;
    // Narrow at the ground, flaring into the cloud base.
    float r = mix(0.1, 1.8, pow(h, 1.9)) * uWidth * (0.8 + 0.35 * aSeed.z);
    float ang = aSeed.y + uTime * aSeed.w * (2.6 - 1.6 * h);
    // The whole column sways a little.
    vec3 sway = vec3(sin(uTime * 0.7 + h * 3.0), 0.0, cos(uTime * 0.6 + h * 2.0)) * h * uWidth * 0.35;
    vec3 p = uCentre + sway + vec3(cos(ang) * r, h * uHeight, sin(ang) * r);
    vA = uFade;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = mix(5.0, 20.0, h) * uPixel / max(1.0, -mv.z);
  }
`;
const FUNNEL_FRAG = /* glsl */ `
  varying float vH;
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * 0.7 * vA;
    vec3 col = mix(vec3(0.3, 0.27, 0.24), vec3(0.42, 0.43, 0.46), vH);
    gl_FragColor = vec4(col, a);
  }
`;

const CLOUD_VERT = /* glsl */ `
  attribute vec4 aSeed;   // radius, angle, height jitter, size
  uniform float uTime;
  uniform float uPixel;
  uniform vec3 uCentre;
  uniform float uFade;
  varying float vA;
  void main() {
    float ang = aSeed.y + uTime * 0.12;
    vec3 p = uCentre + vec3(cos(ang) * aSeed.x, 165.0 + aSeed.z, sin(ang) * aSeed.x);
    vA = uFade;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSeed.w * uPixel / max(1.0, -mv.z);
  }
`;
const CLOUD_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.1, d) * 0.5 * vA;
    gl_FragColor = vec4(0.27, 0.28, 0.31, a);
  }
`;

const FIRE_VERT = /* glsl */ `
  attribute float aK;   // 0 head … 1 tail end
  uniform vec3 uHead;
  uniform vec3 uDir;
  uniform float uPixel;
  uniform float uOn;
  varying float vK;
  void main() {
    vK = aK;
    vec3 p = uHead - uDir * aK * 260.0;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uOn * mix(46.0, 8.0, aK) * uPixel / max(1.0, -mv.z) + uOn * 2.0;
  }
`;
const FIRE_FRAG = /* glsl */ `
  varying float vK;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d) * (1.0 - vK);
    vec3 col = mix(vec3(1.0, 0.82, 0.45), vec3(0.85, 0.22, 0.04), sqrt(vK));
    gl_FragColor = vec4(col, a);
  }
`;

const FLASH_FRAG = /* glsl */ `
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a * 1.4, a);
  }
`;

const FLOOD_VERT = /* glsl */ `
  varying vec2 vLocal;
  void main() {
    vLocal = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const FLOOD_FRAG = /* glsl */ `
  uniform float uRadius;
  uniform float uTime;
  uniform float uFade;
  varying vec2 vLocal;
  void main() {
    float r = length(vLocal) / uRadius;
    float edge = smoothstep(1.0, 0.82, r);
    float rip = sin(vLocal.x * 0.09 + uTime * 1.3) * sin(vLocal.y * 0.11 - uTime * 1.1);
    float glint = pow(max(0.0, sin(vLocal.x * 0.21 - uTime * 2.1) * sin(vLocal.y * 0.17 + uTime * 1.7)), 8.0);
    // Silty flood water: brown-green in the shallows of the sheet, bluer where it catches the sky.
    vec3 col = mix(vec3(0.36, 0.38, 0.27), vec3(0.32, 0.46, 0.52), 0.5 + 0.5 * rip) + glint * 0.25;
    gl_FragColor = vec4(col, 0.8 * edge * uFade);
  }
`;

/**
 * What disasters look like: dust where buildings fall, the tornado's funnel and wall cloud, flood
 * water rising over the low ground, the meteor's fiery fall, flash and scorched crater, closed
 * roads, and the camera shaking during an earthquake.
 */
export class DisasterRenderer {
  readonly group = new Group();
  private time = 0;
  private dust: Points;
  private burst = 0;
  private funnels: { funnel: Points; debris: Points; cloud: Points }[] = [];
  private floods: Mesh[] = [];
  private floodMat: ShaderMaterial;
  private fireball: Points;
  private flash: Points;
  private craters = new Group();
  private craterKey = '';
  private barriers: InstancedMesh;
  readonly closures: RoadTint;
  private version = -1;
  private prevState = new Map<number, number>();
  /** Counters for tests. */
  stats = { dust: 0, funnels: 0, floods: 0, meteors: 0, craters: 0, closures: 0 };
  /** Camera shake offset for this frame (m). */
  readonly shake = new Vector3();

  constructor(private world: ClientWorld) {
    // Dust bursts.
    const n = DUST_BURSTS * DUST_PER;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aSeed', new BufferAttribute(new Float32Array(n * 4), 4));
    g.setAttribute('aBirth', new BufferAttribute(new Float32Array(n).fill(-1e6), 1));
    this.dust = new Points(
      g,
      new ShaderMaterial({
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        uniforms: { uTime: { value: 0 }, uPixel: { value: 1 }, uDur: { value: 7 }, uLight: { value: 1 } },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    this.floodMat = new ShaderMaterial({
      vertexShader: FLOOD_VERT,
      fragmentShader: FLOOD_FRAG,
      uniforms: { uRadius: { value: DISASTERS.flood.radius }, uTime: { value: 0 }, uFade: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });

    const trail = new BufferGeometry();
    trail.setAttribute('position', new BufferAttribute(new Float32Array(TRAIL * 3), 3));
    trail.setAttribute(
      'aK',
      new BufferAttribute(
        Float32Array.from({ length: TRAIL }, (_, i) => i / TRAIL),
        1,
      ),
    );
    this.fireball = new Points(
      trail,
      new ShaderMaterial({
        vertexShader: FIRE_VERT,
        fragmentShader: FIRE_FRAG,
        uniforms: {
          uHead: { value: new Vector3() },
          uDir: { value: new Vector3(0, -1, 0) },
          uPixel: { value: 1 },
          uOn: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        // Normal blending keeps it orange against a bright sky.
        blending: NormalBlending,
      }),
    );
    this.fireball.frustumCulled = false;
    this.group.add(this.fireball);
    const fg = new BufferGeometry();
    fg.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    fg.setAttribute('aK', new BufferAttribute(new Float32Array(1), 1));
    this.flash = new Points(
      fg,
      new ShaderMaterial({
        vertexShader: FIRE_VERT.replace('mix(46.0, 8.0, aK)', '220.0'),
        fragmentShader: FLASH_FRAG,
        uniforms: {
          uHead: { value: new Vector3() },
          uDir: { value: new Vector3(0, -1, 0) },
          uPixel: { value: 1 },
          uOn: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.flash.frustumCulled = false;
    this.group.add(this.flash);
    this.group.add(this.craters);

    // Closed roads: a red ribbon and striped barriers at each end.
    this.closures = new RoadTint((x, z) => world.heightAt(x, z), 'traffic', 0.55);
    this.group.add(this.closures.group);
    this.barriers = new InstancedMesh(
      new BoxGeometry(3.2, 1.0, 0.35).translate(0, 0.9, 0),
      new MeshLambertMaterial({ color: new Color('#f08a24') }),
      MAX_BARRIERS,
    );
    this.barriers.count = 0;
    this.barriers.frustumCulled = false;
    this.group.add(this.barriers);

    world.onBuildings((changed) => {
      for (const id of changed) {
        const b = world.buildings.get(id);
        if (!b) continue;
        const before = this.prevState.get(id);
        this.prevState.set(id, b.state);
        if (b.state === 3 && before !== undefined && before !== 3) this.puff(b.x, b.y, b.z, 1);
      }
    });
    for (const b of world.buildings.values()) this.prevState.set(b.id, b.state);
  }

  /** A dust cloud (scale 1 = a building coming down). */
  puff(x: number, y: number, z: number, scale: number): void {
    const g = this.dust.geometry;
    const pos = g.getAttribute('position') as BufferAttribute;
    const seed = g.getAttribute('aSeed') as BufferAttribute;
    const birth = g.getAttribute('aBirth') as BufferAttribute;
    const base = (this.burst++ % DUST_BURSTS) * DUST_PER;
    for (let i = 0; i < DUST_PER; i++) {
      const k = base + i;
      const a = Math.random() * Math.PI * 2;
      const r = (4 + Math.random() * 12) * scale;
      pos.setXYZ(
        k,
        x + (Math.random() - 0.5) * 6 * scale,
        y + 1 + Math.random() * 4,
        z + (Math.random() - 0.5) * 6 * scale,
      );
      seed.setXYZW(
        k,
        Math.cos(a) * r,
        Math.sin(a) * r,
        (3 + Math.random() * 10) * scale,
        (10 + Math.random() * 12) * scale,
      );
      birth.setX(k, this.time + Math.random() * 0.4);
    }
    pos.needsUpdate = true;
    seed.needsUpdate = true;
    birth.needsUpdate = true;
    this.stats.dust++;
  }

  private makeFunnel() {
    const mk = (count: number, fill: (a: Float32Array, i: number) => void, vert: string, frag: string) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
      const seed = new Float32Array(count * 4);
      for (let i = 0; i < count; i++) fill(seed, i);
      g.setAttribute('aSeed', new BufferAttribute(seed, 4));
      const p = new Points(
        g,
        new ShaderMaterial({
          vertexShader: vert,
          fragmentShader: frag,
          uniforms: {
            uTime: { value: 0 },
            uPixel: { value: 1 },
            uCentre: { value: new Vector3() },
            uHeight: { value: 150 },
            uWidth: { value: 30 },
            uFade: { value: 1 },
          },
          transparent: true,
          depthWrite: false,
          blending: NormalBlending,
        }),
      );
      p.frustumCulled = false;
      this.group.add(p);
      return p;
    };
    const funnel = mk(
      FUNNEL,
      (s, i) =>
        s.set(
          [Math.pow(Math.random(), 0.8), Math.random() * 6.28, Math.random(), 1.5 + Math.random()],
          i * 4,
        ),
      FUNNEL_VERT,
      FUNNEL_FRAG,
    );
    const debris = mk(
      DEBRIS,
      (s, i) =>
        s.set(
          [Math.random() * 0.12, Math.random() * 6.28, 1.5 + Math.random() * 2.5, 2 + Math.random() * 2],
          i * 4,
        ),
      FUNNEL_VERT,
      FUNNEL_FRAG.replace('mix(vec3(0.36, 0.33, 0.3), vec3(0.55, 0.56, 0.58), vH)', 'vec3(0.38, 0.3, 0.22)'),
    );
    const cloud = mk(
      CLOUD,
      (s, i) =>
        s.set(
          [
            Math.sqrt(Math.random()) * 170,
            Math.random() * 6.28,
            (Math.random() - 0.5) * 18,
            60 + Math.random() * 70,
          ],
          i * 4,
        ),
      CLOUD_VERT,
      CLOUD_FRAG,
    );
    return { funnel, debris, cloud };
  }

  private rebuildStatic(): void {
    const w = this.world;
    const d = w.disasters;
    // Closed roads.
    const damaged = d.damaged.filter((id) => w.netState.segments.has(id));
    this.closures.show(
      damaged.map((id) => ({ curve: w.net.curve(id), v: [1, 1], half: 3.2 })),
      'traffic',
    );
    const m = new Matrix4();
    const q = new Quaternion();
    const one = new Vector3(1, 1, 1);
    const p = new Vector3();
    let n = 0;
    for (const id of damaged) {
      const c = w.net.curve(id);
      for (const s of [Math.min(6, c.length / 3), Math.max(c.length - 6, (2 * c.length) / 3)]) {
        if (n >= MAX_BARRIERS) break;
        const pt = c.pointAt(s);
        const t = c.tangentAt(s);
        q.setFromAxisAngle(new Vector3(0, 1, 0), -Math.atan2(t.z, t.x) + Math.PI / 2);
        p.set(pt.x, w.roadHeight(id, s, pt.x, pt.z) + 0.2, pt.z);
        m.compose(p, q, one);
        this.barriers.setMatrixAt(n++, m);
      }
    }
    this.barriers.count = n;
    this.barriers.instanceMatrix.needsUpdate = true;
    this.stats.closures = damaged.length;
    // Craters.
    const key = d.craters.map((c) => `${c.x},${c.z},${c.r}`).join('|');
    if (key !== this.craterKey) {
      this.craterKey = key;
      for (const c of [...this.craters.children]) {
        this.craters.remove(c);
        (c as Mesh).geometry.dispose();
      }
      for (const c of d.craters) this.craters.add(this.craterMesh(c.x, c.z, c.r));
      this.stats.craters = d.craters.length;
    }
  }

  /** A scorched bowl draped on the terrain. */
  private craterMesh(x: number, z: number, r: number): Mesh {
    const R = r * 1.9;
    const g = new CircleGeometry(R, 40, 0, Math.PI * 2);
    g.rotateX(-Math.PI / 2);
    const pos = g.getAttribute('position') as BufferAttribute;
    const col = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i);
      const lz = pos.getZ(i);
      const d = Math.hypot(lx, lz) / R;
      pos.setY(i, Math.max(0, this.world.heightAt(x + lx, z + lz)) + 0.4);
      // Charred in the middle, a ring of thrown-up earth, fading out at the edge.
      const inner = d < 0.5 ? 1 : 0;
      col.set(
        inner ? [0.09, 0.08, 0.07, 0.92] : [0.36, 0.28, 0.2, 0.75 * Math.max(0, 1 - (d - 0.5) / 0.5)],
        i * 4,
      );
    }
    g.setAttribute('color', new BufferAttribute(col, 4));
    g.translate(x, 0, z);
    const mesh = new Mesh(
      g,
      new ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute vec4 color;
          varying vec4 vC;
          void main() { vC = color; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          varying vec4 vC;
          void main() { gl_FragColor = vC; }`,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    );
    mesh.name = 'crater';
    return mesh;
  }

  private active(kind: Disaster['kind']): Disaster[] {
    return this.world.disasters.active.filter((d) => d.kind === kind);
  }

  update(dtSec: number, displayTick: number, pxPerMetre: number, light = 1): void {
    this.time += dtSec;
    (this.dust.material as ShaderMaterial).uniforms.uLight!.value = light;
    const w = this.world;
    if (this.version !== w.disastersVersion) {
      this.version = w.disastersVersion;
      this.rebuildStatic();
    }
    const du = (this.dust.material as ShaderMaterial).uniforms;
    du.uTime!.value = this.time;
    du.uPixel!.value = pxPerMetre;

    // Earthquake: shake while the ground moves (stronger for bigger quakes).
    this.shake.set(0, 0, 0);
    for (const d of this.active('earthquake')) {
      if (displayTick < d.start || displayTick > d.end) continue;
      const k = (d.end - displayTick) / (d.end - d.start);
      const amp = Math.max(0, d.size - 5) * 1.6 * k;
      this.shake.x += (Math.random() - 0.5) * amp;
      this.shake.y += (Math.random() - 0.5) * amp * 0.5;
      this.shake.z += (Math.random() - 0.5) * amp;
    }

    // Tornadoes.
    const tornadoes = this.active('tornado');
    while (this.funnels.length < tornadoes.length) this.funnels.push(this.makeFunnel());
    this.funnels.forEach((f, i) => {
      const d = tornadoes[i];
      const on = !!d;
      f.funnel.visible = f.debris.visible = f.cloud.visible = on;
      if (!d) return;
      const p = tornadoAt(d, displayTick);
      const y = Math.max(0, w.heightAt(p.x, p.z));
      const fade = Math.min(1, (displayTick - d.start) / 6, (d.end - displayTick) / 6);
      for (const pts of [f.funnel, f.debris, f.cloud]) {
        const u = (pts.material as ShaderMaterial).uniforms;
        u.uTime!.value = this.time;
        u.uPixel!.value = pxPerMetre;
        (u.uCentre!.value as Vector3).set(p.x, y, p.z);
        u.uWidth!.value = d.size;
        u.uFade!.value = Math.max(0, fade);
      }
      // Debris kicked up where it touches down.
      if (Math.random() < dtSec * 3) this.puff(p.x, y, p.z, 0.8);
    });
    this.stats.funnels = tornadoes.length;

    // Floods: a sheet of muddy water at the current level, hidden by any ground above it.
    const floods = this.active('flood');
    while (this.floods.length < floods.length) {
      const mesh = new Mesh(new CircleGeometry(DISASTERS.flood.radius, 96), this.floodMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      this.floods.push(mesh);
      this.group.add(mesh);
    }
    this.floodMat.uniforms.uTime!.value = this.time;
    this.floods.forEach((mesh, i) => {
      const d = floods[i];
      mesh.visible = !!d;
      if (!d) return;
      const level = floodLevel(d, displayTick);
      mesh.visible = level > 0.3;
      mesh.position.set(d.x, level, d.z);
    });
    this.stats.floods = floods.filter((d) => floodLevel(d, displayTick) > 0.3).length;

    // Meteors: a fireball streaking in, then a flash.
    const fu = (this.fireball.material as ShaderMaterial).uniforms;
    const flu = (this.flash.material as ShaderMaterial).uniforms;
    fu.uOn!.value = 0;
    flu.uOn!.value = 0;
    fu.uPixel!.value = pxPerMetre;
    flu.uPixel!.value = pxPerMetre;
    let meteors = 0;
    for (const d of this.active('meteor')) {
      const hit = impactTick(d);
      const ground = Math.max(0, w.heightAt(d.x, d.z));
      const dir = new Vector3(0.3, -0.9, 0.25).normalize();
      if (displayTick < hit) {
        const k = Math.max(0, (hit - displayTick) / (hit - d.start));
        const dist = 900 * k;
        (fu.uHead!.value as Vector3).set(d.x - dir.x * dist, ground - dir.y * dist, d.z - dir.z * dist);
        (fu.uDir!.value as Vector3).copy(dir);
        fu.uOn!.value = 1;
        meteors++;
      } else {
        const since = displayTick - hit;
        if (since < 14) {
          (flu.uHead!.value as Vector3).set(d.x, ground + 12, d.z);
          flu.uOn!.value = 0.8 * Math.exp(-since / 3);
        }
        if (since >= 0 && since < 1.5 && !this.boomed.has(d.id)) {
          this.boomed.add(d.id);
          this.puff(d.x, ground, d.z, 3.2);
          this.puff(d.x + 20, ground, d.z - 15, 2.4);
          this.puff(d.x - 18, ground, d.z + 12, 2.4);
          this.onImpact?.(d);
        }
      }
    }
    this.stats.meteors = meteors;
  }

  private boomed = new Set<number>();
  /** Called once when a meteor lands (for sound). */
  onImpact: ((d: Disaster) => void) | null = null;
}
