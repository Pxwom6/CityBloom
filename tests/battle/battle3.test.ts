import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BATTLE, SKIRMISH, SUPER, TOWN as TOWNS } from '../../src/data/battle';
import type { TierKey } from '../../src/data/research';
import { UNIT, type UnitKind } from '../../src/data/war';
import { growRivalTown } from '../../src/sim/ai/town';
import { awayInput, type AwayCity } from '../../src/sim/battle/away';
import { Battle } from '../../src/sim/battle/battle';
import { checkBattleInput } from '../../src/sim/battle/check';
import { battleLayout, strengthFactors, structureAsSeen } from '../../src/sim/battle/layout';
import {
  BATTLE_VERSION,
  CELL_DEEP,
  S,
  TAG,
  type BattleEvent,
  type BattleFrame,
  type BattleInput,
  type BattleLayout,
  type BattleUnitIn,
} from '../../src/sim/battle/types';
import { battleVersionOf, stampBattle } from '../../src/sim/battle/version';
import { Sim } from '../../src/sim/sim';
import { adoptBattle, coverWithDome, resolveBattle } from '../../src/sim/systems/raids';
import { TICKS_PER_MONTH } from '../../src/sim/time';
import { BState } from '../../src/sim/world/buildings';
import { buildTown, newSim, placeAlong, serveTown } from '../helpers';
import { input, lineLayout, TOWN, type StructSpec } from './handmade';

/**
 * Battles, version 3 (M37, `docs/plans/M37-design.md` call 6): research's modifiers, interceptor
 * batteries, the dome's pool and the three superweapons, each an optional field whose code runs only
 * when it's there, so version 2 battles (and version 3 ones using nothing new) play as they did.
 */

/** Every event and frame of a battle, ticked to its end. */
function play(i: BattleInput): {
  b: Battle;
  events: BattleEvent[];
  frames: BattleFrame[];
  /** Each event's tick (its index in `frames`). */
  at: number[];
} {
  const b = new Battle(structuredClone(i));
  const events: BattleEvent[] = [];
  const frames: BattleFrame[] = [];
  const at: number[] = [];
  while (!b.outcome) {
    for (const e of b.tick()) {
      events.push(e);
      at.push(frames.length);
    }
    frames.push(b.frame());
  }
  return { b, events, frames, at };
}

const one = (kind: UnitKind, id: number, over: Partial<BattleUnitIn> = {}): BattleUnitIn => ({
  id,
  kind,
  hp: 1,
  x: 0,
  z: 0,
  base: -1,
  ...over,
});

/** Units with fixed ids (from `first`), so two battles made alike are alike. */
function units(kind: UnitKind, n: number, at = { x: 0, z: 0 }, base = -1, first = 1): BattleUnitIn[] {
  return Array.from({ length: n }, (_, k) => one(kind, first + k, { x: at.x, z: at.z, base }));
}
function force(...spec: [UnitKind, number][]): BattleUnitIn[] {
  const out: BattleUnitIn[] = [];
  for (const [kind, n] of spec) out.push(...units(kind, n, { x: 0, z: 0 }, -1, out.length + 1));
  return out;
}

/** The fortress (id 500) and the 16 drones it carries. */
function fortress(hp = 1): BattleUnitIn[] {
  return [
    one('skyfortress', 500, { hp }),
    ...Array.from({ length: 16 }, (_, k) => one('drone', -(SUPER.carriedId + k), { from: 500 })),
  ];
}

const interceptor = (id: number, x: number, z: number, manned = 1): StructSpec => ({
  id,
  tags: TAG.civic | TAG.military | TAG.defence | TAG.intercept,
  x,
  z,
  r: 12,
  hp: 600,
  gun: 3,
  range: 360,
  against: ['air'],
  manned,
});

/** The same structure without the interceptor's tag: an anti-air gun, nothing more. */
const plainGun = (s: StructSpec): StructSpec => ({ ...s, tags: s.tags & ~TAG.intercept });

