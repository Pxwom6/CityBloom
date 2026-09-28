import { useEffect, useState } from 'preact/hooks';
import type { Game } from '../game';
import { DebugPanel } from './DebugPanel';
import { GameContext } from './hooks';
import { TopBar } from './TopBar';
import { MapLegend, ToolHintLabel, Toolbar } from './Toolbar';
import { Inspector } from './Inspector';
import { Toasts } from './SystemMenu';
import { formatMoney, useGameUpdates } from './hooks';
import { BudgetPanel } from './Budget';
import { AdvisorsPanel } from './Advisors';
import { NotificationsPanel } from './Notifications';
import { ThoughtsFeed } from './Thoughts';
import { CityPanel, MilestoneBanner } from './CityPanel';
import { Shell } from './Shell';
import { TipCard, TutorialCard } from './Guide';
import { ShortcutSheet } from './ShortcutSheet';
import { HistoryPanel } from './History';
import { PhotoMode } from './PhotoMode';
import { GoalsPanel, ScenarioBrief, ScenarioEnd } from './Scenario';

function Shortcuts({ game }: { game: Game }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (game.screen) return;
      if (e.code === 'Backquote') game.toggleDebug();
      else if (e.code === 'Space') {
        e.preventDefault();
        game.setSpeed(game.speed === 0 ? 1 : 0);
      } else if (e.code === 'Digit1') game.setSpeed(1);
      else if (e.code === 'Digit2') game.setSpeed(2);
      else if (e.code === 'Digit3') game.setSpeed(3);
      else if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) game.openPanel('budget');
      else if (e.code === 'KeyJ' && !e.ctrlKey && !e.metaKey) game.openPanel('advisors');
      else if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey) game.openPanel('notifications');
      else if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) game.openPanel('city');
      else if (e.code === 'KeyY' && !e.ctrlKey && !e.metaKey) game.openPanel('history');
      else if (e.code === 'KeyG' && !e.ctrlKey && !e.metaKey && game.world.stats.scenario)
        game.openPanel('goals');
      else if (e.code === 'KeyL' && !e.ctrlKey && !e.metaKey)
        game.overlay.set(game.overlay.active ? null : 'power');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);
  return null;
}

/** Whether photo mode is on, re-rendering only when that changes (the rest of the app updates itself). */
function usePhotoMode(game: Game): boolean {
  const [on, setOn] = useState(!!game.photo);
  useEffect(() => game.subscribe(() => setOn(!!game.photo)), [game]);
  return on;
}

export function App({ game }: { game: Game }) {
  const photo = usePhotoMode(game);
  // The main menu shows only itself over the backdrop map.
  if (game.mode === 'menu')
    return (
      <GameContext.Provider value={game}>
        <Shell />
        <ToastLayer />
      </GameContext.Provider>
    );
  // Photo mode shows only its own panel (M16).
  if (photo)
    return (
      <GameContext.Provider value={game}>
        <PhotoMode />
      </GameContext.Provider>
    );
  return (
    <GameContext.Provider value={game}>
      <Shortcuts game={game} />
      <TopBar />
      <DebugPanel />
      <Toolbar />
      <ToolHintLabel />
      <Inspector />
      <MapLegend />
      <BudgetPanel />
      <AdvisorsPanel />
      <NotificationsPanel />
      <CityPanel />
      <HistoryPanel />
      <GoalsPanel />
      <MilestoneBanner />
      <ThoughtsFeed />
      <MoneyBanner />
      <TutorialCard />
      <TipCard />
      <ShortcutSheet />
      <ScenarioBrief />
      <ScenarioEnd />
      <ToastLayer />
      <Shell />
    </GameContext.Provider>
  );
}

function ToastLayer() {
  useGameUpdates(100);
  return <Toasts />;
}

/** Escalating money warnings and the bankruptcy screen. */
function MoneyBanner() {
  const game = useGameUpdates(300);
  const st = game.world.stats;
  if (st.bankrupt) {
    return (
      <div class="modal-backdrop" data-testid="bankrupt">
        <div class="modal panel">
          <h2>The city is bankrupt</h2>
          <p>
            {st.cityName} ran out of money and couldn't recover in time. The regional authority has taken over
            its finances.
          </p>
          <div class="modal-actions">
            <button class="btn" data-testid="bankrupt-load" onClick={() => game.openScreen('load')}>
              Load a saved city
            </button>
            <button
              class="btn active"
              data-testid="bankrupt-menu"
              onClick={() => (location.href = location.pathname)}
            >
              Main menu
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (st.treasury < 0) {
    const left = Math.max(0, 48 - st.negativeHours);
    return (
      <div class="banner bad" data-testid="money-warning" role="alert">
        The treasury is empty ({formatMoney(st.treasury)}). Raise taxes, cut funding or take a loan:
        bankruptcy in about {left} hours.
      </div>
    );
  }
  if (st.netMonthly < 0 && st.treasury < -st.netMonthly * 3) {
    return (
      <div class="banner warn" data-testid="money-warning" role="status">
        Money is running low: at {formatMoney(st.netMonthly)} a month, the treasury lasts about{' '}
        {Math.max(0, Math.floor(st.treasury / -st.netMonthly))} months.
      </div>
    );
  }
  return null;
}
