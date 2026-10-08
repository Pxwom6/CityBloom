import { CIVIC, type CivicCategory } from '../data/civic';
import { ROAD_TYPES, isRail } from '../data/roads';
import type { Command, CommandResult } from '../sim/commands';
import type { Vec2 } from '../sim/geom';
import { roadsidePose } from '../sim/world/civic';
import type { Game } from '../game';
import type { Tool, ToolPointer } from './tool';

/**
 * Place civic buildings. The footprint snaps to the side of the nearest road, facing it, and
 * slides along it with the cursor. Validity and cost come from sim previews.
 */
export class PlaceTool implements Tool {
  readonly id = 'place';
  readonly usesLeftDrag = true;
  category: CivicCategory = 'power';
  def = 'wind';
  private pose: { x: number; z: number; angle: number; side: 1 | -1 } | null = null;
  private seq = 0;
  private last: { seq: number; res: CommandResult } | null = null;
  private pointer = { x: 0, y: 0 };
  /** Coverage preview: last requested pose key and whether a request is in flight. */
  private covKey = '';
  private covBusy = false;
  /** The civic building being moved (M14), or null when placing new ones. */
  moving: number | null = null;

  constructor(private game: Game) {}

  activate(): void {}

  deactivate(): void {
    // A preview still on its way back must not draw a footprint or a hint on the next tool (P11).
    this.seq++;
    this.moving = null;
    this.pose = null;
    this.covKey = '';
    this.game.renderer.ghost.showFootprint(null, 'ok');
    this.game.renderer.ghost.showCoverage(null);
    this.clearLinkGhost();
    this.game.setHint(null);
  }

  /** The regional rail link (Phase 2 review) goes on the west edge, wherever along it the cursor is. */
  private get railLink(): boolean {
    return !!CIVIC.get(this.def)?.railLink;
  }

  private clearLinkGhost(): void {
    const g = this.game.renderer.ghost;
    g.showRoad(null, 'mainline', 'ok');
    g.showClear(null);
  }

