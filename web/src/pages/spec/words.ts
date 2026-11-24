// The Metrics Spec's plain words: what a metric's fields say, in a sentence. Page-only helpers, pure so they can be tested.
import type { SpecCategory, SpecMetric } from "../../api/spec";

export const words = (s: string) => s.replace(/_/g, " ");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-10-11" -> "11 Oct 2026" (a calendar date, not a moment: no zone). */
export function specDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : ymd;
}

export const sizeText = (n: number | null) => (n == null ? "" : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

const UNIT: Record<string, string> = { currency: "currency", count: "count", percent: "percent", per_1000: "per 1,000", index: "index", percent_pa: "percent a year", pp: "percentage points" };
export const unitWord = (u: string) => UNIT[u] ?? words(u);
/** "per 1,000, weekly" */
export const unitAndGrain = (m: Pick<SpecMetric, "unit" | "grain">) => `${unitWord(m.unit)}, ${m.grain}`;

const KIND: Record<string, string> = { flow: "a total over the period", stock: "a balance at the period's end", count: "a count", ratio: "a ratio", rate: "a rate", level: "a level" };
const CURRENCY: Record<string, string> = { base: "in the base currency", product: "in the product's currency", original: "in the original currency" };
const DAYS: Record<string, string> = { business: "business days", calendar: "calendar days" };

/** What the figure is and how often: "a count, daily". */
export function kindLine(m: SpecMetric): string {
  const when = m.day_basis && m.grain === "daily" ? `${m.grain} (${DAYS[m.day_basis] ?? m.day_basis})` : m.grain;
  return `${KIND[m.kind] ?? m.kind}, ${when}`;
}
export const currencyLine = (m: SpecMetric): string | null => CURRENCY[m.currency_rule] ?? null;
export const lagLine = (m: SpecMetric) => `published within ${m.max_lag_days} day${m.max_lag_days === 1 ? "" : "s"}${m.max_lag_rule ? ` (${m.max_lag_rule})` : ""}`;
export const historyLine = (m: SpecMetric) => `${m.history_months} months of history`;
/** "bad when it rises or falls" */
export function adverseLine(adverse: string[] | null): string {
  const a = adverse ?? [];
  if (!a.length) return "not judged as good or bad";
  const say = (d: string) => (d === "rise" ? "rises" : d === "fall" ? "falls" : d);
  const order = ["rise", "fall"];
  return `bad when it ${[...a].sort((x, y) => order.indexOf(x) - order.indexOf(y)).map(say).join(" or ")}`;
}

export const ucFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const metricCount = (c: SpecCategory) => c.metrics?.length ?? 0;
export const requiredCount = (c: SpecCategory) => (c.metrics ?? []).filter(m => m.tier === "required").length;
/** "10 metrics · 3 required" (the home and the category's first line) */
export function countLine(c: SpecCategory): string {
  const n = metricCount(c), r = requiredCount(c);
  return `${n} metric${n === 1 ? "" : "s"} · ${r ? `${r} required` : "none required"}`;
}

// ---- how a metric is judged
const METHOD: Record<string, string> = {
  recent_vs_prior: "The recent days against the 8 periods of the same length before them",
  seasonal_ratio: "The same season in past years",
  level_change: "Where the level is now against where it started, at the same point in the month or cycle",
  trend: "The recent months against the 12-month trend",
  context: "Shown beside other checks; never judged on its own",
  book_size: "Used to rank products; never judged",
  mask: "Never judged; a rise beyond its limit holds back the credit-quality checks",
};
export const methodLine = (method: string) => `${METHOD[method] ?? words(method)} (${words(method)})`;

const BAR: Record<string, (x: number) => string> = {
  pct_change: x => `a change of ${x}% or more`,
  pp_change: x => `a change of ${x} percentage points or more`,
  forecast_gap_pp: x => `a gap of ${x} percentage points or more from the trend`,
  pct_of_gross_inflow: x => `a change of ${x}% or more of the gross inflow`,
  percentile: x => `among the most extreme ${x}% of past values`,
  robust_z: x => `at least ${x} usual spreads away from normal`,
};
const BAR_ORDER = ["pct_change", "pp_change", "forecast_gap_pp", "pct_of_gross_inflow", "robust_z", "percentile"];
const barOf = (t: Record<string, number>) => BAR_ORDER.filter(k => k in t).map(k => BAR[k](t[k])).join(", ");
const specOf = (t: Record<string, number>) => Object.entries(t).map(([k, x]) => `${words(k)} ${x}`).join(", ");

/** What an effect needs: one sentence when every book size has the same bar (they all do today), else per size. */
export function barLines(thresholds: Record<string, Record<string, number>> | null): { text: string; spec: string }[] {
  if (!thresholds) return [];
  const sizes = Object.entries(thresholds);
  if (!sizes.length) return [];
  const same = sizes.every(([, t]) => specOf(t) === specOf(sizes[0][1]));
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  if (same) return [{ text: cap(barOf(sizes[0][1])), spec: specOf(sizes[0][1]) }];
  return sizes.map(([size, t]) => ({ text: `${cap(size)} books: ${barOf(t)}`, spec: specOf(t) }));
}

/** "Settles after": when the figure stops being revised and how much behind it a verdict needs. */
export function settlesLine(v: NonNullable<SpecMetric["validation"]>, volume: string | null): string | null {
  const bits: string[] = [];
  if (v.stable_age_days != null) bits.push(`${v.stable_age_days} days after the period ends`);
  if (v.min_volume != null) bits.push(`at least ${v.min_volume}${volume ? ` (${volume})` : " records"} behind a verdict`);
  return bits.length ? bits.join("; ") : null;
}
/** The other conditions a verdict has, as short phrases. */
export function alsoLines(v: NonNullable<SpecMetric["validation"]>): string[] {
  const out: string[] = [];
  if (v.judge_grain) out.push(`judged ${v.judge_grain}`);
  if (v.min_denominator != null) out.push(`a denominator of at least ${v.min_denominator}`);
  if (v.min_base != null) out.push(`a year-ago base of at least ${v.min_base}`);
  if (v.counts) out.push("the change must also pass a 95% confidence interval on the counts");
  if (v.concentration_sensitive) out.push("needs the change-concentration data (level 5)");
  return out;
}

// ---- where a metric lives
/** Metric ids: the first category to define a key owns #metric-<key>; later ones add the category. */
export function metricAnchors(cats: SpecCategory[]): Map<string, string> {
  const seen = new Set<string>(), out = new Map<string, string>();
  for (const c of cats) for (const m of c.metrics ?? []) {
    out.set(`${c.id}/${m.key}`, seen.has(m.key) ? `metric-${m.key}-${c.id}` : `metric-${m.key}`);
    seen.add(m.key);
  }
  return out;
}

export type View =
  | { kind: "home" }
  | { kind: "category"; id: string; open?: string }
  | { kind: "chapter"; id: string; target?: string };

/** The view a URL hash asks for; the old anchors (#metric-, #dim-, #check-, #s<n>, #cat-) all still work. */
export function viewOf(hash: string, cats: SpecCategory[]): View {
  const h = decodeURIComponent(hash.replace(/^#/, ""));
  if (!h || h === "categories" || h === "guide" || h === "s5") return { kind: "home" };
  if (h.startsWith("cat-")) return cats.some(c => c.id === h.slice(4)) ? { kind: "category", id: h.slice(4) } : { kind: "home" };
  if (h.startsWith("metric-")) {
    for (const [k, id] of metricAnchors(cats)) if (id === h) return { kind: "category", id: k.split("/")[0], open: h };
    return { kind: "home" };
  }
  if (h.startsWith("dim-")) return { kind: "chapter", id: "s7", target: h };
  if (h.startsWith("check-")) return { kind: "chapter", id: "s9", target: h };
  if (h === "intro" || h === "changes" || /^s\d+$/.test(h)) return { kind: "chapter", id: h };
  return { kind: "home" };
}

// ---- the guide's text, split around the tables the page draws from the data
/** The text of a drawn chapter without its tables: the runs of lines between them. */
export function proseRuns(md: string): string[] {
  const runs: string[] = [];
  let cur: string[] = [];
  const flush = () => { const t = cur.join("\n").trim(); if (t) runs.push(t); cur = []; };
  for (const line of md.split("\n")) { if (line.trim().startsWith("|")) flush(); else cur.push(line); }
  flush();
  return runs;
}
