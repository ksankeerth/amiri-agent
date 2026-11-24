// Run with `node --test src/pages/studio/words.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { eventsSplit, findingsSplit, howRun, storyWord, trackDays } from "./words.ts";

test("marks each day: run, event formed, headlines", () => {
  const d = trackDays(5, 3, [{ kind: "headline", step: 1 }, { kind: "event", step: 2 }, { kind: "headline", step: 2 }, { kind: "check", step: 3 }]);
  assert.equal(d.length, 5);
  assert.deepEqual(d.map(x => x.ran), [true, true, true, false, false]);
  assert.deepEqual(d.map(x => x.event), [false, true, false, false, false]);
  assert.deepEqual(d.map(x => x.headlines), [true, true, false, false, false]);
});

test("says where findings came from", () => {
  assert.equal(findingsSplit([]), "nothing unusual yet");
  const f = (source: string) => ({ kind: "finding", data: { source } });
  assert.equal(findingsSplit([f("monitor"), f("monitor"), f("timeseries")]), "2 from news · 1 from prices");
  assert.equal(findingsSplit([f("timeseries")]), "1 from prices");
});

test("sums up events by tone", () => {
  assert.equal(eventsSplit([]), "none yet");
  assert.equal(eventsSplit([{ tone: "bad" }, { tone: "bad" }]), "2 bad for you");
  assert.equal(eventsSplit([{ tone: "bad" }, { tone: "good" }]), "1 bad · 1 good for you");
});

test("story words", () => {
  assert.equal(storyWord(true, false), "Found");
  assert.equal(storyWord(false, true), "Not yet");
  assert.equal(storyWord(false, false), "Missed");
  assert.equal(howRun("replay"), "replaying a recording");
});
