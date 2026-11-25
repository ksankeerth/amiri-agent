// The run page's words and rules (board 10; states: board 15 B). Pure functions, so `npm test` covers them: how far the page
// carries on by itself, what the status line says, the expected-vs-found rows, the timeline, the price line, how a run ended.
// The older helpers (the day track, where findings came from) stay in ./words.ts.
import type { Simulation, TimelineItem, Tone } from "../../api/studio.ts";
import { plural } from "../../format.ts";
import { cap, eventTitle, words } from "../../plain.ts";

export const isActive = (status: string): boolean => status === "running" || status === "waiting";

// ---------------------------------------------------------------- carrying on by itself
/** A day takes more than one ask when agents are out: the page asks again until the day moves (or, to play on, to the end). */
export const RUNNING_MS = 1200, WAITING_MS = 2500, REFRESH_MS = 30_000;  // a viewer who isn't driving the run: passive, so no faster than every 30 s
export interface Drive { until: number }
/** Next day: one day on from where the run is. Play: to the end. */
export const driveNext = (step: number): Drive => ({ until: step + 1 });
export const drivePlay = (): Drive => ({ until: Infinity });
/** Whether the page has done what it was asked: the clock reached the day, or the run ended. */
export const driveDone = (d: Drive, sim: { step: number; status: string }): boolean => !isActive(sim.status) || sim.step >= d.until;
/** How long to wait before asking again: quickly when nothing is out, calmly while the agents work. */
export const driveDelay = (status: string): number => (status === "waiting" ? WAITING_MS : RUNNING_MS);

// ---------------------------------------------------------------- the status line
/** "investigating 2 findings, 12 s so far": what the agents are doing now (null when nothing is out). */
export function workingText(pending: Simulation["pending"], timeline: Pick<TimelineItem, "kind" | "step" | "data">[]): string | null {
  if (!pending.length) return null;
  const parts = pending.map(p => {
    if (p.kind === "check") return `reading the day's headlines, ${p.seconds} s so far`;
    const row = [...timeline].reverse().find(t => t.kind === "investigation" && t.step === p.step && t.data.status === "started");
    const n = typeof row?.data.findings === "number" ? row.data.findings : null;
    return `${n != null ? `investigating ${plural(n, "finding")}` : "investigating"}, ${p.seconds} s so far`;
  });
  return parts.join(" and ");
}

/** What the screen-reader line says: the day and what the run is waiting for, never the seconds (so it speaks when something changes). */
export function liveText(sim: Pick<Simulation, "status" | "step" | "steps" | "pending">, found: number, expected: number): string {
  const day = `Day ${sim.step} of ${sim.steps}.`;
  switch (sim.status) {
    case "finished": return `Finished. ${expected ? `${found} of ${expected} expected stories found.` : "The run is over."}`;
    case "stopped": return `Stopped on day ${sim.step} of ${sim.steps}.`;
    case "failed": return `Stopped by an error on day ${sim.step} of ${sim.steps}.`;
    default: {
      const out = [...new Set(sim.pending.map(p => (p.kind === "check" ? "the monitor agent" : "the investigation agent")))];
      return out.length ? `${day} Waiting for ${out.join(" and ")}.` : day;
    }
  }
}

/** The pill beside the title: how the run is going, and how it was made. */
export function statusPill(sim: Pick<Simulation, "status" | "step" | "steps" | "mode">): { tone: "good" | "unusual" | "bad" | "neutral"; mark: string; text: string } {
  const how = howRunShort(sim.mode), at = `day ${sim.step} of ${sim.steps}`;
  switch (sim.status) {
    case "running": return { tone: "good", mark: "●", text: `Running · ${how}` };
    case "waiting": return { tone: "unusual", mark: "…", text: "Waiting on the agents" };
    case "finished": return { tone: "good", mark: "✓", text: `Finished · ${sim.steps} of ${sim.steps} days` };
    case "stopped": return { tone: "neutral", mark: "■", text: `Stopped early · ${at}` };
    default: return { tone: "bad", mark: "!", text: `Stopped by an error · ${at}` };
  }
}
const howRunShort = (mode: string) => (mode === "replay" ? "replaying a recording" : "live agents");