describe('battles version 3: what stays as it was', () => {
  const kept = JSON.parse(readFileSync('tests/fixtures/war/battle-v2.json', 'utf8')) as {
    input: BattleInput;
    result: ReturnType<Battle['result']>;
  }[];

  it('a version 2 battle stamped version 3, with nothing new, plays to the same result', () => {
    for (const k of kept) {
      const v3 = structuredClone(k.input);
      v3.v = BATTLE_VERSION;
      v3.layout.v = BATTLE_VERSION;
      expect(checkBattleInput(v3)).toBeNull();
      expect(Battle.run(v3).result()).toEqual(k.result);
      // And it needs nothing of version 3: stamped, it's version 2 again.
      expect(battleVersionOf(v3)).toBe(2);
      expect(stampBattle(v3).v).toBe(2);
      expect(v3.layout.v).toBe(2);
    }
  });

  it('an empty modifier, an empty dome and a far or idle interceptor change nothing', () => {
    const base = kept[0]!.input;
    const same = (spoil: (i: BattleInput) => void) => {
      const i = structuredClone(base);
      i.v = BATTLE_VERSION;
      i.layout.v = BATTLE_VERSION;
      spoil(i);
      expect(checkBattleInput(i)).toBeNull();
      return Battle.run(i).result();
    };
    expect(same((i) => (i.attacker.mods = { land: {}, air: {} }))).toEqual(kept[0]!.result);
    expect(same((i) => (i.layout.mods = { land: {} }))).toEqual(kept[0]!.result);
    expect(same((i) => (i.layout.dome = 0))).toEqual(kept[0]!.result);
  });

  it('battles without a superweapon play as before the superweapons were tuned', () => {
    // Drones, helicopters and tanks against anti-air, a capped drone raid, and a version 3 battle
    // with research and a dome: hashes taken on a037629 (M37 step 7), before bomb drones, the whale's
    // reach and the caps' early pull-out, which only a superweapon's battle may change.
    const aa: StructSpec[] = [0, 1].map((k) => ({
      id: 40 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 800 + k * 100,
      z: 440,
      r: 6,
      hp: 600,
      gun: 5,
      range: 320,
      against: ['air'],
    }));
    const air = { stance: 'bold', route: 'air' } as const;
    const capped = input(lineLayout(TOWN), units('drone', 12), air);
    capped.caps = { maxCollapse: 12, maxWreck: 1 };
    const modded = input(
      lineLayout([...TOWN, ...aa]),
      [...units('drone', 6), ...units('tank', 4, undefined, -1, 30)],
      {
        stance: 'bold',
      },
    );
    modded.attacker.mods = { air: { hp: 1.5, evade: 0.2 } };
    modded.layout.dome = 500;
    const cases: [string, BattleInput, number, string][] = [
      ['drones', input(lineLayout([...TOWN, ...aa]), units('drone', 8), air), 2, 'c9ed84bb36842f9d'],
      ['dronesCapped', capped, 2, 'fda6b586a11de360'],
      [
        'mixed',
        input(
          lineLayout([...TOWN, ...aa]),
          [
            ...units('drone', 6),
            ...units('helicopter', 3, undefined, -1, 20),
            ...units('tank', 4, undefined, -1, 30),
          ],
          { stance: 'cautious' },
        ),
        2,
        'd0574a75d07b5424',
      ],
      ['modded', modded, BATTLE_VERSION, '935a0572f151a570'],
    ];
    for (const [name, i, v, hash] of cases) {
      i.seed = `golden-${name}`;
      const s = stampBattle(i);
      expect(s.v, name).toBe(v);
      expect(Battle.run(structuredClone(s)).result().hash, name).toBe(hash);
    }
  });

  it('a version 2 battle can’t carry anything of version 3', () => {
    const v2 = () => structuredClone(kept[0]!.input);
    expect(checkBattleInput(v2())).toBeNull();
    const spoils: [string, (i: BattleInput) => void][] = [
      ['attackers’ research', (i) => (i.attacker.mods = { land: { hp: 1.2 } })],
      ['defenders’ research', (i) => (i.layout.mods = { land: { hp: 1.2 } })],
      ['a dome', (i) => (i.layout.dome = 1000)],
      ['an interceptor', (i) => (i.layout.structs[S.tags] = i.layout.structs[S.tags]! | TAG.intercept)],
      ['a superweapon', (i) => i.attacker.units.push(one('windupbot', 77))],
      [
        'a carried drone',
        (i) => i.attacker.units.push(one('drone', -1000, { from: i.attacker.units[0]!.id })),
      ],
      ['a version 3 city in a version 2 battle', (i) => (i.layout.v = BATTLE_VERSION)],
    ];
    for (const [what, spoil] of spoils) {
      const i = v2();
      spoil(i);
      expect(checkBattleInput(i), what).not.toBeNull();
    }
  });

  it('version 3 takes its fields within bounds, and refuses them beyond', () => {
    const good = () => input(lineLayout(TOWN, units('tank', 2, { x: 900, z: 540 }, 0)), units('tank', 4));
    const ok: [string, (i: BattleInput) => void][] = [
      ['research', (i) => (i.attacker.mods = { land: { hp: 2, attack: 1, armour: 0.3, evade: 0.5 } })],
      ['the defenders’ research', (i) => (i.layout.mods = { air: { evade: 0.25 }, sea: { hp: 1.2 } })],
      ['a dome', (i) => (i.layout.dome = 40_000)],
      ['an interceptor', (i) => (i.layout.structs[S.tags] = i.layout.structs[S.tags]! | TAG.intercept)],
      ['a robot', (i) => i.attacker.units.push(one('windupbot', 77))],
      [
        '24 units and a fortress’s 16 drones',
        (i) => (i.attacker.units = [...units('tank', 23), ...fortress()]),
      ],
      ['a version 2 city in a version 3 battle', (i) => (i.layout.v = 2)],
    ];
    for (const [what, set] of ok) {
      const i = good();
      set(i);
      expect(checkBattleInput(i), what).toBeNull();
    }
    const bad: [string, (i: BattleInput) => void][] = [
      ['hit points tripled', (i) => (i.attacker.mods = { land: { hp: 3 } })],
      ['attack halved', (i) => (i.attacker.mods = { land: { attack: 0.5 } })],
      ['armour beyond', (i) => (i.layout.mods = { land: { armour: 0.5 } })],
      ['evasion beyond', (i) => (i.attacker.mods = { air: { evade: 0.9 } })],
      ['an unknown modifier', (i) => (i.attacker.mods = { land: { speed: 2 } as never })],
      ['an unknown domain', (i) => (i.attacker.mods = { space: { hp: 1.1 } } as never)],
      ['a dome below nothing', (i) => (i.layout.dome = -5)],
      ['a tag beyond', (i) => (i.layout.structs[S.tags] = 4096)],
      ['a 17th drone', (i) => (i.attacker.units = [...fortress(), one('drone', -2000, { from: 500 })])],
      ['25 of its own', (i) => (i.attacker.units = [...units('tank', 25), ...fortress().slice(1)])],
      ['a drone carried by nothing', (i) => i.attacker.units.push(one('drone', -1000, { from: 12345 }))],
      [
        'a drone carried by a tank',
        (i) => i.attacker.units.push(one('drone', -1000, { from: i.attacker.units[0]!.id })),
      ],
      [
        'a tank carried by a fortress',
        (i) => (i.attacker.units = [one('skyfortress', 500), one('tank', -1000, { from: 500 })]),
      ],
      ['a superweapon defending', (i) => i.layout.defenders.push(one('windupbot', 88, { base: 0 }))],
      ['a carried defender', (i) => (i.layout.defenders[0]!.from = 1)],
    ];
    for (const [what, spoil] of bad) {
      const i = good();
      spoil(i);
      expect(checkBattleInput(i), what).not.toBeNull();
    }
  });
});

