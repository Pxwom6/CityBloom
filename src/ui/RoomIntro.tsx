/**
 * A friend's room, the first time (M42): a short card for a player joining someone else's city, saying
 * what's shared, what this player may do (the host's permissions for them), how to chat and point at
 * a spot, and how to leave. Shown once (`roomIntro` in settings); the room panel's "How rooms work"
 * opens it again.
 */
import { useGameUpdates } from './hooks';
import { PERMISSIONS, permsOf } from '../sim/rules';

export function RoomIntroCard() {
  const game = useGameUpdates(500);
  const mp = game.net;
  if (!game.roomIntro || !mp || game.screen) return null;
  const s = mp.session;
  const host = s.players.find((p) => p.host);
  const rules = s.room?.rules;
  const mine = rules ? permsOf(rules, s.you) : null;
  const may = s.isHost || !mine ? PERMISSIONS : PERMISSIONS.filter((p) => mine.includes(p.id));
  const mayNot = s.isHost || !mine ? [] : PERMISSIONS.filter((p) => !mine.includes(p.id));
  return (
    <div class="guide panel room-intro" data-testid="room-intro" role="dialog" aria-label="How rooms work">
      <div class="guide-kicker">Playing together</div>
      <h3>{s.isHost ? 'Your room' : `Welcome to ${host ? `${host.name}’s` : 'a shared'} city`}</h3>
      <ul class="room-intro-list">
        <li>
          <b>Shared:</b> everyone builds on the same map, with the same money and the same clock. The host
          sets the speed.
        </li>
        <li data-testid="room-intro-perms">
          <b>{s.isHost ? 'You’re the host:' : 'You may:'}</b>{' '}
          {s.isHost
            ? 'you decide who may do what (Allow… beside each player in the room panel).'
            : `build roads, zones and buildings${may.length ? `, and ${may.map((p) => p.label.toLowerCase()).join(', ')}` : ''}.`}
          {mayNot.length > 0 && (
            <>
              {' '}
              <b>Not yet:</b> {mayNot.map((p) => p.label.toLowerCase()).join(', ')}. Ask the host in the chat.
            </>
          )}
        </li>
        <li>
          <b>Talk:</b> the room button by the city’s name opens the chat and who’s here. Point at a spot with
          Shift+G (or Point in the room panel): the others see it.
        </li>
        <li>
          <b>Leave:</b> the menu (Esc) → Quit to main menu. The city carries on for the others, and you keep a
          copy.
        </li>
      </ul>
      <div class="guide-actions">
        <span />
        <button class="btn active" data-testid="room-intro-ok" onClick={() => game.closeRoomIntro()}>
          Got it
        </button>
      </div>
    </div>
  );
}
