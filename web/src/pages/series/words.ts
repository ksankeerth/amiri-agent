// Market series: the plain words and numbers the page shares (kept free of React so node can test them).
import { pct } from "../../format.ts";

interface WindowLike { days: number; z: number | null; change_pct?: number }

/** The latest one-day move's z. The list and the series page show this one, never `max_z`: that is the largest over
 *  the 1-, 3- and 5-day windows, so it can come from a longer window than the "day" the page says. */
export function oneDayZ(latest: { windows: WindowLike[] } | null | undefined): number | null {
  return latest?.windows.find(w => w.days === 1)?.z ?? null;
}

/** Where a track puts a value: 0 at the left, `threshold` at the dashed line, a little room beyond it. */
export function trackSpan(threshold: number): number { return threshold * 1.4; }
export function trackPos(z: number, threshold: number): number {
  return Math.min(Math.abs(z), trackSpan(threshold)) / trackSpan(threshold);
}

/** The short form of what a move means ("A rise means a weaker rupee"): the part about a rise, for a row. */
export function shortMeaning(text: string): string {
  return text.replace(/,\s*a fall .*$/i, "").replace(/^[A-Za-z ]+ price \(([^)]+)\): /, "$1: ").replace(/^./, c => c.toUpperCase());
}

const NOT_CONFIGURED = "Twelve Data isn't configured. Set TWELVEDATA_API_KEY in the server's environment; until then nothing can be added, refreshed or pulled.";

/** The list's one "not updated" line, said once; null when every price is current. A Platform Admin also gets the
 *  server's reason when the provider isn't set up. */
export function listNotice(o: { total: number; stale: number; oldestDay: string | null; configured: boolean; admin: boolean }): string | null {
  const { total, stale, oldestDay, configured, admin } = o;
  const base = stale === 0 ? null
    : stale === total ? `No new prices since ${oldestDay}.`
    : `${stale} of ${total} prices have no new price; the oldest since ${oldestDay}.`;
  if (admin) return [base, configured ? null : NOT_CONFIGURED].filter(Boolean).join(" ") || null;
  if (base) return `${base} Your Platform Admin has been told.`;
  return configured ? null : "Prices can't be updated right now. Your Platform Admin has been told.";
}

/** The series page's one problem line (stale, failed fetch, provider not set up), said once. */
export function seriesNotice(o: {
  stale: boolean; since: string | null; configured: boolean; admin: boolean;
  failed: { at: string; code: string; http: number | null; message: string } | null;
}): string | null {
  const { stale, since, configured, admin, failed } = o;
  const base = stale ? `No new price since ${since}.` : null;
  if (admin) {
    const err = failed ? `The last fetch failed (${failed.at}). Twelve Data returned: ${failed.code}${failed.http ? ` ${failed.http}` : ""}: ${failed.message}.` : null;
    return [base, configured ? null : NOT_CONFIGURED, err].filter(Boolean).join(" ") || null;
  }
  if (base) return `${base} Your Platform Admin has been told.`;
  if (failed) return "The last price update failed. The prices below are the last ones received; your Platform Admin has been told.";
  return configured ? null : "Prices can't be updated right now. Your Platform Admin has been told.";
}

/** A flagged move in a line: "Down 13.10% in 3 trading days (3.3× typical)", or the finding's own title. */
export function moveLine(f: { title: string; evidence?: { signals?: { change_pct: number; window_days: number; z: number; direction?: string }[] } | null }): string {
  const s = f.evidence?.signals?.[0];
  if (!s) return f.title;
  const z = (Math.floor(Math.abs(s.z) * 10) / 10).toFixed(1);
  const up = s.direction ? s.direction === "up" : s.change_pct > 0;
  return `${up ? "Up" : "Down"} ${Math.abs(s.change_pct).toFixed(2)}% in ${s.window_days} trading day${s.window_days === 1 ? "" : "s"} (${z}× typical)`;
}


// ---------------------------------------------------------------- the list (board 07)
export type SeriesStateName = "pending" | "warming_up" | "normal" | "moved" | "stale" | "paused";
export interface RowIn {
  series_id: string; name: string; symbol: string; state: string; state_reason: string;
  instrument: { type?: string };
  latest: { windows: WindowLike[] } | null;
  fetch: { last_status: string | null };
}

export type TabId = "all" | "moved" | "stale" | "warming" | "normal" | "paused";
export const TABS: { id: TabId; label: string }[] = [
  { id: "all", label: "All" }, { id: "moved", label: "Unusual" }, { id: "stale", label: "Waiting for prices" },
  { id: "warming", label: "Warming up" }, { id: "normal", label: "Normal" }, { id: "paused", label: "Paused" },
];
/** The tab a state sits under. A series still waiting for its first prices counts as warming up. */
export function tabOf(state: string): Exclude<TabId, "all"> {
  return state === "moved" ? "moved" : state === "stale" ? "stale" : state === "paused" ? "paused"
    : state === "warming_up" || state === "pending" ? "warming" : "normal";
}
export function tabCounts(items: { state: string }[]): Record<TabId, number> {
  const c: Record<TabId, number> = { all: items.length, moved: 0, stale: 0, warming: 0, normal: 0, paused: 0 };
  for (const s of items) c[tabOf(s.state)]++;
  return c;
}

