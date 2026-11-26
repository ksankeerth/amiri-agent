import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canReach, fadesBetween, foundOf, foundState, getDrawnPath, LatestWait, MAX_SCROLL_ENTRIES, pageGroup, ScrollMemory, scrollPlan, setDrawnPath,
  subscribeDrawnPath, WAIT_LINE_MS, WAIT_MAX_MS,
} from "./routeMotion.ts";

test("a row picked in a list beside its pane is the same page; another page is another", () => {
  assert.equal(fadesBetween("/monitors", "/monitors/mon-1"), false);
  assert.equal(fadesBetween("/monitors/mon-1", "/monitors/mon-2"), false);
  assert.equal(fadesBetween("/series", "/series/qqq"), false);
  assert.equal(fadesBetween("/studio", "/studio/scn-1"), false);
  assert.equal(fadesBetween("/institution", "/institution/customers"), false);
  assert.equal(fadesBetween("/alerts", "/alerts"), false);
  assert.equal(fadesBetween("/home", "/alerts"), true);
  assert.equal(fadesBetween("/events", "/events/ev-1"), true);       // the list and the event are two pages
  assert.equal(fadesBetween("/events/ev-1", "/events/ev-2"), false);
  assert.equal(fadesBetween("/studio/scn-1", "/studio/run/sim-1"), true);
  assert.equal(fadesBetween("/institution", "/institution/setup"), true);
  assert.equal(fadesBetween("/admin/data", "/admin/settings"), true);
  assert.equal(pageGroup("/alerts/"), "/alerts");
});

test("scroll is remembered per history entry and carried across a filter", () => {
  const m = new ScrollMemory();
  m.set("k1", 640.4); assert.equal(m.get("k1"), 640);
  m.carry("k1", "k2"); assert.equal(m.get("k2"), 640);
  m.set("k2", 10); m.carry("k1", "k2"); assert.equal(m.get("k2"), 10);   // an entry that has its own place keeps it
  m.set("k3", -5); assert.equal(m.get("k3"), 0);
  m.set("bad", NaN); assert.equal(m.get("bad"), undefined);
});

test("scroll memory keeps the newest entries, and survives a round trip through JSON", () => {
  const m = new ScrollMemory();
  for (let i = 0; i < MAX_SCROLL_ENTRIES + 20; i++) m.set(`k${i}`, i);
  assert.equal(m.get("k0"), undefined);
  assert.equal(m.get(`k${MAX_SCROLL_ENTRIES + 19}`), MAX_SCROLL_ENTRIES + 19);
  const back = ScrollMemory.from(JSON.parse(JSON.stringify(m)));
  assert.equal(back.get("k50"), 50);
  assert.equal(ScrollMemory.from("junk").get("k1"), undefined);
  assert.equal(ScrollMemory.from([["a", "x"], 3, ["b", 7]]).get("b"), 7);
});

test("what to do with the scroll", () => {
  const base = { samePath: false, pop: false, hash: false, saved: undefined as number | undefined };
  assert.deepEqual(scrollPlan({ ...base, samePath: true, saved: 300 }), { kind: "keep" });
  assert.deepEqual(scrollPlan({ ...base, pop: true, saved: 300 }), { kind: "restore", top: 300 });
  assert.deepEqual(scrollPlan({ ...base, pop: true }), { kind: "top" });                 // back to an entry never scrolled
  assert.deepEqual(scrollPlan({ ...base, saved: 300 }), { kind: "top" });                // a new visit starts at the top
  assert.deepEqual(scrollPlan({ ...base, hash: true }), { kind: "keep" });
});

test("a page that is still filling can't be scrolled yet", () => {
  assert.equal(canReach(500, 400, 600), false);
  assert.equal(canReach(1200, 400, 600), true);
  assert.equal(canReach(1000, 400, 600), true);
});

test("the item to find travels in the navigation state", () => {
  assert.deepEqual(foundOf(foundState("#mn-row-1")), { sel: "#mn-row-1" });
  assert.equal(foundState(null), undefined);
  assert.equal(foundOf(null), null);
  assert.equal(foundOf({ found: { sel: 3 } }), null);
});

// ---------------------------------------------------------------- the wait for data (F4b)

test("the wait is 250 ms at most, and the line shows after 150", () => {
  assert.equal(WAIT_MAX_MS, 250);
  assert.equal(WAIT_LINE_MS, 150);
});

test("a wait ends as soon as everything it waits for has answered", async () => {
  const w = new LatestWait();
  const t0 = Date.now();
  const r = await w.run([new Promise(res => setTimeout(res, 10)), Promise.resolve(1)]);
  assert.equal(r, "ready");
  assert.ok(Date.now() - t0 < 150, "ended long before the 250 ms limit");
});

test("an empty list, and answers that failed, are ready too", async () => {
  const w = new LatestWait();
  assert.equal(await w.run([]), "ready");
  assert.equal(await w.run([Promise.reject(new Error("503")), Promise.resolve()]), "ready");   // the page shows its own error
});

test("a wait that isn't answered ends at 250 ms, not before", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const w = new LatestWait();
  let result: string | null = null;
  w.run([new Promise(() => {})]).then(r => { result = r; });
  t.mock.timers.tick(249); await Promise.resolve(); await Promise.resolve();
  assert.equal(result, null);
  t.mock.timers.tick(1); await Promise.resolve(); await Promise.resolve();
  assert.equal(result, "timeout");
});

test("the latest navigation wins: starting a wait ends the one before it", async () => {
  const w = new LatestWait();
  let release!: () => void;
  const slow = w.run([new Promise<void>(r => { release = r; })]);
  const fast = w.run([Promise.resolve()]);
  assert.equal(await slow, "stale");
  assert.equal(await fast, "ready");
  release();                                            // the first one's answers arriving late change nothing
  assert.equal(await w.run([]), "ready");
});

test("abort ends the wait at once", async () => {
  const w = new LatestWait();
  const p = w.run([new Promise(() => {})]);
  w.abort();
  assert.equal(await p, "stale");
});

test("the page on screen is told to whoever listens, once per change", () => {
  const seen: string[] = [];
  const off = subscribeDrawnPath(() => seen.push(getDrawnPath()));
  setDrawnPath("/alerts"); setDrawnPath("/alerts"); setDrawnPath("/events");
  off(); setDrawnPath("/home");
  assert.deepEqual(seen, ["/alerts", "/events"]);
  assert.equal(getDrawnPath(), "/home");
});
