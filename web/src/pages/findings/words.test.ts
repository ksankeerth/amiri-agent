// Run with `node --test src/pages/findings/words.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FindingRow } from "../../api/investigation";
import {
  bySource, groupMeta, hiddenIn, investigationDidntRun, kindOf, landed, makeGroups, moreWords, noImpactWhy, notInvestigatedLine, onItsWay, retryWord, rowLink, shownIn,
  signalOf, sourceLink, sourceWords, tabCounts, triesOf, whenColumn,
} from "./words.ts";

const f = (id: string, status: FindingRow["status"], more: Partial<FindingRow> = {}): FindingRow => ({
  finding_id: id, world: "live", source: "monitor", kind: "news_match", title: id, explanation: "", score: 60, themes: [], places: [], status,
  run_id: null, outcome: null, created_at: "2026-11-24T10:00:00Z", ...more });
const inEvent = (id: string, ev: string, at = "2026-11-24T10:00:00Z") => f(id, "linked", { outcome: { event_id: ev }, created_at: at });

test("each status is one kind; a run the agent refused is not 'no impact'", () => {
  assert.equal(kindOf(f("a", "new")), "waiting");
  assert.equal(kindOf(f("a", "grouped")), "investigating");
  assert.equal(kindOf(inEvent("a", "e1")), "event");
  assert.equal(kindOf(f("a", "set_aside", { outcome: { reason: "no_theme" } })), "noimpact");
  assert.equal(kindOf(f("a", "set_aside", { outcome: { reason: "investigation_failed" } })), "failed");
  // older rows carry only the note
  assert.equal(kindOf(f("a", "set_aside", { outcome: { note: "the agent refused or couldn't take the run: HTTP 422" } })), "failed");
  assert.equal(kindOf(f("a", "set_aside", { outcome: { note: "XAU: a currency the institution doesn't book in", reason: "not_home_country" } })), "noimpact");
  assert.equal(investigationDidntRun(f("a", "linked")), false);
});

test("the tabs count what the source filter lets through", () => {
  const xs = [f("a", "new"), f("b", "new", { source: "radar" }), f("c", "grouped", { source: "timeseries" }), inEvent("d", "e1"), f("e", "set_aside", { outcome: { reason: "no_theme" } }),
    f("g", "set_aside", { outcome: { reason: "investigation_failed" } })];
  assert.deepEqual(tabCounts(xs), { all: 6, waiting: 2, investigating: 1, event: 1, noimpact: 1, failed: 1 });
  assert.equal(tabCounts(bySource(xs, "radar")).all, 1);
  assert.equal(bySource(xs, "all").length, 6);
  assert.deepEqual(tabCounts(bySource(xs, "monitor")), { all: 4, waiting: 1, investigating: 0, event: 1, noimpact: 1, failed: 1 });
});

test("groups: waiting, being investigated, couldn't investigate, events (most serious first), no impact", () => {
  const xs = [
    f("n1", "set_aside", { outcome: { reason: "no_theme" } }), inEvent("g1", "good", "2026-11-23T10:00:00Z"), inEvent("b1", "bad", "2026-11-22T10:00:00Z"),
    f("w1", "new"), f("i1", "grouped"), f("x1", "set_aside", { outcome: { reason: "investigation_failed" } }), inEvent("m1", "mixed"),
    inEvent("b2", "bad", "2026-11-21T10:00:00Z"), inEvent("m2", "mixed"), inEvent("m3", "mixed"),
  ];
  const tone = (id: string) => ({ good: "good", bad: "bad", mixed: "mixed" } as Record<string, string>)[id];
  const g = makeGroups(xs, "all", tone);
  assert.deepEqual(g.map(x => x.key), ["waiting", "investigating", "bad", "mixed", "good", "noimpact", "failed"]);
  assert.deepEqual(g.find(x => x.key === "bad")!.items.map(x => x.finding_id), ["b1", "b2"]);  // newest first
  // within a tone, the group with more findings goes first
  const t = makeGroups([inEvent("a", "e1"), inEvent("b", "e2"), inEvent("c", "e2")], "event", () => "bad");
  assert.deepEqual(t.map(x => x.key), ["e2", "e1"]);
});

test("a tab shows only its own group; a finding in no known event still groups", () => {
  const xs = [f("w1", "new"), inEvent("a", "e1"), f("l", "linked")];
  assert.deepEqual(makeGroups(xs, "waiting").map(x => x.key), ["waiting"]);
  assert.deepEqual(makeGroups(xs, "event").map(x => x.key).sort(), ["e1", "none"]);
  assert.equal(makeGroups(xs, "event").find(x => x.key === "none")!.eventId, undefined);
  assert.deepEqual(makeGroups([], "all"), []);
});

