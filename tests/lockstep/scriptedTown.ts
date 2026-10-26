/**
 * A scripted town for the determinism tests (M29): grows a town from a seed using every kind of
 * command, deciding each from the city as it stands (so any machine running it decides the same).
 * Shared by the Node tests and the cross-browser test (bundled into a blank page), so it imports
 * only the sim and uses only deterministic maths.
 */
import { Sim } from '../../src/sim/sim';
import { COMMAND_TYPES, type Command, type CommandResult, type CommandType } from '../../src/sim/commands';
import type { Vec2 } from '../../src/sim/geom';
import { DMath } from '../../src/sim/dmath';
import { CIVIC } from '../../src/data/civic';
import { roadsidePose } from '../../src/sim/world/civic';
import { TICKS_PER_MONTH } from '../../src/sim/time';

export type Issue = (cmd: Command) => CommandResult;

export const TOWN_OPTIONS = { seed: 'lockstep', preset: 'river' as const, cityName: 'Stepford' };

/**
 * Every command kind, from the compiler-checked list beside `Command` (the cross-browser test checks
 * the script used each one, so a new kind fails it until the script issues it).
 */
export const ALL_KINDS: readonly CommandType[] = COMMAND_TYPES;

/**
 * `shared`: as in a room, where cheats are refused; the town is then a sandbox (money and unlocks
 * without them).
 */
export function newTown(shared = false): Sim {
  const sim = Sim.create({ ...TOWN_OPTIONS, sandbox: shared });
  sim.shared = shared;
  // Test mode for the test-only cheats (weather, election date, rail link); invariants are
  // checked by the scripts at month ends rather than every tick.
  sim.testMode = true;
  return sim;
}

const at = (sim: Sim): Vec2 => {
  const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
  return { x: n.x, z: n.z };
};

function placeAlong(sim: Sim, issue: Issue, def: string, segs: number[]): number | null {
  const d = CIVIC.get(def)!;
  for (const seg of segs) {
    if (!sim.state.net.segments.has(seg)) continue;
    const len = sim.net.curve(seg).length;
    for (let s = d.w / 2 + 12; s < len - d.w / 2 - 12; s += 6)
      for (const side of [1, -1] as const) {
        const pose = roadsidePose(sim.net, seg, s, side, d.d);
        const cmd: Command = { type: 'placeBuilding', def, ...pose };
        if (sim.preview(cmd).ok) {
          const r = issue(cmd);
          if (r.ok) return r.created![0]!;
        }
      }
  }
  return null;
}

function roadIds(sim: Sim, type?: string): number[] {
  return [...sim.state.net.segments.values()]
    .filter((s) =>
      type ? s.type === type : s.type !== 'highway' && s.type !== 'rail' && s.type !== 'mainline',
    )
    .map((s) => s.id);
}

function brush(points: Vec2[], radius: number) {
  return { kind: 'brush' as const, points, radius };
}

