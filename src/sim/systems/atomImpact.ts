/**
 * The atom bomb lands (M40, plan calls 10 and 9's other half): where it falls and what it does to
 * the city under it. Ground zero is the densest district, chosen by the target city's own sim when it
 * accepts the bomb. The blast is dealt out in hourly slices of at most `ATOM.impact.slice`
 * buildings, nearest first, so no tick pays for a whole city at once: slice 0 also closes the civic
 * buildings in the ring, the roads, trees and the crater; every slice after it levels the next
 * buildings until none inside is left standing. The fires round the edge are set on the tick after
 * the landing, and the civic buildings inside come down a few a tick after that (taking one away
 * costs more than a house, and a fire more than a few): one heavy thing a tick, none over budget.
 *
 * This is not a disaster and not a battle. It raises no ambulance, counts no casualty and writes no
 * disaster line: homes that fall are residents who have left the city, and that is all the city is
 * told. It draws only from dice of its own (`Rng.fromSeed(seed:atom:id)`, a building's own id), never
 * from a `sim.rng` stream, and a slice done is rubble, so a slice is idempotent and a city saved in
 * the middle of an impact carries on exactly. Fallout and the nuclear winter, which follow the last
 * slice, are steps 4 and 5 (the two seams at the bottom).
 */
import { ATOM } from '../../data/atom';
import { MAP_SIZE } from '../../data/world';
import { ZONE_R } from '../../data/zones';
import { DMath } from '../dmath';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import type { Building } from '../world/buildings';
import type { Atom } from './atom';
import { buildingsNear, clearTrees, segmentsNear } from './disasters';
import { ignite, toRubble } from './incidents';
import { damageCivic } from './raids';

/** The landing in hand (`Atom.impact`). */
export type Impact = NonNullable<Atom['impact']>;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where a bomb aimed at this city falls: the centre of the densest window of the map by the people
 * in it (every active building's `pop`, as `cityCentre` weighs them, summed in `bucket`-metre cells
 * over a window `window` metres across), ties to the lowest cell. Not the city's centre, which can
 * sit in a park: the thickest part of it. A map nobody lives on gives its middle. Integer sums only.
 */
export function groundZero(sim: Sim): { x: number; z: number } {
  const L = ATOM.impact;
  const n = Math.ceil(MAP_SIZE / L.bucket);
  const w = Math.max(1, Math.round(L.window / L.bucket));
  const pop = new Int32Array(n * n);
  let any = false;
  for (const b of sim.state.buildings.values()) {
    if (b.state === BState.Rubble || b.pop <= 0) continue;
    const i = clamp(Math.floor(b.x / L.bucket), 0, n - 1);
    const j = clamp(Math.floor(b.z / L.bucket), 0, n - 1);
    pop[j * n + i] = pop[j * n + i]! + Math.round(b.pop);
    any = true;
  }
  if (!any) return { x: MAP_SIZE / 2, z: MAP_SIZE / 2 };
  // A summed-area table: the window at (i, j) is four lookups.
  const m = n + 1;
  const sum = new Int32Array(m * m);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++)
      sum[(j + 1) * m + i + 1] =
        pop[j * n + i]! + sum[j * m + i + 1]! + sum[(j + 1) * m + i]! - sum[j * m + i]!;
  let best = -1;
  let bi = 0;
  let bj = 0;
  for (let j = 0; j + w <= n; j++)
    for (let i = 0; i + w <= n; i++) {
      const s = sum[(j + w) * m + i + w]! - sum[j * m + i + w]! - sum[(j + w) * m + i]! + sum[j * m + i]!;
      if (s > best) {
        best = s;
        bi = i;
        bj = j;
      }
    }
  return { x: (bi + w / 2) * L.bucket, z: (bj + w / 2) * L.bucket };
}

/** The distance from ground zero and the id: the order a blast reaches things. */
interface Near {
  b: Building;
  d: number;
}

function byDistance(a: Near, b: Near): number {
  return a.d - b.d || a.b.id - b.b.id;
}

/**
 * One slice of the blast (call 10): the first `ATOM.impact.slice` buildings still standing inside
 * the radius, nearest first, fall to rubble, their residents counted as having left; the first slice
 * also closes the ring's civic buildings and the roads, clears the trees and leaves the crater (the
 * fires and the civic buildings inside have ticks of their own). Says whether the blast has now left
 * nothing standing inside (the last slice).
 */
