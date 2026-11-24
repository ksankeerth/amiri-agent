// The Events list's own words: how events are grouped and ordered, what the checks say so far, and the
// investigation runs (and why one failed) in plain language. Page-only; the shared words live in plain.ts.
import { api } from "../../api/client";
import type { EventDetail, EventRow, Run } from "../../api/investigation";
import { anchorLabel, earliest, onDay, type VerdictKey } from "../../plain";

// ---------------------------------------------------------------- groups and order
export type GroupKey = "hurt" | "help" | "none";
/** What an event means for the institution: bad or mixed could hurt, good could help, neutral touches no product. */
export const groupOf = (tone: EventRow["tone"]): GroupKey => (tone === "bad" || tone === "mixed" ? "hurt" : tone === "good" ? "help" : "none");
export const GROUP_TITLE: Record<GroupKey, string> = { hurt: "Could hurt you", help: "Could help you", none: "Touch none of your products" };

const TONE_RANK: Record<EventRow["tone"], number> = { bad: 0, mixed: 1, good: 2, neutral: 3 };
export type Sort = "serious" | "newest" | "impacts";
const byNewest = (a: EventRow, b: EventRow) => (a.anchor < b.anchor ? 1 : a.anchor > b.anchor ? -1 : 0);
/** Most serious first: bad, mixed, good, neutral; then more possible impacts; then newest. */
export function sortEvents(rows: EventRow[], sort: Sort): EventRow[] {
  const cmp = sort === "newest" ? byNewest
    : sort === "impacts" ? (a: EventRow, b: EventRow) => b.hypotheses - a.hypotheses || byNewest(a, b)
    : (a: EventRow, b: EventRow) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.hypotheses - a.hypotheses || byNewest(a, b);
  return [...rows].sort(cmp);
}
export function splitGroups(rows: EventRow[]): Record<GroupKey, EventRow[]> {
  const out: Record<GroupKey, EventRow[]> = { hurt: [], help: [], none: [] };
  for (const e of rows) out[groupOf(e.tone)].push(e);
  return out;
}

/** "news broke 17 Oct": what the date is, then the day (Colombo). */
export const whenText = (e: EventRow, dayOf: (iso: string) => string) => {
  const l = anchorLabel(e.anchor_basis);
  return `${l.charAt(0).toLowerCase()}${l.slice(1)} ${dayOf(e.anchor)}`;
};

// ---------------------------------------------------------------- what the checks say so far
export interface CheckWords {
  /** "2 of 6 checked": only when some have been checked */
  progress?: string;
  /** the most telling result so far, to show with its shape and word */
  result?: { verdict: VerdictKey; adverse?: boolean | null; figure?: string | null };
  /** plain text when there is no result yet: "first check 18 Nov", "Not checked" */
  text?: string;
}
const WEIGHT: Record<VerdictKey, number> = { confirms: 6, contradicts: 5, error: 4, no_effect: 3, insufficient_data: 2, masked: 2, not_yet: 0 };

/** An event's checks in words: the most telling result so far and how many are in, or when the first check is due. */
export function checkWords(e: EventDetail | undefined): CheckWords | null {
  if (!e) return null;
  if (!e.run.validation) return { text: "Not checked" };
  const total = e.tasks.length;
  const done = e.tasks.filter(t => t.check && t.check.verdict !== "not_yet");
  const next = earliest(e.tasks.filter(t => !t.check?.final).map(t => t.next_check_after ?? t.check?.next_check_after));
  if (!done.length) return { text: next ? `first check ${onDay(next)}` : "Not checked yet" };
  const top = [...done].sort((a, b) => WEIGHT[b.check!.verdict as VerdictKey] - WEIGHT[a.check!.verdict as VerdictKey])[0].check!;
  const figure = done.length === 1 && top.change && top.change.length <= 12 ? top.change : null;
  return {
    progress: `${done.length} of ${total} checked`,
    result: { verdict: top.verdict as VerdictKey, adverse: top.alert === "opportunity" ? false : top.alert === "adverse" ? true : undefined, figure },
  };
}

// ---------------------------------------------------------------- investigation runs
/** The last 200 runs (the most the server returns). */
export const RUNS_LIMIT = 200;
export const fetchRuns = () => api<{ items: Run[] }>(`/api/v1/investigations?limit=${RUNS_LIMIT}`).then(r => r.items);

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
