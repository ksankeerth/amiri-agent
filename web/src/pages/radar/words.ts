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

export const plainCount = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-GB");
