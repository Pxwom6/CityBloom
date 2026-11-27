/**
 * The owner area's weekly challenge (M44): a week's entries whatever their status (remove one, put
 * one back, watch its run), the challenge played (the generator's, or a pin, with an editor to pin a
 * hand-made one for this week or the next), the word filter for names, and what the board keeps.
 */
import { useEffect, useState } from 'preact/hooks';
import type { OwnerApi, ChallengeWeekView } from './api';

const STATUS_NAMES: Record<string, string> = {
  shown: 'On the board',
  checked: 'Checked by replays',
  disputed: 'In dispute: replays disagree',
  dropped: 'Dropped: a replay didn’t match',
  removed: 'Removed by you',
};

const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 5400) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

export function OwnerChallenge(props: { api: OwnerApi; note: (t: string) => void }) {
  const { api, note } = props;
  const [which, setWhich] = useState<'this' | 'last' | 'next'>('this');
  const [now, setNow] = useState<number | null>(null);
  const [view, setView] = useState<ChallengeWeekView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [words, setWords] = useState('');
  const week = now === null ? undefined : which === 'last' ? now - 1 : which === 'next' ? now + 1 : now;
  const load = () =>
    api.challenge(week).then(
      (v) => {
        setView(v);
        setNow(v.now);
        setDraft(JSON.stringify(v.challenge, null, 1));
        setWords(v.words.join('\n'));
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  useEffect(() => {
    void load();
  }, [which, now]);
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      note(done);
      void load();
    } catch (e) {
      note(e instanceof Error ? e.message : String(e));
    }
  };
  const game = new URL('./', location.href).pathname;
  return (
    <section data-testid="owner-challenge">
      <div class="owner-filter" role="tablist">
        {(
          [
            ['last', 'Last week'],
            ['this', 'This week'],
            ['next', 'Next week'],
          ] as const
        ).map(([w, label]) => (
          <button
            key={w}
            role="tab"
            aria-selected={which === w}
            class={`owner-tab ${which === w ? 'on' : ''}`}
            data-testid={`owner-week-${w}`}
            onClick={() => setWhich(w)}
          >
            {label}
          </button>
        ))}
        <button class="owner-btn quiet" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p class="owner-error">{error}</p>}
      {!view && !error && <p class="muted">Loading…</p>}
      {view && (
        <>
          <div class="owner-card owner-challenge-head">
            <h2 data-testid="owner-challenge-name">
              Week {view.week + 1}: {view.challenge.name}
            </h2>
            <p class="muted">
              {view.pin ? 'Your pinned challenge.' : 'The generator’s challenge.'} {view.challenge.preset} map
              · {view.challenge.twist} · {view.challenge.months} months
            </p>
          </div>
          <h3 class="owner-h3">Entries</h3>
          {view.entries.length === 0 ? (
            <p class="muted" data-testid="owner-challenge-empty">
              No scores posted for this week.
            </p>
          ) : (
            <ul class="owner-list">
              {view.entries.map((e) => (
                <li
                  key={e.id}
                  class={`owner-group owner-entry ${e.status}`}
                  data-testid="owner-entry"
                  data-status={e.status}
                >
                  <div class="owner-entry-line">
                    <span class="owner-count">{e.rank}</span>
                    <span class="owner-msg" data-testid="owner-entry-name">
                      {e.name}
                    </span>
                    <strong>{e.score.toLocaleString('en-US')}</strong>
                  </div>
                  <span class="owner-meta">
                    {STATUS_NAMES[e.status] ?? e.status} · {e.checks} replay
                    {e.checks === 1 ? '' : 's'} agreed · {ago(e.at)}
                    {e.groups.length > 0 && ` · groups ${e.groups.join(', ')}`}
                    {!e.run && ' · run not kept'}
                  </span>
                  <div class="owner-actions">
                    {e.status === 'removed' || e.status === 'dropped' ? (
                      <button
                        class="owner-btn"
                        data-testid="owner-entry-restore"
                        onClick={() => void act(() => api.setEntry(e.id, 'restore'), 'Back on the board.')}
                      >
                        Put back
                      </button>
                    ) : (
                      <button
                        class="owner-btn"
                        data-testid="owner-entry-remove"
                        onClick={() =>
                          void act(() => api.setEntry(e.id, 'remove'), 'Removed from the board.')
                        }
                      >
                        Remove
                      </button>
                    )}
                    {e.run && e.status !== 'removed' && e.status !== 'dropped' && (
                      <a
                        class="owner-btn"
                        href={`${game}?challengeRun=${e.id}`}
                        target="_blank"
                        rel="noopener"
                      >
                        Watch the run
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3 class="owner-h3">Pin a challenge for week {view.week + 1}</h3>
          <p class="muted">
            Edit the challenge below (its name, brief, map seed and preset, months, money, twist, goals and
            the extra), then pin it. It replaces the generator’s for everyone that week; checked as any
            challenge is.
          </p>
          <textarea
            class="owner-json"
            data-testid="owner-pin-json"
            rows={12}
            spellcheck={false}
            value={draft}
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          />
          <div class="owner-actions">
            <button
              class="owner-btn primary"
              data-testid="owner-pin"
              onClick={() => {
                let def: unknown;
                try {
                  def = JSON.parse(draft);
                } catch {
                  note('That isn’t JSON.');
                  return;
                }
                void act(() => api.pin(view.week, def), 'Pinned.');
              }}
            >
              Pin it
            </button>
            {view.pin && (
              <button
                class="owner-btn"
                data-testid="owner-unpin"
                onClick={() => void act(() => api.pin(view.week, null), 'Back to the generator’s.')}
              >
                Take the pin away
              </button>
            )}
          </div>
          <h3 class="owner-h3">Names the board refuses</h3>
          <p class="muted">
            One word a line. A name is refused if it contains one, ignoring case, spaces and punctuation.
          </p>
          <textarea
            class="owner-json"
            data-testid="owner-words"
            rows={5}
            value={words}
            onInput={(e) => setWords((e.target as HTMLTextAreaElement).value)}
          />
          <div class="owner-actions">
            <button
              class="owner-btn"
              data-testid="owner-words-save"
              onClick={() =>
                void act(
                  () =>
                    api.setWords(
                      words
                        .split(/[\n,]/)
                        .map((w) => w.trim())
                        .filter(Boolean),
                    ),
                  'Word filter saved.',
                )
              }
            >
              Save the words
            </button>
          </div>
          <p class="owner-usage muted" data-testid="owner-challenge-usage">
            Kept: {view.usage.entries} entries, {view.usage.runs} runs (
            {(view.usage.runChars / 1e6).toFixed(1)} MB) · {view.usage.rowsToday} of {view.usage.rowsPerDay}{' '}
            rows written today · weeks before last are deleted at each Monday’s change
          </p>
        </>
      )}
    </section>
  );
}
