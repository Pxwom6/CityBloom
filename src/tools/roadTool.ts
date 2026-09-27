import { ROAD_TYPES, type RoadTypeId } from '../data/roads';
import type { Command, CommandResult } from '../sim/commands';
import { mid, type Vec2 } from '../sim/geom';
import type { Game } from '../game';
import { fitFreeform, snapPoint, type SnapResult } from './snap';
import type { Tool, ToolPointer } from './tool';
import type { GhostProfile } from '../render/ghost';

/** What a road build preview reports (see buildRoad in src/sim/actions/roads.ts). */
interface PreviewInfo {
  pieces?: { a: Vec2; c: Vec2; b: Vec2 }[];
  grade?: {
    limit: number;
    max: number;
    ground: number;
    earth: { volume: number; cost: number } | null;
    viaduct: number;
    pieces: (GhostProfile | null)[];
  };
}

/** Upgrade hint notes (M13): regrading a road for a gentler type costs earthworks. */
function upgradeNotes(info: unknown): string[] {
  const earth = (info as { earth?: { cost: number } | null } | undefined)?.earth;
  return earth && earth.cost > 0 ? [`earthworks $${earth.cost.toLocaleString('en-US')}`] : [];
}

/** Hint notes on grading (M13): how steep it climbs against the limit, earthworks and viaducts. */
export function gradeNotes(info: PreviewInfo | undefined): string[] {
  const g = info?.grade;
  if (!g) return [];
  const pct = (v: number) => `${Math.round(v * 100)}\u00a0%`;
  const out: string[] = [];
  if (g.max >= 0.02) out.push(`climbs ${pct(g.max)} (max ${pct(g.limit)})`);
  if (g.earth && g.earth.cost > 0) out.push(`earthworks $${g.earth.cost.toLocaleString('en-US')}`);
  if (g.viaduct > 0) out.push(`${g.viaduct} m on a viaduct`);
  return out;
}

export type RoadMode = 'straight' | 'curve' | 'free' | 'upgrade';

/**
 * Road drawing. Straight: drag or click–click (chains from the last end). Curve: click start,
 * click the bend, click the end. Free-form: press and draw. Ghost colour and cost come from sim
 * previews of the exact command that a click would send. Upgrade: click a road to change it to the
 * selected type in place.
 */
export class RoadTool implements Tool {
  readonly id = 'road';
  readonly usesLeftDrag = true;
  type: RoadTypeId = 'street';
  mode: RoadMode = 'straight';
  grid = false;
  private start: SnapResult | null = null;
  private control: Vec2 | null = null;
  private cursor: SnapResult | null = null;
  private dragging = false;
  private downAt: { x: number; y: number } | null = null;
  private freePath: Vec2[] = [];
  private previewSeq = 0;
  private inFlight = false;
  private queued: Command | null = null;
  private lastResult: { seq: number; res: CommandResult } | null = null;
  private lastSentSeq = 0;
  private pointer = { x: 0, y: 0 };
  /** Upgrade mode: the road under the cursor. */
  private hoverSeg: number | null = null;
  /** A preview has needed real earthworks or run into steep ground (drives a one-time tip). */
  sawEarthworks = false;

