import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Game } from '../../src/game';
import type { AtomSummary } from '../../src/sim/systems/atom';

/*
 * M40 step 11 review: the war room's components, drawn without a browser. `preact/hooks` is stood in for
 * by plain stores (a state starts as the test says, a setter is recorded), which is enough to call a
 * component once and read the tree it returns: each button's handler can then be pressed as the page
 * would press it. The page's real behaviour on a screen is the e2e's; what is held here is what each
 * control does and does not do when it is pressed.
 */
const hooks = vi.hoisted(() => ({
  /** The value the next `useState` starts with, in place of its own (undefined: its own). */
  start: undefined as unknown,
  sets: [] as unknown[],
}));

vi.mock('preact/hooks', () => ({
  useState: (init: unknown) => [
    hooks.start === undefined ? init : hooks.start,
    (v: unknown) => hooks.sets.push(v),
  ],
  useRef: (init: unknown) => ({ current: init }),
  useEffect: () => {},
  useMemo: (f: () => unknown) => f(),
  useCallback: (f: unknown) => f,
  useContext: () => undefined,
  useLayoutEffect: () => {},
}));

// (After the mock: the module reads the hooks it was given.)
const { CountdownView, HoldButton, LaunchCard, StopBuilding } = await import('../../src/ui/Atom');
const { countdown, HOLD_MS } = await import('../../src/ui/atomView');

interface Node {
  type: unknown;
  props: Record<string, unknown> & { children?: unknown };
}

/** Every element of a tree a component returned, in order, that the test asks for. */
function find(tree: unknown, want: (n: Node) => boolean, out: Node[] = []): Node[] {
  if (Array.isArray(tree)) for (const t of tree) find(t, want, out);
  else if (tree && typeof tree === 'object' && 'props' in tree) {
    const n = tree as Node;
    if (want(n)) out.push(n);
    find(n.props.children, want, out);
  }
  return out;
}
const byId = (tree: unknown, id: string) => find(tree, (n) => n.props['data-testid'] === id);
const text = (tree: unknown): string =>
  Array.isArray(tree)
    ? tree.map(text).join('')
    : typeof tree === 'string' || typeof tree === 'number'
      ? String(tree)
      : tree && typeof tree === 'object' && 'props' in tree
        ? text((tree as Node).props.children)
        : '';

/** A stand-in for the game with what these components read, and a record of what they did. */
function stand(over: { guest?: boolean; atom?: Partial<AtomSummary> } = {}) {
  const log = {
    dispatched: [] as unknown[],
    toasts: [] as string[],
    holds: [] as string[],
    holdEnds: 0,
    presses: 0,
  };
  const atom: Partial<AtomSummary> = {
    have: true,
    launch: null,
    launchWhy: null,
    targets: [{ id: 1, name: 'Calhaven', friend: false, why: null }],
    ...over.atom,
  };
  const game = {
    readOnly: false,
    net: over.guest === undefined ? null : { session: { isHost: !over.guest } },
    world: { stats: { war: { atom } } },
    dispatch: (cmd: unknown) => {
      log.dispatched.push(cmd);
      return Promise.resolve({ ok: true });
    },
    toast: (t: string) => log.toasts.push(t),
    audio: { play: () => {} },
    atomUi: {
      holdBegin: (id: string) => log.holds.push(id),
      holdEnd: () => log.holdEnds++,
      commitPress: () => log.presses++,
    },
  } as unknown as Game;
  return { game, log };
}

beforeEach(() => {
  hooks.start = undefined;
  hooks.sets.length = 0;
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: () => {} });
  vi.stubGlobal('performance', { now: () => 0 });
});
afterEach(() => vi.unstubAllGlobals());

type Handler = (e: unknown) => void;
const handler = (node: Node, name: string) => node.props[name] as Handler;

