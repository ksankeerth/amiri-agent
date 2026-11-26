// The rules behind the list-and-pane pages (ListPane.tsx), kept free of the DOM so they can be tested.

/** Rows shown before "Show 10 more". */
export const PAGE = 10;

export type Stick = "pane" | "list" | "none";

/** Which column stays pinned while the page scrolls. The shorter one, if it fits the scrolling area: a column taller than the
 *  area would have its bottom out of reach. A tie pins the pane. Neither fits, or the columns are stacked: none. */
export function whoSticks(listH: number, paneH: number, room: number, sideBySide = true): Stick {
  if (!sideBySide || listH <= 0 || paneH <= 0) return "none";
  const pane = paneH <= listH;
  const h = pane ? paneH : listH;
  return h <= room ? (pane ? "pane" : "list") : "none";
}

/** How many rows show: the pages asked for so far, and at least up to the open one, so a link to a row beyond the first page
 *  opens with that row in view. `openIdx` is -1 when nothing is open. A last row alone is shown rather than hidden behind a button. */
export function visibleCount(total: number, asked: number, openIdx: number): number {
  const n = Math.max(asked, openIdx + 1);
  return total - n === 1 ? total : Math.min(n, total);
}

/** "Show 10 more · 24 left", or "Show 4 more" when that is all that is left. */
export function moreLabel(left: number, step = PAGE): string {
  return left <= step ? `Show ${left} more` : `Show ${step} more · ${left} left`;
}
