import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { awayResult } from '../../src/sim/battle/away';
import { Battle } from '../../src/sim/battle/battle';
import { BATTLE_LIMITS, checkBattleInput } from '../../src/sim/battle/check';
import {
  BATTLE_V4,
  BATTLE_VERSION,
  OWNER_ATTACKER,
  OWNER_DEFENDER,
  S,
  TAG,
  type BattleEvent,
  type BattleFrame,
  type BattleHelper,
  type BattleInput,
  type BattleOrder,
  type BattleUnitIn,
} from '../../src/sim/battle/types';
import { appendOrders, recordInput, stampLive, type StampedOrder } from '../../src/sim/battle/live';
import { battleVersionOf, stampBattle, usesV4 } from '../../src/sim/battle/version';
import { BATTLE, SUPER } from '../../src/data/battle';
import { decodeBattle, encodeBattle } from '../../src/net/snapshot';
import type { UnitKind } from '../../src/data/war';
import { input, lineLayout, TOWN, type StructSpec } from './handmade';

/**
 * Battles, version 4 (M39 war with friends, `docs/plans/M39-design.md` calls 1, 2 and 7): orders
 * given while a battle runs (focus, guard, hold, free, withdraw by units) and allied helpers with
 * owners. Everything version 4 adds is a field whose code runs only when it's there, so version 2
 * and 3 battles (v2replay, battle3, the M36 golden) play and hash exactly as before.
 */

/** Units with fixed ids from `first` (so two battles made alike are alike). */
function crew(kind: UnitKind, n: number, first: number, base = -1, at = { x: 0, z: 0 }): BattleUnitIn[] {
  return Array.from({ length: n }, (_, k) => ({ id: first + k, kind, hp: 1, x: at.x, z: at.z, base }));
}

/** Two manned bunkers by the road: they fire on land and air. */
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

/** Two tanks and three squads at the depot: the defenders the version 2 fixtures use. */
const home = (): BattleUnitIn[] => [
  ...crew('tank', 2, 5001, 0, { x: 900, z: 540 }),
  ...crew('infantry', 3, 5101, 0, { x: 880, z: 520 }),
];

/** A battle stamped as its builder would: whatever version its fields need. */
function make(
  force: BattleUnitIn[],
  orders: BattleOrder[] = [],
  over: {
    structs?: StructSpec[];
    defenders?: BattleUnitIn[];
    helpers?: BattleHelper[];
    stance?: 'cautious' | 'bold';
    readiness?: number;
  } = {},
): BattleInput {
  const i = input(
    lineLayout(over.structs ?? TOWN, structuredClone(over.defenders ?? []), over.readiness ?? 1),
    structuredClone(force),
    over.stance ? { stance: over.stance } : {},
  );
  i.orders = structuredClone(orders);
  if (over.helpers) i.helpers = structuredClone(over.helpers);
  return stampBattle(i);
}

/** A battle ticked to its end: every event with the step it came at, and every frame. */
function play(i: BattleInput): {
  b: Battle;
  events: { e: BattleEvent; step: number }[];
  frames: BattleFrame[];
} {
  const b = new Battle(structuredClone(i));
  const events: { e: BattleEvent; step: number }[] = [];
  const frames: BattleFrame[] = [];
  while (!b.outcome) {
    for (const e of b.tick()) events.push({ e, step: b.step });
    frames.push(b.frame());
  }
  return { b, events, frames };
}

/** Where a unit is in the battle as drawn (null: not on the map, or gone). */
function where(b: Battle, id: number, side: 0 | 1 = 0) {
  return b.frame().units.find((u) => u.id === id && u.side === side) ?? null;
}

/** A battle's private bits, for the tests that look inside it. */
interface Inside {
  units: {
    i: number;
    id: number;
    side: number;
    guard: number;
    posted: boolean;
    held: boolean;
    focus: number;
    target: number;
    objective: number;
  }[];
  gunTarget: Int32Array;
  gunFocus: number;
  state: Uint8Array;
}
const inside = (b: Battle) => b as unknown as Inside;

/** The step the first structure falls at in a battle (a plain run), and the struct row's index by id. */
const indexOf = (i: BattleInput, id: number) => {
  const L = i.layout;
  for (let k = 0; k < L.structs.length / S.stride; k++) if (L.structs[k * S.stride + S.id] === id) return k;
  throw new Error(`no structure ${id}`);
};

const kept = JSON.parse(readFileSync('tests/fixtures/war/battle-v2.json', 'utf8')) as {
  input: BattleInput;
  result: ReturnType<Battle['result']>;
}[];

/** An allied force of three tanks arriving at step 120 (owner 7), as the tests vary it. */
const ally = (over: Partial<BattleHelper> = {}): BattleHelper => ({
  owner: 7,
  name: 'Allies',
  color: 0x33aa33,
  side: 0,
  arrive: 120,
  units: crew('tank', 3, 7001),
  ...over,
});

describe('battles version 4: what stays as it was', () => {
  it('only an order other than a plain withdrawal, or a helper, makes a battle version 4', () => {
    const force = crew('tank', 3, 1);
    const stamped = (orders: BattleOrder[], helpers?: BattleHelper[]) =>
      make(force, orders, helpers ? { helpers } : {});
    const ally: BattleHelper = {
      owner: 3,
      name: 'Allies',
      color: 0x33aa33,
      side: 0,
      arrive: 40,
      units: crew('tank', 1, 7001),
    };
    // M35's withdrawal, whole side, whoever gives it: version 2 as ever; an empty list of helpers is none.
    for (const orders of [
      [],
      [{ step: 50, side: 0, kind: 'withdraw' }],
      [{ step: 50, side: 1, kind: 'withdraw' }],
    ] as BattleOrder[][]) {
      const i = stamped(orders, []);
      expect([i.v, i.layout.v], JSON.stringify(orders)).toEqual([2, 2]);
      expect(usesV4(i)).toBe(false);
    }
    // Anything of version 4 stamps 4, on the battle and its picture of the city.
    const v4: [string, BattleOrder[], BattleHelper[]?][] = [
      ['withdraw by units', [{ step: 5, side: 0, kind: 'withdraw', units: [1] }], undefined],
      ['focus', [{ step: 5, side: 0, kind: 'focus', target: 0 }], undefined],
      ['guard', [{ step: 5, side: 1, kind: 'guard', target: 0 }], undefined],
      ['hold', [{ step: 5, side: 0, kind: 'hold' }], undefined],
      ['free', [{ step: 5, side: 0, kind: 'free' }], undefined],
      ['a helper', [], [ally]],
    ];
    for (const [what, orders, helpers] of v4) {
      const i = stamped(orders, helpers);
      expect([i.v, i.layout.v], what).toEqual([BATTLE_V4, BATTLE_V4]);
      expect(battleVersionOf(i)).toBe(BATTLE_V4);
      expect(checkBattleInput(i), what).toBeNull();
    }
    // Version 3's fields keep a battle at 3 until it uses version 4's.
    const modded = (orders: BattleOrder[]) => {
      const i = make(force, orders);
      i.attacker.mods = { land: { hp: 1.25 } };
      return stampBattle(i);
    };
    expect(modded([{ step: 50, side: 0, kind: 'withdraw' }]).v).toBe(BATTLE_VERSION);
    expect(modded([{ step: 50, side: 0, kind: 'focus', target: 0 }]).v).toBe(BATTLE_V4);
  });

  it('a version 2 battle, stamped again, stays version 2 and plays to the result it was kept with', () => {
    for (const k of kept) {
      const i = structuredClone(k.input);
      i.helpers = [];
      expect(stampBattle(i).v).toBe(2);
      expect(checkBattleInput(i)).toBeNull();
      expect(Battle.run(i).result()).toEqual(k.result);
    }
  });

  it('M35’s withdrawal plays as it did on the M38 tip (hashes taken there)', () => {
    // Taken on 92e212d, before the withdrawal became one of several orders: any step, any force,
    // the defenders' withdrawal ignored, and a repeated one.
    const f1 = [...crew('tank', 6, 1), ...crew('infantry', 3, 11)];
    const f2 = [
      ...crew('helicopter', 2, 21),
      ...crew('fighter', 1, 31),
      ...crew('artillery', 2, 41),
      ...crew('transport', 1, 51),
      ...crew('drone', 2, 61),
    ];
    const run = (force: BattleUnitIn[], orders: BattleOrder[], over: Parameters<typeof make>[2] = {}) => {
      const i = make(force, orders, { structs: [...TOWN, ...bunkers], defenders: home(), ...over });
      const b = Battle.run(i);
      return `${i.v} ${b.outcome} ${b.step} ${b.hash()}`;
    };
    const w = (step: number): BattleOrder[] => [{ step, side: 0, kind: 'withdraw' }];
    expect(run(f1, w(0))).toBe('2 withdrew 1 cda402eaecb4424e');
    expect(run(f1, w(30))).toBe('2 withdrew 60 bac7d4b2e4c7e2e5');
    expect(run(f1, w(60))).toBe('2 withdrew 190 b777e6e0ed4d961f');
    expect(run(f1, w(200))).toBe('2 raided 672 c094aa04be789dd2');
    expect(run(f1, w(500))).toBe('2 raided 992 3105844a2bd4b0f8');
    expect(run(f2, w(10))).toBe('2 withdrew 20 de8e73d90e5c754f');
    expect(run(f2, w(80))).toBe('2 withdrew 166 ae04b9074b808992');
    expect(run(f1, [{ step: 10, side: 1, kind: 'withdraw' }])).toBe('2 raided 2375 70adfc690d4c8fcf');
    expect(run(f1, [])).toBe('2 raided 2375 70adfc690d4c8fcf');
    expect(run(f1, [...w(50), ...w(90)])).toBe('2 withdrew 182 144927687cde1c79');
    expect(run(f1, w(100), { stance: 'cautious' })).toBe('2 withdrew 271 23bbb42a2ad9a349');
  });

  it('a version 4 battle that uses nothing new plays the same course, and says whose each unit is', () => {
    for (const k of kept) {
      const i = structuredClone(k.input);
      i.v = BATTLE_V4;
      i.layout.v = BATTLE_V4;
      expect(checkBattleInput(i)).toBeNull();
      const r = Battle.run(i).result();
      const { hash, units, ...rest } = r;
      const { hash: was, units: wasUnits, ...wasRest } = k.result;
      expect(rest).toEqual(wasRest);
      expect(units.map(({ owner: _, ...u }) => u)).toEqual(wasUnits);
      expect(units.filter((u) => u.side === 0).every((u) => u.owner === OWNER_ATTACKER)).toBe(true);
      expect(units.filter((u) => u.side === 1).every((u) => u.owner === OWNER_DEFENDER)).toBe(true);
      // What version 4 hashes is its own: the same battle stamped 4 has another fingerprint.
      expect(hash).not.toBe(was);
    }
  });

  it('what version 4 hashes is hashed only in a version 4 battle', () => {
    // Told to focus on an attacker that no defender has met, the defence changes nothing on the
    // field at step 1: only the version 4 hash sees the order.
    const at = (v: number, orders: BattleOrder[]) => {
      const i = make(crew('tank', 3, 1), orders, { defenders: home() });
      i.v = v;
      i.layout.v = v;
      const b = new Battle(i);
      b.stepOnce();
      b.stepOnce();
      return b.hash();
    };
    const focus: BattleOrder[] = [{ step: 1, side: 1, kind: 'focus', target: 2 }];
    expect(at(3, focus)).toBe(at(3, []));
    expect(at(4, focus)).not.toBe(at(4, []));
  });
});

