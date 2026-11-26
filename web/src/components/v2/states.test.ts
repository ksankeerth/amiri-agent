import assert from "node:assert/strict";
import { test } from "node:test";
import { agoText, isDownError, isEditConflict, loadErrorCopy, refusalOf } from "./states.ts";

const now = Date.UTC(2026, 10, 24, 12, 0, 0);
test("how long ago, in the words the stale banner uses", () => {
  assert.equal(agoText(now - 20_000, now), "less than a minute ago");
  assert.equal(agoText(now - 3 * 60_000, now), "3 min ago");
  assert.equal(agoText(now - 5 * 3600_000, now), "5 h ago");
  assert.equal(agoText(now - 4 * 86400_000, now), "4 days ago");
  assert.equal(agoText(now + 5000, now), "less than a minute ago");
});

test("a server that didn't answer is told apart from one that said no", () => {
  assert.equal(isDownError({ code: "network", status: 0 }), true);
  assert.equal(isDownError({ code: "boom", status: 503 }), true);
  assert.equal(isDownError({ code: "not_found", status: 404 }), false);
  assert.equal(isDownError("nope"), false);
  assert.equal(isDownError(null), false);
});

test("a failed load says what failed, and what is safe", () => {
  const down = loadErrorCopy({ code: "network", status: 0 }, "the alerts", "Your alerts are safe; this page just couldn't reach them.");
  assert.equal(down.title, "Couldn't load the alerts");
  assert.equal(down.message, "AMIRI Agent didn't answer. Your alerts are safe; this page just couldn't reach them.");
  assert.equal(loadErrorCopy({ code: "x", status: 404, detail: "No such alert." }, "the alert").message, "No such alert.");
  assert.match(loadErrorCopy(undefined).message, /Try again/);
});

test("a refusal shows the server's detail, and its code for support", () => {
  assert.deepEqual(refusalOf({ code: "budget_spent", status: 409, detail: "Radar's budget for today is spent." }),
    { message: "Radar's budget for today is spent.", code: "budget_spent" });
  assert.deepEqual(refusalOf(new Error("plain")), { message: "plain", code: undefined });
  assert.equal(refusalOf({ code: "x" }), null);
  assert.equal(refusalOf(5), null);
});

test("412 is an edit conflict", () => {
  assert.equal(isEditConflict({ status: 412 }), true);
  assert.equal(isEditConflict({ status: 409 }), false);
});
