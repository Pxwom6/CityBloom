/**
 * Friends in the war room's Diplomacy tab (M39 step 5b): the other players' cities in the region, to go
 * to war with and to sign treaties with. The region room keeps the truth (a war's score, a treaty, a
 * pact, who is whose vassal); the city's sim mirrors it, and this is the player's side of it: proposals
 * from friends to answer, wars with their score and what stands in them, treaties in force with their
 * end, the vassal both ways, and a row for each friend with "Propose…" and "Declare war…". The room's
 * refusals are said in plain words beside the control that caused them.
 */
import { useEffect, useState } from 'preact/hooks';
import { DIPLOMACY, MIN_MONEY, TERM_NAMES, timeWords, type TermKind } from '../data/diplomacy';
import type { FriendScale, FriendTerm } from '../../relay/protocol';
import { FRIENDS, termsFor } from '../../relay/protocol';
import type { DiplomacySummary } from '../sim/systems/diplomacy';
import type { FriendWar as RoomWar } from '../../relay/protocol';
import { friendTermWords, friendTermsWords } from '../client/friendsWar';
import { formatMoney } from './hooks';
import { useGameUpdates } from './hooks';
import { Feedback, ScoreBar, type Asked } from './Diplomacy';

type Friend = DiplomacySummary['friends'][number];
type FriendWar = DiplomacySummary['wars'][number];
type FriendPact = DiplomacySummary['pacts'][number];

/** What the friends' terms builder was opened for. */
type Mode = 'propose' | 'offer' | 'impose';

/** The kinds a treaty between friends can hold, in the order the builder lists them. */
const KINDS: readonly FriendTerm['k'][] = [
  'peace',
  'ceasefire',
  'reparations',
  'tribute',
  'nonAggression',
  'alliance',
  'defensivePact',
  'embargo',
  'trade',
  'independence',
  'vassal',
];
const kindName = (k: FriendTerm['k']) =>
  k === 'vassal' ? 'Vassalage' : k === 'trade' ? 'Trade agreement' : TERM_NAMES[k as TermKind];

let openings = 0;

