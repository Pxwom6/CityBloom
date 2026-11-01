/**
 * Fallout (M40 step 4, `docs/plans/M40-design.md` calls 11 and 12): what an atom bomb leaves on the
 * ground and in the air. Two rasters of the pollution's size (128 cells of 16 m):
 *
 * - the **ground** layer stays where it fell, spreads a very little and decays with a half-life of
 *   eight game years, so the core of a strike reopens after about 18 years (11 hours of play at 1x);
 *   at or above `FALLOUT.ban` nothing can be zoned, placed or grown on it;
 * - the **air** layer is the plume: it moves with the city's own wind (`windAngle`, the way the smoke
 *   does), spreads, leaves a little on the ground as it goes and fades. What the wind carries off the
 *   north, south or west edge is counted (`out`) and falls on the computer neighbour on that side; the
 *   east edge is a sink. A computer neighbour with fallout of its own sends a thin stream the other
 *   way when the wind blows from its side.
 *
 * `SimState.fallout` is made by the first strike or the first inflow, so a city that never has any is
 * exactly as before; every effect (sickness, mood, work, land value) reads it through one function
 * that is exactly 1 (or 0) without it. Everything is DMath, rasters are walked in index order and no
 * random stream is touched. Updated every three game hours in the slot after the air pollution's;
 * the friends' half (the report's plume, `friendFallout`) is step 10 and uses `seen` and `out`.
 */
import { ATOM_WIRE, FALLOUT } from '../../data/atom';
import { GRID_CELL, GRID_RES } from '../../data/world';
import { DMath, formatInt } from '../dmath';
import { fail, ok, type CommandResult } from '../commands';
import type { Sim } from '../sim';
import type { Building } from '../world/buildings';
import type { Neighbour } from './region';
import { researched } from './research';
import { fieldAt, windAngle } from './pollution';

const R = GRID_RES;
const N = R * R;

/** A clean-up crew at work (call 11): where, the hours still to go, and whether it is relief crews. */
export interface CleanJob {
  x: number;
  z: number;
  left: number;
  relief?: true;
}

/**
 * The city's fallout (`SimState.fallout`), made on first use. `out` is what the air has carried
 * across each edge so far (cumulative, rounded to a thousandth); `seen` is, per friend's slot, how
 * much of a friend's plume this city has already taken in (step 10).
 */
export interface Fallout {
  ground: Float32Array;
  air: Float32Array;
  out: { north: number; south: number; west: number };
  seen: Record<number, number>;
  jobs: CleanJob[];
}

type Side = 'north' | 'south' | 'west';
const SIDES: readonly Side[] = ['north', 'south', 'west'];

const round3 = (v: number) => Math.round(v * 1000) / 1000;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const dollars = (v: number) => `$${formatInt(Math.round(v))}`;

/** The share of the ground layer left after one update (three game hours): a half-life of eight years. */
const GROUND_KEEP = DMath.pow(0.5, 3 / (FALLOUT.halfLifeYears * FALLOUT.yearHours));
/** The share of a computer neighbour's level left after a month (a game day): the same half-life. */
const TOWN_MONTH_KEEP = DMath.pow(0.5, 1 / (FALLOUT.halfLifeYears * 12));

/** The raster cell under (x, z), clamped to the map. */
function cellAt(x: number, z: number): number {
  const i = Math.min(R - 1, Math.max(0, Math.floor(x / GRID_CELL)));
  const j = Math.min(R - 1, Math.max(0, Math.floor(z / GRID_CELL)));
  return j * R + i;
}

/** The city's fallout, made when there is the first of it (the caller is about to put some in). */
export function falloutOf(sim: Sim): Fallout {
  const s = sim.state;
  return (s.fallout ??= {
    ground: new Float32Array(N),
    air: new Float32Array(N),
    out: { north: 0, south: 0, west: 0 },
    seen: {},
    jobs: [],
  });
}

// ---------------------------------------------------------------------------------------------
// Reading it: the dose, the bans, the years left, the one function each effect reads
// ---------------------------------------------------------------------------------------------

/** The dose in a raster cell: the ground and half the air, at most 1. */
export function doseAtCell(f: Fallout, k: number): number {
  return Math.min(1, f.ground[k]! + FALLOUT.airDose * f.air[k]!);
}