  constructor(private game: Game) {}

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
    this.game.renderer.ghost.clear();
    this.game.setHint(null);
  }

  private reset(): void {
    this.hoverSeg = null;
    this.game.renderer.ghost.highlightSegment(null, 0);
    this.start = null;
    this.control = null;
    this.dragging = false;
    this.freePath = [];
    this.lastResult = null;
    this.game.renderer.ghost.showRoad(null, this.type, 'ok');
    this.game.renderer.ghost.showMarker(null);
  }

  cancel(): boolean {
    const had = !!this.start || this.freePath.length > 0;
    this.reset();
    this.refresh();
    return had;
  }

  private snapScale(): number {
    return Math.max(1, this.game.renderer.controller.current.distance / 500);
  }

  private snap(p: Vec2, from: SnapResult | null): SnapResult {
    return snapPoint(this.game.world.net, p, { from, grid: this.grid, scale: this.snapScale() });
  }

  /** Command for the current geometry, or null if there is nothing to build yet. */
  private currentCommand(): Command | null {
    const c = this.cursor;
    if (this.mode === 'upgrade')
      return this.hoverSeg !== null ? { type: 'upgradeRoad', seg: this.hoverSeg, road: this.type } : null;
    if (this.mode === 'free') {
      if (this.freePath.length < 2) return null;
      return { type: 'buildRoad', road: this.type, points: fitFreeform(this.freePath) };
    }
    if (!this.start || !c) return null;
    if (Math.hypot(c.x - this.start.x, c.z - this.start.z) < 1) return null;
    if (this.mode === 'curve' && this.control)
      return { type: 'buildRoad', road: this.type, points: [this.start, this.control, c] };
    return { type: 'buildRoad', road: this.type, points: [this.start, c] };
  }

  private requestPreview(cmd: Command | null): void {
    const seq = ++this.previewSeq;
    if (!cmd) return;
    if (this.inFlight) {
      this.queued = cmd;
      return;
    }
    this.inFlight = true;
    this.lastSentSeq = seq;
    void this.game.client.preview(cmd).then((res) => {
      this.inFlight = false;
      this.lastResult = { seq: this.lastSentSeq, res };
      this.drawGhost();
      if (this.queued) {
        const q = this.queued;
        this.queued = null;
        this.requestPreview(q);
      }
    });
  }

  private drawUpgrade(): void {
    const g = this.game.renderer.ghost;
    g.showRoad(null, this.type, 'ok');
    const id = this.hoverSeg;
    const net = this.game.world.net;
    if (id === null || !this.game.world.netState.segments.has(id)) {
      g.highlightSegment(null, 0);
      g.showMarker(null);
      this.game.setHint({
        ...this.pointer,
        text: `Click a road to make it ${ROAD_TYPES[this.type].name.toLowerCase()}`,
        tone: 'info',
      });
      return;
    }
    const res = this.lastResult?.res;
    const from = ROAD_TYPES[net.segment(id).type].name;
    const half = ROAD_TYPES[this.type].width / 2 + ROAD_TYPES[this.type].sidewalk;
    g.highlightSegment(net.curve(id), half, res && !res.ok ? 'bad' : 'ok');
    g.showMarker(res && !res.ok && res.at ? res.at : null);
    if (!res)
      this.game.setHint({ ...this.pointer, text: `${from} → ${ROAD_TYPES[this.type].name}`, tone: 'info' });
    else if (res.ok)
      this.game.setHint({
        ...this.pointer,
        text: [
          `${from} → ${ROAD_TYPES[this.type].name} · $${res.cost.toLocaleString('en-US')}`,
          ...upgradeNotes(res.info),
        ].join(' · '),
        tone: 'ok',
      });
    else this.game.setHint({ ...this.pointer, text: res.reason, tone: 'bad' });
  }

  private drawGhost(): void {
    if (this.mode === 'upgrade') {
      this.drawUpgrade();
      return;
    }
    const g = this.game.renderer.ghost;
    const cmd = this.currentCommand();
    if (!cmd || cmd.type !== 'buildRoad') {
      g.showRoad(null, this.type, 'ok');
      g.showMarker(null);
      this.hintIdle();
      return;
    }
    const pts =
      cmd.points.length === 2
        ? [cmd.points[0]!, mid(cmd.points[0]!, cmd.points[1]!), cmd.points[1]!]
        : cmd.points;
    const pieces: { a: Vec2; c: Vec2; b: Vec2 }[] = [];
    for (let i = 0; i + 2 < pts.length; i += 2) pieces.push({ a: pts[i]!, c: pts[i + 1]!, b: pts[i + 2]! });
    const res = this.lastResult?.res;
    const fresh = this.lastResult && this.lastResult.seq === this.previewSeq;
    const state = !res ? 'pending' : res.ok ? 'ok' : 'bad';
    // A fresh preview carries the planned pieces (split at junctions) and their graded profiles.
    const info = fresh ? (res?.info as PreviewInfo | undefined) : undefined;
    const earth = info?.grade?.earth?.cost ?? 0;
    if ((res?.ok && earth > 0.25 * res.cost) || (res && !res.ok && /steep/i.test(res.reason)))
      this.sawEarthworks = true;
    const planned = info?.grade && info.pieces?.length === info.grade.pieces.length ? info : undefined;
    g.showRoad(
      planned?.pieces ?? pieces,
      this.type,
      fresh || !res ? state : state === 'ok' ? 'ok' : 'bad',
      planned ? planned.grade : null,
    );
    g.showMarker(res && !res.ok && res.at ? res.at : null);
    const len = pieces.reduce((s, p) => s + Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z), 0);
    if (!res)
      this.game.setHint({ x: this.pointer.x, y: this.pointer.y, text: `${Math.round(len)} m`, tone: 'info' });
    else if (res.ok)
      this.game.setHint({
        x: this.pointer.x,
        y: this.pointer.y,
        text: [`$${res.cost.toLocaleString('en-US')} · ${Math.round(len)} m`, ...gradeNotes(info)].join(
          ' · ',
        ),
        tone: 'ok',
      });
    else this.game.setHint({ x: this.pointer.x, y: this.pointer.y, text: res.reason, tone: 'bad' });
  }

  private hintIdle(): void {
    const rt = ROAD_TYPES[this.type];
    const what =
      this.mode === 'curve'
        ? this.start
          ? this.control
            ? 'Click to finish the curve'
            : 'Click to set the bend'
          : 'Click to start a curve'
        : this.mode === 'free'
          ? 'Press and draw'
          : this.start
            ? 'Click or release to place'
            : 'Click or drag to draw';
    this.game.setHint({
      x: this.pointer.x,
      y: this.pointer.y,
      text: `${rt.name} · $${rt.costPerMetre}/m — ${what}`,
      tone: 'info',
    });
  }

  private refresh(): void {
    this.drawGhost();
    this.requestPreview(this.currentCommand());
    this.game.renderer.ghost.showSnap(
      this.cursor && (this.cursor.kind === 'node' || this.cursor.kind === 'segment') ? this.cursor : null,
    );
  }

  private async commitUpgrade(): Promise<void> {
    const cmd = this.currentCommand();
    if (!cmd || cmd.type !== 'upgradeRoad') return;
    const res = await this.game.dispatch(cmd);
    if (res.ok) {
      this.game.audio?.play('build');
      this.game.toast(`Road changed to ${ROAD_TYPES[cmd.road].name.toLowerCase()}`, 'ok', 2000);
      this.lastResult = null;
    } else {
      this.game.audio?.play('error');
      this.lastResult = { seq: this.previewSeq, res };
    }
    this.refresh();
  }

  /**
   * Build the road being drawn. Click–click drawing keeps going from where the road ended (`chain`);
   * a drag draws one road, so the next drag starts wherever the player presses. A drag that can't be
   * built starts over too, with the reason in a toast (the ghost showed it red while dragging).
   */
  private async commit(chain = true): Promise<boolean> {
    const cmd = this.currentCommand();
    if (!cmd || cmd.type !== 'buildRoad') return false;
    const res = await this.game.dispatch(cmd);
    if (res.ok) {
      this.game.audio?.play('build');
      const end = cmd.points[cmd.points.length - 1]!;
      this.reset();
      if (this.mode !== 'free' && chain) this.start = this.snap(end, null);
    } else {
      this.game.audio?.play('error');
      if (chain) this.lastResult = { seq: this.previewSeq, res };
      else {
        this.reset();
        const why = res.reason.charAt(0).toLowerCase() + res.reason.slice(1);
        this.game.toast(`Can't build that road: ${why}.`, 'bad', 3000);
      }
    }
    this.refresh();
    return res.ok;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    this.pointer = { x: p.clientX, y: p.clientY };
    this.downAt = { x: p.clientX, y: p.clientY };
    if (this.mode === 'upgrade') {
      void this.commitUpgrade();
      return;
    }
    if (this.mode === 'free') {
      const s = this.snap(p.ground, null);
      this.freePath = [s];
      this.dragging = true;
      this.refresh();
      return;
    }
    if (this.mode === 'curve') {
      if (!this.start) this.start = this.snap(p.ground, null);
      else if (!this.control) this.control = { x: p.ground.x, z: p.ground.z };
      else void this.commit();
      this.cursor = this.snap(p.ground, this.control ? null : this.start);
      this.refresh();
      return;
    }
    if (!this.start) {
      this.start = this.snap(p.ground, null);
      this.dragging = true;
    } else {
      void this.commit();
    }
  }

  pointerMove(p: ToolPointer): void {
    this.pointer = { x: p.clientX, y: p.clientY };
    if (!p.ground) return;
    if (this.mode === 'upgrade') {
      const net = this.game.world.net;
      const hit = net.nearestSegment(p.ground, 14, (id) => ROAD_TYPES[net.segment(id).type].buildable);
      const id = hit ? hit.seg : null;
      if (id !== this.hoverSeg) {
        this.hoverSeg = id;
        this.lastResult = null;
      }
      this.refresh();
      return;
    }
    if (this.mode === 'free' && this.dragging) {
      const last = this.freePath[this.freePath.length - 1]!;
      if (Math.hypot(p.ground.x - last.x, p.ground.z - last.z) >= 6)
        this.freePath.push({ x: p.ground.x, z: p.ground.z });
      this.cursor = { x: p.ground.x, z: p.ground.z, kind: 'free' };
      this.refresh();
      return;
    }
    const from = this.mode === 'curve' && this.control ? null : this.start;
    this.cursor = this.snap(p.ground, from);
    this.refresh();
  }

  pointerUp(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.pointer = { x: p.clientX, y: p.clientY };
    if (this.mode === 'free' && this.dragging) {
      this.dragging = false;
      if (p.ground) {
        const end = this.snap(p.ground, null);
        this.freePath.push(end);
      }
      void this.commit();
      return;
    }
    if (this.mode === 'straight' && this.dragging) {
      this.dragging = false;
      const moved = this.downAt ? Math.hypot(p.clientX - this.downAt.x, p.clientY - this.downAt.y) : 0;
      if (moved > 8) void this.commit(false);
    }
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === 'KeyG') {
      this.grid = !this.grid;
      this.game.notify();
      return true;
    }
    if (e.code === 'Tab') {
      this.mode =
        this.mode === 'straight'
          ? 'curve'
          : this.mode === 'curve'
            ? 'free'
            : this.mode === 'free'
              ? 'upgrade'
              : 'straight';
      this.reset();
      this.game.notify();
      return true;
    }
    return false;
  }

  setType(t: RoadTypeId): void {
    this.type = t;
    this.refresh();
    this.game.notify();
  }

  setMode(m: RoadMode): void {
    this.mode = m;
    this.reset();
    this.refresh();
    this.game.notify();
  }
}
