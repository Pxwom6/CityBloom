import { requirementStatus, type RequirementContext } from '../data/projects';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { BUILDABLE_ROADS, ROAD_TYPES, isRail, type RoadTypeId } from '../data/roads';
import type { ZoneLetter } from '../data/zones';
import type { RoadMode } from '../tools/roadTool';
import type { ToolId } from '../tools/manager';
import { useGame, useGameUpdates } from './hooks';
import { CIVIC_DEFS, type CivicCategory, type CivicDef } from '../data/civic';
import { TRAM, TRANSIT } from '../data/balance';
import { POLICY, type PolicyId } from '../data/policies';
import { districtColour } from '../client/districtView';
import { MAPS } from '../client/overlay';
import {
  IconBolt,
  IconBulldozer,
  IconDrop,
  IconLayers,
  IconTrash,
  IconFlame,
  IconShield,
  IconHealth,
  IconBook,
  IconTree,
  IconBus,
  IconCurve,
  IconUpgrade,
  IconEraser,
  IconFactory,
  IconFreeform,
  IconGrid,
  IconHouse,
  IconLock,
  IconPointer,
  IconRoad,
  IconShop,
  IconStraight,
  IconRedo,
  IconCamera,
  IconCrane,
  IconUndo,
  IconZone,
  IconAlert,
  IconQuake,
  IconTornado,
  IconWaves,
  IconMeteor,
  IconLandmark,
  IconCrate,
  IconOneWay,
  IconDrawOneWay,
  IconRoundabout,
  IconTram,
  IconDistrict,
  IconTerrain,
  IconRaise,
  IconLower,
  IconLevel,
  IconSmooth,
} from './icons';
import { DISASTER_KINDS } from '../sim/systems/disasters';
import { modKey } from '../client/platform';
import { DISASTER_INFO } from '../tools/disasterTool';
import { TERRAFORM, TERRAFORM_MODES, type TerraformMode } from '../data/terraform';

interface TipContent {
  title: string;
  lines?: string[];
  key?: string;
}

