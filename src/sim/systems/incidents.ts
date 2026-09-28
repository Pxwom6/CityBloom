import { CIVIC, SERVICES, type ServiceKind } from '../../data/civic';
import { ZONE_I, ZONE_R } from '../../data/zones';
import { rectsOverlap } from '../geom';
import type { Sim } from '../sim';
import { BState, footprint, type Building } from '../world/buildings';
import { civicDef, civicOnline, civicVehicles } from '../world/civic';
import { attachmentOf } from './commute';
import { Dijkstra } from './graph';
import { sicknessRate } from './health';
import { HEALTH } from '../../data/balance';
import { POLICY_EFFECTS } from '../../data/policies';
import {
  despawnVehicle,
  registerVehicleKind,
  route,
  sendHome,
  spawnVehicle,
  type Vehicle,
  type VehicleKind,
} from './vehicles';

/** A crime or medical emergency waiting for a responder. Fires live on buildings (`b.fire`). */
export interface Incident {
  id: number;
  kind: 'crime' | 'emergency';
  building: number;
  deadline: number;
  responder: number;
}

const dijkstra = new Dijkstra();

/**
 * Send the nearest free vehicle of a service to a building: a Dijkstra outward from the building
 * finds the closest station (by travel time) that still has a vehicle at home.
 */
export function dispatch(
  sim: Sim,
  service: ServiceKind,
  vehicle: VehicleKind,
  targetId: number,
  ref = 0,
): Vehicle | null {
  const s = sim.state;
  const target = s.buildings.get(targetId);
  if (!target) return null;
  const g = sim.graph();
  const att = attachmentOf(sim, g, target);
  const acc = sim.buildingAccess(target);
  if (!att || !acc) return null;
  const stations = new Map<number, number[]>();
  for (const c of s.civics.values()) {
    const def = civicDef(c);
    if (def.service?.kind !== service || def.service.vehicle !== vehicle || !c.access || !civicOnline(c))
      continue;
    const total = Math.max(0, Math.round(civicVehicles(c) * Math.min(1.25, sim.fundingEff(def.dept))));
    if (c.out >= total) continue;
    const seg = s.net.segments.get(c.access.seg);
    if (!seg) continue;
    for (const n of [seg.a, seg.b]) {
      const i = g.index.get(n);
      if (i === undefined) continue;
      const list = stations.get(i) ?? [];
      if (!list.includes(c.id)) list.push(c.id);
      stations.set(i, list);
    }
  }
  if (!stations.size) return null;
  let found = -1;
  dijkstra.run(g, [{ node: att.node, cost: 0 }], Infinity, (node) => {
    const list = stations.get(node);
    if (list) {
      found = Math.min(...list);
      return false;
    }
    return true;
  });
  if (found < 0) return null;
  const home = s.civics.get(found)!;
  const legs = route(sim, home.access!, acc);
  if (!legs) return null;
  const v = spawnVehicle(sim, vehicle, home.id, targetId, legs);
  v.ref = ref;
  return v;
}

/** Hourly chance a building catches fire by itself. */
export function fireRisk(sim: Sim, b: Building): number {
  let p = SERVICES.fireBase * (1 - SERVICES.fireCoverageCut * b.covFire);
  if (sim.policyAt('fireSafety', b.x, b.z)) p *= POLICY_EFFECTS.fireSafety;
  if (b.state === BState.Abandoned) p *= 4;
  if (b.zone === ZONE_I) p *= 1.5;
  return p;
}

export function ignite(sim: Sim, b: Building): void {
  if (b.fire > 0 || b.state === BState.Rubble || b.state === BState.Construction) return;
  b.fire = 0.05;
  b.burn = 0;
  sim.state.burning.push(b.id);
  sim.state.burning.sort((x, y) => x - y);
  sim.markBuildingDirty(b.id);
  sim.events.push({ kind: 'fire', id: b.id });
  dispatch(sim, 'fire', 'fire', b.id);
}

/**
 * Chance of a crime at an active home or business this hour: more with unemployment, poverty and
 * unhappiness, less with police coverage and a neighbourhood watch; scaled by how full it is.
 */
export function crimeRisk(sim: Sim, b: Building): number {
  if (b.zone === ZONE_I) return 0;
  const workers = Math.max(1, b.seekers);
  const unemp = b.zone === ZONE_R ? Math.max(0, b.seekers - b.employed) / workers : 0;
  return (
    (sim.policyAt('neighbourhoodWatch', b.x, b.z) ? POLICY_EFFECTS.neighbourhoodWatch : 1) *
    SERVICES.crimeBase *
    (1 + 2 * unemp + (b.wealth === 0 ? 0.5 : 0) + 1.5 * Math.max(0, 0.5 - b.happiness)) *
    (1 - SERVICES.crimePoliceCut * b.covPolice) *
    (b.pop / Math.max(1, b.cap))
  );
}

