// The Events list's own words: how events are ordered and what each row and the line under the heading say, and the
// investigation runs (and why one failed) in plain language. Page-only; the shared words live in plain.ts.
import type { EventDetail, EventRow, Run } from "../../api/investigation";
import { plural } from "../../format.ts";
import { anchorLabel, productTypeLabel } from "../../plain.ts";

// ---------------------------------------------------------------- order
const TONE_RANK: Record<EventRow["tone"], number> = { bad: 0, mixed: 1, good: 2, neutral: 3 };
export type Sort = "serious" | "newest" | "impacts";
export type Show = "open" | "closed" | "all";
const byNewest = (a: EventRow, b: EventRow) => (a.anchor < b.anchor ? 1 : a.anchor > b.anchor ? -1 : 0);
/** Most serious first: bad, mixed, good, neutral; then more possible impacts; then newest. */
export function sortEvents(rows: EventRow[], sort: Sort): EventRow[] {
  const cmp = sort === "newest" ? byNewest
    : sort === "impacts" ? (a: EventRow, b: EventRow) => b.hypotheses - a.hypotheses || byNewest(a, b)
    : (a: EventRow, b: EventRow) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.hypotheses - a.hypotheses || byNewest(a, b);
  return [...rows].sort(cmp);
}

/** The events a tab lists. Simulated events (from a series' "Simulate a move" or a test) stay out unless asked for. */
export function tabRows(events: EventRow[], show: Show, withSimulated: boolean): EventRow[] {
  return events.filter(e => (withSimulated || e.world === "live") && (show === "all" || e.status === show));
}

/** Events in pages: the first `n`, and how many are left. */
export const PAGE_SIZE = 25;
export const page = <T,>(rows: T[], n: number): { shown: T[]; left: number } => ({ shown: rows.slice(0, n), left: Math.max(0, rows.length - n) });

/** "news broke 17 Oct": what the date is, then the day (Colombo). Used when the server sends no opening time. */
export const whenText = (e: EventRow, dayOf: (iso: string) => string) => {
  const l = anchorLabel(e.anchor_basis);
  return `${l.charAt(0).toLowerCase()}${l.slice(1)} ${dayOf(e.anchor)}`;
};

// ---------------------------------------------------------------- what each row says
/** The products an event could move, once (from its effects), in the order the effects come. */
export function productNames(e: EventDetail | undefined): string[] | null {
  if (!e) return null;
  const seen = new Map<string, string>();
  for (const h of e.hypotheses) if (!seen.has(h.product_id)) seen.set(h.product_id, h.product_name || productTypeLabel(h.product_type));
  return [...seen.values()];
}
/** "Chip-Supplier Credit Lines · Data-Center Contractor Credit Lines +3": the first two, then how many more. */
export function productsText(names: string[], max = 2): string {
  if (names.length <= max) return names.join(" · ");
  return `${names.slice(0, max).join(" · ")} +${names.length - max}`;
}
/** When the latest news reached the event: its newest finding or a later finding that joined it. */
export function lastNews(e: EventDetail | undefined): string | null {
  if (!e) return null;
  const t = [...e.findings.map(f => f.created_at), ...e.developments.map(d => d.joined_at)].filter(Boolean).sort();
  return t.length ? t[t.length - 1] : null;
}
/** "5 effects" with the number apart, for the bold figure: [5, "effects"]; none yet: null. */
export const effectsFigure = (n: number): [number, string] | null => (n > 0 ? [n, n === 1 ? "effect" : "effects"] : null);
/** The alerts column: how many are waiting for a person, or nothing. */
export const alertsText = (n: number): string | null => (n > 0 ? plural(n, "alert") : null);
/** Alerts waiting for review, per event. */
export function alertsByEvent(alerts: { event_id: string }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of alerts) m.set(a.event_id, (m.get(a.event_id) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------- the line under the heading
export interface LedeIn {
  /** the live open events */
  open: { tone: string; hypotheses: number }[];
  /** how many different products those events could move; null until their details are in */
  products: number | null;
  /** how many checks against your data confirmed an effect; null until the details are in */
  confirmed: number | null;
  /** whether checks against your data are switched on (null: not known) */
  validation: boolean | null;
}
/** "2 bad for you · 14 possible effects on 9 products · checks against your data on: 1 confirmed so far". `hot` is the red part. */
export function ledeText(i: LedeIn): { hot: string | null; rest: string[] } {
  if (!i.open.length) return { hot: null, rest: ["Watching for news and price moves that reach your products"] };
  const bad = i.open.filter(e => e.tone === "bad").length;
  const effects = i.open.reduce((n, e) => n + e.hypotheses, 0);
  const rest: string[] = [];
  if (!bad) rest.push("None bad for you");
  rest.push(effects ? `${plural(effects, "possible effect")}${i.products != null && i.products > 0 ? ` on ${plural(i.products, "product")}` : ""}` : "No effects on your products traced yet");
  if (i.validation === false) rest.push("checks against your data are off");
  else if (i.validation && i.confirmed != null) rest.push(`checks against your data on: ${i.confirmed ? `${i.confirmed} confirmed so far` : "none confirmed yet"}`);
  return { hot: bad ? `${bad} bad for you` : null, rest };
}
/** How many effects across these events your data has confirmed. */
export const confirmedCount = (details: (EventDetail | undefined)[]): number =>
  details.reduce((n, d) => n + (d ? d.tasks.filter(t => t.check?.verdict === "confirms").length : 0), 0);

// ---------------------------------------------------------------- investigation runs
/** The last 200 runs (the most the server returns). */
export const RUNS_LIMIT = 200;

export type RunKind = "failed" | "stopped" | "running" | "finished";
export const runKind = (r: Run): RunKind => (r.status === "failed" ? "failed" : r.status === "stopped_early" ? "stopped" : r.status === "running" ? "running" : "finished");

/** What went wrong with a run, in words: who said no ("Refused by the agent") and why ("theme "Oil" not accepted"). */
export function runWords(r: Run): { what: string; why: string } {
  const err = r.error ?? "";
  const http = err.match(/HTTP (\d{3})/)?.[1];
  const tag = http ? ` (HTTP ${http})` : "";
  const what = /lost the run/.test(err) ? "Lost by the agent" : /refused|couldn't take/.test(err) ? "Refused by the agent"
    : r.status === "stopped_early" ? "Stopped early" : "Failed";
  let why = "";
  const at = err.indexOf("{");
  if (at >= 0) {
    try {
      const d = (JSON.parse(err.slice(at)) as { detail?: { loc?: unknown[]; input?: unknown; msg?: string }[] }).detail?.[0];
      const field = d?.loc?.find(x => typeof x === "string" && x !== "body" && x !== "findings" && x !== "item") as string | undefined;
      if (d?.input !== undefined && field) why = `${field.replace(/s$/, "")} "${String(d.input)}" not accepted${tag}`;
      else if (d?.msg) why = `${d.msg.replace(/\.$/, "")}${tag}`;
    } catch { /* not JSON: say it as it is below */ }
  }
  if (!why) {
    const text = err.replace(/^.*?HTTP \d{3}:?\s*/, "").replace(/^the agent [^:]*:\s*/, "").replace(/\.$/, "").trim();
    why = text ? `${text.charAt(0).toLowerCase()}${text.slice(1, 140)}${text.length > 140 ? "…" : ""}${tag}` : tag.trim().replace(/[()]/g, "");
  }
  return { what, why };
}
