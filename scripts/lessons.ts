// Learn's prepared towns (M42): a small town for each lesson, written to public/lessons/<id>.citybloom.
// Usage: npx tsx scripts/lessons.ts [id,id...]   (all when none given)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { decodeSave, encodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { TICKS_PER_HOUR } from '../src/sim/time';
import { LESSONS } from '../src/client/lessons';
import { buildTown, serveTown } from '../tests/helpers';
import { toMorning } from './lib/scenarioCities';

/** A small grid town, grown for `days` game days; with services or without. */
function town(seed: string, name: string, services: boolean, days: number, disasters = false): Sim {
  const sim = Sim.create({ seed, preset: 'river', cityName: name, disasters });
  sim.testMode = true;
  buildTown(sim, { length: 560, streets: 5 });
  serveTown(sim, services);
  sim.advance(TICKS_PER_HOUR * 24 * days);
  sim.testMode = false;
  return sim;
}

const RECIPES: Record<string, () => Sim> = {
  // Busy streets at rush hour: one avenue and its side streets.
  traffic: () => town('lessontraffic', 'Busyford', true, 8),
  // Spending more than it earns, with little in the bank.
  money: () => {
    const sim = town('lessonmoney', 'Thriftwick', true, 6);
    sim.testMode = true;
    for (const z of ['R', 'C', 'I'] as const)
      sim.dispatch({ type: 'setTax', zone: z, wealth: 'all', rate: 5 });
    sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 4_000 - sim.state.treasury });
    sim.testMode = false;
    return sim;
  },
  // Power and water, and nothing else: homes start to leave.
  services: () => town('lessonservices', 'Bareton', false, 5),
  // A served town, disasters on.
  disasters: () => town('lessondisasters', 'Steadfield', true, 6, true),
  districts: () => town('lessondistricts', 'Quarterly', true, 6),
  friends: () => town('lessonfriends', 'Twinbury', true, 6),
  // A town with rivals and a garrison (the HQ, barracks, bunkers, squads): Hold the Line's starting town.
  war: () => Sim.fromSave(decodeSave(readFileSync('public/scenarios/holdline.citybloom'))),
};

const wanted = (process.argv[2] ?? Object.keys(RECIPES).join(',')).split(',');
mkdirSync('public/lessons', { recursive: true });
for (const id of wanted) {
  const make = RECIPES[id];
  const lesson = LESSONS.find((l) => l.id === id);
  if (!make || !lesson?.save) throw new Error(`No recipe or lesson for ${id}`);
  const t0 = performance.now();
  const sim = make();
  toMorning(sim);
  const bytes = encodeSave(sim.save());
  writeFileSync(`public/lessons/${lesson.save}`, bytes);
  const st = sim.stats();
  console.log(
    `${id}: ${st.population} residents, $${st.treasury}, ${(bytes.length / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(0)} s`,
  );
}
