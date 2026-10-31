import { describe, expect, it } from 'vitest';
import { cleanTerm, DIPLOMACY, TERM_KINDS, TERM_NAMES, termProblem } from '../../src/data/diplomacy';
import { Sim } from '../../src/sim/sim';
import { capacity } from '../../src/sim/systems/region';
import {
  diplomacySummary,
  helpers,
  heldBy,
  pactsWith,
  raidStance,
  warWith,
} from '../../src/sim/systems/diplomacy';
import { tradeStopped } from '../../src/sim/systems/warEconomy';
import { TICKS_PER_HOUR, TICKS_PER_MONTH } from '../../src/sim/time';
import { dip, ok, rivals, warCity, why } from './economyHelpers';

/**
 * M39, scenarios: a subject town and the Liberation term. A town held by another computer neighbour
 * (`RivalNeighbour.subjectOf`, set only by a scenario's starting city) trades with nobody, signs
 * nothing and helps no one; its overlord lets it go in a treaty it is made to sign (when it
 * capitulates, or is losing badly), or when it falls.
 */

const H = TICKS_PER_HOUR;
const M = TICKS_PER_MONTH;

/** A war city whose first computer neighbour holds its second as a subject, and the city at war with the first. */
function subjectCity(atWar = true) {
  const sim = warCity();
  const [overlord, town, other] = rivals(sim);
  overlord!.rival!.personality = 'aggressive';
  overlord!.rival!.relation = -40;
  town!.rival!.subjectOf = overlord!.id;
  town!.rival!.relation = 40;
  if (atWar) {
    ok(sim, { type: 'declareWar', neighbour: overlord!.id, scale: 'war', reason: 'Free Lark Spa' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
  }
  return { sim, overlord: overlord!, town: town!, other: other! };
}

const liberate = (town: number) => ({ k: 'liberate' as const, town });

describe('M39: the Liberation term', () => {
  it('is a term like the others: in the list, named, and cleaned', () => {
    expect(TERM_KINDS).toContain('liberate');
    for (const k of TERM_KINDS) expect(TERM_NAMES[k], k).toBeTruthy();
    expect(cleanTerm({ k: 'liberate', town: 3 })).toEqual({ k: 'liberate', town: 3 });
    expect(cleanTerm({ k: 'liberate', town: 3, junk: 1 })).toEqual({ k: 'liberate', town: 3 });
    for (const bad of [
      { k: 'liberate' },
      { k: 'liberate', town: 0 },
      { k: 'liberate', town: 1.5 },
      { k: 'liberate', town: 'x' },
    ])
      expect(cleanTerm(bad), JSON.stringify(bad)).toBeNull();
    expect(termProblem({ k: 'liberate' })).toMatch(/pick the town/);
  });

  it('is refused unless the other side holds that town and the city is at war with it', () => {
    // No subject anywhere: nothing to ask for.
    const plain = warCity();
    const [a, b] = rivals(plain);
    ok(plain, { type: 'declareWar', neighbour: a!.id, scale: 'war', reason: '' });
    expect(
      why(plain, { type: 'propose', neighbour: a!.id, terms: [{ k: 'peace' }, liberate(b!.id)] }),
    ).toMatch(/holds no such town/);
    expect(heldBy(plain, b!.id)).toBeNull();
    expect(diplomacySummary(plain)!.neighbours.every((n) => n.subjectOf === null)).toBe(true);
    // A subject, but of another overlord; or no war; or a town that isn't there.
    const { sim, overlord, town, other } = subjectCity(false);
    expect(why(sim, { type: 'propose', neighbour: overlord.id, terms: [liberate(town.id)] })).toMatch(
      /freed in a war with/,
    );
    ok(sim, { type: 'declareWar', neighbour: overlord.id, scale: 'war', reason: '' });
    expect(why(sim, { type: 'propose', neighbour: overlord.id, terms: [liberate(other.id)] })).toMatch(
      /holds no such town/,
    );
    expect(why(sim, { type: 'propose', neighbour: overlord.id, terms: [liberate(99)] })).toMatch(
      /holds no such town/,
    );
    expect(
      why(sim, { type: 'propose', neighbour: overlord.id, terms: [liberate(town.id), liberate(town.id)] }),
    ).toMatch(/listed twice/);
    expect(
      why(sim, { type: 'propose', neighbour: overlord.id, terms: [{ k: 'peace' }, liberate(town.id)] }),
    ).toBeNull();
  });

  it('a subject town trades with nobody, signs nothing, is not declared on, helps no one and raids no one', () => {
    const { sim, overlord, town } = subjectCity();
    const free = warCity();
    const t = rivals(free)[1]!;
    // Free, the same town trades: a deal for power is possible, and it has power to sell.
    expect(capacity(free, t, 'power', 'buy')).toBeGreaterThan(0);
    // Held, it has nothing to trade, and says why.
    expect(capacity(sim, town, 'power', 'buy')).toBe(0);
    expect(heldBy(sim, town.id)?.id).toBe(overlord.id);
    expect(
      why(sim, { type: 'setDeal', neighbour: town.id, resource: 'power', direction: 'buy', amount: 5 }),
    ).toMatch(/held by .* can’t trade/);
    expect(tradeStopped(sim, town.id)).toMatch(/held by/);
    expect(why(sim, { type: 'buyStake', neighbour: town.id, share: 5 })).toMatch(/held by/);
    // No treaty with it, of any kind, and no war on it.
    for (const terms of [
      [{ k: 'nonAggression' as const, months: 12 }],
      [{ k: 'alliance' as const }],
      [{ k: 'trade' as const }],
    ])
      expect(why(sim, { type: 'propose', neighbour: town.id, terms }), terms[0]!.k).toMatch(
        /signs nothing until it is free/,
      );
    expect(why(sim, { type: 'declareWar', neighbour: town.id, scale: 'war', reason: '' })).toMatch(
      /is held by/,
    );
    // It raids no one, whatever its feelings; and an ally's help doesn't come from it.
    expect(raidStance(sim, town)).toBeNull();
    dip(sim).pacts.push({
      id: sim.state.nextId++,
      with: town.id,
      term: { k: 'alliance' },
      since: sim.state.tick,
    });
    expect(warWith(sim, overlord.id)).toBeDefined();
    expect(helpers(sim)).toHaveLength(0);
    // Freed, the same pact would send it to the city's side.
    delete town.rival!.subjectOf;
    expect(helpers(sim).map((h) => h.ally.id)).toEqual([town.id]);
  });

  it('an overlord that is losing badly signs it, one that is not does not', () => {
    for (const [score, signs] of [
      [0, false],
      [30, false],
      [52, true],
    ] as const) {
      const { sim, overlord, town } = subjectCity();
      warWith(sim, overlord.id)!.score = score;
      ok(sim, { type: 'propose', neighbour: overlord.id, terms: [{ k: 'peace' }, liberate(town.id)] });
      sim.advance(3 * H);
      expect(town.rival!.subjectOf === undefined, `score ${score}`).toBe(signs);
      expect(warWith(sim, overlord.id) === undefined, `score ${score}`).toBe(signs);
    }
  });

  it('a capitulated overlord frees its subject on the city’s terms, and the town thanks the city and offers an alliance', () => {
    const { sim, overlord, town } = subjectCity();
    const was = town.rival!.relation;
    warWith(sim, overlord.id)!.score = 61;
    sim.advance(2 * H);
    expect(warWith(sim, overlord.id)!.capitulated?.by).toBe('them');
    ok(sim, { type: 'propose', neighbour: overlord.id, terms: [liberate(town.id)] });
    expect(town.rival!.subjectOf).toBeUndefined();
    expect(warWith(sim, overlord.id)).toBeUndefined();
    expect(town.rival!.relation).toBe(Math.min(100, was + DIPLOMACY.liberateRelation));
    // It offers an alliance at once; the city takes it, and the pact stands.
    const offer = dip(sim).proposals.find((p) => p.with === town.id && p.from === 'them');
    expect(offer?.terms).toEqual([{ k: 'alliance' }]);
    ok(sim, { type: 'answerProposal', proposal: offer!.id, accept: true });
    expect(pactsWith(sim, town.id, 'alliance')).toHaveLength(1);
    // Now it can be dealt with like any neighbour: it has power to sell.
    expect(
      why(sim, { type: 'setDeal', neighbour: town.id, resource: 'power', direction: 'buy', amount: 5 }),
    ).toBeNull();
    expect(dip(sim).log.some((e) => /is free of/.test(e.text))).toBe(true);
  });

  it('the usual terms free it too when the city sets none within the week', () => {
    const { sim, overlord, town } = subjectCity();
    warWith(sim, overlord.id)!.score = 61;
    sim.advance(2 * H);
    expect(town.rival!.subjectOf).toBe(overlord.id);
    sim.advance(DIPLOMACY.termsDays * M + 2 * H);
    expect(town.rival!.subjectOf).toBeUndefined();
    expect(warWith(sim, overlord.id)).toBeUndefined();
  });

  it('a beaten overlord puts the offer to the city itself, and the city may take it', () => {
    const { sim, overlord, town } = subjectCity();
    warWith(sim, overlord.id)!.score = 40;
    let offer = dip(sim).proposals.find((p) => p.with === overlord.id && p.from === 'them');
    for (let t = 0; t < 40 && !offer; t++) {
      sim.advance(M);
      offer = dip(sim).proposals.find((p) => p.with === overlord.id && p.from === 'them');
    }
    expect(offer, 'the overlord offers peace').toBeDefined();
    expect(offer!.terms.map((x) => x.k)).toContain('liberate');
    expect(offer!.terms).toContainEqual(liberate(town.id));
    ok(sim, { type: 'answerProposal', proposal: offer!.id, accept: true });
    expect(town.rival!.subjectOf).toBeUndefined();
    expect(warWith(sim, overlord.id)).toBeUndefined();
  });

  it('an overlord that falls to the city lets its subjects go', () => {
    const { sim, overlord, town } = subjectCity();
    const war = warWith(sim, overlord.id)!;
    war.scale = 'total';
    war.hold = { by: 'us', since: sim.state.tick - DIPLOMACY.conquestHours * H };
    sim.advance(2 * H);
    expect(overlord.rival!.vassal).toBeDefined();
    expect(town.rival!.subjectOf).toBeUndefined();
    expect(dip(sim).proposals.some((p) => p.with === town.id && p.from === 'them')).toBe(true);
  });

  it('a city that has no subject town sees none of it: the usual terms and offers are as they were', () => {
    const sim = warCity();
    const [a] = rivals(sim);
    ok(sim, { type: 'declareWar', neighbour: a!.id, scale: 'war', reason: '' });
    sim.advance(DIPLOMACY.warningHours * H + 60);
    warWith(sim, a!.id)!.score = 61;
    sim.advance(DIPLOMACY.termsDays * M + 4 * H);
    expect(warWith(sim, a!.id)).toBeUndefined();
    expect(dip(sim).log.some((e) => /free/i.test(e.text))).toBe(false);
    expect(dip(sim).proposals.some((p) => p.terms.some((t) => t.k === 'liberate'))).toBe(false);
    expect(rivals(sim).every((n) => n.rival!.subjectOf === undefined)).toBe(true);
  });

  it('a held town and a pending offer survive a save', () => {
    const { sim, overlord, town } = subjectCity();
    warWith(sim, overlord.id)!.score = 61;
    sim.advance(2 * H);
    ok(sim, { type: 'propose', neighbour: overlord.id, terms: [liberate(town.id)] });
    const copy = Sim.fromSave(sim.save('2026-10-29'));
    copy.testMode = true;
    expect(copy.hash()).toBe(sim.hash());
    // And the held kind too: save before the war is won.
    const held = subjectCity();
    const again = Sim.fromSave(held.sim.save('2026-10-29'));
    expect(rivals(again)[1]!.rival!.subjectOf).toBe(rivals(again)[0]!.id);
    expect(again.hash()).toBe(held.sim.hash());
  });
});
