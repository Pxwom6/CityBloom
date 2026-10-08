import { LEGACY_STEMS, STREET_SUFFIX } from '../../data/streetNames';
import { Network, type RoadNode, type RoadSegment } from './network';
import { nameHash, namesSeed, straightPairs } from './streetNames';

/**
 * The names cities got before save v24 (P10), for the v23 to v24 migration. Until then the client
 * worked a street's name out from the network every time it changed: segments that carry straight
 * on through a junction (`straightPairs`) are one street, named from the lowest segment id in it.
 * A loaded city keeps the names its player has seen, so this reproduces that exactly; do not
 * "improve" it, and never reorder or extend LEGACY_STEMS or STREET_SUFFIX.
 */
export function legacyStreetNames(
  nodes: Map<number, RoadNode>,
  segments: Map<number, RoadSegment>,
  optionsSeed: string,
): Map<number, string> {
  const net = new Network({ nodes, segments, blocks: new Map() }, null, null);
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
  for (const id of segments.keys()) parent.set(id, id);
  for (const node of nodes.values()) for (const [a, b] of straightPairs(net, node.id)) union(a, b);

  const seed = namesSeed(optionsSeed);
  const names = new Map<number, string>();
  for (const id of segments.keys()) {
    const root = find(id);
    const type = segments.get(root)?.type ?? segments.get(id)!.type;
    if (type === 'highway') {
      names.set(id, STREET_SUFFIX.highway[0]!);
      continue;
    }
    const first = LEGACY_STEMS[Math.floor(nameHash(seed, root) * LEGACY_STEMS.length)]!;
    const suf = STREET_SUFFIX[type];
    names.set(id, `${first} ${suf[Math.floor(nameHash(seed, root * 31 + 7) * suf.length)]!}`);
  }
  return names;
}
