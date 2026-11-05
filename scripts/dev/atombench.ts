/**
 * Dev (M40 step 3): what a strike costs. Opens a saved city (the bench city: `npx tsx scripts/bench.ts
 * 6 --big --save bench-results/city.gz`), turns war on, lets a game day go by and times a quiet stretch
 * for the baseline, then has a computer neighbour's atom bomb land on it at once and plays the blast
 * out slice by slice on the real clock. Prints each slice's time (the atom system's share and the whole
 * tick's), the buildings it levelled and the residents who left, the tick average and worst round the
 * strike and for the hours after it, and the size of the aftermath. The plan's budget is about 25 ms
 * a slice on the 100k city (docs/plans/M40-design.md, "Budgets").
 * Usage: npx tsx scripts/dev/atombench.ts [bench-results/city.gz] [--slice N] [--quiet-hours N]
 *   [--after-hours N]
 * `--slice N` lowers the slice limit (to see more slices on a small city).
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gunzipSync, strFromU8 } from 'fflate';
import { ATOM } from '../../src/data/atom';
import { ZONE_R } from '../../src/data/zones';
import { Sim } from '../../src/sim/sim';
import { atomInbound } from '../../src/sim/systems/atom';
import { groundZero } from '../../src/sim/systems/atomImpact';
import { startWar } from '../../src/sim/systems/war';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';

const args = process.argv.slice(2);
const value = (name: string, fallback: number) =>
  args.includes(`--${name}`) ? Number(args[args.indexOf(`--${name}`) + 1]) : fallback;
const file =
  args.find((a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--')) ?? 'bench-results/city.gz';
if (args.includes('--slice')) ATOM.impact.slice = value('slice', ATOM.impact.slice);
const quietHours = value('quiet-hours', 6);
const afterHours = value('after-hours', 12);

const sim = Sim.fromSave(JSON.parse(strFromU8(gunzipSync(readFileSync(file)))));
sim.testMode = false;
const s = sim.state;
console.log(`city: ${s.cityName}, ${s.totals.population} residents, ${s.buildings.size} buildings`);
s.options.rivals = true;
startWar(sim);
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 50_000_000 });
// A neighbour that will not interfere: no raids or spies while it is timed.
for (const n of s.region.neighbours) if (n.rival) n.rival.blackout = { from: 0, until: 1e9 };
sim.advance(TICKS_PER_MONTH);

const stats = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const avg = v.reduce((a, x) => a + x, 0) / Math.max(1, v.length);
  return `avg ${avg.toFixed(2)} ms, p99 ${(v[Math.floor(v.length * 0.99)] ?? 0).toFixed(2)}, max ${(v.at(-1) ?? 0).toFixed(2)} (${v.length} ticks)`;
};

/** Steps `ticks`, giving each tick's whole time and the atom system's share of it. */
function time(ticks: number, each?: (all: number, atom: number) => void) {
  const all: number[] = [];
  let atom = 0;
  sim.timer = (name, fn) => {
    if (name !== 'atom') return fn();
    const t0 = performance.now();
    fn();
    atom += performance.now() - t0;
  };
  for (let t = 0; t < ticks; t++) {
    atom = 0;
    const t0 = performance.now();
    sim.step();
    const dt = performance.now() - t0;
    all.push(dt);
    each?.(dt, atom);
  }
  sim.timer = null;
  return all;
}

const baseline = time(quietHours * TICKS_PER_HOUR);
console.log(`quiet ${quietHours} h: ${stats(baseline)}`);

