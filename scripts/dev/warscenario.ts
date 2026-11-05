/**
 * M39 step 9 probe: grow the town a war scenario starts from, give it a military, send scripted
 * raids at it and print what each did.
 *
 *   npx tsx scripts/dev/warscenario.ts [seed] [pop] [waves: infantry,tank,...;infantry,...]
 */
import { Player } from '../lib/mayor';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';
import { startWar, militaryCivics } from '../../src/sim/systems/war';
import type { UnitKind } from '../../src/data/war';
import { cityStrength, planRaid } from '../../src/sim/systems/raids';
import { objectiveSpots } from '../../src/sim/battle/layout';
import { Rng } from '../../src/sim/rng';
import { Battle } from '../../src/sim/battle/battle';
import { S } from '../../src/sim/battle/types';
import type { BattleTarget } from '../../src/data/battle';

const seed = process.argv[2] ?? 'bastion';
const target = Number(process.argv[3] ?? 3300);
const waves = (
  process.argv[4] ??
  'infantry,infantry,infantry,infantry;tank,tank,infantry,infantry,infantry,infantry;tank,tank,tank,artillery,infantry,infantry,infantry,infantry'
)
  .split(';')
  .map((w) => w.split(',') as UnitKind[]);
const p = new Player('careful', { seed, preset: 'river', cityName: 'Probe' });
const sim = p.sim;
sim.testMode = true;
while (sim.state.totals.population < target) {
  p.play();
  sim.advance(TICKS_PER_HOUR * 6);
}
const count = () => {
  let n = 0;
  for (const b of sim.state.buildings.values()) if (b.state !== BState.Rubble) n++;
  return n;
};
console.log(
  `town: pop ${sim.state.totals.population}, buildings ${count()}, month ${sim.state.tick / TICKS_PER_MONTH}`,
);
sim.state.options.rivals = true;
startWar(sim);
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 400_000 });
for (const def of ['militaryhq', 'barracks', 'bunker', 'bunker', 'bunker', 'shelter'])
  console.log(def, p.place(def, 'industry'));
const barracks = militaryCivics(sim).find((c) => c.def === 'barracks')!;
const extraBunkers = Number(process.env.BUNKERS ?? 0);
for (let k = 0; k < extraBunkers; k++) p.placeNear('bunker', { x: p.c.x + 120 + k * 40, z: p.c.z }, 500);
const infantry = Number(process.env.INF ?? 4);
for (let k = 0; k < infantry; k++) sim.dispatch({ type: 'trainUnit', base: barracks.id, kind: 'infantry' });
sim.advance(3 * TICKS_PER_MONTH);
console.log(`units ${sim.state.war!.units.size}, strength ${cityStrength(sim).toFixed(1)}`);
const rivals = sim.state.region.neighbours.filter((n) => n.rival);
rivals.forEach((n) =>
  console.log(n.name, n.rival!.personality, n.rival!.forces, n.rival!.defences, n.side, n.population),
);
const base = count();
for (const units of waves) {
  const n = rivals[0]!;
  const w = sim.state.war!;
  const rng = new Rng(w.rng);
  const raid = planRaid(sim, n, n.rival!, rng, 3);
  w.rng = rng.getState();
  raid.units = units.map((kind) => ({ kind, hp: 1 }));
  const want = (process.env.TARGET ?? 'military') as BattleTarget;
  if (objectiveSpots(sim, want).length) raid.target = want;
  console.log('raid', raid.target, objectiveSpots(sim, want).length, 'spots');
  let dumped = false;
  for (
    let t = 0;
    t < 3 * TICKS_PER_MONTH && (sim.state.war!.incoming?.length || sim.state.war!.battle);
    t++
  ) {
    sim.step();
    if (!dumped && sim.state.war!.battle && process.env.DUMP) {
      dumped = true;
      const input = structuredClone(sim.state.war!.battle.input);
      const b = Battle.run(input);
      const r = b.result();
      const L = input.layout;
      console.log(
        `  battle: ${L.structs.length / S.stride} structs, ${L.defenders.length} defenders, objectives down ${r.objectives.down}/${r.objectives.aimed}, destroyed ${r.destroyed.length}, damaged ${r.damaged.length}, outcome ${r.outcome}, steps ${b.step}`,
      );
    }
  }
  const rep = sim.state.war!.reports!.at(-1)!;
  console.log(
    `wave ${units.length} (${rep.target}): ${rep.outcome}, collapsed ${rep.collapsed.length}, burning ${rep.burning.length}, civics ${rep.civics.length}, craters ${rep.craters}, lost ${JSON.stringify(rep.lost)}, theirLost ${rep.theirLost}/${rep.theirTotal}, homeless ${rep.homeless}`,
  );
  sim.advance(TICKS_PER_MONTH);
  console.log(
    `  standing ${count()}/${base} = ${((count() / base) * 100).toFixed(1)}%, pop ${sim.state.totals.population}`,
  );
}
