import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  NormalBlending,
  Points,
  ShaderMaterial,
} from 'three';
import type { ClientWorld } from '../client/world';

/** Icon atlas order (index = cell). */
export const ICONS = [
  'road',
  'power',
  'water',
  'closed',
  'sewage',
  'garbage',
  'polluted',
  'fire',
  'sick',
  'smog',
  'flood',
  'repair',
] as const;
const ROWS = 3;
const CELL = 64;
const COLS = 4;

function drawAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = CELL * COLS;
  cv.height = CELL * ROWS;
  const g = cv.getContext('2d')!;
  const bg = [
    '#d2493b',
    '#e39a21',
    '#2f86c9',
    '#7b4fb0',
    '#8a6a3a',
    '#5b6b3a',
    '#3a8f8f',
    '#e5552b',
    '#1f9e8f',
    '#6b6f76',
    '#2c6fb0',
    '#c27a1a',
  ];
  ICONS.forEach((name, i) => {
    const cx = (i % COLS) * CELL + CELL / 2;
    const cy = Math.floor(i / COLS) * CELL + CELL / 2;
    g.save();
    g.translate(cx, cy);
    g.beginPath();
    g.arc(0, 0, 27, 0, Math.PI * 2);
    g.fillStyle = bg[i]!;
    g.fill();
    g.lineWidth = 4;
    g.strokeStyle = '#ffffff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#ffffff';
    g.lineCap = 'round';
    g.lineJoin = 'round';
    switch (name) {
      case 'road':
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(-10, 16);
        g.lineTo(-5, -16);
        g.moveTo(10, 16);
        g.lineTo(5, -16);
        g.stroke();
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(-14, -14);
        g.lineTo(14, 14);
        g.stroke();
        break;
      case 'power':
        g.beginPath();
        g.moveTo(4, -18);
        g.lineTo(-10, 3);
        g.lineTo(0, 3);
        g.lineTo(-4, 18);
        g.lineTo(11, -4);
        g.lineTo(1, -4);
        g.closePath();
        g.fill();
        break;
      case 'water':
        g.beginPath();
        g.moveTo(0, -18);
        g.bezierCurveTo(12, -2, 12, 4, 12, 7);
        g.arc(0, 7, 12, 0, Math.PI);
        g.bezierCurveTo(-12, 4, -12, -2, 0, -18);
        g.fill();
        break;
      case 'closed':
        g.fillRect(-15, -5, 30, 10);
        break;
      case 'sewage':
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(-14, -8);
        g.lineTo(6, -8);
        g.quadraticCurveTo(12, -8, 12, 0);
        g.lineTo(12, 14);
        g.stroke();
        break;
      case 'garbage':
        g.beginPath();
        g.moveTo(-11, -8);
        g.lineTo(11, -8);
        g.lineTo(8, 16);
        g.lineTo(-8, 16);
        g.closePath();
        g.fill();
        g.fillRect(-13, -14, 26, 4);
        g.fillRect(-4, -18, 8, 4);
        break;
      case 'polluted':
        g.beginPath();
        g.arc(0, -3, 12, 0, Math.PI * 2);
        g.fill();
        g.fillRect(-7, 6, 14, 9);
        g.fillStyle = '#3a8f8f';
        g.beginPath();
        g.arc(-5, -3, 3.5, 0, Math.PI * 2);
        g.arc(5, -3, 3.5, 0, Math.PI * 2);
        g.fill();
        break;
      case 'sick': {
        // A thermometer.
        g.lineWidth = 5;
        g.beginPath();
        g.moveTo(0, -16);
        g.lineTo(0, 6);
        g.stroke();
        g.beginPath();
        g.arc(0, 10, 7, 0, Math.PI * 2);
        g.fill();
        g.lineWidth = 2.5;
        for (const y of [-12, -6, 0]) {
          g.beginPath();
          g.moveTo(5, y);
          g.lineTo(10, y);
          g.stroke();
        }
        break;
      }
      case 'smog': {
        // A cloud.
        g.beginPath();
        g.arc(-8, 4, 8, 0, Math.PI * 2);
        g.arc(2, -3, 10, 0, Math.PI * 2);
        g.arc(11, 5, 7, 0, Math.PI * 2);
        g.fill();
        g.fillRect(-8, 4, 19, 8);
        break;
      }
      case 'flood': {
        // Waves.
        g.lineWidth = 5;
        for (const y of [-7, 3, 13]) {
          g.beginPath();
          g.moveTo(-16, y);
          g.quadraticCurveTo(-8, y - 7, 0, y);
          g.quadraticCurveTo(8, y + 7, 16, y);
          g.stroke();
        }
        break;
      }
      case 'repair': {
        // A spanner.
        g.lineWidth = 7;
        g.beginPath();
        g.moveTo(-11, 11);
        g.lineTo(5, -5);
        g.stroke();
        g.beginPath();
        g.arc(8, -8, 9, 0, Math.PI * 2);
        g.fill();
        g.globalCompositeOperation = 'destination-out';
        g.beginPath();
        g.moveTo(8, -8);
        g.lineTo(18, -18);
        g.lineTo(14, -4);
        g.closePath();
        g.fill();
        g.globalCompositeOperation = 'source-over';
        break;
      }
      case 'fire':
        g.beginPath();
        g.moveTo(0, -18);
        g.bezierCurveTo(14, -4, 12, 16, 0, 16);
        g.bezierCurveTo(-12, 16, -14, 0, -4, -8);
        g.bezierCurveTo(-4, 0, 0, 2, 2, -2);
        g.closePath();
        g.fill();
        break;
    }
    g.restore();
  });
  return cv;
}

