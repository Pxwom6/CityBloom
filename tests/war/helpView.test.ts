import { describe, expect, it } from 'vitest';
import { LIVE } from '../../relay/protocol';
import type { HelpView } from '../../src/client/liveBattles';
import { helpAlliesOf, helpForceLine, helpLine, pickUnits, type PactsView } from '../../src/ui/helpView';

/**
 * M39 step 6 (review): the arithmetic and words of an ally's help, as `Help.tsx` and the war room use
 * them: which combatant the pacts let a city help, which units go, and what the force's line says.
 */

const NEIGHBOURS: PactsView['neighbours'] = [
  { id: 11, name: 'Adaville', player: { slot: 1 } },
  { id: 12, name: 'Samford', player: { slot: 2 } },
  { id: 13, name: 'Rival Town', player: null },
];
const pact = (withId: number, k: string, room: number | null = 1) => ({ room, with: withId, term: { k } });
const BATTLE = { from: 1, to: 2 };

describe('M39 step 6 review: who a city may help', () => {
  const allies = (pacts: PactsView['pacts']) => helpAlliesOf({ pacts, neighbours: NEIGHBOURS }, BATTLE);

  it('offers the friend it has an alliance with, on either side', () => {
    expect(allies([pact(12, 'alliance')])).toEqual([{ id: 12, slot: 2, name: 'Samford', side: 1 }]);
    expect(allies([pact(11, 'alliance')])).toEqual([{ id: 11, slot: 1, name: 'Adaville', side: 0 }]);
  });

  it('a defensive pact is for the friend attacked, not the one attacking', () => {
    expect(allies([pact(12, 'defensivePact')])).toEqual([{ id: 12, slot: 2, name: 'Samford', side: 1 }]);
    expect(allies([pact(11, 'defensivePact')])).toEqual([]);
  });

  it('offers nothing with no pact, a pact the room does not keep, or pacts on both sides', () => {
    expect(allies([])).toEqual([]);
    // (A pact only this page knows of, with no number from the room, is not one it may act on.)
    expect(allies([pact(12, 'alliance', null)])).toEqual([]);
    expect(allies([pact(12, 'nonAggression')])).toEqual([]);
    expect(allies([pact(11, 'alliance'), pact(12, 'alliance')])).toEqual([]);
    expect(allies([pact(11, 'alliance'), pact(12, 'defensivePact')])).toEqual([]);
    // A computer neighbour is not a friend in this battle.
    expect(allies([pact(13, 'alliance')])).toEqual([]);
  });

  it('an alliance outweighs a defensive pact with the same friend', () => {
    expect(allies([pact(12, 'defensivePact'), pact(12, 'alliance')])).toEqual([
      { id: 12, slot: 2, name: 'Samford', side: 1 },
    ]);
  });

  it('offers nothing against a friend it holds a binding pact with: ending the pact comes first', () => {
    // An ally of the defender with a defensive pact, or a non-aggression pact, with the attacker would
    // break it by helping (the room: "that breaks your … pact with …: end it first").
    expect(allies([pact(11, 'defensivePact'), pact(12, 'alliance')])).toEqual([]);
    expect(allies([pact(11, 'nonAggression'), pact(12, 'alliance')])).toEqual([]);
    expect(allies([pact(12, 'nonAggression'), pact(11, 'alliance')])).toEqual([]);
    // Pacts that don't bind (trade, an embargo) don't stand in the way.
    expect(allies([pact(11, 'trade'), pact(12, 'alliance')])).toEqual([
      { id: 12, slot: 2, name: 'Samford', side: 1 },
    ]);
  });
});

describe('M39 step 6 review: the units that go', () => {
  const home = [
    ...Array.from({ length: 15 }, (_, k) => ({ id: 100 + k, kind: 'tank' })),
    ...Array.from({ length: 15 }, (_, k) => ({ id: 200 + k, kind: 'helicopter' })),
    ...Array.from({ length: 4 }, (_, k) => ({ id: 300 + k, kind: 'infantry' })),
  ];

  it('takes what was asked for, kind by kind', () => {
    const { chosen, taken } = pickUnits(home, { tank: 3, infantry: 2 });
    expect(chosen.map((u) => u.id)).toEqual([100, 101, 102, 300, 301]);
    expect(taken).toEqual({ tank: 3, helicopter: 0, infantry: 2 });
  });

  it('never sends more than a force takes, and says so in what it hands back', () => {
    // Fifteen tanks and fifteen helicopters asked for: thirty, where 24 is the most one force carries.
    const { chosen, taken, cap } = pickUnits(home, { tank: 15, helicopter: 15 });
    expect(cap).toBe(LIVE.helpUnits);
    expect(chosen).toHaveLength(LIVE.helpUnits);
    // The label and the call both read this list: what is shown is what goes.
    expect(taken).toEqual({ tank: 15, helicopter: 9, infantry: 0 });
    expect(chosen.filter((u) => u.kind === 'helicopter')).toHaveLength(9);
    expect(new Set(chosen.map((u) => u.id)).size).toBe(chosen.length);
  });

  it('reads nonsense as nothing', () => {
    expect(
      pickUnits(home, { tank: -3, helicopter: Number.NaN, infantry: 1.9 }).chosen.map((u) => u.id),
    ).toEqual([300]);
    expect(pickUnits([], { tank: 5 }).chosen).toEqual([]);
  });
});

