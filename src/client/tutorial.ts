import { ROAD_TYPES, isPlayerRoad } from '../data/roads';
import type { Game } from '../game';
import { CIVIC } from '../data/civic';
import { isMac } from './platform';
import { ZONE_C, ZONE_I, ZONE_R } from '../data/zones';
import { LONG_COMMUTE, TRAM } from '../data/balance';

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
    done: (g) => [...g.world.netState.segments.values()].some((s) => isPlayerRoad(s.type)),
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
    id: 'shared',
    text:
      'This city is shared: everyone builds on the same map and money. The room button by the city name ' +
      'shows who is here, the invite link and the chat; its Point button (or Shift+G over the map) shows ' +
      'the others a spot.',
    when: (g) => !!g.net && g.net.session.state === 'playing',
  },
  {
    // (Its own id: 'region' is the neighbours' tip below, and a tip seen hides the one sharing its id.)
    id: 'sharedRegion',
    text:
      'Your city is in a shared region: the other players’ cities now stand where neighbouring towns did. ' +
      'Open the Region panel (Shift+N) to trade with them, pay into Sunfield Commons, or visit their cities. ' +
      'If war is on, a military HQ (the toolbar’s Military button, from 2,000 residents) opens the war room.',
    when: (g) => g.region?.state === 'in',
  },
  {
    id: 'sharedHost',
    text:
      'You are the host: from the room button you can lock the room, choose what each player may do ' +
      '(taxes, policies, bulldozing others’ work, big spending) and turn the chat off.',
    when: (g) => !!g.net?.session.isHost && g.net.session.players.length > 1,
  },
  {
    // War (M34): a city with rival neighbours, or in a region at war, once it may build an HQ.
    id: 'rivals',
    text:
      'Your city has rivals: the towns along the highway arm month by month (see their characters in the ' +
      'Region panel). The Military bar in the toolbar builds a military HQ first: it opens the war room ' +
      'and the other military buildings.',
    when: (g) =>
      !!g.world.stats.war &&
      (g.world.stats.unlockAll || g.world.stats.peak >= (CIVIC.get('militaryhq')?.unlockPopulation ?? 0)) &&
      !hasCivic(g, (d) => d === 'militaryhq'),
  },
  {
    id: 'warRoom',
    text:
      'Your military HQ opens the war room (Shift+M, or its button in the top bar): your forces, their ' +
      'upkeep and stores, readiness and research. Train units at a barracks, depot, airfield or naval ' +
      'yard: click one. They take staff from the workers nearest them, and power.',
    when: (g) => g.world.stats.war?.hq != null,
  },
  {
    id: 'raidComing',
    text:
      'A raid is on its way: the red countdown in the top bar says when it arrives. Your bunkers, guns and ' +
      'units fight on their own; residents near the targets go to the shelters. A radar gives earlier ' +
      'warning. When it comes, the battle bar follows the fighting.',
    when: (g) => !!g.world.stats.war?.incoming || !!g.world.stats.war?.battle,
  },
  {
    id: 'sendForce',
    text:
      'With units at home you can raid a rival: the war room’s Send tab picks the town, what to strike, ' +
      'the way there and the units; the Map tab shows the roads between the towns and forces on the move. ' +
      'Every raid is reported in the Reports tab, and you can watch it.',
    when: (g) => (g.world.stats.war?.units ?? 0) >= 3 && g.world.stats.war?.hq != null,
  },
  {
    // Diplomacy (M36): the first proposal, declaration or war.
    id: 'diplomacy',
    text:
      'Diplomacy is in the war room’s Diplomacy tab: proposals to answer (accept, counter or refuse), ' +
      'your wars and their scores, treaties in force, and each neighbour’s mood. A declared war opens after ' +
      'a warning; at a score of −60 a side gives up and the winner sets the terms. Break a pact and every ' +
      'neighbour hears of it.',
    when: (g) => {
      const d = g.world.stats.war?.diplomacy;
      return !!d && (d.wars.length > 0 || d.proposals.some((p) => p.from === 'them'));
    },
  },
  // Wars and treaties with friends (M39).
  {
    // A region at war where the host is the only one to turn it on, and nobody has yet.
    id: 'regionWarOff',
    text:
      'Your region is at peace. If you and your friends want to fight, you, as its host, can turn war on ' +
      'in the Region panel (Shift+N): every city then raises forces, and a war can be declared on a ' +
      'friend. The same switch turns it off again and ends every war in plain peace.',
    when: (g) =>
      g.region?.state === 'in' &&
      g.region.isHost &&
      !(g.region.view?.rules.war ?? false) &&
      (g.region.view?.cities.length ?? 0) > 1,
  },
  {
    id: 'friendsAtWar',
    text:
      'War is on in your region, and a friend’s city is in it. To go to war with them, open the war room ' +
      '(Shift+M), then the Diplomacy tab: your friends are listed under “Friends in the region”, each ' +
      'with Declare war…. They are told at once and the war opens two minutes later. A new or small city ' +
      'is safe from raids until it strikes first; a war between you lifts that once it has opened.',
    when: (g) => {
      const w = g.world.stats.war;
      const d = w?.diplomacy;
      return !!w && w.hq != null && !!d && d.friends.length > 0 && !d.wars.some((x) => x.friend);
    },
  },
  {
    id: 'friendWar',
    text:
      'You are at war with a friend’s city. It runs on the region’s time: the war opens two minutes after ' +
      'it is declared, then your forces can strike their city (the Send tab), and every battle between ' +
      'your cities moves the score. A side that falls to −60 gives up and the winner sets the terms.',
    when: (g) => !!g.world.stats.war?.diplomacy?.wars.some((w) => w.friend),
  },
  {
    // A battle between two players' cities whose players are both here: both give orders as it happens.
    id: 'liveBattle',
    text:
      'A live battle: the other player is here too, and you both command. Press O (or Command in the ' +
      'bar) for the battle map. Choose your units (click, drag a box round some, or All), then give an ' +
      'order: Focus (a building to strike if you attack, an attacker to hit if you defend), Guard a ' +
      'building, Hold position, Free to let them use their own judgement, or Withdraw. Each order is shown ' +
      'as “heard” when the region has passed it to both of you.',
    when: (g) => {
      const v = g.live?.view();
      return !!v && v.role !== 'watcher' && !v.over;
    },
  },
  {
    // The first battle with a friend is over, or the war is going badly: how to stop it.
    id: 'friendPeace',
    text:
      'Either of you can offer to end a war at any time: in the war room’s Diplomacy tab, press Offer terms next to ' +
      'it, add what you want (peace is there already; reparations or a pact if you like) and Send. Your ' +
      'friend answers when they are here, and the offer waits a day. If you are losing, ask for terms ' +
      'before the score reaches −60: then the winner sets them.',
    when: (g) =>
      !!g.world.stats.war?.diplomacy?.wars.some(
        (w) => w.friend && w.friend.state === 'open' && (w.battles > 0 || w.score <= -20),
      ),
  },
  {
    id: 'friendTreaty',
    text:
      'A treaty with a friend waits for their answer for up to a day, even if they are away. Once signed, ' +
      'both cities apply it: reparations are paid at once, tribute every month on each city’s own clock, ' +
      'and pacts end by the region’s clock. Ending a pact early breaks your word and costs reputation.',
    when: (g) =>
      !!g.world.stats.war?.diplomacy?.pacts.some((p) => p.room !== null) ||
      (g.friends?.view().incoming.length ?? 0) > 0,
  },
  {
    id: 'friendVassal',
    text:
      'A city that falls in a total war becomes its conqueror’s vassal and pays a fifth of its taxes every ' +
      'month. A vassal goes to war only to rise against its overlord, and is free once it wins battles ' +
      'against it, or when the overlord agrees by treaty.',
    when: (g) => {
      const d = g.world.stats.war?.diplomacy;
      return !!d && (!!d.vassal?.friend || d.subjects.length > 0);
    },
  },
  // Weapon development and intelligence (M37).
  {
    id: 'research',
    text:
      'Your weapons lab researches in the war room’s Research tab: six branches of four tiers, each needing ' +
      'the one before. Queue up to four; a tier’s money is paid when the labs start it. Up to three labs ' +
      'work together, and a research park speeds them up.',
    when: (g) => hasCivic(g, (d) => d === 'militarylab'),
  },
  {
    id: 'trial',
    text:
      'A new unit is a prototype until it has been tried: a proving ground runs its trial (half its price, ' +
      'a day or two). Boats need a naval yard for theirs. Once it passes, train it as any other.',
    when: (g) => (g.world.stats.war?.research?.prototypes.length ?? 0) > 0,
  },
  {
    id: 'spinoff',
    text:
      'Some research pays off at home too: spin-offs like better fire engines or prefab panels work for the ' +
      'whole city from the moment the research is done (see each tier’s chip).',
    when: (g) =>
      (g.world.stats.war?.research?.done ?? []).some((k) =>
        ['land1', 'air1', 'sea1', 'defence1', 'intel1', 'logistics1'].includes(k),
      ),
  },
  {
    id: 'intelligence',
    text:
      'Your spy agency sends agents from the war room’s Intelligence tab: to look round a rival, sabotage its ' +
      'power or depot, or steal its research. The odds are shown before they go; a caught spy is an incident ' +
      'that costs the city’s good name.',
    when: (g) => hasCivic(g, (d) => d === 'spyagency'),
  },
  {
    id: 'superweapon',
    text:
      'The fourth tier of each branch is a superweapon, worked on only while a research park is in service: ' +
      'a giant wind-up robot, a sky fortress, a clockwork whale, a dome shield, a blackout tower or an express ' +
      'gate. One of each, and they need time to wind up again after use.',
    when: (g) => {
      const r = g.world.stats.war?.research;
      return (
        !!r &&
        ['land3', 'air3', 'sea3', 'defence3', 'intel3', 'logistics3'].some((k) => r.done.includes(k as never))
      );
    },
  },
  {
    id: 'dome',
    text:
      'The dome shield charges for ten days, then rises over the city when a battle comes (or only for one ' +
      'that brings a superweapon: set its mode in its inspector) and soaks the blows until it pops.',
    when: (g) => !!g.world.stats.war?.supers?.dome,
  },
  {
    id: 'blackout',
    text:
      'Your city is blacked out: power plants falter, the radar is quiet and the maps are out until it ends. ' +
      'A charged dome shield holds four hours on its reserve.',
    when: (g) => !!g.world.stats.war?.supers?.blackout,
  },
  {
    id: 'incident',
    text:
      'A spy was caught: an incident. Your own caught abroad costs reputation and the neighbour’s goodwill; ' +
      'one of theirs caught here lets you declare war on them without losing face for a few days.',
    when: (g) => (g.world.stats.war?.intel?.results ?? []).some((r) => /caught/.test(r.text)),
  },
  // Investments and the war economy (M38).
  {
    id: 'trade',
    text:
      'Money to spare? The war room’s Trade tab buys stakes in a neighbour’s industry, paying a dividend ' +
      'every month (frozen while you fight it). Allies borrow from you, buy munitions from your stores and ' +
      'units outright, and an ally fighting at your side can be paid to fight harder.',
    when: (g) => {
      const e = g.world.stats.war?.economy;
      return (
        !!e &&
        !!g.world.stats.war?.hq &&
        (g.world.stats.treasury > 250_000 || e.neighbours.some((n) => n.allied))
      );
    },
  },
  {
    id: 'weariness',
    text:
      'A long war wears your people down: war weariness costs approval, and past half, homes grow less ' +
      'happily. Losing a war or being raided tires them faster. Peace lets it fade, and a war ended well ' +
      'brings a few days of good cheer (the Diplomacy tab shows it).',
    when: (g) => (g.world.stats.war?.economy?.weariness.value ?? 0) >= 0.25,
  },
  {
    id: 'sanctioned',
    text:
      'A neighbour sanctions the city: no trade with it, and your stake there is frozen until it lifts them. ' +
      'Broken pacts, a war on its ally or a poor reputation bring sanctions; the Trade tab says why.',
    when: (g) => (g.world.stats.war?.economy?.neighbours ?? []).some((n) => n.sanctionedBy !== null),
  },
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
    // avgCommute is in seconds (P15).
    when: (g) => g.world.stats.avgCommute > LONG_COMMUTE && g.world.stats.population > 500,
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

/**
 * The tip to show (P15): one at a time, chosen only when nothing hides it, and dropped if it is
 * still waiting behind a panel when its moment passes, so it never contradicts the numbers. A tip
 * on screen stays until the player dismisses it.
 */
export function pickTip(
  g: Game,
  current: Tip | null,
  hidden: boolean,
  seen: ReadonlySet<string>,
): Tip | null {
  if (current) return hidden && !current.when(g) ? null : current;
  if (hidden) return null;
  return TIPS.find((t) => !seen.has(t.id) && t.when(g)) ?? null;
}
