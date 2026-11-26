import { useEffect, useState } from 'preact/hooks';
import { useGameUpdates } from './hooks';

/** Pulse the button a tutorial step points at. */
function useHighlight(testid: string | undefined) {
  useEffect(() => {
    if (!testid) return;
    // A data attribute rather than a class: Preact owns the class list and may rewrite it.
    const el = document.querySelector(`[data-testid="${testid}"]`);
    el?.setAttribute('data-guide', '');
    return () => el?.removeAttribute('data-guide');
  }, [testid]);
}

/**
 * An arrow at the button to press (M42), kept beside it as the layout moves (a panel opening, the
 * window resized); hidden when the button isn't on screen (folded into a menu on a narrow window).
 */
function GuidePointer({ testid }: { testid: string }) {
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    const place = () => {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      const r = el?.getBoundingClientRect();
      if (!r || !r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) return setAt(null);
      // Above the button when it sits low on the screen (the toolbar), below it when high (the top bar).
      const below = r.top < window.innerHeight / 2;
      setAt({ x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
    };
    place();
    const timer = setInterval(place, 250);
    return () => clearInterval(timer);
  }, [testid]);
  if (!at) return null;
  return (
    <div
      class={`guide-pointer ${at.below ? 'below' : 'above'}`}
      style={{ left: `${at.x}px`, top: `${at.y}px` }}
      data-testid="guide-pointer"
      aria-hidden="true"
    />
  );
}

/** The first-city tutorial: one step at a time, each ticking itself off when done (M42). */
export function TutorialCard() {
  const game = useGameUpdates(300);
  const card = game.tutorialCard();
  const step = card?.step;
  const visible =
    !!step &&
    game.mode === 'play' &&
    !game.screen &&
    (!game.panel || (!!step.panel && game.panel === step.panel));
  useHighlight(visible ? step.target : undefined);
  if (!visible || !card) return null;
  const k = card.index;
  return (
    <>
      {step.target && <GuidePointer testid={step.target} />}
      <div
        class={`guide panel ${card.event ? 'guide-event' : ''} ${step.panel ? 'beside-panel' : ''}`}
        data-testid="tutorial"
        data-step={step.id}
        role="dialog"
        aria-label="Tutorial"
      >
        <div class="guide-kicker">
          {card.event ? 'Tutorial · something to know' : `Tutorial · step ${k + 1} of ${card.total}`}
        </div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        {!card.event && (
          <div class="guide-progress" aria-hidden="true">
            {Array.from({ length: card.total }, (_, i) => (
              <span key={i} class={i < k ? 'done' : i === k ? 'now' : ''} />
            ))}
          </div>
        )}
        <div class="guide-actions">
          {card.event ? (
            <button class="btn active" data-testid="tutorial-next" onClick={() => game.tutorialNext()}>
              Got it
            </button>
          ) : (
            <>
              <span class="guide-leave">
                <button class="btn quiet" data-testid="tutorial-leave" onClick={() => game.leaveTutorial()}>
                  Leave for now
                </button>
                <button class="btn quiet" data-testid="tutorial-skip" onClick={() => game.endTutorial()}>
                  Skip tutorial
                </button>
              </span>
              {step.done ? (
                <>
                  <span class="guide-waiting">Waiting for you…</span>
                  <button class="btn" data-testid="tutorial-skip-step" onClick={() => game.tutorialNext()}>
                    Skip this step
                  </button>
                </>
              ) : (
                <button class="btn active" data-testid="tutorial-next" onClick={() => game.tutorialNext()}>
                  {k === card.total - 1 ? 'Finish' : 'Next'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** A contextual tip, shown once when its moment comes. */
export function TipCard() {
  const game = useGameUpdates(300);
  const tip = game.tip;
  if (!tip || game.mode !== 'play' || game.screen || game.panel) return null;
  return (
    <div class="guide tip-card panel" data-testid="tip" role="status">
      <div class="guide-kicker">Tip</div>
      <p>{tip.text}</p>
      <div class="guide-actions">
        <button class="btn quiet" data-testid="tip-off" onClick={() => game.dismissTip(true)}>
          No more tips
        </button>
        <button class="btn active" data-testid="tip-ok" onClick={() => game.dismissTip()}>
          Got it
        </button>
      </div>
    </div>
  );
}