/** The note beside the pills for a run that is being recorded. */
export const recordingLine = (mode: string, active: boolean): string | null => (mode === "record" && active ? "Recording this run" : null);

// ---------------------------------------------------------------- expected vs found
export type StoryState = "found" | "not_yet" | "not_found" | "unexpected";
export interface StoryRow { key: string; state: StoryState; tone: Tone; label: string; eventId: string | null; eventTitle: string | null; note: string | null }
export interface HeadlineDay { story: string; day: number }

/** When a story's headlines come: the next one still to arrive, and whether one has already. */
export function headlineTiming(plan: HeadlineDay[] | null, key: string, step: number): { next: number | null; arrived: boolean } | null {
  if (!plan) return null;
  const days = plan.filter(h => h.story === key).map(h => h.day);
  return { next: days.filter(d => d > step).sort((a, b) => a - b)[0] ?? null, arrived: days.some(d => d <= step) };
}

/** The expected stories as rows (found, not yet or not found), then what turned up that nobody expected. */
export function storyRows(summary: Simulation["summary"], active: boolean, step: number, plan: HeadlineDay[] | null, evName: (id: string, title: string) => string): StoryRow[] {
  const rows: StoryRow[] = [];
  for (const s of summary.stories) {
    if (s.found && s.event_id) {
      const name = evName(s.event_id, s.event_title ?? s.label);
      rows.push({ key: s.key, state: s.expected ? "found" : "unexpected", tone: s.found_tone ?? s.tone, label: s.expected ? s.label : name, eventId: s.event_id, eventTitle: name, note: s.expected ? null : "Not one of the stories this scenario expects" });
      continue;
    }
    if (!s.expected) continue;
    const t = headlineTiming(plan, s.key, step);
    const note = !active ? "Nothing in this run was traced to it"
      : t?.next != null ? `Its headline comes on day ${t.next}`
      : t?.arrived ? "Its headline is in; waiting for the investigation to trace it"
      : "Not traced to an event yet";
    rows.push({ key: s.key, state: active ? "not_yet" : "not_found", tone: s.tone, label: s.label, eventId: null, eventTitle: null, note });
  }
  for (const e of summary.other_events) {
    rows.push({ key: e.event_id, state: "unexpected", tone: e.tone, label: evName(e.event_id, e.title), eventId: e.event_id, eventTitle: evName(e.event_id, e.title), note: "Not one of the stories this scenario expects" });
  }
  return rows;
}
/** "3 of 4 so far" / "3 of 4 found": expected stories found. */
export function foundCount(rows: Pick<StoryRow, "state">[]): { found: number; expected: number } {
  const expected = rows.filter(r => r.state !== "unexpected").length;
  return { found: rows.filter(r => r.state === "found").length, expected };
}
export const STORY_WORD: Record<StoryState, { mark: string; word: string; tone: "good" | "neutral" | "unusual" | "sim" }> = {
  found: { mark: "✓", word: "Found", tone: "good" },
  not_yet: { mark: "…", word: "Not yet", tone: "neutral" },
  not_found: { mark: "✕", word: "Not found", tone: "unusual" },
  unexpected: { mark: "+", word: "Unexpected", tone: "neutral" },
};

/** "Findings: 7 of at least 4 expected from news ✓ · 2 of at least 1 from prices ✓". */
export function findingsLine(findings: Simulation["summary"]["findings"], active: boolean): string | null {
  const parts = Object.entries(findings).filter(([, v]) => v.expected > 0).map(([k, v]) => {
    const src = k === "timeseries" ? "prices" : k === "monitor" ? "news" : words(k);
    const ok = v.found >= v.expected;
    return `${v.found} of at least ${v.expected} expected from ${src}${ok ? " ✓" : active ? " (so far)" : " ✕"}`;
  });
  return parts.length ? `Findings: ${parts.join(" · ")}` : null;
}