/** The script: what to do at the start of game month `m` (counted from founding). */
export function act(sim: Sim, issue: Issue, m: number): void {
  const c = at(sim);
  const s = sim.state;
  switch (m) {
    case 0: {
      issue({ type: 'cheat', cheat: 'unlockAll' });
      issue({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
      issue({ type: 'renameCity', name: 'Lockstep Lee' });
      issue({ type: 'setWeather', intensity: 2 });
      issue({ type: 'setDisasters', on: false });
      issue({ type: 'setElections', on: true });
      issue({ type: 'setTax', zone: 'R', wealth: 'all', rate: 0.1 });
      issue({ type: 'setTax', zone: 'I', wealth: 2, rate: 0.12 });
      issue({ type: 'setFunding', dept: 'fire', pct: 110 });
      issue({ type: 'buildRoad', road: 'avenue', points: [c, { x: c.x + 520, z: c.z }] });
      for (let k = 1; k <= 4; k++) {
        const x = c.x + 104 * k;
        issue({
          type: 'buildRoad',
          road: 'street',
          points: [
            { x, z: c.z - 170 },
            { x, z: c.z + 170 },
          ],
        });
      }
      // A curved street to the north, drawn as anchor–control–anchor.
      issue({
        type: 'buildRoad',
        road: 'street',
        points: [
          { x: c.x + 104, z: c.z - 170 },
          { x: c.x + 260, z: c.z - 240 },
          { x: c.x + 416, z: c.z - 170 },
        ],
      });
      issue({
        type: 'zone',
        zone: 'R',
        area: brush(
          [
            { x: c.x + 20, z: c.z - 100 },
            { x: c.x + 520, z: c.z - 100 },
          ],
          70,
        ),
      });
      issue({
        type: 'zone',
        zone: 'C',
        area: brush(
          [
            { x: c.x + 20, z: c.z + 22 },
            { x: c.x + 520, z: c.z + 22 },
          ],
          22,
        ),
      });
      issue({
        type: 'zone',
        zone: 'I',
        area: brush(
          [
            { x: c.x + 270, z: c.z + 110 },
            { x: c.x + 520, z: c.z + 110 },
          ],
          50,
        ),
      });
      const north = roadIds(sim, 'street').at(-1);
      if (north) issue({ type: 'zone', zone: 'R', area: { kind: 'segment', id: north } });
      // Utilities and services along the streets.
      const streets = roadIds(sim, 'street');
      for (const def of [
        'coal',
        'pump',
        'pump',
        'pump',
        'pump',
        'treatment',
        'landfill',
        'firestation',
        'police',
        'clinic',
        'primary',
        'park_small',
      ])
        placeAlong(sim, issue, def, streets.slice().reverse());
      for (let k = 1; k <= 3; k++) issue({ type: 'placeStop', x: c.x + 104 * k + 52, z: c.z + 8 });
      break;
    }
    case 1: {
      // One-way, an upgrade and a roundabout.
      const streets = roadIds(sim, 'street');
      if (streets[0]) issue({ type: 'setOneWay', seg: streets[0], dir: 1 });
      if (streets[1]) issue({ type: 'upgradeRoad', seg: streets[1], road: 'avenue' });
      const junction = [...s.net.nodes.values()]
        .filter((n) => sim.net.segmentsAt(n.id).length >= 4)
        .sort((a, b) => a.id - b.id);
      for (const n of junction) if (issue({ type: 'roundabout', node: n.id }).ok) break;
      issue({ type: 'takeLoan', amount: 50_000 });
      break;
    }
    case 2: {
      const d = issue({ type: 'createDistrict', name: 'Old Town' });
      const id = d.ok ? d.created![0]! : 1;
      issue({
        type: 'paintDistrict',
        district: id,
        area: brush(
          [
            { x: c.x + 60, z: c.z - 80 },
            { x: c.x + 250, z: c.z - 80 },
          ],
          60,
        ),
        stroke: 1,
      });
      issue({
        type: 'paintDistrict',
        district: id,
        area: brush(
          [
            { x: c.x + 250, z: c.z - 80 },
            { x: c.x + 300, z: c.z - 60 },
          ],
          60,
        ),
        stroke: 1,
      });
      issue({ type: 'renameDistrict', district: id, name: 'Old Quarter' });
      issue({ type: 'setDistrictPolicy', district: id, policy: 'heritage', on: true });
      issue({ type: 'setPolicy', id: 'recycling', on: true });
      break;
    }
    case 3: {
      // Reshape empty ground, then a building moved and given an add-on; undo and redo.
      issue({
        type: 'terraform',
        mode: 'raise',
        points: [{ x: c.x + 700, z: c.z - 420 }],
        radius: 30,
        stroke: 2,
      });
      issue({
        type: 'terraform',
        mode: 'smooth',
        points: [{ x: c.x + 700, z: c.z - 420 }],
        radius: 40,
        stroke: 3,
      });
      const streets = roadIds(sim);
      const fs = [...s.civics.values()].find((x) => x.def === 'firestation');
      if (fs) issue({ type: 'addModule', civic: fs.id, module: 'engineBay' });
      const park = placeAlong(sim, issue, 'park_small', streets);
      if (park) {
        const p = s.civics.get(park)!;
        for (const seg of streets) {
          const len = sim.net.curve(seg).length;
          let moved = false;
          for (let q = 20; q < len - 20 && !moved; q += 10)
            for (const side of [1, -1] as const) {
              const pose = roadsidePose(sim.net, seg, q, side, CIVIC.get('park_small')!.d);
              if (DMath.hypot(pose.x - p.x, pose.z - p.z) < 60) continue;
              const cmd: Command = { type: 'moveBuilding', id: park, ...pose };
              if (sim.preview(cmd).ok && issue(cmd).ok) {
                moved = true;
                break;
              }
            }
          if (moved) break;
        }
      }
      issue({ type: 'undo' });
      issue({ type: 'redo' });
      const b = [...s.buildings.values()].sort((a, b2) => a.id - b2.id)[0];
      if (b) issue({ type: 'bulldoze', target: { kind: 'building', id: b.id } });
      break;
    }
    case 4: {
      const av = roadIds(sim, 'avenue');
      for (const seg of av) if (issue({ type: 'setTram', seg, on: true, stroke: 4 }).ok) break;
      issue({ type: 'placeStop', x: c.x + 60, z: c.z, tram: true });
      const ring = [...s.net.nodes.values()].find((n) => n.roundabout);
      if (ring) issue({ type: 'removeRoundabout', node: ring.id });
      const loan = s.economy.loans[0];
      if (loan) issue({ type: 'repayLoan', id: loan.id });
      break;
    }
    case 5: {
      issue({ type: 'cheat', cheat: 'weather', kind: 'storm', strength: 0.8, hours: 6 });
      const b = [...s.buildings.values()].filter((x) => x.pop > 0).sort((a, b2) => a.id - b2.id)[2];
      if (b) issue({ type: 'cheat', cheat: 'ignite', id: b.id });
      issue({ type: 'disaster', kind: 'meteor', at: { x: c.x + 900, z: c.z + 500 }, size: 0.5 });
      const n = s.region.neighbours[0];
      if (n) issue({ type: 'setDeal', neighbour: n.id, resource: 'power', direction: 'buy', amount: 5 });
      break;
    }
    case 6: {
      issue({ type: 'cheat', cheat: 'removeRailLink' });
      issue({ type: 'cheat', cheat: 'addMoney', amount: 60_000 });
      const hz = c.z;
      for (const dz of [400, -400, 500, -500, 600, -600, 700, -700, 300, -300]) {
        const cmd: Command = { type: 'buildRailLink', z: hz + dz };
        if (sim.preview(cmd).ok) {
          issue(cmd);
          break;
        }
      }
      break;
    }
    case 7: {
      // A shared region's news and a payment into its project (M32), as the page passes them on: a
      // player city takes a neighbour's place and signs a deal, and the project gets a share. Only
      // the page's own game sends these, so a room's players are refused both (alike on every
      // machine); the single-player run uses them.
      issue({
        type: 'regionUpdate',
        update: {
          cities: [
            {
              slot: 1,
              name: 'Upstream',
              mayor: 'Ada',
              color: 0x4a90d9,
              population: 5200,
              kind: 'industrial',
              offers: {
                buy: { power: 20, water: 0, garbage: 0 },
                sell: { power: 0, water: 30, garbage: 10 },
              },
              workers: 400,
              jobs: 250,
              shoppers: 120,
              online: true,
            },
          ],
          contracts: [{ slot: 1, resource: 'water', direction: 'buy', amount: 10 }],
          project: { total: 50_000, goal: 400_000, funded: false, host: false, built: false, power: 0 },
        },
      });
      issue({ type: 'contributeProject', amount: 20_000 });
      break;
    }
    case 8: {
      issue({ type: 'cheat', cheat: 'electionIn', months: 2 });
      const stop = [...s.transit.stops.values()].sort((a, b) => a.id - b.id)[0];
      if (stop) issue({ type: 'bulldoze', target: { kind: 'stop', id: stop.id } });
      const park = [...s.civics.values()]
        .filter((x) => x.def === 'park_small')
        .sort((a, b) => b.id - a.id)[0];
      if (park) issue({ type: 'bulldoze', target: { kind: 'civic', id: park.id } });
      const dead = roadIds(sim, 'street').filter((id) => {
        const seg = s.net.segments.get(id)!;
        return sim.net.segmentsAt(seg.a).length === 1 || sim.net.segmentsAt(seg.b).length === 1;
      });
      if (dead[0]) issue({ type: 'bulldoze', target: { kind: 'segment', id: dead[0] } });
      const d = [...s.districts.keys()][0];
      if (d) issue({ type: 'removeDistrict', district: d });
      break;
    }
    case 9:
      issue({ type: 'promise', promise: 'jobs', on: true });
      break;
    default:
      // Every few months: the town grows south by another block, joined to the streets and zoned.
      if (m % 2 === 0) {
        const k = (m - 8) / 2;
        const z0 = c.z + 170 + 60 * (k - 1);
        const z = z0 + 60;
        for (const x of [c.x + 104, c.x + 416])
          issue({
            type: 'buildRoad',
            road: 'street',
            points: [
              { x, z: z0 },
              { x, z },
            ],
          });
        const pts = [
          { x: c.x + 104, z },
          { x: c.x + 416, z },
        ];
        if (issue({ type: 'buildRoad', road: 'street', points: pts }).ok)
          issue({
            type: 'zone',
            zone: (['R', 'I', 'C'] as const)[k % 3]!,
            area: brush(
              [
                { x: c.x + 110, z: z - 30 },
                { x: c.x + 410, z: z - 30 },
              ],
              30,
            ),
          });
      }
      if (m % 6 === 0) placeAlong(sim, issue, 'pump', roadIds(sim, 'street').reverse());
      if (m % 4 === 0) issue({ type: 'setTax', zone: 'C', wealth: 'all', rate: 0.09 + 0.001 * (m % 10) });
  }
}

/** The map editor's commands, on an editor city (they're refused anywhere else). */
export function editorScript(issue: Issue): void {
  issue({
    type: 'editMap',
    brush: 'raise',
    points: [{ x: 1200, z: 1200 }],
    radius: 80,
    strength: 1,
    stroke: 1,
  });
  issue({
    type: 'editMap',
    brush: 'smooth',
    points: [
      { x: 1200, z: 1200 },
      { x: 1260, z: 1210 },
    ],
    radius: 60,
    stroke: 2,
  });
  issue({ type: 'editMap', brush: 'forest', points: [{ x: 1500, z: 900 }], radius: 70, stroke: 3 });
  issue({ type: 'undo' });
  issue({ type: 'redo' });
  issue({ type: 'setMapEntry', entry: 'rail', z: null });
  issue({ type: 'setMapInfo', name: 'Even Ground', climate: 'temperate' });
}

/** Grow the scripted town for `months`, calling `monthEnd` after each month's last tick. */
export function growTown(
  months: number,
  monthEnd: (sim: Sim, month: number) => void,
  issue?: (sim: Sim, cmd: Command) => CommandResult,
  shared = false,
): { sim: Sim; used: Map<CommandType, number> } {
  const sim = newTown(shared);
  const used = new Map<CommandType, number>();
  const doIssue: Issue = (cmd) => {
    const r = issue ? issue(sim, cmd) : sim.dispatch(cmd);
    if (r.ok) used.set(cmd.type, (used.get(cmd.type) ?? 0) + 1);
    return r;
  };
  for (let m = 0; m < months; m++) {
    act(sim, doIssue, m);
    sim.advance(TICKS_PER_MONTH);
    monthEnd(sim, m);
  }
  return { sim, used };
}
