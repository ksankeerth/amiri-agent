// Where a page is drawn (F4, F4b). It decides these things when the address changes:
//  1. Another page ("fade through"): the old page stays on screen while the new page's first answers are asked for (the same list
//     the hover prefetch uses, joining any ask already on its way), for at most WAIT_MAX_MS (250 ms; the progress line shows if it
//     takes over 150). Then, in one step, the page is swapped: with the browser's View Transitions the old page fades out (160 ms)
//     and the new one fades in with a 6 px rise (300 ms, starting at 120 ms), so the two barely overlap; the breadcrumbs fade with
//     it (they belong to the page on screen, not to the address). Without View Transitions the new page's content gets the same
//     fade-in; with reduced motion there is no animation at all, but the wait stays (it only prevents a flash of placeholders).
//     A second click during the wait wins: the first wait is dropped.
//  2. Where `main` is scrolled: a new page starts at the top; Back returns to where that page was left (kept per history entry, in
//     sessionStorage); a filter or a picked row on the same page leaves it alone. It is set while the new page is drawn, before
//     the browser takes the new picture, so nothing jumps after the fade.
//  3. An item the person went to (a Go to result): scroll to it, smoothly, and tint it for 1.2 s.
//  4. A placeholder that is replaced by content fades the content in (contentIn.ts); nothing else on the page is animated.
// The same page changing (a list row, a tab, another event) is not a page change: it is drawn at once, and the pane fades its own content.
import { flushSync } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigationType, type Location } from "react-router-dom";
import { holdWaiting, waitingCount, warm } from "../../api/client";
import { prefetchPlan } from "../../api/prefetchPlan";
import { useRole } from "../ui";
import { quiet, watchContentIn } from "./contentIn";
import { prefersReducedMotion } from "./motion";
import { canReach, FOUND_MS, fadesBetween, foundOf, LatestWait, ScrollMemory, scrollPlan, setDrawnPath, WAIT_MAX_MS } from "./routeMotion";

const STORE = "amiri.scroll";
const memory = (() => {
  try { return ScrollMemory.from(JSON.parse(sessionStorage.getItem(STORE) ?? "null")); } catch { return new ScrollMemory(); }
})();
const persist = () => { try { sessionStorage.setItem(STORE, JSON.stringify(memory)); } catch { /* private mode: Back still works, just without a place */ } };

const canFade = () => typeof document !== "undefined" && typeof document.startViewTransition === "function" && !prefersReducedMotion();
const mainEl = () => document.getElementById("main");

/** Resolves when the cross-fade now running ends (or at once when none is): the item search waits for it. */
let fading: Promise<unknown> = Promise.resolve();

/** Put `main` at `top`; if the page is still filling and too short, keep trying until it can (or the person scrolls, or 2 s pass). */
function restoreScroll(main: HTMLElement, top: number): void {
  let frames = 0, stop = false;
  const off = () => { stop = true; main.removeEventListener("wheel", off); main.removeEventListener("touchstart", off); window.removeEventListener("keydown", off); };
  main.addEventListener("wheel", off, { passive: true }); main.addEventListener("touchstart", off, { passive: true }); window.addEventListener("keydown", off);
  const step = () => {
    if (stop) return;
    main.scrollTop = top;
    if (canReach(main.scrollHeight, main.clientHeight, top) || ++frames > 120) { off(); return; }
    requestAnimationFrame(step);
  };
  step();
}

/** Find `sel` on the page (it may still be loading), scroll to it and tint it. Gives up after 3 s. */
function findAndMark(sel: string, alive: () => boolean): void {
  const start = performance.now();
  const look = () => {
    if (!alive()) return;
    let el: HTMLElement | null = null;
    try { el = mainEl()?.querySelector<HTMLElement>(sel) ?? null; } catch { /* a selector that isn't one */ }
    if (!el) { if (performance.now() - start < 3000) setTimeout(look, 60); return; }
    el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    el.classList.remove("v2-found"); void el.offsetWidth;  // restart the tint if it is already on
    el.classList.add("v2-found");
    setTimeout(() => el!.classList.remove("v2-found"), FOUND_MS + 60);
  };
  fading.then(look, look);
}

