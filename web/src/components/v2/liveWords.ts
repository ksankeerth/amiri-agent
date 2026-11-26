// The Live pill's words (sidebar, every page): the word says the state, the line says why. Five states, from what the Overview call
// already says (services.tick.ok, markets[].state, first_run) or from that call failing. Plain logic, so `npm test` covers it.
import { ago } from "../../format.ts";
import type { Overview } from "../../api/overview.ts";

export type LiveTone = "live" | "late" | "idle" | "down";
export interface LiveState { tone: LiveTone; word: string; why: string }

/** Past this many minutes without an update, the pill says "delayed" rather than "a little late". */
export const DELAYED_AFTER_MIN = 60;

/** Green only when updates run and prices are fresh. `down`: the Overview request failed (no answer, or a 5xx).
 *  The server never says the work is paused (services.tick has only last_at, minutes_ago and ok), so a tick that has not run is
 *  "Updates delayed" with when it last ran: a fact, not a state we made up. */
export function liveState(o: Overview | null, now: Date, down: boolean): LiveState | null {
  if (down) return { tone: "down", word: "No answer", why: "trying again every minute" };
  if (!o) return null;
  if (o.first_run || !o.services) return { tone: "idle", word: "Not watching yet", why: "set up an institution" };
  const t = o.services.tick;
  if (!t.ok) {
    if (!t.last_at) return { tone: "idle", word: "Waiting for first update", why: "updates haven't run yet" };
    const mins = t.minutes_ago ?? Math.round((now.getTime() - new Date(t.last_at).getTime()) / 60_000);
    return { tone: "idle", word: mins > DELAYED_AFTER_MIN ? "Updates delayed" : "Updates a little late", why: `last ran ${ago(t.last_at, now)}` };
  }
  const late = (o.markets ?? []).filter(m => m.state === "stale");
  if (late.length) {
    const since = late[0].state_reason?.match(/since (.+?) \(/)?.[1];  // "No new bar since 09:00 (…)"
    const who = late.length === 1 ? late[0].name : `${late[0].name} and ${late.length - 1} more`;
    return { tone: "late", word: "Waiting for prices", why: since ? `${who}: no new price since ${since}` : `${who}: no new price lately` };
  }
  return { tone: "live", word: "Live", why: `updates ran ${t.last_at ? ago(t.last_at, now) : "recently"}` };
}
