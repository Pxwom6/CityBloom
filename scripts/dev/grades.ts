// Dev probe (M13): how often an ordinary street is rejected, and how steep the ground really was.
// Places random straight streets (60–300 m, dry land, clear of the highway) on several seeds of every
// map preset through `preview`, and reports the result against the terrain's steepness along the
// route: the steepest 50 m of the raw ground, in bands. With --build it also builds the ones that
// pass and reports the earthworks they needed.
// Usage: npx tsx scripts/dev/grades.ts [placements per map=150] [seeds per preset=3] [--build]
import { Sim } from '../../src/sim/sim';
import { MAP_PRESETS, MAP_SIZE, SHORE_HEIGHT } from '../../src/data/world';
import { Rng } from '../../src/sim/rng';

const args = process.argv.slice(2);
const build = args.includes('--build');
const nums = args.filter((a) => !a.startsWith('--')).map(Number);
const per = nums[0] ?? 150;
const seeds = nums[1] ?? 3;

/** Steepest rise over run across any 50 m stretch of the raw ground between two points. */
function steepest(sim: Sim, a: { x: number; z: number }, b: { x: number; z: number }): number {
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.max(2, Math.ceil(len / 4));
  const h: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    h.push(sim.terrain.heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t));
  }
  const w = Math.max(1, Math.round(50 / (len / n)));
  let worst = 0;
  for (let i = 0; i + w <= n; i++) worst = Math.max(worst, Math.abs(h[i + w]! - h[i]!) / ((w * len) / n));
  if (n < w) worst = Math.abs(h[n]! - h[0]!) / len;
  return worst;
}

const BANDS = [0.08, 0.15, 0.25, 0.35, Infinity];
const bandName = (i: number) =>
  i === 0
    ? `< ${BANDS[0]! * 100}%`
    : BANDS[i] === Infinity
      ? `≥ ${BANDS[i - 1]! * 100}%`
      : `${BANDS[i - 1]! * 100}–${BANDS[i]! * 100}%`;
const total = BANDS.map(() => ({ n: 0, steep: 0, other: 0 }));
const reasons = new Map<string, number>();
let earth = 0;
let earthCost = 0;
let roadCost = 0;
let built = 0;
const volumes: number[] = [];
const shares: number[] = [];
const flatShares: number[] = [];
const steepShares: number[] = [];
const median = (a: number[]) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]! : 0);

for (const preset of MAP_PRESETS.map((p) => p.id)) {
  for (let k = 0; k < seeds; k++) {
    const sim = Sim.create({ seed: `grade${k}`, preset });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 10_000_000 });
    const rng = Rng.fromSeed(`grades:${preset}:${k}`);
    let placed = 0;
    let guard = 0;
    while (placed < per && guard++ < per * 20) {
      const a = { x: rng.range(80, MAP_SIZE - 80), z: rng.range(80, MAP_SIZE - 80) };
      const ang = rng.range(0, Math.PI * 2);
      const len = rng.range(60, 300);
      const b = { x: a.x + Math.cos(ang) * len, z: a.z + Math.sin(ang) * len };
      if (b.x < 40 || b.z < 40 || b.x > MAP_SIZE - 40 || b.z > MAP_SIZE - 40) continue;
      // Dry land the whole way (bridges are another matter), and clear of the highway corridor.
      let wet = false;
      for (let t = 0; t <= 1; t += 0.05)
        if (sim.terrain.heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) < SHORE_HEIGHT + 0.5)
          wet = true;
      if (wet || Math.min(a.x, b.x) < 60) continue;
      placed++;
      const steep = steepest(sim, a, b);
      const band = BANDS.findIndex((x) => steep < x);
      const cmd = { type: 'buildRoad' as const, road: 'street' as const, points: [a, b] };
      const r = sim.preview(cmd);
      total[band]!.n++;
      if (!r.ok) {
        const why = r.reason.replace(/[\d.,]+/g, '#');
        reasons.set(why, (reasons.get(why) ?? 0) + 1);
        if (/steep|cutting|climb|height/i.test(r.reason)) total[band]!.steep++;
        else total[band]!.other++;
      } else if (build) {
        const done = sim.dispatch(cmd);
        if (done.ok) {
          built++;
          roadCost += done.cost ?? 0;
          const info = (done as { info?: { grade?: { earth: { volume: number; cost: number } | null } } })
            .info;
          const e = info?.grade?.earth;
          earth += e?.volume ?? 0;
          earthCost += e?.cost ?? 0;
          volumes.push(e?.volume ?? 0);
          shares.push((e?.cost ?? 0) / (done.cost || 1));
          if (steep < 0.08) flatShares.push((e?.cost ?? 0) / (done.cost || 1));
          else if (steep >= 0.15) steepShares.push((e?.cost ?? 0) / (done.cost || 1));
        }
      }
    }
  }
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
console.log(`Random streets, ${per} per map × ${seeds} seeds × ${MAP_PRESETS.length} presets\n`);
console.log('steepest 50 m of ground   placements   too steep   other rejections');
for (let i = 0; i < BANDS.length; i++) {
  const t = total[i]!;
  console.log(
    `${bandName(i).padEnd(26)} ${String(t.n).padStart(10)} ${pct(t.steep, t.n).padStart(11)} ${pct(t.other, t.n).padStart(18)}`,
  );
}
const all = total.reduce((a, t) => ({ n: a.n + t.n, steep: a.steep + t.steep, other: a.other + t.other }), {
  n: 0,
  steep: 0,
  other: 0,
});
console.log(
  `${'all'.padEnd(26)} ${String(all.n).padStart(10)} ${pct(all.steep, all.n).padStart(11)} ${pct(all.other, all.n).padStart(18)}`,
);
console.log('\nreasons:');
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(n).padStart(5)}  ${r}`);
if (build && built) {
  console.log(
    `\nbuilt ${built}: earthworks ${Math.round(earth / built)} m³ and $${Math.round(earthCost / built)} per road on average (${pct(earthCost, roadCost)} of what they cost)`,
  );
  const p = (v: number) => `${(v * 100).toFixed(0)}%`;
  console.log(
    `earthworks share of a road's price, median: all ${p(median(shares))}, ground < 8 % ${p(median(flatShares))}, ground ≥ 15 % ${p(median(steepShares))}; median volume ${median(volumes)} m³`,
  );
}