/** Which icon a building shows (most urgent first), or −1. */
export function iconFor(flags: number): number {
  if (flags & 128) return 7;
  if (flags & 1024) return 10;
  if (flags & 1) return 0;
  if (flags & 2) return 1;
  if (flags & 4) return 2;
  if (flags & 32) return 3;
  if (flags & 8) return 4;
  if (flags & 16) return 5;
  if (flags & 256) return 8;
  if (flags & 64) return 6;
  if (flags & 512) return 9;
  return -1;
}

/** Problem icons floating over buildings: a single Points draw call with an icon atlas. */
export class IconRenderer {
  readonly points: Points;
  private geo = new BufferGeometry();
  private mat: ShaderMaterial;
  private dirty = true;

  constructor(private world: ClientWorld) {
    const tex = new CanvasTexture(drawAtlas());
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: { uAtlas: { value: tex }, uTime: { value: 0 }, uScale: { value: 1 } },
      vertexShader: /* glsl */ `
        attribute float icon;
        varying float vIcon;
        varying float vFade;
        uniform float uTime;
        uniform float uScale;
        void main() {
          vIcon = icon;
          vec3 p = position;
          p.y += sin(uTime * 2.0 + position.x * 0.1) * 0.8;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          // Smaller and fainter from far away, so a big city's problems read as hotspots, not snow.
          gl_PointSize = clamp(2600.0 / -mv.z, 8.0, 34.0) * uScale;
          vFade = mix(1.0, 0.55, smoothstep(1400.0, 2600.0, -mv.z));
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uAtlas;
        varying float vIcon;
        varying float vFade;
        void main() {
          float col = mod(vIcon, 4.0);
          float row = floor(vIcon / 4.0);
          vec2 uv = vec2((col + gl_PointCoord.x) / 4.0, 1.0 - (row + gl_PointCoord.y) / 3.0);
          vec4 c = texture2D(uAtlas, uv);
          if (c.a < 0.05) discard;
          gl_FragColor = vec4(c.rgb, c.a * vFade);
          #include <colorspace_fragment>
        }`,
    });
    void AdditiveBlending;
    this.points = new Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 40;
    this.points.name = 'problem-icons';
    world.onBuildings(() => (this.dirty = true));
    world.onCivics(() => (this.dirty = true));
  }

  private rebuild(heights: Map<number, number>, civicHeights: Map<number, number>): void {
    const pos: number[] = [];
    const icon: number[] = [];
    for (const b of this.world.buildings.values()) {
      const k = iconFor(b.flags);
      if (k < 0) continue;
      pos.push(b.x, b.y + (heights.get(b.id) ?? 8) + 6, b.z);
      icon.push(k);
    }
    // Civic buildings knocked out by a disaster: under water, or waiting for repairs.
    for (const c of this.world.civics.values()) {
      if (!c.flooded && !(c.damage > 0)) continue;
      pos.push(c.x, c.y + (civicHeights.get(c.id) ?? 12) + 8, c.z);
      icon.push(c.flooded ? 10 : 11);
    }
    this.geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    this.geo.setAttribute('icon', new BufferAttribute(new Float32Array(icon), 1));
    this.geo.setDrawRange(0, icon.length);
    this.geo.computeBoundingSphere();
  }

  update(time: number, heights: Map<number, number>, civicHeights: Map<number, number>): void {
    this.mat.uniforms.uTime!.value = time;
    if (this.dirty) {
      this.dirty = false;
      this.rebuild(heights, civicHeights);
    }
  }

  get count(): number {
    return this.geo.drawRange.count === Infinity ? 0 : this.geo.drawRange.count;
  }
}
