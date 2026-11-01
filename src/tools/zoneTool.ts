import type { ZoneLetter } from '../data/zones';
import type { Vec2 } from '../sim/geom';
import type { Game } from '../game';
import type { CommandResult } from '../sim/commands';
import type { Tool, ToolPointer } from './tool';

const BRUSH_COLOURS: Record<ZoneLetter | 'none', string> = {
  R: '#58c27d',
  C: '#4d9bf5',
  I: '#f3b93a',
  none: '#ffffff',
};
let strokeCounter = 1;

/**
 * Zone painting with a round brush along the drag path; shift-click fills both sides of a road.
 * Only empty, valid cells change. Each drag is one undo step.
 */
export class ZoneTool implements Tool {
  readonly id = 'zone';
  readonly usesLeftDrag = true;
  zone: ZoneLetter | 'none' = 'R';
  radius = 24;
  private painting = false;
  private last: Vec2 | null = null;
  private stroke = 0;
  /** The stroke whose refusal has been shown (a drag paints every few metres: say it once). */
  private told = 0;

  constructor(private game: Game) {}

  activate(): void {
    this.game.renderer.zones.setGridVisible(true);
  }

  deactivate(): void {
    this.painting = false;
    this.game.renderer.zones.setGridVisible(false);
    this.game.renderer.ghost.showBrush(null, 1);
    this.game.setHint(null);
  }

  cancel(): boolean {
    const was = this.painting;
    this.painting = false;
    return was;
  }

  private paint(points: Vec2[]): void {
    const stroke = this.stroke;
    void this.game
      .dispatch({
        type: 'zone',
        zone: this.zone,
        area: { kind: 'brush', points, radius: this.radius },
        stroke,
      })
      .then((r) => this.report(r, stroke));
  }

  /**
   * Say why a brush painted nothing, or only part (M40: fallout closes ground to building, and the
   * sim's words give the years left), once for a drag; a click on a road (`stroke` 0) says it each time.
   */
  private report(r: CommandResult, stroke: number): void {
    if (stroke !== 0 && this.told === stroke) return;
    const closed = r.ok ? (r.info?.closed as number | undefined) : 0;
    if (r.ok && !closed) return;
    const why = r.ok ? (r.info?.closedWhy as string | undefined) : r.reason;
    if (!why) return;
    if (stroke !== 0) this.told = stroke;
    this.game.audio?.play('error');
    this.game.toast(r.ok ? `Part of this ground is closed and was left unpainted. ${why}` : why, 'bad', 5000);
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    if (p.shift) {
      const hit = this.game.world.net.nearestSegment(p.ground, 20);
      if (hit)
        void this.game
          .dispatch({ type: 'zone', zone: this.zone, area: { kind: 'segment', id: hit.seg } })
          .then((r) => this.report(r, 0));
      return;
    }
    this.painting = true;
    this.stroke = strokeCounter++;
    this.last = { x: p.ground.x, z: p.ground.z };
    this.paint([this.last]);
    this.game.audio?.play('zone');
  }

  pointerMove(p: ToolPointer): void {
    const g = this.game.renderer.ghost;
    g.showBrush(p.ground, this.radius, BRUSH_COLOURS[this.zone]);
    const name =
      this.zone === 'none'
        ? 'Dezone'
        : `${{ R: 'Residential', C: 'Commercial', I: 'Industrial' }[this.zone]} zone`;
    this.game.setHint({
      x: p.clientX,
      y: p.clientY,
      text: `${name} · brush ${this.radius} m ([ ]) · shift-click fills a road`,
      tone: 'info',
    });
    if (!this.painting || !p.ground || !this.last) return;
    if (Math.hypot(p.ground.x - this.last.x, p.ground.z - this.last.z) < this.radius / 3) return;
    const next = { x: p.ground.x, z: p.ground.z };
    this.paint([this.last, next]);
    this.last = next;
  }

  pointerUp(): void {
    this.painting = false;
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'BracketLeft') this.radius = Math.max(8, this.radius - 8);
    else if (e.code === 'BracketRight') this.radius = Math.min(96, this.radius + 8);
    else return false;
    this.game.notify();
    return true;
  }

  setZone(z: ZoneLetter | 'none'): void {
    this.zone = z;
    this.game.notify();
  }
}
