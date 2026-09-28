import { Vector3 } from 'three';
import type { Game } from '../game';
import type { MapCheck, MapData } from '../sim/terrain/customMap';
import { downloadMap, writeMap } from './maps';

/**
 * The map editor (M24) on the page: keeps the map being edited in the player's maps (a draft saved
 * a few seconds after each change, so nothing is lost), runs the playability check, exports the
 * file, and starts a city on the map. Labels mark where the highway and railway come in, and the
 * places the check complains about. DESIGN.md §3.25.
 */
export class MapEditor {
  check: MapCheck | null = null;
  /** Changed since it was last saved. */
  dirty = false;
  savedAt: string | null = null;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private draftTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly labels: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private readonly v = new Vector3();
  private frame = 0;

  constructor(
    private game: Game,
    /** The map's record in the player's maps. */
    readonly id: string,
  ) {
    this.labels = document.createElement('div');
    this.labels.className = 'district-labels editor-labels';
    this.labels.setAttribute('aria-hidden', 'true');
    game.renderer.canvas.parentElement!.appendChild(this.labels);
    void this.runCheck();
  }

  /** The map was edited: check it again shortly, and keep a draft. */
  changed(): void {
    this.dirty = true;
    if (this.checkTimer) clearTimeout(this.checkTimer);
    this.checkTimer = setTimeout(() => void this.runCheck(), 700);
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => void this.save(true), 5000);
    this.game.notify();
  }

  private async exported(): Promise<{ map: MapData; check: MapCheck }> {
    const out = (await this.game.client.query({ type: 'exportMap' })) as { map: MapData; check: MapCheck };
    this.check = out.check;
    this.game.notify();
    return out;
  }

  async runCheck(): Promise<MapCheck> {
    return (await this.exported()).check;
  }

  /** Save to the player's maps: playable maps appear on the new-city screen. */
  async save(quiet = false): Promise<boolean> {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = null;
    const { map, check } = await this.exported();
    try {
      const info = await writeMap(this.id, map, check.ok);
      this.savedAt = info.savedAt;
      this.dirty = false;
    } catch {
      if (!quiet) this.game.toast('The map could not be saved in this browser.', 'bad', 5000);
      return false;
    }
    if (!quiet)
      this.game.toast(
        check.ok
          ? `Saved “${map.name}”. It’s playable: find it on the new-city screen.`
          : `Saved “${map.name}” as a draft. Fix ${check.problems.length === 1 ? 'the problem' : `the ${check.problems.length} problems`} to play it.`,
        check.ok ? 'ok' : 'info',
        5000,
      );
    this.game.notify();
    return check.ok;
  }

  async exportFile(): Promise<void> {
    const { map } = await this.exported();
    downloadMap(map);
  }

  /** Found a city on the map (saved first); an unplayable map says why instead. */
  async play(): Promise<void> {
    const ok = await this.save(true);
    const name = this.game.world.stats.map?.name ?? 'New Town';
    if (!ok) {
      this.game.toast(`Not playable yet: ${this.check?.problems[0]?.text ?? 'check the map'}`, 'bad', 6000);
      this.game.audio?.play('error');
      return;
    }
    const q = new URLSearchParams({ new: '1', map: this.id, name, difficulty: 'normal' });
    location.href = `${location.pathname}?${q.toString()}`;
  }

  /** Each frame: the entry labels and the check's complaints, where they are on the map. */
  update(): void {
    if (++this.frame % 4 !== 0) return;
    const m = this.game.world.stats.map;
    const marks: { x: number; z: number; text: string; cls: string }[] = [];
    if (m) {
      marks.push({ x: 30, z: m.highwayZ, text: '→ Highway comes in here', cls: 'entry' });
      if (m.railZ !== null)
        marks.push({ x: 30, z: m.railZ, text: '→ Railway comes in here', cls: 'entry rail' });
    }
    for (const p of this.check?.problems ?? [])
      if (p.at) marks.push({ ...p.at, text: `⚠ ${p.text}`, cls: 'problem' });
    const r = this.game.renderer;
    const rect = r.canvas.getBoundingClientRect();
    while (this.pool.length < marks.length) {
      const el = document.createElement('div');
      this.labels.appendChild(el);
      this.pool.push(el);
    }
    this.pool.forEach((el, n) => {
      const mk = marks[n];
      if (!mk) {
        el.style.display = 'none';
        return;
      }
      this.v.set(mk.x, Math.max(0, this.game.world.heightAt(mk.x, mk.z)) + 8, mk.z).project(r.camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.className = `district-label editor-label ${mk.cls}`;
      el.textContent = mk.text;
      el.style.transform = `translate(${((this.v.x + 1) / 2) * rect.width}px, ${((1 - this.v.y) / 2) * rect.height}px) translate(0, -50%)`;
    });
  }
}