/** The dose where people are at (x, z), 0 without fallout. */
export function falloutDose(sim: Sim, x: number, z: number): number {
  const f = sim.state.fallout;
  return f ? doseAtCell(f, cellAt(x, z)) : 0;
}

/** The ground layer at (x, z), 0 without fallout. */
export function falloutGround(sim: Sim, x: number, z: number): number {
  const f = sim.state.fallout;
  return f ? fieldAt(f.ground, x, z) : 0;
}

/** Is the ground at (x, z) closed to building: at or above the ban? Always false without fallout. */
export function falloutBanned(sim: Sim, x: number, z: number): boolean {
  const f = sim.state.fallout;
  return !!f && fieldAt(f.ground, x, z) >= FALLOUT.ban;
}

/**
 * Game years until ground at this level falls below the ban, from the decay alone (the spreading
 * and what the air adds are ignored): 0 for ground that is open already.
 */
export function falloutYears(ground: number): number {
  if (!(ground >= FALLOUT.ban)) return 0;
  return (FALLOUT.halfLifeYears * DMath.log(ground / FALLOUT.ban)) / Math.LN2;
}

/** A span of game years in whole years, at least one ("1 more game year", "13 more game years"). */
function yearsWords(years: number): string {
  const n = Math.max(1, Math.round(years));
  return `${n} more game year${n === 1 ? '' : 's'}`;
}

/** Hours (or minutes) of play at 1x that a span of game years takes. */
export function playTime(years: number): string {
  const hours = (years * FALLOUT.yearHours * FALLOUT.secondsPerHour) / 3600;
  if (hours >= 1) {
    const n = Math.round(hours);
    return `${n} hour${n === 1 ? '' : 's'} of play`;
  }
  const m = Math.max(1, Math.round(hours * 60));
  return `${m} minute${m === 1 ? '' : 's'} of play`;
}

/**
 * Why nothing can be built at (x, z), in plain words with the years left, or null when the ground
 * is open. `others` are further points of the same footprint: the worst of them decides.
 */
export function falloutRefusal(
  sim: Sim,
  x: number,
  z: number,
  others: readonly [number, number][] = [],
): string | null {
  const f = sim.state.fallout;
  if (!f) return null;
  let top = fieldAt(f.ground, x, z);
  for (const [ox, oz] of others) top = Math.max(top, fieldAt(f.ground, ox, oz));
  if (top < FALLOUT.ban) return null;
  return `Fallout lies on this ground. Nothing can be built here for about ${yearsWords(falloutYears(top))}.`;
}

/** What a home's residents fall ill of, on top of the usual causes (new cases per resident per hour). */
export function falloutSickness(sim: Sim, b: Building): number {
  const d = falloutDose(sim, b.x, b.z);
  return d > 0 ? FALLOUT.effect.sickness * d : 0;
}

/** A home's mood term for the fallout near it (negative), or 0. */
export function falloutMood(sim: Sim, b: Building): number {
  const d = falloutDose(sim, b.x, b.z);
  return d > 0 ? FALLOUT.effect.mood * d : 0;
}

/**
 * How much of its work a building gets done under fallout, 1 to 0.4: the multiplier its taxes, its
 * freight and its share of the specialisations' income are scaled by. Exactly 1 without fallout.
 */
export function radiationWork(sim: Sim, b: Building): number {
  const f = sim.state.fallout;
  if (!f) return 1;
  const d = doseAtCell(f, cellAt(b.x, b.z));
  return d > 0 ? 1 - Math.min(FALLOUT.effect.workMax, FALLOUT.effect.work * d) : 1;
}

// ---------------------------------------------------------------------------------------------
// The strike
// ---------------------------------------------------------------------------------------------

/**
 * A bomb has fallen at (x, z) (`atomImpact.ts`, once the blast is over): the ground takes the strike's
 * deposit, falling off with the distance, and a share of that mass goes into the air over the downwind
 * side, to be carried off by the wind of the day. Adds to what is there (a second strike on ground
 * already hot), at most 1. Cells are walked in index order; the wind is the city's own.
 */
