/**
 * Playing with friends (M30): the lobby from the main menu (host online, host on this computer,
 * join with a code), the room button in the top bar and the room panel (code and invite link,
 * who's here, the host's controls, leaving).
 */
import { useState } from 'preact/hooks';
import { useGame, useGameUpdates } from './hooks';
import { loadProfile, saveProfile, type Profile } from '../client/profile';
import { inviteLink, relayUrl } from '../net/multiplayer';
import {
  INVITE_INPUT_MAX,
  MAX_CHAT,
  MAX_NAME,
  PLAYER_COLORS,
  cleanName,
  formatInvite,
  inviteProblem,
  parseInvite,
  type PlayerInfo,
} from '../../relay/protocol';
import type { Game } from '../game';
import { DEFAULT_PERMS, PERMISSIONS, type Permission } from '../sim/rules';

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
    // Shared or brought to a region, never both (F4).
    game.forgetFriendsChoice();
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
    const inv = parseInvite(code);
    const why = inviteProblem(inv);
    if (why) return setProblem(why);
    location.href = `${location.pathname}?join=${formatInvite(inv!)}`;
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
              maxLength={INVITE_INPUT_MAX}
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
      <RegionWays latestSlot={props.latestSlot} latestName={props.latestName} ready={ready} />
      <Troubleshooting />
      <footer class="shell-actions">
        <button class="btn" data-testid="shell-back" onClick={() => game.closeScreen()}>
          Back
        </button>
      </footer>
    </div>
  );
}

