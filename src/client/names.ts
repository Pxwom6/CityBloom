import type { ClientWorld } from './world';
import type { RoadTypeId } from '../data/roads';
import { angleDiff, angleOf } from '../sim/geom';
import { seedFromString } from '../sim/rng';

/** Original name parts: nature, crafts and places (no real people or brands). */
const FIRST = [
  'Maple',
  'Birch',
  'Willow',
  'Cedar',
  'Juniper',
  'Linden',
  'Hazel',
  'Rowan',
  'Alder',
  'Aspen',
  'Orchard',
  'Meadow',
  'Harbour',
  'Mill',
  'Chapel',
  'Station',
  'Market',
  'Garden',
  'Foundry',
  'Kiln',
  'Lark',
  'Heron',
  'Wren',
  'Finch',
  'Otter',
  'Badger',
  'Fox',
  'Hawthorn',
  'Bramble',
  'Clover',
  'Copper',
  'Silver',
  'Amber',
  'Flint',
  'Quarry',
  'Ferry',
  'Lantern',
  'Beacon',
  'Tannery',
  'Weaver',
  'Baker',
  'Cooper',
  'Mason',
  'Thatcher',
  'Orchid',
  'Poppy',
  'Sorrel',
  'Tansy',
  'Primrose',
  'Thistle',
  'Brook',
  'Pond',
  'Spring',
  'Fern',
  'Moss',
  'Ivy',
  'Laurel',
  'Holly',
  'Elm',
  'Oak',
];
const SUFFIX: Record<RoadTypeId, string[]> = {
  dirt: ['Lane', 'Track', 'Path'],
  street: ['Street', 'Road', 'Way', 'Close', 'Row', 'Terrace'],
  avenue: ['Avenue', 'Parade'],
  boulevard: ['Boulevard'],
  motorway: ['Expressway', 'Bypass', 'Freeway'],
  ramp: ['Ramp'],
  highway: ['Regional Highway'],
};
const HOODS = [
  'Old Town',
  'Northgate',
  'Millbrook',
  'Eastfield',
  'Hillcrest',
  'Southmead',
  'Westbury',
  'Fairview',
  'Ashford',
  'Greenhollow',
  'Kingsbridge',
  'Brookside',
  'Lindenhurst',
  'Oakridge',
  'Stonebridge',
  'Harbourside',
  'Meadowvale',
  'Copperfield',
  'Rosewood',
  'Foxhill',
  'Larkspur',
  'Willowmere',
];

function hash(seed: number, n: number): number {
  let h = Math.imul(seed ^ n, 2654435761) ^ (n >>> 13);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Street names: segments that carry straight on through a junction form one street; each street
 * is named from the lowest segment id in it, so names stay put as the city grows. Neighbourhoods
 * are named per 384 m cell.
 */
export class StreetNames {
  private seed: number;
  private names = new Map<number, string>();
  private version = -1;

  constructor(private world: ClientWorld) {
    this.seed = seedFromString(`${world.options.seed}:names`)[0];
  }

  private rebuild(): void {
    const w = this.world;
    const net = w.net;
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let c = x;
      while (parent.get(c) !== r) {
        const n = parent.get(c)!;
        parent.set(c, r);
        c = n;
      }
      return r;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    };
    for (const id of w.netState.segments.keys()) parent.set(id, id);
    for (const node of w.netState.nodes.values()) {
      const segs = net.segmentsAt(node.id);
      if (segs.length < 2) continue;
      const dirs = segs.map((sid) => ({
        sid,
        a: angleOf(net.directionAt(sid, node.id)),
        t: net.segment(sid).type,
      }));
      // Pair the most opposite segments of the same type (carrying straight on).
      const used = new Set<number>();
      const pairs: { a: number; b: number; d: number }[] = [];
      for (let i = 0; i < dirs.length; i++)
        for (let j = i + 1; j < dirs.length; j++) {
          if (dirs[i]!.t !== dirs[j]!.t) continue;
          const d = angleDiff(dirs[i]!.a, dirs[j]!.a);
          if (d > (150 * Math.PI) / 180) pairs.push({ a: dirs[i]!.sid, b: dirs[j]!.sid, d });
        }
      pairs.sort((p, q) => q.d - p.d);
      for (const p of pairs) {
        if (used.has(p.a) || used.has(p.b)) continue;
        used.add(p.a);
        used.add(p.b);
        union(p.a, p.b);
      }
    }
    this.names.clear();
    for (const id of w.netState.segments.keys()) {
      const root = find(id);
      const type = w.netState.segments.get(root)?.type ?? w.netState.segments.get(id)!.type;
      if (type === 'highway') {
        this.names.set(id, 'Regional Highway');
        continue;
      }
      const first = FIRST[Math.floor(hash(this.seed, root) * FIRST.length)]!;
      const suf = SUFFIX[type];
      this.names.set(id, `${first} ${suf[Math.floor(hash(this.seed, root * 31 + 7) * suf.length)]!}`);
    }
  }

  street(segId: number): string {
    if (this.version !== this.world.netVersion) {
      this.version = this.world.netVersion;
      this.rebuild();
    }
    return this.names.get(segId) ?? 'an unnamed road';
  }

  neighbourhood(x: number, z: number): string {
    const i = Math.floor(x / 384);
    const j = Math.floor(z / 384);
    return HOODS[Math.floor(hash(this.seed, i * 131 + j * 7919 + 17) * HOODS.length)]!;
  }

  /** "Maple Street, Northgate" for a point near a road. */
  address(x: number, z: number): string {
    const hit = this.world.net.nearestSegment({ x, z }, 60);
    const hood = this.neighbourhood(x, z);
    return hit ? `${this.street(hit.seg)}, ${hood}` : hood;
  }
}
