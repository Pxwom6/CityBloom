import { ROAD_TYPES } from '../data/roads';
import type { Game } from '../game';
import { CIVIC } from '../data/civic';
import { isMac } from './platform';
import { ZONE_C, ZONE_I, ZONE_R } from '../data/zones';
import { TRAM } from '../data/balance';

/**
 * The first-city tutorial and contextual tips (DESIGN.md §5). Steps finish by themselves when the
 * player has done what they ask, so a tutorial resumed after a reload skips what's already built.
 */
export interface TutorialStep {
  title: string;
  text: string;
  /** Test id of the button to point at. */
  target?: string;
  /** The step is done once this holds; steps without it wait for "Next". */
  done?: (g: Game) => boolean;
}

function hasZone(g: Game, zone: number): boolean {
  for (const b of g.world.netState.blocks.values()) if (b.zone.includes(zone)) return true;
  return false;
}

function hasCivic(g: Game, test: (def: string, category: string) => boolean): boolean {
  for (const c of g.world.civics.values()) if (test(c.def, CIVIC.get(c.def)?.category ?? '')) return true;
  return false;
}

export const TUTORIAL: TutorialStep[] = [
  {
    title: 'Welcome, Mayor',
    text:
      'This valley is yours to build. Drag with the left mouse button to move around, the right button ' +
      'to turn, and scroll to zoom (or use W A S D and Q E). Settlers arrive along the highway at the ' +
      'edge of the map.',
  },
  {
    title: 'Lay a road',
    text:
      'Pick the road tool and drag out from the end of the highway. Click to add bends; every road ' +
      'needs to connect back to the highway so people can reach it.',
    target: 'tool-road',
    done: (g) => [...g.world.netState.segments.values()].some((s) => s.type !== 'highway'),
  },
  {
    title: 'Zone homes',
    text:
      'Open the zone tool and paint residential land (green) along your road. Houses grow there when ' +
      'people want to move in: watch the R bar in the top bar.',
    target: 'tool-zone',
    done: (g) => hasZone(g, ZONE_R),
  },
  {
    title: 'Jobs and shops',
    text:
      'Residents need work. Zone some commercial land (blue) for shops and offices, and industry ' +
      '(yellow) a little way off: factories are noisy and dirty.',
    target: 'tool-zone',
    done: (g) => hasZone(g, ZONE_C) && hasZone(g, ZONE_I),
  },
  {
    title: 'Power',
    text:
      'Buildings need electricity. Place a power plant beside a road: wind turbines are cheap and clean, ' +
      'coal is powerful but smoky. Power reaches every building along connected roads.',
    target: 'tool-power',
    done: (g) => hasCivic(g, (_d, cat) => cat === 'power'),
  },
  {
    title: 'Water and sewage',
    text:
      'Place a water pump where the ground water is good, and septic tanks for the sewage, away from ' +
      'homes. When the town reaches the river, an outflow there takes far more. The water tool shows ' +
      'a map of ground water while you place.',
    target: 'tool-water',
    done: (g) =>
      hasCivic(g, (d) => d === 'pump' || d === 'riverpump') &&
      hasCivic(g, (d) => d === 'septic' || d === 'outflow' || d === 'treatment'),
  },
  {
    title: 'Let time run',
    text: 'Press play (or the space bar) and speed up with 2 and 3. Watch the first families move in.',
    target: 'speed-1',
    done: (g) => g.world.stats.population >= 40,
  },
  {
    title: 'Keep the city happy',
    text:
      'Click any building to see how it is doing and why. The advisors (J) flag problems, the budget (M) ' +
      'sets taxes and spending, and the layers button shows data maps. Fire, police, clinics and schools ' +
      'come next. Good luck!',
    target: 'open-advisors',
  },
];

/** A tip shown once, the first time its situation comes up. */
export interface Tip {
  id: string;
  text: string;
  when: (g: Game) => boolean;
}

