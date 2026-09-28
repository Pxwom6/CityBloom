import { Vector3 } from 'three';
import type { Game } from '../game';

const MAX = 10;

/**
 * Street-name labels on the map at close zoom: one per street near the view centre, placed at
 * the visible segment nearest the centre and turned along the road. A plain DOM layer, refreshed
 * a few times a second.
 */
export class StreetLabels {
  private root: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private frame = 0;
  enabled = true;
  private v = new Vector3();

  constructor(private game: Game) {
    this.root = document.createElement('div');
    this.root.className = 'street-labels';
    this.root.setAttribute('aria-hidden', 'true');
    game.renderer.canvas.parentElement!.appendChild(this.root);
  }

  update(): void {
    // Photo mode hides them at once rather than on the next refresh.
    const display = this.game.photo ? 'none' : '';
    if (this.root.style.display !== display) this.root.style.display = display;
    if (++this.frame % 6) return;
    const r = this.game.renderer;
    const cam = r.controller.current;
    const show = this.enabled && cam.distance < 330 && this.game.overlay.active === null;
    const w = this.game.world;
    const picks: { name: string; x: number; y: number; ang: number }[] = [];
    if (show) {
      const target = r.controller.target;
      const rect = r.canvas.getBoundingClientRect();
      const seen = new Set<string>();
      const segs = [...w.netState.segments.values()]
        .filter((s) => s.type !== 'highway' && s.type !== 'ramp')
        .map((s) => {
          const c = w.net.curve(s.id);
          const m = c.pointAt(c.length / 2);
          return { s, c, m, d: Math.hypot(m.x - target.x, m.z - target.z) };
        })
        .filter((e) => e.d < cam.distance * 1.3 && e.c.length > 30)
        .sort((a, b) => a.d - b.d);
      for (const e of segs) {
        if (picks.length >= MAX) break;
        const name = this.game.names.street(e.s.id);
        if (seen.has(name)) continue;
        const y = w.roadHeight(e.s.id, e.c.length / 2, e.m.x, e.m.z) + 0.5;
        this.v.set(e.m.x, y, e.m.z).project(r.camera);
        if (this.v.z > 1 || Math.abs(this.v.x) > 0.9 || Math.abs(this.v.y) > 0.85) continue;
        const sx = rect.left + ((this.v.x + 1) / 2) * rect.width;
        const sy = rect.top + ((1 - this.v.y) / 2) * rect.height;
        // Road direction on screen.
        const t = e.c.tangentAt(e.c.length / 2);
        this.v.set(e.m.x + t.x * 10, y, e.m.z + t.z * 10).project(r.camera);
        const ex = rect.left + ((this.v.x + 1) / 2) * rect.width;
        const ey = rect.top + ((1 - this.v.y) / 2) * rect.height;
        let ang = (Math.atan2(ey - sy, ex - sx) * 180) / Math.PI;
        if (ang > 90) ang -= 180;
        if (ang < -90) ang += 180;
        seen.add(name);
        picks.push({ name, x: sx, y: sy, ang });
      }
    }
    while (this.pool.length < picks.length) {
      const d = document.createElement('div');
      d.className = 'street-label';
      this.root.appendChild(d);
      this.pool.push(d);
    }
    this.pool.forEach((d, i) => {
      const p = picks[i];
      if (!p) {
        d.style.display = 'none';
        return;
      }
      d.style.display = 'block';
      if (d.textContent !== p.name) d.textContent = p.name;
      d.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%) rotate(${p.ang.toFixed(1)}deg)`;
    });
  }
}
