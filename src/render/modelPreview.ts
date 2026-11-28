/**
 * A player's model on a turntable (M46, My Buildings): drawn with the game's own building material
 * (its lit windows, seasonal lawns and snow on flat tops) on a patch of ground in the season picked,
 * by day or by night. A small WebGL view of its own, made while the panel shows it and thrown away
 * when it closes.
 */
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DataTexture,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  PlaneGeometry,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderer,
} from 'three';
import type { Season } from '../data/climate';
import type { ModelData } from './assets/builder';
import { makeMaterial, type BuildingUniforms } from './buildings';
import type { TerrainUniforms } from './terrain';
import { pureSeason, type WeatherUniforms } from './weather';

export interface PreviewLook {
  night: boolean;
  season: Season;
}

/** The ground's colour in each season (the terrain's grass, roughly). */
const GROUND: Record<Season, number> = {
  spring: 0x86b35e,
  summer: 0x7aa651,
  autumn: 0x9a9a4e,
  winter: 0xe8edf2,
};

/** Where the camera stands, from the front (radians to its right), and the sun, from the camera. */
const CAMERA_SIDE = 0.55;
const SUN_SIDE = -0.9;
/** Frames a second at most: a small view beside the city needn't take a whole frame's worth. */
const PREVIEW_FPS = 30;

/** A window's chance of being lit, the same each time it's drawn (a hash of its number). */
function lit(n: number, chance: number): boolean {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 < chance;
}

/** The model's geometry with each window lit or not, as one copy in the city would be. */
function geometryOf(m: ModelData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new BufferAttribute(m.nrm, 3));
  g.setAttribute('color', new BufferAttribute(m.col, 3));
  const emi = m.emi.slice();
  if (m.win && m.winChance)
    for (let i = 0; i < emi.length; i++) {
      const w = m.win[i]!;
      if (w > 0) emi[i] = lit(w, m.winChance[w - 1] ?? 0) ? 1 : 0;
    }
  g.setAttribute('emissive', new BufferAttribute(emi, 1));
  g.computeBoundingSphere();
  return g;
}

