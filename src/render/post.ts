import {
  AdditiveBlending,
  Color,
  DepthTexture,
  FramebufferTexture,
  HalfFloatType,
  LinearFilter,
  SRGBColorSpace,
  Mesh,
  NearestFilter,
  OrthographicCamera,
  type PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  type Texture,
  Vector2,
  Vector4,
  type WebGLRenderer,
  WebGLRenderTarget,
} from 'three';

/**
 * The frame after the scene is drawn (phase 3, M26): soft shading where things meet (screen-space
 * ambient occlusion from the depth buffer, at half resolution, smoothed across edges it
 * mustn't cross) and a soft glow round lit windows and street lamps at night.
 *
 * While an effect is on, the frame is drawn into a multisampled target with its depth, then
 * copied to the screen with the effects laid over it; otherwise it goes straight to the screen.
 * The target is display-referred: three.js tone-maps and encodes into it as it would into the
 * screen (it is marked as an XR target, the one kind three treats so), so it holds 8 bits a
 * channel and the frame looks the same either way. Each effect costs nothing when it's off or
 * faded out (occlusion from far off, glow by day).
 */

export interface PostSettings {
  /** Ambient occlusion: taps a pixel (0 = off) and whether it is smoothed across. */
  aoSamples: number;
  aoBlur: boolean;
  /** Glow at night. */
  glow: boolean;
  /** Multisampling of the frame while an effect is on (smooth edges). */
  samples: number;
  /** How far off the occlusion has faded out (m); it starts fading at 0.42 of that. */
  aoFar: number;
}

export interface PostFrame {
  /** How strong the occlusion is now, 0..1 (it fades out as the camera rises). */
  ao: number;
  /** Its reach round each point (m). */
  aoRadius: number;
  /** How strong the glow is now, 0..1 (night). */
  glow: number;
}

const QUAD_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

/** A shared helper: view-space position from the depth buffer. */
const VIEW_POS = /* glsl */ `
  uniform sampler2D tDepth;
  uniform vec4 uProj;
  uniform float uNear, uFar;
  float viewZ(vec2 uv) {
    return perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
  }
  vec3 viewPos(vec2 uv, float z) {
    return vec3((uv * uProj.xy + uProj.zw) * -z, z);
  }`;

/** A warm violet for the shade in corners: darker, never greyer (the style reference). */
const AO_TINT = new Color('#6c5f86');

export class PostPipeline {
  settings: PostSettings = { aoSamples: 0, aoBlur: false, glow: false, samples: 4, aoFar: 900 };
  private scene = new Scene();
  private camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private quad: Mesh;
  private target: WebGLRenderTarget | null = null;
  /** Half resolution: occlusion, and its smoothed copy. */
  private aoA: WebGLRenderTarget | null = null;
  private aoB: WebGLRenderTarget | null = null;
  /** A quarter resolution: the bright parts, and their blurred copy. */
  private glowA: WebGLRenderTarget | null = null;
  private glowB: WebGLRenderTarget | null = null;
  private size = new Vector2();
  private aoMat: ShaderMaterial;
  private blurMat: ShaderMaterial;
  private brightMat: ShaderMaterial;
  private glowBlurMat: ShaderMaterial;
  private compositeMat: ShaderMaterial;
  /** The glow alone, added over a frame drawn straight to the screen. */
  private glowAddMat: ShaderMaterial;
  /** The screen's frame, copied for the glow's bright pass. */
  private screen: FramebufferTexture | null = null;
  private samplesBuilt = -1;

