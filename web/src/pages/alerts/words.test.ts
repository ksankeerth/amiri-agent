import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alertTitle, checkedCount, countAt, effectCount, effectsShown, effectSays, moreEffects, emptyCopy, evidenceTitle, filterState, historySummary, ledeText, levelPill, limitNote, listMeta, neighbour, parseLevel, parseTab, pickAlert,
  progressWords, shortTitle, whoLine,
} from "./words.ts";
import { mergeEffects } from "../events/mergeEffects.ts";

const up = (at: string) => ({ at, by: "AMIRI Agent", change: "escalated", text: "1 more finding; the investigation added to the event" });

test("a long run of updates is counted, and the check is said once", () => {
  const h = [{ at: "2026-10-18T12:23:56Z", by: "AMIRI Agent", change: "raised", text: "From the event." },
    { at: "2026-10-18T12:30:00Z", by: "AMIRI Agent", change: "checked", text: "x" },
    up("2026-10-18T14:00:00Z"), up("2026-10-19T14:00:00Z"), up("2026-11-10T02:00:00Z")];
  assert.equal(historySummary(h, h[0].at, "2026-11-10"), "Raised 18 Oct · 3 updates from the event, 18 Oct to 10 Nov · last checked 10 Nov");
});

test("people's actions stay in the line, with who did them", () => {
  const h = [{ at: "2026-10-18T12:23:56Z", by: "AMIRI Agent", change: "raised" },
    { at: "2026-10-19T04:00:00Z", by: "John", change: "acknowledged" }, up("2026-10-20T04:00:00Z")];
  assert.equal(historySummary(h, h[0].at), "Raised 18 Oct · acknowledged by John 19 Oct · 1 update from the event, on 20 Oct");
});

test("the address picks the tab and the level; anything else is the default", () => {
  assert.equal(parseTab("resolved"), "resolved");
  assert.equal(parseTab("all"), "new");
  assert.equal(parseTab(null), "new");
  assert.equal(parseLevel("adverse"), "adverse");
  assert.equal(parseLevel("nonsense"), "");
});

test("levels have words and a tone: early warning red, developing amber, confirmed ink", () => {
  assert.deepEqual(levelPill("warning"), { tone: "bad", label: "Early warning" });
  assert.deepEqual(levelPill("developing"), { tone: "unusual", label: "Developing" });
  assert.deepEqual(levelPill("adverse"), { tone: "ink", label: "Confirmed" });
});

test("counts come from the summary, for one team or all; nothing until it is in", () => {
  const rows = [{ owner: "A", status: "new", n: 2 }, { owner: "B", status: "new", n: 1 }, { owner: "A", status: "resolved", n: 9 }];
  assert.equal(countAt(rows, "new"), 3);
  assert.equal(countAt(rows, "new", "A"), 2);
  assert.equal(countAt(rows, "acknowledged"), 0);
  assert.equal(countAt(undefined, "new"), undefined);
});

test("the line under the heading: red part first, a team's view has no institution-wide week count", () => {
  assert.deepEqual(ledeText({ toReview: 3, acknowledgedWeek: 5, team: "" }), { hot: "3 to review", rest: ["5 acknowledged this week"] });
  assert.deepEqual(ledeText({ toReview: 0, acknowledgedWeek: 5, team: "" }), { hot: null, rest: ["Nothing to review", "5 acknowledged this week"] });
  assert.deepEqual(ledeText({ toReview: 0, acknowledgedWeek: 5, team: "Retail banking" }), { hot: null, rest: ["Nothing to review for Retail banking"] });
  assert.equal(ledeText({ toReview: null, acknowledgedWeek: null, team: "" }), null);
});

test("the reading pane: the alert in the address, else the first on a wide screen, nothing on a phone", () => {
  const rows = [{ alert_id: "a" }, { alert_id: "b" }];
  assert.equal(pickAlert(rows, "b", false)?.alert_id, "b");
  assert.equal(pickAlert(rows, "b", true)?.alert_id, "b");
  assert.equal(pickAlert(rows, null, false)?.alert_id, "a");
  assert.equal(pickAlert(rows, "gone", false)?.alert_id, "a");
  assert.equal(pickAlert(rows, null, true), null);
  assert.equal(pickAlert([], null, false), null);
});

test("after an alert leaves the list the next one down opens, else the one above", () => {
  const rows = [{ alert_id: "a" }, { alert_id: "b" }, { alert_id: "c" }];
  assert.equal(neighbour(rows, "a")?.alert_id, "b");
  assert.equal(neighbour(rows, "c")?.alert_id, "b");
  assert.equal(neighbour([{ alert_id: "a" }], "a"), null);
  assert.equal(neighbour(rows, "zz"), null);
});

