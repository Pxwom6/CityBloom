/**
 * Small GLB files made by hand (M46): a writer for parts made of boxes, each a named node with a
 * material named by role, and the models the custom-building tests use: a good one in the game's
 * style (a little clock-tower pavilion on a paved 16 m square, to spec v6), and bad ones (too big a
 * file, too wide for its site, a link to an outside file, textures).
 */
export type Vec3 = [number, number, number];

export interface Part {
  name: string;
  material: string;
  color: [number, number, number];
  tris: number[];
}

/** A box's 12 triangles, wound outward (glTF fronts are counter-clockwise). */
export function box(min: Vec3, max: Vec3): number[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const q = (a: Vec3, b: Vec3, c: Vec3, d: Vec3) => [...a, ...b, ...c, ...a, ...c, ...d];
  return [
    ...q([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]), // +z
    ...q([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]), // -z
    ...q([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]), // +x
    ...q([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]), // -x
    ...q([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]), // +y
    ...q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]), // -y
  ];
}

/** A four-sided pyramid roof over a square base, wound outward. */
export function pyramid(cx: number, cz: number, half: number, y0: number, y1: number): number[] {
  const a: Vec3 = [cx - half, y0, cz - half];
  const b: Vec3 = [cx + half, y0, cz - half];
  const c: Vec3 = [cx + half, y0, cz + half];
  const d: Vec3 = [cx - half, y0, cz + half];
  const t: Vec3 = [cx, y1, cz];
  return [...b, ...a, ...t, ...c, ...b, ...t, ...d, ...c, ...t, ...a, ...d, ...t];
}

/**
 * The parts as a GLB. `outside` puts the binary in an outside file (a `uri`) rather than inside;
 * `texture` adds an image and a texture (the spec allows plain colours only); `pad` makes the file
 * that many bytes bigger (an unused buffer view).
 */