const RANK: Record<string, number> = { moved: 0, stale: 1, warming_up: 2, pending: 2, normal: 3, paused: 4 };
/** "Unusual first": unusual (biggest move first), waiting for prices, warming up, normal (biggest move first), paused; then by name. */
export function sortSeries<T extends RowIn>(items: T[]): T[] {
  const z = (s: T) => Math.abs(oneDayZ(s.latest) ?? 0);
  return [...items].sort((a, b) => (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) || z(b) - z(a) || a.name.localeCompare(b.name));
}

/** What kind of price it is, as a word for the Type filter: "Funds", "FX", "Stocks", "Crypto", "Indices", "Other". */
export function seriesType(s: { instrument: { type?: string }; symbol: string }): string {
  const t = (s.instrument.type ?? "").toLowerCase();
  if (/digital|crypto/.test(t)) return "Crypto";
  if (/etf|fund/.test(t)) return "Funds";
  if (/currency|forex/.test(t) || (!t && /^[A-Z]{3}\/[A-Z]{3}$/.test(s.symbol.toUpperCase()))) return "FX";
  if (/index/.test(t)) return "Indices";
  if (/stock|equity/.test(t)) return "Stocks";
  return "Other";
}
export function typeOptions(items: { instrument: { type?: string }; symbol: string }[]): string[] {
  return [...new Set(items.map(seriesType))].sort((a, b) => (a === "Other" ? 1 : b === "Other" ? -1 : a.localeCompare(b)));
}
/** The Find box: the name or the symbol, in any case, ignoring spaces at the ends. */
export function matchesQuery(s: { name: string; symbol: string }, q: string): boolean {
  const n = q.trim().toLowerCase();
  return !n || s.name.toLowerCase().includes(n) || s.symbol.toLowerCase().includes(n);
}

/** The bar's scale: the flag line sits three quarters of the way along, and a move past a third beyond it fills the bar. */
export const BAR_LINE = 0.75;
export function barFill(z: number | null | undefined, threshold: number): number {
  if (z === null || z === undefined || !(threshold > 0)) return 0;
  return Math.min(Math.abs(z) / (threshold / BAR_LINE), 1);
}
export const isFlagged = (z: number | null | undefined, threshold: number) => z !== null && z !== undefined && Math.abs(z) >= threshold;

export type RowTone = "unusual" | "neutral" | "bad";
export interface RowState { label: string; tone: RowTone | null; mark?: string; /** the fact behind the label ("No new price since 20 Nov 15:30"), for the row's second line */ detail?: string }
/** The state column of a row. `since` is the late-since time ("09:00") when the server's note has one. A normal row is
 *  plain text (tone null) unless its last update failed. */
export function rowState(s: RowIn, since: string | null): RowState {
  switch (s.state) {
    case "moved": return { label: "Unusual", tone: "unusual", mark: "◆" };
    case "stale": return { label: "Waiting for prices", tone: "neutral", detail: since ? `No new price since ${since}` : "No new price lately" };
    case "warming_up": return { label: "Warming up", tone: "neutral" };
    case "pending": return { label: "Pending", tone: "neutral" };
    case "paused": return { label: "Paused", tone: "neutral" };
    default: return s.fetch.last_status === "error" ? { label: "Update failed", tone: "bad", mark: "▲" } : { label: "Normal", tone: null };
  }
}

/** The line under the page's heading: "3 unusual · 1 waiting for prices · 22 of 30 series · checked every hour, last 11:00 · a move over 3× …". */
export function ledeParts(o: { unusual: number; late: number; total: number; max: number | null; everyMinutes: number | null; lastRun: string | null; threshold: number }): { strong: string | null; rest: string } {
  const { unusual, late, total, max, everyMinutes, lastRun, threshold } = o;
  const every = everyMinutes === null ? null : everyMinutes === 60 ? "every hour" : everyMinutes % 60 === 0 ? `every ${everyMinutes / 60} hours` : `every ${everyMinutes} minutes`;
  const bits = [
    late > 0 ? `${late} waiting for prices` : null,
    total === 0 ? "no series yet" : max ? `${total} of ${max} slots used` : `${total} series`,
    every ? `checked ${every}${lastRun ? `, last ${lastRun}` : ""}` : null,
    `a move over ${threshold}× a usual day becomes a finding`,
  ].filter(Boolean);
  return { strong: unusual > 0 ? `${unusual} unusual` : null, rest: bits.join(" · ") };
}

