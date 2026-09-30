import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  NormalBlending,
  Points,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
} from 'three';
import type { Season, WeatherKind } from '../data/climate';
import type { ClientWorld } from '../client/world';
import { dateOf } from '../sim/time';

/**
 * Seasons and weather on screen (M22), DESIGN.md §4.2. The look — how far into each season the
 * year is, the weather now, snow lying and wet ground — eases towards the sim's (or photo mode's)
 * over a few seconds and feeds shared uniforms that the terrain, trees, buildings and roads read.
 * Rain and snow fall as one point system around the camera's target; storms flash with lightning.
 */
export interface WeatherLook {
  /** Weight of spring, summer, autumn and winter colouring (they sum to 1). */
  season: [number, number, number, number];
  kind: WeatherKind;
  strength: number;
  /** Snow lying on the ground and roofs, 0–1. */
  snow: number;
  wet: number;
}

const SEASON_INDEX: Record<Season, number> = { spring: 0, summer: 1, autumn: 2, winter: 3 };

/**
 * Seasonal colouring through the year: each season peaks mid-season (April, July, October,
 * January) and hands over to the next across the month either side.
 */
export function seasonWeights(month: number, dayFraction: number): [number, number, number, number] {
  const p = month + dayFraction; // 0 = start of January
  const centres = [3.5, 6.5, 9.5, 0.5];
  const w = centres.map((c) => {
    let d = Math.abs(p - c) % 12;
    if (d > 6) d = 12 - d;
    return Math.max(0, 1 - d / 3);
  });
  const sum = w.reduce((a, b) => a + b, 0) || 1;
  return w.map((x) => x / sum) as [number, number, number, number];
}

export function pureSeason(s: Season): [number, number, number, number] {
  const w: [number, number, number, number] = [0, 0, 0, 0];
  w[SEASON_INDEX[s]] = 1;
  return w;
}

/** What the world's weather looks like at its display tick. */
export function worldLook(world: ClientWorld): WeatherLook {
  const w = world.stats.weather;
  const d = dateOf(world.displayTick);
  return {
    season: w.seasons ? seasonWeights(d.month, d.dayFraction) : pureSeason('summer'),
    kind: w.kind,
    strength: w.strength,
    snow: w.snow,
    wet: w.wet,
  };
}

/** Uniforms the terrain, tree, building and road materials share. */
export interface WeatherUniforms {
  uSnow: { value: number };
  uWet: { value: number };
  uSeason: { value: Vector4 };
  /** Snow per road: red channel indexed by segment or node id (see `ROAD_SNOW_SIZE`). */
  uRoadSnow: { value: DataTexture };
  /** Overcast (x) greys and dims the scene; heat (y) warms it. */
  uGrade: { value: Vector2 };
}

/** The road snow texture is ROAD_SNOW_SIZE² texels, indexed by entity id modulo its size. */
export const ROAD_SNOW_SIZE = 512;

/** GLSL: snow on a road vertex from its segment or node id (`aTag`; −1 for none). */
export const ROAD_SNOW_GLSL = `
float roadSnowAt(float tag) {
  if (tag < 0.0) return 0.0;
  float slot = mod(tag, ${ROAD_SNOW_SIZE * ROAD_SNOW_SIZE}.0);
  vec2 uv = (vec2(mod(slot, ${ROAD_SNOW_SIZE}.0), floor(slot / ${ROAD_SNOW_SIZE}.0)) + 0.5) / ${ROAD_SNOW_SIZE}.0;
  return texture2D(uRoadSnow, uv).r;
}`;

/** GLSL: cheap value noise for patchy snow. */
export const SNOW_NOISE_GLSL = `
float wHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`;

export const SNOW_COLOUR = 'vec3(0.93, 0.95, 0.98)';

/**
 * GLSL (needs \`uniform vec4 uSeason;\`): grass and hedges in their season. Grass is fresh in
 * spring, gold in autumn and dull in winter (the terrain's own colours, M22); a hedge is
 * evergreen, a little fresher in spring and duller in the cold.
 */
export const SEASON_GLSL = `
vec3 seasonGrass(vec3 c0) {
  float l0 = dot(c0, vec3(0.299, 0.587, 0.114));
  vec3 spring = c0 * vec3(1.03, 1.13, 0.84) + vec3(0.015, 0.03, 0.0);
  vec3 autumn = mix(c0, vec3(l0) * vec3(1.22, 1.12, 0.6), 0.55);
  vec3 winter = mix(c0, vec3(l0) * vec3(1.1, 1.05, 0.9), 0.6);
  return spring * uSeason.x + c0 * uSeason.y + autumn * uSeason.z + winter * uSeason.w;
}
vec3 seasonHedge(vec3 c0) {
  float l0 = dot(c0, vec3(0.299, 0.587, 0.114));
  vec3 spring = c0 * vec3(1.02, 1.1, 0.9) + vec3(0.0, 0.015, 0.0);
  vec3 autumn = mix(c0, vec3(l0) * vec3(1.16, 1.06, 0.7), 0.28);
  vec3 winter = mix(c0, vec3(l0) * vec3(0.98, 1.02, 0.92), 0.4) * 0.94;
  return spring * uSeason.x + c0 * uSeason.y + autumn * uSeason.z + winter * uSeason.w;
}`;

