import {
  Color,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { ClientWorld } from '../client/world';
import { hash2 } from '../sim/rng';
import { mergeGeometries, painted } from './geom';
import { buildingYaw } from './buildings';

const MAX = 4000;

/** Piles of garbage bags in front of buildings whose garbage isn't being collected. */
export class GarbageProps {
  readonly mesh: InstancedMesh;
  private dirty = true;
  private m = new Matrix4();
  private q = new Quaternion();
  private p = new Vector3();
  private s = new Vector3();
  private up = new Vector3(0, 1, 0);

  /** The ground moved (earthworks): re-seat the piles. */
  groundMoved(): void {
    this.dirty = true;
  }

  constructor(private world: ClientWorld) {
    const bags = mergeGeometries([
      painted(new IcosahedronGeometry(0.55, 0).translate(0, 0.45, 0), new Color('#2f3a2f')),
      painted(new IcosahedronGeometry(0.5, 0).translate(0.7, 0.4, 0.3), new Color('#3b3f47')),
      painted(new IcosahedronGeometry(0.45, 0).translate(-0.5, 0.38, 0.5), new Color('#2f3a2f')),
      painted(new IcosahedronGeometry(0.42, 0).translate(0.2, 0.95, 0.2), new Color('#45403a')),
    ]);
    this.mesh = new InstancedMesh(bags, new MeshLambertMaterial({ vertexColors: true }), MAX);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.castShadow = true;
    this.mesh.name = 'garbage-piles';
    world.onBuildings(() => (this.dirty = true));
    world.onTerrain(() => this.groundMoved());
  }

  update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    let n = 0;
    for (const b of this.world.buildings.values()) {
      if (!(b.flags & 16) || n >= MAX) continue;
      const yaw = buildingYaw(b);
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const piles = 1 + (b.w > 1 ? 1 : 0);
      for (let k = 0; k < piles && n < MAX; k++) {
        const lx = (hash2(b.id, k, 3) - 0.5) * (b.w * 8 - 3);
        const lz = -(b.d * 4) + 1.4;
        const x = b.x + lx * c + lz * s;
        const z = b.z - lx * s + lz * c;
        this.p.set(x, Math.max(0, this.world.heightAt(x, z)) + 0.05, z);
        this.q.setFromAxisAngle(this.up, hash2(b.id, k, 7) * 6.28);
        this.s.setScalar(0.9 + hash2(b.id, k, 9) * 0.5);
        this.m.compose(this.p, this.q, this.s);
        this.mesh.setMatrixAt(n++, this.m);
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
