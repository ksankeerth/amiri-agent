// The Studio's run page, in words: the day track, the chain's small print, the story words. Page-only helpers.
import type { SimEvent, TimelineItem, Tone } from "../../api/studio";

export interface DayMark { day: number; ran: boolean; event: boolean; headlines: boolean }

/** One mark per simulated day: run or not yet, a dark one when an event formed that day, a light one for headlines. */
export function trackDays(steps: number, step: number, timeline: Pick<TimelineItem, "kind" | "step">[]): DayMark[] {
  const on = (kind: string) => new Set(timeline.filter(t => t.kind === kind).map(t => t.step));
  const ev = on("event"), hd = on("headline");
  return Array.from({ length: Math.max(0, steps) }, (_, i) => ({ day: i + 1, ran: i + 1 <= step, event: ev.has(i + 1), headlines: hd.has(i + 1) }));
}

/** "6 from news · 7 from prices": where the findings came from (the market series' own are "prices"). */
export function findingsSplit(timeline: Pick<TimelineItem, "kind" | "data">[]): string {
  const f = timeline.filter(t => t.kind === "finding");
  if (!f.length) return "nothing unusual yet";
  const prices = f.filter(t => t.data.source === "timeseries").length, news = f.length - prices;
  return [news ? `${news} from news` : "", prices ? `${prices} from prices` : ""].filter(Boolean).join(" · ");
}

/** "2 bad for you" / "1 bad · 1 good for you": the events' tones in a few words. */
export function eventsSplit(events: Pick<SimEvent, "tone">[]): string {
  if (!events.length) return "none yet";
  const n = (t: Tone) => events.filter(e => e.tone === t).length;
  const parts = (["bad", "mixed", "good", "neutral"] as Tone[]).filter(t => n(t)).map(t => `${n(t)} ${t}`);
  return `${parts.join(" · ")} for you`;
}

/** An expected story's status word: found, not yet (the run goes on), or missed (the run has ended). */
export function storyWord(found: boolean, active: boolean): "Found" | "Not yet" | "Missed" {
  return found ? "Found" : active ? "Not yet" : "Missed";
}

/** How the run was made, for the one line of small print under the title. */
export function howRun(mode: string): string {
  return mode === "replay" ? "replaying a recording" : mode === "record" ? "recording the live agents" : "live agents";
}
