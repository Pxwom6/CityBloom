/**
 * The atom bomb on screen (M40 step 11b): the missile on its smoke trail (inbound to the city from
 * the sender's side, or the city's own rising out of its silo), the silo's hatch opening as a launch
 * is prepared, the flash, a toy mushroom cloud with a shock ring on the ground, and the fallout's tint
 * on the ground. Display only: everything is read from the war summary and the display clock and
 * placed by the pure maths in `atomFx.ts`; the sim is never stepped or asked. Toy style, no gore.
 *
 * The cloud and the trail are camera-facing puffs shaded as little spheres (two triangles each, one
 * draw call a group), dithered away as they thin, so they need no sorting. Budget: the cloud is at
 * most `ATOM_FX.maxCalls` draw calls and `maxTriangles` triangles (the plan's), reported in
 * `renderStats().atom`.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DataTexture,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Camera,
} from 'three';
import type { ClientWorld } from '../client/world';
import { GRID_RES } from '../data/world';
import type { NeighbourSide } from '../data/region';
import { handmade } from './assets/handmade';
import type { BakedUnit } from '../models/baked';
import { buildingYaw } from './buildings';
import { mergeGeometries, painted } from './geom';
import type { Lighting } from './lighting';
import { unitGeometry } from './units';
import type { CameraController } from './camera';
import {
  ATOM_FX,
  MAX_PUFFS,
  MAX_TRAIL,
  TICKS_PER_SECOND,
  atomCaps,
  cloudAt,
  cloudPuffs,
  flashAt,
  hatchOpen,
  inboundAt,
  outboundAt,
  outboundScale,
  placePuff,
  shakeAt,
  sideDir,
  type AtomQuality,
  type CloudShape,
  type MissilePose,
  type Puff,
  type PuffPlace,
} from './atomFx';

/**
 * A picture staged by the test API (`showAtom`), in place of what the city's summary says: ground
 * zero, and any of the missile part way (`k` 0 to 1 from the side given), the flash some seconds in,
 * the cloud at an age, the silo's hatch open by a share, or the city's own bomb some ticks after it left.
 */
export interface AtomStage {
  x?: number;
  z?: number;
  side?: NeighbourSide | null;
  missile?: number;
  flash?: number;
  soft?: boolean;
  cloud?: { seconds: number; hours?: number };
  ring?: number;
  hatch?: number;
  launch?: number;
}

const PUFF_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iMisc;
varying vec2 vUv;
varying float vShow;
varying float vHeat;
varying float vShade;
#include <fog_pars_vertex>
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iMisc.x;
  vUv = position.xy;
  vShow = iMisc.y;
  vHeat = iMisc.z;
  vShade = iMisc.w;
  gl_Position = projectionMatrix * mv;
#ifdef USE_FOG
  vFogDepth = -mv.z;
#endif
}`;

const PUFF_FRAG = /* glsl */ `
uniform vec3 uSunView;
uniform vec3 uSunColor;
uniform vec3 uAmb;
uniform vec3 uCool;
uniform vec3 uHot;
varying vec2 vUv;
varying float vShow;
varying float vHeat;
varying float vShade;
#include <fog_pars_fragment>
void main() {
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  vec3 n = vec3(vUv, sqrt(1.0 - r2));
  float lam = max(dot(n, uSunView), 0.0);
  vec3 base = mix(uCool * vShade, uHot, vHeat);
  vec3 col = base * (uAmb + uSunColor * lam) * (0.8 + 0.2 * n.z) + uHot * vHeat * vHeat * 0.55;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

function puffMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: PUFF_VERT,
    fragmentShader: PUFF_FRAG,
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uSunView: { value: new Vector3(0, 1, 0) },
        uSunColor: { value: new Color(1, 1, 1) },
        uAmb: { value: new Color(0.4, 0.4, 0.45) },
        uCool: { value: new Color('#ece6dc') },
        uHot: { value: new Color('#ff9a3c') },
      },
    ]),
    fog: true,
  });
}

/** Camera-facing puffs: a quad a puff, with its place, size, shown share, heat and shade per instance. */
class Puffs {
  readonly mesh: Mesh;
  private pos: InstancedBufferAttribute;
  private misc: InstancedBufferAttribute;
  private geo: InstancedBufferGeometry;
  count = 0;

