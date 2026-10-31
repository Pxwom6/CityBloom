/**
 * M35 probe: how long the careful balance mayor takes to grow a computer neighbour's town, by map
 * and mode (sandbox: no money worries). Prints the wall time and game months at each size.
 *
 *   npx tsx scripts/dev/towngrow.ts [presets] [sandbox|normal|both] [months]
 */
import { gzipSync, strToU8 } from 'fflate';
import { Sim } from '../../src/sim/sim';
import { Player } from '../lib/mayor';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import type { MapPreset } from '../../src/data/world';

const presets = (process.argv[2] ?? 'river,coast,highlands,lakes').split(',') as MapPreset[];
const modes = process.argv[3] === 'normal' ? [false] : process.argv[3] === 'sandbox' ? [true] : [true, false];
const months = Number(process.argv[4] ?? 36);
const sizes = [1_500, 3_000, 5_000, 8_000, 12_000, 20_000];

for (const preset of presets)
  for (const sandbox of modes) {
    const t0 = performance.now();
    const sim = Sim.create({
      seed: process.env.SEED ? `${process.env.SEED}-${preset}` : `town-${preset}`,
      preset,
      cityName: 'Rival',
      difficulty: 'easy',
      sandbox,
      disasters: false,
      region: false,
    });
    sim.testMode = true;
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const p = new Player('careful', sim);
    const hit: string[] = [];
    let next = 0;
    while (sim.state.tick < months * TICKS_PER_MONTH && next < sizes.length) {
      p.play();
      sim.advance(TICKS_PER_HOUR * 6);
      const pop = sim.state.totals.population;
      while (next < sizes.length && pop >= sizes[next]!) {
        hit.push(
          `${sizes[next]}: ${((performance.now() - t0) / 1000).toFixed(1)} s, ${(sim.state.tick / TICKS_PER_MONTH).toFixed(1)} mo`,
        );
        next++;
      }
    }
    const bytes = gzipSync(strToU8(JSON.stringify(sim.save())), { level: 6 }).length;
    console.log(
      `${preset.padEnd(9)} ${sandbox ? 'sandbox' : 'normal '}  pop ${sim.state.totals.population}  ${((performance.now() - t0) / 1000).toFixed(1)} s  save ${(bytes / 1024).toFixed(0)} KB gzipped\n    ${hit.join('\n    ')}`,
    );
  }
