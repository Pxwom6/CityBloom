/**
 * The battle map's picture (M39, design call 6): the battle from above on a 2D canvas. Roads and water
 * make a layer drawn when the view changes; structures, the ways in, units and shots are drawn each
 * frame from the battle's latest frame. The arithmetic is `battleMapView.ts`; the colours are the
 * `--map-*` tokens, read once (`readPalette`).
 */
import { BATTLE } from '../data/battle';
import { UNIT } from '../data/war';
import {
  CELL_DEEP,
  CELL_SHALLOW,
  CELL_STEEP,
  type BattleFrame,
  type BattleLayout,
  type BattleUnitView,
  type Side,
} from '../sim/battle/types';
import {
  edgeMark,
  mapUnits,
  roadLines,
  structRadiusPx,
  structsOf,
  toScreen,
  UNIT_PX,
  type MapStruct,
  type MapView,
  type StructKind,
  type StructState,
} from './battleMapView';

/** The map's colours: the `--map-*` tokens, with the values the tokens file gives them as fallbacks. */
export interface Palette {
  ground: string;
  water: string;
  waterDeep: string;
  steep: string;
  road: string;
  roadEdge: string;
  attacker: string;
  attackerDark: string;
  defender: string;
  defenderDark: string;
  select: string;
  fallen: string;
  damaged: string;
  objective: string;
  text: string;
  halo: string;
  kinds: Record<StructKind, string>;
  font: string;
}

const TOKENS: [keyof Omit<Palette, 'kinds' | 'font'>, string, string][] = [
  ['ground', '--map-ground', '#ebe7d8'],
  ['water', '--map-water', '#bcd6e8'],
  ['waterDeep', '--map-water-deep', '#9fc2dc'],
  ['steep', '--map-steep', '#ddd6c0'],
  ['road', '--map-road', '#fbf9f1'],
  ['roadEdge', '--map-road-edge', '#b9b29a'],
  ['attacker', '--map-attacker', '#d2493b'],
  ['attackerDark', '--map-attacker-dark', '#7d211a'],
  ['defender', '--map-defender', '#2f7bc4'],
  ['defenderDark', '--map-defender-dark', '#173f6b'],
  ['select', '--map-select', '#ffb000'],
  ['fallen', '--map-fallen', '#77726a'],
  ['damaged', '--map-damaged', '#e8892b'],
  ['objective', '--map-objective', '#c0392b'],
  ['text', '--color-text', '#24303c'],
  ['halo', '--map-halo', '#fffdf8'],
];

const KIND_TOKENS: [StructKind, string][] = [
  ['home', '#cdbf93'],
  ['job', '#b2a8cf'],
  ['industry', '#c9a063'],
  ['power', '#e3c64a'],
  ['civic', '#a3a8ad'],
  ['shelter', '#67b0a6'],
  ['base', '#85945a'],
  ['hq', '#66762f'],
  ['defence', '#94603a'],
  ['intercept', '#7f6ca8'],
];

export function readPalette(el: Element | null): Palette {
  const css = el && typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
  const get = (name: string, fallback: string) => css?.getPropertyValue(name).trim() || fallback;
  const p = { kinds: {} as Record<StructKind, string> } as Palette;
  for (const [key, name, fallback] of TOKENS) p[key] = get(name, fallback) as never;
  for (const [kind, fallback] of KIND_TOKENS) p.kinds[kind] = get(`--map-${kind}`, fallback);
  p.font = css?.fontFamily || 'system-ui, sans-serif';
  return p;
}

/** Everything one picture of the map is made from. */
export interface DrawModel {
  layout: BattleLayout;
  frame: BattleFrame | null;
  states: readonly StructState[];
  view: MapView;
  /** The side the player commands (a watcher has none). */
  side: Side | null;
  selected: ReadonlySet<number>;
  /** An order waits for its target: what a click can land on is lit when the pointer is over it. */
  hover: { kind: 'structure'; k: number } | { kind: 'unit'; id: number } | null;
  box: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Wall-clock seconds, for the pulse of what is aimed at. */
  time: number;
  dpr: number;
}