  constructor(
    readonly max: number,
    material: ShaderMaterial,
  ) {
    const quad = new PlaneGeometry(2, 2);
    this.geo = new InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.pos = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.misc = new InstancedBufferAttribute(new Float32Array(max * 4), 4);
    this.geo.setAttribute('iPos', this.pos);
    this.geo.setAttribute('iMisc', this.misc);
    this.geo.instanceCount = 0;
    this.mesh = new Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  set(
    i: number,
    x: number,
    y: number,
    z: number,
    size: number,
    show: number,
    heat: number,
    shade: number,
  ): void {
    this.pos.setXYZ(i, x, y, z);
    // A puff fades by shrinking (see the shader).
    this.misc.setXYZW(i, size * (0.25 + 0.75 * Math.sqrt(Math.max(0, Math.min(1, show)))), show, heat, shade);
  }

  done(n: number): void {
    this.count = n;
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.pos.clearUpdateRanges();
      this.pos.addUpdateRange(0, n * 3);
      this.pos.needsUpdate = true;
      this.misc.clearUpdateRanges();
      this.misc.addUpdateRange(0, n * 4);
      this.misc.needsUpdate = true;
    }
  }

  get triangles(): number {
    return this.mesh.visible ? this.count * 2 : 0;
  }
}

const GLOW_VERT = /* glsl */ `
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = position.xy;
  vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * uSize;
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = /* glsl */ `
uniform float uOn;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length(vUv);
  if (r > 1.0) discard;
  float a = uOn * (pow(1.0 - r, 2.2) * 0.9 + smoothstep(1.0, 0.0, r) * 0.25);
  gl_FragColor = vec4(uColor * a, a);
}`;

const RING_FRAG = /* glsl */ `
uniform float uOn;
varying vec2 vUv;
void main() {
  float a = uOn * smoothstep(0.0, 0.6, vUv.x) * (1.0 - smoothstep(0.75, 1.0, vUv.x));
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * a, a);
}`;

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  // RingGeometry's uv.x runs across the ring from the inner edge (0) to the outer (1) only roughly:
  // the radius share is what the band needs.
  float r = length(position.xz);
  vUv = vec2(clamp((r - 0.82) / 0.18, 0.0, 1.0), 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** A toy rocket in the game's style, for when the war models haven't loaded (nose up, origin under the fins). */
function generatedRocket(): BufferGeometry {
  const parts = [
    painted(new CylinderGeometry(1.5, 1.5, 10.4, 12).translate(0, 7.2, 0), '#f3f1ea'),
    painted(new CylinderGeometry(1.53, 1.53, 1.7, 12).translate(0, 9.75, 0), '#c8402f'),
    painted(new ConeGeometry(1.5, 5.6, 12).translate(0, 15.2, 0), '#f2c230'),
    painted(new CylinderGeometry(1.52, 1.52, 0.7, 12).translate(0, 13.4, 0), '#26262a'),
    painted(new CylinderGeometry(0.75, 1.05, 1.1, 10).translate(0, 1.45, 0), '#5a5d63'),
  ];
  for (let k = 0; k < 4; k++) {
    const fin = new BoxGeometry(1.7, 6.8, 0.45).translate(2.2, 3.4, 0).rotateY((k * Math.PI) / 2);
    parts.push(painted(fin, '#c8402f'));
  }
  const g = mergeGeometries(
    parts.map((p) => {
      const q = p.index ? p.toNonIndexed() : p;
      q.deleteAttribute('uv');
      return q;
    }),
  );
  g.computeVertexNormals();
  return g;
}

/** The hatch's halves: a half disc of steel with a hazard stripe along its straight edge (radius 1, half thickness 0.5 up from 0). */
function hatchHalf(): BufferGeometry {
  const slab = painted(
    new CylinderGeometry(1, 1, 0.09, 16, 1, false, 0, Math.PI).translate(0, 0.045, 0),
    '#8e949a',
  );
  const stripe = painted(new BoxGeometry(0.16, 0.1, 1.94).translate(0.08, 0.06, 0), '#f2c230');
  const list = [slab, stripe].map((p) => {
    const q = p.index ? p.toNonIndexed() : p;
    q.deleteAttribute('uv');
    return q;
  });
  return mergeGeometries(list);
}

const UP = new Vector3(0, 1, 0);

export interface AtomStats {
  /** The cloud's draw calls and triangles (puffs, the shock ring and the flash), and its puffs. */
  calls: number;
  triangles: number;
  puffs: number;
  /** A missile is in the sky (in or out), the hatch is open, the flash is lit, the ground is tinted. */
  missile: boolean;
  hatch: number;
  flash: number;
  tint: boolean;
  /** The bomb on its way in and the city's own are drawn (both may be in the sky at once). */
  inbound: boolean;
  outbound: boolean;
  /** The camera is following a missile ("Look at the missile"). */
  following: boolean;
}

/** A bomb on its way to the city, as the effects keep it. */
interface Flight {
  warn: number;
  arrive: number;
  x: number;
  z: number;
  side: NeighbourSide | null;
}

/** The end of a flight: a landing at ground zero, or the dome stopping it; its tick and where. */
interface FlightEnd {
  stopped: boolean;
  at: number;
  x: number;
  z: number;
}

/** A camera pose, as the follow keeps the player's own and the last one it set. */
interface Pose {
  x: number;
  z: number;
  distance: number;
  yaw: number;
  tilt: number;
}

/** A flight, by its warning and landing ticks. */
const stopKey = (f: Flight) => `stop:${f.warn}:${f.arrive}`;

const samePose = (a: Pose, b: Pose) =>
  Math.abs(a.x - b.x) < 1e-3 &&
  Math.abs(a.z - b.z) < 1e-3 &&
  Math.abs(a.distance - b.distance) < 1e-3 &&
  Math.abs(a.yaw - b.yaw) < 1e-6 &&
  Math.abs(a.tilt - b.tilt) < 1e-6;

/** The farthest the camera stands from a missile it follows (m; inside the camera's roaming limit). */
const FOLLOW_FAR = 5800;

/** How far out the camera stands over ground zero after a blast it followed the missile to (at least; m). */
const AFTER_BLAST = 2400;

export class AtomEffects {
  readonly group = new Group();
  private q: AtomQuality = atomCaps({ atomPuffs: 500, atomTrail: 60, atomTint: 1 });
  /** Flashes softened (the `reduceFlashes` setting): a 0.8 s fade, and no shake. */
  softFlash = false;
  /** The camera's shake for this frame (m), added by the renderer as the disasters' is. */
  readonly shake = new Vector3();
  /** The flash's strength this frame (0 to 1): the renderer brightens the exposure with it. */
  flash = 0;
  /** A picture staged by the test API, in place of the city's own bomb. */
  stage: AtomStage | null = null;
  /**
   * Called once when the page shows a flight's end (its flash: a landing, or the dome stopping it),
   * for the sounds (`blastSounds`); not for an end the display clock reached too late to flash.
   */
  onBlast: ((stopped: boolean) => void) | null = null;
  stats: AtomStats = {
    calls: 0,
    triangles: 0,
    puffs: 0,
    missile: false,
    hatch: 0,
    flash: 0,
    tint: false,
    inbound: false,
    outbound: false,
    following: false,
  };

  private puffMat = puffMaterial();
  private cloud = new Puffs(MAX_PUFFS, this.puffMat);
  private trailMat = puffMaterial();
  /** Both missiles' trails, one after the other in one draw call. */
  private trail = new Puffs(MAX_TRAIL * 2, this.trailMat);
  private puffs: Puff[] = [];
  private glow: Mesh;
  private ring: Mesh;
  /** The bomb on its way in, and the city's own (in its silo, or leaving it): they share a model. */
  private missile: Mesh;
  private rocket: Mesh;
  private missileFor = -1;
  private hatch: InstancedMesh;
  private pit: Mesh;
  /**
   * The bomb in the air as last read. The summary drops it at the landing, which the display clock
   * may not have reached yet: it is kept, and drawn, until the page shows its end.
   */
  private flying: Flight | null = null;
  /**
   * A flight's end the sim has reached and the display clock hasn't: shown (flashed) when it gets
   * there; with the flight it ends (drawn until then), if this page saw it in the air.
   */
  private pending: (FlightEnd & { flight: Flight | null }) | null = null;
  /** The last end shown: when its flash began (real s), or null if the clock came to it too late to flash. */
  private shown: (FlightEnd & { real: number | null }) | null = null;
  /** The landing's tick and the dome's stops as last read: undefined before the first frame (what is there then is old). */
  private knownImpact: number | null | undefined = undefined;
  private knownStops = 0;
  private lastSimTick = -1;
  private tmp: PuffPlace = { x: 0, y: 0, z: 0, size: 0, show: 0, heat: 0 };
  /**
   * The camera following a missile ("Look at the missile"): which one, the player's own pose when it
   * began (given back after), the pose it set last frame (any other change, from the player or a
   * command such as "Show where", ends the follow), and the player's moves when it began.
   */
  private following: { which: 'in' | 'out'; saved: Pose; set: Pose | null; moves: number } | null = null;
  private inPose: MissilePose | null = null;
  private outPose: MissilePose | null = null;
  /** The side each missile comes from or goes to (the follow stands beside its way). */
  private inSide: NeighbourSide | null = null;
  private outSide: NeighbourSide | null = null;

  constructor(
    private readonly world: ClientWorld,
    private readonly terrain: { uniforms: { uRad: { value: DataTexture }; uRadOn: { value: number } } },
  ) {
    this.group.name = 'atom';
    this.puffs = cloudPuffs(this.q.atomPuffs);
    // The trail is a pale smoke, a little warmer than the cloud.
    (this.trailMat.uniforms.uCool!.value as Color).set('#f4f1ea');
    const glowMat = new ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uOn: { value: 0 }, uSize: { value: 1 }, uColor: { value: new Color(1, 0.97, 0.88) } },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.glow = new Mesh(new PlaneGeometry(2, 2), glowMat);
    this.ring = new Mesh(
      new RingGeometry(0.82, 1, 128, 1).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        uniforms: { uOn: { value: 0 } },
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        side: DoubleSide,
      }),
    );
    const rocketMat = new MeshLambertMaterial({ vertexColors: true });
    const model = generatedRocket();
    this.missile = new Mesh(model, rocketMat);
    this.rocket = new Mesh(model, rocketMat);
    this.missile.castShadow = this.rocket.castShadow = true;
    this.hatch = new InstancedMesh(hatchHalf(), new MeshLambertMaterial({ vertexColors: true }), 2);
    this.hatch.castShadow = true;
    this.pit = new Mesh(
      new SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, -0.6, 1),
      new MeshLambertMaterial({ color: '#141414', side: DoubleSide }),
    );
    for (const m of [
      this.cloud.mesh,
      this.trail.mesh,
      this.glow,
      this.ring,
      this.missile,
      this.rocket,
      this.hatch,
      this.pit,
    ]) {
      m.visible = false;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.glow.renderOrder = 20;
    this.ring.renderOrder = 9;
  }

  set quality(q: AtomQuality) {
    const c = atomCaps(q);
    if (c.atomPuffs !== this.q.atomPuffs) this.puffs = cloudPuffs(c.atomPuffs);
    this.q = c;
  }

  get quality(): AtomQuality {
    return { ...this.q };
  }

  /** The fallout's tint on the ground, from the radiation map's values (-1 none; 0.3 and over: ground). */
  setRadiation(values: Float32Array | null): void {
    const tex = this.terrain.uniforms.uRad.value;
    const data = tex.image.data as Uint8Array;
    let any = false;
    for (let k = 0; k < GRID_RES * GRID_RES; k++) {
      const v = values ? (values[k] ?? -1) : -1;
      // Air alone (under 0.3) leaves the grass as it is; ground from the first amber band, strongest at the core.
      const t = v < 0.28 ? 0 : Math.min(1, 0.25 + (v - 0.28) * 1.05);
      data[k] = Math.round(t * 255);
      if (t > 0) any = true;
    }
    tex.needsUpdate = true;
    this.hasTint = any;
  }
  private hasTint = false;

  /** A missile is in the sky now (inbound to the city, or the city's own leaving). */
  get canLook(): boolean {
    return this.inPose !== null || this.outPose !== null;
  }

  /**
   * "Look at the missile": the camera goes to the bomb on its way in (else the city's own leaving)
   * and follows it, past the map's edge if need be, until it lands (then it stands back over ground
   * zero, as the player had it turned), it has gone (the player's own view back), or anything else
   * moves the camera.
   */
  look(controller: CameraController): boolean {
    const which = this.inPose ? 'in' : this.outPose ? 'out' : null;
    if (!which) return false;
    const g = controller.goal;
    this.following = {
      which,
      // (Asked again while following, the player's own view is still the one from before.)
      saved: this.following?.saved ?? { x: g.x, z: g.z, distance: g.distance, yaw: g.yaw, tilt: g.tilt },
      set: null,
      moves: controller.userMoves,
    };
    controller.roam = true;
    return true;
  }

  /**
   * The follow ends: the camera keeps to the map and its zoom again (eased back from where it is, so
   * nothing jumps) and, if asked, takes this pose.
   */
  private endFollow(controller: CameraController, pose: Partial<Pose> | null): void {
    this.following = null;
    controller.release();
    if (pose) controller.setPose(pose);
  }

  private ground(x: number, z: number): number {
    return Math.max(0, this.world.heightAt(x, z));
  }

  /** The silo (its civic and where its hatch is), if the city has one standing. */
  private silo(): { x: number; y: number; z: number; r: number; yaw: number } | null {
    for (const c of this.world.civics.values()) {
      if (c.def !== 'atomsilo' || c.stage !== undefined) continue;
      // The hand-made silo's hatch is in the middle of the site, the generated one's 3 m behind it.
      const hand = !!handmade.warList().designs.find((d) => d.def === 'atomsilo');
      const yaw = buildingYaw(c);
      const lz = hand ? 0 : 3;
      const top = hand ? 4.3 : 2.92;
      const r = hand ? 4.9 : 6.4;
      // Local (0, lz) turned by the yaw (three's Y rotation: x' = x cos + z sin, z' = -x sin + z cos).
      return { x: c.x + lz * Math.sin(yaw), y: c.y + top, z: c.z + lz * Math.cos(yaw), r, yaw };
    }
    return null;
  }

  private missileModel(): void {
    const u: BakedUnit | null = handmade.unit('atombomb');
    const v = u ? handmade.version : -2;
    if (v === this.missileFor) return;
    this.missileFor = v;
    this.missile.geometry.dispose();
    this.missile.geometry = this.rocket.geometry = u ? unitGeometry(u, false) : generatedRocket();
  }

  private place(mesh: Mesh, p: MissilePose, scale: number): void {
    this.missileModel();
    mesh.position.set(p.x, p.y, p.z);
    mesh.quaternion.setFromUnitVectors(UP, new Vector3(p.dx, p.dy, p.dz));
    mesh.scale.setScalar(scale);
    mesh.visible = true;
  }

  /**
   * A smoke trail behind a missile, from puff `from` on: puffs at its own earlier places, growing and
   * thinning with age, spaced along the way it came (a fast rocket's are as close as a slow one's),
   * the first two a small hot glow at the nozzle. Returns the next free puff.
   */
  private placeTrail(at: (tick: number) => MissilePose | null, tick: number, from: number): number {
    let n = from;
    const max = this.q.atomTrail;
    const here = at(tick);
    const back = at(tick - 1);
    const speed = here && back ? Math.hypot(here.x - back.x, here.y - back.y, here.z - back.z) : 4;
    // Ticks between puffs: about 7 m apart (the trail's puffs are 8 m and more), never finer than a tenth of a tick.
    const step = Math.max(0.1, Math.min(3, 7 / Math.max(0.1, speed)));
    for (let i = 1; i <= max; i++) {
      const p = at(tick - i * step);
      if (!p) break;
      const age = i / max;
      const hot = i <= 2;
      this.trail.set(n++, p.x, p.y, p.z, hot ? 3.5 : 8 + 22 * age, 1 - age * 0.8, hot ? 0.7 : 0, 1);
    }
    return n;
  }

  /**
   * The city's bomb flights as the summary says, a frame at a time: the bomb in the air (kept after the
   * summary drops it, until its end is shown), a landing or a dome's stop the sim has reached (shown
   * when the display clock reaches it: the flash, the ring, the sound), and what has been shown.
   * Returns the end shown this frame, if any.
   */
  private readFlights(now: number, tick: number): FlightEnd | null {
    const w = this.world;
    const a = w.stats.war?.atom ?? null;
    const inbound = a?.inbound ?? null;
    const impactAt = a?.impact?.at ?? null;
    const stops = a?.stopped ?? 0;
    const simTick = w.stats.tick;
    // Ends first, against the flight as it was before this read: a bomb warned in the same read (a
    // friend's bomb sent again, a rival's retried launch) must not take the ending one's place.
    const prev = this.flying;
    if (this.knownImpact === undefined) {
      // The first look: a landing or a stop already there happened before this page was watching.
      this.knownImpact = impactAt;
      this.knownStops = stops;
      if (impactAt !== null) this.remember(`hit:${impactAt}`);
    } else {
      // (A sim put back to before an end, a co-op city's resync, brings the same end round again:
      // each is shown once.)
      if (impactAt !== null && impactAt !== this.knownImpact && !this.ends.includes(`hit:${impactAt}`))
        this.pending = {
          stopped: false,
          at: impactAt,
          x: a!.impact!.x,
          z: a!.impact!.z,
          flight: prev && prev.arrive <= impactAt ? prev : null,
        };
      if (stops > this.knownStops && prev && !this.ends.includes(stopKey(prev))) {
        // The dome stopped it at its landing, somewhere since the last tick this page read.
        const at = Math.min(simTick, Math.max(prev.arrive, this.lastSimTick));
        this.pending = { stopped: true, at, x: prev.x, z: prev.z, flight: prev };
      }
      this.knownImpact = impactAt;
      this.knownStops = stops;
    }
    this.lastSimTick = simTick;
    if (inbound)
      this.flying = {
        warn: inbound.warn,
        arrive: inbound.arrive,
        x: inbound.x,
        z: inbound.z,
        side: inbound.side,
      };
    let ended: FlightEnd | null = null;
    const p = this.pending;
    if (p && tick >= p.at) {
      // The display clock has reached it: the flash now, unless the clock came to it long after.
      const late = tick - p.at >= ATOM_FX.flashWindow * TICKS_PER_SECOND;
      this.shown = { stopped: p.stopped, at: p.at, x: p.x, z: p.z, real: late ? null : now };
      this.pending = null;
      this.remember(p.stopped && p.flight ? stopKey(p.flight) : `hit:${p.at}`);
      if (p.flight && this.flying && stopKey(this.flying) === stopKey(p.flight)) this.flying = null;
      if (!late) this.onBlast?.(p.stopped);
      ended = p;
    }
    // A flight gone with no end to show (a save loaded, say) is let go.
    if (!inbound && !this.pending) this.flying = null;
    return ended;
  }

  /** Ends shown (a few, the latest last), so none is shown twice. */
  private ends: string[] = [];
  private remember(key: string): void {
    this.ends.push(key);
    if (this.ends.length > 16) this.ends.shift();
  }

  update(
    now: number,
    tick: number,
    camera: Camera,
    light: Lighting,
    controller: CameraController,
    windAngle: number,
  ): void {
    const w = this.world;
    const a = w.stats.war?.atom ?? null;
    const st = this.stage;
    this.shake.set(0, 0, 0);
    this.flash = 0;
    this.missile.visible = false;
    this.rocket.visible = false;
    this.cloud.done(0);
    this.ring.visible = false;
    this.glow.visible = false;
    this.hatch.visible = false;
    this.pit.visible = false;
    this.inPose = null;
    this.outPose = null;
    let trail = 0;
    let cloudCalls = 0;
    let cloudTris = 0;

    // Shared lighting for the puffs: the sun in view space, its colour, and the sky's light round them.
    for (const m of [this.puffMat, this.trailMat]) {
      const u = m.uniforms;
      (u.uSunView!.value as Vector3).copy(light.sunDir).transformDirection(camera.matrixWorldInverse);
      (u.uSunColor!.value as Color).copy(light.sunColor).multiplyScalar(0.55 + 0.25 * light.light);
      // (The sky's own colour, half greyed: a moonlit cloud is pale, not blue.)
      const amb = u.uAmb!.value as Color;
      amb.copy(light.hemi.color).multiplyScalar(light.hemi.intensity * 0.45);
      const grey = (amb.r + amb.g + amb.b) / 3;
      amb.lerp(new Color(grey, grey, grey), 0.5).add(new Color(0.06, 0.06, 0.07));
    }

    // ---------------------------------------------------------------- the bomb on its way in
    const ended = st ? null : this.readFlights(now, tick);
    const flight: Flight | null = st
      ? st.missile !== undefined
        ? { warn: 0, arrive: 1000, x: st.x ?? 1024, z: st.z ?? 1024, side: st.side ?? null }
        : null
      : // In the sky until the page shows its end (circling over ground zero while the sim holds it
        // back); a bomb warned meanwhile waits for it.
        (this.pending?.flight ?? a?.inbound ?? null);
    if (flight) {
      const g = this.ground(flight.x, flight.z);
      const f = { warn: flight.warn, arrive: flight.arrive, x: flight.x, z: flight.z, side: flight.side };
      const at = (t: number) => inboundAt(f, g, t);
      const t = st ? st.missile! * 1000 : tick;
      const p = at(t);
      if (p) {
        this.place(this.missile, p, ATOM_FX.scale);
        trail = this.placeTrail(at, t, trail);
        this.inPose = p;
        this.inSide = flight.side;
      }
    }

    // ---------------------------------------------------------------- the city's own bomb
    // In the silo with the hatch open, then rising out of it and away (drawn whether or not a bomb is
    // on its way in at the same time).
    const siloAt = this.silo();
    const fired = st ? (st.launch !== undefined ? 0 : null) : (a?.fired?.tick ?? null);
    const firedSide = st ? (st.side ?? null) : (a?.fired?.side ?? null);
    const launchTick = st?.launch !== undefined ? st.launch : tick;
    let open = 0;
    if (siloAt) {
      open =
        st?.hatch !== undefined
          ? st.hatch
          : st
            ? st.launch !== undefined
              ? hatchOpen(null, 0, st.launch)
              : 0
            : hatchOpen(a?.launch ?? null, fired, tick);
      if (open > 0.01) {
        // Two halves slid apart across the hatch, and the dark shaft between them.
        const r = siloAt.r;
        const m = new Matrix4();
        const q = new Quaternion();
        for (const s of [-1, 1]) {
          const side = s * (0.02 + open * 1.02) * r;
          const off = new Vector3(side, 0.08, 0).applyAxisAngle(UP, siloAt.yaw);
          q.setFromAxisAngle(UP, siloAt.yaw + (s < 0 ? Math.PI : 0));
          m.compose(
            new Vector3(siloAt.x + off.x, siloAt.y + 0.08, siloAt.z + off.z),
            q,
            new Vector3(r, 1, r),
          );
          this.hatch.setMatrixAt(s < 0 ? 0 : 1, m);
        }
        this.hatch.instanceMatrix.needsUpdate = true;
        this.hatch.visible = true;
        this.pit.position.set(siloAt.x, siloAt.y + 0.04, siloAt.z);
        this.pit.scale.set(r * Math.min(1, open * 1.1), 6, r * Math.min(1, open * 1.1));
        this.pit.visible = true;
      }
      const holding = st
        ? st.hatch !== undefined && st.launch === undefined
        : !!(a?.have || a?.launch) && fired === null;
      const out = fired !== null ? outboundAt(siloAt, firedSide, fired, launchTick) : null;
      if (out) {
        this.place(this.rocket, out, outboundScale(out));
        trail = this.placeTrail((t) => outboundAt(siloAt, firedSide, fired!, t), launchTick, trail);
        this.outPose = out;
        this.outSide = firedSide;
      } else if (holding && open > 0.3) {
        // The bomb in its silo, its nose up out of the open hatch.
        this.place(
          this.rocket,
          { x: siloAt.x, y: siloAt.y - 12 + 6 * open, z: siloAt.z, dx: 0, dy: 1, dz: 0, k: 0 },
          1,
        );
      }
    }
    this.trail.done(trail);

    // ---------------------------------------------------------------- the end: flash, ring, cloud
    const soft = st?.soft ?? this.softFlash;
    let gz: { x: number; z: number } | null = null;
    let flashT: number | null = null;
    let ringT: number | null = null;
    let stopped = false;
    if (st) {
      if (st.flash !== undefined || st.cloud || st.ring !== undefined)
        gz = { x: st.x ?? 1024, z: st.z ?? 1024 };
      if (st.flash !== undefined) flashT = st.flash;
      if (st.ring !== undefined) ringT = st.ring;
      else if (st.flash !== undefined) ringT = st.flash;
    } else {
      const s = this.shown;
      if (s && s.real !== null && now - s.real < 8) {
        gz = { x: s.x, z: s.z };
        flashT = now - s.real;
        ringT = s.stopped ? null : now - s.real;
        stopped = s.stopped;
      }
    }
    if (flashT !== null && gz) {
      const f = flashAt(flashT, soft) * (stopped ? 0.35 : 1);
      if (f > 0.001) {
        const g = this.ground(gz.x, gz.z);
        // A dome's stop is high over the city, on its shell; a landing bursts at the dive's end.
        this.glow.position.set(gz.x, g + (stopped ? 420 : ATOM_FX.hover), gz.z);
        const gu = (this.glow.material as ShaderMaterial).uniforms;
        gu.uOn!.value = Math.min(1, f * 1.4);
        gu.uSize!.value = stopped ? 700 : 1500;
        (gu.uColor!.value as Color).set(stopped ? '#cfe8ff' : '#fff6e0');
        this.glow.visible = true;
        this.flash = stopped ? f * 0.4 : f;
        cloudCalls++;
        cloudTris += 2;
      }
      const sh = stopped ? 0 : shakeAt(flashT, soft);
      if (sh > 0)
        this.shake.set(Math.sin(now * 61) * sh, Math.sin(now * 47 + 1) * sh * 0.5, Math.cos(now * 53) * sh);
    }
    if (ringT !== null && gz && ringT < ATOM_FX.ringSeconds) {
      const k = ringT / ATOM_FX.ringSeconds;
      const r = 40 + ATOM_FX.ring * (1 - (1 - k) * (1 - k));
      this.ring.position.set(gz.x, this.ground(gz.x, gz.z) + 3, gz.z);
      this.ring.scale.set(r, 1, r);
      (this.ring.material as ShaderMaterial).uniforms.uOn!.value = (1 - k) * 0.8;
      this.ring.visible = true;
      cloudCalls++;
      cloudTris += 256;
    }

    // The cloud: from the staged age, or the landing's tick (and real time since its flash, if this
    // page showed it) once the display clock has reached the landing: never before its flash.
    let shape: CloudShape | null = null;
    let at: { x: number; z: number } | null = null;
    if (st?.cloud) {
      shape = cloudAt(st.cloud.seconds, st.cloud.hours ?? st.cloud.seconds / 7.5);
      at = { x: st.x ?? 1024, z: st.z ?? 1024 };
    } else if (!st && a?.impact && a.impact.at !== null && tick >= a.impact.at) {
      const landing = a.impact.at;
      const waiting = this.pending && !this.pending.stopped && this.pending.at === landing;
      if (!waiting) {
        const s = this.shown;
        const real = s && !s.stopped && s.at === landing && s.real !== null ? now - s.real : 0;
        const ticks = tick - landing;
        shape = cloudAt(Math.max(ticks / TICKS_PER_SECOND, real), ticks / 60);
        at = { x: a.impact.x, z: a.impact.z };
      }
    }
    if (shape && at) {
      const g = this.ground(at.x, at.z);
      const dx = Math.cos(windAngle) * shape.drift;
      const dz = Math.sin(windAngle) * shape.drift;
      let n = 0;
      for (const p of this.puffs) {
        const o = placePuff(p, shape, now, this.tmp);
        // As a part thins, its puffs go one by one (each at its own moment) while the rest shrink.
        if (o.show <= 0.02 || o.show < p.phase * 0.45) continue;
        // The stem leans with the drift (its foot stays), the cap goes with it.
        const lean = p.part === 0 ? o.y / Math.max(1, shape.height) : 1;
        this.cloud.set(
          n++,
          at.x + o.x + dx * lean,
          g + o.y,
          at.z + o.z + dz * lean,
          o.size,
          o.show,
          o.heat,
          p.part === 0 ? 0.88 : p.part === 2 ? 1.08 : 1,
        );
      }
      this.cloud.done(n);
      cloudCalls += n > 0 ? 1 : 0;
      cloudTris += n * 2;
    }

    // ---------------------------------------------------------------- the camera following a missile
    this.follow(controller, ended);

    // ---------------------------------------------------------------- the fallout's tint
    const tint = this.q.atomTint === 1 && this.hasTint;
    this.terrain.uniforms.uRadOn.value = tint ? 1 : 0;

    this.stats = {
      calls: cloudCalls,
      triangles: cloudTris,
      puffs: this.cloud.count,
      missile: this.missile.visible || this.rocket.visible,
      hatch: open,
      flash: this.flash,
      tint,
      inbound: this.missile.visible,
      outbound: this.rocket.visible,
      following: this.following !== null,
    };
  }

  /**
   * "Look at the missile", a frame at a time: anything else that moved the camera since last frame
   * (the player, or a command such as "Show where", a preset or a fly-to) ends it there; the flight's
   * end shown this frame stands the camera back over ground zero, turned as the player had it; a
   * missile gone with no end (the city's own, out of sight) gives the player's own view back; else
   * the camera stands beside the missile's way and a little behind, high enough to look down on it,
   * with the missile in the middle of the view (outside photo mode the camera can't look up).
   */
  private follow(controller: CameraController, ended: FlightEnd | null): void {
    const fol = this.following;
    if (!fol) return;
    const g = controller.goal;
    if (controller.userMoves !== fol.moves) {
      this.endFollow(controller, null);
      return;
    }
    if (fol.set && !samePose(g, fol.set)) {
      // A command moved it ("Show where", a fly-to, following a battle): it goes where it was sent, but
      // one that kept the follow's own turn and tilt (they build on the pose they find) gets the
      // player's back, not the follow's low, sideways look. A preset sets its own and keeps them.
      const kept = Math.abs(g.yaw - fol.set.yaw) < 1e-6 && Math.abs(g.tilt - fol.set.tilt) < 1e-6;
      this.endFollow(controller, kept ? { yaw: fol.saved.yaw, tilt: fol.saved.tilt } : null);
      return;
    }
    if (ended && fol.which === 'in') {
      const s = fol.saved;
      this.endFollow(controller, {
        x: ended.x,
        z: ended.z,
        distance: Math.max(AFTER_BLAST, s.distance),
        yaw: s.yaw,
        tilt: s.tilt,
      });
      return;
    }
    const p = fol.which === 'in' ? this.inPose : this.outPose;
    if (!p) {
      this.endFollow(controller, fol.saved);
      return;
    }
    const sd = sideDir(fol.which === 'in' ? this.inSide : this.outSide);
    const ax = -sd.z * 0.8 + sd.x * 0.6;
    const az = sd.x * 0.8 + sd.z * 0.6;
    const yaw = Math.atan2(ax, az);
    const tilt = -0.35;
    // The camera looks at a point on the ground (`back` beyond the missile, on the far side from the
    // camera) whose view's middle ray passes through the missile. Its height over that ground, not the
    // ground under the missile, sets `back` (the hills past the map's edge stand far higher than the
    // sea under a missile); and the camera stands far enough out to be above the missile and short of
    // it, since the camera's pitch flattens as it comes in (at 900 m it is barely 9 degrees).
    let distance = Math.min(FOLLOW_FAR, Math.max(900, (p.y - this.ground(p.x, p.z)) * 2.4 + 600));
    let x = p.x;
    let z = p.z;
    for (let i = 0; i < 24; i++) {
      const pitch = controller.pitchFor({ x: 0, z: 0, distance, yaw, tilt });
      // (A missile lower than the hills the view meets has its ground point short of it: `back` < 0.)
      // Settled by halves: on a hillside each step's ground is another height, and full steps can swing.
      let back = (p.y - this.ground(x, z)) / Math.tan(pitch);
      for (let j = 0; j < 12; j++)
        back += ((p.y - this.ground(p.x - ax * back, p.z - az * back)) / Math.tan(pitch) - back) * 0.5;
      x = p.x - ax * back;
      z = p.z - az * back;
      const rise = p.y - this.ground(x, z);
      back = rise / Math.tan(pitch);
      const above = distance * Math.sin(pitch) - rise >= 120;
      const short = distance * Math.cos(pitch) >= back + 200;
      // And over the hills under the camera itself (it would lift itself clear of them, off the aim).
      const run = distance * Math.cos(pitch);
      const clear = p.y - rise + distance * Math.sin(pitch) >= this.ground(x + ax * run, z + az * run) + 40;
      if ((above && short && clear) || distance >= FOLLOW_FAR) break;
      distance = Math.min(FOLLOW_FAR, distance * 1.12);
    }
    controller.setPose({ x, z, distance, yaw, tilt });
    fol.set = { x: g.x, z: g.z, distance: g.distance, yaw: g.yaw, tilt: g.tilt };
  }
}
