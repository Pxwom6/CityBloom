import { Color } from 'three';
import type { CivicDef } from '../../data/civic';
import { ModelBuilder, modelRng, type ModelData } from './builder';
import { buildSpecialModel, moduleAnnex } from './specialModels';
import { buildProjectModel } from './projectModels';

const C = (hex: string) => new Color(hex);
const CONCRETE = C('#c9c6bf');
const CONCRETE_DARK = C('#a9a6a0');
const GRAVEL = C('#bdb6a6');
const GRASS = C('#8cc063');
const STONE = C('#bdb5a6');
const WHITE = C('#f2f4f5');
const RED = C('#c9423a');
const STEEL = C('#9aa0a6');
const GLASS = C('#3d5a73');
const BRICK = C('#b5654a');
const WATER = C('#4aa3c8');
const SOLAR = C('#2c3e66');
const SOLAR_FRAME = C('#c8ccd0');
const COAL = C('#35363a');
const DIRT = C('#8b7355');
const MOUND = C('#7d8f4e');
const GREEN_ROOF = C('#5a9a5a');
const YELLOW = C('#e0b030');

const TRUNK = C('#6b4f36');
const LEAF = C('#5f9a45');
const LEAF_DARK = C('#4a7d3a');
const PAVING = C('#d8d2c4');
const PATH = C('#e3d9c0');
const FIRE_RED = C('#b8322b');
const POLICE_BLUE = C('#2f5f9e');
const TEAL = C('#1f9e8f');
const CREAM = C('#efe6d2');
const TRACK = C('#b85a45');
const SAND = C('#e2cf9e');
const ROOF_GREY = C('#6a6f76');
const SLATE = C('#4f5a66');

function tree(m: ModelBuilder, x: number, z: number, s: number, r: () => number): void {
  const h = 2 + s * 0.6;
  m.frustum(x, z, 0.28 * s * 0.5 + 0.12, 0.2, 0, h, TRUNK, 6);
  const leaf = r() < 0.5 ? LEAF : LEAF_DARK;
  m.frustum(x, z, s * 0.85, s, h, h + s * 0.6, leaf, 8, false);
  m.dome(x, z, s, h + s * 0.6, leaf, 3, 8);
}

/** Flat plus sign standing proud of a −z facing wall at z. */
function plusSign(m: ModelBuilder, cx: number, cy: number, z: number, size: number, col: Color): void {
  const t = size / 3;
  m.box(cx - size / 2, cx + size / 2, cy - t / 2, cy + t / 2, z - 0.25, z, col);
  m.box(cx - t / 2, cx + t / 2, cy - size / 2, cy + size / 2, z - 0.25, z, col);
}

type WinOpts = Parameters<ModelBuilder['windows']>[8];
/** Windows on every face of a box. */
function allWindows(
  m: ModelBuilder,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  y0: number,
  floors: number,
  fh: number,
  opts: WinOpts,
  faces: readonly ('front' | 'back' | 'left' | 'right')[] = ['front', 'back', 'left', 'right'],
): void {
  for (const f of faces) m.windows(f, x0, x1, z0, z1, y0, floors, fh, opts);
}

function bench(m: ModelBuilder, x: number, z: number, alongX: boolean): void {
  if (alongX) m.box(x - 0.9, x + 0.9, 0.4, 0.55, z - 0.25, z + 0.25, TRUNK);
  else m.box(x - 0.25, x + 0.25, 0.4, 0.55, z - 0.9, z + 0.9, TRUNK);
}

function car(m: ModelBuilder, x: number, z: number, col: Color): void {
  m.box(x - 0.9, x + 0.9, 0.2, 1.1, z - 2, z + 2, col);
  m.box(x - 0.8, x + 0.8, 1.1, 1.6, z - 1, z + 1, GLASS);
}

function base(m: ModelBuilder, W: number, D: number, top: Color): void {
  m.box(-W / 2 + 0.2, W / 2 - 0.2, -5, 0.06, -D / 2 + 0.2, D / 2 - 0.2, STONE, top);
}

function fence(m: ModelBuilder, W: number, D: number, col = STEEL): void {
  const h = 1.8;
  const t = 0.12;
  m.box(-W / 2 + 0.4, W / 2 - 0.4, 0, h, -D / 2 + 0.4, -D / 2 + 0.4 + t, col);
  m.box(-W / 2 + 0.4, W / 2 - 0.4, 0, h, D / 2 - 0.4 - t, D / 2 - 0.4, col);
  m.box(-W / 2 + 0.4, -W / 2 + 0.4 + t, 0, h, -D / 2 + 0.4, D / 2 - 0.4, col);
  m.box(W / 2 - 0.4 - t, W / 2 - 0.4, 0, h, -D / 2 + 0.4, D / 2 - 0.4, col);
}

function lit(r: () => number, p = 0.6): (i: number) => number {
  return () => (r() < p ? 0.7 + r() * 0.3 : 0);
}

function turbine(m: ModelBuilder, x: number, z: number, h: number, r: () => number): void {
  m.frustum(x, z, 1.1, 0.6, 0, h, WHITE, 10);
  m.box(x - 0.9, x + 0.9, h - 0.8, h + 1, z - 2.4, z + 1.2, WHITE);
  const hubZ = z - 2.6;
  const blade = 11;
  const phase = r() * Math.PI * 2;
  for (let k = 0; k < 3; k++) {
    const a = phase + (k * Math.PI * 2) / 3;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = -dy * 0.5;
    const py = dx * 0.5;
    m.quad(
      [x + px, h + py, hubZ],
      [x + dx * blade + px * 0.4, h + dy * blade + py * 0.4, hubZ],
      [x + dx * blade - px * 0.4, h + dy * blade - py * 0.4, hubZ],
      [x - px, h - py, hubZ],
      WHITE,
    );
    m.quad(
      [x - px, h - py, hubZ + 0.02],
      [x + dx * blade - px * 0.4, h + dy * blade - py * 0.4, hubZ + 0.02],
      [x + dx * blade + px * 0.4, h + dy * blade + py * 0.4, hubZ + 0.02],
      [x + px, h + py, hubZ + 0.02],
      WHITE,
    );
  }
}