describe('battles version 3: research’s modifiers', () => {
  const bunkers: StructSpec[] = [0, 1].map((k) => ({
    id: 30 + k,
    tags: TAG.civic | TAG.military | TAG.defence,
    x: 600 + k * 40,
    z: 520,
    r: 6,
    hp: 600,
    gun: 3,
    range: 140,
    against: ['land', 'air'],
  }));
  const fixed = (mods?: BattleInput['attacker']['mods'], theirs?: BattleInput['layout']['mods']) => {
    const L = lineLayout([...TOWN, ...bunkers], units('tank', 3, { x: 900, z: 540 }, 0, 100), 1);
    if (theirs) L.mods = theirs;
    const i = input(L, force(['tank', 4], ['helicopter', 2]), { stance: 'bold' });
    i.seed = 'mods';
    if (mods) i.attacker.mods = mods;
    return stampBattle(i);
  };
  const lost = (r: ReturnType<Battle['result']>, side: 0 | 1) =>
    r.units.filter((u) => u.side === side && u.out).length;

  it('move a fixed battle the same way twice', () => {
    const plain = Battle.run(fixed()).result();
    const strong = { land: { hp: 2, attack: 2, armour: 0.3 } };
    const a = Battle.run(fixed(strong)).result();
    const b = Battle.run(fixed(strong)).result();
    expect(a).toEqual(b);
    expect(a.hash).not.toBe(plain.hash);
    // Tougher, harder-hitting tanks lose fewer and knock out more.
    expect(lost(a, 0)).toBeLessThanOrEqual(lost(plain, 0));
    expect(lost(a, 1)).toBeGreaterThanOrEqual(lost(plain, 1));
    expect(lost(a, 0) - lost(a, 1)).toBeLessThan(lost(plain, 0) - lost(plain, 1));
    // The defenders' own research works the other way.
    const theirs = Battle.run(fixed(undefined, { land: { hp: 2, attack: 2, armour: 0.3 } })).result();
    expect(theirs).toEqual(
      Battle.run(fixed(undefined, { land: { hp: 2, attack: 2, armour: 0.3 } })).result(),
    );
    expect(lost(theirs, 1) - lost(theirs, 0)).toBeLessThan(lost(plain, 1) - lost(plain, 0));
  });

  it('beyond the bounds, a battle made at home plays as at the bound', () => {
    expect(Battle.run(fixed({ land: { hp: 9, attack: 5, armour: 0.9 } })).result()).toEqual(
      Battle.run(fixed({ land: { hp: 2, attack: 2, armour: 0.3 } })).result(),
    );
  });

  it('evasion turns hits away within the one draw', () => {
    // Helicopters under two anti-air guns: evading half the hits, they take fewer.
    const guns: StructSpec[] = [0, 1].map((k) => ({
      id: 40 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 400 + k * 60,
      z: 460,
      r: 6,
      hp: 600,
      gun: 5,
      range: 320,
      against: ['air'],
    }));
    const make = (evade?: number) => {
      const i = input(lineLayout([...TOWN, ...guns]), force(['helicopter', 6]), { stance: 'bold' });
      i.seed = 'evade';
      if (evade !== undefined) i.attacker.mods = { air: { evade } };
      return stampBattle(i);
    };
    const hits = (i: BattleInput) => {
      const b = new Battle(i);
      let n = 0;
      while (!b.outcome) {
        b.tick();
        n += b.frame().shots.filter((s) => s.kind === 2 && s.hit).length;
      }
      return n;
    };
    const plain = hits(make());
    const dodging = hits(make(0.5));
    expect(plain).toBeGreaterThan(5);
    expect(dodging).toBeLessThan(plain);
    expect(hits(make(0.5))).toBe(dodging);
  });
});

describe('battles version 3: interceptors', () => {
  /** Artillery shelling the depot from 300–420 m, the bunker and homes round it. */
  const shelling = (extra: StructSpec[]) => {
    const i = input(lineLayout([...TOWN, ...extra]), force(['artillery', 4], ['tank', 1]), {
      stance: 'bold',
    });
    i.seed = 'intercept';
    return stampBattle(i);
  };
  const stopped = (frames: BattleFrame[]) => frames.flatMap((f) => f.shots.filter((s) => s.kind === 3));

  it('stop shells aimed at buildings within their reach, the same every time', () => {
    const near = interceptor(50, 1000, 700); // about 190 m from the depot
    const a = play(shelling([near]));
    const b = play(shelling([near]));
    expect(a.b.result()).toEqual(b.b.result());
    const puffs = stopped(a.frames);
    expect(puffs.length).toBeGreaterThan(0);
    // Each puff over a target within the battery's 450 m.
    for (const p of puffs) expect(Math.hypot(p.x1 - 1000, p.z1 - 700)).toBeLessThan(450 + 80);
    expect(puffs.every((p) => !p.hit && p.y1 > 20)).toBe(true);
    // The battle goes otherwise than without it.
    expect(a.b.result().hash).not.toBe(play(shelling([plainGun(near)])).b.result().hash);
  });

  it('a battery out of reach, or unmanned, draws nothing: the battle is as without one', () => {
    // Beyond the targets, over 450 m from any of them and out of the artillery's reach (not a
    // military building here, or the attackers would make it their objective, and it would guard
    // itself).
    const far = { ...interceptor(50, 1150, 1000), tags: TAG.civic | TAG.defence | TAG.intercept };
    const idle = interceptor(50, 1000, 700, 0);
    for (const s of [far, idle]) {
      const withIt = play(shelling([s]));
      const without = play(shelling([plainGun(s)]));
      expect(stopped(withIt.frames)).toEqual([]);
      expect(withIt.b.result()).toEqual(without.b.result());
    }
  });

  it('shots from close by (tanks at a wall) aren’t stopped', () => {
    // Heavy tanks reach 140 m: at the 40 m depot's wall that's up to 160 m from its middle, but
    // what counts is how far the shell flies, to the wall.
    const near = interceptor(50, 1000, 700);
    for (const kind of ['tank', 'heavytank'] as const) {
      const tanks = (s: StructSpec) => {
        const i = input(lineLayout([...TOWN, s]), force([kind, 6]), { stance: 'bold' });
        i.seed = 'close';
        return stampBattle(i);
      };
      const withIt = play(tanks(near));
      expect(stopped(withIt.frames), kind).toEqual([]);
      expect(withIt.b.result()).toEqual(play(tanks(plainGun(near))).b.result());
    }
  });
});

