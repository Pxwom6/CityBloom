import type { Vec2 } from '../sim/geom';
import type { Game } from '../game';
import { districtColour } from '../client/districtView';
import type { Tool, ToolPointer } from './tool';

let strokeCounter = 1;

/**
 * District painting (M21): a round brush along the drag, one undo step per drag. `district` is the
 * one being painted, 0 erases, and 'new' starts a district where the stroke begins, named after the
 * neighbourhood there.
 */
export class DistrictTool implements Tool {
  readonly id = 'district';
  readonly usesLeftDrag = true;
  district: number | 'new' = 'new';
  radius = 48;
  private painting = false;
  private last: Vec2 | null = null;
  private stroke = 0;
  private busy = false;

  constructor(private game: Game) {}

  activate(): void {
    const w = this.game.world;
    if (this.district !== 'new' && this.district !== 0 && !w.districts.has(this.district))
      this.district = 'new';
    this.game.districts.selected = typeof this.district === 'number' ? this.district : 0;
    // The panel comes with the tool, for names, figures and policies.
    if (this.game.panel !== 'districts') this.game.openPanel('districts');
  }

  deactivate(): void {
    // The panel goes with the tool, so it doesn't cover the map for the next one.
    if (this.game.panel === 'districts') this.game.openPanel('districts');
    this.painting = false;
    this.game.renderer.ghost.showBrush(null, 1);
    this.game.setHint(null);
  }

  cancel(): boolean {
    const was = this.painting;
    this.painting = false;
    return was;
  }

  /** The neighbourhood's name, numbered if a district already has it ("Southmead 2"). */
  defaultName(at: Vec2): string {
    const base = this.game.names.generatedNeighbourhood(at.x, at.z);
    const taken = new Set([...this.game.world.districts.values()].map((d) => d.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  /** Pick the district to paint (0 erases, 'new' starts one with the next stroke). */
  pick(d: number | 'new'): void {
    this.district = d;
    this.game.districts.selected = typeof d === 'number' ? d : 0;
    this.game.notify();
  }

  private paint(points: Vec2[]): void {
    if (this.district === 'new') return;
    void this.game.dispatch({
      type: 'paintDistrict',
      district: this.district,
      area: { kind: 'brush', points, radius: this.radius },
      stroke: this.stroke,
    });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground || this.busy) return;
    const at = { x: p.ground.x, z: p.ground.z };
    this.stroke = strokeCounter++;
    this.last = at;
    this.painting = true;
    if (this.district === 'new') {
      // A new district takes the name the map already gives this place.
      this.busy = true;
      const name = this.defaultName(at);
      void this.game.dispatch({ type: 'createDistrict', name }).then((r) => {
        this.busy = false;
        if (!r.ok) {
          this.painting = false;
          this.game.toast(r.reason, 'bad');
          return;
        }
        this.pick(r.created![0]!);
        this.game.toast(`New district: ${name}. Rename it in the Districts panel.`, 'ok', 3000);
        this.paint([at]);
      });
    } else this.paint([at]);
    this.game.audio?.play('zone');
  }

  pointerMove(p: ToolPointer): void {
    const w = this.game.world;
    const d = typeof this.district === 'number' ? w.districts.get(this.district) : undefined;
    this.game.renderer.ghost.showBrush(
      p.ground,
      this.radius,
      this.district === 0 ? '#ffffff' : d ? districtColour(d.color) : '#ffffff',
    );
    const what =
      this.district === 0
        ? 'Erase districts'
        : d
          ? `Paint ${d.name}`
          : `New district${p.ground ? `: ${this.defaultName(p.ground)}` : ''}`;
    this.game.setHint({
      x: p.clientX,
      y: p.clientY,
      text: `${what} · brush ${this.radius} m ([ ])`,
      tone: 'info',
    });
    if (!this.painting || !p.ground || !this.last || this.busy) return;
    if (Math.hypot(p.ground.x - this.last.x, p.ground.z - this.last.z) < this.radius / 3) return;
    const next = { x: p.ground.x, z: p.ground.z };
    this.paint([this.last, next]);
    this.last = next;
  }

  pointerUp(): void {
    this.painting = false;
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'BracketLeft') this.radius = Math.max(16, this.radius - 16);
    else if (e.code === 'BracketRight') this.radius = Math.min(192, this.radius + 16);
    else return false;
    this.game.notify();
    return true;
  }
}
