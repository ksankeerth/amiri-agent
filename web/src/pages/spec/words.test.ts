// Run with `node --test src/pages/spec/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adverseLine, barLines, chaptersOf, connectionLine, countLine, defaultCategory, deprecationWord, inTab, methodLine, metricAnchors, nameLookup,
  productCounts, proseRuns, searchMetrics, shownRows, specDate, splitChapters, tabCounts, unitAndGrain, viewOf, yourCategories,
} from "./words.ts";

const metric = (key: string, tier = "required") => ({ key, tier }) as never;
const cats = [
  { id: "a", metrics: [metric("x"), metric("y", "optional")] },
  { id: "b", metrics: [metric("x")] },
  { id: "c", metrics: [] },
] as never;

test("a category's first line counts its metrics and its required ones", () => {
  assert.equal(countLine((cats as { id: string }[])[0] as never), "2 metrics · 1 required");
  assert.equal(countLine({ metrics: [metric("z", "optional")] } as never), "1 metric · none required");
});

test("a repeated key keeps its first anchor and the later category adds its own", () => {
  const ids = metricAnchors(cats);
  assert.equal(ids.get("a/x"), "metric-x");
  assert.equal(ids.get("b/x"), "metric-x-b");
});

test("every old anchor still opens the right view", () => {
  assert.deepEqual(viewOf("", cats), { kind: "home" });
  assert.deepEqual(viewOf("#cat-a", cats), { kind: "category", id: "a" });
  assert.deepEqual(viewOf("#metric-x-b", cats), { kind: "category", id: "b", open: "metric-x-b" });
  assert.deepEqual(viewOf("#metric-nope", cats), { kind: "home" });
  assert.deepEqual(viewOf("#dim-region_l1", cats), { kind: "chapter", id: "s7", target: "dim-region_l1" });
  assert.deepEqual(viewOf("#check-C01", cats), { kind: "chapter", id: "s9", target: "check-C01" });
  assert.deepEqual(viewOf("#s2", cats), { kind: "chapter", id: "s2" });
  assert.deepEqual(viewOf("#changes", cats), { kind: "chapter", id: "changes" });
  assert.deepEqual(viewOf("#s5", cats), { kind: "home" });
});

test("a metric's facts are said in words", () => {
  assert.equal(adverseLine(["fall", "rise"]), "bad when it rises or falls");
  assert.equal(adverseLine(["fall"]), "bad when it falls");
  assert.equal(adverseLine([]), "not judged as good or bad");
  assert.equal(unitAndGrain({ unit: "per_1000", grain: "weekly" }), "per 1,000, weekly");
  assert.equal(specDate("2026-10-11"), "11 Oct 2026");
  assert.equal(methodLine("seasonal_ratio"), "The same season in past years (seasonal ratio)");
});

test("what an effect needs is one sentence when every size agrees", () => {
  const same = { small: { pct_change: 5, percentile: 5 }, medium: { pct_change: 5, percentile: 5 }, large: { pct_change: 5, percentile: 5 } };
  assert.deepEqual(barLines(same), [{ text: "A change of 5% or more, among the most extreme 5% of past values", spec: "pct change 5, percentile 5" }]);
  assert.equal(barLines({ small: { pct_change: 5 }, large: { pct_change: 3 } }).length, 2);
  assert.deepEqual(barLines(null), []);
});

test("a drawn chapter's text is cut around its tables", () => {
  assert.deepEqual(proseRuns("Intro\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n**After.** text\n"), ["Intro", "**After.** text"]);
});

const full = (key: string, over: Record<string, unknown> = {}) => ({ key, name: key.toUpperCase(), question: `Q ${key}`, tier: "optional", starter: false, ...over }) as never;
const spread = [
  { id: "bank1", institution: "bank", name: "Deposits", metrics: [full("a", { tier: "required", starter: true }), full("b", { starter: true }), full("c", { tier: "required" }), full("d")] },
  { id: "bank2", institution: "bank", name: "Lending", metrics: [full("e")] },
  { id: "ins1", institution: "insurer", name: "Motor", metrics: [full("f")] },
] as never as import("../../api/spec").SpecCategory[];

