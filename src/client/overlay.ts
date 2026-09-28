import type { JunctionTint, RoadTintPiece } from '../render/roadTint';
import { Color } from 'three';
import type { Game } from '../game';
import type { OverlayMap, OverlayResult } from '../sim/systems/overlays';
import { SERVICE_KINDS, type ServiceKind } from '../data/civic';
import { ROAD_TYPES } from '../data/roads';
import { JUNCTION, TRAFFIC } from '../data/balance';
import { hourOfDay } from '../sim/time';

/** Colour ramps for data maps (see the data-viz reference palette). */
const SEQUENTIAL = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'].map(
  (h) => new Color(h),
);
const DIV_BAD = new Color('#e34948');
const DIV_MID = new Color('#f0efec');
const DIV_GOOD = new Color('#2a78d6');
const tmp = new Color();

/** Congestion: flowing → busy → jammed → gridlock (status colours, always with a legend). */
const TRAFFIC_RAMP = ['#3a9e5c', '#9cc24a', '#e8b43a', '#e0662f', '#b3261e'].map((h) => new Color(h));

export function rampColor(ramp: 'diverging' | 'sequential' | 'traffic', v: number, out = new Color()): Color {
  const t = Math.max(0, Math.min(1, v));
  if (ramp === 'traffic') {
    const f = t * (TRAFFIC_RAMP.length - 1);
    const i = Math.min(TRAFFIC_RAMP.length - 2, Math.floor(f));
    return out.copy(TRAFFIC_RAMP[i]!).lerp(TRAFFIC_RAMP[i + 1]!, f - i);
  }
  if (ramp === 'diverging') {
    return t < 0.5 ? out.copy(DIV_BAD).lerp(DIV_MID, t * 2) : out.copy(DIV_MID).lerp(DIV_GOOD, (t - 0.5) * 2);
  }
  const f = t * (SEQUENTIAL.length - 1);
  const i = Math.min(SEQUENTIAL.length - 2, Math.floor(f));
  return out.copy(SEQUENTIAL[i]!).lerp(SEQUENTIAL[i + 1]!, f - i);
}

export const MAPS: { id: OverlayMap; name: string; group: string }[] = [
  { id: 'power', name: 'Power', group: 'Utilities' },
  { id: 'water', name: 'Water', group: 'Utilities' },
  { id: 'sewage', name: 'Sewage', group: 'Utilities' },
  { id: 'garbage', name: 'Garbage', group: 'Utilities' },
  { id: 'fire', name: 'Fire', group: 'Services' },
  { id: 'police', name: 'Police', group: 'Services' },
  { id: 'health', name: 'Health care', group: 'Services' },
  { id: 'education', name: 'Education', group: 'Services' },
  { id: 'park', name: 'Parks', group: 'Services' },
  { id: 'traffic', name: 'Traffic', group: 'City' },
  { id: 'happiness', name: 'Happiness', group: 'City' },
  { id: 'landValue', name: 'Land value', group: 'City' },
  { id: 'wealth', name: 'Wealth', group: 'City' },
  { id: 'crime', name: 'Crime', group: 'City' },
  { id: 'airPollution', name: 'Air pollution', group: 'Environment' },
  { id: 'groundPollution', name: 'Ground pollution', group: 'Environment' },
  { id: 'eduLevel', name: 'Education level', group: 'City' },
  { id: 'groundwater', name: 'Groundwater', group: 'Resources' },
  { id: 'resources', name: 'Ore and oil', group: 'Resources' },
];

