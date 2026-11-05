/**
 * Dev (M40 step 4): what fallout does on the map, to tune its constants (`FALLOUT` in
 * src/data/atom.ts). Takes a city of rivals, puts a strike's deposit on the ground at a spot
 * (`depositFallout`, as the blast does when it is over) and plays the real update (`updateFallout`,
 * every three game hours) and the neighbours' monthly fade over some game years, on the city's own
 * wind. Raster only: the town is not played, so 25 game years take a second or two. Prints, year by
 * year, the ground closed to building (km²), the strike's centre (ground, then dose), the air still
 * aloft, what has crossed each edge (`out`) and each neighbour's fallout.
 *
 *   npx tsx scripts/dev/fallout.ts [seed] [--at x,z] [--years 25] [--all] [--rival west=1] [--none] [--scan]
 *
 * `--at` is the strike's ground zero (default the middle of the map). `--all` prints every year (else
 * 1 to 3, then every fifth). `--rival side=level` gives a neighbour fallout to begin with (a bomb that
 * landed on it) to see the stream it sends in, and `--none` leaves the strike out (the table then
 * shows the ground at `--at`). `--scan` runs the same strike on twelve seeds and prints only the wind,
 * the air after a day and what the neighbours have after four.
 */
import { FALLOUT } from '../../src/data/atom';
import { GRID_CELL, GRID_RES, MAP_SIZE } from '../../src/data/world';
import { Sim } from '../../src/sim/sim';
import {
  depositFallout,
  falloutOf,
  falloutTownMonth,
  falloutYears,
  updateFallout,
} from '../../src/sim/systems/fallout';
import { windAngle } from '../../src/sim/systems/pollution';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : undefined);
const seed = args.find((a, k) => !a.startsWith('--') && !args[k - 1]?.startsWith('--')) ?? 'citybloom';
const years = Number(flag('years') ?? 25);
const at = (flag('at') ?? `${MAP_SIZE / 2},${MAP_SIZE / 2}`).split(',').map(Number) as [number, number];
const R = GRID_RES;

const deg = (rad: number) => ((((rad * 180) / Math.PI) % 360) + 360) % 360;
const compass = (rad: number) => {
  const d = deg(rad);
  // (x east, z south; the map's north is z = 0.)
  return ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][Math.round(d / 45) % 8]!;
};

function city(seedName: string): Sim {
  const sim = Sim.create({ seed: seedName, preset: 'river', rivals: true });
  for (const n of sim.state.region.neighbours) if (n.rival) delete n.rival.fallout;
  const rival = flag('rival');
  if (rival) {
    const [side, level] = rival.split('=');
    for (const n of sim.state.region.neighbours)
      if (n.side === side && n.rival) n.rival.fallout = Number(level);
  }
  return sim;
}

/** One game day (a month) of updates and the neighbours' fade. */
function day(sim: Sim): void {
  for (let h = 0; h < TICKS_PER_MONTH; h += 3 * TICKS_PER_HOUR) {
    sim.state.tick += 3 * TICKS_PER_HOUR;
    updateFallout(sim);
  }
  for (const n of sim.state.region.neighbours) falloutTownMonth(n);
}

const sum = (a: Float32Array) => a.reduce((x, y) => x + y, 0);

if (args.includes('--scan')) {
  console.log('seed       wind (blows towards)   air after 1 day  out n/s/w after 4 days   neighbours n/s/w');
  for (const name of ['citybloom', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'hill', 'port', 'river', 'x1']) {
    const sim = city(name);
    depositFallout(sim, at[0], at[1]);
    const f = falloutOf(sim);
    day(sim);
    const air1 = sum(f.air);
    for (let k = 0; k < 3; k++) day(sim);
    const a = windAngle(name, sim.state.tick);
    const lvl = (side: string) =>
      sim.state.region.neighbours.find((n) => n.side === side)?.rival?.fallout?.toFixed(3) ?? '-';
    console.log(
      `${name.padEnd(10)} ${compass(a).padEnd(3)} ${deg(a).toFixed(0).padStart(3)} deg           ${air1.toFixed(1).padStart(8)}  ` +
        `${f.out.north.toFixed(1)}/${f.out.south.toFixed(1)}/${f.out.west.toFixed(1)}`.padEnd(24) +
        `${lvl('north')}/${lvl('south')}/${lvl('west')}`,
    );
  }
  process.exit(0);
}

const sim = city(seed);
const a0 = windAngle(seed, 0);
console.log(
  `seed ${seed}: the wind blows towards ${compass(a0)} (${deg(a0).toFixed(0)} deg); strike at (${at[0]}, ${at[1]}); ` +
    `ban ${FALLOUT.ban}, half-life ${FALLOUT.halfLifeYears} years; the neighbours: ` +
    sim.state.region.neighbours.map((n) => `${n.name} (${n.side})`).join(', '),
);
if (!args.includes('--none')) depositFallout(sim, at[0], at[1]);
const f = falloutOf(sim);
const centre = Math.floor(at[1] / GRID_CELL) * R + Math.floor(at[0] / GRID_CELL);
console.log(
  `deposit: ${(sum(f.ground) / 1000).toFixed(2)}k of ground (centre ${f.ground[centre]!.toFixed(2)}), ` +
    `${sum(f.air).toFixed(0)} of air; the centre's ${falloutYears(f.ground[centre]!).toFixed(1)} years to the ban by the decay alone`,
);
console.log(
  'year  closed km2  open>0.02 km2  centre  dose   air   out n/s/w          neighbours n/s/w     first reopened',
);
const row = (label: string) => {
  let closed = 0;
  let open = 0;
  for (let k = 0; k < f.ground.length; k++) {
    if (f.ground[k]! >= FALLOUT.ban) closed++;
    else if (f.ground[k]! >= 0.02) open++;
  }
  const km2 = (cells: number) => ((cells * GRID_CELL * GRID_CELL) / 1e6).toFixed(2);
  const lvl = (side: string) =>
    sim.state.region.neighbours.find((n) => n.side === side)?.rival?.fallout?.toFixed(3) ?? '-';
  console.log(
    `${label.padStart(4)}  ${km2(closed).padStart(9)}  ${km2(open).padStart(13)}  ${f.ground[centre]!.toFixed(3)}  ${Math.min(1, f.ground[centre]! + FALLOUT.airDose * f.air[centre]!).toFixed(3)}  ` +
      `${sum(f.air).toFixed(1).padStart(5)}  ${f.out.north.toFixed(1)}/${f.out.south.toFixed(1)}/${f.out.west.toFixed(1)}`.padEnd(
        24,
      ) +
      `${lvl('north')}/${lvl('south')}/${lvl('west')}`,
  );
};
row('0');
let reopened = -1;
const t0 = Date.now();
for (let y = 1; y <= years; y++) {
  for (let d = 0; d < 12; d++) {
    day(sim);
    if (reopened < 0 && f.ground[centre]! < FALLOUT.ban) reopened = y - 1 + (d + 1) / 12;
  }
  if (args.includes('--all') || y <= 3 || y % 5 === 0 || y === years) row(String(y));
}
console.log(
  `the centre fell below the ban after ${reopened < 0 ? 'more than ' + years : reopened.toFixed(1)} game years ` +
    `(${(reopened * 0.6).toFixed(1)} hours of play at 1x); ${years} years of updates took ${Date.now() - t0} ms`,
);
