// Alerts page (board 01; states: board 16 section D): the words and rules for the list and the reading pane, kept out of
// the shared plain.ts. Plain logic, no React, so `npm test` covers it.
import { day, person, plural } from "../../format.ts";
import { alertChangeText, cap, checkMove, splitCheckText, verdictWhy } from "../../plain.ts";
import { dataSays, type TaskLike } from "../events/eventWords.ts";
import { mergeEffects, type EffectKey } from "../events/mergeEffects.ts";
import type { PillTone } from "../../components/v2/verdictWords.ts";

interface Entry { at: string; change: string; text?: string | null; by?: string }
const asDay = (d: string) => (d.length === 10 ? `${d}T12:00:00Z` : d);

/** The history in one line. A run of the same change (the event only grew, 227 times) is counted, not listed:
 *  "raised 18 Oct · 227 updates from the event, 18 Oct to 10 Nov · last checked 10 Nov".
 *  `lastChecked` is the day the latest check looked at (the checks themselves stay in the full list). */
export function historySummary(history: Entry[], raisedAt: string, lastChecked?: string | null): string {
  const parts: string[] = [];
  const st: { run: { n: number; from: string; to: string } | null } = { run: null };
  const flush = () => {
    if (!st.run) return;
    const { n, from, to } = st.run;
    const [a, b] = [day(from), day(to)];
    parts.push(`${n} ${n === 1 ? "update" : "updates"} from the event, ${a === b ? `on ${a}` : `${a} to ${b}`}`);
    st.run = null;
  };
  let raised = false;
  for (const h of history) {
    if (h.change === "checked") continue;  // said once, as "last checked"
    if (alertChangeText(h).startsWith("Updated")) {
      st.run = st.run ? { ...st.run, n: st.run.n + 1, to: h.at } : { n: 1, from: h.at, to: h.at };
      continue;
    }
    flush();
    if (h.change === "raised") { raised = true; parts.push(`raised ${day(h.at)}`); continue; }
    const who = h.by && h.by !== "AMIRI Agent" ? ` by ${person(h.by)}` : "";
    parts.push(`${alertChangeText(h).toLowerCase()}${who} ${day(h.at)}`);
  }
  flush();
  if (!raised) parts.unshift(`raised ${day(raisedAt)}`);
  if (lastChecked) parts.push(`last checked ${day(asDay(lastChecked))}`);
  return cap(parts.join(" · "));
}

// ---------------------------------------------------------------- tabs, filters and the URL
export type Tab = "new" | "acknowledged" | "resolved";
export type LevelKey = "warning" | "developing" | "adverse";
export const TABS: { id: Tab; label: string; countLabel: string }[] = [
  { id: "new", label: "New", countLabel: "alerts to review" },
  { id: "acknowledged", label: "Acknowledged", countLabel: "acknowledged alerts" },
  { id: "resolved", label: "Resolved", countLabel: "resolved alerts" },
];
export const parseTab = (s: string | null | undefined): Tab => (s === "acknowledged" || s === "resolved" ? s : "new");
export const LEVELS: { id: "" | LevelKey; label: string }[] = [
  { id: "", label: "Any" }, { id: "warning", label: "Early warning" }, { id: "developing", label: "Developing" }, { id: "adverse", label: "Confirmed" },
];
/** The phone's "Filter" button: how many filters are on, and the same in words beside it ("Retail banking · Early warning"). */
export function filterState(team: string, level: "" | LevelKey): { n: number; label: string; summary: string } {
  const lv = level ? LEVELS.find(l => l.id === level)?.label ?? "" : "";
  const n = (team ? 1 : 0) + (lv ? 1 : 0);
  return { n, label: n ? `Filter · ${n}` : "Filter", summary: [team, lv].filter(Boolean).join(" · ") };
}
export const parseLevel = (s: string | null | undefined): "" | LevelKey => (s === "warning" || s === "developing" || s === "adverse" ? s : "");

/** An alert's level as a pill: the word says it; red for an early warning, amber while it develops, ink once your data confirms it. */
export function levelPill(level: string): { tone: PillTone; label: string } {
  if (level === "adverse") return { tone: "ink", label: "Confirmed" };
  if (level === "developing") return { tone: "unusual", label: "Developing" };
  return { tone: "bad", label: "Early warning" };
}
export const statusWord = (status: string): string => (status === "acknowledged" ? "Acknowledged" : status === "resolved" ? "Resolved" : "New");

type Row = { owner: string; status: string; n: number };
/** The number on a tab or in the team menu, from the summary (which counts every alert, not only the newest listed).
 *  undefined until the summary is in: "0" would say there are none. */
