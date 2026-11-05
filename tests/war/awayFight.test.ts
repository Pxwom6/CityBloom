import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { awayInput } from '../../src/sim/battle/away';
import { awayResult } from '../../src/sim/battle/away';
import { fightAwayCity } from '../../src/sim/battle/awayFight';
import { Battle } from '../../src/sim/battle/battle';
import { Sim } from '../../src/sim/sim';
import { liveWorld, sendAgainst } from './liveTown';

/**
 * M39 step 10's review: a force's battle in a friend's city the old way is one function
 * (`fightAwayCity`), which the battle worker and the war soak both call, so the soak cannot go on
 * testing a copy of the worker's branch after the worker's changes.
 */
describe('fightAwayCity', () => {
  it('fights the force in the friend’s saved city as the old way does, without the friend’s own battle', () => {
    const { ada, sam } = liveWorld();
    const sent = sendAgainst(ada.sim);
    const save = sam.sim.save();
    const fought = fightAwayCity({ city: sent.city, save });
    // The same as its parts, done by hand.
    const town = Sim.fromSave(save);
    const input = awayInput(sent.city, town);
    expect(fought.input).toEqual(input);
    expect(fought.result).toEqual(awayResult(input, Battle.run(structuredClone(input))));
    // The town it hands back loads, and is the one the battle was fought in.
    expect(Sim.fromSave(fought.town).state.options.cityName).toBe('Samford');
    // A battle of the friend's own that the save was taken in the middle of is not kept.
    const mid = Sim.fromSave(save);
    mid.testMode = true;
    mid.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 });
    for (let t = 0; t < 5 && !mid.state.war!.battle; t++) mid.step();
    const midSave = mid.save();
    expect(Sim.fromSave(midSave).state.war!.battle).toBeDefined();
    const kept = fightAwayCity({ city: sent.city, save: midSave }).town;
    expect(Sim.fromSave(kept).state.war!.battle).toBeUndefined();
  }, 120_000);

  it('is what both the battle worker and the soak call', () => {
    for (const file of ['src/client/battleWorker.ts', 'scripts/lib/soak/world.ts'])
      expect(readFileSync(file, 'utf8'), file).toMatch(/fightAwayCity\(job\)/);
  });
});
