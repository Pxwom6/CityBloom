import {
  DepthTexture,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';

/** Colour grades for photo mode (M16), applied after tone mapping. All original settings. */
export const GRADES = {
  natural: { name: 'Natural', tint: [1, 1, 1], sat: 1, contrast: 1, lift: 0, vignette: 0 },
  golden: { name: 'Golden', tint: [1.08, 1.0, 0.86], sat: 1.08, contrast: 1.04, lift: 0.01, vignette: 0.28 },
  crisp: { name: 'Crisp', tint: [1, 1, 1.02], sat: 1.22, contrast: 1.14, lift: 0, vignette: 0.12 },
  cool: { name: 'Cool', tint: [0.92, 1.0, 1.1], sat: 0.9, contrast: 1.04, lift: 0.02, vignette: 0.18 },
  faded: { name: 'Faded', tint: [1.04, 1.0, 0.94], sat: 0.72, contrast: 0.88, lift: 0.07, vignette: 0.3 },
  mono: { name: 'Mono', tint: [1, 1, 1], sat: 0, contrast: 1.16, lift: 0.01, vignette: 0.32 },
} as const;
export type GradeId = keyof typeof GRADES;
export const GRADE_IDS = Object.keys(GRADES) as GradeId[];

export interface PhotoLook {
  /** Depth of field and tilt-shift, 0–1. */
  dof: number;
  tiltShift: number;
  /** Distance to keep sharp, metres. */
  focus: number;
  grade: GradeId;
}

/** Blur radius at full strength, in pixels of an 800-pixel-high frame (scaled with resolution). */
const MAX_BLUR_PX = 14;

/**
 * Photo mode's lens (M16): the scene is drawn into an HDR target with its depth, then one pass
 * blurs by distance from the focus (depth of field) and by distance from the middle band
 * (tilt-shift), tone maps, grades the colour and writes the screen. Only photo mode pays for it.
 */
export class PhotoLens {
  private target: WebGLRenderTarget | null = null;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mat: ShaderMaterial;
  private size = new Vector2();

  constructor() {
    this.mat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: null },
        tDepth: { value: null },
        uTexel: { value: new Vector2() },
        uNear: { value: 1 },
        uFar: { value: 1000 },
        uFocus: { value: 100 },
        uDof: { value: 0 },
        uTilt: { value: 0 },
        uMaxPx: { value: MAX_BLUR_PX },
        uTint: { value: new Vector3(1, 1, 1) },
        uSat: { value: 1 },
        uContrast: { value: 1 },
        uLift: { value: 0 },
        uVignette: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uTexel;
        uniform float uNear, uFar, uFocus, uDof, uTilt, uMaxPx;
        uniform vec3 uTint;
        uniform float uSat, uContrast, uLift, uVignette;
        varying vec2 vUv;

        float distAt(vec2 uv) {
          return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
        }
        // Blur radius (px) for a point at distance d on screen row uv.y.
        float blurAt(float d, vec2 uv) {
          float lens = uDof * 2.5 * abs(d - uFocus) / max(d, 0.01);
          float band = uTilt * smoothstep(0.06, 0.5, abs(uv.y - 0.5));
          return min(max(lens, band), 1.0) * uMaxPx;
        }

        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          if (uDof + uTilt > 0.0) {
            float d0 = distAt(vUv);
            float r0 = blurAt(d0, vUv);
            vec3 acc = col;
            float wsum = 1.0;
            // Rotate the sample spiral per pixel so the few taps don't show as rings.
            float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            for (int i = 0; i < 40; i++) {
              float fi = float(i) + 0.5;
              float rr = sqrt(fi / 40.0) * uMaxPx;
              float a = fi * 2.39996323 + jitter * 6.2831853;
              vec2 uv = vUv + vec2(cos(a), sin(a)) * rr * uTexel;
              float di = distAt(uv);
              float ri = blurAt(di, uv);
              // A nearer point blurs over this one; a farther one only as far as this one is blurred,
              // so a sharp subject doesn't get smeared by the background behind it.
              float reach = di < d0 ? ri : min(ri, r0);
              float w = smoothstep(rr - 1.0, rr + 0.5, reach);
              acc += texture2D(tColor, uv).rgb * w;
              wsum += w;
            }
            col = acc / wsum;
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          vec3 g = gl_FragColor.rgb * uTint;
          float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
          g = mix(vec3(l), g, uSat);
          g = (g - 0.18) * uContrast + 0.18;
          g = uLift + g * (1.0 - uLift);
          g *= 1.0 - uVignette * smoothstep(0.3, 1.0, length(vUv - 0.5) * 1.4142);
          gl_FragColor.rgb = clamp(g, 0.0, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Draw `scene` through the lens onto the screen. */
  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, look: PhotoLook): void {
    renderer.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    if (!this.target || this.target.width !== w || this.target.height !== h) {
      this.target?.depthTexture?.dispose();
      this.target?.dispose();
      // Multisampling for smooth edges, less of it on big frames (a 2× capture is smooth anyway).
      const px = w * h;
      this.target = new WebGLRenderTarget(w, h, {
        type: HalfFloatType,
        samples: px > 10e6 ? 0 : px > 4.5e6 ? 2 : 4,
        depthTexture: new DepthTexture(w, h),
      });
    }
    renderer.setRenderTarget(this.target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const u = this.mat.uniforms;
    const g = GRADES[look.grade];
    u.tColor!.value = this.target.texture;
    u.tDepth!.value = this.target.depthTexture;
    (u.uTexel!.value as Vector2).set(1 / w, 1 / h);
    u.uNear!.value = camera.near;
    u.uFar!.value = camera.far;
    u.uFocus!.value = look.focus;
    u.uDof!.value = look.dof;
    u.uTilt!.value = look.tiltShift;
    u.uMaxPx!.value = MAX_BLUR_PX * Math.max(1, h / 800);
    (u.uTint!.value as Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
    u.uSat!.value = g.sat;
    u.uContrast!.value = g.contrast;
    u.uLift!.value = g.lift;
    u.uVignette!.value = g.vignette;
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.target = null;
  }
}
