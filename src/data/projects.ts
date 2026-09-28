/**
 * Big projects (M17): expensive builds in stages over months, each with requirements and a lasting
 * perk once finished. They are civic buildings (placement, roads, funding, inspector) with a
 * `project` block; until the last stage is done they count as offline. All designs are original.
 */
import type { CivicDef } from './civic';

export interface ProjectStage {
  /** What the stage builds ("Foundations", "Stands"). */
  name: string;
  /** Game months it takes (a month is a day-night cycle). */
  months: number;
  /** Paid when the stage starts. */
  cost: number;
}

export type ProjectRequirement =
  | { kind: 'population'; min: number }
  /** Share of the workforce educated to at least this level (0–1). */
  | { kind: 'education'; level: 1 | 2; share: number }
  /** A civic building the city must already run (e.g. a research park). */
  | { kind: 'civic'; def: string; label: string }
  /** Visitors a day (tourism). */
  | { kind: 'visitors'; min: number };

export interface ProjectInfo {
  stages: ProjectStage[];
  requires: ProjectRequirement[];
  /** The lasting perk, for the player. */
  perk: string;
  /** Stadium: match days every so many months draw this many visitors and a crowd by road. */
  matchDays?: { every: number; visitors: number; trips: number; approval: number };
  /** Launch complex: research income and high-tech demand multiplied. */
  research?: { income: number; demand: number; every: number; approval: number };
  /** Convention centre: extra commercial demand. */
  commerce?: { demand: number };
}

export type ProjectDef = CivicDef & { project: ProjectInfo };

/** What a project's requirements are checked against (the sim's state, or the client's mirror of it). */
export interface RequirementContext {
  /** Highest population reached (what unlocks go by). */
  population: number;
  /** Share of the workforce educated to level 1 and to level 2. */
  education: [number, number];
  visitors: number;
  /** Whether the city runs a finished building of this kind. */
  runs: (def: string) => boolean;
}