export function countAt(rows: Row[] | undefined, status: Tab, team = ""): number | undefined {
  if (!rows) return undefined;
  return rows.filter(r => r.status === status && (!team || r.owner === team)).reduce((n, r) => n + r.n, 0);
}

/** The line under the heading: "3 to review · 5 acknowledged this week". Acknowledged-this-week is the whole institution's, so a
 *  team's view leaves it out. */
export function ledeText(i: { toReview: number | null; acknowledgedWeek: number | null; team: string }): { hot: string | null; rest: string[] } | null {
  if (i.toReview === null) return null;
  const rest: string[] = [];
  if (i.toReview === 0) rest.push(i.team ? `Nothing to review for ${i.team}` : "Nothing to review");
  if (!i.team && i.acknowledgedWeek !== null) rest.push(`${i.acknowledgedWeek} acknowledged this week`);
  return { hot: i.toReview > 0 ? `${i.toReview} to review` : null, rest };
}

/** Which alert the reading pane shows. The one in the address, if it is in the list; else (on a wide screen) the first; on a
 *  phone the list is the page until one is opened. */
export function pickAlert<T extends { alert_id: string }>(rows: T[], id: string | null, phone: boolean): T | null {
  const hit = id ? rows.find(r => r.alert_id === id) : undefined;
  return hit ?? (phone ? null : rows[0] ?? null);
}
/** The alert to show once this one leaves the list (it was acknowledged): the next one down, else the one above. */
export function neighbour<T extends { alert_id: string }>(rows: T[], id: string): T | null {
  const i = rows.findIndex(r => r.alert_id === id);
  if (i < 0) return null;
  return rows[i + 1] ?? rows[i - 1] ?? null;
}

/** Many alerts: past this, the page suggests filtering by team first (board 16 section D). */
export const MANY = 12;
/** The newest this many are asked for (the API's largest page); the summary says when there are more. */
export const LIST_LIMIT = 200;
export function limitNote(total: number | undefined, shown: number): string | null {
  if (total === undefined || total <= shown) return null;
  return `Newest ${shown} shown. Narrow with the team or level to see older ones.`;
}

// ---------------------------------------------------------------- the list
/** "Texas power prices spike · +4 more effects": the list row names the first effect in its title, so the rest are "more". */
export const listMeta = (eventTitle: string, effects: number): string =>
  `${eventTitle} · ${effects === 0 ? "no effects yet" : effects === 1 ? "1 effect" : moreEffects(effects - 1)}`;

/** The list's short title. The stored title names every product ("Tech Employee Savings: deposit inflow expected to fall (and 4
 *  more effects on Data-Center Contractor Credit Lines, …)"): the row keeps the first product, metric and direction; the count is
 *  in the meta line and the whole sentence stays in the pane's heading. With no tail to cut, the first effect is spelled out when
 *  the title is long; a short title is left alone. */
const TAIL = /\s*\(and \d+ more effects? on .*\)\s*$/;
export function shortTitle(title: string, first?: { product: string; metric_name: string; direction: string } | null): string {
  const cut = title.replace(TAIL, "");
  if (cut !== title || !first || title.length <= 90) return cut;
  const dir = first.direction === "rise" ? "rise" : first.direction === "fall" ? "fall" : "move";
  return `${first.product}: ${first.metric_name} expected to ${dir}`;
}
/** The title the list row and the pane heading both show. The long server sentence stays on the heading's title attribute. */
export const alertTitle = (a: { title: string; effects: { product: string; metric_name: string; direction: string }[] }): string => shortTitle(a.title, a.effects[0]);
/** The "+N more effects" count: effects after the duplicates are merged, the same way the list and the pane count them. */
export const effectCount = (effects: EffectKey[]): number => mergeEffects(effects).length;

/** The line a person leaves on an alert: "Acknowledged by Dilan, 2 h ago" / "Resolved by Dilan, 3 days ago". */
export function whoLine(a: { status: string; acknowledged_by: string | null; acknowledged_at: string | null; resolved_by: string | null; resolved_at: string | null },
  ago: (iso: string) => string): string | null {
  if (a.status === "acknowledged") return `Acknowledged${a.acknowledged_by ? ` by ${person(a.acknowledged_by)}` : ""}${a.acknowledged_at ? `, ${ago(a.acknowledged_at)}` : ""}`;
  if (a.status === "resolved") return `Resolved${a.resolved_by ? ` by ${person(a.resolved_by)}` : ""}${a.resolved_at ? `, ${ago(a.resolved_at)}` : ""}`;
  return null;
}