/** "all bad for you", "1 bad · 1 good for you", "none yet". */
export function eventsSplit(events: { tone: Tone }[]): string {
  if (!events.length) return "none yet";
  const tones = (["bad", "mixed", "good", "neutral"] as Tone[]).filter(t => events.some(e => e.tone === t));
  const n = (t: Tone) => events.filter(e => e.tone === t).length;
  if (tones.length === 1) {
    const t = tones[0], word = t === "bad" ? "bad for you" : t === "good" ? "good for you" : t;
    return events.length === 1 ? word : `all ${word}`;
  }
  return `${tones.map(t => `${n(t)} ${t}`).join(" · ")} for you`;
}

// ---------------------------------------------------------------- alerts it would raise
export interface EffectLine { product: string; metric: string; arrow: "↑" | "↓" | "→"; word: string; size: string | null; when: string | null }
const WHEN: Record<string, string> = { days: "within days", weeks: "within weeks", months: "within months" };
/** The effects of one alert, once each (a product can come up for several findings). */
export function effectLines(effects: Simulation["alerts"][number]["effects"]): EffectLine[] {
  const seen = new Set<string>(), out: EffectLine[] = [];
  for (const x of effects) {
    const k = `${x.product}|${x.metric_name}|${x.direction}|${x.size}|${x.timing}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const rise = x.direction === "rise", fall = x.direction === "fall";
    out.push({ product: x.product, metric: x.metric_name, arrow: rise ? "↑" : fall ? "↓" : "→", word: rise ? "expected to rise" : fall ? "expected to fall" : "expected to move",
      size: x.size ? x.size.toLowerCase() : null, when: x.timing ? WHEN[x.timing] ?? `within ${x.timing}` : null });
  }
  return out;
}
/** The distinct teams alerted, for the tile's small line. */
export const teamsOf = (alerts: { owner: string }[]): string[] => [...new Set(alerts.map(a => a.owner))];

// ---------------------------------------------------------------- the timeline
export interface TimeRow {
  seq: number; day: number; at: string; label: string; text: string;
  /** an event that formed: its page, and how it reads for you ("bad for you") */
  eventId?: string; tone?: Tone; note?: string;
  /** one of the story's own moments (the rest are the agents' steps) */
  story: boolean;
}
const TONE_WORDS: Record<Tone, string> = { bad: "bad for you", good: "good for you", mixed: "mixed", neutral: "neutral" };
export const toneWords = (t: Tone): string => TONE_WORDS[t] ?? "neutral";

/** A row of the story: the headlines, the findings, an event forming, an investigation starting, or anything that went wrong. */
export function isStory(t: Pick<TimelineItem, "kind" | "data">): boolean {
  if (t.kind === "headline" || t.kind === "finding" || t.kind === "event") return true;
  if (t.kind === "investigation") return t.data.status === "started" || !!t.data.error;
  return t.kind === "check" && !!t.data.error;
}

/** One timeline item as a labelled line (a person's words, never a code). */
export function timeRow(t: TimelineItem): TimeRow {
  const d = t.data;
  const base = { seq: t.seq, day: t.step, at: t.at, story: isStory(t) };
  switch (t.kind) {
    case "headline": return { ...base, label: "Headline", text: String(d.title ?? "") };
    case "price": return { ...base, label: "Flagged move", text: `Unusual move: ${Math.abs(d.z).toFixed(1)}× a typical day (${d.change_pct >= 0 ? "+" : ""}${d.change_pct}% since the start)` };
    case "finding": return { ...base, label: `Finding · ${d.source === "timeseries" ? "prices" : "news"}`, text: String(d.title ?? "") };
    case "event": {
      const tone = (d.tone ?? "neutral") as Tone;
      return { ...base, label: "Event formed", text: eventTitle({ title: d.title, themes: d.themes }), note: toneWords(tone), eventId: t.ref ?? undefined, tone };
    }
    case "check": return { ...base, label: "Monitor check", text: d.status === "started" ? `Reading ${plural(d.headlines ?? 0, "headline")}` : stepEnd(d) };
    case "investigation": return { ...base, label: "Investigation", text: d.status === "started" ? `Investigating ${plural(d.findings ?? 0, "finding")}` : stepEnd(d) };
    case "development": return { ...base, label: "Joined an event", text: String(d.reason ?? "") };
    default: return { ...base, label: "Note", text: String(d.text ?? "") };
  }
}
/** How an agent's step ended, in words: "Finished · 2 findings", "Didn't finish: …". */
function stepEnd(d: Record<string, any>): string {
  if (d.error) return `Didn't finish: ${d.error}`;
  const n = typeof d.findings === "number" && d.findings ? ` · ${plural(d.findings, "finding")}` : "";
  return d.status === "completed" ? `Finished${n}` : `${cap(words(String(d.status ?? "ended")))}${n}`;
}

/** The time of day in the institution's zone, "09:00". */
export function timeOfDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}
/** The simulated clock with its year: "Sat 13 Feb 2027, 18:00". */
export function clockWithYear(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  const p = (t: Intl.DateTimeFormatPartTypes) => parts.find(x => x.type === t)?.value ?? "";
  return `${p("weekday")} ${p("day")} ${p("month")} ${p("year")}, ${p("hour")}:${p("minute")}`;
}

