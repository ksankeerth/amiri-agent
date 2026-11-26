import assert from "node:assert/strict";
import { test } from "node:test";
import { moreLabel, PAGE, visibleCount, whoSticks } from "./listPaneMath.ts";

test("the shorter column that fits is pinned", () => {
  assert.equal(whoSticks(2300, 700, 765), "pane");     // a long list, a pane that fits: the pane
  assert.equal(whoSticks(600, 1100, 765), "list");     // a short list, a long pane: the list
  assert.equal(whoSticks(700, 700, 765), "pane");      // a tie pins the pane
  assert.equal(whoSticks(900, 1100, 765), "none");     // both taller than the area: nothing is pinned
  assert.equal(whoSticks(765, 2000, 765), "list");     // exactly the area still fits
  assert.equal(whoSticks(2000, 766, 765), "none");
});

test("stacked columns and empty columns pin nothing", () => {
  assert.equal(whoSticks(300, 500, 765, false), "none");
  assert.equal(whoSticks(0, 500, 765), "none");
  assert.equal(whoSticks(300, 0, 765), "none");
});

test("how many rows show", () => {
  assert.equal(PAGE, 10);
  assert.equal(visibleCount(14, PAGE, -1), 10);        // 4 are left behind the button
  assert.equal(visibleCount(5, PAGE, -1), 5);          // a short list shows whole
  assert.equal(visibleCount(11, PAGE, -1), 11);        // one row more is no saving: show it
  assert.equal(visibleCount(25, PAGE, 17), 18);        // a link to the 18th row opens with it in view
  assert.equal(visibleCount(14, PAGE, 12), 14);        // ...and one row alone behind the button is shown too
  assert.equal(visibleCount(25, 20, 3), 20);           // already asked for 20: the open row does not shrink it
  assert.equal(visibleCount(0, PAGE, -1), 0);
});

test("the button says how many more", () => {
  assert.equal(moreLabel(4), "Show 4 more");
  assert.equal(moreLabel(10), "Show 10 more");
  assert.equal(moreLabel(24), "Show 10 more · 24 left");
});
