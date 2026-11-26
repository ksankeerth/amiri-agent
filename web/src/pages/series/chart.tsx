// The price chart (board 07), drawn in the v2 tokens, light and dark. The math is the old chart's (components/chartMath.ts):
// points are spaced evenly, so weekends and closed hours don't draw flat stretches; round axis ticks; flagged moves are
// diamonds with a label above; a one-hour spike that isn't a move is a square. No animation. The picture is one image
// with a name that says where the price started, ended, its range and how many moves were flagged, and the left and right
// arrows step a crosshair through the prices (the tooltip isn't for the mouse alone).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { niceTicks, tagGroups } from "../../components/chartMath";

export interface Point { t: string; v: number }
/** A marked time: a diamond and a dashed line; `tag` is drawn above it so it reads without hovering. `note`: marked, but not a flagged move. */
export interface Mark { t: string; label: string; tag?: string; note?: boolean }

/** The chart in a sentence, for anyone who can't see it. */
export function chartSummary(points: Point[], marks: Mark[], fmtY: (v: number) => string, fmtTip: (t: string) => string): string {
  if (points.length < 2) return "Price chart: not enough prices yet.";
  const vs = points.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs);
  const first = points[0], last = points[points.length - 1], flags = marks.filter(m => !m.note).length;
  return `Price chart from ${fmtTip(first.t)} to ${fmtTip(last.t)}: started at ${fmtY(first.v)}, ended at ${fmtY(last.v)}, lowest ${fmtY(lo)}, highest ${fmtY(hi)}.${flags ? ` ${flags} unusual ${flags === 1 ? "move" : "moves"} flagged.` : ""}`;
}

