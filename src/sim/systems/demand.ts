import { CIVIC, SPECIALISATION } from '../../data/civic';
import { freightHubs, ports } from './specialisations';
import { civicDef } from '../world/civic';
import { openProject } from './projects';
import { DEMAND } from '../../data/balance';
import type { Sim } from '../sim';

export interface Factor {
  label: string;
  value: number;
}

export interface DemandState {
  R: number;
  C: number;
  I: number;
  factors: { R: Factor[]; C: Factor[]; I: Factor[] };
}

export function emptyDemand(): DemandState {
  return { R: 0, C: 0, I: 0, factors: { R: [], C: [], I: [] } };
}

const clamp = (v: number) => Math.max(-1, Math.min(1, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** RCI demand as a sum of named factors (DESIGN §3.3), eased toward its target each hour. */
export function updateDemand(sim: Sim): void {
  const t = sim.state.totals;
  const d = sim.state.demand;
  const taxR = sim.avgTax('R');
  const taxC = sim.avgTax('C');
  const taxI = sim.avgTax('I');
  // Jobs held by the neighbours' commuters (M23) are open to newcomers, who'd take them first; and
  // residents working out of town would rather work here.
  const openJobs = Math.max(0, t.jobs - t.jobsFilled + (t.fromRegion ?? 0));
  const looking = t.unemployed + (t.toRegion ?? 0);
  const R: Factor[] = [
    {
      label: 'Jobs available vs. unemployed',
      value:
        (DEMAND.jobsWeight *
          (openJobs + t.pendingC + t.pendingI - looking - t.pendingHomes * DEMAND.workforceShare)) /
        (t.workers + DEMAND.jobsSoftening),
    },
    {
      label: 'Newcomers from the highway',
      value: t.highwayConnected
        ? DEMAND.newcomers * Math.max(0, 1 - t.population / DEMAND.newcomersFadePopulation)
        : 0,
    },
    {
      label: 'City appeal (approval)',
      value: t.population > 0 ? DEMAND.appealWeight * (t.approval - DEMAND.appealNeutral) : 0,
    },
    { label: 'Residential taxes', value: DEMAND.taxPerPoint * (taxR - DEMAND.neutralTax) },
  ];
  const cAll = t.cJobs + t.pendingC;
  const port = ports(sim);
  const C: Factor[] = [
    {
      label: 'Shoppers vs. shops',
      value: (DEMAND.shoppersWeight * (t.population * DEMAND.shopJobsPerResident - cAll)) / (cAll + 20),
    },
    { label: 'Workers looking for jobs', value: (DEMAND.cWorkforceWeight * looking) / (t.workers + 50) },
    { label: 'Commercial taxes', value: DEMAND.taxPerPoint * (taxC - DEMAND.neutralTax) },
    {
      label: 'Convention centre',
      value: openProject(sim, 'convention') ? (CIVIC.get('convention')?.project?.commerce?.demand ?? 0) : 0,
    },
    {
      label: 'Airport',
      value: port.airport ? civicDef(port.airport).airport!.commerce : 0,
    },
    {
      label: 'Visitors shopping',
      value:
        (SPECIALISATION.visitorDemand * sim.state.tourism.visitors) /
        (sim.state.tourism.visitors + SPECIALISATION.visitorsHalf),
    },
  ];
  const I: Factor[] = [
    { label: 'Workers looking for jobs', value: (DEMAND.iWorkforceWeight * looking) / (t.workers + 50) },
    { label: 'Regional demand for goods', value: t.highwayConnected ? DEMAND.exports : 0 },
    { label: 'Industrial taxes', value: DEMAND.taxPerPoint * (taxI - DEMAND.neutralTax) },
    {
      label: 'Freight hubs and terminals',
      value: freightHubs(sim) * (CIVIC.get('freighthub')?.freight?.demand ?? 0),
    },
    {
      label: 'Seaport',
      value: port.seaport ? civicDef(port.seaport).seaport!.demand : 0,
    },
    {
      label: 'Launch complex',
      value: openProject(sim, 'launchsite') ? (CIVIC.get('launchsite')?.project?.research?.demand ?? 0) : 0,
    },
  ];
  const sum = (fs: Factor[]) => clamp(fs.reduce((s, f) => s + f.value, 0));
  const ease = (cur: number, target: number) => round3(cur + (target - cur) * DEMAND.easing);
  d.R = ease(d.R, sum(R));
  d.C = ease(d.C, sum(C));
  d.I = ease(d.I, sum(I));
  const tidy = (fs: Factor[]) =>
    fs.filter((f) => Math.abs(f.value) >= 0.005).map((f) => ({ label: f.label, value: round3(f.value) }));
  d.factors = { R: tidy(R), C: tidy(C), I: tidy(I) };
}
