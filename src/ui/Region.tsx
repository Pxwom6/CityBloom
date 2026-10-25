import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import {
  DEAL_RESOURCES,
  NEIGHBOUR_KIND,
  REGION,
  type DealDirection,
  type DealResource,
} from '../data/region';
import type { RegionSummary } from '../sim/systems/region';
import type { SupplyBalance, UtilityBalance } from '../sim/systems/utilities';
import { formatMoney, formatNumber, useGameUpdates } from './hooks';
import { IconRegion } from './icons';
import { PLAYER_COLORS } from '../../relay/protocol';
import { inviteLink, relayUrl } from '../net/multiplayer';

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

/** Power or water: what you make and use yourself, then what you buy and sell. */
function UtilityLine(props: { res: 'power' | 'water'; b: UtilityBalance }) {
  const { res, b } = props;
  const unit = UNIT[res];
  const short = b.use - b.make;
  const uncovered = short - b.bought;
  const verdict =
    short <= 0 ? (
      <span class="pos">
        {formatNumber(-short)} {unit} to spare.
      </span>
    ) : uncovered <= 0 ? (
      <span class="pos">
        {formatNumber(short)} {unit} short, covered by what you buy.
      </span>
    ) : (
      <span class="neg">
        {formatNumber(short)} {unit} short
        {b.bought > 0 ? `, ${formatNumber(uncovered)} ${unit} of it still uncovered` : ''}.
      </span>
    );
  return (
    <SupplyRow id={res} label={res === 'power' ? 'Power' : 'Water'}>
      You make {formatNumber(b.make)} {unit} and use {formatNumber(b.use)} {unit}: {verdict}
      {(b.bought > 0 || b.sold > 0) && (
        <>
          {' '}
          Bought {formatNumber(b.bought)} {unit}, sold {formatNumber(b.sold)} {unit}.
        </>
      )}
    </SupplyRow>
  );
}

/** One line of the supply section: a label, then what it says. */
function SupplyRow(props: { id: string; label: string; children: ComponentChildren }) {
  return (
    <p class="region-supply-row" data-testid={`region-supply-${props.id}`}>
      <strong>{props.label}</strong>
      <span>{props.children}</span>
    </p>
  );
}

/**
 * What the city makes and uses (P20): power, water and garbage, the winter forecast for power, and
 * last month's money for imports and exports. Asked of the sim on demand (it walks every building).
 */
