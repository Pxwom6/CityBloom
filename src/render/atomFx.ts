/**
 * The atom bomb's effects as numbers (M40 step 11b): the missile's way across the sky, the toy
 * mushroom cloud's puffs and how it grows, drifts and fades, the flash's curve, the siren's and the
 * last seconds' beats, and the quality's caps. Pure (no three.js, no clock of its own): the renderer
 * (`atom.ts`) and the page's sounds read these with the display clock, and tests read them as they are.
 */
import { MAP_SIZE } from '../data/world';
import { TICKS_PER_HOUR } from '../sim/time';
import type { NeighbourSide } from '../data/region';

/** Ticks of game time a second at normal speed (a game hour is 7.5 s of play). */
export const TICKS_PER_SECOND = TICKS_PER_HOUR / 7.5;

export const ATOM_FX = {
  /** The missile comes in from this far out on the sender's side (m), and arcs this high (m). */
  reach: 5200,
  apex: 1700,
  /** The missile is drawn this many times its model's size (a toy, comically big). */
  scale: 2.6,
  /** The city's own bomb: rising out of the silo (ticks), then away to the target's side (ticks). */
  rise: 40,
  away: 200,
  /** The silo's hatch opens over the last share of the preparation, and closes this long (ticks) after the bomb has left. */
  hatchFrom: 0.85,
  hatchShut: 160,
  /** The cloud at its full height and the cap's radius (m); the stem's radius as a share of the cap's. */
  height: 900,
  cap: 330,
  stem: 0.24,
  /** Seconds at normal speed the cloud takes to rise and spread. */
  riseSeconds: 20,
  /** After that, it drifts with the wind (m a game hour) and fades: the stem over these game hours, then the cap. */
  drift: 70,
  stemFade: [3, 9] as [number, number],
  capFade: [7, 22] as [number, number],
  /** The shock ring on the ground: how far it runs (m) and how long (s, real time). */
  ring: 1300,
  ringSeconds: 3.2,
  /** The flash (s, real time): a short white bloom, or a soft fade when flashes are softened. */
  flash: 0.3,
  softFlash: 0.8,
  /** The camera's shake (m) and how long it lasts (s); never with flashes softened. */
  shake: 9,
  shakeSeconds: 1.6,
  /** The siren every this many seconds of play while a bomb is in the air; a tick each second of the last ten. */
  sirenEvery: 6,
  tickFrom: 10,
  /** The cloud's budget (the plan's cap): draw calls and triangles. */
  maxCalls: 6,
  maxTriangles: 4000,
} as const;

/** The quality's switches for the atom effects (in `QUALITY_PARAMS.units`). */
export interface AtomQuality {
  /** Puffs in the mushroom cloud (500 at High, 120 at Low). */
  atomPuffs: number;
  /** Puffs in the missile's smoke trail. */
  atomTrail: number;
  /** The radiation tint on the ground over the fallout (0 off, 1 on). */
  atomTint: 0 | 1;
}

/** No quality's cloud may be more than this many puffs: each is two triangles, so the cloud keeps within its budget. */
export const MAX_PUFFS = 600;
export const MAX_TRAIL = 80;

/** The caps a quality's numbers are held to (a setting out of range is brought back in). */
export function atomCaps(q: AtomQuality): AtomQuality {
  return {
    atomPuffs: Math.max(40, Math.min(MAX_PUFFS, Math.round(q.atomPuffs))),
    atomTrail: Math.max(0, Math.min(MAX_TRAIL, Math.round(q.atomTrail))),
    atomTint: q.atomTint ? 1 : 0,
  };
}