describe('battles version 3: the dome', () => {
  const raid = (dome?: number) => {
    const L = lineLayout(TOWN);
    if (dome !== undefined) L.dome = dome;
    const i = input(L, force(['artillery', 4], ['tank', 4]), { stance: 'bold' });
    i.seed = 'dome';
    return stampBattle(i);
  };

  it('soaks every hit on a building until its pool is spent, then pops', () => {
    const plain = play(raid());
    expect(plain.b.result().damaged.length).toBeGreaterThan(0);
    const a = play(raid(800));
    expect(a.b.result()).toEqual(play(raid(800)).b.result());
    const popped = a.events.findIndex((e) => e.k === 'dome');
    expect(popped).toBeGreaterThanOrEqual(0);
    expect(a.events.filter((e) => e.k === 'dome').length).toBe(1);
    // Nothing was damaged before it popped.
    expect(a.events.slice(0, popped).some((e) => e.k === 'damaged' || e.k === 'destroyed')).toBe(false);
    // The frames carry the pool left, falling to nothing.
    const shares = a.frames.map((f) => f.dome!);
    expect(shares[0]).toBeGreaterThan(0);
    for (let k = 1; k < shares.length; k++) expect(shares[k]!).toBeLessThanOrEqual(shares[k - 1]!);
    expect(shares.at(-1)).toBe(0);
    expect(plain.frames[0]!.dome).toBeUndefined();
  });

  it('a pool bigger than the battle keeps every building whole', () => {
    const a = play(raid(1_000_000));
    const r = a.b.result();
    expect(r.damaged).toEqual([]);
    expect(r.destroyed).toEqual([]);
    expect(a.events.some((e) => e.k === 'dome')).toBe(false);
    expect(a.frames.at(-1)!.dome!).toBeLessThan(1);
  });
});