// ---------------------------------------------------------------- the open series
/** A refusal's heading by the server's code (the detail under it is the server's own words). */
export function refusalTitle(code: unknown): string | undefined {
  switch (code) {
    case "refresh_too_soon": return "Refreshed a moment ago";
    case "series_paused": return "The series is paused";
    case "fetch_in_progress": return "Already fetching";
    case "provider_daily_budget_reached": return "Today's price credits are used up";
    case "provider_minute_budget_reached": return "Price credits are used up for this minute";
    case "provider_not_configured": return "Prices can't be fetched";
    case "provider_rate_limited": return "The price provider is busy";
    case "series_limit_reached": return "No free series slots";
    case "series_exists": return "Already watched";
    case "symbol_not_found": return "Symbol not found";
    case "symbol_not_on_plan": return "Not on your data plan";
    case "symbol_has_no_data": return "No prices for this symbol";
    case "no_prices": return "No prices to move from";
    case "conflict": return "Someone changed this series";
    default: return undefined;
  }
}
/** An error as the refusal toast reads it: the server's detail plus the provider's own message (the toast shows `detail`). */
export function asRefusal(e: unknown): unknown {
  const x = e as { code?: unknown; full?: unknown; message?: unknown } | null;
  return x && typeof x === "object" && typeof x.full === "string" ? { code: x.code, detail: x.full } : e;
}

export interface Note { tone: "unusual" | "bad" | "neutral"; text: string }
/** What the open series says about itself besides its numbers: why it is late, still learning, paused, quiet. One line each. */
export function seriesNotes(o: {
  state: string; reason: string; since: string | null;
  failed: { code: string; http: number | null; message: string } | null; retryAt: string | null; admin: boolean;
}): Note[] {
  const { state, reason, since, failed, retryAt, admin } = o;
  const out: Note[] = [];
  if (state === "stale") out.push({ tone: "neutral", text: `No new price since ${since ?? "it was added"}.` });
  if (failed) {
    const what = failed.http ? `HTTP ${failed.http}` : failed.code;
    out.push({ tone: "bad", text: admin
      ? `The last update failed. Twelve Data said: ${failed.code}${failed.http ? ` ${failed.http}` : ""}: ${failed.message.replace(/[.\s]+$/, "")}${retryAt ? `. Trying again at ${retryAt}.` : "."}`
      : `The last update failed (${what}); ${retryAt ? `trying again at ${retryAt}` : "it will try again"}. The prices shown are the last ones received.` });
  }
  if (state === "warming_up") out.push({ tone: "neutral", text: `Needs more history before it can flag moves. ${reason}` });
  if (state === "pending") out.push({ tone: "neutral", text: "Reading its history; the first prices appear here shortly." });
  if (state === "paused") out.push({ tone: "neutral", text: "Paused: prices aren't pulled until it's resumed." });
  if (state === "moved") out.push({ tone: "neutral", text: reason });
  return out;
}

/** The chart's takeaway in one line: which way it went over the range, and by how much. */
export function takeaway(name: string, vs: number[], range: string, typical: number | null | undefined): string {
  if (vs.length < 2) return name;
  const chg = (vs[vs.length - 1] / vs[0] - 1) * 100;
  const flat = Math.abs(chg) < Math.max(0.1, (typical ?? 0) / 2);
  return `${name} ${flat ? "flat" : chg > 0 ? "up" : "down"} over ${range} (${pct(chg)})`;
}

/** The places a series' moves matter for, short: "Texas, Louisiana +3". */
export function placesLine(names: string[], max = 3): string {
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

/** A series' name as people read it. Some names are the provider's own ("SHY (iShares 1-3 Year Treasury Bond ETF)"): the
 *  symbol stays in mono beside it, so the brackets become "1-3 Year Treasury fund" without the brand and "ETF" noise.
 *  Any other name is shown as it is. */
/** Every provider-style series name inside a sentence, made friendly ("SHY (iShares 1-3 Year Treasury Bond ETF)" → "1-3 Year Treasury fund"). */
export function friendlySeriesText(text: string): string {
  return text.replace(/\b[A-Z][A-Z0-9.^=/-]{0,11} \([^()]*\)/g, m => seriesName(m));
}

export function seriesName(name: string): string {
  const m = name.match(/^[A-Z][A-Z0-9.^=/-]{0,11} \((.*)\)$/);
  if (!m || !/\bETFs?\b|iShares/i.test(m[1])) return name;
  const core = m[1].replace(/\b(iShares|ETFs?|Bond|Trust|Fund)\b/gi, " ").replace(/\s+/g, " ").trim();
  return core ? `${core} fund` : name;
}

/** "1 day", "3 days": a window's length in trading days. */
export const windowWord = (days: number) => `${days} ${days === 1 ? "day" : "days"}`;
