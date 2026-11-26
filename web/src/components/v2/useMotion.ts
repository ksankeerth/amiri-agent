// The React side of the motion system (F3): a leaving thing that fades before it goes, a line that slides between tabs.
// The numbers live in motion.ts and the CSS tokens; everything here does nothing under prefers-reduced-motion.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { EXIT_MS, exitDelay, indicatorBox, prefersReducedMotion, type IndicatorBox } from "./motion";

/** For something this component draws itself (a menu): `mounted` stays true for EXIT_MS after `open` turns false, and `leaving`
 *  says it is in that fade. Under reduced motion it goes at once. */
export function usePresence(open: boolean, ms: number = EXIT_MS): { mounted: boolean; leaving: boolean } {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const wait = exitDelay(prefersReducedMotion(), ms);
    if (wait === 0) { setMounted(false); return; }
    const t = setTimeout(() => setMounted(false), wait);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { mounted: open || mounted, leaving: !open && mounted };
}

/** For a box the parent removes (a dialog): when this component unmounts, a copy of the box stays on screen for EXIT_MS, fading
 *  (class `is-ghost`), then goes. The copy is inert and hidden from assistive technology, so focus return and the focus trap are
 *  unaffected: the real box is gone at once. Pass the ref of the outermost element. */
export function useExitGhost(ref: RefObject<HTMLElement | null>, ms: number = EXIT_MS): void {
  useEffect(() => {
    const node = ref.current;
    return () => {
      if (!node) return;
      // StrictMode runs this cleanup and the effect again at once on mount; the node is still on the page then. A real unmount takes it off.
      queueMicrotask(() => {
        if (node.isConnected || prefersReducedMotion()) return;
        const ghost = node.cloneNode(true) as HTMLElement;
        ghost.classList.add("is-ghost");
        ghost.setAttribute("aria-hidden", "true");
        ghost.setAttribute("inert", "");
        ghost.removeAttribute("id");
        ghost.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
        document.body.appendChild(ghost);
        setTimeout(() => ghost.remove(), exitDelay(false, ms) + 40);
      });
    };
  }, [ref, ms]);
}

export interface Slide { box: IndicatorBox; animate: boolean }
/** A line that follows the active tab: measures `selector` inside `list` (which must be positioned) and returns where the line goes.
 *  The first measurement doesn't animate (the line is simply there); later ones slide. Re-measured when the row or a tab changes size. */
export function useSlideIndicator(list: RefObject<HTMLElement | null>, selector: string, edge: "bottom" | "top", thickness: number, watch: unknown): Slide | null {
  const [slide, setSlide] = useState<Slide | null>(null);
  const first = useRef(true);
  const measure = useCallback(() => {
    const el = list.current, tab = el?.querySelector<HTMLElement>(selector);
    if (!el || !tab) { setSlide(null); return; }
    const box = indicatorBox({ left: tab.offsetLeft, top: tab.offsetTop, width: tab.offsetWidth, height: tab.offsetHeight }, thickness, edge);
    const animate = !first.current && !prefersReducedMotion();
    first.current = false;
    setSlide(s => (s && s.animate === animate && s.box.x === box.x && s.box.y === box.y && s.box.w === box.w ? s : { box, animate }));
  }, [list, selector, thickness, edge]);
  useLayoutEffect(() => { measure(); }, [measure, watch]);
  useEffect(() => {
    const el = list.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.querySelectorAll('[role="tab"]').forEach(t => ro.observe(t));
    return () => ro.disconnect();
  }, [list, measure, watch]);
  return slide;
}
