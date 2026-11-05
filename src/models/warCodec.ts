import type { BakedModel, BakedUnit } from './baked';
import {
  decodeIndex,
  decodeModels,
  decodePositions,
  encodeIndex,
  encodeModels,
  encodePositions,
} from './codec';

/**
 * The war models file (phase 5): fetched only in a city with war on, never with the main models
 * file. It holds the war buildings exactly as the main file holds buildings (a whole models file,
 * codec.ts), then the units packed the same way: a JSON index and their arrays end to end, kind by
 * kind, vertices 16-bit and both they and the indices as differences, which gzip packs tightly.
 *
 *   "CBW1", version, bytes of the buildings' models file, bytes of the units' section,
 *   the buildings' models file, the units' section ("CBU1", JSON length, JSON, arrays).
 */
const MAGIC = 0x31574243; // "CBW1"
const UNITS_MAGIC = 0x31554243; // "CBU1"
const VERSION = 1;

/** The arrays of a unit, in the order the units' section holds them. */
const KINDS = ['positions', 'index', 'triRole', 'triPart', 'triFar'] as const;
type Kind = (typeof KINDS)[number];

interface UnitEntry {
  meta: Omit<BakedUnit, Kind>;
  /** Metres per unit of the 16-bit vertices. */
  scale: number;
  wide: boolean;
  /** Byte offset and element count of each array. */
  at: Record<Kind, [number, number]>;
}

/** Where each array lands after the index (each starts on 4 bytes), and the bytes they take. */
function layout(arrays: ArrayBufferView[]): { at: number[]; size: number } {
  const at: number[] = [];
  let size = 0;
  for (const a of arrays) {
    at.push(size);
    size += a.byteLength + ((4 - (a.byteLength % 4)) % 4);
  }
  return { at, size };
}

/** A JSON index, then the arrays as `layout` places them, behind a magic number and the index's length. */
function pack(magic: number, index: unknown, arrays: ArrayBufferView[]): Uint8Array {
  const { at, size } = layout(arrays);
  let json = new TextEncoder().encode(JSON.stringify(index));
  if (json.length % 4) {
    const padded = new Uint8Array(json.length + 4 - (json.length % 4)).fill(0x20);
    padded.set(json);
    json = padded;
  }
  const out = new Uint8Array(8 + json.length + size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, magic, true);
  dv.setUint32(4, json.length, true);
  out.set(json, 8);
  arrays.forEach((a, i) =>
    out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), 8 + json.length + at[i]!),
  );
  return out;
}

export function encodeUnits(units: BakedUnit[]): Uint8Array {
  const packed = units.map((u) => {
    let max = 1e-6;
    for (const v of u.positions) max = Math.max(max, Math.abs(v));
    if (!Number.isFinite(max)) throw new Error(`${u.id}: a coordinate that isn't a number`);
    const scale = max / 32767;
    const q = new Int16Array(u.positions.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(u.positions[i]! / scale);
    const wide = u.positions.length / 3 > 65535;
    const { positions, index, triRole, triPart, triFar, ...meta } = u;
    void positions;
    const arrays: Record<Kind, ArrayBufferView> = {
      positions: encodePositions(q),
      index: encodeIndex(index, wide),
      triRole,
      triPart,
      triFar,
    };
    const counts = {
      positions: q.length,
      index: index.length,
      triRole: triRole.length,
      triPart: triPart.length,
      triFar: triFar.length,
    };
    return { meta, scale, wide, arrays, counts };
  });
  // Kind by kind, so like numbers sit together for gzip.
  const order: { unit: number; kind: Kind }[] = [];
  for (const kind of KINDS) packed.forEach((_, unit) => order.push({ unit, kind }));
  const arrays = order.map(({ unit, kind }) => packed[unit]!.arrays[kind]);
  const { at } = layout(arrays);
  const entries: UnitEntry[] = packed.map((p) => ({
    meta: p.meta,
    scale: p.scale,
    wide: p.wide,
    at: {} as UnitEntry['at'],
  }));
  order.forEach(({ unit, kind }, i) => {
    entries[unit]!.at[kind] = [at[i]!, packed[unit]!.counts[kind]];
  });
  return pack(UNITS_MAGIC, { version: VERSION, units: entries }, arrays);
}

export function decodeUnits(bytes: Uint8Array): BakedUnit[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || dv.getUint32(0, true) !== UNITS_MAGIC)
    throw new Error('not a Citybloom units section');
  const jsonLen = dv.getUint32(4, true);
  const index = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jsonLen))) as {
    version: number;
    units: UnitEntry[];
  };
  if (index.version !== VERSION) throw new Error(`units section version ${index.version}`);
  const base = bytes.byteOffset + 8 + jsonLen;
  const end = bytes.byteOffset + bytes.byteLength;
  const copy = (at: [number, number], bytesPer: number) => {
    const from = base + at[0];
    const to = from + at[1] * bytesPer;
    if (!(at[0] >= 0 && at[1] >= 0 && to <= end)) throw new Error('units section is cut short');
    return bytes.buffer.slice(from, to) as ArrayBuffer;
  };
  return index.units.map((e) => ({
    ...e.meta,
    positions: decodePositions(new Uint16Array(copy(e.at.positions, 2)), e.scale),
    index: e.wide
      ? decodeIndex(new Uint32Array(copy(e.at.index, 4)), true)
      : decodeIndex(new Uint16Array(copy(e.at.index, 2)), false),
    triRole: new Uint8Array(copy(e.at.triRole, 1)),
    triPart: new Uint8Array(copy(e.at.triPart, 1)),
    triFar: new Uint8Array(copy(e.at.triFar, 1)),
  }));
}

/** The war models file: the war buildings (a models file of their own) and the units. */
export function encodeWarModels(models: BakedModel[], units: BakedUnit[]): Uint8Array {
  const a = encodeModels(models);
  const b = encodeUnits(units);
  const out = new Uint8Array(16 + a.length + b.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, VERSION, true);
  dv.setUint32(8, a.length, true);
  dv.setUint32(12, b.length, true);
  out.set(a, 16);
  out.set(b, 16 + a.length);
  return out;
}

export function decodeWarModels(bytes: Uint8Array): { models: BakedModel[]; units: BakedUnit[] } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 16 || dv.getUint32(0, true) !== MAGIC)
    throw new Error('not a Citybloom war models file');
  const version = dv.getUint32(4, true);
  if (version !== VERSION) throw new Error(`war models file version ${version}`);
  const a = dv.getUint32(8, true);
  const b = dv.getUint32(12, true);
  if (16 + a + b > bytes.byteLength) throw new Error('war models file is cut short');
  return {
    models: decodeModels(bytes.subarray(16, 16 + a)),
    units: decodeUnits(bytes.subarray(16 + a, 16 + a + b)),
  };
}
