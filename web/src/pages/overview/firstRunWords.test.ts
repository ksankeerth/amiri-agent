// Run with `node --test src/pages/overview/firstRunWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { demoLine, firstSteps, resetNote, stepNote } from "./firstRunWords.ts";

const inst = (over: Record<string, unknown> = {}) => ({ name: "Austin Tech Bank", status: "setup", readiness: { ready: false, missing_required: 3 }, ...over }) as never;

test("with no institution, step 1 is the one to take and the others wait", () => {
  const s = firstSteps(null, 0);
  assert.deepEqual(s.map(x => x.state), ["open", "locked", "locked"]);
  assert.deepEqual(s.map(x => x.next), [true, false, false]);
  assert.equal(s[0].label, "Start setup");
  assert.equal(s[0].to, "/institution/new");
  assert.equal(stepNote(s[1]), "After step 1");
  assert.equal(stepNote(s[2]), "After step 2");
  assert.equal(stepNote(s[0]), null);
});

test("once an institution exists, setup continues and step 2 says what is missing", () => {
  const s = firstSteps(inst(), 0);
  assert.deepEqual(s.map(x => x.state), ["done", "open", "locked"]);
  assert.equal(s[0].label, "Continue setup");
  assert.equal(s[0].to, "/institution/setup");
  assert.equal(s[1].next, true);
  assert.equal(s[1].body, "3 required items still missing.");
  assert.equal(stepNote(s[0]), "Done");
});

test("a ready, active profile leaves only the monitors", () => {
  const s = firstSteps(inst({ status: "active", readiness: { ready: true, missing_required: 0 } }), 0);
  assert.deepEqual(s.map(x => x.state), ["done", "done", "open"]);
  assert.equal(s[2].next, true);
  assert.equal(firstSteps(inst({ status: "active", readiness: { ready: true, missing_required: 0 } }), 2).every(x => x.state === "done"), true);
  assert.equal(firstSteps(inst({ readiness: { ready: true, missing_required: 0 } }), 0)[1].body, "Everything required is there. Activate the profile so AMIRI Agent starts using it.");
});

test("the demo line and the reset note", () => {
  assert.equal(demoLine({ name: "Serendib Commercial Bank", what: "A bank in Sri Lanka" }), "Serendib Commercial Bank · a bank in Sri Lanka");
  assert.equal(resetNote(true).link, "Settings");
  assert.equal(resetNote(false).link, null);
  assert.equal(resetNote(false).before, "Only on an empty platform.");
});
