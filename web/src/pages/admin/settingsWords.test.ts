// Run with `node --test src/pages/admin/settingsWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { confirmed, demoMode, institutionLine, resetChoices, resetProblem, resetState } from "./settingsWords.ts";

test("the reset is unknown until the installation loads, allowed unless the server says false", () => {
  assert.equal(resetState(null), "unknown");
  assert.equal(resetState({}), "allowed");
  assert.equal(resetState({ prototype_reset: true }), "allowed");
  assert.equal(resetState({ prototype_reset: false }), "off");
});

test("the demo lock row says on or off in words", () => {
  assert.deepEqual([demoMode({ demo_lock: true }).on, demoMode({ demo_lock: true }).word], [true, "On"]);
  assert.deepEqual([demoMode({}).on, demoMode({ demo_lock: false }).word], [false, "Off"]);
  assert.match(demoMode({ demo_lock: true }).line, /switched off/);
});

test("the institution row", () => {
  assert.equal(institutionLine({ name: "Serendib Commercial Bank" }), "Serendib Commercial Bank");
  assert.equal(institutionLine({ name: null, profile: false }), "None yet");
  assert.equal(institutionLine({ name: null, profile: true }), "Not named");
});

test("the reset offers each demo, then empty", () => {
  const c = resetChoices([{ kind: "bank", label: "Demo bank", name: "Serendib", what: "A bank" }, { kind: "insurer", label: "Demo insurer", name: "Samudra", what: "An insurer" }]);
  assert.deepEqual(c.map(x => x.id), ["demo-bank", "demo-insurer", "empty"]);
  assert.equal(c[0].title, "Demo bank: Serendib");
});

test("RESET must be typed, in any case", () => {
  assert.equal(confirmed(""), false);
  assert.equal(confirmed("rese"), false);
  assert.equal(confirmed(" reset "), true);
  assert.equal(confirmed("RESET"), true);
});

test("a failed reset says the server's sentence, or a plain one", () => {
  assert.equal(resetProblem({ problem: { detail: "Reset is switched off on this server (PROTOTYPE_RESET)." } }), "Reset is switched off on this server (PROTOTYPE_RESET).");
  assert.match(resetProblem(new Error("x")), /Nothing was changed/);
});
