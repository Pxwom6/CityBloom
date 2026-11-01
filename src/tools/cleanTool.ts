import { FALLOUT } from '../data/atom';
import type { Game } from '../game';
import type { OverlayMap } from '../sim/systems/overlays';
import { cleanupHint } from '../ui/atomView';
import type { Tool, ToolPointer } from './tool';

/**
 * Send a clean-up crew onto fallout (M40 step 11): the radiation map shows where the ground is closed,
 * a ring shows how far a crew reaches (`FALLOUT.cleanup.radius`) and its price, and a click hires the
 * crew. The sim decides (`cleanFallout`): a spot that is clean enough, three crews already out, a crew
 * working there or a short treasury is refused in its own words, shown where the pointer is. The tool
 * stays out after a crew is sent, for the next one, until Escape, a right click or the bar's Done.
 */
export class CleanTool implements Tool {
  readonly id = 'cleanup';
  readonly usesLeftDrag = false;
  readonly clickOnly = true;
  private pointer = { x: 0, y: 0 };
  private seq = 0;
  /** The map that was out before the tool opened the radiation map, to put back; undefined: the tool didn't change it. */
  private restore: OverlayMap | null | undefined;

  constructor(private game: Game) {}

  activate(): void {
    const o = this.game.overlay;
    this.restore = o.active === 'radiation' ? undefined : o.active;
    if (o.active !== 'radiation') o.set('radiation');
    // The war room covers the map on a narrow screen, and the tool needs it: its bar has the way back.
    if (this.game.panel === 'war') this.game.openPanel('war');
    this.game.notify();
  }

  deactivate(): void {
    // A preview still on its way back must not draw the ring or a hint on the next tool (P11).
    this.seq++;
    this.game.renderer.ghost.showBrush(null, 1);
    this.game.setHint(null);
    if (this.restore !== undefined && this.game.overlay.active === 'radiation')
      this.game.overlay.set(this.restore);
    this.restore = undefined;
  }

  cancel(): boolean {
    return false;
  }

  pointerMove(p: ToolPointer): void {
    this.pointer = { x: p.clientX, y: p.clientY };
    if (!p.ground) return;
    const seq = ++this.seq;
    const at = { x: p.ground.x, z: p.ground.z };
    void this.game.client.preview({ type: 'cleanFallout', x: at.x, z: at.z }).then((r) => {
      if (seq !== this.seq) return;
      this.game.renderer.ghost.showBrush(at, FALLOUT.cleanup.radius, r.ok ? '#e8b43a' : '#d2493b');
      this.game.setHint({
        ...this.pointer,
        text: r.ok ? cleanupHint(r.cost, !!r.info?.relief) : r.reason,
        tone: r.ok ? 'ok' : 'bad',
      });
    });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    this.pointer = { x: p.clientX, y: p.clientY };
    const at = { x: p.ground.x, z: p.ground.z };
    void this.game.dispatch({ type: 'cleanFallout', x: at.x, z: at.z }).then((r) => {
      if (r.ok) {
        this.game.audio?.play('place');
        this.game.toast('A clean-up crew is at work there', 'ok', 2500);
        // The ring shows the crew's ground until the pointer moves; the next preview says what a second would cost.
        this.pointerMove(p);
      } else {
        this.game.audio?.play('error');
        this.game.setHint({ ...this.pointer, text: r.reason, tone: 'bad' });
      }
    });
  }

  pointerUp(): void {}
}
