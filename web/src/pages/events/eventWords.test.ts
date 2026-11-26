// Run with `node --test src/pages/events/eventWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adverseFor, alertLook, alertStatus, arrowFor, assessmentText, asideTypes, checksUntil, dataSays, expectedParts, findingSource, joinedText,
  groupByDirection, listOrder, moreButtonText, nextCheckText, parseBand, parseNum, periodLayout, progressSteps, rankImpacts, retriedText, runState, scaleLayout, toneFrom, visibleImpacts, whenYoullKnow, type CheckLike,
} from "./eventWords.ts";
import { mergeEffects } from "./mergeEffects.ts";

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
  assert.equal(nextCheckText("2026-11-10", "2026-11-12"), "next check soon");
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
  assert.equal(dataSays({ check: check({ next_check_after: "2026-11-01" }) }, today).line, "Next check soon");
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
  assert.equal(whenYoullKnow({ ...base, status: "open", tasks: [{ next_check_after: "2026-11-01" }] })[0].value, "Soon");
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

// ---------------------------------------------------------------- which products come first
type Row = { id: string; adverse: boolean | null; verdict?: string; size?: string; dir?: string };
const pickRank = (r: Row) => r;
const ids = (rows: Row[]) => rows.map(r => r.id).join(",");

test("products rank bad for you first, then what your data says, then size", () => {
  const rows: Row[] = [
    { id: "good-confirms", adverse: false, verdict: "confirms", size: "large" },
    { id: "bad-other", adverse: true, verdict: "not_yet", size: "medium" },
    { id: "bad-confirms-small", adverse: true, verdict: "confirms", size: "small" },
    { id: "bad-contradicts", adverse: true, verdict: "contradicts", size: "large" },
    { id: "bad-confirms-large", adverse: true, verdict: "confirms", size: "large" },
    { id: "unknown", adverse: null, verdict: "confirms", size: "large" },
  ];
  assert.equal(ids(rankImpacts(rows, pickRank)), "bad-confirms-large,bad-confirms-small,bad-contradicts,bad-other,unknown,good-confirms");
});

test("rows that rank the same keep the order they came in, and ranking leaves the input alone", () => {
  const rows: Row[] = [{ id: "a", adverse: true, size: "medium" }, { id: "b", adverse: true, size: "medium" }, { id: "c", adverse: true, size: "medium" }];
  assert.equal(ids(rankImpacts(rows, pickRank)), "a,b,c");
  const before = ids(rows);
  rankImpacts([{ id: "x", adverse: false }, { id: "y", adverse: true }], pickRank);
  assert.equal(ids(rows), before);
});

test("a missing or unknown size or verdict ranks after a known one", () => {
  const rows: Row[] = [{ id: "none", adverse: true }, { id: "small", adverse: true, size: "Small" }, { id: "odd", adverse: true, size: "huge" }];
  assert.equal(ids(rankImpacts(rows, pickRank)), "small,none,odd");
});

test("only the first five show until the list is opened; a short list shows whole", () => {
  const twelve = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(visibleImpacts(twelve, false), [0, 1, 2, 3, 4]);
  assert.equal(visibleImpacts(twelve, true).length, 12);
  assert.equal(visibleImpacts([1, 2, 3, 4, 5, 6], false).length, 6);
  assert.equal(visibleImpacts([], false).length, 0);
});

test("the button counts what is hidden and flips to Show fewer", () => {
  assert.equal(moreButtonText(12, false), "Show 7 more effects");
  assert.equal(moreButtonText(7, false), "Show 2 more effects");
  assert.equal(moreButtonText(12, true), "Show fewer");
  assert.equal(moreButtonText(6, false), null);
  assert.equal(moreButtonText(2, true), null);
});

test("more than six products are grouped by the way they move, keeping the order inside a group", () => {
  const dirs = ["rise", "fall", "rise", "fall", "rise", "rise", "fall"];
  const rows = dirs.map((dir, i) => ({ id: String(i), dir }));
  const g = groupByDirection(rows, r => r.dir);
  assert.deepEqual(g.map(x => x.label), ["Likely to rise", "Likely to fall"]);
  assert.deepEqual(g[0].items.map(r => r.id), ["0", "2", "4", "5"]);
  assert.deepEqual(g[1].items.map(r => r.id), ["1", "3", "6"]);
});

test("the group holding the first (most important) row comes first", () => {
  const rows = ["fall", "rise", "rise", "fall", "rise", "rise", "rise"].map((dir, i) => ({ id: String(i), dir }));
  assert.deepEqual(groupByDirection(rows, r => r.dir).map(x => x.label), ["Likely to fall", "Likely to rise"]);
});

test("no labels when six or fewer, or when every product moves the same way", () => {
  const mixed = ["rise", "fall", "rise", "fall", "rise", "fall"].map((dir, i) => ({ id: String(i), dir }));
  assert.deepEqual(groupByDirection(mixed, r => r.dir), [{ label: null, items: mixed }]);
  const same = Array.from({ length: 9 }, (_, i) => ({ id: String(i), dir: "rise" }));
  assert.deepEqual(groupByDirection(same, r => r.dir), [{ label: null, items: same }]);
});