/** What the map keeps between pictures: the roads and water layer, and the unpacked layout. */
export class MapCache {
  private layoutRef: BattleLayout | null = null;
  structs: MapStruct[] = [];
  roads: number[][] = [];
  names = new Map<number, string>();
  private layer: HTMLCanvasElement | OffscreenCanvas | null = null;
  private layerKey = '';

  prepare(layout: BattleLayout): void {
    if (this.layoutRef === layout) return;
    this.layoutRef = layout;
    this.structs = structsOf(layout);
    this.roads = roadLines(layout);
    this.names = new Map(layout.names);
    this.layer = null;
    this.layerKey = '';
  }

  /** The ground, water and roads for a view: redrawn only when the view moves. */
  ground(m: DrawModel, p: Palette): CanvasImageSource {
    const v = m.view;
    const key = [v.scale.toFixed(4), v.left.toFixed(1), v.top.toFixed(1), v.w, v.h, m.dpr].join(':');
    if (!this.layer || key !== this.layerKey) {
      const w = Math.round(v.w * m.dpr);
      const h = Math.round(v.h * m.dpr);
      const layer: HTMLCanvasElement | OffscreenCanvas =
        typeof OffscreenCanvas === 'function'
          ? new OffscreenCanvas(w, h)
          : Object.assign(document.createElement('canvas'), { width: w, height: h });
      const g = layer.getContext('2d') as CanvasRenderingContext2D;
      g.scale(m.dpr, m.dpr);
      drawGround(g, m.layout, v, this.roads, p);
      this.layer = layer;
      this.layerKey = key;
    }
    return this.layer;
  }
}

function drawGround(
  g: CanvasRenderingContext2D,
  layout: BattleLayout,
  v: MapView,
  roads: number[][],
  p: Palette,
): void {
  g.fillStyle = p.ground;
  g.fillRect(0, 0, v.w, v.h);
  // Water and steep ground, by the terrain grid's cells.
  const grid = layout.grid;
  const cell = BATTLE.cell;
  const c = cell * v.scale;
  for (let j = 0; j < grid.nz; j++)
    for (let i = 0; i < grid.nx; i++) {
      const t = grid.cells[j * grid.nx + i];
      if (t !== CELL_SHALLOW && t !== CELL_DEEP && t !== CELL_STEEP) continue;
      const q = toScreen(v, grid.x0 + i * cell, grid.z0 + j * cell);
      if (q.x > v.w || q.y > v.h || q.x + c < 0 || q.y + c < 0) continue;
      g.fillStyle = t === CELL_DEEP ? p.waterDeep : t === CELL_SHALLOW ? p.water : p.steep;
      g.fillRect(Math.floor(q.x), Math.floor(q.y), Math.ceil(c) + 1, Math.ceil(c) + 1);
    }
  // Roads: an edge line under a lighter one.
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const width = Math.max(2.5, 9 * v.scale);
  for (const [stroke, w] of [
    [p.roadEdge, width + 2],
    [p.road, width],
  ] as const) {
    g.strokeStyle = stroke;
    g.lineWidth = w;
    g.beginPath();
    for (const line of roads) {
      for (let k = 0; k < line.length; k += 2) {
        const q = toScreen(v, line[k]!, line[k + 1]!);
        if (k === 0) g.moveTo(q.x, q.y);
        else g.lineTo(q.x, q.y);
      }
    }
    g.stroke();
  }
}

