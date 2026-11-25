// Run with `node --test src/pages/studio/runWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  againMode, clockWithYear, driveDelay, driveDone, driveNext, drivePlay, effectLines, endedText, eventsSplit, findingsLine, finishedLine, foldDays, foundCount,
  headlineTiming, isStory, liveText, priceName, priceSummary, statusPill, storyRows, timeOfDay, timeRow, workingText,
} from "./runWords.ts";

const name = (_: string, t: string) => t;

test("carrying on: Next day stops when the day moves, Play when the run ends", () => {
  const d = driveNext(5);
  assert.equal(driveDone(d, { step: 5, status: "waiting" }), false);
  assert.equal(driveDone(d, { step: 6, status: "running" }), true);
  assert.equal(driveDone(d, { step: 5, status: "stopped" }), true);
  const p = drivePlay();
  assert.equal(driveDone(p, { step: 20, status: "running" }), false);
  assert.equal(driveDone(p, { step: 21, status: "finished" }), true);
  assert.ok(driveDelay("waiting") > driveDelay("running"));
});

test("what the agents are doing", () => {
  assert.equal(workingText([], []), null);
  const tl = [{ kind: "investigation", step: 5, data: { status: "started", findings: 2 } }];
  assert.equal(workingText([{ run_id: "r", kind: "investigation", step: 5, seconds: 12 }], tl), "investigating 2 findings, 12 s so far");
  assert.equal(workingText([{ run_id: "r", kind: "check", step: 5, seconds: 3 }], tl), "reading the day's headlines, 3 s so far");
  assert.equal(workingText([{ run_id: "r", kind: "investigation", step: 9, seconds: 1 }], []), "investigating, 1 s so far");
});

test("the line a screen reader hears has no seconds in it", () => {
  const sim = { status: "waiting" as const, step: 6, steps: 21, pending: [{ run_id: "r", kind: "investigation" as const, step: 6, seconds: 12 }] };
  assert.equal(liveText(sim, 0, 4), "Day 6 of 21. Waiting for the investigation agent.");
  assert.equal(liveText({ ...sim, pending: [{ ...sim.pending[0], seconds: 40 }] }, 0, 4), liveText(sim, 0, 4));
  assert.equal(liveText({ ...sim, status: "finished", pending: [] }, 4, 4), "Finished. 4 of 4 expected stories found.");
  assert.equal(liveText({ ...sim, status: "stopped", pending: [] }, 1, 4), "Stopped on day 6 of 21.");
  assert.equal(liveText({ ...sim, status: "failed", pending: [] }, 1, 4), "Stopped by an error on day 6 of 21.");
});

test("the status pill says how it is going", () => {
  const s = { step: 4, steps: 21, mode: "live" as const };
  assert.equal(statusPill({ ...s, status: "running" }).text, "Running · live agents");
  assert.equal(statusPill({ ...s, status: "running", mode: "replay" as const }).text, "Running · replaying a recording");
  assert.equal(statusPill({ ...s, status: "finished", step: 21 }).text, "Finished · 21 of 21 days");
  assert.equal(statusPill({ ...s, status: "stopped" }).text, "Stopped early · day 4 of 21");
  assert.deepEqual([statusPill({ ...s, status: "failed" }).tone, statusPill({ ...s, status: "failed" }).text], ["bad", "Stopped by an error · day 4 of 21"]);
});

test("when a story's headline comes", () => {
  const plan = [{ story: "a", day: 2 }, { story: "a", day: 6 }, { story: "b", day: 3 }];
  assert.deepEqual(headlineTiming(plan, "a", 3), { next: 6, arrived: true });
  assert.deepEqual(headlineTiming(plan, "b", 1), { next: 3, arrived: false });
  assert.deepEqual(headlineTiming(plan, "b", 9), { next: null, arrived: true });
  assert.equal(headlineTiming(null, "a", 1), null);
});

const summary = {
  stories: [
    { key: "power", label: "Power prices spike", expected: true, tone: "bad" as const, found: true, event_id: "e1", event_title: "Texas power prices spike", found_tone: "bad" as const },
    { key: "homes", label: "Homes damaged", expected: true, tone: "bad" as const, found: false, event_id: null, event_title: null, found_tone: null },
    { key: "water", label: "Water runs short", expected: true, tone: "bad" as const, found: false, event_id: null, event_title: null, found_tone: null },
    { key: "off", label: "Switched off", expected: false, tone: "bad" as const, found: false, event_id: null, event_title: null, found_tone: null },
  ],
  other_events: [{ event_id: "e9", title: "A surprise", tone: "mixed" as const }],
  findings: { monitor: { expected: 4, found: 7 }, timeseries: { expected: 1, found: 0 } },
};
test("expected vs found: found, not yet, not found, unexpected", () => {
  const plan = [{ story: "homes", day: 6 }];
  const run = storyRows(summary, true, 5, plan, name);
  assert.deepEqual(run.map(r => r.state), ["found", "not_yet", "not_yet", "unexpected"]);
  assert.equal(run[1].note, "Its headline comes on day 6");
  assert.equal(run[2].note, "Not traced to an event yet");
  assert.equal(run[3].label, "A surprise");
  assert.deepEqual(foundCount(run), { found: 1, expected: 3 });
  const end = storyRows(summary, false, 21, plan, name);
  assert.deepEqual(end.map(r => r.state), ["found", "not_found", "not_found", "unexpected"]);
  assert.equal(end[1].note, "Nothing in this run was traced to it");
});

