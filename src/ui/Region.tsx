import { useState } from 'preact/hooks';
import {
  DEAL_RESOURCES,
  NEIGHBOUR_KIND,
  REGION,
  type DealDirection,
  type DealResource,
} from '../data/region';
import type { RegionSummary } from '../sim/systems/region';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';
import { IconRegion } from './icons';

/**
 * The region (M23): the neighbouring towns, what they'll trade, the deals made with them, and the
 * commuters, shoppers and visitors coming and going. Opened from the top bar (Shift+N).
 */

const UNIT: Record<DealResource, string> = { power: 'MW', water: 'units', garbage: 'a day' };
const WHAT: Record<DealResource, string> = { power: 'power', water: 'water', garbage: 'garbage processing' };
const SIDE: Record<string, string> = {
  north: 'north, up the highway',
  south: 'south, down the highway',
  west: 'west, along the railway',
};

const amount = (res: DealResource, n: number) =>
  res === 'garbage' ? `${formatNumber(n)} a day` : `${formatNumber(n)} ${UNIT[res]}`;

/** A small line chart of a neighbour's last two years. */
function Trend({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 60},${16 - ((v - lo) / (hi - lo || 1)) * 14}`)
    .join(' ');
  return (
    <svg class="region-trend" width="62" height="18" viewBox="-1 0 62 18" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" stroke-width="1.5" />
    </svg>
  );
}

type N = RegionSummary['neighbours'][number];

function DealRow(props: { n: N; res: DealResource; dir: DealDirection }) {
  const game = useGameUpdates(500);
  const { n, res, dir } = props;
  const deals = game.world.stats.region.deals;
  const deal = deals.find((d) => d.neighbour === n.id && d.resource === res && d.direction === dir);
  const cap = n.offers[dir][res];
  const [want, setWant] = useState<number | null>(null);
  const value = Math.min(cap, want ?? deal?.amount ?? Math.round(cap / 2));
  const price = REGION.price[dir][res];
  const act = (a: number) =>
    void game
      .dispatch({ type: 'setDeal', neighbour: n.id, resource: res, direction: dir, amount: a })
      .then((r) => {
        if (!r.ok) game.toast(r.reason, 'bad');
        else {
          game.toast(
            a > 0
              ? `${dir === 'buy' ? 'Buying' : 'Selling'} ${amount(res, Math.min(a, cap))} of ${WHAT[res]} ${dir === 'buy' ? 'from' : 'to'} ${n.name}`
              : `Deal with ${n.name} ended`,
            'ok',
            2500,
          );
          setWant(null);
        }
      });
  const id = `deal-${n.id}-${dir}-${res}`;
  return (
    <div class={`region-deal ${deal ? 'signed' : ''}`} data-testid={id}>
      <div class="region-deal-head">
        <strong>
          {dir === 'buy' ? 'Buy' : 'Sell'} {WHAT[res]}
        </strong>
        <span class="muted">
          up to {amount(res, cap)} · ${price} {dir === 'buy' ? 'a month for each' : 'a month earned per'}{' '}
          {res === 'garbage' ? 'unit a day' : res === 'power' ? 'MW' : 'unit'}
        </span>
      </div>
      {deal && (
        <div class="region-deal-now" data-testid={`${id}-now`}>
          {dir === 'buy' ? 'Buying' : 'Selling'} {amount(res, deal.amount)} ·{' '}
          {deal.delivered < deal.amount ? 'only ' : ''}
          {amount(res, deal.delivered)} went through lately · {formatMoney(deal.delivered * price)}/month{' '}
          {dir === 'buy' ? 'paid' : 'earned'}
        </div>
      )}
      <div class="region-deal-set">
        <input
          type="range"
          min={0}
          max={cap}
          step={1}
          value={value}
          aria-label={`${dir === 'buy' ? 'Buy' : 'Sell'} how much ${WHAT[res]}`}
          data-testid={`${id}-amount`}
          onInput={(e) => setWant(Number((e.target as HTMLInputElement).value))}
        />
        <span class="region-deal-value">{amount(res, value)}</span>
        <button class="btn small" data-testid={`${id}-sign`} disabled={value <= 0} onClick={() => act(value)}>
          {deal ? 'Change' : 'Sign'}
        </button>
        {deal && (
          <button class="btn small" data-testid={`${id}-end`} onClick={() => act(0)}>
            End
          </button>
        )}
      </div>
    </div>
  );
}

function NeighbourCard({ n }: { n: N }) {
  const game = useGameUpdates(500);
  const flows = game.world.stats.region.flows;
  const f = flows.byNeighbour.find((x) => x.id === n.id);
  const def = NEIGHBOUR_KIND[n.kind];
  const growth = n.trend * 100;
  const offers = (['buy', 'sell'] as const).flatMap((dir) =>
    DEAL_RESOURCES.filter((res) => n.offers[dir][res] > 0).map((res) => ({ dir, res })),
  );
  return (
    <section class="region-town" data-testid={`neighbour-${n.id}`}>
      <header>
        <h3>{n.name}</h3>
        <span class="region-kind">{def.label}</span>
      </header>
      <div class="region-pop">
        {formatNumber(n.population)} residents ·{' '}
        <span class={growth >= 0.05 ? 'pos' : growth <= -0.05 ? 'neg' : 'muted'}>
          {Math.abs(growth) < 0.05
            ? 'steady'
            : `${growth > 0 ? 'growing' : 'shrinking'} ${Math.abs(growth).toFixed(1)} % a month`}
        </span>
        <Trend values={n.history} />
      </div>
      <p class="muted">
        {def.blurb} To the {SIDE[n.side] ?? n.side}.
      </p>
      {f && (f.in > 0 || f.out > 0 || f.shop > 0) && (
        <p class="region-flow" data-testid={`neighbour-${n.id}-flow`}>
          {f.in > 0 && <>{formatNumber(f.in)} of its people work here. </>}
          {f.out > 0 && <>{formatNumber(f.out)} of yours work there. </>}
          {f.shop > 0 && <>{formatNumber(f.shop)} shop here each day.</>}
        </p>
      )}
      {offers.map((o) => (
        <DealRow key={`${o.dir}-${o.res}`} n={n} res={o.res} dir={o.dir} />
      ))}
    </section>
  );
}

export function RegionPanel() {
  const game = useGameUpdates(500);
  if (game.panel !== 'region') return null;
  const r = game.world.stats.region;
  const t = game.world.stats;
  const v = r.flows.visitors;
  const arrivals = [
    v.road > 0 && `${formatNumber(v.road)} by road`,
    v.rail > 0 && `${formatNumber(v.rail)} by train`,
    v.air > 0 && `${formatNumber(v.air)} by air`,
    v.sea > 0 && `${formatNumber(v.sea)} by sea`,
  ].filter(Boolean);
  return (
    <aside class="advisors region panel" data-testid="region-panel">
      <header>
        <h2>Region</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('region')}>
          ×
        </button>
      </header>
      <div class="advisors-list">
        {!r.neighbours.length ? (
          <p class="muted" data-testid="region-empty">
            This city has no neighbours to trade with: its puzzle is its own.
          </p>
        ) : (
          <>
            <p class="region-summary" data-testid="region-summary">
              {formatNumber(r.flows.commutersIn)} people drive in from the neighbours to work here, and{' '}
              {formatNumber(r.flows.commutersOut)} of your residents work out of town
              {r.flows.byRail > 0 ? ` (${formatNumber(r.flows.byRail)} of them by train)` : ''}.{' '}
              {r.flows.shoppersIn > 0 && <>{formatNumber(r.flows.shoppersIn)} come in to shop. </>}
              {arrivals.length > 0 && <>Visitors today: {arrivals.join(', ')}.</>}
            </p>
            <p class="muted">
              Deals are paid for what actually comes through, each month. Power and water bought come in along
              the highway; what's sold only ever comes from what's left over once your own homes and
              businesses are served.
              {t.utilities.power.unserved > 0 ? ' Short of power? A neighbour may sell you some.' : ''}
            </p>
            {r.neighbours.map((n) => (
              <NeighbourCard key={n.id} n={n} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

export function RegionButton() {
  const game = useGameUpdates(500);
  return (
    <button
      class={`btn icon ${game.panel === 'region' ? 'active' : ''}`}
      data-testid="open-region"
      title="Region: the neighbouring towns, deals for power, water and garbage, and who comes and goes (Shift+N)"
      aria-label="Region"
      onClick={() => game.openPanel('region')}
    >
      <IconRegion />
    </button>
  );
}
