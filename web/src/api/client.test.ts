import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { api, asksAhead, cache, holdWaiting, peek, quietly, subscribeWaiting, waitingCount, warm } from "./client.ts";

// a fake server: answers GETs with a counter per address, records every call, can hold an answer back
let calls: string[] = [], n = 0, hold: Promise<void> | null = null;
beforeEach(() => {
  calls = []; n = 0; hold = null; cache.clear();
  (globalThis as any).fetch = async (url: string, init: RequestInit = {}) => {
    calls.push(`${init.method ?? "GET"} ${url}`);
    if (hold) await hold;
    const body = init.method && init.method !== "GET" ? { ok: true } : { n: ++n, url };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
});

test("a GET is stored; peek answers from it without a request", async () => {
  assert.equal(peek(() => api<{ n: number }>("/api/v1/a")), undefined);   // nothing yet
  await api("/api/v1/a");
  assert.deepEqual(calls, ["GET /api/v1/a"]);
  assert.equal(peek(() => api<{ n: number }>("/api/v1/a"))?.n, 1);
  assert.equal(calls.length, 1);                                          // peek never asks the server
});

test("peek runs a call's own .then mapping", async () => {
  const list = () => api<{ n: number }>("/api/v1/a").then(r => r.n * 10);
  assert.equal(peek(list), undefined);
  await api("/api/v1/a");
  assert.equal(peek(list), 10);
});

test("the page's own ask always goes to the server (stale shows, then refreshes)", async () => {
  await api("/api/v1/a");
  const again = await api<{ n: number }>("/api/v1/a");
  assert.equal(again.n, 2);
  assert.equal(calls.length, 2);
  assert.equal(peek(() => api<{ n: number }>("/api/v1/a"))?.n, 2);       // and the newer answer is what shows next time
});

test("fresh: true is never answered from a prefetch (the 3 s polls)", async () => {
  await asksAhead(() => api("/api/v1/run/1"));
  const r = await api<{ n: number }>("/api/v1/run/1", { fresh: true });
  assert.equal(r.n, 2);
  assert.equal(calls.length, 2);
});

test("an ask ahead of a click is used by the page's first ask, once", async () => {
  await asksAhead(() => api("/api/v1/p"));
  assert.equal(calls.length, 1);
  const first = await api<{ n: number }>("/api/v1/p");                    // the click
  assert.equal(first.n, 1); assert.equal(calls.length, 1);                // no second request
  await new Promise(r => setTimeout(r, 1_050));
  const second = await api<{ n: number }>("/api/v1/p");                   // a later reload
  assert.equal(second.n, 2); assert.equal(calls.length, 2);
});

test("an ask for what is already on its way waits for that one", async () => {
  let go!: () => void; hold = new Promise(r => { go = r; });
  asksAhead(() => api("/api/v1/p")).catch(() => {});
  const page = api<{ n: number }>("/api/v1/p");
  go();
  assert.equal((await page).n, 1);
  assert.equal(calls.length, 1);
});

test("asking ahead twice, or for what was just fetched, sends one request", async () => {
  await asksAhead(() => api("/api/v1/p"));
  await asksAhead(() => api("/api/v1/p"));
  assert.equal(calls.length, 1);
});

test("a write clears what it could have changed, here and after it ends", async () => {
  await api("/api/v1/alerts:summary"); await api("/api/v1/alerts?status=new&limit=200"); await api("/api/v1/overview"); await api("/api/v1/monitors");
  await api("/api/v1/alerts/al-1:ack", { method: "POST", json: {} });
  assert.equal(peek(() => api("/api/v1/alerts:summary")), undefined);
  assert.equal(peek(() => api("/api/v1/alerts?status=new&limit=200")), undefined);
  assert.equal(peek(() => api("/api/v1/overview")), undefined);
  assert.ok(peek(() => api("/api/v1/monitors")));                         // unrelated: stays
  assert.equal(calls.at(-1), "POST /api/v1/alerts/al-1:ack");
});

test("an answer that was on its way when a write happened is not stored", async () => {
  let go!: () => void; hold = new Promise(r => { go = r; });
  const slow = api("/api/v1/alerts:summary");                             // asked before the write
  await new Promise(r => setTimeout(r, 0));
  hold = null;
  await api("/api/v1/alerts/al-1:ack", { method: "POST", json: {} });
  go(); await slow;
  assert.equal(peek(() => api("/api/v1/alerts:summary")), undefined);     // it may predate the change
});

test("the page is told it is waiting for its own reads, not for passive ones or asks ahead", async () => {
  const seen: number[] = [];
  const off = subscribeWaiting(() => seen.push(waitingCount()));
  let go!: () => void; hold = new Promise(r => { go = r; });
  const a = api("/api/v1/a"), b = quietly(() => api("/api/v1/b")), c = asksAhead(() => api("/api/v1/c"));
  assert.equal(waitingCount(), 1);
  go(); await Promise.all([a, b, c]); await new Promise(r => setTimeout(r, 0));
  assert.equal(waitingCount(), 0);
  assert.deepEqual(seen, [1, 0]);
  off();
});

test("a poll (fresh) isn't something the page is waiting for either", async () => {
  let go!: () => void; hold = new Promise(r => { go = r; });
  const p = api("/api/v1/run/1", { fresh: true });
  assert.equal(waitingCount(), 0);
  go(); await p;
});

test("an error is not stored", async () => {
  (globalThis as any).fetch = async () => new Response(JSON.stringify({ status: 500, code: "boom", detail: "no" }), { status: 500, headers: { "content-type": "application/json" } });
  await assert.rejects(api("/api/v1/x"));
  assert.equal(peek(() => api("/api/v1/x")), undefined);
});

test("warm: asks once, joins an ask on its way, and is done at once for what is already here", async () => {
  let go!: () => void; hold = new Promise(r => { go = r; });
  asksAhead(() => api("/api/v1/w")).catch(() => {});             // a hover's prefetch, still on its way
  let done = false;
  const w = warm("/api/v1/w").then(() => { done = true; });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(done, false); assert.equal(calls.length, 1);      // it waits for that one: no second request
  go(); await w;
  assert.equal(done, true);
  await warm("/api/v1/w");                                       // in the cache now: nothing to wait for
  assert.equal(calls.length, 1);
  const page = await api<{ n: number }>("/api/v1/w");            // and the page's first ask takes it
  assert.equal(page.n, 1); assert.equal(calls.length, 1);
});

test("warm never rejects, and a warmed ask isn't counted as the page waiting", async () => {
  (globalThis as any).fetch = async () => { throw new Error("down"); };
  const before = waitingCount();
  await warm("/api/v1/broken");
  assert.equal(waitingCount(), before);
});

test("holdWaiting lights the progress line's count and puts it out", () => {
  const seen: number[] = [];
  const off = subscribeWaiting(() => seen.push(waitingCount()));
  holdWaiting(1); holdWaiting(-1);
  off();
  assert.deepEqual(seen, [1, 0]);
});
