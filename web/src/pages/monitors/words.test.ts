// Run with `node --test src/pages/monitors/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MonitorFinding, MonitorRow, MonitorSpec } from "../../api/monitors";
import {
  dateWords, awaitingApproval, changedSince, changesLine, changesText, checkDoneText, checkLook, checkSpec, coverageText, diffParts, everyShort, everyWords,
  findingsByCheck, groupMonitors, investigatedText, refusalTitle, isOverdue, lastWords, liveShown, lineMatches, linesOf, needsSlot, pickDefault, rowLine, rowPill, shownLines, slotsWords,
  statusLook, waitingOn,
} from "./words.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const ago = (iso: string) => `${Math.round((NOW.getTime() - new Date(iso).getTime()) / 3_600_000)} h ago`;
const row = (o: Partial<MonitorRow> = {}): MonitorRow => ({
  monitor_id: "m1", institution_id: "i", status: "live", name: "Texas power prices", sentence: "s", owner: "Commercial banking", check_frequency: 360,
  live_version: 3, latest_version: 3, pending: null, origin: "", origin_ref: null, drafted_fields: [], next_check_at: null,
  last_check: { at: "2026-11-11T10:00:00Z", status: "fired", findings: 2 }, findings_30d: 5, review_due: false, created_by: "x", created_at: "", updated_at: "", ...o,
});

test("says how often", () => {
  assert.equal(everyWords(60), "every hour");
  assert.equal(everyWords(1440), "once a day");
  assert.equal(everyWords(360), "every 6 hours");
  assert.equal(everyWords(15), "every 15 minutes");
  assert.equal(everyShort(360), "every 6 h");
  assert.equal(everyShort(1440), "every day");
  assert.equal(everyShort(15), "every 15 min");
});

test("a live monitor is overdue after twice its frequency", () => {
  const now = new Date("2026-11-11T03:30:00Z");
  const m = (at: string, status: "live" | "paused" = "live") => ({ status, check_frequency: 60, last_check: { at, status: "quiet" as const, findings: 0 } });
  assert.equal(isOverdue(m("2026-11-11T01:45:00Z"), now), false);
  assert.equal(isOverdue(m("2026-11-11T01:15:00Z"), now), true);
  assert.equal(isOverdue(m("2026-11-10T06:30:00Z", "paused"), now), false);
  assert.equal(isOverdue({ status: "live", check_frequency: 60, last_check: null }, now), false);
});

test("counts the findings that met each line", () => {
  assert.deepEqual(lineMatches(3, [{ source_ref: { lines: [1] } }, { source_ref: { lines: [1, 3] } }, { source_ref: null }]), [2, 0, 1]);
});

test("groups the list: what waits for a person first, live busiest first", () => {
  const a = row({ monitor_id: "a", findings_30d: 1 }), b = row({ monitor_id: "b", findings_30d: 5 });
  const w = row({ monitor_id: "w", status: "submitted", live_version: null, latest_version: 1, pending: { version: 1, status: "submitted", note: null } });
  const up = row({ monitor_id: "u", pending: { version: 4, status: "submitted", note: null } });   // live, a new version waits
  const p = row({ monitor_id: "p", status: "paused" }), d = row({ monitor_id: "d", status: "draft" }), r = row({ monitor_id: "r", status: "retired" });
  const g = groupMonitors([a, w, b, p, d, r, up]);
  assert.deepEqual(g.waiting.map(x => x.monitor_id), ["w", "u"]);
  assert.deepEqual(g.live.map(x => x.monitor_id), ["b", "a"]);
  assert.deepEqual([g.paused.length, g.draft.length, g.retired.length], [1, 1, 1]);
  assert.equal(pickDefault(g)!.monitor_id, "b");
  assert.equal(pickDefault(groupMonitors([w, d]))!.monitor_id, "w");
  assert.equal(pickDefault(groupMonitors([])), null);
  assert.equal(awaitingApproval(up), true);
  assert.equal(awaitingApproval(a), false);
});

test("the live rows: the first five, and the open one wherever it is", () => {
  const live = Array.from({ length: 8 }, (_, i) => row({ monitor_id: `m${i}` }));
  assert.deepEqual(liveShown(live, null, false).shown.map(x => x.monitor_id), ["m0", "m1", "m2", "m3", "m4"]);
  assert.equal(liveShown(live, null, false).hidden, 3);
  assert.deepEqual(liveShown(live, "m7", false).shown.map(x => x.monitor_id), ["m0", "m1", "m2", "m3", "m4", "m7"]);
  assert.equal(liveShown(live, "m7", false).hidden, 2);
  assert.equal(liveShown(live, null, true).hidden, 0);
  assert.equal(liveShown(live.slice(0, 6), null, false).hidden, 0);   // one more is not worth a button
});