export interface RequirementStatus {
  label: string;
  met: boolean;
  /** Where the city stands ("12,400 so far"). */
  now: string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;
const num = (v: number) => v.toLocaleString('en-US');

export function requirementStatus(r: ProjectRequirement, ctx: RequirementContext): RequirementStatus {
  switch (r.kind) {
    case 'population':
      return {
        label: `${num(r.min)} residents`,
        met: ctx.population >= r.min,
        now: `${num(ctx.population)} so far`,
      };
    case 'education': {
      const share = ctx.education[r.level - 1] ?? 0;
      const what = r.level === 1 ? 'a basic education' : 'a high-school education';
      return {
        label: `${pct(r.share)} of workers with ${what}`,
        met: share >= r.share,
        now: `${pct(share)} now`,
      };
    }
    case 'civic': {
      const has = ctx.runs(r.def);
      return { label: `The city runs ${r.label}`, met: has, now: has ? 'yes' : 'not yet' };
    }
    case 'visitors':
      return {
        label: `${num(r.min)} visitors a day`,
        met: ctx.visitors >= r.min,
        now: `${num(ctx.visitors)} now`,
      };
  }
}

export const PROJECT_DEFS: ProjectDef[] = [
  {
    id: 'stadium',
    name: 'City stadium',
    category: 'project',
    unique: true,
    dept: 'tourism',
    w: 120,
    d: 96,
    cost: 0,
    upkeep: 10_000,
    blurb: 'A 30,000-seat bowl for the home team. Match days fill the stands and the roads around it.',
    unlockPopulation: 20_000,
    landValue: { radius: 260, value: 0.06 },
    model: 'stadium',
    project: {
      stages: [
        { name: 'Groundworks', months: 3, cost: 380_000 },
        { name: 'Stands', months: 4, cost: 700_000 },
        { name: 'Roof and pitch', months: 3, cost: 520_000 },
      ],
      requires: [{ kind: 'population', min: 20_000 }],
      perk: 'Every other month a match day draws 8,000 visitors (and their spending), a crowd on the roads around the ground, and cheers the whole city.',
      matchDays: { every: 2, visitors: 8_000, trips: 3_000, approval: 0.03 },
    },
  },
  {
    id: 'launchsite',
    name: 'Launch complex',
    category: 'project',
    unique: true,
    dept: 'trade',
    w: 112,
    d: 112,
    cost: 0,
    upkeep: 12_000,
    blurb:
      'A launch pad, assembly hall and tower for the technology city: satellites built here fly from here.',
    unlockPopulation: 40_000,
    landValue: { radius: 200, value: -0.05 },
    model: 'launchsite',
    project: {
      stages: [
        { name: 'Pad and flame trench', months: 4, cost: 600_000 },
        { name: 'Assembly hall and tower', months: 4, cost: 950_000 },
        { name: 'First launch', months: 2, cost: 450_000 },
      ],
      requires: [
        { kind: 'population', min: 40_000 },
        { kind: 'civic', def: 'techpark', label: 'a research park' },
        { kind: 'education', level: 2, share: 0.35 },
      ],
      perk: 'Research parks earn half as much again and high-tech industry wants to move in; each launch lifts the city’s mood.',
      research: { income: 1.5, demand: 0.15, every: 3, approval: 0.02 },
    },
  },
  {
    id: 'helioarray',
    name: 'Solar tower array',
    category: 'project',
    unique: true,
    dept: 'power',
    w: 128,
    d: 128,
    cost: 0,
    upkeep: 6_000,
    blurb:
      'A field of mirrors aimed at a tall receiver tower: clean power for a whole city, day and night from stored heat.',
    unlockPopulation: 20_000,
    output: { power: 4_000 },
    model: 'helioarray',
    project: {
      stages: [
        { name: 'Mirror field', months: 3, cost: 420_000 },
        { name: 'Receiver tower', months: 4, cost: 600_000 },
        { name: 'Heat store and grid link', months: 2, cost: 280_000 },
      ],
      requires: [
        { kind: 'population', min: 20_000 },
        { kind: 'education', level: 1, share: 0.6 },
      ],
      perk: '4,000 units of power with no smoke at all: enough to close the coal plants.',
    },
  },
  {
    id: 'gardenexpo',
    name: 'Garden expo',
    category: 'project',
    unique: true,
    dept: 'tourism',
    w: 144,
    d: 112,
    cost: 0,
    upkeep: 10_000,
    blurb:
      'A world fair of gardens and pavilions; when the fair closes, the grounds stay a park the region visits.',
    unlockPopulation: 40_000,
    tourism: { draw: 3_500 },
    landValue: { radius: 420, value: 0.14 },
    service: { kind: 'park', range: 30 },
    model: 'gardenexpo',
    project: {
      stages: [
        { name: 'Grounds and lakes', months: 3, cost: 500_000 },
        { name: 'Pavilions', months: 5, cost: 950_000 },
        { name: 'Opening', months: 2, cost: 350_000 },
      ],
      requires: [
        { kind: 'population', min: 40_000 },
        { kind: 'visitors', min: 1_500 },
      ],
      perk: '3,500 visitors a day for good, land value across a wide area, and a park for everyone nearby.',
    },
  },
  {
    id: 'convention',
    name: 'Convention centre',
    category: 'project',
    unique: true,
    dept: 'tourism',
    w: 120,
    d: 80,
    cost: 0,
    upkeep: 8_000,
    blurb:
      'Exhibition halls and an auditorium under a long wave roof: trade fairs bring business visitors all year.',
    unlockPopulation: 20_000,
    tourism: { draw: 1_500 },
    landValue: { radius: 280, value: 0.08 },
    model: 'convention',
    project: {
      stages: [
        { name: 'Foundations', months: 3, cost: 320_000 },
        { name: 'Exhibition halls', months: 4, cost: 560_000 },
        { name: 'Wave roof and fit-out', months: 2, cost: 320_000 },
      ],
      requires: [
        { kind: 'population', min: 20_000 },
        { kind: 'civic', def: 'hotel', label: 'a hotel' },
      ],
      perk: '1,500 business visitors a day, and shops and offices want to open (commercial demand up).',
      commerce: { demand: 0.12 },
    },
  },
];
