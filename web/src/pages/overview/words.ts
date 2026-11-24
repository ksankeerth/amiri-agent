// Plain logic for the Overview (board 00 and board 15 section A): the greeting, which of the headlines to show, short
// times, the prices worth a row, a finding's status word. No React and no imports of app code, so `node --test` runs it.

const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : many ?? one + "s"}`;

// ---------------------------------------------------------------- greeting
/** "Good morning, John · Wednesday 25 November" (shown in capitals), in the institution's time zone. */
export function greetingText(now: Date, timeZone: string, name: string): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  }
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === t)?.value ?? "";
  const hour = Number(p("hour"));
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return `Good ${part}${name ? `, ${name}` : ""} · ${p("weekday")} ${p("day")} ${p("month")}`;
}

// ---------------------------------------------------------------- the headline (board 15 section A)
export type HeadlineKind = "alerts" | "quiet" | "clear" | "stopped";
export interface HeadlineIn {
  /** counts.alerts_to_review */
  alerts: number;
  /** events.length */
  events: number;
  /** services.tick.ok */
  tickOk: boolean;
}
/** The headline answers "does anything need my teams?": alerts to review; no alerts but events open; nothing open
 *  (all clear, or "nothing open" when updates stopped, so quiet doesn't mean safe). */
export function headlineKind(i: HeadlineIn): HeadlineKind {
  if (i.alerts > 0) return "alerts";
  if (i.events > 0) return "quiet";
  return i.tickOk ? "clear" : "stopped";
}
/** The hero's two lines: `hot` is the red part ("3 alerts"), `rest` the rest ("need your teams"). */
export function headlineText(kind: HeadlineKind, alerts: number): { hot?: string; rest: string } {
  switch (kind) {
    case "alerts": return { hot: plural(alerts, "alert"), rest: alerts === 1 ? "needs your teams" : "need your teams" };
    case "quiet": return { rest: "No alerts for your teams" };
    case "clear": return { rest: "All clear" };
    case "stopped": return { rest: "Nothing open right now" };
  }
}

// ---------------------------------------------------------------- times
/** "just now", "12 min ago", "2 h ago", "yesterday", "3 days ago" (the open events' age column). */
export function ageText(iso: string | null | undefined, now: Date): string {
  if (!iso) return "";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 2) return "yesterday";
  return `${Math.floor(s / 86400)} days ago`;
}

// ---------------------------------------------------------------- the stat tiles
/** "7 monitors · 22 prices · Radar": what is being watched. */
export function watchingMeta(monitors: number, prices: number, radar: boolean): string {
  return [plural(monitors, "monitor"), plural(prices, "price"), ...(radar ? ["Radar"] : [])].join(" · ");
}
/** "9 monitors · 3 prices · 6 Radar": where the last day's findings came from (nothing found: "nothing new"). */
export function foundMeta(f: { monitor: number; timeseries: number; radar: number }): string {
  if (f.monitor + f.timeseries + f.radar === 0) return "nothing new";
  return [plural(f.monitor, "monitor"), plural(f.timeseries, "price"), `${f.radar} Radar`].join(" · ");
}
/** "open events · 14 effects to watch" (the number is the tile's big figure). */
export function tracedMeta(events: number, effects: number): string {
  return `${events === 1 ? "open event" : "open events"} · ${plural(effects, "effect")} to watch`;
}
/** "alerts for 2 teams"; without the team count (the call failed): "alerts to review"; none: "all caught up". */
export function actMeta(alerts: number, teams: number | null): string {
  if (alerts === 0) return "all caught up";
  const noun = alerts === 1 ? "alert" : "alerts";
  return teams && teams > 0 ? `${noun} for ${plural(teams, "team")}` : `${noun} to review`;
}

// ---------------------------------------------------------------- an event's row
/** "5 effects", "1 effect", "No effects yet". */
export function effectsText(n: number): string { return n === 0 ? "No effects yet" : plural(n, "effect"); }
/** The line under an event's effect rows: "+2 more effects · 3 later findings joined" (empty when there is neither). */
export function moreLine(effects: number, shown: number, developments: number): string {
  const more = Math.max(0, effects - shown);
  return [more > 0 && `+${plural(more, "more effect")}`, developments > 0 && `${plural(developments, "later finding")} joined`]
    .filter(Boolean).join(" · ");
}
/** The word read for an arrow: ↑ rises, ↓ falls. */
export function arrowOf(direction: string | null | undefined): { glyph: string; word: string } | null {
  if (direction === "rise") return { glyph: "↑", word: "rises" };
  if (direction === "fall") return { glyph: "↓", word: "falls" };
  return null;
}
/** Up to `max` place names: "Persian Gulf, Iran and 2 more". */
export function placesText(names: string[], max = 1): string {
  const uniq = [...new Set(names.filter(Boolean))];
  if (uniq.length <= max) return uniq.join(", ");
  return `${uniq.slice(0, max).join(", ")} +${uniq.length - max}`;
}

// ---------------------------------------------------------------- the map
const RANK: Record<string, number> = { bad: 0, mixed: 1, good: 2 };
export interface MapEvent { tone: string; places: string[] }
/** One mark per place: the worst tone of the events that touch it. Neutral events have no ▲◆▼, so they add none. */
export function mapMarks(events: MapEvent[]): { code: string; tone: "bad" | "mixed" | "good"; first: boolean }[] {
  const worst = new Map<string, "bad" | "mixed" | "good">();
  let firstCode: string | null = null;
  for (const e of events) {
    if (!(e.tone in RANK)) continue;
    for (const code of e.places) {
      const t = e.tone as "bad" | "mixed" | "good";
      const cur = worst.get(code);
      if (!cur || RANK[t] < RANK[cur]) worst.set(code, t);
      if (firstCode === null) firstCode = code;
    }
  }
  return [...worst].map(([code, tone]) => ({ code, tone, first: code === firstCode }));
}

// ---------------------------------------------------------------- findings and radar rows
export type PillKind = "good" | "unusual" | "neutral";
const SOURCE: Record<string, string> = { monitor: "Monitor", timeseries: "Price", radar: "Radar" };
export const sourceWord = (s: string): string => SOURCE[s] ?? s;
/** A finding's status as a short pill: "In an event" (good), "Being investigated", "No impact found". */
export function findingPill(f: { status: string; event_id: string | null; reason: string | null }): { word: string; tone: PillKind } {
  if (f.event_id || f.status === "linked") return { word: "In an event", tone: "good" };
  if (f.status === "set_aside") return f.reason === "investigation_failed" ? { word: "Couldn't investigate", tone: "unusual" } : { word: "No impact found", tone: "neutral" };
  if (f.status === "grouped") return { word: "Being investigated", tone: "neutral" };
  if (f.status === "new") return { word: "Waiting", tone: "neutral" };
  return { word: f.status, tone: "neutral" };
}
/** A Radar story's status as a pill. */
export function storyPill(r: { status: string; event_id: string | null }): { word: string; tone: PillKind } {
  if (r.status === "sent") return r.event_id ? { word: "In an event", tone: "good" } : { word: "Being investigated", tone: "neutral" };
  if (r.status === "below") return { word: "Not sent this run", tone: "neutral" };
  return { word: "Dismissed", tone: "neutral" };
}

// ---------------------------------------------------------------- prices
export interface PriceIn { series_id: string; name: string; state: string; state_reason: string | null; close: number | null; change_1d_pct: number | null; spark: number[] }
/** "09:00" or "10 Nov 12:30" from the server's note "No new bar since 09:00 (…)"; null when the note says nothing. */
export function lateSince(reason: string | null | undefined): string | null {
  return reason?.match(/since (.+?)(?: \(|\.|$)/)?.[1]?.trim() ?? null;
}
/** The prices that earn a row: unusual moves first, then late ones, then (when nothing is out of the ordinary) the
 *  biggest movers, so the box is never empty. `unusual` counts the moved ones. */
export function priceRows<T extends PriceIn>(markets: T[], max = 4): { shown: T[]; unusual: number; late: number; others: number; othersNormal: boolean } {
  const moved = markets.filter(m => m.state === "moved");
  const late = markets.filter(m => m.state === "stale");
  const odd = [...moved, ...late];
  let shown = odd.slice(0, max);
  if (!odd.length) {
    shown = markets.filter(m => m.change_1d_pct != null)
      .sort((a, b) => Math.abs(b.change_1d_pct!) - Math.abs(a.change_1d_pct!)).slice(0, Math.min(3, max));
  }
  const others = markets.length - shown.length;
  return { shown, unusual: moved.length, late: late.length, others, othersNormal: odd.length <= shown.length };
}

// ---------------------------------------------------------------- needs you
export type NeedLevel = "crit" | "warn" | "info";
/** What a "Needs you" row's button says: a decision is "Review", anything else "Open". */
export function needAction(kind: string): string {
  return kind === "approval" || kind === "proposal" || kind === "review" || kind === "alerts" ? "Review" : "Open";
}
/** Read before a row's title, since its dot is colour only. */
export function needLevelWord(level: string): string {
  return level === "crit" ? "Urgent: " : level === "warn" ? "Needs attention: " : "";
}
/** A server note in plain words where it uses series wording ("No new bar since …"). */
export const plainNote = (t: string): string => t.replace(/^(.+?): No new bar since (.+?) \(.*\)\.?$/, "$1: prices haven't updated since $2");

/** The line under the prices: "18 others normal", "1 other normal", "3 more" (when some odd ones didn't fit), then all series. */
export function othersText(others: number, normal: boolean): string {
  return others <= 0 ? "" : normal ? `${others} ${others === 1 ? "other" : "others"} normal` : `${others} more`;
}