test("a list that stops short says so, and says how to see more", () => {
  assert.equal(limitNote(250, 200), "Newest 200 shown. Narrow with the team or level to see older ones.");
  assert.equal(limitNote(200, 200), null);
  assert.equal(limitNote(undefined, 200), null);
});

test("a row's meta line and who took it on", () => {
  assert.equal(listMeta("Texas power prices spike", 2), "Texas power prices spike · +1 more effect");
  assert.equal(listMeta("Texas power prices spike", 5), "Texas power prices spike · +4 more effects");
  assert.equal(listMeta("Oil rose", 0), "Oil rose · no effects yet");
  assert.equal(listMeta("Oil rose", 1), "Oil rose · 1 effect");
  const ago = (iso: string) => (iso ? "2 h ago" : "");
  assert.equal(whoLine({ status: "acknowledged", acknowledged_by: "dilan@serendib.lk", acknowledged_at: "2026-11-24T10:00:00Z", resolved_by: null, resolved_at: null }, ago), "Acknowledged by Dilan, 2 h ago");
  assert.equal(whoLine({ status: "resolved", acknowledged_by: null, acknowledged_at: null, resolved_by: "Dilan", resolved_at: "2026-11-24T10:00:00Z" }, ago), "Resolved by Dilan, 2 h ago");
  assert.equal(whoLine({ status: "new", acknowledged_by: null, acknowledged_at: null, resolved_by: null, resolved_at: null }, ago), null);
});

const chk = (verdict: string, what = "Credit-line utilisation: x") => ({ check: { verdict, verdict_text: verdict, what } });

test("what your data says: the event's task speaks first; the alert's own check stands in", () => {
  const task = { next_check_after: "2026-12-01", check: { verdict: "not_yet", change: null, usual: null, what: "w", why: null, as_of: null, next_check_after: "2026-12-01", final: false } };
  const s = effectSays(chk("not_yet"), task, "2026-11-25", true);
  assert.equal(s.verdict?.key, "not_yet");
  assert.equal(s.line, "Next check 1 Dec");
  const fallback = effectSays(chk("confirms", "Credit-line utilisation: +6.1% against the prior periods (usual range 1 to 2)"), undefined, "2026-11-25", true);
  assert.equal(fallback.verdict?.key, "confirms");
  assert.equal(fallback.line, "+6.1% vs the prior periods");
});

test("no check: not checked yet, or checks off when the institution switched them off; never an empty cell", () => {
  assert.equal(effectSays({}, undefined, "2026-11-25", true).word, "Not checked yet");
  assert.equal(effectSays({}, undefined, "2026-11-25", null).word, "Not checked yet");
  assert.equal(effectSays({}, undefined, "2026-11-25", false).off, true);
  const watch = effectSays({}, { watch: { from: "2026-12-03", until: "2027-01-03" } }, "2026-11-25", true);
  assert.equal(watch.word, "Watch starts 3 Dec");
});

test("progress: how many effects have a result, in words", () => {
  assert.equal(checkedCount([chk("confirms"), chk("not_yet"), {}]), 1);
  assert.deepEqual(progressWords(1, 2, null, false), { strong: "Checked against your data: 1 of 2.", rest: "The other waits for your figures." });
  assert.deepEqual(progressWords(2, 2, null, false), { strong: "Checked against your data: 2 of 2.", rest: "" });
  assert.deepEqual(progressWords(1, 4, null, false), { strong: "Checked against your data: 1 of 4.", rest: "The other 3 wait for your figures." });
  assert.deepEqual(progressWords(0, 2, "next check 1 Dec", false), { strong: "Not checked against your data yet.", rest: "Next check 1 Dec." });
  assert.deepEqual(progressWords(0, 2, null, false), { strong: "Not checked against your data yet.", rest: "It waits for your figures." });
  assert.equal(progressWords(0, 2, null, true)?.strong, "Checks are off.");
  assert.equal(progressWords(0, 0, null, false), null);
});

test("evidence is counted in findings", () => {
  assert.equal(evidenceTitle(1), "Evidence · 1 finding");
  assert.equal(evidenceTitle(257), "Evidence · 257 findings");
});