describe('orders given while a battle runs', () => {
  /** An armoury 400 m off the road (it's the nearer objective) and the depot up the road. */
  const split: StructSpec[] = [
    { id: 10, tags: TAG.civic | TAG.military | TAG.base, x: 900, z: 540, r: 20, hp: 900 },
    { id: 12, tags: TAG.civic | TAG.military, x: 500, z: 900, r: 20, hp: 900 },
    { id: 20, tags: TAG.home, x: 860, z: 470, r: 8, hp: 150 },
  ];

  it('focus (attackers): the given units make that structure their next objective', () => {
    const force = crew('tank', 4, 1);
    const plain = Battle.run(make(force, [], { structs: split })).result();
    // Left to themselves they go for the nearer objective, the armoury (id 12), first.
    expect(plain.destroyed.slice(0, 2)).toEqual([12, 10]);
    const depot = indexOf(make(force, [], { structs: split }), 10);
    const told = Battle.run(
      make(force, [{ step: 0, side: 0, kind: 'focus', target: depot }], { structs: split }),
    );
    expect(told.result().destroyed.slice(0, 2)).toEqual([10, 12]);
    // Some units only: the others keep their own judgement (and so go for the armoury).
    const some = play(
      make(force, [{ step: 0, side: 0, kind: 'focus', target: depot, units: [1, 2] }], { structs: split }),
    );
    const stand = some.frames[40]!.units;
    expect(stand.find((u) => u.id === 1)!.x).toBeGreaterThan(150);
    expect(some.b.result().destroyed).toContain(10);
    expect(some.b.result().destroyed).toContain(12);
  });

  it('focus (attackers) on a structure that is not an objective: they fire on it before the guns, then go on to an objective', () => {
    const depot: StructSpec = {
      id: 10,
      tags: TAG.civic | TAG.military | TAG.base,
      x: 900,
      z: 540,
      r: 20,
      hp: 900,
    };
    const force = crew('tank', 5, 1);
    // A home and a manned gun (an objective) stand the same distance from the road: left alone the
    // tanks never trouble the home; told to focus on it they level it first, then carry on.
    const pair: StructSpec[] = [
      depot,
      {
        id: 11,
        tags: TAG.civic | TAG.military | TAG.defence,
        x: 450,
        z: 530,
        r: 6,
        hp: 300,
        gun: 1,
        range: 100,
        against: ['land'],
      },
      { id: 20, tags: TAG.home, x: 450, z: 465, r: 6, hp: 150 },
    ];
    expect(Battle.run(make(force, [], { structs: pair })).result().destroyed).toEqual([11, 10]);
    const home = indexOf(make(force, [], { structs: pair }), 20);
    const told = Battle.run(
      make(force, [{ step: 0, side: 0, kind: 'focus', target: home }], { structs: pair }),
    );
    expect(told.result().destroyed).toEqual([20, 11, 10]);
    // A home all alone by the road, far short of the depot: they level it, and when it falls they
    // don't stay there (no objective has fallen to send them on): the depot is next.
    const alone: StructSpec[] = [depot, { id: 20, tags: TAG.home, x: 300, z: 470, r: 8, hp: 150 }];
    expect(Battle.run(make(force, [], { structs: alone })).result().destroyed).toEqual([10]);
    const one = Battle.run(make(force, [{ step: 0, side: 0, kind: 'focus', target: 1 }], { structs: alone }));
    expect(one.result().destroyed).toEqual([20, 10]);
    expect(one.outcome).toBe('raided');
  });

  it('focus (defenders): the given units, and the guns, fire on that attacker whenever it is in reach', () => {
    // Three tanks and three squads come in; the defence is told to concentrate on the last tank.
    const force = [...crew('tank', 3, 1), ...crew('infantry', 3, 11)];
    const focus = 3;
    const i = make(force, [{ step: 0, side: 1, kind: 'focus', target: focus }], {
      structs: [...TOWN, ...bunkers],
      defenders: crew('tank', 3, 5001, 0, { x: 900, z: 540 }),
    });
    const b = new Battle(i);
    const guns = [11, 30, 31].map((id) => indexOf(i, id));
    let tankChecks = 0;
    let gunChecks = 0;
    let gunFired = 0;
    while (!b.outcome) {
      // What the defenders could pick this step, from where everyone stands before it.
      const step = b.step;
      const u = inside(b).units;
      const f = u.find((x) => x.id === focus && x.side === 0)!;
      const pos = new Map(b.frame().units.map((v) => [`${v.side}:${v.id}`, v]));
      const reach = (side: number, id: number, range: number) => {
        const a = pos.get(`${side}:${id}`);
        const t = pos.get(`0:${focus}`);
        return !!a && !!t && t.state !== 2 && Math.hypot(a.x - t.x, a.z - t.z) <= range;
      };
      const chooses = u
        .filter((d) => d.side === 1 && (d.i + step) % BATTLE.targetEvery === 0)
        .map((d) => ({ d, near: reach(1, d.id, 120) }));
      const gunNear = guns
        .filter((k) => (step + k) % BATTLE.targetEvery === 0)
        .map((k) => ({ k, near: false }));
      for (const g of gunNear) {
        const row = i.layout.structs;
        const t = pos.get(`0:${focus}`);
        const x = row[g.k * S.stride + S.x]!;
        const z = row[g.k * S.stride + S.z]!;
        const range = row[g.k * S.stride + S.range]!;
        g.near = !!t && t.state !== 2 && Math.hypot(x - t.x, z - t.z) <= range && b.state[g.k] !== 2;
      }
      b.stepOnce();
      // The focus, still standing after the step (a shot this step could have felled it first).
      if (!where(b, focus)) continue;
      for (const { d, near } of chooses) {
        if (!near || d.target === 0x7fffffff) continue;
        tankChecks++;
        expect(u[d.target]!.id, `a defender at step ${step}`).toBe(focus);
      }
      for (const { k, near } of gunNear) {
        if (!near) continue;
        gunChecks++;
        gunFired += inside(b).gunTarget[k] === f.i ? 1 : 0;
      }
    }
    expect(tankChecks).toBeGreaterThan(5);
    expect(gunChecks).toBeGreaterThan(2);
    expect(gunFired).toBe(gunChecks);
    // Without the order the defence shoots at whatever is nearest and the same tank isn't singled out.
    const free = play(
      make(force, [], {
        structs: [...TOWN, ...bunkers],
        defenders: crew('tank', 3, 5001, 0, { x: 900, z: 540 }),
      }),
    );
    const told = play(i);
    const fell = (r: typeof told) =>
      r.events.find((x) => x.e.k === 'out' && x.e.side === 0 && x.e.unit === focus)?.step ?? Infinity;
    expect(fell(told)).toBeLessThan(fell(free));
  });

  it('guard: the given defenders go to that structure, stay near it, and carry on when it falls or they are freed', () => {
    const town = [...TOWN, { id: 30, tags: TAG.home, x: 1100, z: 470, r: 8, hp: 150 } as StructSpec];
    const post = indexOf(make([], [], { structs: town }), 30);
    const crewHome = () => crew('tank', 2, 5001, 0, { x: 900, z: 540 });
    const run = (orders: BattleOrder[]) =>
      new Battle(make(crew('tank', 3, 1), orders, { structs: town, defenders: crewHome() }));
    const at = (b: Battle, steps: number) => {
      while (b.step < steps && !b.outcome) b.stepOnce();
      return [5001, 5002].map((id) => where(b, id, 1)!);
    };
    // Left alone they drive west to meet the attackers.
    const idle = at(run([]), 120);
    expect(idle.every((u) => u.x < 1000)).toBe(true);
    // Sent to guard the home at x 1100, east of their base, they go there and hold.
    const b = run([{ step: 0, side: 1, kind: 'guard', target: post }]);
    const there = at(b, 120);
    for (const u of there) {
      expect(Math.hypot(u.x - 1100, u.z - 500)).toBeLessThan(5);
      expect(u.state).toBe(1);
    }
    expect(
      inside(b)
        .units.filter((u) => u.side === 1)
        .every((u) => u.posted && u.guard === post),
    ).toBe(true);
    // Freed, they go back to the battle's own judgement and head for the attackers again.
    const freed = run([
      { step: 0, side: 1, kind: 'guard', target: post },
      { step: 100, side: 1, kind: 'free', units: [5001] },
    ]);
    const [a, c] = at(freed, 250);
    expect(a.x).toBeLessThan(900);
    expect(Math.hypot(c.x - 1100, c.z - 500)).toBeLessThan(5);
  });

  it('guard ends when the guarded structure falls', () => {
    // The depot is the defenders' base and the attackers' objective: guarded, then knocked down.
    const i = make(crew('tank', 6, 1), [{ step: 0, side: 1, kind: 'guard', target: 0 }], {
      defenders: crew('tank', 2, 5001, 0, { x: 900, z: 540 }),
    });
    expect(i.layout.structs[S.id]).toBe(10);
    const b = new Battle(i);
    let guarding = 0;
    while (!b.outcome && b.state[0] !== 2) {
      b.stepOnce();
      guarding += inside(b).units.filter((u) => u.side === 1 && u.guard === 0).length;
    }
    expect(guarding).toBeGreaterThan(0);
    expect(b.state[0]).toBe(2);
    // At once, whether they are firing or not.
    expect(
      inside(b)
        .units.filter((u) => u.side === 1)
        .every((u) => u.guard === -1 && !u.posted),
    ).toBe(true);
  });

  it('hold: the given units stop where they are and only fire; free sends them on again', () => {
    // An armoury 100 m up the road, then the depot far up it: held at the way in, three tanks fell the
    // armoury from where they stand and go no further; freed, they carry on to the depot.
    const near: StructSpec[] = [
      { id: 10, tags: TAG.civic | TAG.military | TAG.base, x: 900, z: 540, r: 20, hp: 900 },
      { id: 12, tags: TAG.civic | TAG.military, x: 100, z: 540, r: 20, hp: 600 },
    ];
    const force = crew('tank', 3, 1);
    const free = play(make(force, [], { structs: near }));
    expect(free.b.result().destroyed).toEqual([12, 10]);
    const held = play(
      make(force, [{ step: 0, side: 0, kind: 'hold' }], { structs: near, stance: 'cautious' }),
    );
    const r = held.b.result();
    expect(r.destroyed).toContain(12);
    expect(r.destroyed).not.toContain(10);
    for (const f of held.frames)
      for (const u of f.units.filter((x) => x.side === 0)) expect(u.x).toBeLessThan(10);
    // Some units only: the held one stays at the way in while its mates drive off.
    const some = new Battle(make(force, [{ step: 0, side: 0, kind: 'hold', units: [1] }], { structs: near }));
    for (let k = 0; k < 120; k++) some.stepOnce();
    expect(where(some, 1)!.x).toBeLessThan(10);
    expect(where(some, 1)!.state).toBe(1);
    expect(where(some, 3)!.x).toBeGreaterThan(200);
    // Freed, it goes on and the depot falls.
    const freed = play(
      make(
        force,
        [
          { step: 0, side: 0, kind: 'hold' },
          { step: 150, side: 0, kind: 'free' },
        ],
        { structs: near },
      ),
    );
    expect(freed.b.result().destroyed).toContain(10);
    expect(freed.frames.find((f) => f.step === 100)!.units.every((u) => u.x < 10)).toBe(true);
  });

  it('withdraw by units: those attackers pull out and the rest go on fighting', () => {
    const force = crew('tank', 6, 1);
    const part = play(make(force, [{ step: 40, side: 0, kind: 'withdraw', units: [1, 2] }]));
    const left = part.events
      .filter((x) => x.e.k === 'left')
      .map((x) => [(x.e as { unit: number }).unit, x.step]);
    const first = part.events.find((x) => x.e.k === 'destroyed' || x.e.k === 'end')!.step;
    // The two went out well before anything else happened; the others left only as the battle ended.
    expect(
      left
        .slice(0, 2)
        .map((l) => l[0])
        .sort(),
    ).toEqual([1, 2]);
    expect(left.slice(0, 2).every((l) => l[1]! < first)).toBe(true);
    const mid = part.frames.find((f) => f.step >= 120)!;
    const ids = mid.units.filter((u) => u.side === 0).map((u) => u.id);
    expect(ids).not.toContain(1);
    expect(ids).not.toContain(2);
    expect(ids).toEqual(expect.arrayContaining([3, 4, 5, 6]));
    expect(mid.sides[0]!.alive).toBe(4);
    expect(part.b.result().objectives.down).toBeGreaterThan(0);
    // The whole side's withdrawal (no units) is M35's: everyone goes.
    const all = play(make(force, [{ step: 40, side: 0, kind: 'withdraw' }]));
    expect(all.events.filter((x) => x.e.k === 'left')).toHaveLength(6);
    expect(all.b.result().outcome).toBe('withdrew');
    // Naming every unit is the same pull-out as naming none.
    const named = play(make(force, [{ step: 40, side: 0, kind: 'withdraw', units: [1, 2, 3, 4, 5, 6] }]));
    expect(named.b.result().outcome).toBe('withdrew');
    expect(named.events.filter((x) => x.e.k === 'left')).toHaveLength(6);
  });

  it('units sent home are no loss: the rest of a cautious force go on to win', () => {
    // Four tanks against an undefended depot. Two sent home at step 5 are half the force gone, but
    // not lost: a cautious force (it pulls out at 30 % lost) carries on and takes the depot.
    const depot = TOWN.filter((x) => x.id === 10);
    const i = make(crew('tank', 4, 1), [{ step: 5, side: 0, kind: 'withdraw', units: [1, 2] }], {
      structs: depot,
      stance: 'cautious',
    });
    const r = Battle.run(i).result();
    expect(r.outcome).toBe('raided');
    expect(r.destroyed).toEqual([10]);
    expect(r.units.filter((u) => u.out)).toHaveLength(0);
  });

  it('an order whose units are gone, or whose target has fallen, does nothing and breaks nothing', () => {
    const force = [...crew('tank', 4, 1), ...crew('artillery', 2, 21)];
    const defenders = crew('tank', 2, 5001, 0, { x: 900, z: 540 });
    const over = { structs: [...TOWN, ...bunkers], defenders };
    // The reference: a battle already in version 4 whose one order names nobody.
    const noop: BattleOrder = { step: 0, side: 0, kind: 'hold', units: [424242] };
    const ref = play(make(force, [noop], over));
    const r = ref.b.result();
    const dead = r.units.find((u) => u.side === 0 && u.out)!;
    const fallen = r.destroyed[0]!;
    const fallenIdx = indexOf(make(force, [], over), fallen);
    // After that unit was knocked out and that structure fell (as the battle's own events say).
    const when = (pick: (e: BattleEvent) => boolean) => ref.events.find((x) => pick(x.e))!.step;
    const lateStep =
      Math.max(
        when((e) => e.k === 'destroyed' && e.s === fallen),
        when((e) => e.k === 'out' && e.side === 0 && e.unit === dead.id),
      ) + 6;
    expect(lateStep).toBeLessThan(r.steps);
    const gone: BattleOrder[] = [
      { step: lateStep, side: 0, kind: 'focus', target: fallenIdx },
      { step: lateStep, side: 1, kind: 'guard', target: fallenIdx },
      { step: lateStep, side: 0, kind: 'hold', units: [dead.id] },
      { step: lateStep, side: 0, kind: 'free', units: [dead.id] },
      { step: lateStep + 1, side: 0, kind: 'withdraw', units: [dead.id, 777_777] },
      { step: lateStep + 1, side: 1, kind: 'focus', target: dead.id },
      { step: lateStep + 1, side: 1, kind: 'hold', units: [31337] },
      { step: lateStep + 2, side: 1, kind: 'focus', target: 424242 },
      // Nonsense the check would turn away, which must not throw if it gets here anyway.
      { step: lateStep + 2, side: 0, kind: 'focus', target: 99_999 },
      { step: lateStep + 2, side: 0, kind: 'focus', target: -3 },
      { step: lateStep + 3, side: 0, kind: 'focus', target: Number.NaN },
      { step: lateStep + 3, side: 1, kind: 'guard', target: 1.5 },
      { step: lateStep + 3, side: 0, kind: 'hold', units: 'nope' as unknown as number[] },
      { step: lateStep + 4, side: 2 as 0, kind: 'hold' },
      { step: lateStep + 4, side: 0, kind: 'dance' as 'hold', units: [1] },
    ];
    const spoilt = make(force, [noop, ...gone], over);
    const b = new Battle(spoilt);
    expect(() => b.runToEnd()).not.toThrow();
    expect(b.hash()).toBe(ref.b.hash());
    expect(b.result()).toEqual(r);
  });

  it('orders from the defenders can’t command the attackers, nor the other way about', () => {
    const force = crew('tank', 2, 1);
    const defenders = crew('tank', 2, 5001, 0, { x: 900, z: 540 });
    // Side 1 naming attackers' ids, side 0 naming defenders': nothing is held.
    const i = make(
      force,
      [
        { step: 0, side: 1, kind: 'hold', units: [1, 2] },
        { step: 0, side: 0, kind: 'hold', units: [5001, 5002] },
      ],
      { defenders },
    );
    const b = new Battle(i);
    for (let k = 0; k < 150; k++) b.stepOnce();
    expect(where(b, 1)!.x).toBeGreaterThan(300);
    expect(where(b, 5001, 1)!.x).toBeLessThan(900);
  });

  it('a handover is a free with no units: the whole side, helpers and guns too, back to the battle’s own judgement', () => {
    // The room stamps `{kind: 'free', side}` when a combatant goes silent: every order that side gave
    // is undone, whatever it named.
    const town = [...TOWN, { id: 30, tags: TAG.home, x: 1100, z: 470, r: 8, hp: 150 } as StructSpec];
    const post = indexOf(make([], [], { structs: town }), 30);
    const mate = ally({ side: 1, arrive: 0, units: crew('tank', 2, 7001) });
    const given: BattleOrder[] = [
      { step: 0, side: 1, kind: 'guard', target: post, units: [5001] },
      { step: 0, side: 1, kind: 'hold', units: [5002, 7001] },
      { step: 0, side: 1, kind: 'focus', target: 2 },
    ];
    const run = (orders: BattleOrder[]) => {
      const b = new Battle(
        make(crew('tank', 3, 1), orders, {
          structs: town,
          defenders: crew('tank', 2, 5001, 0, { x: 900, z: 540 }),
          helpers: [mate],
        }),
      );
      for (let k = 0; k < 80; k++) b.stepOnce();
      return b;
    };
    const ordered = run(given);
    expect(inside(ordered).gunFocus).not.toBe(0x7fffffff);
    expect(inside(ordered).units.some((u) => u.side === 1 && (u.held || u.posted))).toBe(true);
    const handed = run([...given, { step: 80, side: 1, kind: 'free' }]);
    handed.stepOnce();
    expect(inside(handed).gunFocus).toBe(0x7fffffff);
    // (Those still in the fight: a unit that has fallen is no longer given orders.)
    const standing = inside(handed).units.filter(
      (x) => x.side === 1 && (where(handed, x.id, 1)?.state ?? 2) !== 2,
    );
    expect(standing.length).toBeGreaterThan(0);
    for (const u of standing)
      expect([u.held, u.posted, u.guard, u.focus], `defender ${u.id}`).toEqual([
        false,
        false,
        -1,
        0x7fffffff,
      ]);
    // The attackers' side: held at the way in, then handed over with a helper among them: all move.
    const holdAll = (extra: BattleOrder[]) => {
      const b = new Battle(
        make(crew('tank', 2, 1), [{ step: 0, side: 0, kind: 'hold' }, ...extra], {
          helpers: [ally({ arrive: 0, units: crew('tank', 2, 7001) })],
        }),
      );
      for (let k = 0; k < 100; k++) b.stepOnce();
      return b;
    };
    const stuck = holdAll([]);
    for (const id of [1, 2, 7001, 7002]) expect(where(stuck, id)!.x).toBeLessThan(10);
    const freed = holdAll([{ step: 40, side: 0, kind: 'free' }]);
    for (const id of [1, 2, 7001, 7002]) expect(where(freed, id)!.x, `attacker ${id}`).toBeGreaterThan(100);
  });

  it('orders apply at their step, in input order', () => {
    // Hold then free in one step: freed. Free then hold: held.
    const at = (kinds: ('hold' | 'free')[]) => {
      const b = new Battle(
        make(
          crew('tank', 1, 1),
          kinds.map((kind) => ({ step: 5, side: 0, kind })),
        ),
      );
      for (let k = 0; k < 60; k++) b.stepOnce();
      return where(b, 1)!.x;
    };
    expect(at(['hold', 'free'])).toBeGreaterThan(100);
    expect(at(['free', 'hold'])).toBeLessThan(40);
  });
});