export class ModelPreview {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(32, 1, 0.5, 2000);
  private sun = new DirectionalLight(0xfff4e0, 2.2);
  private sky = new HemisphereLight(0xcfe3ff, 0x6f7f5a, 1.1);
  private ambient = new AmbientLight(0xffffff, 0.15);
  private ground: Mesh<CircleGeometry, MeshLambertMaterial>;
  private mesh: Mesh | null = null;
  /** What turns on the table: the model, and in street mode its road and neighbours (M47). */
  private group = new Group();
  private street: Mesh[] = [];
  /** In a street the table sways a little either side of the front instead of turning right round. */
  private sway = false;
  private clock = 0;
  private building: BuildingUniforms = {
    uNight: { value: 0 },
    uWindow: { value: new Color(1.0, 0.8, 0.5) },
    uLod: { value: new Vector4(1e6, 1e6 + 1, 1e6 + 2, 1e6 + 3) },
    uLodEye: { value: new Vector3() },
  };
  private weather: WeatherUniforms = {
    uSnow: { value: 0 },
    uWet: { value: 0 },
    uSeason: { value: new Vector4(0, 1, 0, 0) },
    uRoadSnow: { value: new DataTexture(new Uint8Array(4), 1, 1) },
    uGrade: { value: new Vector2() },
  };
  private material;
  private radius = 10;
  private height = 6;
  /** The turntable's angle: the model turns, the camera and sun stay (its lit side always shows). */
  private angle = 0;
  private frame = 0;
  private last = 0;
  private drawn = 0;
  private fog = new Fog(0xbcd8f0, 40, 90);
  /** The turntable turns (off for a still picture). */
  spinning = true;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const terrain = {
      uOverlay: { value: new DataTexture(new Uint8Array(4), 1, 1) },
      uOverlayOn: { value: 0 },
      uMapSize: { value: 1 },
    } as unknown as TerrainUniforms;
    this.material = makeMaterial(this.building, terrain, false, this.weather, 0);
    this.ground = new Mesh(new CircleGeometry(1, 48), new MeshLambertMaterial({ color: GROUND.summer }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.scene.add(this.sun, this.sun.target, this.sky, this.ambient, this.ground, this.group);
    this.scene.fog = this.fog;
    this.setLook({ night: false, season: 'summer' });
  }

  /** Show a model (as `civicLook` builds it: centred on its site, front to −z). */
  show(m: ModelData): void {
    this.clearStreet();
    this.sway = false;
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    const g = geometryOf(m);
    this.mesh = new Mesh(g, this.material);
    this.group.add(this.mesh);
    const s = g.boundingSphere!;
    this.radius = Math.max(4, s.radius);
    this.height = Math.max(2, m.height);
    this.ground.scale.setScalar(this.radius * 8);
    this.draw();
  }

  /**
   * The model on its lot in a street (M47, the Workshop's See step): a road along its front and the
   * game's own buildings either side, fronts in line with its site's. `site` is the model's site (m).
   */
  showStreet(
    m: ModelData,
    site: { w: number; d: number },
    neighbours: { model: ModelData; w: number; d: number }[],
  ): void {
    this.show(m);
    let left = -site.w / 2 - 2;
    let right = site.w / 2 + 2;
    neighbours.forEach((n, i) => {
      const mesh = new Mesh(geometryOf(n.model), this.material);
      const onLeft = i % 2 === 0;
      const x = onLeft ? left - n.w / 2 : right + n.w / 2;
      if (onLeft) left -= n.w + 2;
      else right += n.w + 2;
      mesh.position.set(x, 0, n.d / 2 - site.d / 2);
      this.group.add(mesh);
      this.street.push(mesh);
    });
    const road = new Mesh(
      new PlaneGeometry(right - left + 16, 9),
      new MeshLambertMaterial({ color: 0x6b7178 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set((left + right) / 2, 0.01, -site.d / 2 - 5.5);
    this.group.add(road);
    this.street.push(road);
    // The camera stays on the model (the street runs out of the picture); the ground reaches past it.
    this.ground.scale.setScalar(Math.max(this.radius * 8, (right - left) * 2));
    this.sway = true;
    this.clock = 0;
    this.draw();
  }

  private clearStreet(): void {
    for (const m of this.street) {
      this.group.remove(m);
      m.geometry.dispose();
      if (m.material !== this.material) (m.material as MeshLambertMaterial).dispose();
    }
    this.street = [];
  }

  setLook(look: PreviewLook): void {
    const night = look.night;
    this.building.uNight.value = night ? 1 : 0;
    const w = pureSeason(look.season);
    this.weather.uSeason.value.set(w[0], w[1], w[2], w[3]);
    this.weather.uSnow.value = look.season === 'winter' ? 0.8 : 0;
    this.ground.material.color.setHex(GROUND[look.season]);
    if (night) this.ground.material.color.multiplyScalar(0.35);
    const sky = new Color(night ? 0x141c2e : look.season === 'winter' ? 0xd9e2ec : 0xbcd8f0);
    this.scene.background = sky;
    this.fog.color.copy(sky);
    // By night a moon's light and the sky's glow, enough to see its shape by its windows.
    this.sun.intensity = night ? 0.3 : look.season === 'winter' ? 1.6 : 2.2;
    this.sun.color.setHex(night ? 0x8fa6d9 : 0xfff4e0);
    this.sky.intensity = night ? 0.45 : 1.1;
    this.ambient.intensity = night ? 0.1 : 0.15;
    this.draw();
  }

  private draw(): void {
    const w = this.canvas.clientWidth || this.canvas.width;
    const h = this.canvas.clientHeight || this.canvas.height;
    if (!w || !h) return;
    const size = this.renderer.getSize(new Vector2());
    if (size.x !== w || size.y !== h) this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const dist = this.radius * 2.6;
    const look = new Vector3(0, this.height * 0.4, 0);
    // The front faces −z: the table starts with it towards the camera, a little to one side.
    this.camera.position.set(
      Math.sin(CAMERA_SIDE) * dist,
      look.y + dist * 0.45,
      -Math.cos(CAMERA_SIDE) * dist,
    );
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    this.building.uLodEye.value.copy(this.camera.position);
    const sun = CAMERA_SIDE + SUN_SIDE;
    this.sun.position.set(Math.sin(sun) * dist, dist * 1.3, -Math.cos(sun) * dist);
    this.fog.near = dist * 1.6;
    this.fog.far = dist * 4;
    this.group.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  }

  /** Turn the table and draw, until stopped. */
  start(): void {
    if (this.frame) return;
    this.last = performance.now();
    const step = (t: number) => {
      const dt = Math.min(0.1, (t - this.last) / 1000);
      this.last = t;
      if (this.spinning && this.sway) {
        this.clock += dt;
        this.angle = Math.sin(this.clock * 0.35) * 0.55;
      } else if (this.spinning) this.angle += dt * 0.5;
      if (t - this.drawn >= 1000 / PREVIEW_FPS - 2) {
        this.drawn = t;
        this.draw();
      }
      this.frame = requestAnimationFrame(step);
    };
    this.frame = requestAnimationFrame(step);
  }

  stop(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** The angle the table is at (radians from the front). */
  turnTo(angle: number): void {
    this.angle = angle;
    this.draw();
  }

  dispose(): void {
    this.stop();
    this.clearStreet();
    this.mesh?.geometry.dispose();
    this.material.dispose();
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
