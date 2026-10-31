// Dev (M40): what the race for the atom bomb costs, against a saved city's taxes. For each priced step
// it prints the price in days, months and years of the city's tax income (`monthlyTaxes`: last month's
// taxes; a ledger month is a game day-and-night and a game year is 12 of them, so a "day" here is the
// calendar's 30th part of a month). The prices were sized on a 57,000-resident careful city
// (`ATOM.priceCity`, $3.6M of taxes a year): about 3 game years of its taxes for the silo and the
// bomb, 5 to 6 for the whole race. The last column prints that city's years, whatever city is read;
// the bench city (110,000 residents) has twice the taxes, so it reads about half.
// Usage: npx tsx scripts/dev/atomprice.ts [bench-results/city.gz]   (the bench city, from
//   `npx tsx scripts/bench.ts 6 --big --save bench-results/city.gz`; it does not grow one itself)
import { existsSync, readFileSync } from 'node:fs';
import { gunzipSync, strFromU8 } from 'fflate';
import { ATOM } from '../../src/data/atom';
import { CIVIC } from '../../src/data/civic';
import { TIERS } from '../../src/data/research';
import { Sim } from '../../src/sim/sim';
import { atomPrices } from '../../src/sim/systems/atom';
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

const P = atomPrices();
const refYear = ATOM.priceCity.taxesPerYear;

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
  { name: 'Enrichment plant, 3 stages', price: P.plant.price, hours: P.plant.hours },
  { name: 'Fuel, a full load', price: P.fuel.price, hours: P.fuel.hours },
  { name: 'Atom silo, 3 stages', price: P.silo.price, hours: P.silo.hours },
  { name: 'Bomb, 12 instalments (money)', price: P.bomb.price, hours: P.bomb.hours },
  {
    name: 'Bomb, materials at import prices',
    price: P.materials,
    hours: 0,
    note: 'less what the war stores, mines and wells cover',
  },
  { name: 'Launch preparation', price: P.launch.price, hours: P.launch.hours },
];

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`.padStart(12);
const num = (n: number, d = 1) => n.toFixed(d).padStart(8);
// Years of this city's taxes, and (last) years of the city the prices were sized for.
const row = (name: string, price: number, hours: number, note = '') =>
  console.log(
    `${name.padEnd(36)}${money(price)}${num(price / (taxes / 30), 0)}${num(price / taxes)}${num(price / (taxes * 12), 2)}` +
      `${num(price / refYear, 2)}` +
      `${hours ? ` ${String(hours).padStart(6)} h ${num((hours * 7.5) / 60, 0)} min` : ' '.repeat(18)}  ${note}`,
  );
console.log(
  `${'step'.padEnd(36)}${'price'.padStart(12)}${'days'.padStart(8)}${'months'.padStart(8)}${'years'.padStart(8)}${'ref yrs'.padStart(8)}   war time and play at 1x`,
);
for (const s of steps) row(s.name, s.price, s.hours, s.note);

// The sums that matter: the silo and bomb together, and the whole race, against both cities.
console.log('');
row('Silo and bomb (money)', P.siloBomb, 0, 'sized for about 3 ref years');
row('Whole race, from the first stone', P.race, P.end, 'sized for 3 to 6 ref years');
row('  and the plant and silo upkeep', P.race + P.upkeep, P.end);
console.log(
  `\n"years" are this city's taxes; "ref yrs" the ${ATOM.priceCity.residents.toLocaleString('en-US')}-resident ` +
    `careful city the prices were sized for ($${refYear.toLocaleString('en-US')} a year); a bigger city reads fewer.\n` +
    `critical path ${P.end} war hours = ${((P.end * 7.5) / 3600).toFixed(2)} h of play at 1x ` +
    `(plant ${P.plantDone} h, fuel ${ATOM.fuel.hours} h, bomb ${ATOM.bomb.hours} h, launch ${ATOM.launch.prepHours} h; ` +
    `the silo is built beside the fuel); upkeep $${Math.round(P.upkeep).toLocaleString('en-US')} ` +
    `(${CIVIC.get('enrichment')!.upkeep.toLocaleString('en-US')} + ${CIVIC.get('atomsilo')!.upkeep.toLocaleString('en-US')} a month)`,
);
