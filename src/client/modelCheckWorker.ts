/**
 * Checking a player's model off the page's thread (M46): the file is read and checked here, so a
 * broken or hostile file can't freeze the game, and a model that fails comes back with a picture of
 * where: from above and from the front, its site drawn over it, what lies outside the site and the
 * parts the problems name in red.
 */
import type { GlbFile } from '../models/glb';
import { growBox, emptyBox } from '../models/check';
import {
  checkCustom,
  probeCustom,
  type CustomCheck,
  type CustomTarget,
  type ModelSize,
} from '../models/customCheck';

/** Check a model for a target, or (`probe`) only measure it, to suggest what it could be. */
export type ModelCheckJob =
  { id: number; bytes: ArrayBuffer; target: CustomTarget } | { id: number; bytes: ArrayBuffer; probe: true };

export type ModelCheckReply =
  | { id: number; result: CustomCheck; picture: Blob | null }
  | { id: number; probe: ModelSize | { why: string } };

const COLOURS: Record<string, string> = {
  wall: '#e6d8bb',
  wall_alt: '#c9806a',
  trim: '#f1efe6',
  roof: '#5b6a85',
  glass: '#8fb6d6',
  shop_glass: '#8fb6d6',
  frame: '#555',
  door: '#6b4a33',
  awning: '#c4553d',
  sign: '#d9b44a',
  metal: '#9aa3ab',
  wood: '#8a6440',
  accent: '#e8b84a',
  grass: '#79a35a',
  paving: '#b9b4aa',
  asphalt: '#555b60',
  water: '#5f9fd0',
  hedge: '#4f7d3d',
};

/** Draw the model from above and from the front, its site, and what's wrong in red. */
async function picture(file: GlbFile, r: CustomCheck): Promise<Blob | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const W = 720;
  const H = 360;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#f6f4ee';
  ctx.fillRect(0, 0, W, H);
  const named = new Set(r.problems.flatMap((p) => p.parts));
  const sw = r.site.w / 2;
  const sd = r.site.d / 2;
  const box = r.box ?? { min: [-sw, 0, -sd], max: [sw, 1, sd] };
  // How much of each view to show: the site and the model, whichever is bigger.
  const half = Math.max(sw, sd, -box.min[0], box.max[0], -box.min[2], box.max[2]) * 1.15;
  const tall = Math.max(box.max[1], 4) * 1.15;
  const parts = file.parts.map((p) => {
    const b = growBox(emptyBox(), p.tris);
    const out =
      b.min[0] < -sw - 0.05 || b.max[0] > sw + 0.05 || b.min[2] < -sd - 0.05 || b.max[2] > sd + 0.05;
    return { p, b, red: out || named.has(p.rawName) };
  });
  const panel = (x0: number, title: string, view: 'top' | 'front') => {
    const size = 300;
    const ox = x0 + 30;
    const oy = 40;
    const s = view === 'top' ? size / (2 * half) : Math.min(size / (2 * half), size / tall);
    const px = (x: number) => ox + size / 2 + x * s;
    const py = (y: number, z: number) => (view === 'top' ? oy + size / 2 - z * s : oy + size - y * s);
    ctx.fillStyle = '#333';
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(title, ox, 26);
    // Back to front (front view: far parts first; top view: low parts first).
    const order = [...parts].sort((a, b) =>
      view === 'top' ? a.b.max[1] - b.b.max[1] : b.b.max[2] - a.b.max[2],
    );
    for (const { p, red } of order) {
      ctx.fillStyle = red ? '#e0413a' : (COLOURS[p.material] ?? '#bbb');
      const t = p.tris;
      for (let i = 0; i < t.length; i += 9) {
        ctx.beginPath();
        for (let k = 0; k < 3; k++) {
          const x = px(t[i + k * 3]!);
          const y = py(t[i + k * 3 + 1]!, t[i + k * 3 + 2]!);
          if (k) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    // The site: its outline from above, its width on the ground from the front.
    ctx.strokeStyle = '#1f8a4c';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    if (view === 'top') ctx.strokeRect(px(-sw), py(0, sd), sw * 2 * s, sd * 2 * s);
    else {
      ctx.beginPath();
      ctx.moveTo(px(-sw), py(0, 0));
      ctx.lineTo(px(sw), py(0, 0));
      ctx.moveTo(px(-sw), py(0, 0));
      ctx.lineTo(px(-sw), py(tall, 0));
      ctx.moveTo(px(sw), py(0, 0));
      ctx.lineTo(px(sw), py(tall, 0));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = '#1f8a4c';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(
      view === 'top' ? `site ${r.site.w} × ${r.site.d} m · the road ↓` : `site ${r.site.w} m wide`,
      ox,
      oy + size + 18,
    );
  };
  panel(0, 'From above', 'top');
  panel(W / 2, 'From the front', 'front');
  return c.convertToBlob({ type: 'image/png' });
}

self.onmessage = async (e: MessageEvent<ModelCheckJob>) => {
  const job = e.data;
  const { id, bytes } = job;
  if ('probe' in job) {
    (self as unknown as Worker).postMessage({
      id,
      probe: probeCustom(new Uint8Array(bytes)),
    } satisfies ModelCheckReply);
    return;
  }
  const { result, file } = checkCustom(new Uint8Array(bytes), job.target);
  let pic: Blob | null = null;
  if (!result.ok && file?.parts.length) pic = await picture(file, result).catch(() => null);
  (self as unknown as Worker).postMessage({ id, result, picture: pic } satisfies ModelCheckReply);
};