export function impactSlice(sim: Sim, im: Impact): boolean {
  const L = ATOM.impact;
  const standing: Near[] = [];
  for (const b of buildingsNear(sim, im.x, im.z, L.level)) {
    if (b.state === BState.Rubble) continue;
    standing.push({ b, d: DMath.hypot(b.x - im.x, b.z - im.z) });
  }
  standing.sort(byDistance);
  const batch = standing.slice(0, L.slice);
  if (im.done === 0) {
    closeCivics(sim, im);
    blastRoads(sim, im);
    clearTrees(sim, im.x, im.z, L.level * L.treeReach);
    sim.state.craters.push({ x: im.x, z: im.z, r: L.crater, tick: sim.state.tick });
    sim.disastersChanged();
  }
  for (const { b } of batch) {
    if (b.zone === ZONE_R) im.fled += b.pop;
    toRubble(sim, b, 'collapsed');
  }
  im.levelled = (im.levelled ?? 0) + batch.length;
  im.done++;
  sim.warChanged();
  return standing.length <= L.slice;
}

/** Civic buildings out to 1.5 times the blast close for a while (the war's own damage, so Repair crews shorten it). */
function closeCivics(sim: Sim, im: Impact): void {
  const L = ATOM.impact;
  for (const c of [...sim.state.civics.values()].sort((a, b) => a.id - b.id)) {
    const d = DMath.hypot(c.x - im.x, c.z - im.z);
    if (d > L.level && d <= L.level * L.civicReach) damageCivic(sim, c.id, L.civicClosed, false);
  }
}

/**
 * Civic buildings inside the blast are gone (`removeCivic`: a base's units and orders go with it, a
 * plant or silo lose what they hold), the nearest `ATOM.impact.civicsPerTick` a tick from the
 * landing, because taking one away re-checks the lots round it. Says whether none is left inside.
 * What is left is read from the city each time, so it resumes from a save and is idempotent.
 */
export function impactCivics(sim: Sim, im: Impact): boolean {
  const L = ATOM.impact;
  const inside: { id: number; d: number }[] = [];
  for (const c of sim.state.civics.values()) {
    const d = DMath.hypot(c.x - im.x, c.z - im.z);
    if (d <= L.level) inside.push({ id: c.id, d });
  }
  inside.sort((a, b) => a.d - b.d || a.id - b.id);
  for (const { id } of inside.slice(0, L.civicsPerTick)) {
    const c = sim.state.civics.get(id)!;
    sim.events.push({ kind: 'civicDestroyed', id, info: { def: c.def, x: c.x, z: c.z } });
    sim.removeCivic(id);
  }
  return inside.length <= L.civicsPerTick;
}

/** Roads inside the blast close for a long while (the regional highway stays open: the city's lifeline). */
function blastRoads(sim: Sim, im: Impact): void {
  const s = sim.state;
  let changed = false;
  for (const { seg } of segmentsNear(sim, im.x, im.z, ATOM.impact.level)) {
    if (!s.net.segments.has(seg) || seg === s.highway.segment) continue;
    const had = s.roadDamage.get(seg) ?? 0;
    s.roadDamage.set(seg, Math.max(had, ATOM.impact.roadClosed));
    if (!had) changed = true;
  }
  if (changed) sim.roadsBlockedChanged();
}

/**
 * Fires round the edge of the blast, nearest first and at most `ATOM.impact.fires`: each building
 * between the blast and the fire reach a chance that falls to nothing at the reach, rolled on a die of
 * its own (the seed and its id), so the order they are met in changes nothing and no shared stream
 * moves. Idempotent: a building already burning is left alone. (Set on the tick after the landing.)
 */
export function impactFires(sim: Sim, im: Impact): void {
  const L = ATOM.impact;
  const span = L.level * (L.fireReach - 1);
  const rim: Near[] = [];
  for (const b of buildingsNear(sim, im.x, im.z, L.level * L.fireReach)) {
    const d = DMath.hypot(b.x - im.x, b.z - im.z);
    if (b.state !== BState.Rubble && d > L.level) rim.push({ b, d });
  }
  let lit = 0;
  for (const { b, d } of rim.sort(byDistance)) {
    if (lit >= L.fires) break;
    if (b.fire > 0 || b.state === BState.Construction) continue;
    const chance = L.fireChance * (1 - (d - L.level) / span);
    if (!Rng.fromSeed(`${sim.state.options.seed}:atom:${b.id}`).chance(chance)) continue;
    ignite(sim, b);
    lit++;
  }
}

/** The blast is over: the bomb is counted, the city told, and what follows it begins. */
export function impactOver(sim: Sim, a: Atom, im: Impact): void {
  im.over = true;
  a.boom++;
  sim.events.push({
    kind: 'atomImpact',
    id: 0,
    info: { x: im.x, z: im.z, fled: im.fled, levelled: im.levelled ?? 0 },
  });
  startFallout(sim, im);
  startWinter(sim, im);
  // (The chronicle line for the bomb waits for step 6's `atom` kind.)
  sim.warChanged();
}

/** The seam for step 4: the ground and the air carry the fallout from ground zero. */
function startFallout(_sim: Sim, _im: Impact): void {
  /* step 4 */
}

/** The seam for step 5: a nuclear winter begins, here, at once. */
function startWinter(_sim: Sim, _im: Impact): void {
  /* step 5 */
}
