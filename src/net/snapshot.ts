/**
 * Room snapshots on the wire (M30): the settled city, every player's undo history and where the
 * events stand, as gzipped JSON in base64 parts small enough for any transport.
 */
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import type { SharedSnapshot } from '../sim/protocol';
import type { BattleInput } from '../sim/battle/types';
import { base64ToBytes, bytesToBase64 } from '../sim/serialize';
import { MAX_SNAPSHOT_PARTS, SNAPSHOT_PART, type SnapshotMeta } from '../../relay/protocol';

/** Why a city can't be shared: rooms and regions take snapshots of at most `MAX_SNAPSHOT_PARTS` (F8). */
export const SNAPSHOT_TOO_BIG = 'This city is too big to share: its snapshot would pass 8 MB';

/** Throws `SNAPSHOT_TOO_BIG` for a city whose snapshot every room and region would refuse. */
export function encodeSnapshot(s: SharedSnapshot, id: string): { meta: SnapshotMeta; parts: string[] } {
  const b64 = bytesToBase64(gzipSync(strToU8(JSON.stringify(s)), { level: 6 }));
  if (b64.length > MAX_SNAPSHOT_PARTS * SNAPSHOT_PART) throw new Error(SNAPSHOT_TOO_BIG);
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

/** A battle's input on the wire (M35): gzipped JSON in base64 parts, as snapshots are. */
export function encodeBattle(input: BattleInput): string[] {
  const b64 = bytesToBase64(gzipSync(strToU8(JSON.stringify(input)), { level: 6 }));
  const parts: string[] = [];
  for (let i = 0; i < b64.length; i += SNAPSHOT_PART) parts.push(b64.slice(i, i + SNAPSHOT_PART));
  return parts.length ? parts : [''];
}

export function decodeBattle(parts: string[]): BattleInput {
  return JSON.parse(strFromU8(gunzipSync(base64ToBytes(parts.join(''))))) as BattleInput;
}