function stack(m: ModelBuilder, x: number, z: number, r: number, h: number): void {
  m.frustum(x, z, r * 1.15, r, 0, h, CONCRETE, 12);
  m.frustum(x, z, r * 1.02, r * 1.02, h - 6, h - 3, RED, 12, false);
  m.frustum(x, z, r * 1.02, r * 1.02, h - 12, h - 9, RED, 12, false);
}

export function buildCivicModel(
  def: CivicDef,
  variant: number,
  fill = 0,
  modules = 0,
  /** Big projects (M17): the stage under construction; absent once finished. */
  stage?: number,
): ModelData {
  const W = def.w;
  const D = def.d;
  const r = modelRng(variant * 131 + W * 7 + D);
  const m = new ModelBuilder();
  switch (def.model) {
    case 'wind': {
      base(m, W, D, GRASS);
      turbine(m, -W / 4, D / 6, 22 + r() * 4, r);
      turbine(m, W / 4, -D / 6, 22 + r() * 4, r);
      m.box(-2, 2, 0, 2.4, D / 2 - 5, D / 2 - 2, CONCRETE_DARK);
      break;
    }
    case 'coal': {
      base(m, W, D, GRAVEL);
      const hall = { x0: -W / 2 + 3, x1: W / 2 - 12, z0: -D / 2 + 5, z1: D / 2 - 16 };
      m.box(hall.x0, hall.x1, 0, 20, hall.z0, hall.z1, CONCRETE, CONCRETE_DARK);
      m.windows('front', hall.x0, hall.x1, hall.z0, hall.z1, 0, 4, 5, {
        col: GLASS,
        lit: lit(r, 0.5),
        band: true,
        height: 1.4,
      });
      m.box(hall.x0 + 3, hall.x0 + 13, 20, 27, hall.z0 + 4, hall.z1 - 4, CONCRETE_DARK);
      stack(m, W / 2 - 6, -D / 2 + 10, 2.4, 58);
      stack(m, W / 2 - 6, -D / 2 + 20, 2.4, 52);
      // Coal pile and a conveyor.
      m.frustum(-W / 4, D / 2 - 8, 8, 1, 0, 6, COAL, 8);
      m.box(-W / 4, hall.x0 + 12, 7, 8, D / 2 - 9, D / 2 - 8, STEEL);
      fence(m, W, D);
      break;
    }
    case 'gas': {
      base(m, W, D, GRAVEL);
      m.box(-W / 2 + 3, W / 2 - 3, 0, 14, -D / 2 + 4, 0, WHITE, CONCRETE_DARK);
      m.windows('front', -W / 2 + 3, W / 2 - 3, -D / 2 + 4, 0, 0, 3, 4.5, {
        col: GLASS,
        lit: lit(r, 0.5),
        band: true,
        height: 1.2,
      });
      m.frustum(-W / 4, -D / 4, 1.6, 1.4, 14, 30, STEEL, 10);
      m.frustum(W / 4, -D / 4, 1.6, 1.4, 14, 30, STEEL, 10);
      m.cylinder(-W / 4, D / 4 + 2, 6, 0, 9, WHITE, 14, C('#dfe3e6'));
      m.cylinder(W / 4, D / 4 + 2, 6, 0, 9, WHITE, 14, C('#dfe3e6'));
      fence(m, W, D);
      break;
    }
    case 'solar': {
      base(m, W, D, GRASS);
      for (let row = 0; row < 5; row++) {
        const z = -D / 2 + 5 + row * ((D - 8) / 5);
        for (const [x0, x1] of [
          [-W / 2 + 2, -1],
          [1, W / 2 - 2],
        ]) {
          m.quad([x0!, 0.8, z + 4], [x0!, 2.6, z], [x1!, 2.6, z], [x1!, 0.8, z + 4], SOLAR);
          m.box(x0!, x1!, 0, 0.8, z + 1.8, z + 2.1, SOLAR_FRAME);
        }
      }
      m.box(-2.5, 2.5, 0, 3, -D / 2 + 1, -D / 2 + 4, WHITE);
      fence(m, W, D);
      break;
    }
    case 'nuclear': {
      base(m, W, D, CONCRETE);
      m.frustum(-W / 4, D / 5, 13, 8, 0, 18, CONCRETE, 16, false);
      m.frustum(-W / 4, D / 5, 8, 10, 18, 42, CONCRETE, 16, false);
      m.frustum(W / 4 - 2, D / 5, 13, 8, 0, 18, CONCRETE, 16, false);
      m.frustum(W / 4 - 2, D / 5, 8, 10, 18, 42, CONCRETE, 16, false);
      m.cylinder(0, -D / 4, 9, 0, 16, WHITE, 16);
      m.dome(0, -D / 4, 9, 16, WHITE);
      m.box(-W / 2 + 3, -W / 2 + 18, 0, 10, -D / 2 + 3, -D / 2 + 14, C('#e7e2da'));
      m.windows('front', -W / 2 + 3, -W / 2 + 18, -D / 2 + 3, -D / 2 + 14, 0, 2, 4.5, {
        col: GLASS,
        lit: lit(r),
        band: true,
      });
      fence(m, W, D);
      break;
    }
    case 'pump': {
      base(m, W, D, GRAVEL);
      m.box(-4, 4, 0, 4.5, -D / 2 + 2, -D / 2 + 8, BRICK);
      m.gable(-4, 4, -D / 2 + 2, -D / 2 + 8, 4.5, 1.6, C('#5b6470'), BRICK, true, 0.3);
      m.cylinder(2, D / 4, 3.2, 0, 7, C('#6fa6c8'), 12, C('#5b8fb0'));
      m.box(-3, 0, 0.4, 1.2, -D / 2 + 8, D / 4, STEEL);
      fence(m, W, D);
      break;
    }
    case 'riverpump': {
      base(m, W, D, GRAVEL);
      m.box(-6, 6, 0, 6, -D / 2 + 2, -D / 2 + 10, CONCRETE);
      m.windows('front', -6, 6, -D / 2 + 2, -D / 2 + 10, 0, 1, 6, {
        col: GLASS,
        lit: lit(r),
        band: true,
        height: 1.2,
      });
      for (const x of [-3, 3]) m.box(x - 0.8, x + 0.8, 0.6, 2.2, -D / 2 + 10, D / 2 - 0.5, C('#4f7fa3'));
      m.box(-7, 7, 0, 1.2, D / 2 - 3, D / 2 - 0.3, CONCRETE_DARK);
      break;
    }
    case 'outflow': {
      base(m, W, D, GRAVEL);
      m.box(-3, 3, 0, 3, -D / 2 + 2, -D / 2 + 6, CONCRETE);
      m.cylinder(0, 0, 1.4, 0, 1.6, C('#6b6f73'), 10);
      m.box(-1.2, 1.2, 0.3, 2.1, -D / 2 + 6, D / 2 - 0.3, C('#6b6f73'));
      m.ground(-2, 2, D / 2 - 4, D / 2 - 0.3, 0.1, C('#7a6a4a'));
      break;
    }
    case 'septic': {
      // Two buried tanks (only their lids and vents show) on a fenced gravel plot, with a pump box.
      base(m, W, D, GRASS);
      m.ground(-W / 2 + 1.5, W / 2 - 1.5, -D / 2 + 1.5, D / 2 - 1.5, 0.08, GRAVEL);
      for (const x of [-W / 5, W / 5]) {
        m.cylinder(x, 1, 2.2, 0, 0.35, CONCRETE, 12);
        m.cylinder(x, 1, 0.7, 0.35, 0.5, C('#6b6f73'), 8);
        m.cylinder(x + 1.4, 2.4, 0.12, 0, 1.6, STEEL, 6);
      }
      m.box(-1.3, 1.3, 0, 1.4, -D / 2 + 2, -D / 2 + 4, C('#8d949a'));
      fence(m, W, D);
      break;
    }
    case 'treatment': {
      base(m, W, D, GRASS);
      for (const [x, z] of [
        [-W / 4, D / 5],
        [W / 4, D / 5],
        [-W / 4, -D / 5 + 2],
      ] as const) {
        m.cylinder(x, z, 6, 0, 2.2, CONCRETE, 16, WATER);
        m.box(x - 0.2, x + 0.2, 2.2, 3, z - 6, z + 6, STEEL);
      }
      m.box(W / 8, W / 2 - 2, 0, 6, -D / 2 + 2, -D / 2 + 10, C('#e7e2da'));
      m.windows('front', W / 8, W / 2 - 2, -D / 2 + 2, -D / 2 + 10, 0, 2, 3, {
        col: GLASS,
        lit: lit(r),
        band: true,
      });
      fence(m, W, D);
      break;
    }
    case 'landfill': {
      base(m, W, D, DIRT);
      const h = 1 + fill * 12;
      m.frustum(0, 4, W * 0.38, W * 0.2, 0, h, MOUND, 10);
      m.box(-W / 2 + 2, -W / 2 + 10, 0, 3.5, -D / 2 + 2, -D / 2 + 8, C('#e7e2da'));
      m.windows('front', -W / 2 + 2, -W / 2 + 10, -D / 2 + 2, -D / 2 + 8, 0, 1, 3.5, {
        col: GLASS,
        lit: lit(r),
      });
      m.box(W / 2 - 10, W / 2 - 4, 0, 2.6, -D / 2 + 3, -D / 2 + 6, YELLOW);
      fence(m, W, D, C('#8a8d91'));
      break;
    }
    case 'recycling': {
      base(m, W, D, CONCRETE);
      m.box(-W / 2 + 2, W / 2 - 2, 0, 9, -D / 2 + 4, D / 2 - 8, C('#dfe7df'), GREEN_ROOF);
      m.windows('front', -W / 2 + 2, W / 2 - 2, -D / 2 + 4, D / 2 - 8, 0, 2, 4.5, {
        col: GLASS,
        lit: lit(r),
        band: true,
        height: 1.1,
      });
      for (let k = 0; k < 4; k++)
        m.box(
          -W / 2 + 3 + k * 6,
          -W / 2 + 7 + k * 6,
          0,
          2,
          D / 2 - 6,
          D / 2 - 2,
          [C('#3a8f5a'), C('#2f6fb0'), C('#e0b030'), C('#9a9a9a')][k]!,
        );
      break;
    }
    case 'incinerator': {
      base(m, W, D, GRAVEL);
      m.box(-W / 2 + 3, W / 2 - 3, 0, 16, -D / 2 + 4, D / 2 - 10, C('#b9b3aa'), CONCRETE_DARK);
      m.windows('front', -W / 2 + 3, W / 2 - 3, -D / 2 + 4, D / 2 - 10, 0, 3, 5, {
        col: GLASS,
        lit: lit(r, 0.7),
        band: true,
        height: 1.3,
      });
      stack(m, W / 2 - 6, D / 2 - 5, 1.8, 40);
      fence(m, W, D);
      break;
    }
    case 'firestation': {
      base(m, W, D, CONCRETE);
      // Apron in front of the engine bays, hall with three bay doors, a hose tower behind.
      const z0 = -D / 2 + 7;
      m.box(-W / 2 + 1.5, W / 2 - 6, 0, 7.5, z0, D / 2 - 2, BRICK, C('#8f2a24'));
      m.parapet(-W / 2 + 1.5, W / 2 - 6, z0, D / 2 - 2, 7.5, FIRE_RED, 0.6, 0.4);
      m.box(
        -W / 2 + 3,
        W / 2 - 7.5,
        7.52,
        7.56,
        (z0 + D / 2 - 2) / 2 - 0.6,
        (z0 + D / 2 - 2) / 2 + 0.6,
        WHITE,
      );
      allWindows(
        m,
        -W / 2 + 1.5,
        W / 2 - 6,
        z0,
        D / 2 - 2,
        0,
        2,
        3.6,
        { col: GLASS, lit: lit(r, 0.6), spacing: 2.8, height: 1.2 },
        ['back', 'left'],
      );
      for (let k = 0; k < 3; k++) {
        const x = -W / 2 + 4 + k * 5.4;
        m.box(x, x + 4.2, 0, 5, z0 - 0.08, z0, C('#e8e2d6'));
        for (let y = 1; y < 5; y += 1) m.box(x, x + 4.2, y - 0.06, y, z0 - 0.12, z0 - 0.08, C('#c9c2b4'));
      }
      m.windows('front', -W / 2 + 1.5, W / 2 - 6, z0, D / 2 - 2, 5.5, 1, 2.4, {
        col: GLASS,
        lit: lit(r, 0.7),
        spacing: 2.6,
        height: 1,
      });
      m.box(W / 2 - 5.5, W / 2 - 1.5, 0, 16, D / 2 - 7, D / 2 - 2, BRICK, FIRE_RED);
      allWindows(m, W / 2 - 5.5, W / 2 - 1.5, D / 2 - 7, D / 2 - 2, 2, 3, 4.5, {
        col: GLASS,
        lit: lit(r, 0.4),
        spacing: 3,
      });
      m.box(W / 2 - 4.5, W / 2 - 2.5, 16, 17.5, D / 2 - 6, D / 2 - 3, FIRE_RED);
      break;
    }
    case 'police': {
      base(m, W, D, CONCRETE);
      const z0 = -D / 2 + 4;
      m.box(-W / 2 + 1.5, W / 4, 0, 9, z0, D / 2 - 2, C('#e3e6ea'), C('#274b7a'));
      m.parapet(-W / 2 + 1.5, W / 4, z0, D / 2 - 2, 9, C('#d0d4da'), 0.5, 0.35);
      // Blue band around the building.
      m.box(-W / 2 + 1.5, W / 4, 3.4, 4.2, z0 - 0.1, z0, POLICE_BLUE);
      m.box(-W / 2 + 1.5, W / 4, 3.4, 4.2, D / 2 - 2, D / 2 - 1.9, POLICE_BLUE);
      m.box(-W / 2 + 1.4, -W / 2 + 1.5, 3.4, 4.2, z0, D / 2 - 2, POLICE_BLUE);
      allWindows(m, -W / 2 + 1.5, W / 4, z0, D / 2 - 2, 0, 2, 4.5, {
        col: GLASS,
        lit: lit(r, 0.8),
        spacing: 2.4,
      });
      m.box(-2, 2, 0, 3, z0 - 1.6, z0, C('#d7dade'));
      // Blue lamp over the door and a flagpole.
      m.box(-0.5, 0.5, 3, 3.8, z0 - 1.9, z0 - 1.5, POLICE_BLUE);
      m.frustum(-W / 2 + 2.5, -D / 2 + 1.5, 0.12, 0.1, 0, 11, STEEL, 6);
      m.box(-W / 2 + 2.6, -W / 2 + 5, 9.2, 10.8, -D / 2 + 1.45, -D / 2 + 1.55, POLICE_BLUE);
      // Car park with patrol cars.
      m.ground(W / 4 + 1, W / 2 - 1, -D / 2 + 2, D / 2 - 2, 0.08, C('#8d8f93'));
      for (let k = 0; k < 3; k++) car(m, W / 4 + 3 + k * 2.6, D / 4 - 1, k === 1 ? WHITE : POLICE_BLUE);
      break;
    }
    case 'clinic': {
      base(m, W, D, GRASS);
      const z0 = -D / 2 + 5;
      m.box(-W / 2 + 2, W / 2 - 2, 0, 7, z0, D / 2 - 3, WHITE, C('#d9dde0'));
      m.box(-W / 2 + 2, W / 2 - 2, 6.4, 7, z0 - 0.1, z0, TEAL);
      allWindows(m, -W / 2 + 2, W / 2 - 2, z0, D / 2 - 3, 0, 2, 3.3, {
        col: GLASS,
        lit: lit(r, 0.8),
        spacing: 2.2,
      });
      plusSign(m, 0, 8.6, z0 + 1, 2.4, TEAL);
      // A big plus on the roof reads from above.
      m.box(-2.4, 2.4, 7.02, 7.06, (z0 + D / 2 - 3) / 2 - 0.8, (z0 + D / 2 - 3) / 2 + 0.8, TEAL);
      m.box(-0.8, 0.8, 7.02, 7.06, (z0 + D / 2 - 3) / 2 - 2.4, (z0 + D / 2 - 3) / 2 + 2.4, TEAL);
      m.box(-0.2, 0.2, 7, 7.4, z0 + 0.8, z0 + 1.2, TEAL);
      m.ground(-W / 2 + 1, W / 2 - 1, -D / 2 + 1, z0 - 0.2, 0.08, PAVING);
      break;
    }
    case 'hospital': {
      base(m, W, D, CONCRETE);
      const z0 = -D / 2 + 6;
      // Low wide podium, a taller ward block, a helipad on the roof.
      m.box(-W / 2 + 2, W / 2 - 2, 0, 8, z0, D / 2 - 4, WHITE, C('#d9dde0'));
      m.windows('front', -W / 2 + 2, W / 2 - 2, z0, D / 2 - 4, 0, 2, 4, {
        col: GLASS,
        lit: lit(r, 0.8),
        band: true,
        height: 1.4,
      });
      const bx0 = -W / 4 - 4;
      const bx1 = W / 4 + 2;
      m.box(bx0, bx1, 8, 28, z0 + 4, z0 + 16, C('#f1f3f4'), C('#c9ced2'));
      m.windows('front', bx0, bx1, z0 + 4, z0 + 16, 8, 5, 4, {
        col: GLASS,
        lit: lit(r, 0.85),
        spacing: 2.3,
      });
      allWindows(m, bx0, bx1, z0 + 4, z0 + 16, 8, 5, 4, { col: GLASS, lit: lit(r, 0.85), spacing: 2.3 }, [
        'back',
        'left',
        'right',
      ]);
      allWindows(
        m,
        -W / 2 + 2,
        W / 2 - 2,
        z0,
        D / 2 - 4,
        0,
        2,
        4,
        { col: GLASS, lit: lit(r, 0.8), band: true, height: 1.4 },
        ['back', 'left', 'right'],
      );
      plusSign(m, (bx0 + bx1) / 2, 24, z0 + 4, 4.5, TEAL);
      m.cylinder(W / 2 - 10, D / 2 - 12, 5, 8, 8.3, C('#5a6068'), 16, C('#5a6068'));
      m.box(W / 2 - 11.6, W / 2 - 8.4, 8.3, 8.35, D / 2 - 14.5, D / 2 - 9.5, WHITE);
      // Ambulance bay canopy.
      m.box(-W / 2 + 3, -W / 2 + 13, 4, 4.5, z0 - 4, z0, C('#e6e8ea'));
      m.box(-W / 2 + 3, -W / 2 + 3.4, 0, 4, z0 - 4, z0 - 3.6, STEEL);
      m.box(-W / 2 + 12.6, -W / 2 + 13, 0, 4, z0 - 4, z0 - 3.6, STEEL);
      break;
    }
    case 'primary': {
      base(m, W, D, GRASS);
      const z0 = -D / 2 + 4;
      // L-shaped single-storey school with a pitched roof and a playground.
      m.box(-W / 2 + 2, W / 2 - 2, 0, 4.2, z0, z0 + 8, C('#e0b87a'));
      m.gable(-W / 2 + 2, W / 2 - 2, z0, z0 + 8, 4.2, 2.2, C('#b0553c'), C('#e0b87a'), true, 0.4);
      m.box(-W / 2 + 2, -W / 2 + 10, 0, 4.2, z0 + 8, D / 2 - 2, C('#e0b87a'));
      m.gable(-W / 2 + 2, -W / 2 + 10, z0 + 8, D / 2 - 2, 4.2, 2.2, C('#b0553c'), C('#e0b87a'), false, 0.4);
      m.windows('front', -W / 2 + 2, W / 2 - 2, z0, z0 + 8, 0, 1, 4.2, {
        col: GLASS,
        lit: lit(r, 0.6),
        spacing: 2.4,
        height: 1.6,
      });
      m.ground(-W / 2 + 12, W / 2 - 2, z0 + 10, D / 2 - 2, 0.09, C('#d8a860'));
      m.cylinder(W / 4, D / 4 + 1, 2.5, 0, 0.12, SAND, 12);
      m.box(W / 4 - 4, W / 4 - 3.8, 0, 2.5, D / 4 - 1, D / 4 + 3, YELLOW);
      m.box(W / 4 - 7, W / 4 - 6.8, 0, 2.5, D / 4 - 1, D / 4 + 3, YELLOW);
      m.box(W / 4 - 7, W / 4 - 3.8, 2.5, 2.7, D / 4 - 1, D / 4 + 3, RED);
      break;
    }
    case 'highschool': {
      base(m, W, D, GRASS);
      const z0 = -D / 2 + 3;
      m.box(-W / 2 + 2, W / 2 - 2, 0, 8, z0, z0 + 10, C('#c98f6a'), ROOF_GREY);
      m.windows('front', -W / 2 + 2, W / 2 - 2, z0, z0 + 10, 0, 2, 4, {
        col: GLASS,
        lit: lit(r, 0.6),
        band: true,
        height: 1.6,
      });
      allWindows(
        m,
        -W / 2 + 2,
        W / 2 - 2,
        z0,
        z0 + 10,
        0,
        2,
        4,
        { col: GLASS, lit: lit(r, 0.6), band: true, height: 1.6 },
        ['back', 'left', 'right'],
      );
      m.box(-3, 3, 0, 10, z0 - 1, z0 + 2, C('#b37a58'));
      // Sports field with a running track.
      const fz0 = z0 + 13;
      m.ground(-W / 2 + 2, W / 2 - 2, fz0, D / 2 - 1.5, 0.08, TRACK);
      m.ground(-W / 2 + 4, W / 2 - 4, fz0 + 2, D / 2 - 3.5, 0.1, C('#6fae4f'));
      m.box(-0.1, 0.1, 0.1, 0.12, fz0 + 2, D / 2 - 3.5, WHITE);
      break;
    }
    case 'university': {
      base(m, W, D, GRASS);
      // Halls around a quad, a clock tower on the axis.
      const hall = (x0: number, x1: number, z0: number, z1: number, h: number, face: 'front' | 'back') => {
        m.box(x0, x1, 0, h, z0, z1, CREAM, SLATE);
        m.windows(face, x0, x1, z0, z1, 0, Math.floor(h / 4), 4, {
          col: GLASS,
          lit: lit(r, 0.55),
          spacing: 2.6,
        });
      };
      hall(-W / 2 + 3, W / 2 - 3, -D / 2 + 3, -D / 2 + 13, 12, 'front');
      hall(-W / 2 + 3, -W / 2 + 13, -D / 2 + 16, D / 2 - 3, 12, 'front');
      hall(W / 2 - 13, W / 2 - 3, -D / 2 + 16, D / 2 - 3, 12, 'front');
      hall(-W / 2 + 16, W / 2 - 16, D / 2 - 11, D / 2 - 3, 16, 'front');
      m.ground(-W / 2 + 14, W / 2 - 14, -D / 2 + 14, D / 2 - 12, 0.1, C('#7fbd5c'));
      m.ground(-1.5, 1.5, -D / 2 + 14, D / 2 - 12, 0.12, PATH);
      m.box(-3, 3, 12, 26, -D / 2 + 5, -D / 2 + 11, CREAM);
      m.gable(-3, 3, -D / 2 + 5, -D / 2 + 11, 26, 5, SLATE, CREAM, true, 0.2);
      m.cylinder(0, -D / 2 + 4.9, 1.4, 21, 21.1, WHITE, 12);
      for (const [x, z] of [
        [-W / 4, 0],
        [W / 4, 0],
        [-W / 4, D / 5],
        [W / 4, D / 5],
      ] as const)
        tree(m, x, z, 2.6, r);
      break;
    }
    case 'library': {
      base(m, W, D, PAVING);
      const z0 = -D / 2 + 5;
      m.box(-W / 2 + 2, W / 2 - 2, 0, 1, z0 - 3, D / 2 - 2, STONE);
      m.box(-W / 2 + 3, W / 2 - 3, 1, 9, z0, D / 2 - 3, CREAM, C('#9aa3a8'));
      // Portico: columns and a pediment.
      for (let k = 0; k < 4; k++) m.cylinder(-4.5 + k * 3, z0 - 2, 0.5, 1, 8, WHITE, 8);
      m.box(-6, 6, 8, 9, z0 - 3, z0, WHITE);
      m.gable(-6, 6, z0 - 3, z0, 9, 2.2, C('#e9e4d8'), WHITE, true, 0.1);
      allWindows(m, -W / 2 + 3, W / 2 - 3, z0, D / 2 - 3, 1, 1, 7, {
        col: GLASS,
        lit: lit(r, 0.8),
        spacing: 2.4,
        height: 4,
      });
      break;
    }
    case 'busdepot': {
      base(m, W, D, CONCRETE);
      // Bus shed with open bays facing the road, an office, and buses parked in the yard.
      const z0 = -D / 2 + 4;
      m.box(-W / 2 + 2, W / 4, 0, 7, z0 + 8, D / 2 - 2, C('#d7dade'), SLATE);
      for (let k = 0; k < 3; k++) {
        const x = -W / 2 + 3.5 + k * 5.6;
        m.box(x, x + 4.4, 0, 5, z0 + 7.9, z0 + 8, C('#3b4148'));
      }
      m.box(-W / 2 + 2, W / 4, 7, 7.5, z0 + 7.8, z0 + 8, C('#f2b31b'));
      m.box(W / 4 + 1, W / 2 - 2, 0, 6, z0, z0 + 7, C('#e9e6de'), SLATE);
      allWindows(m, W / 4 + 1, W / 2 - 2, z0, z0 + 7, 0, 2, 3, {
        col: GLASS,
        lit: lit(r, 0.7),
        spacing: 2.4,
      });
      m.ground(-W / 2 + 1, W / 4, -D / 2 + 1, z0 + 7.5, 0.08, C('#8d8f93'));
      for (let k = 0; k < 3; k++) {
        const x = -W / 2 + 3 + k * 4.5;
        m.box(x, x + 2.5, 0.4, 3.1, -D / 2 + 1.5, -D / 2 + 1.5 + 10, C('#f2b31b'));
        m.box(x - 0.02, x + 2.52, 1.7, 2.5, -D / 2 + 1.6, -D / 2 + 1.4 + 10, GLASS);
      }
      break;
    }
    case 'tramdepot': {
      // A tram depot (M20): a long brick shed with three bays open to the road, tracks running out
      // of them across the forecourt, a tram nosing out of the middle bay and a small office.
      base(m, W, D, PAVING);
      const zf = -D / 2;
      const z0 = zf + 8;
      m.box(-W / 2 + 2, W / 4 + 2, 0, 8, z0, D / 2 - 1.5, BRICK);
      m.gable(-W / 2 + 2, W / 4 + 2, z0, D / 2 - 1.5, 8, 2.5, ROOF_GREY, BRICK, true);
      const bays = [-W / 2 + 5, -W / 2 + 14, -W / 2 + 23];
      for (const x of bays) {
        m.box(x, x + 6, 0, 5.8, z0 - 0.05, z0 + 0.02, C('#2f3439'));
        m.box(x - 0.4, x + 6.4, 5.8, 6.4, z0 - 0.2, z0 + 0.05, CREAM);
        // Rails from the bay to the road.
        for (const dx of [1.9, 4.1]) m.box(x + dx - 0.08, x + dx + 0.08, 0.02, 0.09, zf + 0.2, z0, STEEL);
      }
      // A tram half out of the middle bay: cream body, green skirt, windows, pantograph.
      const tx = bays[1]! + 3;
      m.box(tx - 1.3, tx + 1.3, 0.35, 1.3, z0 - 7, z0 + 4, C('#2f6b52'));
      m.box(tx - 1.3, tx + 1.3, 1.3, 3.3, z0 - 7, z0 + 4, C('#efe6cf'));
      m.box(tx - 1.32, tx + 1.32, 1.8, 2.9, z0 - 6.6, z0 + 3.6, GLASS);
      m.box(tx - 0.08, tx + 0.08, 3.3, 4.1, z0 - 3, z0 - 2.8, SLATE);
      m.box(tx - 0.7, tx + 0.7, 4.05, 4.15, z0 - 3.1, z0 - 2.7, SLATE);
      // Office with windows at the side.
      m.box(W / 4 + 3, W / 2 - 2, 0, 6, zf + 3, zf + 13, CREAM, SLATE);
      allWindows(m, W / 4 + 3, W / 2 - 2, zf + 3, zf + 13, 0, 2, 3, {
        col: GLASS,
        lit: lit(r, 0.7),
        spacing: 2.4,
      });
      // Poles for the overhead wires along the forecourt.
      for (const x of [-W / 2 + 3, -W / 2 + 12.5, -W / 2 + 21.5, -W / 2 + 30.5])
        m.cylinder(x, zf + 4, 0.12, 0, 6.2, STEEL, 6);
      break;
    }
    case 'station': {
      // A railway station (M20): the platform along the front (the track side) under a long canopy,
      // and a brick booking hall with a clock over its door behind it.
      base(m, W, D, PAVING);
      const zf = -D / 2;
      m.box(-W / 2 + 1, W / 2 - 1, 0, 1.1, zf + 0.3, zf + 6.5, CONCRETE, PAVING);
      m.box(-W / 2 + 1, W / 2 - 1, 1.1, 1.13, zf + 0.3, zf + 0.9, YELLOW);
      for (let x = -W / 2 + 4; x <= W / 2 - 4; x += 8) m.cylinder(x, zf + 4.2, 0.18, 1.1, 4.5, STEEL, 6);
      m.box(-W / 2 + 2.5, W / 2 - 2.5, 4.5, 4.8, zf + 1.4, zf + 6.4, C('#3f6b5a'));
      for (const x of [-18, -6, 6, 18]) bench(m, x, zf + 5, true);
      // Booking hall.
      m.box(-12, 12, 0, 7, zf + 7, D / 2 - 1, BRICK);
      m.gable(-12, 12, zf + 7, D / 2 - 1, 7, 3, ROOF_GREY, BRICK, true);
      allWindows(m, -12, 12, zf + 7, D / 2 - 1, 0.6, 1, 4.5, { col: GLASS, lit: lit(r, 0.7), spacing: 3 }, [
        'front',
      ]);
      m.box(-1.2, 1.2, 7.4, 9.6, zf + 6.7, zf + 7, WHITE);
      m.box(-0.1, 0.1, 8.2, 9.2, zf + 6.6, zf + 6.7, SLATE);
      // Low wings either side.
      for (const s of [-1, 1]) {
        const x0 = s < 0 ? -W / 2 + 2 : 13;
        const x1 = s < 0 ? -13 : W / 2 - 2;
        m.box(x0, x1, 0, 4, zf + 8, D / 2 - 2, CREAM, SLATE);
      }
      break;
    }
    case 'railfreight': {
      // A rail freight terminal (M20): a shed facing the road, stacked containers, a loading track
      // along the back (the railway side) under a gantry crane, and trucks waiting at the gate.
      base(m, W, D, CONCRETE);
      const zf = -D / 2;
      const zb = D / 2;
      m.box(-W / 2 + 3, -4, 0, 9, zf + 5, zb - 12, C('#c8c2b4'), ROOF_GREY);
      for (let k = 0; k < 4; k++) {
        const x = -W / 2 + 6 + k * 7.5;
        m.box(x, x + 4.5, 0, 5, zf + 4.9, zf + 5, C('#56606b'));
      }
      // Loading track inside the yard, along the back.
      m.box(-W / 2 + 1, W / 2 - 1, 0.06, 0.25, zb - 8, zb - 3, C('#8d8579'));
      for (const z of [zb - 6.2, zb - 4.8])
        m.box(-W / 2 + 1, W / 2 - 1, 0.25, 0.4, z - 0.07, z + 0.07, STEEL);
      // Containers.
      const boxes = [C('#b8432f'), C('#2f5d9e'), C('#3f6b4a'), C('#d08a2c'), C('#e6e1d3')];
      for (let i = 0; i < 5; i++)
        for (let j = 0; j < 2; j++)
          for (let k = 0; k < 1 + ((i + j) % 3); k++) {
            const x = 2 + i * 6.6;
            const z = zf + 7 + j * 3.2;
            m.box(x, x + 6, k * 2.6, k * 2.6 + 2.5, z, z + 2.9, boxes[(i * 3 + j + k) % boxes.length]!);
          }
      // Gantry crane over the loading track.
      const crane = C('#e0b030');
      for (const x of [4, W / 2 - 4])
        for (const z of [zb - 11, zb - 1.5]) m.box(x - 0.5, x + 0.5, 0, 13, z - 0.5, z + 0.5, crane);
      m.box(3, W / 2 - 3, 13, 14.2, zb - 11.6, zb - 0.9, crane);
      m.box(14, 17, 10.5, 13, zb - 7, zb - 4, C('#56606b'));
      // Trucks at the gate.
      for (const x of [-W / 2 + 8, -W / 2 + 16]) {
        m.box(x - 1.2, x + 1.2, 0.5, 3.2, zf + 1, zf + 3.5, C('#d0342c'));
        m.box(x - 1.3, x + 1.3, 0.7, 3.6, zf + 3.6, zf + 11, WHITE);
      }
      break;
    }
    case 'park_small': {
      m.box(-W / 2 + 0.2, W / 2 - 0.2, -5, 0.05, -D / 2 + 0.2, D / 2 - 0.2, STONE, GRASS);
      m.ground(-1, 1, -D / 2 + 0.2, D / 2 - 0.2, 0.08, PATH);
      m.ground(-W / 2 + 0.2, W / 2 - 0.2, -1, 1, 0.09, PATH);
      for (const [x, z] of [
        [-4.2, -4.2],
        [4.2, 4.5],
        [-4.5, 4.2],
        [4.5, -4],
      ] as const)
        tree(m, x + (r() - 0.5), z + (r() - 0.5), 2 + r() * 0.8, r);
      bench(m, -3, -1.8, true);
      bench(m, 3, 1.8, true);
      break;
    }
    case 'plaza': {
      base(m, W, D, PAVING);
      m.ground(-W / 2 + 1, W / 2 - 1, -D / 2 + 1, D / 2 - 1, 0.08, C('#cfc6b3'));
      m.cylinder(0, 0, 4, 0, 0.7, STONE, 16, WATER);
      m.cylinder(0, 0, 0.6, 0.7, 2.4, STONE, 8);
      m.cylinder(0, 0, 1.4, 2.4, 2.6, STONE, 10, WATER);
      for (const [x, z] of [
        [-8, -8],
        [8, -8],
        [-8, 8],
        [8, 8],
      ] as const) {
        m.box(x - 1.4, x + 1.4, 0, 0.7, z - 1.4, z + 1.4, STONE, DIRT);
        tree(m, x, z, 2.2, r);
      }
      for (const x of [-4, 4]) bench(m, x, -6.5, true);
      for (const x of [-4, 4]) bench(m, x, 6.5, true);
      break;
    }
    case 'park_large': {
      m.box(-W / 2 + 0.2, W / 2 - 0.2, -5, 0.05, -D / 2 + 0.2, D / 2 - 0.2, STONE, GRASS);
      // Winding paths (straight pieces), a pond, a pavilion and plenty of trees.
      m.ground(-1.2, 1.2, -D / 2 + 0.2, 0, 0.08, PATH);
      m.ground(-W / 2 + 0.2, W / 2 - 0.2, -1.2, 1.2, 0.09, PATH);
      m.ground(W / 6 - 1.2, W / 6 + 1.2, 0, D / 2 - 0.2, 0.08, PATH);
      m.cylinder(-W / 5, D / 5, 8, 0.02, 0.1, WATER, 18, WATER);
      m.cylinder(W / 4 + 2, -D / 4, 3.4, 0, 0.3, STONE, 8);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        m.cylinder(W / 4 + 2 + Math.cos(a) * 3, -D / 4 + Math.sin(a) * 3, 0.2, 0.3, 3.3, WHITE, 6);
      }
      m.frustum(W / 4 + 2, -D / 4, 4, 0.2, 3.3, 5.2, C('#5b6f5a'), 8);
      for (let k = 0; k < 22; k++) {
        const x = (r() - 0.5) * (W - 6);
        const z = (r() - 0.5) * (D - 6);
        if (Math.abs(x) < 3 || Math.abs(z) < 3) continue;
        if (Math.hypot(x + W / 5, z - D / 5) < 10) continue;
        if (Math.hypot(x - W / 4 - 2, z + D / 4) < 6) continue;
        tree(m, x, z, 2 + r() * 1.4, r);
      }
      for (const x of [-8, 8]) bench(m, x, -2.4, true);
      break;
    }
    default:
      if (def.project) {
        const n = def.project.stages.length;
        buildProjectModel(def.model, m, W, D, stage ?? n, n, r);
      } else if (!buildSpecialModel(def.model, m, W, D, r)) {
        base(m, W, D, CONCRETE);
        m.box(-W / 2 + 2, W / 2 - 2, 0, 8, -D / 2 + 2, D / 2 - 2, WHITE);
      }
  }
  // Add-on modules: a small wing in a back corner of the lot for each.
  for (let k = 0; k < modules; k++) moduleAnnex(m, W, D, k, CREAM);
  return m.build();
}

