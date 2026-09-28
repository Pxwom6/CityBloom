import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeSave } from '../src/client/saves';
import { Sim } from '../src/sim/sim';
import { districtAt, districtFigures } from '../src/sim/systems/districts';
import { TICKS_PER_MONTH } from '../src/sim/time';
import { buildTown, connectPoint, newSim } from './helpers';

describe('districts (M21)', () => {
  it('are named, painted with a brush, erased, renamed and removed, and a drag is one undo step', () => {
    const sim = newSim({ seed: 'dist' });
    const c = connectPoint(sim);
    const r = sim.dispatch({ type: 'createDistrict', name: '  Old   Town ' });
    expect(r.ok).toBe(true);
    const id = r.ok ? r.created![0]! : 0;
    expect(id).toBe(1);
    expect(sim.state.districts.get(id)).toMatchObject({ name: 'Old Town', color: 0, policies: [] });
    expect(sim.dispatch({ type: 'createDistrict', name: '   ' })).toMatchObject({ ok: false });
    // Two brush commands from one drag.
    const brush = (points: { x: number; z: number }[], district = id) =>
      sim.dispatch({
        type: 'paintDistrict',
        district,
        area: { kind: 'brush', points, radius: 40 },
        stroke: 3,
      });
    expect(brush([c, { x: c.x + 100, z: c.z }]).ok).toBe(true);
    expect(
      brush([
        { x: c.x + 100, z: c.z },
        { x: c.x + 200, z: c.z },
      ]).ok,
    ).toBe(true);
    expect(districtAt(sim.state.districtCells, c.x + 150, c.z + 10)).toBe(id);
    expect(districtAt(sim.state.districtCells, c.x + 150, c.z + 80)).toBe(0);
    const painted = sim.state.districtCells.reduce((n, v) => n + (v === id ? 1 : 0), 0);
    expect(painted).toBeGreaterThan(50);
    expect(sim.history.undo[sim.history.undo.length - 1]!.label).toBe('district painting');
    sim.dispatch({ type: 'undo' });
    expect(sim.state.districtCells.every((v) => v === 0)).toBe(true);
    sim.dispatch({ type: 'redo' });
    expect(sim.state.districtCells.reduce((n, v) => n + (v === id ? 1 : 0), 0)).toBe(painted);
    // Erasing, a second district over part of the first, renaming and removing.
    expect(brush([{ x: c.x + 190, z: c.z }], 0).ok).toBe(true);
    expect(districtAt(sim.state.districtCells, c.x + 190, c.z)).toBe(0);
    const two = sim.dispatch({ type: 'createDistrict', name: 'Riverside' });
    const id2 = two.ok ? two.created![0]! : 0;
    expect(sim.state.districts.get(id2)!.color).toBe(1);
    brush([{ x: c.x + 50, z: c.z }], id2);
    expect(districtAt(sim.state.districtCells, c.x + 50, c.z)).toBe(id2);
    expect(sim.dispatch({ type: 'renameDistrict', district: id2, name: 'Quayside' }).ok).toBe(true);
    expect(sim.state.districts.get(id2)!.name).toBe('Quayside');
    expect(sim.dispatch({ type: 'removeDistrict', district: id }).ok).toBe(true);
    expect(sim.state.districtCells.some((v) => v === id)).toBe(false);
    expect(districtAt(sim.state.districtCells, c.x + 50, c.z)).toBe(id2);
    // The lowest free id is reused.
    const three = sim.dispatch({ type: 'createDistrict', name: 'Hilltop' });
    expect(three.ok && three.created![0]).toBe(1);
    // Saved and loaded, exactly.
    const again = Sim.fromSave(JSON.parse(JSON.stringify(sim.save())));
    expect(again.hash()).toBe(sim.hash());
    expect(again.state.districts.get(id2)!.name).toBe('Quayside');
  });

  it('policies: district-only ones go on districts, city-only ones on the city', () => {
    const sim = newSim({ seed: 'dist2' });
    sim.dispatch({ type: 'cheat', cheat: 'unlockAll' });
    const r = sim.dispatch({ type: 'createDistrict', name: 'Old Town' });
    const id = r.ok ? r.created![0]! : 0;
    expect(sim.dispatch({ type: 'setPolicy', id: 'heritage', on: true })).toMatchObject({ ok: false });
    expect(
      sim.dispatch({ type: 'setDistrictPolicy', district: id, policy: 'tourismCampaign', on: true }),
    ).toMatchObject({
      ok: false,
    });
    expect(sim.dispatch({ type: 'setDistrictPolicy', district: id, policy: 'heritage', on: true }).ok).toBe(
      true,
    );
    expect(sim.dispatch({ type: 'setDistrictPolicy', district: id, policy: 'recycling', on: true }).ok).toBe(
      true,
    );
    expect(sim.state.districts.get(id)!.policies).toEqual(['heritage', 'recycling']);
    // Already in force across the city: no point in a district too.
    sim.dispatch({ type: 'setPolicy', id: 'fireSafety', on: true });
    expect(
      sim.dispatch({ type: 'setDistrictPolicy', district: id, policy: 'fireSafety', on: true }),
    ).toMatchObject({
      ok: false,
    });
    expect(sim.dispatch({ type: 'setDistrictPolicy', district: id, policy: 'recycling', on: false }).ok).toBe(
      true,
    );
    expect(sim.state.districts.get(id)!.policies).toEqual(['heritage']);
  });

  it('a grown town reports figures per district, and older saves load without districts and play on', () => {
    const sim = newSim({ seed: 'dist3' });
    buildTown(sim);
    sim.advance(3 * TICKS_PER_MONTH);
    const c = connectPoint(sim);
    const r = sim.dispatch({ type: 'createDistrict', name: 'West End' });
    const id = r.ok ? r.created![0]! : 0;
    sim.dispatch({
      type: 'paintDistrict',
      district: id,
      area: { kind: 'brush', points: [c, { x: c.x + 200, z: c.z }], radius: 200 },
    });
    const f = districtFigures(sim);
    const total = sim.state.totals.population;
    expect(f.get(id)!.population).toBeGreaterThan(0);
    expect(f.get(id)!.population + f.get(0)!.population).toBe(total);
    const reports = sim.query({ type: 'districts' }) as { id: number; taxes: number }[];
    expect(reports.find((x) => x.id === id)!.taxes).toBeGreaterThan(0);
    // The version-10 playtest save.
    const old = Sim.fromSave(decodeSave(readFileSync('Saves/Ashton.citybloom')));
    expect(old.state.districts.size).toBe(0);
    expect(old.state.districtCells.length).toBe(128 * 128);
    old.testMode = true;
    old.advance(TICKS_PER_MONTH / 4);
    const again = Sim.fromSave(JSON.parse(JSON.stringify(old.save())));
    expect(again.hash()).toBe(old.hash());
  });
});
