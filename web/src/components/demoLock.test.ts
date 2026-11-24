// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { guarded, isDemoLocked, LOCK_TIP, lockAttrs } from "./demoLock.ts";

const click = () => { const e = { stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } }; return e; };

test("a locked control swallows the click; an open one passes it on", () => {
  let ran = 0;
  const e1 = click();
  guarded(true, () => { ran++; })!(e1);
  assert.equal(ran, 0);
  assert.ok(e1.prevented && e1.stopped);
  const e2 = click();
  guarded(false, () => { ran++; })!(e2);
  assert.equal(ran, 1);
  assert.ok(!e2.prevented);
  assert.equal(guarded(false, undefined), undefined);  // nothing to run, nothing to add
  assert.equal(typeof guarded(true, undefined), "function");  // still stops a click (a link, a submit button)
});

test("a locked control stays focusable, says so, and gives the reason; an open one is left alone", () => {
  assert.deepEqual(lockAttrs(true), { "aria-disabled": true, title: LOCK_TIP, "data-lock": "" });
  assert.ok(!("disabled" in lockAttrs(true)));  // native `disabled` would hide the tooltip and skip the tab order
  assert.deepEqual(lockAttrs(false), {});
});

test("the server's refusal is recognised by its code", () => {
  assert.ok(isDemoLocked({ code: "demo_locked", status: 403 }));
  assert.ok(!isDemoLocked({ code: "reset_off" }));
  assert.ok(!isDemoLocked(new Error("demo_locked")));
  assert.ok(!isDemoLocked(null));
  assert.ok(!isDemoLocked("demo_locked"));
});
