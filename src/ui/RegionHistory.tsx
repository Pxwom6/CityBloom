import { useState } from 'preact/hooks';
import { LIVE } from '../../relay/protocol';
import {
  HISTORY_GROUPS,
  OUTCOME_NAMES,
  STATE_WORDS,
  byDay,
  historyCities,
  historyRows,
  historyState,
  localOffset,
  timeLabel,
  type HistoryGroup,
} from '../client/regionHistory';
import { useGameUpdates } from './hooks';

/**
 * Region at war (M39 step 7, design call 10): the war events the region room keeps, as a list in the
 * City history panel beside the city's own charts. The region runs on real time and the city on game
 * months, so this is a list with real dates and times, newest first, that can be narrowed to a city
 * or to kinds of events; each battle the room still keeps as a replay has a Watch button.
 */
export function RegionAtWar() {
  const game = useGameUpdates(1000);
  const [city, setCity] = useState<number | null>(null);
  const [groups, setGroups] = useState<HistoryGroup[]>([]);
  const view = game.region?.view ?? null;
  const fv = game.friends.view();
  const events = fv.history;
  const state = historyState({
    inRegion: !!view,
    warOn: !!view?.rules?.war,
    events: events.length,
    synced: game.friends.snapshot().synced,
  });
  if (state !== 'list')
    return (
      <p class="note" data-testid="rh-empty">
        {STATE_WORDS[state]}
      </p>
    );
  if (!view) return null;
  const replays = game.replays.list();
  const cities = historyCities(events, view.cities);
  const rows = historyRows(events, replays, { city, groups });
  const now = fv.now || Date.now();
  const offset = localOffset(now);
  const days = byDay(rows, now, offset);
  const toggle = (g: HistoryGroup) =>
    setGroups((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g]));
  return (
    <div class="rh" data-testid="region-history">
      <p class="note">
        What the region has seen its cities do, in real time, newest first: the last {events.length}{' '}
        {events.length === 1 ? 'event' : 'events'}. A battle fought live can be watched again for as long as
        the region keeps it (its last {LIVE.replays} battles).
      </p>
      <div class="rh-filters">
        <label class="rh-city">
          <span class="muted">City</span>
          <select
            data-testid="rh-city"
            value={city === null ? '' : String(city)}
            onChange={(e) =>
              setCity(
                (e.currentTarget as HTMLSelectElement).value === ''
                  ? null
                  : Number((e.currentTarget as HTMLSelectElement).value),
              )
            }
          >
            <option value="">All cities</option>
            {cities.map((c) => (
              <option key={c.slot} value={c.slot}>
                {c.name}
                {c.slot === fv.me ? ' (yours)' : ''}
              </option>
            ))}
          </select>
        </label>
        <div class="rh-kinds" role="group" aria-label="Kinds of events">
          {HISTORY_GROUPS.map((g) => (
            <button
              key={g.id}
              class={`btn small rh-kind ${groups.includes(g.id) ? 'active' : ''}`}
              aria-pressed={groups.includes(g.id)}
              data-testid={`rh-kind-${g.id}`}
              onClick={() => toggle(g.id)}
            >
              {g.name}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p class="note" data-testid="rh-none">
          Nothing in the history matches that. Choose another city or kind.
        </p>
      ) : (
        <div class="rh-list" data-testid="rh-list">
          {days.map((d) => (
            <section key={d.day + d.rows[0]!.id}>
              <h4 class="rh-day" data-testid="rh-day">
                {d.day}
              </h4>
              <ul class="rh-rows">
                {d.rows.map((r) => {
                  const status = r.replay ? game.replays.statusOf(r.replay.from, r.replay.id) : undefined;
                  return (
                    <li
                      key={r.id}
                      class={`rh-row ${r.group} ${r.a === fv.me || r.b === fv.me ? 'mine' : ''}`}
                      data-testid={`rh-row-${r.id}`}
                    >
                      <span class="when">{timeLabel(r.at, offset)}</span>
                      <span class="rh-body">
                        <span class="rh-text">{r.text}</span>
                        {r.outcome && (
                          <span class={`rh-tag ${r.outcome}`} data-testid={`rh-outcome-${r.id}`}>
                            {OUTCOME_NAMES[r.outcome]}
                          </span>
                        )}
                        {r.live && <span class="rh-tag live">Live</span>}
                        {status?.state === 'error' && (
                          <span class="rh-error" role="alert" data-testid={`rh-error-${r.id}`}>
                            {status.why}.
                          </span>
                        )}
                      </span>
                      {r.replay && (
                        <button
                          class="btn"
                          data-testid={`rh-watch-${r.id}`}
                          disabled={status?.state === 'fetching'}
                          title="Watch this battle again, in the defender’s town"
                          onClick={() => void game.watchReplay(r.replay!.from, r.replay!.id)}
                        >
                          {status?.state === 'fetching' ? 'Fetching…' : 'Watch'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
