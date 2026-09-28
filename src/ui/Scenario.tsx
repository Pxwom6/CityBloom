import { useState } from 'preact/hooks';
import {
  SCENARIO,
  SCENARIOS,
  type GoalMeasure,
  type ScenarioDef,
  type ScenarioLimit,
} from '../data/scenarios';
import { loadProgress } from '../client/scenarioProgress';
import type { ScenarioSummary } from '../sim/systems/scenario';
import { formatMoney, useGame, useGameUpdates } from './hooks';

/**
 * Scenarios (M18): the scenario screen off the main menu, the brief when one begins, the goals
 * panel and its top-bar button, and the win or lose screen.
 */

const base = import.meta.env.BASE_URL;

/** One to three stars, filled for those earned. */
export function Stars({ n, big = false }: { n: number; big?: boolean }) {
  return (
    <span class={`stars ${big ? 'big' : ''}`} role="img" aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((k) => (
        <span key={k} class={k < n ? 'on' : ''} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

export function monthsText(m: number): string {
  const n = Math.max(0, Math.round(m));
  if (n >= 24 && n % 12 === 0) return `${n / 12} years`;
  if (n === 12) return 'a year';
  return `${n} month${n === 1 ? '' : 's'}`;
}

/** A goal's value as the panel shows it. */
export function goalValueText(measure: GoalMeasure, v: number): string {
  switch (measure) {
    case 'treasury':
    case 'income':
    case 'spending':
    case 'net':
      return formatMoney(v);
    case 'approval':
    case 'unemployment':
    case 'crime':
      return `${Math.round(v)} %`;
    case 'pollution':
      return `${v.toFixed(1)} %`;
    case 'traffic':
      return `${v.toFixed(1)} min`;
    case 'project':
    case 'election':
      return v >= 1 ? 'Done' : 'Not yet';
    default:
      return Math.round(v).toLocaleString('en-US');
  }
}

function limitsText(limits: ScenarioLimit[]): string[] {
  return limits.map((l) => l.label);
}

/** What a scenario asks, for the card and the brief. */
function ScenarioFacts({ def }: { def: ScenarioDef }) {
  return (
    <>
      <h3>Goals</h3>
      <ul class="scenario-goals" data-testid="scenario-goals">
        {def.goals.map((g) => (
          <li key={g.label}>{g.label}</li>
        ))}
      </ul>
      <p class="scenario-time">
        <strong>Time:</strong> {monthsText(def.months)}
        {def.limits.length > 0 && (
          <>
            {' · '}
            <strong>Limits:</strong> {limitsText(def.limits).join('; ')}
          </>
        )}
      </p>
      <p class="scenario-stars-rules muted">
        ★ Win · ★★ {def.stars[0].label.toLowerCase()} · ★★★ {def.stars[1].label.toLowerCase()}
      </p>
    </>
  );
}

/** The scenario screen: every scenario with its preview and the best result on this device. */
export function ScenarioScreen() {
  const game = useGame();
  const [progress] = useState(loadProgress);
  const [id, setId] = useState(() => {
    const pick = new URLSearchParams(location.search).get('pick');
    return pick && SCENARIO.has(pick) ? pick : SCENARIOS[0]!.id;
  });
  const def = SCENARIO.get(id)!;
  const won = Object.keys(progress).filter((k) => SCENARIO.has(k)).length;
  return (
    <div class="shell-card panel scenarios" data-testid="scenario-screen">
      <header>
        <h2>Scenarios</h2>
        <small class="muted">
          {won} of {SCENARIOS.length} won on this device
        </small>
      </header>
      <div class="scenarios-body">
        <ul class="scenario-list" role="listbox" aria-label="Scenarios">
          {SCENARIOS.map((s) => (
            <li key={s.id}>
              <button
                class={`scenario-item ${s.id === id ? 'active' : ''}`}
                role="option"
                aria-selected={s.id === id}
                data-testid={`scenario-${s.id}`}
                onClick={() => setId(s.id)}
              >
                <img src={`${base}scenarios/${s.id}.jpg`} alt="" loading="lazy" />
                <span class="scenario-item-text">
                  <strong>{s.name}</strong>
                  <span>{s.blurb}</span>
                </span>
                <Stars n={progress[s.id]?.stars ?? 0} />
              </button>
            </li>
          ))}
        </ul>
        <div class="scenario-detail" data-testid="scenario-detail">
          <img
            class="scenario-preview"
            src={`${base}scenarios/${def.id}.jpg`}
            alt={`${def.name}: the starting city`}
          />
          <h3 class="scenario-name">{def.name}</h3>
          <p>{def.brief}</p>
          <ScenarioFacts def={def} />
          {progress[def.id] && (
            <p class="scenario-best" data-testid="scenario-best">
              Best: <Stars n={progress[def.id]!.stars} /> in {monthsText(progress[def.id]!.months)}
            </p>
          )}
        </div>
      </div>
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
        <button
          class="btn active"
          data-testid="scenario-play"
          onClick={() => {
            location.href = `${location.pathname}?scenario=${encodeURIComponent(def.id)}`;
          }}
        >
          Play {def.name}
        </button>
      </footer>
    </div>
  );
}

/** The brief when a scenario begins: the situation, the goals, the limits and the time. */
export function ScenarioBrief() {
  const game = useGameUpdates(250);
  const sc = game.world.stats.scenario;
  const def = sc ? SCENARIO.get(sc.id) : undefined;
  if (!game.scenarioBrief || !def) return null;
  return (
    <div class="modal-backdrop" data-testid="scenario-brief">
      <div class="modal panel scenario-modal">
        <div class="milestone-kicker">Scenario</div>
        <h2>{def.name}</h2>
        <p>{def.brief}</p>
        <ScenarioFacts def={def} />
        {def.hints.length > 0 && (
          <ul class="scenario-hints">
            {def.hints.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        )}
        <div class="modal-actions">
          <button
            class="btn active"
            data-testid="scenario-begin"
            onClick={() => {
              game.scenarioBrief = false;
              game.setSpeed(1);
              game.notify();
            }}
          >
            Begin
          </button>
        </div>
      </div>
    </div>
  );
}

/** In a scenario, the city's name in the top bar opens the goals panel and says how it's going. */
export function GoalsButton() {
  const game = useGameUpdates(500);
  const st = game.world.stats;
  const sc = st.scenario;
  if (!sc) return null;
  const met = sc.goals.filter((g) => g.met).length;
  const when =
    sc.status === 'won' ? 'won' : sc.status === 'lost' ? 'lost' : `${Math.ceil(sc.monthsLeft)} mo left`;
  return (
    <button
      class={`stat stat-btn goals-btn ${game.panel === 'goals' ? 'active' : ''} ${sc.status}`}
      data-testid="open-goals"
      title="Scenario goals (G)"
      onClick={() => game.openPanel('goals')}
    >
      <span class="city">{st.cityName}</span>
      <span class="sub">
        Goals {met}/{sc.goals.length} · {when} {sc.status === 'won' && <Stars n={sc.stars} />}
      </span>
    </button>
  );
}

function goalProgress(g: ScenarioSummary['goals'][number]): number {
  if (g.met) return 1;
  if (g.min !== undefined) return g.min > 0 ? Math.max(0, Math.min(1, g.value / g.min)) : 0;
  if (g.max !== undefined) return g.value > 0 ? Math.max(0, Math.min(1, g.max / g.value)) : 1;
  return 0;
}

/** The goals panel: each goal against its target, how long it has held, and the clock. */
export function GoalsPanel() {
  const game = useGameUpdates(400);
  const sc = game.world.stats.scenario;
  const def = sc ? SCENARIO.get(sc.id) : undefined;
  if (game.panel !== 'goals' || !sc || !def) return null;
  return (
    <aside class="advisors goals panel" data-testid="goals-panel">
      <header>
        <h2>{def.name}</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('goals')}>
          ×
        </button>
      </header>
      <div class="advisors-list">
        <p class="muted" data-testid="goals-time">
          {sc.status === 'playing'
            ? `${monthsText(sc.monthsLeft)} left. Goals are checked as each month closes; all must be met at once.`
            : sc.status === 'won'
              ? `Won in ${monthsText(sc.monthsTaken)}.`
              : 'The scenario is over; the city plays on.'}
        </p>
        <ul class="goal-list">
          {sc.goals.map((g) => (
            <li key={g.label} class={g.met ? 'met' : ''} data-testid="goal">
              <div class="goal-head">
                <span>{g.label}</span>
                <strong>{g.met ? '✓' : ''}</strong>
              </div>
              <div class="milestone-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(goalProgress(g) * 100)}%` }} />
              </div>
              <small class="muted">
                Now {goalValueText(g.measure, g.value)}
                {g.hold > 1 && ` · held ${Math.min(g.held, g.hold)} of ${g.hold} months`}
              </small>
            </li>
          ))}
        </ul>
        <p class="scenario-stars-rules muted">
          ★★ {def.stars[0].label.toLowerCase()} · ★★★ {def.stars[1].label.toLowerCase()}
        </p>
        {def.limits.length > 0 && <p class="muted">Limits: {limitsText(def.limits).join('; ')}.</p>}
      </div>
    </aside>
  );
}

const LOST: Record<string, string> = {
  time: 'Time ran out before every goal was met.',
  bankrupt: 'The city went bankrupt.',
  election: 'The voters chose someone else.',
};

/** The win or lose screen. */
export function ScenarioEnd() {
  const game = useGameUpdates(250);
  const end = game.scenarioEnd;
  const sc = game.world.stats.scenario;
  const def = sc ? SCENARIO.get(sc.id) : undefined;
  if (!end || !def) return null;
  const next = SCENARIOS[(SCENARIOS.findIndex((s) => s.id === def.id) + 1) % SCENARIOS.length]!;
  return (
    <div class="modal-backdrop" data-testid="scenario-end">
      <div class={`modal panel scenario-modal ${end.won ? 'won' : 'lost'}`}>
        <div class="milestone-kicker">{def.name}</div>
        <h2>{end.won ? 'Scenario won!' : 'Scenario lost'}</h2>
        {end.won ? (
          <>
            <Stars n={end.stars} big />
            <p>Won in {monthsText(end.months)}.</p>
            <ul class="scenario-star-list">
              <li>★ Every goal met</li>
              {def.stars.map((r, k) => (
                <li key={r.label} class={end.stars >= k + 2 ? 'got' : 'missed'}>
                  {'★'.repeat(k + 2)} {r.label}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>{LOST[end.reason] ?? 'The scenario is over.'}</p>
        )}
        <div class="modal-actions">
          <button
            class="btn"
            data-testid="scenario-keep"
            onClick={() => {
              game.scenarioEnd = null;
              game.notify();
            }}
          >
            Keep playing
          </button>
          <button
            class="btn"
            data-testid="scenario-retry"
            onClick={() => {
              location.href = `${location.pathname}?scenario=${encodeURIComponent(def.id)}`;
            }}
          >
            Try again
          </button>
          <button
            class="btn active"
            data-testid="scenario-more"
            onClick={() => {
              location.href = `${location.pathname}?screen=scenarios&pick=${encodeURIComponent(end.won ? next.id : def.id)}`;
            }}
          >
            {end.won ? 'Next scenario' : 'Scenarios'}
          </button>
        </div>
      </div>
    </div>
  );
}
