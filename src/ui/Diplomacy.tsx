/**
 * Diplomacy on the page (M36): the war room's Diplomacy tab (each neighbour's standing, wars and
 * their scores, proposals in and out, treaties in force, the city's reputation and stance), the
 * terms builder, and the card a fallen city's player chooses on. DESIGN.md §3.30.
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DIPLOMACY,
  MIN_MONEY,
  QUARTERS,
  TERM_KINDS,
  TERM_NAMES,
  termProblem,
  type DeclaredScale,
  type Term,
  type TermKind,
} from '../data/diplomacy';
import { PERSONALITY, type Personality } from '../data/war';
import { WEARINESS } from '../data/warEconomy';
import type { Command } from '../sim/commands';
import type { DiplomacySummary } from '../sim/systems/diplomacy';
import { TICKS_PER_HOUR, dateOf, formatDate } from '../sim/time';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';
import { FriendsDiplomacy } from './DiplomacyFriends';

type Neighbour = DiplomacySummary['neighbours'][number];

const hoursLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / TICKS_PER_HOUR));
export const relationWord = (r: number) =>
  r >= 50 ? 'friendly' : r >= 20 ? 'warm' : r > -20 ? 'wary' : r > -50 ? 'cold' : 'hostile';

/** A score from −100 to 100 as a bar that fills left (losing) or right (winning). */
export function ScoreBar({ score, id }: { score: number; id: number }) {
  const w = Math.min(50, Math.abs(score) / 2);
  return (
    <span class="dip-score" data-testid={`dip-score-${id}`} title={`War score ${Math.round(score)}`}>
      <span class="dip-score-mid" />
      <span
        class={`dip-score-fill ${score >= 0 ? 'good' : 'bad'}`}
        style={score >= 0 ? { left: '50%', width: `${w}%` } : { left: `${50 - w}%`, width: `${w}%` }}
      />
    </span>
  );
}

/**
 * War weariness (M38): how tired of war the city is, what it costs, which way it's going, and the
 * lift peace gives. Shown only once a war has worn on the city.
 */
function Weariness({ now }: { now: number }) {
  const game = useGameUpdates(400);
  const w = game.world.stats.war?.economy?.weariness;
  if (!w || (w.value <= 0 && !w.recovery)) return null;
  const pts = (v: number) => Math.round(Math.abs(v) * 100);
  /** Approval points, to a tenth below one. */
  const points = (v: number) => (Math.abs(v) < 0.01 ? (Math.abs(v) * 100).toFixed(1) : String(pts(v)));
  const tone = w.value >= WEARINESS.growthFrom ? 'bad' : 'warn';
  const days = w.recovery ? Math.max(1, Math.ceil((w.recovery.until - now) / (TICKS_PER_HOUR * 24))) : 0;
  return (
    <>
      <p class="war-row" data-testid="dip-weariness">
        <span>
          War weariness <strong data-testid="dip-weariness-value">{pts(w.value)} %</strong>
        </span>
        <span class={`war-bar ${tone}`} title="How tired of war the city’s people are">
          <span style={{ width: `${Math.min(100, w.value * 100)}%` }} />
        </span>
      </p>
      <p class="muted" data-testid="dip-weariness-note">
        {w.cheer < 0 && <>Approval −{points(w.cheer)} points. </>}
        {w.growth < 0 && <>Homes are tired of war and grow less happily. </>}
        {w.perDay > 0
          ? `Rising about ${(w.perDay * 100).toFixed(1)} a day while a war goes on.`
          : w.perDay < 0
            ? `Fading about ${(-w.perDay * 100).toFixed(1)} a day in peace.`
            : ''}
        {w.recovery && (
          <span class="dip-good" data-testid="dip-recovery">
            {' '}
            Peace: approval +{points(w.recovery.cheer)} points, easing away over {days} day
            {days === 1 ? '' : 's'}.
          </span>
        )}
      </p>
    </>
  );
}

/** What the terms builder was opened for: its own terms, an answer, an offer of peace, or terms set. */
type BuilderMode = 'propose' | 'counter' | 'offer' | 'impose';
/** Each opening of the builder starts it afresh. */
let openings = 0;

