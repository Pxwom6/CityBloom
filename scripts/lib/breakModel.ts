// Deliberately broken models, for testing `models:check`: each takes a good GLB and spoils one
// thing the spec asks for. Used by tests/models.test.ts and scripts/dev/breakmodel.ts.

type Json = Record<string, unknown>;

/** Rewrite a GLB's JSON chunk, keeping its binary chunk as it is. */
export function editGlb(bytes: Uint8Array, edit: (gltf: Json) => void): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as Json;
  edit(gltf);
  let json = new TextEncoder().encode(JSON.stringify(gltf));
  if (json.length % 4) {
    const padded = new Uint8Array(json.length + 4 - (json.length % 4)).fill(0x20);
    padded.set(json);
    json = padded;
  }
  const rest = bytes.subarray(20 + jsonLen);
  const out = new Uint8Array(20 + json.length + rest.length);
  const o = new DataView(out.buffer);
  o.setUint32(0, 0x46546c67, true);
  o.setUint32(4, 2, true);
  o.setUint32(8, out.length, true);
  o.setUint32(12, json.length, true);
  o.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  out.set(rest, 20 + json.length);
  return out;
}

const nodes = (g: Json) => g.nodes as Json[];
/** Put a transform (a column-major matrix) over the whole scene. */
function transform(g: Json, m: number[]): void {
  const scene = (g.scenes as Json[])[(g.scene as number) ?? 0]!;
  nodes(g).push({ name: 'spoiled', children: scene.nodes, matrix: m });
  scene.nodes = [nodes(g).length - 1];
}

export const BREAKS: Record<string, { what: string; edit: (g: Json) => void }> = {
  turn: {
    what: 'turned half round, so the front faces +Z',
    edit: (g) => transform(g, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1]),
  },
  shift: {
    what: 'moved 3 m along x, so the origin is off centre',
    edit: (g) => transform(g, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 0, 1]),
  },
  scale: {
    what: 'a tenth too big for its site',
    edit: (g) => transform(g, [1.1, 0, 0, 0, 0, 1.1, 0, 0, 0, 0, 1.1, 0, 0, 0, 0, 1]),
  },
  float: {
    what: 'lifted 1 m off the ground',
    edit: (g) => transform(g, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]),
  },
  sink: {
    what: 'sunk 1 m into the ground',
    edit: (g) => transform(g, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]),
  },
  texture: {
    what: 'given a texture',
    edit: (g) => {
      g.images = [{ uri: 'data:image/png;base64,iVBORw0KGgo=' }];
      g.textures = [{ source: 0 }];
      const m = (g.materials as Json[])[0]!;
      m.pbrMetallicRoughness = { ...(m.pbrMetallicRoughness as Json), baseColorTexture: { index: 0 } };
    },
  },
  material: {
    what: 'with its wall material renamed "bricks"',
    edit: (g) => {
      for (const m of g.materials as Json[]) if (m.name === 'wall') m.name = 'bricks';
    },
  },
  nostack: {
    what: 'with its smoke_stack parts renamed',
    edit: (g) => {
      for (const n of nodes(g)) if (n.name === 'smoke_stack') n.name = 'chimney';
    },
  },
  noglass: {
    what: 'with the glass taken out of its window groups',
    edit: (g) => {
      for (const n of nodes(g)) if (n.name === 'window_glass') n.name = 'pane';
    },
  },
};

export function breakModel(bytes: Uint8Array, how: string): Uint8Array {
  const b = BREAKS[how];
  if (!b) throw new Error(`unknown break "${how}": one of ${Object.keys(BREAKS).join(', ')}`);
  return editGlb(bytes, b.edit);
}
