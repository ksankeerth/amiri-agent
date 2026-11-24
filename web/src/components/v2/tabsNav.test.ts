import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTabIndex } from "./tabsNav.ts";

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
