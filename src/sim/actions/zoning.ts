import { ZONE_LETTERS, ZONE_NONE, type ZoneCode, type ZoneLetter } from '../../data/zones';
import { fail, ok, type CommandResult, type ZoneArea } from '../commands';
import type { Sim } from '../sim';
import { cellKey, keyBlock, keyIdx } from '../world/network';

/**
 * Paint zoning onto cells. Only valid, empty cells change: buildings keep their cells until they
 * are bulldozed (logged in docs/DECISIONS.md).
 */
export function zone(sim: Sim, letter: ZoneLetter | 'none', area: ZoneArea, dryRun: boolean): CommandResult {
  const code: ZoneCode = letter === 'none' ? ZONE_NONE : ZONE_LETTERS[letter];
  if (code === undefined) return fail('Unknown zone');
  let keys: number[];
  if (area.kind === 'brush') {
    if (!area.points.length || !(area.radius > 0) || area.radius > 200) return fail('Invalid brush');
    keys = sim.net.cellsNearPath(area.points, area.radius);
  } else {
    const seg = sim.state.net.segments.get(area.id);
    if (!seg) return fail('No road there');
    keys = [];
    for (const bid of [seg.left, seg.right]) {
      const b = bid ? sim.state.net.blocks.get(bid) : undefined;
      if (b) for (let i = 0; i < b.zone.length; i++) keys.push(cellKey(b.id, i));
    }
  }
  const changes: [number, number, number][] = [];
  for (const k of keys) {
    const b = sim.state.net.blocks.get(keyBlock(k))!;
    const i = keyIdx(k);
    if (!b.valid[i] || b.bld[i] || b.zone[i] === code) continue;
    changes.push([b.id, i, b.zone[i]!]);
  }
  if (!dryRun && changes.length) {
    for (const [bid, i] of changes) {
      const b = sim.state.net.blocks.get(bid)!;
      b.zone[i] = code;
      sim.net.dirty.blocks.add(bid);
    }
  }
  return ok(0, { info: { cells: changes.length } });
}
