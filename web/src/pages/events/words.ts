// The event page's own words: a check's tests as "Needed / Yours", the tests a check will use before it has run, the
// set-aside links grouped by reason, and the one templated line of the investigation report that says why an event
// reached no product. Page-only; the shared words live in plain.ts.
import { TIME_ZONE } from "../../format.ts";
import { productAngle } from "../../plain.ts";

const MINUS = "−";
export interface Threshold { statistic: string; op: string; value: number }

// what each method compares against (server: app/validation/explain.py AGAINST)
const AGAINST: Record<string, string> = {
  seasonal_ratio: "the same period last year", recent_vs_prior: "the prior periods, seasonally adjusted",
  level_change: "the level before the event", trend: "the 12-month trend",
};
// what a percentile is taken among, per method
const AMONG: Record<string, string> = {
  seasonal_ratio: "the same period in past years", level_change: "past changes like it", trend: "past gaps to the trend",
};
export const againstOf = (method?: string) => (method ? AGAINST[method] : undefined);
const amongOf = (method?: string) => (method ? AMONG[method] : undefined) ?? "past periods like it";
// a first ("provisional") look tightens these two tests (server: validate.tighten)
const TIGHTENED = new Set(["percentile", "robust_z", "distance from usual"]);
export const STRICTER = "stricter on a first look";

const num = (s: string) => Number(s.replace(MINUS, "-").replace(/[^\d.+-]/g, ""));
const unsigned = (s: string) => s.replace(/^[+−-]/, "");

/** One test in plain words: what it needed, what yours was, and whether it was met. */
export interface TestWords { needed: string; yours: string; met: boolean | null; stricter: boolean }

/** A check's own test line ("change −1.5%, needed +5.0% or higher: not met") as "Needed / Yours". Null when the line
 *  isn't in the server's usual shape; show it as it is then. */
export function testWords(line: string, method?: string, final?: boolean): TestWords | null {
  const m = line.match(/^(.+?) ([−+-]?\d[\d.,]*(?: ?%| pp)?), needed ([−+-]?\d[\d.,]*(?: ?%| pp)?) (or lower|or higher): (met|not met)$/);
  if (!m) return null;
  const [, stat, yours, needed, side, met] = m;
  const higher = side === "or higher";
  const stricter = !final && TIGHTENED.has(stat);
  const done = { met: met === "met", stricter };
  if (stat === "change") {
    const v = num(needed), against = againstOf(method);
    const need = higher && v >= 0 ? `a rise of ${unsigned(needed)} or more` : !higher && v <= 0 ? `a fall of ${unsigned(needed)} or more`
      : `a change of ${needed} ${side}`;
    return { needed: against ? `${need} against ${against}` : need, yours, ...done };
  }
  if (stat === "percentile") {
    const p = num(yours), q = num(needed), among = amongOf(method);
    return higher
      ? { needed: `higher than ${q}% of ${among}`, yours: `higher than ${p}%`, ...done }
      : { needed: `in the lowest ${q}% of ${among}`, yours: `lower than ${Math.max(0, 100 - p)}%`, ...done };
  }
  if (stat === "distance from usual") {
    const v = num(yours);
    return {
      needed: `${unsigned(needed)} or more typical swings ${higher ? "above" : "below"} usual`,
      yours: `${unsigned(yours)} ${v < 0 ? "below" : "above"}`, ...done,
    };
  }
  return { needed: `${stat} of ${needed} ${side}`, yours, ...done };
}

// a threshold's value, written the way the server writes it in a check (explain._value)
function value(stat: string, v: number): string {
  const sign = (s: string) => (v < 0 ? `${MINUS}${s}` : `+${s}`);
  if (stat === "percentile") return `${Math.round(v)}`;
  if (stat === "pct_change") return sign(`${Math.abs(v).toFixed(1)}%`);
  if (stat === "pp_change") return sign(`${Math.abs(v).toFixed(2)} pp`);
  return v < 0 ? `${MINUS}${Math.abs(v).toFixed(2)}` : Math.abs(v).toFixed(2);
}
const STAT: Record<string, string> = { pct_change: "change", pp_change: "change", robust_z: "distance from usual", percentile: "percentile" };