/** Fetches the active data map from the worker and paints the overlay texture. */
export class OverlayController {
  active: OverlayMap | null = null;
  last: OverlayResult | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private game: Game) {}

  set(map: OverlayMap | null): void {
    this.active = map;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const u = this.game.renderer.terrain.uniforms;
    this.game.renderer.coverageMap.show(null);
    this.roadsKey = '';
    // Zone paint would hide the data underneath.
    this.game.renderer.zones.group.visible = !map;
    if (!map) {
      u.uOverlayOn.value = 0;
      this.last = null;
      this.game.notify();
      return;
    }
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), 1000);
    this.game.notify();
  }

  async refresh(): Promise<void> {
    const map = this.active;
    if (!map) return;
    const res = await this.game.client.query<OverlayResult>({ type: 'overlay', map });
    if (this.active !== map) return;
    this.last = res;
    const u = this.game.renderer.terrain.uniforms;
    const tex = u.uOverlay.value;
    const data = tex.image.data as Uint8Array;
    for (let k = 0; k < res.values.length; k++) {
      const v = res.values[k]!;
      if (v < 0) {
        data[k * 4 + 3] = 0;
        continue;
      }
      rampColor(res.ramp, v, tmp);
      data[k * 4] = Math.round(tmp.r * 255);
      data[k * 4 + 1] = Math.round(tmp.g * 255);
      data[k * 4 + 2] = Math.round(tmp.b * 255);
      data[k * 4 + 3] = 220;
    }
    tex.needsUpdate = true;
    u.uOverlayOn.value = 1;
    if ((SERVICE_KINDS as readonly string[]).includes(map)) await this.refreshRoads(map as ServiceKind);
    if (map === 'traffic') this.refreshTraffic();
    this.game.notify();
  }

  private roadsKey = '';

  /** Roads coloured by congestion at the current hour. */
  private refreshTraffic(): void {
    const w = this.game.world;
    const share = TRAFFIC.profile[Math.floor(hourOfDay(w.displayTick))] ?? 0.5;
    const key = `traffic:${w.trafficVersion}:${share}`;
    if (key === this.roadsKey) return;
    this.roadsKey = key;
    const list: RoadTintPiece[] = [];
    for (const seg of w.netState.segments.values()) {
      if (seg.type === 'highway' || seg.type === 'rail') continue;
      const vc = w.segVC(seg.id, share);
      list.push({
        curve: w.net.curve(seg.id),
        v: [Math.min(1, vc / 1.5), Math.min(1, vc / 1.5)],
        half: ROAD_TYPES[seg.type].width / 2 + 0.5,
        // Flyovers are tinted on their decks; one-way roads and ramps show which way they run (M19).
        ...(seg.deck ? { surface: (s: number, x: number, z: number) => w.roadHeight(seg.id, s, x, z) } : {}),
        ...(seg.oneway ? { dir: seg.oneway } : {}),
      });
    }
    // Junctions shaded by their own load, and roundabouts by theirs (M19).
    const junctions: JunctionTint[] = [];
    for (const node of w.netState.nodes.values()) {
      const kind = w.junctionKind(node.id);
      if (kind === 'none') continue;
      const vc = w.junctionVC(node.id, share);
      const widest = Math.max(...w.net.segmentsAt(node.id).map((id) => w.net.halfWidth(id)));
      const r = kind === 'roundabout' ? node.roundabout! + JUNCTION.ringWidth / 2 + 1 : widest + 3;
      junctions.push({ x: node.x, z: node.z, r, v: Math.min(1, vc / 1.5) });
    }
    this.game.renderer.coverageMap.show(list, 'traffic', junctions);
  }

  /** Service maps also tint the roads themselves, so coverage visibly follows them. */
  private async refreshRoads(kind: ServiceKind): Promise<void> {
    const res = await this.game.client.query<{ seg: number; v: number[] }[]>({ type: 'coverageRoads', kind });
    if (this.active !== kind) return;
    const key = JSON.stringify(res);
    if (key === this.roadsKey) return;
    this.roadsKey = key;
    const net = this.game.world.net;
    this.game.renderer.coverageMap.show(
      res
        .filter((r) => net.st.segments.has(r.seg))
        .map((r) => ({
          curve: net.curve(r.seg),
          v: r.v,
          half: ROAD_TYPES[net.segment(r.seg).type].width / 2 + 0.5,
        })),
    );
  }
}
