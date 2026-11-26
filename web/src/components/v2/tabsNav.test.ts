import assert from "node:assert/strict";
import { test } from "node:test";
import { centreScroll, edgesOf, nextTabIndex } from "./tabsNav.ts";

test("arrows move along the tabs and wrap round", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 3), 1);
  assert.equal(nextTabIndex("ArrowRight", 2, 3), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 3), 2);
  assert.equal(nextTabIndex("ArrowLeft", 2, 3), 1);
});

test("Home and End jump; other keys and an empty row do nothing", () => {
  assert.equal(nextTabIndex("Home", 2, 4), 0);
  assert.equal(nextTabIndex("End", 0, 4), 3);
  assert.equal(nextTabIndex("Enter", 1, 4), null);
  assert.equal(nextTabIndex("ArrowDown", 1, 4), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), null);
  assert.equal(nextTabIndex("ArrowRight", 0, 1), 0);
});

test("the active tab is centred in a scrolling strip, clamped to both ends", () => {
  assert.equal(centreScroll(500, 80, 360, 900), 360);   // centred: 500 - (360 - 80) / 2
  assert.equal(centreScroll(10, 60, 360, 900), 0);      // near the start: no negative scroll
  assert.equal(centreScroll(840, 60, 360, 900), 540);   // near the end: stops at the last tab
  assert.equal(centreScroll(20, 60, 360, 300), 0);      // everything fits
});

test("a strip fades the edge that hides more tabs", () => {
  assert.deepEqual(edgesOf(0, 360, 900), { start: false, end: true });
  assert.deepEqual(edgesOf(200, 360, 900), { start: true, end: true });
  assert.deepEqual(edgesOf(540, 360, 900), { start: true, end: false });
  assert.deepEqual(edgesOf(0, 360, 360), { start: false, end: false });
  assert.deepEqual(edgesOf(1, 360, 361), { start: false, end: false });  // sub-pixel slack
});
