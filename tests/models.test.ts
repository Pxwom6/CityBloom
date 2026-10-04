import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bakeModel,
  TRI_FAR,
  TRI_NEAR,
  TRI_PARTY_NEG,
  TRI_PARTY_POS,
  TRI_SKY,
  UNIT_BAND,
  UNIT_DARK,
  UNIT_WINDOW,
  type BakedModel,
} from '../src/models/bake';
import { checkModel, formatReports, frontEvidence, inspectModel } from '../src/models/check';
import { decodeModels, encodeModels } from '../src/models/codec';
import { GlbError, normaliseName, parseGlb } from '../src/models/glb';
import { ROLES, budgetFor, targetOf } from '../src/models/spec';
import { BREAKS, breakModel, editGlb } from '../scripts/lib/breakModel';
import { buildModels, modelFiles, readBudgets } from '../scripts/lib/modelPipeline';

/** Stable copies of delivered models (assets/models changes as models arrive). */
const GOOD = 'tests/fixtures/models/good';
const good = (id: string) => readFileSync(`${GOOD}/${id}.glb`);
const budgets = readBudgets();

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

  it('reads triangle budgets from every batch of prompts, a later batch winning', () => {
    // Batch 2 (PROMPTS-2.md): designs sized for the lots buildings stand on.
    expect(budgets.get('R013-2')).toBe(900);
    expect(budgets.get('C002-2')).toBe(500);
    expect(budgets.get('R213-2')).toBe(2500);
    expect(budgets.get('R013')).toBe(1100);
    expect(budgets.size).toBeGreaterThanOrEqual(175);
    // Batches in number order (not as their names sort): a remake's budget is its latest prompt's.
    const root = mkdtempSync(join(tmpdir(), 'prompts-'));
    mkdirSync(join(root, 'docs/models'), { recursive: true });
    const prompt = (n: number) => `### Cottage (\`R001.glb\`)\n\nSave as R001.glb. Budget ${n} triangles.\n`;
    writeFileSync(join(root, 'docs/models/PROMPTS.md'), prompt(100));
    writeFileSync(join(root, 'docs/models/PROMPTS-2.md'), prompt(200));
    writeFileSync(join(root, 'docs/models/PROMPTS-10.md'), prompt(300));
    writeFileSync(join(root, 'docs/models/notes.md'), prompt(999));
    expect(readBudgets(root).get('R001')).toBe(300);
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

  it('accepts a zoned model narrower or shallower than its lot by whole cells', () => {
    // The industrial complex's lot is 24 × 32 m; most of them stand on 16 m lots, 24 or 32 deep.
    const r = checkModel(good('I113-2'), 'I113-2.glb', budgets);
    expect(r.errors).toEqual([]);
    expect(r.footprint).toEqual({ w: 16, d: 24, abreast: 0 });
    expect(r.budget).toBe(2000);
    expect(r.warnings.join(' ')).toMatch(/24 m deep on a 32 m lot/);
    expect(formatReports([r])).toMatch(/16 × 24 m, for lots 16 m wide and 24–32 m deep/);
    // But not a size between cells (and not a half or a third of the lot's width, 12 or 8 m).
    const odd = editGlb(good('I113-2'), (g) => {
      const scene = (g.scenes as { nodes: number[] }[])[0]!;
      (g.nodes as unknown[]).push({
        children: scene.nodes,
        matrix: [0.6, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      });
      scene.nodes = [(g.nodes as unknown[]).length - 1];
    });
    expect(checkModel(odd, 'I113-2.glb', budgets).errors.join(' ')).toMatch(
      /is 9\.6 × 24 m; its lot is 24 × 32 m \(or narrower or shallower by whole 8 m cells/,
    );
  });

  it('counts a canopy over garage doors as a loading dock, not an entrance', () => {
    // The second factory: a door at the front, loading docks down one side under a canopy.
    const r = checkModel(good('I111-2'), 'I111-2.glb', budgets);
    expect(r.errors).toEqual([]);
    const e = frontEvidence(parseGlb(good('I111-2')).parts);
    expect(e.seen.join(' ')).not.toMatch(/canopy/);
    expect(e.road).toBeGreaterThan(e.back * 1.5);
    // An entrance canopy still counts (the complex's, over its office door).
    expect(frontEvidence(parseGlb(good('I113-2')).parts).seen.join(' ')).toMatch(/canopy road/);
    // Turned round, it is still caught.
    const turned = (how: string) => checkModel(breakModel(good('I111-2'), how), 'I111-2.glb', budgets);
    expect(turned('turn').errors.join(' ')).toMatch(/front faces \+Z/);
    expect(turned('quarter').ok).toBe(false);
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
    // Fields of the wrong kind, and geometry with nothing behind it: failed reports, not crashes.
    const odd = (edit: (g: Record<string, unknown>) => void) =>
      checkModel(editGlb(good('police'), edit), 'police.glb', budgets);
    expect(odd((g) => (g.extensionsRequired = 'KHR_draco_mesh_compression')).ok).toBe(true);
    const empty = odd((g) => {
      const acc = g.accessors as { bufferView?: number; count: number }[];
      const prim = (g.meshes as { primitives: { attributes: { POSITION: number } }[] }[])[0]!.primitives[0]!;
      acc[prim.attributes.POSITION] = { ...acc[prim.attributes.POSITION]!, count: 130_000_000 };
      delete acc[prim.attributes.POSITION]!.bufferView;
    });
    expect(empty.ok).toBe(false);
    // A building parented under a tree marker would vanish, tree and all.
    const wrapped = odd((g) => {
      const scene = (g.scenes as { nodes: number[] }[])[0]!;
      const nodes = g.nodes as unknown[];
      nodes.push({ name: 'Tree_Spot', children: scene.nodes });
      scene.nodes = [nodes.length - 1];
    });
    expect(wrapped.ok).toBe(false);
    expect(wrapped.errors.join(' ')).toMatch(/tree_spot marker holds more than a marker cube/);
    // A civic building fills its site: an awning out over the road is outside it. A zoned one
    // with room in its lot is stepped back, so the same awning is allowed.
    const outFront = (part: string, dz: number) => (g: Record<string, unknown>) => {
      type Node = { mesh?: number; name?: string; matrix?: number[]; translation?: number[] };
      const nodes = g.nodes as Node[];
      // A copy of the part, dz further forward (its parents' transforms are identities).
      const src = nodes.find((n) => n.name === part)!;
      const copy: Node = { ...src };
      if (src.matrix) copy.matrix = src.matrix.map((v, i) => (i === 14 ? v - dz : v));
      else
        copy.translation = [
          src.translation?.[0] ?? 0,
          src.translation?.[1] ?? 0,
          (src.translation?.[2] ?? 0) - 1.2,
        ];
      nodes.push(copy);
      (g.scenes as { nodes: number[] }[])[0]!.nodes.push(nodes.length - 1);
    };
    const civicAwning = odd(outFront('forecourt', 1.2));
    expect(civicAwning.ok).toBe(false);
    expect(civicAwning.errors.join(' ')).toMatch(/its site is 24 × 24 m/);
    expect(checkModel(editGlb(good('R103'), outFront('stoop', 0.8)), 'R103.glb', budgets).ok).toBe(true);
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

  it('holds a wall up on a leg or a column anywhere under it, however thin', () => {
    // Batch 4: the complex's conveyor on two legs (the far one between two slices' middles), and
    // the open shed's gable on columns at its corners (outside the middle of its depth).
    for (const id of ['I113-5', 'I203-3'])
      expect(checkModel(good(id), `${id}.glb`, budgets).errors, id).toEqual([]);
    const without = (id: string, name: string, which: (i: number) => boolean) =>
      editGlb(good(id), (g) => {
        (g.nodes as Record<string, unknown>[])
          .filter((n) => n.name === name)
          .forEach((n, i) => {
            if (which(i)) delete n.mesh;
          });
      });
    // Without its far leg the conveyor hangs off the hall; without its columns the gable hangs
    // off the shed's end wall.
    const legless = checkModel(
      without('I113-5', 'leg', (i) => i === 1),
      'I113-5.glb',
      budgets,
    );
    expect(legless.errors.join(' ')).toMatch(/a wall hangs in the air: conveyor hangs 6\.97 m/);
    const open = checkModel(
      without('I203-3', 'column', () => true),
      'I203-3.glb',
      budgets,
    );
    expect(open.errors.join(' ')).toMatch(/a wall hangs in the air: gable hangs/);
  });

  it('lets doors that face each other cancel out, not make a side the front', () => {
    // Batch 4's industrial park: two rows of units facing each other across a lane down the
    // middle of the lot, the offices' door and canopy on the road.
    expect(checkModel(good('I213-4'), 'I213-4.glb', budgets).errors).toEqual([]);
    const e = frontEvidence(parseGlb(good('I213-4')).parts);
    expect(e.seen.filter((s) => / in [-+]x /.test(s))).toHaveLength(16);
    expect(e.side).toBe(0);
    expect(e.road).toBeGreaterThan(e.back * 1.5);
    // With one row's doors gone, the other row's look one way and count.
    const oneRow = editGlb(good('I213-4'), (g) => {
      for (const n of g.nodes as { name?: string; mesh?: number; matrix?: number[] }[])
        if (/door/.test(n.name ?? '') && (n.matrix?.[12] ?? 0) > 2.5) delete n.mesh;
    });
    expect(frontEvidence(parseGlb(oneRow).parts).side).toBeGreaterThan(30);
    // Turned half round, it is still caught.
    const turned = checkModel(breakModel(good('I213-4'), 'turn'), 'I213-4.glb', budgets);
    expect(turned.errors.join(' ')).toMatch(/front faces \+Z/);
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

  it('lights a long window in runs of about 3-4 m, with an unlit strip between two', () => {
    // Area of the triangles drawn at a level whose window unit passes `keep`.
    const area = (m: BakedModel, level: number, keep: (u: number) => boolean) => {
      let a = 0;
      const P = m.positions;
      for (let t = 0; t < m.triUnit.length; t++) {
        if (!(m.triFlags[t]! & level) || !keep(m.triUnit[t]!)) continue;
        const [i, j, k] = [0, 1, 2].map((c) => m.index[t * 3 + c]! * 3) as [number, number, number];
        const u = [P[j]! - P[i]!, P[j + 1]! - P[i + 1]!, P[j + 2]! - P[i + 2]!];
        const v = [P[k]! - P[i]!, P[k + 1]! - P[i + 1]!, P[k + 2]! - P[i + 2]!];
        a +=
          Math.hypot(
            u[1]! * v[2]! - u[2]! * v[1]!,
            u[2]! * v[0]! - u[0]! * v[2]!,
            u[0]! * v[1]! - u[1]! * v[0]!,
          ) / 2;
      }
      return a;
    };
    // How far each window that lights at random runs across the ground, at a level.
    const runs = (m: BakedModel, level: number) => {
      const box = new Map<number, number[]>();
      for (let t = 0; t < m.triUnit.length; t++) {
        const u = m.triUnit[t]!;
        if (!u || !(m.triFlags[t]! & level) || ![UNIT_WINDOW, UNIT_BAND].includes(m.units[u - 1]!)) continue;
        const b = box.get(u) ?? [Infinity, Infinity, -Infinity, -Infinity];
        for (let c = 0; c < 3; c++) {
          const i = m.index[t * 3 + c]! * 3;
          b[0] = Math.min(b[0]!, m.positions[i]!);
          b[1] = Math.min(b[1]!, m.positions[i + 2]!);
          b[2] = Math.max(b[2]!, m.positions[i]!);
          b[3] = Math.max(b[3]!, m.positions[i + 2]!);
        }
        box.set(u, b);
      }
      return [...box.values()].map((b) => Math.max(b[2]! - b[0]!, b[3]! - b[1]!));
    };
    // Window bands on a tower, a hospital's long bands, the convention centre's 86 m of glass and a
    // saw-tooth roof's skylights.
    for (const id of ['R203', 'hospital', 'convention', 'I011']) {
      const { report, file } = inspectModel(good(id), `${id}.glb`, budgets);
      const whole = bakeModel(file!, report, { runs: false });
      const m = bakeModel(file!, report);
      const lights = (b: BakedModel) => (u: number) =>
        u > 0 && (b.units[u - 1] === UNIT_WINDOW || b.units[u - 1] === UNIT_BAND);
      const dark = m.units.indexOf(UNIT_DARK) + 1;
      expect(dark, id).toBeGreaterThan(0);
      for (const level of [TRI_NEAR, TRI_FAR, TRI_SKY]) {
        const at = `${id} at ${level}`;
        expect(Math.max(...runs(whole, level)), at).toBeGreaterThan(7.5);
        // Every window lights in runs of 4.5 m at most, near and far alike.
        expect(Math.max(...runs(m, level)), at).toBeLessThanOrEqual(4.5);
        // All the glass is still there.
        const glass = area(whole, level, (u) => u > 0);
        expect(Math.abs(area(m, level, (u) => u > 0) - glass), at).toBeLessThan(glass * 1e-4);
      }
      // Near and far the strips between runs (and close up a band's edges past a run) never
      // light: the rest of its glass does as before.
      for (const level of [TRI_NEAR, TRI_FAR]) {
        const strip = area(m, level, (u) => u === dark);
        const lit = area(whole, level, lights(whole));
        expect(strip, id).toBeGreaterThan(0);
        expect(strip, id).toBeLessThan(lit * 0.3);
        expect(Math.abs(area(m, level, lights(m)) + strip - lit), id).toBeLessThan(lit * 1e-4);
      }
      // In the skyline the runs meet, and as much glass lights as before.
      expect(
        area(m, TRI_SKY, (u) => u === dark),
        id,
      ).toBe(0);
      const sky = area(whole, TRI_SKY, lights(whole));
      expect(Math.abs(area(m, TRI_SKY, lights(m)) - sky), id).toBeLessThan(sky * 1e-4);
    }
    // A window short enough is left whole: the tenement's 64 are still 64.
    expect(bake('R103').units).toHaveLength(65);
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
    // A file cut short is refused, not read as empty models.
    for (const cut of [bytes.length - 1, bytes.length - 5000, Math.floor(bytes.length * 0.6)])
      expect(() => decodeModels(bytes.subarray(0, cut))).toThrow();
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
