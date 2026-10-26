/**
 * Room snapshots on the wire (M30): the settled city, every player's undo history and where the
 * events stand, as gzipped JSON in base64 parts small enough for any transport.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { SharedSnapshot } from '../sim/protocol';
import { base64ToBytes, bytesToBase64 } from '../sim/serialize';
import { SNAPSHOT_PART, type SnapshotMeta } from '../../relay/protocol';

export function encodeSnapshot(s: SharedSnapshot, id: string): { meta: SnapshotMeta; parts: string[] } {
  const b64 = bytesToBase64(gzipSync(strToU8(JSON.stringify(s)), { level: 6 }));
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += SNAPSHOT_PART) parts.push(b64.slice(i, i + SNAPSHOT_PART));
  if (!parts.length) parts.push('');
  const meta: SnapshotMeta = {
    id,
    tick: s.save.meta.tick,
    seq: s.seq,
    eventHash: s.eventHash,
    parts: parts.length,
    cityName: s.save.meta.cityName,
    population: s.save.meta.population,
  };
  return { meta, parts };
}

export function decodeSnapshot(parts: string[]): SharedSnapshot {
  return JSON.parse(strFromU8(gunzipSync(base64ToBytes(parts.join(''))))) as SharedSnapshot;
}

/** Collects a snapshot's parts as they arrive; `add` returns the whole snapshot once complete. */
export class SnapshotAssembler {
  private parts = new Map<string, (string | null)[]>();
  add(meta: SnapshotMeta, part: number, data: string): string[] | null {
    let list = this.parts.get(meta.id);
    if (!list) this.parts.set(meta.id, (list = new Array<string | null>(meta.parts).fill(null)));
    list[part] = data;
    if (list.some((x) => x === null)) return null;
    this.parts.delete(meta.id);
    return list as string[];
  }
}
