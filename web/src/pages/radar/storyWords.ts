// Radar's own logic (board 05; states: board 16 section F): the tabs and their counts, how the list is ordered and cut, where
// a story went, what the Check now button says when it can't be pressed, the words when a read ends, and which sent stories
// are worth asking about. No React and no imports of app code beyond plain.ts and format.ts, so `npm test` runs it.
import type { RadarRun, RadarStatus, RadarStory } from "../../api/radar";
import { plainError, plural } from "../../format.ts";
import { investigationFailed, NOT_INVESTIGATED, notInvestigatedWhy, setAsideReason } from "../../plain.ts";

// ---------------------------------------------------------------- tabs and the list
export type Tab = "all" | "sent" | "below" | "dismissed";
export const TABS: { id: Tab; label: string; countLabel: string }[] = [
  { id: "all", label: "All stories", countLabel: "stories" },
  { id: "sent", label: "Sent", countLabel: "sent to investigate" },
  { id: "below", label: "Held back", countLabel: "held back" },
  { id: "dismissed", label: "Dismissed", countLabel: "dismissed" },
];
export const parseTab = (s: string | null): Tab => (TABS.some(t => t.id === s) ? (s as Tab) : "all");

const RANK: Record<RadarStory["status"], number> = { sent: 0, below: 1, dismissed: 2 };
/** Sent first, then held back, then dismissed; the server's order (newest first) inside each. */
export const orderStories = (xs: RadarStory[]): RadarStory[] => xs.map((s, i) => [s, i] as const).sort((a, b) => RANK[a[0].status] - RANK[b[0].status] || a[1] - b[1]).map(x => x[0]);

/** The stories of a tab, in a place or in all. */
export const listFor = (xs: RadarStory[], tab: Tab, place: string): RadarStory[] =>
  orderStories(xs).filter(s => (tab === "all" || s.status === tab) && (!place || s.places.includes(place)));

/** The tab counts, for the chosen place. */
export function tabCounts(xs: RadarStory[], place: string): Record<Tab, number> {
  const n: Record<Tab, number> = { all: 0, sent: 0, below: 0, dismissed: 0 };
  for (const s of xs) if (!place || s.places.includes(place)) { n.all++; n[s.status]++; }
  return n;
}

/** The places the stories are about, in the order they first appear. */
export const placesOf = (xs: RadarStory[]): string[] => [...new Set(xs.flatMap(s => s.places))];

/** The open story: the one in the address, else the first (the phone shows the list first). */
export function pickStory(rows: RadarStory[], id: string | null, phone: boolean): RadarStory | null {
  const hit = id ? rows.find(s => s.story_id === id) : undefined;
  return hit ?? (phone ? null : rows[0] ?? null);
}
/** The story to open after one leaves the list (dismissed, restored): the next one down, else the one above. */
export function neighbour(rows: RadarStory[], id: string): RadarStory | null {
  const i = rows.findIndex(s => s.story_id === id);
  return rows[i + 1] ?? rows[i - 1] ?? null;
}

/** How many rows show before "N more": the board shows the sent ones and a few held back. */
export const LIST_FIRST = 6;
/** The rows to show, and how many wait behind the button. The open story is always among the shown. */
export function shownRows(rows: RadarStory[], openId: string | null, expanded: boolean): { shown: RadarStory[]; hidden: number } {
  if (expanded || rows.length <= LIST_FIRST + 1) return { shown: rows, hidden: 0 };  // one row more is no saving: show it
  const keep = new Set(rows.slice(0, LIST_FIRST).map(s => s.story_id));
  if (openId) keep.add(openId);
  const shown = rows.filter(s => keep.has(s.story_id));
  return { shown, hidden: rows.length - shown.length };
}
export function moreWord(tab: Tab, n: number): string {
  return tab === "sent" ? `${n} more sent` : tab === "below" ? `${n} more held back` : tab === "dismissed" ? `${n} more dismissed` : `${n} more ${n === 1 ? "story" : "stories"}`;
}

// ---------------------------------------------------------------- one story
export const RELEVANCE: Record<RadarStory["relevance"], { word: string; pill: "ink" | "neutral" }> = {
  high: { word: "High relevance", pill: "ink" },
  medium: { word: "Relevant", pill: "neutral" },
  low: { word: "Slightly relevant", pill: "neutral" },
};

/** What the page knows beyond the story itself. */
export interface Where {
  /** finding_id → why a set-aside finding was set aside. */
  reasons: Record<string, string | null>;
  /** finding_id → the investigation's own note on a finding that couldn't be investigated (turned into one plain phrase, never shown raw). */
  notes?: Record<string, string | null>;
  /** event_id → the event's name as the rest of the app shows it. */
  titles: Record<string, string>;
  /** finding ids being asked about now (this viewer pressed a button). */
  watching: ReadonlySet<string>;
}
export type WentKind = "event" | "waiting" | "investigating" | "noimpact" | "failed" | "none";
export interface Went { kind: WentKind; text: string; eventId?: string; /** one more sentence for the open story */ detail?: string; /** why it couldn't be investigated, in a few words */ reason?: string }

