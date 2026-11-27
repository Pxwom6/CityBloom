import { useEffect, useState } from 'preact/hooks';
import { useGame, useGameUpdates } from './hooks';

/** The menu button: opens the pause menu (save, load, settings, quit); shows autosaves happening. */
export function SystemMenu() {
  const game = useGameUpdates(250);
  return (
    <div class="sysmenu">
      {game.saving && (
        <span class="saving" data-testid="saving" aria-live="polite">
          Saving…
        </span>
      )}
      <button
        class="btn icon"
        aria-label="Menu"
        title="Menu: save, load, settings (Esc)"
        data-testid="menu-button"
        onClick={() => game.openScreen('pause')}
      >
        ☰
      </button>
    </div>
  );
}

/**
 * On a phone, notices keep clear of a tutorial card or a tip, which stand under the top bar too (phase 6
 * end: a fire's notices covered the tutorial card's words). Upright, they go just under the card (but
 * stay put over a sheet, whose tabs they'd cover); sideways, beside it, or under it while a sheet takes
 * the right-hand side.
 */
function useClearOfCard(): { top?: string; left?: string } | null {
  const [at, setAt] = useState<{ top?: string; left?: string } | null>(null);
  useEffect(() => {
    const place = () => {
      const ui = document.getElementById('ui');
      const r =
        ui?.dataset.phone !== undefined
          ? document.querySelector('.guide')?.getBoundingClientRect()
          : undefined;
      // (Only a card at the top: one at the foot leaves the notices where they are.)
      if (!ui || !r || !r.height || r.top > innerHeight / 2) return setAt((was) => (was ? null : was));
      const sheet = !!ui.querySelector('aside.panel');
      const next =
        ui.dataset.orient === 'portrait'
          ? sheet
            ? null
            : { top: `${Math.round(r.bottom + 8)}px` }
          : sheet
            ? { top: `${Math.round(r.bottom + 8)}px` }
            : { left: `${Math.round(r.right + 8)}px` };
      setAt((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
    };
    place();
    const timer = setInterval(place, 250);
    return () => clearInterval(timer);
  }, []);
  return at;
}

export function Toasts() {
  const game = useGame();
  const clear = useClearOfCard();
  return (
    <div
      class={`toasts ${game.panel === 'battleMap' ? 'beside-map' : game.selected ? 'beside-panel' : ''}`}
      style={clear ?? undefined}
      aria-live="polite"
    >
      <UpdateNotice />
      {game.toasts.map((t) => (
        <div
          key={t.id}
          class={`toast ${t.tone} ${t.at ? 'clickable' : ''}`}
          data-testid="toast"
          onClick={() => t.at && game.flyTo(t.at)}
          title={t.at ? 'Show me' : undefined}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

/** "New version, reload" (M15): stays until the player reloads or says later. */
function UpdateNotice() {
  const game = useGame();
  const u = game.updates;
  if (!u.waiting || u.dismissed) return null;
  // A visit to a neighbour's city is never saved (F5).
  const inCity = game.mode === 'play' && !game.readOnly;
  return (
    <div class="toast update-notice" role="status" data-testid="update-notice">
      <strong>New version of Citybloom</strong>
      <span>{inCity ? 'Reload to switch: your city is saved first.' : 'Reload to switch to it.'}</span>
      <div class="update-actions">
        <button class="btn" data-testid="update-later" onClick={() => u.dismiss()}>
          Later
        </button>
        <button
          class="btn active"
          data-testid="update-reload"
          disabled={game.updating}
          onClick={() => void game.applyUpdate()}
        >
          {game.updating ? 'Saving…' : 'Reload'}
        </button>
      </div>
    </div>
  );
}
