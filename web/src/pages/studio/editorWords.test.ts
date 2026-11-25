// Run with `node --test src/pages/studio/editorWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  byTime, changesText, fillFromFile, goingText, headlineError, headlineOk, lastRan, liveMode, onCount, priceMoveError, priceMoveOk, recordingNote,
  replayable, rowMeta, runHint, runLine, sameMove, subtitle, tagsText, unavailableText,
} from "./editorWords.ts";

const d = (iso: string) => iso.slice(0, 10);

test("a scenario's line in the list", () => {
  assert.equal(rowMeta({ template_id: "us-texas-winter-storm", intensity: "medium", recorded: true, last_run: "2026-11-22T10:00:00Z" }, false, d), "Medium · Recorded · last run 2026-11-22");
  assert.equal(rowMeta({ template_id: "us-texas-data-center-land-rush", intensity: "high", recorded: false, last_run: null }, false, d), "High · Not recorded · Not run yet");
  assert.equal(rowMeta({ template_id: "blank", intensity: "medium", recorded: null, last_run: null }, true, d), "Your own · Running now");
});

test("templates: tags and the reason one can't run", () => {
  assert.equal(tagsText(["fx", "importers"]), "currency · importers");
  assert.equal(unavailableText("the institution's base currency is the US dollar."), "Can't run here: the institution's base currency is the US dollar.");
});

test("the recording, in words", () => {
  assert.equal(recordingNote(null, "22 Nov"), "not recorded yet");
  assert.equal(recordingNote({ scenario_version: 1, complete: false, recorded_at: "", current: true }, ""), "a recording was started but didn't finish");
  assert.equal(recordingNote({ scenario_version: 1, complete: true, recorded_at: "", current: false }, ""), "changed since it was recorded");
  assert.equal(recordingNote({ scenario_version: 2, complete: true, recorded_at: "", current: true }, "22 Nov"), "recording saved for this version (22 Nov)");
  assert.equal(replayable({ scenario_version: 2, complete: true, recorded_at: "", current: true }), true);
  assert.equal(replayable({ scenario_version: 2, complete: true, recorded_at: "", current: false }), false);
  assert.equal(replayable(null), false);
  assert.match(subtitle("8 Feb 2027", 21, true, null, ""), /^Starts 8 Feb 2027 · 21 days, one step a day · your own scenario · not recorded yet$/);
});

test("headline counts and the small print beside the run buttons", () => {
  assert.equal(onCount(6, 1), "5 of 6 on");
  assert.equal(onCount(0, 0), "none yet");
  const rec = { scenario_version: 1, complete: true, recorded_at: "", current: true };
  assert.equal(runHint({ running: true, empty: false, rec, mode: "replay" }), "Another run is going: wait for it to end, or stop it above.");
  assert.equal(runHint({ running: false, empty: true, rec, mode: "live" }), "Add a headline or a price move to run it.");
  assert.equal(runHint({ running: false, empty: false, rec, mode: "replay" }), "From the saved recording, no agents");
  assert.equal(runHint({ running: false, empty: false, rec: { ...rec, current: false }, mode: "replay" }), "You changed the scenario: record this version first");
  assert.match(runHint({ running: false, empty: false, rec: null, mode: "replay" }), /^Not recorded yet/);
  assert.equal(liveMode(true), "record");
  assert.equal(liveMode(false), "live");
});

test("which run a new start clears", () => {
  assert.equal(lastRan([{ title: "A", last_run: null }]), null);
  assert.equal(lastRan([{ title: "A", last_run: "2026-11-20T10:00:00Z" }, { title: "B", last_run: "2026-11-22T10:00:00Z" }, { title: "C", last_run: null }]), "B");
  assert.equal(goingText({ title: "Data-center land rush", step: 3, steps: 21 }), "Data-center land rush, day 3 of 21");
});

test("an earlier run, in a line", () => {
  assert.equal(runLine({ mode: "replay", status: "finished", step: 21, steps: 21 }, "22 Nov 10:00"), "22 Nov 10:00 · replay · finished");
  assert.equal(runLine({ mode: "record", status: "stopped", step: 4, steps: 21 }, "22 Nov 10:00"), "22 Nov 10:00 · live, saved · stopped on day 4 of 21");
  assert.equal(runLine({ mode: "live", status: "failed", step: 4, steps: 21 }, "x"), "x · live · failed, day 4 of 21");
});

test("form rules", () => {
  assert.equal(headlineOk("short"), false);
  assert.equal(headlineOk("  Dockworkers strike  "), true);
  assert.equal(headlineError(""), null);
  assert.match(headlineError("short")!, /at least 8/);
  assert.equal(priceMoveOk({ direction: "none", size_pct: 0, ramp_days: 5 }), true);
  assert.equal(priceMoveOk({ direction: "weaker", size_pct: 0.2, ramp_days: 5 }), false);
  assert.equal(priceMoveOk({ direction: "weaker", size_pct: 5, ramp_days: 16 }), false);
  assert.match(priceMoveError({ direction: "weaker", size_pct: 31, ramp_days: 5 })!, /0.5% and 30%/);
  assert.match(priceMoveError({ direction: "weaker", size_pct: 5, ramp_days: 0 })!, /1 to 15/);
  assert.equal(priceMoveError({ direction: "none", size_pct: 99, ramp_days: 0 }), null);
  assert.equal(sameMove(undefined, { direction: "none", size_pct: 0, ramp_days: 5 }), false);
  assert.equal(sameMove({ direction: "weaker", size_pct: 5, ramp_days: 4 }, { direction: "weaker", size_pct: 5, ramp_days: 4 }), true);
  assert.deepEqual(byTime([{ day: 2, time: "16:00" }, { day: 1, time: "09:00" }, { day: 2, time: "07:30" }]).map(x => `${x.day} ${x.time}`), ["1 09:00", "2 07:30", "2 16:00"]);
});

test("a scenario file fills the form", () => {
  const f = fillFromFile({ title: "Port strike", headlines: [{ title: "Dockworkers strike", day: 2 }, { nope: 1 }], prices: { direction: "weaker", size_pct: 5, ramp_days: 4 } }, "old");
  assert.equal(f.title, "Port strike");
  assert.deepEqual(f.headlines, [{ id: "h1", title: "Dockworkers strike", day: 2, time: "09:00" }]);
  assert.deepEqual(f.prices, { direction: "weaker", size_pct: 5, ramp_days: 4 });
  const g = fillFromFile({ custom: { headlines: [], prices: { direction: "sideways" } } }, "keep");
  assert.equal(g.title, "keep");
  assert.equal(g.prices.direction, "none");
});

test("what a conflict leaves on the clipboard", () => {
  assert.equal(changesText({ title: "Storm" }), "Name: Storm");
  assert.equal(changesText({ custom: { headlines: [{ id: "a", title: "Grid fails", day: 2, time: "07:30" }] } }), "Day 2 07:30: Grid fails");
  assert.equal(changesText({ intensity: "high", switched_off: ["h1"] }), "How hard it hits: High\nSwitched off: h1");
});
