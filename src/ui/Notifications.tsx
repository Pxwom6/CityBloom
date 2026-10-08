import { dateOf, formatDate } from '../sim/time';
import { useGameUpdates } from './hooks';
import { IconBell } from './icons';

const RANK = { bad: 0, info: 1, ok: 2 } as const;
/** A heading over each group (P26): problems, news, good news. */
const GROUP = { bad: 'Problems', info: 'News', ok: 'Good news' } as const;

/** Notification log: problems first, then news; click one to fly there. */
export function NotificationsPanel() {
  const game = useGameUpdates(500);
  if (game.panel !== 'notifications') return null;
  const now = performance.now();
  // Prioritised: recent problems first, then everything else by time.
  const list = [...game.notifications].sort((a, b) => {
    const ra = a.tone === 'bad' && now - a.time < 120_000 ? 0 : 1 + RANK[a.tone];
    const rb = b.tone === 'bad' && now - b.time < 120_000 ? 0 : 1 + RANK[b.tone];
    return ra - rb || b.time - a.time;
  });
  return (
    <aside class="advisors notifications panel" data-testid="notifications">
      <header>
        <h2>Notifications</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('notifications')}>
          ×
        </button>
      </header>
      <div class="advisors-list">
        {list.length === 0 && <div class="muted">Nothing to report yet.</div>}
        {list.map((n, i) => [
          i === 0 || list[i - 1]!.tone !== n.tone ? (
            <h3 key={`h-${n.tone}`} class="notice-group" data-testid={`notice-group-${n.tone}`}>
              {GROUP[n.tone]}
            </h3>
          ) : null,
          <button
            key={n.id}
            class={`notice ${n.tone}`}
            data-testid="notice"
            disabled={!n.at}
            onClick={() => n.at && game.flyTo(n.at)}
          >
            <span class="notice-text">
              {n.text}
              {n.count > 1 ? ` (×${n.count})` : ''}
            </span>
            <span class="notice-time">{formatDate(dateOf(n.tick))}</span>
          </button>,
        ])}
      </div>
    </aside>
  );
}

export function NotificationsButton() {
  const game = useGameUpdates(500);
  const now = performance.now();
  const recent = game.notifications.filter((n) => n.tone === 'bad' && now - n.time < 120_000).length;
  return (
    <button
      class={`btn icon bell ${game.panel === 'notifications' ? 'active' : ''}`}
      data-testid="open-notifications"
      title="Notifications (N)"
      aria-label="Notifications"
      onClick={() => game.openPanel('notifications')}
    >
      <IconBell />
      {recent > 0 && <span class="badge urgent">{recent}</span>}
    </button>
  );
}
