/**
 * Learn (M42): short lessons a player can open any time from the main menu, each two to four minutes
 * on a small prepared town (`public/lessons/<id>.citybloom`, made by `scripts/lessons.ts`). A lesson
 * is steps in the tutorial's own model (`TutorialStep`), run by the same runner and card; what a step
 * waits for is read against the town as the lesson found it (`LessonBase`).
 */
import type { Game } from '../game';
import type { TutorialStep } from './tutorial';
import { CIVIC } from '../data/civic';
import { isPlayerRoad } from '../data/roads';

/** The town as the lesson found it: what a step counts from. */
export interface LessonBase {
  roads: number;
  avenues: number;
  loans: number;
  districts: number;
  busLines: number;
  disasters: number;
  civics: Record<string, number>;
}

export interface Lesson {
  id: string;
  title: string;
  blurb: string;
  minutes: number;
  /** The prepared town's file in `public/lessons/` (null: comes with a later milestone). */
  save: string | null;
  /** Shown beside the lesson: war is for cities with rivals on. */
  optIn?: string;
  /** Not ready yet (the lesson's milestone hasn't come). */
  soon?: string;
  steps: TutorialStep[];
}

export function lessonBase(g: Game): LessonBase {
  const segs = [...g.world.netState.segments.values()];
  const civics: Record<string, number> = {};
  for (const c of g.world.civics.values()) {
    const cat = CIVIC.get(c.def)?.category ?? '';
    civics[cat] = (civics[cat] ?? 0) + 1;
  }
  return {
    roads: segs.filter((s) => isPlayerRoad(s.type)).length,
    avenues: segs.filter((s) => s.type === 'avenue').length,
    loans: g.world.stats.loans,
    districts: g.world.districts.size,
    busLines: g.world.lines.filter((l) => l.mode === 'bus').length,
    disasters: g.world.disasters.active.length,
    civics,
  };
}

const base = (g: Game): LessonBase => g.tutorial.base ?? lessonBase(g);
const civicsNow = (g: Game, cat: string) =>
  [...g.world.civics.values()].filter((c) => CIVIC.get(c.def)?.category === cat).length;
const more = (g: Game, cat: string) => civicsNow(g, cat) > (base(g).civics[cat] ?? 0);
const saw = (g: Game, what: string) => g.tutorialSaw.has(what);

/** The town's middle, for a lesson's first look. */
function town(g: Game) {
  let x = 0;
  let z = 0;
  let n = 0;
  for (const b of g.world.buildings.values()) {
    x += b.x;
    z += b.z;
    n++;
  }
  return n ? { x: x / n, z: z / n, distance: 620, yaw: 0.6, tilt: 0.2 } : null;
}

const finish = (what: string): TutorialStep => ({
  id: 'lessonDone',
  title: 'Lesson done',
  text: `That’s ${what}. Back to Learn for another lesson, or keep playing this town.`,
  pause: true,
});

