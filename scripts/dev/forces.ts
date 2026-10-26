/**
 * M34 probe: the e2e's war town (seed `port` on the coast, the avenue out to the sea) with every
 * military building, then each base's staff, power and training month by month.
 *
 *   npx tsx scripts/dev/forces.ts [months]
 */
import { Sim } from '../../src/sim/sim';
import { CIVIC } from '../../src/data/civic';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { militaryDetails } from '../../src/sim/systems/war';
import { roadsidePose } from '../../src/sim/world/civic';
import { buildTown, serveTown } from '../../tests/helpers';
import type { UnitKind } from '../../src/data/war';

const months = Number(process.argv[2] ?? 5);
const sim = Sim.create({ seed: 'port', preset: 'coast', rivals: true });
sim.testMode = true;
buildTown(sim);
serveTown(sim);
const start = sim.state.net.nodes.get(sim.state.highway.connect)!;
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 2_000_000 });
const hz = start.z;
const road = (type: 'avenue' | 'street', points: { x: number; z: number }[]) => {
  const r = sim.dispatch({ type: 'buildRoad', road: type, points });
  if (!r.ok) throw new Error(r.reason);
};
road('avenue', [
  { x: start.x + 480, z: hz },
  { x: 1430, z: hz },
]);
road('street', [
  { x: 1430, z: hz - 560 },
  { x: 1430, z: hz },
]);
sim.advance(20 * TICKS_PER_HOUR);

/** Place `def` on the road nearest (x, z), as close to it as there's room. */
function placeNear(def: string, x: number, z: number): number {
  const d = CIVIC.get(def)!;
  const segs = [...sim.state.net.segments.values()]
    .filter((s) => s.type === 'street' || s.type === 'avenue')
    .map((s) => {
      const c = sim.net.curve(s.id);
      const len = c.length;
      let best = Infinity;
      let at = 0;
      for (let t = 0; t <= len; t += 4) {
        const p = c.pointAt(t);
        const dd = Math.hypot(p.x - x, p.z - z);
        if (dd < best) [best, at] = [dd, t];
      }
      return { id: s.id, len, best, at };
    })
    .sort((a, b) => a.best - b.best);
  for (const s of segs) {
    for (let k = 0; k < 40; k++) {
      for (const sign of [1, -1]) {
        const t = s.at + sign * k * 6;
        if (t < d.w / 2 + 6 || t > s.len - d.w / 2 - 6) continue;
        for (const side of [1, -1] as const) {
          const pose = roadsidePose(sim.net, s.id, t, side, d.d);
          const r = sim.dispatch({ type: 'placeBuilding', def, ...pose });
          if (r.ok) return r.created![0]!;
        }
      }
    }
  }
  throw new Error(`no room for ${def}`);
}

const plan: [string, number, number][] = [
  ['militaryhq', 600, -40],
  ['barracks', 690, -36],
  ['shelter', 770, -18],
  ['bunker', 820, -18],
  ['vehicledepot', 880, -40],
  ['radar', 970, -22],
  ['antiair', 1020, -18],
  ['armsfactory', 1080, -40],
  ['provingground', 1170, -44],
  ['airfield', 900, 50],
  ['navalyard', 1467, -310],
  ['coastalgun', 1443, -510],
];
// A second coal plant: the bases draw nearly 600 power between them.
placeNear('coal', start.x + 300, hz + 250);
const ids = new Map<string, number>();
for (const [def, x, dz] of plan) ids.set(def, placeNear(def, x, hz + dz));
sim.advance(4 * TICKS_PER_HOUR);

const orders: [string, UnitKind[]][] = [
  ['barracks', ['infantry']],
  ['vehicledepot', ['tank', 'artillery', 'transport']],
  ['airfield', ['fighter', 'helicopter', 'drone']],
  ['navalyard', ['patrolboat']],
];
for (const [base, kinds] of orders)
  for (const kind of kinds) {
    const r = sim.dispatch({ type: 'trainUnit', base: ids.get(base)!, kind });
    if (!r.ok) console.log(`train ${kind}: ${r.reason}`);
  }

const report = (label: string) => {
  console.log(`--- ${label}: people ${sim.state.totals.population}`);
  for (const [def, id] of ids) {
    const c = sim.state.civics.get(id)!;
    const d = militaryDetails(sim, c);
    const tr = d.training.map((t) => `${t.kind} ${t.done.toFixed(0)}/${t.hours} @${t.rate}`).join(', ');
    console.log(
      `${def.padEnd(14)} at ${c.x.toFixed(0)},${(c.z - hz).toFixed(0)}  staff ${d.staffed}/${d.jobs}  power ${d.power} served ${(d.powered * 100).toFixed(0)}%  units ${d.units.map((u) => u.kind).join(',') || '-'}  ${tr}  ${d.stalled ?? ''}`,
    );
  }
};
report('start');
for (let m = 1; m <= months; m++) {
  sim.advance(TICKS_PER_MONTH);
  report(`month ${m}`);
}
