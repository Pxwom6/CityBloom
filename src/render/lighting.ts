import {
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { smoothstep } from '../sim/terrain/noise';

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

/** Day/night keyframes by hour; everything in between is interpolated. */
const KEYS: Key[] = [
  {
    h: 0,
    zenith: '#060b1f',
    horizon: '#18233f',
    sun: '#7f93c9',
    sunI: 0.22,
    hemiSky: '#2f3d6e',
    hemiGround: '#12151d',
    hemiI: 0.34,
  },
  {
    h: 4.8,
    zenith: '#0b1330',
    horizon: '#2a3050',
    sun: '#7f93c9',
    sunI: 0.2,
    hemiSky: '#324070',
    hemiGround: '#13161e',
    hemiI: 0.36,
  },
  {
    h: 6.0,
    zenith: '#3b5a95',
    horizon: '#f0a070',
    sun: '#ffb27a',
    sunI: 1.1,
    hemiSky: '#8fa6d0',
    hemiGround: '#5a4a3a',
    hemiI: 0.8,
  },
  {
    h: 8.0,
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
    h: 16.5,
    zenith: '#4a8fd6',
    horizon: '#dbe8ef',
    sun: '#fff1d8',
    sunI: 2.5,
    hemiSky: '#d0e4fa',
    hemiGround: '#8a7a5a',
    hemiI: 1.05,
  },
  {
    h: 18.4,
    zenith: '#4d6aa6',
    horizon: '#f5b37a',
    sun: '#ffb070',
    sunI: 1.6,
    hemiSky: '#b0a8c8',
    hemiGround: '#6a5040',
    hemiI: 0.85,
  },
  {
    h: 19.6,
    zenith: '#26335f',
    horizon: '#c9788a',
    sun: '#ff9a70',
    sunI: 0.55,
    hemiSky: '#5a5a88',
    hemiGround: '#2a2230',
    hemiI: 0.6,
  },
  {
    h: 21.0,
    zenith: '#0a1128',
    horizon: '#1e2a4a',
    sun: '#8093c7',
    sunI: 0.22,
    hemiSky: '#2f3d6e',
    hemiGround: '#12151d',
    hemiI: 0.34,
  },
  {
    h: 24,
    zenith: '#060b1f',
    horizon: '#18233f',
    sun: '#7f93c9',
    sunI: 0.22,
    hemiSky: '#2f3d6e',
    hemiGround: '#12151d',
    hemiI: 0.34,
  },
];

const SUNRISE = 6.0;
const SUNSET = 19.2;

/** Sky dome, sun/moon, hemisphere light and fog, all driven by the time of day. */
export class Lighting {
  readonly sun = new DirectionalLight('#ffffff', 2.5);
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
  private skyMat: ShaderMaterial;
  private cA = new Color();
  private cB = new Color();

  constructor(scene: Scene) {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 4000;
    scene.add(this.sun, this.sun.target, this.hemi, this.ambient);
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
        varying vec3 vDir;
        float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float up = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
          col = mix(col, uHorizon * 0.92, smoothstep(0.0, -0.25, d.y));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25) * (1.0 - uNight * 0.7);
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

    const day = hour >= SUNRISE - 0.3 && hour <= SUNSET + 0.3;
    if (day) {
      const u = Math.min(1, Math.max(0, (hour - SUNRISE + 0.3) / (SUNSET - SUNRISE + 0.6)));
      const az = Math.PI * u; // east → south → west
      const elev = Math.max(0.06, Math.sin(Math.PI * u)) * 1.0;
      this.sunDir.set(Math.cos(az), elev * 1.25, Math.sin(az) * 0.55 + 0.25).normalize();
    } else {
      // Moonlight from high in the south-west.
      this.sunDir.set(-0.35, 0.85, 0.4).normalize();
    }
    this.night =
      1 - smoothstep(SUNRISE - 0.4, SUNRISE + 1.2, hour) + smoothstep(SUNSET - 1.0, SUNSET + 0.8, hour);
    this.night = Math.min(1, Math.max(0, this.night));
    this.light = 1 - this.night * 0.75;
    this.fog.color.copy(this.horizon);
    const u = this.skyMat.uniforms;
    u.uZenith!.value.copy(this.zenith);
    u.uHorizon!.value.copy(this.horizon);
    u.uSunDir!.value.copy(this.sunDir);
    u.uSunColor!.value.copy(this.sunColor);
    u.uNight!.value = this.night;
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
    this.fog.color.copy(this.horizon);
    const u = this.skyMat.uniforms;
    u.uZenith!.value.copy(this.zenith);
    u.uHorizon!.value.copy(this.horizon);
    // No sun disc behind the cloud.
    u.uSunColor!.value.copy(this.sunColor).multiplyScalar(1 - 0.92 * oc);
  }

  /** Keep the sky centred on the camera and the shadow camera around the view target. */
  follow(cameraPos: Vector3, target: Vector3, viewSize: number, far: number): void {
    this.sky.position.copy(cameraPos);
    this.sky.scale.setScalar(far * 0.9);
    const size = Math.min(1600, Math.max(140, viewSize));
    const cam = this.sun.shadow.camera;
    if (cam.right !== size) {
      cam.left = -size;
      cam.right = size;
      cam.top = size;
      cam.bottom = -size;
      cam.updateProjectionMatrix();
    }
    // Snap the shadow camera to texels to avoid shimmering while panning.
    const texel = (2 * size) / this.sun.shadow.mapSize.x;
    const tx = Math.round(target.x / texel) * texel;
    const tz = Math.round(target.z / texel) * texel;
    this.sun.target.position.set(tx, target.y, tz);
    this.sun.position.set(
      tx + this.sunDir.x * 2000,
      target.y + this.sunDir.y * 2000,
      tz + this.sunDir.z * 2000,
    );
    this.sun.target.updateMatrixWorld();
  }
}