describe('battles version 3: superweapons', () => {
  it('the robot leaves the road near its objective and stamps on what stands in its way', () => {
    // Homes on the straight line from where it leaves the road (500 m out) to the depot.
    const path = [500, 600, 760, 820].map((x, k) => ({
      id: 60 + k,
      tags: TAG.home,
      x,
      z: 500 + ((x - 402) * 40) / 498,
      r: 8,
      hp: 200,
    }));
    const make = (caps?: BattleInput['caps']) => {
      const i = input(lineLayout([...TOWN, ...path]), [one('windupbot', 1)], { stance: 'bold' });
      i.seed = 'stomp';
      if (caps) i.caps = caps;
      return stampBattle(i);
    };
    expect(make().v).toBe(BATTLE_VERSION);
    const a = play(make());
    expect(a.b.result()).toEqual(play(make()).b.result());
    const destroyed = a.b.result().destroyed;
    for (const h of path) expect(destroyed, `home ${h.id}`).toContain(h.id);
    // The depot it walked to falls too (stamped and shot).
    expect(destroyed).toContain(10);
    expect(a.b.result().outcome).toBe('raided');
    // It walked off the road: frames put it off z = 500 near the depot.
    const robot = a.frames.flatMap((f) => f.units.filter((u) => u.kind === 'windupbot'));
    expect(robot.some((u) => Math.abs(u.z - 500) > 15)).toBe(true);
    // And the battle's caps still bound it: two homes at most.
    const capped = play(make({ maxCollapse: 2, maxWreck: 3 })).b.result();
    expect(capped.destroyed.filter((id) => id >= 20 && id < 70).length).toBe(2);
  });

  it('with the caps spent on its objectives, a superweapon’s force pulls out; one without waits for the clock', () => {
    // Two military objectives (the depot and the bunker), and room to wreck only one of them.
    const make = (force: BattleUnitIn[]) => {
      const i = input(lineLayout(TOWN), force, { stance: 'bold' });
      i.seed = 'caps-spent';
      i.caps = { maxCollapse: 12, maxWreck: 1 };
      return stampBattle(i);
    };
    const robot = play(make([one('windupbot', 1)])).b.result();
    expect(robot.objectives).toEqual({ aimed: 2, down: 1 });
    expect(robot.outcome).toBe('raided');
    // It pulled out once the one wreck it may make was made, long before the clock ran out.
    expect(robot.steps).toBeLessThan(BATTLE.maxSteps);
    // The same with tanks alone: the battle is as it was (version 2), held on the capped bunker
    // until the clock pulls them out.
    const tanks = make(units('tank', 6, undefined, -1, 100));
    expect(tanks.v).toBe(2);
    const plain = play(tanks).b.result();
    expect(plain.objectives).toEqual({ aimed: 2, down: 1 });
    expect(plain.steps).toBeGreaterThanOrEqual(BATTLE.maxSteps);
  });

  it('the sky fortress launches its 16 drones near its objective, one at a time', () => {
    // Military buildings too strong to fall, so the force stays to launch them all (its drones are
    // bomb drones: the town's own depot and bunker would fall to the first five).
    const sturdy = TOWN.map((s) => (s.tags & TAG.military ? { ...s, hp: 1e6 } : s));
    const make = (hp = 1, extra: StructSpec[] = []) => {
      const i = input(lineLayout([...sturdy, ...extra]), fortress(hp), { stance: 'bold' });
      i.seed = 'fortress';
      return stampBattle(i);
    };
    expect(checkBattleInput(make())).toBeNull();
    const a = play(make());
    expect(a.b.result()).toEqual(play(make()).b.result());
    const seen = new Map<number, number>();
    a.frames.forEach((f, k) => {
      for (const u of f.units) if (u.id <= -SUPER.carriedId && !seen.has(u.id)) seen.set(u.id, k);
    });
    expect(seen.size).toBe(16);
    // One at a time (20 steps apart: 10 ticks), the first within 600 m of the depot.
    const ticks = [...seen.values()].sort((x, y) => x - y);
    for (let k = 1; k < ticks.length; k++) expect(ticks[k]! - ticks[k - 1]!).toBeGreaterThanOrEqual(10);
    // Its objective: the military building nearest the way in (the bunker).
    const k = a.b.objectives[0]!;
    const L = make().layout;
    const [ox, oz] = [L.structs[k * S.stride + S.x]!, L.structs[k * S.stride + S.z]!];
    const first = a.frames[ticks[0]!]!.units.find((u) => u.kind === 'skyfortress')!;
    expect(Math.hypot(first.x - ox, first.z - oz)).toBeLessThanOrEqual(SUPER.launch);
    expect(
      Math.hypot(a.frames[ticks[0]! - 1]!.units[0]!.x - ox, a.frames[ticks[0]! - 1]!.units[0]!.z - oz),
    ).toBeGreaterThan(SUPER.launch - 30);
    // Drones are shown only once launched: none before.
    expect(a.frames.slice(0, ticks[0]!).some((f) => f.units.some((u) => u.kind === 'drone'))).toBe(false);
  });

  it('what a fortress carries are bomb drones; drones of its own aren’t', () => {
    const drone = UNIT.get('drone')!.stats;
    const carries = UNIT.get('skyfortress')!.stats.carries!;
    expect(carries.siege).toBeGreaterThan(1);
    // A fortress, its sixteen, and four drones flown in alongside: only the sixteen carry bombs.
    const i = stampBattle(
      input(lineLayout(TOWN), [...fortress(), ...units('drone', 4, undefined, -1, 700)], { stance: 'bold' }),
    );
    const b = new Battle(structuredClone(i));
    const sieges = (carried: boolean) =>
      b.units.filter((u) => u.kind === 'drone' && u.carrier >= 0 === carried).map((u) => u.siege);
    expect(sieges(true)).toEqual(Array<number>(16).fill(carries.siege!));
    expect(sieges(false)).toEqual(Array<number>(4).fill(drone.siege));
    // A drone raid without a fortress uses nothing of version 3, and plays as it did.
    const plain = stampBattle(
      input(lineLayout(TOWN), units('drone', 6, undefined, -1, 800), { stance: 'bold' }),
    );
    expect(plain.v).toBe(2);
    expect(
      new Battle(structuredClone(plain)).units.every((u) => u.side === 1 || u.siege === drone.siege),
    ).toBe(true);
  });

  it('a fortress knocked out before it has launched them all takes the rest home', () => {
    // Anti-air round the depot, and a fortress already badly hurt.
    const flak: StructSpec[] = [0, 1, 2, 3].map((k) => ({
      id: 40 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 760 + k * 60,
      z: 420,
      r: 6,
      hp: 600,
      gun: 5,
      range: 320,
      against: ['air'],
    }));
    // Tanks along by road (the anti-air can't touch them), so the force fights on without it.
    const i = input(
      lineLayout([...TOWN, ...flak]),
      [...fortress(0.05), ...units('tank', 8, undefined, -1, 600)],
      {
        stance: 'bold',
      },
    );
    i.seed = 'fortress-down';
    const a = play(stampBattle(i));
    const r = a.b.result();
    expect(r.units.find((u) => u.id === 500)!.out).toBe(true);
    const launched = new Set<number>();
    for (const f of a.frames) for (const u of f.units) if (u.kind === 'drone') launched.add(u.id);
    expect(launched.size).toBeLessThan(16);
    // The rest leave as it falls, in the same tick.
    const down = a.at[a.events.findIndex((e) => e.k === 'out' && e.unit === 500)]!;
    const left = new Map<number, number>();
    a.events.forEach((e, k) => e.k === 'left' && left.set(e.unit, a.at[k]!));
    for (let k = 0; k < 16; k++) {
      const id = -(SUPER.carriedId + k);
      if (!launched.has(id)) expect(left.get(id), `drone ${id}`).toBe(down);
    }
    // The tanks fought on after it.
    expect(
      a.frames
        .slice(down + 1)
        .some((f) => f.units.some((u) => u.kind === 'tank' && u.side === 0 && u.state === 1)),
    ).toBe(true);
  });

  it('the whale can’t be hit while it swims; it surfaces off the shore, fires a while, then dives', () => {
    // Deep water from z = 832 m, its shore 300 m south of the depot; a coastal gun on the shore.
    const gun: StructSpec = {
      id: 45,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 900,
      z: 800,
      r: 8,
      hp: 600,
      gun: 6,
      range: 480,
      against: ['sea'],
    };
    const make = () => {
      const L = lineLayout([...TOWN, gun]);
      const n = L.grid.nx;
      L.grid.cells = L.grid.cells.map((c, k) => (Math.floor(k / n) * BATTLE.cell > 800 ? CELL_DEEP : c));
      const i = input(L, [one('clockworkwhale', 7)], { stance: 'bold', route: 'sea' });
      i.seed = 'whale';
      return stampBattle(i);
    };
    expect(checkBattleInput(make())).toBeNull();
    const a = play(make());
    expect(a.b.result()).toEqual(play(make()).b.result());
    const views = a.frames.flatMap((f) =>
      f.units.filter((u) => u.kind === 'clockworkwhale').map((u) => ({ ...u, step: f.step })),
    );
    expect(views.length).toBeGreaterThan(0);
    const firstUp = views.findIndex((v) => v.state !== 3);
    expect(firstUp).toBeGreaterThan(0);
    // Under water it was never touched.
    for (const v of views.slice(0, firstUp)) expect(v.hp).toBe(1);
    // Up, it's within 600 m of its way's end and in reach of the gun, which hits it.
    expect(views.slice(firstUp).some((v) => v.hp < 1)).toBe(true);
    // It fired at most 600 steps, then dived again and left.
    const up = views.filter((v) => v.state !== 3);
    expect(up.at(-1)!.step - up[0]!.step).toBeLessThanOrEqual(600 + BATTLE.stepsPerTick);
    const after = views.slice(views.indexOf(up.at(-1)!) + 1);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((v) => v.state === 3 || v.state === 2)).toBe(true);
    expect(a.b.result().damaged.length + a.b.result().destroyed.length).toBeGreaterThan(0);
  });
});

