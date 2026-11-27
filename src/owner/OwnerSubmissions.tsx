/**
 * The owner area's submissions (M48): every idea and building players sent, newest first, by kind and
 * status. An idea shows its words and its picture; a building its turntable (by day and by night) and
 * the game's check run here in the browser (the relay only checks a model at a glance). Mark one seen,
 * accepted or declined with a short reply the player sees; delete; the word filter for credit names;
 * download an accepted building as a GLB with its credit; copy what a Claude Code session needs.
 */
import { UNTRUSTED_NOTE, fenced } from './untrusted';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { OwnerApi, SubmissionItem, SubmissionRow, SubmissionUsage } from './api';
import { localWhen } from './time';
import type { SubmissionStatus } from '../../relay/submissions';
import { CIVIC } from '../data/civic';
import { cleanTarget } from '../client/myBuildings';
import { checkModelFile } from '../client/modelCheck';
import { targetId, targetLabel, type CustomTarget } from '../models/customCheck';
import { teacherNotes, type TeacherNote } from '../models/workshop';
import { assets } from '../render/assets/registry';
import { ModelPreview } from '../render/modelPreview';

const STATUS_WORDS: Record<SubmissionStatus, string> = {
  sent: 'New',
  seen: 'Seen',
  accepted: 'Accepted',
  declined: 'Declined',
};
const IDEA_WORDS: Record<string, string> = {
  building: 'a building',
  feature: 'a feature',
  fix: 'a fix',
  scenario: 'a scenario or challenge',
  other: 'something else',
};

const when = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const slug = (s: string) =>
  s
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'x';

function targetOf(row: { kind: string; about: string }): CustomTarget | null {
  if (row.kind !== 'building') return null;
  try {
    return cleanTarget(JSON.parse(row.about));
  } catch {
    return null;
  }
}

function bytesOf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The file name an accepted building downloads as: its name and its credit. */
export function glbName(row: { title: string; credit: string }): string {
  return `${slug(row.title)}-by-${slug(row.credit || 'a player')}.glb`;
}

