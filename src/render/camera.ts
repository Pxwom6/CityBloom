import { PerspectiveCamera, Plane, Raycaster, Vector2, Vector3 } from 'three';
import { MAP_SIZE } from '../data/world';
import { clamp, lerp, smoothstep } from '../sim/terrain/noise';

export interface CameraPose {
  x: number;
  z: number;
  distance: number;
  /** Rotation around the vertical axis (radians). 0 = looking north. */
  yaw: number;
  /** Player adjustment added to the zoom-dependent pitch (radians). */
  tilt: number;
}

export type CameraPresetName = 'overview' | 'city' | 'street' | 'aerial' | 'highway';

const MIN_DIST = 14;
const MAX_DIST = 3400;
/** Photo mode (M16) lets the camera come down to a person's eye level. */
const PHOTO_MIN_DIST = 2.5;
const EYE_HEIGHT = 1.6;
const BOUND = 300;

/**
 * Eased city-builder camera: pan (drag / WASD / edge scroll / two-finger swipe), rotate (right-drag
 * / Q E / Option-swipe / rotate gesture), zoom (wheel or pinch, towards the cursor). The pitch follows the zoom level, from a low street view to a
 * high overview, and the player can tilt on top of that.
 */
export class CameraController {
  readonly goal: CameraPose = { x: MAP_SIZE / 2, z: MAP_SIZE / 2, distance: 2200, yaw: 0.3, tilt: 0 };
  readonly current: CameraPose = { ...this.goal };
  readonly target = new Vector3();
  leftDragPans = true;
  edgeScroll = false;
  /** Off while a menu covers the game: keys and screen edges don't move the camera. */
  inputEnabled = true;
  /**
   * How wheel input is read (M14): a mouse wheel zooms, a trackpad's two-finger swipe pans (and
   * rotates and tilts with Option/Alt or Shift held), a pinch zooms either way. `auto` goes by what
   * the device sends; `detected` is what it last looked like.
   */
  pointerDevice: 'auto' | 'mouse' | 'trackpad' = 'auto';
  detected: 'mouse' | 'trackpad' = 'mouse';
  /** Photo mode (M16): the camera may come lower and closer, down to eye level. */
  photo = false;
  /**
   * Something to ride with (photo mode's follow camera): the camera stays on it, looking the way it
   * travels unless the player turns (the turn is kept as an offset from its heading).
   */
  follow: { x: number; y: number; z: number; yaw: number } | null = null;
  private followOffset = 0;
  private followYaw: number | null = null;
  /** Safari's pinch-and-rotate gesture in progress: its last scale and rotation. */
  private gesture: { scale: number; rotation: number } | null = null;
  /** Set by the app so presets can focus on where the city is. */
  focus: () => { x: number; z: number } = () => ({ x: MAP_SIZE / 2, z: MAP_SIZE / 2 });
  private keys = new Set<string>();
  private drag: { mode: 'pan' | 'rotate'; plane: Plane; grab: Vector3; lastX: number; lastY: number } | null =
    null;
  private ray = new Raycaster();
  private ndc = new Vector2();
  private tmp = new Vector3();
  private tmp2 = new Vector3();
  private pointer = { x: -1, y: -1, inside: false };
  private targetY = 0;

  constructor(
    readonly camera: PerspectiveCamera,
    private dom: HTMLElement,
    private heightAt: (x: number, z: number) => number,
  ) {
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    // Safari (macOS) reports trackpad pinch and rotate as gesture events.
    dom.addEventListener('gesturestart', this.onGesture as EventListener);
    dom.addEventListener('gesturechange', this.onGesture as EventListener);
    dom.addEventListener('gestureend', this.onGesture as EventListener);
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerleave', () => (this.pointer.inside = false));
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.targetY = this.groundY(this.goal.x, this.goal.z);
    this.apply();
  }

  pitchFor(pose: CameraPose): number {
    const base = lerp(0.32, 1.0, smoothstep(25, 2600, pose.distance));
    return clamp(base + pose.tilt, this.photo ? 0.005 : 0.1, 1.52);
  }

