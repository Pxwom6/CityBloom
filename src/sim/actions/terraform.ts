import { TERRAFORM, TERRAFORM_MODES, type TerraformMode } from '../../data/terraform';
import { MAP_SIZE } from '../../data/world';
import { fail, ok, type CommandResult } from '../commands';
import type { Vec2 } from '../geom';
import type { Sim } from '../sim';
import { reshapeGround } from '../world/earthworks';
import { planTerraform } from '../world/terraform';

/** Terraforming (M24): one application of the brush along `points`, paid for by the volume moved. */
export function terraform(
  sim: Sim,
  mode: TerraformMode,
  points: Vec2[],
  radius: number,
  level: number | undefined,
  dryRun: boolean,
): CommandResult {
  if (!TERRAFORM_MODES.some((m) => m.id === mode)) return fail('Unknown terrain tool');
  if (!(radius >= TERRAFORM.radius.min && radius <= TERRAFORM.radius.max)) return fail('Invalid brush');
  if (!points.length || points.length > 64) return fail('Invalid brush');
  for (const p of points)
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z) || p.x < -radius || p.z < -radius)
      return fail('Invalid brush');
    else if (p.x > MAP_SIZE + radius || p.z > MAP_SIZE + radius) return fail('Outside the map');
  if (mode === 'level' && !Number.isFinite(level)) return fail('Pick the height to level to');
  const plan = planTerraform(sim, mode, points, radius, level);
  const info = { volume: plan.volume, cut: plan.cut, fill: plan.fill, held: plan.held, water: plan.water };
  if (!plan.idx.length) {
    const reason =
      plan.held && plan.held >= plan.water
        ? 'Roads and buildings hold the ground here'
        : plan.water
          ? 'Terraforming leaves water alone'
          : mode === 'lower'
            ? "Can't dig any lower here"
            : mode === 'raise'
              ? "Can't raise the ground any higher here"
              : mode === 'level'
                ? 'Already level'
                : 'Already smooth';
    return fail(reason, { info });
  }
  if (!sim.state.options.sandbox && sim.state.treasury < plan.cost) return fail('Not enough money', { info });
  if (dryRun) return ok(plan.cost, { info });
  reshapeGround(sim, plan.idx, plan.to);
  sim.net.revalidate(plan.box!);
  sim.spend(plan.cost, 'landscaping');
  return ok(plan.cost, { info });
}
