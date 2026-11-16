import { test } from "node:test";
import assert from "node:assert/strict";
import { niceTicks, spikeIndex, tagGroups } from "./chartMath.ts";

test("niceTicks gives round values inside the range", () => {
  assert.deepEqual(niceTicks(330.45, 332.6), { ticks: [330.5, 331, 331.5, 332, 332.5], dec: 1 });
  assert.deepEqual(niceTicks(304.08, 333.42).ticks, [305, 310, 315, 320, 325, 330]);
  assert.equal(niceTicks(0.1, 0.9).dec, 1);
});

test("spikeIndex finds a one-bar jump that reverses, and nothing in a trend", () => {
  assert.equal(spikeIndex([331, 331.01, 331.02, 332.4, 331.03, 331.02, 331.04]), 3);
  assert.equal(spikeIndex([300, 306, 312, 318, 324, 330]), -1);
});

test("tagGroups draws one tag per cluster of close marks, with the count", () => {
  const m = (x: number, tag = "Flagged move") => ({ m: { tag }, x, ok: true });
  const g = tagGroups([m(700), m(640), m(560), m(600), m(100), { m: { tag: "x" }, x: 300, ok: false }]);
  assert.deepEqual(g.map(({ x, n }) => [x, n]), [[100, 1], [700, 4]]);
});
