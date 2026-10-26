/** Pure layout rules for the interface (no DOM, so tests can pin them). */

export type WidthClass = 'xs' | 's' | 'm' | 'l';
export type BarsClass = 'compact' | 'tight' | 'full';

/** Window width in scaled rem (pixels over 16 times the interface scale) below which the bars fold. */
export const COMPACT_BELOW_REM = 72.5;
/** Below this a scenario's top bar closes its gaps up: its Goals button (name and progress) is the widest item. */
export const SCENARIO_TIGHT_BELOW_REM = 90;

/**
 * Size class of the interface for a window `rem` wide in scaled rem (`#ui[data-width]`): layouts
 * tighten as it narrows.
 */
export function widthClass(rem: number): WidthClass {
  return rem < 60 ? 'xs' : rem < 68 ? 's' : rem < 78 ? 'm' : 'l';
}

/**
 * `#ui[data-bars]`: `compact` below the width the bottom toolbar needs, when it wraps onto two rows
 * and the top bar folds its lesser buttons into the More menu; `tight` up to the width a scenario's
 * top bar needs, when only a scenario's top bar closes its gaps up; `full` above. The toolbar is about 70.7 rem of
 * buttons plus its margins, so raise `COMPACT_BELOW_REM` if a tool is added (the e2e in
 * fix-layout.spec.ts fails when the toolbar clips at 1160 px).
 */
export function barsClass(rem: number): BarsClass {
  return barsClassWith(rem, 0);
}

/** Width of one toolbar button and its gap, in rem (23 buttons are about 70.7 rem). */
export const TOOL_REM = 3.1;

/**
 * As `barsClass`, for a toolbar with `extra` buttons beyond the peaceful city's: a city with war on
 * (M34) shows the Military category too, so its bar folds a button's width sooner.
 */
export function barsClassWith(rem: number, extra: number): BarsClass {
  const compact = COMPACT_BELOW_REM + extra * TOOL_REM;
  return rem < compact ? 'compact' : rem < Math.max(SCENARIO_TIGHT_BELOW_REM, compact) ? 'tight' : 'full';
}

/**
 * Whether the top bar wraps onto more than one row (F11): one row needs about 44 rem (city, treasury,
 * population, demand, the More menu, the date, speed and the menu) and about 6 rem more for a shared
 * city's room button, so a phone held upright, and a tablet in a room, wrap.
 */
export function topbarRows(rem: number, inRoom: boolean): boolean {
  return rem < (inRoom ? 52 : 46);
}

/**
 * How far (px) to slide a tooltip sideways so it stays inside the window: `left` and `right` are its
 * edges where it was centred on its button, `viewport` the window's width.
 */
export function tipShift(left: number, right: number, viewport: number, margin = 8): number {
  if (left < margin) return margin - left;
  if (right > viewport - margin) return viewport - margin - right;
  return 0;
}
