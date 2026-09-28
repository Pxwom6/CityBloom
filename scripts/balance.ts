// Balance tool: plays scripted strategies headlessly for years of game time and prints curves of
// population, treasury, approval and demand (SPEC §8).
// Usage: npx tsx scripts/balance.ts [years=20] [careful,greedy,neglectful] [--csv dir] [--seed s]
//   [--weather 0-3] [--seasons off] (this city's weather intensity and seasons, for A/B runs)
//   [--save dir] (keeps each strategy's city as <dir>/<strategy>.citybloom, loadable in the game)
//   [--demo] (with --save: no random disasters, unused zoning cleared and a mid-afternoon clock, for
//   the main menu's town)
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync, strToU8 } from 'fflate';
import { checkInvariants } from '../src/sim/invariants';
import { CIVIC } from '../src/data/civic';
import { ROAD_TYPES } from '../src/data/roads';
import { advise } from '../src/sim/systems/advisors';
import { TAX_BASE } from '../src/data/economy';
import { ZONE_NONE } from '../src/data/zones';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../src/sim/time';
import { roadsidePose } from '../src/sim/world/civic';
import { happinessFactors } from '../src/sim/systems/happiness';
import { BState } from '../src/sim/world/buildings';
import { GROWTH } from '../src/data/balance';
import { Player, type Sample, type StrategyId } from './lib/mayor';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const csvDir = flag('--csv');
const saveDir = flag('--save');
const demo = args.includes('--demo');
if (demo) args.splice(args.indexOf('--demo'), 1);
const verbose = Number(flag('--verbose') ?? 0);
// --invariants: check the sim's invariants every game hour (a long headless soak).
const invariants = args.includes('--invariants');
if (invariants) args.splice(args.indexOf('--invariants'), 1);
const seed = flag('--seed') ?? 'balance';
const difficulty = (flag('--difficulty') ?? 'normal') as 'easy' | 'normal' | 'hard';
// Exploration knobs (in memory only): --scale tax=1.5,upkeep=0.8,road=1
const scale = Object.fromEntries(
  (flag('--scale') ?? '')
    .split(',')
    .filter(Boolean)
    .map((kv) => kv.split('='))
    .map(([k, v]) => [k, Number(v)]),
) as Record<string, number>;
if (scale.tax)
  for (const z of ['R', 'C', 'I'] as const) TAX_BASE[z] = TAX_BASE[z].map((v) => v * scale.tax!) as never;
if (scale.upkeep) for (const d of CIVIC.values()) d.upkeep = Math.round(d.upkeep * scale.upkeep);
if (scale.road) for (const r of Object.values(ROAD_TYPES)) r.upkeepPerMetre *= scale.road;
// Seasons and weather (M22), for A/B runs: --weather 0|1|2|3 (intensity) and --seasons off.
const weatherIntensity = flag('--weather');
const seasonsOff = flag('--seasons') === 'off';
const years = Number(args[0] ?? 20);
const strategies = (args[1] ?? 'careful,greedy,neglectful').split(',') as StrategyId[];
const MONTHS_PER_YEAR = 12;

/** Why moods are what they are: mean factor per zone, and how many are in distress. */
function moods(p: Player): void {
  for (const [zone, label] of [
    [1, 'R'],
    [2, 'C'],
    [3, 'I'],
  ] as const) {
    const list = [...p.sim.state.buildings.values()].filter(
      (b) => b.zone === zone && b.state === BState.Active,
    );
    if (!list.length) continue;
    const sum = new Map<string, number>();
    for (const b of list)
      for (const f of happinessFactors(p.sim, b))
        sum.set(f.label, (sum.get(f.label) ?? 0) + f.value / list.length);
    const low = list.filter((b) => b.happiness < GROWTH.distressHappiness).length;
    const mean = list.reduce((a, b) => a + b.happiness, 0) / list.length;
    // MOODALL=1: every factor, not just the five that hurt most.
    const top = [...sum.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, process.env.MOODALL ? undefined : 5)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(', ');
    console.log(`      ${label}: ${list.length} active, mood ${mean.toFixed(2)}, ${low} distressed | ${top}`);
  }
}

const BARS = '▁▂▃▄▅▆▇█';
function spark(values: number[], lo = Math.min(...values), hi = Math.max(...values)): string {
  return values
    .map((v) => BARS[Math.max(0, Math.min(7, Math.round(((v - lo) / (hi - lo || 1)) * 7)))])
    .join('');
}

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

