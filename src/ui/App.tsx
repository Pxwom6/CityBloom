import { RegionPanel } from './Region';
import { RoomPanel } from './Friends';
import { useEffect, useState } from 'preact/hooks';
import { isPhone, type Game } from '../game';
import { DebugPanel } from './DebugPanel';
import { GameContext } from './hooks';
import { TopBar } from './TopBar';
import { MapLegend, RadiationTip, ToolHintLabel, ToolQuestionCard, Toolbar } from './Toolbar';
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
import { RoomIntroCard } from './RoomIntro';
import { ShortcutSheet } from './ShortcutSheet';
import { HistoryPanel } from './History';
import { PhotoMode } from './PhotoMode';
import { GoalsPanel, ScenarioBrief, ScenarioEnd } from './Scenario';
import { DistrictsPanel } from './Districts';
import { WarRoomPanel } from './Military';
import { FallenCard } from './Diplomacy';
import { BattleBar, LiveBar, ViewerBar } from './Battle';
import { BattleMapPanel } from './BattleMap';
import { AtomAftermath, AtomCountdown, CleanupBar } from './Atom';
import { EditorApp } from './Editor';
import { typingIn } from '../client/keys';
import { exportSave } from '../client/saves';

function Shortcuts({ game }: { game: Game }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typingIn(e)) return;
      if (game.screen) return;
      // The active tool has first claim on a key (its listener runs first and marks what it
      // handled): with the road tool open, G toggles grid snap, not the scenario's goals.
      if (e.defaultPrevented) return;
      if (e.code === 'Backquote') game.toggleDebug();
      else if (e.code === 'Space') {
        e.preventDefault();
        game.setSpeed(game.speed === 0 ? 1 : 0);
      } else if (e.code === 'Digit1') game.setSpeed(1);
      else if (e.code === 'Digit2') game.setSpeed(2);
      else if (e.code === 'Digit3') game.setSpeed(3);
      // The war room (M34): Shift+M, before M's budget (which ignores Shift).
      else if (e.code === 'KeyM' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (game.world.stats.war?.hq != null) game.openPanel('war');
        else if (game.world.stats.war) game.toast('Build a military HQ to open the war room', 'info', 3000);
      } else if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey) game.openPanel('budget');
      else if (e.code === 'KeyJ' && !e.ctrlKey && !e.metaKey) game.openPanel('advisors');
      else if (e.code === 'KeyN' && e.shiftKey && !e.ctrlKey && !e.metaKey) game.openPanel('region');
      // The battle map (M39), with a live battle to command or watch; O is also the road tool's one-way
      // toggle, which has first claim on it.
      else if (e.code === 'KeyO' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey)
        game.toggleBattleMap();
      else if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey) game.openPanel('notifications');
      else if (e.code === 'KeyP' && !e.ctrlKey && !e.metaKey) game.openPanel('city');
      else if (e.code === 'KeyY' && !e.ctrlKey && !e.metaKey) game.openPanel('history');
      else if (e.code === 'KeyG' && !e.ctrlKey && !e.metaKey && !e.shiftKey && game.world.stats.scenario)
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
  // The map editor (M24) has its own bars; on a phone it says plainly it needs a bigger screen (M49).
  if (game.mode === 'editor')
    return (
      <GameContext.Provider value={game}>
        {isPhone() ? <PhoneEditorNotice /> : <EditorApp />}
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
      {/* Watching a battle (M35), the viewer bar takes the visit banner's place. */}
      {game.readOnly ? !game.viewing && <VisitBanner /> : <Toolbar />}
      <ToolHintLabel />
      <ToolQuestionCard />
      <Inspector />
      <MapLegend />
      <RadiationTip />
      <BudgetPanel />
      <AdvisorsPanel />
      <NotificationsPanel />
      <CityPanel />
      <HistoryPanel />
      <GoalsPanel />
      <DistrictsPanel />
      <RegionPanel />
      <WarRoomPanel />
      <FallenCard />
      <BattleBar />
      <LiveBar />
      <BattleMapPanel />
      <AtomCountdown />
      <AtomAftermath />
      <CleanupBar />
      <ViewerBar />
      <RoomPanel />
      <MilestoneBanner />
      <ThoughtsFeed />
      <MoneyBanner />
      <BackupCard />
      <TutorialCard />
      <TipCard />
      <RoomIntroCard />
      <ShortcutSheet />
      <ScenarioBrief />
      <ScenarioEnd />
      <ToastLayer />
      <Shell />
    </GameContext.Provider>
  );
}

/**
 * The map editor on a phone (M49): painting ground, water and forest by hand at map scale needs a
 * bigger screen, so it says so rather than showing its bars squeezed.
 */
function PhoneEditorNotice() {
  return (
    <div class="modal-backdrop" data-testid="editor-phone">
      <div class="modal panel">
        <h2>The map editor needs a bigger screen</h2>
        <p>
          Painting land, water and forest across a whole map takes a tablet or a computer. Make your map
          there, and your cities on it play on a phone too.
        </p>
        <div class="modal-actions">
          <button
            class="btn active"
            data-testid="editor-phone-back"
            onClick={() => (location.href = location.pathname)}
          >
            Back to the main menu
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastLayer() {
  useGameUpdates(100);
  return <Toasts />;
}

/**
 * An iPhone's suggestion to export a backup (M49): Safari may clear a site's saved cities after a
 * few weeks unused, and a file in Files is safe from that.
 */
function BackupCard() {
  const game = useGameUpdates(1000);
  if (!game.backupNudge || game.screen) return null;
  return (
    <div class="backup-card panel" data-testid="backup-card" role="status">
      <p>
        Safari may clear saved cities if Citybloom isn’t opened for a few weeks. Keep a copy of{' '}
        <strong>{game.world.stats.cityName}</strong> in Files?
      </p>
      <div class="actions">
        <button class="btn" data-testid="backup-later" onClick={() => game.backedUp()}>
          Not now
        </button>
        <button
          class="btn active"
          data-testid="backup-export"
          onClick={async () => {
            if ((await exportSave(await game.client.save())) !== 'cancelled') game.backedUp();
          }}
        >
          Export a copy
        </button>
      </div>
    </div>
  );
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

/** Looking round a neighbour's city (M32): read-only, with the way back. */
function VisitBanner() {
  const game = useGameUpdates(1000);
  return (
    <div class="visit-banner panel" data-testid="visit-banner">
      <span>
        Visiting <strong>{game.world.stats.cityName}</strong> as it was last saved: look round, nothing can be
        changed.
      </span>
      <button class="btn" onClick={() => (history.length > 1 ? history.back() : window.close())}>
        Back to my city
      </button>
    </div>
  );
}
