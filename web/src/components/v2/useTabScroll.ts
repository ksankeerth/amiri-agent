// Phone tab strips (M1): under 720 px a row of tabs is one line that scrolls sideways. This hook keeps the active tab in view (centred, so a
// neighbour peeks out on each side) and says whether more tabs sit past the left or right edge, so the strip can fade that edge.
// The sliding underline lives inside the strip and scrolls with it, so it needs nothing from here. Wide screens: the row wraps, nothing scrolls.
import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { prefersReducedMotion } from "./motion";
import { centreScroll, edgesOf, type TabEdges } from "./tabsNav";

export function useTabScroll(list: RefObject<HTMLElement | null>, active: string): TabEdges {
  const [edges, setEdges] = useState<TabEdges>({ start: false, end: false });
  const read = useCallback(() => {
    const el = list.current;
    if (!el) return;
    const next = edgesOf(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setEdges(e => (e.start === next.start && e.end === next.end ? e : next));
  }, [list]);
  // the active tab comes into view whenever it changes (and on first paint, so a link to the last tab opens with it showing)
  useLayoutEffect(() => {
    const el = list.current, tab = el?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!el || !tab || el.scrollWidth <= el.clientWidth + 1) { read(); return; }
    const left = centreScroll(tab.offsetLeft, tab.offsetWidth, el.clientWidth, el.scrollWidth);
    if (Math.abs(left - el.scrollLeft) > 1) el.scrollTo({ left, behavior: prefersReducedMotion() ? "instant" : "smooth" });
    read();
  }, [list, active, read]);
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    el.addEventListener("scroll", read, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(el);
    el.querySelectorAll('[role="tab"]').forEach(t => ro?.observe(t));
    return () => { el.removeEventListener("scroll", read); ro?.disconnect(); };
  }, [list, read]);
  return edges;
}
