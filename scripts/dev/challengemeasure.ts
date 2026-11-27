// Dev (M44): what the balance mayor reaches on a fresh city in its first years, to set the weekly
// challenges' targets: population, approval, treasury, net income, pollution, unemployment, jobs,
// visitors and powered share at months 12, 24 and 36, per seed and map.
// Usage: npx tsx scripts/dev/challengemeasure.ts [seeds=4] [strategy=careful]
import { Sim } from '../../src/sim/sim';
import { goalValue } from '../../src/sim/systems/scenario';
import { TICKS_PER_HOUR } from '../../src/sim/time';
import type { GoalMeasure } from '../../src/data/scenarios';
import { Player, type StrategyId } from '../lib/mayor';
import type { MapPreset } from '../../src/data/world';

const seeds = Number(process.argv[2] ?? 4);
const strategy = (process.argv[3] ?? 'careful') as StrategyId;
const MEASURES: GoalMeasure[] = [
  'population',
  'approval',
  'treasury',
  'net',
  'pollution',
  'unemployment',
  'jobs',
  'visitors',
  'powered',
];
const presets: MapPreset[] = ['river', 'coast', 'lakes', 'highlands'];
for (let k = 0; k < seeds; k++)
  for (const preset of presets) {
    const sim = Sim.create({
      seed: `cm${k}`,
      preset,
      difficulty: 'normal',
      disasters: false,
      elections: false,
      region: false,
      cityName: 'Measure',
    });
    const p = new Player(strategy, sim);
    const out: string[] = [];
    for (let m = 1; m <= 36; m++) {
      for (let q = 0; q < 4; q++) {
        p.play();
        sim.advance(TICKS_PER_HOUR * 6);
      }
      if (m % 12 === 0)
        out.push(
          `m${m}: ` +
            MEASURES.map((g) => `${g} ${Math.round(goalValue(sim, { measure: g, label: '' }))}`).join(' '),
        );
    }
    console.log(`cm${k} ${preset}\n  ${out.join('\n  ')}`);
  }