export const LESSONS: Lesson[] = [
  {
    id: 'traffic',
    title: 'Traffic and transit',
    blurb: 'Find the busy roads, give drivers another way, and take cars off the road with buses.',
    minutes: 3,
    save: 'traffic.citybloom',
    steps: [
      {
        id: 'trafficIntro',
        title: 'A busy town',
        text: 'Everyone drives to work at the same hours. Roads fill up, and slow trips make people unhappy.',
        camera: town,
        pause: true,
      },
      {
        id: 'trafficMap',
        title: 'Where are the jams?',
        text: 'Open the data maps and pick Traffic. Red roads are full; green ones have room.',
        target: 'tool-maps',
        done: (g) => saw(g, 'map:traffic'),
      },
      {
        id: 'trafficRoad',
        title: 'Another way through',
        text:
          'Draw a new road that joins two streets, or upgrade a busy street: road tool, then Avenue, then ' +
          'Upgrade. More lanes, more cars.',
        target: 'tool-road',
        done: (g) => {
          const b = base(g);
          const segs = [...g.world.netState.segments.values()];
          return (
            segs.filter((s) => isPlayerRoad(s.type)).length > b.roads ||
            segs.filter((s) => s.type === 'avenue').length > b.avenues
          );
        },
      },
      {
        id: 'trafficBus',
        title: 'Buses',
        text:
          'One bus carries forty people. Open Transit, place a bus depot by a road, then bus stops on busy ' +
          'streets. A line runs between them.',
        target: 'tool-transit',
        done: (g) => g.world.lines.filter((l) => l.mode === 'bus').length > base(g).busLines,
      },
      {
        id: 'trafficWatch',
        title: 'Watch it work',
        text: 'Press play. At rush hour, look at the Traffic map again: fewer red roads, and people on the bus.',
        target: 'speed-1',
      },
      finish('traffic and transit'),
    ],
  },
  {
    id: 'money',
    title: 'Money and loans',
    blurb: 'Read the budget, set taxes, and borrow wisely when the money runs short.',
    minutes: 3,
    save: 'money.citybloom',
    steps: [
      {
        id: 'moneyIntro',
        title: 'Running out',
        text: 'This town spends more than it earns. Your money and the net figure under it are in the top bar.',
        target: 'treasury',
        camera: town,
        pause: true,
      },
      {
        id: 'moneyBudget',
        title: 'The budget',
        text: 'Click your money to open the budget. Income is on top, costs below.',
        touch: 'Tap your money to open the budget. Income is on top, costs below.',
        target: 'open-budget',
        done: (g) => saw(g, 'budget'),
      },
      {
        id: 'moneyTaxes',
        title: 'Taxes',
        text: 'Raise the homes’ tax a point or two. Each point brings in more; above 9 % people start to stay away.',
        target: 'tax-R1',
        panel: 'budget',
      },
      {
        id: 'moneyLoan',
        title: 'A loan',
        text:
          'Short of money for something big? Take a loan from the Loans tab. You pay it back each month, with ' +
          'interest, so borrow only what you need.',
        target: 'budget-tab-loans',
        panel: 'budget',
        done: (g) => g.world.stats.loans > base(g).loans,
      },
      {
        id: 'moneyFunding',
        title: 'Cutting costs',
        text:
          'Funding sliders set how much each service gets. Below 100 % it saves money, but the service works ' +
          'less well. Small cuts first.',
        target: 'budget-tab-funding',
        panel: 'budget',
      },
      finish('money and loans'),
    ],
  },
  {
    id: 'services',
    title: 'Happiness and services',
    blurb: 'See why people are unhappy, then cover the town with the services it needs.',
    minutes: 4,
    save: 'services.citybloom',
    steps: [
      {
        id: 'servicesIntro',
        title: 'An unhappy town',
        text: 'This town has power and water, but nothing else. Its people are starting to leave.',
        camera: town,
        pause: true,
      },
      {
        id: 'servicesAdvisors',
        title: 'Ask your advisors',
        text: 'Open the advisors: they say what’s wrong and what to build first.',
        target: 'open-advisors',
        done: (g) => saw(g, 'advisors'),
      },
      {
        id: 'servicesHappy',
        title: 'Who is unhappy?',
        text: 'Open the data maps and pick Happiness. Red homes are the unhappy ones.',
        target: 'tool-maps',
        done: (g) => saw(g, 'map:happiness'),
      },
      {
        id: 'servicesFire',
        title: 'A fire station',
        text: 'Build a fire station near the homes. Fires spread without one.',
        target: 'tool-fire',
        done: (g) => more(g, 'fire'),
      },
      {
        id: 'servicesClinic',
        title: 'A clinic or a school',
        text: 'Families want a clinic and a school nearby. Build one of them now.',
        target: 'tool-health',
        done: (g) => more(g, 'health') || more(g, 'education'),
      },
      {
        id: 'servicesCoverage',
        title: 'Coverage',
        text: 'Open the data maps and pick Fire or Health care. Green streets are covered; red ones need another.',
        target: 'tool-maps',
        done: (g) => saw(g, 'coverage'),
      },
      finish('happiness and services'),
    ],
  },
  {
    id: 'disasters',
    title: 'Disasters',
    blurb: 'What fires, quakes, floods and storms do, and how a town recovers.',
    minutes: 3,
    save: 'disasters.citybloom',
    steps: [
      {
        id: 'disastersIntro',
        title: 'When things go wrong',
        text: 'Now and then a disaster strikes. Fire stations, clinics and police help the town through it.',
        camera: town,
        pause: true,
      },
      {
        id: 'disastersStart',
        title: 'Try one',
        text: 'Open the Disasters tool and set off a meteor or a quake on the edge of town. It’s only practice.',
        target: 'tool-disasters',
        done: (g) => g.world.disasters.active.length > base(g).disasters,
      },
      {
        id: 'disastersRespond',
        title: 'Help arrives',
        text: 'Press play. Fire engines and ambulances drive out from their stations. More stations, quicker help.',
        target: 'speed-1',
      },
      {
        id: 'disastersRebuild',
        title: 'Rebuilding',
        text:
          'Ruined buildings become rubble. It clears by itself and the lots grow again. Broken roads ' +
          'repair over a few hours.',
        pause: true,
      },
      {
        id: 'disastersSwitch',
        title: 'Your choice',
        text: 'Random disasters can be switched off in the Disasters tool or in Settings.',
        target: 'tool-disasters',
      },
      finish('disasters'),
    ],
  },
  {
    id: 'districts',
    title: 'Districts and policies',
    blurb: 'Name parts of town and give each its own rules.',
    minutes: 3,
    save: 'districts.citybloom',
    steps: [
      {
        id: 'districtsIntro',
        title: 'Parts of town',
        text: 'A district is a named part of town with rules of its own: quiet streets, a heritage centre, a works.',
        camera: town,
        pause: true,
      },
      {
        id: 'districtsPaint',
        title: 'Paint a district',
        text: 'Pick the District tool and paint over some homes. It takes the neighbourhood’s name.',
        target: 'tool-district',
        panel: 'districts',
        done: (g) => g.world.districts.size > base(g).districts,
      },
      {
        id: 'districtsPolicy',
        title: 'Give it a rule',
        text: 'In the Districts panel, pick your district and switch on a policy, such as no heavy traffic.',
        panel: 'districts',
        done: (g) => [...g.world.districts.values()].some((d) => d.policies.length > 0),
      },
      finish('districts and policies'),
    ],
  },
  {
    id: 'friends',
    title: 'Playing with friends',
    blurb: 'Rooms, codes, building one city together, and shared regions.',
    minutes: 2,
    save: 'friends.citybloom',
    steps: [
      {
        id: 'friendsIntro',
        title: 'Two ways to play together',
        text: 'Build one city together in a room, or each bring your own city to a shared region.',
        camera: town,
        pause: true,
      },
      {
        id: 'friendsMenu',
        title: 'Inviting friends',
        text: 'Open the menu (Esc). Invite friends shares this city: online, or straight from this computer.',
        touch:
          'Open the menu (the ☰ button). Invite friends shares this city: online, or straight from this device.',
        target: 'menu-button',
        done: (g) => g.tutorialSaw.has('screen:pause'),
      },
      {
        id: 'friendsCodes',
        title: 'Codes and links',
        text:
          'An online room has a six-letter code, like 7KQ2MX. Send friends the code or the invite link; ' +
          'they join from Play with friends.',
        target: 'pause-invite',
        screen: 'pause',
      },
      {
        id: 'friendsRoles',
        title: 'Who can do what',
        text:
          'Everyone builds on the same map with the same money. The host decides who may change taxes, ' +
          'bulldoze others’ work and more.',
        screen: 'pause',
      },
      {
        id: 'friendsRegion',
        title: 'Shared regions',
        text:
          'Or start a region from the Region panel (Shift+N): up to four cities side by side, trading power ' +
          'and water and sharing commuters.',
        touch:
          'Or start a region from the Region panel: up to four cities side by side, trading power and water ' +
          'and sharing commuters.',
      },
      finish('playing with friends'),
    ],
  },
  {
    id: 'war',
    title: 'War',
    blurb: 'Rival neighbours, the war room, raids and defences.',
    minutes: 3,
    save: 'war.citybloom',
    optIn: 'Only for cities with Rival neighbours ticked.',
    steps: [
      {
        id: 'warIntro',
        title: 'Rival neighbours',
        text:
          'With Rival neighbours ticked, the towns along the highway arm and may raid you. Without it, there’s ' +
          'no war at all.',
        camera: town,
        pause: true,
      },
      {
        id: 'warRoom',
        title: 'The war room',
        text: 'This town has a military HQ. Open the war room (Shift+M, or its button in the top bar).',
        touch: 'This town has a military HQ. Open the war room with its button in the top bar.',
        target: 'open-war',
        done: (g) => saw(g, 'panel:war'),
      },
      {
        id: 'warTrain',
        title: 'Forces',
        text: 'The war room lists your forces. Click a barracks to train infantry: units take workers and power.',
        touch:
          'The war room lists your forces. Tap a barracks to train infantry: units take workers and power.',
        panel: 'war',
        pause: true,
      },
      {
        id: 'warRaid',
        title: 'Raids',
        text:
          'A raid comes with a countdown and a siren. Bunkers and anti-air guns fight on their own; rubble ' +
          'clears and regrows.',
        panel: 'war',
        pause: true,
      },
      finish('war'),
    ],
  },
  {
    id: 'buildings',
    title: 'Making your own buildings',
    blurb: 'Make a building of your own and bring it into your city, with the Workshop.',
    minutes: 10,
    save: 'buildings.citybloom',
    steps: [
      {
        id: 'workshopOpen',
        title: 'The Workshop',
        text:
          'The Workshop takes you from nothing to a building in this town in five steps: pick what to make, ' +
          'make it (an AI 3D tool or Blender), check it, see it, use it. Close it any time: it keeps your place.',
        panel: 'buildings',
        pause: true,
        done: (g) => g.panel === 'buildings' && g.buildingsTab === 'workshop' && g.workshop.step >= 1,
      },
      {
        id: 'workshopCheck',
        title: 'Make it, then check it',
        text:
          'Copy the prompt into your AI 3D tool, or follow the Blender steps. Then drop your GLB in step 3: the ' +
          'check says what to fix, why, and how.',
        panel: 'buildings',
        done: (g) => !!g.workshop.check?.ok,
      },
      {
        id: 'workshopUse',
        title: 'See it, then use it',
        text: 'See it in a street by day and night, then add it to My buildings and place it in this town.',
        panel: 'buildings',
        done: (g) => [...g.world.civics.values()].some((c) => !!c.look && g.buildings.get(c.look)?.mine),
      },
      finish('making a building of your own'),
    ],
  },
];

export const LESSON = new Map(LESSONS.map((l) => [l.id, l]));