/** One picture of the map. */
export function drawBattleMap(g: CanvasRenderingContext2D, cache: MapCache, m: DrawModel, p: Palette): void {
  const v = m.view;
  g.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  g.clearRect(0, 0, v.w, v.h);
  cache.prepare(m.layout);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(cache.ground(m, p), 0, 0);
  g.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
  drawWaysIn(g, m, p);
  drawStructures(g, cache, m, p);
  drawShots(g, m, p);
  drawUnits(g, m, p);
  if (m.box) {
    const b = m.box;
    g.fillStyle = 'rgba(255, 176, 0, 0.14)';
    g.strokeStyle = p.select;
    g.lineWidth = 1.5;
    g.setLineDash([5, 3]);
    g.fillRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    g.strokeRect(Math.min(b.x0, b.x1), Math.min(b.y0, b.y1), Math.abs(b.x1 - b.x0), Math.abs(b.y1 - b.y0));
    g.setLineDash([]);
  }
}

// ----------------------------------------------------------------------------- the ways in

const ROUTE_NAME = { highway: 'road', rail: 'rail', sea: 'sea', air: 'air' } as const;

function drawWaysIn(g: CanvasRenderingContext2D, m: DrawModel, p: Palette): void {
  g.font = `600 10px ${p.font}`;
  g.textBaseline = 'middle';
  for (const e of m.layout.entries) {
    const label = ROUTE_NAME[e.route];
    const edge = edgeMark(m.view, e.x, e.z);
    const q = edge ?? toScreen(m.view, e.x, e.z);
    // Pointing in: from the way in towards the middle of the picture.
    const angle = edge ? edge.angle + Math.PI : Math.atan2(m.view.h / 2 - q.y, m.view.w / 2 - q.x);
    g.save();
    g.translate(q.x, q.y);
    g.rotate(angle);
    g.fillStyle = p.attacker;
    g.strokeStyle = p.halo;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(9, 0);
    g.lineTo(-5, -7);
    g.lineTo(-2, 0);
    g.lineTo(-5, 7);
    g.closePath();
    g.stroke();
    g.fill();
    g.restore();
    // The route's name beside it, on the picture's inner side, kept on the canvas.
    const half = g.measureText(label).width / 2;
    const tx = Math.min(m.view.w - half - 4, Math.max(half + 4, q.x + Math.cos(angle) * 22));
    const ty = Math.min(m.view.h - 8, Math.max(8, q.y + Math.sin(angle) * 22));
    g.textAlign = 'center';
    g.lineWidth = 3;
    g.strokeStyle = p.halo;
    g.strokeText(label, tx, ty);
    g.fillStyle = p.attackerDark;
    g.fillText(label, tx, ty);
  }
}

// ----------------------------------------------------------------------------- structures

