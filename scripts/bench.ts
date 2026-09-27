// Benchmark: build a large grid city headlessly, grow it, and report sim tick times.
// Usage: npx tsx scripts/bench.ts [months] [gridSize]         (a ~12k town on a 9×9 street grid)
//        npx tsx scripts/bench.ts [months] --big [target]      (an avenue grid grown to ~100k residents)
//        add --profile for per-system times, --save <file> to keep the city
import { Sim } from '../src/sim/sim';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { placeAlong } from '../tests/helpers';
import { writeFileSync } from 'node:fs';
import { gzipSync, strToU8 } from 'fflate';

const args = process.argv.slice(2);
const big = args.includes('--big');
const pos = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--save');
const months = Number(pos[0] ?? (big ? 36 : 12));
const cells = Number(pos[1] ?? 9);
const target = Number(pos[1] ?? 100_000);
const sim = big
  ? Sim.create({ seed: 'big', preset: 'lakes', sandbox: true })
  : Sim.create({ seed: 'bench', preset: 'river', sandbox: true });
sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
const hw = sim.state.net.nodes.get(sim.state.highway.connect)!;
let built = 0;
let failed = 0;
const whyFailed = new Map<string, number>();
const tryRoad = (road: 'avenue' | 'street', points: { x: number; z: number }[]) => {
  const r = sim.dispatch({ type: 'buildRoad', road, points });
  if (r.ok) built++;
  else {
    failed++;
    const why = r.reason.replace(/[\d.,]+/g, '#');
    whyFailed.set(why, (whyFailed.get(why) ?? 0) + 1);
  }
};
const zone = (z: 'R' | 'C' | 'I', x: number, y: number, radius: number) =>
  sim.dispatch({ type: 'zone', zone: z, area: { kind: 'brush', points: [{ x, z: y }], radius } });
/** Place `n` of a building along the given segments (several per segment where they fit). */
const placeMany = (def: string, n: number, segs: number[]) => {
  let placed = 0;
  for (const seg of segs) {
    while (placed < n) {
      try {
        placeAlong(sim, def, seg);
        placed++;
      } catch {
        break;
      }
    }
    if (placed >= n) break;
  }
  return placed;
};
let civics = 0;