const view = (over: Partial<HelpView>): HelpView => ({
  battle: 'L1',
  state: 'done',
  units: 4,
  alive: null,
  lost: 0,
  hurt: 0,
  side: 1,
  arrive: 552,
  step: 700,
  ...over,
});

describe('M39 step 6 review: what the force’s line says', () => {
  it('does not call a force unharmed that came through hurt', () => {
    expect(helpLine(view({}), 'Samford')).toBe(
      'The battle is over: your force came through unharmed and is on its way home.',
    );
    const hurt = helpLine(view({ hurt: 3 }), 'Samford');
    expect(hurt).toBe(
      'The battle is over: none of your 4 units were knocked out, but 3 need repairs. They are on their way home.',
    );
    expect(hurt).not.toMatch(/unharmed/);
    expect(helpLine(view({ hurt: 1 }), 'Samford')).toMatch(/but 1 needs repairs/);
    expect(helpLine(view({ lost: 1, hurt: 2 }), 'Samford')).toBe(
      'The battle is over: 1 of your 4 units were knocked out and 2 need repairs, and the rest are on their way home.',
    );
    expect(helpLine(view({ lost: 2 }), 'Samford')).toBe(
      'The battle is over: 2 of your 4 units were knocked out, and the rest are on their way home.',
    );
  });

  it('says plainly when the battle could not be followed to its end', () => {
    expect(helpLine(view({ late: true }), 'Samford')).toMatch(/ended before your force could get there/);
    expect(helpLine(view({ reason: 'This page could not confirm how that battle ended.' }), 'Samford')).toBe(
      'This page could not confirm how that battle ended. Your force is on its way home.',
    );
  });

  it('follows the force on its way and in the fight', () => {
    expect(helpLine(view({ state: 'asked' }), 'Samford')).toMatch(/Asking the region/);
    expect(helpLine(view({ state: 'on', arrive: 552, step: 392 }), 'Samford')).toBe(
      'Your 4 units are on the way to help Samford: 10 seconds to go.',
    );
    expect(helpLine(view({ state: 'fighting', alive: 3 }), 'Samford')).toBe(
      'Your force is fighting for Samford: 3 of 4 standing.',
    );
  });
});

describe('M39 step 6 review: the war room’s list of forces', () => {
  const e = (state: 'out' | 'fighting' | 'back') => ({ state, name: 'Samford', help: 'L1' });

  it('says a force sent to help is helping, never that it fought or waits for the region to take a battle', () => {
    const lines = [
      helpForceLine(e('fighting'), view({ state: 'asked' }), 0),
      helpForceLine(e('fighting'), view({ state: 'on', arrive: 552, step: 392 }), 0),
      helpForceLine(e('fighting'), view({ state: 'fighting', alive: 3 }), 0),
      helpForceLine(e('fighting'), view({ state: 'done' }), 0),
      helpForceLine(e('fighting'), null, 0),
      helpForceLine(e('back'), null, 1.5),
    ];
    expect(lines).toEqual([
      'asking the region to let it help Samford',
      'on the way to help Samford: about 10 seconds to go',
      'fighting beside Samford: 3 of 4 standing',
      'coming home from helping Samford',
      'helping Samford in a battle',
      'coming home from helping Samford: 1.5 h',
    ]);
    for (const line of lines)
      expect(line).not.toMatch(/waiting for the region|fought in|on the way to Samford/);
  });

  it('knows another battle’s force from this one', () => {
    expect(helpForceLine(e('fighting'), view({ battle: 'other', state: 'fighting' }), 0)).toBe(
      'helping Samford in a battle',
    );
  });
});
