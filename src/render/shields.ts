/**
 * The superweapon buildings' effects (M37): the dome shield over the city as a fresnel-rim shell
 * (a flash when a blow lands on it, a soap-bubble pop when its pool runs out), shield generators'
 * bubbles in a battle at home, the express gate's swirl as a force steps through, and the blackout
 * tower's ring glowing while it charges. Each is one draw call; the quality's `shields` switch draws
 * the shells in full (High), as a rim (Medium) or as a ring on the ground (Low). Display-only: read
 * from the war summary and the battle frame, never the sim.
 */
import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { ClientWorld } from '../client/world';
import { CIVIC } from '../data/civic';

/** 0: a ring on the ground (Low), 1: the rim only (Medium), 2: the rim and a faint fill (High). */
export type ShieldQuality = 0 | 1 | 2;

const SHELL_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
  vec4 wp = modelMatrix * (im * vec4(position, 1.0));
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const SHELL_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uRim;
uniform float uFill;
uniform float uFlash;
uniform float uFade;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float a = (pow(f, 3.0) * uRim + uFill + uFlash * (0.25 + 0.6 * f)) * uFade;
  gl_FragColor = vec4(uColor * a, a);
}`;

function shellMaterial(color: [number, number, number]): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: SHELL_VERT,
    fragmentShader: SHELL_FRAG,
    uniforms: {
      uColor: { value: new Vector3(...color) },
      uRim: { value: 0.9 },
      uFill: { value: 0.04 },
      uFlash: { value: 0 },
      uFade: { value: 1 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

const SWIRL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFade;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float s = 0.5 + 0.5 * sin(a * 3.0 + r * 9.0 - uTime * 6.0);
  float alpha = (0.35 + 0.65 * s) * smoothstep(1.0, 0.7, r) * uFade;
  gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * alpha, alpha);
}`;

const SWIRL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const DOME_POP = 1.2;
const FLASH = 0.45;
const MAX_BUBBLES = 8;

export class SuperEffects {
  readonly group = new Group();
  quality: ShieldQuality = 2;
  private dome: InstancedMesh;
  private domeRing: Mesh;
  private bubbles: InstancedMesh;
  private bubbleRings: InstancedMesh;
  private swirl: Mesh;
  private towerRing: Mesh;
  private flashAt = -10;
  private popAt = -10;
  private lastDome: number | null = null;
  private domeAt: { x: number; y: number; z: number; r: number; key: string } | null = null;
  /** The dome's spot the Low ring was last laid over the ground for. */
  private ringFor: string | null = null;
  /** What was drawn last update (tests and stats). */
  shown = { dome: false, bubbles: 0, swirl: false, tower: false };