/** The newest days stay open; the earlier ones fold under "Days 1–3". `rows` are newest first. */
export function foldDays<T extends { day: number }>(rows: T[], recent = 3): { shown: T[]; earlier: T[]; range: string | null } {
  const days = [...new Set(rows.map(r => r.day))].sort((a, b) => b - a);
  const keep = new Set(days.slice(0, recent));
  const earlier = rows.filter(r => !keep.has(r.day));
  const old = days.slice(recent).sort((a, b) => a - b);
  const range = !old.length ? null : old.length === 1 ? `Day ${old[0]}` : `Days ${old[0]}–${old[old.length - 1]}`;
  return { shown: rows.filter(r => keep.has(r.day)), earlier, range };
}

// ---------------------------------------------------------------- the price
/** The price's name: a pair ("USD/LKR") as it is, otherwise the scenario's name for it. */
export function priceName(symbol: string, name?: string | null): string {
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)) return symbol;
  return name?.trim() || "The simulated price";
}
/** "From 38.20 to 52.10 (+36%) over 9 days", for those who can't see the line. */
export function priceSummary(bars: { close: number }[], days: number): string | null {
  if (bars.length < 2) return null;
  const a = bars[0].close, z = bars[bars.length - 1].close, pct = a ? ((z - a) / a) * 100 : 0;
  const f = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2));
  return `From ${f(a)} to ${f(z)} (${pct >= 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%) over ${plural(days, "day")}`;
}

// ---------------------------------------------------------------- how it ended
/** What a stopped or failed run says, in a sentence or two: the cause (the server's error, in words) and what is kept. */
export function endedText(sim: Pick<Simulation, "status" | "step" | "steps" | "error">, plainErr: (e: string | null) => string): { title: string; body: string } {
  const kept = `What it found up to day ${sim.step} is kept below.`;
  if (sim.status === "failed") return { title: plainErr(sim.error), body: `${kept} The recording isn't complete, so Replay is off for this version until it is recorded again.` };
  return { title: `This run was stopped on day ${sim.step} of ${sim.steps}`, body: `Its clock won't move again. ${kept}` };
}
/** The end of a finished run in one line: "3 events · 2 alerts it would raise · recorded for instant replay". */
export function finishedLine(events: number, alerts: number, replayReady: boolean): string {
  return [plural(events, "event"), `${plural(alerts, "alert")} it would raise`, replayReady ? "recorded for instant replay" : "not recorded"].join(" · ");
}
/** The mode a "Run again" starts: a recording is made again, a replay replays, anything else runs live. null: nothing to run again (use Replay). */
export function againMode(mode: string): "record" | "live" | null { return mode === "record" ? "record" : mode === "replay" ? null : "live"; }
