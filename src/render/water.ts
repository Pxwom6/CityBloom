import { Color, Mesh, PlaneGeometry, ShaderMaterial, UniformsLib, UniformsUtils, Vector3 } from 'three';
import { MAP_SIZE, SCENERY_MARGIN, WATER_LEVEL } from '../data/world';
import { PAL } from './palette';
import type { TerrainUniforms } from './terrain';
import { LIMIT_COLOUR, LIMIT_GLSL } from './cityLimit';

/** One large animated water plane at the water level; the riverbed shows through at the shallows. */
export class WaterRenderer {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;

  /** `limit`: the terrain's own uniforms for the city limit, shared so the line is drawn over water too. */
  constructor(limit: Pick<TerrainUniforms, 'uMapSize' | 'uLimitPx' | 'uLimitAlpha'>) {
    const size = MAP_SIZE + SCENERY_MARGIN * 2 + 2000;
    const geo = new PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(MAP_SIZE / 2, WATER_LEVEL, MAP_SIZE / 2);
    const uniforms = UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        uShallow: { value: PAL.water.clone() },
        uDeep: { value: PAL.waterDeep.clone() },
        uSky: { value: new Color('#bfe0f5') },
        uSunDir: { value: new Vector3(0.3, 0.8, 0.2).normalize() },
        uSunColor: { value: new Color('#fff4dc') },
        uLight: { value: 1 },
      },
    ]);
    // (After the merge, which clones: these stay the terrain's own objects.)
    Object.assign(uniforms, {
      uMapSize: limit.uMapSize,
      uLimitPx: limit.uLimitPx,
      uLimitAlpha: limit.uLimitAlpha,
    });
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uSky;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uLight;
        uniform float uMapSize;
        uniform float uLimitPx;
        uniform float uLimitAlpha;
        varying vec3 vWorld;
        ${LIMIT_GLSL}
        void main() {
          vec2 p = vWorld.xz;
          float t = uTime;
          // Analytic ripples: sum of travelling waves; derivatives give the normal.
          float dx = 0.0, dz = 0.0;
          dx += 0.050 * cos(p.x * 0.050 + t * 0.9) ;
          dz += 0.040 * cos(p.y * 0.063 - t * 0.7);
          dx += 0.030 * cos((p.x + p.y) * 0.110 + t * 1.4);
          dz += 0.030 * cos((p.x + p.y) * 0.110 + t * 1.4);
          dx += 0.020 * cos((p.x * 0.8 - p.y) * 0.21 - t * 1.9) * 0.8;
          dz -= 0.020 * cos((p.x * 0.8 - p.y) * 0.21 - t * 1.9);
          vec3 n = normalize(vec3(-dx, 1.0, -dz));
          vec3 v = normalize(cameraPosition - vWorld);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
          vec3 base = mix(uShallow, uDeep, 0.35 + 0.25 * sin(p.x * 0.004 + p.y * 0.003));
          vec3 col = mix(base, uSky, fres * 0.55) * uLight;
          // At night the water takes the night sky's colour (it lit itself teal, the brightest
          // thing in a dark whole-city view: walk-through after M28).
          col = mix(col, uSky * 0.5, (1.0 - uLight) * 0.75);
          float spec = pow(max(dot(reflect(-uSunDir, n), v), 0.0), 90.0);
          col += uSunColor * spec * 0.9 * uLight;
          float alpha = 0.72 + fres * 0.25;
          // The city limit where it crosses water (P21): the plane would hide the ground's own line.
          float limit = cityLimit(p, uMapSize, uLimitPx) * uLimitAlpha;
          col = mix(col, ${LIMIT_COLOUR} * (0.2 + 0.8 * uLight), limit);
          alpha = max(alpha, limit);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.renderOrder = 5;
    this.mesh.name = 'water';
  }

  update(time: number): void {
    this.material.uniforms.uTime!.value = time;
  }
}
