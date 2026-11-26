// Moving between pages (F4): the plain decisions, kept apart from React so `npm test` covers them.

/** The page a path belongs to, for deciding whether a navigation is "another page" (the page cross-fades) or "the same page
 *  changing" (a row picked in a list beside its pane, a tab, a filter: nothing fades). "/monitors" and "/monitors/mon-1" are one
 *  page; "/events" and "/events/ev-1" are two. */
export function pageGroup(pathname: string): string {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (/^\/events\/[^/]+/.test(p)) return "event";
  if (/^\/studio\/run\//.test(p)) return "studio-run";
  if (/^\/institution\/new/.test(p)) return "institution-new";
  if (/^\/institution\/setup/.test(p)) return "institution-setup";
  const first = p.split("/")[1] ?? "";
  if (first === "admin") return p;                      // each admin page is its own
  return first ? "/" + first : "/";                     // /monitors/x, /series/x, /studio/x, /institution/customers: the list's own page
}

/** True when going from one path to the other should cross-fade the page. */
export const fadesBetween = (from: string, to: string): boolean => pageGroup(from) !== pageGroup(to);

// ---------------------------------------------------------------- scroll, remembered per history entry
export const MAX_SCROLL_ENTRIES = 100;

/** Where `main` was scrolled on each history entry (keyed by the entry's own key), so Back returns to it. The newest entries are kept. */
export class ScrollMemory {
  private map = new Map<string, number>();
  get(key: string): number | undefined { return this.map.get(key); }
  set(key: string, top: number): void {
    if (!key || !Number.isFinite(top)) return;
    this.map.delete(key);
    this.map.set(key, Math.max(0, Math.round(top)));
    while (this.map.size > MAX_SCROLL_ENTRIES) this.map.delete(this.map.keys().next().value as string);
  }
  /** A page changed its address without leaving (a filter, a picked row): the new entry starts where the old one was. */
  carry(from: string, to: string): void { const v = this.map.get(from); if (v !== undefined && !this.map.has(to)) this.set(to, v); }
  toJSON(): [string, number][] { return [...this.map]; }
  static from(raw: unknown): ScrollMemory {
    const m = new ScrollMemory();
    if (Array.isArray(raw)) for (const e of raw) if (Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "number") m.set(e[0], e[1]);
    return m;
  }
}

/** What to do with `main`'s scroll when a page is drawn. `pop`: the person went Back or Forward. */
export type ScrollPlan = { kind: "restore"; top: number } | { kind: "top" } | { kind: "keep" };
export function scrollPlan(o: { samePath: boolean; pop: boolean; hash: boolean; saved: number | undefined }): ScrollPlan {
  if (o.samePath) return { kind: "keep" };                // a filter, a tab or a picked row: where the person is stays
  if (o.pop && o.saved !== undefined) return { kind: "restore", top: o.saved };
  return o.hash ? { kind: "keep" } : { kind: "top" };     // a new page starts at the top; a #link scrolls to its own place
}

/** True once `main` is tall enough to be scrolled to `top` (the page's content may arrive after the page is drawn). */
export const canReach = (scrollHeight: number, clientHeight: number, top: number): boolean => scrollHeight - clientHeight >= top - 1;

/** Which way a link click (or a Go to choice) wants to go: the item to find and mark on the page it lands on, if any. */
export interface Found { sel: string }
export const foundState = (sel: string | null | undefined): { found: Found } | undefined => (sel ? { found: { sel } } : undefined);
export function foundOf(state: unknown): Found | null {
  const f = (state as { found?: { sel?: unknown } } | null | undefined)?.found;
  return f && typeof f.sel === "string" && f.sel ? { sel: f.sel } : null;
}
export const FOUND_MS = 1200;

// ---------------------------------------------------------------- the short wait for data before a page change (F4b)
/** The longest the old page stays up while the new page's first answers come in. After that the page changes anyway (it shows what
 *  the cache has, or its placeholder, and fills in as the answers land). */
export const WAIT_MAX_MS = 250;
/** The progress line shows only when the wait is longer than this (BusyLine.BUSY_AFTER_MS is the same number). */
export const WAIT_LINE_MS = 150;

export type WaitResult = "ready" | "timeout" | "stale";

/** Waits for `work` (every promise settled, failures included: the page shows its own error) for at most `ms`. Only the newest wait
 *  counts: starting one makes the one before it end at once with "stale" (a second click while the first is waiting). */
export class LatestWait {
  private cancel: (() => void) | null = null;
  run(work: readonly Promise<unknown>[], ms: number = WAIT_MAX_MS): Promise<WaitResult> {
    this.cancel?.();
    return new Promise<WaitResult>(resolve => {
      let done = false;
      const end = (r: WaitResult) => {
        if (done) return;
        done = true; clearTimeout(timer);
        if (this.cancel === stale) this.cancel = null;
        resolve(r);
      };
      const stale = () => end("stale");
      const timer = setTimeout(() => end("timeout"), ms);
      this.cancel = stale;
      Promise.allSettled(work).then(() => end("ready"));
    });
  }
  /** Ends the wait now (the page is going away). */
  abort(): void { this.cancel?.(); }
}

// ---------------------------------------------------------------- the page that is drawn (F4b)
// The menu's breadcrumbs belong to the page on screen, not to the address: while the old page waits for the new one's data the
// address has already changed, and the crumbs must not (they would change a beat before the page does, outside the fade).
let drawnPath: string | null = null;
const drawnSubs = new Set<() => void>();
/** The path of the page on screen. Before the first page is drawn: the address bar's. */
export const getDrawnPath = (): string => drawnPath ?? (typeof location !== "undefined" ? location.pathname : "/");
export function setDrawnPath(p: string): void {
  if (p === drawnPath) return;
  drawnPath = p;
  drawnSubs.forEach(f => f());
}
export const subscribeDrawnPath = (f: () => void): (() => void) => { drawnSubs.add(f); return () => { drawnSubs.delete(f); }; };
