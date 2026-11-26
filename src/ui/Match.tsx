/**
 * Quick match (M43) on screen: the Quick match screen from the main menu (host a match, or join one
 * by its code), and in a match city the lobby, the scoreboard along the top with the timer, the
 * countdowns, emotes (and chat, if the host allows it), a peek at a rival's city, and the results.
 */
import { useState } from 'preact/hooks';
import { useGame, useGameUpdates, formatMoney } from './hooks';
import { Segmented } from './Shell';
import { ProfileFields } from './Friends';
import { loadProfile, saveProfile, type Profile } from '../client/profile';
import { relayUrl } from '../net/multiplayer';
import {
  INVITE_INPUT_MAX,
  MAX_CHAT,
  PLAYER_COLORS,
  cleanName,
  formatInvite,
  inviteProblem,
  parseInvite,
} from '../../relay/protocol';
import {
  MATCH,
  MATCH_MODES,
  MATCH_MODE_INFO,
  MATCH_PRESETS,
  matchMoney,
  matchScoreText,
  type MatchMode,
  type MatchSettings,
} from '../data/match';
import { MAP_PRESETS } from '../data/world';
import { newMatchQuery } from '../client/matchBoot';
import { EMOTES, clockText, countdownShown } from '../client/matchClient';
import { IS_TEST_BUILD } from '../config';
import { formatInt } from '../sim/dmath';
import type { MatchResult } from '../../relay/match';

const presetName = (id: string) => MAP_PRESETS.find((p) => p.id === id)?.name ?? id;
const colorOf = (i: number) => PLAYER_COLORS[i] ?? PLAYER_COLORS[0];
const MINUTES = IS_TEST_BUILD ? [MATCH.testMinutes, ...MATCH.minutes] : [...MATCH.minutes];

/** "Race to 10,000 · 20 min · River Valley" */
export function matchTitle(s: MatchSettings): string {
  const mode = s.mode === 'race' ? `Race to ${formatInt(s.target)}` : MATCH_MODE_INFO[s.mode].name;
  return `${mode} · ${s.minutes} min · ${presetName(s.preset)}`;
}

/** The match's invite as a link a friend can open. */
export function matchLink(invite: string): string {
  return `${location.origin}${location.pathname}?match=${invite}`;
}

// ---- The Quick match screen ----------------------------------------------------------------------

