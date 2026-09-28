import { Color, Vector3 } from 'three';
import { GRID_CELL, GRID_RES } from '../data/world';
import type { Game } from '../game';

/**
 * District colours (M21): twelve distinct hues, one per palette slot a district is given when it's
 * made. Names are always drawn beside the colour on the map and in the panel, so identity never
 * rests on colour alone.
 */
export const DISTRICT_COLOURS = [
  '#e0703a',
  '#2f9fb3',
  '#8f6cc4',
  '#d9a21b',
  '#4d9b52',
  '#d0558a',
  '#3f74b8',
  '#9b7a45',
  '#28a88d',
  '#c2463f',
  '#7c8f2e',
  '#6a6fd1',
];

export const districtColour = (slot: number) => DISTRICT_COLOURS[slot % DISTRICT_COLOURS.length]!;

/**
 * The district view: while the district tool or panel is open (and no data map is), painted cells
 * are tinted in their district's colour on the ground, borders drawn stronger, and each district's
 * name floats over its middle. It draws through the data maps' overlay texture.
 */
export class DistrictView {
  private key = '';
  private shown = false;
  private labels: HTMLDivElement;
  private pool: HTMLDivElement[] = [];
  private centres: { id: number; x: number; z: number; name: string; colour: string }[] = [];
  private frame = 0;
  private v = new Vector3();
  /** The district picked in the tool or panel: drawn stronger than the rest. */
  selected = 0;

  constructor(private game: Game) {
    this.labels = document.createElement('div');
    this.labels.className = 'district-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    game.renderer.canvas.parentElement!.appendChild(this.labels);
  }

  get active(): boolean {
    const g = this.game;
    return (
      (g.tools.activeId === 'district' || g.panel === 'districts') &&
      g.overlay.active === null &&
      !g.photo &&
      g.mode === 'play'
    );
  }

  update(): void {
    const on = this.active;
    const w = this.game.world;
    const key = on ? `${w.districtsVersion}:${this.selected}` : 'off';
    if (key !== this.key) {
      this.key = key;
      if (on) this.paint();
      else if (this.shown) this.hide();
    }
    if (++this.frame % 6 === 0) this.placeLabels(on);
  }

  private hide(): void {
    this.shown = false;
    const r = this.game.renderer;
    if (this.game.overlay.active === null) r.terrain.uniforms.uOverlayOn.value = 0;
    r.zones.group.visible = this.game.overlay.active === null;
  }

  private paint(): void {
    const w = this.game.world;
    const r = this.game.renderer;
    const u = r.terrain.uniforms;
    const tex = u.uOverlay.value;
    const data = tex.image.data as Uint8Array;
    const cells = w.districtCells;
    const col = new Color();
    const sums = new Map<number, { x: number; z: number; n: number }>();
    for (let j = 0; j < GRID_RES; j++)
      for (let i = 0; i < GRID_RES; i++) {
        const k = j * GRID_RES + i;
        const d = cells[k]!;
        const district = d ? w.districts.get(d) : undefined;
        if (!district) {
          data[k * 4 + 3] = 0;
          continue;
        }
        const s = sums.get(d) ?? { x: 0, z: 0, n: 0 };
        s.x += (i + 0.5) * GRID_CELL;
        s.z += (j + 0.5) * GRID_CELL;
        s.n++;
        sums.set(d, s);
        // A border: a neighbour in another district (or none).
        const edge =
          (i > 0 && cells[k - 1] !== d) ||
          (i < GRID_RES - 1 && cells[k + 1] !== d) ||
          (j > 0 && cells[k - GRID_RES] !== d) ||
          (j < GRID_RES - 1 && cells[k + GRID_RES] !== d);
        col.set(districtColour(district.color));
        if (edge) col.multiplyScalar(0.7);
        const dim = this.selected && this.selected !== d;
        data[k * 4] = Math.round(col.r * 255);
        data[k * 4 + 1] = Math.round(col.g * 255);
        data[k * 4 + 2] = Math.round(col.b * 255);
        data[k * 4 + 3] = edge ? (dim ? 150 : 235) : dim ? 70 : 150;
      }
    tex.needsUpdate = true;
    u.uOverlayOn.value = 1;
    // The ground tint would hide under zone paint.
    r.zones.group.visible = false;
    this.shown = true;
    this.centres = [...sums]
      .map(([id, s]) => {
        const d = w.districts.get(id)!;
        return { id, x: s.x / s.n, z: s.z / s.n, name: d.name, colour: districtColour(d.color) };
      })
      .sort((a, b) => a.id - b.id);
  }

  /** District names over their middles (only while the view is on). */
  private placeLabels(on: boolean): void {
    const list = on ? this.centres : [];
    const r = this.game.renderer;
    const rect = r.canvas.getBoundingClientRect();
    while (this.pool.length < list.length) {
      const el = document.createElement('div');
      el.className = 'district-label';
      this.labels.appendChild(el);
      this.pool.push(el);
    }
    this.pool.forEach((el, n) => {
      const c = list[n];
      if (!c) {
        el.style.display = 'none';
        return;
      }
      this.v.set(c.x, Math.max(0, this.game.world.heightAt(c.x, c.z)) + 8, c.z).project(r.camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.1 || Math.abs(this.v.y) > 1.1) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.textContent = c.name;
      el.style.setProperty('--district', c.colour);
      el.classList.toggle('selected', c.id === this.selected);
      el.style.transform = `translate(${((this.v.x + 1) / 2) * rect.width}px, ${((1 - this.v.y) / 2) * rect.height}px) translate(-50%, -50%)`;
    });
  }
}
