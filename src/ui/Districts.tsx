import { useEffect, useState } from 'preact/hooks';
import { POLICIES, policyCost } from '../data/policies';
import type { DistrictReport } from '../sim/protocol';
import { districtColour } from '../client/districtView';
import { formatMoney, useGameUpdates } from './hooks';

const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * The Districts panel (M21): every district with its people, jobs, happiness and land value, what
 * it pays in taxes against what its civic buildings and policies cost, its own policies, its name,
 * and data maps filtered to it.
 */
export function DistrictsPanel() {
  const game = useGameUpdates(300);
  const [reports, setReports] = useState<DistrictReport[]>([]);
  const open = game.panel === 'districts';
  const version = game.world.districtsVersion;
  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = () =>
      void game.client.query<DistrictReport[]>({ type: 'districts' }).then((r) => live && setReports(r));
    load();
    const t = setInterval(load, 1000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [open, game, version]);
  if (!open) return null;
  const w = game.world;
  const st = w.stats;
  const list = [...w.districts.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
  const sel =
    game.districts.selected && w.districts.has(game.districts.selected) ? game.districts.selected : 0;
  const d = sel ? w.districts.get(sel)! : undefined;
  const rep = reports.find((r) => r.id === sel);
  const allTaxes = reports.reduce((s, r) => s + r.taxes, 0);
  // Policies cost a district its share of the people who live or work in the city.
  const everyone = reports.reduce((s, r) => s + r.population + r.jobs, 0);
  // Picking a district also points the brush at it; with none picked the brush starts a new one
  // (never the eraser, which the tool's 0 means).
  const pick = (id: number) => {
    game.districts.selected = id;
    if (game.tools.activeId === 'district') game.tools.district.pick(id || 'new');
    game.notify();
  };
  const act = (cmd: Parameters<typeof game.dispatch>[0], done?: string) =>
    void game.dispatch(cmd).then((r) => {
      if (!r.ok) game.toast(r.reason, 'bad');
      else if (done) game.toast(done, 'ok', 2000);
    });
  const peak = st.unlockAll ? Infinity : st.peak;
  const filter = game.overlay.district;
  return (
    <aside class="advisors districts panel" data-testid="districts-panel">
      <header>
        <h2>Districts</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('districts')}>
          ×
        </button>
      </header>
      <div class="advisors-list">
        {!list.length && (
          <p class="muted" data-testid="districts-empty">
            Paint a district with the district tool (I): it takes the neighbourhood's name, which you can
            change here. A district can have its own policies, and data maps can show it alone.
          </p>
        )}
        {list.length > 0 && (
          <ul class="district-list" role="listbox" aria-label="Districts">
            {list.map((x) => {
              const r = reports.find((y) => y.id === x.id);
              return (
                <li key={x.id}>
                  <button
                    class={`district-row ${x.id === sel ? 'active' : ''}`}
                    role="option"
                    aria-selected={x.id === sel}
                    data-testid={`district-${x.id}`}
                    onClick={() => pick(x.id)}
                  >
                    <span class="district-swatch" style={{ background: districtColour(x.color) }} />
                    <span class="district-row-name">{x.name}</span>
                    <span class="muted">{r ? `${r.population.toLocaleString('en-US')} people` : ''}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {d && (
          <section class="district-detail" data-testid="district-detail">
            <label class="district-rename">
              <span class="muted">Name</span>
              <input
                key={`${d.id}:${d.name}`}
                type="text"
                maxLength={32}
                defaultValue={d.name}
                data-testid="district-name"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  e.stopPropagation();
                }}
                onBlur={(e) => {
                  const v = (e.target as HTMLInputElement).value.trim();
                  if (v && v !== d.name) act({ type: 'renameDistrict', district: d.id, name: v });
                }}
              />
            </label>
            {rep && (
              <dl data-testid="district-figures">
                <dt>Residents</dt>
                <dd>{rep.population.toLocaleString('en-US')}</dd>
                <dt>Jobs</dt>
                <dd>{rep.jobs.toLocaleString('en-US')}</dd>
                <dt>Happiness</dt>
                <dd>{rep.population ? pct(rep.happiness) : '—'}</dd>
                <dt>Land value</dt>
                <dd>{pct(rep.landValue)}</dd>
                <dt>Taxes paid</dt>
                <dd>
                  {formatMoney(rep.taxes)}/mo
                  {allTaxes > 0 ? ` (${pct(rep.taxes / allTaxes)} of the city's)` : ''}
                </dd>
                <dt>Civic upkeep here</dt>
                <dd>{formatMoney(rep.upkeep)}/mo</dd>
                <dt>Its policies</dt>
                <dd>{formatMoney(rep.policies)}/mo</dd>
              </dl>
            )}
            <h3>Policies here</h3>
            <ul class="policy-list" data-testid="district-policies">
              {POLICIES.filter((p) => p.scope !== 'city').map((p) => {
                const city = st.policies.includes(p.id);
                const on = d.policies.includes(p.id);
                const locked = peak < p.unlockPopulation;
                const share = rep && everyone > 0 ? (rep.population + rep.jobs) / everyone : 0;
                return (
                  <li key={p.id} class={`policy ${on || city ? 'on' : ''} ${locked ? 'locked' : ''}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={on || city}
                        disabled={locked || city}
                        data-testid={`district-policy-${p.id}`}
                        onChange={(e) =>
                          act({
                            type: 'setDistrictPolicy',
                            district: d.id,
                            policy: p.id,
                            on: (e.target as HTMLInputElement).checked,
                          })
                        }
                      />
                      <span class="policy-name">
                        {p.name}
                        {p.scope === 'district' ? <span class="badge">District</span> : null}
                      </span>
                      <span class="policy-cost">
                        {city
                          ? 'City-wide'
                          : p.costBase || p.costPerResident
                            ? `${formatMoney(policyCost(p, st.population) * share)}/mo`
                            : 'Free'}
                      </span>
                    </label>
                    <div class="policy-effect">
                      {locked ? `Unlocks at ${p.unlockPopulation.toLocaleString('en-US')} residents. ` : ''}
                      {p.effect}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div class="district-actions">
              <button
                class={`btn small ${filter === d.id ? 'active' : ''}`}
                aria-pressed={filter === d.id}
                data-testid="district-filter"
                title="Data maps show only this district"
                onClick={() => {
                  game.overlay.setDistrict(filter === d.id ? null : d.id);
                  if (filter !== d.id && !game.overlay.active) game.overlay.set('landValue');
                }}
              >
                {filter === d.id ? 'Showing it alone on data maps' : 'Data maps: this district only'}
              </button>
              <button
                class="btn small"
                data-testid="district-paint"
                onClick={() => {
                  game.tools.use('district');
                  game.tools.district.pick(d.id);
                }}
              >
                Paint more
              </button>
              <button
                class="btn small danger"
                data-testid="district-remove"
                onClick={() => {
                  act({ type: 'removeDistrict', district: d.id }, `${d.name} is no longer a district`);
                  pick(0);
                }}
              >
                Dissolve
              </button>
            </div>
          </section>
        )}
        {!d && list.length > 0 && (
          <p class="muted">Pick a district for its figures, its name and its own policies.</p>
        )}
      </div>
    </aside>
  );
}
