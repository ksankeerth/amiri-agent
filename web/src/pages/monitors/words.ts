// Monitors, in words and rules (board 06; states: board 16 section G): how often, whether a check is late, how the list is
// grouped, what each row and each check says, what a new version changes, which findings to ask about after Check now.
// No React and no imports of app code beyond types, so `npm test` runs it. Times arrive already written (the page knows
// the institution's time zone).
import type { CheckRow, MonitorFinding, MonitorRow, MonitorSpec, MonitorsStatus } from "../../api/monitors";
import type { PillTone } from "../../components/v2/verdictWords";

/** "every hour", "every 6 hours", "once a day", "every 15 minutes": mid-sentence, so lower case. */
export function everyWords(min: number): string {
  if (min === 1440) return "once a day";
  if (min === 60) return "every hour";
  if (min % 60 === 0) return `every ${min / 60} hours`;
  return `every ${min} minutes`;
}

/** The same, short, for a list row: "every 15 min", "every hour", "every 6 h", "every day". */
export function everyShort(min: number): string {
  if (min === 1440) return "every day";
  if (min === 60) return "every hour";
  if (min % 60 === 0) return `every ${min / 60} h`;
  return `every ${min} min`;
}

/** A live monitor whose last check is older than twice its frequency has a check due (the scheduler isn't keeping up): said calmly, never as "overdue". */
export function isOverdue(m: Pick<MonitorRow, "status" | "check_frequency" | "last_check">, now: Date): boolean {
  if (m.status !== "live" || !m.last_check) return false;
  return now.getTime() - new Date(m.last_check.at).getTime() > 2 * m.check_frequency * 60_000;
}

/** How many of the findings met each "tell me if" line (the findings number the lines from 1). */
export function lineMatches(lines: number, findings: { source_ref?: { lines?: number[] } | null }[]): number[] {
  const out = Array<number>(lines).fill(0);
  for (const f of findings) for (const n of new Set(f.source_ref?.lines ?? [])) if (n >= 1 && n <= lines) out[n - 1]++;
  return out;
}

/** A calendar date ("2027-03-01", no time and no zone) as "1 Mar": read as written, never moved by the institution's time zone. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateWords(d: string): string {
  const m = d.match(/^(\d{4})-(\d\d)-(\d\d)/);
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]}` : d;
}

// ---------------------------------------------------------------- the list
type Waiting = Pick<MonitorRow, "status" | "pending">;
/** Waiting for a Risk Manager's approval: a new monitor, or a new version of a live or paused one. */
export const awaitingApproval = (m: Waiting): boolean => m.status === "submitted" || m.pending?.status === "submitted";

export interface Groups { waiting: MonitorRow[]; live: MonitorRow[]; paused: MonitorRow[]; draft: MonitorRow[]; retired: MonitorRow[] }
export type GroupId = keyof Groups;
export const GROUP_ORDER: GroupId[] = ["waiting", "live", "paused", "draft", "retired"];
export const GROUP_TITLE: Record<GroupId, string> = { waiting: "Waiting for approval", live: "Live", paused: "Paused", draft: "Drafts", retired: "Retired" };

/** The list's groups: what waits for a person first, then live (the busiest first), paused, drafts, retired. */
export function groupMonitors(xs: MonitorRow[]): Groups {
  const rest = xs.filter(m => !awaitingApproval(m));
  return {
    waiting: xs.filter(awaitingApproval),
    live: rest.filter(m => m.status === "live").sort((a, b) => b.findings_30d - a.findings_30d),
    paused: rest.filter(m => m.status === "paused"),
    draft: rest.filter(m => m.status === "draft"),
    retired: xs.filter(m => m.status === "retired"),
  };
}

/** The monitor the pane shows when the address names none: the busiest live one, else the first in the list's order. */
export function pickDefault(g: Groups): MonitorRow | null {
  return g.live[0] ?? GROUP_ORDER.map(k => g[k][0]).find(Boolean) ?? null;
}

