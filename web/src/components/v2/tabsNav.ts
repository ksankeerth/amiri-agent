// Keyboard moves along a tab row (WAI-ARIA tabs, automatic activation): the arrows wrap, Home and End jump.
// Returns the index to move to, or null when the key isn't one the tab row handles.
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowRight": return (current + 1) % count;
    case "ArrowLeft": return (current - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

export interface TabEdges { start: boolean; end: boolean }

/** Where to scroll so `tab` is centred in a strip `view` wide with `total` of content, clamped to the strip. */
export function centreScroll(tabLeft: number, tabWidth: number, view: number, total: number): number {
  return Math.max(0, Math.min(total - view, Math.round(tabLeft - (view - tabWidth) / 2)));
}
/** Which edges hide more tabs (a 2 px slack for sub-pixel rounding). */
export function edgesOf(scrollLeft: number, view: number, total: number): TabEdges {
  return { start: scrollLeft > 2, end: scrollLeft + view < total - 2 };
}