export function QuickMatchScreen() {
  const game = useGame();
  const [profile, setProfile] = useState(loadProfile);
  const [mode, setMode] = useState<MatchMode>('race');
  const [minutes, setMinutes] = useState<number>(20);
  const [target, setTarget] = useState<number>(MATCH.raceTarget);
  const [preset, setPreset] = useState<MatchSettings['preset']>('river');
  const [chat, setChat] = useState(false);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const online = !!relayUrl();
  const ready = !!cleanName(profile.name);
  const change = (p: Profile) => {
    setProfile(p);
    const name = cleanName(p.name);
    if (name) saveProfile({ ...p, name });
  };
  const host = (kind: 'online' | 'p2p') =>
    (location.href = `${location.pathname}?${newMatchQuery(kind, { mode, minutes, target, preset, chat })}`);
  const join = () => {
    const inv = parseInvite(code);
    const why = inviteProblem(inv);
    if (why) return setProblem(why.replace('a room', 'a match'));
    location.href = `${location.pathname}?match=${formatInvite(inv!)}`;
  };
  return (
    <div class="shell-card panel friends match-screen" data-testid="match-screen">
      <header>
        <h2>Quick match</h2>
        <span class="muted">
          Two to four of you, each with a small city on the same map, against the clock. No accounts: a match
          is found by its code.
        </span>
      </header>
      <ProfileFields profile={profile} onChange={change} />
      <div class="friends-ways">
        <section>
          <h3>Host</h3>
          <div class="field">
            <span>Mode</span>
            <Segmented
              value={mode}
              options={MATCH_MODES}
              label={(m) => MATCH_MODE_INFO[m].name}
              testid="match-mode"
              onChange={setMode}
            />
            <small class="muted" data-testid="match-mode-blurb">
              {mode === 'race'
                ? `First to ${formatInt(target)} residents wins (or the biggest when time is up).`
                : mode === 'happy'
                  ? `${MATCH_MODE_INFO.happy.blurb.replace('the minimum population', `${formatInt(MATCH.happyMinPop)} residents`)}`
                  : MATCH_MODE_INFO[mode].blurb}
            </small>
          </div>
          {mode === 'race' && (
            <div class="field">
              <span>Target</span>
              <Segmented
                value={target}
                options={MATCH.raceTargets}
                label={(t) => formatInt(t)}
                testid="match-target"
                onChange={setTarget}
              />
            </div>
          )}
          <div class="field">
            <span>Timer</span>
            <Segmented
              value={minutes}
              options={MINUTES}
              label={(m) => `${m} min`}
              testid="match-minutes"
              onChange={setMinutes}
            />
          </div>
          <div class="field">
            <span>Map</span>
            <Segmented
              value={preset}
              options={MATCH_PRESETS}
              label={presetName}
              testid="match-preset"
              onChange={setPreset}
            />
          </div>
          <label class="check">
            <input
              type="checkbox"
              checked={chat}
              data-testid="match-chat"
              onChange={(e) => setChat((e.target as HTMLInputElement).checked)}
            />
            <span>Let players chat (otherwise just the quick reactions)</span>
          </label>
          <button
            class="shell-btn primary"
            data-testid="match-host-online"
            disabled={!online || !ready}
            onClick={() => host('online')}
          >
            <span>Host online</span>
            <small>
              {online ? 'An online match friends join by its code' : 'Online matches aren’t set up yet'}
            </small>
          </button>
          <button
            class="shell-btn"
            data-testid="match-host-p2p"
            disabled={!ready}
            title="Your browser runs the match: friends connect straight to it, so they can see your internet (IP) address. If you leave, the match ends."
            onClick={() => host('p2p')}
          >
            <span>Host on this computer</span>
            <small>The match runs in this browser (friends see your IP address)</small>
          </button>
        </section>
        <section>
          <h3>Join</h3>
          <label class="field">
            <span>Match code</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellcheck={false}
              maxLength={INVITE_INPUT_MAX}
              placeholder="7KQ2MX"
              value={code}
              data-testid="match-code"
              onInput={(e) => {
                setCode((e.target as HTMLInputElement).value.toUpperCase());
                setProblem(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && ready && join()}
            />
          </label>
          <button
            class="shell-btn primary"
            data-testid="match-join"
            disabled={!ready || !code.trim()}
            onClick={join}
          >
            <span>Join</span>
            <small>Or open the invite link a friend sent you</small>
          </button>
          {problem && (
            <p class="friends-problem" role="alert">
              {problem}
            </p>
          )}
        </section>
      </div>
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
      </footer>
    </div>
  );
}

// ---- In a match city --------------------------------------------------------------------------

/** Everything a match city shows on top of the game. */
export function MatchHud() {
  const game = useGameUpdates(250);
  const m = game.match;
  if (!m.active || game.inMenu()) return null;
  const phase = m.phase;
  return (
    <>
      {(!phase || phase === 'lobby') && !m.kept && <MatchLobby />}
      {phase && phase !== 'lobby' && !m.kept && <MatchBar />}
      <MatchCountdown />
      {m.resultsOpen && <MatchResults />}
    </>
  );
}

function MatchLobby() {
  const game = useGame();
  const m = game.match;
  const s = m.settings;
  const region = m.region;
  const invite = m.invite;
  const [copied, setCopied] = useState(false);
  const [why, setWhy] = useState<string | null>(null);
  const players = m.info?.players ?? [];
  const here = region?.cities ?? [];
  const isHost = m.isHost;
  const hostName = here.find((c) => c.slot === region?.host)?.name ?? 'the host';
  const readyCount = here.filter((c) => c.online && players.find((p) => p.slot === c.slot)?.ready).length;
  const change = (patch: Partial<MatchSettings>) => s && m.setSettings({ ...s, ...patch });
  return (
    <div class="panel match-lobby" data-testid="match-lobby">
      <header>
        <h3>Quick match</h3>
        {s && <span class="muted">{matchTitle(s)}</span>}
      </header>
      {!region ? (
        <p class="muted">{invite ? 'Joining the match…' : 'Opening the match…'}</p>
      ) : (
        <>
          {invite && (
            <div class="match-invite">
              <span>
                Code <b data-testid="match-invite">{invite}</b>
              </span>
              <button
                class="btn small"
                data-testid="match-copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(matchLink(invite)).then(
                    () => setCopied(true),
                    () => setCopied(false),
                  );
                }}
              >
                {copied ? 'Link copied' : 'Copy invite link'}
              </button>
            </div>
          )}
          <ul class="match-players">
            {here.map((c) => {
              const p = players.find((x) => x.slot === c.slot);
              return (
                <li key={c.slot} data-testid={`match-player-${c.slot}`} class={c.online ? '' : 'away'}>
                  <i style={{ background: colorOf(c.color) }} />
                  <b>{c.name || 'A city'}</b>
                  <span class="muted">
                    {c.mayor}
                    {c.slot === region.host ? ' · host' : ''}
                    {c.slot === m.slot ? ' · you' : ''}
                  </span>
                  <span class={`match-ready ${p?.ready ? 'yes' : ''}`}>
                    {!c.online ? 'away' : p?.ready ? 'ready' : 'founding…'}
                  </span>
                </li>
              );
            })}
          </ul>
          {isHost && s && (
            <div class="match-settings">
              <Segmented
                value={s.mode}
                options={MATCH_MODES}
                label={(x) => MATCH_MODE_INFO[x].name}
                testid="lobby-mode"
                onChange={(mode) => change({ mode })}
              />
              <Segmented
                value={s.minutes}
                options={MINUTES}
                label={(x) => `${x} min`}
                testid="lobby-minutes"
                onChange={(minutes) => change({ minutes })}
              />
            </div>
          )}
          <p class="muted match-hint">
            {m.info?.auto
              ? 'A rematch: it starts by itself once everyone’s new city is ready.'
              : isHost
                ? readyCount < MATCH.minPlayers
                  ? `Send the code to a friend: a match needs ${MATCH.minPlayers} to ${MATCH.maxPlayers} players.`
                  : `${readyCount} players ready. The timer starts after a ${MATCH.countdownMs / 1000}-second countdown.`
                : `Waiting for ${hostName} to start the match.`}
          </p>
          {why && (
            <p class="friends-problem" role="alert">
              {why}
            </p>
          )}
        </>
      )}
      <div class="modal-actions">
        <button class="btn" data-testid="match-leave" onClick={() => game.leaveMatch()}>
          Leave
        </button>
        {isHost && !m.info?.auto && (
          <button
            class="btn active"
            data-testid="match-start"
            disabled={readyCount < MATCH.minPlayers}
            onClick={() => setWhy(m.start() ? null : 'Not connected to the match just now')}
          >
            Start the match
          </button>
        )}
      </div>
    </div>
  );
}

