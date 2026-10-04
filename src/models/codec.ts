import type { BakedModel } from './baked';

/**
 * The file the game fetches its hand-made models from: a small header, a JSON index, then the
 * models' arrays packed end to end, each kind together (every model's vertices, then every
 * model's indices, …). Vertices are 16-bit (a model's largest coordinate maps to 32767, so a 150 m
 * airport keeps 5 mm and a cottage far finer), indices 16-bit where they fit. Both are stored as
 * the difference from the one before (a model's x, y and z each in a run of their own): a box's
 * corners and a run of faces become small numbers, which the server's gzip packs about five
 * times tighter than the numbers themselves (model batch 4: 2.0 MB on the wire down to 0.4 MB).
 */
const MAGIC = 0x314d4243; // "CBM1"
const VERSION = 3;

/** A signed difference as an unsigned number that is small either way (0, −1, 1, −2 → 0, 1, 2, 3). */
const zig = (d: number) => ((d << 1) ^ (d >> 31)) >>> 0;
const zag = (c: number) => (c >>> 1) ^ -(c & 1);
/** Wrapped to 16 bits, signed: every difference between two 16-bit numbers fits. */
const wrap16 = (v: number) => (v << 16) >> 16;

/** A model's 16-bit vertices as differences, x's then y's then z's. */
function encodePositions(q: Int16Array): Uint16Array {
  const n = q.length / 3;
  const out = new Uint16Array(q.length);
  for (let c = 0; c < 3; c++) {
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const v = q[3 * i + c]!;
      out[c * n + i] = zig(wrap16(v - prev));
      prev = v;
    }
  }
  return out;
}

function decodePositions(codes: Uint16Array, scale: number): Float32Array {
  const n = codes.length / 3;
  const out = new Float32Array(codes.length);
  for (let c = 0; c < 3; c++) {
    let prev = 0;
    for (let i = 0; i < n; i++) {
      prev = wrap16(prev + zag(codes[c * n + i]!));
      out[3 * i + c] = prev * scale;
    }
  }
  return out;
}

/** Indices as differences from the one before: 16-bit, or 32-bit for a model past 65,535 vertices. */
function encodeIndex(index: Uint32Array, wide: boolean): Uint16Array | Uint32Array {
  const out = wide ? new Uint32Array(index.length) : new Uint16Array(index.length);
  let prev = 0;
  for (let i = 0; i < index.length; i++) {
    const v = index[i]!;
    out[i] = wide ? zig((v - prev) | 0) : zig(wrap16(v - prev)) & 0xffff;
    prev = v;
  }
  return out;
}

function decodeIndex(codes: Uint16Array | Uint32Array, wide: boolean): Uint32Array {
  const out = new Uint32Array(codes.length);
  let prev = 0;
  for (let i = 0; i < codes.length; i++) {
    prev = wide ? (prev + zag(codes[i]!)) >>> 0 : (prev + zag(codes[i]!)) & 0xffff;
    out[i] = prev;
  }
  return out;
}

interface Entry {
  meta: Omit<
    BakedModel,
    | 'positions'
    | 'index'
    | 'triRole'
    | 'triFlags'
    | 'triUnit'
    | 'triGroup'
    | 'units'
    | 'occupied'
    | 'approach'
  >;
  /** Metres per unit of the 16-bit vertices. */
  scale: number;
  wide: boolean;
  /** Byte offset and element count of each array in the binary section. */
  at: Record<
    | 'positions'
    | 'index'
    | 'triRole'
    | 'triFlags'
    | 'triUnit'
    | 'triGroup'
    | 'units'
    | 'occupied'
    | 'approach',
    [number, number]
  >;
}

/** The arrays of a model, in the order the file holds them. */
const KINDS = [
  'positions',
  'index',
  'triRole',
  'triFlags',
  'triUnit',
  'triGroup',
  'units',
  'occupied',
  'approach',
] as const;

