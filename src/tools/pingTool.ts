import type { Game } from '../game';
import type { Tool, ToolPointer } from './tool';
import type { ToolId } from './manager';

/**
 * "Look here" by touch (multiplayer review, F11): the room panel's Ping button arms this for one tap
 * on the map, which points the others at that spot; then the tool before it comes back. With a
 * keyboard, Shift+G over the map does the same.
 */
export class PingTool implements Tool {
  readonly id = 'ping';
  readonly usesLeftDrag = false;
  readonly clickOnly = true;
  /** The tool to go back to after the ping. */
  back: ToolId = 'select';

  constructor(private game: Game) {}

  activate(): void {}

  deactivate(): void {
    this.game.setHint(null);
  }

  cancel(): boolean {
    return false;
  }

  pointerMove(p: ToolPointer): void {
    this.game.setHint({ x: p.clientX, y: p.clientY, text: 'Tap where the others should look', tone: 'info' });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    this.game.pingAt(p.ground);
    this.game.tools.use(this.back === 'ping' ? 'select' : this.back);
  }

  pointerUp(): void {}
}
