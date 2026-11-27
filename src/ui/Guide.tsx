import { useEffect, useRef, useState } from 'preact/hooks';
import { useGameUpdates } from './hooks';
import { touchScreen, wordsFor } from '../client/tutorial';
import { isPhone } from '../game';

/** Pulse the button a tutorial step points at. */
function useHighlight(testid: string | undefined) {
  useEffect(() => {
    if (!testid) return;
    // A data attribute rather than a class: Preact owns the class list and may rewrite it. Followed
    // as the layout changes (M49: on a phone the button is in a sheet until Build or More opens it).
    let el: Element | null = null;
    const mark = () => {
      const now = shownTarget(testid);
      if (now === el) return;
      el?.removeAttribute('data-guide');
      el = now;
      el?.setAttribute('data-guide', '');
    };
    mark();
    const timer = setInterval(mark, 300);
    return () => {
      clearInterval(timer);
      el?.removeAttribute('data-guide');
    };
  }, [testid]);
}

/** Controls that live on a panel's tab, and the tab that shows them. */
const IN_TAB: [RegExp, string][] = [
  [/^tax-/, 'budget-tab-taxes'],
  [/^funding-/, 'budget-tab-funding'],
  [/^loan-/, 'budget-tab-loans'],
];

/**
 * The button a step points at, or, on a phone (M49), the bar's button that opens the sheet it's in:
 * Build for a civic category, More for districts, terrain, disasters, photo mode and redo.
 */
export function shownTarget(testid: string): Element | null {
  const el = document.querySelector(`[data-testid="${testid}"]`);
  const r = el?.getBoundingClientRect();
  if (el && r && r.width && r.height) return el;
  // A control on a panel's tab that isn't showing: the tab (phase 6 end: the Taxes card pointed at the
  // R1 slider while the budget showed its Overview, so no arrow was drawn at all).
  const tab = IN_TAB.find(([re]) => re.test(testid))?.[1];
  const tabEl = tab ? document.querySelector(`[data-testid="${tab}"]`) : null;
  if (tabEl?.getBoundingClientRect().width) return tabEl;
  // A top-bar button folded into its More menu (a narrow window, a phone): the More button (phase 6
  // end: the Advisors card had no arrow on a phone).
  if (testid.startsWith('open-') && testid !== 'open-more') {
    const more = document.querySelector('[data-testid="open-more"]');
    if (more?.getBoundingClientRect().width) return more;
  }
  if (document.getElementById('ui')?.dataset.phone === undefined) return el;
  const MORE = ['tool-district', 'tool-terrain', 'tool-disasters', 'tool-photo', 'tool-redo'];
  const via = MORE.includes(testid) ? 'tool-more' : testid.startsWith('tool-') ? 'tool-build' : null;
  return via ? document.querySelector(`[data-testid="${via}"]`) : el;
}

/**
 * An arrow at the button to press (M42), kept beside it as the layout moves (a panel opening, the
 * window resized); hidden when the button isn't on screen (folded into a menu on a narrow window).
 */
