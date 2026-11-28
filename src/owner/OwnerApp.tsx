/**
 * The owner area (phase 6): the owner's own page, linked from nowhere in the game. Signed in with
 * OWNER_KEY, which the relay checks on every request; kept on this device until signing out. M41's
 * problem reports live here, and M44's weekly challenge board; later milestones add their tabs.
 * Laid out for a phone first.
 */
import { useEffect, useState } from 'preact/hooks';
import { OwnerApi, groupForClaude, type Usage } from './api';
import { localDay } from './time';
import { OwnerChallenge } from './OwnerChallenge';
import { OwnerSubmissions } from './OwnerSubmissions';
import type { GroupStatus, GroupView, ItemFull } from '../../relay/reportDesk';

const KEY = 'citybloom.ownerKey';

function storedKey(): string {
  try {
    return localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * The key kept for this visit only, or on this device when asked (the site's address is shared with
 * the game, so it isn't kept for good unless the owner wants it).
 */
function storeKey(key: string | null, remember = false): void {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (key) (remember ? localStorage : sessionStorage).setItem(KEY, key);
  } catch {
    /* private mode: signed in for this visit only */
  }
}

function localStorageKey(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

const KIND_NAMES: Record<string, string> = {
  error: 'Error',
  worker: 'Sim worker',
  battle: 'Battle worker',
  save: 'Save failed',
  load: 'Load failed',
  model: 'Models',
  desync: 'Desync',
  user: 'Written report',
};

function download(name: string, text: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // An older phone browser: a text box to select from.
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  }
}

function SignIn(props: {
  onKey: (k: string, remember: boolean) => void;
  error: string | null;
  busy: boolean;
}) {
  const [key, setKey] = useState('');
  const [remember, setRemember] = useState(false);
  return (
    <form
      class="owner-card owner-signin"
      data-testid="owner-signin"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) props.onKey(key.trim(), remember);
      }}
    >
      <h2>Sign in</h2>
      <p class="muted">Your owner key (OWNER_KEY).</p>
      <input
        type="password"
        autocomplete="current-password"
        data-testid="owner-key"
        value={key}
        placeholder="Owner key"
        onInput={(e) => setKey((e.target as HTMLInputElement).value)}
      />
      <label class="owner-remember">
        <input
          type="checkbox"
          checked={remember}
          data-testid="owner-remember"
          onChange={(e) => setRemember((e.target as HTMLInputElement).checked)}
        />
        Keep me signed in on this device
      </label>
      {props.error && (
        <p class="owner-error" data-testid="owner-error">
          {props.error}
        </p>
      )}
      <button class="owner-btn primary" type="submit" data-testid="owner-signin-go" disabled={props.busy}>
        {props.busy ? 'Checking…' : 'Sign in'}
      </button>
    </form>
  );
}