// The bomb: accepted by the city's own sim (ground zero chosen from the town as it stands).
let t0 = performance.now();
const gz = groundZero(sim);
const gzMs = performance.now() - t0;
const near = [...s.buildings.values()].filter(
  (b) => b.state !== BState.Rubble && Math.hypot(b.x - gz.x, b.z - gz.z) <= ATOM.impact.level,
);
const homes = near.filter((b) => b.zone === ZONE_R);
console.log(
  `ground zero (${gz.x}, ${gz.z}) found in ${gzMs.toFixed(1)} ms: ${near.length} buildings inside ${ATOM.impact.level} m (${homes.length} homes, ${homes.reduce((n, b) => n + b.pop, 0)} residents), ${s.civics.size} civics in the city`,
);
t0 = performance.now();
// (As the cheat does it, without the test mode's invariants checks slowing every tick.)
const from = s.region.neighbours.find((n) => n.rival && !n.player)!;
const refused = atomInbound(sim, { id: from.id, name: from.name }, 0);
if (refused) throw new Error(refused);
console.log(`accepted in ${(performance.now() - t0).toFixed(1)} ms`);
const a = s.war!.atom!;
const rubble0 = [...s.buildings.values()].filter((b) => b.state === BState.Rubble).length;

// The blast on the real clock: the landing tick (slice 0), the tick that sets the fires, the civic
// buildings a few a tick, and a slice an hour until it is over.
interface Tick {
  n: number;
  tick: number;
  atom: number;
  levelled: number;
  fled: number;
  civics: number;
  burning: number;
}
const ticks: Tick[] = [];
let lastLevelled = 0;
let lastFled = 0;
let lastCivics = s.civics.size;
let lastBurning = s.burning.length;
let n = 0;
const hoursToRun = Math.ceil(near.length / ATOM.impact.slice) + 1;
const around = time(hoursToRun * TICKS_PER_HOUR + 2, (dt, atom) => {
  const im = a.impact;
  if (!im) return;
  const row = {
    n: n++,
    tick: dt,
    atom,
    levelled: (im.levelled ?? 0) - lastLevelled,
    fled: im.fled - lastFled,
    civics: lastCivics - s.civics.size,
    burning: s.burning.length - lastBurning,
  };
  lastLevelled = im.levelled ?? 0;
  lastFled = im.fled;
  lastCivics = s.civics.size;
  lastBurning = s.burning.length;
  if (row.levelled || row.civics || row.burning || atom > 0.5) ticks.push(row);
});
for (const t of ticks.slice(0, 40))
  console.log(
    `tick ${String(t.n).padStart(3)}: atom ${t.atom.toFixed(1).padStart(5)} ms of a ${t.tick.toFixed(1).padStart(5)} ms tick, ${t.levelled} levelled, ${t.fled} residents gone, ${t.civics} civic buildings gone, ${t.burning >= 0 ? '+' : ''}${t.burning} burning`,
  );
if (ticks.length > 40) console.log(`... ${ticks.length - 40} more ticks with blast work`);
const im = a.impact!;
console.log(
  `blast ${im.over ? 'over' : 'NOT over'} after ${im.done} slice(s) and ${n > 0 ? ticks.at(-1)!.n + 1 : 0} ticks: ${im.levelled} buildings levelled, ${im.fled} residents have left, boom ${a.boom}`,
);
console.log(`ticks round the strike (${hoursToRun} h): ${stats(around)}`);
const worstAtom = Math.max(0, ...ticks.map((x) => x.atom));
const worstTick = Math.max(0, ...ticks.map((x) => x.tick));
console.log(
  `worst tick of the blast: ${worstAtom.toFixed(1)} ms in the atom system, ${worstTick.toFixed(1)} ms in all (budget about 25 ms a slice on the 100k city)`,
);

// And the city afterwards: rubble, fires, closed roads and the people who left.
const after = time(afterHours * TICKS_PER_HOUR);
console.log(`after ${afterHours} h: ${stats(after)}`);
const rubble = [...s.buildings.values()].filter((b) => b.state === BState.Rubble).length;
console.log(
  `rubble ${rubble0} -> ${rubble}, burning ${s.burning.length}, roads closed ${s.roadDamage.size}, residents now ${s.totals.population}`,
);