/** The way out from the map's middle toward a side (unit, on the ground plane). */
export function sideDir(side: NeighbourSide | null): { x: number; z: number } {
  // North is the map's low z edge, south its high z edge, west its low x edge (as the fallout's edges).
  if (side === 'north') return { x: 0, z: -1 };
  if (side === 'south') return { x: 0, z: 1 };
  if (side === 'west') return { x: -1, z: 0 };
  // (A sender with no side, a friend's city with none known: from the east, over the sea or the hills.)
  return { x: 1, z: 0 };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface MissilePose {
  x: number;
  y: number;
  z: number;
  /** Unit direction it flies in. */
  dx: number;
  dy: number;
  dz: number;
  /** How far through the flight it is (0 to 1). */
  k: number;
}

/**
 * The bomb on its way to the city at a tick (display time, fractional): from far out on the sender's
 * side, up in an arc and steeply down onto ground zero at `arrive`. Null before it was warned of and
 * from the landing on. `ground` is the height of ground zero.
 */
export function inboundAt(
  f: { warn: number; arrive: number; x: number; z: number; side: NeighbourSide | null },
  ground: number,
  tick: number,
): MissilePose | null {
  if (tick >= f.arrive || f.arrive <= f.warn) return null;
  const k = clamp01((tick - f.warn) / (f.arrive - f.warn));
  const d = sideDir(f.side);
  const R = ATOM_FX.reach;
  const H = ATOM_FX.apex;
  // Horizontal: from R out to ground zero; height: a parabola from the ground to the apex and down.
  const h = R * (1 - k);
  const y = ground + 4 * H * k * (1 - k);
  // d/dk: horizontal -R along d (towards ground zero), vertical 4H(1 - 2k).
  const vx = -d.x * R;
  const vz = -d.z * R;
  const vy = 4 * H * (1 - 2 * k);
  const l = Math.hypot(vx, vy, vz) || 1;
  return { x: f.x + d.x * h, y, z: f.z + d.z * h, dx: vx / l, dy: vy / l, dz: vz / l, k };
}

/**
 * The city's own bomb leaving its silo (`fired.tick`): straight up out of the hatch for `rise` ticks,
 * then pitching over and climbing away towards the target's side until it is out of sight. Null
 * before it leaves and once it has gone.
 */
export function outboundAt(
  silo: { x: number; y: number; z: number },
  side: NeighbourSide | null,
  fired: number,
  tick: number,
): MissilePose | null {
  const t = tick - fired;
  if (t < 0 || t > ATOM_FX.rise + ATOM_FX.away) return null;
  const d = sideDir(side);
  if (t <= ATOM_FX.rise) {
    // Slow at first, faster as it clears the hatch (a toy rocket's lift-off).
    const k = t / ATOM_FX.rise;
    return { x: silo.x, y: silo.y + 260 * k * k, z: silo.z, dx: 0, dy: 1, dz: 0, k: 0 };
  }
  const k = (t - ATOM_FX.rise) / ATOM_FX.away;
  // Over and away: a quarter circle bending from up to along the ground, as it climbs.
  const a = (Math.PI / 2) * (1 - (1 - k) * (1 - k)) * 0.8;
  const run = 3200 * k * k + 400 * k;
  const climb = 260 + 1500 * k;
  const dx = d.x * Math.sin(a);
  const dz = d.z * Math.sin(a);
  const dy = Math.cos(a);
  return { x: silo.x + d.x * run, y: silo.y + climb, z: silo.z + d.z * run, dx, dy, dz, k };
}

/** How open the silo's hatch is (0 shut, 1 open): over the end of a launch's preparation, while a prepared bomb waits, and for a while after it has left. */
export function hatchOpen(
  launch: { done: number; ready: boolean } | null,
  fired: number | null,
  tick: number,
): number {
  if (fired !== null) {
    const t = tick - fired;
    if (t < 0) return 1;
    return 1 - smooth(ATOM_FX.hatchShut, ATOM_FX.hatchShut + 60, t);
  }
  if (!launch) return 0;
  if (launch.ready) return 1;
  return smooth(ATOM_FX.hatchFrom, 1, launch.done);
}

/** A puff of the cloud: which part (0 stem, 1 cap, 2 ring), where in the part's own shape, its size, and a random phase. */
export interface Puff {
  part: 0 | 1 | 2;
  /** Stem: angle, radius share, height share. Cap: angle round the torus, angle round its tube, tube share. Ring: angle, radius share, height share. */
  a: number;
  b: number;
  c: number;
  size: number;
  phase: number;
}

/** A small fixed random stream (the cloud looks the same every time it is drawn, and in tests). */
function stream(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/** The cloud's share of puffs in each part: stem, cap and the ring round the stem. */
const SHARES: [number, number, number] = [0.3, 0.5, 0.2];

/**
 * The cloud's puffs for a quality's count: a stem of stacked puffs, a cap as a fat ring with a crown
 * on top, and a thin skirt ring round the stem. Fewer puffs are bigger, so a Low cloud is as full.
 */
export function cloudPuffs(n: number, seed = 0x5eed): Puff[] {
  const count = Math.max(1, Math.min(MAX_PUFFS, Math.round(n)));
  const r = stream(seed);
  // A puff's size grows as the count falls, so the cloud covers the same shape.
  const grow = Math.sqrt(500 / count);
  const out: Puff[] = [];
  const parts = [0, 1, 2].map((p) => Math.round(count * SHARES[p]!));
  parts[1] = count - parts[0]! - parts[2]!;
  for (let p = 0; p < 3; p++)
    for (let i = 0; i < parts[p]!; i++) {
      const u = (i + r()) / parts[p]!;
      if (p === 0)
        out.push({
          part: 0,
          a: r() * Math.PI * 2,
          b: Math.sqrt(r()),
          c: u,
          size: (0.16 + 0.08 * r()) * grow,
          phase: r(),
        });
      else if (p === 1)
        out.push({
          part: 1,
          a: u * Math.PI * 2 * 3.0 + r(),
          b: r() * Math.PI * 2,
          c: Math.sqrt(r()),
          size: (0.2 + 0.1 * r()) * grow,
          phase: r(),
        });
      else
        out.push({
          part: 2,
          a: u * Math.PI * 2 + r() * 0.3,
          b: 0.85 + 0.15 * r(),
          c: r(),
          size: (0.065 + 0.035 * r()) * grow,
          phase: r(),
        });
    }
  return out;
}

/** The cloud at an age: its height and cap radius (m), how far it has drifted (m), and how much of the stem and the cap still show (0 to 1). */
export interface CloudShape {
  height: number;
  cap: number;
  drift: number;
  stem: number;
  capShow: number;
  /** 0 hot (glowing orange) to 1 cool (grey and white). */
  cool: number;
  /** The ring round the stem shows while the cloud rises. */
  ring: number;
}

/**
 * The cloud `seconds` after the landing (normal speed's seconds, or more if the page has watched it
 * longer in real time) and `hours` (game hours) after it: it rises and spreads for `riseSeconds`,
 * then drifts with the wind while the stem thins and the cap fades over game hours. Null once gone.
 */
export function cloudAt(seconds: number, hours: number): CloudShape | null {
  if (seconds < 0) return null;
  const F = ATOM_FX;
  const t = clamp01(seconds / F.riseSeconds);
  const ease = 1 - (1 - t) * (1 - t) * (1 - t);
  const capShow = 1 - smooth(F.capFade[0], F.capFade[1], hours);
  if (capShow <= 0) return null;
  const late = Math.max(0, hours - 1);
  return {
    height: F.height * (0.12 + 0.88 * ease),
    cap: F.cap * (0.25 + 0.75 * ease) * (1 + 0.035 * late),
    // (It drifts once it has risen: a game hour is 7.5 s of play.)
    drift: F.drift * Math.max(0, hours - F.riseSeconds / 7.5),
    stem: 1 - smooth(F.stemFade[0], F.stemFade[1], hours),
    capShow,
    cool: smooth(0.04, 0.55, t),
    // The ring forms round the stem once the cap is up, and is gone by the time the cloud has risen.
    ring: t > 0.5 ? 1 - smooth(0.7, 1, t) : smooth(0.3, 0.5, t),
  };
}

export interface PuffPlace {
  x: number;
  y: number;
  z: number;
  size: number;
  /** Shown share (the shader dithers the rest away). */
  show: number;
  /** 0 hot … 1 cool, and 0 shaded … 1 lit from within (the cap's underside glows while hot). */
  heat: number;
}

/**
 * Where a puff stands for a cloud shape, relative to ground zero (y above the ground there). A slow
 * churn from `time` (s) turns the cap's tube so it rolls, as a toy cloud would.
 */
export function placePuff(p: Puff, s: CloudShape, time: number, out: PuffPlace): PuffPlace {
  const H = s.height;
  const R = s.cap;
  const roll = time * 0.05 + p.phase * 0.2;
  if (p.part === 0) {
    const r = R * ATOM_FX.stem * (0.35 + 0.65 * p.b) * (1 - 0.35 * p.c) + R * 0.25 * (1 - p.c) ** 3;
    out.x = Math.cos(p.a) * r;
    out.z = Math.sin(p.a) * r;
    out.y = H * 0.88 * p.c;
    out.size = R * p.size * (1.15 - 0.4 * p.c);
    out.show = s.stem;
    out.heat = (1 - s.cool) * 0.55 * (1 - p.c);
  } else if (p.part === 1) {
    // A torus whose tube rolls outward and down (the cap's churn), with puffs inside the tube too.
    const tube = R * 0.42 * p.c;
    const b = p.b + roll;
    const ring = R * 0.62 + Math.cos(b) * tube;
    out.x = Math.cos(p.a) * ring;
    out.z = Math.sin(p.a) * ring;
    out.y = H + Math.sin(b) * tube * 0.75 + R * 0.08;
    out.size = R * p.size;
    out.show = s.capShow;
    // The cap's underside glows while it is hot.
    out.heat = (1 - s.cool) * (0.6 + 0.4 * Math.max(0, -Math.sin(b)));
  } else {
    const r = R * (0.7 + 0.25 * p.b);
    out.x = Math.cos(p.a) * r;
    out.z = Math.sin(p.a) * r;
    out.y = H * (0.45 + 0.06 * p.c);
    out.size = R * p.size;
    out.show = s.ring * s.capShow;
    out.heat = 0;
  }
  return out;
}

/** The flash's strength `t` seconds (real time) after the landing: a sharp white bloom, or a soft fade. */
export function flashAt(t: number, soft: boolean): number {
  if (t < 0) return 0;
  if (soft) {
    const d = ATOM_FX.softFlash;
    if (t >= d) return 0;
    // Up over a fifth, then down: never a hard jump.
    return 0.45 * (t < d * 0.2 ? smooth(0, d * 0.2, t) : 1 - smooth(d * 0.2, d, t));
  }
  const d = ATOM_FX.flash;
  if (t >= d * 3) return 0;
  return t < d ? 1 : 1 - smooth(d, d * 3, t);
}

/** The camera's shake (m) `t` seconds after the landing; none with flashes softened. */
export function shakeAt(t: number, soft: boolean): number {
  if (soft || t < 0 || t >= ATOM_FX.shakeSeconds) return 0;
  const k = 1 - t / ATOM_FX.shakeSeconds;
  return ATOM_FX.shake * k * k;
}

/**
 * The beats of sound between two display ticks while a bomb is in the air (the page plays them): the
 * siren every `sirenEvery` seconds of play from the warning, and a tick each second of the last
 * `tickFrom` seconds before the landing. A display clock that jumped (a load, a long hold) plays at
 * most one of each.
 */
export function atomBeats(
  f: { warn: number; arrive: number },
  from: number,
  to: number,
): { siren: boolean; ticks: number } {
  if (to <= from || to <= f.warn || from >= f.arrive) return { siren: false, ticks: 0 };
  const S = TICKS_PER_SECOND;
  const every = ATOM_FX.sirenEvery * S;
  // The siren at the warning itself is the game's own warning sound; every beat after it here.
  const beat = (t: number) => Math.floor((Math.min(t, f.arrive) - f.warn) / every);
  // (Not at the landing itself: the blast is the sound then.)
  const siren = from >= f.warn && to < f.arrive && beat(to) > beat(from);
  // Ticks: seconds left (at normal speed) crossing a whole number at or under `tickFrom`.
  const left = (t: number) => Math.ceil((f.arrive - Math.min(t, f.arrive)) / S);
  const a = left(from);
  const b = left(to);
  let ticks = 0;
  for (let s = a - 1; s >= b && s >= 1; s--) if (s <= ATOM_FX.tickFrom) ticks++;
  return { siren, ticks: Math.min(ticks, 1) };
}

/** A default ground zero (the map's middle) for a staged picture with none given. */
export const MAP_MIDDLE = { x: MAP_SIZE / 2, z: MAP_SIZE / 2 };