test("the page opens on the institution's own category, else its kind, else the first", () => {
  const mine = productCounts([{ category: "bank2" }, { category: "bank2" }, { category: "bank1" }]);
  assert.equal(mine.get("bank2"), 2);
  assert.deepEqual(yourCategories(spread, mine).map(c => c.id), ["bank1", "bank2"]);  // the spec's order, not the count's
  assert.equal(defaultCategory(spread, mine, "bank")?.id, "bank1");
  assert.equal(defaultCategory(spread, new Map(), "insurer")?.id, "ins1");
  assert.equal(defaultCategory(spread, new Map(), null)?.id, "bank1");
  assert.equal(defaultCategory([], new Map(), null), undefined);
});

test("the tabs count and filter a category's metrics", () => {
  const ms = spread[0].metrics!;
  assert.deepEqual(tabCounts(ms), { all: 4, starter: 2, required: 2 });
  assert.deepEqual(inTab(ms, "starter").map(m => m.key), ["a", "b"]);
  assert.deepEqual(inTab(ms, "required").map(m => m.key), ["a", "c"]);
  assert.equal(inTab(ms, "all").length, 4);
});

test("six rows show at first; a linked metric further down, or 'more', shows all (a single extra row is never hidden)", () => {
  assert.equal(shownRows(12, false), 6);
  assert.equal(shownRows(12, true), 12);
  assert.equal(shownRows(12, false, 9), 12);
  assert.equal(shownRows(12, false, 2), 6);
  assert.equal(shownRows(7, false), 7);
  assert.equal(shownRows(3, false), 3);
});

test("a replaced metric says what replaced it", () => {
  const nameOf = nameLookup([{ metrics: [full("claims_notified", { name: "Claims notified" })] }] as never);
  assert.equal(deprecationWord({ deprecated_in: "1.1", replaced_by: "claims_notified" }, nameOf), "Replaced by Claims notified · 1.1");
  assert.equal(deprecationWord({ deprecated_in: "1.1", replaced_by: null }, nameOf), "Deprecated · 1.1");
  assert.equal(deprecationWord({ deprecated_in: null, replaced_by: null }, nameOf), null);
  assert.equal(nameOf("claims_count"), "Claims count");
});

test("search finds a metric by key, name, question or category", () => {
  assert.deepEqual(searchMetrics(spread, "  LEND ").map(r => r.m.key), ["e"]);
  assert.deepEqual(searchMetrics(spread, "q f").map(r => r.m.key), ["f"]);
  assert.deepEqual(searchMetrics(spread, "").map(r => r.m.key), []);
});

test("the guide's rail shows four chapters and keeps the rest under 'all'", () => {
  const chs = chaptersOf({ guide: { "1": { title: "One", md: "" }, "3": { title: "Levels", md: "" } }, drawn: { "9": { title: "Checks", md: "" } } });
  assert.deepEqual(chs.map(c => c.id).slice(0, 3), ["intro", "s1", "s2"]);
  assert.ok(!chs.some(c => c.id === "s5"));
  assert.equal(chs.find(c => c.id === "s2")?.title, "Chapter 2");
  const { shown, rest, openRest } = splitChapters(chs, "s7");
  assert.deepEqual(shown.map(c => c.id), ["intro", "s3", "s9", "changes"]);
  assert.equal(rest.length, chs.length - 4);
  assert.equal(openRest, true);
  assert.equal(splitChapters(chs, "s3").openRest, false);
});

test("the banner says whether the institution serves the figures and whether checks are on", () => {
  const base = { configured: true, validationOn: true, approved: true, name: "Austin Tech Bank", source: "bank" as const, coverage: { some: 11, total: 12 } };
  const on = connectionLine(base);
  assert.equal(on.tone, "good");
  assert.equal(on.pill, "Connected · checks on");
  assert.equal(on.text, "Austin Tech Bank serves these figures (sample bank, 11 of 12 products), so Amiri Agent checks its expectations against them.");
  const off = connectionLine({ ...base, validationOn: false, approved: false });
  assert.equal(off.pill, "Connected · checks off");
  assert.match(off.text, /approve a ready connection first/);
  assert.equal(connectionLine({ ...base, configured: false }).pill, "Not connected");
  assert.match(connectionLine({ ...base, name: null, source: null, coverage: null }).text, /^The institution serves these figures, so/);
});
