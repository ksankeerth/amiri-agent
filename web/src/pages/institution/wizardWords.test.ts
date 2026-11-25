// Run with `node --test src/pages/institution/wizardWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Check } from "../../api/institutions";
import { fixStep, goLiveNote, progressLine, requiredLine, stepAria, stepIndex, stepMark, stepStates, STEPS, whyNotLive } from "./wizardWords.ts";

const check = (id: string, ok: boolean, level: Check["level"] = "required", section = "institution"): Check => ({ id, level, ok, message: id, section, fix: "" });
const ALL_OK = ["identity", "footprint_home", "segments", "products", "segment_mapping", "product_segments", "flows", "regulators", "rivals", "risk_exposures"].map(id =>
  check(id, true, ["identity", "footprint_home", "segments", "products"].includes(id) ? "required" : "recommended"));
const with_ = (...open: string[]) => ALL_OK.map(c => (open.includes(c.id) ? { ...c, ok: false } : c));

test("the steps keep their order and every key is unique", () => {
  assert.deepEqual(STEPS.map(s => s.key), ["institution", "where", "customers", "products", "flows", "rules", "rivals", "risks", "monitors", "review"]);
  assert.equal(new Set(STEPS.map(s => s.key)).size, STEPS.length);
  assert.ok(STEPS.every(s => s.label && s.title && s.lede));
});

test("an address names a step; none is the first; a made-up one is -1", () => {
  assert.equal(stepIndex(undefined), 0);
  assert.equal(stepIndex("institution"), 0);
  assert.equal(stepIndex("products"), 3);
  assert.equal(stepIndex("review"), 9);
  assert.equal(stepIndex("nope"), -1);
});

test("everything done: every step is done and the profile is ready", () => {
  const s = stepStates({ ready: true, checks: ALL_OK });
  assert.ok(s.every(x => x === "done"));
  assert.equal(progressLine(s), "10 of 10 steps done");
});

test("a required part open marks its step required; the steps without one are just not started", () => {
  const s = stepStates({ ready: false, checks: with_("footprint_home", "products") });
  assert.equal(s[1], "required");   // where
  assert.equal(s[3], "required");   // products
  assert.equal(s[0], "done");
  assert.equal(s[9], "open");       // review: not ready
  assert.equal(progressLine(s), "7 of 10 steps done");
});

test("a recommended part open leaves the step partly done; monitors and review depend on nothing else", () => {
  const s = stepStates({ ready: true, checks: with_("flows", "rivals", "segment_mapping") });
  assert.equal(s[4], "partial");  // flows
  assert.equal(s[6], "partial");  // rivals
  assert.equal(s[2], "partial");  // customers: required done, mapping open
  assert.equal(s[8], "done");     // monitors: no check of its own
  assert.equal(s[9], "done");
});

test("a step never reads as colour alone: a shape (or the number) and a word", () => {
  assert.deepEqual(stepMark("done", "where"), { shape: "✓", word: "Done" });
  assert.deepEqual(stepMark("partial", "flows"), { shape: "◐", word: "Part still open" });
  assert.deepEqual(stepMark("required", "products"), { shape: "◆", word: "Required" });
  assert.deepEqual(stepMark("open", "rivals"), { shape: "", word: "Not started" });
  assert.equal(stepMark("done", "review").word, "Ready");
  assert.equal(stepMark("open", "review").word, "Not ready");
});

test("the screen-reader name carries the number, the step and its state", () => {
  assert.equal(stepAria(3, "Customers", "required", "customers"), "Step 3, Customers: required, not done yet");
  assert.equal(stepAria(10, "Review", "open", "review"), "Step 10, Review: not ready to go live");
  assert.equal(stepAria(10, "Review", "done", "review"), "Step 10, Review: ready to go live");
  assert.match(stepAria(5, "Flows", "partial", "flows"), /a recommended part is still open/);
});

test("Fix goes to the step that holds the section; the institution's own details have no step", () => {
  assert.equal(fixStep("footprint"), "where");
  assert.equal(fixStep("watch-places"), "where");
  assert.equal(fixStep("segments"), "customers");
  assert.equal(fixStep("counterparties"), "rivals");
  assert.equal(fixStep("risk-exposures"), "risks");
  assert.equal(fixStep("institution"), null);
  assert.ok(["footprint", "watch-places", "segments", "products", "flows", "regulators", "rivals", "counterparties", "risk-exposures"].every(s => STEPS.some(x => x.key === fixStep(s))));
});

test("go-live words: what is missing, what is left open", () => {
  assert.equal(requiredLine(ALL_OK), "4 of 4 required parts done");
  assert.equal(requiredLine(with_("products", "segments")), "2 of 4 required parts done");
  assert.equal(whyNotLive({ ready: true, missing_required: 0 }), "");
  assert.equal(whyNotLive({ ready: false, missing_required: 1 }), "1 required part still missing.");
  assert.equal(whyNotLive({ ready: false, missing_required: 3 }), "3 required parts still missing.");
  assert.equal(goLiveNote({ open_recommendations: 0 }), "Everything required and recommended is there.");
  assert.equal(goLiveNote({ open_recommendations: 1 }), "1 recommended part still open. You can finish it later.");
  assert.equal(goLiveNote({ open_recommendations: 4 }), "4 recommended parts still open. You can finish them later.");
});
