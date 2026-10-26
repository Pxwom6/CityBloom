import { Vector3 } from 'three';
import { NEIGHBOUR_KIND } from '../data/region';
import { MAP_SIZE } from '../data/world';
import type { Game } from '../game';
import type { Neighbour } from '../sim/systems/region';

/**
 * Where the neighbours are (M23): a label at the edge of the map where each one's road or railway
 * leaves (north and south along the regional highway, west along the railway), shown while the
 * Region panel or the region traffic map is open.
 */
export class RegionView {
  private readonly labels: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private readonly v = new Vector3();
  private frame = 0;

  constructor(private game: Game) {
    this.labels = document.createElement('div');
    this.labels.className = 'district-labels region-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    game.renderer.canvas.parentElement!.appendChild(this.labels);
  }

  get active(): boolean {
    const g = this.game;
    return (g.panel === 'region' || g.overlay.active === 'region') && !g.photo && g.mode === 'play';
  }

  /** Where each side's label sits: just inside the map where the way to that neighbour leaves. */
  private anchor(side: string): { x: number; z: number; arrow: string } {
    const w = this.game.world;
    const hw = w.netState.nodes.get(w.highway.connect);
    const z = hw?.z ?? MAP_SIZE / 2;
    if (side === 'north') return { x: 70, z: 60, arrow: '↑' };
    if (side === 'south') return { x: 70, z: MAP_SIZE - 60, arrow: '↓' };
    const rail = w.railway ? w.netState.nodes.get(w.railway.connect) : undefined;
    return { x: 50, z: rail?.z ?? z + 260, arrow: '←' };
  }

  update(): void {
    if (++this.frame % 6 !== 0) return;
    const on = this.active;
    const list = on ? this.game.world.stats.region.neighbours : [];
    const r = this.game.renderer;
    const rect = r.canvas.getBoundingClientRect();
    while (this.pool.length < list.length) {
      const el = document.createElement('div');
      el.className = 'district-label region-label';
      this.labels.appendChild(el);
      this.pool.push(el);
    }
    this.pool.forEach((el, n) => {
      const nb = list[n];
      if (!nb) {
        el.style.display = 'none';
        return;
      }
      const a = this.anchor(nb.side);
      this.v.set(a.x, Math.max(0, this.game.world.heightAt(a.x, a.z)) + 10, a.z).project(r.camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.textContent = neighbourLabel(a.arrow, nb);
      el.style.transform = `translate(${((this.v.x + 1) / 2) * rect.width}px, ${((1 - this.v.y) / 2) * rect.height}px) translate(-50%, -50%)`;
    });
  }
}

/**
 * A neighbour's label at the map's edge (review, minor): a player's city is theirs, not a kind of town,
 * and a small town's population isn't "0k".
 */
export function neighbourLabel(
  arrow: string,
  nb: Pick<Neighbour, 'name' | 'kind' | 'population' | 'player'>,
): string {
  const what = nb.player ? `${nb.player.mayor}’s city` : NEIGHBOUR_KIND[nb.kind].label;
  return `${arrow} ${nb.name} · ${what} · ${townSize(nb.population)}`;
}

/** A town's population for its label: 640, 4.2k, 38k. */
export function townSize(pop: number): string {
  const n = Math.max(0, Math.round(pop));
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
