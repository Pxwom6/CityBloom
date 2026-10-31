import { ShaderLib, Vector3, type Material, type WebGLProgramParametersWithUniforms } from 'three';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ClientWorld } from '../../src/client/world';
import { QUALITY_PARAMS } from '../../src/client/settings';
import { CIVIC } from '../../src/data/civic';
import { UNIT, UNIT_DEFS, type UnitKind } from '../../src/data/war';
import { UNIT_ROLES } from '../../src/models/baked';
import { generatedUnit, generatedWinding, unitModel } from '../../src/render/assets/unitModels';
import { buildMilitaryModel, MILITARY_SITES } from '../../src/render/assets/militaryModels';
import { ModelBuilder, modelRng } from '../../src/render/assets/builder';
import { unitDepthMaterial, unitGeometry, unitMaterial, UnitRenderer } from '../../src/render/units';
import { PoseCache, Site, trialId, unitPoses, type UnitPose } from '../../src/render/unitPoses';
import { handmade } from '../../src/render/assets/handmade';
import { newSim } from '../helpers';
import { kindsAt, unitTown } from './unitTown';

/** M34: units' generated looks, where they stand and move, and nothing at all in peace. */

const role = (name: string) => UNIT_ROLES.indexOf(name as (typeof UNIT_ROLES)[number]);

