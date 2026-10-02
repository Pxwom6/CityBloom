import { JUNCTION } from '../data/balance';
import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { ClientWorld } from '../client/world';
import { ROAD_TYPES, isRail } from '../data/roads';

const MAX = 6000;
const SPACING = 34;

/**
 * Street lamps along every road (not dirt tracks or the highway): posts with lamp heads that glow
 * at night, and soft pools of light on the road beneath them.
 */
export class StreetLightRenderer {
  readonly group = new Group();
  private posts: InstancedMesh;
  private heads: InstancedMesh;
  private pools: InstancedMesh;
  private headMat = new MeshBasicMaterial({ color: new Color('#9aa0a6') });
  private poolMat: ShaderMaterial;
  private version = -1;
  count = 0;

  constructor(private world: ClientWorld) {
    const post = new BoxGeometry(0.22, 7, 0.22).translate(0, 3.5, 0);
    this.posts = new InstancedMesh(post, new MeshLambertMaterial({ color: new Color('#6f757c') }), MAX);
    const head = new BoxGeometry(1.4, 0.25, 0.5).translate(0.6, 7.05, 0);
    this.heads = new InstancedMesh(head, this.headMat, MAX);
    this.poolMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      // Pull towards the camera so the pools never lose to the road surface far away.
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
      uniforms: { uNight: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uNight;
        varying vec2 vUv;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a = a * a * uNight * 0.75;
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.45) * a, a);
        }`,
    });
    const pool = new PlaneGeometry(22, 22).rotateX(-Math.PI / 2);
    this.pools = new InstancedMesh(pool, this.poolMat, MAX);
    this.pools.renderOrder = 3;
    for (const m of [this.posts, this.heads, this.pools]) {
      m.count = 0;
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.posts.castShadow = true;
    this.posts.name = 'street-lamps';
  }

  private rebuild(): void {
    const w = this.world;
    const m = new Matrix4();
    const q = new Quaternion();
    const p = new Vector3();
    const s = new Vector3(1, 1, 1);
    const up = new Vector3(0, 1, 0);
    let n = 0;
    for (const seg of [...w.netState.segments.values()].sort((a, b) => a.id - b.id)) {
      const t = ROAD_TYPES[seg.type];
      if (seg.type === 'highway' || seg.type === 'dirt' || isRail(seg.type)) continue;
      const curve = w.net.curve(seg.id);
      const half = t.width / 2 + Math.min(1.2, t.sidewalk * 0.5);
      // No lamps on a roundabout's ring or island (M19).
      const ringA = w.netState.nodes.get(seg.a)?.roundabout;
      const ringB = w.netState.nodes.get(seg.b)?.roundabout;
      const clearA = ringA ? ringA + JUNCTION.ringWidth / 2 + 4 : 12;
      const clearB = ringB ? ringB + JUNCTION.ringWidth / 2 + 4 : 12;
      let side = 1;
      for (let d = clearA; d < curve.length - clearB && n < MAX; d += SPACING) {
        const pt = curve.pointAt(d);
        const tan = curve.tangentAt(d);
        const nx = tan.z * side;
        const nz = -tan.x * side;
        const x = pt.x + nx * half;
        const z = pt.z + nz * half;
        const y = w.roadHeight(seg.id, d, pt.x, pt.z);
        // The arm points over the road.
        q.setFromAxisAngle(up, Math.atan2(nz, -nx));
        p.set(x, y, z);
        m.compose(p, q, s);
        this.posts.setMatrixAt(n, m);
        this.heads.setMatrixAt(n, m);
        // Above the asphalt (0.2 m) and sidewalk (0.34 m) lifts.
        p.set(pt.x + nx * (half - 3), y + 0.42, pt.z + nz * (half - 3));
        m.compose(p, new Quaternion(), s);
        this.pools.setMatrixAt(n, m);
        n++;
        side = -side;
      }
    }
    this.count = n;
    for (const mesh of [this.posts, this.heads, this.pools]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Posts cast shadows only close up: from further off they are a pixel wide (M26). */
  set postShadows(on: boolean) {
    this.posts.castShadow = on;
  }

  /**
   * `distance`: the camera's. From far off the pools of light are dimmer (walk-through after M28:
   * from the whole-city view at night they were bigger than the houses, strings of pearls).
   */
  update(night: number, distance = 0): void {
    if (this.version !== this.world.netVersion) {
      this.version = this.world.netVersion;
      this.rebuild();
    }
    const far = Math.min(1, Math.max(0, (distance - 900) / 1500));
    this.poolMat.uniforms.uNight!.value = night * (1 - 0.7 * far);
    // The lamp heads light up at night; from far off much less, or the glow blooms each into a
    // white pearl bigger than the houses.
    this.pools.visible = night > 0.05;
    const lit = night * (1 - 0.75 * far);
    this.headMat.color.setRGB(0.6 + 0.4 * lit, 0.62 + 0.28 * lit, 0.65 - 0.05 * lit);
  }
}