test("folding: an event shows its newest three, no impact one, and the rest are one click away", () => {
  const evs = Array.from({ length: 19 }, (_, i) => inEvent(`e${i}`, "e1", `2026-11-${String(10 + i).padStart(2, "0")}T10:00:00Z`));
  const g = makeGroups(evs, "all")[0];
  assert.equal(g.items[0].finding_id, "e18");
  assert.deepEqual([shownIn(g, false).length, hiddenIn(g), shownIn(g, true).length], [3, 16, 19]);
  const n = makeGroups([1, 2, 3, 4].map(i => f(`n${i}`, "set_aside", { outcome: { reason: "no_theme" } })), "all")[0];
  assert.deepEqual([shownIn(n, false).length, hiddenIn(n)], [1, 3]);
  assert.equal(moreWords(3, false), "Show the other 3");
  assert.equal(moreWords(3, true), "Show fewer");
  assert.equal(groupMeta(n, { waitMinutes: 10, shown: 1 }), "showing 1");
  const w = makeGroups([f("w", "new")], "all")[0];
  assert.equal(groupMeta(w, { waitMinutes: 30, shown: 1 }), "AMIRI Agent investigates every 30 minutes");
  assert.equal(groupMeta(w, { waitMinutes: null, shown: 1 }), "");
});

test("a row goes to its event, else to whatever found it", () => {
  assert.equal(rowLink(inEvent("a", "ev 1")), "/events/ev%201");
  assert.equal(rowLink(f("a", "new", { source_ref: { monitor_id: "mon-1" } })), "/monitors/mon-1");
  assert.equal(rowLink(f("a", "set_aside", { source: "timeseries", source_ref: { series_id: "bno" } })), "/series/bno");
  assert.equal(rowLink(f("a", "new", { source: "radar" })), "/radar");
  assert.equal(sourceLink({ source: "studio", source_ref: null }), null);
  assert.equal(rowLink(f("a", "new", { source_ref: null })), null);
});

test("source words: the kind, then its own name", () => {
  assert.equal(sourceWords({ source: "monitor" }, "Texas power prices"), "Monitor · Texas power prices");
  assert.equal(sourceWords({ source: "timeseries" }, "Natural gas fund"), "Price · Natural gas fund");
  assert.equal(sourceWords({ source: "radar" }, "ignored"), "Radar");
  assert.equal(sourceWords({ source: "monitor" }), "Monitor");
});

test("signal: 70 and over strong, 40 and over moderate, below weak, none without a score", () => {
  assert.deepEqual([70, 69, 40, 39, 0].map(s => signalOf(s).level), [3, 2, 2, 1, 1]);
  assert.equal(signalOf(null).level, 0);
  assert.equal(signalOf(NaN).level, 0);
  assert.equal(signalOf(84).word, "Strong signal");
});

test("the time column: the time today, a weekday this week, a date after that, in the institution's zone", () => {
  const now = new Date("2026-11-24T17:20:00Z");               // 11:20 Tuesday in Chicago
  assert.equal(whenColumn("2026-11-24T15:45:00Z", now, "America/Chicago"), "09:45");
  assert.equal(whenColumn("2026-11-23T20:00:00Z", now, "America/Chicago"), "Mon");
  assert.equal(whenColumn("2026-11-17T20:00:00Z", now, "America/Chicago"), "17 Nov");
  assert.equal(whenColumn("2026-11-25T04:00:00Z", new Date("2026-11-25T05:00:00Z"), "Asia/Colombo"), "09:30");  // the zone decides the day
});

test("why there was no impact: the note, else the reason in words, else the plain fact", () => {
  assert.equal(noImpactWhy({ outcome: { reason: "merged_into_event" } }), "Already part of an open event");
  assert.equal(noImpactWhy({ outcome: { reason: "not_home_country", note: "XAU: a currency the institution doesn't book in" } }), "XAU: a currency the institution doesn't book in");
  assert.equal(noImpactWhy({ outcome: { reason: "below_min_size" } }), "The move is too small to matter");
  assert.equal(noImpactWhy({ outcome: null }), "No link to your products");
});

test("tries: shown when a finding was tried before and is on its way again", () => {
  assert.equal(triesOf(f("a", "new", { outcome: { attempts: 2 } })), 2);
  assert.equal(triesOf(f("a", "grouped", { outcome: { attempts: 1 } })), 1);
  assert.equal(triesOf(f("a", "new")), null);
  assert.equal(triesOf(f("a", "linked", { outcome: { attempts: 2, event_id: "e" } })), null);
  assert.equal(retryWord(2), "Retried 2×");
});

test("polling: only findings on their way, one per run, at most three; done when linked or set aside", () => {
  const xs = [f("n", "new"), ...Array.from({ length: 12 }, (_, i) => f(`g${i}`, "grouped", { created_at: `2026-11-24T10:${String(i).padStart(2, "0")}:00Z` })), inEvent("e", "e1")];
  const ids = onItsWay(xs);
  assert.equal(ids.length, 3);
  assert.equal(ids[0], "g11");
  const sameRun = Array.from({ length: 5 }, (_, i) => f(`r${i}`, "grouped", { run_id: "run-1", created_at: `2026-11-24T11:0${i}:00Z` }));
  assert.deepEqual(onItsWay([...sameRun, f("x", "grouped", { run_id: "run-2", created_at: "2026-11-24T09:00:00Z" })]), ["r4", "x"]);
  assert.ok(!ids.includes("n") && !ids.includes("e"));
  assert.deepEqual(["new", "grouped", "linked", "set_aside"].map(landed), [false, false, true, true]);
});

test("a finding that couldn't be investigated gives its reason as a sentence", () => {
  assert.equal(notInvestigatedLine({ outcome: { reason: "investigation_failed", note: "the agent refused or couldn't take the run: HTTP 422: {}" } }), "The investigation agent couldn't take the run");
  assert.equal(notInvestigatedLine({ outcome: null }), "The investigation agent didn't answer");
});