describe('generated units (M34)', () => {
  it('every kind is its prompt’s size, front along −z, on the ground or at the waterline', () => {
    for (const d of UNIT_DEFS) {
      const u = generatedUnit(d.id);
      const [L, W, H] = d.size;
      expect(u.kind).toBe(d.id);
      expect(u.id).toBe(d.model);
      // Within about 10 % (the unit spec's tolerance), and a little more for the toy proportions.
      expect(Math.abs(u.size[0] - L) / L, `${d.id} length`).toBeLessThan(0.12);
      expect(Math.abs(u.size[1] - W) / W, `${d.id} width`).toBeLessThan(0.12);
      expect(Math.abs(u.size[2] - H) / H, `${d.id} height`).toBeLessThan(0.12);
      // Ships float with their hulls below the waterline; everything else stands on the ground.
      if (d.domain === 'sea') expect(u.depth, d.id).toBeGreaterThan(0.5);
      else expect(u.depth, d.id).toBeLessThan(0.01);
      // Guns point forward (−z), as do the nose and the cab: what's armed fires ahead.
      for (const mz of u.muzzles) if (d.id !== 'gunboat') expect(mz.at[2], `${d.id} muzzle`).toBeLessThan(0);
      // The origin is under the middle.
      const xs = u.positions.filter((_, i) => i % 3 === 0);
      const zs = u.positions.filter((_, i) => i % 3 === 2);
      expect(Math.abs((Math.min(...xs) + Math.max(...xs)) / 2), d.id).toBeLessThan(W * 0.05);
      expect(Math.abs((Math.min(...zs) + Math.max(...zs)) / 2), d.id).toBeLessThan(L * 0.06);
    }
  });

  it('every closed shape is wound outward (faces aren’t drawn inside out)', () => {
    for (const d of UNIT_DEFS) {
      const w = generatedWinding(d.id);
      expect(w.flipped, d.id).toEqual([]);
      expect(w.volume, d.id).toBeGreaterThan(0);
    }
  });

  it('has a far version, the owner’s paint, and the moving parts each kind needs, with pivots', () => {
    const needs: Partial<Record<UnitKind, string[]>> = {
      tank: ['turret', 'barrel', 'track_left', 'track_right', 'wheel', 'hatch'],
      heavytank: ['turret', 'barrel', 'track_left', 'track_right'],
      artillery: ['turret', 'barrel', 'wheel'],
      transport: ['wheel'],
      repair: ['wheel', 'crane'],
      fighter: ['wheel'],
      bomber: ['propeller', 'hatch', 'wheel'],
      helicopter: ['rotor', 'tail_rotor'],
      drone: ['propeller'],
      patrolboat: ['turret', 'barrel'],
      gunboat: ['turret', 'barrel'],
      submarine: ['propeller'],
      landingcraft: ['ramp', 'propeller'],
    };
    for (const d of UNIT_DEFS) {
      const u = generatedUnit(d.id);
      const tris = u.index.length / 3;
      expect(u.triRole.length).toBe(tris);
      expect(u.triPart.length).toBe(tris);
      expect(u.counts.near).toBe(tris);
      // The far version keeps most of it, but not all of what's fine.
      expect(u.counts.far, d.id).toBeGreaterThan(tris * 0.4);
      expect(u.counts.far, d.id).toBeLessThanOrEqual(tris);
      expect(u.triRole.includes(role('body')), `${d.id} body`).toBe(true);
      expect(u.triRole.includes(role('body_alt')), `${d.id} body_alt`).toBe(true);
      const names = u.parts.map((p) => p.name);
      for (const n of needs[d.id] ?? []) expect(names, d.id).toContain(n);
      // Every part has triangles, a pivot inside the unit's box, and a parent before it.
      u.parts.forEach((p, k) => {
        expect(u.triPart.includes(k + 1), `${d.id} ${p.name}`).toBe(true);
        expect(p.parent).toBeLessThanOrEqual(k);
        expect(Math.abs(p.pivot[0])).toBeLessThan(u.size[1]);
        expect(Math.abs(p.pivot[2])).toBeLessThan(u.size[0]);
      });
      // Barrels turn with their turrets.
      u.parts.forEach((p) => {
        if (p.name === 'barrel') expect(u.parts[p.parent - 1]?.name, d.id).toBe('turret');
      });
    }
    // Lamps that glow at night on the vehicles that have them.
    for (const k of ['tank', 'transport', 'repair', 'patrolboat', 'gunboat'] as const)
      expect(generatedUnit(k).triRole.includes(role('light')), k).toBe(true);
    // Armed units have somewhere to fire from.
    for (const d of UNIT_DEFS)
      if (
        d.stats.attack > 0 &&
        d.id !== 'submarine' &&
        d.id !== 'bomber' &&
        d.id !== 'drone' &&
        d.id !== 'infantry'
      )
        expect(generatedUnit(d.id).muzzles.length, d.id).toBeGreaterThan(0);
  });

  it('becomes drawable geometry: parts tagged with their motion and pivots, far smaller', () => {
    for (const d of UNIT_DEFS) {
      const u = generatedUnit(d.id);
      const near = unitGeometry(u, false);
      const far = unitGeometry(u, true);
      const n = near.getAttribute('position').count;
      expect(n).toBe((u.index.length / 3) * 3);
      expect(far.getAttribute('position').count).toBe(u.counts.far * 3);
      const part = near.getAttribute('aPart');
      let moving = 0;
      let painted = 0;
      for (let i = 0; i < n; i++) {
        if (part.getX(i) > 0) moving++;
        if (part.getZ(i) === 1 || part.getZ(i) === 2) painted++;
      }
      expect(painted, d.id).toBeGreaterThan(0);
      if (u.parts.some((p) => p.name !== 'crane')) expect(moving, d.id).toBeGreaterThan(0);
      // Normals are unit length.
      const nrm = near.getAttribute('normal');
      for (let i = 0; i < n; i += 37)
        expect(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i))).toBeCloseTo(1, 3);
    }
    // A helicopter's rotor spins about y, its tail rotor about x; a bomber's propellers about z.
    const kindOf = (k: UnitKind, name: string) => {
      const u = generatedUnit(k);
      const g = unitGeometry(u, false);
      const a = g.getAttribute('aPart');
      const part = u.parts.findIndex((p) => p.name === name) + 1;
      const t = [...u.triPart].indexOf(part);
      return a.getX(t * 3);
    };
    expect(kindOf('helicopter', 'rotor')).toBe(4);
    expect(kindOf('helicopter', 'tail_rotor')).toBe(3);
    expect(kindOf('bomber', 'propeller')).toBe(5);
    expect(kindOf('drone', 'propeller')).toBe(4);
    expect(kindOf('tank', 'wheel')).toBe(6);
  });

  it('patches three.js’s own shader chunks: parts move in the colour and shadow passes', () => {
    const patch = (m: Material, lib: { vertexShader: string; fragmentShader: string }) => {
      const shader = { ...lib, uniforms: {} } as unknown as WebGLProgramParametersWithUniforms;
      m.onBeforeCompile(shader, undefined as never);
      return shader;
    };
    const u = { uNight: { value: 0 }, uSlow: { value: 0 } };
    for (const anim of [true, false]) {
      const colour = patch(unitMaterial(u, anim), ShaderLib.lambert);
      expect(colour.vertexShader).toContain('unitMove(unitPos, objectNormal)');
      expect(colour.vertexShader).toContain('vec3 transformed = unitPos;');
      expect(colour.vertexShader).not.toContain('#include <begin_vertex>');
      // vColor is a vec4 in this three.js: paint its rgb.
      expect(colour.vertexShader).toContain('vColor.rgb = iBody');
      expect(colour.fragmentShader).toContain('totalEmissiveRadiance += vLight');
      expect(colour.uniforms).toHaveProperty('uSlow');
      const depth = patch(unitDepthMaterial(u, anim), ShaderLib.depth);
      expect(depth.vertexShader).toContain('unitMove(transformed, unitN)');
      expect(unitMaterial(u, anim).customProgramCacheKey()).not.toBe(
        unitMaterial(u, !anim).customProgramCacheKey(),
      );
    }
  });

  it('wears a hand-made model when there is one, and the generated look otherwise', () => {
    for (const d of UNIT_DEFS) expect(unitModel(d.id)).toBe(generatedUnit(d.id));
  });
});

