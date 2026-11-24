// Run with `node --test src/pages/series/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { listNotice, moveLine, oneDayZ, seriesNotice, shortMeaning, trackPos } from "./words.ts";

test("the day's z is the one-day window's, not the largest", () => {
  const latest = { windows: [{ days: 1, z: 0.28 }, { days: 3, z: 0.701 }, { days: 5, z: -0.061 }] };
  assert.equal(oneDayZ(latest), 0.28);
  assert.equal(oneDayZ({ windows: [] }), null);
  assert.equal(oneDayZ(null), null);
});

test("a track puts 0 at the left, the flag line before the end, and clamps beyond", () => {
  assert.equal(trackPos(0, 3), 0);
  assert.ok(Math.abs(trackPos(-3, 3) - 3 / 4.2) < 1e-9);
  assert.equal(trackPos(9, 3), 1);
});

test("what a move means, short", () => {
  assert.equal(shortMeaning("A rise means a weaker rupee, a fall a stronger one"), "A rise means a weaker rupee");
  assert.equal(shortMeaning("oil: a rise means up"), "Oil: a rise means up");
  assert.equal(shortMeaning("Commodity price (oil): a rise means up, a fall means down"), "Oil: a rise means up");
});

test("the list says 'not updated' once", () => {
  const o = { total: 4, stale: 4, oldestDay: "10 Nov", configured: false, admin: false };
  assert.equal(listNotice(o), "Prices haven't updated since 10 Nov. Your Platform Admin has been told.");
  assert.equal(listNotice({ ...o, stale: 1 }), "1 of 4 prices haven't updated; the oldest since 10 Nov. Your Platform Admin has been told.");
  assert.match(listNotice({ ...o, admin: true })!, /^Prices haven't updated since 10 Nov\. Twelve Data isn't configured/);
  assert.equal(listNotice({ ...o, stale: 0, configured: true }), null);
  assert.equal(listNotice({ ...o, stale: 0 }), "Prices can't be updated right now. Your Platform Admin has been told.");
});

test("the series page says its one problem once", () => {
  const o = { stale: true, since: "10 Nov 03:00", configured: true, admin: false, failed: null };
  assert.equal(seriesNotice(o), "Not updated since 10 Nov 03:00. Your Platform Admin has been told.");
  assert.equal(seriesNotice({ ...o, stale: false }), null);
  const failed = { at: "10 Nov 12:30", code: "rate_limit", http: 429, message: "too many calls" };
  assert.match(seriesNotice({ ...o, stale: false, failed })!, /last price update failed/);
  assert.match(seriesNotice({ ...o, admin: true, failed })!, /rate_limit 429: too many calls\.$/);
});

test("a flagged move in a line", () => {
  const sig = { change_pct: -13.0979, window_days: 3, z: -3.315, direction: "down" };
  assert.equal(moveLine({ title: "t", evidence: { signals: [sig] } }), "Down 13.10% in 3 trading days (3.3× typical)");
  assert.equal(moveLine({ title: "Brent fell", evidence: null }), "Brent fell");
});
