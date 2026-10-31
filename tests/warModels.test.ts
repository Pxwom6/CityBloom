import { copyFileSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bakeModel, pitsOf, TRI_NEAR, type BakedModel } from '../src/models/bake';
import { UNIT_ROLES, type BakedUnit } from '../src/models/baked';
import {
  checkModel,
  emptyBox,
  groundLift,
  growBox,
  inspectModel,
  onGround,
  openTop,
  orientFaces,
  orientOpen,
  PIT,
} from '../src/models/check';
import { decodeModels } from '../src/models/codec';
import { parseGlb } from '../src/models/glb';
import { ROLES, WAR_ALLOW, parseSites, targetOf } from '../src/models/spec';
import { INSIDE_OUT, UNIT_PARTS, bakeUnit, checkUnit, inspectUnit } from '../src/models/unit';
import { decodeUnits, decodeWarModels, encodeUnits, encodeWarModels } from '../src/models/warCodec';
import { BASE_TOP, buildHandModel } from '../src/render/assets/handmade';
import { PALETTES } from '../src/render/assets/models';
import { editGlb } from '../scripts/lib/breakModel';
import {
  WAR_MODELS_DIR,
  buildModels,
  buildWarModels,
  isUnitFile,
  modelFiles,
  readBudgets,
  readWarSites,
} from '../scripts/lib/modelPipeline';

/** The delivered war models (assets/models/war), read from disk. */
const war = (id: string) => readFileSync(`${WAR_MODELS_DIR}/${id}.glb`);
const budgets = readBudgets();
const sites = readWarSites();

const bake = (id: string): BakedModel => {
  const { report, file } = inspectModel(war(id), `${id}.glb`, budgets, sites);
  expect(report.errors, id).toEqual([]);
  return bakeModel(file!, report);
};
const bakeU = (id: string): BakedUnit => {
  const { report, file } = inspectUnit(war(id), `${id}.glb`, budgets);
  expect(report.errors, id).toEqual([]);
  return bakeUnit(file!, report);
};

describe('war sites and budgets', () => {
  it('reads every war building’s site from PROMPTS-WAR.md', () => {
    expect(sites.size).toBe(21);
    expect(sites.get('interceptor')).toEqual({ name: 'Interceptor battery', w: 24, d: 24 });
    expect(sites.get('airfield')).toMatchObject({ w: 200, d: 80 });
    expect(sites.get('atomsilo')).toMatchObject({ name: 'Atom silo', w: 40, d: 40 });
    // Units have sizes, not sites.
    expect(sites.has('unit-tank')).toBe(false);
    expect(parseSites('### Thing (`thing.glb`)\nSave as thing.glb.\nSite 12.5 x 8 m.\n')).toEqual(
      new Map([['thing', { name: 'Thing', w: 12.5, d: 8 }]]),
    );
  });

  it('takes the sites of war buildings the game has from its data, the rest from the prompts', () => {
    // In the game (M34): its own site; military; smoke only where the data says.
    expect(targetOf('barracks')).toMatchObject({ kind: 'civic', w: 40, d: 32, war: true, smokes: false });
    expect(targetOf('armsfactory')).toMatchObject({ war: true, smokes: true });
    // In the game since M37 (research's buildings): their own sites too.
    expect(targetOf('interceptor')).toMatchObject({
      kind: 'civic',
      def: 'interceptor',
      w: 24,
      d: 24,
      war: true,
    });
    expect(targetOf('domeshield')).toMatchObject({ war: true, smokes: false });
    // Not in the game yet (M40): only with the prompts' sites, and never smoking (a cooling stack is a vent).
    expect(targetOf('enrichment')).toBeNull();
    expect(targetOf('enrichment', sites)).toMatchObject({ war: true, smokes: false });
    // Everything else as before.
    expect(targetOf('firestation', sites)).not.toHaveProperty('war');
    expect(targetOf('R103', sites)).toMatchObject({ kind: 'zoned' });
  });

  it('every war model has its prompt’s budget, and the units’ prompts name their parts', () => {
    const files = modelFiles(WAR_MODELS_DIR);
    expect(files).toHaveLength(39);
    for (const f of files) expect(budgets.get(f.replace(/\.glb$/, '')), f).toBeGreaterThan(0);
    const units = files.filter(isUnitFile).map((f) => f.replace(/^unit-|\.glb$/g, ''));
    expect(units).toHaveLength(18);
    expect(Object.keys(UNIT_PARTS).sort()).toEqual([...units].sort());
  });
});

