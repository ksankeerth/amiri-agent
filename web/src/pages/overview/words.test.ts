// Run with `node --test src/pages/overview/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actMeta, ageText, arrowOf, findingPill, footprintView, foundMeta, greetingText, headlineKind, headlineText, lateSince, mapMarks, moreLine, mostSpecific,
  needAction, needLevelWord, othersText, placesText, plainNote, priceRows, storyPill, tracedMeta, watchingMeta,
} from "./words.ts";

test("the greeting follows the hour in the institution's zone, and says the date there", () => {
  const t = new Date("2026-11-24T05:30:00Z");  // 11:00 in Colombo, 23:30 the evening before in Chicago
  assert.equal(greetingText(t, "Asia/Colombo", "John"), "Good morning, John · Tuesday 24 November");
  assert.equal(greetingText(t, "America/Chicago", "John"), "Good evening, John · Monday 23 November");
  assert.equal(greetingText(new Date("2026-11-24T09:00:00Z"), "UTC", "John"), "Good morning, John · Tuesday 24 November");
  assert.equal(greetingText(new Date("2026-11-24T13:00:00Z"), "UTC", "John"), "Good afternoon, John · Tuesday 24 November");
  assert.equal(greetingText(t, "Not/AZone", ""), "Good morning · Tuesday 24 November");  // an unknown zone falls back to UTC
});

test("the headline is picked in the order alerts, open events, all clear, updates stopped", () => {
  assert.equal(headlineKind({ alerts: 3, events: 4, tickOk: true }), "alerts");
  assert.equal(headlineKind({ alerts: 1, events: 0, tickOk: false }), "alerts");
  assert.equal(headlineKind({ alerts: 0, events: 2, tickOk: true }), "quiet");
  assert.equal(headlineKind({ alerts: 0, events: 2, tickOk: false }), "quiet");
  assert.equal(headlineKind({ alerts: 0, events: 0, tickOk: true }), "clear");
  assert.equal(headlineKind({ alerts: 0, events: 0, tickOk: false }), "stopped");
});

test("the headline's words", () => {
  assert.deepEqual(headlineText("alerts", 3), { hot: "3 alerts", rest: "need your teams" });
  assert.deepEqual(headlineText("alerts", 1), { hot: "1 alert", rest: "needs your teams" });
  assert.deepEqual(headlineText("quiet", 0), { rest: "No alerts for your teams" });
  assert.deepEqual(headlineText("clear", 0), { rest: "All clear" });
  assert.deepEqual(headlineText("stopped", 0), { rest: "Nothing open right now" });
});

test("an event's age", () => {
  const now = new Date("2026-11-24T12:00:00Z");
  assert.equal(ageText("2026-11-24T11:59:30Z", now), "just now");
  assert.equal(ageText("2026-11-24T11:48:00Z", now), "12 min ago");
  assert.equal(ageText("2026-11-24T10:00:00Z", now), "2 h ago");
  assert.equal(ageText("2026-11-23T08:00:00Z", now), "yesterday");
  assert.equal(ageText("2026-11-20T12:00:00Z", now), "4 days ago");
  assert.equal(ageText(null, now), "");
});

test("the tiles' meta lines", () => {
  assert.equal(watchingMeta(7, 22, true), "7 monitors · 22 prices · Radar");
  assert.equal(watchingMeta(1, 1, false), "1 monitor · 1 price");
  assert.equal(foundMeta({ monitor: 9, timeseries: 3, radar: 6 }), "9 monitors · 3 prices · 6 Radar");
  assert.equal(foundMeta({ monitor: 0, timeseries: 0, radar: 0 }), "quiet in the last 24 h");
  assert.equal(tracedMeta(4, 14), "open events · 14 effects to watch");
  assert.equal(tracedMeta(1, 1), "open event · 1 effect to watch");
  assert.equal(actMeta(3, 2), "alerts for 2 teams");
  assert.equal(actMeta(1, 1), "alert for 1 team");
  assert.equal(actMeta(3, null), "alerts to review");
  assert.equal(actMeta(0, 0), "all caught up");
});

