import type { Sim } from './sim';
import { ATOM, WINTER } from '../data/atom';
import { MAP_SIZE } from '../data/world';
import { TICKS_PER_HOUR } from './time';
import { buildingCapacity } from './world/buildings';

export class InvariantError extends Error {}

/** Checked every tick in test mode (SPEC §8): finite numbers, no negatives, money balances. */
export function checkInvariants(sim: Sim): void {
  const s = sim.state;
  if (!Number.isInteger(s.tick) || s.tick < 0) throw new InvariantError(`bad tick ${s.tick}`);
  if (!Number.isFinite(s.treasury) || !Number.isInteger(s.treasury)) {
    throw new InvariantError(`treasury is not a finite integer: ${s.treasury}`);
  }
  const e = s.economy;
  const booked = Object.values(e.month).reduce((a, b) => a + b, 0);
  if (s.treasury !== e.monthStartTreasury + booked) {
    throw new InvariantError(
      `money does not balance: treasury ${s.treasury} ≠ ${e.monthStartTreasury} + ${booked}`,
    );
  }
  for (const [k, v] of Object.entries(e.month))
    if (!Number.isInteger(v)) throw new InvariantError(`ledger ${k} not an integer: ${v}`);
  for (const d of s.disasters)
    for (const k of ['x', 'z', 'size', 'start', 'end', 'heading'] as const)
      if (!Number.isFinite(d[k])) throw new InvariantError(`disaster ${d.id} ${k} = ${d[k]}`);
  // Every road has a name (P10): any way of making one has to go through `Sim.nameSegments`.
  for (const seg of s.net.segments.values())
    if (!seg.name) throw new InvariantError(`segment ${seg.id} has no name`);
  for (const [seg, h] of s.roadDamage)
    if (!(h > 0) || !s.net.segments.has(seg)) throw new InvariantError(`road damage ${seg}: ${h}`);
  for (const c of s.civics.values())
    if (!Number.isFinite(c.damage) || c.damage < 0)
      throw new InvariantError(`civic ${c.id} damage ${c.damage}`);
  for (const loan of e.loans)
    if (!Number.isFinite(loan.balance) || loan.balance < 0)
      throw new InvariantError(`loan balance ${loan.balance}`);
  for (const b of s.buildings.values()) {
    for (const k of [
      'pop',
      'cap',
      'employed',
      'seekers',
      'commute',
      'shop',
      'happiness',
      'distress',
      'x',
      'z',
      'y',
      'progress',
      'flooded',
      'sick',
      'treated',
      'edu',
    ] as const) {
      const v = b[k];
      if (!Number.isFinite(v)) throw new InvariantError(`building ${b.id} ${k} is ${v}`);
      if (k !== 'y' && v < 0) throw new InvariantError(`building ${b.id} ${k} is negative: ${v}`);
    }
    if (b.x < 0 || b.z < 0 || b.x > MAP_SIZE || b.z > MAP_SIZE)
      throw new InvariantError(`building ${b.id} outside the map`);
    if (b.zone === 1 && b.pop > Math.max(b.cap, buildingCapacity(b)))
      throw new InvariantError(`building ${b.id} over capacity`);
    if (b.employed > Math.max(b.pop, b.seekers))
      throw new InvariantError(`building ${b.id} employs more than live there`);
    if (!s.net.blocks.has(b.block)) throw new InvariantError(`building ${b.id} has no lot`);
    if (b.sick > b.pop + 1e-6) throw new InvariantError(`building ${b.id} has more sick than residents`);
    if (b.edu > 3 || b.treated > 1) throw new InvariantError(`building ${b.id} edu/treated out of range`);
  }
  const t = s.totals;
  for (const [k, v] of Object.entries(t)) {
    if (typeof v === 'number' && (!Number.isFinite(v) || v < 0))
      throw new InvariantError(`totals.${k} = ${v}`);
  }
  for (const k of ['R', 'C', 'I'] as const) {
    const v = s.demand[k];
    if (!Number.isFinite(v) || v < -1 || v > 1) throw new InvariantError(`demand ${k} = ${v}`);
  }
  checkAtom(sim);
  checkFallout(sim);
  checkWinters(sim);
}

