import { test } from "node:test";
import assert from "node:assert/strict";
import { busyState, exitDelay, holdMs, holdPlan, indicatorBox, withLeaving, EXIT_MS, SNAP_BELOW } from "./motion.ts";

test("indicator sits under the tab, as wide as it, on whole pixels", () => {
  assert.deepEqual(indicatorBox({ left: 10.4, top: 0, width: 80.6, height: 38 }, 2, "bottom"), { x: 10, y: 36, w: 81 });
  assert.deepEqual(indicatorBox({ left: 0, top: 40, width: 60, height: 38 }, 2, "bottom"), { x: 0, y: 76, w: 60 });  // a wrapped second row
});
test("indicator over the tab for the institution strip", () => {
  assert.deepEqual(indicatorBox({ left: 120, top: 0, width: 100, height: 70 }, 3, "top"), { x: 120, y: 0, w: 100 });
  assert.equal(indicatorBox({ left: 0, top: 0, width: -5, height: 10 }, 3, "top").w, 0);
});
test("a panel holds its height only for a real change and only with motion on", () => {
  assert.equal(holdPlan(400, 700, false), "animate");
  assert.equal(holdPlan(700, 400, false), "animate");
  assert.equal(holdPlan(400, 400 + SNAP_BELOW - 1, false), "none");
  assert.equal(holdPlan(400, 400 + SNAP_BELOW, false), "animate");
  assert.equal(holdPlan(400, 700, true), "none");
  assert.equal(holdPlan(0, 700, false), "none");     // first paint: nothing to hold
  assert.equal(holdPlan(Number.NaN, 700, false), "none");
});
test("a height change takes 220 ms, more for a big one, never over 340", () => {
  assert.equal(holdMs(400, 460), 220);
  assert.equal(holdMs(100, 700), 280);
  assert.equal(holdMs(100, 5000), 340);
  assert.equal(holdMs(700, 100), 280);
});
test("exits wait 120 ms, or nothing under reduced motion", () => {
  assert.equal(exitDelay(false), EXIT_MS);
  assert.equal(exitDelay(true), 0);
  assert.equal(exitDelay(false, 200), 200);
});
test("a busy button blocks clicks and says it is busy, whatever else it was told", () => {
  assert.deepEqual(busyState(true, false), { disabled: false, ariaBusy: true, blocksClick: true });
  assert.deepEqual(busyState(false, true), { disabled: true, ariaBusy: false, blocksClick: false });
  assert.deepEqual(busyState(false, undefined), { disabled: false, ariaBusy: false, blocksClick: false });
});
test("toasts that went keep their place and fade; new ones go last", () => {
  const a = { id: 1, m: "a" }, b = { id: 2, m: "b" }, c = { id: 3, m: "c" };
  const first = withLeaving([], [a, b]);
  assert.deepEqual(first.map(x => [x.item.id, x.leaving]), [[1, false], [2, false]]);
  const second = withLeaving(first, [b, c]);
  assert.deepEqual(second.map(x => [x.item.id, x.leaving]), [[1, true], [2, false], [3, false]]);
  const third = withLeaving(second, [b, c]);     // the leaving one is dropped by the caller after its fade; here it stays marked
  assert.deepEqual(third.map(x => [x.item.id, x.leaving]), [[1, true], [2, false], [3, false]]);
});
