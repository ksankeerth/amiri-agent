// Calls amiri-server. Errors come back as RFC 9457 problem details; every failure
// becomes an ApiError carrying the problem's code, detail and Retry-After.
import { LOCK_TOAST } from "../components/demoLock.ts";
import { invalidationFor, SwrCache } from "./cache.ts";

export interface Problem {
  type?: string;
  title?: string;
  status: number;
  code: string;
  detail: string;
  retry_after_seconds?: number;
  provider_message?: string;
  errors?: { field: string; message: string }[];
  [k: string]: unknown;
}

export class ApiError extends Error {
  problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail);
    this.problem = problem;
  }
  get code() { return this.problem.code; }
  get status() { return this.problem.status; }
  /** The detail, plus the provider's own message or the field errors when there are any. */
  get full(): string {
    const p = this.problem;
    const extra = p.provider_message ? ` Twelve Data said: “${p.provider_message}”` :
      p.errors?.length ? " " + p.errors.map(e => `${e.field}: ${e.message}`).join("; ") : "";
    return p.detail + extra;
  }
}

// The signed-in person. IAP provides it in production; until then, one demo user, by name only (the server
// stores the X-Amiri-Actor header as free text). Pages show actors through format.person, never an email.
export const ME = "John";

// ---------------------------------------------------------------- the GET cache (F4; rules in cache.ts)
/** What every page and the prefetch share. A GET stores its answer here; a write drops what it could have changed. */
export const cache = new SwrCache();
// dev server only (a constant false in the production build): lets a browser check look at the cache
if (import.meta.env?.DEV && typeof window !== "undefined") (window as unknown as { __amiriCache: SwrCache }).__amiriCache = cache;

type Mode = "quiet" | "ahead" | "peek" | null;
let mode: Mode = null;
/** Run `fn` so every GET it starts *right now* (before its first await) is of the given kind. */
function inMode<T>(m: Mode, fn: () => T): T {
  const was = mode;
  mode = m;
  try { return fn(); } finally { mode = was; }
}
/** The page's own passive refresh (a timer, the menu's counts): no progress line, nothing for the person to wait for. */
export const quietly = <T,>(fn: () => T): T => inMode("quiet", fn);
/** Asks ahead of a click: the answer is stored for the page's first ask; nothing is shown, errors are ignored. */
export const asksAhead = <T,>(fn: () => T): T => inMode("ahead", fn);
/** True while `peek` runs a call, so a call with a side effect in its `.then` (the Overview's event) can skip it. */
export const isPeeking = () => mode === "peek";

/** What a call would answer from the cache, now, without asking the server: for a page's first render, so a page seen before
 *  opens with its last answer in place (no skeleton) while the page's own load refreshes it. `undefined`: not in the cache
 *  (or older than 5 minutes). Give it one call of an api module: `peek(() => alertsApi.summary())`. Only calls that are a single
 *  GET followed by plain `.then` mapping work; `Promise.all` is peeked one call at a time. */
export function peek<T>(call: () => Promise<T>): T | undefined {
  try {
    const r = inMode("peek", call) as unknown;
    return r instanceof Sync && r.hit ? (r.value as T) : undefined;
  } catch { return undefined; }
}
/** A stand-in for the promise while peeking: `.then` runs at once on a hit and does nothing on a miss. */
class Sync<T> {
  readonly hit: boolean;
  readonly value?: T;
  constructor(hit: boolean, value?: T) { this.hit = hit; this.value = value; }
  then(f?: (v: T) => unknown): Sync<unknown> {
    if (!this.hit || !f) return this as Sync<unknown>;
    const v = f(this.value as T);
    return v instanceof Sync ? v : new Sync(true, v);
  }
  catch(): Sync<T> { return this; }
  finally(): Sync<T> { return this; }
}