export function encodeModels(models: BakedModel[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const put = (a: ArrayBufferView): number => {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const at = offset;
    chunks.push(bytes);
    offset += bytes.byteLength;
    const pad = (4 - (offset % 4)) % 4;
    if (pad) {
      chunks.push(new Uint8Array(pad));
      offset += pad;
    }
    return at;
  };
  const packed = models.map((m) => {
    let max = 1e-6;
    for (const v of m.positions) max = Math.max(max, Math.abs(v));
    if (!Number.isFinite(max)) throw new Error(`${m.id}: a coordinate that isn't a number`);
    const scale = max / 32767;
    const q = new Int16Array(m.positions.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(m.positions[i]! / scale);
    const wide = m.positions.length / 3 > 65535;
    const { positions, index, triRole, triFlags, triUnit, triGroup, units, occupied, approach, ...meta } = m;
    const arrays: Record<(typeof KINDS)[number], ArrayBufferView & { length: number }> = {
      positions: encodePositions(q),
      index: encodeIndex(index, wide),
      triRole,
      triFlags,
      triUnit,
      triGroup,
      units,
      occupied,
      approach,
    };
    void positions;
    const entry: Entry = { meta, scale, wide, at: {} as Entry['at'] };
    return { entry, arrays };
  });
  // Kind by kind, so like numbers sit together for gzip.
  for (const kind of KINDS)
    for (const { entry, arrays } of packed) entry.at[kind] = [put(arrays[kind]), arrays[kind].length];
  const entries = packed.map((p) => p.entry);
  let json = new TextEncoder().encode(JSON.stringify({ version: VERSION, models: entries }));
  if (json.length % 4) {
    const padded = new Uint8Array(json.length + 4 - (json.length % 4)).fill(0x20);
    padded.set(json);
    json = padded;
  }
  const out = new Uint8Array(8 + json.length + offset);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, json.length, true);
  out.set(json, 8);
  let o = 8 + json.length;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export function decodeModels(bytes: Uint8Array): BakedModel[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 8 || dv.getUint32(0, true) !== MAGIC) throw new Error('not a Citybloom models file');
  const jsonLen = dv.getUint32(4, true);
  const index = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + jsonLen))) as {
    version: number;
    models: Entry[];
  };
  if (index.version !== VERSION) throw new Error(`models file version ${index.version}`);
  const base = bytes.byteOffset + 8 + jsonLen;
  const end = bytes.byteOffset + bytes.byteLength;
  // Copies, so the arrays are aligned whatever the file's offset in its buffer. A file cut short
  // (or damaged) is refused whole rather than read as empty models.
  const copy = (at: [number, number], bytesPer: number) => {
    const from = base + at[0];
    const to = from + at[1] * bytesPer;
    if (!(at[0] >= 0 && at[1] >= 0 && to <= end)) throw new Error('models file is cut short');
    return bytes.buffer.slice(from, to) as ArrayBuffer;
  };
  return index.models.map((e) => {
    const positions = decodePositions(new Uint16Array(copy(e.at.positions, 2)), e.scale);
    // 16 bits put a wall a fraction of a millimetre off the edge of its footprint: back on it,
    // so copies standing in a row meet exactly.
    const edge = [e.meta.w / 2, 0, e.meta.d / 2];
    for (let i = 0; i < positions.length; i++) {
      const at = edge[i % 3]!;
      if (at && Math.abs(Math.abs(positions[i]!) - at) < 1e-3) positions[i] = Math.sign(positions[i]!) * at;
    }
    return {
      ...e.meta,
      positions,
      index: e.wide
        ? decodeIndex(new Uint32Array(copy(e.at.index, 4)), true)
        : decodeIndex(new Uint16Array(copy(e.at.index, 2)), false),
      triRole: new Uint8Array(copy(e.at.triRole, 1)),
      triFlags: new Uint8Array(copy(e.at.triFlags, 1)),
      triUnit: new Uint16Array(copy(e.at.triUnit, 2)),
      triGroup: new Uint8Array(copy(e.at.triGroup, 1)),
      units: new Uint8Array(copy(e.at.units, 1)),
      occupied: new Uint8Array(copy(e.at.occupied, 1)),
      approach: new Uint8Array(copy(e.at.approach, 1)),
    };
  });
}
