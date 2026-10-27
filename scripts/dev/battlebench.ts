/**
 * Dev (M35): what a big battle costs. Opens a saved city (the bench city: `npx tsx scripts/bench.ts
 * 6 --big --save bench-results/city.gz`), turns war on, builds an HQ, barracks, a depot and
 * defences near the highway, trains defenders, then has its strongest rival raid it with a full
 * force (the caps' 24 units). Prints the city's tick time on a quiet day and during the battle
 * (avg/p99/max, and the battle's own share), the whole battle run at once as the page's battle
 * worker would (an expedition against this city), and the battle's size as friends send it.
 * Usage: npx tsx scripts/dev/battlebench.ts bench-results/city.gz [--super robot|fortress|whale]
 *   [--dome] [--guards] [--dump input.json]
 * M37 (battles version 3): `--super` makes the raid a superweapon's (the robot and 23 heavy tanks by
 * road; the sky fortress, its 16 drones, 12 bombers and 11 fighters by air; the whale and 23
 * gunboats by sea), `--dome` raises a dome's pool of 40,000 over the city, and `--guards` gives the
 * city Hardened buildings, four interceptor batteries and two shield generators. The whole battle at
 * once is then fought with the superweapon caps, and its superweapon moments are counted. `--dump`
 * writes that battle's input (JSON) for a closer look at it alone.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gunzipSync, strFromU8 } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { startWar } from '../../src/sim/systems/war';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { battleLayout } from '../../src/sim/battle/layout';
import { Battle } from '../../src/sim/battle/battle';
import { BATTLE, SUPER } from '../../src/data/battle';
import type { UnitKind } from '../../src/data/war';
import { E, S, type BattleInput, type BattleUnitIn } from '../../src/sim/battle/types';
import { stampBattle } from '../../src/sim/battle/version';
import { encodeBattle } from '../../src/net/snapshot';
import { placeAlong } from '../../tests/helpers';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const superKind = args[args.indexOf('--super') + 1] as 'robot' | 'fortress' | 'whale' | undefined;
const superweapon = args.includes('--super') ? superKind : undefined;
if (args.includes('--super') && !['robot', 'fortress', 'whale'].includes(superKind ?? ''))
  throw new Error('--super robot|fortress|whale');
const file =
  args.find((a, k) => !a.startsWith('--') && args[k - 1] !== '--super' && args[k - 1] !== '--dump') ??
  'bench-results/city.gz';
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
if (flag('guards')) {
  // Research done as the labs would leave it, then the batteries and generators near the highway.
  s.war!.research = {
    done: ['defence1', 'defence2', 'defence3'],
    queue: [],
    points: {},
    paid: [],
    prototypes: [],
    proven: [],
    trials: [],
  };
  defs.push('interceptor', 'interceptor', 'shieldgen', 'interceptor', 'interceptor', 'shieldgen');
}
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
/** A superweapon's force (M37), as the design's heaviest battles stage it. */
function superForce(kind: 'robot' | 'fortress' | 'whale'): {
  units: BattleUnitIn[];
  route: 'highway' | 'air' | 'sea';
} {
  const unit = (k: UnitKind, id: number, from?: number): BattleUnitIn => ({
    id,
    kind: k,
    hp: 1,
    x: 0,
    z: 0,
    base: -1,
    ...(from !== undefined ? { from } : {}),
  });
  const own = (list: UnitKind[]) => list.map((k, i) => unit(k, -(i + 1)));
  if (kind === 'robot')
    return { units: own(['windupbot', ...Array<UnitKind>(23).fill('heavytank')]), route: 'highway' };
  if (kind === 'whale')
    return { units: own(['clockworkwhale', ...Array<UnitKind>(23).fill('gunboat')]), route: 'sea' };
  const units = own([
    'skyfortress',
    ...Array<UnitKind>(12).fill('bomber'),
    ...Array<UnitKind>(11).fill('fighter'),
  ]);
  for (let k = 0; k < 16; k++) units.push(unit('drone', -(SUPER.carriedId + k), -1));
  return { units, route: 'air' };
}
if (superweapon) {
  const f = superForce(superweapon);
  hb.input.attacker.units = f.units;
  hb.input.attacker.route = f.route;
}
if (flag('dome')) hb.input.layout.dome = 40_000;
stampBattle(hb.input);
sim.battleRun = null;
const L = hb.input.layout;
const intercepts = (structs: number[]) => {
  let n = 0;
  for (let k = 0; k < structs.length; k += S.stride) if (structs[k + S.tags]! & 1024) n++;
  return n;
};
console.log(
  `version ${hb.input.v}${superweapon ? `, ${superweapon}` : ''}${L.dome ? `, dome ${L.dome}` : ''}, interceptors ${intercepts(L.structs)}, shields ${flag('guards') ? 'on' : 'off'}`,
);
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
if (flag('dome')) input.layout.dome = 40_000;
// In a computer neighbour's town a superweapon's battle has its own, bigger caps.
if (superweapon) input.caps = { ...SUPER.caps };
stampBattle(input);
if (flag('dump')) writeFileSync(args[args.indexOf('--dump') + 1]!, JSON.stringify(input));
const t0 = performance.now();
const b = Battle.run(structuredClone(input));
const res = b.result();
console.log(
  `whole battle at once: ${(performance.now() - t0).toFixed(0)} ms, ${res.steps} steps, ${res.outcome}, ${res.destroyed.length} down, ${res.damaged.length} hit, objectives ${res.objectives.down}/${res.objectives.aimed}`,
);
if (superweapon || flag('dome') || flag('guards')) {
  // Played again a tick at a time (not timed): what the superweapons and guards did.
  const w = new Battle(structuredClone(input));
  let puffs = 0;
  let popped = -1;
  const drones = new Set<number>();
  let dived = 0;
  let shots = 0;
  while (!w.outcome) {
    for (const e of w.tick()) if (e.k === 'dome') popped = w.step;
    const f = w.frame();
    shots = Math.max(shots, f.shots.length);
    for (const sh of f.shots) if (sh.kind === 3) puffs++;
    for (const u of f.units) {
      if (u.kind === 'drone' && u.id <= -SUPER.carriedId) drones.add(u.id);
      if (u.state === 3) dived++;
    }
  }
  const sup = res.units.find((u) => u.side === 0 && u.id === -1);
  console.log(
    `  superweapon ${sup ? `${sup.kind} hp ${sup.hp}${sup.out ? ' (knocked out)' : ''}` : 'none'}, drones launched ${drones.size}, unit-ticks dived ${dived}, shells stopped ${puffs}, dome ${popped >= 0 ? `popped at step ${popped}` : L.dome ? 'held' : 'none'}, most shots a tick ${shots}`,
  );
}
const parts = encodeBattle(input);
const bytes = parts.reduce((a, p) => a + p.length, 0);
console.log(
  `battle message: ${parts.length} part(s), ${(bytes / 1024).toFixed(1)} KB (base64, gzipped JSON ${(JSON.stringify(input).length / 1024).toFixed(0)} KB raw)`,
);