/** What will count as an effect, before any figure is in: every test the check will use, from the task's thresholds.
 *  Level and trend checks add a test of how unusual the change is when the task has none (server:
 *  validation/methods._implicit_percentile: the outer 5 %, 2.5 % on a first look). */
export function plannedTests(thresholds: Threshold[], method: string | undefined, direction: string | undefined, final: boolean): { text: string; stricter: boolean }[] {
  const out = thresholds.map(t => {
    const stat = STAT[t.statistic] ?? t.statistic.replace(/_/g, " ");
    const w = testWords(`${stat} 0, needed ${value(t.statistic, t.value)} ${t.op.startsWith("<") ? "or lower" : "or higher"}: not met`, method, final);
    return { text: w?.needed ?? `${stat} ${t.op} ${t.value}`, stricter: !final && TIGHTENED.has(t.statistic) };
  });
  if ((method === "level_change" || method === "trend") && direction && !thresholds.some(t => t.statistic === "percentile")) {
    const among = amongOf(method);
    out.push({ text: direction === "rise" ? `higher than 95% of ${among}` : `in the lowest 5% of ${among}`, stricter: !final });
  }
  return out;
}

/** Links set aside for the same reason, together: "2 links set aside for the same reason". */
export interface AsideGroup { reason: string; decision: string; links: string[] }
export function groupAside(items: { product_type: string; angle: string; decision: string; reason: string }[]): AsideGroup[] {
  const by = new Map<string, AsideGroup>();
  for (const s of items) {
    const k = `${s.decision}|${s.reason}`;
    const g = by.get(k) ?? { reason: s.reason, decision: s.decision, links: [] };
    g.links.push(productAngle(s.product_type, s.angle));
    by.set(k, g);
  }
  return [...by.values()];
}
/** What a set-aside reason means for you, in plain words. */
export function asideMeaning(g: AsideGroup): string {
  if (/offers a metric that could show this effect/.test(g.reason))
    return `None of your products has a figure that would show ${g.links.length > 1 ? "these effects" : "this effect"}, so there was nothing to check ${g.links.length > 1 ? "them" : "it"} against and no team was told.`;
  if (g.decision === "cut_by_cap") return "It kept the more likely impacts above and left this one out, so no team was told.";
  return "Amiri Agent judged the link too weak to send to a team.";
}

/** The investigation report's section for this event: the one whose "From:" line names its findings. */
function reportSection(report: string, findingTitles: string[]): string | null {
  const parts = report.split(/\n(?=## )/).filter(p => p.startsWith("## "));
  const hits = parts.filter(p => { const from = p.match(/^From: (.*)$/m)?.[1] ?? p.split("\n").find(l => l.includes("From: ")) ?? "";
    return findingTitles.some(t => t && from.includes(t)); });
  return hits.length === 1 ? hits[0] : null;
}
/** Why the investigation traced nothing to your products: the report's own templated line for this event, when it
 *  has one ("Nothing is traced yet: the move (6.75%) is below the size its effects need (from about 7.0%)."). */
export function untracedWhy(report: string | null, findingTitles: string[]): string | null {
  if (!report) return null;
  const sec = reportSection(report, findingTitles);
  return sec?.match(/^(Nothing is traced[^\n]*|No product of the institution is exposed[^\n]*)$/m)?.[1] ?? null;
}
/** How many other events the report covers (it's the whole investigation's report). */
export function otherEventsInReport(report: string | null): number {
  if (!report) return 0;
  const n = report.split("\n").filter(l => /^## /.test(l) && !/^## (Findings set aside|Products the investigation)/.test(l)).length;
  return Math.max(0, n - 1);
}

/** Today's date where the bank is ("2026-11-11"). */
export const today = (now = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(now);
