// Monitors, in words: how often, and whether a check is late. Page-only helpers.
import type { MonitorRow } from "../../api/monitors";

/** "every hour", "every 6 hours", "once a day", "every 15 minutes": mid-sentence, so lower case. */
export function everyWords(min: number): string {
  if (min === 1440) return "once a day";
  if (min === 60) return "every hour";
  if (min % 60 === 0) return `every ${min / 60} hours`;
  return `every ${min} minutes`;
}

/** A live monitor whose last check is older than twice its frequency is overdue (the scheduler isn't keeping up). */
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