/** Hourly: roll fires, crimes and emergencies; retry dispatch for fires still waiting. */
export function incidentsHour(sim: Sim): void {
  const s = sim.state;
  const rng = sim.rng.events;
  const engines = new Set<number>();
  for (const v of s.vehicles.values()) if (v.kind === 'fire') engines.add(v.target);
  for (const id of s.burning) if (!engines.has(id)) dispatch(sim, 'fire', 'fire', id);
  for (const b of [...s.buildings.values()]) {
    if (b.state !== BState.Active && b.state !== BState.Abandoned) continue;
    if (b.fire <= 0 && rng.chance(fireRisk(sim, b))) ignite(sim, b);
    if (b.state !== BState.Active) continue;
    if (b.zone !== ZONE_I) {
      if (rng.chance(crimeRisk(sim, b))) {
        const inc: Incident = {
          id: s.nextId++,
          kind: 'crime',
          building: b.id,
          deadline: s.tick + SERVICES.crimeWindow,
          responder: 0,
        };
        s.incidents.set(inc.id, inc);
        const v = dispatch(sim, 'police', 'police', b.id, inc.id);
        if (v) inc.responder = v.id;
      }
    }
    // Emergencies: a small base rate plus a share of new sickness (so pollution brings ambulances).
    if (
      b.zone === ZONE_R &&
      b.pop > 0 &&
      rng.chance(
        Math.min(
          0.3,
          SERVICES.emergencyRate * b.pop +
            SERVICES.emergencyPerCase * (b.pop - b.sick) * (sicknessRate(sim, b) - HEALTH.baseRate),
        ),
      )
    ) {
      const inc: Incident = {
        id: s.nextId++,
        kind: 'emergency',
        building: b.id,
        deadline: s.tick + SERVICES.emergencyWindow,
        responder: 0,
      };
      s.incidents.set(inc.id, inc);
      const v = dispatch(sim, 'health', 'ambulance', b.id, inc.id);
      if (v) inc.responder = v.id;
    }
    b.rubbleH = 0;
  }
  // Rubble clears itself after a while so the lot can regrow.
  for (const b of [...s.buildings.values()]) {
    if (b.state !== BState.Rubble) continue;
    b.rubbleH++;
    if (b.rubbleH >= SERVICES.rubbleClearHours) sim.removeBuilding(b.id);
  }
}

/** Every tick: fires grow, spread and collapse; late incidents resolve badly. */
export function incidentsTick(sim: Sim): void {
  const s = sim.state;
  if (s.burning.length) {
    const spread = s.tick % SERVICES.fireSpreadEvery === 0;
    for (const id of [...s.burning]) {
      const b = s.buildings.get(id);
      if (!b || b.fire <= 0) {
        s.burning = s.burning.filter((x) => x !== id);
        continue;
      }
      const before = Math.round(b.fire * 10);
      if (b.fire < 1) b.fire = Math.min(1, b.fire + SERVICES.fireGrowth);
      else b.burn++;
      if (Math.round(b.fire * 10) !== before) sim.markBuildingDirty(b.id);
      if (spread && b.fire > 0.5) {
        const r = footprint(b, -SERVICES.fireSpreadRange);
        for (const nid of sim.bldHash.queryPoint(b.x, b.z, 60)) {
          if (nid === b.id) continue;
          const nb = s.buildings.get(nid)!;
          if (nb.fire > 0 || !rectsOverlap(r, footprint(nb))) continue;
          if (sim.rng.events.chance(SERVICES.fireSpreadChance * b.fire * (1 - 0.5 * nb.covFire)))
            ignite(sim, nb);
        }
      }
      if (b.burn >= SERVICES.fireDestroyTicks) toRubble(sim, b);
    }
  }
  if (s.incidents.size) {
    for (const inc of [...s.incidents.values()]) {
      if (s.tick < inc.deadline) continue;
      s.incidents.delete(inc.id);
      const b = s.buildings.get(inc.building);
      if (!b) continue;
      if (inc.kind === 'crime') {
        sim.addCrime(b.x, b.z, 0.12);
        sim.events.push({ kind: 'crime', id: b.id });
      } else {
        b.pop = Math.max(0, b.pop - 1);
        b.sick = Math.min(b.sick, b.pop);
        sim.events.push({ kind: 'death', id: b.id });
      }
      const v = inc.responder ? s.vehicles.get(inc.responder) : undefined;
      if (v && v.phase === 'out') v.ref = 0;
    }
  }
}

export function toRubble(
  sim: Sim,
  b: Building,
  why: 'destroyed' | 'decayed' | 'collapsed' = 'destroyed',
): void {
  b.state = BState.Rubble;
  b.fire = 0;
  b.burn = 0;
  b.pop = 0;
  b.sick = 0;
  b.employed = 0;
  b.seekers = 0;
  b.rubbleH = 0;
  b.progress = 0;
  sim.state.burning = sim.state.burning.filter((x) => x !== b.id);
  sim.markBuildingDirty(b.id);
  sim.events.push({ kind: why, id: b.id });
}

registerVehicleKind('fire', {
  arrive(_sim, v) {
    v.phase = 'work';
    v.wait = 1;
  },
  workDone(sim, v) {
    const b = sim.state.buildings.get(v.target);
    if (b && b.fire > 0 && b.state !== BState.Rubble) {
      const before = Math.round(b.fire * 10);
      b.fire = Math.max(0, b.fire - SERVICES.extinguishRate * Math.min(1.25, sim.fundingEff('fire')));
      if (b.fire <= 0) {
        b.burn = 0;
        sim.state.burning = sim.state.burning.filter((x) => x !== b.id);
        sim.events.push({ kind: 'fireOut', id: b.id });
      }
      if (Math.round(b.fire * 10) !== before) sim.markBuildingDirty(b.id);
      if (b.fire > 0) {
        v.wait = 1;
        return;
      }
    }
    sendHome(sim, v);
  },
  home(sim, v) {
    despawnVehicle(sim, v);
  },
});

for (const kind of ['police', 'ambulance'] as const) {
  registerVehicleKind(kind, {
    arrive(sim, v) {
      const inc = v.ref ? sim.state.incidents.get(v.ref) : undefined;
      if (inc) {
        sim.state.incidents.delete(inc.id);
        sim.events.push({ kind: kind === 'police' ? 'crimeStopped' : 'patientSaved', id: inc.building });
      }
      v.phase = 'work';
      v.wait = kind === 'police' ? 20 : 30;
    },
    workDone(sim, v) {
      sendHome(sim, v);
    },
    home(sim, v) {
      despawnVehicle(sim, v);
    },
  });
}

export { CIVIC };
