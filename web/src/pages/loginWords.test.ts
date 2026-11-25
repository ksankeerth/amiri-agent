// Run with `node --test src/pages/loginWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { boxProblem, entryProblem, pausedButton, pausedStatus } from "./loginWords.ts";

const err = (code: string, detail: string) => ({ problem: { code, detail } });

test("a rate limit says what to do next, for the button and for the box", () => {
  assert.match(entryProblem(err("too_many", "Too many tries; wait a minute."), "judge"), /press the button again/);
  assert.match(entryProblem(err("too_many", "Too many tries; wait a minute."), "box"), /tick the box again/);
});

test("any other refusal is the server's own sentence", () => {
  assert.equal(entryProblem(err("captcha_failed", "The check didn't pass. Tick the box again."), "box"), "The check didn't pass. Tick the box again.");
  assert.equal(entryProblem(err("busy", "Too many checks today; try again tomorrow."), "box"), "Too many checks today; try again tomorrow.");
});

test("something that is not an API error still gets a plain sentence", () => {
  assert.match(entryProblem(new Error("x"), "judge"), /Try again in a moment/);
  assert.match(entryProblem(null, "box"), /Try again in a moment/);
});

test("the two reasons the box is missing", () => {
  assert.match(boxProblem("blocked").body, /blocker for google\.com/);
  assert.match(boxProblem("no_key").title, /isn't set up/);
});

test("the paused page says where its check is", () => {
  assert.equal(pausedStatus("idle"), "");
  assert.match(pausedStatus("checking"), /Checking/);
  assert.match(pausedStatus("still"), /Still paused/);
  assert.match(pausedStatus("unreachable"), /Couldn't reach/);
  assert.equal(pausedButton("checking"), "Checking…");
  assert.equal(pausedButton("idle"), "Check again");
});