export function writeGlb(
  parts: Part[],
  o: { outside?: boolean; texture?: boolean; pad?: number } = {},
): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const views: { buffer: number; byteOffset: number; byteLength: number; target?: number }[] = [];
  const accessors: Record<string, unknown>[] = [];
  const meshes: Record<string, unknown>[] = [];
  const nodes: Record<string, unknown>[] = [];
  const materials: Record<string, unknown>[] = [];
  const matIndex = new Map<string, number>();
  const add = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes, new Uint8Array(pad));
    offset += bytes.length + pad;
    return views.length - 1;
  };
  for (const p of parts) {
    const pos = new Float32Array(p.tris);
    const n = pos.length / 3;
    const idx = new Uint32Array(n).map((_, i) => i);
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < pos.length; i++) {
      min[i % 3] = Math.min(min[i % 3]!, pos[i]!);
      max[i % 3] = Math.max(max[i % 3]!, pos[i]!);
    }
    const pv = add(new Uint8Array(pos.buffer), 34962);
    const iv = add(new Uint8Array(idx.buffer), 34963);
    accessors.push({ bufferView: pv, componentType: 5126, count: n, type: 'VEC3', min, max });
    accessors.push({ bufferView: iv, componentType: 5125, count: n, type: 'SCALAR' });
    let m = matIndex.get(p.material);
    if (m === undefined) {
      m = materials.length;
      matIndex.set(p.material, m);
      materials.push({
        name: p.material,
        pbrMetallicRoughness: { baseColorFactor: [...p.color, 1], metallicFactor: 0, roughnessFactor: 0.9 },
      });
    }
    meshes.push({
      name: p.name,
      primitives: [
        { attributes: { POSITION: accessors.length - 2 }, indices: accessors.length - 1, material: m },
      ],
    });
    nodes.push({ name: p.name, mesh: meshes.length - 1 });
  }
  if (o.pad) add(new Uint8Array(o.pad).map((_, i) => (i * 2654435761) >>> 24));
  const extra: Record<string, unknown> = {};
  if (o.texture) {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = add(png);
    extra.images = [{ bufferView: view, mimeType: 'image/png' }];
    extra.textures = [{ source: 0 }];
  }
  const binLength = offset;
  const json = {
    asset: { version: '2.0', generator: 'citybloom tests' },
    scene: 0,
    scenes: [{ nodes: nodes.map((_, i) => i) }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews: views,
    buffers: [o.outside ? { byteLength: binLength, uri: 'building.bin' } : { byteLength: binLength }],
    ...extra,
  };
  let text = JSON.stringify(json);
  while (text.length % 4) text += ' ';
  const jsonBytes = new TextEncoder().encode(text);
  const bin = new Uint8Array(binLength);
  let at = 0;
  for (const c of chunks) {
    bin.set(c, at);
    at += c.length;
  }
  const withBin = !o.outside;
  const total = 12 + 8 + jsonBytes.length + (withBin ? 8 + bin.length : 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonBytes.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  if (withBin) {
    const o2 = 20 + jsonBytes.length;
    v.setUint32(o2, bin.length, true);
    v.setUint32(o2 + 4, 0x004e4942, true);
    out.set(bin, o2 + 8);
  }
  return out;
}

const C = {
  paving: [0.72, 0.7, 0.66],
  grass: [0.42, 0.62, 0.32],
  wall: [0.93, 0.86, 0.72],
  wall_alt: [0.82, 0.45, 0.36],
  trim: [0.96, 0.95, 0.9],
  roof: [0.36, 0.42, 0.55],
  glass: [0.55, 0.72, 0.85],
  door: [0.45, 0.3, 0.2],
  accent: [0.95, 0.75, 0.25],
  hedge: [0.3, 0.5, 0.25],
} as const;

const part = (name: string, material: keyof typeof C, tris: number[]): Part => ({
  name,
  material,
  color: [...C[material]] as [number, number, number],
  tris,
});

/**
 * The good model: a clock-tower pavilion on a paved square `size` metres across (16: a 2×2
 * landmark, or the pocket park's site), front to −Z: lawns in the corners, low hedges, a two-tone
 * tower with a door and windows on the front, a clock face, a slate roof.
 */
export function goodModelParts(size = 16): Part[] {
  const h = size / 2;
  const parts: Part[] = [part('square', 'paving', box([-h, 0, -h], [h, 0.1, h]))];
  // A lawn in each corner, clear of the steps and the tower.
  const c = h - 3.2;
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const)
    parts.push(
      part(
        `lawn_${sx}_${sz}`,
        'grass',
        box([sx * c - 2.5, 0.1, sz * c - 2.5], [sx * c + 2.5, 0.16, sz * c + 2.5]),
      ),
    );
  parts.push(part('hedge_left', 'hedge', box([-h + 0.5, 0.1, 1], [-h + 1.3, 0.9, h - 2])));
  parts.push(part('hedge_right', 'hedge', box([h - 1.3, 0.1, 1], [h - 0.5, 0.9, h - 2])));
  parts.push(part('tower', 'wall', box([-2.5, 0.1, -2.5], [2.5, 9, 2.5])));
  parts.push(part('tower_band', 'wall_alt', box([-2.6, 4.2, -2.6], [2.6, 4.8, 2.6])));
  parts.push(part('cornice', 'trim', box([-2.8, 9, -2.8], [2.8, 9.4, 2.8])));
  parts.push(part('roof', 'roof', pyramid(0, 0, 2.8, 9.4, 12.5)));
  parts.push(part('door', 'door', box([-0.8, 0.1, -2.6], [0.8, 2.6, -2.5])));
  parts.push(part('window_front', 'glass', box([-1.2, 5.5, -2.6], [1.2, 7.5, -2.5])));
  parts.push(part('clock', 'accent', box([-0.9, 7.7, -2.65], [0.9, 8.7, -2.55])));
  parts.push(part('window_left', 'glass', box([-2.6, 5.5, -1.2], [-2.5, 7.5, 1.2])));
  parts.push(part('window_right', 'glass', box([2.5, 5.5, -1.2], [2.6, 7.5, 1.2])));
  parts.push(part('steps', 'paving', box([-1.4, 0.1, -3.3], [1.4, 0.3, -2.5])));
  return parts;
}

/** The test models: a good one and the bad ones the e2e imports. */
export function testModels(): Record<'good' | 'tooBig' | 'tooWide' | 'outside' | 'textured', Uint8Array> {
  const good = goodModelParts(16);
  return {
    good: writeGlb(good),
    // Over 1 MB.
    tooBig: writeGlb(good, { pad: 1_200_000 }),
    // 24 m across for a 16 m site.
    tooWide: writeGlb(goodModelParts(24)),
    // Its data in an outside file.
    outside: writeGlb(good, { outside: true }),
    // A texture (plain colours only).
    textured: writeGlb(good, { texture: true }),
  };
}
