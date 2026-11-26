// The event page's words and rules for the v2 chain (board 02; states: boards 15 section C and 16 section E): the four
// progress steps, what each product row says about your data, what AMIRI Agent's assessment line reads, and when you'll
// know. Plain logic, no React, so `npm test` covers it. The check's tests, the set-aside groups and the report's
// templated lines stay in ./words.ts.
import { dateRange, cap, count, earliest, onDay, sourceInfo, checkMove, verdictWhy, LEVEL_LABEL, type LevelKey } from "../../plain.ts";
import { day, person } from "../../format.ts";

// ---------------------------------------------------------------- the event's tone
export type ToneKey = "bad" | "mixed" | "good" | "neutral";
/** One impact: is the move bad for you? Said by the task first (its adverse direction), then by the alert's effect, then by
 *  the event's own tone when every effect points the same way; null when nothing says. */
export function adverseFor(
  expectedDirection: string,
  task: { adverse_direction?: string } | undefined,
  effect: { adverse: boolean } | undefined,
  eventTone: string | undefined,
): boolean | null {
  if (task?.adverse_direction) return expectedDirection === task.adverse_direction;
  if (effect) return effect.adverse;
  return eventTone === "bad" ? true : eventTone === "good" ? false : null;
}
/** The event as a whole: bad and good effects together are mixed. */
export function toneFrom(nBad: number, nGood: number): ToneKey {
  return nBad && nGood ? "mixed" : nBad ? "bad" : nGood ? "good" : "neutral";
}

// ---------------------------------------------------------------- the four steps under the title
export interface ProgressStep { label: string; value: string; /** 0 to 1: how much of the bar is filled */ fill: number }
export interface ProgressInput {
  findings: number;
  effects: number;
  teams: number;
  /** effects with a result in (anything but "waiting for your data") */
  checked: number;
  /** is the institution's data connected for checks */
  validation: boolean;
}
export function progressSteps(p: ProgressInput): ProgressStep[] {
  const s = (n: number, one: string, many?: string) => count(n, one, many);
  return [
    { label: "Found", value: s(p.findings, "finding"), fill: p.findings > 0 ? 1 : 0 },
    { label: "Investigated", value: p.effects ? s(p.effects, "possible effect") : "No effect traced", fill: 1 },
    { label: "Alerted", value: p.teams ? s(p.teams, "team") : p.effects ? "No team needs telling" : "Nothing to send", fill: p.effects || p.teams ? 1 : 0 },
    !p.effects ? { label: "Checked", value: "Nothing to check", fill: 0 }
      : !p.validation ? { label: "Checked", value: "Checks off", fill: 0 }
      : { label: "Checked", value: p.checked === p.effects && p.effects > 1 ? `All ${p.effects} checked` : `${p.checked} of ${p.effects} so far`, fill: p.checked / p.effects },
  ];
}

// ---------------------------------------------------------------- a product row
const TIMING: Record<string, string> = { days: "within days", weeks: "within weeks", months: "within months" };
/** "medium" and "within weeks": the size is shown bold, the timing after it. */
export function expectedParts(size?: string | null, timing?: string | null): { size: string | null; when: string | null } {
  return { size: size ? size.toLowerCase() : null, when: timing ? TIMING[timing] ?? `within ${timing}` : null };
}

// ---------------------------------------------------------------- which products come first, and how they are grouped
/** How many product rows show before "Show N more effects". */
export const PRODUCTS_SHOWN = 5;
/** A list this short is shown whole (hiding one row behind a button helps nobody), and is not given group labels. */
export const PRODUCTS_WHOLE_UP_TO = 6;

export interface RankInput { adverse: boolean | null; verdict?: string | null; size?: string | null }
const VERDICT_RANK: Record<string, number> = { confirms: 0, contradicts: 1 };
const SIZE_RANK: Record<string, number> = { large: 0, big: 0, high: 0, medium: 1, moderate: 1, small: 2, low: 2 };
/** Most important first: bad for you, then not known, then good for you; then what your data says (confirms, then moved the
 *  other way, then everything else); then the size of the expected move. Equal rows keep the order they came in. */