/** The checks under a monitor: the latest two, and "All N checks" for the rest. One more is no saving: three show whole. */
export const CHECKS_SHOWN = 2;
export function checksShown(total: number, all: boolean): { shown: number; hidden: number } {
  const shown = all || total <= CHECKS_SHOWN + 1 ? total : CHECKS_SHOWN;
  return { shown, hidden: total - shown };
}

export const LIVE_SHOWN = 5;
/** The live rows shown: the first few, and the open one wherever it is; "▸ N more live" holds the rest. */
export function liveShown(live: MonitorRow[], selectedId: string | null, expanded: boolean): { shown: MonitorRow[]; hidden: number } {
  if (expanded || live.length <= LIVE_SHOWN + 1) return { shown: live, hidden: 0 };
  const shown = live.filter((m, i) => i < LIVE_SHOWN || m.monitor_id === selectedId);
  return { shown, hidden: live.length - shown.length };
}

/** What a row says about the last check: "fired 2 h ago", "quiet", "couldn't check", "check due · last checked 4 days ago", "not checked yet". `agoText` is the age, written. */
export function lastWords(m: Pick<MonitorRow, "status" | "check_frequency" | "last_check">, now: Date, agoText: (iso: string) => string): string {
  if (!m.last_check) return "not checked yet";
  if (isOverdue(m, now)) return `check due · last checked ${agoText(m.last_check.at)}`;
  const c = m.last_check;
  if (c.status === "fired") return `fired ${agoText(c.at)}`;
  if (c.status === "error") return `couldn't check ${agoText(c.at)}`;
  return "quiet";
}

/** The row's second line: "Commercial banking · every 6 h · fired 2 h ago", and the count that follows it in bold ("5" in 30 days). */
export function rowLine(m: MonitorRow, now: Date, agoText: (iso: string) => string): { lead: string; count: number | null } {
  const parts = [m.owner, everyShort(m.check_frequency)];
  if (m.status === "draft" || m.status === "submitted") parts.push("not live yet");
  else if (m.status === "paused") parts.push("paused");
  else if (m.status === "retired") parts.push(`retired ${agoText(m.updated_at)}`);   // nothing changes a retired monitor, so its last update is when it was retired
  else if (m.pending?.status === "submitted") parts.push(`version ${m.pending.version} waiting`);
  else if (m.pending && m.pending.status === "draft") parts.push(`version ${m.pending.version} being edited`);
  if (m.status === "live" || m.status === "paused") parts.push(lastWords(m, now, agoText));
  return { lead: parts.join(" · "), count: m.status === "draft" ? null : m.findings_30d };
}

/** The status word on a row or the pane's top line, with the version: "Live · version 3". */
export interface StatusLook { label: string; tone: PillTone; dashed?: boolean }
export function statusLook(m: Pick<MonitorRow, "status" | "live_version" | "latest_version">, withVersion = false): StatusLook {
  const v = (n: number | null) => (withVersion && n ? ` · version ${n}` : "");
  switch (m.status) {
    case "live": return { label: `Live${v(m.live_version)}`, tone: "good" };
    case "paused": return { label: `Paused${v(m.live_version)}`, tone: "neutral" };
    case "submitted": return { label: `Waiting for approval${v(m.latest_version)}`, tone: "unusual" };
    case "retired": return { label: `Retired${v(m.live_version)}`, tone: "neutral", dashed: true };
    default: return { label: `Draft${v(m.latest_version)}`, tone: "neutral" };
  }
}

/** A short word in a row's pill: only what the heading above it doesn't already say. */
export function rowPill(m: MonitorRow, group: GroupId): StatusLook | null {
  if (group === "waiting") return m.status === "submitted" ? { label: "Waiting for approval", tone: "unusual" } : { label: `Version ${m.pending!.version} waiting`, tone: "unusual" };
  if (group === "paused") return { label: "Paused", tone: "neutral" };
  if (group === "draft") return { label: "Draft", tone: "neutral" };
  if (group === "retired") return { label: "Retired", tone: "neutral", dashed: true };
  return null;
}