describe('helpers', () => {
  const defenders = () => crew('tank', 2, 5001, 0, { x: 900, z: 540 });
  it('an attacking helper comes in at its step, by the way in, and its losses are reported by owner', () => {
    const i = make(crew('tank', 3, 1), [], {
      structs: [...TOWN, ...bunkers],
      defenders: defenders(),
      helpers: [ally()],
    });
    expect(i.v).toBe(BATTLE_V4);
    expect(checkBattleInput(i)).toBeNull();
    const { b, frames } = play(i);
    const mine = (f: BattleFrame) => f.units.filter((u) => u.id >= 7001);
    // Not on the map before its step (two steps a frame), on it from the step after, at the way in.
    const before = frames.filter((f) => f.step <= 120);
    expect(before.every((f) => mine(f).length === 0)).toBe(true);
    const first = frames.find((f) => mine(f).length)!;
    expect(first.step).toBeGreaterThan(120);
    expect(first.step).toBeLessThanOrEqual(124);
    const u = mine(first)[0]!;
    expect(u.owner).toBe(7);
    expect(u.side).toBe(0);
    expect(Math.hypot(u.x - 0, u.z - 500)).toBeLessThan(10);
    // The frame tells the helpers' count; the side's own count takes them in.
    expect(first.helpers).toEqual([
      { owner: 7, name: 'Allies', color: 0x33aa33, side: 0, arrive: 120, alive: 3, total: 3 },
    ]);
    expect(frames[0]!.sides[0]).toMatchObject({ alive: 6, total: 6 });
    // The result: every unit with its owner; losses can be counted by owner.
    const r = b.result();
    const owners = new Map<number, number>();
    for (const x of r.units) owners.set(x.owner!, (owners.get(x.owner!) ?? 0) + 1);
    expect([...owners]).toEqual([
      [OWNER_ATTACKER, 3],
      [OWNER_DEFENDER, 2],
      [7, 3],
    ]);
    const lostBy = (o: number) => r.units.filter((x) => x.owner === o && x.out).length;
    expect(lostBy(OWNER_ATTACKER) + lostBy(7)).toBe(r.units.filter((x) => x.side === 0 && x.out).length);
    // The force's own city hears of its own units only.
    const away = awayResult(i, b);
    expect(away.units.map((x) => x.id)).toEqual([1, 2, 3]);
  });

  it('a helper’s units fight on the helper’s side and the attackers’ strength counts them', () => {
    const lone = make(crew('infantry', 1, 1), [], {
      structs: [...TOWN, ...bunkers],
      defenders: defenders(),
      helpers: [ally({ arrive: 400, units: crew('tank', 4, 7001) })],
    });
    // The squad that came first is beaten in the first minute or two, long before the helpers set out:
    // the battle is not over, for they are the attacking side's too.
    const b = new Battle(lone);
    while (!b.outcome && b.step < 380) b.stepOnce();
    const r = b.result();
    expect(r.units.find((u) => u.id === 1)!.out).toBe(true);
    expect(b.outcome).toBeNull();
    expect(where(b, 7001)).toBeNull();
    while (!b.outcome && b.step < 410) b.stepOnce();
    expect(where(b, 7001)).not.toBeNull();
    expect(b.frame().helpers![0]).toMatchObject({ alive: 4, total: 4, arrive: 400 });
  });

  it('the army pulls out when it as a whole has lost enough, the helper’s units counted with the force’s', () => {
    // One tank and three of an ally's, against four heavy guns: lost, they withdraw with a survivor.
    // (Were the ally's tanks counted in the strength still standing but not in the strength that
    // went in, the army would never reckon itself beaten, and fight on until the last was dead.)
    const guns: StructSpec[] = [0, 1, 2, 3].map((k) => ({
      id: 30 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 400 + k * 20,
      z: 520,
      r: 6,
      hp: 900,
      gun: 4,
      range: 150,
      against: ['land', 'air'],
    }));
    const i = make(crew('tank', 1, 1), [], {
      structs: [...TOWN, ...guns],
      stance: 'cautious',
      helpers: [ally({ arrive: 0, units: crew('tank', 3, 7001) })],
    });
    const { b } = play(i);
    const r = b.result();
    expect(r.outcome).toBe('withdrew');
    expect(r.units.filter((u) => u.side === 0 && !u.out).length).toBeGreaterThan(0);
    expect(r.units.filter((u) => u.side === 0 && u.out).length).toBeGreaterThan(1);
  });

  it('a helper that arrives after the first objective has fallen goes for one still standing', () => {
    // A weak armoury by the way in (the first objective, down in a minute) and the depot up the road.
    const two: StructSpec[] = [
      { id: 10, tags: TAG.civic | TAG.military | TAG.base, x: 900, z: 540, r: 20, hp: 900 },
      { id: 12, tags: TAG.civic | TAG.military, x: 200, z: 540, r: 10, hp: 60 },
    ];
    const i = make(crew('tank', 3, 1), [], {
      structs: two,
      helpers: [ally({ arrive: 150, units: crew('tank', 2, 7001) })],
    });
    const armoury = indexOf(i, 12);
    const depot = indexOf(i, 10);
    const b = new Battle(i);
    while (b.step < 151) b.stepOnce();
    expect(b.state[armoury]).toBe(2);
    expect(b.state[depot]).toBe(0);
    expect(inside(b).units.find((u) => u.id === 1)!.objective).toBe(depot);
    expect(inside(b).units.find((u) => u.id === 7001)!.objective).toBe(depot);
    expect(where(b, 7001)).not.toBeNull();
  });

  it('a defending helper comes in at its step, as a defender, and fights the attackers', () => {
    const force = crew('tank', 3, 1);
    const make4 = (helpers: BattleHelper[]) =>
      make(force, [], { structs: [...TOWN, ...bunkers], defenders: defenders(), helpers });
    const mate = ally({ side: 1, arrive: 90, units: crew('tank', 3, 7001) });
    const i = make4([mate]);
    expect(checkBattleInput(i)).toBeNull();
    const { b, frames } = play(i);
    expect(frames.filter((f) => f.step <= 90).every((f) => !f.units.some((u) => u.id >= 7001))).toBe(true);
    const first = frames.find((f) => f.units.some((u) => u.id >= 7001))!;
    expect(first.step).toBeLessThanOrEqual(100);
    const u = first.units.find((x) => x.id >= 7001)!;
    expect(u.side).toBe(1);
    expect(u.owner).toBe(7);
    expect(first.helpers![0]).toMatchObject({ side: 1, owner: 7 });
    // The attackers' side is not made bigger by them, and the defence is.
    expect(frames[0]!.sides[0]!.total).toBe(3);
    expect(frames[0]!.sides[1]!.total).toBe(5);
    // With the help the raiders do worse than without it.
    const alone = Battle.run(make4([]));
    const down = (x: Battle) => x.result().units.filter((v) => v.side === 0 && v.out).length;
    expect(down(b)).toBeGreaterThanOrEqual(down(alone));
    expect(b.result().units.filter((x) => x.owner === 7).length).toBe(3);
    // Its units' ids are its own: the city's own defenders (no helper's) report as the defender's.
    expect(
      b
        .result()
        .units.filter((x) => x.owner === OWNER_DEFENDER)
        .map((x) => x.id),
    ).toEqual([5001, 5002]);
  });

  it('a helper comes by its own route, and brings its own research', () => {
    const air = ally({ route: 'air', arrive: 30, units: crew('helicopter', 2, 7001) });
    const b = new Battle(make(crew('tank', 2, 1), [], { defenders: defenders(), helpers: [air] }));
    for (let k = 0; k < 40; k++) b.stepOnce();
    const h = b.frame().units.filter((u) => u.id >= 7001);
    expect(h).toHaveLength(2);
    expect(h.every((u) => u.y > 0 && Math.abs(u.z - 400) < 80)).toBe(true);
    // Its research, not the force's: a helper's modifiers go to its own units only.
    const strong = ally({ arrive: 0, units: crew('tank', 1, 7001), mods: { land: { hp: 2 } } });
    const plain = make(crew('tank', 1, 1), [], { helpers: [strong] });
    plain.attacker.mods = { land: { hp: 1.25 } };
    const hp = (id: number) => {
      const x = new Battle(plain);
      return (x as unknown as { units: { id: number; max: number }[] }).units.find((u) => u.id === id)!.max;
    };
    expect(hp(7001)).toBe((2 * hp(1)) / 1.25);
  });

  it('pending helpers go with the attackers’ withdrawal; one withdrawn by id never comes', () => {
    const force = crew('tank', 3, 1);
    const helpers = [ally({ arrive: 300, units: crew('tank', 2, 7001) })];
    const over = { structs: [...TOWN, ...bunkers], defenders: defenders(), helpers };
    const easy = { structs: TOWN, helpers };
    const all = play(make(force, [{ step: 100, side: 0, kind: 'withdraw' }], over));
    const gone = (r: typeof all) =>
      r.events.filter((x) => x.e.k === 'left').map((x) => (x.e as { unit: number }).unit);
    expect(gone(all)).toEqual(expect.arrayContaining([7001, 7002]));
    expect(all.frames.every((f) => !f.units.some((u) => u.id >= 7001))).toBe(true);
    expect(all.b.result().outcome).toBe('withdrew');
    // (The force pulls out when it has lost enough: here nothing stands in its way, so it fights on.)
    const one = play(make(force, [{ step: 100, side: 0, kind: 'withdraw', units: [7001] }], easy));
    expect(one.events.find((x) => x.e.k === 'left' && (x.e as { unit: number }).unit === 7001)).toBeTruthy();
    expect(one.frames.some((f) => f.units.some((u) => u.id === 7002))).toBe(true);
    expect(one.frames.some((f) => f.units.some((u) => u.id === 7001))).toBe(false);
  });
});