/** The scoreboard along the top: the timer, each city's score, the reactions. */
function MatchBar() {
  const game = useGame();
  const m = game.match;
  const s = m.settings!;
  const [peek, setPeek] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);
  const [line, setLine] = useState('');
  const now = performance.now();
  const rows = m.standings();
  const recent = m.said.filter((x) => now - x.at < 5000);
  const left = m.timeLeft(now);
  const phase = m.phase;
  return (
    <div class="match-bar panel" data-testid="match-bar">
      <div class="match-clock" data-testid="match-timer" title="Time left in the match">
        {phase === 'final' || phase === 'over'
          ? 'Time!'
          : clockText(now < m.startAt ? m.endsAt - m.startAt : left)}
      </div>
      <ol class="match-chips">
        {rows.map((r, k) => {
          const said = recent.filter((x) => x.from === r.slot).at(-1);
          return (
            <li key={r.slot}>
              <button
                class={`match-chip ${r.me ? 'me' : ''} ${r.out ? 'out' : ''}`}
                data-testid={`match-chip-${r.slot}`}
                title={r.me ? 'Your city' : `Peek at ${r.name}`}
                onClick={() => setPeek(peek === r.slot ? null : r.slot)}
              >
                <span class="match-rank">{r.out ? '–' : k + 1}</span>
                <i style={{ background: colorOf(r.color) }} />
                <span class="match-name">{r.name}</span>
                <b class="match-score">{r.out ? 'left' : r.fig ? matchScoreText(s.mode, r.fig, s) : '…'}</b>
                {said && (
                  <span class="match-said" data-testid={`match-said-${r.slot}`}>
                    {said.e !== undefined ? EMOTES[said.e] : said.text}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
      <div class="match-react">
        <button
          class="btn small"
          data-testid="match-emote-btn"
          aria-expanded={picker}
          title="A quick reaction everyone sees"
          onClick={() => setPicker(!picker)}
        >
          {EMOTES[0]}
        </button>
        {picker && (
          <div class="match-emotes" role="menu">
            {EMOTES.map((e, i) => (
              <button
                key={e}
                class="btn small"
                role="menuitem"
                data-testid={`match-emote-${i}`}
                onClick={() => {
                  m.emote(i);
                  setPicker(false);
                }}
              >
                {e}
              </button>
            ))}
            {s.chat && (
              <form
                class="match-chat"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (line.trim() && m.chat(line.trim())) setLine('');
                }}
              >
                <input
                  type="text"
                  maxLength={MAX_CHAT}
                  value={line}
                  placeholder="Say something"
                  data-testid="match-chat-input"
                  onInput={(e) => setLine((e.target as HTMLInputElement).value)}
                />
              </form>
            )}
          </div>
        )}
      </div>
      {peek !== null && <MatchPeek slot={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}

/** A peek at a city of the match: its picture (every minute or so) and its figures. */
function MatchPeek(props: { slot: number; onClose: () => void }) {
  const game = useGame();
  const m = game.match;
  const c = m.region?.cities.find((x) => x.slot === props.slot);
  const r = m.rows.get(props.slot);
  if (!c) return null;
  const visit = c.visitable && m.invite && c.slot !== m.slot;
  return (
    <div class="match-peek panel" data-testid="match-peek">
      <header>
        <b>{c.name}</b>
        <span class="muted">{c.mayor}</span>
      </header>
      {c.thumb ? (
        <img class="region-thumb" src={c.thumb} alt={`${c.name} from above`} />
      ) : (
        <p class="muted">No picture yet: one comes about every minute.</p>
      )}
      {r && (
        <dl class="match-figures">
          <dt>Residents</dt>
          <dd>{formatInt(r.population)}</dd>
          <dt>Money</dt>
          <dd>{formatMoney(matchMoney(r))}</dd>
          <dt>Approval</dt>
          <dd>{Math.round(r.approval)} %</dd>
        </dl>
      )}
      <div class="modal-actions">
        {visit && (
          <button
            class="btn small"
            data-testid="match-visit"
            title="Opens in a new tab: your city keeps running here"
            onClick={() => window.open(`${location.pathname}?visit=${m.invite}&city=${c.slot}`, '_blank')}
          >
            Look round
          </button>
        )}
        <button class="btn small" onClick={props.onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

/** The big numbers: the start's countdown, and the last minute (counted down big from ten). */
function MatchCountdown() {
  const game = useGame();
  const c = countdownShown(game.match);
  if (!c) return null;
  if (c.kind === 'end' && c.s > 10)
    return (
      <div class="match-last" data-testid="match-last-minute" aria-live="polite">
        Last minute · {c.s} s
      </div>
    );
  return (
    <div class={`match-countdown ${c.kind}`} data-testid="match-countdown" aria-live="assertive">
      {c.s}
    </div>
  );
}

/** The results: the winner, each city's numbers and a small chart over the match. */
function MatchResults() {
  const game = useGameUpdates(500);
  const m = game.match;
  const r = m.info?.result;
  const [mode, setMode] = useState<MatchMode | null>(null);
  const [keeping, setKeeping] = useState(false);
  const s = r?.settings ?? m.settings;
  const winner = r?.rows.find((x) => x.slot === r.winner);
  const iWon = !!r && r.winner === m.slot;
  const ended =
    m.cut ??
    (r?.endedBy === 'race'
      ? `${winner?.name ?? 'A city'} reached ${formatInt(r.settings.target)} residents first.`
      : r?.endedBy === 'alone'
        ? 'Everyone else left the match.'
        : 'Time’s up.');
  return (
    <div class="modal-backdrop" data-testid="match-results">
      <div class="modal panel match-results">
        <div class="milestone-kicker">{s ? matchTitle(s) : 'Quick match'}</div>
        <h2 data-testid="match-winner">
          {!r ? 'The match ended early' : iWon ? 'You won!' : winner ? `${winner.name} won` : 'Nobody won'}
        </h2>
        <p class="muted">{ended}</p>
        {r && s ? (
          <>
            <table class="match-table">
              <thead>
                <tr>
                  <th />
                  <th>City</th>
                  <th>Score</th>
                  <th>Residents</th>
                  <th>Money</th>
                  <th>Approval</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row, k) => (
                  <tr
                    key={row.slot}
                    data-testid={`match-row-${row.slot}`}
                    class={row.slot === m.slot ? 'me' : ''}
                  >
                    <td>{row.out ? '–' : k + 1}</td>
                    <td>
                      <i class="match-dot" style={{ background: colorOf(row.color) }} />
                      {row.name}
                      {row.out && <span class="muted"> (left)</span>}
                    </td>
                    <td>{matchScoreText(r.settings.mode, row, r.settings)}</td>
                    <td>{formatInt(row.population)}</td>
                    <td>{formatMoney(matchMoney(row))}</td>
                    <td>{Math.round(row.approval)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <MatchChart r={r} />
            <details class="match-hashes">
              <summary>Check</summary>
              <ul data-testid="match-hashes">
                {r.rows.map((row) => (
                  <li key={row.slot}>
                    {row.name}: <code>{row.hash ?? 'no last report'}</code>
                  </li>
                ))}
              </ul>
            </details>
          </>
        ) : (
          <MatchStandingsSoFar />
        )}
        {m.kept && (
          <p class="match-kept" data-testid="match-kept">
            Kept as “{m.kept}”: open it from Load city any time.
          </p>
        )}
        <div class="modal-actions match-actions">
          {!m.kept && r && (
            <button
              class="btn"
              data-testid="match-keep"
              disabled={keeping}
              onClick={() => {
                setKeeping(true);
                void game.keepMatchCity().finally(() => setKeeping(false));
              }}
            >
              Keep this city
            </button>
          )}
          <button class="btn" data-testid="match-menu" onClick={() => game.leaveMatch()}>
            Back to menu
          </button>
          {r && !m.cut && m.isHost && s && (
            <>
              <select
                class="match-next-mode"
                data-testid="match-rematch-mode"
                aria-label="Mode for the rematch"
                value={mode ?? s.mode}
                onChange={(e) => setMode((e.target as HTMLSelectElement).value as MatchMode)}
              >
                {MATCH_MODES.map((x) => (
                  <option key={x} value={x}>
                    {MATCH_MODE_INFO[x].name}
                  </option>
                ))}
              </select>
              <button
                class="btn active"
                data-testid="match-rematch"
                onClick={() => m.requestRematch(mode && mode !== s.mode ? { ...s, mode } : undefined)}
              >
                Rematch
              </button>
            </>
          )}
          {r && !m.cut && !m.isHost && (
            <span class="muted" data-testid="match-wait-rematch">
              The host can start a rematch.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** When the match ended without a result (its host left): the scores as they stood. */
function MatchStandingsSoFar() {
  const game = useGame();
  const m = game.match;
  const s = m.settings;
  if (!s) return null;
  return (
    <ol class="match-so-far">
      {m.standings().map((r) => (
        <li key={r.slot}>
          {r.name}: {r.fig ? matchScoreText(s.mode, r.fig, s) : 'no score yet'}
        </li>
      ))}
    </ol>
  );
}

/** The chart: each city's value over the match (the mode's measure). */
function MatchChart(props: { r: MatchResult }) {
  const { r } = props;
  const W = 300;
  const H = 110;
  const series = r.rows.map((row) => ({ row, v: r.samples[row.slot] ?? [] }));
  const n = Math.max(2, ...series.map((x) => x.v.length));
  // Scaled to the values (money barely moves against a city's whole worth), a little room each side.
  const all = series.flatMap((x) => x.v);
  const min = Math.min(...all, Infinity);
  const max = Math.max(...all, -Infinity);
  const pad = Math.max((max - min) * 0.08, Math.abs(max) * 0.002, 1);
  const lo = Number.isFinite(min) ? min - pad : 0;
  const hi = Number.isFinite(max) ? max + pad : 1;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo)) * (H - 12);
  const label = (v: number) =>
    r.settings.mode === 'rich'
      ? formatMoney(v)
      : r.settings.mode === 'happy'
        ? `${Math.round(v)} %`
        : formatInt(v);
  const unit =
    r.settings.mode === 'race'
      ? 'residents'
      : r.settings.mode === 'rich'
        ? 'money'
        : r.settings.mode === 'happy'
          ? 'approval'
          : 'points';
  return (
    <figure class="match-chart" data-testid="match-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Each city’s ${unit} over the match`}>
        <line x1="0" y1={H - 4} x2={W} y2={H - 4} class="match-axis" />
        {series.map(({ row, v }) => (
          <polyline
            key={row.slot}
            fill="none"
            stroke={colorOf(row.color)}
            stroke-width={row.slot === r.winner ? 3 : 2}
            points={v.map((val, k) => `${((k / (n - 1)) * W).toFixed(1)},${y(val).toFixed(1)}`).join(' ')}
          />
        ))}
      </svg>
      <figcaption class="muted">
        {unit[0]!.toUpperCase() + unit.slice(1)} over the {r.settings.minutes}{' '}
        {r.settings.minutes === 1 ? 'minute' : 'minutes'}
        {Number.isFinite(min) && ` · from ${label(min)} to ${label(max)}`}
      </figcaption>
    </figure>
  );
}