/** A question or a refusal, shown where the control that caused it is (`at`). */
export interface Asked {
  at: string;
  text: string;
  yes?: string;
  go?: () => void;
}

/** The answer to a control, beside it, scrolled into view when it appears. */
export function Feedback({ at, asked, onClose }: { at: string; asked: Asked | null; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const mine = asked?.at === at ? asked : null;
  const text = mine?.text ?? '';
  useEffect(() => {
    if (text) ref.current?.scrollIntoView?.({ block: 'nearest' });
  }, [text]);
  if (!mine) return null;
  return (
    <div ref={ref}>
      {mine.go ? (
        <div class="dip-confirm" role="alertdialog" data-testid="dip-confirm">
          <p>{mine.text}</p>
          <div class="dip-actions">
            <button
              class="btn danger"
              data-testid="dip-confirm-yes"
              onClick={() => {
                onClose();
                mine.go!();
              }}
            >
              {mine.yes}
            </button>
            <button class="btn" data-testid="dip-confirm-no" onClick={onClose}>
              Keep the city’s word
            </button>
          </div>
        </div>
      ) : (
        <p class="dip-why" role="alert" data-testid="dip-why">
          {mine.text}
        </p>
      )}
    </div>
  );
}

/** The war room's Diplomacy tab. */
export function Diplomacy() {
  const game = useGameUpdates(400);
  const d = game.world.stats.war?.diplomacy;
  const [builder, setBuilder] = useState<{
    to: number;
    terms: Term[];
    counters?: number;
    mode: BuilderMode;
    n: number;
  } | null>(null);
  const [declaring, setDeclaring] = useState<number | null>(null);
  const [asked, setAsked] = useState<Asked | null>(null);
  if (!d) return null;
  const now = game.world.displayTick;
  /**
   * Send a command; one a pact stands in the way of is asked about first. The answer shows at `at`;
   * `after` runs once the command (or, asked, the command sent anyway) went through.
   */
  const run = async (
    cmd: Command,
    at: string,
    { yes = 'Break it', after }: { yes?: string; after?: () => void } = {},
  ): Promise<boolean> => {
    const r = await game.dispatch(cmd);
    if (!r.ok && r.info?.breaks) {
      setAsked({
        at,
        text: `${r.reason}. Your reputation will suffer, and its allies will turn against the city.`,
        yes,
        go: () => void run({ ...cmd, breakPact: true } as Command, at, { yes, after }),
      });
      return false;
    }
    setAsked(r.ok ? null : { at, text: r.reason });
    if (r.ok) after?.();
    return r.ok;
  };
  const open = (to: number, terms: Term[], mode: BuilderMode, counters?: number) => {
    setAsked(null);
    setBuilder({ to, terms, mode, n: ++openings, ...(counters !== undefined ? { counters } : {}) });
  };
  const feedback = (at: string) => <Feedback at={at} asked={asked} onClose={() => setAsked(null)} />;
  const name = (id: number) => d.neighbours.find((n) => n.id === id)?.name ?? 'A neighbour';
  const incoming = d.proposals.filter((p) => p.from === 'them');
  const outgoing = d.proposals.filter((p) => p.from === 'us');
  return (
    <div class="dip" data-testid="war-diplomacy-body">
      <section class="dip-standing" data-testid="dip-standing">
        <p class="war-row">
          <span>
            Reputation <strong data-testid="dip-reputation">{d.reputation}</strong>
            <small class="muted"> of 100</small>
          </span>
          <span class="war-bar" title="How far other cities trust the city’s word">
            <span style={{ width: `${d.reputation}%` }} />
          </span>
        </p>
        <Weariness now={now} />
        {d.vassal && !d.vassal.friend && (
          <p class="dip-vassal" data-testid="dip-vassal">
            The city is {d.vassal.name}’s vassal: a fifth of its taxes go to {d.vassal.name}, and it may go to
            war only to rise against it. Strength {formatNumber(d.vassal.strength)} of the{' '}
            {formatNumber(d.vassal.need)} a rising needs.
          </p>
        )}
        <p class="war-row">
          <span class="muted">
            {d.neutral
              ? 'Neutral: no wars, no raids of the city’s own; friends may not raid it, neighbours seldom do.'
              : d.leaving !== null
                ? `Leaving neutrality: the city may strike in ${hoursLeft(d.leaving, now)} hours.`
                : d.allowed
                  ? `Up to ${d.allowed === 'total' ? 'total war' : d.allowed === 'war' ? 'war' : 'skirmishes'} allowed.`
                  : 'War is off.'}
          </span>
          <button
            class="btn"
            data-testid="dip-neutral"
            onClick={() => void run({ type: 'setNeutral', on: !d.neutral }, 'standing')}
          >
            {d.neutral ? 'Leave neutrality' : 'Stand neutral'}
          </button>
        </p>
        {feedback('standing')}
      </section>

      <FriendsDiplomacy d={d} />

      {d.wars.some((w) => !w.friend) && (
        <section data-testid="dip-wars">
          <h4>Wars</h4>
          {d.wars
            .filter((w) => !w.friend)
            .map((w) => (
              <div key={w.id} class="dip-war" data-testid={`dip-war-${w.with}`}>
                <p class="war-row">
                  <strong>
                    {w.rebellion ? 'Rising against' : w.scale === 'total' ? 'Total war with' : 'War with'}{' '}
                    {w.name}
                  </strong>
                  <ScoreBar score={w.score} id={w.with} />
                </p>
                <p class="muted">
                  {w.by === 'us' ? 'Declared by the city' : `Declared by ${w.name}`}: “{w.reason}”.{' '}
                  {now < w.opens
                    ? `It opens in ${hoursLeft(w.opens, now)} hours.`
                    : `Score ${Math.round(w.score)} after ${w.battles} battle${w.battles === 1 ? '' : 's'}.`}
                  {w.ceasefire !== null && ` Ceasefire for ${hoursLeft(w.ceasefire, now)} more hours.`}
                  {w.helpers.length > 0 &&
                    ` ${w.helpers.join(' and ')} fight${w.helpers.length === 1 ? 's' : ''} at the city’s side.`}
                </p>
                {w.hold && (
                  <p class={w.hold.by === 'us' ? 'dip-good' : 'dip-bad'} data-testid={`dip-hold-${w.with}`}>
                    {w.hold.by === 'us'
                      ? `The city holds ${w.name}’s seat of power: it falls in ${hoursLeft(w.hold.falls, now)} hours.`
                      : `${w.name} holds the city’s HQ: win a battle within ${hoursLeft(w.hold.falls, now)} hours or the city falls.`}
                  </p>
                )}
                {w.capitulated?.by === 'them' && (
                  <p class="dip-good">
                    {w.name} has capitulated. Set the terms within {hoursLeft(w.capitulated.until, now)}{' '}
                    hours, or peace with reparations stands.{' '}
                    <button
                      class="btn primary"
                      data-testid={`dip-impose-${w.with}`}
                      onClick={() => open(w.with, [{ k: 'peace' }], 'impose')}
                    >
                      Set terms
                    </button>
                  </p>
                )}
                {!w.capitulated && now >= w.opens && (
                  <div class="dip-actions">
                    <button
                      class="btn"
                      data-testid={`dip-peace-${w.with}`}
                      onClick={() => open(w.with, [{ k: 'peace' }], 'offer')}
                    >
                      Offer terms
                    </button>
                  </div>
                )}
              </div>
            ))}
        </section>
      )}

      {incoming.length > 0 && (
        <section data-testid="dip-incoming">
          <h4>Proposals to the city</h4>
          {incoming.map((p) => (
            <div key={p.id} class="dip-proposal" data-testid={`dip-proposal-${p.id}`}>
              <p>
                <strong>{p.name}</strong> proposes{p.counters !== null ? ', answering yours' : ''}:
              </p>
              <ul>
                {p.texts.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ul>
              <p class="muted">Open for {hoursLeft(p.expires, now)} more hours.</p>
              <div class="dip-actions">
                <button
                  class="btn primary"
                  data-testid={`dip-accept-${p.id}`}
                  onClick={() =>
                    void run({ type: 'answerProposal', proposal: p.id, accept: true }, `prop-${p.id}`)
                  }
                >
                  Accept
                </button>
                <button
                  class="btn"
                  data-testid={`dip-counter-${p.id}`}
                  onClick={() =>
                    open(
                      p.with,
                      p.terms.map((t) => ({ ...t })),
                      'counter',
                      p.id,
                    )
                  }
                >
                  Counter…
                </button>
                <button
                  class="btn"
                  data-testid={`dip-refuse-${p.id}`}
                  onClick={() =>
                    void run({ type: 'answerProposal', proposal: p.id, accept: false }, `prop-${p.id}`)
                  }
                >
                  Refuse
                </button>
              </div>
              {feedback(`prop-${p.id}`)}
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section data-testid="dip-outgoing">
          <h4>Waiting for an answer</h4>
          {outgoing.map((p) => (
            <div key={p.id}>
              <p class="war-row" data-testid={`dip-waiting-${p.id}`}>
                <span>
                  To {p.name}: {p.texts.join('; ')}
                </span>
                <button
                  class="btn"
                  onClick={() => void run({ type: 'withdrawProposal', proposal: p.id }, `out-${p.id}`)}
                >
                  Take back
                </button>
              </p>
              {feedback(`out-${p.id}`)}
            </div>
          ))}
        </section>
      )}

      {builder && (
        <TermsBuilder
          key={builder.n}
          to={builder.to}
          name={name(builder.to)}
          initial={builder.terms}
          mode={builder.mode}
          feedback={feedback('builder')}
          onSend={async (terms) => {
            // A term out of bounds (or one too many) is named here, before it goes anywhere.
            const bad =
              terms.length > DIPLOMACY.maxTerms
                ? `A treaty has ${DIPLOMACY.maxTerms} terms at most`
                : terms.map((t) => termProblem(t)).find((x) => x !== null);
            if (bad) return setAsked({ at: 'builder', text: bad });
            await run(
              {
                type: 'propose',
                neighbour: builder.to,
                terms,
                ...(builder.counters !== undefined ? { counters: builder.counters } : {}),
              },
              'builder',
              { after: () => setBuilder(null) },
            );
          }}
          onCancel={() => {
            setAsked(null);
            setBuilder(null);
          }}
        />
      )}

      {d.pacts.some((p) => p.room === null) && (
        <section data-testid="dip-pacts">
          <h4>Treaties in force</h4>
          {d.pacts
            .filter((p) => p.room === null)
            .map((p) => (
              <div key={p.id} class="war-row dip-pact" data-testid={`dip-pact-${p.id}`}>
                <span>
                  <strong>{p.name}</strong>: {p.text}
                  <small class="muted">
                    {p.left !== null && ` · ${p.left} months to go, ${p.paid ?? 0} paid`}
                    {p.until !== null && ` · ${hoursLeft(p.until, now)} hours left`}
                    {p.amount !== null && p.term.k === 'occupy' && ` · ${formatMoney(p.amount)} a month`}
                    {p.imposed && ' · imposed'}
                  </small>
                </span>
                {p.buyBack !== null ? (
                  <button
                    class="btn"
                    data-testid={`dip-buyback-${p.id}`}
                    onClick={() => void run({ type: 'buyBack', pact: p.id }, `pact-${p.id}`)}
                  >
                    Buy back · {formatMoney(p.buyBack)}
                  </button>
                ) : (
                  <button
                    class="btn"
                    data-testid={`dip-end-${p.id}`}
                    title={p.breaks ? 'Ending it breaks the city’s word' : 'End it'}
                    onClick={() => void run({ type: 'endPact', pact: p.id }, `pact-${p.id}`)}
                  >
                    End
                  </button>
                )}
                {feedback(`pact-${p.id}`)}
              </div>
            ))}
        </section>
      )}

      <section data-testid="dip-neighbours">
        <h4>Neighbours</h4>
        {d.neighbours.map((n) => (
          <NeighbourRow
            key={n.id}
            n={n}
            d={d}
            declaring={declaring === n.id}
            feedback={feedback(`n-${n.id}`)}
            onDeclare={() => {
              setAsked(null);
              setDeclaring(declaring === n.id ? null : n.id);
            }}
            onPropose={() => open(n.id, [], 'propose')}
            onEdit={() => setAsked((a) => (a?.at === `n-${n.id}` ? null : a))}
            send={async (scale, reason) => {
              await run({ type: 'declareWar', neighbour: n.id, scale, reason }, `n-${n.id}`, {
                yes: d.vassal?.overlord === n.id ? 'Rise anyway' : 'Declare war anyway',
                after: () => setDeclaring(null),
              });
            }}
          />
        ))}
      </section>

      {d.log.length > 0 && (
        <section data-testid="dip-log">
          <h4>What happened</h4>
          <ul class="dip-log">
            {d.log.slice(0, 12).map((e, k) => (
              <li key={k}>
                <span class="muted">{formatDate(dateOf(e.tick))}</span> {e.text}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function NeighbourRow({
  n,
  d,
  declaring,
  feedback,
  onDeclare,
  onPropose,
  onEdit,
  send,
}: {
  n: Neighbour;
  d: DiplomacySummary;
  declaring: boolean;
  feedback: ComponentChildren;
  onDeclare: () => void;
  onPropose: () => void;
  /** The form changed: a question about what it said before no longer stands. */
  onEdit: () => void;
  send: (scale: DeclaredScale, reason: string) => Promise<void>;
}) {
  // A vassal's war on its overlord is a rising, and a rising is a total war (whatever was picked
  // before the city fell, or before the region's rules changed).
  const rising = d.vassal?.overlord === n.id;
  const [picked, setScale] = useState<DeclaredScale>('war');
  const scale: DeclaredScale = rising ? 'total' : d.allowed === 'total' ? picked : 'war';
  const [reason, setReason] = useState('');
  const atWar = d.wars.some((w) => w.with === n.id);
  const canDeclare = !n.declare || n.breaks;
  return (
    <div class="dip-neighbour" data-testid={`dip-neighbour-${n.id}`}>
      <p class="war-row">
        <span>
          <strong>{n.name}</strong>{' '}
          <small class="muted">{PERSONALITY[n.personality as Personality].name}</small>
          {n.vassal && <small class="dip-good"> · your vassal</small>}
        </span>
        <span title={`Relation ${n.relation} (−100 to 100)`}>
          {relationWord(n.relation)} ({n.relation}) · strength {formatNumber(n.strength)}
        </span>
      </p>
      {n.allies.length > 0 && <p class="muted">Allied with {n.allies.join(' and ')}.</p>}
      <div class="dip-actions">
        <button class="btn" data-testid={`dip-propose-${n.id}`} onClick={onPropose}>
          Propose…
        </button>
        {!atWar && (
          <button
            class="btn"
            data-testid={`dip-declare-${n.id}`}
            disabled={!canDeclare}
            title={n.declare && !n.breaks ? n.declare : rising ? 'Rise against it' : 'Declare war'}
            onClick={onDeclare}
          >
            {rising ? 'Rise against it…' : 'Declare war…'}
          </button>
        )}
      </div>
      {!canDeclare && !atWar && n.declare && <p class="muted">{n.declare}.</p>}
      {declaring && !atWar && (
        <div class="dip-declare" data-testid="dip-declare-form">
          <label>
            Scale{' '}
            <select
              data-testid="dip-scale"
              value={scale}
              onChange={(e) => {
                setScale((e.target as HTMLSelectElement).value as DeclaredScale);
                onEdit();
              }}
            >
              {!rising && <option value="war">War: battles score, terms end it</option>}
              {d.allowed === 'total' && (
                <option value="total">
                  {rising
                    ? 'A rising: total war, hold their HQ and the city goes free'
                    : 'Total war: hold their HQ and they fall'}
                </option>
              )}
            </select>
          </label>
          <label>
            Reason{' '}
            <input
              data-testid="dip-reason"
              type="text"
              maxLength={DIPLOMACY.reasonMax}
              placeholder="What they’ll be told"
              value={reason}
              onInput={(e) => {
                setReason((e.target as HTMLInputElement).value);
                onEdit();
              }}
            />
          </label>
          <p class="muted">
            The war opens {DIPLOMACY.warningHours} hours after it’s declared. {n.name}’s allies may come to
            its side.
          </p>
          <button class="btn danger" data-testid="dip-declare-go" onClick={() => void send(scale, reason)}>
            {rising ? `Rise against ${n.name}` : `Declare war on ${n.name}`}
          </button>
        </div>
      )}
      {feedback}
    </div>
  );
}

/** The fields a term kind starts with (money measured against the payer's taxes). */
function blankTerm(k: TermKind, theirTaxes: number, district: number | undefined, town?: number): Term {
  const amount = Math.max(500, Math.round((theirTaxes * 0.1) / 100) * 100);
  switch (k) {
    case 'ceasefire':
      return { k, hours: 72 };
    case 'reparations':
      return { k, payer: 'them', amount: amount * 3 };
    case 'tribute':
      return { k, payer: 'them', amount, months: 12 };
    case 'dmz':
      return { k, side: 'them', months: 12 };
    case 'occupy':
    case 'release':
      return { k, side: 'them', district: district ?? 1 };
    case 'nonAggression':
      return { k, months: 24 };
    case 'liberate':
      return { k, town: town ?? 0 };
    default:
      return { k } as Term;
  }
}

/** The bounds of a number in a term (the sim's `cleanTerm` and `termProblem` hold the same). */
function bounds(t: Term, key: 'amount' | 'months' | 'hours'): [number, number] {
  const L = DIPLOMACY.limits;
  if (key === 'hours') return L.ceasefireHours;
  if (key === 'months') return L.months;
  return [MIN_MONEY, t.k === 'tribute' ? 1e8 : 1e9];
}

/** Build a proposal's terms: pick each, set its numbers, send. */
function TermsBuilder({
  to,
  name,
  initial,
  mode,
  feedback,
  onSend,
  onCancel,
}: {
  to: number;
  name: string;
  initial: Term[];
  mode: BuilderMode;
  feedback: ComponentChildren;
  onSend: (terms: Term[]) => Promise<void>;
  onCancel: () => void;
}) {
  const game = useGameUpdates(500);
  const d = game.world.stats.war?.diplomacy;
  const [terms, setTerms] = useState<Term[]>(initial);
  const [kind, setKind] = useState<TermKind>('peace');
  const ref = useRef<HTMLElement>(null);
  // Opened from further down the tab: brought into view.
  useEffect(() => ref.current?.scrollIntoView?.({ block: 'nearest' }), []);
  if (!d) return null;
  const theirs = d.neighbours.find((n) => n.id === to);
  const districts = [...game.world.districts.values()];
  /** The towns this neighbour holds as its subjects (a scenario's): the ones a Liberation term can free. */
  const subjects = d.neighbours.filter((x) => x.subjectOf === to);
  /** The districts a term may name: free ones to occupy, occupied ones to hand back. */
  const choices = (k: 'occupy' | 'release', side: 'us' | 'them'): { id: number; label: string }[] => {
    const held = d.pacts
      .filter((p) => p.with === to && p.term.k === 'occupy' && p.term.side === side)
      .map((p) => (p.term as { district: number }).district);
    const all =
      side === 'us'
        ? districts.map((x) => ({ id: x.id, label: x.name }))
        : [1, 2, 3].map((q) => ({ id: q, label: `its ${QUARTERS[q]} quarter` }));
    return all.filter((o) => (k === 'release' ? held.includes(o.id) : !held.includes(o.id)));
  };
  const set = (k: number, t: Term) => setTerms(terms.map((x, i) => (i === k ? t : x)));
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const party = (
    k: number,
    t: Term & { payer?: 'us' | 'them'; side?: 'us' | 'them' },
    field: 'payer' | 'side',
  ) => (
    <select
      data-testid={`dip-term-${k}-${field}`}
      value={t[field]}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value as 'us' | 'them';
        // A district picked on one side means nothing on the other: the first that fits.
        if ((t.k === 'occupy' || t.k === 'release') && field === 'side')
          return set(k, { ...t, side: v, district: choices(t.k, v)[0]?.id ?? 1 });
        set(k, { ...t, [field]: v } as Term);
      }}
    >
      <option value="them">{field === 'payer' ? `${name} pays` : `${name}’s side`}</option>
      <option value="us">{field === 'payer' ? 'The city pays' : 'The city’s side'}</option>
    </select>
  );
  const field = (k: number, t: Term, key: 'amount' | 'months' | 'hours', label: string) => {
    const [lo, hi] = bounds(t, key);
    return (
      <label>
        {label}{' '}
        <input
          type="number"
          min={lo}
          max={hi}
          data-testid={`dip-term-${k}-${key}`}
          value={(t as unknown as Record<string, number>)[key]}
          onInput={(e) => set(k, { ...t, [key]: num((e.target as HTMLInputElement).value) } as Term)}
          // Out of bounds when the field is left: brought back within them.
          onBlur={(e) => {
            const v = num((e.target as HTMLInputElement).value);
            if (v < lo || v > hi) set(k, { ...t, [key]: Math.min(hi, Math.max(lo, v)) } as Term);
          }}
        />
      </label>
    );
  };
  const district = (k: number, t: Extract<Term, { k: 'occupy' | 'release' }>) => {
    const opts = choices(t.k, t.side);
    return opts.length ? (
      <select
        data-testid={`dip-term-${k}-district`}
        value={t.district}
        onChange={(e) => set(k, { ...t, district: Number((e.target as HTMLSelectElement).value) })}
      >
        {opts.map((x) => (
          <option key={x.id} value={x.id}>
            {x.label}
          </option>
        ))}
      </select>
    ) : (
      <small class="muted">{t.k === 'release' ? 'none occupied' : 'none left to occupy'}</small>
    );
  };
  return (
    <section class="dip-builder" data-testid="dip-builder" ref={ref}>
      <h4>
        {mode === 'counter'
          ? `Counter ${name}’s proposal`
          : mode === 'impose'
            ? `Terms for ${name}, who has capitulated`
            : mode === 'offer'
              ? `Terms to end the war with ${name}`
              : `Terms for ${name}`}
      </h4>
      <p class="muted">
        Taxes a month: the city’s {formatMoney(d.taxes)}
        {theirs ? `, ${name}’s ${formatMoney(theirs.taxes)}` : ''}. Tribute is at most half the payer’s, and
        reparations a year of them.
      </p>
      {terms.map((t, k) => (
        <div key={k} class="dip-term" data-testid={`dip-term-${k}`}>
          <strong>{TERM_NAMES[t.k]}</strong>
          {t.k === 'ceasefire' && field(k, t, 'hours', 'hours')}
          {t.k === 'reparations' && (
            <>
              {party(k, t, 'payer')}
              {field(k, t, 'amount', '$')}
            </>
          )}
          {t.k === 'tribute' && (
            <>
              {party(k, t, 'payer')}
              {field(k, t, 'amount', '$ a month')}
              {field(k, t, 'months', 'for months')}
            </>
          )}
          {t.k === 'dmz' && (
            <>
              {party(k, t, 'side')}
              {field(k, t, 'months', 'months')}
            </>
          )}
          {(t.k === 'occupy' || t.k === 'release') && (
            <>
              {party(k, t, 'side')}
              {district(k, t)}
            </>
          )}
          {t.k === 'nonAggression' && field(k, t, 'months', 'months')}
          {t.k === 'liberate' &&
            (subjects.length ? (
              <select
                data-testid={`dip-term-${k}-town`}
                value={t.town}
                onChange={(e) => set(k, { ...t, town: Number((e.target as HTMLSelectElement).value) })}
              >
                {subjects.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            ) : (
              <small class="muted">no town to free</small>
            ))}
          <button
            class="btn icon"
            aria-label="Remove"
            onClick={() => setTerms(terms.filter((_, i) => i !== k))}
          >
            ×
          </button>
        </div>
      ))}
      <div class="dip-actions">
        <select
          data-testid="dip-term-kind"
          value={kind}
          onChange={(e) => setKind((e.target as HTMLSelectElement).value as TermKind)}
        >
          {TERM_KINDS.map((k) => (
            <option key={k} value={k}>
              {TERM_NAMES[k]}
            </option>
          ))}
        </select>
        <button
          class="btn"
          data-testid="dip-term-add"
          disabled={terms.length >= DIPLOMACY.maxTerms}
          title={
            terms.length >= DIPLOMACY.maxTerms
              ? `A treaty has ${DIPLOMACY.maxTerms} terms at most`
              : undefined
          }
          onClick={() =>
            setTerms([
              ...terms,
              blankTerm(
                kind,
                theirs?.taxes ?? d.taxes,
                kind === 'occupy' || kind === 'release' ? choices(kind, 'them')[0]?.id : undefined,
                subjects[0]?.id,
              ),
            ])
          }
        >
          Add term
        </button>
      </div>
      <div class="dip-actions">
        <button
          class="btn primary"
          data-testid="dip-send"
          disabled={!terms.length}
          onClick={() => void onSend(terms)}
        >
          {mode === 'impose' ? `Impose on ${name}` : `Send to ${name}`}
        </button>
        <button class="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      {feedback}
      <p class="muted">
        {mode === 'impose'
          ? `${name} has capitulated: these terms stand at once.`
          : 'Computer neighbours answer within a couple of hours, by their character.'}
      </p>
    </section>
  );
}

/** Falls already answered (city and tick), kept in this browser so a reload doesn't ask again. */
const FALLS_KEY = 'citybloom.falls';
function answeredFalls(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FALLS_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
function answerFall(key: string): void {
  try {
    localStorage.setItem(
      FALLS_KEY,
      JSON.stringify([...answeredFalls().filter((k) => k !== key), key].slice(-20)),
    );
  } catch {
    // Storage refused: the card is answered for this page only.
  }
}

/**
 * The card a city that fell sees once: play on as a vassal, or start again (the save stays). Not
 * for a friend's visit or the battle viewer: the choice is the city's player's.
 */
export function FallenCard() {
  const game = useGameUpdates(500);
  const fell = game.world.stats.war?.diplomacy?.fell;
  // A friend's city holds no strength over the city, only the war score (M39).
  const friendly = !!game.world.stats.war?.diplomacy?.vassal?.friend;
  const key = fell ? `${game.world.stats.cityName}:${fell.at}` : '';
  const [seen, setSeen] = useState<string | null>(null);
  if (!fell || seen === key || game.inMenu() || game.readOnly || game.viewing) return null;
  if (seenFalls.has(key) || answeredFalls().includes(key)) return null;
  const close = () => {
    seenFalls.add(key);
    answerFall(key);
    setSeen(key);
  };
  return (
    <div class="fallen panel" role="dialog" aria-label="The city has fallen" data-testid="fallen-card">
      <h2>{game.world.stats.cityName} has fallen</h2>
      <p>
        {friendly ? `${fell.name} won the war` : `${fell.name} held the city’s HQ long enough`}: the city is
        its vassal now. It pays {fell.name} a fifth of its taxes and may go to war only to rise against it
        {friendly ? ', and it goes free once it wins battles against it.' : ', once it’s strong enough.'}
      </p>
      <div class="dip-actions">
        <button class="btn primary" data-testid="fallen-play-on" onClick={close}>
          Play on as a vassal
        </button>
        <button
          class="btn"
          data-testid="fallen-start-again"
          onClick={() => {
            close();
            game.openScreen('newGame');
          }}
        >
          Start again
        </button>
      </div>
      <p class="muted">Starting again keeps this city’s saves: you can come back to it from Load city.</p>
    </div>
  );
}

/** Falls already answered on this page. */
const seenFalls = new Set<string>();