test("a row says who, how often, the last check and the 30-day count", () => {
  assert.deepEqual(rowLine(row(), NOW, ago), { lead: "Commercial banking · every 6 h · fired 2 h ago", count: 5 });
  assert.equal(rowLine(row({ last_check: { at: "2026-11-11T06:00:00Z", status: "quiet", findings: 0 } }), NOW, ago).lead, "Commercial banking · every 6 h · quiet");
  assert.equal(rowLine(row({ last_check: { at: "2026-11-11T09:00:00Z", status: "error", findings: 0 } }), NOW, ago).lead, "Commercial banking · every 6 h · couldn't check 3 h ago");
  assert.equal(rowLine(row({ status: "submitted", last_check: null, findings_30d: 0 }), NOW, ago).lead, "Commercial banking · every 6 h · not live yet");
  assert.equal(rowLine(row({ status: "draft" }), NOW, ago).count, null);
  assert.equal(rowLine(row({ status: "retired", updated_at: "2026-11-11T06:00:00Z" }), NOW, ago).lead, "Commercial banking · every 6 h · retired 6 h ago");
  assert.match(rowLine(row({ pending: { version: 4, status: "submitted", note: null } }), NOW, ago).lead, /version 4 waiting/);
  assert.equal(lastWords({ status: "live", check_frequency: 60, last_check: null }, NOW, ago), "not checked yet");
  assert.equal(lastWords({ status: "live", check_frequency: 60, last_check: { at: "2026-11-11T06:00:00Z", status: "quiet", findings: 0 } }, NOW, ago), "overdue");
});

test("status words and the row pill", () => {
  assert.deepEqual(statusLook(row(), true), { label: "Live · version 3", tone: "good" });
  assert.equal(statusLook(row({ status: "draft", live_version: null, latest_version: 2 }), true).label, "Draft · version 2");
  assert.equal(statusLook(row({ status: "submitted" })).label, "Waiting for approval");
  assert.equal(rowPill(row(), "live"), null);
  assert.equal(rowPill(row({ status: "submitted" }), "waiting")!.label, "Waiting for approval");
  assert.equal(rowPill(row({ pending: { version: 4, status: "submitted", note: null } }), "waiting")!.label, "Version 4 waiting");
  assert.equal(rowPill(row({ status: "retired" }), "retired")!.dashed, true);
});

test("the live limit", () => {
  assert.equal(slotsWords({ live: 10, live_max: 10 }), "10 of 10 live. Pause or retire one first.");
  assert.equal(slotsWords({ live: 7, live_max: 10 }), null);
  assert.equal(slotsWords(null), null);
  assert.equal(needsSlot({ status: "live" }), false);
  assert.equal(needsSlot({ status: "paused" }), true);
  assert.equal(needsSlot({ status: "submitted" }), true);
});

test("a check in the board's words", () => {
  assert.deepEqual(checkLook({ status: "completed", findings: 2 }), { word: "Fired", tone: "good", count: "2 findings" });
  assert.deepEqual(checkLook({ status: "completed", findings: 1 }), { word: "Fired", tone: "good", count: "1 finding" });
  assert.deepEqual(checkLook({ status: "completed", findings: 0 }), { word: "Quiet", tone: "neutral", count: "0 findings" });
  assert.equal(checkLook({ status: "failed", findings: null }).word, "Couldn't check");
  assert.equal(checkLook({ status: "running", findings: null }).word, "Checking…");
  assert.equal(checkLook({ status: "stopped_early", findings: 0 }).word, "Stopped early");
  assert.equal(coverageText({ web_queries: 14, pages_seen: 61, pages_dated: 40, pages_in_window: 9, already_reported: 0 }), "14 searches · 61 pages · 9 in the window");
  assert.equal(coverageText({ web_queries: 1, pages_seen: 1, pages_dated: 1, pages_in_window: 1, already_reported: 2 }), "1 search · 1 page · 1 in the window · 2 already reported");
  assert.equal(coverageText(null), "");
  assert.equal(checkDoneText({ status: "failed", findings: null }, false), "The check failed: see Recent checks.");
  assert.equal(checkDoneText({ status: "completed", findings: 0 }, false), "Nothing new.");
  assert.match(checkDoneText({ status: "completed", findings: 2 }, true), /kept apart/);
});

const finding = (id: string, check: string, status: MonitorFinding["status"], run: string | null): MonitorFinding => ({
  finding_id: id, status, run_id: run, source_ref: { monitor_id: "m1", monitor_version: 3, check_run_id: check, lines: [], line_texts: [] },
} as unknown as MonitorFinding);

test("which findings to ask about after Check now: one per run, only on their way, only that check's", () => {
  const fs = [finding("a", "c1", "grouped", "r1"), finding("b", "c1", "grouped", "r1"), finding("c", "c1", "new", null), finding("d", "c1", "linked", "r1"),
    finding("e", "c2", "grouped", "r2"), finding("f", "c1", "grouped", "r3")];
  assert.deepEqual(waitingOn(fs, "c1"), ["a", "c", "f"]);
  assert.deepEqual(waitingOn(fs, "c2"), ["e"]);
  assert.deepEqual(waitingOn([], "c1"), []);
  assert.deepEqual(Object.keys(findingsByCheck(fs)).sort(), ["c1", "c2"]);
  assert.equal(findingsByCheck(fs).c1.length, 5);
});