/** What a Claude Code session needs to bring an accepted submission in. */
export function submissionForClaude(row: SubmissionRow, notes: TeacherNote[] | null = null): string {
  // Everything a player wrote goes in fenced, labelled blocks (DECISIONS "M48": a paste must not carry
  // a player's instructions); what the owner wrote and the game's own facts stay outside them.
  const credit = row.credit ? fenced('Credit', row.credit) : 'Credit: a player (no name given)';
  if (row.kind === 'idea')
    return [
      UNTRUSTED_NOTE,
      `A player's idea, accepted for Citybloom (submission #${row.id}, ${when(row.decided ?? row.at)} UTC): ${IDEA_WORDS[row.about] ?? row.about}.`,
      fenced('Title', row.title),
      fenced('In full', row.text),
      credit,
      "Add the credit to CREDITS.md when it's built.",
      row.reply ? `My reply to them: ${row.reply}` : '',
      row.file ? '(A picture of the game came with it: it is in the owner area.)' : '',
    ]
      .filter(Boolean)
      .join('\n');
  const t = targetOf(row);
  const where =
    t?.kind === 'look'
      ? `assets/models/${targetId(t)}.glb (a new look for the ${CIVIC.get(t.def)?.name.toLowerCase() ?? t.def})`
      : `assets/models/ under the name of the building it becomes (it was made as ${t ? targetLabel(t) : 'a landmark'}: choose which of the game's landmarks or a new civic building)`;
  return [
    UNTRUSTED_NOTE,
    `A player's building, accepted for Citybloom (submission #${row.id}, ${when(row.decided ?? row.at)} UTC).`,
    fenced('Name', row.title),
    `What it's for: ${t ? targetLabel(t) : 'a landmark'}`,
    row.text ? fenced('A line about it', row.text) : '',
    credit,
    'Add it to CREDITS.md as "<name> by <credit>" (or "by a player" with no credit).',
    `The model: ${glbName(row)} (download it from the owner area), ${Math.round(row.bytes / 1024)} kB, hash ${row.hash}.`,
    `Where it goes: ${where}.`,
    'Bring it in through the normal pipeline: `npm run models:check`, look at it with scripts/dev/modelshot.mjs, then a pull request. Nothing goes in automatically.',
    notes
      ? notes.length
        ? `The game's check in the owner area found: ${notes.map((n) => n.title).join('; ')}.`
        : "The game's check in the owner area passed it."
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function OwnerSubmissions(props: { api: OwnerApi; note: (t: string) => void }) {
  const { api, note } = props;
  const [kind, setKind] = useState<'all' | 'idea' | 'building'>('all');
  const [status, setStatus] = useState<SubmissionStatus | 'all'>('all');
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [usage, setUsage] = useState<SubmissionUsage | null>(null);
  const [words, setWords] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api.submissions(kind, status).then(
      (r) => {
        setRows(r.submissions);
        setUsage(r.usage);
        setWords(r.words.join('\n'));
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  useEffect(() => {
    void load();
  }, [kind, status]);
  return (
    <section class="owner-submissions" data-testid="owner-submissions">
      <div class="owner-filters">
        <label>
          Kind{' '}
          <select
            value={kind}
            data-testid="owner-sub-kind"
            onChange={(e) => setKind(e.currentTarget.value as typeof kind)}
          >
            <option value="all">All</option>
            <option value="idea">Ideas</option>
            <option value="building">Buildings</option>
          </select>
        </label>
        <label>
          Status{' '}
          <select
            value={status}
            data-testid="owner-sub-status"
            onChange={(e) => setStatus(e.currentTarget.value as typeof status)}
          >
            <option value="all">All</option>
            {(Object.keys(STATUS_WORDS) as SubmissionStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_WORDS[s]}
              </option>
            ))}
          </select>
        </label>
        {usage && (
          <span class="muted" data-testid="owner-sub-usage">
            {usage.kept} kept ({Math.round(usage.bytes / 1024)} kB), {usage.rowsToday} of {usage.rowsPerDay}{' '}
            rows today
          </span>
        )}
      </div>
      {error && <p class="owner-error">{error}</p>}
      {!rows.length && !error && <p class="muted">Nothing here.</p>}
      <ul class="owner-list">
        {rows.map((r) => (
          <li key={r.id} class={`owner-entry ${r.status}`} data-testid={`owner-sub-${r.id}`}>
            <button
              class="owner-entry-line owner-sub-line"
              onClick={() => setOpen(open === r.id ? null : r.id)}
            >
              <b>{r.title}</b>
              <span class="muted">
                {r.kind === 'idea' ? `idea: ${IDEA_WORDS[r.about] ?? r.about}` : 'building'} ·{' '}
                {r.credit || 'no name'} · {localWhen(r.at)}
              </span>
              <span class="owner-badge">{STATUS_WORDS[r.status]}</span>
            </button>
            {open === r.id && <Detail api={api} row={r} note={note} reload={() => void load()} />}
          </li>
        ))}
      </ul>
      <details class="owner-words">
        <summary>Word filter for credit names</summary>
        <textarea
          rows={4}
          value={words}
          data-testid="owner-sub-words"
          onInput={(e) => setWords(e.currentTarget.value)}
        />
        <button
          class="owner-btn"
          data-testid="owner-sub-words-save"
          onClick={() =>
            void api.setSubmissionWords(words.split(/\s+/).filter(Boolean)).then(
              (r) => {
                setWords(r.words.join('\n'));
                note('Words saved');
              },
              (e: Error) => note(e.message),
            )
          }
        >
          Save words
        </button>
      </details>
    </section>
  );
}

function Detail(props: { api: OwnerApi; row: SubmissionRow; note: (t: string) => void; reload: () => void }) {
  const { api, row, note } = props;
  const [item, setItem] = useState<SubmissionItem | null>(null);
  const [reply, setReply] = useState(row.reply);
  const [notes, setNotes] = useState<TeacherNote[] | null>(null);
  const [baked, setBaked] = useState<Awaited<ReturnType<typeof checkModelFile>>['result']['baked']>(null);
  const [night, setNight] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const preview = useRef<ModelPreview | null>(null);
  const target = targetOf(row);
  useEffect(() => {
    let live = true;
    void api.submission(row.id).then(
      async (it) => {
        if (!live) return;
        setItem(it);
        // A building: the game's own check, here in the browser.
        if (it.kind === 'building' && it.data && target) {
          const { result } = await checkModelFile(bytesOf(it.data), target);
          if (!live) return;
          setNotes(teacherNotes(result.problems, result.site));
          setBaked(result.baked);
        }
      },
      (e: Error) => note(e.message),
    );
    return () => {
      live = false;
    };
  }, [row.id]);
  useEffect(() => {
    if (!canvas.current || !baked || !target || !row.hash) return;
    preview.current = new ModelPreview(canvas.current);
    preview.current.show(assets.civicLook(targetId(target), 0, row.hash, baked));
    preview.current.start();
    return () => {
      preview.current?.dispose();
      preview.current = null;
    };
  }, [baked]);
  useEffect(() => {
    preview.current?.setLook({ night, season: 'summer' });
  }, [night, baked]);
  const decide = (s: SubmissionStatus) =>
    void api.decide(row.id, s, reply).then(
      () => {
        note(`Marked ${STATUS_WORDS[s].toLowerCase()}`);
        props.reload();
      },
      (e: Error) => note(e.message),
    );
  const copy = () => {
    const text = submissionForClaude({ ...row, reply }, notes);
    void navigator.clipboard?.writeText(text).then(
      () => note('Copied for Claude Code'),
      () => note('Couldn’t copy: select the text instead'),
    );
  };
  const download = () => {
    if (!item?.data) return;
    const url = URL.createObjectURL(
      new Blob([bytesOf(item.data).slice().buffer], { type: 'model/gltf-binary' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = glbName(row);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };
  return (
    <div class="owner-detail" data-testid="owner-sub-detail">
      {row.kind === 'idea' ? (
        <>
          <p class="owner-text" data-testid="owner-sub-text">
            {row.text}
          </p>
          {item?.data && (
            <img
              class="owner-shot"
              src={`data:image/jpeg;base64,${item.data}`}
              alt="The picture of the game that came with it"
              data-testid="owner-sub-shot"
            />
          )}
        </>
      ) : (
        <>
          <p>
            {target ? targetLabel(target) : row.about} · {Math.round(row.bytes / 1024)} kB ·{' '}
            {row.text || 'no line'}
          </p>
          <canvas ref={canvas} class="owner-turntable" data-testid="owner-sub-preview" />
          <div class="owner-actions">
            <button
              class={`owner-tab ${night ? '' : 'on'}`}
              data-testid="owner-sub-day"
              onClick={() => setNight(false)}
            >
              Day
            </button>
            <button
              class={`owner-tab ${night ? 'on' : ''}`}
              data-testid="owner-sub-night"
              onClick={() => setNight(true)}
            >
              Night
            </button>
          </div>
          {notes === null ? (
            <p class="muted">Checking…</p>
          ) : notes.length ? (
            <ul data-testid="owner-sub-check">
              {notes.map((n, i) => (
                <li key={i}>
                  <b>{n.title}</b>: {n.words}
                </li>
              ))}
            </ul>
          ) : (
            <p data-testid="owner-sub-check">✓ It passes the game's check.</p>
          )}
        </>
      )}
      <label class="owner-reply">
        A reply the player sees (optional)
        <input
          type="text"
          maxLength={300}
          value={reply}
          data-testid="owner-sub-reply"
          onInput={(e) => setReply(e.currentTarget.value)}
        />
      </label>
      <div class="owner-actions">
        <button class="owner-btn" data-testid="owner-sub-seen" onClick={() => decide('seen')}>
          Seen
        </button>
        <button class="owner-btn primary" data-testid="owner-sub-accept" onClick={() => decide('accepted')}>
          Accept
        </button>
        <button class="owner-btn" data-testid="owner-sub-decline" onClick={() => decide('declined')}>
          Decline
        </button>
        <button class="owner-btn" data-testid="owner-sub-copy" onClick={copy}>
          Copy for Claude Code
        </button>
        {row.kind === 'building' && (
          <button
            class="owner-btn"
            data-testid="owner-sub-download"
            disabled={!item?.data}
            onClick={download}
          >
            Download GLB
          </button>
        )}
        <button
          class="owner-btn danger"
          data-testid="owner-sub-delete"
          onClick={() =>
            void api.deleteSubmission(row.id).then(
              () => {
                note('Deleted');
                props.reload();
              },
              (e: Error) => note(e.message),
            )
          }
        >
          Delete
        </button>
      </div>
    </div>
  );
}