/** Where a sent story stands: in an event, being investigated, waiting, no impact found, or couldn't be investigated. Not sent: nothing. */
export function whereWent(s: RadarStory, w: Where): Went {
  if (s.status !== "sent") return { kind: "none", text: "" };
  const reason = s.finding_id ? w.reasons[s.finding_id] : undefined;
  if (s.event_id) return { kind: "event", text: w.titles[s.event_id] ?? s.event_title ?? "the event", eventId: s.event_id };
  if (s.finding_status === "grouped" || (s.finding_id && w.watching.has(s.finding_id) && s.finding_status !== "set_aside")) return { kind: "investigating", text: "Being investigated" };
  if (investigationFailed(s.finding_status, reason)) {
    const why = notInvestigatedWhy(s.finding_id ? w.notes?.[s.finding_id] : null);
    return { kind: "failed", text: NOT_INVESTIGATED, reason: why, detail: `Radar sent it, but it couldn't be investigated: ${why}.` };
  }
  if (s.finding_status === "set_aside") {
    return reason ? { kind: "noimpact", text: "No impact found", detail: `No impact found: ${setAsideReason(reason)}.` } : { kind: "noimpact", text: "Not in an event" };
  }
  return { kind: "waiting", text: "Waiting for investigation" };
}

/** "Follow-up to “…”": the story it continues (its fingerprint is `development_of`), or a plain line when that one has aged out. */
export function followUpOf(s: RadarStory, all: RadarStory[]): string | null {
  if (!s.development_of) return null;
  const was = all.find(x => x.fingerprint === s.development_of);
  return was ? `Follow-up to “${was.title}”` : "Follow-up to an earlier story";
}

/** The one status a story shows: "Sent", or "Sent · couldn't be investigated" when it was sent and then couldn't be looked into (two labels would argue). */
export function storyStatus(s: Pick<RadarStory, "status">, went: Went): { tone: "good" | "unusual" | "neutral"; label: string; dashed: boolean } {
  if (s.status === "sent") return went.kind === "failed" ? { tone: "unusual", label: "Sent · couldn't be investigated", dashed: false } : { tone: "good", label: "Sent", dashed: false };
  return s.status === "below" ? { tone: "neutral", label: "Held back", dashed: false } : { tone: "neutral", label: "Dismissed", dashed: true };
}

export const publishers = (n: number) => `${n} publisher${n === 1 ? "" : "s"}`;
/** The first place or two, then how many more: "Texas, Austin and 2 more". */
export function placeList(names: string[], cap = 2): string {
  return names.length > cap ? `${names.slice(0, cap).join(", ")} and ${names.length - cap} more` : names.join(", ");
}

/** When the story was last seen: "seen in 2 reads" (said only when it was seen more than once). */
export const seenIn = (runsSeen: number): string => (runsSeen > 1 ? `seen in ${runsSeen} reads` : "");

// ---------------------------------------------------------------- the funnel
export interface FunnelStat { n: number; label: string; big?: boolean }
/** The four numbers of a finished read (board 05). Nothing for a read that didn't count articles (running, failed, older). */
export function funnelOf(run: RadarRun | null | undefined): FunnelStat[] | null {
  if (!run || run.status === "running" || run.status === "failed" || run.considered == null) return null;
  return [
    { n: run.considered, label: "articles considered" },
    { n: run.shortlisted ?? 0, label: "about your places and names" },
    { n: run.stories ?? 0, label: "stories in this read" },
    { n: run.sent ?? 0, label: "sent to investigate", big: true },
  ];
}

/** The finished read the funnel shows: the last one, or the one before it while the last is still running. */
export function funnelRun(last: RadarRun | null | undefined, runs: RadarRun[] | null): RadarRun | null {
  if (last && last.status !== "running" && last.status !== "failed") return last;
  return (runs ?? []).find(r => r.status !== "running" && r.status !== "failed" && r.considered != null) ?? null;
}

// ---------------------------------------------------------------- the words of the header
/** "Reads the world's news once a day at 06:00 · last read today 06:15 · next read: tomorrow 06:00". `at` writes a moment as "today 06:15"; `next`
 *  writes the next read's time (it says "due now" when the time has passed). A read more than two periods old means the schedule isn't
 *  running (the server's next time is simply "now"): "next read: when updates resume", not a time that has gone by. */
export function ledeText(st: RadarStatus, schedule: string, at: (iso: string) => string, next: (iso: string) => string = at, now: Date = new Date()): string {
  const last = st.last_run;
  if (!st.connected) return last && last.status !== "running" ? `Radar isn't connected, so it isn't reading the news now · last read ${at(last.finished_at ?? last.created_at)}` : "Radar isn't reading the news yet.";
  const lastPart = !last ? "no read yet" : last.status === "running" ? "reading now"
    : last.status === "failed" ? `last read failed ${at(last.finished_at ?? last.created_at)}` : `last read ${at(last.finished_at ?? last.created_at)}`;
  const lastAt = last && last.status !== "running" ? new Date(last.finished_at ?? last.created_at).getTime() : null;
  const stalled = lastAt !== null && new Date(st.next_run_at).getTime() <= now.getTime() + 90_000 && now.getTime() - lastAt > 2 * st.every_minutes * 60_000;
  return `Reads the world's news ${schedule} · ${lastPart} · ${stalled ? "next read: when updates resume" : `next read: ${next(st.next_run_at)}`}`;
}

