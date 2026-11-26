// Dev (M43): a serviced test town with and without a quick match's fast start, day by day: population,
// buildings, power and water, demand and money. Usage: npx tsx scripts/dev/matchgrowth.ts [days] [growth unlock funds]
import { Sim } from '../../src/sim/sim';
import { buildTown, serveTown } from '../../tests/helpers';
import { MATCH, type MatchStart } from '../../src/data/match';

const days = Number(process.argv[2] ?? 6);
const fast: MatchStart = {
  growth: Number(process.argv[3] ?? MATCH.fastStart.growth),
  unlock: Number(process.argv[4] ?? MATCH.fastStart.unlock),
  funds: Number(process.argv[5] ?? MATCH.fastStart.funds),
};

function town(match: MatchStart | null): Sim {
  const sim = Sim.create({
    seed: 'matchtown',
    preset: 'river',
    disasters: false,
    elections: false,
    region: false,
    ...(match ? { match } : {}),
  });
  buildTown(sim, { zone: true });
  serveTown(sim);
  return sim;
}

const a = town(null);
const b = town(fast);
const line = (s: Sim) => {
  const u = s.state.utilityStats;
  let building = 0;
  for (const x of s.state.buildings.values()) if (x.state === 0) building++;
  return `pop ${s.state.totals.population} bld ${s.state.buildings.size} (${building} going up) power ${Math.round(u.power.supply)}/${Math.round(u.power.demand)} water ${Math.round(u.water.supply)}/${Math.round(u.water.demand)} R ${s.state.demand.R.toFixed(2)} $${Math.round(s.state.treasury)}`;
};
for (let d = 1; d <= days; d++) {
  for (let t = 0; t < 1440; t++) {
    a.step();
    b.step();
  }
  console.log(`day ${d}\n  plain ${line(a)}\n  fast  ${line(b)}`);
}