for (const id of strategies) {
  const t0 = performance.now();
  const p = new Player(id, { seed, difficulty, cityName: demo ? 'Bloomfield' : id });
  if (weatherIntensity !== undefined || seasonsOff)
    p.sim.dispatch({
      type: 'setWeather',
      ...(weatherIntensity !== undefined ? { intensity: Number(weatherIntensity) as 0 | 1 | 2 | 3 } : {}),
      ...(seasonsOff ? { seasons: false } : {}),
    });
  const samples: Sample[] = [];
  const months = years * MONTHS_PER_YEAR;
  for (let m = 0; m < months; m++) {
    for (let h = 0; h < 4; h++) {
      p.play();
      if (!invariants) p.sim.advance(TICKS_PER_HOUR * 6);
      else
        for (let k = 0; k < 6; k++) {
          p.sim.advance(TICKS_PER_HOUR);
          checkInvariants(p.sim);
        }
    }
    samples.push(p.sample());
    if (m < verbose) {
      const st = p.stats();
      const u = st.utilities;
      const e = p.sim.state.economy;
      const last = e.history[e.history.length - 1]?.lines ?? {};
      const lines = Object.entries(last)
        .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
        .slice(0, 6)
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(', ');
      console.log(
        `  m${m + 1}: pop ${st.population} bld ${st.buildings} abandoned ${st.abandoned} jobs ${st.jobsFilled}/${st.jobs} ` +
          `approval ${Math.round(st.approval * 100)}% $${fmt(st.treasury)} net ${fmt(st.netMonthly)} | ` +
          `power ${u.power.supply}/${Math.round(u.power.demand)} water ${u.water.supply}/${Math.round(u.water.demand)} ` +
          `sewage ${u.sewage.supply}/${Math.round(u.sewage.demand)} | ${lines}`,
      );
      moods(p);
    }
  }
  if (process.env.MOOD) moods(p);
  if (process.env.GARB) {
    for (const c of p.sim.state.civics.values()) {
      const g = p.sim.civicDetails(c.id)?.garbage;
      if (g)
        console.log(
          `  ${c.def} #${c.id} at ${Math.round(c.x)},${Math.round(c.z)}: trucks ${g.out}/${g.trucks} stored ${Math.round(g.stored)}/${g.storage} processed ${Math.round(g.processedToday)}/${g.process}`,
        );
    }
    const dirty = [...p.sim.state.buildings.values()].filter((b) => b.garbage > 20);
    console.log(
      `  dirty buildings ${dirty.length} of ${p.sim.state.buildings.size}; mean garbage ${(dirty.reduce((a, b) => a + b.garbage, 0) / Math.max(1, dirty.length)).toFixed(0)}`,
    );
  }
  if (process.env.TRYPLACE) {
    const def = process.env.TRYPLACE;
    const seg = [...p.sim.state.net.segments.values()].find((x) => x.type === 'street')!;
    const d = CIVIC.get(def)!;
    const pose = roadsidePose(p.sim.net, seg.id, 40, 1, d.d);
    console.log(
      'try',
      def,
      JSON.stringify(p.sim.dispatch({ type: 'placeBuilding', def, ...pose })),
      'place()',
      p.place(def),
    );
    for (const a of advise(p.sim)) if (a.severity >= 2) console.log('  advice', a.severity, a.title);
  }
  if (process.env.ADVICE)
    for (const a of advise(p.sim))
      if (a.severity >= 1) console.log(`advice ${a.severity} ${a.advisor}: ${a.title} — ${a.text}`);
  if (process.env.DEMAND) {
    const st = p.stats();
    console.log('vacancy R/C/I', [1, 2, 3].map((z) => p.vacancy(z).toFixed(2)).join(' '));
    for (const z of ['R', 'C', 'I'] as const)
      console.log(
        z,
        st.demand[z].toFixed(2),
        st.demandFactors[z].map((f) => `${f.label} ${f.value.toFixed(2)}`).join(', '),
      );
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  console.log(`\n=== ${id} (${years} years, ${secs} s) ===`);
  console.log(
    'year  population   treasury   approval   demand R/C/I      net/mo  abandoned districts civics  on goals',
  );
  for (let y = 1; y <= years; y++) {
    const s = samples[y * MONTHS_PER_YEAR - 1]!;
    const spent = s.goals - (samples[(y - 1) * MONTHS_PER_YEAR - 1]?.goals ?? 0);
    console.log(
      `${String(y).padStart(4)} ${fmt(s.population).padStart(11)} ${fmt(s.treasury).padStart(10)} ${`${Math.round(s.approval * 100)}%`.padStart(10)}   ${[s.R, s.C, s.I].map((d) => d.toFixed(2).padStart(5)).join(' ')} ${fmt(s.net).padStart(10)} ${String(s.abandoned).padStart(10)} ${String(s.districts).padStart(9)} ${String(s.civics).padStart(6)} ${fmt(spent).padStart(9)}`,
    );
  }
  const col = (k: keyof Sample) => samples.map((s) => s[k] as number);
  console.log(`population ${spark(col('population'))}`);
  console.log(`treasury   ${spark(col('treasury'))}`);
  console.log(`approval   ${spark(col('approval'), 0, 1)}`);
  console.log(`demand R   ${spark(col('R'), -1, 1)}`);
  console.log(`first moves: ${p.log.slice(0, 14).join(', ')}`);
  if (p.goalsMet.size) {
    const when = (m: number) => `y${Math.floor(m / 12) + 1}m${(m % 12) + 1}`;
    const opened = new Map<string, number>();
    for (const e of p.sim.state.chronicle.events)
      if (e.kind === 'project') opened.set(String(e.ref), Math.floor(e.tick / TICKS_PER_MONTH));
    console.log(
      `goals: ${[...p.goalsMet].map(([d, m]) => `${d} ${when(m)}${opened.has(d) ? ` (open ${when(opened.get(d)!)})` : ''}`).join(', ')}`,
    );
  }
  const cuts = p.log.filter((l) => / taxes \d+%$/.test(l));
  if (cuts.length) console.log(`tax cuts: ${cuts.join(', ')}`);
  for (const r of p.sim.state.election.results)
    console.log(
      `election ${`y${Math.floor(r.tick / TICKS_PER_MONTH / 12) + 1}`}: ${r.won ? 'won' : 'lost'} with ${Math.round(r.share * 100)}% (approval ${Math.round(r.approval * 100)}%)${r.promises.length ? `; ${r.promises.map((q) => `${q.id} ${q.kept ? 'kept' : 'broken'}`).join(', ')}` : ''}`,
    );
  const late = samples.slice(-Math.min(samples.length, 5 * MONTHS_PER_YEAR));
  if (late.length > 1)
    console.log(
      `last ${late.length / 12} years: treasury ${fmt(late[0]!.treasury)} → ${fmt(late[late.length - 1]!.treasury)}, spent on goals ${fmt(late[late.length - 1]!.goals - late[0]!.goals)}`,
    );
  const trucks = p.log.filter((l) => l.endsWith(': truck')).map((l) => l.split(':')[0]);
  if (trucks.length) console.log(`trucks bought: ${trucks.length} (${trucks.join(', ')})`);
  const built = new Map<string, number>();
  for (const c of p.sim.state.civics.values()) built.set(c.def, (built.get(c.def) ?? 0) + 1);
  console.log(`built: ${[...built].map(([d, n]) => `${d}×${n}`).join(' ')}`);
  if (saveDir) {
    mkdirSync(saveDir, { recursive: true });
    if (demo) {
      p.sim.dispatch({ type: 'setDisasters', on: false });
      // Clear the zoning nothing has grown on, so the menu shows a finished-looking town.
      for (const b of p.sim.state.net.blocks.values())
        for (let k = 0; k < b.zone.length; k++) {
          if (b.zone[k] === ZONE_NONE || b.bld[k] !== 0) continue;
          const c = p.sim.net.cellCenter(b.id, k);
          p.sim.dispatch({ type: 'zone', zone: 'none', area: { kind: 'brush', points: [c, c], radius: 1 } });
        }
      // Clocks start at 07:00; open at 15:00 so the town runs into dusk and lit windows.
      p.sim.advance(TICKS_PER_HOUR * 8);
    }
    writeFileSync(`${saveDir}/${id}.citybloom`, gzipSync(strToU8(JSON.stringify(p.sim.save()))));
  }
  if (csvDir) {
    mkdirSync(csvDir, { recursive: true });
    const keys = Object.keys(samples[0]!) as (keyof Sample)[];
    writeFileSync(
      `${csvDir}/${id}.csv`,
      [keys.join(','), ...samples.map((s) => keys.map((k) => s[k]).join(','))].join('\n'),
    );
    // Goals met and project openings by month, for charts (scripts/dev/moneychart.mjs).
    const rows = [...p.goalsMet].map(([d, m]) => `${m},goal,${d}`);
    for (const e of p.sim.state.chronicle.events)
      if (e.kind === 'project' || e.kind === 'election')
        rows.push(`${Math.floor(e.tick / TICKS_PER_MONTH)},${e.kind},${e.ref}`);
    writeFileSync(`${csvDir}/${id}-events.csv`, ['month,kind,ref', ...rows].join('\n'));
  }
}
