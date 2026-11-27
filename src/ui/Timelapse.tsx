import { useEffect, useState } from 'preact/hooks';
import type { Chronicle } from '../sim/systems/chronicle';
import { dateOf, monthLabel } from '../sim/time';
import { fileName, shareOrDownload } from '../client/shareFile';
import type { TimelapseView } from '../client/timelapseThin';
import { TIMELAPSE } from '../client/timelapseThin';
import {
  makeTimelapseVideo,
  videoSupport,
  type TimelapseOverlays,
  type TimelapseVideo,
  type VideoSupport,
} from '../client/timelapseVideo';
import { eventLabel } from './History';
import { useGame, useGameUpdates } from './hooks';

/**
 * The timelapse in City history (M45): what has been recorded (and since when: a city older than its
 * recording says so plainly), and Make timelapse: a length, a view, overlays and music, then the video
 * to watch, share or download, and its first and last frames as pictures.
 */

const mb = (n: number) => `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;

/** The section at the top of City history. */
export function TimelapseSection() {
  const game = useGameUpdates(1000);
  const info = game.timelapse.info();
  const on = game.settings.timelapse;
  if (!info) return null;
  const frames = info.frames.wide + info.frames.orbit;
  const since = monthLabel(dateOf(info.startTick).totalMonths);
  return (
    <section class="timelapse-section" data-testid="timelapse-section">
      <div class="timelapse-line">
        <strong>Timelapse</strong>
        <span class="muted" data-testid="timelapse-recorded">
          {frames > 0
            ? `${frames} frames since ${since} · ${mb(info.bytes)}`
            : on
              ? 'The first frames come as the city plays.'
              : 'Nothing recorded yet.'}
        </span>
        <button
          class="btn small"
          data-testid="timelapse-open"
          disabled={Math.min(info.frames.wide, info.frames.orbit) < 2}
          onClick={() => {
            game.timelapseCard = true;
            game.notify();
          }}
        >
          Make timelapse
        </button>
      </div>
      {info.late && (
        <p class="note" data-testid="timelapse-late">
          This city is older than its timelapse: recording began in {since}, when this version of the game
          first opened it, so its video starts there.
        </p>
      )}
      {!on && (
        <p class="note" data-testid="timelapse-off">
          Recording is off (Settings → Game → Record a timelapse).
        </p>
      )}
    </section>
  );
}

const VIEWS: { id: TimelapseView; name: string }[] = [
  { id: 'wide', name: 'Whole map' },
  { id: 'orbit', name: 'Busiest area' },
];

/** Make timelapse: the choices, the progress, then the video. */
export function TimelapseCard() {
  const game = useGame();
  useGameUpdates(500);
  const [seconds, setSeconds] = useState<number>(30);
  const [view, setView] = useState<TimelapseView>('wide');
  const [overlays, setOverlays] = useState<TimelapseOverlays>({
    name: true,
    date: true,
    population: true,
    events: true,
  });
  const [music, setMusic] = useState(false);
  const [support, setSupport] = useState<VideoSupport | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [video, setVideo] = useState<(TimelapseVideo & { url: string }) | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const open = game.timelapseCard;
  useEffect(() => {
    if (open && !support) void videoSupport().then(setSupport);
  }, [open]);
  useEffect(() => () => video && URL.revokeObjectURL(video.url), [video]);
  if (!open) return null;
  const info = game.timelapse.info();
  const city = game.world.stats.cityName;
  const close = () => {
    game.timelapseCard = false;
    setVideo(null);
    setProgress(null);
    game.notify();
  };
  const make = async () => {
    const key = game.timelapse.key;
    if (!key) return;
    setWhy(null);
    setVideo(null);
    setProgress(0);
    try {
      const frames = await game.timelapse.store.frames(key, view);
      const chronicle = await game.client.query<Chronicle>({ type: 'chronicle' });
      const events = chronicle.events
        .filter((e) => e.kind === 'milestone' || e.kind === 'disaster')
        .map((e) => ({ tick: e.tick, label: eventLabel(e) }));
      const v = await makeTimelapseVideo({
        frames,
        seconds,
        cityName: city,
        overlays,
        events,
        music,
        onProgress: (p) => setProgress(p),
      });
      setVideo({ ...v, url: URL.createObjectURL(v.blob) });
    } catch (e) {
      setWhy(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  const busy = progress !== null;
  const toggle = (k: keyof TimelapseOverlays) => setOverlays({ ...overlays, [k]: !overlays[k] });
  const tag = `${seconds}s-${view}`;
  return (
    <div class="modal-backdrop" data-testid="timelapse-card">
      <div class="modal panel timelapse-modal">
        <div class="milestone-kicker">City history</div>
        <h2>Make a timelapse</h2>
        {info && (
          <p class="muted">
            {info.frames[view]} frames of this view since {monthLabel(dateOf(info.startTick).totalMonths)}.
          </p>
        )}
        <div class="timelapse-choices">
          <div class="field">
            <span>Length</span>
            <div class="segmented" role="radiogroup">
              {TIMELAPSE.lengths.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={seconds === s}
                  class={seconds === s ? 'active' : ''}
                  data-testid={`timelapse-length-${s}`}
                  disabled={busy}
                  onClick={() => setSeconds(s)}
                >
                  {s} s
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span>View</span>
            <div class="segmented" role="radiogroup">
              {VIEWS.map((v) => (
                <button
                  key={v.id}
                  role="radio"
                  aria-checked={view === v.id}
                  class={view === v.id ? 'active' : ''}
                  data-testid={`timelapse-view-${v.id}`}
                  disabled={busy}
                  onClick={() => setView(v.id)}
                >
                  {v.name}
                </button>
              ))}
            </div>
          </div>
          <div class="field">
            <span>On the video</span>
            {(
              [
                ['name', 'The city’s name'],
                ['date', 'The date'],
                ['population', 'Population'],
                ['events', 'Milestones and disasters'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} class="check">
                <input
                  type="checkbox"
                  checked={overlays[k]}
                  disabled={busy}
                  data-testid={`timelapse-overlay-${k}`}
                  onChange={() => toggle(k)}
                />
                <span>{label}</span>
              </label>
            ))}
            <label class="check">
              <input
                type="checkbox"
                checked={music && !!support?.audio}
                disabled={busy || !support?.audio}
                data-testid="timelapse-music"
                onChange={() => setMusic(!music)}
              />
              <span>
                Music
                {support && !support.audio && (
                  <small class="muted"> (this browser can’t put sound in a video)</small>
                )}
              </span>
            </label>
          </div>
        </div>
        {support && !support.video && (
          <p class="neg">This browser can’t make videos. Chrome, Edge or Safari can.</p>
        )}
        {busy && (
          <div class="timelapse-progress" data-testid="timelapse-progress">
            <div class="milestone-bar" aria-hidden="true">
              <span style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
            </div>
            <small class="muted">Making the video… {Math.round((progress ?? 0) * 100)} %</small>
          </div>
        )}
        {why && (
          <p class="neg" data-testid="timelapse-error">
            {why}
          </p>
        )}
        {video && (
          <div class="timelapse-result" data-testid="timelapse-result">
            <video
              class="timelapse-video"
              data-testid="timelapse-video"
              src={video.url}
              controls
              playsInline
              muted={!video.audio}
            />
            <small class="muted">
              {video.seconds} s · {mb(video.blob.size)} · {video.ext.toUpperCase()}
              {video.audio ? ' with music' : ''}
            </small>
            <div class="timelapse-actions">
              <button
                class="btn active"
                data-testid="timelapse-download"
                onClick={() =>
                  void shareOrDownload(video.blob, fileName(city, `timelapse-${tag}.${video.ext}`), city)
                }
              >
                Share or save the video
              </button>
              <button
                class="btn"
                data-testid="timelapse-first"
                onClick={() => void shareOrDownload(video.first, fileName(city, 'first.jpg'), city)}
              >
                First picture
              </button>
              <button
                class="btn"
                data-testid="timelapse-last"
                onClick={() => void shareOrDownload(video.last, fileName(city, 'last.jpg'), city)}
              >
                Last picture
              </button>
            </div>
          </div>
        )}
        <div class="modal-actions">
          <button class="btn" data-testid="timelapse-close" onClick={close} disabled={busy}>
            Close
          </button>
          <button
            class="btn active"
            data-testid="timelapse-make"
            disabled={busy || !support?.video || (info?.frames[view] ?? 0) < 2}
            onClick={() => void make()}
          >
            {video ? 'Make another' : 'Make'}
          </button>
        </div>
      </div>
    </div>
  );
}