/** GLSL (needs \`uniform vec2 uGrade;\`): cloud greys and dims a colour, heat warms it. */
export const GRADE_GLSL = `
vec3 weatherGrade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l), 0.5 * uGrade.x) * (1.0 - 0.16 * uGrade.x);
  return c * mix(vec3(1.0), vec3(1.08, 1.0, 0.84), 0.6 * uGrade.y);
}`;

/** How overcast each kind of weather is (0 clear sky … 1 heavy cloud). */
const OVERCAST: Record<WeatherKind, number> = {
  clear: 0,
  cloudy: 0.55,
  rain: 0.75,
  storm: 0.95,
  snow: 0.7,
  fog: 0.6,
  heat: 0,
};

const MAX_DROPS = 9000;

export class WeatherRenderer {
  readonly uniforms: WeatherUniforms;
  /** The look now (eased) and where it's heading. */
  readonly look: WeatherLook = { season: [0, 1, 0, 0], kind: 'clear', strength: 0, snow: 0, wet: 0 };
  /** Overcast 0–1, fog 0–1, heat haze 0–1 and a lightning flash 0–1, for the lighting. */
  overcast = 0;
  fog = 0;
  haze = 0;
  flash = 0;
  /** Rain (1) or snow (0) mix of the falling particles, and how many are drawn. */
  private rainMix = 1;
  private fall = 0;
  readonly points: Points;
  private material: ShaderMaterial;
  private tex: DataTexture;
  private texData: Uint8Array;
  private snowVersion = -1;
  private snowAt = -1;
  private flashUntil = 0;
  private nextFlash = 0;
  private started = false;
  private mid = new Vector3();
  /** Jump straight to the next target instead of easing (a look picked in photo mode or a test). */
  snapNext = false;
  /** Particle count for the graphics quality. */
  drops = MAX_DROPS;
  /** Lightning strikes this session (tests), and whether the last frame drew rain or snow. */
  stats = { strikes: 0, particles: 0 };
  /** Called on a lightning strike (the audio plays thunder). */
  onStrike: ((distance: number) => void) | null = null;

