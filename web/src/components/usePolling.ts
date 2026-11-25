import { useEffect, useRef } from "react";

/** A passive refresh for a page: every `ms` (never faster than 30 s, so many viewers at once stay light), only while the
 *  tab is visible, and one catch-up when the tab comes back after being away longer than that. The first load is the
 *  page's own; this only keeps it fresh. */
export function usePolling(load: () => void, ms: number) {
  const every = Math.max(ms, 30_000);
  const last = useRef(Date.now());
  useEffect(() => {
    last.current = Date.now();
    const run = () => { last.current = Date.now(); load(); };
    const t = setInterval(() => { if (!document.hidden) run(); }, every);
    const back = () => { if (!document.hidden && Date.now() - last.current > every) run(); };
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [load, every]);
}