if (big) {
  // Avenues every 110 m over 16 × 16 blocks east of the highway: towers everywhere, shops on a
  // checkerboard, industry along the east edge; utilities and services spread through the grid.
  const cols = 16;
  const rows = 16;
  const sp = 110;
  const x0 = hw.x + 40;
  const z0 = 150;
  tryRoad('avenue', [
    { x: hw.x, z: hw.z },
    { x: x0, z: hw.z },
  ]);
  // Block by block, so a steep stretch only loses that block's edge.
  for (let i = 0; i <= cols; i++)
    for (let j = 0; j < rows; j++)
      tryRoad('avenue', [
        { x: x0 + i * sp, z: z0 + j * sp },
        { x: x0 + i * sp, z: z0 + (j + 1) * sp },
      ]);
  for (let j = 0; j <= rows; j++)
    for (let i = 0; i < cols; i++)
      tryRoad('avenue', [
        { x: x0 + i * sp, z: z0 + j * sp },
        { x: x0 + (i + 1) * sp, z: z0 + j * sp },
      ]);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const cx = x0 + (i + 0.5) * sp;
      const cz = z0 + (j + 0.5) * sp;
      // Enough job land for the towers: industry on the east four columns, shops and offices on a third.
      const z = i >= cols - 4 ? 'I' : (i + j) % 3 === 0 ? 'C' : 'R';
      zone(z, cx, cz, sp * 0.75);
    }
  const segs = [...sim.state.net.segments.values()].filter((s) => s.type !== 'highway');
  const mid = (id: number) => {
    const c = sim.net.curve(id);
    return c.pointAt(c.length / 2);
  };
  const east = segs.filter((s) => mid(s.id).x > x0 + (cols - 4) * sp).map((s) => s.id);
  const west = segs.filter((s) => mid(s.id).x < x0 + 2 * sp).map((s) => s.id);
  // Utilities: nuclear and treatment by the industry, pumps on the quieter west side.
  civics += placeMany('nuclear', 5, east);
  civics += placeMany('treatment', 20, east);
  civics += placeMany('incinerator', 8, east);
  civics += placeMany('pump', 90, [...west, ...segs.map((s) => s.id)]);
  // Services on a coarse grid of the blocks: one kit per 3 × 3 blocks, big ones per 6 × 6.
  for (let j = 0; j < rows; j += 3)
    for (let i = 0; i < cols - 4; i += 3) {
      const near = segs
        .map((s) => ({
          id: s.id,
          d: Math.hypot(mid(s.id).x - (x0 + (i + 1.5) * sp), mid(s.id).z - (z0 + (j + 1.5) * sp)),
        }))
        .sort((a, b) => a.d - b.d)
        .map((s) => s.id);
      for (const def of ['firestation', 'police', 'clinic', 'primary', 'park_small', 'recycling'])
        civics += placeMany(def, 1, near);
      if (i % 6 === 0 && j % 6 === 0)
        for (const def of ['hospital', 'highschool', 'park_large']) civics += placeMany(def, 1, near);
    }
} else {
  const spacing = 110;
  const x0 = hw.x;
  const z0 = Math.max(80, hw.z - (spacing * cells) / 2);
  tryRoad('avenue', [
    { x: hw.x, z: hw.z },
    { x: x0 + spacing * cells, z: hw.z },
  ]);
  for (let i = 0; i <= cells; i++)
    tryRoad(i % 3 === 0 ? 'avenue' : 'street', [
      { x: x0 + 40 + i * spacing, z: z0 },
      { x: x0 + 40 + i * spacing, z: z0 + spacing * cells },
    ]);
  for (let j = 0; j <= cells; j++)
    tryRoad('street', [
      { x: x0 + 40, z: z0 + j * spacing },
      { x: x0 + 40 + spacing * cells, z: z0 + j * spacing },
    ]);
  // Zone: residential everywhere, commercial on avenues, industry in one corner.
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const cx = x0 + 40 + (i + 0.5) * spacing;
      const cz = z0 + (j + 0.5) * spacing;
      zone(i >= cells - 2 && j >= cells - 3 ? 'I' : (i + j) % 4 === 0 ? 'C' : 'R', cx, cz, spacing * 0.75);
    }
  }
  // Utilities and services along the north-south avenues, spread over the grid.
  const avenues = [...sim.state.net.segments.values()].filter((s) => s.type === 'avenue').map((s) => s.id);
  const kit = [
    'coal',
    'pump',
    'pump',
    'treatment',
    'landfill',
    'firestation',
    'police',
    'clinic',
    'primary',
    'park_small',
  ];
  for (let k = 0; k < avenues.length; k++) civics += placeMany(kit[k % kit.length]!, 1, [avenues[k]!]);
  for (const def of [
    'coal',
    'coal',
    'pump',
    'pump',
    'treatment',
    'landfill',
    'firestation',
    'police',
    'hospital',
    'highschool',
  ])
    civics += placeMany(def, 1, [...avenues].reverse());
}
console.log(
  `roads built ${built}, failed ${failed}, segments ${sim.state.net.segments.size}, civics ${civics}`,
);
for (const [why, n] of whyFailed) console.log(`  ${n} × ${why}`);
// --profile: time each system; report the costliest per month (total and worst single run).
const profile = new Map<string, { total: number; worst: number }>();
if (args.includes('--profile'))
  sim.timer = (name, fn) => {
    const a = performance.now();
    fn();
    const d = performance.now() - a;
    const p = profile.get(name) ?? { total: 0, worst: 0 };
    p.total += d;
    p.worst = Math.max(p.worst, d);
    profile.set(name, p);
  };
const t0 = performance.now();
let worst = 0;
let reached = 0;
for (let m = 1; m <= months; m++) {
  const ms: number[] = [];
  for (let k = 0; k < TICKS_PER_MONTH; k++) {
    const a = performance.now();
    sim.step();
    const d = performance.now() - a;
    ms.push(d);
    if (d > worst) worst = d;
  }
  ms.sort((a, b) => a - b);
  const avg = ms.reduce((s, x) => s + x, 0) / ms.length;
  const t = sim.state.totals;
  console.log(
    `month ${m}: pop ${t.population} jobs ${t.jobs} bld ${t.buildings} | tick avg ${avg.toFixed(3)} ms p99 ${ms[Math.floor(ms.length * 0.99)]!.toFixed(2)} max ${ms[ms.length - 1]!.toFixed(1)} ms`,
  );
  if (profile.size) {
    const top = [...profile.entries()].sort((a, b) => b[1].worst - a[1].worst).slice(0, 8);
    console.log(`  worst: ${top.map(([n, p]) => `${n} ${p.worst.toFixed(1)}`).join(', ')}`);
    const tot = [...profile.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 6);
    console.log(`  total ms: ${tot.map(([n, p]) => `${n} ${p.total.toFixed(0)}`).join(', ')}`);
    profile.clear();
  }
  // Big mode: stop a few months after reaching the target, so the numbers are for a settled city.
  if (big && t.population >= target && !reached) reached = m;
  if (big && reached && m >= reached + 3) break;
}
console.log(`total ${(performance.now() - t0).toFixed(0)} ms, worst tick ${worst.toFixed(1)} ms`);
// --save <file>: keep the grown city (gzip JSON, like a game save) for probes and soak tests.
const saveTo = args[args.indexOf('--save') + 1];
if (args.includes('--save') && saveTo) {
  writeFileSync(saveTo, gzipSync(strToU8(JSON.stringify(sim.save()))));
  console.log(`saved ${saveTo}`);
}
