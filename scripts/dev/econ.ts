// Where a careful city's money comes from and goes, year by year (Phase 2 review): taxes at the rate
// in force and what they'd be at 6 %, the other income, every cost line, road length and traffic
// (vehicle-km a day), and the residents by wealth.
// Usage: npx tsx scripts/dev/econ.ts [years=20] [--seed balance] [--every 1] [--scale key=v,…]
import { Player } from '../lib/mayor';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import { monthlyRates } from '../../src/sim/systems/economy';
import { BState } from '../../src/sim/world/buildings';

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(n);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const seed = flag('--seed') ?? 'balance';
const every = Number(flag('--every') ?? 1);
const years = Number(args[0] ?? 20);
const p = new Player('careful', { seed });
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
for (let m = 1; m <= years * 12; m++) {
  for (let h = 0; h < 4; h++) {
    p.play();
    p.sim.advance(TICKS_PER_HOUR * 6);
  }
  if (m % (12 * every)) continue;
  const s = p.sim.state;
  const r = monthlyRates(p.sim);
  const rate = s.economy.taxes.R[0]!;
  let taxes = 0;
  let other = 0;
  let costs = 0;
  for (const [k, v] of Object.entries(r)) {
    if (k.startsWith('tax')) taxes += v;
    else if (v > 0) other += v;
    else costs += v;
  }
  let len = 0;
  let vkm = 0;
  const byType: Record<string, number> = {};
  for (const sg of s.net.segments.values()) {
    const L = p.sim.net.curve(sg.id).length;
    len += L;
    byType[sg.type] = (byType[sg.type] ?? 0) + L / 1000;
    vkm += ((s.traffic.get(sg.id) ?? 0) * L) / 1000;
  }
  const wealth = [0, 0, 0];
  for (const b of s.buildings.values())
    if (b.zone === 1 && b.state === BState.Active) wealth[b.wealth]! += b.pop;
  const pop = s.totals.population;
  const at6 = (taxes * 6) / rate;
  console.log(
    `y${m / 12} pop ${fmt(pop)} tax ${rate}% taxes ${fmt(taxes)} (at 6%: ${fmt(at6)}) other ${fmt(other)} costs ${fmt(costs)} net ${fmt(taxes + other + costs)} net@6 ${fmt(at6 + other + costs)} | roads ${(len / 1000).toFixed(1)} km ${Object.entries(
      byType,
    )
      .map(([k, v]) => `${k} ${v.toFixed(1)}`)
      .join(
        ' ',
      )} | veh-km/day ${fmt(vkm)} | R wealth ${wealth.map(fmt).join('/')} | edu ${s.totals.eduWorkforce.map((x) => Math.round(x * 100)).join('/')}%`,
  );
  console.log(
    '   ' +
      Object.entries(r)
        .sort((a, b) => a[1] - b[1])
        .map(([k, v]) => `${k} ${fmt(v)}`)
        .join(', '),
  );
}