  constructor(private readonly world: ClientWorld) {
    this.group.name = 'supers';
    const hemi = (n: number): BufferGeometry =>
      new SphereGeometry(1, n, Math.max(8, n / 3), 0, Math.PI * 2, 0, Math.PI / 2);
    this.dome = new InstancedMesh(hemi(48), shellMaterial([0.45, 0.75, 1]), 1);
    this.bubbles = new InstancedMesh(hemi(32), shellMaterial([0.6, 0.9, 1]), MAX_BUBBLES);
    const ringMat = shellMaterial([0.45, 0.75, 1]);
    const ring = new RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2);
    this.domeRing = new Mesh(ring, ringMat);
    this.bubbleRings = new InstancedMesh(ring.clone(), ringMat.clone(), MAX_BUBBLES);
    this.swirl = new Mesh(
      new CircleGeometry(1, 48),
      new ShaderMaterial({
        vertexShader: SWIRL_VERT,
        fragmentShader: SWIRL_FRAG,
        uniforms: { uTime: { value: 0 }, uFade: { value: 1 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    this.towerRing = new Mesh(
      new TorusGeometry(6, 0.5, 8, 48).rotateX(Math.PI / 2),
      shellMaterial([1, 0.55, 0.9]),
    );
    for (const m of [this.dome, this.domeRing, this.bubbles, this.bubbleRings, this.swirl, this.towerRing]) {
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 9;
      this.group.add(m);
    }
  }

  private civic(id: number | undefined) {
    return id === undefined ? undefined : this.world.civics.get(id);
  }

  /**
   * Where the dome stands and how far it reaches: over every building of the city, from the dome
   * shield (kept until the city's buildings or the dome move).
   */
  private domeSpot(civic: number) {
    const w = this.world;
    const c = this.civic(civic);
    if (!c) return null;
    const key = `${civic}:${w.civics.size}:${w.buildings.size}`;
    if (this.domeAt?.key === key) return this.domeAt;
    let r = 300;
    for (const o of w.civics.values()) r = Math.max(r, Math.hypot(o.x - c.x, o.z - c.z) + 40);
    for (const b of w.buildings.values()) r = Math.max(r, Math.hypot(b.x - c.x, b.z - c.z) + 30);
    this.domeAt = { x: c.x, y: c.y, z: c.z, r: Math.min(2_000, r), key };
    return this.domeAt;
  }

  /**
   * The Low dome's ring, laid over the ground around the city (a flat ring at the dome's own height
   * floated above valleys as a bright band): rebuilt when the dome's spot moves.
   */
  private drapeRing(spot: NonNullable<SuperEffects['domeAt']>): void {
    if (this.ringFor === spot.key) return;
    this.ringFor = spot.key;
    const g = new RingGeometry(0.97 * spot.r, spot.r, 192).rotateX(-Math.PI / 2);
    const p = g.attributes.position!;
    for (let i = 0; i < p.count; i++)
      p.setY(i, this.world.heightAt(spot.x + p.getX(i), spot.z + p.getZ(i)) - spot.y + 1.5);
    p.needsUpdate = true;
    this.domeRing.geometry.dispose();
    this.domeRing.geometry = g;
  }

  update(now: number): void {
    const w = this.world;
    const sup = w.stats.war?.supers ?? null;
    const frame = w.battle;
    const shown = { dome: false, bubbles: 0, swirl: false, tower: false };
    // The dome: raised over a battle at home, flashing as blows land, popping when it's spent.
    const pool = frame?.dome;
    if (pool !== undefined && this.lastDome !== null) {
      if (pool < this.lastDome) this.flashAt = now;
      if (pool <= 0 && this.lastDome > 0) this.popAt = now;
    }
    this.lastDome = pool ?? null;
    const popping = now - this.popAt < DOME_POP;
    const raised = (pool !== undefined && pool > 0) || (!!sup?.dome?.raised && pool === undefined && !!frame);
    const spot = sup?.dome ? this.domeSpot(sup.dome.civic) : null;
    if (spot && (raised || popping)) {
      const k = popping ? (now - this.popAt) / DOME_POP : 0;
      const scale = spot.r * (1 + 0.08 * k);
      const fade = popping ? 1 - k : 1;
      const flash = Math.max(0, 1 - (now - this.flashAt) / FLASH);
      if (this.quality === 0) {
        this.drapeRing(spot);
        this.domeRing.position.set(spot.x, spot.y, spot.z);
        this.domeRing.scale.set(scale / spot.r, 1, scale / spot.r);
        const u = (this.domeRing.material as ShaderMaterial).uniforms;
        u.uFade!.value = fade;
        u.uFlash!.value = flash;
        u.uFill!.value = 0.6;
        this.domeRing.visible = true;
        this.dome.visible = false;
      } else {
        this.dome.setMatrixAt(
          0,
          new Matrix4().makeScale(scale, scale * 0.55, scale).setPosition(spot.x, spot.y, spot.z),
        );
        this.dome.instanceMatrix.needsUpdate = true;
        const u = (this.dome.material as ShaderMaterial).uniforms;
        u.uFade!.value = fade;
        u.uFlash!.value = flash;
        u.uRim!.value = this.quality === 2 ? 0.9 : 0.7;
        u.uFill!.value = this.quality === 2 ? 0.035 : 0;
        this.dome.visible = true;
        this.domeRing.visible = false;
      }
      shown.dome = true;
    } else {
      this.dome.visible = this.domeRing.visible = false;
    }
    // Shield generators' bubbles, in a battle at home.
    let n = 0;
    if (frame) {
      const m = new Matrix4();
      for (const c of [...w.civics.values()].sort((a, b) => a.id - b.id)) {
        const sh = CIVIC.get(c.def)?.military?.shield;
        if (!sh || c.out || c.damage > 0 || n >= MAX_BUBBLES) continue;
        const r = sh.radius;
        if (this.quality === 0) m.makeScale(r, 1, r).setPosition(c.x, c.y + 0.4, c.z);
        else m.makeScale(r, r * 0.5, r).setPosition(c.x, c.y, c.z);
        (this.quality === 0 ? this.bubbleRings : this.bubbles).setMatrixAt(n++, m);
      }
    }
    const bubbles = this.quality === 0 ? this.bubbleRings : this.bubbles;
    const other = this.quality === 0 ? this.bubbles : this.bubbleRings;
    bubbles.count = n;
    bubbles.instanceMatrix.needsUpdate = n > 0;
    bubbles.visible = n > 0;
    other.visible = false;
    const bu = (bubbles.material as ShaderMaterial).uniforms;
    bu.uRim!.value = this.quality === 2 ? 0.55 : 0.4;
    bu.uFill!.value = this.quality === 0 ? 0.5 : this.quality === 2 ? 0.02 : 0;
    shown.bubbles = n;
    // The gate's swirl, for the hour a force goes through (at every quality).
    const gate = sup?.gate;
    const g = this.civic(gate?.civic);
    if (g && gate && gate.since !== null && gate.since < 1) {
      this.swirl.position.set(g.x, g.y + 13, g.z);
      this.swirl.rotation.set(0, (g.angle ?? 0) + Math.PI / 2, 0);
      this.swirl.scale.setScalar(11);
      const u = (this.swirl.material as ShaderMaterial).uniforms;
      u.uTime!.value = now;
      u.uFade!.value = 1 - gate.since;
      this.swirl.visible = true;
      shown.swirl = true;
    } else this.swirl.visible = false;
    // The tower's ring glows while it charges at its target.
    const tower = sup?.tower;
    const t = this.civic(tower?.civic);
    if (t && tower?.charging) {
      this.towerRing.position.set(t.x, t.y + 34, t.z);
      const u = (this.towerRing.material as ShaderMaterial).uniforms;
      u.uFlash!.value = 0.6 + 0.4 * Math.sin(now * 5);
      u.uRim!.value = 1;
      this.towerRing.visible = true;
      shown.tower = true;
    } else this.towerRing.visible = false;
    this.shown = shown;
  }
}