export function PriceChart({ points, marks = [], height = 160, fmtX, fmtY, fmtTip }: {
  points: Point[]; marks?: Mark[]; height?: number;
  fmtX: (t: string) => string; fmtY: (v: number) => string; fmtTip: (t: string) => string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(380);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(e => setW(Math.max(240, e[0].contentRect.width)));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  const tagged = marks.some(m => m.tag);
  const L = 52, R = 10, T = tagged ? 34 : 10, B = 26, h = height;   // tags get their own band above the plot, clear of the lines
  const geo = useMemo(() => {
    const vs = points.map(p => p.v);
    const mn = Math.min(...vs), mx = Math.max(...vs), pad = (mx - mn) * 0.08 || Math.abs(mx) * 0.001 || 1;
    const lo = mn - pad, hi = mx + pad, n = points.length;
    const X = (i: number) => L + (n <= 1 ? 0 : (i * (w - L - R)) / (n - 1));
    const Y = (v: number) => T + ((hi - v) / (hi - lo)) * (h - T - B);
    return { lo, hi, n, X, Y };
  }, [points, w, h, T]);
  if (points.length < 2) return <div ref={box} className="v2-sr-chart__none">Not enough prices in this range.</div>;
  const { lo, hi, n, X, Y } = geo;
  const d = points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p.v).toFixed(1)}`).join("");
  const { ticks, dec } = niceTicks(lo, hi);   // round values (330.5, 331.0), not the padded min/mid/max
  const fmtTick = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  // a middle tick moves to the nearest point where its label changes (a new day), so it reads "14 Oct", not 02:30 into it
  const snap = (i: number) => {
    for (let k = 0; k < n / 8; k++) for (const j of [i - k, i + k]) if (j > 0 && j < n - 1 && fmtX(points[j].t) !== fmtX(points[j - 1].t)) return j;
    return i;
  };
  // the date labels: one per distinct date, and none that would run into the one before it. The last point's label wins a
  // clash over a middle one (it's the end of the range), and the first point's label always stays.
  const xt: { i: number; s: string }[] = [];
  for (const i of Array.from(new Set([0, snap(Math.round(n * 0.25)), snap(Math.round(n * 0.5)), snap(Math.round(n * 0.75)), n - 1]))) {
    if (i < 0 || i >= n) continue;
    const s = fmtX(points[i].t), prev = xt[xt.length - 1];
    if (prev && prev.s === s) continue;
    if (prev && X(i) - X(prev.i) < (prev.s.length + s.length) * 3.6 + 12) {
      if (i === n - 1 && prev.i !== 0) xt.pop(); else continue;
    }
    xt.push({ i, s });
  }
  const idxOf = (t: string) => {
    const ms = new Date(t).getTime();
    let best = -1;
    for (let i = 0; i < n; i++) if (new Date(points[i].t).getTime() <= ms) best = i;
    return best;
  };
  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * w;
    const i = Math.round(((x - L) / (w - L - R)) * (n - 1));
    setHover(i >= 0 && i < n ? i : null);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    const k = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n }[e.key];
    if (!k) return;
    e.preventDefault();
    setHover(i => Math.min(n - 1, Math.max(0, (i ?? n - 1) + k)));
  };
  const hp = hover !== null ? points[hover] : null;
  const tipTop = hp ? (Y(hp.v) < h / 2 ? Y(hp.v) + 12 : Y(hp.v) - 40) : 0;
  return (
    <div ref={box} className="v2-sr-chart">
      <svg viewBox={`0 0 ${w} ${h}`} style={{ height: h }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}
        role="img" aria-label={`${chartSummary(points, marks, fmtY, fmtTip)} Left and right arrows step through the prices.`}
        tabIndex={0} onFocus={() => setHover(x => x ?? n - 1)} onBlur={() => setHover(null)} onKeyDown={onKey}>
        {ticks.map((v, i) => (
          <g key={i}><line className="v2-sr-chart__grid" x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} />
            <text className="v2-sr-chart__ax" x={L - 8} y={Y(v) + 4} textAnchor="end">{fmtTick(v)}</text></g>
        ))}
        {xt.map(({ i, s }) => (
          <text key={i} className="v2-sr-chart__ax" x={X(i)} y={h - 8} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{s}</text>
        ))}
        <path className="v2-sr-chart__line" d={d} fill="none" />
        {marks.map((m, k) => {
          const i = idxOf(m.t);
          if (i < 0) return null;
          return (
            <g key={k}><line className="v2-sr-chart__flagline" x1={X(i)} x2={X(i)} y1={T} y2={h - B} />
              {/* a flagged move is a diamond (◆); a note that isn't a flagged move is a square (■) */}
              {m.note
                ? <rect className="v2-sr-chart__note" x={X(i) - 5} y={Y(points[i].v) - 5} width={10} height={10} rx={1}><title>{m.label}</title></rect>
                : <path className="v2-sr-chart__flag" d={`M${X(i)},${Y(points[i].v) - 8}l8,8l-8,8l-8,-8z`} strokeLinejoin="round"><title>{m.label}</title></path>}</g>
          );
        })}
        {tagGroups(marks.map(m => ({ m, x: X(idxOf(m.t)), ok: idxOf(m.t) >= 0 }))).map(({ m, x0, x, n: cnt }, k) => {
          const text = cnt > 1 ? `${m.tag} ×${cnt}` : m.tag!;
          const half = text.length * 4.3 + 4;
          const cx = Math.min(Math.max((x0 + x) / 2, L + half), w - R - half);
          return (
            <g key={`t${k}`}>
              {cnt > 1 && <path className="v2-sr-chart__span" d={`M${x0},${T - 2}v-4H${x}v4`} fill="none" />}
              <text className="v2-sr-chart__tag" x={cx} y={T - 12} textAnchor="middle">{text}</text>
            </g>
          );
        })}
        {hp && hover !== null && (
          <g><line className="v2-sr-chart__cross" x1={X(hover)} x2={X(hover)} y1={T} y2={h - B} />
            <circle className="v2-sr-chart__dot" cx={X(hover)} cy={Y(hp.v)} r={3.5} /></g>
        )}
      </svg>
      {hp && hover !== null && (
        <div className="v2-sr-chart__tip" style={{ top: tipTop, left: Math.min(Math.max((X(hover) / w) * 100, 14), 80) + "%" }} aria-hidden="true">
          <b className="v2-num">{fmtY(hp.v)}</b> <span>{fmtTip(hp.t)}</span>
        </div>
      )}
      <span className="v2-sr" aria-live="polite">{hp ? `${fmtY(hp.v)}, ${fmtTip(hp.t)}` : ""}</span>
    </div>
  );
}
