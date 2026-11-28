import { useEffect, useState } from 'preact/hooks';
import {
  bestOnDevice,
  CHALLENGE_PAGE,
  checkBoard,
  groupCode,
  handChallenge,
  loadGroups,
  newGroupCode,
  saveGroups,
  timeLeftWords,
  type BoardView,
  type ChallengeNow,
} from '../client/challenge';
import { listSlots, type SlotInfo } from '../client/saves';
import { loadProfile, saveProfile } from '../client/profile';
import { challengeMaxScore, SCORE, TWIST_INFO, type ChallengeDef } from '../data/challenges';
import { MAP_PRESETS } from '../data/world';
import { isPhone } from '../game';
import { monthsText } from './Scenario';
import { useGame, useGameUpdates } from './hooks';
import { IconTrophy } from './icons';

/**
 * The weekly challenge (M44): its entry on the main menu, its screen (the challenge, Play, the board:
 * this week, friends and last week, with Watch beside each kept run), the score in a challenge city and
 * its end card (Post score, Try again), and the bar while watching someone's run.
 */

const fmt = (n: number) => n.toLocaleString('en-US');

/** The week as players count it (the first challenge is week 1). */
export const weekName = (week: number) => `Week ${week + 1}`;

/** Milliseconds left in the week by the board's clock, kept fresh every second. */
function useTimeLeft(now: ChallengeNow | null): number | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return now ? now.end - (Date.now() + now.offset) : null;
}

let refreshedAt = -Infinity;

/**
 * This week's challenge, asked of the board when the screen opens and again once the week is over (the
 * new challenge arrives with Monday, Adelaide time).
 */
function useChallengeNow(): { now: ChallengeNow | null; left: number | null } {
  const game = useGameUpdates(500);
  const now = game.challengeNow;
  const left = useTimeLeft(now);
  useEffect(() => {
    if (performance.now() - refreshedAt < 2000) return;
    refreshedAt = performance.now();
    void game.refreshChallenge();
  }, []);
  // Once the week is over, asked again every few seconds until the board has the new one.
  const over = left !== null && left <= 0;
  useEffect(() => {
    if (over && performance.now() - refreshedAt > 4000) {
      refreshedAt = performance.now();
      void game.refreshChallenge();
    }
  }, [over ? Math.floor(performance.now() / 5000) : -1]);
  return { now, left };
}

/**
 * The main menu's card for the week (Menu tidy): the challenge's name, the time left and the top
 * score, under the main buttons rather than one of them. Clicking it opens the challenge.
 */
