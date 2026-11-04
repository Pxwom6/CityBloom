import { describe, expect, it } from 'vitest';
import { helpOverLine, helpOverNotice, shelterSentence, unitsKnockedOut } from '../../src/ui/warWords';
import { shelterLine } from '../../src/ui/atomView';

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
