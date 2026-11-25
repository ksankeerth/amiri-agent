// Radar's page-only helpers: times and wording.
import { TIME_ZONE, isToday } from "../../format";
import type { RadarStory } from "../../api/radar";

export const REL_WORD: Record<RadarStory["relevance"], string> = { high: "highly relevant", medium: "relevant", low: "slightly relevant" };

/** The zone as a person says it: "Asia/Colombo" → "Colombo". */
export const zoneName = (zone: string | null | undefined) =>
  !zone || zone === "UTC" ? "UTC" : zone.split("/").pop()!.replace(/_/g, " ");

/** "06:15" in the institution's time zone. */
export function clock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** "06:00 today", "06:00 tomorrow", otherwise "25 Nov 06:00" (the zone is said once, at the top of the page). */
export function nextAt(iso: string, now: Date): string {
  if (new Date(iso) <= now) return "due now";
  if (isToday(iso, now)) return `${clock(iso)} today`;
  if (isToday(iso, new Date(now.getTime() + 864e5))) return `${clock(iso)} tomorrow`;
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" }).format(new Date(iso))} ${clock(iso)}`;
}

/** When the reading budget resets, in the institution's zone (the server counts a day from midnight UTC). */
export function budgetResets(now: Date): string {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return clock(new Date(next).toISOString());
}
/** The same with the day, as the page says it: "tomorrow 18:00". */
export function budgetResetsAt(now: Date): string {
  return dayWord(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString(), now);
}

/** A moment as people say it, in the institution's zone: "today 06:15", "yesterday 06:15", "tomorrow 06:00", else "25 Nov 06:15". */
export function dayWord(iso: string, now: Date): string {
  const t = new Date(iso);
  if (isToday(iso, now)) return `today ${clock(iso)}`;
  if (isToday(iso, new Date(now.getTime() + 864e5))) return `tomorrow ${clock(iso)}`;
  if (isToday(iso, new Date(now.getTime() - 864e5))) return `yesterday ${clock(iso)}`;
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" }).format(t)} ${clock(iso)}`;
}
/** The same for a moment already past, or due: a time that has gone by says "due now" (the scheduler is late). */
export const nextWord = (iso: string, now: Date): string => (new Date(iso) <= now ? "due now" : dayWord(iso, now));

export const plainCount = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-GB");
