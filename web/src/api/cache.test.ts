import { test } from "node:test";
import assert from "node:assert/strict";
import { invalidationFor, MAX_AGE_MS, SwrCache } from "./cache.ts";

const clock = () => { let t = 1_000_000; return { now: () => t, tick: (ms: number) => { t += ms; } }; };

test("a stored answer comes back, until it is older than the limit", () => {
  const c = clock(), k = new SwrCache(c.now);
  k.set("/a", { n: 1 });
  assert.deepEqual(k.peek("/a"), { n: 1 });
  c.tick(MAX_AGE_MS - 1);
  assert.deepEqual(k.peek("/a"), { n: 1 });
  c.tick(2);
  assert.equal(k.peek("/a"), undefined);   // never shown older than 5 minutes
  assert.equal(k.size, 0);                 // and dropped
});

test("a newer answer replaces the old one and restarts its age", () => {
  const c = clock(), k = new SwrCache(c.now);
  k.set("/a", 1); c.tick(MAX_AGE_MS - 10); k.set("/a", 2); c.tick(100);
  assert.equal(k.peek("/a"), 2);
});

test("invalidation drops every key that starts with a prefix, and only those", () => {
  const k = new SwrCache();
  for (const key of ["/api/v1/alerts:summary", "/api/v1/alerts?status=new&limit=200", "/api/v1/alerts/a1", "/api/v1/overview", "/api/v1/events?limit=200", "/api/v1/monitors"]) k.set(key, 1);
  const n = k.invalidate(["/api/v1/alerts", "/api/v1/overview", "/api/v1/events"]);
  assert.equal(n, 5);
  assert.deepEqual(k.keys(), ["/api/v1/monitors"]);
});

test("an invalidation bumps the epoch, so an answer on its way can be told apart", () => {
  const k = new SwrCache(); const e = k.epoch;
  k.invalidate(["/x"]); assert.equal(k.epoch, e + 1);
  k.clear(); assert.equal(k.epoch, e + 2);
});

test("the cap drops the least recently used", () => {
  const c = clock(), k = new SwrCache(c.now, MAX_AGE_MS, 3);
  k.set("/1", 1); c.tick(1); k.set("/2", 2); c.tick(1); k.set("/3", 3); c.tick(1);
  k.peek("/1"); c.tick(1);                // /1 was read last: /2 is the oldest use
  k.set("/4", 4);
  assert.deepEqual(k.keys().sort(), ["/1", "/3", "/4"]);
  assert.equal(k.size, 3);
});

test("an answer fetched ahead is handed to a page's first ask once, within its window", () => {
  const c = clock(), k = new SwrCache(c.now);
  k.set("/a", "ahead", true);
  assert.equal(k.takeAhead("/a")?.value, "ahead");
  assert.equal(k.takeAhead("/a")?.value, "ahead");     // the same page asking again at once (a double mount) takes it too
  c.tick(1_500);
  assert.equal(k.takeAhead("/a"), undefined);          // spare no more: the next ask goes to the server
  assert.equal(k.peek("/a"), "ahead");                 // but it still shows
  k.set("/b", "old", true); c.tick(20_000);
  assert.equal(k.takeAhead("/b"), undefined);          // the click came too late: ask again
  k.set("/c", "page's own"); assert.equal(k.takeAhead("/c"), undefined);   // only an answer fetched ahead is spare
});

test("which prefixes a write clears", () => {
  assert.deepEqual(invalidationFor("/api/v1/alerts/al-1:ack"), ["/api/v1/alerts", "/api/v1/overview", "/api/v1/events"]);
  assert.deepEqual(invalidationFor("/api/v1/alerts/al-1:resolve?x=1"), ["/api/v1/alerts", "/api/v1/overview", "/api/v1/events"]);
  const m = invalidationFor("/api/v1/monitors/mon-1:approve")!;
  for (const p of ["/api/v1/monitors", "/api/v1/overview", "/api/v1/findings", "/api/v1/monitor-checks"]) assert.ok(m.includes(p), p);
  assert.ok(invalidationFor("/api/v1/series")!.includes("/api/v1/series"));
  assert.ok(invalidationFor("/api/v1/investigations")!.includes("/api/v1/investigation"));   // :status too
  assert.ok(invalidationFor("/api/v1/institutions/x:batch")!.includes("/api/v1/installation"));
});

test("a write to something unknown, or to the sign-in, clears everything", () => {
  assert.equal(invalidationFor("/api/v1/auth/logout"), null);
  assert.equal(invalidationFor("/api/v1/assistant/run_sse"), null);
  assert.equal(invalidationFor("/somewhere/else"), null);
  assert.equal(invalidationFor("/api/v1/"), null);
});
