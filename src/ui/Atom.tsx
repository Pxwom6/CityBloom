/**
 * The atom bomb on screen (M40 step 11): the war room's Bomb tab (the ladder from the research to the
 * bomb, the launch card behind a three-second hold, the region's race, the fallout and its clean-up),
 * the card for a bomb on its way to the city, the card a bomb leaves behind, and the bar of the
 * clean-up tool. Every word and figure comes from the sim's summary through `atomView.ts`; this file
 * only draws and sends commands.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Game } from '../game';
import type { FalloutQuery } from '../sim/systems/fallout';
import type { AtomSummary } from '../sim/systems/atom';
import { falloutYears } from '../sim/systems/fallout';
import {
  HOLD_MS,
  PIPS,
  buildTerms,
  consequences,
  countdown,
  defaultTarget,
  falloutLines,
  headline,
  holdFraction,
  holdKey,
  holdSeconds,
  ladderRows,
  launchGuestWhy,
  launchTerms,
  launchWords,
  markLines,
  moneyWords,
  pointerInside,
  raceRows,
  stopTerms,
  targetRows,
  type Countdown,
  type LadderRow,
  type RaceRow,
} from './atomView';
import { useGameUpdates } from './hooks';

/** Run a command and say how it went: a sound and a line on success, the sim's words on a refusal. */
function useAct(game: Game) {
  return (cmd: Parameters<Game['dispatch']>[0], done?: string) =>
    void game.dispatch(cmd).then((r) => {
      if (r.ok) {
        game.audio?.play('place');
        if (done) game.toast(done, 'ok', 2500);
      } else {
        game.audio?.play('error');
        game.toast(r.reason, 'bad');
      }
    });
}

/** The state of a rung, in the words a screen reader reads. */
const STATE_WORDS: Record<LadderRow['state'], string> = {
  done: 'done',
  now: 'in hand',
  wait: 'waiting',
  todo: 'not yet',
};