/** Draw `to` now: in one step (React's flushSync), inside a view transition when the browser has them and motion is allowed. */
function swap(to: Location, setShown: (l: Location) => void, deadline: number): void {
  const draw = () => { quiet(true); flushSync(() => setShown(to)); };  // the commit also sets the scroll (the layout effect below), before the new picture
  if (canFade()) {
    const main = mainEl(), crumbs = document.querySelector<HTMLElement>(".v2-crumbs");
    // the names are on only while it fades: a permanent one would make `main` the containing block of fixed things inside it
    if (main) main.style.viewTransitionName = "v2-main";
    if (crumbs) crumbs.style.viewTransitionName = "v2-crumbs";
    const t = document.startViewTransition(async () => { try { draw(); await settle(deadline); } finally { quiet(false); } });
    t.ready.catch(() => {});  // skipped by a newer navigation: not an error
    fading = t.finished.catch(() => {}).then(() => { if (main) main.style.viewTransitionName = ""; if (crumbs) crumbs.style.viewTransitionName = ""; });
    return;
  }
  draw();
  const main = mainEl();
  if (!main || prefersReducedMotion()) { setTimeout(() => quiet(false), 50); return; }  // no animation: the page is simply there
  // no View Transitions: the old page is already gone, so keep the new one out of sight for the same few tens of milliseconds
  // (its own first requests landing), then fade it in
  main.classList.add("is-settling");
  settle(deadline).then(() => {
    quiet(false);
    main.classList.remove("is-settling"); main.classList.add("is-arriving");
    setTimeout(() => main.classList.remove("is-arriving"), arriveMs() + 80);
  });
}

const turns = (n: number) => new Promise<void>(r => { const go = (k: number) => (k <= 0 ? r() : setTimeout(() => go(k - 1), 0)); go(n); });
/** Inside the view transition's callback, the new page is drawn but the browser still shows the old one (it is held until the callback
 *  is done). Give the new page's own first requests (a detail it asks for once it knows what is open) until `deadline` (the 250 ms
 *  budget of the wait) to land, so what the browser pictures is the page as it will stay, not its first draw. */
async function settle(deadline: number): Promise<void> {
  await turns(2);
  while (waitingCount() > 0 && performance.now() < deadline) await new Promise<void>(r => setTimeout(r, 8));
  await turns(2);
}
/** How long the arrival lasts: the token, read from the page (for removing the fallback's class). */
const arriveMs = () => { const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--v2-dur-page-in")); return Number.isFinite(v) ? v : 300; };

export function RouteStage({ children, institutionId }: { children: (location: Location) => ReactNode; institutionId: string | null }) {
  const location = useLocation();
  const navType = useNavigationType();
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [shown, setShown] = useState(location);
  // another page: keep drawing the old one until its successor's first answers are in (or 250 ms have passed)
  const hold = shown.key !== location.key && fadesBetween(shown.pathname, location.pathname);
  const drawn = hold ? shown : location;
  const waits = useRef(new LatestWait());

  useEffect(() => {
    if (!hold) { if (shown !== location) setShown(location); return; }
    let live = true;
    const deadline = performance.now() + WAIT_MAX_MS;
    const urls = document.hidden || navigator.onLine === false ? [] : prefetchPlan(location.pathname + location.search, { admin, institutionId });
    if (urls.length) holdWaiting(1);
    waits.current.run(urls.map(warm)).then(result => {
      if (urls.length) holdWaiting(-1);
      if (live && result !== "stale") swap(location, setShown, deadline);
    });
    return () => { live = false; waits.current.abort(); };
  }, [hold, location]);  // eslint-disable-line react-hooks/exhaustive-deps

  // the crumbs and the tab title go with the page on screen
  useLayoutEffect(() => { setDrawnPath(drawn.pathname); }, [drawn.pathname]);
  // a skeleton replaced by content: the content fades in
  useEffect(() => { const m = mainEl(); return m ? watchContentIn(m) : undefined; }, []);

  // scroll: remember it as it moves, keep it where it belongs when a page is drawn
  const current = useRef(drawn.key);
  useEffect(() => {
    const main = mainEl();
    if (!main) return;
    let raf = 0;
    const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => memory.set(current.current, main.scrollTop)); };
    main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => { cancelAnimationFrame(raf); main.removeEventListener("scroll", onScroll); window.removeEventListener("pagehide", persist); };
  }, []);

  const last = useRef<Location | null>(null);
  const marked = useRef<string | null>(null);
  useLayoutEffect(() => {
    const main = mainEl(), prev = last.current;
    last.current = drawn;
    if (!main || (prev && prev.key === drawn.key)) return;
    const samePath = !!prev && prev.pathname === drawn.pathname;
    if (prev && samePath) memory.carry(prev.key, drawn.key);
    const plan = scrollPlan({ samePath, pop: navType === "POP", hash: !!drawn.hash, saved: memory.get(drawn.key) });
    current.current = drawn.key;
    if (plan.kind === "restore") restoreScroll(main, plan.top);
    else if (plan.kind === "top") main.scrollTop = 0;
    persist();
    const f = navType === "POP" ? null : foundOf(drawn.state);
    if (f && marked.current !== drawn.key) { marked.current = drawn.key; const key = drawn.key; findAndMark(f.sel, () => current.current === key); }
  }, [drawn]);  // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children(drawn)}</>;
}