  /** The link's preview: its track in from the regional line, its junction building, what it clears. */
  private showLink(res: CommandResult | undefined): void {
    const g = this.game.renderer.ghost;
    const def = CIVIC.get(this.def)!;
    const info = (res?.info ?? {}) as {
      track?: { a: Vec2; b: Vec2 };
      box?: { x: number; z: number; angle: number };
      clear?: { x: number; z: number; hw: number; hd: number; angle: number }[];
    };
    const state = !res ? 'pending' : res.ok ? 'ok' : 'bad';
    if (info.track) {
      const { a, b } = info.track;
      g.showRoad([{ a, b, c: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 } }], 'mainline', state);
    }
    if (info.box) g.showFootprint({ ...info.box, hw: def.w / 2, hd: def.d / 2 }, state, 6);
    g.showClear(info.clear ?? null);
  }

  cancel(): boolean {
    if (this.moving === null) return false;
    // Escape puts a building being moved back where it was (nothing has changed yet).
    this.stopMove();
    return true;
  }

  startMove(civicId: number, def: string): void {
    this.setDef(def);
    this.moving = civicId;
    this.last = null;
    this.game.notify();
  }

  private stopMove(): void {
    this.moving = null;
    this.pose = null;
    this.game.renderer.ghost.showFootprint(null, 'ok');
    this.game.renderer.ghost.showCoverage(null);
    this.game.setHint(null);
    this.game.tools.use('select');
  }

  setDef(id: string): void {
    this.clearLinkGhost();
    this.def = id;
    this.category = CIVIC.get(id)!.category;
    this.last = null;
    // Mines and wells go on deposits: show where they are.
    if (CIVIC.get(id)!.resource && this.game.overlay.active !== 'resources')
      this.game.overlay.set('resources');
    this.game.notify();
  }

  private command(): Command | null {
    if (!this.pose) return null;
    if (this.railLink) return { type: 'buildRailLink', z: Math.round(this.pose.z) };
    if (this.moving !== null) return { type: 'moveBuilding', id: this.moving, ...this.pose };
    return { type: 'placeBuilding', def: this.def, ...this.pose };
  }

  /** The hint for the current preview: what it costs, or why it can't go here. */
  private hintFor(res: CommandResult | undefined): void {
    const def = CIVIC.get(this.def)!;
    if (this.moving !== null) {
      const text = !res
        ? `Move the ${def.name.toLowerCase()} · Esc to leave it`
        : res.ok
          ? `Move the ${def.name.toLowerCase()} here · $${res.cost.toLocaleString('en-US')}`
          : res.reason;
      this.game.setHint({ ...this.pointer, text, tone: !res ? 'info' : res.ok ? 'ok' : 'bad' });
      return;
    }
    const upkeep = `$${def.upkeep}/mo upkeep`;
    // Big projects (M17): the first stage is paid now, the rest as each stage starts.
    const p = def.project;
    const price = p
      ? `$${p.stages[0]!.cost.toLocaleString('en-US')} now for the ${p.stages[0]!.name.toLowerCase()}, $${p.stages
          .reduce((a, s) => a + s.cost, 0)
          .toLocaleString('en-US')} in all over ${p.stages.reduce((a, s) => a + s.months, 0)} months`
      : `$${def.cost.toLocaleString('en-US')}`;
    if (!res)
      this.game.setHint({
        ...this.pointer,
        text: `${def.name} · ${price}`,
        tone: 'info',
      });
    else if (res.ok) {
      const demolish = (res.info?.demolish as number) ?? 0;
      this.game.setHint({
        ...this.pointer,
        text: `${def.name} · ${price} · ${upkeep}${demolish ? ` · replaces ${demolish} building${demolish > 1 ? 's' : ''}` : ''}`,
        tone: 'ok',
      });
    } else this.game.setHint({ ...this.pointer, text: res.reason, tone: 'bad' });
  }

  private computePose(p: { x: number; z: number }): void {
    const def = CIVIC.get(this.def)!;
    if (def.railLink) {
      this.pose = { x: 14, z: p.z, angle: 0, side: 1 };
      return;
    }
    const net = this.game.world.net;
    // Stations face a railway, tram depots a road with tram track, everything else a road (M20).
    const faces = (id: number) => {
      const seg = net.segment(id);
      const t = ROAD_TYPES[seg.type];
      if (def.track === 'rail') return isRail(seg.type) && t.buildable;
      return t.buildable && !isRail(seg.type) && (!def.tram || !!seg.tram);
    };
    const hit =
      net.nearestSegment(p, def.d + 30, faces) ??
      (def.tram ? net.nearestSegment(p, def.d + 30, (id) => ROAD_TYPES[net.segment(id).type].access) : null);
    if (!hit) {
      this.pose = { x: p.x, z: p.z, angle: 0, side: 1 };
      return;
    }
    const curve = net.curve(hit.seg);
    const t = curve.tangentAt(hit.s);
    const left = { x: t.z, z: -t.x };
    const side: 1 | -1 = (p.x - hit.x) * left.x + (p.z - hit.z) * left.z >= 0 ? 1 : -1;
    const s = Math.max(def.w / 2, Math.min(curve.length - def.w / 2, hit.s));
    this.pose = roadsidePose(net, hit.seg, curve.length > def.w ? s : hit.s, side, def.d);
  }

  private refresh(): void {
    const def = CIVIC.get(this.def)!;
    const cmd = this.command();
    const g = this.game.renderer.ghost;
    if (cmd?.type === 'buildRailLink') {
      this.hintFor(this.last?.res);
      const seq = ++this.seq;
      void this.game.client.preview(cmd).then((r) => {
        if (seq !== this.seq) return;
        this.last = { seq, res: r };
        this.showLink(r);
        this.hintFor(r);
      });
      return;
    }
    if (!cmd || (cmd.type !== 'placeBuilding' && cmd.type !== 'moveBuilding')) {
      g.showFootprint(null, 'ok');
      return;
    }
    const res = this.last?.res;
    const state = !res ? 'pending' : res.ok ? 'ok' : 'bad';
    g.showFootprint({ x: cmd.x, z: cmd.z, hw: def.w / 2, hd: def.d / 2, angle: cmd.angle }, state, 8);
    this.hintFor(res);
    this.previewCoverage();
    const seq = ++this.seq;
    void this.game.client.preview(cmd).then((r) => {
      if (seq !== this.seq) return;
      this.last = { seq, res: r };
      const st = r.ok ? 'ok' : 'bad';
      g.showFootprint({ x: cmd.x, z: cmd.z, hw: def.w / 2, hd: def.d / 2, angle: cmd.angle }, st, 8);
      this.hintFor(r);
    });
  }

  /** Ask the sim what a service building here would cover and shade those roads (throttled). */
  private previewCoverage(): void {
    const def = CIVIC.get(this.def)!;
    const pose = this.pose;
    const g = this.game.renderer.ghost;
    if (!def.service || !pose) {
      g.showCoverage(null);
      this.covKey = '';
      return;
    }
    const key = `${def.id}:${Math.round(pose.x / 4)}:${Math.round(pose.z / 4)}:${pose.side}`;
    if (key === this.covKey || this.covBusy) return;
    this.covKey = key;
    this.covBusy = true;
    void this.game.client
      .query<{ seg: number; v: number[] }[]>({ type: 'coveragePreview', def: def.id, ...pose })
      .then((res) => {
        this.covBusy = false;
        if (this.game.tools.activeId !== 'place' || this.def !== def.id) return;
        const net = this.game.world.net;
        const list = res
          .filter((r) => net.st.segments.has(r.seg))
          .map((r) => {
            const seg = net.segment(r.seg);
            return { curve: net.curve(r.seg), v: r.v, half: ROAD_TYPES[seg.type].width / 2 + 1 };
          });
        g.showCoverage(list);
        // The cursor may have moved on while we waited.
        if (this.pose && this.pose !== pose) this.previewCoverage();
      });
  }

  pointerMove(p: ToolPointer): void {
    this.pointer = { x: p.clientX, y: p.clientY };
    if (!p.ground) return;
    this.computePose(p.ground);
    this.refresh();
  }

  pointerDown(p: ToolPointer): void {
    if (p.button !== 0 || !p.ground) return;
    this.computePose(p.ground);
    const cmd = this.command();
    if (!cmd) return;
    const moving = this.moving;
    void this.game.dispatch(cmd).then((r) => {
      if (r.ok && cmd.type === 'buildRailLink') {
        // One link a city: done, and the button leaves the toolbar.
        this.game.audio?.play('place');
        this.game.toast('Regional rail link laid: lay railway from its end to bring trains in', 'ok', 4000);
        this.game.tools.use('select');
        return;
      }
      if (r.ok) {
        this.game.audio?.play('place');
        this.game.toast(`${CIVIC.get(this.def)!.name} ${moving !== null ? 'moved' : 'built'}`, 'ok', 2000);
        if (moving !== null) {
          this.stopMove();
          return;
        }
      } else {
        this.game.audio?.play('error');
        this.game.setHint({ ...this.pointer, text: r.reason, tone: 'bad' });
      }
      this.last = null;
      this.refresh();
    });
  }

  pointerUp(): void {}
}