  /** How far the point the camera looks at sits above the ground: eye level when close in photo mode. */
  private lift(distance: number): number {
    return this.photo ? EYE_HEIGHT * (1 - smoothstep(10, 150, distance)) : 0;
  }

  private groundY(x: number, z: number): number {
    return Math.max(0, this.heightAt(x, z));
  }

  setPose(pose: Partial<CameraPose>, instant = false): void {
    Object.assign(this.goal, pose);
    this.clampGoal();
    if (instant) {
      Object.assign(this.current, this.goal);
      this.targetY = this.groundY(this.current.x, this.current.z);
      this.apply();
    }
  }

  preset(name: CameraPresetName, instant = false): void {
    const f = this.focus();
    switch (name) {
      case 'overview':
        this.setPose({ x: MAP_SIZE / 2, z: MAP_SIZE / 2 + 150, distance: 2750, yaw: 0.28, tilt: 0 }, instant);
        break;
      case 'city':
        this.setPose({ x: f.x, z: f.z, distance: 620, yaw: 0.55, tilt: 0 }, instant);
        break;
      case 'street':
        this.setPose({ x: f.x, z: f.z, distance: 70, yaw: 0.85, tilt: -0.02 }, instant);
        break;
      case 'aerial':
        this.setPose({ x: MAP_SIZE / 2, z: MAP_SIZE / 2, distance: 2500, yaw: 0, tilt: 0.6 }, instant);
        break;
      case 'highway':
        this.setPose({ x: f.x, z: f.z, distance: 300, yaw: -0.4, tilt: 0 }, instant);
        break;
    }
  }

  private clampGoal(): void {
    const g = this.goal;
    g.distance = clamp(g.distance, this.photo ? PHOTO_MIN_DIST : MIN_DIST, MAX_DIST);
    g.x = clamp(g.x, -BOUND, MAP_SIZE + BOUND);
    g.z = clamp(g.z, -BOUND, MAP_SIZE + BOUND);
    g.tilt = clamp(g.tilt, this.photo ? -1.2 : -0.35, 0.6);
  }