function drawStructures(g: CanvasRenderingContext2D, cache: MapCache, m: DrawModel, p: Palette): void {
  const v = m.view;
  const targets = new Map((m.frame?.targets ?? []).map((t) => [t.id, t.hp]));
  const pulse = 0.5 + 0.5 * Math.sin(m.time * 4);
  // Fallen first, so what still stands is on top of the rubble.
  const order = [...cache.structs].sort(
    (a, b) => (m.states[b.k] === 2 ? 1 : 0) - (m.states[a.k] === 2 ? 1 : 0),
  );
  const labels: { text: string; x: number; y: number; r: number }[] = [];
  for (const s of order) {
    const q = toScreen(v, s.x, s.z);
    if (q.x < -20 || q.y < -20 || q.x > v.w + 20 || q.y > v.h + 20) continue;
    const r = structRadiusPx(v, s);
    const state = m.states[s.k] ?? 0;
    g.save();
    g.translate(q.x, q.y);
    if (state === 2) {
      // Rubble: a flat grey mark with a cross.
      g.fillStyle = p.fallen;
      g.globalAlpha = 0.75;
      g.fillRect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
      g.globalAlpha = 1;
      g.strokeStyle = p.halo;
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(-r * 0.6, -r * 0.6);
      g.lineTo(r * 0.6, r * 0.6);
      g.moveTo(r * 0.6, -r * 0.6);
      g.lineTo(-r * 0.6, r * 0.6);
      g.stroke();
      g.restore();
      continue;
    }
    shape(
      g,
      s.kind,
      r,
      p.kinds[s.kind],
      state === 1 ? p.damaged : 'rgba(40, 48, 60, 0.55)',
      state === 1 ? 2 : 1,
    );
    if (state === 1) {
      // Hurt: a small flame.
      g.fillStyle = p.damaged;
      g.beginPath();
      g.moveTo(0, -r - 6);
      g.quadraticCurveTo(4, -r - 1, 0, -r + 1);
      g.quadraticCurveTo(-4, -r - 1, 0, -r - 6);
      g.fill();
    }
    g.restore();
    // What the attackers are after: a ring that pulses, and its health.
    const hp = targets.get(s.id);
    if (hp !== undefined) {
      g.strokeStyle = p.objective;
      g.lineWidth = 2;
      g.globalAlpha = 0.55 + 0.45 * pulse;
      g.beginPath();
      g.arc(q.x, q.y, r + 5 + pulse * 1.5, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
      const w = Math.max(22, r * 2 + 8);
      g.fillStyle = 'rgba(30, 36, 44, 0.65)';
      g.fillRect(q.x - w / 2, q.y + r + 8, w, 4);
      g.fillStyle = hp > 0.5 ? '#4caf7d' : hp > 0.25 ? p.damaged : p.objective;
      g.fillRect(q.x - w / 2, q.y + r + 8, w * Math.max(0, Math.min(1, hp)), 4);
      const name = cache.names.get(s.id);
      if (name) labels.push({ text: name, x: q.x, y: q.y, r });
    }
    if (m.hover?.kind === 'structure' && m.hover.k === s.k) {
      g.strokeStyle = p.select;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(q.x, q.y, r + 4, 0, Math.PI * 2);
      g.stroke();
    }
  }
  drawLabels(g, labels, v, p);
}

/**
 * The names of what is aimed at, each beside its building: above it, else below its health bar, else to
 * one side, whichever place is free (none: it is left out rather than written over another).
 */
function drawLabels(
  g: CanvasRenderingContext2D,
  labels: { text: string; x: number; y: number; r: number }[],
  v: MapView,
  p: Palette,
): void {
  g.font = `600 10px ${p.font}`;
  const taken: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const l of [...labels].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const w = g.measureText(l.text).width + 4;
    const spots = [
      { x: l.x, y: l.y - l.r - 11 },
      { x: l.x, y: l.y + l.r + 20 },
      { x: l.x + l.r + 8 + w / 2, y: l.y },
      { x: l.x - l.r - 8 - w / 2, y: l.y },
    ];
    for (const at of spots) {
      const box = { x0: at.x - w / 2, y0: at.y - 6, x1: at.x + w / 2, y1: at.y + 6 };
      if (box.x0 < 2 || box.y0 < 2 || box.x1 > v.w - 2 || box.y1 > v.h - 2) continue;
      if (taken.some((t) => box.x0 < t.x1 && box.x1 > t.x0 && box.y0 < t.y1 && box.y1 > t.y0)) continue;
      taken.push(box);
      label(g, l.text, at.x, at.y, p);
      break;
    }
  }
}

