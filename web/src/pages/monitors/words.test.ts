// Run with `node --test src/pages/monitors/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { everyWords, isOverdue, lineMatches } from "./words.ts";

test("says how often", () => {
  assert.equal(everyWords(60), "every hour");
  assert.equal(everyWords(1440), "once a day");
  assert.equal(everyWords(360), "every 6 hours");
  assert.equal(everyWords(15), "every 15 minutes");
});

test("a live monitor is overdue after twice its frequency", () => {
  const now = new Date("2026-11-11T03:30:00Z");
  const m = (at: string, status: "live" | "paused" = "live") => ({ status, check_frequency: 60, last_check: { at, status: "quiet" as const, findings: 0 } });
  assert.equal(isOverdue(m("2026-11-11T01:45:00Z"), now), false);
  assert.equal(isOverdue(m("2026-11-11T01:15:00Z"), now), true);
  assert.equal(isOverdue(m("2026-11-10T06:30:00Z", "paused"), now), false);
  assert.equal(isOverdue({ status: "live", check_frequency: 60, last_check: null }, now), false);
});

test("counts the findings that met each line", () => {
  assert.deepEqual(lineMatches(3, [{ source_ref: { lines: [1] } }, { source_ref: { lines: [1, 3] } }, { source_ref: null }]), [2, 0, 1]);
});