describe('helpers added while the battle runs (M39 step 6)', () => {
  const defenders = () => crew('tank', 2, 5001, 0, { x: 900, z: 540 });
  const config = () => ({ structs: [...TOWN, ...bunkers], defenders: defenders() });
  /** The state to compare two runs by: the hash, and the step the battle ended at. */
  const hashes = (b: Battle, to: number): string[] => {
    const out: string[] = [];
    while (!b.outcome && b.step < to) {
      b.stepOnce();
      if (b.step % 25 === 0) out.push(`${b.step}:${b.hash()}`);
    }
    return out;
  };

  it('a helper appended to the input while it runs joins as one given up front does', () => {
    const force = crew('tank', 5, 1);
    for (const side of [0, 1] as const) {
      const help = ally({ side, arrive: 300, units: crew('tank', 3, 7001) });
      // Given up front, with the step it was added at (as the room stamps it) ...
      const front = new Battle(make(force, [], { ...config(), helpers: [{ ...help, at: 100 }] }));
      // ... and added at that step to a battle that was running without it.
      const late = new Battle(stampLive(make(force, [], config())));
      const lateHashes = hashes(late, 60);
      late.input.helpers = [{ ...help, at: 100 }];
      lateHashes.push(...hashes(late, 100));
      expect(late.frame().helpers?.[0]).toMatchObject({ owner: 7, alive: 3, total: 3 });
      // Nothing of it in the battle before its step.
      expect((late as unknown as Inside).units.some((u) => u.id >= 7001)).toBe(false);
      const frontHashes = hashes(front, 100);
      const sameBefore = frontHashes.filter((h) => Number(h.split(':')[0]) <= 100);
      // (Before its step the two differ: one has the helper waiting from the start; the other has nothing
      // of it. From the step it was added at they are the same battle.)
      expect(lateHashes.length).toBeGreaterThan(0);
      expect(sameBefore.length).toBeGreaterThan(0);
      lateHashes.push(...hashes(late, 4_000));
      frontHashes.push(...hashes(front, 4_000));
      const from = (list: string[]) => list.filter((h) => Number(h.split(':')[0]) > 100);
      expect(from(lateHashes).length).toBeGreaterThan(5);
      expect(from(lateHashes)).toEqual(from(frontHashes));
      expect(late.hash()).toBe(front.hash());
      expect(late.step).toBe(front.step);
      expect(late.result()).toEqual(front.result());
      expect(late.result().units.filter((u) => u.owner === 7)).toHaveLength(3);
    }
  });

  it('it comes in at its arrival step, whenever the page took the entry in', () => {
    // A page that took the entry in a step after another still has the helper made at the same step.
    const help = { ...ally({ arrive: 200, units: crew('tank', 2, 7001) }), at: 40 };
    const a = new Battle(stampLive(make(crew('tank', 4, 1), [], config())));
    const b = new Battle(stampLive(make(crew('tank', 4, 1), [], config())));
    while (a.step < 10) a.stepOnce();
    a.input.helpers = [structuredClone(help)];
    while (b.step < 39) b.stepOnce();
    b.input.helpers = [structuredClone(help)];
    while (!a.outcome && a.step < 260) a.stepOnce();
    while (!b.outcome && b.step < 260) b.stepOnce();
    expect(a.hash()).toBe(b.hash());
    const here = (x: Battle) => x.frame().units.filter((u) => u.id >= 7001);
    expect(here(a)).toEqual(here(b));
    expect(here(a).length).toBe(2);
    // Not on the map before it arrives, on it after.
    const c = new Battle(make(crew('tank', 4, 1), [], { ...config(), helpers: [structuredClone(help)] }));
    while (c.step < 195) c.stepOnce();
    expect(c.frame().units.some((u) => u.id >= 7001)).toBe(false);
    while (c.step < 210) c.stepOnce();
    expect(c.frame().units.some((u) => u.id >= 7001)).toBe(true);
  });

  it('a helper whose step the battle never reaches is no part of it', () => {
    const help = { ...ally({ arrive: 900, units: crew('tank', 2, 7001) }), at: 600 };
    const easy = stampLive(make(crew('tank', 4, 1), [], { structs: TOWN }));
    const plain = Battle.run(easy);
    expect(plain.step).toBeLessThan(600);
    const b = new Battle(structuredClone(easy));
    b.input.helpers = [help];
    b.runToEnd();
    expect(b.result().units.some((u) => u.owner === 7)).toBe(false);
    expect(b.hash()).toBe(plain.hash());
  });

  it('a helper added after the army pulled out turns straight back', () => {
    const guns: StructSpec[] = [0, 1, 2, 3].map((k) => ({
      id: 30 + k,
      tags: TAG.civic | TAG.military | TAG.defence,
      x: 400 + k * 20,
      z: 520,
      r: 6,
      hp: 900,
      gun: 4,
      range: 150,
      against: ['land', 'air'],
    }));
    const i = stampLive(
      make(crew('tank', 2, 1), [{ step: 40, side: 0, kind: 'withdraw' }], { structs: [...TOWN, ...guns] }),
    );
    const b = new Battle(i);
    while (b.step < 60) b.stepOnce();
    b.input.helpers = [{ ...ally({ arrive: 200, units: crew('tank', 2, 7001) }), at: 60 }];
    const events: BattleEvent[] = [];
    while (!b.outcome && b.step < 400) {
      b.stepOnce();
      events.push(...b.drain());
    }
    // They left at once, never fought: not lost, not on the map.
    expect(events.filter((e) => e.k === 'left' && e.unit >= 7001)).toHaveLength(2);
    expect(
      b
        .result()
        .units.filter((u) => u.owner === 7)
        .every((u) => !u.out),
    ).toBe(true);
    expect(b.frame().units.some((u) => u.id >= 7001)).toBe(false);
  });

  it('the checker wants an arrival no earlier than the step it was added at', () => {
    const base = () => make(crew('tank', 3, 1), [], { helpers: [{ ...ally({ arrive: 200 }), at: 80 }] });
    expect(checkBattleInput(base())).toBeNull();
    const equal = base();
    equal.helpers![0]!.at = 200;
    expect(checkBattleInput(equal)).toBeNull();
    const bad: [string, (b: BattleInput) => void][] = [
      ['arriving before it was added', (b) => (b.helpers![0]!.at = 201)],
      ['added at a half step', (b) => (b.helpers![0]!.at = 80.5)],
      ['added before the start', (b) => (b.helpers![0]!.at = -1)],
      ['added after the battle', (b) => (b.helpers![0]!.at = BATTLE.maxSteps + 1)],
      ['an added step that isn’t a number', (b) => (b.helpers![0]!.at = 'soon' as unknown as number)],
    ];
    for (const [what, spoil] of bad) {
      const b = base();
      spoil(b);
      expect(checkBattleInput(b), what).not.toBeNull();
    }
    // At most three helpers, as ever, whenever they were added.
    const four = base();
    for (const owner of [8, 9, 10])
      four.helpers!.push({ ...ally({ arrive: 300, units: crew('tank', 1, owner * 1000) }), owner, at: 90 });
    expect(checkBattleInput(four)).not.toBeNull();
  });
});