function Supply() {
  const game = useGameUpdates(500);
  const [s, setS] = useState<SupplyBalance | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => void game.client.query<SupplyBalance>({ type: 'supply' }).then((r) => live && setS(r));
    load();
    const t = setInterval(load, 700);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [game]);
  if (!s) return null;
  const g = s.garbage;
  const net = g.made + g.taken - g.sent - g.process;
  const days = net > 0 ? Math.floor(g.room / net) : Infinity;
  const w = s.winter;
  const enough = w ? w.have >= w.need : true;
  return (
    <section class="region-supply" data-testid="region-supply">
      <h3>Supply and demand</h3>
      <UtilityLine res="power" b={s.power} />
      <UtilityLine res="water" b={s.water} />
      <SupplyRow id="garbage" label="Garbage">
        You make {formatNumber(g.made)} a day; your plants process {formatNumber(g.process)} a day.
        {(g.sent > 0 || g.taken > 0) && (
          <>
            {' '}
            Neighbours take {formatNumber(g.sent)} a day of it, and you take {formatNumber(g.taken)} of
            theirs.
          </>
        )}{' '}
        {net <= 0 ? (
          <span class="pos">Handled.</span>
        ) : (
          <span class={days < 30 ? 'neg' : undefined}>
            The other {formatNumber(net)} a day goes to landfill,{' '}
            {g.room <= 0
              ? 'which is full.'
              : `which has room for about ${formatNumber(days)} ${days === 1 ? 'day' : 'days'}.`}
          </span>
        )}
      </SupplyRow>
      {w && (
        <SupplyRow id="winter" label="Winter">
          {w.months > 0
            ? `When winter comes (in ${w.months} ${w.months === 1 ? 'month' : 'months'}) heating`
            : 'Winter heating'}{' '}
          will lift your use to about {formatNumber(w.need)} MW; you'd have {formatNumber(w.have)} MW:{' '}
          {enough ? (
            <span class="pos">enough.</span>
          ) : (
            <span class="neg">{formatNumber(w.need - w.have)} MW short.</span>
          )}
          {w.cut > 0 && <> The industrial neighbour sends {formatNumber(w.cut)} MW less in the cold.</>}
        </SupplyRow>
      )}
      {s.ledger && (s.ledger.imports > 0 || s.ledger.exports > 0) && (
        <p class="muted" data-testid="region-supply-ledger">
          Last month you paid {formatMoney(s.ledger.imports)} for imports and earned{' '}
          {formatMoney(s.ledger.exports)} from exports.
        </p>
      )}
    </section>
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
  // Between two players' cities one price, paid by the buyer and earned by the seller (M32).
  const price = n.player ? REGION.playerPrice[res] : REGION.price[dir][res];
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
          {amount(res, deal.delivered)} went through in the last hour · {formatMoney(deal.delivered * price)}
          /month {dir === 'buy' ? 'paid' : 'earned'} at that rate
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
  const pl = n.player;
  const view = pl ? game.region?.view?.cities.find((c) => c.slot === pl.slot) : undefined;
  return (
    <section class={`region-town ${pl ? 'player' : ''}`} data-testid={`neighbour-${n.id}`}>
      <header>
        <h3>
          {pl && <span class="player-dot" style={{ background: PLAYER_COLORS[pl.color] }} />} {n.name}
        </h3>
        <span class="region-kind">{pl ? `${pl.mayor}’s city` : def.label}</span>
      </header>
      {pl && (
        <div class="region-player" data-testid={`neighbour-${n.id}-player`}>
          {view?.thumb && <img class="region-thumb" src={view.thumb} alt={`${n.name} from above`} />}
          <p class="muted">
            Played by {pl.mayor}.{' '}
            {(view?.online ?? pl.online) ? 'Playing now.' : 'Away: its last offers stand.'}
          </p>
          {view?.visitable && game.regionCode && (
            <a
              class="btn small"
              data-testid={`visit-${pl.slot}`}
              href={`${location.pathname}?visit=${game.regionCode}&city=${pl.slot}`}
              target="_blank"
              rel="noopener"
              title={`Look round ${n.name} as it was last saved (read-only, in a new tab)`}
            >
              Visit
            </a>
          )}
        </div>
      )}
      <div class="region-pop">
        {formatNumber(n.population)} residents ·{' '}
        <span class={growth >= 0.05 ? 'pos' : growth <= -0.05 ? 'neg' : 'muted'}>
          {Math.abs(growth) < 0.05
            ? 'steady'
            : `${growth > 0 ? 'growing' : 'shrinking'} ${Math.abs(growth).toFixed(1)} % a month`}
        </span>
        <Trend values={n.history} />
      </div>
      {!pl && (
        <p class="muted">
          {def.blurb} To the {SIDE[n.side] ?? n.side}.
        </p>
      )}
      {f && (f.in > 0 || f.out > 0 || f.shop > 0) && (
        <p class="region-flow" data-testid={`neighbour-${n.id}-flow`}>
          {f.in > 0 && <>{formatNumber(f.in)} of its people work here. </>}
          {f.out > 0 && <>{formatNumber(f.out)} of yours work there. </>}
          {f.shop > 0 && <>{formatNumber(f.shop)} shop here each day.</>}
        </p>
      )}
      {game.world.stats.region.deals
        .filter((d) => d.remote && d.neighbour === n.id)
        .map((d) => (
          <p
            class="region-deal-now"
            key={d.id}
            data-testid={`remote-deal-${n.id}-${d.direction}-${d.resource}`}
          >
            {n.name} {d.direction === 'sell' ? 'buys' : 'sells'} {amount(d.resource, d.amount)} of{' '}
            {WHAT[d.resource]} {d.direction === 'sell' ? 'from' : 'to'} you (their deal):{' '}
            {amount(d.resource, d.delivered)} went through in the last hour,{' '}
            {formatMoney(d.delivered * REGION.playerPrice[d.resource])}/month{' '}
            {d.direction === 'sell' ? 'earned' : 'paid'}.
          </p>
        ))}
      {offers
        .filter(
          (o) =>
            !game.world.stats.region.deals.some(
              (d) => d.remote && d.neighbour === n.id && d.resource === o.res && d.direction === o.dir,
            ),
        )
        .map((o) => (
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
            <SharedRegion />
            <Supply />
            <p class="muted">
              Deals are paid for what actually comes through, each month. Power and water bought come in along
              the highway; what's sold only ever comes from what you make yourself, once your own homes and
              businesses are served, never from what you buy.
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

/**
 * A shared region (M32): start one with this city, join one by its code, or, once in, its code,
 * the region project and leaving.
 */
function SharedRegion() {
  const game = useGameUpdates(500);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const link = game.region;
  if (game.net || game.readOnly) return null;
  if (!link) {
    const online = !!relayUrl();
    const go = async (f: () => Promise<boolean>) => {
      setBusy(true);
      await f();
      setBusy(false);
    };
    return (
      <section class="region-share" data-testid="region-share">
        <h3>Play this region with friends</h3>
        <p class="muted">
          Up to four of you each play your own city side by side: their cities take the neighbours’ places,
          and you trade power, water and garbage, share commuters and build a great work together.
        </p>
        <div class="region-share-row">
          <button
            class="btn"
            disabled={busy}
            data-testid="region-start"
            onClick={() =>
              void go(() =>
                game.startRegion(online ? 'online' : 'p2p', `${game.world.stats.cityName}’s region`),
              )
            }
          >
            {online ? 'Start a region' : 'Start a region on this computer'}
          </button>
          <input
            type="text"
            placeholder="Region code"
            maxLength={9}
            value={code}
            data-testid="region-code"
            onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button
            class="btn"
            disabled={busy || code.trim().length < 6}
            data-testid="region-join"
            onClick={() => void go(() => game.joinRegion(code.replace(/[\s-]/g, '').toUpperCase()))}
          >
            Join
          </button>
        </div>
      </section>
    );
  }
  const v = link.view;
  const p = v?.project;
  const mine = p ? (p.by[link.slot] ?? 0) : 0;
  const host = p?.host ? v?.cities.find((c) => c.slot === p.host)?.name : null;
  return (
    <section class="region-share in" data-testid="region-share">
      <h3>
        {v?.name ?? 'Shared region'} <span class="room-code">{game.regionCode}</span>
      </h3>
      <p class="muted">
        Friends join with their own cities: Region → Join, with this code
        {game.regionCode && (
          <>
            {' '}
            (<span class="region-link">{inviteLink(game.regionCode).replace('?join=', '?region=')}</span>)
          </>
        )}
        . {link.state === 'reconnecting' ? 'Reconnecting…' : ''}
      </p>
      {p && (
        <div class="region-project" data-testid="region-project">
          <h4>{p.name}</h4>
          <p class="muted">
            A great work the region pays for together; the city that gives most builds it, and every city that
            gave shares its {formatNumber(p.power)} MW of clean power, in proportion to what it gave.
          </p>
          <div class="bar">
            <span style={{ width: `${Math.min(100, (p.total / p.goal) * 100)}%` }} />
          </div>
          <p data-testid="region-project-status">
            {formatMoney(p.total)} of {formatMoney(p.goal)}
            {mine > 0 && <> · you gave {formatMoney(mine)}</>}
            {p.built
              ? ' · built: power flowing'
              : p.funded
                ? ` · paid for: ${host ?? 'a city'} builds it`
                : ''}
          </p>
          {!p.funded && (
            <div class="region-share-row">
              {[25_000, 100_000].map((a) => (
                <button
                  key={a}
                  class="btn"
                  data-testid={`region-give-${a}`}
                  onClick={() =>
                    void link.contribute(a).then((r) => {
                      if (r.ok) game.toast(`You gave ${formatMoney(r.cost)} to ${p.name}`, 'ok', 3000);
                      else game.toast(r.reason, 'bad', 4000);
                    })
                  }
                >
                  Give {formatMoney(a)}
                </button>
              ))}
            </div>
          )}
          {p.funded && !p.built && p.host === link.slot && (
            <p class="room-line">It’s yours to build: find it with the power plants (Sunfield Commons).</p>
          )}
        </div>
      )}
      <button class="btn small" data-testid="region-leave" onClick={() => game.leaveRegion()}>
        Leave the region
      </button>
    </section>
  );
}
