/**
 * Diplomacy on the page (M36): the war room's Diplomacy tab (each neighbour's standing, wars and
 * their scores, proposals in and out, treaties in force, the city's reputation and stance), the
 * terms builder, and the card a fallen city's player chooses on. DESIGN.md §3.30.
 */
import { useState } from 'preact/hooks';
import {
  DIPLOMACY,
  TERM_KINDS,
  TERM_NAMES,
  type DeclaredScale,
  type Term,
  type TermKind,
} from '../data/diplomacy';
import { PERSONALITY, type Personality } from '../data/war';
import type { Command } from '../sim/commands';
import type { DiplomacySummary } from '../sim/systems/diplomacy';
import { TICKS_PER_HOUR, dateOf, formatDate } from '../sim/time';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';

type Neighbour = DiplomacySummary['neighbours'][number];

const hoursLeft = (until: number, now: number) => Math.max(0, Math.ceil((until - now) / TICKS_PER_HOUR));
const relationWord = (r: number) =>
  r >= 50 ? 'friendly' : r >= 20 ? 'warm' : r > -20 ? 'wary' : r > -50 ? 'cold' : 'hostile';

/** A score from −100 to 100 as a bar that fills left (losing) or right (winning). */
function ScoreBar({ score, id }: { score: number; id: number }) {
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

/** The war room's Diplomacy tab. */
export function Diplomacy() {
  const game = useGameUpdates(400);
  const d = game.world.stats.war?.diplomacy;
  const [builder, setBuilder] = useState<{ to: number; terms: Term[]; counters?: number } | null>(null);
  const [declaring, setDeclaring] = useState<number | null>(null);
  const [confirm, setConfirm] = useState<{ text: string; yes: string; go: () => void } | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  if (!d) return null;
  const now = game.world.displayTick;
  /** Send a command; one a pact stands in the way of is asked about first. */
  const run = async (cmd: Command, yes = 'Break it'): Promise<boolean> => {
    const r = await game.dispatch(cmd);
    if (!r.ok && r.info?.breaks) {
      setConfirm({
        text: `${r.reason}. Your reputation will suffer, and its allies will turn against the city.`,
        yes,
        go: () => void run({ ...cmd, breakPact: true } as Command),
      });
      return false;
    }
    setWhy(r.ok ? null : r.reason);
    return r.ok;
  };
  const name = (id: number) => d.neighbours.find((n) => n.id === id)?.name ?? 'A neighbour';
  const incoming = d.proposals.filter((p) => p.from === 'them');
  const outgoing = d.proposals.filter((p) => p.from === 'us');
  return (
    <div class="dip" data-testid="war-diplomacy-body">
      {confirm && (
        <div class="dip-confirm" role="alertdialog" data-testid="dip-confirm">
          <p>{confirm.text}</p>
          <div class="dip-actions">
            <button
              class="btn danger"
              data-testid="dip-confirm-yes"
              onClick={() => {
                const go = confirm.go;
                setConfirm(null);
                go();
              }}
            >
              {confirm.yes}
            </button>
            <button class="btn" data-testid="dip-confirm-no" onClick={() => setConfirm(null)}>
              Keep the city’s word
            </button>
          </div>
        </div>
      )}
      {why && (
        <p class="dip-why" role="alert" data-testid="dip-why">
          {why}
        </p>
      )}
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
        {d.vassal && (
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
            onClick={() => void run({ type: 'setNeutral', on: !d.neutral })}
          >
            {d.neutral ? 'Leave neutrality' : 'Stand neutral'}
          </button>
        </p>
      </section>

      {d.wars.length > 0 && (
        <section data-testid="dip-wars">
          <h4>Wars</h4>
          {d.wars.map((w) => (
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
                  {w.name} has capitulated. Set the terms within {hoursLeft(w.capitulated.until, now)} hours,
                  or peace with reparations stands.{' '}
                  <button
                    class="btn primary"
                    data-testid={`dip-impose-${w.with}`}
                    onClick={() => setBuilder({ to: w.with, terms: [{ k: 'peace' }] })}
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
                    onClick={() => setBuilder({ to: w.with, terms: [{ k: 'peace' }] })}
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
                  onClick={() => void run({ type: 'answerProposal', proposal: p.id, accept: true })}
                >
                  Accept
                </button>
                <button
                  class="btn"
                  data-testid={`dip-counter-${p.id}`}
                  onClick={() =>
                    setBuilder({ to: p.with, terms: p.terms.map((t) => ({ ...t })), counters: p.id })
                  }
                >
                  Counter…
                </button>
                <button
                  class="btn"
                  data-testid={`dip-refuse-${p.id}`}
                  onClick={() => void run({ type: 'answerProposal', proposal: p.id, accept: false })}
                >
                  Refuse
                </button>
              </div>
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section data-testid="dip-outgoing">
          <h4>Waiting for an answer</h4>
          {outgoing.map((p) => (
            <p key={p.id} class="war-row" data-testid={`dip-waiting-${p.id}`}>
              <span>
                To {p.name}: {p.texts.join('; ')}
              </span>
              <button class="btn" onClick={() => void run({ type: 'withdrawProposal', proposal: p.id })}>
                Take back
              </button>
            </p>
          ))}
        </section>
      )}

      {builder && (
        <TermsBuilder
          key={`${builder.to}:${builder.counters ?? 0}`}
          to={builder.to}
          name={name(builder.to)}
          initial={builder.terms}
          counters={builder.counters}
          onSend={async (terms) => {
            const ok = await run({
              type: 'propose',
              neighbour: builder.to,
              terms,
              ...(builder.counters !== undefined ? { counters: builder.counters } : {}),
            });
            if (ok) setBuilder(null);
          }}
          onCancel={() => setBuilder(null)}
        />
      )}

      {d.pacts.length > 0 && (
        <section data-testid="dip-pacts">
          <h4>Treaties in force</h4>
          {d.pacts.map((p) => (
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
                  onClick={() => void run({ type: 'buyBack', pact: p.id })}
                >
                  Buy back · {formatMoney(p.buyBack)}
                </button>
              ) : (
                <button
                  class="btn"
                  data-testid={`dip-end-${p.id}`}
                  title={p.breaks ? 'Ending it breaks the city’s word' : 'End it'}
                  onClick={() => void run({ type: 'endPact', pact: p.id })}
                >
                  End
                </button>
              )}
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
            onDeclare={() => setDeclaring(declaring === n.id ? null : n.id)}
            onPropose={() => setBuilder({ to: n.id, terms: [] })}
            send={async (scale, reason) => {
              if (await run({ type: 'declareWar', neighbour: n.id, scale, reason }, 'Declare war anyway'))
                setDeclaring(null);
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
  onDeclare,
  onPropose,
  send,
}: {
  n: Neighbour;
  d: DiplomacySummary;
  declaring: boolean;
  onDeclare: () => void;
  onPropose: () => void;
  send: (scale: DeclaredScale, reason: string) => Promise<void>;
}) {
  const [scale, setScale] = useState<DeclaredScale>('war');
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
            title={n.declare && !n.breaks ? n.declare : 'Declare war'}
            onClick={onDeclare}
          >
            Declare war…
          </button>
        )}
      </div>
      {!canDeclare && !atWar && n.declare && <p class="muted">{n.declare}.</p>}
      {declaring && (
        <div class="dip-declare" data-testid="dip-declare-form">
          <label>
            Scale{' '}
            <select
              data-testid="dip-scale"
              value={scale}
              onChange={(e) => setScale((e.target as HTMLSelectElement).value as DeclaredScale)}
            >
              <option value="war">War: battles score, terms end it</option>
              {d.allowed === 'total' && <option value="total">Total war: hold their HQ and they fall</option>}
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
              onInput={(e) => setReason((e.target as HTMLInputElement).value)}
            />
          </label>
          <p class="muted">
            The war opens {DIPLOMACY.warningHours} hours after it’s declared. {n.name}’s allies may come to
            its side.
          </p>
          <button class="btn danger" data-testid="dip-declare-go" onClick={() => void send(scale, reason)}>
            Declare war on {n.name}
          </button>
        </div>
      )}
    </div>
  );
}

/** The fields a term kind starts with. */
function blankTerm(k: TermKind, taxes: number, district: number | undefined): Term {
  const amount = Math.max(500, Math.round((taxes * 0.1) / 100) * 100);
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
    default:
      return { k } as Term;
  }
}

/** Build a proposal's terms: pick each, set its numbers, send. */
function TermsBuilder({
  to,
  name,
  initial,
  counters,
  onSend,
  onCancel,
}: {
  to: number;
  name: string;
  initial: Term[];
  counters?: number;
  onSend: (terms: Term[]) => Promise<void>;
  onCancel: () => void;
}) {
  const game = useGameUpdates(500);
  const d = game.world.stats.war?.diplomacy;
  const [terms, setTerms] = useState<Term[]>(initial);
  const [kind, setKind] = useState<TermKind>('peace');
  if (!d) return null;
  const districts = [...game.world.districts.values()];
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
      onChange={(e) => set(k, { ...t, [field]: (e.target as HTMLSelectElement).value } as Term)}
    >
      <option value="them">{field === 'payer' ? `${name} pays` : `${name}’s side`}</option>
      <option value="us">{field === 'payer' ? 'The city pays' : 'The city’s side'}</option>
    </select>
  );
  const field = (k: number, t: Term, key: 'amount' | 'months' | 'hours', label: string) => (
    <label>
      {label}{' '}
      <input
        type="number"
        min={1}
        data-testid={`dip-term-${k}-${key}`}
        value={(t as unknown as Record<string, number>)[key]}
        onInput={(e) => set(k, { ...t, [key]: num((e.target as HTMLInputElement).value) } as Term)}
      />
    </label>
  );
  return (
    <section class="dip-builder" data-testid="dip-builder">
      <h4>
        {counters !== undefined ? `Counter ${name}’s proposal` : `Terms for ${name}`}
        <small class="muted"> · the city’s taxes {formatMoney(d.taxes)} a month</small>
      </h4>
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
              {t.side === 'us' ? (
                <select
                  data-testid={`dip-term-${k}-district`}
                  value={t.district}
                  onChange={(e) => set(k, { ...t, district: Number((e.target as HTMLSelectElement).value) })}
                >
                  {districts.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  data-testid={`dip-term-${k}-district`}
                  value={t.district}
                  onChange={(e) => set(k, { ...t, district: Number((e.target as HTMLSelectElement).value) })}
                >
                  <option value={1}>its north quarter</option>
                  <option value={2}>its middle quarter</option>
                  <option value={3}>its south quarter</option>
                </select>
              )}
            </>
          )}
          {t.k === 'nonAggression' && field(k, t, 'months', 'months')}
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
          onClick={() => setTerms([...terms, blankTerm(kind, d.taxes, districts[0]?.id)])}
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
          Send to {name}
        </button>
        <button class="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p class="muted">
        {to ? 'Computer neighbours answer within a couple of hours, by their character.' : ''}
      </p>
    </section>
  );
}

/** The card a city that fell sees once: play on as a vassal, or start again (the save stays). */
export function FallenCard() {
  const game = useGameUpdates(500);
  const fell = game.world.stats.war?.diplomacy?.fell;
  const key = fell ? `${game.world.stats.cityName}:${fell.at}` : '';
  const [seen, setSeen] = useState<string | null>(null);
  if (!fell || seen === key || game.inMenu() || seenFalls.has(key)) return null;
  const close = () => {
    seenFalls.add(key);
    setSeen(key);
  };
  return (
    <div class="fallen panel" role="dialog" aria-label="The city has fallen" data-testid="fallen-card">
      <h2>{game.world.stats.cityName} has fallen</h2>
      <p>
        {fell.name} held the city’s HQ long enough: the city is its vassal now. It pays {fell.name} a fifth of
        its taxes and may go to war only to rise against it, once it’s strong enough.
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