export function depositFallout(sim: Sim, x: number, z: number): void {
  const f = falloutOf(sim);
  const E = FALLOUT.impact;
  const a = windAngle(sim.state.options.seed, sim.state.tick);
  const wx = DMath.cos(a);
  const wz = DMath.sin(a);
  const span = Math.ceil(E.reach / GRID_CELL) + 1;
  const ci = Math.floor(x / GRID_CELL);
  const cj = Math.floor(z / GRID_CELL);
  const dep = new Float64Array(N);
  let total = 0;
  let downwind = 0;
  for (let j = Math.max(0, cj - span); j <= Math.min(R - 1, cj + span); j++)
    for (let i = Math.max(0, ci - span); i <= Math.min(R - 1, ci + span); i++) {
      const cx = (i + 0.5) * GRID_CELL;
      const cz = (j + 0.5) * GRID_CELL;
      const v = strikeDeposit(DMath.hypot(cx - x, cz - z));
      if (v <= 0) continue;
      const k = j * R + i;
      dep[k] = v;
      total += v;
      if ((cx - x) * wx + (cz - z) * wz > 0) downwind += v;
    }
  // The plume carries `plume` of the mass; it lies over the downwind side, where it is thickest.
  const scale = downwind > 0 ? (E.plume * total) / downwind : 0;
  for (let j = Math.max(0, cj - span); j <= Math.min(R - 1, cj + span); j++)
    for (let i = Math.max(0, ci - span); i <= Math.min(R - 1, ci + span); i++) {
      const k = j * R + i;
      const v = dep[k]!;
      if (v <= 0) continue;
      f.ground[k] = Math.min(1, f.ground[k]! + v);
      const cx = (i + 0.5) * GRID_CELL;
      const cz = (j + 0.5) * GRID_CELL;
      if ((cx - x) * wx + (cz - z) * wz > 0) f.air[k] = Math.min(1, f.air[k]! + v * scale);
    }
}

// ---------------------------------------------------------------------------------------------
// The update, every three game hours
// ---------------------------------------------------------------------------------------------

/** The air's concentration beyond each edge: what a computer neighbour with fallout sends in. */
function inflows(sim: Sim): Record<Side, number> {
  const out: Record<Side, number> = { north: 0, south: 0, west: 0 };
  for (const n of sim.state.region.neighbours) {
    const level = n.rival && !n.player ? (n.rival.fallout ?? 0) : 0;
    if (level > 0) out[n.side] += FALLOUT.town.inflow * level;
  }
  return out;
}

/** Does a wind at this bearing blow in from the neighbour on that side (towards the city)? */
function windFrom(a: number, side: Side): boolean {
  return side === 'north' ? DMath.sin(a) > 0 : side === 'south' ? DMath.sin(a) < 0 : DMath.cos(a) > 0;
}

/**
 * Does the city need an update now: it has fallout, or a neighbour has some whose stream the wind
 * would carry in? (Cheap: three neighbours and a bearing.) A city with neither is left alone.
 */
export function falloutDue(sim: Sim): boolean {
  const s = sim.state;
  if (s.fallout) return true;
  const inn = inflows(sim);
  if (inn.north <= 0 && inn.south <= 0 && inn.west <= 0) return false;
  const a = windAngle(s.options.seed, s.tick);
  return (
    (inn.north > 0 && windFrom(a, 'north')) ||
    (inn.south > 0 && windFrom(a, 'south')) ||
    (inn.west > 0 && windFrom(a, 'west'))
  );
}

/**
 * One update (three game hours): finished clean-up jobs clear their ground, then the air moves with
 * the wind (a stream from a neighbour with fallout coming in beyond the edges), spreads, leaves a
 * little on the ground and fades, the ground spreads a little and decays, and what the wind carried
 * off the north, south and west edges is counted and handed to the neighbour there (the east edge is
 * a sink).
 */
