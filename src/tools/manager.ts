import { modDown } from '../client/platform';
import type { Game } from '../game';
import { BulldozeTool } from './bulldozeTool';
import { RoadTool } from './roadTool';
import { SelectTool } from './selectTool';
import type { Tool, ToolPointer } from './tool';
import { ZoneTool } from './zoneTool';
import { PlaceTool } from './placeTool';
import { StopTool } from './stopTool';
import { DisasterTool } from './disasterTool';
import { DistrictTool } from './districtTool';
import { TerrainTool } from './terrainTool';
import { MapTool } from './mapTool';

export type ToolId =
  'select' | 'road' | 'zone' | 'bulldoze' | 'place' | 'stop' | 'disaster' | 'district' | 'terrain' | 'map';

/** Routes canvas pointer and keyboard input to the active tool. */
export class ToolManager {
  readonly select: SelectTool;
  readonly road: RoadTool;
  readonly zone: ZoneTool;
  readonly bulldoze: BulldozeTool;
  readonly place: PlaceTool;
  readonly stop: StopTool;
  readonly disaster: DisasterTool;
  /** District painting (M21). */
  readonly district: DistrictTool;
  /** Terraforming (M24). */
  readonly terrain: TerrainTool;
  /** The map editor's brushes and entries (M24). */
  readonly map: MapTool;
  active: Tool;
  private rightDown: { x: number; y: number } | null = null;

  constructor(private game: Game) {
    this.select = new SelectTool(game);
    this.road = new RoadTool(game);
    this.zone = new ZoneTool(game);
    this.bulldoze = new BulldozeTool(game);
    this.place = new PlaceTool(game);
    this.stop = new StopTool(game);
    this.disaster = new DisasterTool(game);
    this.district = new DistrictTool(game);
    this.terrain = new TerrainTool(game);
    this.map = new MapTool(game);
    this.active = this.select;
    const canvas = game.renderer.canvas;
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointerleave', () => {
      this.game.setHint(null);
      this.game.renderer.ghost.showBrush(null, 1);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** Where a left click began in photo mode (a click, not a drag, picks what to follow). */
  private photoDown: { x: number; y: number } | null = null;

  get activeId(): ToolId {
    return this.active.id as ToolId;
  }

  /** Pick up a civic building to move it (M14): the place tool carries it until it's put down. */
  startMove(civicId: number, def: string): void {
    this.game.select(null);
    this.use('place');
    this.place.startMove(civicId, def);
  }

  use(id: ToolId): void {
    const next = this[id];
    if (next === this.active) return;
    this.active.deactivate();
    this.active = next;
    this.active.activate();
    this.game.renderer.controller.leftDragPans = !next.usesLeftDrag;
    this.game.renderer.terrain.uniforms.uGridOn.value = id === 'road' ? 1 : 0;
    this.game.notify();
  }

  private pointer(e: PointerEvent): ToolPointer {
    const g = this.game.renderer.controller.screenToGround(e.clientX, e.clientY);
    return {
      clientX: e.clientX,
      clientY: e.clientY,
      ground: g ? { x: g.x, z: g.z } : null,
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      alt: e.altKey,
    };
  }

  private onDown(e: PointerEvent): void {
    // Photo mode (M16) has no tools: a click only picks something to follow.
    if (this.game.photo) {
      if (e.button === 0) this.photoDown = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 2) {
      this.rightDown = { x: e.clientX, y: e.clientY };
      return;
    }
    this.active.pointerDown(this.pointer(e));
  }

  private onMove(e: PointerEvent): void {
    if (this.game.photo) return;
    if (this.game.renderer.controller.isDragging && !this.active.usesLeftDrag) return;
    this.active.pointerMove(this.pointer(e));
  }

  private onUp(e: PointerEvent): void {
    if (this.game.photo) {
      const d = this.photoDown;
      this.photoDown = null;
      if (d && e.button === 0 && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5)
        this.game.photoClick(e.clientX, e.clientY);
      return;
    }
    if (e.button === 2) {
      const d = this.rightDown;
      this.rightDown = null;
      // A right click without a drag cancels the current action.
      if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) this.cancelOrExit();
      return;
    }
    this.active.pointerUp(this.pointer(e));
  }

  cancelOrExit(): void {
    if (!this.active.cancel() && this.active !== this.select) this.use('select');
  }

  /** Escape: cancel or leave the tool; with nothing left, close the open panel or pause. */
  private escape(): void {
    if (this.active.cancel()) return;
    // The map editor (M24) keeps its brush; its own bar has the way out.
    if (this.game.mode === 'editor') return;
    if (this.active !== this.select) this.use('select');
    else if (this.game.panel) this.game.openPanel(this.game.panel);
    else this.game.openScreen('pause');
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    // Menus handle their own keys.
    if (this.game.screen) return;
    if (this.game.photo) {
      if (this.photoKey(e)) e.preventDefault();
      return;
    }
    if (this.active.key?.(e)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      // Handled here: the menus' own Escape listener must not undo what this press opened.
      e.preventDefault();
      this.escape();
      return;
    }
    // Undo: ⌘Z / Ctrl+Z or U; redo: ⇧⌘Z / Ctrl+Shift+Z, Ctrl+Y or Shift+U (M14).
    const mod = modDown(e);
    if (
      (e.code === 'KeyZ' && mod && e.shiftKey) ||
      (e.code === 'KeyY' && mod) ||
      (e.code === 'KeyU' && e.shiftKey)
    ) {
      e.preventDefault();
      void this.game.redo();
      return;
    }
    if ((e.code === 'KeyZ' && mod) || (e.code === 'KeyU' && !mod)) {
      e.preventDefault();
      void this.game.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // The city's tools aren't in the map editor.
    if (this.game.mode === 'editor') return;
    switch (e.code) {
      case 'KeyT':
        // Shift+T: the terrain tools (M24).
        if (e.shiftKey) this.use(this.active === this.terrain ? 'select' : 'terrain');
        else this.use('road');
        break;
      case 'KeyZ':
        this.zone.setZone('R');
        this.use('zone');
        break;
      case 'KeyX':
        this.zone.setZone('C');
        this.use('zone');
        break;
      case 'KeyC':
        this.zone.setZone('I');
        this.use('zone');
        break;
      case 'KeyV':
        this.zone.setZone('none');
        this.use('zone');
        break;
      case 'KeyB':
        this.use('bulldoze');
        break;
      case 'KeyI':
        this.use(this.active === this.district ? 'select' : 'district');
        break;
      case 'KeyH':
        this.use('select');
        break;
      case 'KeyK':
        this.game.enterPhoto();
        break;
    }
  }

  /** Photo mode's keys (M16); the camera keys still work through the camera controller. */
  private photoKey(e: KeyboardEvent): boolean {
    const g = this.game;
    const p = g.photo!;
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    // A focused button in the photo panel answers Enter and Space itself.
    if ((e.code === 'Enter' || e.code === 'Space') && (e.target as HTMLElement | null)?.tagName === 'BUTTON')
      return false;
    switch (e.code) {
      case 'Escape':
        if (p.picking) g.setPhoto({ picking: false });
        else g.exitPhoto();
        return true;
      case 'KeyK':
        g.exitPhoto();
        return true;
      case 'KeyH':
        g.setPhoto({ panel: !p.panel });
        return true;
      case 'Space':
        g.setPhoto({ running: !p.running });
        return true;
      case 'Enter':
        void g.savePhoto();
        return true;
    }
    return false;
  }
}
