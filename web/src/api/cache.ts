// A small stale-while-revalidate store for GET answers (F4). Plain logic with the clock passed in, so `npm test` covers it.
//
// What it is for: a page you have already seen opens at once from what it saw last time (`peek`), and asks the server again
// quietly; a link you hover or focus warms the page's first answers before you click. It is never the reason a page shows old
// numbers for long: nothing older than MAX_AGE_MS is ever shown, and any write drops what it could have changed.

/** The longest an answer is still shown while a fresh one is on its way. Older: the page waits for the new one (a skeleton). */
export const MAX_AGE_MS = 5 * 60_000;
/** An answer a hover or focus fetched ahead of time is used by the page's own first ask if it is this young (the click came soon after). */
export const PREFETCH_USE_MS = 15_000;
/** After a page took an answer fetched ahead, an identical ask this soon after takes it too (the same page asking twice at opening). */
export const TAKE_AGAIN_MS = 1_000;
/** Most answers kept; the least recently used go first. */
export const MAX_ENTRIES = 80;

export interface Entry<V = unknown> {
  value: V;
  /** When the server answered. */
  at: number;
  /** Fetched ahead of a click and not yet used by a page's own ask: that first ask may take it instead of asking again. */
  ahead: boolean;
  /** When a page's ask took it (the same page asking again within TAKE_AGAIN_MS, as React's double mount does in development, may too). */
  taken?: number;
  /** When it was last read (for choosing what to drop at the cap). */
  used: number;
}

export class SwrCache {
  private map = new Map<string, Entry>();
  /** Counts every invalidation: an answer that was on its way when a write happened is dropped on arrival, not stored. */
  epoch = 0;
  private now: () => number;
  private maxAge: number;
  private cap: number;
  constructor(now: () => number = Date.now, maxAge = MAX_AGE_MS, cap = MAX_ENTRIES) { this.now = now; this.maxAge = maxAge; this.cap = cap; }

  get size(): number { return this.map.size; }
  keys(): string[] { return [...this.map.keys()]; }

  /** The entry for `key` if it is young enough to show; an older one is dropped. */
  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.maxAge) { this.map.delete(key); return undefined; }
    return e;
  }

  /** True when `key` was answered less than `ms` ago. */
  younger(key: string, ms: number): boolean {
    const e = this.get(key);
    return !!e && this.now() - e.at < ms;
  }

  /** Read for showing: marks the entry used. */
  peek<V>(key: string): V | undefined {
    const e = this.get(key);
    if (!e) return undefined;
    e.used = this.now();
    return e.value as V;
  }

  set(key: string, value: unknown, ahead = false): void {
    const t = this.now();
    this.map.delete(key);
    this.map.set(key, { value, at: t, ahead, used: t });
    this.trim();
  }

  /** The first ask of a page for something fetched ahead: hands it over once. Later asks go to the server. */
  takeAhead(key: string, within = PREFETCH_USE_MS): Entry | undefined {
    const e = this.get(key);
    if (!e) return undefined;
    const t = this.now();
    if (e.taken !== undefined) return t - e.taken < TAKE_AGAIN_MS ? e : undefined;
    if (!e.ahead || t - e.at > within) return undefined;
    e.ahead = false; e.taken = t; e.used = t;
    return e;
  }

  /** Drop every key that starts with one of the prefixes. */
  invalidate(prefixes: readonly string[]): number {
    this.epoch++;
    let n = 0;
    for (const k of [...this.map.keys()]) if (prefixes.some(p => k.startsWith(p))) { this.map.delete(k); n++; }
    return n;
  }

  clear(): void { this.epoch++; this.map.clear(); }

  private trim(): void {
    while (this.map.size > this.cap) {
      let oldest: string | null = null, at = Infinity;
      for (const [k, e] of this.map) if (e.used < at) { at = e.used; oldest = k; }
      if (oldest === null) break;
      this.map.delete(oldest);
    }
  }
}

// ---------------------------------------------------------------- what a write changes
const V1 = "/api/v1/";
/** What else each area's writes make out of date, besides the area itself (by the first word of the path after /api/v1/).
 *  An area that isn't listed clears everything: slower, never wrong. */
export const RELATED: Record<string, string[]> = {
  alerts: ["overview", "events"],
  monitors: ["monitor-checks", "overview", "findings", "events"],
  series: ["overview", "findings", "events"],
  radar: ["overview", "findings", "investigation", "events"],
  investigations: ["investigation", "findings", "events", "alerts", "overview", "radar"],
  findings: ["investigation", "events", "alerts", "overview"],
  events: ["investigation", "alerts", "overview"],
  sandbox: ["findings", "events", "investigation", "overview", "series", "alerts"],
  studio: ["overview", "findings", "events", "alerts", "investigation"],
  institutions: ["installation", "overview", "alerts", "events", "radar", "spec", "monitors", "findings"],
  "data-connection": ["overview", "alerts", "events", "findings", "installation"],
  validation: ["overview", "alerts", "events", "investigation", "data-connection"],
};

/** The key prefixes a write to `path` (any method but GET) makes out of date. "/api/v1/alerts/a1:ack" → alerts*, overview*, events*.
 *  `null`: clear the whole cache. */
export function invalidationFor(path: string): string[] | null {
  const bare = path.split("?")[0];
  if (!bare.startsWith(V1)) return null;
  const area = bare.slice(V1.length).split(/[/:?]/)[0];
  if (!area) return null;
  if (area === "auth") return null;
  const related = RELATED[area];
  if (!related) return null;
  return [area, ...related].map(a => V1 + a);
}