export function updateFallout(sim: Sim): void {
  const s = sim.state;
  if (!falloutDue(sim)) return;
  const f = falloutOf(sim);
  const A = FALLOUT.air;
  const inn = inflows(sim);
  runJobs(sim, f);
  const ang = windAngle(s.options.seed, s.tick);
  const dx = DMath.cos(ang) * A.wind;
  const dz = DMath.sin(ang) * A.wind;
  const air = f.air;
  const ground = f.ground;
  // Moved with the wind: each cell takes what lay upwind of it (bilinear), the stream beyond an edge
  // included, the rest off the map being nothing.
  let any = inn.north > 0 || inn.south > 0 || inn.west > 0;
  for (let k = 0; k < N && !any; k++) if (air[k]! > 0) any = true;
  const moved = new Float32Array(N);
  let gone: Record<Side, number> = { north: 0, south: 0, west: 0 };
  if (any) {
    gone = carriedOff(air, dx, dz);
    const at = (i: number, j: number): number =>
      i >= R ? 0 : j < 0 ? inn.north : j >= R ? inn.south : i < 0 ? inn.west : air[j * R + i]!;
    for (let j = 0; j < R; j++)
      for (let i = 0; i < R; i++) {
        const x = i - dx;
        const z = j - dz;
        const i0 = Math.floor(x);
        const j0 = Math.floor(z);
        const fx = x - i0;
        const fz = z - j0;
        moved[j * R + i] =
          at(i0, j0) * (1 - fx) * (1 - fz) +
          at(i0 + 1, j0) * fx * (1 - fz) +
          at(i0, j0 + 1) * (1 - fx) * fz +
          at(i0 + 1, j0 + 1) * fx * fz;
      }
  }
  // Spreading, the share left on the ground, fading; the ground spreads and decays and takes it.
  const nextAir = new Float32Array(N);
  const nextGround = new Float32Array(N);
  const gd = FALLOUT.ground.diffusion;
  for (let j = 0; j < R; j++)
    for (let i = 0; i < R; i++) {
      const k = j * R + i;
      let nb = 0;
      let gb = 0;
      let cnt = 0;
      if (i > 0) {
        nb += moved[k - 1]!;
        gb += ground[k - 1]!;
        cnt++;
      }
      if (i < R - 1) {
        nb += moved[k + 1]!;
        gb += ground[k + 1]!;
        cnt++;
      }
      if (j > 0) {
        nb += moved[k - R]!;
        gb += ground[k - R]!;
        cnt++;
      }
      if (j < R - 1) {
        nb += moved[k + R]!;
        gb += ground[k + R]!;
        cnt++;
      }
      const spread = moved[k]! * (1 - A.diffusion) + (cnt ? (nb / cnt) * A.diffusion : 0);
      const left = spread * A.deposit;
      let a = (spread - left) * A.decay;
      let g = (ground[k]! * (1 - gd) + (cnt ? (gb / cnt) * gd : 0)) * GROUND_KEEP + left;
      if (a < FALLOUT.floor) a = 0;
      if (g < FALLOUT.floor) g = 0;
      nextAir[k] = Math.min(1, a);
      nextGround[k] = Math.min(1, g);
    }
  air.set(nextAir);
  ground.set(nextGround);
  handOver(sim, f, gone);
}

/**
 * What the shift of one update carries off the map: the air in each cell goes to the point `(dx, dz)`
 * cells away and is shared out over the four cells round it, exactly the weights the bilinear step
 * above reads back with, so the share whose cells lie beyond the north, south or west edge is the very
 * mass the step drops (the corners go to north and south; the east edge is a sink and is not counted).
 * Counting the flux, not a band of rows, keeps the total whole whatever the wind: a band cleared after
 * the step saw only the parcels that happened to land in it (about half of a plume), and cleared a
 * stream smeared along an edge when the wind turned. An edge the wind is not blowing towards gets
 * nothing, and one it grazes only the little the shift reaches.
 */
