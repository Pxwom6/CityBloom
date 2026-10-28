/**
 * Dev (M37): what each superweapon does to a computer neighbour's grown town, as the page's battle
 * worker fights it. Grows the town of a neighbour of the test city (seed `citybloom`, its resort
 * Calhaven by default: a coastal town, so the whale has a shore), arms it as `awayInput` does, and
 * fights the robot, the sky fortress and the whale there, each alone (or `--escort`ed), printing
 * buildings collapsed and wrecked, objectives down, steps, the superweapon's health, drones
 * launched and the whale's shots, and how long the battle took at once.
 * Usage: npx tsx scripts/dev/superstrike.ts [--seed citybloom] [--kind resort|industrial|suburb]
 *   [--cap 1500] [--only robot,fortress,whale] [--escort] [--forces n] [--defences n]
 *   [--town file.gz] (keeps the grown town there and loads it next time)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { gunzipSync, gzipSync, strFromU8, strToU8 } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { growRivalTown } from '../../src/sim/ai/town';
import { awayInput, type AwayCity } from '../../src/sim/battle/away';
import { Battle } from '../../src/sim/battle/battle';
import { S, TAG, type BattleInput } from '../../src/sim/battle/types';
import { BATTLE, SUPER } from '../../src/data/battle';
import type { UnitKind } from '../../src/data/war';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const k = args.indexOf(`--${name}`);
  return k >= 0 && args[k + 1] ? args[k + 1]! : fallback;
};
const seed = opt('seed', 'citybloom');
const kind = opt('kind', 'resort');
const cap = Number(opt('cap', '1500'));
const only = opt('only', 'robot,fortress,whale').split(',');
const townFile = opt('town', '');

const city = Sim.create({ seed, preset: 'river', rivals: true, disasters: false });
const n = city.state.region.neighbours.find((x) => x.rival && x.kind === kind);
if (!n) throw new Error(`no ${kind} rival`);
const rival = { ...n.rival! };
if (args.includes('--forces')) rival.forces = Number(opt('forces', '0'));
if (args.includes('--defences')) rival.defences = Number(opt('defences', '0'));

let town: Sim;
if (townFile && existsSync(townFile))
  town = Sim.fromSave(JSON.parse(strFromU8(gunzipSync(readFileSync(townFile)))));
else {
  const t0 = performance.now();
  town = growRivalTown({
    citySeed: seed,
    neighbour: n.id,
    name: n.name,
    kind: n.kind,
    personality: rival.personality,
    population: n.population,
    cap,
  });
  console.log(`grown in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
  if (townFile) writeFileSync(townFile, gzipSync(strToU8(JSON.stringify(town.save()))));
}
console.log(
  `${n.name} (${n.kind}, ${rival.personality}, forces ${rival.forces}, defences ${rival.defences}): ${town.state.totals.population} residents, ${town.state.buildings.size} buildings`,
);

const FORCES: Record<string, { route: 'highway' | 'air' | 'sea'; units: UnitKind[] }> = {
  robot: { route: 'highway', units: ['windupbot', ...Array<UnitKind>(6).fill('tank')] },
  fortress: { route: 'air', units: ['skyfortress', ...Array<UnitKind>(6).fill('bomber')] },
  whale: { route: 'sea', units: ['clockworkwhale', ...Array<UnitKind>(6).fill('gunboat')] },
};

for (const name of only) {
  const f = FORCES[name]!;
  const kinds = args.includes('--escort') ? f.units : f.units.slice(0, 1);
  const away: AwayCity = {
    seed,
    cityName: city.state.options.cityName,
    readiness: 1,
    expedition: { id: 1, route: f.route, target: 'military', stance: 'bold' },
    units: kinds.map((k, i) => ({ id: i + 1, kind: k, hp: 1 })),
    neighbour: {
      id: n.id,
      name: n.name,
      side: n.side,
      kind: n.kind,
      population: n.population,
      rival,
      slot: null,
      colour: 0xd04040,
    },
  };
  const input: BattleInput = awayInput(away, town);
  const L = input.layout;
  const t0 = performance.now();
  const b = Battle.run(structuredClone(input));
  const ms = performance.now() - t0;
  const r = b.result();
  const civic = new Set<number>();
  for (let k = 0; k < L.structs.length / S.stride; k++)
    if (L.structs[k * S.stride + S.tags]! & TAG.civic) civic.add(L.structs[k * S.stride + S.id]!);
  const wrecked = r.destroyed.filter((id) => civic.has(id)).length;
  const sup = r.units.find((u) => u.side === 0 && u.id === 1)!;
  // Played again a tick at a time: drones launched, the superweapon's shots, where it surfaced.
  const w = new Battle(structuredClone(input));
  const drones = new Set<number>();
  let shots = 0;
  let up: { x: number; z: number } | null = null;
  while (!w.outcome) {
    w.tick();
    const fr = w.frame();
    for (const u of fr.units) {
      if (u.kind === 'drone' && u.id <= -SUPER.carriedId) drones.add(u.id);
      if (u.id === 1 && u.side === 0 && u.state !== 3 && name === 'whale') up = { x: u.x, z: u.z };
    }
    const me = fr.units.find((u) => u.id === 1 && u.side === 0);
    if (me)
      for (const sh of fr.shots) if (Math.abs(sh.x0 - me.x) < 20 && Math.abs(sh.z0 - me.z) < 20) shots++;
  }
  // Where the whale was last up: how far its objectives, and what stood within its reach.
  let where = '';
  if (up) {
    const at = up;
    const d = (x: number, z: number) => Math.hypot(x - at.x, z - at.z);
    const objs = b.objectives.map((k) => d(L.structs[k * S.stride + S.x]!, L.structs[k * S.stride + S.z]!));
    let inReach = 0;
    let nearest = Infinity;
    for (let k = 0; k < L.structs.length / S.stride; k++) {
      const v =
        d(L.structs[k * S.stride + S.x]!, L.structs[k * S.stride + S.z]!) - L.structs[k * S.stride + S.rIn]!;
      nearest = Math.min(nearest, v);
      if (v <= 450) inReach++;
    }
    let townNearest = Infinity;
    for (const t of [...town.state.buildings.values(), ...town.state.civics.values()])
      townNearest = Math.min(townNearest, d(t.x, t.z));
    where = `, up at (${at.x.toFixed(0)}, ${at.z.toFixed(0)}): objectives from ${Math.min(...objs).toFixed(0)} m, ${inReach} structures within 450 m (nearest ${nearest.toFixed(0)} m; the town's nearest ${townNearest.toFixed(0)} m)`;
  }
  console.log(
    `${name}${kinds.length > 1 ? ` + ${kinds.length - 1}` : ''}: ${r.outcome}, ${r.destroyed.length - wrecked} collapsed (cap ${input.caps.maxCollapse}), ${wrecked} wrecked (cap ${input.caps.maxWreck}), ${r.damaged.length} damaged, objectives ${r.objectives.down}/${r.objectives.aimed}, ${r.steps} steps (limit ${BATTLE.maxSteps}), ${sup.kind} hp ${sup.hp}${sup.out ? ' out' : ''}, ${L.defenders.length} defenders, shots by it ${shots}${name === 'fortress' ? `, drones launched ${drones.size}, shot down ${r.units.filter((u) => u.side === 0 && u.id <= -SUPER.carriedId && u.out).length}` : ''}${where}, ${ms.toFixed(0)} ms at once`,
  );
}
