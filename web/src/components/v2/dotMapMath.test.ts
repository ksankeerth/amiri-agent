import assert from "node:assert/strict";
import { test } from "node:test";
import { cellSize, columnsFor, describePlaces, frameBox, gridCells, haloLevel, mainBounds, minSpanFor, pickSides } from "./dotMapMath.ts";

const span = (f: [number, number][]) => [f[1][0] - f[0][0], f[1][1] - f[0][1]];

test("a small area is widened to the smallest span, round its centre", () => {
  const f = frameBox([[-97.7, 30.3], [-102, 31.9]]);
  assert.ok(span(f)[0] >= 30 - 1e-9 && span(f)[1] >= 30 - 1e-9);
  const g = frameBox([[80.7, 7.9]], 8);
  assert.deepEqual(g.map(p => p.map(n => Math.round(n * 10) / 10)), [[76.7, 3.9], [84.7, 11.9]]);
});

test("the frame pads each side by a fifth, and a wide area is left otherwise as it is; nothing to frame gives nothing", () => {
  const f = frameBox([[-125, 15], [-65, 50]], 10, 0.2);
  assert.ok(Math.abs(span(f)[0] - 60 * 1.4) < 1e-9 && Math.abs(span(f)[1] - 35 * 1.4) < 1e-9);
  assert.deepEqual(frameBox([[-125, 15], [-66, 50]]), [[-125, 15], [-66, 50]]);
  assert.deepEqual(frameBox([]), []);
});

test("the span is per direction: a tall area stays tall but is as wide as the smallest span", () => {
  const f = frameBox([[10, -30], [12, 30]], 8);
  assert.ok(Math.abs(span(f)[0] - 8) < 1e-9 && Math.abs(span(f)[1] - 60) < 1e-9);
});

test("padding near the date line and the poles stays on the map", () => {
  const f = frameBox([[178, -41]], 30);
  assert.ok(Math.max(f[0][0], f[1][0]) <= 179 + 1e-9);
  const p = frameBox([[10, 88]], 30);
  assert.ok(p[1][1] <= 89 + 1e-9);
});

test("the smallest span follows the place: an island nation fills half the picture, never under 2 or over 30 degrees", () => {
  assert.equal(minSpanFor(4.4), 4.4 * 1.8);
  assert.equal(minSpanFor(0.45), 2);
  assert.equal(minSpanFor(60), 30);
});

test("a country's main land: its biggest part and the parts near it; far outliers (Alaska, Hawaii) are left out", () => {
  const lower48 = { area: 8, box: [[-125, 25], [-67, 49]] as [[number, number], [number, number]] };
  const alaska = { area: 1.7, box: [[-170, 52], [-130, 71]] as [[number, number], [number, number]] };
  const hawaii = { area: 0.02, box: [[-160, 19], [-155, 22]] as [[number, number], [number, number]] };
  assert.deepEqual(mainBounds([alaska, lower48, hawaii]), [[-125, 25], [-67, 49]]);
  const honshu = { area: 2, box: [[130, 33], [142, 41]] as [[number, number], [number, number]] };
  const hokkaido = { area: 0.7, box: [[140, 41.5], [146, 45.5]] as [[number, number], [number, number]] };
  assert.deepEqual(mainBounds([honshu, hokkaido]), [[130, 33], [146, 45.5]]);
  assert.equal(mainBounds([{ area: 1, box: [[170, -17], [-179, -16]] }]), null);
  assert.equal(mainBounds([]), null);
});

test("dots across: 70 for a continent, 92 for a country or a state, steadily between", () => {
  assert.equal(columnsFor(150), 70);
  assert.equal(columnsFor(90), 70);
  assert.equal(columnsFor(6), 92);
  assert.equal(columnsFor(0.5), 92);
  const mid = columnsFor(25);
  assert.ok(mid > 70 && mid < 92);
  assert.ok(columnsFor(10) > columnsFor(40));
});

test("the cell is the width over a whole number of columns, between 4 and 8 px", () => {
  const world = cellSize(511, 120), sl = cellSize(511, 20), sg = cellSize(511, 5);
  assert.equal(world.cols, 70);
  assert.ok(world.cell > sl.cell && sl.cell > sg.cell);
  for (const c of [world, sl, sg]) { assert.ok(c.cell >= 4 && c.cell <= 8); assert.ok(Math.abs(c.cell * c.cols - 511) < 1e-9); }
  const phone = cellSize(280, 5);
  assert.ok(phone.cell >= 4 && phone.cols <= 70);
  assert.ok(cellSize(2000, 120).cell <= 8);
});

test("a halo has an inner part and an outer ring", () => {
  assert.equal(haloLevel(0, 0, 10), 2);
  assert.equal(haloLevel(5, 0, 10), 2);
  assert.equal(haloLevel(0, 8, 10), 1);
  assert.equal(haloLevel(8, 8, 10), 0);
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
  assert.equal(describePlaces([{ label: "Texas", tone: "bad" }], "Where today's events are", "Texas, California"), "Where today's events are. Bad for you: Texas. Shaded: Texas, California.");
});

test("names go to the first side that fits: right by default, left at the right-hand edge, apart from each other", () => {
  assert.deepEqual(pickSides([{ label: "Austin", x: 100, y: 100 }], 511, 224), ["right"]);
  assert.deepEqual(pickSides([{ label: "Sri Lanka", x: 480, y: 100 }], 511, 224), ["left"]);
  // two places side by side: the first one's name would run over the second's mark on the right, so it goes left
  assert.deepEqual(pickSides([{ label: "Saudi Arabia", x: 100, y: 100 }, { label: "Iran", x: 140, y: 102 }], 511, 224), ["left", "right"]);
  assert.deepEqual(pickSides([{ label: "X", x: 100, y: 100, side: "top" }], 511, 224), ["top"]);
  assert.deepEqual(pickSides([{ label: "Corner", x: 5, y: 5 }], 511, 224), ["right"]);
});

test("a long name with no clear side takes the one that fits the picture, never off its edge", () => {
  // 30 letters on a 350 px picture, with a neighbour's name on its left: only the left stays on the picture
  const two = pickSides([{ label: "Share prices down · nationwide", x: 253, y: 100 }, { label: "Colombo", x: 190, y: 110 }], 350, 153);
  assert.notEqual(two[0], "right");
  assert.equal(pickSides([{ label: "Share prices down · nationwide", x: 340, y: 100 }], 350, 153)[0], "left");
});
