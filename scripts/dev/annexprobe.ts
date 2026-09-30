// Dev (phase 3): where each add-on annex lands on each hand-made civic site, and whether it is
// on built ground, a road, an apron or a doorway. Usage: npx tsx scripts/dev/annexprobe.ts
import { MODULES } from '../../src/data/modules';
import { CIVIC } from '../../src/data/civic';
import { clearPlace, handmade } from '../../src/render/assets/handmade';
import { annexPlace } from '../../src/render/assets/registry';
import { buildModels, MODELS_DIR } from '../lib/modelPipeline';

const { models } = buildModels(process.cwd(), MODELS_DIR);
handmade.set(models);
for (const mod of MODULES)
  for (const id of mod.for) {
    const site = handmade.civic(id, 0);
    const def = CIVIC.get(id)!;
    if (!site) {
      console.log(`${id}: generated`);
      continue;
    }
    const cols = Math.ceil(site.w);
    const bit = (bits: Uint8Array, x: number, z: number) => {
      const c = Math.floor(x + site.w / 2);
      const r = Math.floor(z + site.d / 2);
      if (c < 0 || r < 0 || c >= cols || r >= Math.ceil(site.d)) return false;
      const i = r * cols + c;
      return ((bits[i >> 3] ?? 0) & (1 << (i & 7))) !== 0;
    };
    const taken: { x: number; z: number; w: number; d: number }[] = [];
    const out: string[] = [];
    for (let k = 0; k < (mod.id === 'garbageTruck' ? 4 : 1); k++) {
      const p = clearPlace(site, annexPlace(def.w, def.d, k), taken);
      const w = 9 * p.scale;
      const d = 8 * p.scale;
      taken.push({ x: p.x, z: p.z, w, d });
      let built = 0;
      let clear = 0;
      for (let x = p.x - w / 2 + 0.5; x < p.x + w / 2; x++)
        for (let z = p.z - d / 2 + 0.5; z < p.z + d / 2; z++) {
          if (bit(site.occupied, x, z)) built++;
          else if (bit(site.approach, x, z)) clear++;
        }
      out.push(
        `#${k + 1} (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ×${p.scale.toFixed(2)}${p.turn ? ' turned' : ''}${built ? ` BUILT ${built} m²` : ''}${clear ? ` in the way ${clear} m²` : ''}`,
      );
    }
    let marked = 0;
    for (const b of site.approach) for (let i = 0; i < 8; i++) if (b & (1 << i)) marked++;
    console.log(`${id} + ${mod.id} (${site.w}×${site.d}, ${marked} m² kept clear): ${out.join('; ')}`);
  }
