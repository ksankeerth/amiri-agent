// The Metrics Spec's plain words: what a metric's fields say, in a sentence. Page-only helpers, pure so they can be tested.
import type { Spec, SpecCategory, SpecMetric } from "../../api/spec";

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

// ---- the page's rail and the category's list
export interface Chapter { id: string; n: string; title: string }
/** The guide's chapters in the spec's own numbering: the introduction, 1 to 13 (5 is the categories, which the rail shows), the change log. */
export function chaptersOf(s: Pick<Spec, "guide" | "drawn">): Chapter[] {
  const title = (n: string) => s.guide[n]?.title ?? s.drawn[n]?.title ?? `Chapter ${n}`;
  const out: Chapter[] = [{ id: "intro", n: "", title: "Introduction" }];
  for (let i = 1; i <= 13; i++) if (i !== 5) out.push({ id: `s${i}`, n: String(i), title: title(String(i)) });
  out.push({ id: "changes", n: "", title: "Change log" });
  return out;
}
/** The chapters the rail shows at first (board 12: four); the others sit under "All N chapters". */
export const FEATURED = ["intro", "s3", "s9", "changes"];
export function splitChapters(chs: Chapter[], current?: string): { shown: Chapter[]; rest: Chapter[]; openRest: boolean } {
  const shown = chs.filter(c => FEATURED.includes(c.id)), rest = chs.filter(c => !FEATURED.includes(c.id));
  return { shown, rest, openRest: !!current && rest.some(c => c.id === current) };
}
export const chapterHead = (c: Chapter) => (c.n ? `${c.n}. ${c.title}` : c.title);

/** How many of the institution's products sit in each category (profile products carry their category's id). */
export function productCounts(products: { category: string }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of products) out.set(p.category, (out.get(p.category) ?? 0) + 1);
  return out;
}
export const productsWord = (n: number) => `${n} product${n === 1 ? "" : "s"}`;
/** The categories that hold one of the institution's products, in the spec's order. */
export const yourCategories = (cats: SpecCategory[], counts: Map<string, number>) => cats.filter(c => (counts.get(c.id) ?? 0) > 0);

/** The category the page opens on when the URL names none: the first of the institution's own, else the first of its kind, else the first. */
export function defaultCategory(cats: SpecCategory[], counts: Map<string, number>, kind?: "bank" | "insurer" | null): SpecCategory | undefined {
  return yourCategories(cats, counts)[0] ?? cats.find(c => c.institution === kind) ?? cats[0];
}

export type Tab = "all" | "starter" | "required";
export function tabCounts(ms: SpecMetric[]): Record<Tab, number> {
  return { all: ms.length, starter: ms.filter(m => m.starter).length, required: ms.filter(m => m.tier === "required").length };
}
export function inTab(ms: SpecMetric[], tab: Tab): SpecMetric[] {
  return tab === "starter" ? ms.filter(m => m.starter) : tab === "required" ? ms.filter(m => m.tier === "required") : ms;
}
export const SHOWN_AT_FIRST = 6;
/** How many rows show: the first six, until "N more" is opened or a linked metric sits further down. */
export function shownRows(total: number, expanded: boolean, linkedIndex = -1): number {
  return expanded || linkedIndex >= SHOWN_AT_FIRST || total <= SHOWN_AT_FIRST + 1 ? total : SHOWN_AT_FIRST;
}
export const tierWord = (t: SpecMetric["tier"]) => ucFirst(t);

/** What the Tier column says of a metric that was replaced: "Replaced by Claims notified · 1.1". Null for a live metric. */
export function deprecationWord(m: Pick<SpecMetric, "deprecated_in" | "replaced_by">, nameOf: (key: string) => string): string | null {
  if (!m.deprecated_in) return null;
  return m.replaced_by ? `Replaced by ${nameOf(m.replaced_by)} · ${m.deprecated_in}` : `Deprecated · ${m.deprecated_in}`;
}
/** A metric's name from its key, across every category (the replaced metric may sit in another). */
export function nameLookup(cats: SpecCategory[]): (key: string) => string {
  const names = new Map(cats.flatMap(c => c.metrics ?? []).map(m => [m.key, m.name] as const));
  return key => names.get(key) ?? ucFirst(words(key));
}

/** Search: metrics whose key, name, question or category contains every word's text (one phrase, lower case). */
export function searchMetrics(cats: SpecCategory[], q: string): { c: SpecCategory; m: SpecMetric }[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return [];
  return cats.flatMap(c => (c.metrics ?? []).filter(m => [m.key, m.name, m.question, c.name].some(x => x.toLowerCase().includes(needle))).map(m => ({ c, m })));
}

// ---- the banner: does the institution serve these figures, and are the checks on?
export interface ConnectionFacts {
  configured: boolean; validationOn: boolean; approved: boolean; name: string | null;
  source: "bank" | "insurer" | "file" | null; coverage: { some: number; total: number } | null;
}
export interface ConnectionLine { tone: "good" | "neutral"; pill: string; text: string }
export function connectionLine(f: ConnectionFacts): ConnectionLine {
  const who = f.name ?? "The institution";
  if (!f.configured) return { tone: "neutral", pill: "Not connected", text: `${who} hasn't shared its own figures yet, so Amiri Agent has nothing of its own to check its expectations against.` };
  const from = f.source === "bank" ? "sample bank" : f.source === "insurer" ? "sample insurer" : f.source === "file" ? "a file" : null;
  const cover = f.coverage ? `${f.coverage.some} of ${f.coverage.total} product${f.coverage.total === 1 ? "" : "s"}` : null;
  const bits = [from, cover].filter(Boolean).join(", ");
  const serves = `${who} serves these figures${bits ? ` (${bits})` : ""}`;
  if (f.validationOn) return { tone: "good", pill: "Connected · checks on", text: `${serves}, so Amiri Agent checks its expectations against them.` };
  return { tone: "neutral", pill: "Connected · checks off", text: `${serves}, but checks against them are off${f.approved ? "" : ": approve a ready connection first"}.` };
}