/** Debris left by a fire on a zoned lot of w×d cells. */
export function buildRubbleModel(w: number, d: number, variant: number): ModelData {
  const W = w * 8 - 2;
  const D = d * 8 - 3;
  const r = modelRng(variant * 977 + w * 13 + d);
  const m = new ModelBuilder();
  m.box(-W / 2, W / 2, -3, 0.08, -D / 2, D / 2, C('#6f6a63'), C('#4a4541'));
  const cols = [C('#3b3632'), C('#57504a'), C('#7a6f64'), C('#2c2927'), C('#8a5a44')];
  const n = Math.round((W * D) / 18);
  for (let k = 0; k < n; k++) {
    const x = (r() - 0.5) * (W - 3);
    const z = (r() - 0.5) * (D - 3);
    const s = 0.6 + r() * 1.8;
    const h = 0.3 + r() * 1.4 * (1 - Math.hypot(x / W, z / D));
    m.box(x - s, x + s * (0.4 + r()), 0, h, z - s * (0.4 + r()), z + s, cols[Math.floor(r() * cols.length)]!);
  }
  // A few charred wall stubs and beams.
  for (let k = 0; k < 3; k++) {
    const x = (r() - 0.5) * (W - 4);
    const z = (r() - 0.5) * (D - 4);
    m.box(x - 0.2, x + 0.2, 0, 1.5 + r() * 2.5, z - 1.5, z + 1.5, cols[0]!);
  }
  return m.build();
}
