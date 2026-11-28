/**
 * Send it in (M48): an idea (a kind, a title, a few words, a picture of the game if they like) or a
 * building of the player's own (from My buildings), with an optional name to be credited as. Before it
 * goes the player sees exactly what will be sent, and that only the game's maker sees it unless it's
 * picked. Then their submissions with the status of each, and the ideas and buildings accepted so far.
 */
import { useEffect, useState } from 'preact/hooks';
import type { AcceptedRow, IdeaKind, MineRow } from '../../relay/submissions';
import { IDEA_KINDS, SUBMIT_LIMITS } from '../../relay/submissions';
import { IDEA_KIND_WORDS, STATUS_WORDS } from '../client/submissions';
import { targetLabel } from '../models/customCheck';
import { useGameUpdates } from './hooks';

type Tab = 'send' | 'mine' | 'accepted';

const WHEN = (t: number) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function SubmitScreen() {
  const game = useGameUpdates(500);
  const [tab, setTab] = useState<Tab>(game.submitDraft.tab);
  return (
    <div class="shell-card panel submit-screen" data-testid="submit-screen">
      <header>
        <h2>Send it in</h2>
        <span class="muted">
          Ideas and buildings for the game. Only its maker sees them, unless one is picked.
        </span>
      </header>
      <div class="workshop-tabs" role="tablist">
        {(
          [
            ['send', 'Send'],
            ['mine', 'What I sent'],
            ['accepted', 'Accepted ideas'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            class={`btn ${tab === id ? 'active' : ''}`}
            aria-selected={tab === id}
            data-testid={`submit-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {!game.submissions.online && (
        <p class="warn" data-testid="submit-offline">
          Sending needs the internet: this copy of the game can't reach its server.
        </p>
      )}
      {tab === 'send' && <SendTab onSent={() => setTab('mine')} />}
      {tab === 'mine' && <MineTab />}
      {tab === 'accepted' && <AcceptedTab />}
      <footer class="shell-actions">
        <button class="btn" data-testid="submit-close" onClick={() => game.closeScreen()}>
          Close
        </button>
      </footer>
    </div>
  );
}

function SendTab(props: { onSent: () => void }) {
  const game = useGameUpdates(500);
  const mine = game.buildings.list();
  const [kind, setKind] = useState<'idea' | 'building'>(game.submitDraft.building ? 'building' : 'idea');
  const [about, setAbout] = useState<IdeaKind>('feature');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [withShot, setWithShot] = useState(false);
  const [shot, setShot] = useState<string | null>(null);
  const [model, setModel] = useState<string>(game.submitDraft.building ?? mine[0]?.hash ?? '');
  const [line, setLine] = useState('');
  const [credit, setCredit] = useState('');
  const [review, setReview] = useState(false);
  const [sending, setSending] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  // A picture of the game (the 3D view, never the interface), taken once when asked for.
  useEffect(() => {
    if (withShot && !shot) setShot(game.reportShot());
  }, [withShot]);
  const m = mine.find((x) => x.hash === model);
  const ready = kind === 'idea' ? title.trim().length > 0 && text.trim().length > 0 : !!m;
  const send = async () => {
    setSending(true);
    setWhy(null);
    const r =
      kind === 'idea'
        ? await game.submissions.sendIdea({ about, title, text, shot: withShot ? shot : null, credit })
        : await game.submissions.sendBuilding(m!, line, credit);
    setSending(false);
    if (!r.ok) {
      setWhy(r.why);
      return;
    }
    game.toast('Sent: thank you! Its status is under What I sent', 'ok', 4000);
    props.onSent();
  };
  if (review)
    return (
      <section class="submit-review" data-testid="submit-preview">
        <h3>This is exactly what will be sent</h3>
        <dl class="report-lines">
          <dt>What</dt>
          <dd>{kind === 'idea' ? `An idea: ${IDEA_KIND_WORDS[about].toLowerCase()}` : 'A building'}</dd>
          {kind === 'idea' ? (
            <>
              <dt>Title</dt>
              <dd data-testid="submit-preview-title">{title.trim()}</dd>
              <dt>About it</dt>
              <dd class="submit-text">{text.trim()}</dd>
              <dt>Picture of the game</dt>
              <dd>{withShot && shot ? 'yes, below' : 'no'}</dd>
            </>
          ) : (
            <>
              <dt>Model</dt>
              <dd data-testid="submit-preview-title">
                {m!.name}: {targetLabel(m!.target)}, {m!.size.w} × {m!.size.d} m,{' '}
                {(m!.bytes.length / 1024).toFixed(0)} kB
              </dd>
              <dt>A line about it</dt>
              <dd>{line.trim() || '(none)'}</dd>
            </>
          )}
          <dt>Credit me as</dt>
          <dd data-testid="submit-preview-credit">{credit.trim() || '(no name)'}</dd>
          <dt>Nothing else</dt>
          <dd>
            No account, no email, nothing about you or your cities. A private code in this browser lets you
            see what happens to it.
          </dd>
        </dl>
        {kind === 'idea' && withShot && shot && (
          <img class="report-shot" src={shot} alt="The picture of the game that goes with it" />
        )}
        <p class="submit-who" data-testid="submit-who">
          Only the game's maker will see it. If it's picked for the game, its{' '}
          {kind === 'idea' ? 'title' : 'name'} and your credit name show in Accepted ideas for everyone;
          otherwise nobody else ever sees it.
        </p>
        {why && (
          <p class="warn" data-testid="submit-why">
            {why}
          </p>
        )}
        <div class="buildings-actions">
          <button class="btn" data-testid="submit-edit" onClick={() => setReview(false)}>
            Change it
          </button>
          <button
            class="btn primary"
            data-testid="submit-send"
            disabled={sending || !game.submissions.online}
            onClick={() => void send()}
          >
            {sending ? 'Sending…' : 'Send it'}
          </button>
        </div>
      </section>
    );
  return (
    <section class="submit-form" data-testid="submit-form">
      <div class="workshop-choices" role="group" aria-label="What to send">
        <button
          class={`btn ${kind === 'idea' ? 'active' : ''}`}
          aria-pressed={kind === 'idea'}
          data-testid="submit-kind-idea"
          onClick={() => setKind('idea')}
        >
          An idea
        </button>
        <button
          class={`btn ${kind === 'building' ? 'active' : ''}`}
          aria-pressed={kind === 'building'}
          data-testid="submit-kind-building"
          onClick={() => setKind('building')}
        >
          A building
        </button>
      </div>
      {kind === 'idea' ? (
        <>
          <label class="buildings-field">
            <span class="muted">What kind of idea</span>
            <select
              value={about}
              data-testid="submit-about"
              onChange={(e) => setAbout(e.currentTarget.value as IdeaKind)}
            >
              {IDEA_KINDS.map((k) => (
                <option key={k} value={k}>
                  {IDEA_KIND_WORDS[k]}
                </option>
              ))}
            </select>
          </label>
          <label class="buildings-field">
            <span class="muted">A short title</span>
            <input
              type="text"
              maxLength={SUBMIT_LIMITS.titleChars}
              value={title}
              data-testid="submit-title"
              onKeyDown={(e) => e.stopPropagation()}
              onInput={(e) => setTitle(e.currentTarget.value)}
            />
          </label>
          <label class="buildings-field">
            <span class="muted">
              Tell us about it ({SUBMIT_LIMITS.textChars - text.length} characters left)
            </span>
            <textarea
              rows={5}
              maxLength={SUBMIT_LIMITS.textChars}
              value={text}
              data-testid="submit-text"
              onKeyDown={(e) => e.stopPropagation()}
              onInput={(e) => setText(e.currentTarget.value)}
            />
          </label>
          <label class="buildings-setting">
            <input
              type="checkbox"
              checked={withShot}
              data-testid="submit-shot"
              onChange={(e) => setWithShot(e.currentTarget.checked)}
            />
            <span>Add a picture of the game (the 3D view only)</span>
          </label>
          {withShot && shot && (
            <img
              class="report-shot"
              src={shot}
              data-testid="submit-shot-preview"
              alt="The picture that would go with it"
            />
          )}
        </>
      ) : mine.length ? (
        <>
          <label class="buildings-field">
            <span class="muted">Which of your buildings</span>
            <select
              value={model}
              data-testid="submit-model"
              onChange={(e) => setModel(e.currentTarget.value)}
            >
              {mine.map((x) => (
                <option key={x.hash} value={x.hash}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          {m && <p class="muted">{targetLabel(m.target)}: it passed the game's check when you added it.</p>}
          <label class="buildings-field">
            <span class="muted">A line about it</span>
            <input
              type="text"
              maxLength={SUBMIT_LIMITS.lineChars}
              value={line}
              data-testid="submit-line"
              onKeyDown={(e) => e.stopPropagation()}
              onInput={(e) => setLine(e.currentTarget.value)}
            />
          </label>
        </>
      ) : (
        <p class="muted" data-testid="submit-no-buildings">
          Make one in the Workshop (My buildings) first: it's checked there, then it can be sent in.
        </p>
      )}
      <label class="buildings-field">
        <span class="muted">Credit me as (optional: a name to show if it's picked)</span>
        <input
          type="text"
          maxLength={SUBMIT_LIMITS.nameChars}
          value={credit}
          data-testid="submit-credit"
          onKeyDown={(e) => e.stopPropagation()}
          onInput={(e) => setCredit(e.currentTarget.value)}
        />
      </label>
      <div class="buildings-actions">
        <button
          class="btn primary"
          data-testid="submit-review"
          disabled={!ready}
          onClick={() => setReview(true)}
        >
          See what will be sent
        </button>
      </div>
    </section>
  );
}

/** Rows from the server, loaded when the tab opens. */
function useRows<T>(load: () => Promise<T[] | null>): T[] | null | 'offline' {
  const [rows, setRows] = useState<T[] | null | 'offline'>(null);
  useEffect(() => {
    let live = true;
    void load().then((r) => live && setRows(r ?? 'offline'));
    return () => {
      live = false;
    };
  }, []);
  return rows;
}

function MineTab() {
  const game = useGameUpdates(1000);
  const rows = useRows<MineRow>(() => game.submissions.mine());
  if (rows === null) return <p class="muted">Looking…</p>;
  if (rows === 'offline') return <p class="muted">It can't be reached just now: try again later.</p>;
  if (!rows.length)
    return (
      <p class="muted" data-testid="submit-mine-empty">
        Nothing sent from this browser yet.
      </p>
    );
  return (
    <ul class="submit-list" data-testid="submit-mine">
      {rows.map((r) => (
        <li key={r.id} class={`submit-row ${r.status}`} data-testid="submit-mine-row" data-status={r.status}>
          <div>
            <b>{r.title}</b>{' '}
            <span class="muted">
              · {r.kind === 'idea' ? 'idea' : 'building'} · {WHEN(r.at)}
            </span>
          </div>
          <span class="submit-status" data-testid="submit-status">
            {STATUS_WORDS[r.status]}
          </span>
          {r.reply && (
            <p class="submit-reply" data-testid="submit-reply">
              “{r.reply}”
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function AcceptedTab() {
  const game = useGameUpdates(1000);
  const rows = useRows<AcceptedRow>(() => game.submissions.accepted());
  if (rows === null) return <p class="muted">Looking…</p>;
  if (rows === 'offline') return <p class="muted">It can't be reached just now: try again later.</p>;
  if (!rows.length)
    return (
      <p class="muted" data-testid="accepted-empty">
        Nothing yet: be the first!
      </p>
    );
  return (
    <ul class="submit-list" data-testid="accepted-list">
      {rows.map((r) => (
        <li key={r.id} class="submit-row accepted" data-testid="accepted-row">
          <div>
            <b>{r.title}</b>{' '}
            <span class="muted">
              ·{' '}
              {r.kind === 'idea'
                ? (IDEA_KIND_WORDS[r.about as IdeaKind] ?? 'An idea').toLowerCase()
                : 'a building'}
            </span>
          </div>
          <span class="muted">{r.credit ? `from ${r.credit}` : 'from a player'}</span>
        </li>
      ))}
    </ul>
  );
}