describe('war buildings: what the check allows them', () => {
  it('lets three war buildings face the road as their prompts ask, by name', () => {
    for (const id of Object.keys(WAR_ALLOW.facing)) {
      const r = checkModel(war(id), `${id}.glb`, budgets, sites);
      expect(r.errors, id).toEqual([]);
      expect(
        r.warnings.some((w) => w.startsWith('the facing check would turn it')),
        id,
      ).toBe(true);
    }
    // The bunker's file under another 16 m building's name is turned away.
    const r = checkModel(war('bunker'), 'shelter.glb', budgets, sites);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/front faces \+Z/);
  });

  it('accepts light on war buildings only', () => {
    const silo = parseGlb(war('atomsilo'));
    expect(silo.parts.some((p) => p.material === 'light')).toBe(true);
    expect(checkModel(war('atomsilo'), 'atomsilo.glb', budgets, sites).ok).toBe(true);
    // A peaceful building with a lamp in `light` fails as before.
    const lamp = editGlb(new Uint8Array(readFileSync('tests/fixtures/models/good/police.glb')), (g) => {
      (g.materials as { name: string }[])[0]!.name = 'light';
    });
    const r = checkModel(lamp, 'police.glb', budgets, sites);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/materials that aren't roles in the spec: "light"/);
    // The roles the main models file numbers stay as they were: light comes last.
    expect(ROLES.indexOf('hedge')).toBe(17);
    expect(ROLES.indexOf('light')).toBe(18);
  });

  it('lets the naval yard, coastal gun and spy agency go below ground, and no other', () => {
    for (const id of ['navalyard', 'coastalgun', 'spyagency'])
      expect(checkModel(war(id), `${id}.glb`, budgets, sites).errors, id).toEqual([]);
    // The spy agency's ramp under the radar station's name (the same 24 m site): too deep.
    const r = checkModel(war('spyagency'), 'radar.glb', budgets, sites);
    expect(r.errors.join(' ')).toMatch(/goes 2\.9 m below the ground/);
  });

  it('leaves water in a pit where it is: the lift for lawns ignores it', () => {
    const yard = parseGlb(war('navalyard'));
    const water = yard.parts.find((p) => p.name === 'water')!;
    expect(onGround(water)).toBe(true);
    expect(growBox(emptyBox(), water.tris).max[1]).toBeCloseTo(-1, 3);
    // Before: lifted by the dock's water (1.05 m); now its quay deck and lawns are where they were.
    expect(groundLift(yard.parts)).toBe(0);
    const m = bake('navalyard');
    let lowest = Infinity;
    for (let t = 0; t < m.triRole.length; t++) {
      if (ROLES[m.triRole[t]!] !== 'water') continue;
      for (let k = 0; k < 3; k++) lowest = Math.min(lowest, m.positions[m.index[t * 3 + k]! * 3 + 1]!);
    }
    expect(lowest).toBeCloseTo(-1, 2);
  });

  it('no model in assets/models has ground in a pit: their lift is as it was', () => {
    for (const f of modelFiles('assets/models')) {
      const file = parseGlb(readFileSync(`assets/models/${f}`));
      for (const p of file.parts)
        if (onGround(p)) expect(growBox(emptyBox(), p.tris).max[1], f).toBeGreaterThanOrEqual(-PIT);
    }
  });

  it('records the pits: the quays, the dry dock and the basement ramp', () => {
    const yard = bake('navalyard');
    const boxes = (m: BakedModel) =>
      Array.from({ length: (m.pits?.length ?? 0) / 5 }, (_, i) => m.pits!.slice(i * 5, i * 5 + 5));
    // The quay along the back, 8 m deep, and the dock running into the site from it.
    expect(boxes(yard)).toContainEqual([-60, 16, 60, 32, -8]);
    expect(boxes(yard).some(([x0, z0, x1, z1]) => x0 === -46 && x1 === -30 && z0! <= 0 && z1 === 32)).toBe(
      true,
    );
    expect(boxes(bake('coastalgun'))).toEqual([[-8, 6.5, 8, 8, -3]]);
    const ramp = boxes(bake('spyagency'));
    expect(ramp.every(([x0, , x1, , y]) => x0! >= 8 && x1! <= 12 && y === -2.9)).toBe(true);
    // Every other war building stands on its lot base whole.
    expect(bake('barracks').pits).toBeUndefined();
    expect(pitsOf(parseGlb(war('radar')).parts)).toEqual([]);
  });

  it('the lot base leaves its top out over a pit, and its sides open where one meets an edge', () => {
    const base = (m: BakedModel) => {
      const d = buildHandModel(m, { W: m.w, D: m.d, seed: 0, lit: 0.5, mirror: false, base: PALETTES.pave });
      const top: number[][] = [];
      const sides: number[][] = [];
      for (let i = 0; i < d.pos.length; i += 9) {
        const v = Array.from(d.pos.subarray(i, i + 9));
        if ([1, 4, 7].every((k) => Math.abs(v[k]! - BASE_TOP) < 1e-6)) top.push(v);
        else if ([1, 4, 7].some((k) => v[k] === -5)) sides.push(v);
      }
      return { top, sides };
    };
    const inside = (v: number[], x0: number, z0: number, x1: number, z1: number) => {
      const cx = (v[0]! + v[3]! + v[6]!) / 3;
      const cz = (v[2]! + v[5]! + v[8]!) / 3;
      return cx > x0 && cx < x1 && cz > z0 && cz < z1;
    };
    const yard = base(bake('navalyard'));
    expect(yard.top.length).toBeGreaterThan(2);
    // No paving over the dock or the quay.
    expect(yard.top.filter((v) => inside(v, -46, -1.5, -30, 32) || inside(v, -60, 16, 60, 32))).toEqual([]);
    // The back stands in deep water: no stone wall closes the dock's mouth or hides the quay.
    expect(yard.sides.filter((v) => [2, 5, 8].every((k) => Math.abs(v[k]! - 32) < 1e-6))).toEqual([]);
    // The coastal gun's quay: stone below its foot (−3 m) only.
    const gun = base(bake('coastalgun'));
    const back = gun.sides.filter((v) => [2, 5, 8].every((k) => Math.abs(v[k]! - 8) < 1e-6));
    expect(back.length).toBeGreaterThan(0);
    expect(Math.max(...back.flatMap((v) => [v[1]!, v[4]!, v[7]!]))).toBeCloseTo(-3, 5);
    // A building without pits keeps the whole base: two triangles on top, two each side.
    const plain = base(bake('radar'));
    expect(plain.top).toHaveLength(2);
    expect(plain.sides).toHaveLength(8);
  });

  it('lights the atom silo’s searchlights at night, in their own colour', () => {
    const silo = bake('atomsilo');
    const light = ROLES.indexOf('light');
    const lamps = [...silo.triRole].filter((r, t) => r === light && silo.triFlags[t]! & TRI_NEAR).length;
    expect(lamps).toBeGreaterThan(0);
    const d = buildHandModel(silo, { W: 40, D: 40, seed: 3, lit: 0.5, mirror: false, base: PALETTES.pave });
    const lit = [...d.emi].filter((e) => e === 1).length;
    expect(lit).toBe(lamps * 3);
    // Never repainted: the file's colour (the lamps are full bright, no darkening at the foot).
    const [r, g, b] = silo.colors[light]!;
    const i = d.emi.indexOf(1);
    expect([d.col[i * 3], d.col[i * 3 + 1], d.col[i * 3 + 2]].map((c) => c!.toFixed(4))).toEqual(
      [r, g, b].map((c) => c.toFixed(4)),
    );
  });

  it('turns an open part’s odd faces round, and finds a box left without a top', () => {
    // A box open at the bottom (a tyre stack) with its +x side wound inside out.
    const q = (a: number[], b: number[], c: number[], d: number[]) => [...a, ...b, ...c, ...a, ...c, ...d];
    const [x0, x1, y0, y1, z0, z1] = [0, 1, 0, 1, 0, 1];
    const faces = [
      q([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]), // top
      q([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]), // −z
      q([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]), // +z
      q([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]), // −x
    ];
    const plusX = q([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]);
    const wrong = q([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]);
    const good = new Float32Array([...faces.flat(), ...plusX]);
    const bad = new Float32Array([...faces.flat(), ...wrong]);
    expect(orientFaces(bad).turned).toBe(0); // open: the closed-part fix can't help
    expect(orientOpen(good).turned).toBe(0);
    const fixed = orientOpen(bad);
    expect(fixed.turned).toBe(2);
    // The +x side's two triangles, each with two corners swapped: wound outward again.
    const turn = (t: number[]) =>
      t.map((_, i) => t[Math.floor(i / 9) * 9 + [0, 1, 2, 6, 7, 8, 3, 4, 5][i % 9]!]!);
    expect(Array.from(fixed.tris.subarray(72))).toEqual(turn(wrong));
    expect(orientOpen(fixed.tris).turned).toBe(0);
    // A box with a bottom and sides but no top shows a hole from above.
    const bottom = q([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    expect(openTop(new Float32Array([...faces.slice(1).flat(), ...plusX, ...bottom]))).toBe(true);
    expect(openTop(new Float32Array([...faces.flat(), ...plusX, ...bottom]))).toBe(false);
  });
});

describe('units (unit spec v1)', () => {
  it('passes every delivered unit, the ones the game has yet and the ones for later', () => {
    const b = buildWarModels();
    expect(b.unitReports).toHaveLength(18);
    for (const r of b.unitReports) expect(r.errors, r.id).toEqual([]);
    const later = b.unitReports.filter((r) => !r.known).map((r) => r.kind);
    // The superweapons came into the game in M37; the atom bomb waits for M40.
    expect(later.sort()).toEqual(['atombomb']);
    expect(b.units.map((u) => u.kind)).toContain('windupbot');
  });

  it('bakes the light tank: parts with pivots at their node origins, the barrel on the turret', () => {
    const u = bakeU('unit-tank');
    expect(u.kind).toBe('tank');
    const names = u.parts.map((p) => p.name);
    expect(names.filter((n) => n === 'wheel')).toHaveLength(8);
    const k = (name: string) => names.indexOf(name) + 1;
    const turret = u.parts[k('turret') - 1]!;
    expect(turret).toEqual({ name: 'turret', parent: 0, pivot: [0, 1.85, 0.475] });
    expect(u.parts[k('barrel') - 1]).toEqual({
      name: 'barrel',
      parent: k('turret'),
      pivot: [0, 2.2, -0.625],
    });
    expect(u.parts[k('hatch') - 1]!.parent).toBe(k('turret'));
    expect(u.parts[k('track_left') - 1]).toMatchObject({ parent: 0, pivot: [-1.255, 0.575, 0.125] });
    // The muzzle is a marker on the barrel, not drawn.
    expect(u.muzzles).toEqual([{ part: k('barrel'), at: [0, 2.2, -3.275] }]);
    expect(u.counts.file - u.counts.near).toBe(12);
    // Triangles by part: the turret's own, the barrel's, and the body's (hull, headlights).
    const count = (part: number) => [...u.triPart].filter((p) => p === part).length;
    expect(count(k('turret'))).toBe(92);
    expect(count(k('barrel'))).toBe(56);
    expect(count(k('hatch'))).toBe(28);
    expect(count(0)).toBe(140);
    // Roles from the unit spec: the headlights glow, the hull is the owner's colour.
    expect(u.triRole.some((r) => UNIT_ROLES[r] === 'light')).toBe(true);
    expect(u.triRole.some((r) => UNIT_ROLES[r] === 'body')).toBe(true);
    expect(u.size[0]).toBeCloseTo(6.7, 2);
    expect(u.depth).toBe(0);
  });

  it('bakes the wind-up robot: limbs at shoulders and hips with everything on them, the key on its axle', () => {
    const u = bakeU('unit-windupbot');
    expect(u.kind).toBe('windupbot');
    const part = (name: string) => u.parts.find((p) => p.name === name)!;
    expect(part('arm_left')).toEqual({ name: 'arm_left', parent: 0, pivot: [-4.425, 19.4, -0.5] });
    expect(part('arm_right').pivot).toEqual([4.425, 19.4, -0.5]);
    expect(part('leg_left').pivot).toEqual([-2.05, 8.35, -0.5]);
    expect(part('windup_key').pivot).toEqual([0, 16.3, 3.925]);
    // The arm takes its shoulder, elbow, forearm, hand and claws: 44 + 64 + 48 + 44 + 44 + 44 + 36 × 2.
    const arm = u.parts.indexOf(part('arm_left')) + 1;
    expect([...u.triPart].filter((p) => p === arm)).toHaveLength(360);
    // Every vertex of the left arm's triangles is on the robot's left (−x), none on the body.
    for (let t = 0; t < u.triPart.length; t++) {
      if (u.triPart[t] !== arm) continue;
      for (let k = 0; k < 3; k++) expect(u.positions[u.index[t * 3 + k]! * 3]!).toBeLessThan(-2);
    }
    expect(u.muzzles).toEqual([]);
    expect(u.counts.far).toBeLessThan(u.counts.near);
    expect(u.counts.far).toBeGreaterThan(u.counts.near / 2);
  });

  it('marks exhausts where the smoke comes out, and still draws them', () => {
    const tank = bakeU('unit-heavytank');
    expect(tank.exhausts).toEqual([{ part: 0, at: [1.35, 2.45, 3.365] }]); // the top of its stack
    expect(bakeU('unit-fighter').exhausts[0]!.at[2]).toBeCloseTo(6.5, 3); // the end of its tail
    expect(bakeU('unit-atombomb').exhausts[0]!.at[1]).toBeCloseTo(0.9, 3); // under the rocket
    expect(bakeU('unit-gunboat').exhausts[0]!.at[1]).toBeCloseTo(10.45, 3); // the funnel's top
    expect(tank.counts.near).toBe(tank.counts.file - 12);
  });

  it('never turns the whale’s mouth round: its faces look into it on purpose', () => {
    expect(INSIDE_OUT.clockworkwhale).toEqual(['mouth', 'jaw_inside']);
    const file = parseGlb(war('unit-clockworkwhale'));
    const u = bakeU('unit-clockworkwhale');
    const key = (v: number[]) => v.map((x) => x.toFixed(3)).join(',');
    // Each baked triangle as its corners from the smallest, so the same winding matches.
    const baked = new Set<string>();
    for (let t = 0; t < u.triPart.length; t++) {
      const c = [0, 1, 2].map((k) =>
        key(Array.from(u.positions.subarray(u.index[t * 3 + k]! * 3, u.index[t * 3 + k]! * 3 + 3))),
      );
      const s = c.indexOf([...c].sort()[0]!);
      baked.add([c[s], c[(s + 1) % 3], c[(s + 2) % 3]].join('|'));
    }
    const mouth = file.parts.filter((p) => p.name === 'mouth' || p.name === 'jaw_inside');
    expect(mouth.length).toBeGreaterThan(0);
    for (const p of mouth)
      for (let i = 0; i < p.tris.length; i += 9) {
        const c = [0, 3, 6].map((o) =>
          key(Array.from(p.tris.subarray(i + o, i + o + 3)).map((v) => Math.round(v * 1000) / 1000)),
        );
        const s = c.indexOf([...c].sort()[0]!);
        expect(baked.has([c[s], c[(s + 1) % 3], c[(s + 2) % 3]].join('|'))).toBe(true);
      }
    // A sea unit: the waterline at 0, the hull below.
    expect(u.depth).toBeGreaterThan(8);
  });

  it('refuses a unit missing a part its prompt names, the wrong size, or not resting on the ground', () => {
    const tank = new Uint8Array(war('unit-tank'));
    const rename = editGlb(tank, (g) => {
      for (const n of g.nodes as { name?: string }[]) if (n.name === 'turret') n.name = 'dome';
    });
    expect(checkUnit(rename, 'unit-tank.glb', budgets).errors.join(' ')).toMatch(/turret \(0 found\)/);
    const big = editGlb(tank, (g) => {
      const scene = (g.scenes as { nodes: number[] }[])[0]!;
      (g.nodes as object[]).push({ name: 'big', children: scene.nodes, scale: [1.3, 1.3, 1.3] });
      scene.nodes = [(g.nodes as object[]).length - 1];
    });
    expect(checkUnit(big, 'unit-tank.glb', budgets).errors.join(' ')).toMatch(/more than 10 % off/);
    const up = editGlb(tank, (g) => {
      const scene = (g.scenes as { nodes: number[] }[])[0]!;
      (g.nodes as object[]).push({ name: 'up', children: scene.nodes, translation: [0, 2, 0] });
      scene.nodes = [(g.nodes as object[]).length - 1];
    });
    expect(checkUnit(up, 'unit-tank.glb', budgets).errors.join(' ')).toMatch(/floats 2 m above the ground/);
    // A ship has to go below its waterline; a tank under a boat's name is too small and dry.
    expect(checkUnit(tank, 'unit-gunboat.glb', budgets).ok).toBe(false);
    expect(checkUnit(tank, 'unit-nothing.glb', budgets).errors[0]).toMatch(/isn't a unit in the game/);
  });
});

describe('the war models file', () => {
  it('holds every war model, apart from the main file, and packs and unpacks them unchanged', () => {
    const b = buildWarModels();
    expect(b.reports).toHaveLength(21);
    for (const r of b.reports) expect(r.errors, r.id).toEqual([]);
    expect(b.models).toHaveLength(21);
    expect(b.units).toHaveLength(18);
    const back = decodeWarModels(b.bytes);
    expect(back.models.map((m) => m.id)).toEqual(b.models.map((m) => m.id));
    expect(back.units.map((u) => u.id)).toEqual(b.units.map((u) => u.id));
    for (const [i, u] of b.units.entries()) {
      const v = back.units[i]!;
      expect(v.parts).toEqual(u.parts);
      expect(v.muzzles).toEqual(u.muzzles);
      expect(v.exhausts).toEqual(u.exhausts);
      expect(Array.from(v.index)).toEqual(Array.from(u.index));
      expect(Array.from(v.triRole)).toEqual(Array.from(u.triRole));
      expect(Array.from(v.triPart)).toEqual(Array.from(u.triPart));
      expect(Array.from(v.triFar)).toEqual(Array.from(u.triFar));
      // 16-bit vertices: within a couple of millimetres on the biggest unit.
      let worst = 0;
      for (let k = 0; k < u.positions.length; k++)
        worst = Math.max(worst, Math.abs(v.positions[k]! - u.positions[k]!));
      expect(worst, u.id).toBeLessThan(0.002);
    }
    const yard = back.models.find((m) => m.id === 'navalyard')!;
    expect(yard.pits).toEqual(b.models.find((m) => m.id === 'navalyard')!.pits);
    // Units alone too, and an empty file.
    expect(decodeUnits(encodeUnits(b.units.slice(0, 2))).map((u) => u.id)).toEqual(
      b.units.slice(0, 2).map((u) => u.id),
    );
    expect(decodeWarModels(encodeWarModels([], []))).toEqual({ models: [], units: [] });
    expect(() => decodeWarModels(b.bytes.subarray(0, 1000))).toThrow();
  });

  it('leaves the main models file as it was: no war model, no pits, no light, the same format', () => {
    const main = buildModels();
    expect(main.reports).toHaveLength(modelFiles('assets/models').length);
    const ids = new Set(main.models.map((m) => m.id));
    for (const f of modelFiles(WAR_MODELS_DIR)) expect(ids.has(f.replace(/\.glb$/, ''))).toBe(false);
    const light = ROLES.indexOf('light');
    for (const m of main.models) {
      expect(m.pits, m.id).toBeUndefined();
      expect(m.triRole.includes(light), m.id).toBe(false);
    }
    const json = new TextDecoder().decode(
      main.bytes.subarray(8, 8 + new DataView(main.bytes.buffer).getUint32(4, true)),
    );
    expect(JSON.parse(json).version).toBe(3);
    expect(json).not.toContain('"pits"');
    expect(decodeModels(main.bytes)).toHaveLength(main.models.length);
  });

  it('refuses a war building dropped among the main models: that file loads in every city', () => {
    const root = mkdtempSync(join(tmpdir(), 'war-'));
    mkdirSync(join(root, 'assets/models'), { recursive: true });
    copyFileSync(`${WAR_MODELS_DIR}/barracks.glb`, join(root, 'assets/models/barracks.glb'));
    const b = buildModels(root);
    expect(b.models).toEqual([]);
    expect(b.reports[0]!.errors.join(' ')).toMatch(/a war building: put it in assets\/models\/war/);
  });
});
