import { describe, expect, it } from 'vitest';
import { ATOM } from '../../src/data/atom';
import type { CommandResult } from '../../src/sim/commands';
import { runAtomSection, THROTTLES } from './atomSection';

/**
 * The atom section is a story, and it says when the story does not happen (`must`): a section that
 * stayed green while it covered less (a blast in one slice, no fire set, a saboteur never caught) would
 * compare nothing in the browsers. Each test breaks one thing the story needs and wants the section to
 * stop, saying what. (The whole section passing is `determinism.test.ts`, which also reads what its
 * entries hold.)
 */

const play = (): string[] => runAtomSection((_, r: CommandResult) => r);

/** Runs the section with some of the game's numbers changed, then puts them back, pass or fail. */
function broken<T>(patch: Partial<typeof ATOM.impact>, play: () => T): T {
  const was = { ...ATOM.impact };
  Object.assign(ATOM.impact, patch);
  try {
    return play();
  } finally {
    Object.assign(ATOM.impact, was);
  }
}

describe('the atom section stops when its story does not happen', () => {
  it('no fire is set, and the blast throttles are the game own again afterwards', () => {
    const slice = ATOM.impact.slice;
    const perTick = ATOM.impact.firesPerTick;
    expect(THROTTLES.slice).toBeLessThan(slice);
    expect(THROTTLES.firesPerTick).toBeLessThan(perTick);
    // (Fires that never catch: the ring is worked through and nothing is lit.)
    expect(() => broken({ fireChance: 0 }, () => play())).toThrow(
      /story broke: the fires were not set over several ticks/,
    );
    // The section lowers two limits for the strike on the town and gives them back even when it stops.
    expect(ATOM.impact.slice).toBe(slice);
    expect(ATOM.impact.firesPerTick).toBe(perTick);
  }, 120_000);

  it("the blast is one slice (the game's own cap of 400, bigger than the town)", () => {
    // The strike on the town as the section first played it: every building inside goes in the first slice.
    const was = THROTTLES.slice;
    try {
      THROTTLES.slice = ATOM.impact.slice;
      expect(() => play()).toThrow(/story broke: the blast was not dealt out in slices/);
    } finally {
      THROTTLES.slice = was;
    }
  }, 120_000);

  it('no agent is ever caught or gets through', () => {
    // Missions that always find nothing to slow: the race is never put back.
    const was = ATOM.spy.setBack;
    try {
      ATOM.spy.setBack = 0;
      expect(() => play()).toThrow(
        /story broke: the saboteurs were never both caught once and successful once/,
      );
    } finally {
      ATOM.spy.setBack = was;
    }
  }, 120_000);
});
