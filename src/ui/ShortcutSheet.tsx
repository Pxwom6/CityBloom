import { useEffect } from 'preact/hooks';
import { isMac, modKey } from '../client/platform';
import { useGameUpdates } from './hooks';

type Row = [what: string, keys: string[]];

/** Every shortcut and gesture on one card (M14), opened with `?`. Keys follow the platform. */
function sections(): [string, Row[]][] {
  const alt = isMac ? 'Option' : 'Alt';
  return [
    [
      'Camera',
      [
        ['Pan', ['Drag', 'W A S D', 'Arrows', 'Two-finger swipe']],
        ['Zoom', ['Wheel', 'Pinch', '+ / −']],
        ['Turn and tilt', ['Right-drag', 'Q / E', 'R / F', `${alt} + swipe`]],
      ],
    ],
    [
      'Build',
      [
        ['Roads', ['T']],
        ['Road modes: curve, free, upgrade, one-way, roundabout, tram track', ['Tab']],
        ['Draw one-way, grid snap', ['O', 'G']],
        ['Zone homes, shops, industry', ['Z', 'X', 'C']],
        ['Dezone', ['V']],
        ['Districts: paint, and their panel', ['I']],
        ['Terrain: raise, lower, level, smooth', ['Shift+T', 'Tab']],
        ['Brush size', ['[ ]']],
        ['Bulldoze', ['B']],
        ['Select and inspect', ['H', 'Click']],
        ['Cancel, leave a tool', ['Esc', 'Right-click']],
      ],
    ],
    [
      'Edit',
      [
        ['Undo (last 30)', [modKey('Z'), 'U']],
        ['Redo', [modKey('Z', true), ...(isMac ? [] : ['Ctrl+Y']), 'Shift+U']],
        ['Move a civic building', ['Select it', 'Move']],
      ],
    ],
    [
      'City',
      [
        ['Pause, speeds', ['Space', '1', '2', '3']],
        ['Budget, advisors', ['M', 'J']],
        ['Notifications, city', ['N', 'P']],
        ['City history, photo mode', ['Y', 'K']],
        ['Scenario goals', ['G']],
        ['Data maps', ['L']],
        ['Pause menu', ['Esc']],
        ['This card', ['?']],
      ],
    ],
  ];
}

export function ShortcutSheet() {
  const game = useGameUpdates(200);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (game.screen) return;
      if (e.key === '?') {
        e.preventDefault();
        game.toggleShortcuts();
      } else if (e.code === 'Escape' && game.shortcutsOpen) {
        // Close the card rather than cancel a tool or open the pause menu.
        e.preventDefault();
        e.stopImmediatePropagation();
        game.toggleShortcuts(false);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [game]);
  if (!game.shortcutsOpen) return null;
  return (
    <div class="shortcut-sheet panel" role="dialog" aria-label="Keyboard shortcuts" data-testid="shortcuts">
      <header>
        <h2>Shortcuts</h2>
        <button class="btn small" data-testid="shortcuts-close" onClick={() => game.toggleShortcuts(false)}>
          Close
        </button>
      </header>
      <div class="columns">
        {sections().map(([title, rows]) => (
          <section key={title}>
            <h3>{title}</h3>
            <dl>
              {rows.map(([what, keys]) => (
                <div key={what}>
                  <dt>{what}</dt>
                  <dd>
                    {keys.map((k, i) => (
                      <>
                        {i > 0 && <span class="or"> or </span>}
                        <kbd>{k}</kbd>
                      </>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p class="muted">
        {isMac ? 'Trackpad' : 'Trackpad or touchpad'}: swipe to pan, pinch to zoom. Settings can fix the
        pointing device if it's detected wrongly.
      </p>
    </div>
  );
}