/** A war town: an HQ, barracks and a bunker by the town, three squads at home. */
function warTown(): { sim: Sim; place: (def: string) => number } {
  const sim = newSim({ rivals: true, disasters: false });
  const { streets } = buildTown(sim);
  serveTown(sim);
  sim.advance(2 * TICKS_PER_MONTH);
  sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
  const place = (def: string) => {
    for (const seg of [...streets].reverse())
      try {
        return placeAlong(sim, def, seg);
      } catch {
        /* the next street */
      }
    throw new Error(`no room for ${def}`);
  };
  place('militaryhq');
  const barracks = place('barracks');
  place('bunker');
  for (let k = 0; k < 3; k++) sim.dispatch({ type: 'trainUnit', base: barracks, kind: 'infantry' });
  sim.advance(2 * TICKS_PER_MONTH);
  return { sim, place };
}

/** Research done, as the labs would leave it (no cheat for it yet). */
function researched(sim: Sim, done: TierKey[]): void {
  sim.state.war!.research = { done, queue: [], points: {}, paid: [], prototypes: [], proven: [], trials: [] };
}

/** A friend's page's raid on the town as its own picture shows it: 24 tanks by road at its military. */
function raidOn(layout: BattleLayout, id = 'exp-test-1'): BattleInput {
  return stampBattle({
    v: BATTLE_VERSION,
    id,
    seed: `seed-${id}`,
    scale: 'skirmish',
    layout,
    attacker: {
      name: 'Raiders',
      color: 0xd04040,
      units: Array.from({ length: 24 }, (_, k) => one('tank', 90_000 + k)),
      route: 'highway',
      target: 'military',
      stance: 'bold',
      readiness: 1,
    },
    defender: { name: 'Town', color: 0x4060d0 },
    orders: [],
    caps: { maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck },
  });
}

const rows = (L: BattleLayout) =>
  Array.from({ length: L.structs.length / S.stride }, (_, k) => ({
    k,
    id: L.structs[k * S.stride + S.id]!,
    tags: L.structs[k * S.stride + S.tags]!,
    x: L.structs[k * S.stride + S.x]!,
    z: L.structs[k * S.stride + S.z]!,
    hp: L.structs[k * S.stride + S.hp]!,
  }));

