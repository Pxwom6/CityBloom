import {
  DepthTexture,
  HalfFloatType,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Texture,
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
/** How fast depth of field blurs with relative distance from the focus, at full strength. */
const LENS_FALLOFF = 1.6;

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/**
 * Photo mode's lens (M16): the scene is drawn into an HDR target with its depth; a first pass blurs
 * each pixel by its distance from the focus (depth of field) and from the middle band (tilt-shift),
 * gathering from a spiral of samples and keeping its blur radius; a second pass smooths the grain
 * that leaves in blurred areas, then tone maps, grades the colour and writes the screen. Only photo
 * mode pays for it.
 */
export class PhotoLens {
  private target: WebGLRenderTarget | null = null;
  private mid: WebGLRenderTarget | null = null;
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private gather: ShaderMaterial;
  private finish: ShaderMaterial;
  private finishDisplay: ShaderMaterial;
  private size = new Vector2();

  constructor() {
    this.gather = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
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
        uDisplay: { value: 0 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <packing>
        uniform sampler2D tColor;
        uniform sampler2D tDepth;
        uniform vec2 uTexel;
        uniform float uNear, uFar, uFocus, uDof, uTilt, uMaxPx, uDisplay;
        varying vec2 vUv;

        float distAt(vec2 uv) {
          return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
        }
        // The scene in the HDR target, tamed: a stray infinite or huge highlight (harmless as one white
        // pixel on screen) would otherwise spread into a blob when blurred.
        vec3 colorAt(vec2 uv) {
          vec3 c = texture2D(tColor, uv).rgb;
          // A finished frame (the post pipeline's) is sRGB: blur it in linear light.
          if (uDisplay > 0.5) c = pow(c, vec3(2.2));
          if (any(isnan(c))) return vec3(0.0);
          return clamp(c, 0.0, 4.0);
        }
        // Blur radius (px) for a point at distance d on screen row uv.y.
        float blurAt(float d, vec2 uv) {
          float lens = uDof * ${LENS_FALLOFF.toFixed(2)} * abs(d - uFocus) / max(d, 0.01);
          float band = uTilt * smoothstep(0.06, 0.5, abs(uv.y - 0.5));
          return min(max(lens, band), 1.0) * uMaxPx;
        }

        void main() {
          vec3 col = colorAt(vUv);
          float d0 = distAt(vUv);
          float r0 = blurAt(d0, vUv);
          if (uDof + uTilt > 0.0) {
            vec3 acc = col;
            float wsum = 1.0;
            // Rotate the sample spiral per pixel so the taps don't show as rings; pass 2 smooths the grain.
            float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            for (int i = 0; i < 48; i++) {
              float fi = float(i) + 0.5;
              float rr = sqrt(fi / 48.0) * uMaxPx;
              float a = fi * 2.39996323 + jitter * 6.2831853;
              vec2 uv = vUv + vec2(cos(a), sin(a)) * rr * uTexel;
              float di = distAt(uv);
              float ri = blurAt(di, uv);
              // A nearer point blurs over this one; a farther one only as far as this one is blurred,
              // so a sharp subject doesn't get smeared by the background behind it.
              float reach = di < d0 ? ri : min(ri, r0);
              float w = smoothstep(rr - 1.0, rr + 0.5, reach);
              acc += colorAt(uv) * w;
              wsum += w;
            }
            col = acc / wsum;
          }
          gl_FragColor = vec4(col, r0);
        }`,
    });
    this.finish = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tMid: { value: null },
        uTexel: { value: new Vector2() },
        uTint: { value: new Vector3(1, 1, 1) },
        uSat: { value: 1 },
        uContrast: { value: 1 },
        uLift: { value: 0 },
        uVignette: { value: 0 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMid;
        uniform vec2 uTexel;
        uniform vec3 uTint;
        uniform float uSat, uContrast, uLift, uVignette;
        varying vec2 vUv;

        void main() {
          vec4 c = texture2D(tMid, vUv);
          vec3 col = c.rgb;
          // Smooth what the gather left grainy, only where it blurred (sharp detail stays sharp).
          float r = clamp(c.a * 0.3, 0.0, 3.0);
          if (r > 0.6) {
            vec3 acc = col * 2.0;
            float wsum = 2.0;
            for (int i = 0; i < 8; i++) {
              float a = float(i) * 0.785398;
              vec4 s = texture2D(tMid, vUv + vec2(cos(a), sin(a)) * r * uTexel);
              // Only from neighbours that are blurred too, so edges of sharp things don't bleed.
              float w = smoothstep(0.5, 2.0, s.a);
              acc += s.rgb * w;
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
    // For a finished frame: tone-mapped already, so graded and encoded only.
    this.finishDisplay = this.finish.clone();
    this.finishDisplay.toneMapped = false;
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.gather);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
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
    this.renderFrom(renderer, this.target.texture, this.target.depthTexture!, camera, look);
  }

  /** The lens over a scene already drawn: its HDR colour and its depth (M26's frame). */
  renderFrom(
    renderer: WebGLRenderer,
    color: Texture,
    depth: Texture,
    camera: PerspectiveCamera,
    look: PhotoLook,
    /** The colour is a finished, tone-mapped frame (sRGB), not the scene's light. */
    display = false,
  ): void {
    renderer.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    if (!this.mid || this.mid.width !== w || this.mid.height !== h) {
      this.mid?.dispose();
      this.mid = new WebGLRenderTarget(w, h, { type: HalfFloatType, depthBuffer: false });
    }
    const u = this.gather.uniforms;
    u.tColor!.value = color;
    u.tDepth!.value = depth;
    u.uDisplay!.value = display ? 1 : 0;
    (u.uTexel!.value as Vector2).set(1 / w, 1 / h);
    u.uNear!.value = camera.near;
    u.uFar!.value = camera.far;
    u.uFocus!.value = look.focus;
    u.uDof!.value = look.dof;
    u.uTilt!.value = look.tiltShift;
    u.uMaxPx!.value = MAX_BLUR_PX * Math.max(1, h / 800);
    this.quad.material = this.gather;
    renderer.setRenderTarget(this.mid);
    renderer.render(this.scene, this.camera);

    const finish = display ? this.finishDisplay : this.finish;
    const f = finish.uniforms;
    const g = GRADES[look.grade];
    f.tMid!.value = this.mid!.texture;
    (f.uTexel!.value as Vector2).set(1 / w, 1 / h);
    (f.uTint!.value as Vector3).set(g.tint[0], g.tint[1], g.tint[2]);
    f.uSat!.value = g.sat;
    f.uContrast!.value = g.contrast;
    f.uLift!.value = g.lift;
    f.uVignette!.value = g.vignette;
    this.quad.material = finish;
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.mid?.dispose();
    this.target = null;
    this.mid = null;
  }
}