// ---------------------------------------------------------------- limits
/** "10 of 10 live. Pause or retire one first." when a monitor can't go live (or be resumed) because the limit is used. */
export function slotsWords(status: Pick<MonitorsStatus, "live" | "live_max"> | null): string | null {
  return status && status.live >= status.live_max ? `${status.live} of ${status.live_max} live. Pause or retire one first.` : null;
}
/** Approving a new monitor, or resuming a paused one, takes a live slot; a new version of a live one doesn't. */
export const needsSlot = (m: Pick<MonitorRow, "status">): boolean => m.status === "draft" || m.status === "submitted" || m.status === "paused";

// ---------------------------------------------------------------- checks
export interface CheckLook { word: string; tone: PillTone; count: string }
/** One check, as the board's row: "Fired · 2 findings", "Quiet · 0 findings", "Couldn't check", "Checking…". */
export function checkLook(r: Pick<CheckRow, "status" | "findings">): CheckLook {
  const n = r.findings ?? 0;
  const count = `${n} ${n === 1 ? "finding" : "findings"}`;
  if (r.status === "running") return { word: "Checking…", tone: "brand", count: "" };
  if (r.status === "failed") return { word: "Couldn't check", tone: "bad", count: "" };
  if (r.status === "stopped_early") return { word: "Stopped early", tone: "unusual", count };
  return n > 0 ? { word: "Fired", tone: "good", count } : { word: "Quiet", tone: "neutral", count };
}

/** "14 searches · 61 pages · 9 in the window" (and "3 already reported" when some were). */
export function coverageText(c: CheckRow["coverage"]): string {
  if (!c) return "";
  const p = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  return [p(c.web_queries, "search", "searches"), p(c.pages_seen, "page"), `${c.pages_in_window} in the window`, c.already_reported ? `${c.already_reported} already reported` : ""].filter(Boolean).join(" · ");
}

/** What the toast says when a check this viewer started has ended. */
export function checkDoneText(r: Pick<CheckRow, "status" | "findings">, test: boolean): string {
  if (r.status === "failed") return "The check failed: see Recent checks.";
  const n = r.findings ?? 0;
  if (test) return n ? `The test found ${n}. They are kept apart from your real findings.` : "The test found nothing new.";
  return n ? `Found ${n}. Sent to the investigation.` : "Nothing new.";
}

/** The findings that came from each check (a finding names the check that made it). */
export function findingsByCheck(findings: MonitorFinding[]): Record<string, MonitorFinding[]> {
  const out: Record<string, MonitorFinding[]> = {};
  for (const f of findings) { const k = f.source_ref?.check_run_id; if (k) (out[k] ??= []).push(f); }
  return out;
}

export const POLL_FINDINGS_MAX = 3;
/** The findings of one check that are still on their way (`new` or `grouped`), to ask about every 3 s until each lands. Findings
 *  that went to one investigation run land together, so one per run is enough; at most a few, so a long list isn't a burst of calls. */
