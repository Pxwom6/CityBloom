import { afterEach, describe, expect, it, vi } from 'vitest';
import { AtomUi } from '../../src/client/atomUi';
import { aftermath } from '../../src/ui/atomView';

/** M40 step 11: what the page keeps of the bomb that the sim doesn't (`src/client/atomUi.ts`). */
describe('M40 step 11: the page’s atom state', () => {
  const make = () => {
    let notified = 0;
    const ui = new AtomUi({ notify: () => notified++ });
    return { ui, notified: () => notified };
  };

  it('keeps the card a bomb left behind until it is closed, and a new one replaces it', () => {
    const { ui, notified } = make();
    expect(ui.after).toBeNull();
    ui.showAfter('hit', { fled: 1200, levelled: 40 });
    expect(ui.after).toEqual({ kind: 'hit', ...aftermath('hit', { fled: 1200, levelled: 40 }) });
    expect(ui.after!.text).toContain('1,200 residents have left the city; 40 buildings were levelled');
    ui.showAfter('stopped', { from: 'Calhaven' });
    expect(ui.after!.kind).toBe('stopped');
    ui.dismissAfter();
    expect(ui.after).toBeNull();
    // Closing nothing tells nobody.
    const n = notified();
    ui.dismissAfter();
    expect(notified()).toBe(n);
  });

  it('hides "Look at the missile" until the effects have a missile, and goes to it when there is one', () => {
    const { ui } = make();
    expect(ui.canLook).toBe(false);
    expect(ui.look()).toBe(false);
    let looked = 0;
    let there = false;
    ui.missile = { available: () => there, look: () => looked++ };
    expect(ui.canLook).toBe(false);
    expect(ui.look()).toBe(false);
    there = true;
    expect(ui.canLook).toBe(true);
    expect(ui.look()).toBe(true);
    expect(looked).toBe(1);
  });

  describe('a press that committed the launch', () => {
    afterEach(() => vi.unstubAllGlobals());

    /** A window that records its listeners, so a test can lift the pointer. */
    const fakeWindow = () => {
      const listeners = new Map<string, Set<() => void>>();
      vi.stubGlobal('window', {
        addEventListener: (t: string, f: () => void) => {
          if (!listeners.has(t)) listeners.set(t, new Set());
          listeners.get(t)!.add(f);
        },
        removeEventListener: (t: string, f: () => void) => listeners.get(t)?.delete(f),
      });
      return {
        count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
        fire: (t: string) => [...(listeners.get(t) ?? [])].forEach((f) => f()),
      };
    };

    it('guards what takes the held button’s place until the pointer is up, and a moment after', () => {
      const win = fakeWindow();
      const { ui, notified } = make();
      const now = performance.now();
      expect(ui.guarded(now)).toBe(false);
      ui.commitPress();
      expect(ui.guarded(performance.now())).toBe(true);
      // Still down a long while later: still guarded (up to the limit).
      expect(ui.guarded(now + 10_000)).toBe(true);
      const before = notified();
      win.fire('pointerup');
      expect(notified()).toBe(before + 1);
      // Just let go: guarded; a moment later: not.
      expect(ui.guarded(performance.now())).toBe(true);
      expect(ui.guarded(performance.now() + 1_000)).toBe(false);
      // Every listener the press put up is gone with the release.
      expect(win.count()).toBe(0);
    });

    it('does not guard for ever when the release is lost', () => {
      fakeWindow();
      const { ui } = make();
      ui.commitPress();
      expect(ui.guarded(performance.now() + 60_000)).toBe(false);
    });

    it('lifts on a finger’s touch end, a cancelled touch, a key coming up, and the window losing focus', () => {
      for (const t of ['touchend', 'pointercancel', 'touchcancel', 'keyup', 'blur', 'mouseup']) {
        const win = fakeWindow();
        const { ui } = make();
        ui.commitPress();
        win.fire(t);
        expect(win.count(), t).toBe(0);
        expect(ui.guarded(performance.now() + 1_000), t).toBe(false);
      }
    });

    it('has nothing to guard where there is no window', () => {
      const { ui } = make();
      ui.commitPress();
      expect(ui.guarded(performance.now())).toBe(false);
    });
  });

  it('keeps the held button for a test to read, and lets it go', () => {
    const { ui } = make();
    expect(ui.hold).toBeNull();
    ui.holdBegin('launch-hold', 1234);
    expect(ui.hold).toEqual({ id: 'launch-hold', since: 1234 });
    ui.holdEnd();
    expect(ui.hold).toBeNull();
  });
});
