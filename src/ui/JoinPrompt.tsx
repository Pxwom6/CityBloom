/**
 * Before an invite link opens a room (multiplayer review, F12): a friend arriving for the first time
 * picks the name and colour the others will see, instead of being given a random one. Drawn on the
 * boot screen, before the game itself exists.
 */
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { cleanName, PLAYER_COLORS, MAX_NAME } from '../../relay/protocol';
import { saveProfile, type Profile } from '../client/profile';

function JoinPrompt(props: { what: string; start: Profile; done: (p: Profile) => void }) {
  const [p, setP] = useState(props.start);
  const name = cleanName(p.name);
  const go = () => {
    if (!name) return;
    const out = { ...p, name };
    saveProfile(out);
    props.done(out);
  };
  return (
    <form
      class="join-prompt panel"
      data-testid="join-name"
      onSubmit={(e) => {
        e.preventDefault();
        go();
      }}
    >
      <h2>{props.what}</h2>
      <p class="muted">Pick the name and colour the others will see. Nothing else about you is shared.</p>
      <label class="field">
        <span>Your name</span>
        <input
          type="text"
          maxLength={MAX_NAME}
          value={p.name}
          autoFocus
          data-testid="join-name-input"
          onInput={(e) => setP({ ...p, name: (e.target as HTMLInputElement).value })}
        />
      </label>
      <div class="swatches" role="radiogroup" aria-label="Your colour">
        {PLAYER_COLORS.map((c, i) => (
          <button
            key={c}
            type="button"
            class={`swatch ${p.color === i ? 'on' : ''}`}
            style={{ background: c }}
            role="radio"
            aria-checked={p.color === i}
            aria-label={`Colour ${i + 1}`}
            onClick={() => setP({ ...p, color: i })}
          />
        ))}
      </div>
      <div class="join-prompt-actions">
        <a class="btn" href={location.pathname} data-testid="join-name-back">
          Back to the menu
        </a>
        <button class="btn active" type="submit" disabled={!name} data-testid="join-name-go">
          Join
        </button>
      </div>
    </form>
  );
}

/** Ask for a name and colour on the boot screen; resolves once the player has chosen (and saved) them. */
export function askName(boot: HTMLElement, what: string, start: Profile): Promise<Profile> {
  return new Promise((resolve) => {
    boot.classList.add('asking');
    render(
      <JoinPrompt
        what={what}
        start={start}
        done={(p) => {
          render(null, boot);
          boot.classList.remove('asking');
          resolve(p);
        }}
      />,
      boot,
    );
  });
}