/** The tab's friends part: nothing when the region has no other player's city. */
export function FriendsDiplomacy({ d }: { d: DiplomacySummary }) {
  const game = useGameUpdates(400);
  const [asked, setAsked] = useState<Asked | null>(null);
  const [declaring, setDeclaring] = useState<number | null>(null);
  const [builder, setBuilder] = useState<{
    slot: number;
    mode: Mode;
    terms: FriendTerm[];
    n: number;
  } | null>(null);
  if (!d.friends.length) return null;
  const fv = game.friends.view();
  const now = fv.now;
  const nameOf = (slot: number) => d.friends.find((f) => f.slot === slot)?.name ?? 'A friend';
  const feedback = (at: string) => <Feedback at={at} asked={asked} onClose={() => setAsked(null)} />;
  const warsWith = d.wars.filter((w) => w.friend);
  const pacts = d.pacts.filter((p) => p.room !== null);
  const open = (slot: number, mode: Mode, terms: FriendTerm[]) => {
    setAsked(null);
    game.friends.clearRefusal(`terms:${slot}`);
    setBuilder({ slot, mode, terms, n: ++openings });
  };
  const roomWar = (w: FriendWar) => fv.wars.find((x) => x.id === w.friend!.room);
  const roomPact = (p: FriendPact) => fv.pacts.find((x) => x.id === p.room);
  return (
    <section class="dip-friends" data-testid="dip-friends">
      <h4>Friends in the region</h4>

      {fv.incoming.map((p) => {
        const name = nameOf(p.with);
        const mine = termsFor(p.terms, 'b');
        return (
          <div key={p.id} class="dip-proposal" data-testid={`dip-fproposal-${p.id}`}>
            <p>
              <strong>{name}</strong> proposes:
            </p>
            <ul>
              {mine.map((t, k) => (
                <li key={k}>{friendTermWords(t, name)}</li>
              ))}
            </ul>
            <p class="muted">Open for {timeWords(p.expires - now)} more.</p>
            <div class="dip-actions">
              <button
                class="btn primary"
                data-testid={`dip-faccept-${p.id}`}
                onClick={() =>
                  void game.friends
                    .answer(p.id, true)
                    .then((why) => setAsked(why ? { at: `fprop-${p.id}`, text: why } : null))
                }
              >
                Accept
              </button>
              <button
                class="btn"
                data-testid={`dip-fdecline-${p.id}`}
                onClick={() => void game.friends.answer(p.id, false)}
              >
                Decline
              </button>
            </div>
            {feedback(`fprop-${p.id}`)}
          </div>
        );
      })}

      {warsWith.length > 0 && (
        <div data-testid="dip-fwars">
          {warsWith.map((w) => (
            <FriendWarCard
              key={w.id}
              w={w}
              room={roomWar(w)}
              pact={fv.pacts.find((x) => x.war === w.friend!.room && x.kind === 'ceasefire')}
              now={now}
              onTerms={(mode, terms) => open(w.friend!.slot, mode, terms)}
              rising={d.vassal?.overlord === w.with}
            />
          ))}
        </div>
      )}

      {fv.outgoing.map((p) => (
        <p key={p.id} class="war-row" data-testid={`dip-fwaiting-${p.id}`}>
          <span>
            To {nameOf(p.with)}: {friendTermsWords(p.terms, nameOf(p.with))}{' '}
            <small class="muted">· waiting, open for {timeWords(p.expires - now)} more</small>
          </span>
        </p>
      ))}

      {builder && (
        <FriendTermsBuilder
          key={builder.n}
          d={d}
          friend={d.friends.find((f) => f.slot === builder.slot)!}
          mode={builder.mode}
          initial={builder.terms}
          refusal={game.friends.refusal(`terms:${builder.slot}`)}
          onSent={() => setBuilder(null)}
          onCancel={() => setBuilder(null)}
        />
      )}

      {d.vassal?.friend && (
        <p class="dip-vassal" data-testid="dip-fvassal">
          The city is {d.vassal.name}’s vassal: a fifth of its taxes go to {d.vassal.name}, and it may go to
          war only to rise against it. A rising is a total war, declared below; if the city wins battles
          against {d.vassal.name} it goes free.
        </p>
      )}
      {d.subjects.map((s) => (
        <p key={s.with} class="dip-good" data-testid={`dip-fsubject-${s.with}`}>
          {s.name} is the city’s vassal:{' '}
          {s.dues > 0
            ? `it pays about ${formatMoney(s.dues)} a month`
            : 'its first payment comes with its next report'}
          , until it goes free.
        </p>
      ))}

      {pacts.length > 0 && (
        <div data-testid="dip-fpacts">
          <h5>Treaties with friends</h5>
          {pacts.map((p) => {
            const rp = roomPact(p);
            return (
              <div key={p.id} class="war-row dip-pact" data-testid={`dip-fpact-${p.id}`}>
                <span>
                  <strong>{p.name}</strong>: {p.text}
                  <small class="muted">
                    {rp?.until !== undefined && ` · ${timeWords(rp.until - now)} left`}
                  </small>
                </span>
                <button
                  class="btn"
                  data-testid={`dip-fend-${p.id}`}
                  title={p.breaks ? 'Ending it breaks the city’s word' : 'End it'}
                  onClick={() => void endPact(p, false)}
                >
                  End
                </button>
                {feedback(`fpact-${p.id}`)}
              </div>
            );
          })}
        </div>
      )}

      <div data-testid="dip-friend-rows">
        {d.friends.map((f) => (
          <FriendRow
            key={f.id}
            f={f}
            d={d}
            atWar={d.wars.some((w) => w.with === f.id)}
            declaring={declaring === f.slot}
            onAsked={setAsked}
            onDeclare={() => {
              setAsked(null);
              game.friends.clearRefusal(`war:${f.slot}`);
              setDeclaring(declaring === f.slot ? null : f.slot);
            }}
            onPropose={() =>
              open(f.slot, 'propose', d.wars.some((w) => w.with === f.id) ? [{ k: 'peace' }] : [])
            }
            feedback={feedback}
          />
        ))}
      </div>

      <RegionHistory />
    </section>
  );

  /** End a pact: asked first when it breaks the city's word. */
  async function endPact(p: FriendPact, breakPact: boolean): Promise<void> {
    const r = await game.friends.endPact({ id: p.id, room: p.room! }, breakPact);
    if (!r.ok && r.info?.breaks)
      setAsked({
        at: `fpact-${p.id}`,
        text: `${r.reason}. Your reputation will suffer, and other cities will hear of it.`,
        yes: 'End it anyway',
        go: () => void endPact(p, true),
      });
    else setAsked(r.ok ? null : { at: `fpact-${p.id}`, text: r.reason });
  }
}

