import { snowFactor } from '../data/climate';
import { ROAD_TYPES, isRail } from '../data/roads';
import { CIVIC } from '../data/civic';
import { TRAM, TRANSIT } from '../data/balance';
import { compass } from '../tools/roadTool';
import type { Command } from '../sim/commands';
import { useEffect, useState } from 'preact/hooks';
import { MODULE, modulesFor } from '../data/modules';
import { DENSITY_NAMES, INDUSTRY_TIER_NAMES, WEALTH_NAMES, ZONED_DEFS } from '../data/buildings';
import type { BuildingDetails, CivicDetails } from '../sim/protocol';
import { formatNumber, useGameUpdates } from './hooks';
import { modKey } from '../client/platform';
import { moveFee } from '../sim/world/civic';
import { IconBulldozer, IconMove } from './icons';

const ZONE_NAMES = ['', 'Residential', 'Commercial', 'Industrial'];
const EDU_NAMES = ['Little schooling', 'Primary school', 'High school', 'University'];
const STATE_NAMES = ['Under construction', 'Occupied', 'Abandoned', 'Rubble'];

function Mood({ value }: { value: number }) {
  const tone = value >= 0.65 ? 'good' : value >= 0.4 ? 'ok' : 'bad';
  return (
    <div class="mood">
      <div class="mood-track">
        <div class={`mood-fill ${tone}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span>{Math.round(value * 100)}%</span>
    </div>
  );
}

/**
 * Demolish the inspected building. Bulldozing can't be undone, so the first click asks: the
 * confirmation names the building and what the city gets back.
 */
function BulldozeButton(props: {
  name: string;
  refund: number;
  onConfirm: () => void;
  /** Civic buildings can be moved instead (M14). */
  onMove?: () => void;
  moveFee?: number;
}) {
  const [asking, setAsking] = useState(false);
  const refund = props.refund > 0 ? `refund $${props.refund.toLocaleString('en-US')}` : 'no refund';
  if (!asking)
    return (
      <footer>
        {props.onMove && (
          <button
            class="btn"
            data-testid="move-civic"
            onClick={props.onMove}
            title={`Pick it up and put it down beside another road, keeping its add-ons ($${(props.moveFee ?? 0).toLocaleString('en-US')} plus any levelling)`}
          >
            <IconMove />
            <span>Move (${(props.moveFee ?? 0).toLocaleString('en-US')})</span>
          </button>
        )}
        <button class="btn danger" data-testid="bulldoze" onClick={() => setAsking(true)}>
          <IconBulldozer />
          <span>Bulldoze ({refund})</span>
        </button>
      </footer>
    );
  return (
    <footer class="confirm" data-testid="bulldoze-confirm" role="alertdialog" aria-label="Confirm bulldozing">
      <p>
        Bulldoze the {props.name.toLowerCase()}?{' '}
        {props.refund > 0 ? `The city gets $${props.refund.toLocaleString('en-US')} back. ` : ''}Undo (
        {modKey('Z')}) brings it back.
      </p>
      <div class="actions">
        <button class="btn" data-testid="bulldoze-cancel" onClick={() => setAsking(false)} autoFocus>
          Keep it
        </button>
        <button class="btn danger" data-testid="bulldoze-yes" onClick={props.onConfirm}>
          <IconBulldozer />
          <span>Bulldoze</span>
        </button>
      </div>
    </footer>
  );
}

/** Details of the selected building: who lives or works there, its mood and why. */
export function Inspector() {
  const game = useGameUpdates(200);
  if (game.selected?.kind === 'civic') return <CivicInspector id={game.selected.id} />;
  if (game.selected?.kind === 'car') return <CarInspector id={game.selected.id} />;
  if (game.selected?.kind === 'walker') return <CarInspector id={game.selected.id} walker />;
  if (game.selected?.kind === 'road') return <RoadInspector id={game.selected.id} />;
  if (game.selected?.kind === 'stop') return <StopInspector id={game.selected.id} />;
  return <BuildingInspector id={game.selected?.id ?? null} />;
}

/** A bus or tram stop (M20): the line that calls there, how often, and how many use it. */
function StopInspector({ id }: { id: number }) {
  const game = useGameUpdates(400);
  const w = game.world;
  const stop = w.stops.get(id);
  const close = (
    <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
      ×
    </button>
  );
  if (!stop)
    return (
      <aside class="inspector panel" data-testid="inspector">
        <header>
          <div>
            <h2>Stop removed</h2>
          </div>
          {close}
        </header>
      </aside>
    );
  const tram = !!stop.tram;
  const mode = tram ? 'tram' : 'bus';
  const line = w.lines.find((l) => l.mode === mode && l.stops.includes(id));
  const depot = line ? w.civics.get(line.depot) : undefined;
  const vehicles = tram ? 'trams' : 'buses';
  return (
    <aside class="inspector panel" data-testid="inspector">
      <header>
        <div>
          <h2>{tram ? 'Tram stop' : 'Bus stop'}</h2>
          <div class="sub address">{game.names.street(stop.seg)}</div>
          <div class="sub">
            {tram
              ? `People walk up to ${Math.round(TRANSIT.walkRadius * TRAM.walkFactor)} m to catch a tram here.`
              : `People walk up to ${TRANSIT.walkRadius} m to catch a bus here.`}
          </div>
        </div>
        {close}
      </header>
      {!line && (
        <div class="warn" data-testid="stop-unserved">
          {tram
            ? 'No trams call here: it needs a tram depot on connected track and at least one more tram stop.'
            : 'No buses call here: it needs a bus depot whose buses can reach it and at least one more stop.'}
        </div>
      )}
      {line && (
        <dl data-testid="stop-line">
          <dt>Line</dt>
          <dd>
            {line.stops.length} stops from the {tram ? 'tram' : 'bus'} depot
            {depot ? ` at ${game.names.address(depot.x, depot.z)}` : ''}
          </dd>
          <dt>{tram ? 'Trams' : 'Buses'}</dt>
          <dd>
            {line.buses} · every {Math.max(1, Math.round(line.headway / 60))} min
          </dd>
          <dt>Here</dt>
          <dd data-testid="stop-use">
            {(w.stopUse.get(id) ?? 0).toLocaleString('en-US')} getting on or off a day
          </dd>
          <dt>On the line</dt>
          <dd class={line.load < 0.95 ? 'neg' : ''}>
            {line.riders.toLocaleString('en-US')} trips/day{line.load < 0.95 ? ` (${vehicles} full)` : ''}
          </dd>
        </dl>
      )}
      <BulldozeButton
        name={tram ? 'tram stop' : 'bus stop'}
        refund={Math.round(TRANSIT.stopCost * 0.25)}
        onConfirm={() =>
          void game.dispatch({ type: 'bulldoze', target: { kind: 'stop', id } }).then((r) => {
            if (r.ok) {
              game.audio?.play('bulldoze');
              game.select(null);
            } else game.toast(r.reason, 'bad');
          })
        }
      />
    </aside>
  );
}

/**
 * A railway (M20): the trains along it, the line's riders, and its level crossings.
 */
function RailInspector({ id }: { id: number }) {
  const game = useGameUpdates(400);
  const w = game.world;
  const seg = w.netState.segments.get(id)!;
  const rt = ROAD_TYPES[seg.type];
  const curve = w.net.curve(id);
  const lines = w.lines.filter((l) => l.mode === 'train' && l.legs.some((x) => x.seg === id));
  // The most frequent line along it sets how often a train comes by each way.
  const every = lines.length ? Math.min(...lines.map((l) => l.headway)) : 0;
  const riders = lines.reduce((n, l) => n + l.riders, 0);
  const freight = w.freight.filter((f) => f.legs.some((x) => x.seg === id));
  const freightTrains = freight.reduce((n, f) => n + Math.max(1, Math.round(f.trucks / 40)), 0);
  const crossings = [seg.a, seg.b].filter((n) => w.junctionKind(n) === 'crossing').length;
  const regional = seg.type === 'mainline';
  return (
    <aside class="inspector panel" data-testid="inspector">
      <header>
        <div>
          <h2>{regional ? 'Regional railway' : game.names.street(id)}</h2>
          <div class="sub">
            {regional
              ? 'The link to the regional railway. Lay track from here to bring trains into town.'
              : `${rt.name} · two tracks`}
          </div>
        </div>
        <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
          ×
        </button>
      </header>
      <dl data-testid="rail-traffic">
        <dt>Passenger trains</dt>
        <dd>
          {lines.length
            ? `Every ${Math.max(1, Math.round(every / 60))} min each way`
            : 'None: stations on connected track start a line'}
        </dd>
        {lines.length > 0 && (
          <>
            <dt>Riders</dt>
            <dd>{riders.toLocaleString('en-US')} trips/day on the line</dd>
          </>
        )}
        <dt>Freight trains</dt>
        <dd>
          {freight.length
            ? `about ${freightTrains * 2} a day (in and out)`
            : 'None: a rail freight terminal on track linked to the regional railway loads them'}
        </dd>
        <dt>Length</dt>
        <dd>
          {Math.round(curve.length)} m · up to {rt.speed} km/h
        </dd>
        {crossings > 0 && (
          <>
            <dt>Level crossings</dt>
            <dd>{crossings} at its ends: cars wait a little as trains pass</dd>
          </>
        )}
      </dl>
    </aside>
  );
}

/** Freight trains for so many truckloads a day (about forty a train, M20). */
function trainsText(trucks: number): string {
  const n = Math.max(1, Math.round(trucks / 40));
  return `about ${n} train${n === 1 ? '' : 's'}`;
}

/** How full a road or junction is at the rush hour, in words. */
function loadText(vc: number): string {
  const pct = `${Math.round(vc * 100)}% of capacity`;
  if (vc < 0.6) return `Flowing freely (${pct})`;
  if (vc < 0.9) return `Busy (${pct})`;
  if (vc < 1.2) return `Congested (${pct})`;
  return `Jammed (${pct})`;
}

/**
 * A road (M19): its traffic, which way it runs (switchable), and the junctions at its ends, where a
 * roundabout can go in or come out.
 */
function RoadInspector({ id }: { id: number }) {
  const game = useGameUpdates(400);
  const w = game.world;
  const seg = w.netState.segments.get(id);
  if (!seg)
    return (
      <aside class="inspector panel" data-testid="inspector">
        <header>
          <div>
            <h2>Road removed</h2>
          </div>
          <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
            ×
          </button>
        </header>
      </aside>
    );
  const rt = ROAD_TYPES[seg.type];
  const curve = w.net.curve(id);
  const a = w.net.node(seg.a);
  const b = w.net.node(seg.b);
  const heading = (d: number) => compass((b.x - a.x) * d, (b.z - a.z) * d);
  const act = (cmd: Command, done: string) =>
    void game.dispatch(cmd).then((r) => {
      if (r.ok) {
        game.audio?.play('place');
        game.toast(done, 'ok', 2000);
      } else game.toast(r.reason, 'bad');
    });
  const ways: [0 | 1 | -1, string][] = rt.oneWay
    ? [
        [1, `One-way ${heading(1)}`],
        [-1, `One-way ${heading(-1)}`],
      ]
    : [
        [0, 'Two-way'],
        [1, `One-way ${heading(1)}`],
        [-1, `One-way ${heading(-1)}`],
      ];
  const ends = [seg.a, seg.b].map((n) => {
    const node = w.netState.nodes.get(n)!;
    const kind = w.junctionKind(n);
    return { n, node, kind, arms: w.net.segmentsAt(n).length, vc: w.junctionVC(n, 1) };
  });
  if (isRail(seg.type)) return <RailInspector id={id} />;
  // Trams along it (M20).
  const tramLine = w.lines.find((l) => l.mode === 'tram' && l.legs.some((x) => x.seg === id));
  // Cut off from the highway (P1), with however many other roads share its fate.
  const islands = w.roadIslands();
  const island = rt.access ? islands.of.get(id) : undefined;
  const others = island !== undefined ? islands.list[island]!.segs.length - 1 : 0;
  return (
    <aside class="inspector panel" data-testid="inspector">
      <header>
        <div>
          <h2>{game.names.street(id)}</h2>
          <div class="sub">
            {rt.name}
            {seg.oneway ? ` · one-way ${heading(seg.oneway)}` : ''}
          </div>
        </div>
        <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
          ×
        </button>
      </header>
      {island !== undefined && (
        <div class="warn" data-testid="road-island">
          Not connected to the highway
          {others ? ` (nor ${others === 1 ? 'the road' : `the ${others} roads`} joined to it)` : ''}: nothing
          grows here, and nobody can drive to or from town. Join one of its ends to a road that is.
        </div>
      )}
      <dl data-testid="road-traffic">
        <dt>Traffic</dt>
        <dd>{Math.round(w.traffic.get(id) ?? 0).toLocaleString('en-US')} cars a day</dd>
        <dt>Rush hour</dt>
        <dd class={w.segVC(id, 1) >= 1 ? 'neg' : ''}>{loadText(w.segVC(id, 1))}</dd>
        <dt>Carries</dt>
        <dd>{Math.round(w.segCapacity(id)).toLocaleString('en-US')} cars an hour</dd>
        <dt>Length</dt>
        <dd>
          {Math.round(curve.length)} m · {rt.speed} km/h
        </dd>
        {(seg.snow ?? 0) >= 0.05 && (
          <>
            <dt>Snow</dt>
            <dd class="neg" data-testid="road-snow">
              {Math.round(seg.snow! * 100)} % · traffic {snowFactor(seg.snow).toFixed(1)}× slower
              <div class="muted">
                {[...w.civics.values()].some((c) => c.def === 'works')
                  ? 'Ploughs clear roads within about 3 km of a public works depot, busiest first.'
                  : 'No public works depot: it lies until it melts.'}
              </div>
            </dd>
          </>
        )}
      </dl>
      {rt.buildable && (
        <section class="road-way" data-testid="road-oneway">
          <h3>Direction</h3>
          <div class="seg-buttons" role="group" aria-label="Direction">
            {ways.map(([dir, label]) => (
              <button
                key={dir}
                class={`btn small ${(seg.oneway ?? 0) === dir ? 'active' : ''}`}
                aria-pressed={(seg.oneway ?? 0) === dir}
                data-testid={`oneway-${dir}`}
                onClick={() =>
                  (seg.oneway ?? 0) !== dir &&
                  act({ type: 'setOneWay', seg: id, dir }, dir ? `Now ${label.toLowerCase()}` : 'Now two-way')
                }
              >
                {label}
              </button>
            ))}
          </div>
          <p class="muted">
            {rt.oneWay
              ? 'Ramps always run one way.'
              : 'One-way roads carry a quarter more; trips that need the other way go round. Free to change.'}
          </p>
        </section>
      )}
      {rt.access && (
        <section class="road-ends" data-testid="road-junctions">
          <h3>Junctions</h3>
          {ends.map((e, i) => (
            <div key={e.n} class="module-row">
              <div>
                <strong>
                  {i === 0 ? 'Start' : 'End'} (
                  {compass(e.node.x - (a.x + b.x) / 2, e.node.z - (a.z + b.z) / 2)}):{' '}
                  {e.kind === 'roundabout'
                    ? 'roundabout'
                    : e.kind === 'crossing'
                      ? 'level crossing'
                      : e.kind === 'plain'
                        ? `junction of ${e.arms} roads`
                        : e.arms === 1
                          ? 'dead end'
                          : 'bend'}
                </strong>
                {e.kind !== 'none' && <div class={`muted ${e.vc >= 1 ? 'neg' : ''}`}>{loadText(e.vc)}</div>}
              </div>
              {e.kind === 'roundabout' ? (
                <button
                  class="btn small"
                  data-testid="remove-roundabout"
                  onClick={() => act({ type: 'removeRoundabout', node: e.n }, 'Roundabout removed')}
                >
                  Remove
                </button>
              ) : e.arms >= 2 && e.kind !== 'crossing' ? (
                <button
                  class="btn small"
                  data-testid="add-roundabout"
                  title="A roundabout passes far more traffic than a plain junction"
                  onClick={() => act({ type: 'roundabout', node: e.n }, 'Roundabout built')}
                >
                  Roundabout
                </button>
              ) : null}
            </div>
          ))}
        </section>
      )}
      {rt.tram && (
        <section class="road-tram" data-testid="road-tram">
          <h3>Tram track</h3>
          <div class="module-row">
            <div>
              <strong>{seg.tram ? 'Tram track laid' : 'No tram track'}</strong>
              <div class="muted">
                {tramLine
                  ? `Trams every ${Math.max(1, Math.round(tramLine.headway / 60))} min · ${tramLine.riders.toLocaleString('en-US')} trips/day on the line`
                  : seg.tram
                    ? 'No trams run here yet: a tram depot and tram stops on the track start a line.'
                    : `$${Math.round(curve.length * TRAM.trackCost).toLocaleString('en-US')} to lay along this road`}
              </div>
            </div>
            <button
              class="btn small"
              data-testid={seg.tram ? 'tram-remove' : 'tram-lay'}
              onClick={() =>
                act(
                  { type: 'setTram', seg: id, on: !seg.tram },
                  seg.tram ? 'Tram track taken up' : 'Tram track laid',
                )
              }
            >
              {seg.tram ? 'Take up' : 'Lay track'}
            </button>
          </div>
        </section>
      )}
      {!rt.access && seg.type !== 'highway' && (
        <p class="muted">
          {seg.type === 'motorway'
            ? 'No zoning or junctions: roads cross over or under it, and ramps join it.'
            : 'Joins the city highway to the roads beside it.'}
        </p>
      )}
    </aside>
  );
}

function Supply({ label, v }: { label: string; v: number }) {
  return (
    <>
      <dt>{label}</dt>
      <dd class={v < 0.999 ? 'neg' : ''}>
        {v >= 0.999 ? 'Yes' : v <= 0 ? 'None' : `${Math.round(v * 100)}%`}
      </dd>
    </>
  );
}

const VEHICLE_NAMES: Record<string, string> = {
  fire: 'Fire engines',
  police: 'Patrol cars',
  health: 'Ambulances',
};

const SERVICE_ROWS = [
  ['fire', 'Fire'],
  ['police', 'Police'],
  ['health', 'Health care'],
  ['education', 'Education'],
  ['park', 'Parks'],
] as const;

function Coverage({ label, v }: { label: string; v: number }) {
  const tone = v >= 0.65 ? 'good' : v >= 0.3 ? 'ok' : 'bad';
  return (
    <li class="cov">
      <span>{label}</span>
      <div class="mood-track">
        <div class={`mood-fill ${tone}`} style={{ width: `${Math.round(v * 100)}%` }} />
      </div>
      <span>{Math.round(v * 100)}%</span>
    </li>
  );
}

/** What would help most: the biggest negative mood factors, as suggestions. */
const NEEDS: [RegExp, string][] = [
  [/no power|power shortage/i, 'Power: build or expand a power plant within reach'],
  [/no water|water shortage/i, 'Water: add a pump connected by road'],
  [/sewage/i, 'Sewage: build an outflow or treatment plant'],
  [/polluted tap water/i, 'Clean water: move pumps away from pollution'],
  [/garbage/i, 'Garbage collection: a landfill with free trucks nearby'],
  [/no fire station/i, 'A fire station within reach'],
  [/no police/i, 'A police station within reach'],
  [/no health care/i, 'A clinic or hospital within reach'],
  [/no school/i, 'School seats nearby'],
  [/crime/i, 'Police patrols to bring crime down'],
  [/without jobs/i, 'Jobs: zone commercial or industry'],
  [/long commute/i, 'Jobs closer to home, or faster roads'],
  [/few shops/i, 'Shops nearby: zone commercial'],
  [/too few customers/i, 'More homes nearby to shop here'],
  [/not enough workers/i, 'More homes within commuting distance'],
  [/taxes are high/i, 'Lower taxes'],
  [/highway/i, 'A road link to the highway'],
  [/neighbourhood/i, 'Parks and services to raise land value'],
  [/polluted air/i, 'Cleaner air: move heavy industry and plants downwind, plant parks'],
  [/sick residents/i, 'A clinic or hospital with free beds nearby'],
];

function needsOf(d: BuildingDetails): string[] {
  const out: string[] = [];
  for (const f of [...d.factors].sort((a, b) => a.value - b.value)) {
    if (f.value > -0.02) break;
    const hit = NEEDS.find(([re]) => re.test(f.label));
    if (hit && !out.includes(hit[1])) out.push(hit[1]);
    if (out.length >= 3) break;
  }
  return out;
}

const PURPOSE: Record<string, [string, string]> = {
  work: ['Commuter', 'Driving to work'],
  shop: ['Shopper', 'Off to the shops'],
  freight: ['Delivery truck', 'Taking goods from industry to a shop'],
  export: ['Export truck', 'Taking goods out to the region'],
  import: ['Import truck', 'Bringing goods in from the region'],
  event: ['Match-day fan', 'Driving in from the region for the match at the stadium'],
  incommute: ['Commuter from out of town', 'Driving in from a neighbouring town to work'],
  outcommute: ['Commuter', 'Driving out to work in a neighbouring town'],
  regionshop: ['Shopper from out of town', 'Driving in from a neighbouring town to the shops'],
  visit: ['Visitor', 'Off to see the sights'],
};

const WALKING: Record<string, [string, string]> = {
  work: ['Pedestrian', 'Walking to work'],
  shop: ['Pedestrian', 'Walking to the shops'],
};

/** A clicked car or walker: where it's going and why (a real trip from the sim's assignment). */
function CarInspector({ id, walker = false }: { id: number; walker?: boolean }) {
  const game = useGameUpdates(300);
  const car = walker ? game.renderer.pedestrians.walker(id) : game.renderer.traffic.car(id);
  const name = (bid: number) => {
    if (!bid) return 'the regional highway';
    const b = game.world.buildings.get(bid);
    if (b) return ZONED_DEFS.get(b.def)?.name ?? 'a building';
    // Rail freight (M20): trucks to and from a terminal.
    const c = game.world.civics.get(bid);
    if (c) return `the ${(CIVIC.get(c.def)?.name ?? 'building').toLowerCase()}`;
    return 'a building (since demolished)';
  };
  if (!car)
    return (
      <aside class="inspector panel" data-testid="inspector">
        <header>
          <div>
            <h2>Arrived</h2>
            <div class="sub">{walker ? 'They reached' : 'This vehicle reached'} its destination.</div>
          </div>
          <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
            ×
          </button>
        </header>
      </aside>
    );
  const byRail = !walker && game.world.civics.get(car.trip.to)?.def === 'railfreight';
  const bySea = !walker && game.world.civics.get(car.trip.to)?.def === 'seaport';
  const [title, what] = bySea
    ? car.trip.purpose === 'export'
      ? ['Export truck', 'Taking goods to the seaport, to go on by ship']
      : ['Import truck', 'Bringing goods off a ship at the seaport']
    : byRail
      ? car.trip.purpose === 'export'
        ? ['Export truck', 'Taking goods to the rail freight terminal, to go on by train']
        : ['Import truck', 'Bringing goods off the train at the rail freight terminal']
      : ((walker ? WALKING : PURPOSE)[car.trip.purpose] ?? ['Vehicle', '']);
  const forward = car.legs[0] === car.trip.legs[0];
  const [from, to] = forward ? [car.trip.from, car.trip.to] : [car.trip.to, car.trip.from];
  const home = (car.trip.purpose === 'work' || car.trip.purpose === 'outcommute') && !forward;
  const leg = car.legs[car.leg];
  const seg = leg ? game.world.netState.segments.get(leg.seg) : undefined;
  const vc = leg ? game.world.segVC(leg.seg, 1) : 0;
  const length = car.legs.reduce((s, l) => s + Math.abs(l.s1 - l.s0), 0);
  return (
    <aside class="inspector panel" data-testid="inspector">
      <header>
        <div>
          <h2>{title}</h2>
          <div class="sub">
            {home ? (walker ? 'Walking home from work' : 'Heading home from work') : what}
          </div>
        </div>
        <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
          ×
        </button>
      </header>
      <dl data-testid="car-trip">
        <dt>From</dt>
        <dd>{name(from)}</dd>
        <dt>To</dt>
        <dd>{name(to)}</dd>
        <dt>Route</dt>
        <dd>{(length / 1000).toFixed(1)} km</dd>
        <dt>On</dt>
        <dd>{seg ? game.names.street(seg.id) : '—'}</dd>
        {walker ? (
          <>
            <dt>On foot</dt>
            <dd>About {Math.max(1, Math.round(length / 1.4 / 60))} min</dd>
          </>
        ) : (
          <>
            <dt>Traffic here</dt>
            <dd class={vc > 1 ? 'neg' : ''}>
              {vc > 1 ? 'Jammed at rush hour' : vc > 0.7 ? 'Busy' : 'Flowing'}
            </dd>
          </>
        )}
      </dl>
    </aside>
  );
}

function CivicInspector({ id }: { id: number }) {
  const game = useGameUpdates(200);
  const [d, setD] = useState<CivicDetails | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      void game.client.query<CivicDetails | null>({ type: 'civic', id }).then((r) => live && setD(r));
    load();
    const t = setInterval(load, 700);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id, game]);
  if (!d) return null;
  const UNIT: Record<string, string> = { power: 'Power', water: 'Water', sewage: 'Sewage handled' };
  return (
    <aside class="inspector panel" data-testid="inspector">
      <header>
        <div>
          <h2>{d.name}</h2>
          <div class="sub address">
            {(() => {
              const c = game.world.civics.get(d.id);
              return c ? game.names.address(c.x, c.z) : '';
            })()}
          </div>
          <div class="sub">{d.blurb}</div>
        </div>
        <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
          ×
        </button>
      </header>
      {!d.access && (
        <div class="warn">
          {d.transit?.mode === 'train'
            ? 'Not facing a railway: no trains can call.'
            : "Not facing a road: it can't reach anyone."}
        </div>
      )}
      {(() => {
        const c = game.world.civics.get(d.id);
        if (c?.flooded)
          return (
            <div class="warn" data-testid="inspector-damage">
              Under flood water: out of action until it drains.
            </div>
          );
        if (c && c.damage > 0)
          return (
            <div class="warn" data-testid="inspector-damage">
              Damaged: out of action while it's repaired ({c.damage} h left).
            </div>
          );
        return null;
      })()}
      {d.project && <ProjectProgress p={d.project} />}
      {d.transit?.why && (
        <div class="warn" data-testid="transit-why">
          {d.transit.why}
        </div>
      )}
      {d.railFreight && !d.railFreight.linked && (
        <div class="warn" data-testid="freight-unlinked">
          Its railway isn't linked to the regional railway: lay track from the rail link at the map's west
          edge.
        </div>
      )}
      {d.polluted && (
        <div class="warn">
          The ground here is polluted, so this pump's water is too. Move it away from outflows, landfills and
          heavy industry.
        </div>
      )}
      <dl>
        {d.produces.map((p) => (
          <>
            <dt key={p.utility}>{UNIT[p.utility] ?? p.utility}</dt>
            <dd>{p.output.toLocaleString('en-US')} units</dd>
          </>
        ))}
        {d.garbage && (
          <>
            <dt>Trucks out</dt>
            <dd data-testid="garbage-trucks">
              {d.garbage.out} of {d.garbage.trucks}
            </dd>
            <dt>Collected</dt>
            <dd
              data-testid="garbage-collected"
              class={
                d.garbage.collectedAllLastDay < d.garbage.producedPerDay * 0.95 && d.garbage.piles > 0
                  ? 'neg'
                  : ''
              }
            >
              {d.garbage.collectedLastDay.toLocaleString('en-US')} a day
              {d.garbage.collectedAllLastDay > d.garbage.collectedLastDay &&
                ` (${d.garbage.collectedAllLastDay.toLocaleString('en-US')} all sites)`}
            </dd>
            <dt>City makes</dt>
            <dd data-testid="garbage-produced">{d.garbage.producedPerDay.toLocaleString('en-US')} a day</dd>
            <dt>On the streets</dt>
            <dd data-testid="garbage-backlog" class={d.garbage.piles > 0 ? 'neg' : ''}>
              {d.garbage.backlog.toLocaleString('en-US')}
              {d.garbage.piles > 0 ? `, piles at ${d.garbage.piles}` : ''}
            </dd>
            <dt>Rounds</dt>
            <dd data-testid="garbage-rounds">
              {d.garbage.roundHours
                ? `${d.garbage.roundHours} h, ${d.garbage.stopsPerRound} ${d.garbage.stopsPerRound === 1 ? 'stop' : 'stops'}, ${d.garbage.loadPerRound} of ${d.garbage.truckCapacity} a load`
                : '—'}
            </dd>
            {d.garbage.storage > 0 && (
              <>
                <dt>Landfill used</dt>
                <dd class={d.garbage.stored >= d.garbage.storage ? 'neg' : ''}>
                  {Math.round((d.garbage.stored / d.garbage.storage) * 100)}%
                </dd>
              </>
            )}
            {d.garbage.process > 0 && (
              <>
                <dt>Processed today</dt>
                <dd>
                  {d.garbage.processedToday} / {d.garbage.process}
                </dd>
              </>
            )}
          </>
        )}
      </dl>
      {d.garbage && <GarbageTrucks civicId={d.id} g={d.garbage} />}
      {d.plough && (
        <dl data-testid="plough-details">
          <dt>Ploughs out</dt>
          <dd>
            {d.plough.out} of {d.plough.ploughs}
          </dd>
          <dt>Reach</dt>
          <dd>about {(d.plough.reach / 1000).toFixed(0)} km of road</dd>
          <dt>Cleared</dt>
          <dd>
            {(d.plough.today / 1000).toFixed(1)} km today, {(d.plough.yesterday / 1000).toFixed(1)} km
            yesterday
          </dd>
        </dl>
      )}
      <dl>
        {d.service && (
          <>
            {d.service.vehicles > 0 && (
              <>
                <dt>{VEHICLE_NAMES[d.service.kind] ?? 'Vehicles'} out</dt>
                <dd data-testid="civic-vehicles">
                  {d.service.out} / {d.service.vehicles}
                </dd>
              </>
            )}
            {d.service.seats > 0 && (
              <>
                <dt>{d.service.kind === 'health' ? 'Beds filled' : 'Seats filled'}</dt>
                <dd class={d.service.used >= d.service.seats ? 'neg' : ''}>
                  {d.service.used.toLocaleString('en-US')} / {d.service.seats.toLocaleString('en-US')}
                </dd>
              </>
            )}
            <dt>Buildings covered</dt>
            <dd data-testid="civic-reach">{d.service.reach.toLocaleString('en-US')}</dd>
          </>
        )}
        {d.transit && (
          <>
            <dt>{d.transit.mode === 'train' ? 'Stations on the line' : 'Stops served'}</dt>
            <dd data-testid="depot-stops">{d.transit.stops}</dd>
            <dt>{d.transit.mode === 'train' ? 'Trains' : d.transit.mode === 'tram' ? 'Trams' : 'Buses'}</dt>
            <dd data-testid="depot-vehicles">
              {d.transit.buses}
              {d.transit.headwayMinutes ? ` · every ${d.transit.headwayMinutes} min` : ''}
            </dd>
            <dt>{d.transit.mode === 'train' ? 'There and back' : 'Round trip'}</dt>
            <dd>{d.transit.loopMinutes ? `${d.transit.loopMinutes} min` : '—'}</dd>
            <dt>Riders</dt>
            <dd data-testid="depot-riders" class={d.transit.full ? 'neg' : ''}>
              {d.transit.riders.toLocaleString('en-US')} trips/day
              {d.transit.full
                ? ` (${d.transit.mode === 'train' ? 'trains' : d.transit.mode === 'tram' ? 'trams' : 'buses'} full)`
                : ''}
            </dd>
            {d.transit.capacity > 0 && (
              <>
                <dt>Carries</dt>
                <dd>{d.transit.capacity.toLocaleString('en-US')} passengers an hour</dd>
              </>
            )}
            {d.transit.mode === 'train' && (
              <>
                <dt>Here</dt>
                <dd data-testid="station-use">
                  {d.transit.here.toLocaleString('en-US')} getting on or off a day
                </dd>
              </>
            )}
          </>
        )}
        {d.railLink && (
          <>
            <dt>Track</dt>
            <dd data-testid="raillink-joined">
              {d.railLink.joined
                ? 'Joined to the city’s railways'
                : 'Nothing joined yet: lay railway from its end (the road tool’s Railway type)'}
            </dd>
            <dt>Freight trains</dt>
            <dd>
              {d.railLink.freight > 0
                ? `${d.railLink.freight.toLocaleString('en-US')} truckloads/day · ${trainsText(d.railLink.freight)}`
                : 'None yet: a rail freight terminal on joined track loads them'}
            </dd>
            <dt>By train</dt>
            <dd data-testid="raillink-riders">
              {d.railLink.riders > 0
                ? `${d.railLink.riders.toLocaleString('en-US')} commuters and shoppers from the neighbours a day`
                : 'No one yet: stations on joined track bring the neighbours’ commuters'}
            </dd>
          </>
        )}
        {d.railFreight && (
          <>
            <dt>Onto trains</dt>
            <dd data-testid="freight-trucks">
              {d.railFreight.trucks.toLocaleString('en-US')} truckloads/day
              {d.railFreight.trucks > 0 ? ` · ${trainsText(d.railFreight.trucks)}` : ''}
            </dd>
          </>
        )}
        {d.port && (
          <>
            <dt>{d.port.kind === 'airport' ? 'Flying in' : 'By sea'}</dt>
            <dd data-testid="port-visitors">{formatNumber(d.port.visitors)} visitors a day</dd>
            {d.port.kind === 'seaport' && (
              <>
                <dt>Onto ships</dt>
                <dd data-testid="port-loads">
                  {formatNumber(d.port.loads)} truckloads/day off the highway
                  {d.port.loads > 0 ? ` · ${Math.max(1, Math.round(d.port.loads / 120))} ships a day` : ''}
                </dd>
              </>
            )}
            {d.port.kind === 'airport' && (
              <>
                <dt>Flights</dt>
                <dd>
                  {Math.max(1, Math.round(d.port.visitors / 90))} a day · loud along the runway (noise map)
                </dd>
              </>
            )}
          </>
        )}
        {d.special?.kind === 'resource' && (
          <>
            <dt>Output</dt>
            <dd data-testid="civic-output">{d.special.perDay} units/day</dd>
            <dt>Deposit left</dt>
            <dd>{d.special.left}%</dd>
          </>
        )}
        {d.special?.kind === 'tourism' && (
          <>
            {d.special.draw > 0 && (
              <>
                <dt>Draws</dt>
                <dd>{d.special.draw.toLocaleString('en-US')} visitors/day</dd>
              </>
            )}
            {d.special.rooms > 0 && (
              <>
                <dt>Rooms</dt>
                <dd>{d.special.rooms.toLocaleString('en-US')}</dd>
              </>
            )}
            <dt>City visitors</dt>
            <dd>{game.world.stats.visitors.toLocaleString('en-US')}/day</dd>
          </>
        )}
        <dt>Upkeep</dt>
        <dd>
          ${d.upkeep.toLocaleString('en-US')}/month ({d.funding}% funding)
        </dd>
      </dl>
      <ModuleList civicId={d.id} def={d.def} />
      {/* The regional rail link stays put: it belongs to the regional railway (Phase 2 review). */}
      {!d.railLink && (
        <BulldozeButton
          key={d.id}
          name={d.name}
          refund={d.refund}
          moveFee={moveFee(d.def)}
          onMove={() => game.tools.startMove(d.id, d.def)}
          onConfirm={() => {
            void game.dispatch({ type: 'bulldoze', target: { kind: 'civic', id: d.id } });
            game.select(null);
          }}
        />
      )}
    </aside>
  );
}

/** What the garbage figures say, in a line: keeping up, or what would help. */
function garbageVerdict(g: NonNullable<CivicDetails['garbage']>): string {
  const behind = g.piles > 0 && g.collectedAllLastDay < g.producedPerDay * 0.95;
  if (!behind) return g.piles > 0 ? 'Clearing the last piles.' : 'The trucks are keeping up.';
  const busy = g.out >= g.trucks;
  const far = g.roundHours >= 8;
  if (busy && g.extraTrucks < g.maxExtraTrucks)
    return far
      ? 'Every truck is out and rounds are long: buy a truck, or build a site closer to town.'
      : 'Every truck is out and garbage is piling up: buy another truck.';
  if (busy) return 'Every truck is out: build another site closer to the piles.';
  return 'Some piles are out of reach: connect them by road or build a site nearer.';
}

/** Extra trucks for a garbage facility, bought one at a time up to a limit. */
function GarbageTrucks({ civicId, g }: { civicId: number; g: NonNullable<CivicDetails['garbage']> }) {
  const game = useGameUpdates(300);
  const m = MODULE.get('garbageTruck')!;
  const full = g.extraTrucks >= g.maxExtraTrucks;
  return (
    <section class="trucks" data-testid="garbage-verdict">
      <p class="muted">{garbageVerdict(g)}</p>
      <div class="module-row">
        <div>
          <strong>Extra trucks</strong>
          <div class="muted">
            {g.extraTrucks} of {g.maxExtraTrucks} bought. Each carries {g.truckCapacity} and costs +$
            {m.upkeep}/month.
          </div>
        </div>
        <button
          class="btn small"
          data-testid="buy-truck"
          disabled={full}
          onClick={() =>
            void game.dispatch({ type: 'addModule', civic: civicId, module: m.id }).then((r) => {
              if (r.ok) game.audio?.play('place');
              else game.toast(r.reason, 'bad');
            })
          }
        >
          {full ? 'All bought' : `Buy a truck $${m.cost.toLocaleString('en-US')}`}
        </button>
      </div>
    </section>
  );
}

/** Add-on modules for a service building: what's installed and what can be added. */
function ModuleList({ civicId, def }: { civicId: number; def: string }) {
  const game = useGameUpdates(300);
  // Extra garbage trucks are bought in the garbage section, next to the figures that call for them.
  const list = modulesFor(def).filter((m) => !m.trucks);
  if (!list.length) return null;
  const installed = game.world.civics.get(civicId)?.modules ?? [];
  const st = game.world.stats;
  return (
    <section class="modules" data-testid="modules">
      <h3>Modules</h3>
      {list.map((m) => {
        const has = installed.includes(m.id);
        const locked = !st.unlockAll && st.peak < m.unlockPopulation;
        return (
          <div key={m.id} class="module-row">
            <div>
              <strong>{m.name}</strong>
              <div class="muted">
                {m.blurb} +${m.upkeep}/month.
                {locked ? ` Unlocks at ${m.unlockPopulation.toLocaleString('en-US')} residents.` : ''}
              </div>
            </div>
            {has ? (
              <span class="module-done">Added</span>
            ) : (
              <button
                class="btn small"
                disabled={locked}
                data-testid={`add-module-${m.id}`}
                onClick={() =>
                  void game.dispatch({ type: 'addModule', civic: civicId, module: m.id }).then((r) => {
                    if (r.ok) game.audio?.play('place');
                    else game.toast(r.reason, 'bad');
                  })
                }
              >
                Add ${m.cost.toLocaleString('en-US')}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}

function BuildingInspector({ id }: { id: number | null }) {
  const game = useGameUpdates(200);
  const [d, setD] = useState<BuildingDetails | null>(null);
  useEffect(() => {
    if (id === null) {
      setD(null);
      return;
    }
    let live = true;
    const load = () =>
      void game.client.query<BuildingDetails | null>({ type: 'building', id }).then((r) => live && setD(r));
    load();
    const t = setInterval(load, 600);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id, game]);
  if (id === null || !d) return null;
  const kind =
    d.zone === 3
      ? `${DENSITY_NAMES[d.density]} industry · ${INDUSTRY_TIER_NAMES[d.wealth]}`
      : `${DENSITY_NAMES[d.density]} ${ZONE_NAMES[d.zone]!.toLowerCase()} · ${WEALTH_NAMES[d.wealth]}`;
  const people = d.isResidential ? 'Residents' : 'Workers';
  const left = d.abandonAt - d.distress;
  return (
    <aside class="inspector panel" data-testid="inspector">
      <header>
        <div>
          <h2>{d.name}</h2>
          <div class="sub">
            {kind} · Level {d.level}
          </div>
          <div class="sub address" data-testid="inspector-address">
            {(() => {
              const b = game.world.buildings.get(d.id);
              return b ? game.names.address(b.x, b.z) : '';
            })()}
          </div>
        </div>
        <button class="btn icon" aria-label="Close" onClick={() => game.select(null)}>
          ×
        </button>
      </header>
      <div class={`status s${d.state}`}>
        {STATE_NAMES[d.state]}
        {d.state === 0 ? ` · ${Math.round(d.progress * 100)}%` : ''}
      </div>
      {!d.connected && <div class="warn">No road link to the highway: nobody can reach this building.</div>}
      {d.fire > 0 && (
        <div class="warn fire" data-testid="inspector-fire">
          On fire ({Math.round(d.fire * 100)}%).{' '}
          {d.coverage.fire > 0 ? 'Fire engines are on their way.' : 'No fire station can reach it quickly.'}
        </div>
      )}
      {d.state === 3 && <div class="warn">In ruins. The rubble is cleared after a day or so.</div>}
      {(game.world.buildings.get(d.id)?.flags ?? 0) & 1024 ? (
        <div class="warn" data-testid="inspector-flooded">
          Flooded.{' '}
          {d.zone === 1 ? 'The residents are sitting it out upstairs.' : 'Closed until the water drains.'}
        </div>
      ) : null}
      <dl>
        <dt>{people}</dt>
        <dd data-testid="inspector-pop">
          {formatNumber(d.pop)} / {formatNumber(d.cap)}
        </dd>
        {d.isResidential && (
          <>
            <dt>Employed</dt>
            <dd>
              {formatNumber(d.employed)}
              {d.toRegion > 0 && (
                <span class="muted" data-testid="inspector-out-of-town">
                  {' '}
                  ({formatNumber(d.toRegion)} in a neighbouring town)
                </span>
              )}
            </dd>
            <dt>Commute</dt>
            <dd>{d.employed > 0 ? `${Math.max(1, Math.round(d.commute / 60))} min` : '—'}</dd>
            <dt>Shopping nearby</dt>
            <dd>{Math.round(d.shop * 100)}%</dd>
          </>
        )}
        {!d.isResidential && d.fromRegion > 0 && (
          <>
            <dt>From out of town</dt>
            <dd data-testid="inspector-from-region">
              {formatNumber(d.fromRegion)} of the workers commute in from the neighbours
            </dd>
          </>
        )}
        {d.zone === 2 && (
          <>
            <dt>Customers</dt>
            <dd>{Math.round(d.shop * 100)}% of capacity</dd>
          </>
        )}
        {d.state === 1 && d.isResidential && (
          <>
            <dt>Health</dt>
            <dd class={d.sick > 0 && d.treated < 0.5 ? 'neg' : ''} data-testid="inspector-health">
              {d.sick === 0 ? 'Everyone is well' : `${d.sick} sick · ${Math.round(d.treated * 100)}% in care`}
            </dd>
            <dt>Schooling</dt>
            <dd>{EDU_NAMES[Math.min(3, Math.floor(d.edu + 0.25))]}</dd>
          </>
        )}
        {d.state === 1 && d.zone !== 3 && (
          <>
            <dt>Air</dt>
            <dd class={d.air > 0.2 ? 'neg' : ''}>
              {d.air < 0.05 ? 'Clean' : d.air < 0.2 ? 'Hazy' : 'Smoggy'}
            </dd>
          </>
        )}
        {d.state === 1 && (
          <>
            <Supply label="Power" v={d.power} />
            <Supply label="Water" v={d.water} />
            <Supply label="Sewage" v={d.sewage} />
            <dt>Garbage waiting</dt>
            <dd class={d.garbage >= 20 ? 'neg' : ''}>{d.garbage} units</dd>
          </>
        )}
      </dl>
      {d.closed && (
        <div class="warn">Closed: no power or water for too long. It reopens once both are back.</div>
      )}
      {d.factors.length > 0 && (
        <section>
          <h3>Mood</h3>
          <Mood value={d.happiness} />
          <ul class="factors" data-testid="inspector-factors">
            {d.factors.map((f) => (
              <li key={f.label} class={f.value > 0.004 ? 'pos' : f.value < -0.004 ? 'neg' : 'neutral'}>
                <span>{f.label}</span>
                <span>
                  {f.value > 0 ? '+' : ''}
                  {Math.round(f.value * 100)}%
                </span>
              </li>
            ))}
          </ul>
          {needsOf(d).length > 0 && (
            <div class="needs" data-testid="inspector-needs">
              <h4>Would help</h4>
              <ul>
                {needsOf(d).map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          )}
          {d.distress > 0 && d.state === 1 && (
            <div class="warn">
              Unhappy: {d.isResidential ? 'residents will move out' : 'the business will close'} in about{' '}
              {Math.max(1, Math.round(left))} hours if nothing changes.
            </div>
          )}
        </section>
      )}
      {d.state === 1 && (
        <section>
          <h3>Services</h3>
          <ul class="coverage" data-testid="inspector-coverage">
            {SERVICE_ROWS.filter(([k]) => d.isResidential || (k !== 'education' && k !== 'health')).map(
              ([k, label]) => (
                <Coverage key={k} label={label} v={d.coverage[k]} />
              ),
            )}
          </ul>
          <div class="sub">Crime nearby: {d.crime < 0.05 ? 'low' : d.crime < 0.3 ? 'some' : 'high'}</div>
        </section>
      )}
      <BulldozeButton
        key={d.id}
        name={d.name}
        refund={0}
        onConfirm={() => {
          void game.dispatch({ type: 'bulldoze', target: { kind: 'building', id: d.id } });
          game.select(null);
        }}
      />
    </aside>
  );
}

/** A big project's stages, how far along it is, what it's waiting for, and its perk (M17). */
function ProjectProgress({ p }: { p: NonNullable<CivicDetails['project']> }) {
  const open = p.stage >= p.stages.length;
  const cur = p.stages[Math.min(p.stage, p.stages.length - 1)]!;
  const next = p.stages[p.stage + 1];
  return (
    <section class="project-progress" data-testid="project-progress">
      <ol class="project-stages">
        {p.stages.map((st, k) => (
          <li key={k} class={k < p.stage ? 'done' : k === p.stage ? 'now' : ''}>
            <span>{st.name}</span>
            <small>
              {st.months} mo · ${st.cost.toLocaleString('en-US')}
            </small>
          </li>
        ))}
      </ol>
      {open ? (
        <p class="project-status ok" data-testid="project-status">
          Open{p.nextEvent ? ` · ${p.nextEvent}` : ''}
        </p>
      ) : p.waiting && next ? (
        <p class="project-status warn" data-testid="project-status">
          Waiting for ${next.cost.toLocaleString('en-US')} to start the {next.name.toLowerCase()}. The site
          carries on as soon as the treasury can pay.
        </p>
      ) : (
        <>
          <div class="milestone-bar" aria-label="Progress on this stage">
            <span style={{ width: `${Math.round((p.months / cur.months) * 100)}%` }} />
          </div>
          <p class="project-status" data-testid="project-status">
            {cur.name}: {p.months} of {cur.months} months · opens in about {p.monthsLeft} month
            {p.monthsLeft === 1 ? '' : 's'}
          </p>
        </>
      )}
      <p class="project-perk">
        <strong>{open ? 'Perk' : 'When it opens'}:</strong> {p.perk}
      </p>
    </section>
  );
}