describe('helpers in the room’s log (M39 step 6)', () => {
  const stamped = (seq: number, step: number, over: Partial<StampedOrder> = {}): StampedOrder => ({
    seq,
    step,
    side: 0,
    kind: 'help',
    helper: {
      owner: 7,
      name: 'Allies',
      color: 0x33aa33,
      side: 0,
      arrive: step + 480,
      units: crew('tank', 3, 70_000).map(({ id, kind, hp }) => ({ id, kind, hp })),
    },
    ...over,
  });
  const live = () => stampLive(make(crew('tank', 3, 1), [], { structs: [...TOWN, ...bunkers] }));

  it('an entry in the log becomes a helper with the step it was stamped at, once', () => {
    const i = live();
    const seen = appendOrders(i, 0, [stamped(1, 64)]);
    expect(seen).toBe(1);
    expect(i.helpers).toHaveLength(1);
    expect(i.helpers![0]).toMatchObject({ owner: 7, side: 0, at: 64, arrive: 544, name: 'Allies' });
    expect(i.helpers![0]!.units[0]).toEqual({ id: 70_000, kind: 'tank', hp: 1, x: 0, z: 0, base: -1 });
    expect(checkBattleInput(i)).toBeNull();
    // Told the whole log again, it takes nothing twice.
    expect(appendOrders(i, seen, [stamped(1, 64)])).toBe(1);
    expect(i.helpers).toHaveLength(1);
  });

  it('what the battle could not take is left out the same way on every page', () => {
    const i = live();
    const bad: StampedOrder[] = [
      // Arriving before it was stamped; on a side that isn't the entry's; an owner already there.
      stamped(1, 64, { helper: { ...stamped(1, 64).helper!, arrive: 10 } }),
      stamped(2, 64, { helper: { ...stamped(2, 64).helper!, side: 1 } }),
      stamped(3, 64, { helper: { ...stamped(3, 64).helper!, owner: 0 } }),
      // A superweapon; a unit that isn't one; with an id of the force's own.
      stamped(4, 64, {
        helper: { ...stamped(4, 64).helper!, units: [{ id: 70_000, kind: 'skyfortress', hp: 1 }] },
      }),
      stamped(5, 64, {
        helper: { ...stamped(5, 64).helper!, units: [{ id: 70_000, kind: 'dragon' as never, hp: 1 }] },
      }),
      stamped(6, 64, { helper: { ...stamped(6, 64).helper!, units: [{ id: 1, kind: 'tank', hp: 1 }] } }),
      stamped(7, 64, { helper: undefined }),
    ];
    expect(appendOrders(i, 0, bad)).toBe(7);
    expect(i.helpers ?? []).toHaveLength(0);
    // A good one after them still goes in; a second from the same owner and a fourth don't.
    appendOrders(i, 7, [stamped(8, 64)]);
    appendOrders(i, 8, [stamped(9, 70)]);
    expect(i.helpers).toHaveLength(1);
    for (const owner of [8, 9, 10]) {
      const h = stamped(10 + owner, 80);
      h.helper!.owner = owner;
      h.helper!.units = [{ id: owner * 10_000, kind: 'tank', hp: 1 }];
      appendOrders(i, 9 + owner - 1, [h]);
    }
    expect(i.helpers!.map((h) => h.owner)).toEqual([7, 8, 9]);
    expect(checkBattleInput(i)).toBeNull();
  });

  it('a record with the log in it plays as the live battle did', () => {
    const base = live();
    const entry = stamped(2, 64);
    const hold: StampedOrder = { seq: 1, step: 32, side: 0, kind: 'hold' };
    const free: StampedOrder = { seq: 3, step: 96, side: 0, kind: 'free' };
    // The live run: the entry and the orders fed to it as they were stamped.
    const run = new Battle(structuredClone(base));
    let seen = 0;
    const feed = (list: StampedOrder[]) => (seen = appendOrders(run.input, seen, list));
    while (run.step < 32) run.stepOnce();
    feed([hold]);
    while (run.step < 64) run.stepOnce();
    feed([entry]);
    while (run.step < 96) run.stepOnce();
    feed([free]);
    run.runToEnd();
    expect(run.result().units.filter((u) => u.owner === 7)).toHaveLength(3);
    // The record is the input with the whole log in it, run from the start.
    const record = recordInput(base, [hold, entry, free]);
    expect(record.helpers).toHaveLength(1);
    expect(checkBattleInput(record)).toBeNull();
    const again = Battle.run(record);
    expect(again.hash()).toBe(run.hash());
    expect(again.result()).toEqual(run.result());
  });
});