/** Nuclear winters (M40): each has a name of its own, a start in the past and a depth in range. */
function checkWinters(sim: Sim): void {
  const list = sim.state.weather.winters;
  if (!list) return;
  const seen = new Set<string>();
  for (const e of list) {
    if (!e.id || seen.has(e.id))
      throw new InvariantError(`nuclear winter ${e.id || '(no id)'} twice or nameless`);
    seen.add(e.id);
    if (!Number.isInteger(e.from) || e.from < 0 || e.from > sim.state.tick)
      throw new InvariantError(`nuclear winter ${e.id} began at ${e.from}`);
    if (!Number.isFinite(e.depth) || e.depth <= 0 || e.depth > WINTER.cap)
      throw new InvariantError(`nuclear winter ${e.id} depth ${e.depth}`);
  }
}

/** Fallout (M40): finite rasters, the ground in [0, 1], the air not negative, the counters not negative. */
function checkFallout(sim: Sim): void {
  const f = sim.state.fallout;
  if (!f) return;
  // (The rasters are scanned once an hour, not every tick: they change only at an update or a strike.)
  if (sim.state.tick % TICKS_PER_HOUR === 0)
    for (let k = 0; k < f.ground.length; k++) {
      const g = f.ground[k]!;
      if (!Number.isFinite(g) || g < 0 || g > 1) throw new InvariantError(`fallout ground[${k}] = ${g}`);
      const a = f.air[k]!;
      if (!Number.isFinite(a) || a < 0 || a > 1) throw new InvariantError(`fallout air[${k}] = ${a}`);
    }
  for (const side of ['north', 'south', 'west'] as const)
    if (!Number.isFinite(f.out[side]) || f.out[side] < 0) throw new InvariantError(`fallout out.${side}`);
  for (const j of f.jobs)
    if (![j.x, j.z, j.left].every(Number.isFinite) || j.left <= 0)
      throw new InvariantError(`fallout clean-up job ${j.x},${j.z}: ${j.left}`);
}

/** The race for the atom bomb (M40): finite facts in range, one bomb, a flight with somewhere to go. */
function checkAtom(sim: Sim): void {
  const a = sim.state.war?.atom;
  if (!a) return;
  const within = (what: string, v: number, max: number) => {
    if (!Number.isFinite(v) || v < 0 || v > max) throw new InvariantError(`atom ${what} = ${v}`);
  };
  within('fuel', a.fuel, ATOM.fuel.hours);
  within('boom', a.boom, Infinity);
  within('stopped', a.stopped, Infinity);
  if (a.bomb) {
    within('bomb done', a.bomb.done, ATOM.bomb.hours);
    within('bomb paid', a.bomb.paid, ATOM.bomb.hours / ATOM.bomb.every);
  }
  if (a.prep) {
    within('prep done', a.prep.done, ATOM.launch.prepHours);
    if (!Number.isFinite(a.prep.to)) throw new InvariantError('atom launch without a target');
  }
  // One bomb: being built, or finished and then prepared, or gone; never two of these at once.
  if (a.bomb && (a.have || a.prep || a.fired)) throw new InvariantError('atom bomb built twice');
  if (a.prep && !a.have) throw new InvariantError('atom launch prepared without a bomb');
  if (a.fired && (a.have || a.prep)) throw new InvariantError('atom bomb fired and still held');
  if (a.fired && !(Number.isFinite(a.fired.tick) && Number.isFinite(a.fired.to) && a.fired.name))
    throw new InvariantError('atom flight without a target');
  const hit = a.inbound;
  if (hit && ![hit.warn, hit.arrive, hit.x, hit.z].every(Number.isFinite))
    throw new InvariantError('atom flight without a landing');
  const im = a.impact;
  if (im && ![im.done, im.fled, im.x, im.z].every(Number.isFinite))
    throw new InvariantError('atom impact is not finite');
}