function Tip({ tip, children }: { tip: TipContent; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <span class="tip-anchor" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      {children}
      {open && (
        <span class="tip" role="tooltip">
          <strong>{tip.title}</strong>
          {tip.key && <kbd>{tip.key}</kbd>}
          {tip.lines?.map((l) => (
            <span class="tip-line" key={l}>
              {l}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export function ToolButton(props: {
  id: string;
  active: boolean;
  onClick: () => void;
  tip: TipContent;
  children: ComponentChildren;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <Tip tip={props.tip}>
      <button
        class={`tool-btn ${props.active ? 'active' : ''} ${props.class ?? ''}`}
        data-testid={props.id}
        aria-label={props.tip.title}
        aria-pressed={props.active}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.children}
      </button>
    </Tip>
  );
}

const ROAD_ICON_COLOURS: Record<RoadTypeId, string> = {
  dirt: '#b59a6d',
  street: '#6b7079',
  avenue: '#4d5259',
  boulevard: '#3a3f46',
  motorway: '#2f343a',
  ramp: '#5a6068',
  rail: '#7a6a58',
  mainline: '#7a6a58',
  highway: '#333',
};
const ZONES: {
  z: ZoneLetter | 'none';
  name: string;
  Icon: typeof IconHouse;
  key: string;
  cls: string;
  effect: string;
}[] = [
  {
    z: 'R',
    name: 'Residential',
    Icon: IconHouse,
    key: 'Z',
    cls: 'zone-r',
    effect: 'Homes. Residents want jobs, shops and services.',
  },
  {
    z: 'C',
    name: 'Commercial',
    Icon: IconShop,
    key: 'X',
    cls: 'zone-c',
    effect: 'Shops and offices. Need customers, workers and goods.',
  },
  {
    z: 'I',
    name: 'Industrial',
    Icon: IconFactory,
    key: 'C',
    cls: 'zone-i',
    effect: 'Factories. Need workers and a way to ship freight.',
  },
  {
    z: 'none',
    name: 'Dezone',
    Icon: IconEraser,
    key: 'V',
    cls: '',
    effect: 'Remove zoning from empty cells.',
  },
];

export function Toolbar() {
  const game = useGameUpdates(100);
  const tools = game.tools;
  const active: ToolId = tools.activeId;
  // Unlocks go by the highest population reached (and the unlock-all cheat / sandbox).
  const pop = game.world.stats.unlockAll ? Infinity : game.world.stats.peak;
  const use = (id: ToolId) => tools.use(active === id && id !== 'select' ? 'select' : id);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [disastersOpen, setDisastersOpen] = useState(false);
  return (
    <div class="toolbar-wrap">
      {active === 'road' && (
        <div class="subbar panel" data-testid="road-options">
          {BUILDABLE_ROADS.map((id) => {
            const rt = ROAD_TYPES[id];
            const locked = pop < rt.unlockPopulation;
            return (
              <ToolButton
                key={id}
                id={`road-${id}`}
                active={tools.road.type === id}
                disabled={locked}
                onClick={() => tools.road.setType(id)}
                tip={{
                  title: rt.name,
                  lines: isRail(id)
                    ? [
                        `$${rt.costPerMetre}/m to build · $${(rt.upkeepPerMetre * 100).toFixed(0)}/100 m monthly upkeep`,
                        `Two tracks · trains up to ${rt.speed} km/h · no cars`,
                        'Crosses dirt roads, streets and avenues at level crossings (drawn across the middle of a road); goes over boulevards and highways on a bridge',
                        `Climbs up to ${(rt.maxGrade * 100).toFixed(1)}\u00a0% and curves no tighter than ${rt.minRadius ?? 0} m radius`,
                        'Stations on connected track run a train line; a rail freight terminal needs track linked to the regional railway',
                        ...(locked
                          ? [`Unlocks at ${rt.unlockPopulation.toLocaleString('en-US')} residents`]
                          : []),
                      ]
                    : [
                        `$${rt.costPerMetre}/m to build · $${(rt.upkeepPerMetre * 100).toFixed(0)}/100 m monthly upkeep`,
                        `${rt.lanes} lane${rt.lanes === 1 ? '' : 's'} · ${rt.speed} km/h · ${rt.capacity.toLocaleString('en-US')} vehicles/h`,
                        rt.access
                          ? `Density up to ${['low', 'medium', 'high'][rt.maxDensity]}`
                          : 'No zoning or buildings along it',
                        `Climbs up to ${Math.round(rt.maxGrade * 100)}\u00a0%: steeper ground is cut and filled (earthworks cost extra)`,
                        rt.blurb,
                        ...(locked
                          ? [`Unlocks at ${rt.unlockPopulation.toLocaleString('en-US')} residents`]
                          : []),
                      ],
                }}
              >
                {locked ? (
                  <IconLock />
                ) : (
                  <span class="road-swatch" style={{ background: ROAD_ICON_COLOURS[id] }} />
                )}
                <span class="tool-label">
                  {rt.name.replace(' road', '').replace('City highway', 'Highway')}
                </span>
              </ToolButton>
            );
          })}
          <span class="sep" />
          {(
            [
              [
                'straight',
                IconStraight,
                'Straight',
                'Drag, or click start and end. Keeps drawing from the last end.',
              ],
              ['curve', IconCurve, 'Curve', 'Click the start, the bend, then the end.'],
              ['free', IconFreeform, 'Free-form', 'Press and draw any shape.'],
              [
                'upgrade',
                IconUpgrade,
                'Upgrade',
                'Click a road to change it to the selected type. Buildings along it stay where they can; a gentler type may need its slope regraded.',
              ],
              [
                'oneway',
                IconOneWay,
                'One-way',
                'Click a road to make it one-way; click again to turn it round, and again for two-way. Free. One-way roads carry a quarter more traffic, but trips may have to go round.',
              ],
              [
                'roundabout',
                IconRoundabout,
                'Roundabout',
                'Click a junction (or a road) for a roundabout; drag out to size the ring. A roundabout passes far more traffic than a plain junction, at a few seconds more for each car when quiet.',
              ],
              [
                'tram',
                IconTram,
                'Tram track',
                `Click a street, avenue or boulevard to lay tram track ($${TRAM.trackCost}/m); click again to take it up. Drag along roads to lay a whole line. A tram depot on the track runs trams round the tram stops.${pop < TRAM.unlockPopulation ? ` Unlocks at ${TRAM.unlockPopulation.toLocaleString('en-US')} residents.` : ''}`,
              ],
            ] as [RoadMode, typeof IconCurve, string, string][]
          ).map(([m, Icon, name, how]) => (
            <ToolButton
              key={m}
              id={`mode-${m}`}
              active={tools.road.mode === m}
              disabled={m === 'tram' && pop < TRAM.unlockPopulation}
              onClick={() => tools.road.setMode(m)}
              tip={{ title: name, lines: [how], key: 'Tab' }}
            >
              {m === 'tram' && pop < TRAM.unlockPopulation ? <IconLock /> : <Icon />}
            </ToolButton>
          ))}
          <ToolButton
            id="draw-oneway"
            active={tools.road.oneWay}
            onClick={() => {
              tools.road.oneWay = !tools.road.oneWay;
              game.notify();
            }}
            tip={{
              title: 'Draw one-way',
              lines: ['New roads run one-way, in the direction you draw them. Ramps always do.'],
              key: 'O',
            }}
          >
            <IconDrawOneWay />
          </ToolButton>
          <ToolButton
            id="grid-snap"
            active={tools.road.grid}
            onClick={() => {
              tools.road.grid = !tools.road.grid;
              game.notify();
            }}
            tip={{ title: 'Grid snap', lines: ['Snap to an 8 m grid and 8 m lengths.'], key: 'G' }}
          >
            <IconGrid />
          </ToolButton>
        </div>
      )}
      {active === 'district' && <DistrictOptions />}
      {active === 'terrain' && <TerrainOptions />}
      {active === 'zone' && (
        <div class="subbar panel" data-testid="zone-options">
          {ZONES.map(({ z, name, Icon, key, cls, effect }) => (
            <ToolButton
              key={z}
              id={`zone-${z}`}
              class={cls}
              active={tools.zone.zone === z}
              onClick={() => tools.zone.setZone(z)}
              tip={{
                title: name,
                lines: [effect, 'Zoning is free. Shift-click a road to fill both sides.'],
                key,
              }}
            >
              <Icon />
              <span class="tool-label">{name}</span>
            </ToolButton>
          ))}
          <span class="sep" />
          <label class="brush">
            Brush
            <input
              type="range"
              min={8}
              max={96}
              step={8}
              value={tools.zone.radius}
              onInput={(e) => {
                tools.zone.radius = Number((e.target as HTMLInputElement).value);
                game.notify();
              }}
            />
            <span>{tools.zone.radius} m</span>
          </label>
        </div>
      )}
      {(active === 'place' || active === 'stop') && (
        <div class="subbar panel" data-testid="place-options">
          {CIVIC_DEFS.filter(
            (d) =>
              d.category === (active === 'stop' ? 'transit' : tools.place.category) &&
              // The regional rail link only while the city has none (Phase 2 review).
              (!d.railLink || game.world.stats.railLinkOffered),
          ).map((d) => {
            if (d.project) return <ProjectButton key={d.id} def={d} />;
            const locked = pop < d.unlockPopulation;
            const out = d.output ? Object.entries(d.output).map(([k, v]) => `${v} ${k} units`) : [];
            return (
              <ToolButton
                key={d.id}
                id={`place-${d.id}`}
                active={active === 'place' && tools.place.def === d.id}
                disabled={locked}
                onClick={() => {
                  tools.place.setDef(d.id);
                  tools.use('place');
                }}
                tip={{
                  title: d.name,
                  lines: [
                    `$${d.cost.toLocaleString('en-US')} to build · $${d.upkeep.toLocaleString('en-US')}/month upkeep`,
                    ...out,
                    ...(d.garbage ? [`${d.garbage.trucks} trucks`] : []),
                    ...(d.service ? [serviceLine(d.service)] : []),
                    d.blurb,
                    ...(d.railLink
                      ? [
                          'This city has no link to the regional railway yet (its west edge was built up when rail arrived). Click on the west edge to lay one.',
                        ]
                      : []),
                    ...(locked ? [`Unlocks at ${d.unlockPopulation.toLocaleString('en-US')} residents`] : []),
                  ],
                }}
              >
                {locked ? <IconLock /> : null}
                <span class="tool-label">{d.name}</span>
              </ToolButton>
            );
          })}
          {(active === 'stop' || tools.place.category === 'transit') && (
            <ToolButton
              id="place-busstop"
              active={active === 'stop' && !tools.stop.tram}
              onClick={() => {
                tools.stop.tram = false;
                tools.use('stop');
                game.notify();
              }}
              tip={{
                title: 'Bus stop',
                lines: [
                  `$${TRANSIT.stopCost} each · $${TRANSIT.stopUpkeep}/month`,
                  'Click beside a road. Homes and jobs within a few minutes’ walk can use it.',
                  'Stops need a bus depot; its buses loop through every stop they can reach.',
                ],
              }}
            >
              <span class="tool-label">Bus stop</span>
            </ToolButton>
          )}
          {(active === 'stop' || tools.place.category === 'transit') && (
            <ToolButton
              id="place-tramstop"
              active={active === 'stop' && tools.stop.tram}
              disabled={pop < TRAM.unlockPopulation}
              onClick={() => {
                tools.stop.tram = true;
                tools.use('stop');
                game.notify();
              }}
              tip={{
                title: 'Tram stop',
                lines: [
                  `$${TRANSIT.stopCost} each · $${TRANSIT.stopUpkeep}/month`,
                  'Click a road with tram track (lay it with the road tool’s Tram track mode).',
                  `People walk a little further to a tram (up to ${Math.round(TRANSIT.walkRadius * TRAM.walkFactor)} m) and like the smoother ride; a tram depot on the track runs its trams through every stop they reach.`,
                  ...(pop < TRAM.unlockPopulation
                    ? [`Unlocks at ${TRAM.unlockPopulation.toLocaleString('en-US')} residents`]
                    : []),
                ],
              }}
            >
              {pop < TRAM.unlockPopulation ? <IconLock /> : null}
              <span class="tool-label">Tram stop</span>
            </ToolButton>
          )}
        </div>
      )}
      {mapsOpen && <MapsMenu onClose={() => setMapsOpen(false)} />}
      {disastersOpen && <DisastersMenu onClose={() => setDisastersOpen(false)} />}
      <div class="toolbar panel" data-testid="toolbar">
        <ToolButton
          id="tool-select"
          active={active === 'select'}
          onClick={() => use('select')}
          tip={{ title: 'Select', lines: ['Drag to pan. Click things to inspect them.'], key: 'H / Esc' }}
        >
          <IconPointer />
        </ToolButton>
        <ToolButton
          id="tool-road"
          active={active === 'road'}
          onClick={() => use('road')}
          tip={{
            title: 'Roads',
            lines: ['Build roads off the highway. Buildings grow along them.'],
            key: 'T',
          }}
        >
          <IconRoad />
        </ToolButton>
        <ToolButton
          id="tool-zone"
          active={active === 'zone'}
          onClick={() => use('zone')}
          tip={{
            title: 'Zoning',
            lines: ['Paint residential, commercial and industrial zones.'],
            key: 'Z X C V',
          }}
        >
          <IconZone />
        </ToolButton>
        <ToolButton
          id="tool-district"
          active={active === 'district'}
          onClick={() => use('district')}
          tip={{
            title: 'Districts',
            lines: [
              'Paint named districts over the city, each with its own policies. The Districts panel shows their figures.',
            ],
            key: 'I',
          }}
        >
          <IconDistrict />
        </ToolButton>
        <ToolButton
          id="tool-terrain"
          active={active === 'terrain'}
          onClick={() => use('terrain')}
          tip={{
            title: 'Terrain',
            lines: [
              'Raise, lower, level or smooth the ground, paid for by the earth moved. Level a hillside before building for more lots.',
              'Roads and buildings hold the ground they stand on; water is left alone.',
            ],
            key: 'Shift+T',
          }}
        >
          <IconTerrain />
        </ToolButton>
        {(
          [
            ['power', IconBolt, 'Power', 'Power plants. Electricity flows along the roads.'],
            [
              'water',
              IconDrop,
              'Water and sewage',
              'Pumps bring water in; outflows or treatment plants take sewage away.',
            ],
            [
              'garbage',
              IconTrash,
              'Garbage and snow',
              'Trucks collect garbage from buildings in reach; a public works depot sends ploughs to clear snow.',
            ],
            ['fire', IconFlame, 'Fire', 'Fire stations cover what their engines can reach quickly by road.'],
            ['police', IconShield, 'Police', 'Police stations deter crime and answer calls along the roads.'],
            ['health', IconHealth, 'Health', 'Clinics and hospitals treat the sick and run ambulances.'],
            [
              'education',
              IconBook,
              'Education',
              'Schools seat the children of nearby homes; libraries help too.',
            ],
            ['parks', IconTree, 'Parks and plazas', 'Lift moods and land value in the streets around them.'],
            [
              'transit',
              IconBus,
              'Buses',
              'A depot runs buses round the stops you place. Riders leave their cars at home.',
            ],
            [
              'landmark',
              IconLandmark,
              'Tourism and landmarks',
              'Landmarks draw visitors who spend money and shop; hotels keep them overnight.',
            ],
            [
              'special',
              IconCrate,
              'Trade, research and ports',
              'Freight, ore mines and oil wells earn export income; a research park grows high-tech industry; an airport brings visitors and a seaport ships goods.',
            ],
            [
              'project',
              IconCrane,
              'Big projects',
              'A stadium, a launch complex, a solar tower array, a garden expo, a convention centre: built in stages over months, each with a lasting perk.',
            ],
          ] as [CivicCategory, typeof IconBolt, string, string][]
        ).map(([cat, Icon, name, blurb]) => (
          <ToolButton
            key={cat}
            id={`tool-${cat}`}
            active={
              (active === 'place' && tools.place.category === cat) || (cat === 'transit' && active === 'stop')
            }
            onClick={() => {
              if (
                (active === 'place' && tools.place.category === cat) ||
                (cat === 'transit' && active === 'stop')
              )
                tools.use('select');
              else {
                const first = CIVIC_DEFS.find((d) => d.category === cat)!;
                tools.place.setDef(first.id);
                tools.use('place');
              }
            }}
            tip={{ title: name, lines: [blurb] }}
          >
            <Icon />
          </ToolButton>
        ))}
        <ToolButton
          id="tool-bulldoze"
          active={active === 'bulldoze'}
          onClick={() => use('bulldoze')}
          tip={{ title: 'Bulldoze', lines: ['Demolish roads and buildings. Roads refund 25%.'], key: 'B' }}
        >
          <IconBulldozer />
        </ToolButton>
        <ToolButton
          id="tool-disasters"
          active={disastersOpen || active === 'disaster'}
          onClick={() => {
            if (active === 'disaster') tools.use('select');
            setDisastersOpen(!disastersOpen);
          }}
          tip={{
            title: 'Disasters',
            lines: [
              'Set off an earthquake, tornado, flood or meteor strike, or switch random disasters off.',
            ],
          }}
        >
          <IconAlert />
        </ToolButton>
        <span class="sep" />
        <ToolButton
          id="tool-maps"
          active={mapsOpen || game.overlay.active !== null}
          onClick={() => setMapsOpen(!mapsOpen)}
          tip={{
            title: 'Data maps',
            lines: ['See power, water, garbage, land value, pollution and resources at a glance.'],
            key: 'L',
          }}
        >
          <IconLayers />
        </ToolButton>
        <ToolButton
          id="tool-undo"
          active={false}
          disabled={!game.world.stats.undoAvailable}
          onClick={() => void game.undo()}
          tip={{
            title: game.world.stats.undoLabel ? `Undo the ${game.world.stats.undoLabel}` : 'Undo',
            lines: [
              'Take back the last action (up to 30), with its money: roads, zoning, buildings, bulldozing, moves.',
            ],
            key: `${modKey('Z')} or U`,
          }}
        >
          <IconUndo />
        </ToolButton>
        <ToolButton
          id="tool-redo"
          active={false}
          disabled={!game.world.stats.redoAvailable}
          onClick={() => void game.redo()}
          tip={{
            title: game.world.stats.redoLabel ? `Redo the ${game.world.stats.redoLabel}` : 'Redo',
            lines: ['Put back what you just undid.'],
            key: modKey('Z', true),
          }}
        >
          <IconRedo />
        </ToolButton>
        <ToolButton
          id="tool-photo"
          active={false}
          onClick={() => game.enterPhoto()}
          tip={{
            title: 'Photo mode',
            lines: [
              'Hide the interface, bring the camera down to street level, set the light, lens and colour, ride along with a car, and save a picture.',
            ],
            key: 'K',
          }}
        >
          <IconCamera />
        </ToolButton>
      </div>
    </div>
  );
}

function serviceLine(svc: NonNullable<CivicDef['service']>): string {
  const reach = `Reaches about ${Math.round((svc.range * 40) / 3.6 / 10) * 10} m of street`;
  const parts = [reach];
  if (svc.vehicles)
    parts.push(
      `${svc.vehicles} ${svc.vehicle === 'ambulance' ? 'ambulances' : svc.vehicle === 'police' ? 'patrol cars' : 'engines'}`,
    );
  if (svc.capacity)
    parts.push(`${svc.capacity.toLocaleString('en-US')} ${svc.kind === 'health' ? 'beds' : 'seats'}`);
  return parts.join(' · ');
}

export function ToolHintLabel() {
  const game = useGameUpdates(30);
  const h = game.hint;
  const ref = useRef<HTMLDivElement>(null);
  // Keep it on screen: long explanations wrap, and near the right or bottom edge the hint moves to
  // the other side of the cursor.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !h) return;
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    let x = h.x + 18;
    let y = h.y + 18;
    if (x + w > window.innerWidth - 8) x = Math.max(8, h.x - 18 - w);
    if (y + ht > window.innerHeight - 8) y = Math.max(8, h.y - 18 - ht);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
  if (!h) return null;
  return (
    <div
      ref={ref}
      class={`tool-hint ${h.tone}`}
      style={{ left: `${h.x + 18}px`, top: `${h.y + 18}px` }}
      data-testid="tool-hint"
    >
      {h.text}
    </div>
  );
}

/**
 * A tool's question at the pointer (P2: a road that would demolish buildings), in the style of the
 * inspector's bulldoze confirmation: the safe answer first and focused, so Enter keeps them.
 */
export function ToolQuestionCard() {
  const game = useGameUpdates(100);
  const q = game.question;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !q) return;
    let x = q.x + 18;
    let y = q.y + 18;
    if (x + el.offsetWidth > window.innerWidth - 8) x = Math.max(8, q.x - 18 - el.offsetWidth);
    if (y + el.offsetHeight > window.innerHeight - 8) y = Math.max(8, q.y - 18 - el.offsetHeight);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
  if (!q) return null;
  return (
    <div
      ref={ref}
      class="tool-question panel"
      style={{ left: `${q.x + 18}px`, top: `${q.y + 18}px` }}
      role="alertdialog"
      aria-label="Confirm"
      data-testid="tool-question"
    >
      <p>{q.text}</p>
      <div class="actions">
        <button class="btn" data-testid="tool-question-no" onClick={() => game.answer(false)} autoFocus>
          {q.no}
        </button>
        <button class="btn danger" data-testid="tool-question-yes" onClick={() => game.answer(true)}>
          {q.yes}
        </button>
      </div>
    </div>
  );
}

const DISASTER_ICONS = { earthquake: IconQuake, tornado: IconTornado, flood: IconWaves, meteor: IconMeteor };

/** Pick a disaster to aim, and switch random disasters on or off. */
function DisastersMenu({ onClose }: { onClose: () => void }) {
  const game = useGameUpdates(200);
  const on = game.randomDisasters;
  return (
    <div class="maps-menu disasters-menu panel" data-testid="disasters-menu">
      <div class="maps-group">
        <h4>Set off</h4>
        {DISASTER_KINDS.map((k) => {
          const Icon = DISASTER_ICONS[k];
          return (
            <button
              key={k}
              class="map-item disaster-item"
              data-testid={`disaster-${k}`}
              title={DISASTER_INFO[k].blurb}
              onClick={() => {
                game.tools.disaster.setKind(k);
                game.tools.use('disaster');
                onClose();
              }}
            >
              <Icon width={16} height={16} />
              {DISASTER_INFO[k].name}
            </button>
          );
        })}
      </div>
      <div class="maps-group">
        <h4>Random disasters</h4>
        <label class="volume-mute disaster-random">
          <input
            type="checkbox"
            checked={on}
            data-testid="random-disasters"
            onChange={(e) => game.setRandomDisasters((e.target as HTMLInputElement).checked)}
          />
          Now and then, once the city has grown
        </label>
      </div>
    </div>
  );
}

function MapsMenu({ onClose }: { onClose: () => void }) {
  const game = useGameUpdates(200);
  const groups = [...new Set(MAPS.map((m) => m.group))];
  return (
    <div class="maps-menu panel" data-testid="maps-menu">
      {groups.map((g) => (
        <div key={g} class="maps-group">
          <h4>{g}</h4>
          {MAPS.filter((m) => m.group === g).map((m) => (
            <button
              key={m.id}
              class={`map-item ${game.overlay.active === m.id ? 'active' : ''}`}
              data-testid={`map-${m.id}`}
              onClick={() => {
                game.overlay.set(game.overlay.active === m.id ? null : m.id);
                onClose();
              }}
            >
              {m.name}
            </button>
          ))}
        </div>
      ))}
      {game.overlay.active && (
        <button class="map-item off" onClick={() => (game.overlay.set(null), onClose())}>
          Hide data map
        </button>
      )}
    </div>
  );
}

/** Legend for the active data map. */
export function MapLegend() {
  const game = useGameUpdates(300);
  const res = game.overlay.last;
  if (!game.overlay.active || !res) return null;
  const name = MAPS.find((m) => m.id === game.overlay.active)?.name ?? '';
  const grad =
    res.ramp === 'traffic'
      ? 'linear-gradient(90deg, #3a9e5c, #9cc24a, #e8b43a, #e0662f, #b3261e)'
      : res.ramp === 'diverging'
        ? 'linear-gradient(90deg, #e34948, #f0efec, #2a78d6)'
        : 'linear-gradient(90deg, #cde2fb, #9ec5f4, #6da7ec, #3987e5, #256abf, #184f95, #0d366b)';
  return (
    <div
      class={`legend panel ${game.panel === 'budget' ? 'beside-budget' : game.panel ? 'beside-panel' : ''} ${
        ['road', 'zone', 'place', 'stop', 'district', 'terrain'].includes(game.tools.activeId)
          ? 'above-subbar'
          : ''
      }`}
      data-testid="map-legend"
    >
      <div class="legend-head">
        <strong>{name}</strong>
        <button class="btn icon" aria-label="Hide data map" onClick={() => game.overlay.set(null)}>
          ×
        </button>
      </div>
      <div class="legend-bar" style={{ background: grad }} />
      <div class="legend-labels">
        <span>{res.legend[0]}</span>
        <span>{res.legend[1]}</span>
      </div>
      {game.overlay.district !== null && game.world.districts.get(game.overlay.district) && (
        <div class="legend-note" data-testid="legend-district">
          Only {game.world.districts.get(game.overlay.district)!.name}{' '}
          <button class="btn small" onClick={() => game.overlay.setDistrict(null)}>
            Whole city
          </button>
        </div>
      )}
      {game.overlay.active === 'traffic' && (
        <div class="legend-note muted" data-testid="traffic-legend-note">
          Discs: junctions and roundabouts · Chevrons: one-way roads and ramps
          {game.world.roadIslands().list.length > 0 && ' · Red with no cars: no road link to the highway'}
        </div>
      )}
    </div>
  );
}

/** The district tool's options (M21): the district to paint, a new one, the eraser, the brush. */
function DistrictOptions() {
  const game = useGameUpdates(200);
  const t = game.tools.district;
  const list = [...game.world.districts.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  return (
    <div class="subbar panel" data-testid="district-options">
      <ToolButton
        id="district-new"
        active={t.district === 'new'}
        onClick={() => t.pick('new')}
        tip={{
          title: 'New district',
          lines: ['Your next stroke starts a district, named after the neighbourhood you start it in.'],
        }}
      >
        <span class="tool-label">+ New</span>
      </ToolButton>
      {list.map((d) => (
        <ToolButton
          key={d.id}
          id={`district-pick-${d.id}`}
          active={t.district === d.id}
          onClick={() => t.pick(d.id)}
          tip={{
            title: d.name,
            lines: [
              d.policies.length
                ? `Policies here: ${d.policies.map((p) => POLICY.get(p as PolicyId)?.name ?? p).join(', ')}`
                : 'No policies of its own yet: set them in the Districts panel.',
            ],
          }}
        >
          <span class="district-swatch" style={{ background: districtColour(d.color) }} />
          <span class="tool-label">{d.name}</span>
        </ToolButton>
      ))}
      <ToolButton
        id="district-erase"
        active={t.district === 0}
        onClick={() => t.pick(0)}
        tip={{ title: 'Erase', lines: ['Take cells out of any district.'] }}
      >
        <IconEraser />
      </ToolButton>
      <span class="sep" />
      <label class="brush">
        Brush
        <input
          type="range"
          min={16}
          max={192}
          step={16}
          value={t.radius}
          onInput={(e) => {
            t.radius = Number((e.target as HTMLInputElement).value);
            game.notify();
          }}
        />
        <span>{t.radius} m</span>
      </label>
      <ToolButton
        id="district-panel"
        active={game.panel === 'districts'}
        onClick={() => game.openPanel('districts')}
        tip={{ title: 'Districts panel', lines: ['Figures, names and policies for each district.'] }}
      >
        <span class="tool-label">Panel</span>
      </ToolButton>
    </div>
  );
}

const TERRAIN_ICON: Record<TerraformMode, typeof IconRaise> = {
  raise: IconRaise,
  lower: IconLower,
  level: IconLevel,
  smooth: IconSmooth,
};

/** The terrain tool's options (M24): raise, lower, level or smooth, and the brush. */
function TerrainOptions() {
  const game = useGameUpdates(200);
  const t = game.tools.terrain;
  return (
    <div class="subbar panel" data-testid="terrain-options">
      {TERRAFORM_MODES.map((m) => {
        const Icon = TERRAIN_ICON[m.id];
        return (
          <ToolButton
            key={m.id}
            id={`terrain-${m.id}`}
            active={t.mode === m.id}
            onClick={() => t.setMode(m.id)}
            tip={{ title: m.name, lines: [m.blurb, 'Tab picks the next one.'] }}
          >
            <Icon />
          </ToolButton>
        );
      })}
      <span class="sep" />
      <label class="brush">
        Brush
        <input
          type="range"
          data-testid="terrain-brush"
          min={TERRAFORM.radius.min}
          max={TERRAFORM.radius.max}
          step={16}
          value={t.radius}
          onInput={(e) => {
            t.radius = Number((e.target as HTMLInputElement).value);
            game.notify();
          }}
        />
        <span>{t.radius} m</span>
      </label>
      <span class="subbar-note">${TERRAFORM.costPerCubicMetre.toFixed(2)} per m³ moved</span>
    </div>
  );
}

/** A big project in the build menu (M17): what it costs and takes, what it needs, and its perk. */
function ProjectButton({ def }: { def: CivicDef }) {
  const game = useGame();
  const tools = game.tools;
  const st = game.world.stats;
  const p = def.project!;
  const civics = [...game.world.civics.values()];
  const sandbox = game.world.options.sandbox;
  const ctx: RequirementContext = {
    population: st.unlockAll ? Infinity : st.peak,
    education: st.eduWorkforce,
    visitors: st.visitors,
    runs: (id) => civics.some((c) => c.def === id && c.stage === undefined),
  };
  const reqs = p.requires.map((r) => requirementStatus(r, ctx));
  const built = civics.find((c) => c.def === def.id);
  const blocked = !sandbox && reqs.some((r) => !r.met);
  const total = p.stages.reduce((a, s) => a + s.cost, 0);
  const months = p.stages.reduce((a, s) => a + s.months, 0);
  return (
    <ToolButton
      id={`place-${def.id}`}
      active={game.tools.activeId === 'place' && tools.place.def === def.id}
      disabled={blocked || !!built}
      onClick={() => {
        tools.place.setDef(def.id);
        tools.use('place');
      }}
      tip={{
        title: def.name,
        lines: [
          `$${total.toLocaleString('en-US')} over ${months} months, in ${p.stages.length} stages (${p.stages.map((s) => s.name.toLowerCase()).join(', ')}); $${def.upkeep.toLocaleString('en-US')}/month once open`,
          def.blurb,
          `Perk: ${p.perk}`,
          ...reqs.map((r) => `${r.met ? '✓' : '✗'} ${r.label}${r.met ? '' : ` (${r.now})`}`),
          ...(built ? [built.stage === undefined ? 'Already built' : 'Under construction'] : []),
        ],
      }}
    >
      {blocked ? <IconLock /> : null}
      <span class="tool-label">{def.name}</span>
    </ToolButton>
  );
}
