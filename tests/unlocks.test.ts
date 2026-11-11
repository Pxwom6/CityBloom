import { describe, expect, it } from 'vitest';
import { unlocksAt } from '../src/data/unlocks';
import { DENSITY_UNLOCK_POPULATION } from '../src/data/buildings';

describe('unlocksAt', () => {
  it('lists only zero-population modules and policies at population 0', () => {
    const list = unlocksAt(0);
    expect(list).not.toContain('Medium-density zones');
    expect(list).not.toContain('High-density zones');
    for (const label of list) expect(label).toMatch(/ \((module|policy)\)$/);
    expect(list).toContain('Extra truck (module)');
  });

  it('unlocks medium density at its population', () => {
    const list = unlocksAt(DENSITY_UNLOCK_POPULATION[1]);
    expect(list).toContain('Medium-density zones');
    expect(list).not.toContain('High-density zones');
  });

  it('unlocks high density at its population', () => {
    const list = unlocksAt(DENSITY_UNLOCK_POPULATION[2]);
    expect(list).toContain('High-density zones');
    expect(list).not.toContain('Medium-density zones');
  });

  it('unlocks nothing between milestones', () => {
    expect(unlocksAt(1234)).toEqual([]);
    expect(unlocksAt(DENSITY_UNLOCK_POPULATION[1] + 1)).toEqual([]);
  });
});