describe('M40 step 11 review: the held button', () => {
  const button = (game: Game) =>
    byId(
      HoldButton({ game, testid: 'launch-hold', label: 'Hold', disabled: false, onDone: () => {} }),
      'launch-hold',
    )[0]!;

  it('swallows the keyboard’s auto-repeat of a held Space, so the window’s Space never pauses the game under it', () => {
    const { game, log } = stand();
    const b = button(game);
    const key = (repeat: boolean, k = ' ') => {
      const e = { key: k, repeat, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      handler(b, 'onKeyDown')(e);
      return e;
    };
    // The first press begins the hold, and is the hold's alone.
    const first = key(false);
    expect(first.preventDefault).toHaveBeenCalled();
    expect(first.stopPropagation).toHaveBeenCalled();
    expect(log.holds).toEqual(['launch-hold']);
    // Every repeat after it is swallowed too (this is what the window's Space handler would act on),
    // and none of them begins the hold again.
    for (let n = 0; n < 5; n++) {
      const again = key(true);
      expect(again.preventDefault, `repeat ${n}`).toHaveBeenCalled();
      expect(again.stopPropagation, `repeat ${n}`).toHaveBeenCalled();
    }
    const enter = key(true, 'Enter');
    expect(enter.preventDefault).toHaveBeenCalled();
    expect(log.holds).toEqual(['launch-hold']);
    // Another key is left to the game.
    const other = key(false, '1');
    expect(other.preventDefault).not.toHaveBeenCalled();
    expect(other.stopPropagation).not.toHaveBeenCalled();
  });

  it('ends the hold when a finger slides off the button, though a touch never says it left', () => {
    const { game, log } = stand();
    const b = button(game);
    const rect = { left: 100, right: 300, top: 400, bottom: 440 };
    const move = (x: number, y: number) =>
      handler(
        b,
        'onPointerMove',
      )({ clientX: x, clientY: y, currentTarget: { getBoundingClientRect: () => rect } });
    handler(b, 'onPointerDown')({ pointerType: 'touch', button: 0, preventDefault: () => {} });
    expect(log.holds).toEqual(['launch-hold']);
    // Wandering about on the button keeps the hold.
    move(150, 410);
    move(299, 439);
    expect(log.holdEnds).toBe(0);
    // Sliding off it ends the hold, though no leave event came.
    move(200, 160);
    expect(log.holdEnds).toBe(1);
    // A move after that has nothing to end.
    move(200, 160);
    expect(log.holdEnds).toBe(1);
    expect(HOLD_MS).toBe(3000);
  });
});

describe('M40 step 11 review: the launch card', () => {
  it('holds a second sending as it holds the first: there is no plain button for it', () => {
    for (const again of [false, true]) {
      const { game } = stand({
        atom: again
          ? {
              launch: {
                done: 1,
                to: 1,
                name: 'Calhaven',
                ready: true,
                wait: null,
                held: 'The war is paused',
                refused: null,
                sent: false,
              },
            }
          : {},
      });
      const tree = LaunchCard({ game, again });
      const id = again ? 'atom-send-again' : 'launch-hold';
      const hold = find(tree, (n) => n.type === HoldButton);
      expect(hold, again ? 'sending again' : 'launching').toHaveLength(1);
      expect(hold[0]!.props.testid).toBe(id);
      // No bare button carries the id (a tap on it would send the bomb).
      expect(find(tree, (n) => n.type === 'button' && n.props['data-testid'] === id)).toEqual([]);
    }
  });

  it('is dead for a guest in a shared city, with the room’s words, and alive for the host and for a single player', () => {
    const state = (guest?: boolean) => {
      const { game } = stand(guest === undefined ? {} : { guest });
      const tree = LaunchCard({ game, again: false });
      const hold = find(tree, (n) => n.type === HoldButton)[0]!;
      return {
        disabled: hold.props.disabled,
        title: hold.props.title,
        why: text(byId(tree, 'atom-launch-why')),
      };
    };
    expect(state(true)).toEqual({
      disabled: true,
      title: 'Only the host can launch the atom bomb',
      why: 'Only the host can launch the atom bomb.',
    });
    expect(state(false)).toMatchObject({ disabled: false, why: '' });
    expect(state()).toMatchObject({ disabled: false, why: '' });
  });
});

describe('M40 step 11 review: stopping the build', () => {
  const bomb = { done: 0.75, paid: 9, of: 12, wait: null };

  it('asks before it throws the build away: one tap sends nothing, and the question says what is lost', () => {
    const { game, log } = stand();
    const tree = StopBuilding({ game, bomb });
    handler(byId(tree, 'atom-stop')[0]!, 'onClick')({});
    expect(log.dispatched, 'a tap on Stop building sends no command').toEqual([]);
    expect(hooks.sets).toEqual([true]);
    expect(byId(tree, 'atom-stop-confirm')).toEqual([]);

    // The question, as it stands once asked.
    hooks.start = true;
    const asked = StopBuilding({ game, bomb });
    expect(text(byId(asked, 'atom-stop-terms'))).toMatch(/75 % built, with 9 of 12 instalments paid/);
    expect(text(byId(asked, 'atom-stop-terms'))).toMatch(/all of that is lost/);
    expect(text(byId(asked, 'atom-stop-terms'))).toMatch(/starting again begins from nothing/);
    // Keeping it sends nothing; only the second, plain-worded button does.
    handler(byId(asked, 'atom-stop-no')[0]!, 'onClick')({});
    expect(log.dispatched).toEqual([]);
    handler(byId(asked, 'atom-stop-yes')[0]!, 'onClick')({});
    expect(log.dispatched).toEqual([{ type: 'cancelBomb' }]);
  });
});

describe('M40 step 11 review: the countdown card', () => {
  const card = (over: { raise?: boolean; canLook?: boolean } = {}) => {
    const inbound = {
      from: 'Calhaven',
      warn: 60,
      side: 'north' as const,
      arrive: 1_500,
      x: 0,
      z: 0,
      near: 1000,
      sheltered: 300,
      stops: false,
      raisable: over.raise ?? false,
    };
    const dome = {
      civic: 1,
      charge: 1,
      mode: over.raise ? ('off' as const) : ('all' as const),
      raised: false,
      down: 0,
    };
    const calls: string[] = [];
    const c = countdown(inbound, 0, dome, false);
    const tree = CountdownView({
      c,
      canLook: over.canLook ?? false,
      roomOpen: false,
      onShow: () => calls.push('show'),
      onRaise: () => calls.push('raise'),
      onLook: () => calls.push('look'),
      onRoom: () => calls.push('room'),
    });
    return { tree, calls, c };
  };

  it('puts no live region round the clock: one hidden alert says it once, and holds no figure', () => {
    const { tree, c } = card();
    const root = tree as unknown as Node;
    // The card itself is a labelled group, not an alert: its content moves eight times a second.
    expect(root.props.role).toBe('group');
    expect(root.props['aria-live']).toBeUndefined();
    expect(root.props['aria-label']).toBeTruthy();
    // The clock is in the card, and no element that holds it (or the card) is a live region.
    expect(byId(tree, 'atom-eta')).toHaveLength(1);
    const live = find(tree, (n) => n.props.role === 'alert' || n.props['aria-live'] !== undefined);
    expect(live).toHaveLength(1);
    expect(live[0]!.props['data-testid']).toBe('atom-announce');
    expect(find(live[0], (n) => n.props['data-testid'] === 'atom-eta')).toEqual([]);
    expect(text(live[0])).toBe(c.announce);
    expect(c.announce).toMatch(/Calhaven/);
    expect(c.announce).not.toMatch(/\d/);
  });

  it('offers the dome only when the card says raising it helps, and each button does what it says', () => {
    expect(byId(card().tree, 'atom-raise-dome')).toEqual([]);
    const { tree, calls } = card({ raise: true, canLook: true });
    handler(byId(tree, 'atom-raise-dome')[0]!, 'onClick')({});
    handler(byId(tree, 'atom-show')[0]!, 'onClick')({});
    handler(byId(tree, 'atom-look')[0]!, 'onClick')({});
    handler(byId(tree, 'atom-open-room')[0]!, 'onClick')({});
    expect(calls).toEqual(['raise', 'show', 'look', 'room']);
  });
});

describe('M40 step 11 review: the stylesheet', () => {
  const css = readFileSync('src/ui/styles/main.css', 'utf8');
  /** The declarations of the rule whose selector is exactly `selector` (the first such rule). */
  const rule = (selector: string): string => {
    const at = css.indexOf(`\n${selector} {`);
    expect(at, `a rule for ${selector}`).toBeGreaterThanOrEqual(0);
    return css.slice(at, css.indexOf('}', at));
  };

  it('moves a tip off the countdown card while a bomb is on its way (both stood at the top left, one over the other)', () => {
    const tip = rule('.atom-countdown ~ .guide');
    expect(tip).toMatch(/top:\s*auto/);
    expect(tip).toMatch(/bottom:\s*calc\(var\(--toolbar-height\)/);
    // The card comes before the tip in the page, which is what the sibling selector reads.
    const app = readFileSync('src/ui/App.tsx', 'utf8');
    expect(app.indexOf('<AtomCountdown />')).toBeGreaterThan(-1);
    expect(app.indexOf('<AtomCountdown />')).toBeLessThan(app.indexOf('<TipCard />'));
  });

  it('keeps the hidden announcement out of sight and out of the layout', () => {
    const r = rule('.atom-announce');
    expect(r).toMatch(/position:\s*absolute/);
    expect(r).toMatch(/width:\s*1px/);
    expect(r).toMatch(/overflow:\s*hidden/);
  });

  it('gives “Show where” a phone-sized target, and the touch check looks at it', () => {
    const r = rule("#ui[data-width='xs'] .atom-countdown .link");
    expect(r).toMatch(/min-height:\s*max\(24px/);
    const spec = readFileSync('e2e/m39-touch-scale.spec.ts', 'utf8');
    expect(spec).toContain("'.atom-countdown .link'");
  });
});
