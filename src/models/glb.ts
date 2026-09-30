import { Matrix3, Matrix4, Quaternion, Vector3 } from 'three';

/**
 * A small GLB (binary glTF 2.0) reader for hand-made building models (phase 3). It runs at build
 * time and in `models:check`, never in the game: the game gets models already converted into its
 * own arrays. It reads meshes only (no textures, skins, animation or cameras), bakes every node's
 * world transform into its triangles, and reports what a checker needs to know about the file.
 */

export interface GlbPart {
  /** The node's name as written, and its normalised form (lower case, no ".001"/"_3" suffix). */
  rawName: string;
  name: string;
  /** Normalised names of the node's ancestors, root first. */
  path: string[];
  node: number;
  /** The material's name (normalised the same way) and its base colour (linear RGB). */
  material: string;
  rawMaterial: string;
  color: [number, number, number];
  /** Triangles in model space, nine floats each, wound counter-clockwise seen from outside. */
  tris: Float32Array;
}

export interface GlbFile {
  parts: GlbPart[];
  nodes: { name: string; parent: number; mesh: boolean }[];
  materials: string[];
  images: number;
  textures: number;
  samplers: number;
  extensionsUsed: string[];
  extensionsRequired: string[];
  generator: string;
  /** Things the reader skipped or repaired, for the report. */
  notes: string[];
}

export class GlbError extends Error {}

const MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

/** Lower case, trimmed, without the numeric suffixes exporters add to repeated names. */
export function normaliseName(s: string | undefined): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s.:_-]*\d+$/, '')
    .replace(/\s+/g, '_');
}

interface Accessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const SIZES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

/** Reads a GLB file. Throws GlbError when it isn't one or can't be read. */
export function parseGlb(bytes: Uint8Array): GlbFile {
  if (bytes.byteLength < 20) throw new GlbError('not a GLB file (too short)');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new GlbError('not a GLB file (no glTF header)');
  if (dv.getUint32(4, true) !== 2) throw new GlbError(`glTF version ${dv.getUint32(4, true)}, expected 2`);
  let json: Record<string, unknown> | null = null;
  let bin: DataView | null = null;
  for (let o = 12; o + 8 <= bytes.byteLength;) {
    const len = dv.getUint32(o, true);
    const type = dv.getUint32(o + 4, true);
    const start = o + 8;
    if (start + len > bytes.byteLength) throw new GlbError('truncated GLB chunk');
    if (type === JSON_CHUNK) {
      const text = new TextDecoder().decode(bytes.subarray(start, start + len));
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new GlbError('the JSON chunk is not valid JSON');
      }
    } else if (type === BIN_CHUNK && !bin) {
      bin = new DataView(bytes.buffer, bytes.byteOffset + start, len);
    }
    o = start + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new GlbError('no JSON chunk');
  return readGltf(json, bin);
}

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);

