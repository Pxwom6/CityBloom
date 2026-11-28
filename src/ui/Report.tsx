/**
 * "Report a problem" (M41), from the main menu and the pause menu: an optional short message and an
 * optional picture of the game (the 3D view only, never the interface or the rest of the screen). The
 * player sees exactly what will be sent before sending: the game's version, browser, graphics and
 * whether the city is shared, never names, cities or chat. Only the game's maker reads it.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useGame } from './hooks';
import { REPORT_CAPS, type Report } from '../../relay/reports';

const SHARED = { no: 'No', room: 'Yes, in a room', region: 'Yes, in a shared region' } as const;
const WHERE = {
  boot: 'Starting up',
  menu: 'Main menu',
  city: 'In a city',
  editor: 'Map editor',
  visit: 'Visiting a city',
  battle: 'Watching a battle',
} as const;

/** The report's lines as the player reads them before sending. */
export function reportLines(r: Report): [string, string][] {
  return [
    ['Game version', r.env.build],
    ['Browser', `${r.env.browser} on ${r.env.os}`],
    ['Graphics', r.env.quality],
    ['Save version', String(r.env.save)],
    ['Shared city', SHARED[r.env.shared]],
    ['Where', WHERE[r.env.where]],
    ['Your message', r.note ?? '(none)'],
    ['Picture of the game', r.shot ? 'yes, the one above' : 'no'],
  ];
}

export function ReportScreen() {
  const game = useGame();
  const [note, setNote] = useState('');
  const [withShot, setWithShot] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [showSent, setShowSent] = useState(false);
  // The picture is the view as it stands when the screen opens (the menu is drawn over it, not in it).
  useEffect(() => {
    setShot(game.reportShot());
  }, []);
  const report = useMemo(
    () => game.reporter?.preview(note, withShot ? shot : null) ?? null,
    [note, withShot, shot, game.reporter],
  );
  const canSend = !!game.reporter && game.reporter.canSend;
  const send = async () => {
    if (!report || !game.reporter) return;
    setSending(true);
    const r = await game.reporter.send(report);
    setSending(false);
    if (r === 'off') {
      game.toast('Reports can’t be sent from this copy of the game: it has no online relay.', 'bad', 7000);
      return;
    }
    game.toast(
      r === 'sent'
        ? 'Thanks: your report is on its way.'
        : 'You seem to be offline: your report will be sent when you’re back.',
      'ok',
      6000,
    );
    game.closeScreen();
  };
  return (
    <div class="shell-card panel report-screen" data-testid="report-screen">
      <header>
        <h2>Report a problem</h2>
        <span class="muted">Only Citybloom’s maker reads it.</span>
      </header>
      <div class="report-body">
        <label class="field report-note">
          <span>What went wrong? (optional)</span>
          <textarea
            data-testid="report-note"
            maxLength={REPORT_CAPS.note}
            rows={4}
            value={note}
            placeholder="What were you doing, and what happened?"
            onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
          />
          <small class="muted">
            {note.length}/{REPORT_CAPS.note} · please don’t write your name or anything about you
          </small>
        </label>
        <label class="check">
          <input
            type="checkbox"
            checked={withShot}
            disabled={!shot}
            data-testid="report-shot"
            onChange={(e) => setWithShot((e.target as HTMLInputElement).checked)}
          />
          <span>
            Add a picture of the game <small class="muted">the city view only, not your screen</small>
          </span>
        </label>
        {withShot && shot && (
          <img
            class="report-preview"
            src={shot}
            alt="The picture that will be sent"
            data-testid="report-shot-preview"
          />
        )}
        <button class="btn small" data-testid="report-what" onClick={() => setShowSent(!showSent)}>
          {showSent ? 'Hide what will be sent' : 'See what will be sent'}
        </button>
        {showSent && report && (
          <dl class="report-lines" data-testid="report-lines">
            {reportLines(report).map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
            <p class="muted">
              Nothing else: no names, no city names, no chat, no saves. Crash reports sent by themselves are
              switched on and off in Settings → Game.
            </p>
          </dl>
        )}
        {!canSend && (
          <p class="muted" data-testid="report-cant">
            This copy of the game has no online relay, so reports can’t be sent from it.
          </p>
        )}
      </div>
      <footer class="shell-actions">
        <button class="btn" data-testid="report-cancel" onClick={() => game.closeScreen()}>
          Cancel
        </button>
        <button
          class="btn active"
          data-testid="report-send"
          disabled={!canSend || sending || !report || (!note.trim() && !withShot)}
          title={!note.trim() && !withShot ? 'Write a message or add a picture first' : undefined}
          onClick={() => void send()}
        >
          {sending ? 'Sending…' : 'Send report'}
        </button>
      </footer>
    </div>
  );
}
