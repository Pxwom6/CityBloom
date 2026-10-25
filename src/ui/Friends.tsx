/**
 * Playing with friends (M30): the lobby from the main menu (host online, host on this computer,
 * join with a code), the room button in the top bar and the room panel (code and invite link,
 * who's here, the host's controls, leaving).
 */
import { useState } from 'preact/hooks';
import { useGame, useGameUpdates } from './hooks';
import { loadProfile, saveProfile, type Profile } from '../client/profile';
import { inviteLink, relayUrl } from '../net/multiplayer';
import { MAX_NAME, PLAYER_COLORS, cleanName, normaliseCode, type PlayerInfo } from '../../relay/protocol';
import type { Game } from '../game';

function ProfileFields(props: { profile: Profile; onChange: (p: Profile) => void }) {
  const { profile, onChange } = props;
  return (
    <div class="friends-profile">
      <label class="field">
        <span>Your name</span>
        <input
          type="text"
          maxLength={MAX_NAME}
          value={profile.name}
          data-testid="friends-name"
          title="Shown to the others in the room, nothing else about you is"
          onInput={(e) => onChange({ ...profile, name: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="field">
        <span>Your colour</span>
        <div class="swatches" role="radiogroup" aria-label="Your colour">
          {PLAYER_COLORS.map((c, i) => (
            <button
              key={c}
              class={`swatch ${profile.color === i ? 'on' : ''}`}
              style={{ background: c }}
              role="radio"
              aria-checked={profile.color === i}
              aria-label={`Colour ${i + 1}`}
              data-testid={`friends-color-${i}`}
              onClick={() => onChange({ ...profile, color: i })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Where a hosted city comes from: a new one, or the latest save. */
function hostCity(game: Game, kind: 'online' | 'p2p', latest: string | null) {
  if (latest) location.href = `${location.pathname}?load=${encodeURIComponent(latest)}&host=${kind}`;
  else {
    game.hostKind = kind;
    game.openScreen('newGame');
  }
}

export function FriendsScreen(props: { latestSlot: string | null; latestName: string | null }) {
  const game = useGame();
  const [profile, setProfile] = useState(loadProfile);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const online = !!relayUrl();
  const change = (p: Profile) => {
    setProfile(p);
    const name = cleanName(p.name);
    if (name) saveProfile({ ...p, name });
  };
  const ready = !!cleanName(profile.name);
  const join = () => {
    const c = normaliseCode(code);
    if (!c) return setProblem('A room code has six letters and numbers, like 7KQ2MX.');
    location.href = `${location.pathname}?join=${c}`;
  };
  const city = props.latestName ? `“${props.latestName}”` : 'a new city';
  return (
    <div class="shell-card panel friends" data-testid="friends-screen">
      <header>
        <h2>Play with friends</h2>
        <span class="muted">
          Build one city together, up to 8 of you. No accounts: a room is found by its code.
        </span>
      </header>
      <ProfileFields profile={profile} onChange={change} />
      <div class="friends-ways">
        <section>
          <h3>Host</h3>
          <button
            class="shell-btn"
            data-testid="friends-host-online"
            disabled={!online || !ready}
            title="The city lives in an online room: friends can come and go, and it waits for you all between sessions"
            onClick={() => hostCity(game, 'online', props.latestSlot)}
          >
            <span>Host online</span>
            <small>
              {online
                ? `Share ${city} in an online room`
                : 'Online rooms aren’t set up yet: host on this computer'}
            </small>
          </button>
          <button
            class="shell-btn"
            data-testid="friends-host-p2p"
            disabled={!ready}
            title="Your browser is the room: friends connect straight to it while you play. The city stays in your saves."
            onClick={() => hostCity(game, 'p2p', props.latestSlot)}
          >
            <span>Host on this computer</span>
            <small>Share {city} straight from this browser</small>
          </button>
          {props.latestSlot && (
            <button
              class="shell-btn quiet"
              data-testid="friends-host-new"
              disabled={!ready}
              onClick={() => hostCity(game, online ? 'online' : 'p2p', null)}
            >
              <span>Host a new city instead</span>
            </button>
          )}
        </section>
        <section>
          <h3>Join</h3>
          <label class="field">
            <span>Room code</span>
            <input
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellcheck={false}
              maxLength={9}
              placeholder="7KQ2MX"
              value={code}
              data-testid="friends-code"
              onInput={(e) => {
                setCode((e.target as HTMLInputElement).value.toUpperCase());
                setProblem(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && ready && join()}
            />
          </label>
          <button
            class="shell-btn primary"
            data-testid="friends-join"
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

function stateLine(game: Game): string | null {
  const s = game.net?.session;
  if (!s) return null;
  if (s.state === 'reconnecting') return 'Reconnecting…';
  if (s.state === 'connecting') return 'Connecting…';
  if (s.state === 'joining') return 'Catching up…';
  if (s.waitingFor) return `Waiting for ${s.waitingFor}…`;
  return null;
}

function Dot({ p }: { p: PlayerInfo }) {
  return (
    <span
      class={`player-dot ${p.online ? '' : 'away'}`}
      style={{ background: PLAYER_COLORS[p.color] }}
      title={`${p.name}${p.host ? ' (host)' : ''}${p.online ? '' : ' — away'}`}
    />
  );
}

/** The top bar's room button: the code, who's here and anything to wait for. */
export function RoomChip() {
  const game = useGameUpdates(300);
  const s = game.net?.session;
  if (!game.net || !s) return null;
  const line = stateLine(game);
  return (
    <button
      class={`room-chip ${game.panel === 'room' ? 'active' : ''} ${line ? 'busy' : ''}`}
      data-testid="room-chip"
      title={`Room ${game.net.code}: who's here, the invite link and the host's controls`}
      onClick={() => game.openPanel('room')}
    >
      <span class="room-code">{game.net.code}</span>
      <span class="room-dots">
        {s.players
          .filter((p) => p.online)
          .map((p) => (
            <Dot key={p.id} p={p} />
          ))}
      </span>
      {line && (
        <span class="room-state" data-testid="room-state">
          {line}
        </span>
      )}
    </button>
  );
}

export function RoomPanel() {
  const game = useGameUpdates(300);
  const [copied, setCopied] = useState(false);
  const mp = game.net;
  if (game.panel !== 'room' || !mp) return null;
  const s = mp.session;
  const room = s.room;
  const link = inviteLink(mp.code);
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const line = stateLine(game);
  return (
    <aside class="advisors room-panel panel" data-testid="room-panel">
      <header>
        <h2>Room {mp.code}</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('room')}>
          ×
        </button>
      </header>
      <div class="advisors-list">
        <p class="muted">
          {mp.kind === 'online'
            ? 'An online room: the city waits here between sessions, and friends can join any time with the code.'
            : 'This room runs in the host’s browser: friends can play while the host is here.'}
        </p>
        <div class="invite">
          <input
            readOnly
            value={link}
            data-testid="room-link"
            aria-label="Invite link"
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <button class="btn" data-testid="room-copy" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
        {line && (
          <p class="room-line" data-testid="room-line">
            {line}
          </p>
        )}
        <ul class="room-players" data-testid="room-players">
          {s.players.map((p) => (
            <li key={p.id} class={p.online ? '' : 'away'} data-testid={`room-player-${p.id}`}>
              <Dot p={p} />
              <span class="name">
                {p.name}
                {p.id === s.you && ' (you)'}
              </span>
              <span class="muted">
                {p.host ? 'host' : ''}
                {!p.online ? ' away' : p.joining ? ' joining…' : room?.pacer === p.id ? ' keeps time' : ''}
              </span>
              {s.isHost && !p.host && (
                <button
                  class="btn small"
                  data-testid={`room-kick-${p.id}`}
                  title={`Remove ${p.name} from the room (they can't come back)`}
                  onClick={() => s.admin('kick', p.id)}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {s.isHost && room && (
          <div class="room-host">
            <label class="check" title="Nobody new can join while the room is locked">
              <input
                type="checkbox"
                checked={room.locked}
                data-testid="room-lock"
                onChange={(e) => s.admin((e.target as HTMLInputElement).checked ? 'lock' : 'unlock')}
              />
              <span>Lock the room</span>
            </label>
            <label class="check">
              <input
                type="checkbox"
                checked={room.chat}
                data-testid="room-chat-toggle"
                onChange={(e) => s.admin((e.target as HTMLInputElement).checked ? 'chatOn' : 'chatOff')}
              />
              <span>Chat on</span>
            </label>
          </div>
        )}
        <button class="shell-btn quiet" data-testid="room-leave" onClick={() => game.leaveRoom()}>
          <span>Leave the room</span>
          <small>
            {mp.host
              ? 'The room closes for everyone: it runs in this browser.'
              : 'The city carries on for the others; you keep a copy to play alone.'}
          </small>
        </button>
      </div>
    </aside>
  );
}
