import { test } from "node:test";
import assert from "node:assert/strict";
import { mirrorAround, niceTicks, spikeIndex, tagGroups } from "./chartMath.ts";

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
  assert.deepEqual(g.map(({ x0, x, n }) => [x0, x, n]), [[100, 100, 1], [560, 700, 4]]);
});

test("mirrorAround stays on the map, along the same line", () => {
  assert.deepEqual(mirrorAround([80, 7], [70, 17]), [86, 1]);  // inside the map: the plain 60 % mirror
  const nz: [number, number] = [172.5, -41.3], [x, y] = mirrorAround(nz, [-0.1, 51.5]);  // London, mirrored around New Zealand
  assert.ok(x <= 179 && x >= -179 && y <= 89 && y >= -89, `${x}, ${y}`);
  assert.ok(Math.abs((y - nz[1]) / (x - nz[0]) - (nz[1] - 51.5) / (nz[0] + 0.1)) < 1e-9);  // same direction
  assert.deepEqual(mirrorAround([179, 0], [170, 0]), [179, 0]);  // home on the edge: no room, no mirror
});