function Rung({ r }: { r: LadderRow }) {
  return (
    <li class={`atom-row ${r.state}`} data-testid={`atom-row-${r.id}`} data-state={r.state}>
      <i class="atom-dot" role="img" aria-label={STATE_WORDS[r.state]} />
      <div class="atom-row-body">
        <div class="atom-row-head">
          <strong>{r.label}</strong>
          <span data-testid={`atom-text-${r.id}`}>{r.text}</span>
        </div>
        {r.bar !== null && r.state !== 'done' && (
          <div class={`war-bar ${r.state === 'wait' ? 'warn' : 'good'}`}>
            <span style={{ width: `${Math.max(0, Math.min(100, r.bar * 100))}%` }} />
          </div>
        )}
        {r.reason && (
          <p class={`atom-why ${r.state === 'wait' ? 'war-warn' : 'muted'}`} data-testid={`atom-why-${r.id}`}>
            {r.reason}
            {/[.!?]$/.test(r.reason) ? '' : '.'}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * A button held for three seconds to commit (M40 call 20): a bar fills while the pointer is down on it,
 * and letting go (or sliding off it, or the touch being taken over) puts it back to nothing. Space and
 * Enter held do the same. It works by mouse, finger and pen alike (pointer events), and the game keeps
 * the press in `atomUi.hold` so a test can read how far it has got.
 */
export function HoldButton({
  game,
  testid,
  label,
  disabled,
  title,
  onDone,
}: {
  game: Game;
  testid: string;
  label: string;
  disabled: boolean;
  title?: string;
  onDone: () => void;
}) {
  const [elapsed, setElapsed] = useState<number | null>(null);
  const start = useRef(0);
  const raf = useRef(0);
  const live = useRef(false);
  const done = useRef(onDone);
  done.current = onDone;
  const timer = useRef(0);
  const stop = () => {
    live.current = false;
    cancelAnimationFrame(raf.current);
    clearTimeout(timer.current);
    game.atomUi.holdEnd();
    setElapsed(null);
  };
  const commit = () => {
    stop();
    // (The card is about to be replaced by the launch's: its buttons stay inert until this press is let go.)
    game.atomUi.commitPress();
    done.current();
  };
  // The bar is drawn a frame at a time, but the hold is also timed on a timer of its own: a window whose
  // frames are slow (a busy page, software drawing) still commits at three seconds, not at the next frame.
  const frame = () => {
    if (!live.current) return;
    const e = performance.now() - start.current;
    if (e >= HOLD_MS) return commit();
    setElapsed(e);
    raf.current = requestAnimationFrame(frame);
  };
  const due = () => {
    if (!live.current) return;
    const left = HOLD_MS - (performance.now() - start.current);
    if (left <= 0) commit();
    else timer.current = window.setTimeout(due, Math.max(16, left));
  };
  const begin = () => {
    if (disabled || live.current) return;
    live.current = true;
    start.current = performance.now();
    game.atomUi.holdBegin(testid, start.current);
    setElapsed(0);
    raf.current = requestAnimationFrame(frame);
    timer.current = window.setTimeout(due, HOLD_MS);
  };
  // A button that gets disabled mid-hold (the silo closes, the war pauses) gets no pointer-up: the hold ends.
  useEffect(() => {
    if (disabled && live.current) stop();
  }, [disabled]);
  // A button taken off the screen mid-hold must not leave the frame loop running.
  useEffect(
    () => () => {
      live.current = false;
      cancelAnimationFrame(raf.current);
      game.atomUi.holdEnd();
    },
    [game],
  );
  const pressed = elapsed !== null;
  return (
    <button
      class={`btn danger launch-hold ${pressed ? 'holding' : ''}`}
      data-testid={testid}
      disabled={disabled}
      title={title}
      aria-label={`${label}: hold for ${HOLD_MS / 1000} seconds`}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        begin();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onPointerLeave={stop}
      // A mouse that slides off fires a leave; a finger never does (a touch is captured by the button it
      // touched until it lifts), so every move asks whether the pointer is still over the button.
      onPointerMove={(e) => {
        if (live.current && !pointerInside(e.currentTarget.getBoundingClientRect(), e.clientX, e.clientY))
          stop();
      }}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        const k = holdKey(e);
        // (Every keydown of Space or Enter, the auto-repeat of a held one too, is the hold's: left alone
        // the repeats reach the window's Space and flip the game between paused and running.)
        if (k.swallow) {
          e.preventDefault();
          e.stopPropagation();
        }
        if (k.begin) begin();
      }}
      onKeyUp={(e) => {
        if (holdKey(e).swallow) stop();
      }}
      onBlur={stop}
    >
      <span class="launch-hold-fill" style={{ width: `${holdFraction(elapsed ?? 0) * 100}%` }} />
      <span class="launch-hold-label">{pressed ? `Keep holding… ${holdSeconds(elapsed!)}` : label}</span>
    </button>
  );
}

/** The launch card: who to aim at, what it costs the city, and the held button that commits. */
export function LaunchCard({ game, again }: { game: Game; again: boolean }) {
  const a = game.world.stats.war!.atom!;
  const act = useAct(game);
  const [chosen, setChosen] = useState<number | null>(null);
  const rows = targetRows(a);
  const target = defaultTarget(a, chosen ?? a.launch?.to ?? null);
  const picked = rows.find((r) => r.id === target);
  // In a shared city only the host launches: the room refuses a guest, so the button says so before the hold.
  const guestWhy = launchGuestWhy(!!game.net && !game.net.session.isHost);
  const blocked =
    guestWhy ?? a.launchWhy ?? (target === null ? 'No neighbour is in a total war with the city' : null);
  return (
    <section class="atom-launch dip-neighbour" data-testid="atom-launch-card">
      <h4>{again ? 'Send the bomb again' : 'Launch the bomb'}</h4>
      <p class="muted">Aim it at a neighbour the city is in a total war with:</p>
      <div class="atom-targets" role="radiogroup" aria-label="Target" data-testid="atom-targets">
        {rows.length === 0 && <p class="muted">The city has no neighbours to aim at.</p>}
        {rows.map((r) => (
          <div key={r.id} class={`atom-target ${r.why ? 'greyed' : ''}`}>
            <button
              class={`btn small ${target === r.id ? 'active' : ''}`}
              role="radio"
              aria-checked={target === r.id}
              disabled={!!r.why || game.readOnly}
              data-testid={`atom-target-${r.id}`}
              onClick={() => setChosen(r.id)}
            >
              {r.label}
            </button>
            {r.why && (
              <small class="muted" data-testid={`atom-target-why-${r.id}`}>
                {r.why}
              </small>
            )}
          </div>
        ))}
      </div>
      <p class="atom-warning">If the bomb leaves:</p>
      <ul class="atom-consequences" data-testid="atom-consequences">
        {consequences().map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      {!again && <p class="muted">{launchTerms()}</p>}
      {blocked && (
        <p class="war-warn" data-testid="atom-launch-why">
          {blocked}.
        </p>
      )}
      {/* (Sending it again is as final as the first launch: it is held the same three seconds.) */}
      <HoldButton
        game={game}
        testid={again ? 'atom-send-again' : 'launch-hold'}
        label={
          again
            ? `Hold to send it again${picked ? ` at ${picked.name}` : ''}`
            : picked
              ? `Hold to launch at ${picked.name}`
              : 'Hold to launch'
        }
        disabled={game.readOnly || !!blocked || target === null}
        title={blocked ?? undefined}
        onDone={() => {
          if (target !== null)
            act(
              { type: 'launchBomb', to: target },
              again
                ? `The bomb is sent again at ${picked?.name ?? 'the target'}`
                : `The launch at ${picked?.name ?? 'the target'} is being prepared`,
            );
        }}
      />
    </section>
  );
}

/**
 * False for the first `ms` after mounting (a button that appears under a pointer must not take the click that was
 * meant for what stood there before; `AtomUi.guarded` holds it for as long as the press that caused it is down).
 */
function useArmed(ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return on;
}

/** Call a launch off (half the price back). Inert for the first moments and while a press that started the launch is still down: see `useArmed`. */
function CancelLaunch({ game }: { game: Game }) {
  const act = useAct(game);
  const armed = useArmed(400);
  // A launch held on has just replaced the button under the finger with this one: its release is not a press.
  const guarded = game.atomUi.guarded(performance.now());
  return (
    <button
      class="btn"
      data-testid="atom-cancel-launch"
      disabled={game.readOnly || !armed || guarded}
      onClick={() => act({ type: 'cancelLaunch' }, 'The launch is called off')}
    >
      Cancel launch (half refunded)
    </button>
  );
}

function Pips({ n }: { n: number }) {
  return (
    <span class="atom-pips" role="img" aria-label={`${n} of ${PIPS} steps`}>
      {Array.from({ length: PIPS }, (_, k) => (
        <i key={k} class={k < n ? 'on' : ''} />
      ))}
    </span>
  );
}

function RaceLine({ r }: { r: RaceRow }) {
  return (
    <li
      class={`atom-race-row ${r.who} ${r.ready ? 'ready' : ''} ${r.fired ? 'fired' : ''}`}
      data-testid={`atom-race-${r.key}`}
    >
      <div class="atom-race-head">
        <strong>
          {r.name}
          {r.who === 'city' ? ' (you)' : ''}
        </strong>
        {r.first && (
          <small class="atom-first" data-testid="atom-first">
            first to the bomb
          </small>
        )}
        <Pips n={r.pips} />
      </div>
      <div class="atom-race-body">
        <span>{r.fired ? 'Bomb fired' : r.stageName}</span>
        {r.fuel !== null && (
          <>
            <div class="war-bar good atom-fuel">
              <span style={{ width: `${r.fuel}%` }} />
            </div>
            <small class="muted">{r.fuel} % fuel</small>
          </>
        )}
        {r.launchIn !== null && (
          <small class="dip-bad" data-testid="atom-race-leaves">
            {launchWords(r.launchIn)}
          </small>
        )}
      </div>
    </li>
  );
}

/** The fallout in the city and what to do about it: the closed ground, the crews, and the clean-up tool. */
function FalloutBlock({ game }: { game: Game }) {
  const [f, setF] = useState<FalloutQuery['summary']>(null);
  useEffect(() => {
    let alive = true;
    const ask = () =>
      void game.client.query<FalloutQuery>({ type: 'fallout' }).then((r) => {
        if (alive) setF(r.summary);
      });
    ask();
    const timer = setInterval(ask, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [game]);
  if (!f) return null;
  const lines = falloutLines(f, falloutYears(f.peak));
  const full = f.jobs.length >= 3;
  return (
    <section class="atom-fallout dip-neighbour" data-testid="atom-fallout">
      <h4>Fallout</h4>
      <p data-testid="atom-fallout-closed">{lines.closed}.</p>
      {lines.years && <p class="muted">{lines.years}.</p>}
      <p class="muted" data-testid="atom-fallout-crews">
        {lines.crews}. {lines.price}.
      </p>
      <div class="dip-actions">
        <button
          class="btn small"
          data-testid="atom-cleanup"
          disabled={game.readOnly || full || f.closedArea <= 0}
          title={full ? 'Three crews are out already' : 'Click the fallout map to send a crew'}
          onClick={() => {
            game.tools.use('cleanup');
          }}
        >
          Clean up…
        </button>
        <button
          class="btn small"
          data-testid="atom-show-map"
          onClick={() => game.overlay.set(game.overlay.active === 'radiation' ? null : 'radiation')}
        >
          {game.overlay.active === 'radiation' ? 'Hide the fallout map' : 'Show the fallout map'}
        </button>
      </div>
    </section>
  );
}

/** What the toast says once the dome is set to stop the bomb (a refusal says its own reason instead). */
const RAISED = 'The dome shield is set to stop the bomb';

/** A bomb on its way, first in the Bomb tab: the clock, the dome in a sentence and the way to raise it. */
function InboundSection({ game }: { game: Game }) {
  const act = useAct(game);
  const w = game.world.stats.war!;
  const c = countdown(w.atom!.inbound!, game.world.displayTick, w.supers?.dome ?? null, !!w.supers?.blackout);
  return (
    <section class="atom-inbound dip-neighbour" data-testid="atom-tab-inbound">
      <h4>
        Atom bomb from {c.from} lands in <span data-testid="atom-tab-eta">{c.eta}</span>
      </h4>
      <p class={`atom-dome ${c.dome.tone}`} data-testid="atom-tab-dome">
        {c.dome.text}
      </p>
      {c.shelter && <p class="muted">{c.shelter}</p>}
      {c.dome.raise && (
        <button
          class="btn small atom-raise"
          data-testid="atom-tab-raise-dome"
          disabled={game.readOnly}
          title="Sets the dome to “Superweapons only”, which stops an atom bomb"
          onClick={() => act({ type: 'setDome', mode: 'super' }, RAISED)}
        >
          Raise the dome now
        </button>
      )}
    </section>
  );
}

/**
 * Stop the bomb's build, after asking: the build is thrown away (a restart begins from nothing and pays the
 * first instalment again), which is no small thing at instalment ten of twelve.
 */
export function StopBuilding({ game, bomb }: { game: Game; bomb: NonNullable<AtomSummary['bomb']> }) {
  const act = useAct(game);
  const [asking, setAsking] = useState(false);
  return (
    <div class="atom-actions">
      <button
        class="btn"
        data-testid="atom-stop"
        disabled={game.readOnly}
        title="Everything built so far is lost"
        onClick={() => setAsking(true)}
      >
        Stop building…
      </button>
      <p class="muted">What has been built is lost, and what was paid stays spent.</p>
      {asking && (
        <div class="dip-confirm" role="alertdialog" data-testid="atom-stop-confirm">
          <p data-testid="atom-stop-terms">{stopTerms(bomb)}</p>
          <div class="dip-actions">
            <button
              class="btn danger"
              data-testid="atom-stop-yes"
              onClick={() => {
                setAsking(false);
                act({ type: 'cancelBomb' }, 'The bomb is no longer being built');
              }}
            >
              Stop and lose it
            </button>
            <button class="btn" data-testid="atom-stop-no" onClick={() => setAsking(false)}>
              Keep building
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** The war room's Bomb tab (M40). */
export function Bomb() {
  const game = useGameUpdates(300);
  const act = useAct(game);
  const w = game.world.stats.war;
  const a = w?.atom;
  if (!w || !a) return null;
  const st = game.world.stats;
  const rows = ladderRows(a);
  const neighbours = st.region.neighbours;
  const race = raceRows(
    st.cityName,
    a,
    neighbours.map((n) => ({
      id: n.id,
      name: n.name,
      ...(n.player
        ? { player: { slot: n.player.slot, ...(n.player.atom ? { atom: n.player.atom } : {}) } }
        : {}),
    })),
    game.atomRegion.atoms,
  );
  const mySlot = game.region?.slot;
  const nameOf = (slot: number) =>
    slot === mySlot ? st.cityName : (neighbours.find((n) => n.player?.slot === slot)?.name ?? 'another city');
  const record = markLines(game.atomRegion.atoms, nameOf);
  const idle = !a.bomb && !a.have && !a.launch && !a.fired;
  const raced = a.plantState !== 'none' || a.fuel > 0;
  const prep = a.launch;
  return (
    <div class="dip atom" data-testid="atom">
      {a.inbound && <InboundSection game={game} />}
      <p data-testid="atom-stage">
        <strong>{headline(a)}</strong>
        {a.first && (
          <small class="atom-first" data-testid="atom-first-me">
            {' '}
            · first to the bomb in the region
          </small>
        )}
      </p>
      {!a.allowed && a.rules && (
        <p class="war-warn" data-testid="atom-rules">
          {a.rules}.
        </p>
      )}
      <ol class="atom-ladder" data-testid="atom-ladder">
        {rows.map((r) => (
          <Rung key={r.id} r={r} />
        ))}
      </ol>

      {/* The bomb's build: started once the fuel and the silo are there, stopped at any time. */}
      {idle && raced && !a.fired && (
        <div class="atom-actions" data-testid="atom-build-card">
          <button
            class="btn"
            data-testid="atom-build"
            disabled={game.readOnly || !!a.buildWhy}
            title={a.buildWhy ?? undefined}
            onClick={() => act({ type: 'buildBomb' }, 'The bomb is being built')}
          >
            Build the bomb
          </button>
          <p class="muted">{buildTerms()}</p>
        </div>
      )}
      {a.bomb && <StopBuilding game={game} bomb={a.bomb} />}

      {/* A bomb in the silo: choose a target and hold the button. */}
      {a.have && !prep && !a.fired && <LaunchCard game={game} again={false} />}

      {/* A launch under way: how far it is, the room's last word, and the way out. */}
      {prep && !a.fired && (
        <section class="atom-launch dip-neighbour" data-testid="atom-prep-card">
          <h4>{prep.ready ? 'Launch prepared' : 'Preparing the launch'}</h4>
          <p>
            {prep.ready
              ? `The bomb is ready to leave for ${prep.name}.`
              : `The bomb leaves for ${prep.name} by itself when the bar is full.`}
          </p>
          {prep.refused && (
            <p class="dip-why" role="alert" data-testid="atom-last-answer">
              The region’s last answer: {prep.refused}
            </p>
          )}
          {prep.sent && (
            <p class="muted" data-testid="atom-in-room">
              The strike is with the region’s room, which has to agree. It can’t be called off meanwhile.
            </p>
          )}
          {!prep.sent && (
            <div class="dip-actions">
              <CancelLaunch game={game} />
            </div>
          )}
          {prep.ready && !prep.sent && <LaunchCard game={game} again />}
        </section>
      )}

      {a.fired && (
        <p class="muted" data-testid="atom-fired">
          The one atom bomb has been used. There is only ever one.
        </p>
      )}

      {a.impact && (
        <p class="muted" data-testid="atom-impact">
          The last bomb to land here: {a.impact.fled.toLocaleString('en-US')} residents have left the city;{' '}
          {a.impact.levelled.toLocaleString('en-US')} buildings were levelled.
        </p>
      )}

      {race.length > 0 && (
        <section class="atom-race" data-testid="atom-race">
          <h4>The race</h4>
          <ul>
            {race.map((r) => (
              <RaceLine key={r.key} r={r} />
            ))}
          </ul>
        </section>
      )}
      {record.length > 0 && (
        <section data-testid="atom-record">
          <h4>The region’s record</h4>
          <ul class="dip-log">
            {record.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </section>
      )}
      {a.fallout && <FalloutBlock game={game} />}
    </div>
  );
}

/** The card for a bomb on its way to the city (M40): the clock, the dome, the shelters and what can be done. */
export function AtomCountdown() {
  const game = useGameUpdates(500);
  // (A city with no bomb in the air costs one slow check; the clock below ticks at eight a second.)
  if (!game.world.stats.war?.atom?.inbound || game.inMenu() || game.readOnly || game.viewing) return null;
  return <CountdownCard />;
}

function CountdownCard() {
  const game = useGameUpdates(120);
  const act = useAct(game);
  const w = game.world.stats.war;
  const inbound = w?.atom?.inbound;
  if (!w || !inbound) return null;
  // On a narrow window the war room's Bomb tab fills the screen and says the same (its first section is this
  // countdown), so the card steps aside for it.
  const width = typeof document === 'undefined' ? undefined : document.getElementById('ui')?.dataset.width;
  const roomOpen = game.panel === 'war' && game.warTab === 'atom';
  if ((width === 'xs' || width === 's') && roomOpen) return null;
  return (
    <CountdownView
      c={countdown(inbound, game.world.displayTick, w.supers?.dome ?? null, !!w.supers?.blackout)}
      canLook={game.atomUi.canLook}
      roomOpen={roomOpen}
      onShow={() => game.flyTo({ x: inbound.x, z: inbound.z })}
      onRaise={() => act({ type: 'setDome', mode: 'super' }, RAISED)}
      onLook={() => game.atomUi.look()}
      onRoom={() => game.openWarRoom('atom')}
    />
  );
}

export interface CountdownViewProps {
  c: Countdown;
  /** The effects have a missile to look at. */
  canLook: boolean;
  /** The war room is open on the Bomb tab already. */
  roomOpen: boolean;
  onShow(): void;
  onRaise(): void;
  onLook(): void;
  onRoom(): void;
}

/**
 * The card itself, from what `countdown` made. A screen reader is told once (the hidden alert, whose words
 * hold no clock and no figure, so they change only when the dome's state does); the clock is drawn
 * outside any live region, since it moves eight times a second.
 */
export function CountdownView({ c, canLook, roomOpen, onShow, onRaise, onLook, onRoom }: CountdownViewProps) {
  return (
    <div
      class="atom-countdown panel"
      data-testid="atom-countdown"
      role="group"
      aria-label="An atom bomb is on its way"
    >
      <p class="atom-announce" role="alert" data-testid="atom-announce">
        {c.announce}
      </p>
      <header>
        <strong data-testid="atom-from">Atom bomb from {c.from}</strong>
        <span class="atom-eta" data-testid="atom-eta" title="Game time until it lands">
          {c.eta}
        </span>
      </header>
      <p class="muted" data-testid="atom-play-left">
        Lands in about {c.playLeft} at normal speed.
      </p>
      <p data-testid="atom-aim">
        {c.aim}.{' '}
        <button class="link" data-testid="atom-show" onClick={onShow}>
          Show where
        </button>
      </p>
      <p class={`atom-dome ${c.dome.tone}`} data-testid="atom-dome">
        {c.dome.text}
      </p>
      {c.shelter && (
        <p class="muted" data-testid="atom-shelters">
          {c.shelter}
        </p>
      )}
      <div class="atom-actions">
        {c.dome.raise && (
          <button
            class="btn small atom-raise"
            data-testid="atom-raise-dome"
            title="Sets the dome to “Superweapons only”, which stops an atom bomb"
            onClick={onRaise}
          >
            Raise the dome now
          </button>
        )}
        {canLook && (
          <button class="btn small" data-testid="atom-look" onClick={onLook}>
            Look at the missile
          </button>
        )}
        {!roomOpen && (
          <button class="btn small" data-testid="atom-open-room" onClick={onRoom}>
            Open the war room
          </button>
        )}
      </div>
    </div>
  );
}

/** What a bomb left behind: the blast's toll in the plain count, or the dome's save; read, then closed. */
export function AtomAftermath() {
  const game = useGameUpdates(300);
  const after = game.atomUi.after;
  if (!after || game.inMenu() || game.readOnly || game.viewing) return null;
  return (
    <div class="atom-after panel" data-testid="atom-after" role="dialog" aria-label={after.title}>
      <h2>{after.title}</h2>
      <p data-testid="atom-after-text">{after.text}</p>
      <div class="dip-actions">
        {after.kind === 'hit' && (
          <button
            class="btn small"
            data-testid="atom-after-map"
            onClick={() => {
              game.overlay.set('radiation');
              game.atomUi.dismissAfter();
            }}
          >
            Show the fallout map
          </button>
        )}
        <button
          class="btn small active"
          data-testid="atom-after-ok"
          onClick={() => game.atomUi.dismissAfter()}
        >
          OK
        </button>
      </div>
    </div>
  );
}

/** While the clean-up tool is out: what it does, the price, and the way to put it down (a finger has no Escape). */
export function CleanupBar() {
  const game = useGameUpdates(300);
  const [price, setPrice] = useState<{ price: number; relief: boolean } | null>(null);
  const on = game.tools.activeId === 'cleanup';
  useEffect(() => {
    if (!on) return;
    let alive = true;
    void game.client.query<FalloutQuery>({ type: 'fallout' }).then((r) => {
      if (alive && r.summary) setPrice({ price: r.summary.price, relief: r.summary.relief });
    });
    return () => {
      alive = false;
    };
  }, [game, on]);
  if (!on) return null;
  return (
    <div class="cleanup-bar panel" data-testid="cleanup-bar" role="status">
      <span>
        Click the fallout map to send a clean-up crew
        {price ? `: ${moneyWords(price.price)}${price.relief ? ' (relief crews)' : ''} each` : ''}.
      </span>
      <button class="btn small" data-testid="cleanup-done" onClick={() => game.tools.use('select')}>
        Done
      </button>
    </div>
  );
}