/** The last few things that happened between cities of the region (the room's history). */
function RegionHistory() {
  const game = useGameUpdates(1000);
  const events = game.friends.view().history.slice(-5).reverse();
  if (!events.length) return null;
  return (
    <div data-testid="dip-region-history">
      <h5>Lately in the region</h5>
      <ul class="dip-log">
        {events.map((e) => (
          <li key={e.id}>{e.text}</li>
        ))}
      </ul>
    </div>
  );
}

/** A war with a friend: its score, what stands in it, and what the player can do. */
function FriendWarCard({
  w,
  room,
  pact,
  now,
  onTerms,
  rising,
}: {
  w: FriendWar;
  room: RoomWar | undefined;
  pact: { until?: number } | undefined;
  now: number;
  onTerms: (mode: Mode, terms: FriendTerm[]) => void;
  rising: boolean;
}) {
  const state = w.friend!.state;
  const slot = w.friend!.slot;
  const kind =
    rising || w.rebellion
      ? 'Rising against'
      : w.scale === 'total'
        ? 'Total war with'
        : w.scale === 'skirmish'
          ? 'Skirmish war with'
          : 'War with';
  const holdFalls =
    room?.hold !== undefined ? room.hold.since + DIPLOMACY.conquestHours * FRIENDS.hour : null;
  return (
    <div class="dip-war" data-testid={`dip-fwar-${slot}`}>
      <p class="war-row">
        <strong>
          {kind} {w.name}
        </strong>
        <ScoreBar score={w.score} id={w.with} />
      </p>
      <p class="muted" data-testid={`dip-fwar-text-${slot}`}>
        {w.by === 'us' ? 'Declared by the city' : `Declared by ${w.name}`}: “{w.reason}”.{' '}
        {state === 'declared'
          ? `It opens in ${room ? timeWords(room.opens - now) : 'a moment'}.`
          : `Score ${Math.round(w.score)} after ${w.battles} battle${w.battles === 1 ? '' : 's'}.`}
        {state === 'ceasefire' &&
          ` Ceasefire${pact?.until !== undefined ? ` for ${timeWords(pact.until - now)} more` : ''}.`}
      </p>
      {w.hold && (
        <p class={w.hold.by === 'us' ? 'dip-good' : 'dip-bad'} data-testid={`dip-fhold-${slot}`}>
          {w.hold.by === 'us'
            ? `The city holds ${w.name}’s seat of power${holdFalls ? `: it falls in ${timeWords(holdFalls - now)}` : ''}.`
            : `${w.name} holds the city’s HQ${holdFalls ? `: win a battle within ${timeWords(holdFalls - now)} or the city falls` : ''}.`}
        </p>
      )}
      {w.capitulated?.by === 'them' && (
        <p class="dip-good">
          {w.name} has capitulated. Set the terms within{' '}
          {room?.capitulated ? timeWords(room.capitulated.at + FRIENDS.terms - now) : 'a day'}, or plain peace
          stands.{' '}
          <button
            class="btn primary"
            data-testid={`dip-fimpose-${slot}`}
            onClick={() => onTerms('impose', [])}
          >
            Set the terms
          </button>
        </p>
      )}
      {w.capitulated?.by === 'us' && (
        <p class="dip-bad">
          The city has capitulated: {w.name} sets the terms (a day at most, then plain peace).
        </p>
      )}
      {(state === 'open' || state === 'ceasefire') && (
        <div class="dip-actions">
          <button
            class="btn"
            data-testid={`dip-fpeace-${slot}`}
            onClick={() => onTerms('offer', [{ k: 'peace' }])}
          >
            Offer terms
          </button>
        </div>
      )}
    </div>
  );
}

