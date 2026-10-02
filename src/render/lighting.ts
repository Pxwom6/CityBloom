import {
  AmbientLight,
  BackSide,
  Color,
  Fog,
  HemisphereLight,
  Mesh,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { smoothstep } from '../sim/terrain/noise';
import { CitySunShadow } from './sunShadow';
import './lightChunks';

interface Key {
  h: number;
  zenith: string;
  horizon: string;
  sun: string;
  sunI: number;
  hemiSky: string;
  hemiGround: string;
  hemiI: number;
}

/**
 * Day/night keyframes by hour; everything in between is interpolated. Phase 3 (M26) adds the
 * blue hour before sunrise and after sunset (deep blue sky, violet horizon, a cool fill) and the
 * golden hour after sunrise and before sunset (a low warm sun, amber horizon, warm fill), and
 * gives the night a clearer blue.
 */
const KEYS: Key[] = [
  {
    h: 0,
    zenith: '#07102b',
    horizon: '#1c2a52',
    sun: '#9db2ea',
    sunI: 0.3,
    hemiSky: '#3a4c8a',
    hemiGround: '#1a1f33',
    hemiI: 0.42,
  },
  {
    h: 4.6,
    zenith: '#0b1535',
    horizon: '#26325e',
    sun: '#9db2ea',
    sunI: 0.28,
    hemiSky: '#3c4e8c',
    hemiGround: '#1b2034',
    hemiI: 0.44,
  },
  // Blue hour.
  {
    h: 5.3,
    zenith: '#223a7a',
    horizon: '#8a7fb8',
    sun: '#b8a8d8',
    sunI: 0.45,
    hemiSky: '#6272b0',
    hemiGround: '#2c2a40',
    hemiI: 0.6,
  },
  // Sunrise.
  {
    h: 6.0,
    zenith: '#4268ae',
    horizon: '#f7ac82',
    sun: '#ffb47c',
    sunI: 1.5,
    hemiSky: '#a8b2dc',
    hemiGround: '#665240',
    hemiI: 0.95,
  },
  // Golden hour.
  {
    h: 6.9,
    zenith: '#4a86d0',
    horizon: '#f8d6a6',
    sun: '#ffd49a',
    sunI: 2.3,
    hemiSky: '#d0d6e6',
    hemiGround: '#86734f',
    hemiI: 1.08,
  },
  {
    h: 8.2,
    zenith: '#4f94dd',
    horizon: '#cfe4f2',
    sun: '#fff0d6',
    sunI: 2.4,
    hemiSky: '#cfe6ff',
    hemiGround: '#8a7a5a',
    hemiI: 1.05,
  },
  {
    h: 12.5,
    zenith: '#3f8ee0',
    horizon: '#d8ebf6',
    sun: '#fffaf0',
    sunI: 2.7,
    hemiSky: '#d6ebff',
    hemiGround: '#8c7d5c',
    hemiI: 1.1,
  },
  {
    h: 16.3,
    zenith: '#4a8fd6',
    horizon: '#dbe8ef',
    sun: '#fff1d8',
    sunI: 2.5,
    hemiSky: '#d0e4fa',
    hemiGround: '#8a7a5a',
    hemiI: 1.05,
  },
  // Golden hour.
  {
    h: 17.6,
    zenith: '#4c8ad0',
    horizon: '#f5dcac',
    sun: '#ffd08c',
    sunI: 2.5,
    hemiSky: '#cad6ee',
    hemiGround: '#8a744e',
    hemiI: 1.08,
  },
  {
    h: 18.5,
    zenith: '#5478b8',
    horizon: '#f8ba82',
    sun: '#ffb06a',
    sunI: 2.2,
    hemiSky: '#d6c4b8',
    hemiGround: '#7a5e46',
    hemiI: 1.02,
  },
  // Sunset.
  {
    h: 19.2,
    zenith: '#435c9c',
    horizon: '#f0978c',
    sun: '#ff9066',
    sunI: 1.1,
    hemiSky: '#9690c2',
    hemiGround: '#4e3c42',
    hemiI: 0.84,
  },
  // Blue hour.
  {
    h: 19.9,
    zenith: '#23367a',
    horizon: '#7e74b0',
    sun: '#aab0e0',
    sunI: 0.42,
    hemiSky: '#5a68aa',
    hemiGround: '#2a2a42',
    hemiI: 0.58,
  },
  {
    h: 21.0,
    zenith: '#0b1432',
    horizon: '#233058',
    sun: '#9db2ea',
    sunI: 0.3,
    hemiSky: '#3a4c8a',
    hemiGround: '#1a1f33',
    hemiI: 0.42,
  },
  {
    h: 24,
    zenith: '#07102b',
    horizon: '#1c2a52',
    sun: '#9db2ea',
    sunI: 0.3,
    hemiSky: '#3a4c8a',
    hemiGround: '#1a1f33',
    hemiI: 0.42,
  },
];

const MOON = new Vector3(-0.35, 0.85, 0.4).normalize();
/** What the ground bounces up by season (spring, summer, autumn, winter) and under snow. */
const GROUNDS = [new Color('#8a9a5a'), new Color('#86955a'), new Color('#a08a58'), new Color('#8c8a72')];
const SNOW_GROUND = new Color('#c8d0dc');
const REF_GROUND = new Color('#8c7d5c');
const SUNRISE = 6.0;
const SUNSET = 19.2;

/** Sky dome, sun/moon, hemisphere light and fog, all driven by the time of day. */
export class Lighting {
  /** The sun (or moon): its shadows in two cascades fitted to the ground in view (M26). */
  readonly sun = new SunLight('#ffffff', 2.5);
  readonly shadow = new CitySunShadow();
  readonly hemi = new HemisphereLight('#cfe6ff', '#8a7a5a', 1);
  readonly ambient = new AmbientLight('#ffffff', 0.12);
  readonly sky: Mesh;
  readonly fog = new Fog('#d8ebf6', 1500, 9000);
  readonly sunDir = new Vector3(0.4, 0.8, 0.3).normalize();
  readonly zenith = new Color();
  readonly horizon = new Color();
  readonly sunColor = new Color();
  /** 0 at full day, 1 at full night: drives window lights and street lamps. */
  night = 0;
  /** 0..1 overall scene brightness (used by water and effects). */
  light = 1;
  /** 0..1 how near the sun is to rising or setting (the golden and blue hours). */
  low = 0;
  private skyMat: ShaderMaterial;
  private cA = new Color();
  private cB = new Color();

  constructor(scene: Scene) {
    this.sun.shadow = this.shadow;
    this.sun.castShadow = true;
    this.shadow.mapSize.set(2048, 2048);
    this.shadow.bias = -0.0003;
    this.shadow.normalBias = 0.4;
    this.shadow.camera.near = 10;
    scene.add(this.sun, this.hemi, this.ambient);
    this.skyMat = new ShaderMaterial({
      side: BackSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uZenith: { value: new Color() },
        uHorizon: { value: new Color() },
        uSunDir: { value: new Vector3() },
        uSunColor: { value: new Color() },
        uNight: { value: 0 },
        uLow: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uNight;
        uniform float uLow;
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float up = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
          col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.25, d.y));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.7);
          // A low sun lights the sky round it along the horizon (golden and blue hours).
          vec3 sd = normalize(vec3(uSunDir.x, 0.0, uSunDir.z));
          float side = max(dot(normalize(vec3(d.x, 0.0, d.z)), sd), 0.0);
          col += uSunColor * uLow * pow(side, 3.0) * pow(1.0 - up, 5.0) * 0.35;
          vec3 cell = floor(d * 300.0);
          float star = step(0.9975, hash(cell)) * uNight * smoothstep(0.05, 0.3, d.y);
          col += vec3(star);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new Mesh(new SphereGeometry(1, 32, 16), this.skyMat);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.sky.name = 'sky';
    scene.add(this.sky);
    scene.fog = this.fog;
    this.update(12);
  }

  update(hour: number): void {
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1]!.h <= hour) i++;
    const a = KEYS[i]!;
    const b = KEYS[i + 1]!;
    const t = smoothstep(0, 1, (hour - a.h) / (b.h - a.h));
    const mix = (x: string, y: string, out: Color) => out.copy(this.cA.set(x)).lerp(this.cB.set(y), t);
    mix(a.zenith, b.zenith, this.zenith);
    mix(a.horizon, b.horizon, this.horizon);
    mix(a.sun, b.sun, this.sunColor);
    mix(a.hemiSky, b.hemiSky, this.hemi.color);
    mix(a.hemiGround, b.hemiGround, this.hemi.groundColor);
    this.hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * t;
    this.sun.intensity = a.sunI + (b.sunI - a.sunI) * t;
    this.sun.color.copy(this.sunColor);

    // The sun from east to south to west; the moon high in the south-west. Through the blue
    // hours the light turns from one to the other, so shadows swing round rather than jump.
    const along = Math.min(1, Math.max(0, (hour - SUNRISE + 0.3) / (SUNSET - SUNRISE + 0.6)));
    const az = Math.PI * along;
    const elev = Math.max(0.06, Math.sin(Math.PI * along));
    this.sunDir.set(Math.cos(az), elev * 1.25, Math.sin(az) * 0.55 + 0.25).normalize();
    const moon =
      hour < 12
        ? 1 - smoothstep(SUNRISE - 1.1, SUNRISE - 0.2, hour)
        : smoothstep(SUNSET + 0.2, SUNSET + 1.1, hour);
    if (moon > 0) this.sunDir.lerp(MOON, moon).normalize();
    this.night =
      1 - smoothstep(SUNRISE - 0.4, SUNRISE + 1.2, hour) + smoothstep(SUNSET - 1.0, SUNSET + 0.8, hour);
    this.night = Math.min(1, Math.max(0, this.night));
    this.light = 1 - this.night * 0.75;
    const u = this.skyMat.uniforms;
    u.uZenith!.value.copy(this.zenith);
    u.uHorizon!.value.copy(this.horizon);
    u.uSunDir!.value.copy(this.sunDir);
    u.uSunColor!.value.copy(this.sunColor);
    u.uNight!.value = this.night;
    // How low the sun is: the glow round it on the horizon, from the blue hour to the golden.
    const low = (h: number) => smoothstep(0, 1, 1 - Math.abs(hour - h) / 1.4);
    this.low = Math.max(low(6.2), low(18.9));
    u.uLow!.value = this.low;
    this.setFog();
  }

  /**
   * Fog in the horizon's colour, eased towards a light warm white while the sun is low by day
   * (walk-through after M28): an amber or salmon fog over the whole-city view turned snow to sand
   * and green to olive at dawn and golden hour, the sky keeping its colour.
   */
  private setFog(): void {
    this.fog.color.copy(this.horizon).lerp(this.cA.set('#f4ece0'), 0.5 * this.low * (1 - this.night));
  }

  /**
   * Weather over the time of day (M22), after `update`: cloud greys the sky and softens the sun and
   * its shadows, heat hazes the horizon warm, and lightning flashes the sky and the fill light.
   */
  applyWeather(w: { overcast: number; haze: number; flash: number }): void {
    const oc = w.overcast;
    if (oc > 0) {
      const dark = this.night > 0.5;
      this.zenith.lerp(this.cA.set(dark ? '#2b3036' : '#a3abb3'), oc * 0.8);
      this.horizon.lerp(this.cB.set(dark ? '#32373d' : '#c3c9ce'), oc * 0.7);
      this.sun.intensity *= 1 - 0.72 * oc;
      this.hemi.intensity *= 1 - 0.3 * oc;
      this.light *= 1 - 0.25 * oc;
    }
    if (w.haze > 0) {
      this.horizon.lerp(this.cB.set('#eadcc0'), 0.5 * w.haze);
      this.sunColor.lerp(this.cA.set('#ffd49c'), 0.35 * w.haze);
      this.sun.color.copy(this.sunColor);
    }
    if (w.flash > 0) {
      this.hemi.intensity += 2.4 * w.flash;
      this.zenith.lerp(this.cA.set('#e2e8ff'), 0.6 * w.flash);
      this.horizon.lerp(this.cB.set('#eef1ff'), 0.5 * w.flash);
    }
    this.setFog();
    const u = this.skyMat.uniforms;
    u.uZenith!.value.copy(this.zenith);
    u.uHorizon!.value.copy(this.horizon);
    // No sun disc behind the cloud.
    u.uSunColor!.value.copy(this.sunColor).multiplyScalar(1 - 0.92 * oc);
  }

  /**
   * The ground's colour in the light bounced up from it (M26): green in spring and summer, gold
   * in autumn, pale under snow. Tints the hemisphere light's ground side, after `update`.
   */
  groundBounce(season: readonly number[], snow: number): void {
    const c = this.cA.setRGB(0, 0, 0);
    GROUNDS.forEach((g, i) => c.add(this.cB.copy(g).multiplyScalar(season[i] ?? 0)));
    c.lerp(SNOW_GROUND, Math.min(1, Math.max(0, snow)));
    // Relative to the brown the keyframes were drawn with.
    this.hemi.groundColor.multiply(
      c.multiply(this.cB.setRGB(1 / REF_GROUND.r, 1 / REF_GROUND.g, 1 / REF_GROUND.b)),
    );
    // Over snow at a low sun, a cool sky fill and a little less orange in the sun (walk-through
    // after M28): with the warm golden-hour fill even the shadows were tan, and a snowy map read as
    // desert sand from the whole-city view. Now sunlit snow glows warm and its shadows go blue.
    const k = this.low * Math.min(1, Math.max(0, snow)) * (1 - this.night);
    if (k > 0) {
      this.hemi.color.lerp(this.cB.set('#b3c3e6'), 0.45 * k);
      const l = (this.sun.color.r + this.sun.color.g + this.sun.color.b) / 3;
      this.sun.color.lerp(this.cB.setRGB(l * 1.04, l, l * 0.94), 0.3 * k);
    }
  }

  /**
   * From far off at a low sun, a cooler and a little stronger sky fill (walk-through after M28):
   * the whole-city view at dawn and golden hour was an olive or mustard wash, the warm light
   * on green grass with the fill as warm as the sun. Close up the warm look stays as drawn.
   */
  farLowSun(distance: number): void {
    const k = this.low * (1 - this.night) * smoothstep(900, 2400, distance);
    if (k <= 0) return;
    this.hemi.color.lerp(this.cB.set('#c9dcf4'), 0.55 * k);
    this.hemi.intensity *= 1 + 0.3 * k;
  }

  /**
   * Keep the sky centred on the camera, and fit the sun's shadows to the ground in view: `yLo`
   * and `yHi` the lowest ground and highest roof there, `reach` the view depth shadows end at.
   */
  follow(cameraPos: Vector3, far: number, yLo: number, yHi: number, reach: number): void {
    this.sky.position.copy(cameraPos);
    this.sky.scale.setScalar(far * 0.9);
    this.sun.position.copy(this.sunDir);
    this.sun.updateMatrixWorld();
    this.shadow.fit.yLo = yLo;
    this.shadow.fit.yHi = yHi;
    this.shadow.fit.far = reach;
  }
}