// requests the page is waiting for (the progress line at the top of the page, F4); a passive refresh or a prefetch isn't one
let waiting = 0;
const listeners = new Set<() => void>();
export const waitingCount = () => waiting;
export function subscribeWaiting(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
const bump = (d: number) => { waiting += d; listeners.forEach(f => f()); };

/** Marks the page as waiting (the progress line) for something that isn't a request of its own: RouteStage's short wait for the
 *  next page's first answers. Call with +1 when it starts and -1 when it ends. */
export const holdWaiting = (d: 1 | -1): void => bump(d);

const ahead = new Map<string, Promise<unknown>>();  // asked ahead of a click and still on its way
const claimed = new Set<string>();                  // …and a page has asked for the same thing since: it is not spare any more

export function api<T>(path: string, init: RequestInit & { json?: unknown; fresh?: boolean } = {}): Promise<T> {
  const read = !init.method || init.method === "GET";
  const m = mode;
  if (m === "peek") {
    const v = read ? cache.peek<T>(path) : undefined;
    return (v === undefined ? new Sync<T>(false) : new Sync<T>(true, v)) as unknown as Promise<T>;
  }
  if (!read) {
    // a write: when it is over (it worked or it didn't: either way something may have moved) what it touches is asked for again
    const drop = () => { const p = invalidationFor(path); if (p) cache.invalidate(p); else cache.clear(); };
    drop();
    return request<T>(path, init, false).finally(drop);
  }
  if (init.fresh) return fetched<T>(path, init, m);  // a poll, or a read that must be live: never from the cache
  if (m === "ahead") {
    if (ahead.has(path) || cache.younger(path, 10_000)) return Promise.resolve(undefined as T);  // it is coming, or we have it from a moment ago
    return fetched<T>(path, init, m);
  }
  const spare = cache.takeAhead(path);
  if (spare) return Promise.resolve(spare.value as T);
  const coming = ahead.get(path);
  if (coming) { claimed.add(path); return coming as Promise<T>; }
  return fetched<T>(path, init, m);
}

/** For the wait before a page change (F4b): resolves when `path` is in the cache (an answer from the last 10 s, as `asksAhead` counts it),
 *  or once it has been asked for: it joins an ask already on its way (a hover's prefetch) instead of asking twice. Never rejects:
 *  a failed ask is the page's to show when it opens. The answer is kept for the page's first ask, as any ask ahead is. */
export function warm(path: string): Promise<void> {
  if (cache.younger(path, 10_000)) return Promise.resolve();
  const coming = ahead.get(path);
  const p = coming ?? asksAhead(() => api<unknown>(path));
  return p.then(() => undefined, () => undefined);
}

function fetched<T>(path: string, init: RequestInit & { json?: unknown }, m: Mode): Promise<T> {
  const epoch = cache.epoch;
  const isAhead = m === "ahead";
  const visible = m !== "quiet" && !isAhead && !(init as { fresh?: boolean }).fresh;  // a poll is not something the page is waiting for
  if (visible) bump(1);
  const p = request<T>(path, init, isAhead).then(v => {
    if (cache.epoch === epoch) cache.set(path, v, isAhead && !claimed.has(path));  // a write came while it was on its way: it may be out of date
    return v;
  });
  if (isAhead) {
    ahead.set(path, p);
    const done = () => { ahead.delete(path); claimed.delete(path); };
    p.then(done, done);
  }
  return visible ? p.finally(() => bump(-1)) : p;
}

async function request<T>(path: string, init: RequestInit & { json?: unknown; fresh?: boolean }, silent: boolean): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("X-Amiri-Actor")) headers.set("X-Amiri-Actor", ME);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  const read = !init.method || init.method === "GET";
  let r: Response;
  try {
    r = await fetch(path, { ...init, headers, body });
    // a read that met a starting server (Cloud Run brings it up from zero after a quiet spell) is tried once more
    if (read && [502, 503, 504].includes(r.status) && !(r.headers.get("content-type") ?? "").includes("problem")) r = await fetch(path, { ...init, headers, body });
  } catch (e) {
    try {
      if (!read) throw e;  // a write isn't sent twice: it may have arrived
      r = await fetch(path, { ...init, headers, body });
    } catch {
      throw new ApiError({ status: 0, code: "network", detail: read
        ? "AMIRI Agent didn't answer. It may be starting up after a quiet spell: try again in a few seconds."
        : "AMIRI Agent didn't answer, so this may not have been saved. It may be starting up after a quiet spell: check, then try again in a few seconds." });
    }
  }
  if (r.status === 204) return undefined as T;
  const text = await r.text();
  let data: any;
  try { data = text ? JSON.parse(text) : undefined; }
  catch (e) { if (r.ok) throw e; }  // an error page from a proxy (HTML or plain text): the status below says what happened
  if (!r.ok) {
    const p: Problem = data && data.code ? data : { status: r.status, code: "http_" + r.status, detail: text || r.statusText };
    if (p.retry_after_seconds === undefined && r.headers.get("Retry-After")) p.retry_after_seconds = Number(r.headers.get("Retry-After"));
    // the passed check ran out (or was never there): back to the bot check, once
    if (r.status === 401 && p.code === "signed_out" && !path.startsWith("/api/v1/auth/")) { cache.clear(); if (!silent) window.dispatchEvent(new Event("amiri:signed-out")); }
    // the database is stopped to save costs (server: app/sleep.py): the app shows its paused page
    if (r.status === 503 && p.code === "asleep" && !silent) window.dispatchEvent(new Event("amiri:asleep"));
    // the demo is locked (server: app/demo_lock.py) and this page didn't know: say so, once, in the same words everywhere
    if (r.status === 403 && p.code === "demo_locked") { p.detail = LOCK_TOAST; if (!silent) window.dispatchEvent(new Event("amiri:demo-locked")); }
    throw new ApiError(p);
  }
  return data as T;
}
