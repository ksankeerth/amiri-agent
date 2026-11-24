// Run with `node --test src/pages/events/eventWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adverseFor, alertLook, alertStatus, arrowFor, assessmentText, asideTypes, checksUntil, dataSays, expectedParts, findingSource, joinedText,
  nextCheckText, parseBand, parseNum, periodLayout, progressSteps, retriedText, runState, scaleLayout, toneFrom, whenYoullKnow, type CheckLike,
} from "./eventWords.ts";

const check = (o: Partial<CheckLike>): CheckLike => ({
  verdict: "not_yet", change: null, usual: null, what: "", why: null, as_of: null, next_check_after: null, final: false, ...o,
});

test("the event's tone comes from its impacts", () => {
  assert.equal(toneFrom(2, 0), "bad");
  assert.equal(toneFrom(0, 1), "good");
  assert.equal(toneFrom(1, 1), "mixed");
  assert.equal(toneFrom(0, 0), "neutral");
});

test("an impact is bad for you by the task first, then the alert, then the event", () => {
  assert.equal(adverseFor("fall", { adverse_direction: "fall" }, { adverse: false }, "good"), true);
  assert.equal(adverseFor("rise", { adverse_direction: "fall" }, undefined, undefined), false);
  assert.equal(adverseFor("rise", undefined, { adverse: true }, "good"), true);
  assert.equal(adverseFor("rise", undefined, undefined, "good"), false);
  assert.equal(adverseFor("rise", undefined, undefined, "bad"), true);
  assert.equal(adverseFor("rise", undefined, undefined, "mixed"), null);
});

test("the four steps say what happened, and fill as far as it got", () => {
  assert.deepEqual(progressSteps({ findings: 3, effects: 5, teams: 1, checked: 1, validation: true }), [
    { label: "Found", value: "3 findings", fill: 1 },
    { label: "Investigated", value: "5 possible effects", fill: 1 },
    { label: "Alerted", value: "1 team", fill: 1 },
    { label: "Checked", value: "1 of 5 so far", fill: 0.2 },
  ]);
  const none = progressSteps({ findings: 2, effects: 0, teams: 0, checked: 0, validation: true });
  assert.equal(none[1].value, "No effect traced");
  assert.equal(none[2].value, "Nothing to send");
  assert.deepEqual(none[3], { label: "Checked", value: "Nothing to check", fill: 0 });
  assert.equal(progressSteps({ findings: 1, effects: 2, teams: 0, checked: 0, validation: false })[3].value, "Checks off");
  assert.equal(progressSteps({ findings: 1, effects: 2, teams: 0, checked: 0, validation: false })[2].value, "No team needs telling");
  assert.equal(progressSteps({ findings: 1, effects: 3, teams: 1, checked: 3, validation: true })[3].value, "All 3 checked");
});

test("the expected size and timing, and the arrow's words", () => {
  assert.deepEqual(expectedParts("medium", "weeks"), { size: "medium", when: "within weeks" });
  assert.deepEqual(expectedParts(null, undefined), { size: null, when: null });
  assert.deepEqual(arrowFor("rise", true), { glyph: "↑", tone: "bad", word: "Expected to rise; bad for you" });
  assert.deepEqual(arrowFor("fall", false), { glyph: "↓", tone: "good", word: "Expected to fall; good for you" });
  assert.equal(arrowFor("fall", null).word, "Expected to fall");
});

test("next check, in words", () => {
  assert.equal(nextCheckText("2026-11-10", "2026-11-12"), "check due");
  assert.equal(nextCheckText("2026-11-12", "2026-11-12"), "next check today");
  assert.equal(nextCheckText("2026-12-01", "2026-11-12"), "next check 1 Dec");
  assert.equal(nextCheckText(null, "2026-11-12"), null);
});

test("what your data says, line by line", () => {
  const today = "2026-11-12";
  assert.deepEqual(dataSays(undefined, today), { pill: null, line: null });
  // a task with no result yet: the watch starts later, or it hasn't been checked
  assert.deepEqual(dataSays({ watch: { from: "2026-12-01", until: "2027-01-26" } }, today), { pill: "Watch starts 1 Dec", line: "Watching 1 Dec 2026 – 26 Jan 2027" });
  assert.deepEqual(dataSays({ watch: { from: "2026-11-01", until: "2026-12-01" } }, today), { pill: "Not checked yet", line: "Watching 1 Nov – 1 Dec" });
  // not published yet: when the next check is
  assert.deepEqual(dataSays({ next_check_after: "2026-12-01", watch: { from: "2026-11-01", until: "2027-01-26" }, check: check({}) }, today), { pill: null, line: "Next check 1 Dec" });
  assert.equal(dataSays({ check: check({ next_check_after: "2026-11-01" }) }, today).line, "Check due");
  assert.equal(dataSays({ watch: { from: "2026-12-01", until: "2027-01-26" }, check: check({}) }, today).pill, "Watch starts 1 Dec");
  // a result with a figure: the figure and what it is against
  assert.equal(dataSays({ check: check({ verdict: "confirms", change: "+6.1%", what: "Credit-line utilisation: +6.1% against the prior periods (usual range −2% to +3%)" }) }, today).line, "+6.1% vs the prior periods");
  assert.equal(dataSays({ check: check({ verdict: "no_effect", change: "−1.5%", what: "nothing like it" }) }, today).line, "−1.5%");
  assert.equal(dataSays({ check: check({ verdict: "no_effect" }) }, today).line, "Within the usual range");
  assert.equal(dataSays({ check: check({ verdict: "insufficient_data", why: "too few accounts to judge" }) }, today).line, "Too few accounts to judge");
  assert.equal(dataSays({ check: check({ verdict: "error", as_of: "2026-11-09" }) }, today).line, "Tried 9 Nov");
});

