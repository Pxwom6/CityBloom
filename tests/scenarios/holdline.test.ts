import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../../src/data/scenarios';
import { Player } from '../../src/sim/ai/mayor';
import { Sim } from '../../src/sim/sim';
import { checksum } from '../../src/sim/sync';
import { goalValue } from '../../src/sim/systems/scenario';
import { militaryCivics } from '../../src/sim/systems/war';
import { isMonthStart, TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { openScenario, playOut } from './harness';
import { fillBarracks, homeReports, rivalsOf } from './warHelpers';

const def = SCENARIO.get('holdline')!;

/** What the scenario's goals read now. */
function goals(sim: Sim): string {
  return def.goals.map((g) => `${g.measure} ${goalValue(sim, g)}`).join(', ');
}

/**
 * A player who stops them at the way in: `bunkers` bunkers along the avenue just inside the highway
 * (the raiders come in along it), and a full garrison.
 */
function digIn(sim: Sim, bunkers: number): () => void {
  const p = new Player('careful', sim);
  p.holdTaxes = true;
  let k = 0;
  return () => {
    while (p.count('bunker') < bunkers && k < 40) {
      if (p.placeNear('bunker', { x: p.c.x + 100 + k * 25, z: p.c.z }, 400)) continue;
      k++;
    }
    fillBarracks(sim);
    p.utilities(false);
  };
}

describe('scenario: Hold the Line (M39)', () => {
  it('opens as a town at war with a garrison, and the neighbours leave it alone until the script says', () => {
    const sim = openScenario('holdline');
    const w = sim.state.war!;
    expect(w).toBeDefined();
    expect(rivalsOf(sim)).toHaveLength(3);
    expect(rivalsOf(sim)[0]!.rival!.personality).toBe('aggressive');
    expect(
      militaryCivics(sim)
        .map((c) => c.def)
        .sort(),
    ).toEqual(['barracks', 'bunker', 'bunker', 'bunker', 'militaryhq', 'shelter']);
    expect(w.units.size).toBe(4);
    const base = sim.state.scenario!.base!;
    expect(base.I.length).toBeGreaterThanOrEqual(30);
    console.log(
      `[holdline] opens: ${goals(sim)}, treasury ${Math.round(sim.state.treasury)}, buildings R ${base.R.length} C ${base.C.length} I ${base.I.length}`,
    );
    // The first wave is due at the start of month 2: a day and a bit of quiet before it, though
    // the neighbours are armed to the teeth and the city is old enough to be raided.
    sim.advance(TICKS_PER_MONTH);
    expect(w.incoming).toBeUndefined();
    expect(w.battle).toBeUndefined();
    expect(sim.state.scenario!.waves).toBeUndefined();
    for (let t = 0; t < 2 * TICKS_PER_MONTH && !sim.state.scenario!.waves; t++) sim.step();
    expect(isMonthStart(sim.state.tick)).toBe(true);
    expect(sim.state.scenario!.waves).toHaveLength(1);
    expect(w.incoming).toHaveLength(1);
    expect(w.incoming![0]!.units.map((u) => u.kind)).toEqual([
      'infantry',
      'infantry',
      'infantry',
      'infantry',
    ]);
    expect(w.incoming![0]!.target).toBe('industry');
  });

  it('a player who builds nothing loses factories to the waves, and the scenario with them', () => {
    const sim = openScenario('holdline');
    const sc = playOut(sim);
    console.log(`[holdline] passive: ${sc.status} (${sc.reason}); ${goals(sim)}\n  ${homeReports(sim)}`);
    expect(sc.waves).toHaveLength(3);
    expect(goalValue(sim, def.goals[0]!)).toBe(3);
    expect(goalValue(sim, def.goals[1]!)).toBeLessThan(90);
    expect(sc).toMatchObject({ status: 'lost', reason: 'time' });
  });

  it('a player who stops them at the way in holds the line', () => {
    const sim = openScenario('holdline');
    const sc = playOut(sim, digIn(sim, 10));
    console.log(
      `[holdline] dug in: ${sc.status}, ${sc.stars} stars, in ${(sc.end - sc.start) / TICKS_PER_MONTH} months; ${goals(sim)}, treasury ${Math.round(sim.state.treasury)}\n  ${homeReports(sim)}`,
    );
    expect(sc.status).toBe('won');
    expect(goalValue(sim, def.goals[1]!)).toBeGreaterThanOrEqual(90);
    expect(sc.stars).toBeGreaterThanOrEqual(2);
  });

  it('bunkers beside the factories are too late: fires finish what the raiders start', () => {
    const sim = openScenario('holdline');
    const p = new Player('careful', sim);
    p.holdTaxes = true;
    const sc = playOut(sim, () => {
      const f = sim.state.scenario!.base!.I;
      const b = sim.state.buildings.get(f[Math.floor(f.length / 2)]!)!;
      while (p.count('bunker') < 10) if (!p.placeNear('bunker', b, 400)) break;
      fillBarracks(sim);
      p.utilities(false);
    });
    console.log(`[holdline] at the factories: ${sc.status}; ${goals(sim)}\n  ${homeReports(sim)}`);
    expect(sc.status).toBe('lost');
  });

  it('a wave whose way is blocked waits for the next month', () => {
    const sim = openScenario('holdline');
    sim.testMode = true;
    // A raid of the neighbours' own is on its way as month 2 begins (long enough to still be coming).
    expect(
      sim.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 47, neighbour: rivalsOf(sim)[1]!.id }).ok,
    ).toBe(true);
    const w = sim.state.war!;
    const start = sim.state.scenario!.start;
    while (sim.state.tick < start + 2 * TICKS_PER_MONTH - 7 * TICKS_PER_HOUR + 10) sim.step();
    // (Month 2 has begun: wave one is due, and can't set off.)
    expect(sim.state.scenario!.waves).toBeUndefined();
    expect(w.incoming).toHaveLength(1);
    // The blocking raid arrives and is fought; the next month's start sends the wave.
    for (let t = 0; t < 3 * TICKS_PER_MONTH && !sim.state.scenario!.waves; t++) sim.step();
    expect(sim.state.scenario!.waves).toHaveLength(1);
    expect(w.reports!.filter((r) => !r.ours)).toHaveLength(1);
    expect(isMonthStart(sim.state.tick)).toBe(true);
  });

  it('a city saved in the middle of a wave plays on exactly as if it never stopped', () => {
    const sim = openScenario('holdline');
    const act = digIn(sim, 6);
    // Into the first wave: sent, arrived, being fought.
    for (let t = 0; t < 3 * TICKS_PER_MONTH && !sim.state.war!.battle; t++) {
      if (t % (6 * TICKS_PER_HOUR) === 0) act();
      sim.step();
    }
    expect(sim.state.war!.battle).toBeDefined();
    sim.advance(30);
    const copy = Sim.fromSave(sim.save());
    copy.testMode = true;
    expect(copy.state.scenario!.waves).toEqual(sim.state.scenario!.waves);
    for (let t = 0; t < 5 * TICKS_PER_MONTH; t++) {
      sim.step();
      copy.step();
      if (t % 720 === 0) expect(checksum(copy), `tick ${t}`).toBe(checksum(sim));
    }
    expect(checksum(copy)).toBe(checksum(sim));
    expect(copy.state.scenario).toEqual(sim.state.scenario);
    expect(copy.state.scenario!.waves!.length).toBeGreaterThanOrEqual(2);
  });
});
