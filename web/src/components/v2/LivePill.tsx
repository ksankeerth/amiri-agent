// The Live pill (sidebar, every page). The words are in liveWords.ts. It is a role="status" region, so a change from Live to
// Updates delayed is announced (A9).
import type { LiveState } from "./liveWords";
export { liveState, type LiveState, type LiveTone } from "./liveWords";

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