test("an unexpected story that was found is unexpected, with the event's name", () => {
  const s = { ...summary, stories: [{ ...summary.stories[3], found: true, event_id: "e5", event_title: "Odd event", found_tone: "good" as const }], other_events: [] };
  const r = storyRows(s, false, 21, null, name);
  assert.deepEqual([r[0].state, r[0].label, r[0].tone], ["unexpected", "Odd event", "good"]);
});

test("the findings line marks what is met", () => {
  assert.equal(findingsLine(summary.findings, true), "Findings: 7 of at least 4 expected from news ✓ · 0 of at least 1 expected from prices (so far)");
  assert.equal(findingsLine(summary.findings, false), "Findings: 7 of at least 4 expected from news ✓ · 0 of at least 1 expected from prices ✕");
  assert.equal(findingsLine({ monitor: { expected: 0, found: 2 } }, true), null);
});

test("events by tone", () => {
  assert.equal(eventsSplit([]), "none yet");
  assert.equal(eventsSplit([{ tone: "bad" }]), "bad for you");
  assert.equal(eventsSplit([{ tone: "bad" }, { tone: "bad" }, { tone: "bad" }]), "all bad for you");
  assert.equal(eventsSplit([{ tone: "bad" }, { tone: "good" }]), "1 bad · 1 good for you");
});

test("an alert's effects, each once, in words", () => {
  const x = { product: "Chip-Supplier Credit Lines", metric_name: "Credit-line utilisation", direction: "rise", size: "Medium", timing: "weeks" };
  const lines = effectLines([x, x, { ...x, product: "Other", direction: "fall", size: null, timing: null }]);
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0].arrow, lines[0].word, lines[0].size, lines[0].when], ["↑", "expected to rise", "medium", "within weeks"]);
  assert.deepEqual([lines[1].arrow, lines[1].size, lines[1].when], ["↓", null, null]);
});

test("timeline rows: the story, and the agents' steps apart", () => {
  const t = (kind: string, data: Record<string, any>, extra = {}) => ({ seq: 1, step: 4, at: "2027-02-11T17:00:00+00:00", kind, ref: null, data, ...extra });
  assert.equal(isStory(t("headline", {})), true);
  assert.equal(isStory(t("price", {})), false);
  assert.equal(isStory(t("check", { status: "started" })), false);
  assert.equal(isStory(t("check", { status: "failed", error: "x" })), true);
  assert.equal(isStory(t("investigation", { status: "started" })), true);
  assert.equal(isStory(t("investigation", { status: "completed" })), false);
  assert.equal(timeRow(t("finding", { source: "timeseries", title: "Power up" })).label, "Finding · prices");
  assert.equal(timeRow(t("finding", { source: "monitor", title: "Chips" })).label, "Finding · news");
  const ev = timeRow(t("event", { title: "Texas chip output halts", tone: "bad", themes: [] }, { ref: "ev-1" }));
  assert.deepEqual([ev.label, ev.text, ev.note, ev.eventId], ["Event formed", "Texas chip output halts", "bad for you", "ev-1"]);
  assert.equal(timeRow(t("investigation", { status: "started", findings: 2 })).text, "Investigating 2 findings");
  assert.equal(timeRow(t("investigation", { status: "completed", findings: 1 })).text, "Finished · 1 finding");
  assert.equal(timeRow(t("check", { status: "failed", error: "took too long" })).text, "Didn't finish: took too long");
});

test("the newest days stay open; earlier ones fold", () => {
  const rows = [6, 6, 5, 4, 4, 3, 2, 1].map(day => ({ day }));
  const f = foldDays(rows);
  assert.equal(f.shown.length, 5);
  assert.equal(f.earlier.length, 3);
  assert.equal(f.range, "Days 1–3");
  assert.equal(foldDays([{ day: 5 }, { day: 4 }]).range, null);
  assert.equal(foldDays([{ day: 4 }, { day: 3 }, { day: 2 }, { day: 1 }]).range, "Day 1");
});

test("the clock in the institution's zone", () => {
  assert.equal(clockWithYear("2027-02-13T18:00:00-06:00", "America/Chicago"), "Sat 13 Feb 2027, 18:00");
  assert.equal(timeOfDay("2027-02-13T15:00:00+00:00", "America/Chicago"), "09:00");
});

test("the price: a pair is its own name, a key is not", () => {
  assert.equal(priceName("USD/LKR"), "USD/LKR");
  assert.equal(priceName("TX-POWER", "Texas wholesale power (simulated)"), "Texas wholesale power (simulated)");
  assert.equal(priceName("TX-POWER"), "The simulated price");
  assert.equal(priceSummary([{ close: 40 }], 0), null);
  assert.equal(priceSummary([{ close: 40 }, { close: 54.4 }], 9), "From 40.00 to 54.40 (+36%) over 9 days");
});

test("how a run ended", () => {
  const plain = (e: string | null) => (e ? "The investigation took too long." : "It didn't finish.");
  const f = endedText({ status: "failed", step: 4, steps: 21, error: "deadline" }, plain);
  assert.equal(f.title, "The investigation took too long.");
  assert.match(f.body, /kept below/);
  assert.match(f.body, /Replay is off/);
  const s = endedText({ status: "stopped", step: 4, steps: 21, error: null }, plain);
  assert.equal(s.title, "This run was stopped on day 4 of 21");
  assert.equal(finishedLine(3, 2, true), "3 events · 2 alerts it would raise · recorded for instant replay");
  assert.equal(finishedLine(1, 1, false), "1 event · 1 alert it would raise · not recorded");
  assert.deepEqual([againMode("live"), againMode("record"), againMode("replay")], ["live", "record", null]);
});
