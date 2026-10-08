import { TRANSIT } from '../data/balance';
import { ROAD_TYPES } from '../data/roads';
import type { Game } from '../game';
import type { Vec2 } from '../sim/geom';
import { roadUnderCursor } from './roadPick';
import type { Tool, ToolPointer } from './tool';

/**
 * Place bus stops: click beside a road. A depot's buses loop through every stop they reach. With
 * `tram` set (M20), tram stops on roads with tram track.
 */
export class StopTool implements Tool {
  readonly id = 'stop';
  readonly usesLeftDrag = false;
  readonly clickOnly = true;
  tram = false;
  private pointer = { x: 0, y: 0 };
  private seq = 0;

  constructor(private game: Game) {}

  activate(): void {}

  deactivate(): void {
    // A preview still on its way back must not draw a marker or a hint on the next tool (P11).
    this.seq++;
    this.game.renderer.ghost.showMarker(null);
    this.game.renderer.ghost.showSnap(null);
    this.game.setHint(null);
  }

  cancel(): boolean {
    return false;
  }

  /**
   * Where a stop click is (P12): on the road under the cursor as it's drawn, so a click on a bridge
   * deck is on the bridge (the ground under the cursor lies well behind a raised deck), else the
   * ground point as before, which the sim takes to the road within 14 m.
   */
  private spot(p: ToolPointer): Vec2 | null {
    if (!p.ground) return null;
    const g = this.game;
    const w = g.world;
    const tram = this.tram;
    return (
      roadUnderCursor({
        net: w.net,
        roadHeight: (s, t, x, z) => w.roadHeight(s, t, x, z),
        camera: g.renderer.camera,
        rect: g.renderer.canvas.getBoundingClientRect(),
        clientX: p.clientX,
        clientY: p.clientY,
        near: p.ground,
        accept: (id) => {
          const seg = w.netState.segments.get(id);
          return !!seg && (tram ? !!seg.tram : ROAD_TYPES[seg.type].access);
        },
      }) ?? p.ground
    );
  }

  pointerMove(p: ToolPointer): void {
    this.pointer = { x: p.clientX, y: p.clientY };
    const g = this.spot(p);
    if (!g) return;
    const seq = ++this.seq;
    const tram = this.tram;
    void this.game.client.preview({ type: 'placeStop', x: g.x, z: g.z, tram }).then((r) => {
      if (seq !== this.seq) return;
      const ghost = this.game.renderer.ghost;
      if (r.ok) {
        const at = r.info as { x: number; z: number };
        ghost.showSnap(at);
        ghost.showMarker(null);
        const civics = [...this.game.world.civics.values()];
        const depot = civics.some((c) => (tram ? c.def === 'tramdepot' : c.def === 'busdepot'));
        this.game.setHint({
          ...this.pointer,
          text: `${tram ? 'Tram' : 'Bus'} stop · $${TRANSIT.stopCost}${depot ? '' : tram ? ' · trams need a depot on the track' : ' · buses need a depot'}`,
          tone: 'ok',
        });
      } else {
        ghost.showSnap(null);
        ghost.showMarker(r.at ?? null);
        this.game.setHint({ ...this.pointer, text: r.reason, tone: 'bad' });
      }
    });
  }

  pointerDown(p: ToolPointer): void {
    const at = p.button === 0 ? this.spot(p) : null;
    if (!at) return;
    const tram = this.tram;
    void this.game.dispatch({ type: 'placeStop', x: at.x, z: at.z, tram }).then((r) => {
      if (r.ok) {
        this.game.audio?.play('build');
        this.game.toast(tram ? 'Tram stop placed' : 'Bus stop placed', 'ok', 1500);
      } else {
        this.game.audio?.play('error');
        this.game.setHint({ ...this.pointer, text: r.reason, tone: 'bad' });
      }
    });
  }

  pointerUp(): void {}
}
