import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Small, dependency-free SVG charts following the dataviz rules:
 * thin marks (<=24px columns, 4px rounded data-end, square at the baseline),
 * solid hairline grid, one y-axis, per-mark hover/focus tooltips, and a table view elsewhere.
 * Charts draw at their real pixel width so text stays at its true size.
 */

function useWidth<T extends HTMLElement>(fallback = 480) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth || fallback);
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, w] as const;
}

/** A tidy axis: max and evenly spaced ticks. Integer data gets integer ticks. */
export function niceScale(maxValue: number, integer = false): { max: number; ticks: number[] } {
  if (maxValue <= 0) return { max: integer ? 2 : 1, ticks: integer ? [0, 1, 2] : [0, 0.5, 1] };
  const raw = maxValue / 3;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  let step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
  if (integer) step = Math.max(1, Math.ceil(step));
  const max = Math.ceil(maxValue / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { max, ticks };
}

/** Time axes step in units people think in: 15m, 30m, 1h, 2h… */
export function timeScale(maxMin: number): { max: number; ticks: number[] } {
  const steps = [5, 10, 15, 30, 60, 120, 180, 240, 360, 480, 720];
  const step = steps.find((st) => maxMin / st <= 4) ?? 1440;
  const max = Math.max(step, Math.ceil(maxMin / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  return { max, ticks };
}

export function axisMinutes(v: number): string {
  if (v < 60) return `${v}m`;
  return v % 60 === 0 ? `${v / 60}h` : `${Math.floor(v / 60)}h${String(v % 60).padStart(2, '0')}`;
}

function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

export interface ColumnDatum {
  key: string;
  label: string;
  tick: string;
  value: number;
  detail?: string[];
}

export function ColumnChart({
  data,
  color,
  axisFormat,
  valueFormat,
  integer,
  time,
  height = 200,
  ariaLabel,
}: {
  data: ColumnDatum[];
  color: string;
  axisFormat: (v: number) => string;
  valueFormat: (v: number) => string;
  integer?: boolean;
  /** Values are minutes: use time-friendly ticks. */
  time?: boolean;
  height?: number;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth<HTMLDivElement>();
  const id = useId();
  const H = height;
  const pad = { l: 44, r: 8, t: 18, b: 26 };
  const top = Math.max(...data.map((d) => d.value), 0);
  const { max, ticks } = time ? timeScale(top) : niceScale(top, integer);
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.max(4, Math.min(24, band - 4));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const maxTicks = Math.max(2, Math.floor((W - pad.l) / 42));
  const showEvery = Math.ceil(data.length / maxTicks);
  const peak = data.reduce((m, d, i) => (d.value > data[m].value ? i : m), 0);

  return (
    <div ref={box} className="relative">
      <svg width={W} height={H} className="block" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11.5} fill="var(--faint)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = pad.l + band * i + band / 2;
          const top = y(d.value);
          const h = H - pad.b - top;
          return (
            <g key={d.key}>
              {d.value > 0 && <path d={roundedTopRect(cx - bw / 2, top, bw, h, 4)} fill={color} opacity={hover == null || hover === i ? 1 : 0.45} style={{ transition: 'opacity .15s' }} />}
              {(data.length - 1 - i) % showEvery === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={11.5} fill="var(--faint)">
                  {d.tick}
                </text>
              )}
              {i === peak && d.value > 0 && hover == null && (
                <text x={cx} y={top - 6} textAnchor="middle" fontSize={11.5} fontWeight={600} fill="var(--muted)">
                  {valueFormat(d.value)}
                </text>
              )}
              <rect
                x={pad.l + band * i}
                y={pad.t}
                width={band}
                height={H - pad.t - pad.b}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.label}: ${valueFormat(d.value)}`}
                aria-describedby={hover === i ? `${id}-tip` : undefined}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                style={{ outline: 'none' }}
              />
            </g>
          );
        })}
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--line-strong)" strokeWidth={1} />
      </svg>
      {hover != null && (
        <div
          id={`${id}-tip`}
          role="tooltip"
          className="pointer-events-none absolute z-10 min-w-[150px] -translate-x-1/2 -translate-y-full rounded-xl border border-line-strong bg-raised px-3 py-2 text-xs shadow-panel"
          style={{ left: Math.min(W - 80, Math.max(80, pad.l + band * hover + band / 2)), top: y(data[hover].value) - 8 }}
        >
          <div className="font-display text-[15px] font-semibold text-text">{valueFormat(data[hover].value)}</div>
          <div className="text-muted">{data[hover].label}</div>
          {data[hover].detail?.map((line) => (
            <div key={line} className="mt-0.5 flex items-center gap-1.5 text-text">
              <span className="h-0.5 w-2.5 rounded-full" style={{ background: color }} />
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface ScatterDatum {
  key: string;
  label: string;
  x: number;
  y: number;
}

/** Estimate (x) against actual (y), same scale on both axes, with the "spot on" diagonal. */
export function EstimateScatter({ data, color, axisFormat, valueFormat, ariaLabel }: { data: ScatterDatum[]; color: string; axisFormat: (v: number) => string; valueFormat: (v: number) => string; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [box, W] = useWidth<HTMLDivElement>();
  const H = Math.min(300, Math.max(220, W * 0.62));
  const pad = { l: 64, r: 16, t: 14, b: 44 };
  const { max, ticks } = useMemo(() => timeScale(Math.max(...data.flatMap((d) => [d.x, d.y]), 1)), [data]);
  const sx = (v: number) => pad.l + (W - pad.l - pad.r) * (v / max);
  const sy = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const midY = pad.t + (H - pad.t - pad.b) / 2;
  return (
    <div ref={box} className="relative">
      <svg width={W} height={H} className="block" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="var(--line)" />
            <text x={pad.l - 8} y={sy(t) + 4} textAnchor="end" fontSize={11.5} fill="var(--faint)">
              {axisFormat(t)}
            </text>
            <text x={sx(t)} y={H - pad.b + 17} textAnchor="middle" fontSize={11.5} fill="var(--faint)">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        <line x1={sx(0)} y1={sy(0)} x2={sx(max)} y2={sy(max)} stroke="var(--muted)" strokeWidth={1} opacity={0.55} />
        <text x={sx(max) - 6} y={sy(max) + 16} textAnchor="end" fontSize={11} fill="var(--muted)">
          spot on
        </text>
        <text x={pad.l + (W - pad.l - pad.r) / 2} y={H - 6} textAnchor="middle" fontSize={11.5} fill="var(--muted)">
          Estimated
        </text>
        <text x={13} y={midY} textAnchor="middle" fontSize={11.5} fill="var(--muted)" transform={`rotate(-90 13 ${midY})`}>
          Actual
        </text>
        {data.map((d, i) => (
          <g key={d.key}>
            <circle cx={sx(d.x)} cy={sy(d.y)} r={hover === i ? 6.5 : 5} fill={color} stroke="var(--surface)" strokeWidth={2} />
            <circle
              cx={sx(d.x)}
              cy={sy(d.y)}
              r={13}
              fill="transparent"
              tabIndex={0}
              aria-label={`${d.label}: estimated ${valueFormat(d.x)}, took ${valueFormat(d.y)}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              style={{ outline: 'none' }}
            />
          </g>
        ))}
      </svg>
      {hover != null && (
        <div
          role="tooltip"
          className="pointer-events-none absolute z-10 max-w-[240px] -translate-x-1/2 -translate-y-full rounded-xl border border-line-strong bg-raised px-3 py-2 text-xs shadow-panel"
          style={{ left: Math.min(W - 100, Math.max(100, sx(data[hover].x))), top: sy(data[hover].y) - 10 }}
        >
          <div className="font-display text-[15px] font-semibold">
            {valueFormat(data[hover].y)} <span className="text-xs font-normal text-muted">actual · est. {valueFormat(data[hover].x)}</span>
          </div>
          <div className="truncate text-muted">{data[hover].label}</div>
        </div>
      )}
    </div>
  );
}
