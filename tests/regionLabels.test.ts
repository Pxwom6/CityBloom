import { describe, expect, it } from 'vitest';
import { neighbourLabel } from '../src/client/regionView';
import type { PlayerNeighbour } from '../src/sim/systems/region';

/** The neighbours' labels at the map's edge (multiplayer review, minor). */
describe('a neighbour’s label', () => {
  it('names a player’s city by its mayor, and a small town by its real size', () => {
    const player = { mayor: 'Sam' } as PlayerNeighbour;
    expect(neighbourLabel('↑', { name: 'Samford', kind: 'industrial', population: 240, player })).toBe(
      '↑ Samford · Sam’s city · 240',
    );
    expect(neighbourLabel('↓', { name: 'Millbrook', kind: 'industrial', population: 4230 })).toMatch(
      /^↓ Millbrook · .+ · 4\.2k$/,
    );
    expect(neighbourLabel('←', { name: 'Oakvale', kind: 'suburb', population: 38_400 })).toMatch(/ · 38k$/);
  });
});
