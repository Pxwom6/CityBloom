import { JUNCTION, TRAM } from '../data/balance';
import { ROAD_TYPES, type RoadTypeId } from '../data/roads';
import type { Command, CommandResult } from '../sim/commands';
import { compass, mid, type Vec2 } from '../sim/geom';
import type { Game } from '../game';
import { modKey } from '../client/platform';
import { fitFreeform, snapPoint, type SnapResult } from './snap';
import { CLICK_SLOP, type Tool, type ToolPointer } from './tool';
import type { GhostProfile } from '../render/ghost';

/** What a road build preview reports (see buildRoad in src/sim/actions/roads.ts). */
interface PreviewInfo {
  pieces?: { a: Vec2; c: Vec2; b: Vec2 }[];
  /** Buildings the road would demolish (P2). */
  demolished?: number[];
  grade?: {
    limit: number;
    max: number;
    ground: number;
    earth: { volume: number; cost: number } | null;
    viaduct: number;
    pieces: (GhostProfile | null)[];
  };
}

/** Buildings a road or an upgrade would demolish (P2), as a preview names them. */
function doomedOf(info: unknown): number[] {
  return (info as { demolished?: number[] } | undefined)?.demolished ?? [];
}

const articled = (name: string) =>
  /^[aeiou]/i.test(name) ? `an ${name.toLowerCase()}` : `a ${name.toLowerCase()}`;

/** P1: a road that joins nothing, or only roads that can't reach the highway, says so. */
export function linkNotes(info: unknown): string[] {
  const link = (info as { link?: string } | undefined)?.link;
  return link === 'none'
    ? ["Doesn't join any road"]
    : link === 'island'
      ? ['Not connected to the highway']
      : [];
}

const demolishes = (n: number) => `demolishes ${n} building${n === 1 ? '' : 's'}`;