describe('battles version 3 in a city', () => {
  let town: Sim;
  const spec = { target: 'military' as const, from: 'west' as const };
  beforeAll(() => {
    town = warTown().sim;
  });

  it('a city that hasn’t researched fights its battles as on M36 (version 2)', () => {
    const sim = town;
    const L = battleLayout(sim, spec);
    expect(L.mods).toBeUndefined();
    expect(battleVersionOf(raidOn(L))).toBe(2);
    expect(strengthFactors(sim)).toEqual({ hard: { civic: 1, other: 1 }, shields: [] });
  });

  it('hardened buildings stand more, and a battle from outside still matches them', () => {
    const { sim } = { sim: town };
    const before = battleLayout(sim, spec);
    researched(sim, ['defence1']);
    try {
      const hard = battleLayout(sim, spec);
      const was = rows(before);
      const now = rows(hard);
      expect(now.map((r) => r.id)).toEqual(was.map((r) => r.id));
      for (const [k, r] of now.entries()) {
        const f = r.tags & TAG.civic ? 1.3 : 1.15;
        expect(Math.abs(r.hp - was[k]!.hp * f), `structure ${r.id}`).toBeLessThanOrEqual(f);
        // The city sees each the same way.
        const seen = structureAsSeen(sim, r.id)!;
        expect([seen.tags, seen.x, seen.z, seen.hp]).toEqual([r.tags, r.x, r.z, r.hp]);
      }
      // Strength alone is no version 3 field: the battle is version 2 still.
      expect(battleVersionOf(raidOn(hard))).toBe(2);
      // Made on the city as it is, every structure is the city's own.
      const adopted = adoptBattle(sim, raidOn(hard));
      expect(rows(adopted.layout).map((r) => r.id)).toEqual(now.map((r) => r.id));
      // Made on a save from before the research, each looks weaker than it is: none is touched.
      const stale = adoptBattle(sim, raidOn(before));
      expect(rows(stale.layout).every((r) => r.id < 0)).toBe(true);
    } finally {
      delete sim.state.war!.research;
    }
  });

  it('a working shield generator doubles what stands in its reach; a stale picture spares it', () => {
    const { sim, place } = warTown();
    researched(sim, ['defence1', 'defence2', 'defence3']);
    const gen = place('shieldgen');
    const battery = place('interceptor');
    sim.advance(TICKS_PER_MONTH);
    const g = sim.state.civics.get(gen)!;
    expect(strengthFactors(sim).shields).toEqual([{ x: g.x, z: g.z, radius: 300, factor: 2 }]);
    const shielded = battleLayout(sim, spec);
    // A picture made while the generator stood idle: what the attacker's page might have.
    const staff = g.staff;
    g.staff = 0;
    const idle = battleLayout(sim, spec);
    expect(strengthFactors(sim).shields).toEqual([]);
    g.staff = staff;
    const inReach = (r: { x: number; z: number }) => Math.hypot(r.x - g.x, r.z - g.z) <= 300;
    const was = new Map(rows(idle).map((r) => [r.id, r]));
    let covered = 0;
    for (const r of rows(shielded)) {
      const before = was.get(r.id)!;
      if (inReach(r)) {
        covered++;
        expect(Math.abs(r.hp - before.hp * 2)).toBeLessThanOrEqual(2);
      } else expect(r.hp).toBe(before.hp);
      expect(structureAsSeen(sim, r.id)!.hp).toBe(r.hp);
    }
    expect(covered).toBeGreaterThan(3);
    // The battery is an interceptor to the battle: that's version 3.
    const b = rows(shielded).find((r) => r.id === battery)!;
    expect(b.tags & TAG.intercept).toBe(TAG.intercept);
    expect(raidOn(shielded).v).toBe(BATTLE_VERSION);
    expect(checkBattleInput(raidOn(shielded))).toBeNull();
    // Matched as it is: every structure the city's own.
    expect(rows(adoptBattle(sim, raidOn(shielded)).layout).every((r) => r.id >= 0)).toBe(true);
    // Matched on the idle picture: what the shield covers is a stranger (it takes nothing), the rest
    // is the city's own.
    for (const r of rows(adoptBattle(sim, raidOn(idle)).layout)) {
      const orig = rows(idle)[r.k]!;
      expect(r.id < 0, `structure ${orig.id}`).toBe(inReach(orig));
    }
  });

  it('the city’s own dome covers what a battle made without it would hit', () => {
    const fight = (pool: number | null) => {
      const copy = cloneSim(town);
      const r = resolveBattle(copy, raidOn(battleLayout(copy, spec), 'dome-test'), 'watch', false);
      expect(r.ok).toBe(true);
      const hb = copy.state.war!.battle!;
      if (pool !== null) coverWithDome(hb, pool);
      while (copy.state.war!.battle) copy.step();
      const rep = copy.state.war!.reports!.at(-1)!;
      return { rep, cover: hb.cover, copy };
    };
    const open = fight(null);
    expect(open.rep.collapsed.length + open.rep.burning.length + open.rep.civics.length).toBeGreaterThan(0);
    const domed = fight(1e9);
    expect(domed.rep.collapsed).toEqual([]);
    expect(domed.rep.burning).toEqual([]);
    expect(domed.rep.civics).toEqual([]);
    expect(domed.cover!.ids.length).toBeGreaterThan(0);
    expect(domed.cover!.pool).toBeLessThan(1e9);
    // A pool no bigger than the battle's own adds nothing.
    const hb = { input: { layout: { dome: 500 } } } as Parameters<typeof coverWithDome>[0];
    coverWithDome(hb, 400);
    expect(hb.cover).toBeUndefined();
    coverWithDome(hb, 900);
    expect(hb.cover).toEqual({ pool: 400, ids: [] });
  });

  it('a superweapon in a computer neighbour’s town brings its own caps; a fortress its drones', () => {
    const sim = town;
    const rival = sim.state.region.neighbours.find((n) => n.rival && !n.player)!;
    const city = (units: AwayCity['units'], friend = false): AwayCity => ({
      seed: 'ashford',
      cityName: 'Ashford',
      readiness: 1,
      expedition: { id: 7, route: 'air', target: 'military', stance: 'bold' },
      units,
      neighbour: {
        id: rival.id,
        name: rival.name,
        side: rival.side,
        kind: rival.kind,
        population: rival.population,
        rival: friend ? null : { ...rival.rival! },
        slot: friend ? 2 : null,
        colour: 0xd04040,
      },
    });
    const sky = awayInput(city([{ id: 1, kind: 'skyfortress', hp: 1 }]), sim);
    expect(sky.caps).toEqual(SUPER.caps);
    expect(sky.v).toBe(BATTLE_VERSION);
    expect(checkBattleInput(sky)).toBeNull();
    const drones = sky.attacker.units.filter((u) => u.from !== undefined);
    expect(drones.map((u) => u.id)).toEqual(Array.from({ length: 16 }, (_, k) => -(SUPER.carriedId + k)));
    expect(drones.every((u) => u.from === 1 && u.kind === 'drone')).toBe(true);
    // A friend keeps a skirmish's caps, superweapon or not.
    expect(awayInput(city([{ id: 1, kind: 'skyfortress', hp: 1 }], true), sim).caps).toEqual({
      maxCollapse: SKIRMISH.maxCollapse,
      maxWreck: SKIRMISH.maxWreck,
    });
    // No superweapon: a skirmish, and version 2.
    const plain = awayInput(city([{ id: 1, kind: 'tank', hp: 1 }]), sim);
    expect(plain.caps).toEqual({ maxCollapse: SKIRMISH.maxCollapse, maxWreck: SKIRMISH.maxWreck });
    expect(plain.v).toBe(2);
    // The city's research goes with its force.
    const modded = awayInput(
      { ...city([{ id: 1, kind: 'tank', hp: 1 }]), mods: { land: { hp: 1.25 } } },
      sim,
    );
    expect(modded.attacker.mods).toEqual({ land: { hp: 1.25 } });
    expect(modded.v).toBe(BATTLE_VERSION);
    // The fortress fights the same twice.
    expect(Battle.run(structuredClone(sky)).result()).toEqual(Battle.run(structuredClone(sky)).result());
  });

  it('the robot stomps through a real town, within the superweapon caps', () => {
    const sim = town;
    const rival = sim.state.region.neighbours.find((n) => n.rival && !n.player)!;
    const city: AwayCity = {
      seed: 'ashford',
      cityName: 'Ashford',
      readiness: 1,
      expedition: { id: 8, route: 'highway', target: 'military', stance: 'bold' },
      units: [{ id: 1, kind: 'windupbot', hp: 1 }],
      neighbour: {
        id: rival.id,
        name: rival.name,
        side: rival.side,
        kind: rival.kind,
        population: rival.population,
        rival: { ...rival.rival!, forces: 0, defences: 0 },
        slot: null,
        colour: 0xd04040,
      },
    };
    const i = awayInput(city, sim);
    const a = Battle.run(structuredClone(i)).result();
    expect(a).toEqual(Battle.run(structuredClone(i)).result());
    expect(a.outcome).toBe('raided');
    expect(a.objectives.down).toBeGreaterThan(0);
    const civics = new Set(
      rows(i.layout)
        .filter((r) => r.tags & TAG.civic)
        .map((r) => r.id),
    );
    expect(a.destroyed.filter((id) => !civics.has(id)).length).toBeLessThanOrEqual(SUPER.caps.maxCollapse);
    expect(a.destroyed.filter((id) => civics.has(id)).length).toBeLessThanOrEqual(SUPER.caps.maxWreck);
  });

  it('a raid on a city with research carries its modifiers; one without stays version 2', () => {
    const plain = cloneSim(town);
    expect(plain.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 }).ok).toBe(true);
    const hb = plain.state.war!.battle!;
    expect([hb.input.v, hb.input.layout.v]).toEqual([2, 2]);
    const armoured = cloneSim(town);
    researched(armoured, ['land1', 'land2', 'land3']);
    expect(armoured.dispatch({ type: 'cheat', cheat: 'raidIn', hours: 0 }).ok).toBe(true);
    const hb3 = armoured.state.war!.battle!;
    expect(hb3.input.layout.mods).toEqual({ land: { hp: 1.25, armour: 0.05 } });
    expect([hb3.input.v, hb3.input.layout.v]).toEqual([BATTLE_VERSION, BATTLE_VERSION]);
    // It plays out, and the same after a save and load mid-battle.
    armoured.advance(60);
    const copy = cloneSim(armoured);
    while (armoured.state.war!.battle) armoured.step();
    while (copy.state.war!.battle) copy.step();
    expect(copy.hash()).toBe(armoured.hash());
    expect(rubble(copy)).toBe(rubble(armoured));
  });
});