const spec = (o: (s: MonitorSpec) => void = () => {}): MonitorSpec => {
  const s: MonitorSpec = {
    about: { name: "Texas power prices", owner: "Commercial banking", check_frequency: 360, review_by: null, key_dates: [] },
    public: { watch: [{ name: "ERCOT", type: "organisation" }], in_one_sentence: "Texas power prices and grid alerts that raise costs.",
      tell_me_if: ["Prices hit the cap", "ERCOT declares an emergency"], ignore: [], places: ["US-TX"], languages: ["en"], sources: { mode: "any_reputable", check_first: [] } },
    private: { exposure: [], serious: [] }, alert_level: 6,
  };
  o(s);
  return s;
};

test("what a new version changes, as the board writes it", () => {
  const a = spec();
  const b = spec(s => { s.public.tell_me_if.push("A plant closes"); s.public.watch.push({ name: "Samsung Taylor fab", type: "organisation" }); });
  const parts = diffParts(a, b);
  assert.deepEqual(parts.map(p => p.label), ["Tell me if", "Watch"]);
  assert.equal(changesLine(parts), "Tell me if (+ “A plant closes”) · Watch (+ “Samsung Taylor fab”)");
  const c = spec(s => { s.about.check_frequency = 60; s.public.tell_me_if = ["x1x", "x2x", "x3x", "x4x"]; });
  assert.equal(diffParts(a, c).find(p => p.label === "Check")!.after, "every hour");
  assert.match(changesLine(diffParts(a, c)), /Tell me if \(\+4 conditions, −2 conditions\)/);
  const d = spec(s => { s.public.tell_me_if.push("A very long condition that is more than forty characters long"); });
  assert.equal(changesLine(diffParts(a, d)), "Tell me if (+1 condition)");
  assert.deepEqual(diffParts(a, spec()), []);
});

test("the lines shown first, and the rest behind a button", () => {
  assert.deepEqual(shownLines([1, 2], false), { shown: [1, 2], hidden: 0 });
  assert.deepEqual(shownLines([1, 2, 3], false), { shown: [1, 2], hidden: 1 });   // the board: "+1 more"
  assert.deepEqual(shownLines([1, 2, 3, 4], false), { shown: [1, 2], hidden: 2 });
  assert.deepEqual(shownLines([1, 2, 3, 4], true), { shown: [1, 2, 3, 4], hidden: 0 });
});

test("an edit is out of date when the monitor changed since the form opened", () => {
  const o = { latest_version: 3, updated_at: "2026-11-11T10:00:00Z" };
  assert.equal(changedSince(o, { ...o }), false);
  assert.equal(changedSince(o, { ...o, latest_version: 4 }), true);
  assert.equal(changedSince(o, { ...o, updated_at: "2026-11-11T10:05:00Z" }), true);
});

test("the unsaved text for the clipboard", () => {
  const t = changesText(spec(), "Added Qatar");
  assert.match(t, /^Name: Texas power prices/);
  assert.match(t, /Tell me if:\n- Prices hit the cap\n- ERCOT declares an emergency/);
  assert.match(t, /Check: every 6 hours/);
  assert.match(t, /What changed: Added Qatar$/);
});

test("the form checks the server's limits before sending", () => {
  assert.deepEqual(checkSpec(spec()).fields, {});
  const bad = checkSpec(spec(s => { s.about.name = "ab"; s.public.in_one_sentence = "short"; s.public.watch = []; s.public.tell_me_if = []; }));
  assert.deepEqual(Object.keys(bad.fields).sort(), ["about.name", "public.in_one_sentence", "public.tell_me_if", "public.watch"]);
  assert.match(checkSpec(spec(s => { s.public.tell_me_if = ["ok line", "no"]; })).fields["public.tell_me_if"], /at least 3/);
  assert.deepEqual(linesOf(" a \n\n b\n"), ["a", "b"]);
});

test("the toasts", () => {
  assert.equal(investigatedText("timeout", 0), "Still working; it will appear here.");
  assert.equal(investigatedText("cancelled", 2), "");
  assert.equal(investigatedText("done", 1), "The investigation finished: 1 finding joined an event.");
  assert.equal(investigatedText("done", 0), "The investigation finished. No new event.");
  assert.equal(refusalTitle("check_running"), "A check is already running");
  assert.equal(refusalTitle("demo_locked"), undefined);
});

test("a calendar date is read as written, not moved by a time zone", () => {
  assert.equal(dateWords("2027-03-01"), "1 Mar");
  assert.equal(dateWords("2026-12-31"), "31 Dec");
  assert.equal(dateWords("soon"), "soon");
});
