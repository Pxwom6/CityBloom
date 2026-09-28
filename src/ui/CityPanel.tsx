import { useState } from 'preact/hooks';
import { ACHIEVEMENTS } from '../data/achievements';
import { ELECTIONS, PROMISES } from '../data/elections';
import { MILESTONES } from '../data/progression';
import { POLICIES, policyCost } from '../data/policies';
import { unlocksAt } from '../data/unlocks';
import type { CityStats, ElectionSummary } from '../sim/protocol';
import { formatMonth, START_TICK_OFFSET, TICKS_PER_MONTH } from '../sim/time';
import type { Game } from '../game';
import { useGameUpdates } from './hooks';
import { IconCity, IconTrophy } from './icons';

type Tab = 'progress' | 'policies' | 'election' | 'achievements';
const TABS: { id: Tab; name: string }[] = [
  { id: 'progress', name: 'Progress' },
  { id: 'policies', name: 'Policies' },
  { id: 'election', name: 'Election' },
  { id: 'achievements', name: 'Achievements' },
];

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;

/** The city: milestones reached and next, policies in force, achievements. */
export function CityPanel() {
  const game = useGameUpdates(400);
  const [tab, setTab] = useState<Tab>('progress');
  if (game.panel !== 'city') return null;
  const st = game.world.stats;
  const k = st.milestone;
  const now = MILESTONES[k]!;
  const next = MILESTONES[k + 1];
  const frac = next ? Math.min(1, (st.peak - now.population) / (next.population - now.population)) : 1;
  return (
    <aside class="advisors city panel" data-testid="city-panel">
      <header>
        <h2>{now.name}</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('city')}>
          ×
        </button>
      </header>
      <nav class="tabs" role="tablist">
        {TABS.filter((t) => t.id !== 'election' || st.election).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            class={`tab ${tab === t.id ? 'active' : ''}`}
            data-testid={`city-tab-${t.id}`}
            onClick={() => setTab(t.id)}
          >
            {t.name}
          </button>
        ))}
      </nav>
      <div class="advisors-list">
        {tab === 'progress' && (
          <>
            <section class="milestone-card">
              <div class="milestone-now">{now.blurb}</div>
              {next ? (
                <>
                  <div class="milestone-bar" aria-label="Progress to the next milestone">
                    <span style={{ width: `${Math.round(frac * 100)}%` }} />
                  </div>
                  <div class="milestone-next">
                    Next: <strong>{next.name}</strong> at {next.population.toLocaleString('en-US')} residents
                  </div>
                  <ul class="unlock-list" data-testid="next-unlocks">
                    {unlocksAt(next.population).map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <div class="milestone-next">Every milestone reached.</div>
              )}
            </section>
            <section class="milestone-card">
              <h3>Tourism and trade</h3>
              <dl class="city-stats">
                <dt>Visitors a day</dt>
                <dd data-testid="city-visitors">{st.visitors.toLocaleString('en-US')}</dd>
              </dl>
              <p class="muted">
                Landmarks draw visitors (more with good approval and a tourism campaign); hotels keep them
                overnight, when they spend the most.
              </p>
            </section>
          </>
        )}
        {tab === 'policies' && (
          <ul class="policy-list">
            {POLICIES.map((p) => {
              const on = st.policies.includes(p.id);
              const locked = !st.unlockAll && st.peak < p.unlockPopulation;
              return (
                <li key={p.id} class={`policy ${on ? 'on' : ''} ${locked ? 'locked' : ''}`}>
                  <label>
                    <input
                      type="checkbox"
                      checked={on}
                      disabled={locked}
                      data-testid={`policy-${p.id}`}
                      onChange={(e) =>
                        void game.dispatch({
                          type: 'setPolicy',
                          id: p.id,
                          on: (e.target as HTMLInputElement).checked,
                        })
                      }
                    />
                    <span class="policy-name">{p.name}</span>
                    <span class="policy-cost">
                      {p.costBase || p.costPerResident ? `${money(policyCost(p, st.population))}/mo` : 'Free'}
                    </span>
                  </label>
                  <div class="policy-effect">
                    {locked ? `Unlocks at ${p.unlockPopulation.toLocaleString('en-US')} residents. ` : ''}
                    {p.effect}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {tab === 'election' && st.election && <ElectionTab game={game} st={st} e={st.election} />}
        {tab === 'achievements' && (
          <ul class="achievement-list" data-testid="achievements">
            {ACHIEVEMENTS.map((a) => {
              const got = st.achievements[a.id] !== undefined;
              return (
                <li key={a.id} class={`achievement ${got ? 'got' : ''}`}>
                  <IconTrophy width={20} height={20} />
                  <div>
                    <strong>{a.name}</strong>
                    <div class="muted">{a.blurb}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

const pct = (x: number) => `${Math.round(x * 100)} %`;

/** The next vote: when, how it looks, the campaign's promises, and the last result and its term. */
function ElectionTab({ game, st, e }: { game: Game; st: CityStats; e: ElectionSummary }) {
  const voteTick = e.nextMonth * TICKS_PER_MONTH - START_TICK_OFFSET;
  const months = Math.max(0, Math.ceil(e.monthsToVote - 1e-6));
  const winning = e.projected >= 0.5;
  const made = new Map(e.promises.map((p) => [p.id, p.kept]));
  const full = e.promises.length >= ELECTIONS.maxPromises;
  const opens = Math.max(0, months - ELECTIONS.campaign);
  return (
    <>
      <section class="milestone-card" data-testid="election-card">
        <h3>
          Next vote: {formatMonth(voteTick)}{' '}
          <span class="muted">
            (in {months} month{months === 1 ? '' : 's'})
          </span>
        </h3>
        <div class="vote-bar" aria-label="Projected vote share">
          <span class={winning ? 'win' : 'lose'} style={{ width: pct(e.projected) }} />
          <i aria-hidden="true" />
        </div>
        <div class="milestone-next" data-testid="election-projected">
          If the vote were today: <strong>{pct(e.projected)}</strong> —{' '}
          {winning ? 'you would win' : 'you would lose'}.
        </div>
        <p class="muted">
          Voters mostly follow approval (now {pct(st.approval)}; {pct(ELECTIONS.neutralApproval)} is an even
          race). Each promise kept adds {Math.round(ELECTIONS.kept * 100)} points on the day; each broken one
          costs {Math.round(-ELECTIONS.broken * 100)}.
        </p>
      </section>
      <section class="milestone-card">
        <h3>Promises</h3>
        <p class="muted">
          {e.campaign
            ? `The campaign is on: make up to ${ELECTIONS.maxPromises}. Each is judged against where the city stands when you make it.`
            : `Promises open ${ELECTIONS.campaign} months before the vote (in ${opens} month${opens === 1 ? '' : 's'}).`}
        </p>
        <ul class="policy-list promise-list">
          {PROMISES.map((p) => {
            const on = made.has(p.id);
            const kept = made.get(p.id);
            return (
              <li key={p.id} class={`policy ${on ? 'on' : ''} ${!e.campaign ? 'locked' : ''}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!e.campaign || (!on && full)}
                    data-testid={`promise-${p.id}`}
                    onChange={(ev) =>
                      void game
                        .dispatch({
                          type: 'promise',
                          promise: p.id,
                          on: (ev.target as HTMLInputElement).checked,
                        })
                        .then((r) => {
                          if (!r.ok) game.toast(r.reason, 'bad');
                        })
                    }
                  />
                  <span class="policy-name">{p.text}</span>
                  {on && (
                    <span
                      class={`promise-state ${kept ? 'kept' : 'not'}`}
                      data-testid={`promise-state-${p.id}`}
                    >
                      {kept ? '✓ On track' : '✗ Not yet'}
                    </span>
                  )}
                </label>
                <div class="policy-effect">{p.test}</div>
              </li>
            );
          })}
        </ul>
      </section>
      {(e.term || e.last) && (
        <section class="milestone-card" data-testid="election-last">
          <h3>Last election</h3>
          {e.last && (
            <p>
              {formatMonth(e.last.tick)}: {e.last.won ? 'won' : 'lost'} with {pct(e.last.share)}.
              {e.last.promises.length > 0 &&
                ` Promises: ${e.last.promises
                  .map(
                    (p) =>
                      `${PROMISES.find((d) => d.id === p.id)?.text ?? p.id} (${p.kept ? 'kept' : 'broken'})`,
                  )
                  .join(', ')}.`}
            </p>
          )}
          {e.term &&
            (e.term.won ? (
              <p class="muted">
                Goodwill until {formatMonth(e.term.until)}: approval +{Math.round(ELECTIONS.honeymoon * 100)}{' '}
                points.
              </p>
            ) : (
              <p class="note warn">
                The council blocks tax rises and new loans until {formatMonth(e.term.until)}.
              </p>
            ))}
        </section>
      )}
    </>
  );
}

/** Top-bar button for the city panel. */
export function CityButton() {
  const game = useGameUpdates(500);
  const got = Object.keys(game.world.stats.achievements).length;
  const e = game.world.stats.election;
  const vote = e?.campaign ? ` · Election in ${Math.max(1, Math.ceil(e.monthsToVote))} months` : '';
  return (
    <button
      class={`btn icon city-btn ${game.panel === 'city' ? 'active' : ''} ${e?.campaign ? 'campaign' : ''}`}
      data-testid="open-city"
      title={`City: progress, policies, elections and achievements (P) · ${got} of ${ACHIEVEMENTS.length} achievements${vote}`}
      aria-label="City"
      onClick={() => game.openPanel('city')}
    >
      <IconCity />
    </button>
  );
}

/** A celebratory banner when the city reaches a milestone, listing what it unlocked. */
export function MilestoneBanner() {
  const game = useGameUpdates(250);
  const c = game.celebration;
  if (!c) return null;
  const m = MILESTONES[c]!;
  return (
    <div
      class="milestone-banner panel"
      data-testid="milestone-banner"
      onClick={() => game.dismissCelebration()}
    >
      <div class="confetti" aria-hidden="true">
        {Array.from({ length: 18 }, (_, i) => (
          <span key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 0.15}s` }} />
        ))}
      </div>
      <div class="milestone-kicker">Milestone reached</div>
      <h2>{m.name}!</h2>
      <p>
        {m.population.toLocaleString('en-US')} residents. {m.blurb}
      </p>
      <ul class="unlock-list">
        {unlocksAt(m.population).map((u) => (
          <li key={u}>{u}</li>
        ))}
      </ul>
    </div>
  );
}
