import assert from "node:assert/strict";
import { test } from "node:test";
import { describePlaces, frameOf, gridCells } from "./dotMapMath.ts";

test("a small area is padded to at least 30 degrees each way, round its centre", () => {
  const f = frameOf([[-97.7, 30.3], [-102, 31.9]]);
  const lons = f.map(p => p[0]), lats = f.map(p => p[1]);
  assert.ok(Math.max(...lons) - Math.min(...lons) >= 30 - 1e-9);
  assert.ok(Math.max(...lats) - Math.min(...lats) >= 30 - 1e-9);
});

test("a wide area is left as it is; nothing to frame gives nothing", () => {
  const pts: [number, number][] = [[-125, 15], [-66, 50]];
  assert.deepEqual(frameOf(pts), pts);
  assert.deepEqual(frameOf([]), []);
});

test("padding near the date line stays on the map", () => {
  const f = frameOf([[178, -41]]);
  assert.ok(Math.max(...f.map(p => p[0])) <= 179 + 1e-9);
  assert.ok(Math.min(...f.map(p => p[0])) >= -179 - 1e-9);
});

test("the board's picture (511 × 224, 7 px cells) is 73 columns by 32 rows", () => {
  const cells = gridCells(511, 224, 7);
  assert.equal(cells.length, 73 * 32);
  assert.deepEqual(cells[0], { col: 0, row: 0, x: 3.5, y: 3.5 });
  assert.deepEqual(cells[73], { col: 0, row: 1, x: 3.5, y: 10.5 });
});

test("the picture's words name every place under its direction", () => {
  const t = describePlaces([{ label: "Austin", tone: "bad" }, { label: "Texas", tone: "bad" }, { label: "Silicon Valley", tone: "mixed" }, { label: "Permian", tone: "good" }]);
  assert.equal(t, "Where today's events are. Bad for you: Austin, Texas. Mixed: Silicon Valley. Good for you: Permian.");
  assert.equal(describePlaces([]), "Where today's events are: none.");
});