test("under an event: what else it could move, and what joined later", () => {
  assert.equal(moreLine(5, 3, 3), "+2 more effects · 3 later findings joined");
  assert.equal(moreLine(4, 3, 0), "+1 more effect");
  assert.equal(moreLine(3, 3, 1), "1 later finding joined");
  assert.equal(moreLine(2, 2, 0), "");
});

test("an arrow is read as a word", () => {
  assert.deepEqual(arrowOf("rise"), { glyph: "↑", word: "rises" });
  assert.deepEqual(arrowOf("fall"), { glyph: "↓", word: "falls" });
  assert.equal(arrowOf(null), null);
});

test("places in a row", () => {
  assert.equal(placesText(["Texas"]), "Texas");
  assert.equal(placesText(["Saudi Arabia", "Iran", "Qatar"]), "Saudi Arabia +2");
  assert.equal(placesText(["Texas", "Texas"], 2), "Texas");
  assert.equal(placesText([]), "");
});

test("the map: the worst tone wins at a place, neutral events add no mark, the first event's place is marked first", () => {
  const marks = mapMarks([
    { tone: "neutral", places: ["GB"] },
    { tone: "mixed", places: ["TX", "CA"] },
    { tone: "bad", places: ["TX", "AU"] },
    { tone: "good", places: ["CA", "OK"] },
  ]);
  assert.deepEqual(marks.map(m => [m.code, m.tone]), [["TX", "bad"], ["CA", "mixed"], ["AU", "bad"], ["OK", "good"]]);
  assert.deepEqual(marks.filter(m => m.first).map(m => m.code), ["TX"]);
  assert.deepEqual(mapMarks([{ tone: "neutral", places: ["GB"] }]), []);
});

const P = (code: string, kind: string, parent: string | null, country: string | null, lat: number, lon: number, name: string, numeric: string | null = null) =>
  [code, { code, name, kind, parent, country, lat, lon, numeric }] as const;
const US_PLACES = Object.fromEntries([
  P("US", "country", null, "US", 37.09, -95.71, "United States", "840"), P("US-TX", "state", "US", "US", 31, -99.9, "Texas"),
  P("US-CA", "state", "US", "US", 36.78, -119.42, "California"), P("city:austin", "city", "US-TX", "US", 30.27, -97.74, "Austin"),
  P("AE", "country", null, "AE", 23.4, 53.8, "United Arab Emirates", "784"), P("chk:hormuz", "chokepoint", null, null, 26.57, 56.25, "Strait of Hormuz"),
  P("LK", "country", null, "LK", 7.87, 80.77, "Sri Lanka", "144"),
]);

test("an event is marked on the most specific place it has: a city over its state over its country", () => {
  assert.deepEqual(mostSpecific(["US", "US-TX"], US_PLACES), ["US-TX"]);
  assert.deepEqual(mostSpecific(["US", "US-TX", "city:austin"], US_PLACES), ["city:austin"]);
  assert.deepEqual(mostSpecific(["US-TX", "US-CA", "US"], US_PLACES), ["US-TX", "US-CA"]);
  assert.deepEqual(mostSpecific(["AE", "chk:hormuz"], US_PLACES), ["AE", "chk:hormuz"]);
  assert.deepEqual(mostSpecific(["US", "AE"], US_PLACES), ["US", "AE"]);
});

