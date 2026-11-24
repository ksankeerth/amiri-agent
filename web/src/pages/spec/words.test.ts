// Run with `node --test src/pages/spec/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { adverseLine, barLines, countLine, methodLine, metricAnchors, proseRuns, specDate, unitAndGrain, viewOf } from "./words.ts";

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
