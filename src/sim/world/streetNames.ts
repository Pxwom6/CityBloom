import type { RoadTypeId } from '../../data/roads';
import { STREET_STEMS, STREET_SUFFIX } from '../../data/streetNames';
import { angleDiff, angleOf } from '../geom';
import { seedFromString } from '../rng';
import type { Network } from './network';

/**
 * Street names (P10). A street is the set of segments that share a `name`. A segment is named once,
 * when it is made (`nameSegments`): it takes the name of the road it carries straight on from, or a
 * fresh one. A split copies the name to both halves, and a change of road type swaps the suffix
 * (`restyleName`). Nothing else changes a name, so a street keeps its name as the city grows, and
 * undo needs no code of its own: the name is part of the segment.
 */

/** A small stable hash of (seed, n) in [0, 1), as the client's names always used. */
export function nameHash(seed: number, n: number): number {
  let h = Math.imul(seed ^ n, 2654435761) ^ (n >>> 13);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** The seed street and neighbourhood names are drawn from, for a city's `options.seed`. */
export function namesSeed(optionsSeed: string): number {
  return seedFromString(`${optionsSeed}:names`)[0]!;
}

/** Two segments carry straight on through a junction when they are of one type and nearly opposite. */
const STRAIGHT_ON = (150 * Math.PI) / 180;

type Geometry = Pick<Network, 'segmentsAt' | 'directionAt' | 'segment'>;

/**
 * The pairs of segments that carry straight on through a node: the most opposite same-type pairs,
 * widest first, each segment in at most one pair. (Cities before save v24 derived every name from
 * these pairs, so the v23 migration needs this to give the same answer as it always did.)
 */
export function straightPairs(net: Geometry, nodeId: number): [number, number][] {
  const segs = net.segmentsAt(nodeId);
  if (segs.length < 2) return [];
  const dirs = segs.map((sid) => ({
    sid,
    a: angleOf(net.directionAt(sid, nodeId)),
    t: net.segment(sid).type,
  }));
  const used = new Set<number>();
  const pairs: { a: number; b: number; d: number }[] = [];
  for (let i = 0; i < dirs.length; i++)
    for (let j = i + 1; j < dirs.length; j++) {
      if (dirs[i]!.t !== dirs[j]!.t) continue;
      const d = angleDiff(dirs[i]!.a, dirs[j]!.a);
      if (d > STRAIGHT_ON) pairs.push({ a: dirs[i]!.sid, b: dirs[j]!.sid, d });
    }
  pairs.sort((p, q) => q.d - p.d);
  const out: [number, number][] = [];
  for (const p of pairs) {
    if (used.has(p.a) || used.has(p.b)) continue;
    used.add(p.a);
    used.add(p.b);
    out.push([p.a, p.b]);
  }
  return out;
}

/** The stem of a name (every stem is one word). */
export const stemOf = (name: string): string => name.split(' ')[0]!;

/** Names in use: whole names, and how many distinct names each stem is in. */
interface InUse {
  names: Set<string>;
  stems: Map<string, number>;
}

function inUse(net: Network): InUse {
  const names = new Set<string>();
  for (const seg of net.st.segments.values()) if (seg.name) names.add(seg.name);
  const stems = new Map<string, number>();
  for (const name of names) stems.set(stemOf(name), (stems.get(stemOf(name)) ?? 0) + 1);
  return { names, stems };
}

/**
 * A name for a new street: from a spot picked by (seed, segment id), the first stem no street uses
 * yet, then (once all are used) the least-used ones; a suffix of the road's type that makes the
 * whole name new. Only the seed, the id and the network decide it, so replays agree.
 */
function freshName(seed: number, id: number, type: RoadTypeId, used: InUse): string {
  const n = STREET_STEMS.length;
  const suffixes = STREET_SUFFIX[type];
  const s0 = Math.floor(nameHash(seed, id) * n);
  const x0 = Math.floor(nameHash(seed, id * 31 + 7) * suffixes.length);
  for (let level = 0; level < 8; level++)
    for (let k = 0; k < n; k++) {
      const stem = STREET_STEMS[(s0 + k) % n]!;
      if ((used.stems.get(stem) ?? 0) > level) continue;
      for (let j = 0; j < suffixes.length; j++) {
        const name = `${stem} ${suffixes[(x0 + j) % suffixes.length]!}`;
        if (!used.names.has(name)) return name;
      }
    }
  // Hundreds of streets on every stem: number it.
  return `${STREET_STEMS[s0]!} ${suffixes[x0]!} ${used.names.size}`;
}

/**
 * Name the segments `ids` that have no name yet, in id order (so the pieces of one road, made in
 * order, pass their name along). A segment carrying straight on from a named one takes its name,
 * looking first at its `a` end (where a road was started) and then at its `b` end; otherwise it
 * gets a fresh name that avoids the stems in use. The regional highway has a fixed name.
 */
export function nameSegments(net: Network, seed: number, ids: readonly number[]): void {
  let used: InUse | null = null;
  for (const id of [...ids].sort((a, b) => a - b)) {
    const seg = net.st.segments.get(id);
    if (!seg || seg.name !== undefined) continue;
    let name: string | undefined;
    if (seg.type === 'highway') name = STREET_SUFFIX.highway[0];
    else
      for (const node of [seg.a, seg.b]) {
        const pair = straightPairs(net, node).find(([p, q]) => p === id || q === id);
        if (!pair) continue;
        name = net.st.segments.get(pair[0] === id ? pair[1] : pair[0])?.name;
        if (name) break;
      }
    if (!name) {
      used ??= inUse(net);
      name = freshName(seed, id, seg.type, used);
    }
    seg.name = name;
    net.dirty.segments.add(id);
    if (used && !used.names.has(name)) {
      used.names.add(name);
      used.stems.set(stemOf(name), (used.stems.get(stemOf(name)) ?? 0) + 1);
    }
  }
}

/**
 * The name of a street whose road type changes: the stem stays and the suffix moves to the same
 * place in the new type's list, so Maple Terrace becomes Maple Parade. Every segment of a street
 * gets the same answer, so a street upgraded piece by piece ends up with one name.
 */
export function restyleName(name: string, from: RoadTypeId, to: RoadTypeId): string {
  const stem = stemOf(name);
  const i = STREET_SUFFIX[from].indexOf(name.slice(stem.length + 1));
  if (i < 0 || from === to) return name;
  const suffixes = STREET_SUFFIX[to];
  return `${stem} ${suffixes[i % suffixes.length]!}`;
}
