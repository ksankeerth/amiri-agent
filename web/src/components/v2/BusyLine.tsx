// The thin progress line at the top of `main` (F4): shown while the page is asking the server for something the person is waiting for
// (a page opened from what it showed last time, refreshing; a first load shows it over the skeleton). Not for passive refreshes.
// Indeterminate, so no value; under reduced motion it holds still.
import { useEffect, useState, useSyncExternalStore } from "react";
import { subscribeWaiting, waitingCount } from "../../api/client";
import { usePresence } from "./useMotion";
import { WAIT_LINE_MS } from "./routeMotion";

/** Wait this long before drawing it, so an answer that comes straight back shows nothing (the same 150 ms as the wait before a page change). */
export const BUSY_AFTER_MS = WAIT_LINE_MS;

export function BusyLine() {
  const n = useSyncExternalStore(subscribeWaiting, waitingCount, () => 0);
  const waiting = n > 0;
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!waiting) { setOn(false); return; }
    const t = setTimeout(() => setOn(true), BUSY_AFTER_MS);
    return () => clearTimeout(t);
  }, [waiting]);
  const { mounted, leaving } = usePresence(on);
  if (!mounted) return null;
  return <div className={`v2-busy${leaving ? " is-leaving" : ""}`} role="progressbar" aria-label="Refreshing this page"><span aria-hidden="true" /></div>;
}
