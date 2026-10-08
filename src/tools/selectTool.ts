import type { Game } from '../game';
import { clickSlop, type Tool, type ToolPointer } from './tool';

/** Default tool: left-drag pans the camera; a click selects a building for the inspector. */
export class SelectTool implements Tool {
  readonly id = 'select';
  readonly usesLeftDrag = false;
  private down: { x: number; y: number } | null = null;
  constructor(private game: Game) {}
  activate(): void {}
  deactivate(): void {}
  cancel(): boolean {
    if (this.game.selected === null) return false;
    this.game.select(null);
    return true;
  }
  pointerDown(p: ToolPointer): void {
    if (p.button === 0) this.down = { x: p.clientX, y: p.clientY };
  }
  pointerMove(_p: ToolPointer): void {
    this.game.setHint(null);
  }
  pointerCancel(): void {
    this.down = null;
  }
  pointerUp(p: ToolPointer): void {
    const d = this.down;
    this.down = null;
    if (!d || p.button !== 0 || Math.hypot(p.clientX - d.x, p.clientY - d.y) > clickSlop(p.type)) return;
    this.game.select(this.game.renderer.pick(p.clientX, p.clientY));
  }
}
