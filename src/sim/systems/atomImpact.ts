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
 * the middle of an impact carries on exactly. Fallout (`fallout.ts`) and the nuclear winter
 * (`startWinter`, `weather.ts`), which follow the last slice, are the two calls at the bottom.
 */
import { ATOM } from '../../data/atom';
import { MAP_SIZE } from '../../data/world';
import { ZONE_R } from '../../data/zones';
import { DMath } from '../dmath';
import { Rng } from '../rng';
import type { Sim } from '../sim';
import { BState } from '../world/buildings';
import type { Building } from '../world/buildings';
import { civicDef, civicRect } from '../world/civic';
import type { Civic } from '../world/civic';
import type { Atom } from './atom';
import { buildingsNear, clearTrees, segmentsNear } from './disasters';
import { depositFallout } from './fallout';
import { ignite, toRubble } from './incidents';
import { damageCivic } from './raids';
import { startWinter } from './weather';

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
  forgetIncidents(sim, new Set(batch.map((x) => x.b.id)));
  im.levelled = (im.levelled ?? 0) + batch.length;
  im.done++;
  sim.warChanged();
  return standing.length <= L.slice;
}

/**
 * Calls for help at buildings that have just fallen are called off: an emergency or a crime open on
 * a home the blast levelled would otherwise run out its clock on the rubble and write a patient lost
 * (`incidentsTick` does not look at what stands), or have an ambulance arrive and save one. The
 * blast has no patients; the vehicles on their way are let go (as a missed call lets them).
 */
function forgetIncidents(sim: Sim, levelled: Set<number>): void {
  const s = sim.state;
  if (!s.incidents.size) return;
  for (const inc of [...s.incidents.values()]) {
    if (!levelled.has(inc.building)) continue;
    s.incidents.delete(inc.id);
    const v = inc.responder ? s.vehicles.get(inc.responder) : undefined;
    if (v && v.ref === inc.id) v.ref = 0;
  }
}

/**
 * Civic buildings the blast closes but does not take: the regional rail link's junction (a
 * bulldozer is refused it, and the city could never put it back: the rail link is placed once) and
 * Sunfield Commons (the region's great work, built once for good; a city that loses it still gets its
 * share). They stand, closed for as long as the roads inside the blast are.
 */
function endures(c: Civic): boolean {
  const def = civicDef(c);
  return !!(def.railLink || def.regionProject);
}

/**
 * Civic buildings out to 1.5 times the blast close for a while (the war's own damage, so Repair
 * crews shorten it), and those inside it that the blast leaves standing (`endures`) close like the
 * roads there.
 */
function closeCivics(sim: Sim, im: Impact): void {
  const L = ATOM.impact;
  for (const c of [...sim.state.civics.values()].sort((a, b) => a.id - b.id)) {
    const d = DMath.hypot(c.x - im.x, c.z - im.z);
    if (d > L.level && d <= L.level * L.civicReach) damageCivic(sim, c.id, L.civicClosed, false);
    else if (d <= L.level && endures(c)) damageCivic(sim, c.id, L.roadClosed, false);
  }
}

/**
 * The lots round a civic building that taking it away re-checks (`Sim.removeCivic`'s box), counted:
 * what the work costs, near enough, whatever the building is. Deterministic and cheap (a hash query).
 */
function civicWork(sim: Sim, c: Civic): number {
  const r = civicRect(c);
  const pad = DMath.hypot(r.hw, r.hd) + 40;
  return sim.net.cellHash.query({ minX: c.x - pad, minZ: c.z - pad, maxX: c.x + pad, maxZ: c.z + pad })
    .length;
}

/**
 * Civic buildings inside the blast are gone (`removeCivic`: a base's units and orders go with it, a
 * plant or silo lose what they hold), the nearest first and a few a tick from the landing: at most
 * `ATOM.impact.civicsPerTick`, and no more once the lots round those taken come to
 * `ATOM.impact.civicCells` (a nuclear plant alone is about that), because taking one away re-checks
 * the lots round it and some cost many times another. At least one a tick. The rail link and the
 * region's great work are left (`endures`). Says whether none is left inside. What is left is read
 * from the city each time, so it resumes from a save and is idempotent.
 */
export function impactCivics(sim: Sim, im: Impact): boolean {
  const L = ATOM.impact;
  const inside: { c: Civic; d: number }[] = [];
  for (const c of sim.state.civics.values()) {
    const d = DMath.hypot(c.x - im.x, c.z - im.z);
    if (d <= L.level && !endures(c)) inside.push({ c, d });
  }
  inside.sort((a, b) => a.d - b.d || a.c.id - b.c.id);
  let work = 0;
  let taken = 0;
  for (const { c } of inside) {
    if (taken >= L.civicsPerTick) break;
    const cost = civicWork(sim, c);
    if (taken > 0 && work + cost > L.civicCells) break;
    work += cost;
    taken++;
    sim.events.push({ kind: 'civicDestroyed', id: c.id, info: { def: c.def, x: c.x, z: c.z } });
    sim.removeCivic(c.id);
  }
  return inside.length <= taken;
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
 * Fires round the edge of the blast, nearest first, at most `ATOM.impact.fires` in all and
 * `ATOM.impact.firesPerTick` on each tick (the rest on the next ones, from where the last stopped:
 * `im.fireAfter`, so a building put out or burnt down in between is not lit again): each building
 * between the blast and the fire reach a chance that falls to nothing at the reach, rolled on a die of
 * its own (the seed and its id), so the order they are met in changes nothing and no shared stream
 * moves. A building already burning is left alone. Set from the tick after the landing. Says whether
 * the last of them is set.
 */
export function impactFires(sim: Sim, im: Impact): boolean {
  const L = ATOM.impact;
  const span = L.level * (L.fireReach - 1);
  const rim: Near[] = [];
  for (const b of buildingsNear(sim, im.x, im.z, L.level * L.fireReach)) {
    const d = DMath.hypot(b.x - im.x, b.z - im.z);
    if (b.state !== BState.Rubble && d > L.level) rim.push({ b, d });
  }
  rim.sort(byDistance);
  const from = im.fireAfter;
  let lit = 0;
  for (const { b, d } of rim) {
    // (Past the last one reached: nearer, or as near and with a lower id, is behind us.)
    if (from && (d < from.d || (d === from.d && b.id <= from.id))) continue;
    if ((im.lit ?? 0) >= L.fires) break;
    if (lit >= L.firesPerTick) return false;
    im.fireAfter = { d, id: b.id };
    if (b.fire > 0 || b.state === BState.Construction) continue;
    const chance = L.fireChance * (1 - (d - L.level) / span);
    if (!Rng.fromSeed(`${sim.state.options.seed}:atom:${b.id}`).chance(chance)) continue;
    ignite(sim, b);
    lit++;
    im.lit = (im.lit ?? 0) + 1;
  }
  return true;
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
  // The winter is named for the bomb (this city's `boom`th), so a repeat of this call changes nothing.
  startWinter(sim, `self:${a.boom}`);
  // (The chronicle line for the bomb waits for step 6's `atom` kind.)
  sim.warChanged();
}

/** The ground and the air carry the fallout from ground zero (`fallout.ts`). */
function startFallout(sim: Sim, im: Impact): void {
  depositFallout(sim, im.x, im.z);
}