function Group(props: { g: GroupView; api: OwnerApi; changed: () => void; note: (t: string) => void }) {
  const { g, api } = props;
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Record<number, ItemFull>>({});
  const loadItem = async (id: number): Promise<ItemFull> => {
    const it = details[id] ?? (await api.item(id));
    setDetails((d) => ({ ...d, [id]: it }));
    return it;
  };
  const act = async (action: 'fixed' | 'open' | 'delete') => {
    if (action === 'delete' && !confirm('Delete this entry and everything kept with it?')) return;
    try {
      await api.setGroup(g.key, action);
      props.note(action === 'fixed' ? 'Marked fixed.' : action === 'open' ? 'Opened again.' : 'Deleted.');
      props.changed();
    } catch (e) {
      props.note(e instanceof Error ? e.message : String(e));
    }
  };
  const copyIt = async () => {
    // A desync's replays are fetched first, so the text says where each starts.
    const full = g.kind === 'desync' ? await Promise.all(g.items.slice(0, 3).map((i) => loadItem(i.id))) : [];
    props.note((await copy(groupForClaude(g, full))) ? 'Copied for Claude Code.' : 'Couldn’t copy.');
  };
  return (
    <li class={`owner-group ${g.status}`} data-testid="owner-group" data-kind={g.kind} data-status={g.status}>
      <button class="owner-group-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span class={`owner-kind kind-${g.kind}`}>{KIND_NAMES[g.kind] ?? g.kind}</span>
        <span class="owner-msg" data-testid="owner-group-message">
          {g.kind === 'user' ? (g.items[0]?.note ?? '(a picture)') : g.message}
        </span>
        <span class="owner-count" data-testid="owner-group-count" title="Times seen">
          ×{g.count}
        </span>
        <span class="owner-meta">
          {ago(g.last)} · since {localDay(g.first)} ·{' '}
          {g.builds
            .slice(0, 2)
            .map((b) => b.build)
            .join(', ')}
          {g.builds.length > 2 ? '…' : ''} · {g.browsers[0]?.browser ?? ''}
          {g.status === 'fixed' ? ' · fixed' : g.reopened ? ' · came back' : ''}
        </span>
      </button>
      {open && (
        <div class="owner-group-body" data-testid="owner-group-body">
          {g.stack && <pre class="owner-stack">{g.stack}</pre>}
          <dl class="owner-facts">
            <dt>Seen</dt>
            <dd>
              {g.count} {g.count === 1 ? 'time' : 'times'}, first {localDay(g.first)}, last {ago(g.last)}
            </dd>
            <dt>Versions</dt>
            <dd>{g.builds.map((b) => `${b.build} ×${b.count}`).join(' · ')}</dd>
            <dt>Browsers</dt>
            <dd>{g.browsers.map((b) => `${b.browser} ×${b.count}`).join(' · ')}</dd>
            <dt>Latest</dt>
            <dd>
              graphics {g.env.quality}, save v{g.env.save}, shared: {g.env.shared}, {g.env.where}
            </dd>
          </dl>
          {g.items.length > 0 && (
            <ul class="owner-items">
              {g.items.map((i) => {
                const d = details[i.id];
                return (
                  <li key={i.id} data-testid="owner-item">
                    <span class="muted">{ago(i.at)}</span>
                    {i.note && <p class="owner-note">{i.note}</p>}
                    {i.summary && (
                      <p class="owner-note" data-testid="owner-item-summary">
                        {i.summary}
                      </p>
                    )}
                    {i.shot &&
                      (d?.report.shot ? (
                        <img
                          class="owner-shot"
                          src={d.report.shot}
                          alt="The player's picture of the game"
                          data-testid="owner-shot"
                        />
                      ) : (
                        <button
                          class="owner-btn"
                          data-testid="owner-show-shot"
                          onClick={() => void loadItem(i.id)}
                        >
                          Show picture
                        </button>
                      ))}
                    {(i.replay || g.kind === 'desync') && (
                      <button
                        class="owner-btn"
                        data-testid="owner-download"
                        onClick={async () => {
                          const it = await loadItem(i.id);
                          download(`citybloom-desync-${i.id}.json`, JSON.stringify(it.report, null, 1));
                        }}
                      >
                        Download replay
                      </button>
                    )}
                    <button
                      class="owner-btn quiet"
                      onClick={async () => {
                        await api.deleteItem(i.id);
                        props.changed();
                      }}
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {g.dropped > 0 && <p class="muted">{g.dropped} more weren’t kept (the desk was full).</p>}
          <div class="owner-actions">
            {g.status === 'open' ? (
              <button class="owner-btn primary" data-testid="owner-fixed" onClick={() => void act('fixed')}>
                Mark fixed
              </button>
            ) : (
              <button class="owner-btn" data-testid="owner-reopen" onClick={() => void act('open')}>
                Reopen
              </button>
            )}
            <button class="owner-btn" data-testid="owner-copy" onClick={() => void copyIt()}>
              Copy for Claude Code
            </button>
            <button class="owner-btn quiet" data-testid="owner-delete" onClick={() => void act('delete')}>
              Delete
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Reports(props: { api: OwnerApi; note: (t: string) => void }) {
  const [status, setStatus] = useState<GroupStatus | 'all'>('open');
  const [groups, setGroups] = useState<GroupView[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    props.api.reports(status).then(
      (r) => {
        setGroups(r.groups);
        setUsage(r.usage);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  useEffect(() => {
    void load();
  }, [status]);
  return (
    <section data-testid="owner-reports">
      <div class="owner-filter" role="tablist">
        {(['open', 'fixed', 'all'] as const).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={status === s}
            class={`owner-tab ${status === s ? 'on' : ''}`}
            data-testid={`owner-filter-${s}`}
            onClick={() => setStatus(s)}
          >
            {s === 'open' ? 'Open' : s === 'fixed' ? 'Fixed' : 'All'}
          </button>
        ))}
        <button class="owner-btn quiet" data-testid="owner-refresh" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {error && <p class="owner-error">{error}</p>}
      {groups === null && !error && <p class="muted">Loading…</p>}
      {groups?.length === 0 && (
        <p class="muted" data-testid="owner-empty">
          Nothing here{status === 'open' ? ': no open problems' : ''}.
        </p>
      )}
      <ul class="owner-list">
        {groups?.map((g) => (
          <Group key={g.key} g={g} api={props.api} changed={() => void load()} note={props.note} />
        ))}
      </ul>
      {usage && (
        <p class="owner-usage muted" data-testid="owner-usage">
          Kept: {usage.groups} of {usage.limits.maxGroups} entries · {usage.items} of {usage.limits.maxItems}{' '}
          reports and replays ({(usage.bytes / 1e6).toFixed(1)} of {usage.limits.itemBytes / 1e6} MB) ·{' '}
          {usage.rowsToday} of {usage.limits.rowsPerDay} rows written today · deleted {usage.limits.keepDays}{' '}
          days after last seen
        </p>
      )}
    </section>
  );
}

export function OwnerApp(props: { base: string | null }) {
  const [key, setKey] = useState(storedKey);
  const [state, setState] = useState<'checking' | 'unset' | 'signin' | 'in' | 'norelay' | 'offline'>(
    props.base ? 'checking' : 'norelay',
  );
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [section, setSection] = useState<'reports' | 'challenge' | 'submissions'>('reports');
  const api = props.base ? new OwnerApi(props.base, key) : null;
  const check = async (k: string, remember = !!localStorageKey()) => {
    if (!props.base) return;
    setState('checking');
    try {
      const s = await new OwnerApi(props.base, k).status();
      if (!s.setUp) return setState('unset');
      if (s.ok) {
        storeKey(k, remember);
        setKey(k);
        setError(null);
        return setState('in');
      }
      setError(k ? (s.busy ? 'Too many wrong keys: wait a minute.' : 'That isn’t the owner key.') : null);
      setState('signin');
    } catch {
      setState('offline');
    }
  };
  useEffect(() => {
    void check(key);
  }, []);
  const note = (t: string) => {
    setToast(t);
    setTimeout(() => setToast((x) => (x === t ? null : x)), 3000);
  };
  return (
    <div class="owner" data-testid="owner-area" data-state={state}>
      <header class="owner-top">
        <h1>Citybloom · owner area</h1>
        {state === 'in' && (
          <button
            class="owner-btn quiet"
            data-testid="owner-signout"
            onClick={() => {
              storeKey(null);
              setKey('');
              setState('signin');
            }}
          >
            Sign out
          </button>
        )}
      </header>
      {state === 'norelay' && (
        <p class="owner-card" data-testid="owner-norelay">
          This copy of the game has no online relay, so it has no owner area.
        </p>
      )}
      {state === 'unset' && (
        <p class="owner-card" data-testid="owner-unset">
          The owner area isn’t set up yet: it needs an owner key (OWNER_KEY), stored as a GitHub secret and
          passed to the relay when it deploys. PROGRESS.md says how.
        </p>
      )}
      {state === 'offline' && (
        <div class="owner-card" data-testid="owner-offline">
          <p>The relay can’t be reached right now.</p>
          <button class="owner-btn" onClick={() => void check(key)}>
            Try again
          </button>
        </div>
      )}
      {state === 'checking' && <p class="muted owner-card">Checking…</p>}
      {state === 'signin' && (
        <SignIn onKey={(k, remember) => void check(k, remember)} error={error} busy={false} />
      )}
      {state === 'in' && api && (
        <main>
          <nav class="owner-sections" role="tablist">
            {(
              [
                ['reports', 'Problem reports'],
                ['challenge', 'Weekly challenge'],
                ['submissions', 'Submissions'],
              ] as const
            ).map(([t, label]) => (
              <button
                key={t}
                role="tab"
                aria-selected={section === t}
                class={`owner-tab ${section === t ? 'on' : ''}`}
                data-testid={`owner-section-${t}`}
                onClick={() => setSection(t)}
              >
                {label}
              </button>
            ))}
          </nav>
          {section === 'reports' && <Reports api={api} note={note} />}
          {section === 'challenge' && <OwnerChallenge api={api} note={note} />}
          {section === 'submissions' && <OwnerSubmissions api={api} note={note} />}
        </main>
      )}
      {toast && (
        <div class="owner-toast" data-testid="owner-toast">
          {toast}
        </div>
      )}
    </div>
  );
}