describe('generated war buildings (M34)', () => {
  it('every war building, those to come too, has a look on its site with far and skyline versions', () => {
    expect(Object.keys(MILITARY_SITES)).toHaveLength(21);
    for (const [id, [W, D]] of Object.entries(MILITARY_SITES)) {
      const m = new ModelBuilder();
      expect(buildMilitaryModel(id, m, W, D, modelRng(1)), id).toBe(true);
      const out = m.build();
      const tris = out.pos.length / 9;
      // In line with the other generated civic buildings (a hundred to about 1,300 triangles).
      expect(tris, id).toBeGreaterThan(80);
      expect(tris, id).toBeLessThan(1600);
      expect(out.far!.pos.length, id).toBeLessThanOrEqual(out.pos.length);
      expect(out.sky!.pos.length, id).toBeLessThanOrEqual(out.far!.pos.length);
      // Nothing outside the site (a few centimetres for trim).
      for (let i = 0; i < out.pos.length; i += 3) {
        expect(Math.abs(out.pos[i]!), id).toBeLessThanOrEqual(W / 2 + 0.05);
        expect(Math.abs(out.pos[i + 2]!), id).toBeLessThanOrEqual(D / 2 + 0.05);
      }
    }
    // The buildings in the game's table are the same sites.
    for (const def of CIVIC.values())
      if (def.category === 'military') expect(MILITARY_SITES[def.model]).toEqual([def.w, def.d]);
  });
});

