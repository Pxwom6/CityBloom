import type { Game } from '../game';
import type { Advice, AdvisorId } from '../sim/systems/advisors';
import { useGameUpdates } from './hooks';
import { IconBolt, IconBook, IconHealth, IconMoney, IconRoad, IconShield, IconTree, IconZone } from './icons';

const ADVISORS: { id: AdvisorId; name: string; Icon: typeof IconBolt }[] = [
  { id: 'finance', name: 'Finance', Icon: IconMoney },
  { id: 'utilities', name: 'Utilities', Icon: IconBolt },
  { id: 'safety', name: 'Safety', Icon: IconShield },
  { id: 'health', name: 'Health', Icon: IconHealth },
  { id: 'education', name: 'Education', Icon: IconBook },
  { id: 'transport', name: 'Transport', Icon: IconRoad },
  { id: 'environment', name: 'Environment', Icon: IconTree },
  { id: 'planning', name: 'Planning', Icon: IconZone },
];

const TONE = ['good', 'notice', 'warning', 'urgent'] as const;
const TONE_LABEL = ['All good', 'Worth a look', 'Needs attention', 'Urgent'];

/** Advisors: each names what's wrong in their area, what to do, and flies the camera there. */
export function AdvisorsPanel() {
  const game = useGameUpdates(500);
  if (game.panel !== 'advisors') return null;
  const all = game.advice;
  return (
    <aside class="advisors panel" data-testid="advisors">
      <header>
        <h2>Advisors</h2>
        <button class="btn icon" aria-label="Close" onClick={() => game.openPanel('advisors')}>
          ×
        </button>
      </header>
      <div class="advisors-list">
        {ADVISORS.map(({ id, name, Icon }) => {
          const items = all.filter((a) => a.advisor === id).slice(0, 3);
          if (!items.length) return null;
          const worst = Math.max(...items.map((a) => a.severity));
          return (
            <section key={id} class={`advisor ${TONE[worst]}`} data-testid={`advisor-${id}`}>
              <div class="advisor-head">
                <span class="advisor-icon">
                  <Icon />
                </span>
                <strong>{name}</strong>
                <span class={`advisor-status ${TONE[worst]}`}>{TONE_LABEL[worst]}</span>
              </div>
              {items.map((a, i) => (
                <AdviceItem key={i} a={a} />
              ))}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

/** "Ivy Row and 2 more streets can't reach the highway" (P1): the roads by name. */
function islandTitle(game: Game, segs: number[]): string {
  const names = [...new Set(segs.map((id) => game.names.street(id)))];
  const more = names.length - 1;
  return `${names[0]}${more ? ` and ${more} more street${more === 1 ? '' : 's'}` : ''} can’t reach the highway`;
}

function AdviceItem({ a }: { a: Advice }) {
  const game = useGameUpdates(1000);
  return (
    <div class="advice" data-testid={a.segs?.length ? 'advice-island' : undefined}>
      <div class="advice-title">{a.segs?.length ? islandTitle(game, a.segs) : a.title}</div>
      <div class="advice-text">
        {a.at &&
        !a.segs?.length &&
        (a.advisor === 'transport' || a.advisor === 'safety' || a.advisor === 'environment')
          ? `Near ${game.names.address(a.at.x, a.at.z)}. `
          : ''}
        {a.text}
      </div>
      {(a.at || a.map) && (
        <div class="advice-actions">
          {a.at && (
            <button class="btn small" data-testid="advice-show" onClick={() => game.flyTo(a.at!, a.map)}>
              Show me
            </button>
          )}
          {a.map && !a.at && (
            <button class="btn small" onClick={() => game.overlay.set(a.map as never)}>
              Open map
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Top-bar button: the advisors, with a count of things that need attention. */
export function AdvisorsButton() {
  const game = useGameUpdates(500);
  const urgent = game.advice.filter((a) => a.severity >= 2).length;
  const worst = game.advice.reduce((m, a) => Math.max(m, a.severity), 0);
  return (
    <button
      class={`btn advisors-btn ${game.panel === 'advisors' ? 'active' : ''}`}
      data-testid="open-advisors"
      title="Advisors (J)"
      onClick={() => game.openPanel('advisors')}
    >
      Advisors
      {urgent > 0 && <span class={`badge ${TONE[worst]}`}>{urgent}</span>}
    </button>
  );
}
