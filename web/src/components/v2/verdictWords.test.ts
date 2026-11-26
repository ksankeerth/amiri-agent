// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { directionOf, DIRECTIONS } from "./directionWords.ts";
import { VERDICT_ORDER, verdictLook, verdictNotes, VERDICTS } from "./verdictWords.ts";

test("the seven server verdicts each have the board's words and a tone", () => {
  assert.deepEqual(VERDICT_ORDER, ["confirms", "contradicts", "no_effect", "insufficient_data", "masked", "not_yet", "error"]);
  assert.deepEqual(VERDICT_ORDER.map(k => VERDICTS[k].label),
    ["Confirms", "Moved the other way", "No effect", "Not enough data", "Hidden by relief", "Waiting for your data", "Couldn't check"]);
  assert.deepEqual(VERDICT_ORDER.map(k => VERDICTS[k].tone), ["ink", "unusual", "good", "neutral", "neutral", "neutral", "bad"]);
});

test("the server's own words win, with a capital letter; an unknown verdict is neutral", () => {
  assert.equal(verdictLook("contradicts", "moved the other way").label, "Moved the other way");
  assert.equal(verdictLook("confirms", "confirmed").label, "Confirmed");
  assert.equal(verdictLook("confirms").label, "Confirms");
  const odd = verdictLook("half_baked");
  assert.equal(odd.tone, "neutral");
  assert.equal(odd.label, "Half baked");
  assert.equal(verdictLook(null).label, "Not checked");
});

test("the small print: a first look, and what it replaces", () => {
  assert.deepEqual(verdictNotes({ final: false, verdict: "confirms", supersedes: { verdict: "not_yet" } }),
    ["First look; may change as more data comes in", "was: Waiting for your data"]);
  assert.deepEqual(verdictNotes({ final: true, verdict: "confirms" }), []);
  assert.deepEqual(verdictNotes({ final: false, verdict: "error" }), []);
  assert.deepEqual(verdictNotes({ final: false, verdict: "not_yet" }), []);
});

test("direction: the server's tone gives a shape and a word; anything else is neutral", () => {
  assert.equal(DIRECTIONS[directionOf("bad")].glyph, "▲");
  assert.equal(DIRECTIONS[directionOf("mixed")].word, "Mixed");
  assert.equal(DIRECTIONS[directionOf("good")].word, "Good for you");
  assert.equal(directionOf("weird"), "neutral");
  assert.equal(directionOf(undefined), "neutral");
  assert.equal(new Set(Object.values(DIRECTIONS).map(d => d.glyph)).size, 4);  // four different shapes: never colour alone
});