function carriedOff(air: Float32Array, dx: number, dz: number): Record<Side, number> {
  const sums: Record<Side, number> = { north: 0, south: 0, west: 0 };
  for (let j = 0; j < R; j++)
    for (let i = 0; i < R; i++) {
      // Air no thicker than the thickest stream a neighbour can send is haze, not a cloud.
      const v = air[j * R + i]! - FALLOUT.town.inflow;
      if (!(v > 0)) continue;
      const x = i + dx;
      const z = j + dz;
      const i0 = Math.floor(x);
      const j0 = Math.floor(z);
      // The footprint (i0..i0+1, j0..j0+1) lies wholly on the map for nearly every cell.
      if (i0 >= 0 && j0 >= 0 && j0 + 1 < R) continue;
      const fx = x - i0;
      const fz = z - j0;
      for (let b = 0; b < 4; b++) {
        const w = (b & 1 ? fx : 1 - fx) * (b & 2 ? fz : 1 - fz);
        if (!(w > 0)) continue;
        const ii = i0 + (b & 1);
        const jj = j0 + (b >> 1);
        if (jj < 0) sums.north += v * w;
        else if (jj >= R) sums.south += v * w;
        else if (ii < 0) sums.west += v * w;
      }
    }
  return sums;
}

/** Count what left the map and hand it to the computer neighbour on that side (`FALLOUT.town`). */
function handOver(sim: Sim, f: Fallout, gone: Record<Side, number>): void {
  for (const side of SIDES) {
    const d = round3(gone[side]);
    if (d <= 0) continue;
    f.out[side] = round3(f.out[side] + d);
    for (const n of sim.state.region.neighbours) {
      if (n.side !== side || !n.rival || n.player) continue;
      n.rival.fallout = round6(
        Math.min(1, (n.rival.fallout ?? 0) + (d * FALLOUT.town.share) / FALLOUT.town.scale),
      );
    }
  }
}

/**
 * A friend's cloud reaches the city (M40 step 10, plan call 12; page only, `friendFallout`). `total`
 * is the friend's cumulative air towards this city, as the region gave it; the sim keeps how much of
 * it it has taken in (`seen`) and puts what is new on the edge facing that friend, as air, only while
 * the city's own wind blows from that side (air put there while the wind blows away would leave by the
 * same edge at once, and be counted back to the sender as `out`). Idempotent: the same total twice
 * adds once; the first sight of a friend takes nothing (a newcomer, or a friend away for the whole
 * drift, is spared); a lower total (the friend went back to a save) sets `seen` down. When the wind is
 * wrong the cloud waits, `seen` where it was, and comes in the next time the wind is right. What one
 * message adds is bounded (`FALLOUT.friend.step`): the room bounds the total, not the flow.
 */
export function friendFallout(sim: Sim, from: unknown, total: unknown, dryRun: boolean): CommandResult {
  const BAD = 'That cloud could not be read';
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1 || from > ATOM_WIRE.slots)
    return fail(BAD);
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0 || total > ATOM_WIRE.plumeMax)
    return fail(BAD);
  const s = sim.state;
  if (!s.war) return fail('War is off in this city');
  const n = s.region.neighbours.find((x) => x.player?.slot === from);
  if (!n) return fail('That came from a city this one doesn’t know');
  const t = round3(total);
  const seen = s.fallout?.seen[from];
  // First sight (or nothing from it yet): taken as already known, and nothing deposited.
  if (seen === undefined) {
    if (t <= 0) return ok(0);
    if (dryRun) return ok(0);
    falloutOf(sim).seen[from] = t;
    sim.warChanged();
    return ok(0, { info: { deposited: 0 } });
  }
  if (t === seen) return ok(0, { info: { deposited: 0 } });
  if (t < seen) {
    if (dryRun) return ok(0);
    s.fallout!.seen[from] = t;
    sim.warChanged();
    return ok(0, { info: { deposited: 0 } });
  }
  // New cloud, but not on this city's wind: it waits at the border.
  if (!windFrom(windAngle(s.options.seed, s.tick), n.side))
    return ok(0, { info: { deposited: 0, waiting: true } });
  if (dryRun) return ok(0);
  const put = depositFromFriend(s.fallout!, n.side, t - seen);
  s.fallout!.seen[from] = t;
  sim.warChanged();
  return ok(0, { info: { deposited: put } });
}