/** Shared regions from the lobby (M32): each brings their own city. */
function RegionWays(props: { latestSlot: string | null; latestName: string | null; ready: boolean }) {
  const game = useGame();
  const [code, setCode] = useState(game.pendingRegion ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const city = props.latestName ? `“${props.latestName}”` : 'a new city';
  const go = (q: string) => {
    if (props.latestSlot)
      location.href = `${location.pathname}?load=${encodeURIComponent(props.latestSlot)}&${q}`;
    else {
      game.forgetFriendsChoice();
      game.regionParam = q;
      game.openScreen('newGame');
    }
  };
  return (
    <div class="friends-region">
      <h3>A shared region</h3>
      <p class="muted">
        Or each play your own city side by side (up to four): your cities take the neighbouring towns’ places,
        trade power and water, share commuters and build a great work together.
      </p>
      <div class="friends-region-row">
        <button
          class="shell-btn"
          data-testid="friends-region-start"
          disabled={!props.ready}
          onClick={() => go(`newregion=${relayUrl() ? 'online' : 'p2p'}`)}
        >
          <span>Start a region</span>
          <small>with {city}</small>
        </button>
        <label class="field">
          <span>Region code</span>
          <input
            type="text"
            maxLength={INVITE_INPUT_MAX}
            placeholder="4RT9KW"
            value={code}
            data-testid="friends-region-code"
            onInput={(e) => {
              setCode((e.target as HTMLInputElement).value.toUpperCase());
              setProblem(null);
            }}
          />
        </label>
        <button
          class="shell-btn"
          data-testid="friends-region-join"
          disabled={!props.ready || !code.trim()}
          onClick={() => {
            const inv = parseInvite(code);
            const why = inviteProblem(inv);
            if (why) return setProblem(why.replace('a room', 'a region'));
            go(`region=${formatInvite(inv!)}`);
          }}
        >
          <span>Join with {city}</span>
        </button>
      </div>
      {problem && (
        <p class="friends-problem" role="alert">
          {problem}
        </p>
      )}
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
  const [open, setOpen] = useState(0);
  const mp = game.net;
  if (game.panel !== 'room' || !mp) return null;
  const s = mp.session;
  const room = s.room;
  const link = inviteLink(mp.invite);
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
        {mp.key && (
          <p class="muted room-invite-code">
            Or the code to type: <strong data-testid="room-invite">{mp.invite}</strong>
          </p>
        )}
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
              {p.id !== s.you && p.online && (
                <button
                  class={`btn small ${game.following === p.id ? 'active' : ''}`}
                  data-testid={`room-follow-${p.id}`}
                  title={`Ride along with ${p.name}'s view (move the camera to stop)`}
                  onClick={() => game.follow(p.id)}
                >
                  {game.following === p.id ? 'Following' : 'Follow'}
                </button>
              )}
              {s.isHost && !p.host && (
                <button
                  class={`btn small ${open === p.id ? 'active' : ''}`}
                  data-testid={`room-perms-${p.id}`}
                  title={`What ${p.name} may do`}
                  onClick={() => setOpen(open === p.id ? 0 : p.id)}
                >
                  Allow…
                </button>
              )}
              {s.isHost && !p.host && open === p.id && room && (
                <PlayerRules
                  player={p}
                  perms={room.rules.perms[p.id] ?? DEFAULT_PERMS}
                  muted={room.muted.includes(p.id)}
                  onPerms={(perms) => s.setPermissions(p.id, perms)}
                  onMute={(m) => s.admin(m ? 'mute' : 'unmute', p.id)}
                  onKick={() => s.admin('kick', p.id)}
                />
              )}
            </li>
          ))}
        </ul>
        <p class="muted room-tip">Press Shift+G over the map to point the others at a spot.</p>
        <Chat />
        <Troubleshooting />
        {s.isHost && room && (
          <div class="room-host">
            <label
              class="check"
              title="Nobody new can join while the room is locked (it locks by itself when you remove someone); players already in it can still come back"
            >
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
            <label
              class="field spend"
              title="Players without “Spend above the limit” can't spend more than this on one action"
            >
              <span>Spending limit</span>
              <input
                type="number"
                min={0}
                step={1000}
                placeholder="none"
                value={room.rules.spendLimit ?? ''}
                data-testid="room-spend-limit"
                onChange={(e) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  s.setSpendLimit(v === '' ? null : Math.max(0, Math.round(Number(v))));
                }}
              />
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

/** The host's say over one player (M31): what they may do, muting and removing. */
function PlayerRules(props: {
  player: PlayerInfo;
  perms: readonly Permission[];
  muted: boolean;
  onPerms: (p: Permission[]) => void;
  onMute: (m: boolean) => void;
  onKick: () => void;
}) {
  const { player, perms } = props;
  return (
    <div class="player-rules" data-testid={`room-rules-${player.id}`}>
      {PERMISSIONS.map((p) => (
        <label key={p.id} class="check" title={p.blurb}>
          <input
            type="checkbox"
            checked={perms.includes(p.id)}
            data-testid={`perm-${player.id}-${p.id}`}
            onChange={(e) =>
              props.onPerms(
                (e.target as HTMLInputElement).checked ? [...perms, p.id] : perms.filter((x) => x !== p.id),
              )
            }
          />
          <span>{p.label}</span>
        </label>
      ))}
      <div class="player-rules-actions">
        <button
          class="btn small"
          data-testid={`room-mute-${player.id}`}
          onClick={() => props.onMute(!props.muted)}
        >
          {props.muted ? 'Unmute' : 'Mute in chat'}
        </button>
        <button
          class="btn small danger"
          data-testid={`room-kick-${player.id}`}
          title={`Remove ${player.name} from the room: it locks behind them so they can’t come back`}
          onClick={props.onKick}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/** A short chat (M31): the last messages and a line to type in. */
function Chat() {
  const game = useGameUpdates(300);
  const [text, setText] = useState('');
  const mp = game.net;
  if (!mp) return null;
  const s = mp.session;
  const on = s.room?.chat !== false;
  const muted = !!s.room?.muted.includes(s.you);
  const send = () => {
    const t = text.trim();
    if (!t) return;
    s.chat(t);
    setText('');
  };
  return (
    <div class="chat" data-testid="chat">
      <ul class="chat-log" data-testid="chat-log">
        {game.chatLog.slice(-8).map((m, i) => (
          <li key={i}>
            <span class="who" style={{ color: PLAYER_COLORS[m.color] }}>
              {m.name}
            </span>{' '}
            {m.text}
          </li>
        ))}
      </ul>
      {on && !muted ? (
        <div class="chat-input">
          <input
            type="text"
            maxLength={MAX_CHAT}
            placeholder="Say something…"
            value={text}
            data-testid="chat-input"
            onInput={(e) => setText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') send();
            }}
          />
          <button class="btn" data-testid="chat-send" onClick={send}>
            Send
          </button>
        </div>
      ) : (
        <p class="muted">
          {muted ? 'The host has muted you in the chat.' : 'The host has turned the chat off.'}
        </p>
      )}
    </div>
  );
}

/** What to do when playing together goes wrong (M33): short, and only when asked for. */
export function Troubleshooting() {
  return (
    <details class="friends-help" data-testid="friends-help">
      <summary>Trouble connecting?</summary>
      <ul>
        <li>
          <strong>Can’t connect to the host’s computer?</strong> Some home, school and office networks block
          direct connections between browsers. Ask the host to choose Host online instead.
        </li>
        <li>
          <strong>Room full or locked?</strong> A room takes 8 players and a region 4 cities. Ask the host to
          remove someone who has left, or to unlock the room.
        </li>
        <li>
          <strong>“Fell out of step”?</strong> One game stopped agreeing with the others. The room sends it
          the city as it stands and it carries on a moment later; nothing is lost.
        </li>
        <li>
          <strong>“Waiting for …”?</strong> Someone’s computer is falling behind; the city waits a few seconds
          for them. A game in a background tab isn’t waited for.
        </li>
      </ul>
    </details>
  );
}