  constructor() {
    this.aoMat = this.makeAo(8);
    this.blurMat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: {
        tAO: { value: null },
        tDepth: { value: null },
        uDir: { value: new Vector2() },
        uProj: { value: new Vector4() },
        uNear: { value: 1 },
        uFar: { value: 1000 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform sampler2D tAO;
        uniform vec2 uDir;
        ${VIEW_POS}
        varying vec2 vUv;
        void main() {
          float z0 = viewZ(vUv);
          float sum = 0.0;
          float wsum = 0.0;
          for (int i = -3; i <= 3; i++) {
            vec2 uv = vUv + uDir * float(i);
            float z = viewZ(uv);
            // Not across an edge: a neighbour at another depth doesn't count.
            float w = exp(-float(i * i) / 8.0) * max(0.0, 1.0 - abs(z - z0) / (0.03 * -z0 + 0.3));
            sum += texture2D(tAO, uv).r * w;
            wsum += w;
          }
          gl_FragColor = vec4(sum / max(wsum, 1e-4), 0.0, 0.0, 1.0);
        }`,
    });
    this.brightMat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { tColor: { value: null }, uTexel: { value: new Vector2() }, uThreshold: { value: 0.7 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform vec2 uTexel;
        uniform float uThreshold;
        varying vec2 vUv;
        vec3 bright(vec2 uv) {
          vec3 c = texture2D(tColor, uv).rgb;
          float l = max(c.r, max(c.g, c.b));
          // A soft knee, so glow grows smoothly with a light's brightness.
          float k = max(0.0, l - uThreshold);
          return c * (k * k / (k + 0.12)) / max(l, 1e-4);
        }
        void main() {
          // Four taps between the full-resolution pixels this one covers.
          vec3 c = bright(vUv + uTexel * vec2(-1.0, -1.0)) + bright(vUv + uTexel * vec2(1.0, -1.0)) +
                   bright(vUv + uTexel * vec2(-1.0, 1.0)) + bright(vUv + uTexel * vec2(1.0, 1.0));
          gl_FragColor = vec4(c * 0.25, 1.0);
        }`,
    });
    this.glowBlurMat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { tSrc: { value: null }, uDir: { value: new Vector2() } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tSrc;
        uniform vec2 uDir;
        varying vec2 vUv;
        void main() {
          // Nine taps as five bilinear fetches.
          vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
          c += (texture2D(tSrc, vUv + uDir * 1.3846154).rgb + texture2D(tSrc, vUv - uDir * 1.3846154).rgb) * 0.3162162;
          c += (texture2D(tSrc, vUv + uDir * 3.2307692).rgb + texture2D(tSrc, vUv - uDir * 3.2307692).rgb) * 0.0702703;
          gl_FragColor = vec4(c, 1.0);
        }`,
    });
    this.compositeMat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      // The frame is tone-mapped and encoded already.
      toneMapped: false,
      uniforms: {
        tColor: { value: null },
        tAO: { value: null },
        tGlow: { value: null },
        uAO: { value: 0 },
        uAOTint: { value: AO_TINT.clone() },
        uGlow: { value: 0 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tColor;
        uniform sampler2D tAO;
        uniform sampler2D tGlow;
        uniform float uAO, uGlow;
        uniform vec3 uAOTint;
        varying vec2 vUv;
        void main() {
          vec3 col = texture2D(tColor, vUv).rgb;
          if (uAO > 0.0) {
            float ao = texture2D(tAO, vUv).r;
            col *= mix(vec3(1.0), mix(uAOTint, vec3(1.0), ao), uAO);
          }
          if (uGlow > 0.0) col += texture2D(tGlow, vUv).rgb * uGlow;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.glowAddMat = new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: AdditiveBlending,
      uniforms: { tGlow: { value: null }, uGlow: { value: 0 } },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        uniform sampler2D tGlow;
        uniform float uGlow;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(tGlow, vUv).rgb * uGlow, 1.0);
        }`,
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.compositeMat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  private makeAo(samples: number): ShaderMaterial {
    return new ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      defines: { SAMPLES: samples },
      uniforms: {
        tDepth: { value: null },
        uTexel: { value: new Vector2() },
        uProj: { value: new Vector4() },
        uNear: { value: 1 },
        uFar: { value: 1000 },
        uRadius: { value: 2 },
        uPxPerM: { value: 800 },
        uIntensity: { value: 1.2 },
      },
      vertexShader: QUAD_VERTEX,
      fragmentShader: /* glsl */ `
        #include <packing>
        uniform vec2 uTexel;
        uniform float uRadius, uPxPerM, uIntensity;
        ${VIEW_POS}
        varying vec2 vUv;
        void main() {
          float d = texture2D(tDepth, vUv).x;
          if (d >= 1.0) { gl_FragColor = vec4(1.0); return; }
          float z = perspectiveDepthToViewZ(d, uNear, uFar);
          vec3 P = viewPos(vUv, z);
          // The surface's normal from its neighbours: on each axis the nearer one, so a depth
          // edge doesn't bend it.
          vec2 dx = vec2(uTexel.x * 2.0, 0.0);
          vec2 dy = vec2(0.0, uTexel.y * 2.0);
          vec3 px = viewPos(vUv + dx, viewZ(vUv + dx)) - P;
          vec3 nx = P - viewPos(vUv - dx, viewZ(vUv - dx));
          vec3 py = viewPos(vUv + dy, viewZ(vUv + dy)) - P;
          vec3 ny = P - viewPos(vUv - dy, viewZ(vUv - dy));
          vec3 ddx = abs(px.z) < abs(nx.z) ? px : nx;
          vec3 ddy = abs(py.z) < abs(ny.z) ? py : ny;
          vec3 N = normalize(cross(ddx, ddy));
          if (dot(N, P) > 0.0) N = -N;
          // Taps on a spiral, turned per pixel; their reach is uRadius metres, in pixels here.
          float rPx = min(uRadius * uPxPerM / -z, 90.0);
          float phi = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float occ = 0.0;
          float r2 = uRadius * uRadius;
          for (int i = 0; i < SAMPLES; i++) {
            float t = (float(i) + 0.5) / float(SAMPLES);
            float a = t * 7.0 * 6.2831853 + phi;
            vec2 uv = vUv + vec2(cos(a), sin(a)) * (rPx * t) * uTexel;
            vec3 v = viewPos(uv, viewZ(uv)) - P;
            float vv = dot(v, v);
            float vn = dot(v, N);
            float fall = max(0.0, 1.0 - vv / r2);
            occ += fall * max(0.0, vn * inversesqrt(vv + 1e-4) - 0.08);
          }
          float ao = clamp(1.0 - uIntensity * occ / float(SAMPLES), 0.0, 1.0);
          gl_FragColor = vec4(ao, 0.0, 0.0, 1.0);
        }`,
    });
  }

