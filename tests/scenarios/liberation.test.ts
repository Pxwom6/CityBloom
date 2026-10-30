import { describe, expect, it } from 'vitest';
import { DIPLOMACY } from '../../src/data/diplomacy';
import { SCENARIO } from '../../src/data/scenarios';
import type { Sim } from '../../src/sim/sim';
import { heldBy, pactsWith, warWith } from '../../src/sim/systems/diplomacy';
import { cityStrength } from '../../src/sim/systems/raids';
import { goalValue } from '../../src/sim/systems/scenario';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { openScenario, playOut } from './harness';
import { armUp, homeReports, rivalsOf } from './warHelpers';

const def = SCENARIO.get('liberation')!;
const overlord = (sim: Sim) => rivalsOf(sim)[0]!;
const friend = (sim: Sim) => rivalsOf(sim)[1]!;
const subject = (sim: Sim) => rivalsOf(sim)[2]!;

function goals(sim: Sim): string {
  return def.goals.map((g) => `${g.measure} ${goalValue(sim, g)}`).join(', ');
}

describe('scenario: Liberation (M39)', () => {
  it('opens with a friend held by an aggressive neighbour that outguns the city', () => {
    const sim = openScenario('liberation');
    const [dun, nor, lark] = [overlord(sim), friend(sim), subject(sim)];
    expect(dun.name).toBe('Dunford');
    expect(lark.name).toBe('Lark Spa');
    expect(lark.rival!.subjectOf).toBe(dun.id);
    expect(heldBy(sim, lark.id)?.id).toBe(dun.id);
    expect(dun.rival!.personality).toBe('aggressive');
    expect(dun.rival!.forces).toBeGreaterThan(1.4 * cityStrength(sim));
    expect(nor.rival!.relation).toBeGreaterThanOrEqual(40);
    expect(goalValue(sim, def.goals[0]!)).toBe(0);
    // The held town can be neither traded with, allied with nor fought.
    const refuse = (cmd: Parameters<Sim['dispatch']>[0]) => {
      const r = sim.dispatch(cmd);
      return r.ok ? '' : r.reason;
    };
    expect(
      refuse({ type: 'setDeal', neighbour: lark.id, resource: 'power', direction: 'buy', amount: 5 }),
    ).toMatch(/held by Dunford/);
    expect(refuse({ type: 'propose', neighbour: lark.id, terms: [{ k: 'alliance' }] })).toMatch(
      /held by Dunford/,
    );
    expect(refuse({ type: 'declareWar', neighbour: lark.id, scale: 'war', reason: '' })).toMatch(
      /held by Dunford/,
    );
    console.log(
      `[liberation] opens: ${goals(sim)}; strength ${cityStrength(sim).toFixed(0)} against ${dun.rival!.forces}`,
    );
  });

  it('a city that does nothing is beaten, and Lark Spa stays held', () => {
    const sim = openScenario('liberation');
    const sc = playOut(sim);
    console.log(`[liberation] passive: ${sc.status} (${sc.reason}); ${goals(sim)}\n  ${homeReports(sim)}`);
    expect(sc).toMatchObject({ status: 'lost', reason: 'time' });
    expect(subject(sim).rival!.subjectOf).toBe(overlord(sim).id);
  });

  it('an armed city with Norcombe at its side beats Dunford and sets Lark Spa free', () => {
    const sim = openScenario('liberation');
    const [dun, nor, lark] = [overlord(sim), friend(sim), subject(sim)];
    const arm = armUp(sim, { bunkers: 12, tanks: 4 });
    let asked = false;
    let declared = false;
    const sc = playOut(sim, () => {
      arm();
      const w = sim.state.war!;
      const day = (sim.state.tick - sim.state.scenario!.start) / TICKS_PER_MONTH;
      // An alliance with Norcombe first.
      if (!asked && day >= 0.5) {
        asked = true;
        expect(sim.dispatch({ type: 'propose', neighbour: nor.id, terms: [{ k: 'alliance' }] }).ok).toBe(
          true,
        );
      }
      // Then the war on Dunford (if it hasn't begun one itself).
      if (!declared && day >= 3 && !warWith(sim, dun.id)) {
        declared = sim.dispatch({
          type: 'declareWar',
          neighbour: dun.id,
          scale: 'war',
          reason: 'Free Lark Spa',
        }).ok;
        expect(declared).toBe(true);
      }
      // Dunford's offers: taken when they set Lark Spa free.
      for (const p of [...(w.diplomacy?.proposals ?? [])])
        if (p.from === 'them' && p.with === dun.id)
          sim.dispatch({
            type: 'answerProposal',
            proposal: p.id,
            accept: p.terms.some((t) => t.k === 'liberate'),
          });
      // A beaten Dunford gives up: the city sets the terms, and Lark Spa is among them.
      if (warWith(sim, dun.id)?.capitulated?.by === 'them')
        sim.dispatch({
          type: 'propose',
          neighbour: dun.id,
          terms: [{ k: 'peace' }, { k: 'liberate', town: lark.id }],
        });
    });
    console.log(
      `[liberation] armed: ${sc.status}, ${sc.stars} stars, in ${((sc.end - sc.start) / TICKS_PER_MONTH).toFixed(1)} months; ${goals(sim)}; ${warWith(sim, dun.id) ? 'war on' : 'no war'}\n  ${homeReports(sim)}`,
    );
    expect(sc.status).toBe('won');
    expect(sc.facts?.liberated).toBe(1);
    expect(lark.rival!.subjectOf).toBeUndefined();
    expect(pactsWith(sim, nor.id, 'alliance')).toHaveLength(1);
    // Lark Spa thanks the city and offers an alliance; the city takes it.
    expect(lark.rival!.relation).toBeGreaterThanOrEqual(75);
    const offer = sim.state.war!.diplomacy!.proposals.find((p) => p.with === lark.id && p.from === 'them');
    expect(offer?.terms).toEqual([{ k: 'alliance' }]);
    expect(sim.dispatch({ type: 'answerProposal', proposal: offer!.id, accept: true }).ok).toBe(true);
    expect(pactsWith(sim, lark.id, 'alliance')).toHaveLength(1);
    expect(DIPLOMACY.liberateRelation).toBeGreaterThan(0);
    sim.advance(TICKS_PER_HOUR);
  });
});