test("an empty list says why and offers the way out", () => {
  assert.deepEqual(emptyCopy("new", "", ""), { title: "No alerts for your teams", text: "When an event could hit your products, the owning team's alert appears here.", clear: null });
  assert.equal(emptyCopy("resolved", "", "").title, "Nothing resolved yet");
  assert.equal(emptyCopy("acknowledged", "", "").title, "Nothing acknowledged");
  assert.deepEqual(emptyCopy("new", "Retail banking", ""), { title: "No new alerts for Retail banking", text: "Other teams may have some.", clear: "team" });
  assert.deepEqual(emptyCopy("new", "", "adverse"), { title: "No new confirmed alerts", text: "Other levels may have some.", clear: "level" });
  assert.equal(emptyCopy("new", "Treasury", "warning").clear, "both");
});

test("the pane shows three effects and folds the rest", () => {
  assert.deepEqual(effectsShown(2, false), { shown: 2, hidden: 0 });
  assert.deepEqual(effectsShown(3, false), { shown: 3, hidden: 0 });
  assert.deepEqual(effectsShown(7, false), { shown: 3, hidden: 4 });
  assert.deepEqual(effectsShown(7, true), { shown: 7, hidden: 0 });
  assert.equal(moreEffects(1), "+1 more effect");
  assert.equal(moreEffects(4), "+4 more effects");
});

test("a list row keeps the first effect; the count moves to the meta line", () => {
  const long = "Tech Employee Savings: deposit inflow expected to fall (and 4 more effects on Data-Center Contractor Credit Lines, Founder and Employee Investment Accounts, Founder and Employee Mortgages)";
  assert.equal(shortTitle(long), "Tech Employee Savings: deposit inflow expected to fall");
  assert.equal(shortTitle("Tech Employee Savings: new accounts expected to fall (and 1 more effect on Founder and Employee Mortgages)"), "Tech Employee Savings: new accounts expected to fall");
  assert.equal(shortTitle("Energy Loans: instalment collection rate expected to fall"), "Energy Loans: instalment collection rate expected to fall");
  const first = { product: "Energy Loans", metric_name: "Instalment collection rate", direction: "fall" };
  assert.equal(shortTitle("x".repeat(120), first), "Energy Loans: Instalment collection rate expected to fall");
});

test("two effects on the same product and metric become one row with both reasons", () => {
  const fx = (id: string, o: object = {}) => ({ hypothesis_id: id, product_id: "m", metric: "icr", direction: "fall", size: "medium", timing: "weeks", chain_label: `why ${id}`, ...o });
  const rows = mergeEffects([fx("a"), fx("b", { timing: "months", size: "large" }), fx("c", { product_id: "other" }), fx("d", { direction: "rise" })]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0].reasons, ["why a", "why b"]);
  assert.equal(rows[0].timing, "weeks to months");
  assert.equal(rows[0].size, "large");
  assert.equal(rows[0].members.length, 2);
  assert.equal(mergeEffects([fx("a"), fx("a")])[0].reasons.length, 1);  // the same reason twice is said once
});

test("the pane heading and the list row show the same short title; the long sentence is not used", () => {
  const a = { title: "Tech Employee Savings: deposit inflow expected to fall (and 4 more effects on Data-Center Contractor Credit Lines, Founder and Employee Mortgages)",
    effects: [{ product: "Tech Employee Savings", metric_name: "Deposit inflow", direction: "fall" }, { product: "Founder and Employee Mortgages", metric_name: "x", direction: "fall" }] };
  assert.equal(alertTitle(a), "Tech Employee Savings: deposit inflow expected to fall");
  assert.equal(alertTitle({ title: "Oil rose", effects: [] }), "Oil rose");
});

test("the +N more effects count merges duplicates first, as the pane's table does", () => {
  const fx = (id: string, o: object = {}) => ({ hypothesis_id: id, product_id: "m", metric: "icr", direction: "fall", size: "medium", timing: "weeks", chain_label: `why ${id}`, ...o });
  assert.equal(effectCount([]), 0);
  assert.equal(effectCount([fx("a"), fx("b")]), 1);  // one row: the list says "1 effect", not "+1 more"
  assert.equal(effectCount([fx("a"), fx("b"), fx("c", { product_id: "other" })]), 2);
  assert.equal(listMeta("Oil rose", effectCount([fx("a"), fx("b")])), "Oil rose · 1 effect");
});

test("the phone's Filter button counts the filters that are on", () => {
  assert.deepEqual(filterState("", ""), { n: 0, label: "Filter", summary: "" });
  assert.deepEqual(filterState("Retail banking", ""), { n: 1, label: "Filter · 1", summary: "Retail banking" });
  assert.deepEqual(filterState("Retail banking", "warning"), { n: 2, label: "Filter · 2", summary: "Retail banking · Early warning" });
  assert.deepEqual(filterState("", "adverse"), { n: 1, label: "Filter · 1", summary: "Confirmed" });
});
