import assert from "node:assert/strict";
import { test } from "node:test";
import { sparkPoints } from "./sparkMath.ts";

test("the lowest value sits at the bottom, the highest at the top, kept clear of the edges", () => {
  assert.equal(sparkPoints([1, 3], 80, 24, 3), "0,21 80,3");
  assert.equal(sparkPoints([5, 1, 3], 80, 24, 3), "0,3 40,21 80,12");
});

test("a flat line is in the middle; too little data draws nothing; bad numbers are skipped", () => {
  assert.equal(sparkPoints([2, 2, 2], 80, 24), "0,12 40,12 80,12");
  assert.equal(sparkPoints([]), "");
  assert.equal(sparkPoints([4]), "");
  assert.equal(sparkPoints([1, NaN, 3], 80, 24, 3), "0,21 80,3");
});
