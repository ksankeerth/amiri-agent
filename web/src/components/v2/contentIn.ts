// A placeholder replaced by the real content fades in (F4b). One shared place, not a wrapper in every page: when a skeleton leaves
// `main` and something is put where it was, what was put there gets the `v2-in` class for one 160 ms fade (shell.css).
//
// Only that. A page showing cached data that a refresh then replaces has no skeleton leaving, so it never fades: a quiet refresh
// cannot flicker. A page that opens with content (the cache or a prefetch had it) has none either: the page change itself already
// fades it. And while RouteStage swaps pages (`quiet`) nothing is marked: that swap is the page's own fade.

const SKELETON = ".v2-skel, .v2-skel__b";
const isElement = (n: Node): n is Element => n.nodeType === 1;
/** True for a placeholder, or something that holds one. */
const holdsSkeleton = (n: Node): boolean => isElement(n) && (n.matches(SKELETON) || n.querySelector(SKELETON) !== null);

let quietNow = false, quietUntil = 0;
/** While a page is being swapped in, nothing is marked: that swap is the page's own fade. `quiet(false)` ends it a moment later (the
 *  last changes of the swap are still on their way to the observer). */
export function quiet(on: boolean): void {
  quietNow = on;
  if (!on) quietUntil = performance.now() + 60;
}

/** The elements added where a placeholder was removed, in one batch of changes: grouped by the parent they were added to. */
export function filledIn(records: readonly Pick<MutationRecord, "target" | "addedNodes" | "removedNodes">[]): Element[] {
  const emptied = new Set<Node>();
  for (const r of records) for (const n of r.removedNodes) if (holdsSkeleton(n)) emptied.add(r.target);
  if (!emptied.size) return [];
  const out: Element[] = [];
  for (const r of records) {
    if (!emptied.has(r.target)) continue;
    for (const n of r.addedNodes) if (isElement(n) && !holdsSkeleton(n) && n.isConnected) out.push(n);
  }
  return out;
}

/** Start watching `main`. Returns the stop function. */
export function watchContentIn(main: HTMLElement): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const mo = new MutationObserver(records => {
    if (quietNow || performance.now() < quietUntil) return;
    for (const el of filledIn(records)) {
      el.classList.remove("v2-in"); void (el as HTMLElement).offsetWidth;  // a second fill-in restarts it
      el.classList.add("v2-in");
      const done = (e: Event) => { if (e.target === el) { el.classList.remove("v2-in"); el.removeEventListener("animationend", done); } };
      el.addEventListener("animationend", done);
    }
  });
  mo.observe(main, { childList: true, subtree: true });
  return () => mo.disconnect();
}
