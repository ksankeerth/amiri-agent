import { useEffect, useMemo, useRef, useState } from "react";
import { niceTicks, tagGroups } from "./chartMath";

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
/** A flagged point: a dot and dashed line; `tag` is drawn next to it so it reads without hovering. */
export interface Mark { t: string; color: string; label: string; tag?: string; note?: boolean }  // note: marked but not a flagged move
/** Something that happened at a time (a headline): a small tick on the time axis, label on hover. */
export interface Pin { t: string; label: string }

/**
 * Price chart over trading time: points are spaced evenly, so weekends and
 * closed hours don't draw flat stretches. Hover shows the bar's time and price.
 */
/** The chart in a sentence, for anyone who can't see it. */
function chartSummary(points: Point[], marks: Mark[], fmtY: (v: number) => string, fmtTip: (t: string) => string): string {
  if (points.length < 2) return "Price chart: not enough prices yet.";
  const vs = points.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const first = points[0], last = points[points.length - 1], flags = marks.filter(m => !m.note).length;
  return `Price chart from ${fmtTip(first.t)} to ${fmtTip(last.t)}: started at ${fmtY(first.v)}, ended at ${fmtY(last.v)}, lowest ${fmtY(lo)}, highest ${fmtY(hi)}.${flags ? ` ${flags} unusual ${flags === 1 ? "move" : "moves"} flagged.` : ""}`;
}

export function PriceChart({ points, marks = [], pins = [], height = 260, fmtX, fmtY, fmtTip }: {
  points: Point[]; marks?: Mark[]; pins?: Pin[]; height?: number;
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
  const tagged = marks.some(m => m.tag);
  const L = 64, R = 12, T = tagged ? 34 : 10, B = 26, h = height;  // tags get their own band above the plot, clear of the lines
  const geo = useMemo(() => {
    const vs = points.map(p => p.v);
    const mn = Math.min(...vs), mx = Math.max(...vs), pad = (mx - mn) * 0.08 || Math.abs(mx) * 0.001 || 1;
    const lo = mn - pad, hi = mx + pad, n = points.length;
    const X = (i: number) => L + (n <= 1 ? 0 : (i * (w - L - R)) / (n - 1));
    const Y = (v: number) => T + ((hi - v) / (hi - lo)) * (h - T - B);
    return { lo, hi, n, X, Y };
  }, [points, w, h, T]);
  if (points.length < 2) return <div ref={box} className="empty small">Not enough prices in this range.</div>;
  const { lo, hi, n, X, Y } = geo;
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const area = `${d}L${X(n - 1).toFixed(1)},${h - B}L${X(0).toFixed(1)},${h - B}Z`;
  const { ticks, dec } = niceTicks(lo, hi);  // round values (330.5, 331.0), not the padded min/mid/max
  const fmtTick = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  // a middle tick moves to the nearest point where its label changes (a new day), so it reads "14 Oct", not 02:30 into it
  const snap = (i: number) => {
    for (let d = 0; d < n / 8; d++) for (const j of [i - d, i + d]) if (j > 0 && j < n - 1 && fmtX(points[j].t) !== fmtX(points[j - 1].t)) return j;
    return i;
  };
  const xt = Array.from(new Set([0, snap(Math.round(n * 0.25)), snap(Math.round(n * 0.5)), snap(Math.round(n * 0.75)), n - 1]))
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
  // the keyboard steps the crosshair too: the tooltip isn't for the mouse alone
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const k = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (!k) return;
    e.preventDefault();
    setHover(i => Math.min(n - 1, Math.max(0, (i ?? n - 1) + k)));
  };
  const hp = hover !== null ? points[hover] : null;
  // beside the point, not on the labels drawn along the top: below a high point, above a low one
  const tipTop = hp ? (Y(hp.v) < h / 2 ? Y(hp.v) + 12 : Y(hp.v) - 40) : 0;
  return (
    <div ref={box} style={{ position: "relative" }}>
      <svg className="chart" viewBox={`0 0 ${w} ${h}`} style={{ height: h }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        role="img" aria-label={`${chartSummary(points, marks, fmtY, fmtTip)} Left and right arrows step through the prices.`}
        tabIndex={0} onFocus={() => setHover(h0 => h0 ?? n - 1)} onBlur={() => setHover(null)} onKeyDown={onKey}>
        <defs>
          <linearGradient id="pcfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--accent)" stopOpacity={0.18} />
            <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        {ticks.map((v, i) => (
          <g className="ax" key={i}><line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} />
            <text x={L - 8} y={Y(v) + 5} textAnchor="end">{fmtTick(v)}</text></g>
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
              {/* a flagged move is a diamond (◆); a note that isn't a flagged move is a square (■) */}
              {m.note
                ? <rect x={X(i) - 5} y={Y(points[i].v) - 5} width={10} height={10} rx={1} fill={m.color} stroke="var(--surface)" strokeWidth={1.5}><title>{m.label}</title></rect>
                : <path d={`M${X(i)},${Y(points[i].v) - 8}l8,8l-8,8l-8,-8z`} fill={m.color} stroke="var(--surface)" strokeWidth={1.5} strokeLinejoin="round"><title>{m.label}</title></path>}</g>
          );
        })}
        {tagGroups(marks.map(m => ({ m, x: X(idxOf(m.t)), ok: idxOf(m.t) >= 0 }))).map(({ m, x0, x, n }, k) => {
          const text = n > 1 ? `${m.tag} ×${n}` : m.tag!;
          const half = text.length * 4.3 + 4;  // about half the label's width at the tag's 14 px bold
          const cx = Math.min(Math.max((x0 + x) / 2, L + half), w - R - half);
          return (
            <g key={`t${k}`} className="mk-tag-g">
              {n > 1 && <path d={`M${x0},${T - 2}v-4H${x}v4`} fill="none" stroke={m.color} strokeWidth={1.25} />}
              <text className="mk-tag" x={cx} y={T - 12} textAnchor="middle" fill={m.color}>{text}</text>
            </g>
          );
        })}
        {pins.map((p, k) => {
          const ms = new Date(p.t).getTime(), i = points.findIndex(q => new Date(q.t).getTime() >= ms);  // the close it fed into
          if (i < 0) return null;
          return <path key={`p${k}`} className="pin" d={`M${X(i).toFixed(1)},${h - B - 1}l-4.5,7h9z`}><title>{p.label}</title></path>;
        })}
        {hp && hover !== null && (
          <g><line x1={X(hover)} x2={X(hover)} y1={T} y2={h - B} stroke="var(--ink-3)" strokeWidth={1} />
            <circle cx={X(hover)} cy={Y(hp.v)} r={3.5} fill="var(--accent)" /></g>
        )}
      </svg>
      {hp && hover !== null && (
        <div className="maptip" style={{ position: "absolute", top: tipTop, left: Math.min(Math.max(X(hover) / w * 100, 8), 80) + "%", transform: "translateX(-50%)", pointerEvents: "none" }}>
          <b className="num">{fmtY(hp.v)}</b> <span className="muted">· {fmtTip(hp.t)}</span>
        </div>
      )}
      <span className="sr" aria-live="polite">{hp ? `${fmtY(hp.v)}, ${fmtTip(hp.t)}` : ""}</span>
    </div>
  );
}