  /** Ground point under a screen position (ray-marched against the terrain), or null. */
  screenToGround(clientX: number, clientY: number, out = new Vector3()): Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    const o = this.ray.ray.origin;
    const d = this.ray.ray.direction;
    if (d.y >= -0.001) return null;
    let prevT = 0;
    let step = Math.max(2, this.current.distance / 200);
    for (let t = step; t < 12000; t += step) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const h = this.groundY(x, z);
      if (y <= h) {
        let lo = prevT;
        let hi = t;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          const my = o.y + d.y * mid;
          if (my <= this.groundY(o.x + d.x * mid, o.z + d.z * mid)) hi = mid;
          else lo = mid;
        }
        return out.set(o.x + d.x * hi, o.y + d.y * hi, o.z + d.z * hi);
      }
      prevT = t;
      step *= 1.01;
    }
    return null;
  }

  private rayPlane(clientX: number, clientY: number, plane: Plane, out: Vector3): Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray.intersectPlane(plane, out);
  }

  private onPointerDown = (e: PointerEvent): void => {
    const pan = e.button === 1 || (e.button === 0 && this.leftDragPans);
    const rotate = e.button === 2;
    if (!pan && !rotate) return;
    this.beginDrag(pan ? 'pan' : 'rotate', e.clientX, e.clientY, e.pointerId);
  };

  /**
   * Start dragging the map from a screen point: a press on the canvas does this itself, and so does
   * one that began on a panel floating over the map and then turned into a drag.
   */
  beginDrag(mode: 'pan' | 'rotate', clientX: number, clientY: number, pointerId: number): void {
    const grab = this.screenToGround(clientX, clientY) ?? this.target.clone();
    this.drag = {
      mode,
      plane: new Plane(new Vector3(0, 1, 0), -grab.y),
      grab,
      lastX: clientX,
      lastY: clientY,
    };
    this.dom.setPointerCapture?.(pointerId);
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = e.clientX - rect.left;
    this.pointer.y = e.clientY - rect.top;
    this.pointer.inside =
      this.pointer.x >= 0 &&
      this.pointer.y >= 0 &&
      this.pointer.x < rect.width &&
      this.pointer.y < rect.height;
    const d = this.drag;
    if (!d) return;
    if (d.mode === 'pan') {
      const p = this.rayPlane(e.clientX, e.clientY, d.plane, this.tmp);
      if (p) {
        this.goal.x += d.grab.x - p.x;
        this.goal.z += d.grab.z - p.z;
        this.clampGoal();
        this.current.x = this.goal.x;
        this.current.z = this.goal.z;
        this.apply();
      }
    } else {
      this.goal.yaw -= (e.clientX - d.lastX) * 0.006;
      this.goal.tilt += (e.clientY - d.lastY) * 0.004;
      this.clampGoal();
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  };

  private onPointerUp = (): void => {
    this.drag = null;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const lines = e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 600 : 1;
    const dx = e.deltaX * lines;
    const dy = e.deltaY * lines;
    // A pinch arrives as a wheel with Ctrl held (Chrome, Firefox, Edge); Safari sends gestures.
    if (e.ctrlKey && !e.metaKey) {
      if (this.gesture) return;
      this.detected = 'trackpad';
      this.zoomBy(Math.exp(clamp(dy, -80, 80) * 0.012), e.clientX, e.clientY);
      return;
    }
    const device = this.pointerDevice === 'auto' ? this.classify(e) : this.pointerDevice;
    if (device === 'trackpad') {
      if (e.altKey || e.shiftKey) {
        // Two fingers with Option/Alt or Shift: sideways turns, up and down tilts.
        this.goal.yaw -= dx * 0.005;
        this.goal.tilt -= dy * 0.003;
      } else this.panBy(dx, dy, this.goal.distance * 0.0012);
      this.clampGoal();
      return;
    }
    const f = Math.exp(clamp(dy, -300, 300) * 0.0016);
    this.zoomBy(f, e.clientX, e.clientY);
  };

  /**
   * Mouse or trackpad? A mouse wheel moves in coarse notches (lines, or whole pixels in large steps
   * straight up and down); a trackpad streams small, often fractional, two-axis deltas.
   */
  private classify(e: WheelEvent): 'mouse' | 'trackpad' {
    if (e.deltaMode !== 0) this.detected = 'mouse';
    else if (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 12)
      this.detected = 'trackpad';
    else if (Math.abs(e.deltaY) >= 50) this.detected = 'mouse';
    return this.detected;
  }

  /** Move the camera by a screen-space amount (a trackpad swipe): the map follows the fingers. */
  private panBy(dx: number, dy: number, perPixel: number): void {
    const s = Math.sin(this.goal.yaw);
    const c = Math.cos(this.goal.yaw);
    this.goal.x += (dx * c + dy * s) * perPixel;
    this.goal.z += (-dx * s + dy * c) * perPixel;
  }

  private onGesture = (
    e: Event & { scale?: number; rotation?: number; clientX?: number; clientY?: number },
  ): void => {
    e.preventDefault();
    const scale = e.scale ?? 1;
    const rotation = e.rotation ?? 0;
    if (e.type === 'gesturestart') {
      this.gesture = { scale, rotation };
      this.detected = 'trackpad';
      return;
    }
    if (e.type === 'gestureend' || !this.gesture) {
      this.gesture = null;
      return;
    }
    if (scale > 0) this.zoomBy(this.gesture.scale / scale, e.clientX, e.clientY);
    this.goal.yaw -= ((rotation - this.gesture.rotation) * Math.PI) / 180;
    this.gesture = { scale, rotation };
    this.clampGoal();
  };

  zoomBy(f: number, clientX?: number, clientY?: number): void {
    const oldD = this.goal.distance;
    const newD = clamp(oldD * f, MIN_DIST, MAX_DIST);
    if (clientX !== undefined && clientY !== undefined && newD < oldD) {
      const a = this.screenToGround(clientX, clientY, this.tmp2);
      if (a) {
        const k = 1 - newD / oldD;
        this.goal.x += (a.x - this.goal.x) * k;
        this.goal.z += (a.z - this.goal.z) * k;
      }
    }
    this.goal.distance = newD;
    this.clampGoal();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!this.inputEnabled) return;
    this.keys.add(e.code);
  };

  update(dt: number): void {
    const k = this.keys;
    const g = this.goal;
    const panSpeed = g.distance * 0.9 * dt;
    let fx = 0;
    let fz = 0;
    if (!this.inputEnabled) k.clear();
    if (k.has('KeyW') || k.has('ArrowUp')) fz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) fz += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) fx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) fx += 1;
    if (this.edgeScroll && this.inputEnabled && this.pointer.inside && !this.drag) {
      const rect = this.dom.getBoundingClientRect();
      const m = 14;
      if (this.pointer.x < m) fx -= 1;
      if (this.pointer.x > rect.width - m) fx += 1;
      if (this.pointer.y < m) fz -= 1;
      if (this.pointer.y > rect.height - m) fz += 1;
    }
    if (fx || fz) {
      const s = Math.sin(g.yaw);
      const c = Math.cos(g.yaw);
      // Forward on screen is -z rotated by yaw.
      g.x += (fx * c + fz * s) * panSpeed;
      g.z += (-fx * s + fz * c) * panSpeed;
    }
    if (k.has('KeyQ')) g.yaw += 1.6 * dt;
    if (k.has('KeyE')) g.yaw -= 1.6 * dt;
    if (k.has('KeyR')) g.tilt += 0.8 * dt;
    if (k.has('KeyF')) g.tilt -= 0.8 * dt;
    if (k.has('Equal') || k.has('NumpadAdd')) g.distance *= Math.exp(-1.8 * dt);
    if (k.has('Minus') || k.has('NumpadSubtract')) g.distance *= Math.exp(1.8 * dt);
    const f = this.follow;
    if (f) {
      // Keep any turn the player made since the last frame as an offset from the heading.
      if (this.followYaw !== null) this.followOffset += g.yaw - this.followYaw;
      g.yaw = f.yaw + this.followOffset;
      this.followYaw = g.yaw;
      g.x = f.x;
      g.z = f.z;
    } else {
      this.followYaw = null;
      this.followOffset = 0;
    }
    this.clampGoal();

    const a = 1 - Math.exp(-dt * 9);
    const c = this.current;
    if (f) {
      // Ride with it: no easing on position, or the camera trails behind.
      c.x = g.x;
      c.z = g.z;
    } else {
      c.x += (g.x - c.x) * a;
      c.z += (g.z - c.z) * a;
    }
    c.distance *= Math.exp((Math.log(g.distance) - Math.log(c.distance)) * a);
    c.yaw += (g.yaw - c.yaw) * a;
    c.tilt += (g.tilt - c.tilt) * a;
    const ground = f ? f.y : this.groundY(c.x, c.z);
    this.targetY += (ground - this.targetY) * (f ? 1 : 1 - Math.exp(-dt * 5));
    this.apply();
  }

  private apply(): void {
    const c = this.current;
    const pitch = this.pitchFor(c);
    this.target.set(c.x, this.targetY + this.lift(c.distance), c.z);
    const cp = Math.cos(pitch);
    const pos = this.camera.position;
    pos.set(
      c.x + Math.sin(c.yaw) * cp * c.distance,
      this.target.y + Math.sin(pitch) * c.distance,
      c.z + Math.cos(c.yaw) * cp * c.distance,
    );
    const floor = this.groundY(pos.x, pos.z) + (this.photo ? 0.6 : 4);
    if (pos.y < floor) pos.y = floor;
    this.camera.near = clamp(c.distance * 0.02, this.photo ? 0.25 : 0.5, 20);
    this.camera.far = Math.max(14000, c.distance * 6);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.target);
  }

  get isDragging(): boolean {
    return this.drag !== null;
  }
}