/** Upgrade hint notes (M13): regrading a road for a gentler type costs earthworks; P2: what goes. */
function upgradeNotes(info: unknown): string[] {
  const earth = (info as { earth?: { cost: number } | null } | undefined)?.earth;
  const n = doomedOf(info).length;
  return [
    ...(earth && earth.cost > 0 ? [`earthworks $${earth.cost.toLocaleString('en-US')}`] : []),
    ...(n ? [demolishes(n)] : []),
  ];
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

export type RoadMode = 'straight' | 'curve' | 'free' | 'upgrade' | 'oneway' | 'roundabout' | 'tram';

const MODES: RoadMode[] = ['straight', 'curve', 'free', 'upgrade', 'oneway', 'roundabout', 'tram'];

export { compass };

/** Four quadratic pieces round a circle (the ghost of a roundabout's ring). */
function ringPieces(c: Vec2, r: number): { a: Vec2; c: Vec2; b: Vec2 }[] {
  const out: { a: Vec2; c: Vec2; b: Vec2 }[] = [];
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a0 = (Math.PI * 2 * k) / n;
    const a1 = (Math.PI * 2 * (k + 1)) / n;
    const am = (a0 + a1) / 2;
    const rc = r / Math.cos(Math.PI / n);
    out.push({
      a: { x: c.x + Math.cos(a0) * r, z: c.z + Math.sin(a0) * r },
      c: { x: c.x + Math.cos(am) * rc, z: c.z + Math.sin(am) * rc },
      b: { x: c.x + Math.cos(a1) * r, z: c.z + Math.sin(a1) * r },
    });
  }
  return out;
}

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
  /** New roads are one-way, in the direction they're drawn (M19; ramps always are). */
  oneWay = false;
  /** Roundabout mode: where the ring goes, and its radius while it's being dragged out. */
  private ring: { node?: number; at?: Vec2; centre: Vec2; radius?: number } | null = null;
  private ringDrag = false;
  private start: SnapResult | null = null;
  private control: Vec2 | null = null;
  private cursor: SnapResult | null = null;
  private dragging = false;
  private downAt: { x: number; y: number } | null = null;
  /** A press waiting to become a click (P3): done when the button comes up near where it went down. */
  private click: { x: number; y: number; run: () => void } | null = null;
  private freePath: Vec2[] = [];
  private previewSeq = 0;
  private inFlight = false;
  private queued: Command | null = null;
  /**
   * Bumped whenever the tool is entered, cancelled, left or changes mode (P11): the sim's answer to
   * anything sent before that is stale, and must not bring a chain or a hint back.
   */
  private epoch = 0;
  private lastResult: { seq: number; res: CommandResult } | null = null;
  private lastSentSeq = 0;
  private pointer = { x: 0, y: 0 };
  /** Upgrade mode: the road under the cursor. */
  private hoverSeg: number | null = null;
  /**
   * Tram mode (M20): while the button is held, every road the pointer passes gets the same change
   * as the first (laying or taking up track), as one undo step.
   */
  private tramPaint: { on: boolean; stroke: number; done: Set<number> } | null = null;
  private tramStrokes = 0;
  /** A preview has needed real earthworks or run into steep ground (drives a one-time tip). */
  sawEarthworks = false;

  constructor(private game: Game) {}

  activate(): void {
    this.abandon();
  }

  deactivate(): void {
    this.abandon();
    this.game.renderer.ghost.clear();
    this.game.setHint(null);
  }

  /**
   * Drop everything in progress and make the sim's answers to anything already sent stale. Not part
   * of `reset()`: a built road resets the tool too, and two quick clicks can have two builds in
   * flight whose chain must still move on.
   */
  private abandon(): void {
    this.epoch++;
    this.queued = null;
    // A press that was about to become a click (P3) must not fire after Escape. Not in `reset()`: a
    // road built while the next press is down must not eat that click.
    this.click = null;
    this.reset();
  }

  private reset(): void {
    // A question about the road being reset goes with it (P2).
    if (this.game.question) {
      this.game.question = null;
      this.game.notify();
    }
    this.hoverSeg = null;
    this.ring = null;
    this.ringDrag = false;
    this.game.renderer.ghost.highlightSegment(null, 0);
    this.start = null;
    this.control = null;
    this.dragging = false;
    this.freePath = [];
    this.lastResult = null;
    this.game.renderer.ghost.showRoad(null, this.type, 'ok');
    this.game.renderer.ghost.showMarker(null);
    this.game.renderer.ghost.showClear(null);
  }

  cancel(): boolean {
    // A question about demolishing first (P2): Escape keeps the buildings, and the road stays drawn.
    if (this.game.question) {
      this.game.answer(false);
      return true;
    }
    const had = !!this.start || this.freePath.length > 0;
    this.abandon();
    this.refresh();
    return had;
  }

  private snapScale(): number {
    return Math.max(1, this.game.renderer.controller.current.distance / 500);
  }

  /**
   * Snap a point of the road being drawn; `arriving` is where the road comes to it from (its start
   * or bend), so an end that nearly reaches a road joins it (P1).
   */
  private snap(p: Vec2, from: SnapResult | null, arriving: Vec2 | null = null): SnapResult {
    return snapPoint(this.game.world.net, p, {
      from,
      grid: this.grid,
      scale: this.snapScale(),
      near: ROAD_TYPES[this.type].access,
      arriving,
    });
  }

  /** Command for the current geometry, or null if there is nothing to build yet. */
  private currentCommand(): Command | null {
    const c = this.cursor;
    if (this.mode === 'upgrade')
      return this.hoverSeg !== null ? { type: 'upgradeRoad', seg: this.hoverSeg, road: this.type } : null;
    if (this.mode === 'oneway') {
      const seg = this.hoverSeg !== null ? this.game.world.netState.segments.get(this.hoverSeg) : undefined;
      return seg ? { type: 'setOneWay', seg: seg.id, dir: this.nextDir(seg.oneway ?? 0, seg.type) } : null;
    }
    if (this.mode === 'tram') {
      const seg = this.hoverSeg !== null ? this.game.world.netState.segments.get(this.hoverSeg) : undefined;
      if (!seg) return null;
      const on = this.tramPaint ? this.tramPaint.on : !seg.tram;
      return {
        type: 'setTram',
        seg: seg.id,
        on,
        ...(this.tramPaint ? { stroke: this.tramPaint.stroke } : {}),
      };
    }
    if (this.mode === 'roundabout') {
      const r = this.ring;
      if (!r) return null;
      return {
        type: 'roundabout',
        ...(r.node !== undefined ? { node: r.node } : { at: r.at! }),
        ...(r.radius !== undefined ? { radius: r.radius } : {}),
      };
    }
    const way = this.oneWay && !ROAD_TYPES[this.type].oneWay ? { oneway: true } : {};
    if (this.mode === 'free') {
      if (this.freePath.length < 2) return null;
      return { type: 'buildRoad', road: this.type, points: fitFreeform(this.freePath), ...way };
    }
    if (!this.start || !c) return null;
    if (Math.hypot(c.x - this.start.x, c.z - this.start.z) < 1) return null;
    if (this.mode === 'curve' && this.control)
      return { type: 'buildRoad', road: this.type, points: [this.start, this.control, c], ...way };
    return { type: 'buildRoad', road: this.type, points: [this.start, c], ...way };
  }

  /** One-way mode cycles two-way → one way → the other way → two-way (ramps skip two-way). */
  private nextDir(cur: number, type: RoadTypeId): 0 | 1 | -1 {
    if (ROAD_TYPES[type].oneWay) return cur === 1 ? -1 : 1;
    return cur === 0 ? 1 : cur === 1 ? -1 : 0;
  }

  /** Where a roundabout would go under the cursor: a junction, or a point on a road. */
  private ringSite(p: Vec2): { node?: number; at?: Vec2; centre: Vec2 } | null {
    const net = this.game.world.net;
    const n = net.nearestNode(p, 14);
    if (n) return { node: n.id, centre: { x: n.x, z: n.z } };
    const hit = net.nearestSegment(p, 10, (id) => ROAD_TYPES[net.segment(id).type].access);
    return hit ? { at: { x: hit.x, z: hit.z }, centre: { x: hit.x, z: hit.z } } : null;
  }

  /** Send a command; `live` is false if Escape, a mode change or leaving the tool came before the reply. */
  private async send(cmd: Command, epoch = this.epoch): Promise<{ res: CommandResult; live: boolean }> {
    const res = await this.game.dispatch(cmd);
    return { res, live: epoch === this.epoch };
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
    const epoch = this.epoch;
    void this.game.client.preview(cmd).then((res) => {
      this.inFlight = false;
      // A stale reply draws nothing, but it still frees the line for what the current session queued.
      if (epoch === this.epoch) {
        this.lastResult = { seq: this.lastSentSeq, res };
        this.drawGhost();
      }
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
    this.showDoomed(res?.ok ? doomedOf(res.info) : []);
    if (this.game.question) return;
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

  /** Tram mode (M20): the road under the pointer and what a click would do to its track. */
  private drawTram(): void {
    const g = this.game.renderer.ghost;
    g.showRoad(null, this.type, 'ok');
    const id = this.hoverSeg;
    const w = this.game.world;
    const seg = id !== null ? w.netState.segments.get(id) : undefined;
    if (!seg) {
      g.highlightSegment(null, 0);
      g.showMarker(null);
      this.game.setHint({
        ...this.pointer,
        text: 'Click a street, avenue or boulevard to lay tram track (click again to take it up); drag along roads to lay a line',
        tone: 'info',
      });
      return;
    }
    const res = this.lastResult?.res;
    g.highlightSegment(
      w.net.curve(seg.id),
      ROAD_TYPES[seg.type].width / 2 + ROAD_TYPES[seg.type].sidewalk,
      res && !res.ok ? 'bad' : 'ok',
    );
    g.showMarker(res && !res.ok && res.at ? res.at : null);
    const on = this.tramPaint ? this.tramPaint.on : !seg.tram;
    if (res && !res.ok) this.game.setHint({ ...this.pointer, text: res.reason, tone: 'bad' });
    else
      this.game.setHint({
        ...this.pointer,
        text: on
          ? `Lay tram track · ${res ? `$${res.cost.toLocaleString('en-US')}` : `$${TRAM.trackCost}/m`}`
          : 'Take up the tram track · free',
        tone: 'ok',
      });
  }

  private drawOneWay(): void {
    const g = this.game.renderer.ghost;
    g.showRoad(null, this.type, 'ok');
    const id = this.hoverSeg;
    const w = this.game.world;
    const seg = id !== null ? w.netState.segments.get(id) : undefined;
    if (!seg) {
      g.highlightSegment(null, 0);
      g.showMarker(null);
      this.game.setHint({
        ...this.pointer,
        text: 'Click a road to make it one-way, then click again to turn it round',
        tone: 'info',
      });
      return;
    }
    const res = this.lastResult?.res;
    const curve = w.net.curve(seg.id);
    g.highlightSegment(
      curve,
      ROAD_TYPES[seg.type].width / 2 + ROAD_TYPES[seg.type].sidewalk,
      res && !res.ok ? 'bad' : 'ok',
    );
    g.showMarker(null);
    const next = this.nextDir(seg.oneway ?? 0, seg.type);
    const a = w.net.node(seg.a);
    const b = w.net.node(seg.b);
    const heading = (d: number) => compass((b.x - a.x) * d, (b.z - a.z) * d);
    const now = seg.oneway ? `one-way ${heading(seg.oneway)}` : 'two-way';
    const then = next ? `one-way ${heading(next)}` : 'two-way';
    if (res && !res.ok) this.game.setHint({ ...this.pointer, text: res.reason, tone: 'bad' });
    else this.game.setHint({ ...this.pointer, text: `${now} → ${then} · free`, tone: 'ok' });
  }

  private drawRoundabout(): void {
    const g = this.game.renderer.ghost;
    g.highlightSegment(null, 0);
    const r = this.ring;
    if (!r) {
      g.showRoad(null, 'street', 'ok');
      g.showMarker(null);
      this.game.setHint({
        ...this.pointer,
        text: 'Click a junction or a road for a roundabout; drag out to size the ring',
        tone: 'info',
      });
      return;
    }
    const res = this.lastResult?.res;
    const info = (res?.info ?? {}) as { radius?: number; demolish?: number };
    const radius = info.radius ?? r.radius ?? JUNCTION.minRadius + 2;
    g.showRoad(ringPieces(r.centre, radius), 'street', !res ? 'pending' : res.ok ? 'ok' : 'bad');
    g.showMarker(res && !res.ok && res.at ? res.at : null);
    if (!res) this.game.setHint({ ...this.pointer, text: 'Roundabout', tone: 'info' });
    else if (res.ok)
      this.game.setHint({
        ...this.pointer,
        text: [
          `Roundabout · $${res.cost.toLocaleString('en-US')}`,
          `${Math.round(radius * 2)} m across`,
          ...(info.demolish ? [`replaces ${info.demolish} building${info.demolish === 1 ? '' : 's'}`] : []),
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
    if (this.mode === 'oneway') {
      this.drawOneWay();
      return;
    }
    if (this.mode === 'tram') {
      this.drawTram();
      return;
    }
    if (this.mode === 'roundabout') {
      this.drawRoundabout();
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
    // P1: a road that joins nothing, or only cut-off roads, says so (from the last answer, so the
    // hint doesn't flicker while a fresh one comes back).
    const links = res?.ok ? linkNotes(res.info) : [];
    const state = !res ? 'pending' : res.ok ? (links.length ? 'unlinked' : 'ok') : 'bad';
    // A fresh preview carries the planned pieces (split at junctions) and their graded profiles.
    const info = fresh ? (res?.info as PreviewInfo | undefined) : undefined;
    const earth = info?.grade?.earth?.cost ?? 0;
    if ((res?.ok && earth > 0.25 * res.cost) || (res && !res.ok && /steep/i.test(res.reason)))
      this.sawEarthworks = true;
    const planned = info?.grade && info.pieces?.length === info.grade.pieces.length ? info : undefined;
    g.showRoad(planned?.pieces ?? pieces, this.type, state, planned ? planned.grade : null);
    g.showMarker(res && !res.ok && res.at ? res.at : null);
    if (fresh) this.showDoomed(res?.ok ? doomedOf(info) : []);
    if (this.game.question) return;
    const doomed = res?.ok ? doomedOf(info).length : 0;
    const len = pieces.reduce((s, p) => s + Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z), 0);
    if (!res)
      this.game.setHint({ x: this.pointer.x, y: this.pointer.y, text: `${Math.round(len)} m`, tone: 'info' });
    else if (res.ok)
      this.game.setHint({
        x: this.pointer.x,
        y: this.pointer.y,
        text: [
          `$${res.cost.toLocaleString('en-US')} · ${Math.round(len)} m`,
          ...this.wayNotes(pieces),
          ...gradeNotes(info),
          ...(doomed ? [demolishes(doomed)] : []),
          ...links,
        ].join(' · '),
        tone: links.length ? 'warn' : 'ok',
      });
    else this.game.setHint({ x: this.pointer.x, y: this.pointer.y, text: res.reason, tone: 'bad' });
  }

  /** One-way roads and ramps say which way they'll run (M19). */
  private wayNotes(pieces: { a: Vec2; b: Vec2 }[]): string[] {
    if (!this.oneWay && !ROAD_TYPES[this.type].oneWay) return [];
    const a = pieces[0]!.a;
    const b = pieces[pieces.length - 1]!.b;
    return [`one-way ${compass(b.x - a.x, b.z - a.z)}`];
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
    const way = this.oneWay && !rt.oneWay ? ' · one-way (O)' : rt.oneWay ? ' · one-way, as drawn' : '';
    // A left-drag draws with this tool out, so say how to move the map instead (P3).
    const pan = !this.start && this.freePath.length === 0 ? ' · pan with middle-drag, WASD or a swipe' : '';
    this.game.setHint({
      x: this.pointer.x,
      y: this.pointer.y,
      text: `${rt.name}${way} · $${rt.costPerMetre}/m — ${what}${pan}`,
      tone: 'info',
    });
  }

  private refresh(): void {
    this.drawGhost();
    this.requestPreview(this.currentCommand());
    this.game.renderer.ghost.showSnap(
      this.cursor && (this.cursor.kind === 'node' || this.cursor.kind === 'segment') ? this.cursor : null,
      Math.max(1, this.game.renderer.controller.current.distance / 250),
    );
  }

  /** Red boxes over the buildings the road would demolish (P2). */
  private showDoomed(ids: readonly number[]): void {
    const w = this.game.world;
    const rects = [];
    for (const id of ids) {
      const b = w.buildings.get(id);
      if (b) rects.push({ x: b.x, z: b.z, hw: b.w * 4, hd: b.d * 4, angle: b.angle });
    }
    this.game.renderer.ghost.showClear(rects.length ? rects : null);
  }

  /**
   * A road or upgrade that would demolish buildings asks first (P2), as bulldozing does: true while
   * the question is open, and `go` runs if the player says yes. The road stays drawn meanwhile; a
   * no keeps a click–click road's start (pick another end) and drops a dragged one (`drop`).
   */
  private async askFirst(cmd: Command, go: () => void, drop = false): Promise<boolean> {
    const epoch = this.epoch;
    const pre = await this.game.client.preview(cmd);
    const ids = pre.ok ? doomedOf(pre.info) : [];
    // Nothing to demolish: built as clicked, even if Escape came meanwhile (P11).
    if (!ids.length) return false;
    // Demolishing needs a yes, and Escape, a mode change or leaving the tool came first: nothing.
    if (epoch !== this.epoch || this.game.tools.activeId !== 'road') return true;
    const n = ids.length;
    const what =
      cmd.type === 'upgradeRoad'
        ? `Making this road ${articled(ROAD_TYPES[cmd.road].name)} demolishes`
        : 'This road demolishes';
    this.showDoomed(ids);
    this.game.setHint(null);
    this.game.ask({
      ...this.pointer,
      text: `${what} ${n} building${n === 1 ? '' : 's'} beside it. Undo (${modKey('Z')}) brings ${n === 1 ? 'it' : 'them'} back.`,
      yes: cmd.type === 'upgradeRoad' ? 'Change it' : 'Build it',
      no: n === 1 ? 'Keep it' : 'Keep them',
      onYes: go,
      onNo: () => {
        if (drop) this.reset();
        this.lastResult = null;
        this.refresh();
      },
    });
    return true;
  }

  /** Lay or take up tram track on the road under the pointer (M20); part of a drag's stroke. */
  private async commitTram(): Promise<void> {
    const cmd = this.currentCommand();
    if (!cmd || cmd.type !== 'setTram') return;
    this.tramPaint?.done.add(cmd.seg);
    const { res, live } = await this.send(cmd);
    // Painting along a line skips roads that already have (or can't take) track quietly.
    const quiet = !res.ok && !!this.tramPaint && this.tramPaint.done.size > 1;
    if (!quiet) this.game.audio?.play(res.ok ? 'build' : 'error');
    if (!live) return;
    if (res.ok) this.lastResult = null;
    else if (!quiet) this.lastResult = { seq: this.previewSeq, res };
    this.refresh();
  }

  /** One-way switch or roundabout (M19). */
  private async commitEdit(): Promise<void> {
    const cmd = this.currentCommand();
    if (!cmd || (cmd.type !== 'setOneWay' && cmd.type !== 'roundabout')) return;
    const { res, live } = await this.send(cmd);
    if (res.ok) {
      this.game.audio?.play('build');
      if (cmd.type === 'roundabout') this.game.toast('Roundabout built', 'ok', 2000);
    } else {
      this.game.audio?.play('error');
      if (cmd.type === 'roundabout')
        this.game.toast(
          `Can't build a roundabout here: ${res.reason.charAt(0).toLowerCase()}${res.reason.slice(1)}.`,
          'bad',
          3000,
        );
    }
    if (!live) return;
    if (res.ok) {
      if (cmd.type === 'roundabout') this.ring = null;
      this.lastResult = null;
    } else this.lastResult = { seq: this.previewSeq, res };
    this.refresh();
  }

  /** `confirmed`: the command the player said yes to (P2), run as it was counted. */
  private async commitUpgrade(confirmed?: Command): Promise<void> {
    const cmd = confirmed ?? this.currentCommand();
    if (!cmd || cmd.type !== 'upgradeRoad') return;
    // Replies count from the click, not from after the question (P11).
    const epoch = this.epoch;
    if (!confirmed && (await this.askFirst(cmd, () => void this.commitUpgrade(cmd)))) return;
    const { res, live } = await this.send(cmd, epoch);
    if (res.ok) {
      this.game.audio?.play('build');
      this.game.toast(`Road changed to ${ROAD_TYPES[cmd.road].name.toLowerCase()}`, 'ok', 2000);
    } else this.game.audio?.play('error');
    if (!live) return;
    this.lastResult = res.ok ? null : { seq: this.previewSeq, res };
    this.refresh();
  }

  /**
   * Build the road being drawn. Click–click drawing keeps going from where the road ended (`chain`);
   * a drag draws one road, so the next drag starts wherever the player presses. A drag that can't be
   * built starts over too, with the reason in a toast (the ghost showed it red while dragging).
   */
  private async commit(chain = true, confirmed?: Command): Promise<boolean> {
    const cmd = confirmed ?? this.currentCommand();
    if (!cmd || cmd.type !== 'buildRoad') return false;
    // Replies count from the click (P11): an Escape while it was counted still ends the chain.
    const epoch = this.epoch;
    if (!confirmed && (await this.askFirst(cmd, () => void this.commit(chain, cmd), !chain))) return false;
    const { res, live } = await this.send(cmd, epoch);
    if (res.ok) this.game.audio?.play('build');
    else {
      this.game.audio?.play('error');
      // The ghost showed a chained road red; a dragged one, or one given up on, needs saying.
      if (!chain || !live) {
        const why = res.reason.charAt(0).toLowerCase() + res.reason.slice(1);
        this.game.toast(`Can't build that road: ${why}.`, 'bad', 3000);
      }
    }
    // Escape, a mode change or leaving the tool came first: the road is built (or refused) as sent,
    // but the chain does not come back and nothing is redrawn (P11).
    if (!live) return res.ok;
    if (res.ok) {
      const end = cmd.points[cmd.points.length - 1]!;
      this.reset();
      if (this.mode !== 'free' && chain) this.start = this.snap(end, null);
    } else if (chain) this.lastResult = { seq: this.previewSeq, res };
    else this.reset();
    this.refresh();
    return res.ok;
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    // A click elsewhere on the map while asking keeps the buildings (P2).
    if (this.game.question) {
      this.game.answer(false);
      return;
    }
    this.pointer = { x: p.clientX, y: p.clientY };
    this.downAt = { x: p.clientX, y: p.clientY };
    this.click = null;
    if (this.mode === 'upgrade') {
      this.onClick(p, () => void this.commitUpgrade());
      return;
    }
    if (this.mode === 'oneway') {
      this.onClick(p, () => void this.commitEdit());
      return;
    }
    if (this.mode === 'tram') {
      const seg = this.hoverSeg !== null ? this.game.world.netState.segments.get(this.hoverSeg) : undefined;
      if (!seg) return;
      this.tramPaint = { on: !seg.tram, stroke: ++this.tramStrokes, done: new Set() };
      void this.commitTram();
      return;
    }
    if (this.mode === 'roundabout') {
      const site = this.ringSite(p.ground);
      this.ring = site;
      this.ringDrag = !!site;
      this.lastResult = null;
      this.refresh();
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
      if (!this.start) {
        this.start = this.snap(p.ground, null);
        this.cursor = this.snap(p.ground, this.start, this.start);
        this.refresh();
      } else {
        // The bend and the end are clicks: dragged away from, a press is a pan.
        const ground = { x: p.ground.x, z: p.ground.z };
        this.onClick(p, () => {
          const bend = !this.control;
          if (bend) this.control = ground;
          // The end joins a road it nearly reaches, arriving from the bend (P1).
          this.cursor = this.snap(ground, null, this.control ?? this.start);
          if (!bend) void this.commit();
          this.refresh();
        });
      }
      return;
    }
    if (!this.start) {
      this.start = this.snap(p.ground, null);
      this.dragging = true;
    } else {
      // Mid-chain a press is a click, not the start of a drag: pulled away from it is a pan (P3).
      const ground = { x: p.ground.x, z: p.ground.z };
      this.onClick(p, () => {
        this.cursor = this.snap(ground, this.start, this.start);
        void this.commit();
      });
    }
  }

  /**
   * Do something when the button comes up within a click's reach of where it went down. A road tool
   * keeps drag-to-draw for a first press, but anything else a press would do (finish a road, change one
   * already built) waits for the release, so a left-drag meant to pan the map builds nothing (P3).
   */
  private onClick(p: ToolPointer, run: () => void): void {
    this.click = { x: p.clientX, y: p.clientY, run };
  }

  pointerMove(p: ToolPointer): void {
    // While asking about demolishing, the road stays where it was drawn (P2).
    if (this.game.question) return;
    this.pointer = { x: p.clientX, y: p.clientY };
    if (!p.ground) return;
    if (this.mode === 'roundabout') {
      if (this.ringDrag && this.ring) {
        // Dragging out from the middle draws the ring at that size.
        const d = Math.hypot(p.ground.x - this.ring.centre.x, p.ground.z - this.ring.centre.z);
        const radius =
          d > 8 ? Math.round(Math.min(JUNCTION.maxRadius, Math.max(JUNCTION.minRadius, d))) : undefined;
        if (radius !== this.ring.radius) {
          this.ring = { ...this.ring, ...(radius !== undefined ? { radius } : {}) };
          if (radius === undefined) delete this.ring.radius;
          this.lastResult = null;
        }
      } else {
        const site = this.ringSite(p.ground);
        const same =
          site &&
          this.ring &&
          site.node === this.ring.node &&
          site.at?.x === this.ring.at?.x &&
          site.at?.z === this.ring.at?.z;
        if (!same) {
          this.ring = site;
          this.lastResult = null;
        }
      }
      this.refresh();
      return;
    }
    if (this.mode === 'upgrade' || this.mode === 'oneway' || this.mode === 'tram') {
      const net = this.game.world.net;
      const tram = this.mode === 'tram';
      const hit = net.nearestSegment(p.ground, 14, (id) =>
        tram ? !!ROAD_TYPES[net.segment(id).type].tram : ROAD_TYPES[net.segment(id).type].buildable,
      );
      const id = hit ? hit.seg : null;
      if (id !== this.hoverSeg) {
        this.hoverSeg = id;
        this.lastResult = null;
        const seg = id !== null ? this.game.world.netState.segments.get(id) : undefined;
        // Dragging lays (or takes up) track on every road passed that still needs it.
        if (
          tram &&
          this.tramPaint &&
          seg &&
          !this.tramPaint.done.has(seg.id) &&
          !!seg.tram !== this.tramPaint.on
        )
          void this.commitTram();
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
    this.cursor = this.snap(
      p.ground,
      from,
      this.mode === 'curve' && this.control ? this.control : this.start,
    );
    this.refresh();
  }

  pointerUp(p: ToolPointer): void {
    if (p.button !== 0) return;
    this.pointer = { x: p.clientX, y: p.clientY };
    const c = this.click;
    this.click = null;
    if (c) {
      if (Math.hypot(p.clientX - c.x, p.clientY - c.y) <= CLICK_SLOP) c.run();
      return;
    }
    if (this.tramPaint) {
      this.tramPaint = null;
      this.refresh();
      return;
    }
    if (this.mode === 'roundabout' && this.ringDrag) {
      this.ringDrag = false;
      void this.commitEdit();
      return;
    }
    if (this.mode === 'free' && this.dragging) {
      this.dragging = false;
      if (p.ground) {
        const end = this.snap(p.ground, null, this.freePath[this.freePath.length - 1] ?? null);
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
      this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length]!;
      this.abandon();
      this.game.notify();
      return true;
    }
    if (e.code === 'KeyO' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      this.oneWay = !this.oneWay;
      this.refresh();
      this.game.notify();
      return true;
    }
    return false;
  }

  setType(t: RoadTypeId): void {
    // The question was about the road as it was (P2).
    if (this.game.question) this.game.answer(false);
    this.type = t;
    this.refresh();
    this.game.notify();
  }

  setMode(m: RoadMode): void {
    this.mode = m;
    this.abandon();
    this.refresh();
    this.game.notify();
  }
}
