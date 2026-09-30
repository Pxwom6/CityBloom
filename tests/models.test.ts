import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bakeModel,
  TRI_FAR,
  TRI_NEAR,
  TRI_PARTY_NEG,
  TRI_PARTY_POS,
  TRI_SKY,
  UNIT_WINDOW,
} from '../src/models/bake';
import { checkModel, formatReports, inspectModel } from '../src/models/check';
import { decodeModels, encodeModels } from '../src/models/codec';
import { GlbError, normaliseName, parseGlb } from '../src/models/glb';
import { ROLES, budgetFor, parseBudgets, targetOf } from '../src/models/spec';
import { BREAKS, breakModel, editGlb } from '../scripts/lib/breakModel';
import { buildModels, modelFiles } from '../scripts/lib/modelPipeline';

/** Stable copies of delivered models (assets/models changes as models arrive). */
const GOOD = 'tests/fixtures/models/good';
const good = (id: string) => readFileSync(`${GOOD}/${id}.glb`);
const budgets = parseBudgets(readFileSync('docs/models/PROMPTS.md', 'utf8'));

describe('model spec', () => {
  it('reads what a file name stands for from the game data', () => {
    expect(targetOf('R103')).toMatchObject({ kind: 'zoned', def: 'R103', design: 1, w: 24, d: 24 });
    expect(targetOf('R103-2')).toMatchObject({ kind: 'zoned', def: 'R103', design: 2 });
    expect(targetOf('I201')).toMatchObject({ kind: 'zoned', smokes: true });
    expect(targetOf('I211')).toMatchObject({ kind: 'zoned', smokes: false });
    expect(targetOf('firestation')).toMatchObject({ kind: 'civic', w: 24, d: 24, smokes: false });
    expect(targetOf('coal')).toMatchObject({ kind: 'civic', w: 40, d: 48, smokes: true });
    expect(targetOf('annex-engineBay')).toMatchObject({ kind: 'annex', def: 'engineBay', w: 9, d: 8 });
    expect(targetOf('annex-engineBay-2')).toMatchObject({ kind: 'annex', design: 2 });
    expect(targetOf('townhall')).toBeNull();
    expect(targetOf('R903')).toBeNull();
    expect(targetOf('annex-ballroom')).toBeNull();
  });

  it('reads triangle budgets from PROMPTS.md', () => {
    expect(budgets.get('firestation')).toBe(2000);
    expect(budgets.get('R001')).toBe(600);
    // The tenement has no prompt of its own: R103.glb takes the budget of its lot's prompt.
    expect(budgets.get('R103')).toBe(1800);
    expect(budgets.get('R103-2')).toBe(1800);
    expect(budgetFor('R001-3', budgets)).toBe(600);
    expect(budgets.get('annex-ward')).toBe(400);
    // Every building the prompts cover has one.
    expect(budgets.size).toBeGreaterThanOrEqual(135);
  });

  it('normalises exporter suffixes on names', () => {
    expect(normaliseName('Window.001')).toBe('window');
    expect(normaliseName('window_glass_12')).toBe('window_glass');
    expect(normaliseName(' Smoke Stack ')).toBe('smoke_stack');
    expect(normaliseName('wall_alt')).toBe('wall_alt');
  });
});

