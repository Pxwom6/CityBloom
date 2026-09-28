import { useState } from 'preact/hooks';
import { GoalsButton } from './Scenario';
import { dateOf, formatDate, type Speed } from '../sim/time';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';
import { WEATHER_ICON, weatherBrief, weatherLines, weatherName } from './weather';
import { IconPause, IconSpeed1, IconSpeed2, IconSpeed3 } from './icons';
import { Rci } from './Rci';
import { SystemMenu } from './SystemMenu';
import { AdvisorsButton } from './Advisors';
import { CityButton } from './CityPanel';
import { HistoryButton } from './History';
import { RegionButton } from './Region';
import { NotificationsButton } from './Notifications';

const SPEEDS: { s: Speed; label: string; Icon: typeof IconPause; key: string }[] = [
  { s: 0, label: 'Pause', Icon: IconPause, key: 'Space' },
  { s: 1, label: 'Normal speed', Icon: IconSpeed1, key: '1' },
  { s: 2, label: 'Fast', Icon: IconSpeed2, key: '2' },
  { s: 3, label: 'Fastest', Icon: IconSpeed3, key: '3' },
];

export function TopBar() {
  const game = useGameUpdates(200);
  const st = game.world.stats;
  const date = dateOf(Math.floor(game.world.displayTick));
  const WeatherIcon = WEATHER_ICON[st.weather.kind];
  const [weatherOpen, setWeatherOpen] = useState(false);
  return (
    <div class="topbar panel" data-testid="topbar">
      {st.scenario ? <GoalsButton /> : <span class="city">{st.cityName}</span>}
      <span class="divider" />
      <button
        class="stat stat-btn"
        data-testid="open-budget"
        title="Open the budget (M)"
        onClick={() => game.openPanel('budget')}
      >
        <span class="label">Treasury</span>
        <span class={`value ${st.treasury < 0 ? 'negative' : ''}`} data-testid="treasury">
          {formatMoney(st.treasury)}
        </span>
        <span class={`sub ${st.netMonthly < 0 ? 'negative' : 'positive'}`} data-testid="net-income">
          {st.netMonthly >= 0 ? '+' : ''}
          {formatMoney(st.netMonthly)}/mo
        </span>
      </button>
      <div class="stat">
        <span class="label">Population</span>
        <span class="value" data-testid="population">
          {formatNumber(st.population)}
        </span>
      </div>
      <div class="stat stat-jobs">
        <span class="label">Jobs</span>
        <span class="value" data-testid="jobs">
          {formatNumber(st.jobsFilled)} / {formatNumber(st.jobs)}
        </span>
      </div>
      <div class="stat" title="City approval: how happy residents are overall">
        <span class="label">Approval</span>
        <span class="value" data-testid="approval">
          {st.population > 0 ? `${Math.round(st.approval * 100)}%` : '—'}
        </span>
      </div>
      <Rci />
      <CityButton />
      <HistoryButton />
      <RegionButton />
      <AdvisorsButton />
      <NotificationsButton />
      <span class="divider" />
      <button
        class="stat stat-btn stat-date"
        data-testid="weather"
        aria-expanded={weatherOpen}
        title={weatherLines(st.weather).join('\n')}
        onClick={() => setWeatherOpen(!weatherOpen)}
      >
        <span class="label weather-label">
          <WeatherIcon width={13} height={13} />
          {weatherBrief(st.weather)}
        </span>
        <span class="value" data-testid="date">
          {formatDate(date)}
        </span>
      </button>
      {weatherOpen && (
        <div class="weather-pop panel" data-testid="weather-panel" role="dialog" aria-label="Weather">
          <header>
            <strong>
              <WeatherIcon width={16} height={16} /> {weatherName(st.weather.kind, st.weather.strength)}
            </strong>
            <button class="btn icon" aria-label="Close" onClick={() => setWeatherOpen(false)}>
              ×
            </button>
          </header>
          {weatherLines(st.weather).map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}
      <div class="speed" role="group" aria-label="Simulation speed">
        {SPEEDS.map(({ s, label, Icon, key }) => (
          <button
            key={s}
            class={`btn icon ${game.speed === s ? 'active' : ''}`}
            title={`${label} (${key})`}
            aria-label={label}
            data-testid={`speed-${s}`}
            onClick={() => game.setSpeed(s)}
          >
            <Icon />
          </button>
        ))}
      </div>
      <SystemMenu />
    </div>
  );
}
