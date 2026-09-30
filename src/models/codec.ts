import type { BakedModel } from './baked';

/**
 * The file the game fetches its hand-made models from: a small header, a JSON index, then the
 * models' arrays packed end to end. Vertices are 16-bit (a model's largest coordinate maps to
 * 32767, so a 150 m airport keeps 5 mm and a cottage far finer), indices 16-bit where they fit.
 */
const MAGIC = 0x314d4243; // "CBM1"

interface Entry {
  meta: Omit<BakedModel, 'positions' | 'index' | 'triRole' | 'triFlags' | 'triUnit' | 'triGroup' | 'units'>;
  /** Metres per unit of the 16-bit vertices. */
  scale: number;
  wide: boolean;
  /** Byte offset and element count of each array in the binary section. */
  at: Record<
    'positions' | 'index' | 'triRole' | 'triFlags' | 'triUnit' | 'triGroup' | 'units',
    [number, number]
  >;
}

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
  const entries: Entry[] = models.map((m) => {
    let max = 1e-6;
    for (const v of m.positions) max = Math.max(max, Math.abs(v));
    const scale = max / 32767;
    const q = new Int16Array(m.positions.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(m.positions[i]! / scale);
    const wide = m.positions.length / 3 > 65535;
    const idx = wide ? m.index : Uint16Array.from(m.index);
    const { positions, index, triRole, triFlags, triUnit, triGroup, units, ...meta } = m;
    void positions;
    void index;
    return {
      meta,
      scale,
      wide,
      at: {
        positions: [put(q), q.length],
        index: [put(idx), idx.length],
        triRole: [put(triRole), triRole.length],
        triFlags: [put(triFlags), triFlags.length],
        triUnit: [put(triUnit), triUnit.length],
        triGroup: [put(triGroup), triGroup.length],
        units: [put(units), units.length],
      },
    };
  });
  let json = new TextEncoder().encode(JSON.stringify({ version: 1, models: entries }));
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
  if (index.version !== 1) throw new Error(`models file version ${index.version}`);
  const base = bytes.byteOffset + 8 + jsonLen;
  // Copies, so the arrays are aligned whatever the file's offset in its buffer.
  const copy = (at: [number, number], bytesPer: number) =>
    bytes.buffer.slice(base + at[0], base + at[0] + at[1] * bytesPer) as ArrayBuffer;
  return index.models.map((e) => {
    const q = new Int16Array(copy(e.at.positions, 2));
    const positions = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) positions[i] = q[i]! * e.scale;
    return {
      ...e.meta,
      positions,
      index: e.wide
        ? new Uint32Array(copy(e.at.index, 4))
        : Uint32Array.from(new Uint16Array(copy(e.at.index, 2))),
      triRole: new Uint8Array(copy(e.at.triRole, 1)),
      triFlags: new Uint8Array(copy(e.at.triFlags, 1)),
      triUnit: new Uint16Array(copy(e.at.triUnit, 2)),
      triGroup: new Uint8Array(copy(e.at.triGroup, 1)),
      units: new Uint8Array(copy(e.at.units, 1)),
    };
  });
}