/** The "Check now" button's second part: "· 5 left today". */
export const leftToday = (left: number): string => `· ${left} left today`;

export interface CheckState {
  connected: boolean;
  budgetSpent: boolean;
  /** A read is going: the server says so, or this viewer started one. */
  running: boolean;
  left: number;
  limit: number;
  /** When the reading budget starts again, in the institution's zone ("tomorrow 05:30"). */
  budgetBack: string;
  /** "06:00" when Radar reads at a set time, else null. */
  runAt: string | null;
}
/** Why Check now can't be pressed, in a sentence; null when it can. */
export function cantCheck(c: CheckState): string | null {
  if (!c.connected) return "Radar isn't connected.";
  if (c.running) return "A read is in progress.";
  if (c.budgetSpent) return `Today's reading budget is spent. Radar reads again from ${c.budgetBack}.`;
  if (c.left <= 0) return `You've used today's ${c.limit} checks. They come back at midnight; ${c.runAt ? `the ${c.runAt} read` : "the scheduled read"} still runs.`;
  return null;
}

// ---------------------------------------------------------------- a read ends
/** The toast when a read ends (failed, or how many stories and how many went on). */
export function runDoneText(run: Pick<RadarRun, "status" | "stories" | "sent" | "error">): string {
  if (run.status === "failed") return `Radar's read failed. ${plainError(run.error)}`;
  const n = run.stories ?? 0, sent = run.sent ?? 0;
  if (n === 0) return "Radar read the news and found nothing for you.";
  return sent > 0 ? `Radar found ${plural(n, "story", "stories")} and sent ${sent} to investigate.` : `Radar found ${plural(n, "story", "stories")}; none needed an investigation.`;
}

export const WATCH_MAX = 10;
/** The stories a read sent whose findings are still on their way: ask about these (the newest few, one call each every 3 s).
 *  `since` is when the read started: a story seen before that was sent by an earlier read, and isn't this viewer's to wait for. */
export function toWatch(xs: RadarStory[], since: string, max = WATCH_MAX): string[] {
  return xs.filter(s => s.status === "sent" && !!s.finding_id && s.last_seen_at >= since && (s.finding_status === "new" || s.finding_status === "grouped"))
    .sort((a, b) => (a.last_seen_at < b.last_seen_at ? 1 : a.last_seen_at > b.last_seen_at ? -1 : 0))
    .slice(0, max).map(s => s.finding_id!);
}

/** The toast when the asking ends: how many of the findings joined an event. */
export function investigatedText(end: "done" | "timeout" | "cancelled", linked: number): string {
  if (end === "timeout") return "Still working; it will appear here.";
  if (end === "cancelled") return "";
  return linked > 0 ? `The investigation finished: ${linked === 1 ? "1 story joined an event" : `${linked} stories joined events`}.` : "The investigation finished. No new event.";
}

/** The refusal's heading, by the server's code (the detail under it is the server's own words). */
export function refusalTitle(code: unknown): string | undefined {
  switch (code) {
    case "budget_spent": return "Radar's budget for today is spent";
    case "run_now_limit": return "You've used today's checks";
    case "run_running": return "A read is already in progress";
    case "radar_not_connected": return "Radar isn't connected";
    case "already_sent": return "Already sent";
    default: return undefined;
  }
}

// ---------------------------------------------------------------- when the list is empty
export interface EmptyWords { title: string; text: string; /** Which filter would show something. */ clear?: "place" }
/** What an empty list says: no stories at all (connected or not), nothing in a tab, or nothing in a place. */
export function emptyCopy(tab: Tab, place: string, placeName: string, o: { any: boolean; connected: boolean; admin: boolean }): EmptyWords {
  if (!o.any) {
    return o.connected
      ? { title: "Nothing from Radar yet", text: "Radar hasn't found anything touching your places yet. Check now reads the news at once." }
      : { title: "Radar isn't reading the news yet", text: o.admin ? "Connect the Radar agent and it starts reading the news." : "Radar starts reading the news once your Platform Admin connects it." };
  }
  if (place) return { title: `No stories about ${placeName}`, text: tab === "all" ? "Radar found nothing about this place." : "Nothing in this group is about this place.", clear: "place" };
  return tab === "sent" ? { title: "Nothing sent to investigate", text: "Radar sends only the few its judge picks. The rest are held back, and you can still send them." }
    : tab === "below" ? { title: "Nothing held back", text: "Every story Radar kept was sent to investigate." }
    : { title: "Nothing dismissed", text: "A story you dismiss from held back waits here, and you can restore it." };
}
