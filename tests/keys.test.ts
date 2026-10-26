import { describe, expect, it } from 'vitest';
import { typingIn } from '../src/client/keys';

/** Shortcuts and typing: a ticked box doesn't swallow the game's shortcuts (M35 e2e). */
describe('typing or a shortcut', () => {
  const press = (target: object | null, key: string) => typingIn({ target, key } as unknown as KeyboardEvent);
  const input = (type: string) => ({ tagName: 'INPUT', type, isContentEditable: false });

  it('text fields, sliders, selects and editable text keep every key', () => {
    for (const t of [input('text'), input('number'), input('range'), input('search')])
      expect(press(t, 'M')).toBe(true);
    expect(press({ tagName: 'TEXTAREA' }, 'N')).toBe(true);
    expect(press({ tagName: 'SELECT' }, 'ArrowUp')).toBe(true);
    expect(press({ tagName: 'DIV', isContentEditable: true }, 'M')).toBe(true);
  });

  it('a ticked box or radio keeps only Space and Enter', () => {
    for (const t of [input('checkbox'), input('radio')]) {
      expect(press(t, 'M')).toBe(false);
      expect(press(t, 'N')).toBe(false);
      expect(press(t, ' ')).toBe(true);
      expect(press(t, 'Enter')).toBe(true);
    }
  });

  it('anything else is a shortcut', () => {
    expect(press({ tagName: 'CANVAS' }, 'M')).toBe(false);
    expect(press({ tagName: 'BUTTON' }, 'M')).toBe(false);
    expect(press(null, 'M')).toBe(false);
  });
});
