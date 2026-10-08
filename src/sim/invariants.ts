import type { Sim } from './sim';
import { MAP_SIZE } from '../data/world';
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
}
