// Motion helpers (F3): the few decisions that are plain arithmetic, kept apart from React so they can be tested.
// Durations are in CSS (tokens.css: --v2-dur-fast / --v2-dur / --v2-dur-slow); these are the same numbers for the JS that waits for an exit.

/** How long a thing fades out before it is removed (matches --v2-dur-fast). */
export const EXIT_MS = 120;
/** How long a panel's height takes to follow its new content: --v2-dur-slow (220 ms) for an ordinary change, longer for a big one so
 *  hundreds of pixels don't fly by (up to 340 ms). */
export const HOLD_MS = 220;
export function holdMs(prev: number, next: number): number {
  return Math.round(Math.min(340, Math.max(HOLD_MS, 160 + Math.abs(next - prev) * 0.2)));
}
/** A panel whose height changes by less than this just snaps: an animation would only look like a twitch. */
export const SNAP_BELOW = 8;

/** True when the person asked for less motion. Safe on a server or in a test (no window). */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How long to wait before removing a leaving thing: no wait at all under reduced motion. */
export function exitDelay(reduced: boolean, ms: number = EXIT_MS): number {
  return reduced ? 0 : ms;
}

export interface TabRect { left: number; top: number; width: number; height: number }
export interface IndicatorBox { x: number; y: number; w: number }

/** Where the sliding line sits: under (bottom) or over (top) the active tab, `thickness` px tall, as wide as the tab. Rects are the tab's
 *  offsets inside the tab row, so the line moves with the row when it scrolls. Whole pixels, so the line never blurs. */
export function indicatorBox(tab: TabRect, thickness: number, edge: "bottom" | "top"): IndicatorBox {
  const y = edge === "top" ? tab.top : tab.top + tab.height - thickness;
  return { x: Math.round(tab.left), y: Math.round(y), w: Math.max(0, Math.round(tab.width)) };
}

export type HoldPlan = "none" | "animate";
/** What to do with the height of a tab panel when another tab is picked. `prev` and `next` are the old and the new content's heights.
 *  "animate": hold the old height, then ease to the new one, so what is below the panel doesn't jump. "none": leave it alone (first
 *  paint, a tiny change, or reduced motion). */
export function holdPlan(prev: number, next: number, reduced: boolean): HoldPlan {
  if (reduced || !(prev > 0) || !(next >= 0)) return "none";
  return Math.abs(next - prev) < SNAP_BELOW ? "none" : "animate";
}

export interface BusyState { disabled: boolean; ariaBusy: boolean; blocksClick: boolean }
/** A busy button keeps its label and its width (the spinner is drawn over it), says it is busy, and ignores clicks while it works. */
export function busyState(busy: boolean, disabled: boolean | undefined): BusyState {
  return { disabled: !!disabled, ariaBusy: busy, blocksClick: busy };
}

export interface Leaving<T> { item: T; leaving: boolean }
/** The list to draw while some entries are still fading out: the entries now in `items` (in their old places), the ones that went
 *  marked `leaving` (kept where they were), and new ones last. Keyed by `id`. */
export function withLeaving<T extends { id: number | string }>(prev: Leaving<T>[], items: T[]): Leaving<T>[] {
  const now = new Map(items.map(i => [i.id, i]));
  const seen = new Set<number | string>();
  const out: Leaving<T>[] = [];
  for (const p of prev) {
    const cur = now.get(p.item.id);
    if (cur) { out.push({ item: cur, leaving: false }); seen.add(p.item.id); }
    else out.push({ item: p.item, leaving: true });
  }
  for (const i of items) if (!seen.has(i.id)) out.push({ item: i, leaving: false });
  return out;
}