describe('unit poses (M34)', () => {
  let world: ClientWorld;
  let bases: Record<string, number>;
  const roster: { id: number; kind: UnitKind; base: number; hp: number }[] = [];

  beforeAll(() => {
    const town = unitTown();
    bases = town.bases;
    world = new ClientWorld(town.sim.snapshot());
    let id = 50_000;
    for (const [def, n] of [
      ['barracks', 8],
      ['vehicledepot', 2],
      ['airfield', 2],
      ['navalyard', 1],
    ] as const) {
      for (const kind of kindsAt(def))
        for (let k = 0; k < (kind === 'infantry' ? n : def === 'airfield' && kind === 'drone' ? 3 : n); k++)
          roster.push({ id: id++, kind, base: bases[def]!, hp: 1 });
    }
    world.forces = { units: roster, orders: [], trials: [] };
  }, 120_000);

  const LIM = { drill: 8, patrol: 3, fly: 4 };
  const at = (tick: number) => unitPoses(world, tick, LIM, new PoseCache());

  it('places every base the test needs', () => {
    expect(Object.keys(bases).sort()).toEqual([
      'airfield',
      'barracks',
      'militaryhq',
      'navalyard',
      'vehicledepot',
    ]);
  });

  it('are pure functions of the clock and the unit: the same tick gives the same poses', () => {
    const cache = new PoseCache();
    // Walk the clock about with one cache, then ask again with a fresh one.
    for (const t of [10, 500, 90, 1300, 700]) unitPoses(world, t, LIM, cache);
    for (const t of [123, 777, 1441, 5000]) {
      const a = unitPoses(world, t, LIM, cache);
      const b = at(t);
      expect(a).toEqual(b);
      expect(a.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))).toBe(true);
    }
  });

  /** Is (x, z) inside the civic's site (with a margin)? */
  const inside = (base: number, p: { x: number; z: number }, margin = 0) => {
    const c = world.civics.get(base)!;
    const site = new Site(c);
    const def = CIVIC.get(c.def)!;
    // Back to the site's local frame.
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const yaw = site.yaw;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const lz = dx * Math.sin(yaw) + dz * Math.cos(yaw);
    return Math.abs(lx) <= def.w / 2 + margin && Math.abs(lz) <= def.d / 2 + margin;
  };

  it('parks units in slots inside their base’s site, a slot each', () => {
    const seen = new Map<UnitKind, number>();
    for (const t of [0, 200, 400, 600, 800, 1000, 1200]) {
      const poses = at(t);
      const parked = poses.filter((p) => p.doing === 'parked');
      const where = new Set<string>();
      for (const p of parked) {
        const u = roster.find((r) => r.id === p.id)!;
        seen.set(u.kind, (seen.get(u.kind) ?? 0) + 1);
        if (u.kind === 'patrolboat' || UNIT.get(u.kind)!.domain === 'sea') {
          // Boats lie at berths in the water behind the quay.
          expect(world.heightAt(p.x, p.z), u.kind).toBeLessThan(-1.4);
          expect(p.y).toBe(0);
          continue;
        }
        expect(inside(u.base, p), `${u.kind} ${p.id} at ${p.x},${p.z}`).toBe(true);
        const key = `${p.x.toFixed(1)},${p.z.toFixed(1)}`;
        expect(where.has(key), `two units on one slot at ${key}`).toBe(false);
        where.add(key);
      }
    }
    // Every kind of unit is parked at some point.
    for (const d of UNIT_DEFS) expect(seen.get(d.id) ?? 0, d.id).toBeGreaterThan(0);
  });

  it('over a day: squads march, tanks drill, vehicles patrol, aircraft fly and boats sail', () => {
    const doing = new Map<string, Set<string>>();
    for (let t = 0; t < 2880; t += 9)
      for (const p of at(t)) {
        const k = `${p.kind}`;
        if (!doing.has(k)) doing.set(k, new Set());
        doing.get(k)!.add(p.doing);
      }
    expect(doing.get('infantry')).toContain('drill');
    expect(doing.get('tank')).toContain('drill');
    expect(
      [...['tank', 'heavytank', 'artillery', 'transport', 'repair']].some((k) => doing.get(k)?.has('patrol')),
    ).toBe(true);
    for (const k of ['fighter', 'bomber', 'helicopter', 'drone']) expect(doing.get(k), k).toContain('flying');
    for (const k of ['patrolboat', 'gunboat', 'submarine', 'landingcraft'])
      expect(doing.get(k), k).toContain('sailing');
  });

  it('drills stay on the base’s own ground', () => {
    for (let t = 0; t < 1440; t += 11)
      for (const p of at(t))
        if (p.doing === 'drill') expect(inside(roster.find((r) => r.id === p.id)!.base, p, 2.5)).toBe(true);
  });

  it('patrols keep to the roads once out of the gate', () => {
    let checked = 0;
    for (let t = 0; t < 2880; t += 5)
      for (const p of at(t)) {
        if (p.doing !== 'patrol') continue;
        const u = roster.find((r) => r.id === p.id)!;
        if (inside(u.base, p, 8)) continue;
        const hit = world.net.nearestSegment(p, 30);
        expect(hit, `${p.kind} off the roads at ${p.x},${p.z}`).not.toBeNull();
        expect(hit!.d).toBeLessThan(world.net.halfWidth(hit!.seg) + 0.5);
        // On the road surface.
        expect(Math.abs(p.y - world.roadHeight(hit!.seg, hit!.s, p.x, p.z))).toBeLessThan(0.6);
        checked++;
      }
    expect(checked).toBeGreaterThan(20);
  });

  it('boats sail on water deep enough for them', () => {
    let checked = 0;
    for (let t = 0; t < 2880; t += 5)
      for (const p of at(t)) {
        if (p.doing !== 'sailing') continue;
        expect(world.heightAt(p.x, p.z), `${p.kind} aground at ${p.x},${p.z}`).toBeLessThan(-1);
        checked++;
      }
    expect(checked).toBeGreaterThan(20);
  });

  it('aircraft take off from their base and come back to it', () => {
    const air = (p: UnitPose) => p.doing === 'flying';
    let high = 0;
    for (let t = 0; t < 2880; t += 7)
      for (const p of at(t).filter(air)) {
        const c = world.civics.get(bases.airfield!)!;
        if (p.y > c.y + 30) high++;
        expect(p.y).toBeGreaterThanOrEqual(c.y - 0.01);
      }
    expect(high).toBeGreaterThan(10);
  });

  it('a prototype on trial runs at its proving ground, flies over it, or sails off the naval yard (M37)', () => {
    const ground = bases.vehicledepot!;
    const c = world.civics.get(ground)!;
    const site = new Site(c);
    const was = world.forces!;
    const trialAt = (kind: UnitKind, tick: number) => {
      world.forces = { ...was, units: [], trials: [{ ground, kind, done: 3, hours: 36 }] };
      const poses = unitPoses(world, tick, LIM, new PoseCache());
      world.forces = was;
      expect(poses).toHaveLength(1);
      expect(poses[0]!.id).toBe(trialId(ground));
      expect(poses[0]!.doing).toBe('trial');
      return poses[0]!;
    };
    // On the track, and moving: two moments apart are in different places.
    const a = trialAt('heavytank', 100);
    const b = trialAt('heavytank', 140);
    expect(Math.hypot(a.x - c.x, a.z - c.z)).toBeLessThan(Math.hypot(site.W, site.D) / 2);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(5);
    expect(trialAt('heavytank', 100)).toEqual(a);
    // Up in the air over it, and on the water off the yard.
    expect(trialAt('bomber', 100).y).toBeGreaterThan(c.y + 40);
    const boat = trialAt('gunboat', 100);
    expect(boat.y).toBe(0);
    expect(world.heightAt(boat.x, boat.z)).toBeLessThan(0);
    // With the hand-made model, round its own ring: never in the middle, where its hangar stands
    // (the generated look's loop came within a few metres of it).
    const middle = (from: number) => {
      let near = Infinity;
      for (let t = 0; t < 600; t += 7) {
        const p = trialAt('heavytank', t);
        near = Math.min(near, Math.hypot(p.x - c.x, p.z - c.z));
      }
      return near + from;
    };
    expect(middle(0)).toBeLessThan(15);
    const spy = vi.spyOn(handmade, 'civic').mockReturnValue({} as never);
    try {
      expect(middle(0)).toBeGreaterThan(18);
    } finally {
      spy.mockRestore();
    }
  });

  it('draws a prototype on trial though no unit has been trained yet', () => {
    const ground = bases.vehicledepot!;
    const was = world.forces!;
    world.forces = { ...was, units: [], trials: [{ ground, kind: 'heavytank', done: 3, hours: 36 }] };
    try {
      const r = new UnitRenderer(world);
      const c = world.civics.get(ground)!;
      r.update(100, new Vector3(c.x, c.y + 60, c.z + 60), 0);
      expect(r.shown.map((p) => p.id)).toEqual([trialId(ground)]);
    } finally {
      world.forces = was;
    }
  });

  it('fewer units leave their slots at a lower quality', () => {
    const away = (lim: typeof LIM) => {
      let n = 0;
      for (let t = 0; t < 2880; t += 13)
        n += unitPoses(world, t, lim, new PoseCache()).filter((p) => p.doing !== 'parked').length;
      return n;
    };
    const { high, medium, low } = QUALITY_PARAMS;
    const h = away(high.units);
    const m = away(medium.units);
    const l = away(low.units);
    expect(h).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(l);
  });

  it('the renderer draws each kind instanced: near, far and dots by distance', () => {
    const r = new UnitRenderer(world);
    const c = world.civics.get(bases.barracks!)!;
    r.update(0, new Vector3(c.x, c.y + 60, c.z + 60), 0);
    expect(r.counts.near).toBeGreaterThan(0);
    expect(r.counts.near + r.counts.far + r.counts.dots).toBe(r.shown.length);
    // Far away: only dots.
    r.update(0, new Vector3(c.x + 9000, 3000, c.z), 0);
    expect(r.counts.near).toBe(0);
    expect(r.counts.far).toBe(0);
    expect(r.counts.dots).toBe(r.shown.length);
  });
});

