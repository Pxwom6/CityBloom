/** Pure layout rules for the interface (no DOM, so tests can pin them). */

export type WidthClass = 'xs' | 's' | 'm' | 'l';
export type BarsClass = 'compact' | 'tight' | 'full';

/** Window width in scaled rem (pixels over 16 times the interface scale) below which the bars fold. */
export const COMPACT_BELOW_REM = 72.5;
/** Below this a scenario's top bar folds too: its Goals button (name and progress) is the widest item. */
export const SCENARIO_FOLD_BELOW_REM = 90;

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
 * top bar needs, when only a scenario's top bar folds; `full` above. The toolbar is about 70.7 rem of
 * buttons plus its margins, so raise `COMPACT_BELOW_REM` if a tool is added (the e2e in
 * fix-layout.spec.ts fails when the toolbar clips at 1160 px).
 */
export function barsClass(rem: number): BarsClass {
  return rem < COMPACT_BELOW_REM ? 'compact' : rem < SCENARIO_FOLD_BELOW_REM ? 'tight' : 'full';
}
