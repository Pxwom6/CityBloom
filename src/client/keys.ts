/**
 * Is a key press the player's typing (or a control's own key), so the game's shortcuts leave it
 * alone? Text fields, text areas, selects, editable text and sliders keep every key; a ticked box
 * or a radio button keeps only Space and Enter, so after ticking one the shortcuts still work.
 */
const CONTROLS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);

export function typingIn(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || typeof t.tagName !== 'string') return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName !== 'INPUT') return false;
  if (CONTROLS.has((t as HTMLInputElement).type)) return e.key === ' ' || e.key === 'Enter';
  return true;
}