/** A copy of a city, in test mode (for the cheats). */
function cloneSim(sim: Sim): Sim {
  const copy = Sim.fromSave(sim.save());
  copy.testMode = true;
  return copy;
}

const rubble = (sim: Sim) =>
  [...sim.state.buildings.values()].filter((b) => b.state === BState.Rubble).length;

/**
 * A computer neighbour's town as the page's battle worker grows it (the test size): the test city's
 * coastal resort, Calhaven. Its military stands about a kilometre in from the sea.
 */
function resortTown() {
  const city = newSim({ rivals: true, disasters: false });
  const n = city.state.region.neighbours.find((x) => x.rival && x.kind === 'resort')!;
  const town = growRivalTown({
    citySeed: city.state.options.seed,
    neighbour: n.id,
    name: n.name,
    kind: n.kind,
    personality: n.rival!.personality,
    population: n.population,
    cap: TOWNS.testCap,
  });
  /**
   * A strike on the town by one unit of `kind` (and an escort), as an expedition from the city;
   * `defences` mans the town's guns as a neighbour with that many defence points would.
   */
  const strike = (
    kind: UnitKind,
    route: 'highway' | 'air' | 'sea',
    escort: UnitKind[] = [],
    defences = n.rival!.defences,
  ) =>
    awayInput(
      {
        seed: city.state.options.seed,
        cityName: city.state.options.cityName,
        readiness: 1,
        expedition: { id: 3, route, target: 'military', stance: 'bold' },
        units: [kind, ...escort].map((k, i) => ({ id: i + 1, kind: k, hp: 1 })),
        neighbour: {
          id: n.id,
          name: n.name,
          side: n.side,
          kind: n.kind,
          population: n.population,
          rival: { ...n.rival!, defences },
          slot: null,
          colour: 0xd04040,
        },
      },
      town,
    );
  return { city, n, town, strike };
}

/** What a battle knocked down: buildings collapsed and city buildings wrecked. */
function fallen(i: BattleInput, r: ReturnType<Battle['result']>): { collapsed: number; wrecked: number } {
  const civics = new Set(
    rows(i.layout)
      .filter((x) => x.tags & TAG.civic)
      .map((x) => x.id),
  );
  const wrecked = r.destroyed.filter((id) => civics.has(id)).length;
  return { collapsed: r.destroyed.length - wrecked, wrecked };
}

describe('superweapons in a grown computer town', () => {
  let resort: ReturnType<typeof resortTown>;
  beforeAll(() => {
    resort = resortTown();
  });

  it('the robot raids what the caps allow and is done within its time', () => {
    const i = resort.strike('windupbot', 'highway');
    expect(i.caps).toEqual(SUPER.caps);
    const r = Battle.run(structuredClone(i)).result();
    expect(r).toEqual(Battle.run(structuredClone(i)).result());
    expect(r.outcome).toBe('raided');
    const f = fallen(i, r);
    expect(f.wrecked).toBeLessThanOrEqual(SUPER.caps.maxWreck);
    expect(f.collapsed).toBeLessThanOrEqual(SUPER.caps.maxCollapse);
    // Every objective it could knock down is down: what stands, the caps hold up.
    expect(r.objectives.aimed).toBe(BATTLE.maxTargets);
    expect(r.objectives.down).toBeGreaterThanOrEqual(SUPER.caps.maxWreck);
    if (r.objectives.down < r.objectives.aimed) expect(f.wrecked).toBe(SUPER.caps.maxWreck);
    // And it was out of the town again (raid and walk back) before the clock ran out.
    expect(r.steps).toBeLessThan(BATTLE.maxSteps);
  });

  it('the sky fortress’s bomb drones knock down as much as the robot; anti-air shoots them down', () => {
    const robot = Battle.run(structuredClone(resort.strike('windupbot', 'highway'))).result();
    const i = resort.strike('skyfortress', 'air');
    const r = Battle.run(structuredClone(i)).result();
    expect(r).toEqual(Battle.run(structuredClone(i)).result());
    expect(r.outcome).toBe('raided');
    const f = fallen(i, r);
    expect(f.wrecked).toBeLessThanOrEqual(SUPER.caps.maxWreck);
    expect(f.collapsed).toBeLessThanOrEqual(SUPER.caps.maxCollapse);
    // As many of its objectives down as the robot's, and as many city buildings wrecked.
    expect(r.objectives.down).toBeGreaterThanOrEqual(robot.objectives.down);
    expect(f.wrecked).toBeGreaterThanOrEqual(fallen(i, robot).wrecked);
    // The town's anti-air still brought drones down.
    const downed = (x: typeof r) => x.units.filter((u) => u.id <= -SUPER.carriedId && u.out).length;
    expect(downed(r)).toBeGreaterThan(0);
    // With every post manned, it shoots down all sixteen and the town keeps more standing.
    const manned = resort.strike('skyfortress', 'air', [], 40);
    const m = Battle.run(structuredClone(manned)).result();
    expect(downed(m)).toBe(16);
    expect(m.objectives.down).toBeLessThan(r.objectives.down);
  });
});