test("where a finding came from", () => {
  assert.equal(findingSource({ source: "radar", source_ref: { publishers: 4 } }), "Radar · 4 publishers");
  assert.equal(findingSource({ source: "radar", source_ref: { publishers: 1 } }), "Radar · 1 publisher");
  assert.equal(findingSource({ source: "monitor", evidence: { headlines: [{ outlet: "Reuters" }, { outlet: "Reuters" }, { outlet: "Lanka" }, { outlet: "FT" }] } }), "News monitor · Reuters · Lanka · +1");
  assert.equal(findingSource({ source: "timeseries" }), "Market price");
  assert.equal(retriedText({ attempts: 2 }), "Retried 2×");
  assert.equal(retriedText({ attempts: 1 }), null);
  assert.equal(retriedText(null), null);
  assert.equal(joinedText(1), "+1 later finding joined");
  assert.equal(joinedText(255), "+255 later findings joined");
});

test("the assessment line names the effect count and the first reasons", () => {
  assert.equal(assessmentText([]), "");
  assert.equal(assessmentText([{ chain_label: "Foreign-currency inflows fall" }]), "1 possible effect on your products: Foreign-currency inflows fall.");
  const many = ["a one", "b two", "c three", "d four", "e five"].map(chain_label => ({ chain_label }));
  assert.equal(assessmentText(many), "5 possible effects on your products: A one. B two. C three. And 2 more reasons in the report.");
  // the same reason twice is said once
  assert.equal(assessmentText([{ chain_label: "x." }, { chain_label: "x" }]), "2 possible effects on your products: X.");
  assert.equal(asideTypes([{ product_type: "a" }, { product_type: "a" }, { product_type: "b" }]), 2);
});

test("alerts raised", () => {
  const a = { alert_id: "1", owner: "Treasury", level: "warning", status: "new", effects: [] };
  assert.equal(alertStatus(a), "to review");
  assert.equal(alertStatus({ ...a, status: "acknowledged" }), "acknowledged");
  assert.equal(alertStatus({ ...a, status: "resolved" }), "resolved");
  assert.deepEqual(alertLook("warning"), { tone: "bad", label: "Early warning" });
  assert.deepEqual(alertLook("developing"), { tone: "unusual", label: "Showing early signs" });
  assert.deepEqual(alertLook("adverse"), { tone: "bad", label: "Confirmed by your data" });
});

test("when you'll know", () => {
  const base = { today: "2026-11-12", open_until: "2026-12-08T10:00:00Z", closed_at: null };
  assert.deepEqual(whenYoullKnow({ ...base, status: "open", tasks: [{ next_check_after: "2026-12-01" }, { next_check_after: "2026-11-20" }] }), [
    { label: "Next check against your data", value: "20 Nov" },
    { label: "Event closes if nothing new", value: "8 Dec" },
  ]);
  assert.equal(whenYoullKnow({ ...base, status: "open", tasks: [{ next_check_after: "2026-11-01" }] })[0].value, "Due now");
  assert.equal(whenYoullKnow({ ...base, status: "open", tasks: [{ next_check_after: "2026-11-12" }] })[0].value, "Today");
  // every check final: no next check
  assert.deepEqual(whenYoullKnow({ ...base, status: "open", tasks: [{ check: check({ final: true, verdict: "confirms" }) }] })[0], { label: "Checks against your data", value: "All final" });
  // closed: no "closes if nothing new"
  const closed = whenYoullKnow({ ...base, status: "closed", closed_at: "2026-12-08T10:00:00Z", tasks: [] });
  assert.deepEqual(closed, [{ label: "Event closed", value: "8 Dec" }]);
  assert.equal(checksUntil([{ watch: { from: "2026-10-01", until: "2027-01-26" } }, { watch: { from: "2026-10-01", until: "2026-12-01" } }], "2026-12-09"), "26 Jan");
  assert.equal(checksUntil([{ watch: { from: "2026-10-01", until: "2026-12-01" } }], "2026-12-09"), null);
  assert.equal(checksUntil([], "2026-12-09"), null);
});

test("the investigation's state", () => {
  assert.equal(runState("running"), "running");
  assert.equal(runState("stopped_early"), "stopped");
  assert.equal(runState("failed"), "failed");
  assert.equal(runState("completed"), "ok");
  assert.equal(runState(undefined), "ok");
});

test("the scales put figures on a track", () => {
  const l = scaleLayout(-1.5, [-9.7, 10.6], 5);
  assert.ok(l.fig > 0 && l.fig < 100 && l.thr! > l.fig && l.band!.left < l.fig && l.band!.left + l.band!.width > l.thr!);
  assert.deepEqual(scaleLayout(2), { fig: 50 });
  assert.deepEqual(periodLayout("2026-10-01", "2026-12-01", "2026-09-01"), { at: 0, state: "before" });
  assert.deepEqual(periodLayout("2026-10-01", "2026-12-01", "2027-01-01"), { at: 100, state: "after" });
  assert.equal(periodLayout("2026-10-01", "2026-12-01", "2026-11-01").state, "inside");
  assert.equal(parseNum("−0.55 pp"), -0.55);
  assert.equal(parseNum("+6.1%"), 6.1);
  assert.equal(parseNum(null), null);
  assert.deepEqual(parseBand("−9.7% to +10.6%"), [-9.7, 10.6]);
  assert.equal(parseBand("n/a"), undefined);
});
