// Run with `node --test src/pages/events/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupAside, otherEventsInReport, plannedTests, testWords, untracedWhy } from "./words.ts";

test("a check's tests read as Needed / Yours", () => {
  assert.deepEqual(testWords("change −1.5%, needed +5.0% or higher: not met", "seasonal_ratio", false),
    { needed: "a rise of 5.0% or more against the same period last year", yours: "−1.5%", met: false, stricter: false });
  assert.deepEqual(testWords("percentile 39, needed 98 or higher: not met", "seasonal_ratio", false),
    { needed: "higher than 98% of the same period in past years", yours: "higher than 39%", met: false, stricter: true });
  assert.equal(testWords("percentile 39, needed 98 or higher: not met", "seasonal_ratio", true)?.stricter, false);
  assert.equal(testWords("change −0.55 pp, needed +0.60 pp or higher: not met", "level_change")?.needed,
    "a rise of 0.60 pp or more against the level before the event");
  assert.equal(testWords("change −4.2%, needed −4.0% or lower: met", "seasonal_ratio")?.met, true);
  assert.equal(testWords("something else entirely"), null);
});

test("before a check runs, every test it will use is listed", () => {
  const t = plannedTests([{ statistic: "percentile", op: "<=", value: 5 }, { statistic: "pct_change", op: "<=", value: -4 }], "seasonal_ratio", "fall", false);
  assert.deepEqual(t, [
    { text: "in the lowest 5% of the same period in past years", stricter: true },
    { text: "a fall of 4.0% or more against the same period last year", stricter: false },
  ]);
  // a level check adds a test of how unusual the change is when the task has none
  const l = plannedTests([{ statistic: "pp_change", op: "<=", value: -0.5 }], "level_change", "fall", false);
  assert.equal(l.length, 2);
  assert.equal(l[0].text, "a fall of 0.50 pp or more against the level before the event");
  assert.equal(l[1].text, "in the lowest 5% of past changes like it");
});

test("identical set-aside reasons are grouped", () => {
  const r = "None of these products offers a metric that could show this effect.";
  const g = groupAside([{ product_type: "remittance", angle: "corridor", decision: "rejected", reason: r },
    { product_type: "business_loan", angle: "repayment_stress", decision: "rejected", reason: r }]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].links, ["Remittances · sending countries", "Business loan · missed repayments"]);
});

test("the report's own line says why nothing was traced, for this event only", () => {
  const report = "# Investigation\n\n3 findings, 3 events.\n\n## Oil fell (6.75%)\n\n30 Oct 2026, Sri Lanka. From: Brent down 6.75%.\n\n"
    + "Nothing is traced yet: the move (6.75%) is below the size its effects need (from about 7.0%).\n\n## Oil rose\n\n02 Nov 2026. From: Tanker hit.\n\n"
    + "**What could be affected**\n\n## Findings set aside\n\n- x";
  assert.equal(untracedWhy(report, ["Brent down 6.75%"]), "Nothing is traced yet: the move (6.75%) is below the size its effects need (from about 7.0%).");
  assert.equal(untracedWhy(report, ["Tanker hit"]), null);
  assert.equal(untracedWhy(report, ["Not in the report"]), null);
  assert.equal(otherEventsInReport(report), 1);
});
