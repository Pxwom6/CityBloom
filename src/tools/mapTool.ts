import { MAP_BRUSHES, MAP_EDIT, type MapBrush } from '../data/mapEditor';
import type { Command } from '../sim/commands';
import type { Vec2 } from '../sim/geom';
import type { Game } from '../game';
import type { Tool, ToolPointer } from './tool';

let strokeCounter = 1;

/** What the map editor's tool does: paint with a brush, or put the highway or railway entry down. */
export type MapToolMode = MapBrush | 'highway' | 'rail';

const COLOUR: Partial<Record<MapToolMode, string>> = {
  raise: '#f0c36a',
  lower: '#c9a27a',
  water: '#6fb3ff',
  sea: '#2f7fd6',
  land: '#e2d29a',
  forest: '#3d9a4f',
  clearForest: '#b8c9a0',
  ore: '#d08a4a',
  oil: '#303030',
  clearResources: '#ffffff',
};

/**
 * The map editor's tool (M24): a round brush along the drag (held still, it keeps working), one
 * undo step per drag; or, for the entries, a click near the west edge to say where the highway or
 * railway comes in.
 */
export class MapTool implements Tool {
  readonly id = 'map';
  readonly usesLeftDrag = true;
  mode: MapToolMode = 'raise';
  radius: number = MAP_EDIT.radius.initial;
  strength: number = MAP_EDIT.strength.initial;
  private painting = false;
  private at: Vec2 | null = null;
  private last: Vec2 | null = null;
  private level = 0;
  private stroke = 0;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pointer: ToolPointer | null = null;

  constructor(private game: Game) {}

  activate(): void {}

  deactivate(): void {
    this.stop();
    this.game.renderer.ghost.showBrush(null, 1);
    this.game.renderer.ghost.showMarker(null);
    this.game.setHint(null);
  }

  cancel(): boolean {
    const was = this.painting;
    this.stop();
    return was;
  }

  get entry(): boolean {
    return this.mode === 'highway' || this.mode === 'rail';
  }

  setMode(m: MapToolMode): void {
    this.mode = m;
    // Ore and oil show on their data map while a resource brush is in hand.
    const res = m === 'ore' || m === 'oil' || m === 'clearResources';
    if (res && this.game.overlay.active !== 'resources') this.game.overlay.set('resources');
    if (!res && this.game.overlay.active === 'resources') this.game.overlay.set(null);
    this.game.notify();
    if (this.pointer) this.pointerMove(this.pointer);
  }

  private stop(): void {
    this.painting = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private apply(points: Vec2[]): void {
    if (this.busy || this.entry) return;
    this.busy = true;
    const cmd: Command = {
      type: 'editMap',
      brush: this.mode as MapBrush,
      points,
      radius: this.radius,
      strength: this.strength,
      ...(this.mode === 'level' ? { level: this.level } : {}),
      stroke: this.stroke,
    };
    void this.game.dispatch(cmd).then((r) => {
      this.busy = false;
      if (r.ok) this.game.editor?.changed();
    });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    const at = { x: p.ground.x, z: p.ground.z };
    if (this.entry) {
      const entry = this.mode === 'highway' ? 'highway' : 'rail';
      void this.game.dispatch({ type: 'setMapEntry', entry, z: at.z }).then((r) => {
        if (!r.ok) {
          this.game.toast(r.reason, 'bad');
          this.game.audio?.play('error');
          return;
        }
        this.game.audio?.play('place');
        this.game.editor?.changed();
      });
      return;
    }
    this.stroke = strokeCounter++;
    this.level = this.game.world.heightAt(at.x, at.z);
    this.painting = true;
    this.at = at;
    this.last = at;
    this.apply([at]);
    this.game.audio?.play('earth');
    this.timer = setInterval(() => {
      if (this.painting && this.at && !this.busy) {
        this.apply([this.at]);
        this.last = this.at;
      }
    }, 140);
  }

  pointerMove(p: ToolPointer): void {
    this.pointer = p;
    this.at = p.ground ? { x: p.ground.x, z: p.ground.z } : null;
    const ghost = this.game.renderer.ghost;
    if (this.entry) {
      ghost.showBrush(null, 1);
      ghost.showMarker(p.ground ? { x: 30, z: p.ground.z } : null);
    } else {
      ghost.showMarker(null);
      ghost.showBrush(p.ground, this.radius, COLOUR[this.mode] ?? '#ffffff');
    }
    if (this.painting && this.at && this.last && !this.busy) {
      if (Math.hypot(this.at.x - this.last.x, this.at.z - this.last.z) >= this.radius / 4) {
        this.apply([this.last, this.at]);
        this.last = this.at;
      }
    }
    const name = this.entry
      ? this.mode === 'highway'
        ? 'Click where the highway comes in (on the west edge)'
        : 'Click where the railway comes in (on the west edge)'
      : `${MAP_BRUSHES.find((b) => b.id === this.mode)!.name} · brush ${this.radius} m ([ ]) · strength ${this.strength}× (, .)`;
    const h = p.ground ? this.game.world.heightAt(p.ground.x, p.ground.z) : null;
    const where =
      h === null ? '' : ` · ${h < 0 ? `${(-h).toFixed(1)} m under water` : `${h.toFixed(1)} m up`}`;
    const text =
      this.painting && this.mode === 'level' ? `Levelling to ${this.level.toFixed(1)} m` : name + where;
    this.game.setHint({ x: p.clientX, y: p.clientY, text, tone: 'info' });
  }

  pointerUp(): void {
    this.stop();
  }

  key(e: KeyboardEvent): boolean {
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.code === 'BracketLeft') this.radius = Math.max(MAP_EDIT.radius.min, this.radius - 16);
    else if (e.code === 'BracketRight') this.radius = Math.min(MAP_EDIT.radius.max, this.radius + 16);
    else if (e.code === 'Comma') this.strength = Math.max(MAP_EDIT.strength.min, this.strength / 2);
    else if (e.code === 'Period') this.strength = Math.min(MAP_EDIT.strength.max, this.strength * 2);
    else return false;
    this.game.notify();
    if (this.pointer) this.pointerMove(this.pointer);
    return true;
  }
}