export function rankImpacts<T>(items: T[], pick: (x: T) => RankInput): T[] {
  const key = (x: T) => {
    const r = pick(x);
    return [r.adverse === true ? 0 : r.adverse === null ? 1 : 2, VERDICT_RANK[r.verdict ?? ""] ?? 2, SIZE_RANK[(r.size ?? "").toLowerCase()] ?? 3];
  };
  return items.map((x, i) => ({ x, i, k: key(x) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2] || a.i - b.i).map(o => o.x);
}

export interface ImpactGroup<T> { label: string | null; items: T[] }
const GROUP_LABEL: Record<string, string> = { rise: "Likely to rise", fall: "Likely to fall" };
/** The rows, with a label above each run that moves the same way ("Likely to rise", "Likely to fall"). Only when there are
 *  more than six rows and they do not all move the same way; otherwise one unlabelled group. The order inside a group is
 *  the order given, and the group holding the first row comes first. `whole` is the full list when `items` is only the part
 *  showing: the labels depend on all of it, so they do not come and go as the list opens and closes. */
export function groupByDirection<T>(items: T[], directionOf: (x: T) => string, whole: T[] = items): ImpactGroup<T>[] {
  const dirs = new Set(whole.map(directionOf));
  if (whole.length <= PRODUCTS_WHOLE_UP_TO || dirs.size < 2) return [{ label: null, items }];
  const groups: ImpactGroup<T>[] = [];
  const at = new Map<string, ImpactGroup<T>>();
  for (const x of items) {
    const d = directionOf(x);
    let g = at.get(d);
    if (!g) { g = { label: GROUP_LABEL[d] ?? "Other moves", items: [] }; at.set(d, g); groups.push(g); }
    g.items.push(x);
  }
  return groups;
}

/** The one order the list is shown in, collapsed or open: the groups (the one holding the top-ranked row first), then the
 *  rank inside each group. Not grouped, it is the ranked order as given. Showing the first five of this order, and then all of
 *  it, never moves a row that is already on screen. */
export function listOrder<T>(ranked: T[], directionOf: (x: T) => string): T[] {
  return groupByDirection(ranked, directionOf).flatMap(g => g.items);
}

/** The rows to show now: the first five of the list's order, or all of them once opened (or when the list is short). */
export function visibleImpacts<T>(ranked: T[], all: boolean): T[] {
  return all || ranked.length <= PRODUCTS_WHOLE_UP_TO ? ranked : ranked.slice(0, PRODUCTS_SHOWN);
}
/** The label of the button under the rows, or null when every row already shows. */
export function moreButtonText(total: number, all: boolean): string | null {
  if (total <= PRODUCTS_WHOLE_UP_TO) return null;
  return all ? "Show fewer" : `Show ${total - PRODUCTS_SHOWN} more ${total - PRODUCTS_SHOWN === 1 ? "effect" : "effects"}`;
}

/** The arrow for an expected move, and what it says in words. */
export function arrowFor(direction: string, adverse: boolean | null): { glyph: string; tone: "bad" | "good" | "neutral"; word: string } {
  const glyph = direction === "rise" ? "↑" : direction === "fall" ? "↓" : "→";
  const move = direction === "rise" ? "Expected to rise" : direction === "fall" ? "Expected to fall" : "Expected to move";
  const tone = adverse === true ? "bad" : adverse === false ? "good" : "neutral";
  return { glyph, tone, word: adverse === null ? move : `${move}; ${adverse ? "bad" : "good"} for you` };
}

/** "next check 16 Nov", "next check today", or "next check soon" once the day has passed (the check runs with the next update). */
export function nextCheckText(d: string | null | undefined, today: string): string | null {
  if (!d) return null;
  return d < today ? "next check soon" : d === today ? "next check today" : `next check ${onDay(d)}`;
}

export interface CheckLike {
  verdict: string; change: string | null; usual: string | null; what: string; why: string | null; as_of: string | null;
  next_check_after: string | null; final: boolean;
}
export interface TaskLike { next_check_after?: string | null; watch?: { from: string; until: string }; check?: CheckLike | null }
/** What the "Your data says" cell adds to the verdict: a word that replaces it (the watch hasn't started), and the line under it. */
export interface DataSays { pill: string | null; line: string | null }
export function dataSays(t: TaskLike | undefined, today: string): DataSays {
  if (!t) return { pill: null, line: null };
  const c = t.check, w = t.watch;
  const notStarted = !!w && w.from > today;
  const watching = w ? `Watching ${dateRange(w.from, w.until, new Date(`${today}T12:00:00Z`))}` : null;
  if (!c) return { pill: notStarted ? `Watch starts ${onDay(w!.from)}` : "Not checked yet", line: watching };
  switch (c.verdict) {
    case "not_yet": {
      if (notStarted) return { pill: `Watch starts ${onDay(w!.from)}`, line: watching };
      const next = cap(nextCheckText(t.next_check_after ?? c.next_check_after, today) ?? "");
      return { pill: null, line: next || watching };
    }
    case "confirms": case "contradicts": case "no_effect": {
      if (c.change) {
        const against = checkMove(c.what)?.against;
        return { pill: null, line: against ? `${c.change} ${against}` : c.change };
      }
      return { pill: null, line: c.verdict === "no_effect" ? "Within the usual range" : null };
    }
    case "insufficient_data": case "masked": return { pill: null, line: cap(verdictWhy(c.why)) || null };
    case "error": return { pill: null, line: c.as_of ? `Tried ${onDay(c.as_of)}` : null };
    default: return { pill: null, line: null };
  }
}

// ---------------------------------------------------------------- the findings on the left
export interface FindingBits {
  source: string;
  source_ref?: Record<string, unknown> | null;
  evidence?: { headlines?: { title?: string; outlet?: string | null; published_at?: string }[] } | null;
}
/** "Radar · 4 publishers", "News monitor · Reuters", "Market price": where a finding came from, in a few words. */
export function findingSource(f: FindingBits): string {
  const label = sourceInfo(f.source).label;
  const pubs = Number(f.source_ref?.publishers);
  if (f.source === "radar" && pubs > 0) return `${label} · ${count(pubs, "publisher")}`;
  const outlets = [...new Set((f.evidence?.headlines ?? []).map(h => h.outlet).filter((o): o is string => !!o))];
  if (!outlets.length) return label;
  return `${label} · ${outlets.slice(0, 2).join(" · ")}${outlets.length > 2 ? ` · +${outlets.length - 2}` : ""}`;
}
/** "Retried 2×" for a finding that took more than one go to investigate (outcome.attempts), else null. */
export function retriedText(outcome: { attempts?: number } | null | undefined): string | null {
  const n = outcome?.attempts ?? 0;
  return n > 1 ? `Retried ${n}×` : null;
}
/** "+3 later findings joined": the reports that joined after the event began. */
export const joinedText = (n: number) => `+${count(n, "later finding")} joined`;

// ---------------------------------------------------------------- AMIRI Agent's assessment
/** The assessment line: how many products it traced to, and the first few reasons in AMIRI Agent's own words (each
 *  impact's chain label). Empty when nothing was traced; the page then says why from the report. */
export function assessmentText(impacts: { chain_label: string }[]): string {
  if (!impacts.length) return "";
  const seen = [...new Set(impacts.map(i => i.chain_label.trim().replace(/\.$/, "")).filter(Boolean))];
  const shown = seen.slice(0, 3).map(cap);
  const more = seen.length - shown.length;
  return `${count(impacts.length, "possible effect")} on your products: ${shown.join(". ")}.${more > 0 ? ` And ${count(more, "more reason")} in the report.` : ""}`;
}

/** How many product types the investigation looked at and set aside: "4 product types". */
export function asideTypes(set_aside: { product_type: string }[]): number {
  return new Set(set_aside.map(s => s.product_type)).size;
}

// ---------------------------------------------------------------- alerts raised
export interface AlertBits { alert_id: string; owner: string; level: string; status: string; acknowledged_by?: string | null; resolved_by?: string | null; effects: unknown[] }
/** "to review", "acknowledged by Dilan", "resolved". */
export function alertStatus(a: AlertBits): string {
  if (a.status === "acknowledged") return a.acknowledged_by ? `acknowledged by ${person(a.acknowledged_by)}` : "acknowledged";
  if (a.status === "resolved") return a.resolved_by ? `resolved by ${person(a.resolved_by)}` : "resolved";
  return "to review";
}
/** The level as a pill: early warnings and confirmed alerts are red, "showing early signs" is amber. */
export function alertLook(level: string): { tone: "bad" | "unusual"; label: string } {
  return { tone: level === "developing" ? "unusual" : "bad", label: LEVEL_LABEL[level as LevelKey] ?? cap(level) };
}

// ---------------------------------------------------------------- when you'll know
export interface Know { label: string; value: string }
export interface KnowInput {
  tasks: TaskLike[];
  status: string;
  open_until: string;
  closed_at: string | null;
  today: string;
}
/** The dates that matter next: the next check against your data, then when the event closes (or closed). Nothing the
 *  event doesn't have: a closed event has no "closes if nothing new", a finished set of checks has no next check. */
export function whenYoullKnow(k: KnowInput): Know[] {
  const out: Know[] = [];
  const open = k.tasks.filter(t => !t.check?.final);
  const next = earliest(open.map(t => t.next_check_after ?? t.check?.next_check_after));
  if (next) out.push({ label: "Next check against your data", value: next < k.today ? "Soon" : next === k.today ? "Today" : onDay(next) });
  else if (k.tasks.length && !open.length) out.push({ label: "Checks against your data", value: "All final" });
  if (k.status === "open") out.push({ label: "Event closes if nothing new", value: day(k.open_until) });
  else out.push({ label: "Event closed", value: k.closed_at ? day(k.closed_at) : "—" });
  return out;
}

/** A closed event's checks can still arrive until its latest watch period ends ("26 Jan"); null when that has passed. */
export function checksUntil(tasks: TaskLike[], today: string): string | null {
  const ends = tasks.map(t => t.watch?.until).filter((u): u is string => !!u).sort();
  const last = ends[ends.length - 1];
  return last && last >= today ? onDay(last) : null;
}

// ---------------------------------------------------------------- the investigation's own state
export type RunState = "running" | "stopped" | "failed" | "ok";
export function runState(status: string | null | undefined): RunState {
  return status === "running" ? "running" : status === "stopped_early" ? "stopped" : status === "failed" ? "failed" : "ok";
}

// ---------------------------------------------------------------- the little scales in an opened impact
export interface ScaleLayout { fig: number; band?: { left: number; width: number }; thr?: number }
/** Where your figure, the usual range and the point an effect starts sit on a track, as percentages of its width. */
export function scaleLayout(fig: number, band?: [number, number], thr?: number): ScaleLayout {
  const pts = [fig, ...(band ?? []), ...(thr !== undefined ? [thr] : [])];
  const lo = Math.min(...pts), hi = Math.max(...pts);
  const pad = Math.max((hi - lo) * 0.18, Math.abs(hi) * 0.1, 0.1);
  const min = lo - pad, span = hi + pad - min;
  const at = (v: number) => Math.round(((v - min) / span) * 1000) / 10;
  return { fig: at(fig), ...(band ? { band: { left: at(band[0]), width: Math.round((at(band[1]) - at(band[0])) * 10) / 10 } } : {}), ...(thr !== undefined ? { thr: at(thr) } : {}) };
}
/** Where today is inside a watch period (0 to 100), and whether it is before, inside or after it. Dates are "2026-11-12". */
export function periodLayout(from: string, until: string, today: string): { at: number; state: "before" | "inside" | "after" } {
  const a = Date.parse(from), b = Date.parse(until), t = Date.parse(today);
  const state = t < a ? "before" : t > b ? "after" : "inside";
  const at = b > a ? Math.round(Math.max(0, Math.min(1, (t - a) / (b - a))) * 1000) / 10 : 0;
  return { at, state };
}
/** The first number in a figure ("−1.5%", "+0.60 pp", "3.2×"), or null. */
export function parseNum(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = s.replace(/−/g, "-").match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}
/** "−9.7% to +10.6%" → [−9.7, 10.6]. */
export function parseBand(usual: string | null | undefined): [number, number] | undefined {
  const p = usual?.split(/\s+to\s+/).map(parseNum);
  return p && p.length === 2 && p[0] !== null && p[1] !== null ? [p[0], p[1]] : undefined;
}
