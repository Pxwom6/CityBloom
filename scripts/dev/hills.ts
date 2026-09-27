// Dev probe (M13): find a hilly street within reach of the highway to show off earthworks.
// Usage: npx tsx scripts/dev/hills.ts [seed=hill] [preset=highlands] [reach=900]
// Prints streets (with an avenue to reach them from the highway) over the steepest buildable ground.
import { Sim } from '../../src/sim/sim';
import type { MapPreset } from '../../src/data/world';

const seed = process.argv[2] ?? 'hill';
const preset = (process.argv[3] ?? 'highlands') as MapPreset;
const reach = Number(process.argv[4] ?? 900);
const sim = Sim.create({ seed, preset });
sim.dispatch({ type: 'cheat', cheat: 'addMoney', amount: 5_000_000 });
const n = sim.state.net.nodes.get(sim.state.highway.connect)!;
const c = { x: n.x, z: n.z };
type Info = { grade: { ground: number; max: number; earth: { volume: number; cost: number } | null } };
const found: {
  trunk: { x: number; z: number }[];
  pts: { x: number; z: number }[];
  ground: number;
  max: number;
  vol: number;
  cost: number;
}[] = [];
for (let x = c.x + 120; x < c.x + reach; x += 60)
  for (let z = c.z - reach; z < c.z + reach; z += 60) {
    const a = { x, z };
    const trunk = [c, a];
    const tr = sim.preview({ type: 'buildRoad', road: 'avenue', points: trunk });
    if (!tr.ok) continue;
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      const pts = [a, { x: a.x + Math.cos(ang) * 260, z: a.z + Math.sin(ang) * 260 }];
      const r = sim.preview({ type: 'buildRoad', road: 'street', points: pts });
      if (!r.ok) continue;
      const g = (r as { info?: Info }).info!.grade;
      // With HUMP=1, rank by how far the ground rises above (or dips below) both ends instead.
      let hump = 0;
      if (process.env.HUMP) {
        const b = pts[1]!;
        const ha = sim.terrain.heightAt(a.x, a.z);
        const hb = sim.terrain.heightAt(b.x, b.z);
        for (let t = 0.1; t < 0.9; t += 0.05) {
          const h = sim.terrain.heightAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
          hump = Math.max(hump, h - Math.max(ha, hb), Math.min(ha, hb) - h);
        }
      }
      found.push({
        trunk,
        pts,
        ground: process.env.HUMP ? hump / 100 : g.ground,
        max: g.max,
        vol: g.earth?.volume ?? 0,
        cost: r.cost ?? 0,
      });
    }
  }
// Optional band of ground steepness, e.g. BAND=0.18-0.35.
const band = (process.env.BAND ?? '0-9').split('-').map(Number);
found.sort((a, b) => b.ground - a.ground);
found.splice(0, found.length, ...found.filter((f) => f.ground >= band[0]! && f.ground <= band[1]!));
const r1 = (p: { x: number; z: number }) => `{"x":${Math.round(p.x)},"z":${Math.round(p.z)}}`;
for (const f of found.slice(0, 10))
  console.log(
    `trunk [${f.trunk.map(r1).join(',')}] street [${f.pts.map(r1).join(',')}]`,
    `ground ${Math.round(f.ground * 100)}%  road ${Math.round(f.max * 100)}%  earth ${f.vol} m³  $${f.cost}`,
  );