// ---------------------------------------------------------------- the reading pane: what your data says
export interface EffectLike {
  check?: { verdict: string; verdict_text?: string; what: string; as_of?: string | null; final?: boolean } | null;
}
export interface Says {
  /** the check's verdict, as the shared Verdict pill */
  verdict: { key: string; text: string | null } | null;
  /** a word in the pill's place ("Not checked yet", "Watch starts 3 Dec") */
  word: string | null;
  /** the institution's checks are switched off */
  off: boolean;
  line: string | null;
}
/** One effect's "Your data says". The event's task knows more (the figure, the next check, the watch period), so it speaks first;
 *  until it arrives, or when the event can't be read, the alert's own copy of the check does. */
export function effectSays(e: EffectLike, task: TaskLike | undefined, today: string, validation: boolean | null): Says {
  if (task) {
    const s = dataSays(task, today);
    const c = task.check;
    if (c && !s.pill) return { verdict: { key: c.verdict, text: (c as { verdict_text?: string }).verdict_text ?? null }, word: null, off: false, line: s.line };
    return { verdict: null, word: s.pill ?? "Not checked yet", off: false, line: s.line };
  }
  const c = e.check;
  if (c) {
    const m = checkMove(c.what);
    const measured = c.verdict === "confirms" || c.verdict === "contradicts" || c.verdict === "no_effect";
    const line = measured ? (m ? `${m.move} ${m.against}` : c.verdict === "no_effect" ? "Within the usual range" : null)
      : c.verdict === "insufficient_data" || c.verdict === "masked" || c.verdict === "not_yet" ? cap(verdictWhy(splitCheckText(c.what)[1])) || null
      : c.verdict === "error" && c.as_of ? `Tried ${day(`${c.as_of}T12:00:00Z`)}` : null;
    return { verdict: { key: c.verdict, text: c.verdict_text ?? null }, word: null, off: false, line };
  }
  if (validation === false) return { verdict: null, word: null, off: true, line: null };
  return { verdict: null, word: "Not checked yet", off: false, line: null };
}

/** Effects with a result in: anything but "waiting for your data" (the Event page counts the same way). */
export const checkedCount = (effects: EffectLike[]): number => effects.filter(e => e.check && e.check.verdict !== "not_yet").length;

/** "Checked against your data: 1 of 2." and what is left to say. `next` is the earliest next check ("next check 1 Dec"). */
export function progressWords(done: number, total: number, next: string | null, checksOff: boolean): { strong: string; rest: string } | null {
  if (total === 0) return null;
  if (checksOff) return { strong: "Checks are off.", rest: "AMIRI Agent can't test these against your data." };
  if (done === 0) return { strong: "Not checked against your data yet.", rest: next ? `${cap(next)}.` : "It waits for your figures." };
  const left = total - done;
  return { strong: `Checked against your data: ${done} of ${total}.`, rest: left === 0 ? "" : left === 1 ? "The other waits for your figures." : `The other ${left} wait for your figures.` };
}

/** How many effects the pane shows before "+N more effects": three, and a longer list is folded. */
export const EFFECTS_SHOWN = 3;
export function effectsShown(total: number, all: boolean): { shown: number; hidden: number } {
  const shown = all ? total : Math.min(total, EFFECTS_SHOWN);
  return { shown, hidden: total - shown };
}
export const moreEffects = (n: number): string => `+${n} more ${n === 1 ? "effect" : "effects"}`;

/** "Evidence · 3 findings". */
export const evidenceTitle = (findings: number): string => `Evidence · ${plural(findings, "finding")}`;

// ---------------------------------------------------------------- empty lists
export interface EmptyCopy { title: string; text: string; /** which filter a "show all" button clears */ clear: "team" | "level" | "both" | null }
const WORD: Record<Tab, string> = { new: "new", acknowledged: "acknowledged", resolved: "resolved" };
/** Why a list is empty, and what to do. With a team or level on, it says so and offers to clear it; without, each tab says what lands there. */
export function emptyCopy(tab: Tab, team: string, level: "" | LevelKey): EmptyCopy {
  if (team || level) {
    const lv = level ? LEVELS.find(l => l.id === level)?.label.toLowerCase() : undefined;
    return {
      title: `No ${WORD[tab]} ${lv ? `${lv} ` : ""}alerts${team ? ` for ${team}` : ""}`,
      text: team && level ? "Other teams or levels may have some." : team ? "Other teams may have some." : "Other levels may have some.",
      clear: team && level ? "both" : team ? "team" : "level",
    };
  }
  if (tab === "new") return { title: "No alerts for your teams", text: "When an event could hit your products, the owning team's alert appears here.", clear: null };
  if (tab === "acknowledged") return { title: "Nothing acknowledged", text: "When someone takes an alert on, it is kept here with who and when.", clear: null };
  return { title: "Nothing resolved yet", text: "Alerts you resolve are kept here, with who resolved them and why.", clear: null };
}
