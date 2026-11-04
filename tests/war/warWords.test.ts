import { describe, expect, it } from 'vitest';
import {
  asSentence,
  damageLine,
  helpOverLine,
  helpOverNotice,
  nameInSentence,
  objectiveName,
  scaleHint,
  scaleName,
  shelterSentence,
  termPayer,
  unitsKnockedOut,
  warScoreLine,
} from '../../src/ui/warWords';
import { shelterLine } from '../../src/ui/atomView';
import { seasonNotice } from '../../src/ui/weather';

/** Phase 5 end: the words the war's warnings, notices and cards share. */
describe('the shelter line of a warning', () => {
  it('says how many residents near a raid head for the shelters, or that none can reach one', () => {
    expect(shelterSentence(1208, 300, 'nearby', 'head for the shelters')).toBe(
      '300 of the 1,208 residents nearby head for the shelters.',
    );
    expect(shelterSentence(1208, 0, 'nearby', 'head for the shelters')).toBe(
      'None of the 1,208 residents nearby can reach a shelter.',
    );
    expect(shelterSentence(0, 0, 'nearby', 'head for the shelters')).toBeNull();
  });

  it('is the countdown card’s line for a bomb', () => {
    expect(shelterLine(1200, 450)).toBe('450 of the 1,200 residents in its path can reach a shelter.');
    expect(shelterLine(1808, 0)).toBe('None of the 1,808 residents in its path can reach a shelter.');
    expect(shelterLine(0, 0)).toBeNull();
  });
});

describe('units knocked out', () => {
  it('one unit was, more were', () => {
    expect(unitsKnockedOut(1, 'our')).toBe('1 of our units was knocked out');
    expect(unitsKnockedOut(3, 'our')).toBe('3 of our units were knocked out');
    expect(unitsKnockedOut(1, 'your', 4)).toBe('1 of your 4 units was knocked out');
    expect(unitsKnockedOut(2, 'its', 4)).toBe('2 of its 4 units were knocked out');
  });

  it('a whole force lost is said as such, never "1 of your 1 units"', () => {
    expect(unitsKnockedOut(4, 'its', 4)).toBe('all 4 of its units were knocked out');
    expect(unitsKnockedOut(1, 'your', 1)).toBe('your only unit was knocked out');
    expect(unitsKnockedOut(1200, 'our')).toBe('1,200 of our units were knocked out');
  });
});

describe('how an ally’s force came out of a battle (the Help card and its notice)', () => {
  it('agrees with the numbers, and only sends "the rest" home when some are left', () => {
    expect(helpOverLine(4, 1, 2)).toBe(
      'The battle is over: 1 of your 4 units was knocked out and 2 need repairs, and the rest are on their way home.',
    );
    expect(helpOverLine(2, 1, 0)).toBe(
      'The battle is over: 1 of your 2 units was knocked out, and the other is on its way home.',
    );
    expect(helpOverLine(4, 4, 0)).toBe('The battle is over: all 4 of your units were knocked out.');
    expect(helpOverLine(1, 1, 0)).toBe('The battle is over: your only unit was knocked out.');
    expect(helpOverLine(1, 0, 1)).toBe(
      'The battle is over: your unit came through, but needs repairs. It is on its way home.',
    );
    expect(helpOverLine(4, 0, 0)).toBe(
      'The battle is over: your force came through unharmed and is on its way home.',
    );
  });

  it('the notice says the same in its own words', () => {
    expect(helpOverNotice(4, 1, 1)).toBe(
      'Your force came through the battle, but 1 of its 4 units was knocked out and 1 needs repairs. The rest are on their way home.',
    );
    expect(helpOverNotice(2, 1, 0)).toBe(
      'Your force came through the battle, but 1 of its 2 units was knocked out. The other is on its way home.',
    );
    expect(helpOverNotice(3, 3, 0)).toBe(
      'Your force did not come through the battle: all 3 of its units were knocked out.',
    );
    expect(helpOverNotice(4, 0, 3)).toBe(
      'Your force came through the battle with none of its 4 units knocked out, but 3 need repairs. They are on their way home.',
    );
    expect(helpOverNotice(1, 0, 1)).toBe(
      'Your force came through the battle, but its unit needs repairs. It is on its way home.',
    );
    expect(helpOverNotice(4, 0, 0)).toBe(
      'Your force came through the battle unharmed and is on its way home.',
    );
  });
});