/** Put a friend's new cloud (`news` of its total) on the strip of the edge facing it; the air added (mass). */
function depositFromFriend(f: Fallout, side: Side, news: number): number {
  const F = FALLOUT.friend;
  const cells = R * F.rows;
  const per = Math.min(F.cell, (Math.min(news, F.step) * F.share) / (cells * F.spread));
  let put = 0;
  for (let j = 0; j < R; j++)
    for (let i = 0; i < R; i++) {
      const on = side === 'north' ? j < F.rows : side === 'south' ? j >= R - F.rows : i < F.rows;
      if (!on) continue;
      const k = j * R + i;
      const v = Math.min(1, f.air[k]! + per);
      put += v - f.air[k]!;
      f.air[k] = v;
    }
  return round3(put);
}

/** A computer neighbour's fallout halves every eight game years, and is gone once it is a trace. */
export function falloutTownMonth(n: Neighbour): void {
  const r = n.rival;
  if (!r?.fallout) return;
  const v = r.fallout * TOWN_MONTH_KEEP;
  if (v < 0.005) delete r.fallout;
  else r.fallout = round6(v);
}

/** What a neighbour's fallout costs its growth a month (a value, never a draw): 0 when it has none. */
export function falloutTownDrag(n: Neighbour): number {
  const level = n.rival && !n.player ? (n.rival.fallout ?? 0) : 0;
  return level > 0 ? FALLOUT.town.drag * level : 0;
}

// ---------------------------------------------------------------------------------------------
// Clean-up
// ---------------------------------------------------------------------------------------------

/** What a clean-up job costs this city: the price, and whether it is relief crews at `relief` times that. */
export function cleanupPrice(sim: Sim): { price: number; relief: boolean } {
  const relief = !researched(sim, FALLOUT.cleanup.tier);
  return { price: FALLOUT.cleanup.cost * (relief ? FALLOUT.cleanup.relief : 1), relief };
}

/** The highest ground within a clean-up's reach of (x, z). */
function worstWithin(f: Fallout, x: number, z: number): number {
  const C = FALLOUT.cleanup;
  const span = Math.ceil(C.radius / GRID_CELL);
  const ci = Math.floor(x / GRID_CELL);
  const cj = Math.floor(z / GRID_CELL);
  let top = 0;
  for (let j = Math.max(0, cj - span); j <= Math.min(R - 1, cj + span); j++)
    for (let i = Math.max(0, ci - span); i <= Math.min(R - 1, ci + span); i++)
      if (DMath.hypot((i + 0.5) * GRID_CELL - x, (j + 0.5) * GRID_CELL - z) <= C.radius)
        top = Math.max(top, f.ground[j * R + i]!);
  return top;
}

/**
 * Send a crew to clear the ground within 128 m of (x, z) (M40, call 11): `cleanFallout`. Needs the
 * city's fallout, ground there worth clearing, a free crew (three at a time) and the money, a city that
 * hasn't researched Repair crews paying twice for relief crews. The crew works on the city's own
 * hours; when it is done the ground there has half the dose.
 */
export function cleanFallout(sim: Sim, x: number, z: number, dryRun: boolean): CommandResult {
  const f = sim.state.fallout;
  if (!f) return fail('There is no fallout in the city to clean up');
  if (![x, z].every(Number.isFinite) || x < 0 || z < 0 || x > R * GRID_CELL || z > R * GRID_CELL)
    return fail('Invalid position');
  const C = FALLOUT.cleanup;
  const px = Math.round(x);
  const pz = Math.round(z);
  if (worstWithin(f, px, pz) < C.min) return fail('The ground there is clean enough: no crew is needed');
  if (f.jobs.length >= C.jobs) return fail(`${C.jobs} crews are already at work: wait for one to finish`);
  if (f.jobs.some((j) => DMath.hypot(j.x - px, j.z - pz) < C.radius / 2))
    return fail('A crew is already working there');
  const { price, relief } = cleanupPrice(sim);
  if (!sim.state.options.sandbox && sim.state.treasury < price)
    return fail(`Not enough money: ${dollars(price)} for ${relief ? 'relief crews' : 'a clean-up crew'}`);
  if (dryRun) return ok(price, { info: { relief } });
  sim.spend(price, 'cleanup');
  f.jobs.push({ x: px, z: pz, left: C.hours, ...(relief ? { relief: true as const } : {}) });
  sim.warChanged();
  return ok(price, { info: { relief } });
}

