// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { zx } from "./format.ts";

test("a move vs typical is rounded down, so one under the threshold never reads as it", () => {
  assert.equal(zx(-2.998), "2.9×");
  assert.equal(zx(3), "3.0×");
  assert.equal(zx(8.085), "8.0×");
  assert.equal(zx(null), "—");
});