test("a move that is neither rise nor fall gets its own group", () => {
  const rows = ["rise", "rise", "rise", "rise", "fall", "fall", "flat"].map((dir, i) => ({ id: String(i), dir }));
  assert.deepEqual(groupByDirection(rows, r => r.dir).map(x => x.label), ["Likely to rise", "Likely to fall", "Other moves"]);
});

test("labels follow the whole list even when only the first five show", () => {
  const rows = ["rise", "rise", "rise", "rise", "rise", "fall", "fall"].map((dir, i) => ({ id: String(i), dir }));
  const g = groupByDirection(rows.slice(0, 5), r => r.dir, rows);
  assert.deepEqual(g.map(x => x.label), ["Likely to rise"]);
  assert.equal(g[0].items.length, 5);
});

test("opening the list never moves a row that already shows: the first five of the open order are the closed rows", () => {
  const dirs = ["fall", "rise", "rise", "fall", "rise", "rise", "fall", "rise", "fall", "rise", "rise", "fall"];
  const ranked = dirs.map((dir, i) => ({ id: String(i), dir }));
  const order = listOrder(ranked, r => r.dir);
  assert.deepEqual(order.map(r => r.id), ["0", "3", "6", "8", "11", "1", "2", "4", "5", "7", "9", "10"]);  // fall group first, rank kept inside
  assert.deepEqual(visibleImpacts(order, true).slice(0, 5), visibleImpacts(order, false));
  // grouping the five that show gives the same rows in the same places as the top of the open list
  const closed = groupByDirection(visibleImpacts(order, false), r => r.dir, order).flatMap(g => g.items);
  assert.deepEqual(closed, order.slice(0, 5));
});

test("a group with no row showing has no label until the list is opened", () => {
  const dirs = ["rise", "rise", "rise", "rise", "rise", "rise", "fall", "fall"];
  const order = listOrder(dirs.map((dir, i) => ({ id: String(i), dir })), r => r.dir);
  const closed = groupByDirection(visibleImpacts(order, false), r => r.dir, order);
  assert.deepEqual(closed.map(g => g.label), ["Likely to rise"]);
  const open = groupByDirection(visibleImpacts(order, true), r => r.dir, order);
  assert.deepEqual(open.map(g => g.label), ["Likely to rise", "Likely to fall"]);
});

test("an ungrouped list keeps its ranked order", () => {
  const rows = Array.from({ length: 9 }, (_, i) => ({ id: String(i), dir: "rise" }));
  assert.deepEqual(listOrder(rows, r => r.dir), rows);
  const short = ["fall", "rise", "fall"].map((dir, i) => ({ id: String(i), dir }));
  assert.deepEqual(listOrder(short, r => r.dir), short);
});

test("the event's product rows: one per product, metric and direction, the most important one's verdict, the larger size, the timing span, both reasons", () => {
  // shaped like the page's hypotheses: the expectation sits under `expected`
  const h = (id: string, o: { size?: string; timing?: string; direction?: string; chain?: string; product?: string } = {}) => ({
    hypothesis_id: id, product_id: o.product ?? "mort", product_name: "Founder and Employee Mortgages", chain_label: o.chain ?? `why ${id}`,
    expected: { metric: "icr", direction: o.direction ?? "fall", size: o.size ?? "medium", timing: o.timing ?? "weeks" },
  });
  const pickRank = (x: ReturnType<typeof h>) => ({ adverse: true, verdict: x.hypothesis_id === "b" ? "confirms" : undefined, size: x.expected.size });
  const flat = (x: ReturnType<typeof h>) => ({ ...x, metric: x.expected.metric, direction: x.expected.direction, size: x.expected.size, timing: x.expected.timing });
  // "a" is the less important (no check); "b" has its data confirm it, so it ranks first and stands for the row
  const ranked = rankImpacts([h("a", { size: "large", timing: "months", chain: "rates up" }), h("b", { size: "small", timing: "days", chain: "arrears" }),
    h("c", { product: "other", direction: "rise" })], pickRank);
  assert.deepEqual(ranked.map(x => x.hypothesis_id), ["b", "a", "c"]);
  const rows = mergeEffects(ranked.map(flat));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].hypothesis_id, "b");  // the verdict and the detail are the most important one's
  assert.equal(rows[0].size, "large");  // the larger size
  assert.equal(rows[0].timing, "days to months");  // the span
  assert.deepEqual(rows[0].reasons, ["arrears", "rates up"]);
  assert.deepEqual(rows[0].members.map(x => x.hypothesis_id), ["b", "a"]);  // a link to either id opens this row
  assert.equal(rows[1].hypothesis_id, "c");
  assert.equal(rows[1].reasons.length, 1);
  // the first five rule still counts rows, and grouping still reads the merged direction
  assert.equal(moreButtonText(rows.length, false), null);
});