describe('the battle bar and the battle report', () => {
  it('names each objective: a city building by name, a zoned one by its kind', () => {
    expect(objectiveName('Coal power plant', undefined)).toBe('Coal power plant');
    expect(objectiveName(undefined, 3)).toBe('Industry');
    expect(objectiveName(undefined, 1)).toBe('Homes');
    expect(objectiveName(undefined, 2)).toBe('Business');
    expect(objectiveName(undefined, undefined)).toBe('Target');
  });

  it('counts the damage in words that agree, and leaves out a move-out of nobody', () => {
    expect(damageLine(1, 0, 1, 0)).toBe('1 building knocked down, 1 set on fire');
    expect(damageLine(3, 12, 0, 1)).toBe(
      '3 buildings knocked down (12 residents moved out), 1 road cratered',
    );
    expect(damageLine(1, 1, 0, 2)).toBe('1 building knocked down (1 resident moved out), 2 roads cratered');
    expect(damageLine(0, 0, 0, 0)).toBe('No buildings knocked down');
  });
});

describe('a diplomacy note as a notice', () => {
  it('ends with a full stop, once', () => {
    expect(asSentence('The city declares war on Wilwell: it opens in 12 hours')).toBe(
      'The city declares war on Wilwell: it opens in 12 hours.',
    );
    expect(asSentence('Wilwell accepts.')).toBe('Wilwell accepts.');
    expect(asSentence('Wilwell says: “Never”')).toBe('Wilwell says: “Never”');
    expect(asSentence('')).toBe('');
  });
});

describe('a war’s score on its card', () => {
  it('counts battles in words that agree, and says plainly when there have been none', () => {
    expect(warScoreLine(0, 0)).toBe('Score 0, no battles yet.');
    expect(warScoreLine(-15.6, 1)).toBe('Score -16 after 1 battle.');
    expect(warScoreLine(22.2, 3)).toBe('Score 22 after 3 battles.');
  });
});

describe('who pays a money term when it is added', () => {
  it('the other side, unless the city offers peace in a war it is losing', () => {
    expect(termPayer('offer', -24)).toBe('us');
    expect(termPayer('offer', 12)).toBe('them');
    expect(termPayer('offer', undefined)).toBe('them');
    expect(termPayer('propose', -40)).toBe('them');
    expect(termPayer('impose', -5)).toBe('them');
  });
});

describe('a building’s name inside a sentence', () => {
  it('drops its capital, except in a proper name', () => {
    expect(nameInSentence('Enrichment plant')).toBe('enrichment plant');
    expect(nameInSentence('Atom silo')).toBe('atom silo');
    expect(nameInSentence('City stadium')).toBe('city stadium');
    expect(nameInSentence('Military HQ')).toBe('military HQ');
    expect(nameInSentence('Sunfield Commons')).toBe('Sunfield Commons');
    expect(nameInSentence('building')).toBe('building');
  });
});

describe('a new season’s notice under a nuclear winter', () => {
  it('does not promise warmth or a winter to come under the ash', () => {
    expect(seasonNotice(2, false)).toBe(
      'Autumn: winter is three months away, and heating will push up power demand.',
    );
    expect(seasonNotice(1, false)).toMatch(/heatwaves/);
    for (const s of [0, 1, 2]) {
      const t = seasonNotice(s, true)!;
      expect(t).toMatch(/nuclear winter|ash/);
      expect(t).not.toMatch(/heatwaves|three months away/);
    }
    // Winter itself says what it always does.
    expect(seasonNotice(3, true)).toBe(seasonNotice(3, false));
    expect(seasonNotice(7, false)).toBeNull();
  });
});

describe('the war scale in the declaration (phase 5 end)', () => {
  it('names each scale in a word or two, so the drop-down never cuts an option off', () => {
    expect(scaleName('skirmish')).toBe('Skirmish war');
    expect(scaleName('war')).toBe('War');
    expect(scaleName('total')).toBe('Total war');
    expect(scaleName('total', true)).toBe('A rising');
    for (const s of ['skirmish', 'war', 'total'] as const)
      expect(scaleName(s).length).toBeLessThanOrEqual(12);
  });

  it('says beneath it what the chosen scale means, as the options used to', () => {
    expect(scaleHint('skirmish')).toBe('Battles move the score.');
    expect(scaleHint('war')).toBe('Battles move the score; a treaty ends it.');
    expect(scaleHint('total')).toBe('Total war: hold their HQ and they fall.');
    expect(scaleHint('total', true)).toBe('Total war on the overlord: hold its HQ and the city goes free.');
  });
});
