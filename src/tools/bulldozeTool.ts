import type { BulldozeTarget } from '../sim/commands';
import type { Game } from '../game';
import type { Tool, ToolPointer } from './tool';
import { CIVIC } from '../data/civic';

/** Click a building, civic building or road to demolish it. Hovering shows what would go. */
export class BulldozeTool implements Tool {
  readonly id = 'bulldoze';
  readonly usesLeftDrag = false;
  readonly clickOnly = true;
  private hover: string | null = null;
  private hoverInfo: string | null = null;
  private seq = 0;

  constructor(private game: Game) {}

  activate(): void {}

  deactivate(): void {
    // A preview still on its way back must not draw a hint on the next tool (P11).
    this.seq++;
    this.hover = null;
    this.game.renderer.ghost.highlightSegment(null, 0);
    this.game.renderer.ghost.showSelection(null);
    this.game.setHint(null);
  }

  cancel(): boolean {
    return false;
  }

  private pick(p: ToolPointer): BulldozeTarget | null {
    const hitB = this.game.renderer.pick(p.clientX, p.clientY);
    if (hitB?.kind === 'civic' || hitB?.kind === 'building') return { kind: hitB.kind, id: hitB.id };
    if (!p.ground) return null;
    const stop = this.game.world.stopAt(p.ground.x, p.ground.z, 8);
    if (stop) return { kind: 'stop', id: stop.id };
    const net = this.game.world.net;
    const hit = net.nearestSegment(p.ground, 14);
    if (!hit || hit.d > net.halfWidth(hit.seg) + 1) return null;
    return { kind: 'segment', id: hit.seg };
  }

  private describe(t: BulldozeTarget, refund: number, buildings: number): string {
    const money = refund > 0 ? ` · refund $${refund.toLocaleString('en-US')}` : '';
    if (t.kind === 'segment')
      return `Bulldoze road${money}${buildings ? ` · demolishes ${buildings} building${buildings > 1 ? 's' : ''}` : ''}`;
    if (t.kind === 'stop') return `Remove bus stop${money}`;
    if (t.kind === 'civic')
      return `Bulldoze ${CIVIC.get(this.game.world.civics.get(t.id)?.def ?? '')?.name ?? 'building'}${money}`;
    return 'Bulldoze building';
  }

  private highlight(t: BulldozeTarget | null): void {
    const g = this.game.renderer.ghost;
    const net = this.game.world.net;
    g.highlightSegment(
      t?.kind === 'segment' ? net.curve(t.id) : null,
      t?.kind === 'segment' ? net.halfWidth(t.id) : 0,
    );
    if (t?.kind === 'building') {
      const b = this.game.world.buildings.get(t.id);
      g.showSelection(b ? { x: b.x, z: b.z, hw: b.w * 4, hd: b.d * 4, angle: b.angle } : null);
    } else if (t?.kind === 'civic') {
      const c = this.game.world.civics.get(t.id);
      const d = c ? CIVIC.get(c.def) : undefined;
      g.showSelection(c && d ? { x: c.x, z: c.z, hw: d.w / 2, hd: d.d / 2, angle: c.angle } : null);
    } else if (t?.kind === 'stop') {
      const st = this.game.world.stops.get(t.id);
      g.showSelection(st ? { x: st.x, z: st.z, hw: 4, hd: 4, angle: 0 } : null);
    } else g.showSelection(null);
  }

  pointerMove(p: ToolPointer): void {
    const t = this.pick(p);
    const key = t ? `${t.kind}:${t.id}` : null;
    if (key !== this.hover) {
      this.hover = key;
      this.hoverInfo = null;
      this.highlight(t);
      if (t) {
        const seq = ++this.seq;
        void this.game.client.preview({ type: 'bulldoze', target: t }).then((r) => {
          if (seq !== this.seq) return;
          this.hoverInfo = r.ok
            ? this.describe(t, -r.cost, ((r.info?.buildings as number[]) ?? []).length)
            : r.reason;
          this.game.setHint({
            x: p.clientX,
            y: p.clientY,
            text: this.hoverInfo,
            tone: r.ok ? 'bad' : 'info',
          });
        });
      }
    }
    this.game.setHint(
      !t
        ? { x: p.clientX, y: p.clientY, text: 'Bulldozer — click a road or building', tone: 'info' }
        : { x: p.clientX, y: p.clientY, text: this.hoverInfo ?? 'Bulldoze', tone: 'bad' },
    );
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0) return;
    const t = this.pick(p);
    if (!t) return;
    void this.game.dispatch({ type: 'bulldoze', target: t }).then((r) => {
      if (r.ok) this.game.audio?.play('bulldoze');
      this.hover = null;
      this.highlight(null);
    });
  }

  pointerUp(): void {}
}
