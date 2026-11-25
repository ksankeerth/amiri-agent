// The Studio's run page, in words: the day track and where the findings came from. Page-only helpers (the rest is in ./runWords.ts).
import type { TimelineItem } from "../../api/studio";

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
