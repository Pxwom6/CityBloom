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

export function Toasts() {
  const game = useGame();
  return (
    <div class={`toasts ${game.selected ? 'beside-panel' : ''}`} aria-live="polite">
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
  const inCity = game.mode === 'play';
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
