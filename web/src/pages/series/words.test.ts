// Run with `node --test src/pages/series/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  asRefusal, barFill, ledeParts, listNotice, matchesQuery, moveLine, oneDayZ, placesLine, refusalTitle, rowState, seriesNotes, seriesNotice, seriesType,
  shortMeaning, sortSeries, tabCounts, tabOf, takeaway, trackPos, typeOptions, windowWord,
} from "./words.ts";

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
  assert.equal(seriesNotice(o), "No new price since 10 Nov 03:00. Your Platform Admin has been told.");
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

const row = (name: string, state: string, z: number | null, extra: object = {}) => ({
  series_id: name, name, symbol: name.slice(0, 3).toUpperCase(), state, state_reason: "", instrument: { type: "ETF" },
  latest: z === null ? null : { windows: [{ days: 1, z }] }, fetch: { last_status: "ok" }, ...extra,
});

test("the list: unusual first, late, warming up, normal by size, paused last", () => {
  const xs = [row("Paused one", "paused", null), row("Calm", "normal", 0.5), row("Busy", "normal", 1.4), row("Wait", "warming_up", null),
    row("Late one", "stale", null), row("Small move", "moved", -3.2), row("Big move", "moved", 4.1), row("New", "pending", null)];
  assert.deepEqual(sortSeries(xs).map(x => x.name), ["Big move", "Small move", "Late one", "New", "Wait", "Busy", "Calm", "Paused one"]);
});

test("the tabs count each state once; pending counts as warming up", () => {
  const c = tabCounts([{ state: "moved" }, { state: "stale" }, { state: "pending" }, { state: "warming_up" }, { state: "normal" }, { state: "normal" }, { state: "paused" }]);
  assert.deepEqual(c, { all: 7, moved: 1, stale: 1, warming: 2, normal: 2, paused: 1 });
  assert.equal(tabOf("pending"), "warming");
});

test("types for the filter", () => {
  assert.equal(seriesType({ instrument: { type: "ETF" }, symbol: "UNG" }), "Funds");
  assert.equal(seriesType({ instrument: { type: "Physical Currency" }, symbol: "EUR/USD" }), "FX");
  assert.equal(seriesType({ instrument: {}, symbol: "EUR/USD" }), "FX");
  assert.equal(seriesType({ instrument: { type: "Digital Currency" }, symbol: "BTC/USD" }), "Crypto");
  assert.equal(seriesType({ instrument: { type: "Common Stock" }, symbol: "AAPL" }), "Stocks");
  assert.equal(seriesType({ instrument: {}, symbol: "XAU" }), "Other");
  assert.deepEqual(typeOptions([{ instrument: {}, symbol: "XAU" }, { instrument: { type: "ETF" }, symbol: "A" }, { instrument: { type: "ETF" }, symbol: "B" }]), ["Funds", "Other"]);
});

test("the Find box matches the name or the symbol", () => {
  const s = { name: "Natural gas fund", symbol: "UNG" };
  assert.ok(matchesQuery(s, "gas") && matchesQuery(s, " ung ") && matchesQuery(s, ""));
  assert.ok(!matchesQuery(s, "oil"));
});

test("the bar: the flag line is at three quarters, and a big move fills it", () => {
  assert.equal(barFill(3, 3), 0.75);
  assert.equal(barFill(4.1, 3), 1);
  assert.equal(barFill(-1.4, 3), 0.35);
  assert.equal(barFill(null, 3), 0);
});

test("the state column", () => {
  assert.deepEqual(rowState(row("a", "moved", 4), null), { label: "Unusual", tone: "unusual", mark: "◆" });
  assert.equal(rowState(row("a", "stale", null), "09:00").label, "Late · since 09:00");
  assert.equal(rowState(row("a", "stale", null), null).label, "Late");
  assert.equal(rowState(row("a", "stale", null), "10 Nov 03:00").label, "Late · 10 Nov");
  assert.equal(rowState(row("a", "normal", 1), null).tone, null);
  assert.equal(rowState(row("a", "normal", 1, { fetch: { last_status: "error" } }), null).label, "Update failed");
});

test("the heading's line", () => {
  const o = { unusual: 3, late: 1, total: 22, max: 30, everyMinutes: 60, lastRun: "11:00", threshold: 3 };
  assert.deepEqual(ledeParts(o), { strong: "3 unusual", rest: "1 late · 22 of 30 series · checked every hour, last 11:00 · a move over 3× a usual day becomes a finding" });
  assert.equal(ledeParts({ ...o, unusual: 0, late: 0, total: 0 }).rest.slice(0, 13), "no series yet");
  assert.deepEqual(ledeParts({ ...o, unusual: 0, late: 0, max: null, everyMinutes: null }), { strong: null, rest: "22 series · a move over 3× a usual day becomes a finding" });
});

test("refusals keep the server's detail and the provider's words", () => {
  assert.equal(refusalTitle("provider_daily_budget_reached"), "Today's price credits are used up");
  assert.equal(refusalTitle("demo_locked"), undefined);
  assert.deepEqual(asRefusal({ code: "x", full: "No. Twelve Data said: “busy”", message: "No." }), { code: "x", detail: "No. Twelve Data said: “busy”" });
  assert.equal(asRefusal("plain"), "plain");
});

test("what the open series says about itself", () => {
  const base = { state: "normal", reason: "", since: null, failed: null, retryAt: null, admin: false };
  assert.deepEqual(seriesNotes(base), []);
  assert.equal(seriesNotes({ ...base, state: "stale", since: "09:00" })[0].text, "No new price since 09:00.");
  const failed = { code: "rate_limit", http: 429, message: "too many calls" };
  assert.match(seriesNotes({ ...base, state: "stale", since: "09:00", failed, retryAt: "12:00" })[1].text, /HTTP 429\); trying again at 12:00/);
  assert.match(seriesNotes({ ...base, failed, admin: true })[0].text, /Twelve Data said: rate_limit 429: too many calls\./);
  assert.match(seriesNotes({ ...base, state: "warming_up", reason: "18 of 20 trading days needed to know a typical move." })[0].text, /^Needs more history before it can flag moves\. 18 of 20/);
  assert.equal(seriesNotes({ ...base, state: "moved", reason: "Flagged 09:00; quiet until 21:00." })[0].text, "Flagged 09:00; quiet until 21:00.");
});

test("the chart's takeaway and the small words", () => {
  assert.equal(takeaway("UNG", [10, 11], "the month", 1), "UNG up over the month (+10.00%)");
  assert.equal(takeaway("UNG", [10, 10.01], "the week", 1.6), "UNG flat over the week (+0.10%)");
  assert.equal(takeaway("UNG", [10], "the week", 1), "UNG");
  assert.equal(placesLine(["Texas", "Louisiana"]), "Texas, Louisiana");
  assert.equal(placesLine(["a", "b", "c", "d", "e"]), "a, b, c +2");
  assert.equal(windowWord(1), "1 day");
  assert.equal(windowWord(3), "3 days");
});
