/**
 * Words written for a mouse and keys, read on a touch screen (phase 6 end): a phone's first city was
 * told to right-drag, scroll, press Esc and pan with middle-drag or WASD. The tutorial's cards and tips
 * (`wordsFor` in tutorial.ts) and the tools' hints (`Game.setHint`) go through `touchWords` there.
 */

const coarse = typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null;

/** Is the main pointer a finger (a phone or a tablet), so the game speaks of tapping rather than clicking? */
export function touchScreen(): boolean {
  return !!coarse?.matches;
}

/** The words with the keys' shortcuts left out, the mouse's ways of moving the map a finger's, and clicks taps. */
export function touchWords(text: string): string {
  return text
    .replace(/ · pan with middle-drag, WASD or a swipe/g, ' · move the map with two fingers')
    .replace(/, or press \[ and \],/g, '')
    .replace(/ \(\[ \]\)/g, '')
    .replace(/ · shift-click fills a road/g, '')
    .replace(/ \((?:Shift\+)?[A-Z0-9]\)/g, '')
    .replace(/ \((?:Esc|Escape)\)/g, '')
    .replace(/\((?:Shift\+[A-Z]|Esc|Escape|[A-Z]), (?:or )?/g, '(')
    .replace(/\bClick\b/g, 'Tap')
    .replace(/\bclick\b/g, 'tap')
    .replace(/\bclicking\b/g, 'tapping');
}