test("an event tagged only with the home country is marked on the home anchor as nationwide", () => {
  const ctx = { places: US_PLACES, home: "US", anchor: "US-TX" };
  const marks = mapMarks([
    { title: "Rates rose", tone: "bad", places: ["US"] },
    { title: "Prices down", tone: "mixed", places: ["US"] },
    { title: "Oil stress", tone: "bad", places: ["AE", "chk:hormuz"] },
  ], ctx);
  assert.deepEqual(marks.map(m => [m.code, m.tone, m.nationwide, m.specific]), [["US-TX", "bad", 2, false], ["AE", "bad", 0, true], ["chk:hormuz", "bad", 0, true]]);
  assert.equal(marks[0].first, true);
  // the hover lists every event at a mark, worst first
  assert.deepEqual(marks[0].events, [{ title: "Rates rose", tone: "bad" }, { title: "Prices down", tone: "mixed" }]);
  // never the country's middle
  assert.ok(!marks.some(m => m.code === "US"));
  // an event with a state of its own marks that state, not "nationwide"
  const own = mapMarks([{ title: "Texas grid", tone: "bad", places: ["US", "US-CA"] }], ctx);
  assert.deepEqual(own.map(m => [m.code, m.nationwide]), [["US-CA", 0]]);
  // without an anchor the home country's own spot is used, still as nationwide (a Sri Lankan bank)
  const lk = mapMarks([{ title: "Rates rose", tone: "bad", places: ["LK"] }], { places: US_PLACES, home: "LK", anchor: null });
  assert.deepEqual(lk.map(m => [m.code, m.nationwide]), [["LK", 1]]);
  // a foreign country is just that country
  const ae = mapMarks([{ title: "x", tone: "bad", places: ["AE"] }], { places: US_PLACES, home: "LK", anchor: null });
  assert.deepEqual(ae.map(m => [m.code, m.nationwide]), [["AE", 0]]);
});

test("nationwide and specific events at one place share one mark; a place with no position uses its parent's", () => {
  const ctx = { places: { ...US_PLACES, "city:nowhere": { code: "city:nowhere", name: "Nowhere", kind: "city", parent: "US-TX", country: "US", lat: null, lon: null, numeric: null } }, home: "US", anchor: "US-TX" };
  const m = mapMarks([{ title: "a", tone: "mixed", places: ["US"] }, { title: "b", tone: "bad", places: ["US-TX"] }, { title: "c", tone: "good", places: ["city:nowhere"] }], ctx);
  assert.deepEqual(m.map(x => [x.code, x.tone, x.nationwide, x.specific]), [["US-TX", "bad", 1, true]]);
});

test("the footprint: a country is shaded, states get halos and the busiest home state is the anchor", () => {
  const us = footprintView("US", [{ code: "US", role: "home" }, { code: "US-TX", role: "branches", branch_count: 22 }, { code: "US-CA", role: "branches", branch_count: 2 }], US_PLACES);
  assert.deepEqual(us.countries, []);  // the US has states listed: halos, not the whole country
  assert.deepEqual(us.halos.map(h => [h.code, h.r]), [["US-TX", 4.5], ["US-CA", 4.5]]);
  assert.equal(us.anchor?.code, "US-TX");
  assert.deepEqual(us.names, ["Texas", "California"]);
  const lk = footprintView("LK", [{ code: "LK", role: "home" }], US_PLACES);
  assert.deepEqual(lk.countries, ["144"]);
  assert.deepEqual(lk.halos, []);
  assert.equal(lk.anchor?.code, "LK");
  assert.deepEqual(lk.names, ["Sri Lanka"]);
  assert.deepEqual(lk.labels.map(l => l.name), ["Sri Lanka"]);  // the footprint's name is written on the map
  const two = footprintView("AE", [{ code: "AE", role: "home" }, { code: "LK", role: "branches" }], US_PLACES);
  assert.deepEqual(two.countries, ["784", "144"]);
  assert.equal(two.anchor?.code, "AE");
  const city = footprintView("US", [{ code: "city:austin", role: "home" }], US_PLACES);
  assert.deepEqual(city.halos.map(h => h.r), [1.2]);
  assert.equal(city.anchor?.code, "city:austin");
  assert.deepEqual(footprintView("ZZ", [], {}), { countries: [], halos: [], anchor: null, names: [], labels: [] });
});