export function waitingOn(findings: MonitorFinding[], checkRunId: string): string[] {
  const seen = new Set<string>();
  return findings
    .filter(f => f.source_ref?.check_run_id === checkRunId && (f.status === "new" || f.status === "grouped"))
    .filter(f => { const k = f.run_id ?? "new"; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, POLL_FINDINGS_MAX).map(f => f.finding_id);
}

/** The findings the page counts for "N findings in 30 days": the list's own number. */
export const findingsIn30 = (n: number): string => `${n} ${n === 1 ? "finding" : "findings"} in 30 days`;

// ---------------------------------------------------------------- what a new version changes
export interface Part { label: string; added: string[]; removed: string[]; before?: string; after?: string }
const joinNames = (xs: string[]) => xs.join(", ");
const listPart = (label: string, a: string[], b: string[]): Part | null => {
  const added = b.filter(x => !a.includes(x)), removed = a.filter(x => !b.includes(x));
  return added.length || removed.length ? { label, added, removed } : null;
};
const scalarPart = (label: string, a: string, b: string): Part | null => (a === b ? null : { label, added: [], removed: [], before: a, after: b });

/** The parts of the spec that differ between the running version (a) and the one waiting (b), in the form's words. */
export function diffParts(a: MonitorSpec, b: MonitorSpec): Part[] {
  const watch = (s: MonitorSpec) => s.public.watch.map(w => w.name);
  const dates = (s: MonitorSpec) => (s.about.key_dates ?? []).map(d => `${d.label} (${d.date})`);
  return [
    scalarPart("Name", a.about.name, b.about.name),
    scalarPart("The question", a.public.in_one_sentence, b.public.in_one_sentence),
    listPart("Tell me if", a.public.tell_me_if, b.public.tell_me_if),
    listPart("Watch", watch(a), watch(b)),
    listPart("Ignore", a.public.ignore ?? [], b.public.ignore ?? []),
    listPart("Where", a.public.places, b.public.places),
    scalarPart("Check", everyWords(a.about.check_frequency), everyWords(b.about.check_frequency)),
    scalarPart("Sources", sourcesWords(a), sourcesWords(b)),
    listPart("Key dates", dates(a), dates(b)),
    listPart("Could reach", a.private.exposure.map(e => e.id), b.private.exposure.map(e => e.id)),
    listPart("What counts as serious", a.private.serious ?? [], b.private.serious ?? []),
    scalarPart("How serious before it reports", `${a.alert_level} of 10`, `${b.alert_level} of 10`),
    scalarPart("Owner", a.about.owner, b.about.owner),
  ].filter((p): p is Part => !!p);
}
function sourcesWords(s: MonitorSpec): string {
  const x = s.public.sources;
  return x?.mode === "trusted_only" ? `Only ${joinNames(x.check_first)}` : `Any reputable outlet${x?.check_first.length ? `, ${joinNames(x.check_first)} first` : ""}`;
}

const NOUN: Record<string, [string, string]> = { "Tell me if": ["condition", "conditions"], Watch: ["name", "names"], Ignore: ["line", "lines"], Where: ["place", "places"], "Key dates": ["date", "dates"], "Could reach": ["item", "items"] };
const count = (label: string, n: number) => { const [one, many] = NOUN[label] ?? ["item", "items"]; return `${n} ${n === 1 ? one : many}`; };
/** One part in a line, as the board writes it: "Tell me if (+1 condition)", "Watch (+ “Samsung Taylor fab”)", "Check (now every hour)". A short single change is quoted; otherwise it is counted. */
export function partSummary(p: Part): string {
  if (p.before !== undefined) return `${p.label} (now ${p.after})`;
  const one = (xs: string[]) => xs.length === 1 && xs[0].length <= 40;
  const bits: string[] = [];
  if (p.added.length) bits.push(one(p.added) ? `+ “${p.added[0]}”` : `+${count(p.label, p.added.length)}`);
  if (p.removed.length) bits.push(one(p.removed) ? `− “${p.removed[0]}”` : `−${count(p.label, p.removed.length)}`);
  return `${p.label} (${bits.join(", ")})`;
}
export const changesLine = (parts: Part[]): string => parts.map(partSummary).join(" · ");

// ---------------------------------------------------------------- the question, as the pane lists it
/** The "tell me if" lines shown at first, and how many wait behind "+N more". */
export const TELL_SHOWN = 2;
export function shownLines<T>(lines: T[], all: boolean): { shown: T[]; hidden: number } {
  return all || lines.length <= TELL_SHOWN ? { shown: lines, hidden: 0 } : { shown: lines.slice(0, TELL_SHOWN), hidden: lines.length - TELL_SHOWN };
}

// ---------------------------------------------------------------- editing
/** Someone saved a new version, or changed the monitor, since this person opened the form. The server has no If-Match for monitors,
 *  so the page asks again just before saving and compares what it gets with what the form was opened on. */
export function changedSince(opened: { latest_version: number; updated_at: string }, now: { latest_version: number; updated_at: string }): boolean {
  return opened.latest_version !== now.latest_version || opened.updated_at !== now.updated_at;
}

/** The person's unsaved text, written out to put on the clipboard when a save finds someone else got there first. */
export function changesText(spec: MonitorSpec, note?: string): string {
  const list = (xs: string[]) => xs.map(x => `- ${x}`).join("\n");
  const out = [
    `Name: ${spec.about.name}`,
    `In one sentence: ${spec.public.in_one_sentence}`,
    `Watch: ${spec.public.watch.map(w => `${w.name} (${w.type}${w.other_forms?.length ? `, also ${w.other_forms.join(", ")}` : ""})`).join("; ")}`,
    `Tell me if:\n${list(spec.public.tell_me_if)}`,
    spec.public.ignore?.length ? `Ignore:\n${list(spec.public.ignore)}` : "",
    spec.public.places.length ? `Where: ${spec.public.places.join(", ")}` : "",
    `Check: ${everyWords(spec.about.check_frequency)}`,
    `Owner: ${spec.about.owner}`,
    spec.private.serious?.length ? `What counts as serious:\n${list(spec.private.serious)}` : "",
    note ? `What changed: ${note}` : "",
  ];
  return out.filter(Boolean).join("\n");
}

export interface FormErrors { fields: Record<string, string>; general: string[] }
/** The form's own checks, the server's limits (schemas.py) in words, before anything is sent. */
export function checkSpec(s: MonitorSpec): FormErrors {
  const f: Record<string, string> = {};
  const name = s.about.name.trim(), q = s.public.in_one_sentence.trim();
  if (name.length < 3) f["about.name"] = "Give it a name of at least 3 characters.";
  else if (name.length > 80) f["about.name"] = "Keep the name to 80 characters.";
  if (q.length < 10) f["public.in_one_sentence"] = "Say what to watch for in at least 10 characters.";
  else if (q.length > 300) f["public.in_one_sentence"] = "Keep it to 300 characters.";
  if (!s.public.watch.length) f["public.watch"] = "Add at least one name to watch.";
  const tell = s.public.tell_me_if;
  if (!tell.length) f["public.tell_me_if"] = "Write at least one condition.";
  else if (tell.length > 8) f["public.tell_me_if"] = "Eight conditions at most.";
  else if (tell.some(x => x.length < 3)) f["public.tell_me_if"] = "Each condition needs at least 3 characters.";
  if ((s.public.ignore ?? []).length > 8) f["public.ignore"] = "Eight lines at most.";
  return { fields: f, general: [] };
}
/** The lines of a textarea: one per line, blanks dropped. */
export const linesOf = (s: string): string[] => s.split("\n").map(x => x.trim()).filter(Boolean);

// ---------------------------------------------------------------- what the toasts say
/** The toast when the asking about a check's findings ends: how many joined an event. */
export function investigatedText(end: "done" | "timeout" | "cancelled", linked: number): string {
  if (end === "timeout") return "Still working; it will appear here.";
  if (end === "cancelled") return "";
  return linked > 0 ? `The investigation finished: ${linked === 1 ? "1 finding joined an event" : `${linked} findings joined events`}.` : "The investigation finished. No new event.";
}

/** A refusal's heading by the server's code (the detail under it is the server's own words). */
export function refusalTitle(code: unknown): string | undefined {
  switch (code) {
    case "monitor_not_connected": return "Monitors can't check the news right now";
    case "check_running": return "A check is already running";
    case "not_started": return "The check couldn't start";
    case "monitor_retired": return "This monitor is retired";
    case "monitor_limit_reached": return "The live limit is reached";
    case "invalid_transition": return "That can't be done now";
    default: return undefined;
  }
}

/** What the success toast says after a button on the monitor. */
export const DONE_WORDS = {
  submit: "Submitted for approval", approve: "Approved: live within a few minutes", pause: "Paused", resume: "Resumed: checked again within a few minutes", retire: "Retired",
} as const;
