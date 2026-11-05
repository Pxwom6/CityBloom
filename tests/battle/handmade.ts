/**
 * Hand-made battle layouts for the battle tests (M35): a straight road into a small town with a
 * target, guns and homes, and helpers to make forces.
 */
import { BATTLE } from '../../src/data/battle';
import type { UnitKind } from '../../src/data/war';
import {
  BATTLE_VERSION,
  CELL_DEEP,
  CELL_LAND,
  DOMAIN_BIT,
  S,
  TAG,
  type BattleInput,
  type BattleLayout,
  type BattleUnitIn,
} from '../../src/sim/battle/types';

export interface StructSpec {
  id: number;
  tags: number;
  x: number;
  z: number;
  r?: number;
  hp?: number;
  gun?: number;
  range?: number;
  against?: ('land' | 'air' | 'sea')[];
  manned?: number;
}

/**
 * A road west to east along z = 500 from x = 0 to x = 1200 (nodes every 200 m), structures beside
 * it, land everywhere except a strip of deep water along the south edge (z > 1900).
 */
export function lineLayout(
  structs: StructSpec[],
  defenders: BattleUnitIn[] = [],
  readiness = 1,
): BattleLayout {
  const nodes: number[] = [];
  for (let k = 0; k <= 6; k++) nodes.push(k * 200, 500);
  const edges: number[] = [];
  const pts: number[] = [];
  for (let k = 0; k < 6; k++) {
    const n = Math.ceil(200 / BATTLE.pointStep) + 1;
    edges.push(k, k + 1, 200, pts.length / 2, n, 1000 + k);
    for (let q = 0; q < n; q++) pts.push(k * 200 + (200 * q) / (n - 1), 500);
  }
  const packed: number[] = [];
  for (const s of [...structs].sort((a, b) => a.id - b.id)) {
    const edge = Math.min(5, Math.max(0, Math.floor(s.x / 200)));
    let against = 0;
    for (const d of s.against ?? []) against |= DOMAIN_BIT[d];
    const row = new Array<number>(S.stride).fill(0);
    row[S.id] = s.id;
    row[S.tags] = s.tags;
    row[S.x] = s.x;
    row[S.z] = s.z;
    row[S.r] = s.r ?? 10;
    row[S.rIn] = s.r ?? 10;
    row[S.hp] = s.hp ?? 300;
    row[S.edge] = edge;
    row[S.at] = s.x - edge * 200;
    row[S.gun] = s.gun ?? 0;
    row[S.range] = s.range ?? 0;
    row[S.against] = against;
    row[S.manned] = s.manned ?? (s.gun ? 1 : 0);
    row[S.seg] = 1000 + edge;
    packed.push(...row);
  }
  const nx = 2048 / BATTLE.cell;
  const cells: number[] = [];
  for (let j = 0; j < nx; j++)
    for (let i = 0; i < nx; i++) cells.push(j * BATTLE.cell > 1900 ? CELL_DEEP : CELL_LAND);
  return {
    v: BATTLE_VERSION,
    city: 'Testville',
    tick: 0,
    box: [0, 0, 1200, 1000],
    nodes,
    edges,
    pts,
    structs: packed,
    names: [],
    grid: { x0: 0, z0: 0, nx, nz: nx, cells },
    entries: [
      { route: 'highway', x: 0, z: 500, edge: 0, at: 0 },
      { route: 'air', x: 0, z: 400, edge: -1, at: 0 },
      { route: 'sea', x: 600, z: 2000, edge: -1, at: 0 },
    ],
    defenders,
    readiness,
  };
}

let nextId = 1;
export function units(kind: UnitKind, n: number, at = { x: 0, z: 0 }, base = -1): BattleUnitIn[] {
  return Array.from({ length: n }, () => ({ id: 9000 + nextId++, kind, hp: 1, x: at.x, z: at.z, base }));
}

export function input(
  layout: BattleLayout,
  force: BattleUnitIn[],
  over: Partial<BattleInput['attacker']> = {},
): BattleInput {
  return {
    v: BATTLE_VERSION,
    id: 'test',
    seed: 'battle-test',
    scale: 'skirmish',
    layout,
    attacker: {
      name: 'Raiders',
      color: 0xd04040,
      units: force,
      route: 'highway',
      target: 'military',
      stance: 'bold',
      readiness: 1,
      ...over,
    },
    defender: { name: 'Testville', color: 0x4060d0 },
    orders: [],
    caps: { maxCollapse: 12, maxWreck: 3 },
  };
}

/** The usual little town: a depot to aim at, a bunker guarding the road, homes around. */
export const TOWN: StructSpec[] = [
  { id: 10, tags: TAG.civic | TAG.military | TAG.base, x: 900, z: 540, r: 20, hp: 900 },
  {
    id: 11,
    tags: TAG.civic | TAG.military | TAG.defence,
    x: 700,
    z: 520,
    r: 6,
    hp: 600,
    gun: 3,
    range: 120,
    against: ['land'],
  },
  { id: 20, tags: TAG.home, x: 860, z: 470, r: 8, hp: 150 },
  { id: 21, tags: TAG.home, x: 940, z: 470, r: 8, hp: 150 },
  { id: 22, tags: TAG.home, x: 960, z: 560, r: 8, hp: 150 },
];