describe('GLB reader', () => {
  it('reads the tenement: every part named, transforms baked, outward winding', () => {
    const g = parseGlb(good('R103'));
    expect(g.parts).toHaveLength(174);
    expect(g.parts.reduce((s, p) => s + p.tris.length / 9, 0)).toBe(1474);
    expect(new Set(g.parts.map((p) => p.material))).toEqual(
      new Set([
        'wall_alt',
        'wall',
        'trim',
        'roof',
        'frame',
        'glass',
        'metal',
        'sign',
        'awning',
        'door',
        'wood',
      ]),
    );
    expect(g.images + g.textures).toBe(0);
    // Window panes sit in groups named window, turned to face out of each wall.
    const panes = g.parts.filter((p) => p.name === 'window_glass');
    expect(panes).toHaveLength(64);
    expect(panes.every((p) => p.path.includes('window'))).toBe(true);
    // The front (storefront glass) is at −z and its triangles face −z.
    const shop = g.parts.find((p) => p.name === 'storefront_glass')!;
    const t = shop.tris;
    const nz = (t[3]! - t[0]!) * (t[7]! - t[1]!) - (t[4]! - t[1]!) * (t[6]! - t[0]!);
    expect(nz).toBeLessThan(0);
    expect(Math.max(...Array.from(t).filter((_, i) => i % 3 === 2))).toBeLessThan(-8);
    // Colours are the file's linear base colours: brick walls.
    const wall = g.parts.find((p) => p.material === 'wall')!;
    expect(wall.color[0]).toBeGreaterThan(wall.color[2]);
  });

  it('refuses what is not a GLB', () => {
    expect(() => parseGlb(new Uint8Array(40))).toThrow(GlbError);
    expect(() => parseGlb(new TextEncoder().encode('not a model at all, just text'))).toThrow(GlbError);
    expect(() => parseGlb(good('police').subarray(0, 5000))).toThrow(GlbError);
  });
});