  private wanted(px: number): number {
    return px > 10e6 ? 0 : px > 6e6 ? Math.min(2, this.settings.samples) : this.settings.samples;
  }

  private ensure(w: number, h: number): void {
    if (
      this.target &&
      this.target.width === w &&
      this.target.height === h &&
      this.target.samples === this.wanted(w * h)
    )
      return;
    this.dispose();
    // Multisampled for smooth edges; less on very big frames (a 2× photo is smooth anyway).
    const px = w * h;
    this.target = new WebGLRenderTarget(w, h, {
      samples: this.wanted(px),
      depthTexture: new DepthTexture(w, h),
    });
    // Drawn into as the screen is: tone-mapped and sRGB-encoded by the shaders (see above), into
    // plain 8-bit storage (named, or three gives the multisampled buffer and the texture
    // different formats for an XR target, and the copy between them fails).
    this.target.texture.colorSpace = SRGBColorSpace;
    this.target.texture.internalFormat = 'RGBA8';
    // The multisampled depth isn't kept once the frame is resolved (a tile-based GPU then never
    // writes it out).
    this.target.storeMultisampledDepthBuffer = false;
    (this.target as { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
    this.target.depthTexture!.minFilter = NearestFilter;
    this.target.depthTexture!.magFilter = NearestFilter;
    const hw = Math.max(1, Math.ceil(w / 2));
    const hh = Math.max(1, Math.ceil(h / 2));
    const lin = { depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter };
    this.aoA = new WebGLRenderTarget(hw, hh, lin);
    this.aoB = new WebGLRenderTarget(hw, hh, lin);
    const qw = Math.max(1, Math.ceil(w / 4));
    const qh = Math.max(1, Math.ceil(h / 4));
    this.glowA = new WebGLRenderTarget(qw, qh, { ...lin, type: HalfFloatType });
    this.glowB = new WebGLRenderTarget(qw, qh, { ...lin, type: HalfFloatType });
  }

  private pass(renderer: WebGLRenderer, mat: ShaderMaterial, to: WebGLRenderTarget | null): void {
    this.quad.material = mat;
    renderer.setRenderTarget(to);
    renderer.render(this.scene, this.camera);
  }

  /**
   * Draw `scene` and lay the effects over it: onto the screen, or (with `into`) into a target for
   * photo mode's lens, whose depth is then `depth`. What it writes is display-referred.
   */
  render(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    frame: PostFrame,
    into: WebGLRenderTarget | null = null,
  ): void {
    renderer.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    this.ensure(w, h);
    const target = this.target!;
    const s = this.settings;
    // The depth is copied out of the multisampled frame only when something reads it.
    target.resolveDepthBuffer = (s.aoSamples > 0 && frame.ao > 0.01) || !!into;
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);

    const proj = camera.projectionMatrix.elements;
    const projInfo = (v: Vector4) => v.set(2 / proj[0]!, 2 / proj[5]!, -1 / proj[0]!, -1 / proj[5]!);
    const ao = s.aoSamples > 0 && frame.ao > 0.01;
    if (ao) {
      if (this.samplesBuilt !== s.aoSamples) {
        this.aoMat.dispose();
        this.aoMat = this.makeAo(s.aoSamples);
        this.samplesBuilt = s.aoSamples;
      }
      const u = this.aoMat.uniforms;
      u.tDepth!.value = target.depthTexture;
      (u.uTexel!.value as Vector2).set(1 / w, 1 / h);
      projInfo(u.uProj!.value as Vector4);
      u.uNear!.value = camera.near;
      u.uFar!.value = camera.far;
      u.uRadius!.value = frame.aoRadius;
      u.uPxPerM!.value = h / (2 * Math.tan((camera.fov * Math.PI) / 360));
      this.pass(renderer, this.aoMat, this.aoA);
      if (s.aoBlur) {
        const b = this.blurMat.uniforms;
        b.tDepth!.value = target.depthTexture;
        projInfo(b.uProj!.value as Vector4);
        b.uNear!.value = camera.near;
        b.uFar!.value = camera.far;
        b.tAO!.value = this.aoA!.texture;
        (b.uDir!.value as Vector2).set(1 / this.aoA!.width, 0);
        this.pass(renderer, this.blurMat, this.aoB);
        b.tAO!.value = this.aoB!.texture;
        (b.uDir!.value as Vector2).set(0, 1 / this.aoA!.height);
        this.pass(renderer, this.blurMat, this.aoA);
      }
    }
    const glow = s.glow && frame.glow > 0.01;
    if (glow) this.blurGlow(renderer, target.texture, w, h);
    const c = this.compositeMat.uniforms;
    c.tColor!.value = target.texture;
    c.tAO!.value = ao ? this.aoA!.texture : null;
    c.uAO!.value = ao ? frame.ao : 0;
    c.tGlow!.value = glow ? this.glowA!.texture : null;
    c.uGlow!.value = glow ? frame.glow : 0;
    this.pass(renderer, this.compositeMat, into);
  }

  /** The bright parts of a frame, at a quarter resolution and blurred, into `glowA`. */
  private blurGlow(renderer: WebGLRenderer, from: Texture, w: number, h: number): void {
    const b = this.brightMat.uniforms;
    b.tColor!.value = from;
    (b.uTexel!.value as Vector2).set(1 / w, 1 / h);
    this.pass(renderer, this.brightMat, this.glowA);
    const g = this.glowBlurMat.uniforms;
    for (let k = 0; k < 2; k++) {
      const spread = 1 + k * 1.5;
      g.tSrc!.value = this.glowA!.texture;
      (g.uDir!.value as Vector2).set(spread / this.glowA!.width, 0);
      this.pass(renderer, this.glowBlurMat, this.glowB);
      g.tSrc!.value = this.glowB!.texture;
      (g.uDir!.value as Vector2).set(0, spread / this.glowA!.height);
      this.pass(renderer, this.glowBlurMat, this.glowA);
    }
  }

  /**
   * The glow alone over a frame already drawn to the screen (when it is the only effect on: from
   * far off at night). Copying the finished screen is cheaper than drawing the whole frame into
   * the multisampled target and resolving it.
   */
  glowOver(renderer: WebGLRenderer, strength: number): void {
    renderer.getDrawingBufferSize(this.size);
    const w = this.size.x;
    const h = this.size.y;
    this.ensure(w, h);
    if (!this.screen || this.screen.image.width !== w || this.screen.image.height !== h) {
      this.screen?.dispose();
      this.screen = new FramebufferTexture(w, h);
    }
    renderer.copyFramebufferToTexture(this.screen);
    this.blurGlow(renderer, this.screen, w, h);
    this.glowAddMat.uniforms.tGlow!.value = this.glowA!.texture;
    this.glowAddMat.uniforms.uGlow!.value = strength;
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    this.pass(renderer, this.glowAddMat, null);
    renderer.autoClear = clear;
  }

  /** The scene's depth from the last frame (photo mode's lens reads it). */
  get depth(): Texture | null {
    return this.target?.depthTexture ?? null;
  }

  dispose(): void {
    this.screen?.dispose();
    this.screen = null;
    this.target?.depthTexture?.dispose();
    for (const t of [this.target, this.aoA, this.aoB, this.glowA, this.glowB]) t?.dispose();
    this.target = this.aoA = this.aoB = this.glowA = this.glowB = null;
  }
}
