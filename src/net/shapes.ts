/**
 * The outline of what a command would do on the map (M31): shown to the other players as this
 * player's tool ghost, and to this player while their own command waits for the room.
 */
import type { Command } from '../sim/commands';
import type { Vec2 } from '../sim/geom';
import { CIVIC } from '../data/civic';
import type { Shape } from '../../relay/protocol';

const r1 = (v: number) => Math.round(v * 10) / 10;

/** A road's anchor and control points as a polyline (quadratic pieces sampled). */
function roadLine(points: Vec2[]): number[] {
  const out: number[] = [];
  const push = (p: Vec2) => out.push(r1(p.x), r1(p.z));
  if (points.length < 2) return out;
  push(points[0]!);
  if (points.length === 2) {
    push(points[1]!);
    return out;
  }
  for (let i = 1; i + 1 < points.length; i += 2) {
    const a = points[i - 1]!;
    const c = points[i]!;
    const b = points[i + 1]!;
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      push({
        x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        z: u * u * a.z + 2 * u * t * c.z + t * t * b.z,
      });
    }
  }
  return out.slice(0, 128);
}

function brush(points: Vec2[], radius: number): Shape {
  const pts = points.slice(0, 8);
  return {
    circles: pts.map((p) => [r1(p.x), r1(p.z), r1(radius)]),
    ...(pts.length > 1 ? { lines: [pts.flatMap((p) => [r1(p.x), r1(p.z)])] } : {}),
  };
}

export function commandShape(cmd: Command): Shape | null {
  switch (cmd.type) {
    case 'buildRoad':
      return { lines: [roadLine(cmd.points)] };
    case 'zone':
      return cmd.area.kind === 'brush' ? brush(cmd.area.points, cmd.area.radius) : null;
    case 'paintDistrict':
    case 'terraform':
      return brush(
        cmd.type === 'terraform' ? cmd.points : cmd.area.points,
        cmd.type === 'terraform' ? cmd.radius : cmd.area.radius,
      );
    case 'placeBuilding':
    case 'moveBuilding': {
      const def = cmd.type === 'placeBuilding' ? CIVIC.get(cmd.def) : null;
      const w = def?.w ?? 24;
      const d = def?.d ?? 24;
      return { rects: [[r1(cmd.x), r1(cmd.z), w / 2, d / 2, Math.round(cmd.angle * 1000) / 1000]] };
    }
    case 'placeStop':
      return { circles: [[r1(cmd.x), r1(cmd.z), 4]] };
    case 'roundabout':
      return cmd.at ? { circles: [[r1(cmd.at.x), r1(cmd.at.z), cmd.radius ?? 20]] } : null;
    case 'disaster':
      return { circles: [[r1(cmd.at.x), r1(cmd.at.z), 30]] };
    default:
      return null;
  }
}