test("a finding's status as a pill", () => {
  assert.deepEqual(findingPill({ status: "linked", event_id: "e1", reason: null }), { word: "In an event", tone: "good" });
  assert.deepEqual(findingPill({ status: "grouped", event_id: null, reason: null }), { word: "Being investigated", tone: "neutral" });
  assert.deepEqual(findingPill({ status: "new", event_id: null, reason: null }), { word: "Waiting", tone: "neutral" });
  assert.deepEqual(findingPill({ status: "set_aside", event_id: null, reason: "no_impact" }), { word: "No impact found", tone: "neutral" });
  assert.deepEqual(findingPill({ status: "set_aside", event_id: null, reason: "investigation_failed" }), { word: "Couldn't be investigated", tone: "unusual", why: "the investigation agent didn't answer" });
});

test("a Radar story's status as a pill", () => {
  assert.equal(storyPill({ status: "sent", event_id: "e" }).word, "In an event");
  assert.equal(storyPill({ status: "sent", event_id: null }).word, "Being investigated");
  assert.equal(storyPill({ status: "below", event_id: null }).word, "Not sent this run");
  assert.equal(storyPill({ status: "dismissed", event_id: null }).word, "Dismissed");
});

test("when a price stopped, from the server's note", () => {
  assert.equal(lateSince("No new bar since 09:00 (2 market hours; stale after 6)."), "09:00");
  assert.equal(lateSince("No new bar since 10 Nov 12:30 (252 market hours; stale after 6)."), "10 Nov 12:30");
  assert.equal(lateSince(null), null);
  assert.equal(lateSince("Provider sent nothing new"), null);
});

const mk = (id: string, state: string, change: number | null) => ({ series_id: id, name: id, state, state_reason: null, close: 1, change_1d_pct: change, spark: [] });
test("the prices that earn a row: unusual, then late, then the biggest movers when nothing is odd", () => {
  const all = [mk("a", "normal", 0.2), mk("b", "moved", 6.4), mk("c", "stale", 0.1), mk("d", "normal", -1), mk("e", "moved", -5.2)];
  const r = priceRows(all, 4);
  assert.deepEqual(r.shown.map(m => m.series_id), ["b", "e", "c"]);
  assert.equal(r.unusual, 2); assert.equal(r.late, 1); assert.equal(r.others, 2); assert.equal(r.othersNormal, true);
  const calm = priceRows([mk("a", "normal", 0.2), mk("b", "normal", -3), mk("c", "normal", 1), mk("d", "normal", 0.1)], 4);
  assert.deepEqual(calm.shown.map(m => m.series_id), ["b", "c", "a"]);
  assert.equal(calm.unusual, 0);
  const many = priceRows(Array.from({ length: 6 }, (_, i) => mk(`m${i}`, "moved", i)), 4);
  assert.equal(many.shown.length, 4); assert.equal(many.othersNormal, false); assert.equal(many.others, 2);
  assert.deepEqual(priceRows([], 4).shown, []);
});

test("a Needs-you row: the button word, and the level read aloud", () => {
  assert.equal(needAction("approval"), "Review");
  assert.equal(needAction("series"), "Open");
  assert.equal(needLevelWord("crit"), "Urgent: ");
  assert.equal(needLevelWord("warn"), "Needs attention: ");
  assert.equal(needLevelWord("info"), "");
});

test("a server note about late prices in plain words", () => {
  assert.equal(plainNote("USD/LKR: No new bar since 10 Nov 12:30 (252 market hours; stale after 6)."), "USD/LKR: no new price since 10 Nov 12:30");
  assert.equal(plainNote("2 recommendations for the profile"), "2 recommendations for the profile");
});

test("the line under the prices", () => {
  assert.equal(othersText(18, true), "18 others normal");
  assert.equal(othersText(1, true), "1 other normal");
  assert.equal(othersText(3, false), "3 more");
  assert.equal(othersText(0, true), "");
});
