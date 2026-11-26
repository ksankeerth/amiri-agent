// The Findings page's own logic (board 04; states: board 16 section E): which kind each finding is, how the tabs and the
// source filter count, how the groups are made and ordered, the words on a row and under a group. No React and no
// imports of app code beyond plain.ts, so `npm test` runs it.
import type { FindingRow } from "../../api/investigation";
import { notInvestigatedWhy, setAsideReason } from "../../plain.ts";

// ---------------------------------------------------------------- what kind of finding
/** What became of a finding, in the page's words: waiting, being investigated, in an event, no impact found, or the
 *  investigation couldn't run on it (nobody judged it, so it isn't "no impact"). */
export type Kind = "waiting" | "investigating" | "event" | "noimpact" | "failed";

/** The agent refused or lost the run: the reason says so, or (older rows) only the note does. */
export function investigationDidntRun(f: Pick<FindingRow, "status" | "outcome">): boolean {
  if (f.status !== "set_aside") return false;
  const o = f.outcome;
  return o?.reason === "investigation_failed" || (!o?.reason && /^the agent (refused|couldn't|could not|lost)/i.test(o?.note ?? ""));
}
export function kindOf(f: Pick<FindingRow, "status" | "outcome">): Kind {
  if (f.status === "new") return "waiting";
  if (f.status === "grouped") return "investigating";
  if (f.status === "linked") return "event";
  return investigationDidntRun(f) ? "failed" : "noimpact";
}

// ---------------------------------------------------------------- filters and tabs
export type Tab = "all" | "waiting" | "investigating" | "event" | "noimpact" | "failed";
export type SourceFilter = "all" | "monitor" | "timeseries" | "radar";
export const SOURCE_OPTIONS: { id: SourceFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "monitor", label: "Monitors" }, { id: "timeseries", label: "Prices" }, { id: "radar", label: "Radar" },
];
export const isSourceFilter = (s: string): s is SourceFilter => SOURCE_OPTIONS.some(o => o.id === s);
export const isTab = (s: string): s is Tab => ["all", "waiting", "investigating", "event", "noimpact", "failed"].includes(s);

/** The findings the source filter lets through (the tabs count these). */
export const bySource = (xs: FindingRow[], source: SourceFilter): FindingRow[] => (source === "all" ? xs : xs.filter(f => f.source === source));

export function tabCounts(xs: FindingRow[]): Record<Tab, number> {
  const n: Record<Tab, number> = { all: xs.length, waiting: 0, investigating: 0, event: 0, noimpact: 0, failed: 0 };
  for (const f of xs) n[kindOf(f)]++;
  return n;
}

// ---------------------------------------------------------------- groups
/** One block of the list: findings waiting, being investigated, couldn't be investigated, the ones in one event, or no impact. */
export interface Group { key: string; kind: Kind; eventId?: string; items: FindingRow[] }

const TONE_RANK: Record<string, number> = { bad: 0, mixed: 1, neutral: 2, good: 3 };
const newestFirst = (a: FindingRow, b: FindingRow) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);

/** The groups of the tab, in the order they read: waiting, being investigated, couldn't be investigated, then the events
 *  (most serious first, then the most findings, then the newest), then no impact found. Findings are newest first inside. */
export function makeGroups(xs: FindingRow[], tab: Tab, toneOf: (eventId: string) => string | undefined = () => undefined): Group[] {
  const rows = [...xs].sort(newestFirst);
  const wants = (k: Kind) => tab === "all" || tab === k;
  const out: Group[] = [];
  const plain = (k: Kind, key: string) => { if (!wants(k)) return; const items = rows.filter(f => kindOf(f) === k); if (items.length) out.push({ key, kind: k, items }); };
  plain("waiting", "waiting");
  plain("investigating", "investigating");
  if (wants("event")) {
    const by = new Map<string, FindingRow[]>();
    for (const f of rows) if (kindOf(f) === "event") { const id = f.outcome?.event_id ?? "none"; by.set(id, [...(by.get(id) ?? []), f]); }
    const evs = [...by.entries()].map(([id, items]): Group => ({ key: id, kind: "event", eventId: id === "none" ? undefined : id, items }));
    const rank = (g: Group) => TONE_RANK[toneOf(g.eventId ?? "") ?? ""] ?? 4;
    evs.sort((a, b) => rank(a) - rank(b) || b.items.length - a.items.length || (a.items[0].created_at < b.items[0].created_at ? 1 : -1));
    out.push(...evs);
  }
  plain("noimpact", "noimpact");
  plain("failed", "failed");  // last: what reached an event comes first
  return out;
}

/** How many findings a group shows before "Show the other N": an event's newest three; no impact found stays folded to one. */
export const SHOW_FIRST: Record<Kind, number> = { waiting: 10, investigating: 10, failed: 3, event: 3, noimpact: 1 };
export const shownIn = (g: Group, expanded: boolean): FindingRow[] => (expanded ? g.items : g.items.slice(0, SHOW_FIRST[g.kind]));
export const hiddenIn = (g: Group): number => Math.max(0, g.items.length - SHOW_FIRST[g.kind]);

// ---------------------------------------------------------------- the words
export const GROUP_TITLE: Record<Exclude<Kind, "event">, string> = {
  waiting: "Waiting for the next investigation", investigating: "Being investigated", failed: "Couldn't be investigated", noimpact: "No impact found",
};
export const TAB_LABEL: Record<Tab, string> = {
  all: "All", waiting: "Waiting", investigating: "Being investigated", event: "In an event", noimpact: "No impact found", failed: "Couldn't be investigated",
};