  constructor(private world: ClientWorld) {
    this.texData = new Uint8Array(ROAD_SNOW_SIZE * ROAD_SNOW_SIZE);
    this.tex = new DataTexture(this.texData, ROAD_SNOW_SIZE, ROAD_SNOW_SIZE, RedFormat, UnsignedByteType);
    this.tex.needsUpdate = true;
    this.uniforms = {
      uSnow: { value: 0 },
      uWet: { value: 0 },
      uSeason: { value: new Vector4(0, 1, 0, 0) },
      uRoadSnow: { value: this.tex },
      uGrade: { value: new Vector2() },
    };
    // Rain and snow: a fixed box of seeds, animated entirely in the shader.
    const seed = new Float32Array(MAX_DROPS * 3);
    let h = 0x9e3779b9;
    const rnd = () => {
      h ^= h << 13;
      h ^= h >>> 17;
      h ^= h << 5;
      return ((h >>> 0) % 100000) / 100000;
    };
    for (let i = 0; i < seed.length; i++) seed[i] = rnd();
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(seed, 3));
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        uTime: { value: 0 },
        uCentre: { value: new Vector3() },
        uSize: { value: 400 },
        uHeight: { value: 240 },
        uRain: { value: 1 },
        uAlpha: { value: 0 },
        uScale: { value: 600 },
        uWind: { value: new Vector3(0.3, 0, 0.1) },
      },
      vertexShader: `
uniform float uTime;
uniform vec3 uCentre;
uniform float uSize;
uniform float uHeight;
uniform float uRain;
uniform float uScale;
uniform vec3 uWind;
varying float vRain;
void main() {
  vRain = uRain;
  // Rain falls fast and straight; snow drifts down and sways.
  float speed = mix(1.6, 11.0, uRain);
  float y = fract(position.y - uTime * speed / uHeight);
  vec2 drift = uWind.xz * (1.0 - y) * uHeight * mix(0.8, 0.25, uRain);
  vec2 sway = vec2(sin(uTime * 1.3 + position.x * 40.0), cos(uTime * 1.1 + position.z * 37.0)) * (1.0 - uRain) * 1.5;
  vec2 xz = (fract(position.xz + (drift + sway) / uSize) - 0.5) * uSize;
  vec3 p = vec3(uCentre.x + xz.x, uCentre.y + y * uHeight, uCentre.z + xz.y);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float s = mix(0.35, 0.9, uRain) * uScale / max(1.0, -mv.z);
  gl_PointSize = clamp(s, mix(2.5, 1.5, uRain), mix(7.0, 18.0, uRain));
}`,
      fragmentShader: `
uniform float uAlpha;
varying float vRain;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  // Rain: a thin streak; snow: a soft flake.
  float streak = (1.0 - smoothstep(0.03, 0.09, abs(c.x))) * (1.0 - smoothstep(0.25, 0.5, abs(c.y)));
  float flake = 1.0 - smoothstep(0.18, 0.5, length(c));
  float a = mix(flake, streak, vRain) * uAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(vec3(1.0), vec3(0.72, 0.78, 0.86), vRain), a);
}`,
    });
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.name = 'weather';
    this.points.visible = false;
  }

  /**
   * Ease the look towards `target`, update the shared uniforms, the road snow texture and the
   * falling rain or snow around `centre` (the camera's target) for a view `distance` away.
   */
  update(
    dt: number,
    time: number,
    target: WeatherLook,
    centre: Vector3,
    distance: number,
    pxPerMetre: number,
    camera?: Vector3,
  ): void {
    const snap = !this.started || this.snapNext;
    const k = snap ? 1 : 1 - Math.exp(-dt / 2.5);
    this.started = true;
    this.snapNext = false;
    const L = this.look;
    if (snap) {
      L.kind = target.kind;
      L.strength = target.strength;
    }
    for (let i = 0; i < 4; i++) L.season[i] = L.season[i]! + (target.season[i]! - L.season[i]!) * k;
    L.snow += (target.snow - L.snow) * k;
    L.wet += (target.wet - L.wet) * k;
    // The spell itself cross-fades: the old weather fades out as the new one fades in.
    if (target.kind !== L.kind) {
      L.strength -= Math.min(L.strength, dt / 2);
      if (L.strength <= 0.02) L.kind = target.kind;
    } else L.strength += (target.strength - L.strength) * k;
    const u = this.uniforms;
    u.uSnow.value = L.snow;
    u.uWet.value = L.wet;
    u.uSeason.value.set(L.season[0], L.season[1], L.season[2], L.season[3]);
    const st = L.kind === 'clear' ? 0 : L.strength;
    this.overcast = OVERCAST[L.kind] * Math.min(1, 0.4 + st);
    this.fog =
      L.kind === 'fog' ? st : L.kind === 'rain' || L.kind === 'snow' || L.kind === 'storm' ? st * 0.45 : 0;
    this.haze = L.kind === 'heat' ? st : 0;
    u.uGrade.value.set(this.overcast, this.haze);
    this.updateRoadSnow(time);
    this.updateLightning(time, L.kind === 'storm' ? st : 0);
    // Falling rain or snow.
    const falling = L.kind === 'rain' || L.kind === 'storm' || L.kind === 'snow';
    this.fall = falling ? st : 0;
    this.rainMix = L.kind === 'snow' ? 0 : 1;
    const m = this.material.uniforms;
    // Rain and snow fill a box between the camera and what it looks at, so the nearest drops are
    // big enough to see from a strategic view.
    const size = Math.min(1400, Math.max(120, distance * 0.9));
    const mid = this.mid.copy(centre);
    if (camera) mid.lerp(camera, 0.45);
    m.uTime!.value = time;
    m.uCentre!.value.set(mid.x, Math.max(0, centre.y) - size * 0.05, mid.z);
    m.uSize!.value = size;
    m.uHeight!.value = size * 0.7;
    m.uRain!.value = this.rainMix;
    m.uScale!.value = pxPerMetre;
    m.uAlpha!.value = this.fall * (this.rainMix ? 0.7 : 0.9);
    const n = Math.round(this.drops * Math.min(1, 0.25 + this.fall));
    this.points.geometry.setDrawRange(0, n);
    this.points.visible = this.fall > 0.02 && n > 0;
    this.stats.particles = this.points.visible ? n : 0;
  }

  /** Write each road's snow (and a junction's, the most of its roads') into the texture. */
  private updateRoadSnow(time: number): void {
    const w = this.world;
    if (w.roadSnowVersion === this.snowVersion || time - this.snowAt < 0.25) return;
    this.snowVersion = w.roadSnowVersion;
    this.snowAt = time;
    const d = this.texData;
    d.fill(0);
    const N = ROAD_SNOW_SIZE * ROAD_SNOW_SIZE;
    for (const seg of w.netState.segments.values()) {
      if (!seg.snow) continue;
      const v = Math.min(255, Math.round(seg.snow * 255));
      d[seg.id % N] = v;
      for (const n of [seg.a, seg.b]) d[n % N] = Math.max(d[n % N]!, v);
    }
    this.tex.needsUpdate = true;
  }

  /** Storms: a flash every few seconds, at random, with thunder a moment later. */
  private updateLightning(time: number, storm: number): void {
    if (storm <= 0.05) {
      this.flash = Math.max(0, this.flash - 0.1);
      return;
    }
    if (time >= this.nextFlash) {
      const r = Math.abs(Math.sin(time * 91.7) * 43758.5453) % 1;
      this.flashUntil = time + 0.12 + r * 0.12;
      this.nextFlash = time + (2.5 + r * 7) / (0.5 + storm);
      this.stats.strikes++;
      this.onStrike?.(300 + r * 2500);
    }
    const on = time < this.flashUntil;
    // A double flicker, then fade.
    this.flash = on
      ? (Math.sin((this.flashUntil - time) * 90) > -0.3 ? 1 : 0.4) * storm
      : Math.max(0, this.flash - 0.15);
  }
}
