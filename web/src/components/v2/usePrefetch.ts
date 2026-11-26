// Warm the cache before a click (F4): when the pointer rests on a link for 100 ms, or a link gets keyboard focus, the page it leads to
// asks for its first answers now; the click then finds them waiting. Reads only; nothing at all on a metered connection.
import { useEffect } from "react";
import { api, asksAhead } from "../../api/client";
import { prefetchPlan, type PlanCtx } from "../../api/prefetchPlan";

export const INTENT_MS = 100;

/** True when the person (or the connection) wants less data: Save-Data on, or a slow connection. */
function thrifty(): boolean {
  const c = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!c && (c.saveData === true || c.effectiveType === "slow-2g" || c.effectiveType === "2g");
}

/** Ask for what the page at `to` opens with. Safe to call often: an answer from the last 10 s, or one on its way, isn't asked for twice. */
export function prefetchRoute(to: string, ctx: PlanCtx): void {
  if (thrifty() || document.hidden || navigator.onLine === false) return;
  for (const url of prefetchPlan(to, ctx)) asksAhead(() => api<unknown>(url)).catch(() => { /* the page asks again when it opens */ });
}

/** Any link in the app, wherever it is (menu, breadcrumbs, a row, Go to's own list): found by event delegation, so no link needs wiring. */
export function usePrefetchOnIntent(ctx: PlanCtx): void {
  const { admin, institutionId } = ctx;
  useEffect(() => {
    let timer = 0, target = "";
    const stop = () => { clearTimeout(timer); target = ""; };
    const start = (from: EventTarget | null) => {
      const a = (from as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.origin !== location.origin) return;
      const to = a.pathname + a.search;
      if (to === target) return;
      stop(); target = to;
      if (a.pathname === location.pathname) return;  // the page you are on: nothing to warm
      timer = window.setTimeout(() => prefetchRoute(to, { admin, institutionId }), INTENT_MS);
    };
    const over = (e: PointerEvent) => { if (e.pointerType === "mouse") start(e.target); };
    const focus = (e: FocusEvent) => start(e.target);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", stop);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", stop);
    return () => {
      stop();
      document.removeEventListener("pointerover", over); document.removeEventListener("pointerout", stop);
      document.removeEventListener("focusin", focus); document.removeEventListener("focusout", stop);
    };
  }, [admin, institutionId]);
}
