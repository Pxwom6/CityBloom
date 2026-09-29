import { TERRAFORM, TERRAFORM_MODES, type TerraformMode } from '../data/terraform';
import { SHORE_HEIGHT } from '../data/world';
import type { Command, CommandResult } from '../sim/commands';
import type { Vec2 } from '../sim/geom';
import type { Game } from '../game';
import type { Tool, ToolPointer } from './tool';

let strokeCounter = 1;

const COLOUR: Record<TerraformMode, string> = {
  raise: '#f0c36a',
  lower: '#8fb8e8',
  level: '#ffffff',
  smooth: '#a8e0a0',
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/**
 * Terraforming (M24): raise, lower, level or smooth the ground with a round brush. Holding the
 * button keeps working the ground under it; a drag is one undo step. The level tool flattens to
 * the height where the drag began. The hint shows what a pass costs, or why the ground won't move.
 */
export class TerrainTool implements Tool {
  readonly id = 'terrain';
  readonly usesLeftDrag = true;
  mode: TerraformMode = 'raise';
  radius: number = TERRAFORM.radius.initial;
  private painting = false;
  private at: Vec2 | null = null;
  private last: Vec2 | null = null;
  private level = 0;
  private stroke = 0;
  private busy = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Spent this drag, and the last refusal (shown in the hint). */
  private spent = 0;
  private note: string | null = null;
  private preview: { key: string; text: string; bad: boolean } | null = null;
  private previewing = false;
  private lastSound = 0;
  private pointer: ToolPointer | null = null;

  constructor(private game: Game) {}

  activate(): void {
    this.note = null;
  }

  deactivate(): void {
    this.stop();
    this.game.renderer.ghost.showBrush(null, 1);
    this.game.setHint(null);
  }

  cancel(): boolean {
    const was = this.painting;
    this.stop();
    return was;
  }

  setMode(m: TerraformMode): void {
    this.mode = m;
    this.preview = null;
    this.game.notify();
    if (this.pointer) this.pointerMove(this.pointer);
  }

  private stop(): void {
    this.painting = false;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private command(points: Vec2[]): Command {
    return {
      type: 'terraform',
      mode: this.mode,
      points,
      radius: this.radius,
      ...(this.mode === 'level' ? { level: this.level } : {}),
      stroke: this.stroke,
    };
  }

  private apply(points: Vec2[]): void {
    if (this.busy) return;
    this.busy = true;
    void this.game.dispatch(this.command(points)).then((r: CommandResult) => {
      this.busy = false;
      if (r.ok) {
        this.spent += r.cost;
        this.note = null;
        const now = performance.now();
        if (now - this.lastSound > 260) {
          this.game.audio?.play('earth');
          this.lastSound = now;
        }
      } else {
        this.note = r.reason;
        if (r.reason === 'Not enough money') {
          this.stop();
          this.game.toast('Not enough money to move more earth', 'bad');
          this.game.audio?.play('error');
        }
      }
      if (this.pointer) this.showHint(this.pointer);
    });
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    const at = { x: p.ground.x, z: p.ground.z };
    this.stroke = strokeCounter++;
    this.level = Math.max(SHORE_HEIGHT + 0.1, this.game.world.heightAt(at.x, at.z));
    this.painting = true;
    this.spent = 0;
    this.note = null;
    this.at = at;
    this.last = at;
    this.apply([at]);
    // Holding still keeps working the ground under the brush.
    this.timer = setInterval(() => {
      if (this.painting && this.at && !this.busy) {
        this.apply([this.at]);
        this.last = this.at;
      }
    }, 160);
  }

  pointerMove(p: ToolPointer): void {
    this.pointer = p;
    this.at = p.ground ? { x: p.ground.x, z: p.ground.z } : null;
    this.game.renderer.ghost.showBrush(p.ground, this.radius, COLOUR[this.mode]);
    if (this.painting && this.at && this.last && !this.busy) {
      if (Math.hypot(this.at.x - this.last.x, this.at.z - this.last.z) >= this.radius / 4) {
        this.apply([this.last, this.at]);
        this.last = this.at;
      }
    }
    if (!this.painting) this.requestPreview();
    this.showHint(p);
  }

  pointerUp(): void {
    if (!this.painting) return;
    this.stop();
    if (this.spent > 0) this.game.toast(`Landscaping: ${money(this.spent)}`, 'info', 2000);
  }

  /** What one pass here would cost, or why the ground won't move (asked of the sim, throttled). */
  private requestPreview(): void {
    if (!this.at || this.previewing) return;
    const level = Math.max(SHORE_HEIGHT + 0.1, this.game.world.heightAt(this.at.x, this.at.z));
    const key = `${this.mode}|${this.radius}|${Math.round(this.at.x / 8)}|${Math.round(this.at.z / 8)}`;
    if (this.preview?.key === key) return;
    this.previewing = true;
    const cmd: Command = {
      type: 'terraform',
      mode: this.mode,
      points: [this.at],
      radius: this.radius,
      ...(this.mode === 'level' ? { level } : {}),
    };
    void this.game.client.preview(cmd).then((r) => {
      this.previewing = false;
      // Levelling at the height under the cursor changes nothing there; the first pass of a drag
      // is what counts, so a level preview only says what holds the ground.
      const text = r.ok
        ? this.mode === 'level'
          ? 'Drag to flatten to the height where you start'
          : `about ${money(r.cost)} a pass`
        : r.reason === 'Already level'
          ? 'Drag to flatten to the height where you start'
          : r.reason;
      this.preview = { key, text, bad: !r.ok && r.reason !== 'Already level' };
      if (this.pointer && !this.painting) this.showHint(this.pointer);
      if (this.pointer && !this.painting) this.requestPreview();
    });
  }

  private showHint(p: ToolPointer): void {
    const name = TERRAFORM_MODES.find((m) => m.id === this.mode)!.name;
    let text: string;
    let tone: 'info' | 'bad' = 'info';
    if (this.painting) {
      const what = this.mode === 'level' ? `Levelling to ${this.level.toFixed(1)} m` : name;
      text = `${what} · ${money(this.spent)} so far`;
      if (this.note) {
        text += ` · ${this.note}`;
        tone = 'bad';
      }
    } else {
      text = `${name} · brush ${this.radius} m ([ ]) · Tab: next tool`;
      if (this.preview) {
        text += ` · ${this.preview.text}`;
        if (this.preview.bad) tone = 'bad';
      }
    }
    this.game.setHint({ x: p.clientX, y: p.clientY, text, tone });
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'BracketLeft') this.radius = Math.max(TERRAFORM.radius.min, this.radius - 16);
    else if (e.code === 'BracketRight') this.radius = Math.min(TERRAFORM.radius.max, this.radius + 16);
    else if (e.code === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const i = TERRAFORM_MODES.findIndex((m) => m.id === this.mode);
      const n = TERRAFORM_MODES.length;
      this.setMode(TERRAFORM_MODES[(i + (e.shiftKey ? n - 1 : 1)) % n]!.id);
      return true;
    } else return false;
    this.preview = null;
    this.game.notify();
    if (this.pointer) this.pointerMove(this.pointer);
    return true;
  }
}
