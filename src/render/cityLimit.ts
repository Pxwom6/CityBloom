/**
 * The city limit (P21): the line round the buildable square. It used to be a metre or two wide, so
 * from any distance it was under a pixel and vanished; now it is a few pixels wide at any zoom, and
 * stronger while a road or building tool is out. The ground draws it, and so does the water where
 * the limit crosses a river or the sea (the translucent water plane covers the ground there).
 */

/** The line's half width in CSS pixels, and how much of the ground it covers, by how it is shown. */
const LOOK = {
  calm: { px: 1.25, alpha: 0.8 },
  /** A road, zoning or building tool is out: the limit is what the player is building against. */
  strong: { px: 2.25, alpha: 0.95 },
  /** Photo mode keeps the old thin line: wide shots are not ruled with a bar. */
  photo: { px: 0, alpha: 0.6 },
} as const;

/** The two uniforms' values: half width in device pixels, and the line's strength. */
export function limitLook(
  strong: boolean,
  photo: boolean,
  pixelRatio: number,
): { px: number; alpha: number } {
  const l = photo ? LOOK.photo : strong ? LOOK.strong : LOOK.calm;
  return { px: l.px * pixelRatio, alpha: l.alpha };
}

/** The line's colour: a warm cream, as it was. */
export const LIMIT_COLOUR = 'vec3(1.0, 0.97, 0.85)';

/**
 * `cityLimit(p, mapSize, px)`: 1 on the limit, fading to 0 beside it, for a ground point `p` (x, z).
 * The solid core is `px` pixels either side of the edge and a pixel's feather lies beyond it (which
 * is also what smooths its edge); only at the closest zooms do the floors of 0.25 m keep it from
 * thinning to a thread. With `px` 0 it is the old metre-wide line (photo mode). Metres per pixel
 * across the edge come from the derivative of the coordinate the nearest edge runs along (the
 * distance field's own would fold at the line, and the length of `fwidth(p)` over-reads on slanted
 * views). Needs derivatives: call it from uniform control flow.
 */
export const LIMIT_GLSL = /* glsl */ `
float cityLimit(vec2 p, float mapSize, float px) {
  vec2 f = fwidth(p);
  float dx = min(abs(p.x), abs(p.x - mapSize));
  float dz = min(abs(p.y), abs(p.y - mapSize));
  float mpp = min(dx < dz ? f.x : f.y, 12.0);
  float core = px > 0.0 ? max(0.25, mpp * px) : 0.9;
  float reach = core + (px > 0.0 ? max(0.25, mpp) : 1.7);
  vec2 inside = min(p, vec2(mapSize) - p);
  float inRange = step(-reach, inside.x) * step(-reach, inside.y);
  return (1.0 - smoothstep(core, reach, min(dx, dz))) * inRange;
}`;