function readGltf(g: Json, bin: DataView | null): GlbFile {
  const notes: string[] = [];
  const accessors = arr(g.accessors) as unknown as Accessor[];
  const views = arr(g.bufferViews);
  const meshes = arr(g.meshes);
  const materials = arr(g.materials);
  const nodesJson = arr(g.nodes);
  const asset = (g.asset ?? {}) as Json;

  const read = (index: number): { data: Float64Array; size: number } => {
    const a = accessors[index];
    if (!a) throw new GlbError(`missing accessor ${index}`);
    const size = COMPONENTS[a.type];
    const csize = SIZES[a.componentType];
    if (!size || !csize) throw new GlbError(`accessor ${index} has an unsupported type`);
    if (a.sparse) throw new GlbError(`accessor ${index} is sparse (not supported)`);
    const out = new Float64Array(a.count * size);
    if (a.bufferView === undefined) return { data: out, size };
    const v = views[a.bufferView];
    if (!v) throw new GlbError(`missing buffer view ${a.bufferView}`);
    if ((v.buffer as number) !== 0 || !bin)
      throw new GlbError('data outside the GLB binary chunk (not supported)');
    const base = ((v.byteOffset as number) ?? 0) + (a.byteOffset ?? 0);
    const stride = (v.byteStride as number) || size * csize;
    const end = base + stride * (a.count - 1) + size * csize;
    if (end > bin.byteLength) throw new GlbError(`accessor ${index} runs past the binary chunk`);
    const norm = a.normalized === true;
    for (let i = 0; i < a.count; i++) {
      for (let k = 0; k < size; k++) {
        const o = base + i * stride + k * csize;
        let x: number;
        switch (a.componentType) {
          case 5126:
            x = bin.getFloat32(o, true);
            break;
          case 5125:
            x = bin.getUint32(o, true);
            break;
          case 5123:
            x = bin.getUint16(o, true);
            if (norm) x /= 65535;
            break;
          case 5122:
            x = bin.getInt16(o, true);
            if (norm) x = Math.max(x / 32767, -1);
            break;
          case 5121:
            x = bin.getUint8(o);
            if (norm) x /= 255;
            break;
          default:
            x = bin.getInt8(o);
            if (norm) x = Math.max(x / 127, -1);
        }
        out[i * size + k] = x;
      }
    }
    return { data: out, size };
  };

  // Node hierarchy and world matrices.
  const parent = new Array<number>(nodesJson.length).fill(-1);
  nodesJson.forEach((n, i) => {
    for (const c of (n.children as number[] | undefined) ?? [])
      if (c >= 0 && c < nodesJson.length) parent[c] = i;
  });
  const local = nodesJson.map((n) => {
    const m = new Matrix4();
    if (Array.isArray(n.matrix) && n.matrix.length === 16) m.fromArray(n.matrix as number[]);
    else {
      const t = (n.translation as number[] | undefined) ?? [0, 0, 0];
      const r = (n.rotation as number[] | undefined) ?? [0, 0, 0, 1];
      const s = (n.scale as number[] | undefined) ?? [1, 1, 1];
      m.compose(
        new Vector3(t[0], t[1], t[2]),
        new Quaternion(r[0], r[1], r[2], r[3]),
        new Vector3(s[0], s[1], s[2]),
      );
    }
    return m;
  });
  const world: (Matrix4 | null)[] = new Array(nodesJson.length).fill(null);
  const worldOf = (i: number, depth = 0): Matrix4 => {
    const w = world[i];
    if (w) return w;
    if (depth > 256) throw new GlbError('the node hierarchy loops');
    const m =
      parent[i]! >= 0
        ? worldOf(parent[i]!, depth + 1)
            .clone()
            .multiply(local[i]!)
        : local[i]!.clone();
    world[i] = m;
    return m;
  };
  const nameOf = (i: number) => (nodesJson[i]?.name as string | undefined) ?? '';

  // Only nodes reachable from the scene count (or every root, when there is no scene).
  const scenes = arr(g.scenes);
  const sceneIndex = typeof g.scene === 'number' ? (g.scene as number) : 0;
  const roots =
    (scenes[sceneIndex]?.nodes as number[] | undefined) ??
    nodesJson.map((_, i) => i).filter((i) => parent[i] === -1);
  const reachable = new Set<number>();
  const walk = (i: number, depth = 0) => {
    if (reachable.has(i) || depth > 256) return;
    reachable.add(i);
    for (const c of (nodesJson[i]?.children as number[] | undefined) ?? []) walk(c, depth + 1);
  };
  roots.forEach((r) => walk(r));

  const matName = (i: number | undefined) => (i === undefined ? '' : ((materials[i]?.name as string) ?? ''));
  const matColor = (i: number | undefined): [number, number, number] => {
    const pbr = (i === undefined ? undefined : materials[i]?.pbrMetallicRoughness) as Json | undefined;
    const f = (pbr?.baseColorFactor as number[] | undefined) ?? [1, 1, 1, 1];
    return [f[0] ?? 1, f[1] ?? 1, f[2] ?? 1];
  };

  const parts: GlbPart[] = [];
  const nm = new Matrix3();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const e1 = new Vector3();
  const e2 = new Vector3();
  let flipped = 0;
  let degenerate = 0;
  for (const i of [...reachable].sort((x, y) => x - y)) {
    const node = nodesJson[i]!;
    if (typeof node.mesh !== 'number') continue;
    const mesh = meshes[node.mesh];
    if (!mesh) throw new GlbError(`node ${i} names a missing mesh`);
    const w = worldOf(i);
    nm.getNormalMatrix(w);
    const mirrored = w.determinant() < 0;
    const path: string[] = [];
    for (let p = parent[i]!; p >= 0; p = parent[p]!) path.unshift(normaliseName(nameOf(p)));
    const rawName = nameOf(i) || ((mesh.name as string | undefined) ?? '');
    for (const prim of arr(mesh.primitives)) {
      const mode = (prim.mode as number | undefined) ?? 4;
      const attrs = (prim.attributes ?? {}) as Record<string, number>;
      if (attrs.POSITION === undefined) continue;
      if (mode !== 4 && mode !== 5 && mode !== 6) {
        notes.push(`${rawName || `node ${i}`}: points or lines skipped`);
        continue;
      }
      const P = read(attrs.POSITION).data;
      const N = attrs.NORMAL !== undefined ? read(attrs.NORMAL).data : null;
      const count = P.length / 3;
      let idx: number[];
      if (typeof prim.indices === 'number') idx = Array.from(read(prim.indices).data);
      else idx = Array.from({ length: count }, (_, k) => k);
      // Strips and fans become plain triangles.
      if (mode === 5) {
        const t: number[] = [];
        for (let k = 0; k + 2 < idx.length; k++)
          t.push(
            ...(k % 2 === 0 ? [idx[k]!, idx[k + 1]!, idx[k + 2]!] : [idx[k + 1]!, idx[k]!, idx[k + 2]!]),
          );
        idx = t;
      } else if (mode === 6) {
        const t: number[] = [];
        for (let k = 1; k + 1 < idx.length; k++) t.push(idx[0]!, idx[k]!, idx[k + 1]!);
        idx = t;
      }
      const out: number[] = [];
      for (let k = 0; k + 2 < idx.length; k += 3) {
        const ia = idx[k]!;
        const ib = idx[k + 1]!;
        const ic = idx[k + 2]!;
        if (ia >= count || ib >= count || ic >= count)
          throw new GlbError(`${rawName}: an index is out of range`);
        a.set(P[ia * 3]!, P[ia * 3 + 1]!, P[ia * 3 + 2]!).applyMatrix4(w);
        b.set(P[ib * 3]!, P[ib * 3 + 1]!, P[ib * 3 + 2]!).applyMatrix4(w);
        c.set(P[ic * 3]!, P[ic * 3 + 1]!, P[ic * 3 + 2]!).applyMatrix4(w);
        e1.subVectors(b, a);
        e2.subVectors(c, a);
        n.crossVectors(e1, e2);
        if (n.lengthSq() < 1e-10) {
          degenerate++;
          continue;
        }
        // Which side is outside: the file's normals say so; without them, the winding (which a
        // mirroring transform reverses).
        let flip = mirrored;
        if (N) {
          const fx = N[ia * 3]! + N[ib * 3]! + N[ic * 3]!;
          const fy = N[ia * 3 + 1]! + N[ib * 3 + 1]! + N[ic * 3 + 1]!;
          const fz = N[ia * 3 + 2]! + N[ib * 3 + 2]! + N[ic * 3 + 2]!;
          const fn = new Vector3(fx, fy, fz).applyMatrix3(nm);
          if (fn.lengthSq() > 1e-12) flip = fn.dot(n) < 0;
        }
        if (flip) {
          flipped++;
          out.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z);
        } else out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
      if (!out.length) continue;
      const mi = prim.material as number | undefined;
      parts.push({
        rawName,
        name: normaliseName(rawName),
        path,
        node: i,
        material: normaliseName(matName(mi)),
        rawMaterial: matName(mi),
        color: matColor(mi),
        tris: new Float32Array(out),
      });
    }
  }
  if (flipped) notes.push(`${flipped} triangles were wound against their normals and were turned round`);
  if (degenerate) notes.push(`${degenerate} degenerate triangles dropped`);

  return {
    parts,
    nodes: nodesJson.map((node, i) => ({
      name: normaliseName(node.name as string | undefined),
      parent: parent[i]!,
      mesh: typeof node.mesh === 'number',
    })),
    materials: materials.map((m) => (m.name as string | undefined) ?? ''),
    images: arr(g.images).length,
    textures: arr(g.textures).length,
    samplers: arr(g.samplers).length,
    extensionsUsed: ((g.extensionsUsed as string[] | undefined) ?? []).slice(),
    extensionsRequired: ((g.extensionsRequired as string[] | undefined) ?? []).slice(),
    generator: (asset.generator as string | undefined) ?? '',
    notes,
  };
}