export const TIPS: Tip[] = [
  {
    id: 'noPower',
    text: 'Some buildings have no power (the lightning icon). Build a power plant beside a connected road.',
    when: (g) => g.world.stats.utilities.power.unserved > 3,
  },
  {
    id: 'noWater',
    text: 'Some buildings have no water (the drop icon). Place a pump, and a sewage outflow for the waste.',
    when: (g) => g.world.stats.utilities.water.unserved > 3 && g.world.stats.utilities.power.unserved === 0,
  },
  {
    id: 'money',
    text:
      'The city spends more than it earns. Open the budget (M) to raise taxes a little, fund services ' +
      'less, or take a loan while the city grows.',
    when: (g) => g.world.stats.netMonthly < 0 && g.world.stats.population > 100,
  },
  {
    id: 'jobs',
    text: 'Many residents are out of work. Zone commercial or industrial land, and connect it by road.',
    when: (g) => g.world.stats.unemployed > 60 && g.world.stats.unemployed > g.world.stats.workers * 0.15,
  },
  {
    id: 'abandoned',
    text: 'A building was abandoned. Click it: the inspector says why (no power, no jobs, crime, pollution…).',
    when: (g) => g.world.stats.abandoned > 0,
  },
  {
    id: 'services',
    text:
      'The town is big enough to need a fire station, police and a clinic. Their data maps show which ' +
      'streets they reach.',
    when: (g) => g.world.stats.population > 400 && !hasCivic(g, (d) => d === 'firestation'),
  },
  {
    id: 'traffic',
    text:
      'Commutes are getting long. The traffic map (layers button) shows the busiest roads: add a parallel ' +
      'street, upgrade to an avenue, or start a bus line.',
    when: (g) => g.world.stats.avgCommute > 28 && g.world.stats.population > 500,
  },
  {
    id: 'junctions',
    text:
      'A junction is jammed at the rush hour (the traffic map shows junctions as discs). A roundabout ' +
      'passes far more traffic: pick Roundabout in the road tool, or click one of its roads. One-way ' +
      'streets (O while drawing) carry a quarter more.',
    when: (g) => g.world.stats.population > 1_000 && g.world.worstJunctionVC() > 1.1,
  },
  {
    id: 'cityHighway',
    text:
      'City highways unlocked: four fast lanes with no junctions or zoning. They pass over the roads they ' +
      'cross and join them by one-way ramps; start one from the regional highway to take through traffic ' +
      'round the town.',
    when: (g) =>
      (g.world.stats.unlockAll ? Infinity : g.world.stats.peak) >= ROAD_TYPES.motorway.unlockPopulation &&
      g.world.stats.population > 0,
  },
  {
    id: 'rail',
    text:
      'Trams and trains unlocked. Lay tram track along busy streets (Roads → Tram track) and add a tram ' +
      'depot and tram stops; or build a railway (Roads → Railway) with two stations. The regional railway ' +
      'comes in at the west edge: link a rail freight terminal to it and industry ships by train.',
    when: (g) =>
      (g.world.stats.unlockAll ? Infinity : g.world.stats.peak) >= TRAM.unlockPopulation &&
      g.world.stats.population > 0,
  },
  {
    id: 'region',
    text:
      'Your city has neighbours along the highway. Their people commute in to jobs you can’t fill, yours ' +
      'take jobs there, and they’ll buy or sell power, water and garbage processing: see the Region panel ' +
      '(Shift+N, top bar).',
    when: (g) => g.world.stats.population >= 1_500 && g.world.stats.region.neighbours.length > 0,
  },
  {
    id: 'terrain',
    text:
      'The terrain tools reshape the ground: raise, lower, level (to the height where the drag starts) or ' +
      'smooth. Level a hillside before building a street on it and far more of its lots can be built on. ' +
      'Roads and buildings hold the ground they stand on, and the earth moved is paid for.',
    when: (g) => g.tools.activeId === 'terrain',
  },
  {
    id: 'airport',
    text:
      'An airport brings visitors by the planeload and business for the shops, but its planes are loud along ' +
      'the runway’s line: check the noise map before you zone homes there.',
    when: (g) => hasCivic(g, (def) => def === 'airport'),
  },
  {
    id: 'snow',
    text:
      'Snow slows every car on the roads it lies on until it melts. A public works depot (in the Garbage ' +
      'and snow bar) sends ploughs out to clear the busiest roads first. Hover the date for the weather.',
    when: (g) => g.world.stats.weather.roadsSnowy > 0.2 && !hasCivic(g, (def) => def === 'works'),
  },
  {
    id: 'winter',
    text:
      'Winter is coming: heating pushes up power demand, most of all in homes. The advisors say how much ' +
      'power midwinter will need; the date in the top bar shows the season and the temperature.',
    when: (g) =>
      g.world.stats.weather.seasons &&
      g.world.stats.weather.season === 'autumn' &&
      g.world.stats.population > 300,
  },
  {
    id: 'heat',
    text:
      'A heatwave: homes and shops use more power for cooling and more water, and a long dry spell ' +
      'lowers what groundwater pumps can give.',
    when: (g) => g.world.stats.weather.kind === 'heat' && g.world.stats.population > 300,
  },
  {
    id: 'districts',
    text:
      'Parts of a city want different things. The district tool (I) paints named districts, and in the ' +
      'Districts panel each gets its own policies and figures: a heavy-traffic ban round the homes, a ' +
      'heritage district for the old centre.',
    when: (g) =>
      (g.world.stats.unlockAll ? Infinity : g.world.stats.peak) >= 5_000 && g.world.districts.size === 0,
  },
  {
    id: 'raillink',
    text:
      'This city has no link to the regional railway: its west edge was built up before rail arrived. ' +
      'Place a Regional rail link (Transit) on the west edge, at least 160 m from the highway, and lay ' +
      'railway from its end: freight trains and the neighbours’ commuters come in along it.',
    when: (g) =>
      g.world.stats.railLinkOffered &&
      (g.world.stats.unlockAll ? Infinity : g.world.stats.peak) >= TRAM.unlockPopulation &&
      g.world.stats.population > 0,
  },
  {
    id: 'railway',
    text:
      'Railways climb no more than 3.5 % and curve no tighter than 100 m, so they need room. Draw one ' +
      'across the middle of a street, avenue or dirt road for a level crossing; over boulevards and ' +
      'highways it goes on a bridge. Stations face the track.',
    when: (g) => g.tools.activeId === 'road' && g.tools.road.type === 'rail',
  },
  {
    id: 'earthworks',
    text:
      'Roads are laid into hills: the ground is cut and filled so they climb no steeper than their type ' +
      'allows (streets 16 %, boulevards 8 %). The ghost turns amber near the limit and red where it is ' +
      'too steep; a longer, winding route is cheaper to grade.',
    when: (g) => g.tools.road.sawEarthworks,
  },
  {
    id: 'trackpad',
    text:
      `Trackpad: swipe with two fingers to pan, pinch to zoom, and hold ${isMac ? 'Option' : 'Alt'} while ` +
      'swiping to turn and tilt. Press ? for every shortcut.',
    when: (g) => g.renderer.controller.detected === 'trackpad',
  },
  {
    id: 'milestone',
    text: 'New buildings, policies and a bigger loan unlocked. The city panel (P) shows them and what comes next.',
    when: (g) => g.world.stats.milestone >= 1,
  },
  {
    id: 'history',
    text:
      'Two years in: the city history (Y) charts population, money, jobs, pollution, crime and commutes ' +
      'month by month, with milestones and disasters marked.',
    when: (g) => g.world.stats.tick >= 24 * 1440 && g.world.stats.population > 0,
  },
  {
    id: 'photo',
    text:
      'A town worth a picture: photo mode (K, or the camera button) hides the interface, brings the camera ' +
      'down to the street and saves a PNG, with its own light, lens and colours.',
    when: (g) => g.world.stats.milestone >= 2,
  },
  {
    id: 'projects',
    text:
      'Big projects unlocked (the crane button): a stadium, a solar tower and a convention centre. Each is ' +
      'built in stages over months, paid for as each stage starts, and gives the city a lasting perk.',
    when: (g) => g.world.stats.peak >= 20_000 && !g.world.options.sandbox,
  },
];
