/**
 * Dev (M35): what a big battle costs. Opens a saved city (the bench city: `npx tsx scripts/bench.ts
 * 6 --big --save bench-results/city.gz`), turns war on, builds an HQ, barracks, a depot and
 * defences near the highway, trains defenders, then has its strongest rival raid it with a full
 * force (the caps' 24 units). Prints the city's tick time on a quiet day and during the battle
 * (avg/p99/max, and the battle's own share), the whole battle run at once as the page's battle
 * worker would (an expedition against this city), and the battle's size as friends send it.
 * Usage: npx tsx scripts/dev/battlebench.ts bench-results/city.gz
 */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gunzipSync, strFromU8 } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { startWar } from '../../src/sim/systems/war';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { battleLayout } from '../../src/sim/battle/layout';
import { Battle } from '../../src/sim/battle/battle';
import { BATTLE } from '../../src/data/battle';
import { E, S, type BattleInput } from '../../src/sim/battle/types';
import { encodeBattle } from '../../src/net/snapshot';
import { placeAlong } from '../../tests/helpers';

const file = process.argv[2] ?? 'bench-results/city.gz';
const sim = Sim.fromSave(JSON.parse(strFromU8(gunzipSync(readFileSync(file)))));
sim.testMode = true;
const s = sim.state;
console.log(`city: ${s.cityName}, ${s.totals.population} residents, ${s.buildings.size} buildings`);
startWar(sim);
sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 50_000_000 });

// Military buildings along the streets nearest the highway that have room.
const connect = s.net.nodes.get(s.highway.connect)!;
const segs = [...s.net.segments.values()]
  .filter((g) => g.type === 'street' || g.type === 'avenue')
  .map((g) => {
    const a = s.net.nodes.get(g.a)!;
    const b = s.net.nodes.get(g.b)!;
    return { id: g.id, d: Math.hypot((a.x + b.x) / 2 - connect.x, (a.z + b.z) / 2 - connect.z) };
  })
  .sort((a, b) => a.d - b.d)
  .slice(0, 600);
const placed: Record<string, number> = {};
const defs = ['militaryhq', 'barracks', 'vehicledepot', 'bunker', 'bunker', 'antiair', 'bunker', 'antiair'];
for (const def of defs) {
  for (const g of segs)
    try {
      placed[`${def}${Object.keys(placed).filter((k) => k.startsWith(def)).length}`] = placeAlong(
        sim,
        def,
        g.id,
      );
      break;
    } catch {
      /* next street */
    }
}
console.log('placed', JSON.stringify(placed));
const barracks = placed.barracks0!;
const depot = placed.vehicledepot0!;
for (let k = 0; k < 8; k++) sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
for (const kind of ['tank', 'tank', 'tank', 'artillery', 'artillery', 'transport'] as const)
  sim.dispatch({ type: 'trainUnit', base: depot, kind });
sim.advance(3 * TICKS_PER_MONTH);
console.log(`forces: ${s.war!.units.size} units, readiness ${s.war!.readiness.toFixed(2)}`);

const stats = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const avg = v.reduce((a, x) => a + x, 0) / Math.max(1, v.length);
  return `avg ${avg.toFixed(2)} ms, p99 ${(v[Math.floor(v.length * 0.99)] ?? 0).toFixed(2)}, max ${(v.at(-1) ?? 0).toFixed(2)} (${v.length} ticks)`;
};
const time = (ticks: number, until?: () => boolean) => {
  const all: number[] = [];
  const battle: number[] = [];
  let b = 0;
  sim.timer = (name, fn) => {
    if (name !== 'battle') return fn();
    const t0 = performance.now();
    fn();
    b += performance.now() - t0;
  };
  for (let t = 0; t < ticks && (!until || until()); t++) {
    b = 0;
    const t0 = performance.now();
    sim.step();
    all.push(performance.now() - t0);
    battle.push(b);
  }
  sim.timer = null;
  return { all, battle };
};

// A quiet day.
const quiet = time(1440);
console.log(`quiet day: ${stats(quiet.all)}`);

// The strongest rival raids with a full force.
const rival = s.region.neighbours
  .filter((n) => n.rival)
  .sort((a, b) => b.rival!.forces - a.rival!.forces)[0]!;
sim.dispatch({ type: 'cheat', cheat: 'rival', neighbour: rival.id, forces: 400, defences: 50 });
const r = sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 });
if (!r.ok) throw new Error(r.reason);
const hb = s.war!.battle!;
const L = hb.input.layout;
console.log(
  `battle: ${hb.input.attacker.units.length} attackers, ${L.defenders.length} defenders, ${L.structs.length / S.stride} structures (cap ${BATTLE.maxStructs}), ${L.nodes.length / 2} road nodes, ${L.edges.length / E.stride} edges`,
);
const fight = time(24 * 60, () => !!s.war!.battle);
console.log(`battle ticks: ${stats(fight.all)}`);
console.log(`  of which the battle: ${stats(fight.battle)}`);
const rep = s.war!.reports!.at(-1)!;
console.log(
  `  outcome ${rep.outcome}: ${rep.collapsed.length} collapsed, ${rep.civics.length} city buildings hit, lost ${JSON.stringify(rep.lost)}, theirs ${rep.theirLost}`,
);

// The same city attacked as an expedition's target: the page's battle worker runs it at once.
const input: BattleInput = JSON.parse(JSON.stringify(hb.input));
input.id = 'bench-away';
input.layout = battleLayout(sim, { target: 'military', from: rival.side });
const t0 = performance.now();
const b = Battle.run(structuredClone(input));
console.log(`whole battle at once: ${(performance.now() - t0).toFixed(0)} ms, ${b.result().steps} steps`);
const parts = encodeBattle(input);
const bytes = parts.reduce((a, p) => a + p.length, 0);
console.log(
  `battle message: ${parts.length} part(s), ${(bytes / 1024).toFixed(1)} KB (base64, gzipped JSON ${(JSON.stringify(input).length / 1024).toFixed(0)} KB raw)`,
);
