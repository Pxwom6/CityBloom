import { describe, expect, it } from 'vitest';
import { barsClass, tipShift, widthClass } from '../src/ui/layout';

describe('interface size classes', () => {
  it('sorts a window by its width in scaled rem', () => {
    expect([59.9, 60, 67.9, 68, 77.9, 78].map(widthClass)).toEqual(['xs', 's', 's', 'm', 'm', 'l']);
  });

  it('wraps the toolbar below the width its buttons need, and folds a scenario bar below 90 rem', () => {
    // 1160 px at the normal interface size: the toolbar is 70.7 rem of buttons plus margins.
    expect([59.9, 67.9, 72.4].map(barsClass)).toEqual(['compact', 'compact', 'compact']);
    expect([72.5, 77.9, 89.9].map(barsClass)).toEqual(['tight', 'tight', 'tight']);
    expect([90, 120].map(barsClass)).toEqual(['full', 'full']);
  });
});

describe('tooltip placement', () => {
  it('leaves a tooltip that fits where it is', () => {
    expect(tipShift(100, 300, 1280)).toBe(0);
    expect(tipShift(8, 300, 1280)).toBe(0);
    expect(tipShift(100, 1272, 1280)).toBe(0);
  });

  it('slides one that runs off the left edge right, and off the right edge left', () => {
    expect(tipShift(-17, 228, 1280)).toBe(25);
    expect(tipShift(1039, 1311, 1280)).toBe(-39);
    expect(tipShift(-145, 100, 1024)).toBe(153);
  });
});
