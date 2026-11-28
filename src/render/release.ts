import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute } from 'three';

/**
 * Geometry the page never reads again once it is on the GPU (M49): chunk meshes of buildings, civic
 * buildings and roads, and construction sites, are built whole and thrown away whole, so their
 * arrays are let go as soon as three.js has uploaded them. A phone keeps one copy, on the GPU,
 * instead of two. If the GPU's context is lost, `GameRenderer` builds them all again.
 */
export const RELEASE = { on: true };

function release(this: BufferAttribute | InterleavedBufferAttribute): void {
  const a = this as unknown as {
    array: ArrayLike<number> & { constructor: new (n: number) => ArrayLike<number> };
  };
  // An empty array of the same kind, not null: anything that still looks finds nothing, not a crash.
  a.array = new a.array.constructor(0) as never;
}

/** Let the geometry's arrays go once each is uploaded (a no-op with `RELEASE.on` false). */
export function releaseAfterUpload(g: BufferGeometry): void {
  if (!RELEASE.on) return;
  for (const a of Object.values(g.attributes)) (a as BufferAttribute).onUpload?.(release);
  g.index?.onUpload(release);
}