/** Crews work three hours of the update; a finished one halves the ground within its reach. */
function runJobs(sim: Sim, f: Fallout): void {
  if (!f.jobs.length) return;
  const C = FALLOUT.cleanup;
  const span = Math.ceil(C.radius / GRID_CELL);
  const kept: CleanJob[] = [];
  for (const job of f.jobs) {
    job.left -= 3;
    if (job.left > 0) {
      kept.push(job);
      continue;
    }
    const ci = Math.floor(job.x / GRID_CELL);
    const cj = Math.floor(job.z / GRID_CELL);
    for (let j = Math.max(0, cj - span); j <= Math.min(R - 1, cj + span); j++)
      for (let i = Math.max(0, ci - span); i <= Math.min(R - 1, ci + span); i++)
        if (DMath.hypot((i + 0.5) * GRID_CELL - job.x, (j + 0.5) * GRID_CELL - job.z) <= C.radius) {
          const v = f.ground[j * R + i]! * C.keep;
          f.ground[j * R + i] = v < FALLOUT.floor ? 0 : v;
        }
    sim.events.push({ kind: 'falloutCleaned', id: 0, info: { x: job.x, z: job.z } });
  }
  f.jobs = kept;
  sim.warChanged();
}

// ---------------------------------------------------------------------------------------------
// For the map's tooltip and the war room
// ---------------------------------------------------------------------------------------------

/** What the radiation map says about a spot: the dose, and how long it stays closed. */
export interface FalloutReading {
  /** The dose (ground and half the air, 0 to 1), the ground and the air alone. */
  dose: number;
  ground: number;
  air: number;
  /** Closed to building (the ground is at or above the ban), the game years left and the words. */
  closed: boolean;
  years: number;
  text: string;
}

/** The map's tooltip for (x, z): "Fallout 0.34. Closed for about 13 more game years (8 hours of play)". */
export function falloutReading(sim: Sim, x: number, z: number): FalloutReading {
  const f = sim.state.fallout;
  const k = cellAt(x, z);
  const ground = f ? f.ground[k]! : 0;
  const air = f ? f.air[k]! : 0;
  const dose = f ? doseAtCell(f, k) : 0;
  const closed = ground >= FALLOUT.ban;
  const years = falloutYears(ground);
  const level = Math.round(dose * 100) / 100;
  const text =
    dose < 0.005
      ? 'No fallout here'
      : closed
        ? `Fallout ${level.toFixed(2)}. Closed for about ${yearsWords(years)} (${playTime(years)})`
        : `Fallout ${level.toFixed(2)}. Open for building`;
  return { dose, ground, air, closed, years, text };
}

/** The city's fallout at a glance, for the war room and the clean-up tool. */
export interface FalloutSummary {
  /** Metres squared of ground closed to building, and the highest ground level. */
  closedArea: number;
  peak: number;
  /** Crews at work: where, hours left, relief or not; and what the next job costs. */
  jobs: CleanJob[];
  price: number;
  relief: boolean;
  /** What the air has carried across the edges so far. */
  out: Fallout['out'];
}

/** The `fallout` query: the map's reading at a spot (when asked about one) and the city's fallout. */
export interface FalloutQuery {
  reading: FalloutReading | null;
  summary: FalloutSummary | null;
}

/** The fallout in the city, or null when it has none. */
export function falloutSummary(sim: Sim): FalloutSummary | null {
  const f = sim.state.fallout;
  if (!f) return null;
  let closed = 0;
  let peak = 0;
  for (let k = 0; k < N; k++) {
    const g = f.ground[k]!;
    if (g >= FALLOUT.ban) closed++;
    if (g > peak) peak = g;
  }
  const { price, relief } = cleanupPrice(sim);
  return {
    closedArea: closed * GRID_CELL * GRID_CELL,
    peak: Math.round(peak * 1000) / 1000,
    jobs: f.jobs.map((j) => ({ ...j })),
    price,
    relief,
    out: { ...f.out },
  };
}

/** The strike's ground deposit at a distance, for tests and the probe (`FALLOUT.impact`). */
export function strikeDeposit(d: number): number {
  const E = FALLOUT.impact;
  return d >= E.reach ? 0 : Math.min(1, E.peak * DMath.pow(1 - d / E.reach, E.shape));
}
