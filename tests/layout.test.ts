import { describe, expect, it } from 'vitest';
import { barsClass, tipShift, topbarFolds, topbarRows, widthClass } from '../src/ui/layout';

describe('interface size classes', () => {
  it('sorts a window by its width in scaled rem', () => {
    expect([59.9, 60, 67.9, 68, 77.9, 78].map(widthClass)).toEqual(['xs', 's', 's', 'm', 'm', 'l']);
  });

  it('wraps the toolbar below the width its buttons need, and tightens a scenario top bar below 90 rem', () => {
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

describe('the top bar on a phone (F11)', () => {
  it('wraps onto two rows when one row would clip, sooner in a room', () => {
    // 390 px (a phone held upright) and 768 px (a tablet) at the normal interface size.
    expect(topbarRows(390 / 16, false)).toBe(true);
    expect(topbarRows(390 / 16, true)).toBe(true);
    expect(topbarRows(768 / 16, false)).toBe(false);
    expect(topbarRows(768 / 16, true)).toBe(true);
    expect(topbarRows(1280 / 16, true)).toBe(false);
  });
});

describe('the top bar folding when what it shows doesn’t fit (phase 5 checks)', () => {
  it('folds when its content passes the room it has, and unfolds only with room to spare', () => {
    // 1280 px window: room 1256 px. A war city's bar with a nuclear winter's badge: 1430 px.
    expect(topbarFolds(false, 1180, 1256, 0)).toBe(false);
    expect(topbarFolds(false, 1430, 1256, 0)).toBe(true);
    // Folded it is 1120 px; folding saved 310 px. The badge still there: it stays folded.
    expect(topbarFolds(true, 1120, 1256, 310)).toBe(true);
    // The winter over (the bar 890 px folded, 1200 unfolded): it unfolds.
    expect(topbarFolds(true, 890, 1256, 310)).toBe(false);
    // At the edge it doesn't flicker: 4 px short of the room is still folded.
    expect(topbarFolds(true, 1252 - 310, 1256, 310)).toBe(true);
  });
});