export function ChallengeMenuCard() {
  const game = useGame();
  const { now, left } = useChallengeNow();
  const going = left !== null && left > 0;
  return (
    <button
      class="menu-card"
      data-testid="main-challenge"
      title="The same challenge for everyone this week: play it as often as you like, your best score counts"
      onClick={() => game.openScreen('challenge')}
    >
      <IconTrophy class="menu-card-icon" />
      <span class="menu-card-text" data-testid="main-challenge-line">
        {now ? (
          <>
            <b>This week:</b> {now.def.name}
            {` · ${going ? `${timeLeftWords(left!)} left` : 'a new one is coming'}`}
            {now.top ? ` · top score ${fmt(now.top.score)}` : ''}
          </>
        ) : (
          <>
            <b>Weekly challenge:</b> a new one every Monday
          </>
        )}
      </span>
      <span class="menu-card-go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/** What a challenge asks beyond its goals: the map, the twist, the money, the time and the score. */
export function ChallengeFacts({ def }: { def: ChallengeDef }) {
  const map = MAP_PRESETS.find((p) => p.id === def.preset)?.name ?? def.preset;
  return (
    <>
      <h3>Goals</h3>
      <ul class="scenario-goals" data-testid="challenge-goals">
        {def.goals.map((g) => (
          <li key={g.label}>{g.label}</li>
        ))}
      </ul>
      <p class="scenario-time">
        <strong>Map:</strong> {map} · <strong>Money:</strong> ${fmt(def.funds)} · <strong>Time:</strong>{' '}
        {monthsText(def.months)}
      </p>
      <p class="scenario-time" data-testid="challenge-twist">
        <strong>Twist:</strong> {TWIST_INFO[def.twist].name}. {TWIST_INFO[def.twist].line}
      </p>
      <p class="muted challenge-score-rules">
        Score: up to {fmt(SCORE.goals)} for the goals’ progress; {fmt(SCORE.win)} for meeting them all, and{' '}
        {fmt(SCORE.perMonthLeft)} for each month left; up to {fmt(def.extra.cap)} for{' '}
        {def.extra.label.toLowerCase()}. At most {fmt(challengeMaxScore(def))}.
      </p>
    </>
  );
}

type Tab = 'week' | 'friends' | 'last';

/** The board: this week's, a group's, last week's; the top runs this browser hasn't checked get checked. */
function ChallengeBoard({ now }: { now: ChallengeNow }) {
  const game = useGame();
  const [tab, setTab] = useState<Tab>('week');
  const [groups, setGroups] = useState(loadGroups);
  const [group, setGroup] = useState<string | null>(() => loadGroups()[0] ?? null);
  const [view, setView] = useState<BoardView | null | 'error'>(null);
  const [checked, setChecked] = useState<Record<number, boolean>>({});
  const [made, setMade] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [why, setWhy] = useState<string | null>(null);
  const week = tab === 'last' ? now.week - 1 : now.week;
  const g = tab === 'friends' ? group : null;
  useEffect(() => {
    if (!now.online || (tab === 'friends' && !group)) {
      setView(null);
      return;
    }
    let live = true;
    setView(null);
    void (async () => {
      let v: BoardView;
      try {
        v = await game.challenges.board(week, g);
      } catch {
        if (live) setView('error');
        return;
      }
      if (!live) return;
      setView(v);
      // Checking runs is how the board stays honest: replay the top few nobody here has checked.
      const max = isPhone() ? CHALLENGE_PAGE.verifyPhone : CHALLENGE_PAGE.verifyMax;
      const found = await checkBoard(game.challenges, v.rows, max, (id, ok) => {
        if (live) setChecked((c) => ({ ...c, [id]: ok }));
      });
      if (live && found.some((f) => !f.ok)) {
        // A run that didn't replay is off the board now.
        const again = await game.challenges.board(week, g).catch(() => null);
        if (again && live) setView(again);
      }
    })();
    return () => {
      live = false;
    };
  }, [tab, group, now.week, now.online]);

  const keep = (next: string[]) => {
    saveGroups(next);
    setGroups(next);
    setGroup(next.includes(group ?? '') ? group : (next[0] ?? null));
  };
  const make = () => {
    if (groups.length >= CHALLENGE_PAGE.groups) {
      setWhy(`At most ${CHALLENGE_PAGE.groups} groups`);
      return;
    }
    const code = newGroupCode();
    keep([...groups, code]);
    setGroup(code);
    setMade(code);
    setWhy(null);
  };
  const join = () => {
    const r = groupCode(typed);
    if ('why' in r) return setWhy(r.why);
    if (groups.includes(r.code)) return setGroup(r.code);
    if (groups.length >= CHALLENGE_PAGE.groups) return setWhy(`At most ${CHALLENGE_PAGE.groups} groups`);
    keep([...groups, r.code]);
    setGroup(r.code);
    setTyped('');
    setWhy(null);
  };

  return (
    <section class="challenge-board" data-testid="challenge-board">
      <div class="challenge-tabs" role="tablist">
        {(
          [
            ['week', 'This week'],
            ['friends', 'Friends'],
            ['last', 'Last week'],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            class={`btn ${tab === t ? 'active' : ''}`}
            data-testid={`board-tab-${t}`}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'friends' && (
        <div class="challenge-groups" data-testid="challenge-groups">
          {groups.length > 0 ? (
            <div class="challenge-group-list">
              {groups.map((c) => (
                <button
                  key={c}
                  class={`btn small ${c === group ? 'active' : ''}`}
                  data-testid={`group-${c}`}
                  onClick={() => setGroup(c)}
                >
                  {c}
                </button>
              ))}
              {group && (
                <button
                  class="btn small"
                  data-testid="group-leave"
                  onClick={() => keep(groups.filter((c) => c !== group))}
                >
                  Leave {group}
                </button>
              )}
            </div>
          ) : (
            <p class="muted">
              A group is a board for you and your friends: make one and share its code, or join a friend’s.
            </p>
          )}
          {made && (
            <p class="challenge-made" data-testid="group-made">
              Your group’s code is <strong>{made}</strong>. Give it to your friends; scores you post from now
              on show on its board.
            </p>
          )}
          <div class="field challenge-group-actions">
            <div class="field-row">
              <input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                data-testid="group-code"
                placeholder="A friend’s group code"
                aria-label="A friend’s group code"
                maxLength={9}
                value={typed}
                onInput={(e) => setTyped((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => e.key === 'Enter' && join()}
              />
              <button class="btn" data-testid="group-join" onClick={join}>
                Join
              </button>
            </div>
            <button class="btn" data-testid="group-make" onClick={make}>
              Make a group
            </button>
          </div>
          {why && <p class="neg">{why}</p>}
        </div>
      )}
      {!now.online ? (
        <p class="muted" data-testid="board-offline">
          The board isn’t available right now. You can still play: your best score is kept on this device.
        </p>
      ) : tab === 'friends' && !group ? null : view === 'error' ? (
        <p class="muted">The board couldn’t be reached. Try again in a moment.</p>
      ) : view === null ? (
        <p class="muted">Loading the board…</p>
      ) : view.rows.length === 0 ? (
        <p class="muted" data-testid="board-empty">
          {tab === 'last' ? 'Nobody posted a score last week.' : 'No scores yet: be the first.'}
        </p>
      ) : (
        <ol class="challenge-rows" data-testid="board-rows">
          {view.rows.map((r) => (
            <li key={r.id} class="challenge-row" data-testid="board-row">
              <span class="challenge-rank">{r.rank}</span>
              <span class="challenge-name">{r.name}</span>
              <span class="challenge-score">{fmt(r.score)}</span>
              <span
                class="challenge-check"
                title={
                  r.checked || checked[r.id]
                    ? 'Replayed by players and found right'
                    : 'Not checked by a replay yet'
                }
              >
                {r.checked || checked[r.id] ? '✓' : ''}
              </span>
              {r.run ? (
                <button
                  class="btn small"
                  data-testid={`board-watch-${r.id}`}
                  onClick={() => (location.href = `${location.pathname}?challengeRun=${r.id}`)}
                >
                  Watch
                </button>
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
      )}
      {view && view !== 'error' && view.total > view.rows.length && (
        <p class="muted">
          Top {view.rows.length} of {fmt(view.total)}.
        </p>
      )}
    </section>
  );
}

/** The challenge screen off the main menu. */
export function ChallengeScreen() {
  const game = useGame();
  const { now, left } = useChallengeNow();
  const [slot, setSlot] = useState<SlotInfo | null>(null);
  useEffect(() => {
    void listSlots()
      .then((s) => setSlot(s.find((x) => x.slot === 'challenge') ?? null))
      .catch(() => setSlot(null));
  }, []);
  const def = now?.def;
  const best = now ? bestOnDevice(now.week) : null;
  const resume = slot?.challenge && now && slot.challenge.week === now.week && !slot.challenge.done;
  return (
    <div class="shell-card panel challenge-screen" data-testid="challenge-screen">
      <header>
        <h2>This week’s challenge</h2>
        <small class="muted" data-testid="challenge-week">
          {now
            ? `${weekName(now.week)} · ${left !== null && left > 0 ? `${timeLeftWords(left)} left` : 'a new challenge is coming'}`
            : 'Asking the board…'}
        </small>
      </header>
      {def && now && (
        <div class="challenge-body">
          <div class="challenge-detail" data-testid="challenge-detail">
            <h3 class="scenario-name" data-testid="challenge-name">
              {def.name}
              {def.pinned && <span class="challenge-pin"> · chosen this week</span>}
            </h3>
            <p>{def.brief}</p>
            <ChallengeFacts def={def} />
            <p class="challenge-best" data-testid="challenge-best">
              {best !== null ? `Your best on this device: ${fmt(best)}` : 'You haven’t played it yet.'}
              {now.top && ` · Top this week: ${fmt(now.top.score)} by ${now.top.name}`}
            </p>
            {now.last && (
              <p class="muted" data-testid="challenge-last">
                Last week’s winner: {now.last.name} with {fmt(now.last.score)}.
              </p>
            )}
          </div>
          <ChallengeBoard now={now} />
        </div>
      )}
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
        {resume && (
          <button
            class="btn"
            data-testid="challenge-continue"
            onClick={() => (location.href = `${location.pathname}?load=challenge`)}
          >
            Continue your try
          </button>
        )}
        <button
          class="btn active"
          data-testid="challenge-play"
          disabled={!def}
          onClick={() => {
            if (!def || !now) return;
            handChallenge(def);
            location.href = `${location.pathname}?challenge=${now.week}`;
          }}
        >
          {best !== null ? 'Try again' : 'Play'}
        </button>
      </footer>
    </div>
  );
}

const ENDED: Record<string, string> = {
  time: 'Time’s up.',
  bankrupt: 'The town went bankrupt.',
  election: 'The voters chose someone else.',
};

/** A challenge city's end: the score, posting it, trying again. */
export function ChallengeEnd() {
  const game = useGameUpdates(250);
  const end = game.scenarioEnd;
  const def = game.challengeDef;
  const sc = game.world.stats.scenario;
  const [name, setName] = useState(() => loadProfile().name);
  if (!end || !def || !sc) return null;
  const score = sc.challenge?.score ?? 0;
  const best = bestOnDevice(def.week);
  const post = game.challengePost;
  const reply = post.reply;
  return (
    <div class="modal-backdrop" data-testid="challenge-end">
      <div class={`modal panel scenario-modal ${end.won ? 'won' : 'lost'}`}>
        <div class="milestone-kicker">This week’s challenge · {weekName(def.week)}</div>
        <h2>{end.won ? 'Challenge complete!' : (ENDED[end.reason] ?? 'The challenge is over.')}</h2>
        <p class="challenge-final" data-testid="challenge-score">
          {fmt(score)}
          <small> points</small>
        </p>
        <p class="muted">
          {end.won ? `Every goal met in ${monthsText(end.months)}.` : 'Every goal’s progress still counts.'}
          {best !== null && ` Your best this week on this device: ${fmt(best)}.`}
        </p>
        {game.challenges.online ? (
          <div class="challenge-post">
            <label class="field">
              <span>Name on the board</span>
              <input
                type="text"
                data-testid="challenge-name-input"
                maxLength={20}
                value={name}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
              />
            </label>
            <button
              class="btn active"
              data-testid="challenge-post"
              disabled={post.busy || !name.trim() || reply?.ok === true}
              onClick={() => {
                const p = loadProfile();
                saveProfile({ ...p, name: name.trim() });
                void game.postChallenge(name.trim());
              }}
            >
              {post.busy ? 'Posting…' : reply?.ok ? 'Posted' : 'Post score'}
            </button>
            {reply && (
              <p class={reply.ok ? 'pos' : 'neg'} data-testid="challenge-post-result">
                {reply.ok
                  ? reply.best
                    ? `On the board: ${ordinal(reply.rank)} this week.`
                    : `Your best this week is still higher: ${ordinal(reply.rank)} on the board.`
                  : reply.why}
              </p>
            )}
          </div>
        ) : (
          <p class="muted">The board isn’t available right now; your best is kept on this device.</p>
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
            data-testid="challenge-retry"
            onClick={() => {
              handChallenge(def);
              location.href = `${location.pathname}?challenge=${def.week}`;
            }}
          >
            Try again
          </button>
          <button
            class="btn"
            data-testid="challenge-see-board"
            onClick={() => (location.href = `${location.pathname}?screen=challenge`)}
          >
            See the board
          </button>
        </div>
      </div>
    </div>
  );
}

export function ordinal(n: number): string {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}

/** Watching someone's run: whose, how far, skip to the end, and whether it came to the same city. */
export function RunViewerBar() {
  const game = useGameUpdates(300);
  const w = game.watchingRun;
  if (!w) return null;
  const done = Math.min(1, game.world.stats.tick / Math.max(1, w.end));
  return (
    <div class="visit-banner panel run-viewer" data-testid="run-viewer">
      <span>
        Watching <strong>{w.name}</strong>’s run · {fmt(w.score)} points · {weekName(w.week)}
      </span>
      <div class="milestone-bar run-viewer-bar" aria-hidden="true">
        <span style={{ width: `${Math.round(done * 100)}%` }} />
      </div>
      {w.result ? (
        <span class={w.result.ok ? 'pos' : 'neg'} data-testid="run-result">
          {w.result.ok
            ? 'It replayed to the same city: this score stands.'
            : 'It didn’t replay to the same city: the board has been told.'}
        </span>
      ) : (
        <button class="btn" data-testid="run-rush" onClick={() => game.rushRun(!w.rush)}>
          {w.rush ? 'Watch it play' : 'Skip to the end'}
        </button>
      )}
      <button
        class="btn"
        data-testid="run-back"
        onClick={() => (location.href = `${location.pathname}?screen=challenge`)}
      >
        Back to the board
      </button>
    </div>
  );
}
