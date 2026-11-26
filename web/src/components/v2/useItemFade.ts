// The same page showing another item (F4b): a row picked beside its pane, another event: the pane's content fades in (opacity,
// a 4 px rise, --v2-dur-item). No fade at the page's first draw (the page change did that) and none when nothing changed.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./motion";

/** Run the fade on `el` (again, if it is still running). */
export function fadeIn(el: HTMLElement | null): void {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove("v2-item-in"); void el.offsetWidth;
  el.classList.add("v2-item-in");
  const done = (e: Event) => { if (e.target === el) { el.classList.remove("v2-item-in"); el.removeEventListener("animationend", done); } };
  el.addEventListener("animationend", done);
}

/** Fade `ref`'s element whenever `key` (the open item's id) changes. */
export function useItemFade(ref: RefObject<HTMLElement | null>, key: string | null | undefined): void {
  const prev = useRef(key);
  useLayoutEffect(() => {
    if (prev.current === key) return;
    prev.current = key;
    fadeIn(ref.current);
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
}

/** Fade `ref`'s element once, as it first appears, when `enter` says it replaced another item of the same page. */
export function useEnterFade(ref: RefObject<HTMLElement | null>, enter: boolean): void {
  useLayoutEffect(() => { if (enter) fadeIn(ref.current); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
}
