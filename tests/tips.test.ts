import { describe, expect, it } from 'vitest';
import { TIPS, pickTip } from '../src/client/tutorial';
import { LONG_COMMUTE } from '../src/data/balance';
import { advise } from '../src/sim/systems/advisors';
import type { Game } from '../src/game';
import type { CityStats } from '../src/sim/protocol';
import { buildTown, newSim, serveTown } from './helpers';
import { TICKS_PER_MONTH } from '../src/sim/time';

/** A stand-in for the game, as far as tips look at it: a new city's stats, with some changed. */
const base = newSim().stats();
const gameWith = (stats: Partial<CityStats>) =>
  ({
    world: {
      stats: { ...base, population: 1_000, ...stats },
      civics: new Map(),
      netState: { segments: new Map(), blocks: new Map() },
      worstJunctionVC: () => 0,
    },
    tools: { activeId: 'select' },
  }) as unknown as Game;

const tip = (id: string) => TIPS.find((t) => t.id === id)!;

describe('tips agree with the numbers (P15)', () => {
  it('drop the money tip if the city earns again before a panel closes', () => {
    const spending = gameWith({ netMonthly: -1_200, population: 900 });
    const earning = gameWith({ netMonthly: 26_018, population: 900 });
    // Chosen only when it can be seen.
    expect(pickTip(spending, null, true, new Set())).toBeNull();
    const t = pickTip(spending, null, false, new Set());
    expect(t?.id).toBe('money');
    // Waiting behind the budget panel while the player raises taxes: gone once the books balance.
    expect(pickTip(earning, t, true, new Set(['money']))).toBeNull();
    expect(pickTip(spending, t, true, new Set(['money']))).toBe(t);
    // On screen, it stays until dismissed.
    expect(pickTip(earning, t, false, new Set(['money']))).toBe(t);
  });

  it('call commutes long where the transport advisor does', () => {
    const traffic = tip('traffic');
    // avgCommute is in seconds: a 1-minute average isn't long, a 25-minute one is.
    expect(traffic.when(gameWith({ avgCommute: 60 }))).toBe(false);
    expect(traffic.when(gameWith({ avgCommute: 25 * 60 }))).toBe(true);
    expect(traffic.when(gameWith({ avgCommute: LONG_COMMUTE }))).toBe(false);
    expect(traffic.when(gameWith({ avgCommute: LONG_COMMUTE + 1 }))).toBe(true);
    // And in a real town, the tip and the advisor's "Commutes average N minutes" agree.
    const sim = newSim();
    buildTown(sim);
    serveTown(sim);
    sim.advance(TICKS_PER_MONTH);
    const stats = sim.stats();
    const advisorSaysLong = advise(sim).some((a) => /^Commutes average/.test(a.title));
    expect(traffic.when(gameWith({ avgCommute: stats.avgCommute, population: 1_000 }))).toBe(advisorSaysLong);
  });
});
