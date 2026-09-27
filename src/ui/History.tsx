import { useEffect, useState } from 'preact/hooks';
import { MILESTONES } from '../data/progression';
import { CHRONICLE_SERIES, type Chronicle, type SeriesKey } from '../sim/systems/chronicle';
import { MONTH_NAMES, dateOf } from '../sim/time';
import { DISASTER_INFO } from '../tools/disasterTool';
import { TimeChart, compactMoney, type TimeMarker } from './charts';
import { formatNumber, useGameUpdates } from './hooks';
import { IconHistory } from './icons';

type Range = 'all' | 'decade' | 'recent';
const RANGES: { id: Range; name: string; months: number }[] = [
  { id: 'all', name: 'Whole life', months: Infinity },
  { id: 'decade', name: '10 years', months: 120 },
  { id: 'recent', name: '2 years', months: 24 },
];

const pct = (v: number) => `${Math.round(v)}%`;
const minutes = (v: number) => `${v.toFixed(v < 10 ? 1 : 0)} min`;
const count = (v: number) =>
  Math.abs(v) >= 10_000 ? `${Math.round(v / 1000)}k` : formatNumber(Math.round(v));

interface Figure {
  title: string;
  keys: SeriesKey[];
  names?: string[];
  fmt: (v: number) => string;
  tickFmt?: (v: number) => string;
  floor?: number;
  ceil?: number;
  /** What the figure measures, in a line. */
  note: string;
}

const FIGURES: Figure[] = [
  {
    title: 'Population',
    keys: ['population'],
    fmt: formatNumber,
    tickFmt: count,
    floor: 0,
    note: 'Residents.',
  },
  {
    title: 'Approval',
    keys: ['approval'],
    fmt: pct,
    floor: 0,
    ceil: 100,
    note: 'How happy residents are overall.',
  },
  {
    title: 'Jobs',
    keys: ['jobs'],
    fmt: formatNumber,
    tickFmt: count,
    floor: 0,
    note: 'Jobs in shops and industry.',
  },
  {
    title: 'Unemployment',
    keys: ['unemployment'],
    fmt: pct,
    floor: 0,
    note: 'Share of working-age residents without a job.',
  },
  {
    title: 'Treasury',
    keys: ['treasury'],
    fmt: compactMoney,
    note: 'Money in the bank as each month closed.',
  },
  {
    title: 'Income and spending',
    keys: ['income', 'spending'],
    names: ['Income', 'Spending'],
    fmt: compactMoney,
    floor: 0,
    note: 'Per month, from the ledger (loans taken not counted as income).',
  },
  {
    title: 'Air pollution',
    keys: ['pollution'],
    fmt: pct,
    floor: 0,
    note: 'Average air pollution where people live.',
  },
  { title: 'Crime', keys: ['crime'], fmt: pct, floor: 0, note: 'Average crime where people live.' },
  {
    title: 'Traffic',
    keys: ['traffic'],
    fmt: minutes,
    floor: 0,
    note: 'Average commute, door to door; it grows as roads jam.',
  },
];

/** "Mar, Year 3" for a month index since the city began (fractional months round down). */
export function monthName(m: number): string {
  const k = Math.max(0, Math.floor(m));
  return `${MONTH_NAMES[k % 12]}, Year ${Math.floor(k / 12) + 1}`;
}

function eventLabel(e: Chronicle['events'][number]): string {
  if (e.kind === 'milestone') {
    const m = MILESTONES[e.ref as number];
    return m ? `Became a ${m.name.toLowerCase()} (${formatNumber(m.population)} residents)` : 'Milestone';
  }
  const d = DISASTER_INFO[e.ref as keyof typeof DISASTER_INFO];
  return d ? d.name : 'Disaster';
}

/** City history (M16): the city's key figures over its whole life, with its milestones and disasters. */
export function HistoryPanel() {
  const game = useGameUpdates(500);
  const [range, setRange] = useState<Range>('all');
  const [c, setC] = useState<Chronicle | null>(null);
  const open = game.panel === 'history';
  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () => void game.client.query<Chronicle>({ type: 'chronicle' }).then((r) => live && setC(r));
    load();
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open, game]);
  if (!open || !c) return null;
  const startMonth = dateOf(c.start).totalMonths;
  const now = dateOf(game.world.stats.tick).totalMonths + dateOf(game.world.stats.tick).dayFraction;
  const n = c.series[0]!.length;
  const months = Array.from({ length: n }, (_, k) => startMonth + k * c.step + c.step / 2);
  const span = RANGES.find((r) => r.id === range)!.months;
  const to = Math.max(now, startMonth + 1);
  const from = Math.max(startMonth, to - span);
  const markers: TimeMarker[] = c.events.map((e) => {
    const d = dateOf(e.tick);
    return { month: d.totalMonths + d.dayFraction, kind: e.kind, label: eventLabel(e) };
  });
  const years = Math.floor((to - startMonth) / 12);
  return (
    <aside class="budget history panel" data-testid="history-panel">
      <header>
        <h2>City history</h2>
        <div class="budget-summary">
          <span>
            Since {monthName(startMonth)}
            {years > 0 ? ` · ${years} year${years === 1 ? '' : 's'}` : ''}
          </span>
        </div>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel(null)}>
          ×
        </button>
      </header>
      <nav class="tabs" role="tablist">
        {RANGES.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={range === r.id}
            class={`tab ${range === r.id ? 'active' : ''}`}
            data-testid={`history-range-${r.id}`}
            onClick={() => setRange(r.id)}
          >
            {r.name}
          </button>
        ))}
      </nav>
      <div class="tab-body" data-testid="history-charts">
        {c.step > 1 && (
          <p class="note">
            Each point averages {c.step} months: older cities keep their whole story in fewer points.
          </p>
        )}
        {FIGURES.map((f) => (
          <section key={f.title} class="history-figure" data-testid={`history-${f.keys[0]}`}>
            <h3 title={f.note}>{f.title}</h3>
            <TimeChart
              title={f.title}
              series={f.keys.map((k, i) => ({
                name: f.names?.[i] ?? f.title,
                values: c.series[CHRONICLE_SERIES.indexOf(k)]!,
                cls: i ? 'chart-line-2' : 'chart-line',
              }))}
              months={months}
              step={c.step}
              from={from}
              to={to}
              markers={markers}
              fmt={f.fmt}
              tickFmt={f.tickFmt}
              monthLabel={monthName}
              floor={f.floor}
              ceil={f.ceil}
            />
          </section>
        ))}
        <h3>Timeline</h3>
        {c.events.length ? (
          <ul class="history-events" data-testid="history-events">
            {[...c.events].reverse().map((e, k) => (
              <li key={k} class={e.kind}>
                <span class="when">{monthName(dateOf(e.tick).totalMonths)}</span> {eventLabel(e)}
              </li>
            ))}
          </ul>
        ) : (
          <p class="note">Milestones and disasters will be marked here and on the charts.</p>
        )}
      </div>
    </aside>
  );
}

export function HistoryButton() {
  const game = useGameUpdates(500);
  return (
    <button
      class={`btn icon ${game.panel === 'history' ? 'active' : ''}`}
      data-testid="open-history"
      title="City history: population, money, jobs, pollution and more over the city's life (Y)"
      aria-label="City history"
      onClick={() => game.openPanel('history')}
    >
      <IconHistory />
    </button>
  );
}