/** One friend: who it is, and "Propose…" and "Declare war…" with what stands in their way. */
function FriendRow({
  f,
  d,
  atWar,
  declaring,
  onAsked,
  onDeclare,
  onPropose,
  feedback,
}: {
  f: Friend;
  d: DiplomacySummary;
  atWar: boolean;
  declaring: boolean;
  onAsked: (a: Asked | null) => void;
  onDeclare: () => void;
  onPropose: () => void;
  feedback: (at: string) => preact.ComponentChildren;
}) {
  const game = useGameUpdates(400);
  const rising = f.overlord;
  const allowed = d.allowed;
  const scales: FriendScale[] = rising
    ? ['total']
    : allowed === 'skirmish'
      ? ['skirmish']
      : allowed === 'total'
        ? ['war', 'total']
        : ['war'];
  const [scale, setScale] = useState<FriendScale>(scales[0]!);
  const [reason, setReason] = useState('');
  const picked = scales.includes(scale) ? scale : scales[0]!;
  const refusal = game.friends.refusal(`war:${f.slot}`);
  const breaksAsked = game.friends.refusal(`warBreaks:${f.slot}`);
  const canDeclare = !f.declare || f.breaks;
  // The war is declared (or on): the form has done its work.
  useEffect(() => {
    if (atWar && declaring) onDeclare();
  }, [atWar]);
  const go = (breakPact: boolean) => {
    onAsked(null);
    game.friends.declare(f.slot, picked, reason, breakPact);
  };
  // The region says a pact is in the way (the city didn't know): asked, as the sim's own check is.
  useEffect(() => {
    if (breaksAsked && declaring)
      onAsked({
        at: `fdeclare-${f.slot}`,
        text: `${breaksAsked}. Your reputation will suffer, and other cities will hear of it.`,
        yes: rising ? 'Rise anyway' : 'Declare war anyway',
        go: () => go(true),
      });
  }, [breaksAsked]);
  return (
    <div class="dip-neighbour" data-testid={`dip-friend-${f.slot}`}>
      <p class="war-row">
        <span>
          <strong>{f.name}</strong> <small class="muted">{f.mayor}’s city</small>
          {f.overlord && <small class="dip-bad"> · your overlord</small>}
          {f.subject && <small class="dip-good"> · your vassal</small>}
        </span>
        <span class="muted" title={f.online ? 'Their player is here' : 'Their player is away'}>
          {f.online ? 'here now' : 'away'} · {f.population.toLocaleString('en-US')} people
        </span>
      </p>
      <div class="dip-actions">
        <button class="btn" data-testid={`dip-fpropose-${f.slot}`} onClick={onPropose}>
          Propose…
        </button>
        {!atWar && (
          <button
            class="btn"
            data-testid={`dip-fdeclare-${f.slot}`}
            disabled={!canDeclare}
            title={f.declare && !f.breaks ? f.declare : rising ? 'Rise against it' : 'Declare war'}
            onClick={onDeclare}
          >
            {rising ? 'Rise against it…' : 'Declare war…'}
          </button>
        )}
      </div>
      {!canDeclare && !atWar && f.declare && <p class="muted">{f.declare}.</p>}
      {declaring && !atWar && canDeclare && (
        <div class="dip-declare" data-testid="dip-fdeclare-form">
          <label>
            Scale{' '}
            <select
              data-testid="dip-fscale"
              value={picked}
              onChange={(e) => setScale((e.target as HTMLSelectElement).value as FriendScale)}
            >
              {scales.includes('skirmish') && <option value="skirmish">Skirmish war: battles score</option>}
              {scales.includes('war') && <option value="war">War: battles score, terms end it</option>}
              {scales.includes('total') && (
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
              data-testid="dip-freason"
              type="text"
              maxLength={FRIENDS.reasonMax}
              placeholder="What they’ll be told"
              value={reason}
              onInput={(e) => setReason((e.target as HTMLInputElement).value)}
            />
          </label>
          <p class="muted">
            {f.name} is told at once, and the war opens {timeWords(FRIENDS.warning)} later. Battles between
            your cities score it; a side that falls to −60 gives up.
          </p>
          <button class="btn danger" data-testid="dip-fdeclare-go" onClick={() => go(false)}>
            {rising ? `Rise against ${f.name}` : `Declare war on ${f.name}`}
          </button>
        </div>
      )}
      {refusal && !breaksAsked && (
        <p class="dip-why" role="alert" data-testid={`dip-fwhy-${f.slot}`}>
          {refusal}
        </p>
      )}
      {feedback(`fdeclare-${f.slot}`)}
    </div>
  );
}

/** Build a treaty to put to a friend: pick each term, set its numbers, see what stands in the way, send. */
function FriendTermsBuilder({
  d,
  friend,
  mode,
  initial,
  refusal,
  onSent,
  onCancel,
}: {
  d: DiplomacySummary;
  friend: Friend;
  mode: Mode;
  initial: FriendTerm[];
  refusal: string | null;
  onSent: () => void;
  onCancel: () => void;
}) {
  const game = useGameUpdates(500);
  const [terms, setTerms] = useState<FriendTerm[]>(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const war = d.wars.find((w) => w.with === friend.id);
  const imposing = mode === 'impose';
  const offered = KINDS.filter((k) =>
    imposing
      ? k === 'reparations' || k === 'tribute' || (k === 'vassal' && war?.scale === 'total')
      : k !== 'vassal',
  );
  const [kind, setKind] = useState<FriendTerm['k']>(offered[0]!);
  const name = friend.name;
  // The region's rules and the city's own limits, asked of the city as the terms change.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!terms.length) return setProblem(null);
      void game.client
        .query<string | null>({
          type: 'friendTerms',
          slot: friend.slot,
          terms,
          imposed: imposing,
        })
        .then(setProblem)
        .catch(() => setProblem(null));
    }, 150);
    return () => clearTimeout(timer);
  }, [JSON.stringify(terms)]);
  const set = (k: number, t: FriendTerm) => setTerms(terms.map((x, i) => (i === k ? t : x)));
  const num = (v: string) => Math.max(0, Math.round(Number(v) || 0));
  const L = DIPLOMACY.limits;
  const bounds = (t: FriendTerm, key: 'amount' | 'months' | 'hours'): [number, number] =>
    key === 'hours'
      ? L.ceasefireHours
      : key === 'months'
        ? L.months
        : [MIN_MONEY, t.k === 'tribute' ? 1e8 : 1e9];
  const field = (k: number, t: FriendTerm, key: 'amount' | 'months' | 'hours', label: string) => {
    const [lo, hi] = bounds(t, key);
    return (
      <label>
        {label}{' '}
        <input
          type="number"
          min={lo}
          max={hi}
          data-testid={`dip-fterm-${k}-${key}`}
          value={(t as unknown as Record<string, number>)[key]}
          onInput={(e) => set(k, { ...t, [key]: num((e.target as HTMLInputElement).value) } as FriendTerm)}
          onBlur={(e) => {
            const v = num((e.target as HTMLInputElement).value);
            if (v < lo || v > hi) set(k, { ...t, [key]: Math.min(hi, Math.max(lo, v)) } as FriendTerm);
          }}
        />
      </label>
    );
  };
  const payer = (k: number, t: Extract<FriendTerm, { k: 'reparations' | 'tribute' }>) =>
    imposing ? (
      <small class="muted">{name} pays</small>
    ) : (
      <select
        data-testid={`dip-fterm-${k}-payer`}
        value={t.payer}
        onChange={(e) => set(k, { ...t, payer: (e.target as HTMLSelectElement).value as 'us' | 'them' })}
      >
        <option value="them">{name} pays</option>
        <option value="us">The city pays</option>
      </select>
    );
  const blank = (kd: FriendTerm['k']): FriendTerm => {
    const amount = Math.max(500, Math.round((friend.taxes * 0.1) / 100) * 100);
    switch (kd) {
      case 'ceasefire':
        return { k: kd, hours: 72 };
      case 'reparations':
        return { k: kd, payer: 'them', amount: amount * 3 };
      case 'tribute':
        return { k: kd, payer: 'them', amount, months: 12 };
      case 'nonAggression':
        return { k: kd, months: 24 };
      default:
        return { k: kd } as FriendTerm;
    }
  };
  const send = () => {
    const out = imposing ? terms : terms;
    const r = game.friends.propose(friend.slot, out, imposing);
    if (r.sent) onSent();
  };
  return (
    <section class="dip-builder" data-testid="dip-fbuilder">
      <h4>
        {mode === 'impose'
          ? `Terms for ${name}, who has capitulated`
          : mode === 'offer'
            ? `Terms to end the war with ${name}`
            : `Terms for ${name}`}
      </h4>
      <p class="muted">
        Taxes a month: the city’s {formatMoney(d.taxes)}, {name}’s about {formatMoney(friend.taxes)}. Tribute
        is at most half the payer’s, and reparations a year of them; {name}’s own city checks its side.
      </p>
      {terms.map((t, k) => (
        <div key={k} class="dip-term" data-testid={`dip-fterm-${k}`}>
          <strong>{kindName(t.k)}</strong>
          {t.k === 'ceasefire' && field(k, t, 'hours', 'hours')}
          {t.k === 'reparations' && (
            <>
              {payer(k, t)}
              {field(k, t, 'amount', '$')}
            </>
          )}
          {t.k === 'tribute' && (
            <>
              {payer(k, t)}
              {field(k, t, 'amount', '$ a month')}
              {field(k, t, 'months', 'for months')}
            </>
          )}
          {t.k === 'nonAggression' && field(k, t, 'months', 'months')}
          {t.k === 'vassal' && <small class="muted">{name} becomes the city’s vassal</small>}
          {t.k === 'independence' && <small class="muted">the vassal goes free</small>}
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
          data-testid="dip-fterm-kind"
          value={kind}
          onChange={(e) => setKind((e.target as HTMLSelectElement).value as FriendTerm['k'])}
        >
          {offered.map((k) => (
            <option key={k} value={k}>
              {kindName(k)}
            </option>
          ))}
        </select>
        <button
          class="btn"
          data-testid="dip-fterm-add"
          disabled={terms.length >= DIPLOMACY.maxTerms || terms.some((t) => t.k === kind)}
          onClick={() => setTerms([...terms, blank(kind)])}
        >
          Add term
        </button>
      </div>
      {terms.length > 0 && (
        <p class="muted" data-testid="dip-fterm-words">
          {friendTermsWords(terms, name)}.
        </p>
      )}
      {(problem || refusal) && (
        <p class="dip-why" role="alert" data-testid="dip-fterm-why">
          {problem ?? refusal}
        </p>
      )}
      <div class="dip-actions">
        <button
          class="btn primary"
          data-testid="dip-fsend"
          disabled={!terms.length || !!problem}
          onClick={send}
        >
          {imposing ? `Impose on ${name}` : `Send to ${name}`}
        </button>
        <button class="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <p class="muted">
        {imposing
          ? `${name} has capitulated: these terms stand at once, with peace.`
          : `${name}’s player answers when they are here; the proposal waits a day.`}
      </p>
    </section>
  );
}
