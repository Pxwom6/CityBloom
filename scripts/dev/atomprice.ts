// Dev (M40): what the race for the atom bomb costs, against a saved city's taxes. For each priced step
// it prints the price in days, months and years of the city's tax income (`monthlyTaxes`: last month's
// taxes; a ledger month is a game day-and-night and a game year is 12 of them, so a "day" here is the
// calendar's 30th part of a month). The plan aims at 3 to 6 game years of a big city's taxes for the
// whole race, and about 3 for the silo and the bomb on the 100,000-resident city.
// Usage: npx tsx scripts/dev/atomprice.ts [bench-results/city.gz]   (the bench city, from
//   `npx tsx scripts/bench.ts 6 --big --save bench-results/city.gz`; it does not grow one itself)
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, strFromU8 } from 'fflate';
import { ATOM } from '../../src/data/atom';
import { CIVIC } from '../../src/data/civic';
import { TIERS } from '../../src/data/research';
import { WAR } from '../../src/data/war';
import { Sim } from '../../src/sim/sim';
import { monthlyTaxes } from '../../src/sim/systems/diplomacy';

const file = process.argv[2] ?? 'bench-results/city.gz';
if (!existsSync(file)) {
  console.error(
    `${file} is missing. This probe prices the race against the bench city's taxes and does not grow one:\n` +
      '  npx tsx scripts/bench.ts 6 --big --save bench-results/city.gz',
  );
  process.exit(1);
}
const sim = Sim.fromSave(JSON.parse(strFromU8(gunzipSync(readFileSync(file)))));
const taxes = monthlyTaxes(sim);
if (taxes <= 0) {
  console.error('the city has no taxes on record (last month): run it a month first');
  process.exit(1);
}
const e = sim.state.economy;
const lines = e.history.at(-1)?.lines ?? e.month;
const income = Object.entries(lines).reduce((a, [, v]) => a + (v > 0 ? v : 0), 0);
console.log(
  `${file}: population ${sim.state.totals.population}, taxes $${taxes.toLocaleString('en-US')} a month ` +
    `($${(taxes * 12).toLocaleString('en-US')} a year; all income $${Math.round(income).toLocaleString('en-US')} a month)\n`,
);

const stagesOf = (id: string) => CIVIC.get(id)!.project!.stages;
const sum = (id: string, key: 'cost' | 'months') => stagesOf(id).reduce((a, s) => a + s[key], 0);
const instalments = ATOM.bomb.hours / ATOM.bomb.every;
const mat = WAR.materials.importPrice;
const inst = ATOM.bomb.instalment;
// What the materials would cost bought outright, at the import price (the war stores cover part of it).
const bombMaterials = instalments * (inst.goods * mat.goods + inst.ore * mat.ore + inst.oil * mat.oil);
const bombMoney = instalments * inst.money;
const fuel = ATOM.fuel.hours * ATOM.fuel.cost;

interface Step {
  name: string;
  price: number;
  /** War hours it takes (the war clock; a game hour is 7.5 s of play at 1x). */
  hours: number;
  note?: string;
}
const steps: Step[] = [
  {
    name: 'Research, all 24 tiers',
    price: TIERS.reduce((a, t) => a + t.cost, 0),
    hours: 0,
    note: 'given: the labs need about 6 h of play',
  },
  {
    name: 'Enrichment plant, 3 stages',
    price: sum('enrichment', 'cost'),
    hours: sum('enrichment', 'months') * 24,
  },
  { name: 'Fuel, a full load', price: fuel, hours: ATOM.fuel.hours },
  { name: 'Atom silo, 3 stages', price: sum('atomsilo', 'cost'), hours: sum('atomsilo', 'months') * 24 },
  { name: 'Bomb, 12 instalments (money)', price: bombMoney, hours: ATOM.bomb.hours },
  {
    name: 'Bomb, materials at import prices',
    price: bombMaterials,
    hours: 0,
    note: 'less what the war stores, mines and wells cover',
  },
  { name: 'Launch preparation', price: ATOM.launch.cost, hours: ATOM.launch.prepHours },
];

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`.padStart(12);
const num = (n: number, d = 1) => n.toFixed(d).padStart(8);
const row = (name: string, price: number, hours: number, note = '') =>
  console.log(
    `${name.padEnd(36)}${money(price)}${num(price / (taxes / 30), 0)}${num(price / taxes)}${num(price / (taxes * 12), 2)}` +
      `${hours ? ` ${String(hours).padStart(6)} h ${num((hours * 7.5) / 60, 0)} min` : ' '.repeat(18)}  ${note}`,
  );
console.log(
  `${'step'.padEnd(36)}${'price'.padStart(12)}${'days'.padStart(8)}${'months'.padStart(8)}${'years'.padStart(8)}   war time and play at 1x`,
);
for (const s of steps) row(s.name, s.price, s.hours, s.note);

// The sums that matter: the plan's targets are the silo and bomb together, and the whole race.
const siloBomb = sum('atomsilo', 'cost') + bombMoney;
const race = steps.filter((s) => s.name !== 'Research, all 24 tiers').reduce((a, s) => a + s.price, 0);
// Upkeep while it is built: the plant from its completion to the launch, the silo from its own.
const plantDone = sum('enrichment', 'months') * 24;
const siloDone = plantDone + sum('atomsilo', 'months') * 24;
const end = plantDone + ATOM.fuel.hours + ATOM.bomb.hours + ATOM.launch.prepHours;
const upkeep =
  (CIVIC.get('enrichment')!.upkeep * (end - plantDone)) / 24 +
  (CIVIC.get('atomsilo')!.upkeep * (end - siloDone)) / 24;
console.log('');
row('Silo and bomb (money)', siloBomb, 0, 'the plan: about 3 years');
row('Whole race, from the first stone', race, end, 'the plan: 3 to 6 years');
row('  and the plant and silo upkeep', race + upkeep, end);
console.log(
  `\ncritical path ${end} war hours = ${((end * 7.5) / 3600).toFixed(2)} h of play at 1x ` +
    `(plant ${plantDone} h, fuel ${ATOM.fuel.hours} h, bomb ${ATOM.bomb.hours} h, launch ${ATOM.launch.prepHours} h; ` +
    `the silo is built beside the fuel); upkeep $${Math.round(upkeep).toLocaleString('en-US')} ` +
    `(${CIVIC.get('enrichment')!.upkeep.toLocaleString('en-US')} + ${CIVIC.get('atomsilo')!.upkeep.toLocaleString('en-US')} a month)`,
);
