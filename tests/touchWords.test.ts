/**
 * The tools' hints on a touch screen (phase 6 end): a phone's road tool said "Click or drag to draw ·
 * pan with middle-drag, WASD or a swipe". `Game.setHint` reads every hint through `touchWords` there.
 */
import { describe, expect, it } from 'vitest';
import { touchWords } from '../src/client/touchWords';

describe('tool hints read for a finger', () => {
  it('speaks of taps and two fingers, never of a mouse or keys', () => {
    expect(touchWords('Street · $10/m — Click or drag to draw · pan with middle-drag, WASD or a swipe')).toBe(
      'Street · $10/m — Tap or drag to draw · move the map with two fingers',
    );
    expect(touchWords('Avenue · one-way (O) · $20/m — Click to start a curve')).toBe(
      'Avenue · one-way · $20/m — Tap to start a curve',
    );
    expect(
      touchWords('Click a junction or a road for a roundabout; drag out, or press [ and ], to size the ring'),
    ).toBe('Tap a junction or a road for a roundabout; drag out to size the ring');
    expect(touchWords('Bulldozer — click a road or building')).toBe('Bulldozer — tap a road or building');
    expect(touchWords('Residential zone · brush 24 m ([ ]) · shift-click fills a road')).toBe(
      'Residential zone · brush 24 m',
    );
    // Words with nothing of a mouse in them are left as they are.
    expect(touchWords('Wind turbine · $3,000 · $60/mo upkeep')).toBe('Wind turbine · $3,000 · $60/mo upkeep');
  });
});