function GuidePointer({ testid }: { testid: string }) {
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    const place = () => {
      const el = shownTarget(testid);
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
    (!game.screen || (!!step.screen && game.screen === step.screen)) &&
    (!game.panel ||
      (!!step.panel && game.panel === step.panel) ||
      // A lesson's last card shows whatever panel the lesson left open.
      (!!card?.lesson && card.index === card.total - 1));
  useHighlight(visible ? step.target : undefined);
  // On a phone (phase 6 end) the card covered half the map held upright, and sideways the Build sheet's
  // buttons: it folds to one line once the player acts on it (picks a tool, or opens one of the bar's
  // sheets) or taps Hide, and unfolds for the next card or at a tap. A first problem's card folds only
  // for a sheet (its arrow's button is in one).
  const fold = useRef<{ id: string | undefined; tool: string; open: boolean | null }>({
    id: undefined,
    tool: 'select',
    open: null,
  });
  const [, redraw] = useState(0);
  // (The bar's sheets are the toolbar's own state: a phone looks for them a few times a second.)
  useEffect(() => {
    if (!isPhone()) return;
    const timer = setInterval(() => redraw((n) => n + 1), 300);
    return () => clearInterval(timer);
  }, []);
  if (fold.current.id !== step?.id) fold.current = { id: step?.id, tool: game.tools.activeId, open: null };
  const setOpen = (open: boolean) => {
    fold.current.open = open;
    redraw((n) => n + 1);
  };
  if (!visible || !card) return null;
  const k = card.index;
  const kicker = card.lesson
    ? `Lesson · ${card.lesson.title} · ${k + 1} of ${card.total}`
    : card.event
      ? 'Tutorial · something to know'
      : `Tutorial · step ${k + 1} of ${card.total}`;
  const phone = isPhone();
  // Acting on the card: one of the bar's sheets open (Build, More, Maps: the Coverage card covered the
  // Fire map's button), or a tool picked since it came.
  const sheet =
    phone &&
    !!document.querySelector('[data-testid=maps-menu], [data-testid=build-sheet], [data-testid=more-sheet]');
  const tool = game.tools.activeId !== 'select' && game.tools.activeId !== fold.current.tool;
  const acting = sheet || (tool && !card.event);
  const folded = phone && (fold.current.open === null ? acting : !fold.current.open);
  // Beside the panel the step teaches, or (a lesson's last card) whatever panel the lesson left open:
  // over it, it covered the panel's tabs (phase 6 end: the Workshop lesson's "Lesson done").
  const beside =
    (!!step.panel && game.panel === step.panel) ||
    (!!card.lesson && card.index === card.total - 1 && !!game.panel);
  if (folded)
    return (
      <>
        {step.target && <GuidePointer testid={step.target} />}
        <button
          class="guide guide-folded panel"
          data-testid="tutorial"
          data-step={step.id}
          data-folded=""
          aria-label={`${kicker}: ${step.title}. Show the card`}
          onClick={() => setOpen(true)}
        >
          <span class="guide-kicker">{kicker}</span>
          <strong>{step.title}</strong>
          <span class="guide-unfold" aria-hidden="true">
            ▾
          </span>
        </button>
      </>
    );
  return (
    <>
      {step.target && <GuidePointer testid={step.target} />}
      <div
        class={`guide panel ${card.event ? 'guide-event' : ''} ${beside ? 'beside-panel' : ''} ${step.screen && game.screen === step.screen ? 'over-screen' : ''}`}
        data-testid="tutorial"
        data-step={step.id}
        role="dialog"
        aria-label="Tutorial"
      >
        {phone && (
          <button
            class="guide-fold"
            data-testid="tutorial-fold"
            aria-label="Hide the card"
            onClick={() => setOpen(false)}
          >
            ▴
          </button>
        )}
        <div class="guide-kicker">{kicker}</div>
        <h3>{step.title}</h3>
        <p>{wordsFor(step, touchScreen())}</p>
        {!card.event && (
          <div class="guide-progress" aria-hidden="true">
            {Array.from({ length: card.total }, (_, i) => (
              <span key={i} class={i < k ? 'done' : i === k ? 'now' : ''} />
            ))}
          </div>
        )}
        <div class="guide-actions">
          {card.lesson ? (
            k === card.total - 1 ? (
              <>
                <button class="btn" data-testid="lesson-keep" onClick={() => game.tutorialNext()}>
                  Keep playing
                </button>
                <button class="btn active" data-testid="lesson-learn" onClick={() => game.backToLearn()}>
                  Back to Learn
                </button>
              </>
            ) : (
              <>
                <span class="guide-leave">
                  <button class="btn quiet" data-testid="lesson-leave" onClick={() => game.endLesson()}>
                    Leave lesson
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
                    Next
                  </button>
                )}
              </>
            )
          ) : card.event ? (
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
      <p>{wordsFor(tip, touchScreen())}</p>
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
