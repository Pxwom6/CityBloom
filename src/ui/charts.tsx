import { useState } from 'preact/hooks';

/**
 * Small SVG charts for the budget (one axis each, thin marks, recessive grid, hover tooltip).
 * Colours come from CSS tokens (--chart-*).
 */
export interface Point {
  label: string;
  value: number;
}

const W = 300;
const H = 120;
const PAD = { l: 44, r: 8, t: 10, b: 20 };

function niceTicks(min: number, max: number, count = 3): number[] {
  if (min === max) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? mag * 10;
  const out: number[] = [];
  const top = Math.ceil(max / step - 1e-9) * step;
  for (let v = Math.floor(min / step + 1e-9) * step; v <= top + step * 1e-6; v += step)
    out.push(Math.round(v * 1e6) / 1e6);
  if (out.length < 2) out.push(out[0]! + step);
  return out;
}

export function compactMoney(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${sign}$${Math.round(a)}`;
}

function Frame(props: {
  ticks: number[];
  y: (v: number) => number;
  children: preact.ComponentChildren;
  title: string;
  fmt?: (v: number) => string;
}) {
  const fmt = props.fmt ?? compactMoney;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} class="chart" role="img" aria-label={props.title}>
      {props.ticks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={props.y(t)}
            y2={props.y(t)}
            class={t === 0 ? 'chart-base' : 'chart-grid'}
          />
          <text x={PAD.l - 6} y={props.y(t) + 3} class="chart-tick" text-anchor="end">
            {fmt(t)}
          </text>
        </g>
      ))}
      {props.children}
    </svg>
  );
}

/** Single-series line with a crosshair tooltip. */
export function LineChart({ points, title }: { points: Point[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <div class="chart-empty">History appears after the first month closes.</div>;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(...vals));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (points.length - 1);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo || 1));
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const hp = hover !== null ? points[hover] : null;
  return (
    <div class="chart-wrap">
      <Frame ticks={ticks} y={y} title={title}>
        <path d={d} class="chart-line" />
        {hover !== null && hp && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b} class="chart-cross" />
            <circle cx={x(hover)} cy={y(hp.value)} r={4} class="chart-dot" />
          </g>
        )}
        <text x={PAD.l} y={H - 4} class="chart-tick">
          {points[0]!.label}
        </text>
        <text x={W - PAD.r} y={H - 4} class="chart-tick" text-anchor="end">
          {points[points.length - 1]!.label}
        </text>
        <rect
          x={PAD.l}
          y={PAD.t}
          width={W - PAD.l - PAD.r}
          height={H - PAD.t - PAD.b}
          fill="transparent"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            const f = (e.clientX - r.left) / r.width;
            setHover(Math.max(0, Math.min(points.length - 1, Math.round(f * (points.length - 1)))));
          }}
          onMouseLeave={() => setHover(null)}
        />
      </Frame>
      {hp && (
        <div class="chart-tip">
          <strong>{hp.label}</strong> {compactMoney(hp.value)}
        </div>
      )}
    </div>
  );
}

/** Bars around a zero baseline; positive and negative use the two diverging poles. */
export function BarChart({ points, title }: { points: Point[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!points.length) return <div class="chart-empty">No months closed yet.</div>;
  const vals = points.map((p) => p.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals));
  const lo = ticks[0]!;
  const hi = ticks[ticks.length - 1]!;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo || 1));
  const slot = (W - PAD.l - PAD.r) / points.length;
  const bw = Math.max(2, Math.min(14, slot - 2));
  const hp = hover !== null ? points[hover] : null;
  return (
    <div class="chart-wrap">
      <Frame ticks={ticks} y={y} title={title}>
        {points.map((p, i) => {
          const x0 = PAD.l + slot * i + (slot - bw) / 2;
          const top = Math.min(y(p.value), y(0));
          const h = Math.max(1, Math.abs(y(p.value) - y(0)));
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={PAD.l + slot * i}
                y={PAD.t}
                width={slot}
                height={H - PAD.t - PAD.b}
                fill="transparent"
              />
              <rect
                x={x0}
                y={top}
                width={bw}
                height={h}
                rx={Math.min(4, bw / 2)}
                class={p.value >= 0 ? 'chart-bar-pos' : 'chart-bar-neg'}
                opacity={hover === null || hover === i ? 1 : 0.55}
              />
            </g>
          );
        })}
        <text x={PAD.l} y={H - 4} class="chart-tick">
          {points[0]!.label}
        </text>
        <text x={W - PAD.r} y={H - 4} class="chart-tick" text-anchor="end">
          {points[points.length - 1]!.label}
        </text>
      </Frame>
      {hp && (
        <div class="chart-tip">
          <strong>{hp.label}</strong> {hp.value >= 0 ? '+' : ''}
          {compactMoney(hp.value)}
        </div>
      )}
    </div>
  );
}

export interface TimeSeries {
  name: string;
  values: number[];
  /** Line class: `chart-line` (first series) or `chart-line-2`. */
  cls: string;
}

export interface TimeMarker {
  /** Month since the city began (fractional). */
  month: number;
  kind: 'milestone' | 'disaster';
  label: string;
}

/**
 * A figure over the city's life (M16 history): one axis, one or two series (with a legend), points
 * placed by month, milestone and disaster markers as vertical rules, and a crosshair tooltip that
 * gives the date, the values and any event near it.
 */
export function TimeChart(props: {
  title: string;
  series: TimeSeries[];
  /** Month at the middle of each point, and how many months a point covers. */
  months: number[];
  step: number;
  from: number;
  to: number;
  markers: TimeMarker[];
  fmt: (v: number) => string;
  /** Axis ticks (compact), when they need a shorter form than the tooltip. */
  tickFmt?: (v: number) => string;
  monthLabel: (m: number) => string;
  /** Keep 0 on the axis (counts and rates); money can dip below it. */
  floor?: number;
  ceil?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const idx = props.months.map((_, i) => i).filter((i) => props.months[i]! >= props.from - props.step / 2);
  if (idx.length < 2) return <div class="chart-empty">The history fills in as the months go by.</div>;
  const vals = props.series.flatMap((s) => idx.map((i) => s.values[i]!));
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (props.floor !== undefined) lo = Math.min(lo, props.floor);
  if (props.ceil !== undefined) hi = Math.max(hi, props.ceil);
  const ticks = niceTicks(lo, hi);
  const tlo = ticks[0]!;
  const thi = ticks[ticks.length - 1]!;
  const span = Math.max(1, props.to - props.from);
  const x = (m: number) => PAD.l + ((W - PAD.l - PAD.r) * (m - props.from)) / span;
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - tlo) / (thi - tlo || 1));
  const markers = props.markers.filter((m) => m.month >= props.from && m.month <= props.to);
  const hi2 = hover !== null ? idx[hover]! : null;
  const near =
    hi2 !== null
      ? markers.filter((m) => Math.abs(m.month - props.months[hi2]!) <= Math.max(1, props.step))
      : [];
  return (
    <div class="chart-wrap">
      {props.series.length > 1 && (
        <div class="chart-legend">
          {props.series.map((s) => (
            <span key={s.name}>
              <i class={`chart-key ${s.cls}`} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <Frame ticks={ticks} y={y} title={props.title} fmt={props.tickFmt ?? props.fmt}>
        {markers.map((m, k) => (
          <g key={k} class={`chart-marker ${m.kind}`}>
            <line x1={x(m.month)} x2={x(m.month)} y1={PAD.t} y2={H - PAD.b} />
            {m.kind === 'milestone' ? (
              <circle cx={x(m.month)} cy={PAD.t - 3} r={3} />
            ) : (
              <path d={`M${x(m.month) - 3.5},${PAD.t} l3.5,-6 l3.5,6 z`} />
            )}
          </g>
        ))}
        {props.series.map((s) => (
          <path
            key={s.name}
            class={s.cls}
            d={idx
              .map(
                (i, k) => `${k ? 'L' : 'M'}${x(props.months[i]!).toFixed(1)},${y(s.values[i]!).toFixed(1)}`,
              )
              .join(' ')}
          />
        ))}
        {hi2 !== null && (
          <g>
            <line
              x1={x(props.months[hi2]!)}
              x2={x(props.months[hi2]!)}
              y1={PAD.t}
              y2={H - PAD.b}
              class="chart-cross"
            />
            {props.series.map((s) => (
              <circle
                key={s.name}
                cx={x(props.months[hi2]!)}
                cy={y(s.values[hi2]!)}
                r={4}
                class={`chart-dot ${s.cls === 'chart-line-2' ? 'second' : ''}`}
              />
            ))}
          </g>
        )}
        <text x={PAD.l} y={H - 4} class="chart-tick">
          {props.monthLabel(props.from)}
        </text>
        <text x={W - PAD.r} y={H - 4} class="chart-tick" text-anchor="end">
          {props.monthLabel(props.to)}
        </text>
        <rect
          x={PAD.l}
          y={PAD.t}
          width={W - PAD.l - PAD.r}
          height={H - PAD.t - PAD.b}
          fill="transparent"
          onMouseMove={(e) => {
            const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
            const m = props.from + ((e.clientX - r.left) / r.width) * span;
            let best = 0;
            for (let k = 1; k < idx.length; k++)
              if (Math.abs(props.months[idx[k]!]! - m) < Math.abs(props.months[idx[best]!]! - m)) best = k;
            setHover(best);
          }}
          onMouseLeave={() => setHover(null)}
        />
      </Frame>
      {hi2 !== null && (
        <div class="chart-tip">
          <strong>{props.monthLabel(props.months[hi2]!)}</strong>{' '}
          {props.series
            .map((s) => `${props.series.length > 1 ? `${s.name} ` : ''}${props.fmt(s.values[hi2]!)}`)
            .join(' · ')}
          {near.map((m, k) => (
            <div key={k} class={`chart-tip-event ${m.kind}`}>
              {m.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
