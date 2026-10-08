import { DISASTERS } from '../data/balance';
import type { Game } from '../game';
import { disasterReach, type DisasterKind } from '../sim/systems/disasters';
import type { Tool, ToolPointer } from './tool';

export const DISASTER_INFO: Record<DisasterKind, { name: string; blurb: string; aim: string }> = {
  earthquake: {
    name: 'Earthquake',
    blurb: 'Shakes everything within a few hundred metres: buildings fall, fires start, roads crack.',
    aim: 'Click the epicentre',
  },
  tornado: {
    name: 'Tornado',
    blurb: 'Touches down and tears a path through whatever lies ahead of it.',
    aim: 'Click where it touches down; it heads for the city',
  },
  flood: {
    name: 'Flood',
    blurb: 'Water rises over the low ground by a river, lake or coast, then drains away.',
    aim: 'Click beside the water',
  },
  meteor: {
    name: 'Meteor strike',
    blurb: 'Flattens everything in its crater and sets fires around it.',
    aim: 'Click the impact point',
  },
};

/** Aim a disaster: a ring shows how far it reaches; click to set it off. */
export class DisasterTool implements Tool {
  readonly id = 'disaster';
  readonly usesLeftDrag = false;
  readonly clickOnly = true;
  kind: DisasterKind = 'earthquake';
  private pointer = { x: 0, y: 0 };
  private seq = 0;

  constructor(private game: Game) {}

  setKind(kind: DisasterKind): void {
    this.kind = kind;
    this.game.notify();
  }

  /** Typical reach of the chosen disaster for the preview ring. */
  private reach(): number {
    if (this.kind === 'earthquake') return disasterReach('earthquake', 6.5);
    if (this.kind === 'tornado') return 60;
    if (this.kind === 'meteor') return disasterReach('meteor', 38);
    return DISASTERS.flood.radius;
  }

  activate(): void {}

  deactivate(): void {
    // A preview still on its way back must not draw the ring or a hint on the next tool (P11).
    this.seq++;
    this.game.renderer.ghost.showBrush(null, 1);
    this.game.setHint(null);
  }

  cancel(): boolean {
    return false;
  }

  pointerMove(p: ToolPointer): void {
    this.pointer = { x: p.clientX, y: p.clientY };
    if (!p.ground) return;
    const seq = ++this.seq;
    const at = { x: p.ground.x, z: p.ground.z };
    void this.game.client.preview({ type: 'disaster', kind: this.kind, at }).then((r) => {
      if (seq !== this.seq) return;
      this.game.renderer.ghost.showBrush(at, this.reach(), r.ok ? '#ff8a3d' : '#d2493b');
      const info = DISASTER_INFO[this.kind];
      this.game.setHint({
        ...this.pointer,
        text: r.ok ? `${info.name} · ${info.aim}` : r.reason,
        tone: r.ok ? 'ok' : 'bad',
      });
    });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    const at = { x: p.ground.x, z: p.ground.z };
    void this.game.dispatch({ type: 'disaster', kind: this.kind, at }).then((r) => {
      if (r.ok) this.game.tools.use('select');
      else {
        this.game.audio?.play('error');
        this.game.setHint({ ...this.pointer, text: r.reason, tone: 'bad' });
      }
    });
  }

  pointerUp(): void {}
}