describe('version 4 is deterministic', () => {
  /** A busy battle: every kind of order on both sides, a helper on each. */
  function busy(): BattleInput {
    const force = [...crew('tank', 4, 1), ...crew('infantry', 3, 11), ...crew('artillery', 2, 21)];
    const structs = [
      ...TOWN,
      ...bunkers,
      { id: 12, tags: TAG.civic | TAG.military, x: 500, z: 900, r: 20, hp: 900 },
      { id: 30 + 5, tags: TAG.home, x: 1100, z: 470, r: 8, hp: 150 },
    ];
    const i = make(force, [], {
      structs,
      defenders: [
        ...crew('tank', 3, 5001, 0, { x: 900, z: 540 }),
        ...crew('infantry', 2, 5101, 0, { x: 880, z: 520 }),
      ],
      helpers: [
        {
          owner: 3,
          name: 'Allies',
          color: 0x33aa33,
          side: 0,
          arrive: 150,
          units: crew('tank', 2, 3001),
        },
        {
          owner: 4,
          name: 'Friends',
          color: 0x3333aa,
          side: 1,
          arrive: 200,
          units: crew('helicopter', 2, 4001),
          route: 'air',
        },
      ],
    });
    const at = (id: number) => indexOf(i, id);
    i.orders = [
      { step: 0, side: 0, kind: 'focus', target: at(12), units: [1, 2] },
      { step: 20, side: 1, kind: 'guard', target: at(35), units: [5001] },
      { step: 40, side: 0, kind: 'hold', units: [21, 22] },
      { step: 40, side: 1, kind: 'focus', target: 3 },
      { step: 90, side: 1, kind: 'free', units: [5001] },
      { step: 120, side: 0, kind: 'free' },
      { step: 160, side: 0, kind: 'focus', target: at(10) },
      { step: 260, side: 0, kind: 'withdraw', units: [11, 12, 13] },
      { step: 400, side: 1, kind: 'hold' },
    ];
    return stampBattle(i);
  }

  it('the same input and orders give the same battle, and the same after a JSON round trip', () => {
    const i = busy();
    expect(i.v).toBe(BATTLE_V4);
    expect(checkBattleInput(i)).toBeNull();
    const a = Battle.run(structuredClone(i));
    const b = Battle.run(structuredClone(i));
    const c = Battle.run(JSON.parse(JSON.stringify(i)) as BattleInput);
    expect(a.result()).toEqual(b.result());
    expect(c.result()).toEqual(a.result());
    expect(c.hash()).toBe(a.hash());
    // And the orders did something: the unordered battle isn't this one.
    const plain = structuredClone(i);
    plain.orders = [];
    expect(Battle.run(plain).hash()).not.toBe(a.hash());
    // It travels as a battle does (the room sends it packed).
    expect(decodeBattle(encodeBattle(i))).toEqual(i);
  });

  it('run straight, ticked, or re-run from any step after a load, it is one battle', () => {
    const i = busy();
    const straight = Battle.run(structuredClone(i)).result();
    const ticked = new Battle(structuredClone(i));
    const hashes = new Map<number, string>();
    while (!ticked.outcome) {
      ticked.tick();
      hashes.set(ticked.step, ticked.hash());
    }
    expect(ticked.result()).toEqual(straight);
    let checked = 0;
    for (const [step, hash] of hashes) {
      if (step % 24 !== 0) continue;
      const again = new Battle(structuredClone(i));
      while (again.step < step && !again.outcome) again.stepOnce();
      again.drain();
      expect(again.hash(), `re-run to ${step}`).toBe(hash);
      while (!again.outcome) again.tick();
      expect(again.result(), `played on from ${step}`).toEqual(straight);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
  });

  it('orders that arrive while it runs (a live battle) make the same battle as orders given up front', () => {
    const i = busy();
    const whole = Battle.run(structuredClone(i));
    const live = structuredClone(i);
    const later = live.orders;
    live.orders = [];
    const b = new Battle(live);
    // The room stamps an order two seconds ahead of where the slowest page is: it reaches the
    // battle before its step, at most a tick early.
    let given = 0;
    while (!b.outcome) {
      while (given < later.length && later[given]!.step <= b.step + 2) live.orders.push(later[given++]!);
      b.tick();
    }
    // Every order that came before the battle's end reached it (the last one's step is past it).
    expect(given).toBe(later.filter((o) => o.step <= b.step + 2).length);
    expect(given).toBeGreaterThan(5);
    expect(b.result()).toEqual(whole.result());
    expect(b.hash()).toBe(whole.hash());
  });
});

describe('reading a version 4 battle from outside', () => {
  const rich = () => {
    const i = make([...crew('tank', 4, 1), ...crew('infantry', 2, 11)], [], {
      structs: [...TOWN, ...bunkers],
      defenders: crew('tank', 2, 5001, 0, { x: 900, z: 540 }),
      helpers: [
        { owner: 1, name: 'North', color: 1, side: 0, arrive: 0, units: crew('tank', 2, 7001) },
        {
          owner: 2,
          name: 'South',
          color: 2,
          side: 1,
          arrive: BATTLE.maxSteps,
          units: crew('infantry', 1, 8001),
          route: 'highway',
        },
        {
          owner: 255,
          name: 'East',
          color: 3,
          side: 0,
          arrive: 60,
          units: crew('helicopter', 24, 9001),
          route: 'air',
        },
      ],
    });
    i.orders = [
      { step: 0, side: 0, kind: 'focus', target: 0, units: [1, 2] },
      { step: 0, side: 0, kind: 'focus', target: 1 },
      { step: 0, side: 1, kind: 'focus', target: 11 },
      { step: 10, side: 1, kind: 'guard', target: 3, units: [5001] },
      { step: 10, side: 0, kind: 'hold', units: [] },
      { step: 20, side: 1, kind: 'hold' },
      { step: 30, side: 1, kind: 'free', units: [5001, 5002] },
      { step: 40, side: 0, kind: 'withdraw', units: [11] },
      { step: 50, side: 0, kind: 'withdraw' },
      { step: 60, side: 1, kind: 'withdraw' },
      { step: BATTLE.maxSteps + 1_200, side: 0, kind: 'hold' },
    ];
    return stampBattle(i);
  };

  it('a sound one passes', () => {
    const i = rich();
    expect(i.v).toBe(BATTLE_V4);
    expect(checkBattleInput(i)).toBeNull();
    expect(checkBattleInput(JSON.parse(JSON.stringify(i)))).toBeNull();
    // Even without a helper or an order a battle stamped 4 (a live battle's start) is sound.
    const bare = make(crew('tank', 2, 1));
    bare.v = BATTLE_V4;
    bare.layout.v = BATTLE_V4;
    expect(checkBattleInput(bare)).toBeNull();
    expect(Battle.run(rich()).outcome).not.toBeNull();
  });

  it('a malformed one is turned away, with a reason', () => {
    const many = (n: number, f: (k: number) => BattleOrder): BattleOrder[] =>
      Array.from({ length: n }, (_, k) => f(k));
    const cases: [string, (b: BattleInput) => void][] = [
      ['257 orders', (b) => (b.orders = many(257, (k) => ({ step: k, side: 0, kind: 'hold' })))],
      [
        '5 orders from a side at a step',
        (b) => (b.orders = many(5, () => ({ step: 9, side: 0, kind: 'hold' }))),
      ],
      ['an unknown kind', (b) => b.orders.push({ step: 1, side: 0, kind: 'dance' as 'hold' })],
      ['a side that isn’t', (b) => b.orders.push({ step: 1, side: 2 as 0, kind: 'hold' })],
      ['a guard by the attackers', (b) => b.orders.push({ step: 1, side: 0, kind: 'guard', target: 0 })],
      [
        'a withdrawal by units of the defenders',
        (b) => b.orders.push({ step: 1, side: 1, kind: 'withdraw', units: [1] }),
      ],
      ['a focus with no target', (b) => b.orders.push({ step: 1, side: 0, kind: 'focus' })],
      ['a guard with no target', (b) => b.orders.push({ step: 1, side: 1, kind: 'guard' })],
      ['a hold with a target', (b) => b.orders.push({ step: 1, side: 0, kind: 'hold', target: 1 })],
      ['a structure past the last', (b) => b.orders.push({ step: 1, side: 0, kind: 'focus', target: 99 })],
      ['a structure below the first', (b) => b.orders.push({ step: 1, side: 1, kind: 'guard', target: -1 })],
      [
        'a structure that isn’t a whole number',
        (b) => b.orders.push({ step: 1, side: 1, kind: 'guard', target: 1.5 }),
      ],
      [
        'an attacker’s id that isn’t a number',
        (b) => b.orders.push({ step: 1, side: 1, kind: 'focus', target: Number.NaN }),
      ],
      [
        'units that aren’t a list',
        (b) => b.orders.push({ step: 1, side: 0, kind: 'hold', units: 'all' as unknown as number[] }),
      ],
      [
        'units that aren’t whole numbers',
        (b) => b.orders.push({ step: 1, side: 0, kind: 'hold', units: [1.5] }),
      ],
      [
        'too many units named',
        (b) =>
          b.orders.push({ step: 1, side: 0, kind: 'hold', units: Array.from({ length: 257 }, (_, k) => k) }),
      ],
      ['a step past the end', (b) => b.orders.push({ step: BATTLE.maxSteps + 1_201, side: 0, kind: 'hold' })],
      ['a negative step', (b) => b.orders.push({ step: -1, side: 0, kind: 'hold' })],
      [
        'a fourth helper',
        (b) =>
          b.helpers!.push({
            owner: 9,
            name: 'More',
            color: 0,
            side: 0,
            arrive: 5,
            units: crew('tank', 1, 6001),
          }),
      ],
      ['two helpers with one owner', (b) => (b.helpers![1]!.owner = 1)],
      ['a helper with owner 0', (b) => (b.helpers![0]!.owner = 0)],
      ['a helper with owner −1', (b) => (b.helpers![0]!.owner = -1)],
      ['a helper with owner 256', (b) => (b.helpers![2]!.owner = 256)],
      ['a helper arriving after the battle', (b) => (b.helpers![0]!.arrive = BATTLE.maxSteps + 1)],
      ['a helper arriving before it', (b) => (b.helpers![0]!.arrive = -1)],
      ['a helper arriving between steps', (b) => (b.helpers![0]!.arrive = 2.5)],
      ['a helper with no units', (b) => (b.helpers![0]!.units = [])],
      [
        'a helper with too many units',
        (b) => (b.helpers![0]!.units = crew('tank', BATTLE.maxAttackers + 1, 6001)),
      ],
      ['a helper with an unknown route', (b) => ((b.helpers![0] as { route: string }).route = 'teleport')],
      ['a helper on a side that isn’t', (b) => (b.helpers![0]!.side = 2 as 0)],
      ['a helper with a very long name', (b) => (b.helpers![0]!.name = 'x'.repeat(500))],
      ['a helper with research out of bounds', (b) => (b.helpers![0]!.mods = { land: { hp: 99 } })],
      ['a helper’s unit that isn’t', (b) => ((b.helpers![0]!.units[0] as { kind: string }).kind = 'dragon')],
      ['a helper’s unit based somewhere', (b) => (b.helpers![0]!.units[0]!.base = 0)],
      [
        'a helper’s superweapon',
        (b) => (b.helpers![0]!.units = [{ id: 7001, kind: 'skyfortress', hp: 1, x: 0, z: 0, base: -1 }]),
      ],
      ['a helper’s unit carried in', (b) => (b.helpers![0]!.units[0]!.from = 7002)],
      ['a helper unit with the force’s id', (b) => (b.helpers![0]!.units[0]!.id = 1)],
      ['a helper unit with a defender’s id', (b) => (b.helpers![1]!.units[0]!.id = 5001)],
      ['two helpers’ units with one id', (b) => (b.helpers![2]!.units[0]!.id = 7001)],
      ['helpers that aren’t a list', (b) => (b.helpers = {} as unknown as BattleHelper[])],
    ];
    for (const [what, spoil] of cases) {
      const b = rich();
      spoil(b);
      expect(checkBattleInput(b), what).not.toBeNull();
    }
    // Two defenders with one id.
    const d = rich();
    d.layout.defenders[1]!.id = d.layout.defenders[0]!.id;
    expect(checkBattleInput(d)).not.toBeNull();
  });

  it('a field of version 4 in a battle stamped below it is turned away', () => {
    const base = () => {
      const i = make(crew('tank', 3, 1));
      expect(i.v).toBe(2);
      return i;
    };
    const cases: [string, (b: BattleInput) => void][] = [
      ['a focus', (b) => b.orders.push({ step: 1, side: 0, kind: 'focus', target: 0 })],
      ['a hold', (b) => b.orders.push({ step: 1, side: 0, kind: 'hold' })],
      ['a withdrawal by units', (b) => b.orders.push({ step: 1, side: 0, kind: 'withdraw', units: [1] })],
      ['a withdrawal with a target', (b) => b.orders.push({ step: 1, side: 0, kind: 'withdraw', target: 1 })],
      [
        'a helper',
        (b) =>
          (b.helpers = [{ owner: 1, name: 'A', color: 0, side: 0, arrive: 1, units: crew('tank', 1, 7001) }]),
      ],
      [
        '65 withdrawals',
        (b) =>
          (b.orders = Array.from(
            { length: 65 },
            (_, k) => ({ step: k, side: 0, kind: 'withdraw' }) as BattleOrder,
          )),
      ],
    ];
    for (const v of [2, 3]) {
      for (const [what, spoil] of cases) {
        const b = base();
        b.v = v;
        b.layout.v = v;
        spoil(b);
        expect(checkBattleInput(b), `${what} in version ${v}`).not.toBeNull();
      }
      // An empty list of helpers and M35's withdrawals are still fine there.
      const ok = base();
      ok.v = v;
      ok.layout.v = v;
      ok.helpers = [];
      ok.orders = Array.from(
        { length: BATTLE_LIMITS.orders },
        (_, k) => ({ step: k, side: 0, kind: 'withdraw' }) as BattleOrder,
      );
      expect(checkBattleInput(ok), `M35's orders in version ${v}`).toBeNull();
    }
    // Version 4 takes the longer list.
    const long = rich4();
    long.orders = Array.from(
      { length: BATTLE_LIMITS.ordersV4 },
      (_, k) => ({ step: k, side: 0, kind: 'withdraw' }) as BattleOrder,
    );
    expect(checkBattleInput(long)).toBeNull();
    // And a picture stamped higher than its battle, or a version nobody knows, is not read.
    const high = base();
    high.layout.v = BATTLE_V4;
    expect(checkBattleInput(high)).not.toBeNull();
    const odd = rich4();
    odd.v = 5;
    odd.layout.v = 5;
    expect(checkBattleInput(odd)).not.toBeNull();
  });

  it('what a helper brings is capped like the force: a full house plays', () => {
    const i = rich();
    expect(i.helpers!.reduce((n, h) => n + h.units.length, 0)).toBeGreaterThan(BATTLE.maxAttackers);
    const b = Battle.run(i);
    expect(b.outcome).not.toBeNull();
    expect(b.result().units.filter((u) => u.owner === 255)).toHaveLength(24);
    // The limits are what the design says.
    expect([BATTLE_LIMITS.ordersV4, BATTLE_LIMITS.perStep, BATTLE_LIMITS.helpers]).toEqual([256, 4, 3]);
    expect(SUPER.maxCarried).toBeGreaterThan(0);
  });
});

/** A small version 4 battle to spoil. */
function rich4(): BattleInput {
  const i = make(crew('tank', 3, 1), [{ step: 3, side: 0, kind: 'hold' }]);
  expect(i.v).toBe(BATTLE_V4);
  return i;
}
