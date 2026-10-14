import { useEffect, useMemo, useRef, useState } from "react";

export function Spark({ values, color = "var(--accent)", w = 140, h = 40 }: { values: number[]; color?: string; w?: number; h?: number }) {
  if (values.length < 2) return <svg className="spark" style={{ width: w, height: h }} />;
  const mn = Math.min(...values), mx = Math.max(...values);
  const sx = (w - 4) / (values.length - 1);
  const sy = (v: number) => h - 3 - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * (h - 6);
  const d = values.map((v, i) => `${i ? "L" : "M"}${(2 + i * sx).toFixed(1)},${sy(v).toFixed(1)}`).join("");
  const last = values[values.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} style={{ width: w, height: h }} aria-hidden="true">
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} />
      <circle cx={2 + (values.length - 1) * sx} cy={sy(last)} r={2.5} fill={color} />
    </svg>
  );
}

export interface Point { t: string; v: number }
export interface Mark { t: string; color: string; label: string }

/**
 * Price chart over trading time: points are spaced evenly, so weekends and
 * closed hours don't draw flat stretches. Hover shows the bar's time and price.
 */
/** The chart in a sentence, for anyone who can't see it. */
function chartSummary(points: Point[], marks: Mark[], fmtY: (v: number) => string, fmtTip: (t: string) => string): string {
  if (points.length < 2) return "Price chart: not enough prices yet.";
  const vs = points.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const first = points[0], last = points[points.length - 1];
  return `Price chart from ${fmtTip(first.t)} to ${fmtTip(last.t)}: started at ${fmtY(first.v)}, ended at ${fmtY(last.v)}, lowest ${fmtY(lo)}, highest ${fmtY(hi)}.${marks.length ? ` ${marks.length} unusual ${marks.length === 1 ? "move" : "moves"} flagged.` : ""}`;
}

export function PriceChart({ points, marks = [], height = 260, fmtX, fmtY, fmtTip }: {
  points: Point[]; marks?: Mark[]; height?: number;
  fmtX: (t: string) => string; fmtY: (v: number) => string; fmtTip: (t: string) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(e => setW(Math.max(280, e[0].contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const L = 64, R = 12, T = 10, B = 26, h = height;
  const geo = useMemo(() => {
    const vs = points.map(p => p.v);
    const mn = Math.min(...vs), mx = Math.max(...vs), pad = (mx - mn) * 0.08 || Math.abs(mx) * 0.001 || 1;
    const lo = mn - pad, hi = mx + pad, n = points.length;
    const X = (i: number) => L + (n <= 1 ? 0 : (i * (w - L - R)) / (n - 1));
    const Y = (v: number) => T + ((hi - v) / (hi - lo)) * (h - T - B);
    return { lo, hi, n, X, Y };
  }, [points, w, h]);
  if (points.length < 2) return <div ref={box} className="empty small">Not enough prices in this range.</div>;
  const { lo, hi, n, X, Y } = geo;
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const area = `${d}L${X(n - 1).toFixed(1)},${h - B}L${X(0).toFixed(1)},${h - B}Z`;
  const ticks = [0, 0.5, 1].map(f => lo + (hi - lo) * f);
  const xt = Array.from(new Set([0, Math.round(n * 0.25), Math.round(n * 0.5), Math.round(n * 0.75), n - 1]))
    .filter(i => i >= 0 && i < n);
  const idxOf = (t: string) => {
    const ms = new Date(t).getTime();
    let best = -1;
    for (let i = 0; i < n; i++) if (new Date(points[i].t).getTime() <= ms) best = i;
    return best;
  };
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.round(((x - L) / (w - L - R)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  const hp = hover !== null ? points[hover] : null;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} style={{ height: h }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label={chartSummary(points, marks, fmtY, fmtTip)}>
        <defs>
          <linearGradient id="pcfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity={0.18} />
            <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => (
          <g className="ax" key={i}><line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} />
            <text x={L - 8} y={Y(v) + 3.5} textAnchor="end">{fmtY(v)}</text></g>
        ))}
        {xt.map(i => (
          <g className="ax" key={i}><text x={X(i)} y={h - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{fmtX(points[i].t)}</text></g>
        ))}
        <path d={area} fill="url(#pcfill)" />
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.75} />
        {marks.map((m, k) => {
          const i = idxOf(m.t);
          if (i < 0) return null;
          return (
            <g key={k}><line x1={X(i)} x2={X(i)} y1={T} y2={h - B} stroke={m.color} strokeDasharray="3 3" />
              <circle cx={X(i)} cy={Y(points[i].v)} r={4.5} fill={m.color} stroke="var(--surface)" strokeWidth={1.5}><title>{m.label}</title></circle></g>
          );
        })}
        {hp && hover !== null && (
          <g><line x1={X(hover)} x2={X(hover)} y1={T} y2={h - B} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={X(hover)} cy={Y(hp.v)} r={3.5} fill="var(--accent)" /></g>
        )}
      </svg>
      {hp && hover !== null && (
        <div className="maptip" style={{ position: "absolute", top: 4, left: Math.min(Math.max(X(hover) / w * 100, 8), 80) + "%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <b className="num">{fmtY(hp.v)}</b> <span className="muted">· {fmtTip(hp.t)}</span>
        </div>
      )}
    </div>
  );
}