/** The source column: "Monitor · Texas power prices", "Price · Natural gas fund", "Radar". `name` is the monitor's or series' own name. */
export function sourceWords(f: Pick<FindingRow, "source">, name?: string | null): string {
  const kind = f.source === "monitor" ? "Monitor" : f.source === "timeseries" ? "Price" : f.source === "radar" ? "Radar" : f.source === "studio" ? "Scenario Studio" : "Other";
  return name && f.source !== "radar" ? `${kind} · ${name}` : kind;
}
/** The icon for a source (components/Icon names). */
export const sourceIcon = (s: string): string => (s === "monitor" ? "monitor" : s === "timeseries" ? "series" : s === "radar" ? "radar" : "info");
/** The page a finding's source lives on: its monitor, its market series, Radar. */
export function sourceLink(f: Pick<FindingRow, "source" | "source_ref">): string | null {
  const r = f.source_ref ?? {};
  if (f.source === "monitor" && r.monitor_id) return `/monitors/${encodeURIComponent(r.monitor_id)}`;
  if (f.source === "timeseries" && r.series_id) return `/series/${encodeURIComponent(r.series_id)}`;
  if (f.source === "radar") return "/radar";
  return null;
}
/** Where a row goes: the event it joined, else the page of whatever found it. */
export const rowLink = (f: FindingRow): string | null => (kindOf(f) === "event" && f.outcome?.event_id ? `/events/${encodeURIComponent(f.outcome.event_id)}` : sourceLink(f));

/** The signal bars: 3 strong, 2 moderate, 1 weak; none when the source gave no score. Same cut-offs as plain.ts signalStrength. */
export function signalOf(score: number | null | undefined): { level: 0 | 1 | 2 | 3; word: string } {
  if (score === null || score === undefined || !Number.isFinite(score)) return { level: 0, word: "No signal strength" };
  return score >= 70 ? { level: 3, word: "Strong signal" } : score >= 40 ? { level: 2, word: "Moderate signal" } : { level: 1, word: "Weak signal" };
}

const parts = (iso: string, timeZone: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone, ...o }).format(new Date(iso));
/** The time column: "10:45" today, a weekday ("Mon") for the last few days, then "4 Nov". In the institution's time zone. */
export function whenColumn(iso: string, now: Date, timeZone: string): string {
  const key = (d: Date | string) => parts(typeof d === "string" ? d : d.toISOString(), timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  if (key(iso) === key(now)) return parts(iso, timeZone, { hour: "2-digit", minute: "2-digit", hour12: false });
  const days = (now.getTime() - new Date(iso).getTime()) / 86400_000;
  return days < 6 ? parts(iso, timeZone, { weekday: "short" }) : parts(iso, timeZone, { day: "numeric", month: "short" });
}

/** Why a finding wasn't put in an event, in a few words: the investigation's own note, else its reason, else the plain fact. */
export function noImpactWhy(f: Pick<FindingRow, "outcome">): string {
  const o = f.outcome;
  if (o?.reason === "merged_into_event") return "Already part of an open event";
  const t = o?.note || setAsideReason(o?.reason) || "no link to your products";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Why a finding couldn't be investigated, as a sentence for the row: "The investigation agent didn't answer" (never the server's raw note). */
export function notInvestigatedLine(f: Pick<FindingRow, "outcome">): string {
  const t = notInvestigatedWhy(f.outcome?.note);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** A finding that was tried and went back to waiting (or is running again): how many tries so far; null when it is the first. */
export function triesOf(f: Pick<FindingRow, "status" | "outcome">): number | null {
  const n = f.outcome?.attempts;
  return (f.status === "new" || f.status === "grouped") && typeof n === "number" && n > 0 ? n : null;
}
export const retryWord = (n: number) => `Retried ${n}×`;

/** The line under a group's title, in words. */
export function groupMeta(g: Group, o: { waitMinutes: number | null; shown: number }): string {
  const folded = g.items.length > o.shown ? `showing ${o.shown}` : "";
  const lead = g.kind === "waiting" ? (o.waitMinutes ? `AMIRI Agent investigates every ${o.waitMinutes} minutes` : "")
    : g.kind === "failed" ? "These won't be tried again"
    : g.kind === "investigating" ? "The result arrives on its own"
    : "";
  return [lead, folded].filter(Boolean).join(" · ");
}

/** "Show the other 3": the button under a folded group. */
export const moreWords = (hidden: number, expanded: boolean) => (expanded ? "Show fewer" : `Show the other ${hidden}`);

// ---------------------------------------------------------------- a finding on its way
const POLL_MAX = 3;  // every viewer polls: keep it to a few requests (and agent checks) per 3 s
/** The findings to ask about every 3 seconds (UI_POLLING_NOTE.md: a finding on its way is `grouped`; done when it is
 *  `linked` or `set_aside`). The newest few, so a long list doesn't become a burst of calls. */
export function onItsWay(xs: FindingRow[]): string[] {
  // findings in one investigation run land together, so one per run is enough to know when it's done
  const seen = new Set<string>();
  return xs.filter(f => f.status === "grouped").sort(newestFirst)
    .filter(f => !f.run_id || (!seen.has(f.run_id) && seen.add(f.run_id) !== undefined))
    .slice(0, POLL_MAX).map(f => f.finding_id);
}
/** Whether an answer for a polled finding means it has landed. */
export const landed = (status: string): boolean => status === "linked" || status === "set_aside";