function label(g: CanvasRenderingContext2D, text: string, x: number, y: number, p: Palette): void {
  g.font = `600 10px ${p.font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 3;
  g.strokeStyle = p.halo;
  g.strokeText(text, x, y);
  g.fillStyle = p.text;
  g.fillText(text, x, y);
}

/** A structure's mark by kind: its fill, and an outline (thicker when hurt). */
function shape(
  g: CanvasRenderingContext2D,
  kind: StructKind,
  r: number,
  fill: string,
  stroke: string,
  line: number,
): void {
  g.fillStyle = fill;
  g.strokeStyle = stroke;
  g.lineWidth = line;
  g.beginPath();
  switch (kind) {
    case 'defence':
      // A gun: a triangle.
      g.moveTo(0, -r * 1.15);
      g.lineTo(r * 1.05, r * 0.85);
      g.lineTo(-r * 1.05, r * 0.85);
      g.closePath();
      break;
    case 'intercept':
      g.moveTo(0, -r * 1.2);
      g.lineTo(r * 1.2, 0);
      g.lineTo(0, r * 1.2);
      g.lineTo(-r * 1.2, 0);
      g.closePath();
      break;
    case 'hq':
      // The HQ: a star.
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rad = k % 2 === 0 ? r * 1.35 : r * 0.6;
        if (k === 0) g.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
        else g.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
      }
      g.closePath();
      break;
    case 'power':
      g.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'shelter':
      g.arc(0, 0, r, Math.PI, 0);
      g.closePath();
      break;
    default:
      g.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
  }
  g.fill();
  g.stroke();
  if (kind === 'base') {
    // A military building: a bar across.
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(-r * 0.5, 0);
    g.lineTo(r * 0.5, 0);
    g.stroke();
  }
}

// ----------------------------------------------------------------------------- shots and units

function drawShots(g: CanvasRenderingContext2D, m: DrawModel, p: Palette): void {
  // (Over, the last frame's shots are not in the air any more.)
  const shots = m.frame && !m.frame.outcome ? m.frame.shots : null;
  if (!shots?.length) return;
  g.lineWidth = 1.2;
  for (const s of shots) {
    // A shell or a burst is drawn as it nears its mark: the last of its line.
    const q0 = toScreen(m.view, s.x0, s.z0);
    const b = toScreen(m.view, s.x1, s.z1);
    const a = { x: q0.x + (b.x - q0.x) * 0.6, y: q0.y + (b.y - q0.y) * 0.6 };
    g.strokeStyle = s.kind === 3 ? p.defender : s.hit ? p.objective : p.fallen;
    g.globalAlpha = 0.8;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
    if (s.hit) {
      g.fillStyle = p.damaged;
      g.beginPath();
      g.arc(b.x, b.y, 2.2, 0, Math.PI * 2);
      g.fill();
    }
  }
  g.globalAlpha = 1;
}

function drawUnits(g: CanvasRenderingContext2D, m: DrawModel, p: Palette): void {
  const frame = m.frame;
  if (!frame) return;
  const owners = new Map((frame.helpers ?? []).map((h) => [h.owner, h.color]));
  // Wrecks first, then the ground, then the air above it.
  const rank = (u: BattleUnitView) =>
    u.state === 2 ? 0 : (UNIT.get(u.kind)?.domain ?? 'land') === 'air' ? 2 : 1;
  const list = [...mapUnits(frame)].sort((a, b) => rank(a) - rank(b));
  for (const u of list) {
    const q = toScreen(m.view, u.x, u.z);
    if (q.x < -12 || q.y < -12 || q.x > m.view.w + 12 || q.y > m.view.h + 12) continue;
    const def = UNIT.get(u.kind);
    const domain = def?.domain ?? 'land';
    const r = UNIT_PX / 2 + (def?.super ? 3 : 0) + (u.kind === 'heavytank' || u.kind === 'bomber' ? 1 : 0);
    const mine = m.side !== null && u.side === m.side;
    if (u.state === 2) {
      g.strokeStyle = p.fallen;
      g.lineWidth = 1.6;
      g.beginPath();
      g.moveTo(q.x - 3, q.y - 3);
      g.lineTo(q.x + 3, q.y + 3);
      g.moveTo(q.x + 3, q.y - 3);
      g.lineTo(q.x - 3, q.y + 3);
      g.stroke();
      continue;
    }
    const fill = u.side === 0 ? p.attacker : p.defender;
    const dark = u.side === 0 ? p.attackerDark : p.defenderDark;
    const heading = Math.atan2(-Math.cos(u.yaw), -Math.sin(u.yaw));
    // The air is above its shadow.
    const lift = domain === 'air' ? 4 : 0;
    if (domain === 'air') {
      g.fillStyle = 'rgba(30, 36, 44, 0.22)';
      g.beginPath();
      g.ellipse(q.x, q.y + 2, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
      g.fill();
    }
    // A chosen unit is ringed, under its mark.
    const picked = m.selected.has(u.id);
    const hovered = m.hover?.kind === 'unit' && m.hover.id === u.id;
    if (picked || hovered) {
      g.strokeStyle = p.select;
      g.lineWidth = picked ? 2.6 : 3;
      g.beginPath();
      g.arc(q.x, q.y - lift, r + 4, 0, Math.PI * 2);
      g.stroke();
    }
    if (u.waiting) {
      // Still mobilising at its base: a hollow square.
      g.save();
      g.translate(q.x, q.y);
      g.fillStyle = fill;
      g.strokeStyle = dark;
      g.lineWidth = 1.4;
      g.setLineDash([2.5, 2]);
      g.beginPath();
      g.roundRect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8, 2);
      g.globalAlpha = 0.25;
      g.fill();
      g.globalAlpha = 1;
      g.stroke();
      g.restore();
      continue;
    }
    g.save();
    g.translate(q.x, q.y - lift);
    g.fillStyle = fill;
    g.strokeStyle = dark;
    g.lineWidth = 1.6;
    // Marks tell the sides apart without the colour: attackers point the way they face, defenders are squares.
    if (domain === 'sea') {
      g.rotate(heading);
      g.beginPath();
      g.moveTo(r * 1.3, 0);
      g.lineTo(-r * 0.2, -r * 0.8);
      g.lineTo(-r * 1.2, -r * 0.6);
      g.lineTo(-r * 1.2, r * 0.6);
      g.lineTo(-r * 0.2, r * 0.8);
      g.closePath();
    } else if (domain === 'air') {
      g.rotate(heading);
      g.beginPath();
      g.moveTo(r * 1.2, 0);
      g.lineTo(-r * 0.9, -r * 1.05);
      g.lineTo(-r * 0.35, 0);
      g.lineTo(-r * 0.9, r * 1.05);
      g.closePath();
    } else if (u.side === 0) {
      g.rotate(heading);
      g.beginPath();
      g.moveTo(r * 1.15, 0);
      g.lineTo(-r * 0.85, -r * 0.95);
      g.lineTo(-r * 0.85, r * 0.95);
      g.closePath();
    } else {
      g.beginPath();
      g.roundRect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8, 2);
    }
    g.fill();
    g.stroke();
    // An ally's unit (a helper's) is edged in its owner's colour.
    const ownerColor = u.owner !== undefined ? owners.get(u.owner) : undefined;
    if (ownerColor !== undefined) {
      g.strokeStyle = `#${ownerColor.toString(16).padStart(6, '0')}`;
      g.lineWidth = 2.2;
      g.stroke();
    }
    if (def?.super) {
      g.fillStyle = p.halo;
      g.beginPath();
      g.arc(0, 0, 1.8, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // Health, when it is not whole: a small bar under the mark.
    if (u.hp < 0.995) {
      const w = 12;
      g.fillStyle = 'rgba(30, 36, 44, 0.7)';
      g.fillRect(q.x - w / 2, q.y + r + 3, w, 3);
      g.fillStyle = u.hp > 0.5 ? '#4caf7d' : u.hp > 0.25 ? p.damaged : p.objective;
      g.fillRect(q.x - w / 2, q.y + r + 3, w * u.hp, 3);
    }
    // Held (firing without moving): a short bar over it.
    if (mine && u.state === 1) {
      g.fillStyle = p.halo;
      g.fillRect(q.x - 3, q.y - lift - r - 4, 6, 2);
    }
  }
}