describe('models:check', () => {
  it('passes good models', () => {
    for (const id of ['police', 'coal', 'R001', 'landfill', 'R201']) {
      const r = checkModel(good(id), `${id}.glb`, budgets);
      expect(r.errors, id).toEqual([]);
      expect(r.ok).toBe(true);
      expect(r.footprint).toMatchObject({ w: r.target!.w, d: r.target!.d, abreast: 1 });
      expect(r.triangles).toBeLessThanOrEqual(r.budget!);
    }
    expect(checkModel(good('coal'), 'coal.glb', budgets).stacks).toBe(2);
    expect(checkModel(good('R001'), 'R001.glb', budgets).trees).toBe(1);
  });

  it('passes the tenement as a row model: 8 m wide, three abreast on its 24 m lot', () => {
    const r = checkModel(good('R103'), 'R103.glb', budgets);
    expect(r.ok).toBe(true);
    expect(r.footprint).toEqual({ w: 8, d: 16, abreast: 3 });
    expect(r.windows).toBe(64);
    expect(r.triangles).toBe(1474);
    // It says what it let through: a shallow model with overhanging trim.
    expect(r.warnings.join(' ')).toMatch(/16 m deep on a 24 m lot/);
    expect(r.warnings.join(' ')).toMatch(/overhang/);
  });

  it('catches deliberately broken models, each for its own reason', () => {
    const fails = (id: string, how: string, name = `${id}.glb`) => {
      const r = checkModel(breakModel(good(id), how), name, budgets);
      expect(r.ok, `${id} ${how}`).toBe(false);
      return r.errors.join(' | ');
    };
    expect(fails('police', 'turn')).toMatch(/front faces \+Z/);
    expect(fails('police', 'quarter')).toMatch(/front faces along X/);
    expect(fails('police', 'shift')).toMatch(/origin isn't at the centre/);
    expect(fails('police', 'scale')).toMatch(/is 26\.4 × 26\.4 m; its site is 24 × 24 m/);
    expect(fails('police', 'float')).toMatch(/floats 1 m above the ground/);
    expect(fails('police', 'sink')).toMatch(/below the ground/);
    expect(fails('police', 'texture')).toMatch(/has textures/);
    expect(fails('police', 'material')).toMatch(/materials that aren't roles.*bricks/);
    expect(fails('police', 'noglass')).toMatch(/window groups? ha(s|ve) no window_glass/);
    expect(fails('coal', 'nostack')).toMatch(/no part named smoke_stack/);
    // A good model under the wrong name: another building's site, or no building at all.
    expect(checkModel(good('police'), 'hospital.glb', budgets).errors.join(' ')).toMatch(
      /is 24 × 24 m; its site is 40 × 40 m/,
    );
    expect(checkModel(good('police'), 'townhall.glb', budgets).errors.join(' ')).toMatch(
      /isn't a building in the game/,
    );
    // Over budget.
    expect(checkModel(good('police'), 'police.glb', new Map([['police', 500]])).errors.join(' ')).toMatch(
      /1,260 triangles, over its budget of 500/,
    );
    // Not a model at all: a failed report, not a crash.
    const junk = checkModel(new Uint8Array([1, 2, 3]), 'police.glb', budgets);
    expect(junk.ok).toBe(false);
    expect(junk.errors[0]).toMatch(/not a GLB/);
    // A damaged file: a part thrown to infinity, or a kilometre away.
    for (const y of [1e30, 'NaN', 20000]) {
      const far = checkModel(
        editGlb(good('police'), (g) => {
          const scene = (g.scenes as { nodes: number[] }[])[0]!;
          const nodes = g.nodes as unknown[];
          nodes.push({ children: scene.nodes, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, y, 0, 1] });
          scene.nodes = [nodes.length - 1];
        }),
        'police.glb',
        budgets,
      );
      expect(far.ok, String(y)).toBe(false);
      expect(far.errors[0], String(y)).toMatch(/coordinate that isn't a number, or is out of range/);
    }
    // A colour that isn't one.
    const paint = checkModel(
      editGlb(good('police'), (g) => {
        const m = (g.materials as { pbrMetallicRoughness?: { baseColorFactor?: unknown } }[])[0]!;
        m.pbrMetallicRoughness = { baseColorFactor: ['red', 0, 0, 1] };
      }),
      'police.glb',
      budgets,
    );
    expect(paint.ok).toBe(false);
    expect(paint.errors[0]).toMatch(/colour that isn't a number/);
  });

  it('catches a wall that hangs in the air, but not one that spans', () => {
    // As delivered: the school's gable, slid half its length along the roof.
    const r = checkModel(readFileSync('tests/fixtures/models/broken/primary.glb'), 'primary.glb', budgets);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/a wall hangs in the air: gable hangs 9 m past what is under it/);
    // The coal plant's conveyor and turbine hall, the tower's storeys on its podium: all held up.
    for (const id of ['coal', 'R201', 'convention', 'landfill'])
      expect(checkModel(good(id), `${id}.glb`, budgets).errors.join(' '), id).not.toMatch(/hangs/);
  });

  it('knows a row model from one that is simply the wrong size', () => {
    // Half as wide as its lot: two abreast.
    const half = editGlb(good('R201'), (g) => {
      const scene = (g.scenes as { nodes: number[] }[])[0]!;
      (g.nodes as unknown[]).push({
        children: scene.nodes,
        matrix: [0.5, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      });
      scene.nodes = [(g.nodes as unknown[]).length - 1];
    });
    expect(checkModel(half, 'R201.glb', budgets).footprint).toMatchObject({ w: 8, abreast: 2 });
    // Three quarters as wide: neither the lot nor a row.
    const odd = editGlb(good('R201'), (g) => {
      const scene = (g.scenes as { nodes: number[] }[])[0]!;
      (g.nodes as unknown[]).push({
        children: scene.nodes,
        matrix: [0.75, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      });
      scene.nodes = [(g.nodes as unknown[]).length - 1];
    });
    expect(checkModel(odd, 'R201.glb', budgets).errors.join(' ')).toMatch(
      /is 12 × 24 m; its lot is 16 × 24 m/,
    );
  });

  it('prints a plain report, failures with their reasons', () => {
    const reports = [
      checkModel(good('police'), 'police.glb', budgets),
      checkModel(breakModel(good('coal'), 'nostack'), 'coal.glb', budgets),
    ];
    const text = formatReports(reports);
    expect(text).toMatch(
      /^ok {4}police\.glb\s+Police station: 24 × 24 m, 8\.44 m tall, 1,260 of 1,800 triangles/m,
    );
    expect(text).toMatch(/^FAIL {2}coal\.glb\s+Coal power plant: skipped/m);
    expect(text).toMatch(/2 models: 1 pass, 1 fail and are skipped/);
  });

  it('every kind of break is caught on a model it applies to', () => {
    for (const how of Object.keys(BREAKS)) {
      const id = how === 'nostack' ? 'coal' : 'police';
      expect(checkModel(breakModel(good(id), how), `${id}.glb`, budgets).ok, how).toBe(false);
    }
  });
});

describe('conversion', () => {
  const bake = (id: string, name = `${id}.glb`) => {
    const { report, file } = inspectModel(good(id), name, budgets);
    return bakeModel(file!, report);
  };

  it('bakes the tenement: roles, window units, party walls and three levels of detail', () => {
    const m = bake('R103');
    expect(m).toMatchObject({ id: 'R103', kind: 'zoned', def: 'R103', design: 1, w: 8, d: 16, party: true });
    expect(m.h).toBeCloseTo(25.8, 1);
    expect(m.over.front).toBeCloseTo(1.51, 1);
    const n = m.triRole.length;
    expect(m.index).toHaveLength(n * 3);
    expect(m.counts.file).toBe(1474);
    // Hidden faces (frame backs inside the walls, faces between stacked boxes) are gone.
    expect(m.counts.near).toBe(n);
    expect(n).toBeLessThan(1474 * 0.9);
    // Far and skyline versions are picked from the same triangles, each smaller than the last.
    expect(m.counts.far).toBeLessThan(n * 0.6);
    expect(m.counts.sky).toBeLessThan(m.counts.far);
    expect(m.counts.sky).toBeGreaterThan(100);
    for (let t = 0; t < n; t++) {
      expect(m.triFlags[t]! & TRI_NEAR).toBeTruthy();
      expect(m.triRole[t]!).toBeLessThan(ROLES.length);
    }
    // 64 windows and the shopfront light up, one unit each.
    expect(m.units).toHaveLength(65);
    expect([...m.units].filter((k) => k === UNIT_WINDOW)).toHaveLength(64);
    const lit = new Set<number>();
    for (let t = 0; t < n; t++) if (m.triUnit[t]) lit.add(m.triUnit[t]!);
    expect(lit.size).toBe(65);
    // Every pane is still there in the skyline, as a flat panel.
    const skyUnits = new Set<number>();
    for (let t = 0; t < n; t++) if (m.triUnit[t] && m.triFlags[t]! & TRI_SKY) skyUnits.add(m.triUnit[t]!);
    expect(skyUnits.size).toBe(65);
    // Side-wall windows are marked, to drop where a neighbour in the row hides them.
    const pos = [...m.triFlags].filter((f) => f & TRI_PARTY_POS).length;
    const neg = [...m.triFlags].filter((f) => f & TRI_PARTY_NEG).length;
    expect(pos).toBeGreaterThan(100);
    expect(neg).toBeGreaterThan(100);
    // Colours by role, as in the file: brick walls, slate roof.
    expect(
      Object.keys(m.colors)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(
      ['wall', 'wall_alt', 'trim', 'roof', 'glass', 'frame', 'door', 'awning', 'sign', 'metal', 'wood']
        .map((r) => ROLES.indexOf(r as (typeof ROLES)[number]))
        .sort((a, b) => a - b),
    );
  });

  it('keeps every triangle wound outward and inside the model', () => {
    for (const id of ['R103', 'police', 'R201', 'coal']) {
      const m = bake(id);
      let outward = 0;
      for (let t = 0; t < m.triRole.length; t++) {
        const [a, b, c] = [m.index[t * 3]!, m.index[t * 3 + 1]!, m.index[t * 3 + 2]!];
        const p = (i: number, k: number) => m.positions[i * 3 + k]!;
        // Walls' faces look away from the middle of the building more often than not.
        const nx = (p(b, 1) - p(a, 1)) * (p(c, 2) - p(a, 2)) - (p(b, 2) - p(a, 2)) * (p(c, 1) - p(a, 1));
        const nz = (p(b, 0) - p(a, 0)) * (p(c, 1) - p(a, 1)) - (p(b, 1) - p(a, 1)) * (p(c, 0) - p(a, 0));
        if (Math.abs(nx) + Math.abs(nz) > 1e-6 && nx * p(a, 0) + nz * p(a, 2) > 0) outward++;
        for (const i of [a, b, c]) expect(p(i, 1)).toBeGreaterThanOrEqual(-0.01);
      }
      expect(outward / m.triRole.length, id).toBeGreaterThan(0.4);
    }
  });

  it('turns markers into places: a tree in the cottage garden, smoke from the stack tops', () => {
    const cottage = bake('R001');
    expect(cottage.trees).toHaveLength(3);
    expect(cottage.trees[1]).toBeCloseTo(0.05, 1);
    // The marker cube itself isn't drawn.
    expect(cottage.counts.file).toBe(checkModel(good('R001'), 'R001.glb', budgets).triangles);
    const coal = bake('coal');
    expect(coal.stacks).toHaveLength(6);
    // Two tall stacks at the back right, as the prompt asks (50-58 m).
    for (const k of [0, 3]) {
      expect(coal.stacks[k]!).toBeGreaterThan(5);
      expect(coal.stacks[k + 1]!).toBeGreaterThan(48);
      expect(coal.stacks[k + 2]!).toBeGreaterThan(5);
    }
    // The landfill's heap is tagged for the game to raise.
    const landfill = bake('landfill');
    expect([...landfill.triGroup].filter((g) => g === 1).length).toBeGreaterThan(300);
    expect(bake('police').triGroup.every((g) => g === 0)).toBe(true);
  });

  it('distant versions keep what holds a kept part up, and long lines along the roof', () => {
    // The tenement's water tank stands on four legs 0.35 m square: far too thin to keep for
    // themselves, but the tank stays, so they do (or it would hang in the air).
    const { file } = inspectModel(good('R103'), 'R103.glb', budgets);
    const m = bake('R103');
    const legs = file!.parts.filter((p) => p.name === 'tank_leg');
    expect(legs).toHaveLength(4);
    const inLeg = (t: number) => {
      const i = m.index[t * 3]! * 3;
      const [x, y, z] = [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!];
      return legs.some((l) => {
        let hit = false;
        for (let k = 0; k < l.tris.length; k += 3)
          if (
            Math.abs(l.tris[k]! - x) < 0.002 &&
            Math.abs(l.tris[k + 1]! - y) < 0.002 &&
            Math.abs(l.tris[k + 2]! - z) < 0.002
          )
            hit = true;
        return hit;
      });
    };
    let farLegs = 0;
    let skyLegs = 0;
    for (let t = 0; t < m.triRole.length; t++) {
      if (m.triRole[t] !== ROLES.indexOf('metal') || !inLeg(t)) continue;
      if (m.triFlags[t]! & TRI_FAR) farLegs++;
      if (m.triFlags[t]! & TRI_SKY) skyLegs++;
    }
    expect(farLegs).toBeGreaterThanOrEqual(4 * 8);
    expect(skyLegs).toBeGreaterThanOrEqual(4 * 8);
    // The parapets round the roof (0.3 m thick, 8 and 16 m long) stay in the far version.
    const trim = ROLES.indexOf('trim');
    let farParapet = 0;
    for (let t = 0; t < m.triRole.length; t++) {
      const y = m.positions[m.index[t * 3]! * 3 + 1]!;
      if (m.triRole[t] === trim && y > 18.5 && m.triFlags[t]! & TRI_FAR) farParapet++;
    }
    expect(farParapet).toBeGreaterThan(20);
  });

  it('distant versions keep the big shapes and every pane that lights', () => {
    const tower = bake('R201');
    expect(tower.counts.far).toBeLessThan(tower.counts.near * 0.65);
    expect(tower.counts.sky).toBeLessThan(tower.counts.near * 0.3);
    const n = tower.triRole.length;
    const wall = ROLES.indexOf('wall');
    const walls = [...tower.triRole].filter((r) => r === wall).length;
    let skyWalls = 0;
    const panes = new Set<number>();
    const skyPanes = new Set<number>();
    for (let t = 0; t < n; t++) {
      if (tower.triRole[t] === wall && tower.triFlags[t]! & TRI_SKY) skyWalls++;
      if (tower.triUnit[t]) {
        panes.add(tower.triUnit[t]!);
        if (tower.triFlags[t]! & TRI_FAR) skyPanes.add(tower.triUnit[t]!);
      }
    }
    // Walls lose only what never shows from above (faces looking down).
    expect(skyWalls).toBeGreaterThan(walls * 0.7);
    expect(skyPanes.size).toBe(panes.size);
  });

  it('hides only faces that are inside a real box: a saw-tooth roof keeps every glazed face', () => {
    // Three wedges side by side, each with a skylight in its upright face. A wedge fills only
    // half its bounding box: the next tooth's upright face and its glass stand in the open.
    const m = bake('I011');
    const upright = new Set<number>();
    for (let t = 0; t < m.triRole.length; t++) {
      if (!m.triUnit[t] || !(m.triFlags[t]! & TRI_NEAR)) continue;
      const [a, b, c] = [0, 1, 2].map((k) => m.index[t * 3 + k]! * 3);
      const y = Math.min(m.positions[a + 1]!, m.positions[b + 1]!, m.positions[c + 1]!);
      const x = [m.positions[a]!, m.positions[b]!, m.positions[c]!];
      // A pane above the eaves, in a plane of constant x, looking along +x.
      if (y > 5 && Math.abs(x[0]! - x[1]!) < 1e-3 && Math.abs(x[0]! - x[2]!) < 1e-3)
        upright.add(Math.round(x[0]! * 10));
    }
    expect(upright.size).toBeGreaterThanOrEqual(3);
  });

  it('keeps a glazed room in the distant versions, and a pane as a flat panel', () => {
    // The hospital's lobby stands 6 m out of the main block: its glass walls stay.
    const m = bake('hospital');
    let lobbyFar = 0;
    let lobbySky = 0;
    for (let t = 0; t < m.triRole.length; t++) {
      if (ROLES[m.triRole[t]!] !== 'shop_glass') continue;
      if (m.triFlags[t]! & TRI_FAR) lobbyFar++;
      if (m.triFlags[t]! & TRI_SKY) lobbySky++;
    }
    expect(lobbyFar).toBeGreaterThanOrEqual(6);
    expect(lobbySky).toBeGreaterThanOrEqual(6);
    // A window pane in a wall is two triangles far away, not a box.
    const t = bake('R103');
    const perUnit = new Map<number, number>();
    for (let k = 0; k < t.triRole.length; k++)
      if (t.triUnit[k] && t.triFlags[k]! & TRI_SKY)
        perUnit.set(t.triUnit[k]!, (perUnit.get(t.triUnit[k]!) ?? 0) + 1);
    expect(Math.max(...perUnit.values())).toBeLessThanOrEqual(4);
  });

  it('the skyline keeps what would change how a building reads, and no loose ends', () => {
    const tris = (m: ReturnType<typeof bake>, role: string, flag: number) => {
      const out: { minY: number; maxY: number }[] = [];
      for (let t = 0; t < m.triRole.length; t++) {
        if (ROLES[m.triRole[t]!] !== role || !(m.triFlags[t]! & flag)) continue;
        const ys = [0, 1, 2].map((k) => m.positions[m.index[t * 3 + k]! * 3 + 1]!);
        out.push({ minY: Math.min(...ys), maxY: Math.max(...ys) });
      }
      return out;
    };
    // The tenement: white frames are a quarter of the facade's brightness, so their outward
    // faces stay (two triangles a window); the fire escape goes whole, not flights without
    // landings (the only metal left is up on the roof, under the water tank).
    const t = bake('R103');
    expect(tris(t, 'frame', TRI_SKY).length).toBe(64 * 2 + 0);
    expect(tris(t, 'metal', TRI_FAR).some((f) => f.maxY < 20)).toBe(true);
    expect(tris(t, 'metal', TRI_SKY).every((f) => f.minY > 18)).toBe(true);
    // The tower's crown: a ring on four posts that run on past it. The posts stay with the ring.
    const tower = bake('R203');
    const ring = tris(tower, 'accent', TRI_SKY).filter((f) => f.minY > 70);
    expect(ring.length).toBeGreaterThan(0);
    const under = Math.min(...ring.map((f) => f.minY));
    const posts = tris(tower, 'trim', TRI_SKY).filter((f) => f.minY < under - 2 && f.maxY > under);
    expect(posts.length).toBeGreaterThanOrEqual(8);
    // … and the ring's underside, which casts its shadow on the roof below.
    expect(ring.some((f) => f.maxY - f.minY < 1e-3 && Math.abs(f.minY - under) < 1e-3)).toBe(true);
  });

  it('puts walls back on the edge of the footprint after packing, so rows meet', () => {
    const m = bake('R103');
    const [back] = decodeModels(encodeModels([m]));
    let onEdge = 0;
    for (let i = 0; i < back!.positions.length; i += 3) {
      const x = Math.abs(back!.positions[i]!);
      // Exactly on the party line, or clearly off it: never a fraction of a millimetre out.
      if (x === 4) onEdge++;
      else expect(Math.abs(x - 4)).toBeGreaterThan(1e-3);
    }
    expect(onEdge).toBeGreaterThan(20);
  });

  it('packs and unpacks the models file without changing the models', () => {
    const models = ['R103', 'police', 'coal', 'R001', 'landfill'].map((id) => bake(id));
    const bytes = encodeModels(models);
    const back = decodeModels(bytes);
    expect(back).toHaveLength(models.length);
    for (let i = 0; i < models.length; i++) {
      const a = models[i]!;
      const b = back[i]!;
      expect(b.id).toBe(a.id);
      expect({ w: b.w, d: b.d, party: b.party, counts: b.counts, colors: b.colors }).toEqual({
        w: a.w,
        d: a.d,
        party: a.party,
        counts: a.counts,
        colors: a.colors,
      });
      expect(b.trees).toEqual(a.trees);
      expect(b.stacks).toEqual(a.stacks);
      expect([...b.index]).toEqual([...a.index]);
      expect([...b.triRole]).toEqual([...a.triRole]);
      expect([...b.triFlags]).toEqual([...a.triFlags]);
      expect([...b.triUnit]).toEqual([...a.triUnit]);
      expect([...b.triGroup]).toEqual([...a.triGroup]);
      expect([...b.units]).toEqual([...a.units]);
      // Vertices keep to a few millimetres.
      for (let k = 0; k < a.positions.length; k++)
        expect(Math.abs(b.positions[k]! - a.positions[k]!)).toBeLessThan(0.003);
    }
    // About 15 bytes a triangle.
    const tris = models.reduce((s, m) => s + m.triRole.length, 0);
    expect(bytes.length / tris).toBeLessThan(24);
    expect(() => decodeModels(new Uint8Array(16))).toThrow();
  });
});

describe('the models in assets/models', () => {
  it('each either passes and converts, or fails with a reason; none crash the build', () => {
    const build = buildModels();
    expect(build.reports).toHaveLength(modelFiles('assets/models').length);
    for (const r of build.reports) {
      if (r.ok) expect(r.errors).toEqual([]);
      else expect(r.errors.length, r.id).toBeGreaterThan(0);
    }
    const passed = build.reports.filter((r) => r.ok).map((r) => r.id);
    expect(build.models.map((m) => m.id)).toEqual(passed);
    expect(decodeModels(build.bytes).map((m) => m.id)).toEqual(passed);
    // The first hand-made model is among them.
    expect(passed).toContain('R103');
    for (const m of build.models) {
      expect(m.counts.far, m.id).toBeLessThanOrEqual(m.counts.near);
      expect(m.counts.sky, m.id).toBeLessThanOrEqual(m.counts.far);
      expect(m.counts.sky, m.id).toBeGreaterThan(0);
    }
  });
});
