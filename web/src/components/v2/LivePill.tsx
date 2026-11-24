// The Live pill (sidebar, every page): the word says the state, the line says why. Five states, from what the
// Overview call already says (services.tick.ok, markets[].state, first_run) or from that call failing. It is a
// role="status" region, so a change from Live to Paused is announced (A9).
import { ago } from "../../format";
import type { Overview } from "../../api/overview";

export type LiveTone = "live" | "late" | "idle" | "down";
export interface LiveState { tone: LiveTone; word: string; why: string }

/** Green only when updates run and prices are fresh. `down`: the Overview request failed (no answer, or a 5xx). */
export function liveState(o: Overview | null, now: Date, down: boolean): LiveState | null {
  if (down) return { tone: "down", word: "No answer", why: "trying again every minute" };
  if (!o) return null;
  if (o.first_run || !o.services) return { tone: "idle", word: "Not watching yet", why: "set up an institution" };
  const t = o.services.tick;
  if (!t.ok) return { tone: "idle", word: "Paused", why: t.last_at ? `updates last ran ${ago(t.last_at, now)}` : "updates haven't run yet" };
  const late = (o.markets ?? []).filter(m => m.state === "stale");
  if (late.length) {
    const since = late[0].state_reason?.match(/since (.+?) \(/)?.[1];  // "No new bar since 09:00 (…)"
    const who = late.length === 1 ? late[0].name : `${late[0].name} and ${late.length - 1} more`;
    return { tone: "late", word: "Prices late", why: since ? `${who} since ${since}` : `${who} hasn't updated` };
  }
  return { tone: "live", word: "Live", why: `updates ran ${t.last_at ? ago(t.last_at, now) : "recently"}` };
}

/** `compact` (phone top bar): the dot and the word; the line stays for screen readers and as the tooltip. */
export function LivePill({ live, compact }: { live: LiveState | null; compact?: boolean }) {
  const tone = live?.tone ?? "wait";
  return (
    <div className={`v2-live is-${tone}${compact ? " is-compact" : ""}`} role="status" title={compact && live ? `${live.word}: ${live.why}` : undefined}>
      <span className="v2-live__dot" aria-hidden="true" />
      <span className="v2-live__t">
        {live ? <><b>{live.word}</b> <span className="v2-live__why">{live.why}</span></> : <span className="v2-live__why">checking updates</span>}
      </span>
    </div>
  );
}