describe('peace (M34)', () => {
  it('a peaceful city’s renderer makes no unit meshes and draws nothing', () => {
    const sim = newSim({ seed: 'calm' });
    const world = new ClientWorld(sim.snapshot());
    expect(world.forces).toBeNull();
    const r = new UnitRenderer(world);
    for (const t of [0, 100, 2000]) r.update(t, new Vector3(1000, 200, 1000), 0.5);
    expect(r.group.children).toHaveLength(0);
    expect(r.meshCount).toBe(0);
    expect(r.counts).toEqual({ near: 0, far: 0, dots: 0 });
    expect(r.shown).toHaveLength(0);
  });

  it('gives units a cost switch: full at High, cheaper at Medium, least at Low', () => {
    const { low, medium, high } = QUALITY_PARAMS;
    expect(high.units.near).toBeGreaterThan(medium.units.near);
    expect(medium.units.near).toBeGreaterThan(low.units.near);
    expect(high.units.far).toBeGreaterThan(medium.units.far);
    expect(medium.units.far).toBeGreaterThan(low.units.far);
    expect([high.units.animate, medium.units.animate, low.units.animate]).toEqual([true, true, false]);
    expect([high.units.shadows, medium.units.shadows, low.units.shadows]).toEqual([true, true, false]);
    for (const k of ['drill', 'patrol', 'fly'] as const) {
      expect(high.units[k]).toBeGreaterThan(medium.units[k]);
      expect(medium.units[k]).toBeGreaterThanOrEqual(low.units[k]);
    }
    expect(medium.units.drill + medium.units.patrol + medium.units.fly).toBeGreaterThan(
      low.units.drill + low.units.patrol + low.units.fly,
    );
  });
});
