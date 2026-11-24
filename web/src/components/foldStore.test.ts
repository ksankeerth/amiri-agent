// Run with `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFold, writeFold, type StorageLike } from "./foldStore.ts";

function memory(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}
const blocked: StorageLike = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("SecurityError"); },
};

test("a fold the viewer never touched has no saved choice", () => {
  assert.equal(readFold("markets", memory()), null);
});

test("a viewer's open or closed choice is remembered per fold", () => {
  const s = memory();
  writeFold("markets", true, s);
  writeFold("radar", false, s);
  assert.equal(readFold("markets", s), true);
  assert.equal(readFold("radar", s), false);
  writeFold("markets", false, s);
  assert.equal(readFold("markets", s), false);
});

test("blocked storage doesn't break the page: reads are null and writes are ignored", () => {
  assert.equal(readFold("markets", blocked), null);
  assert.doesNotThrow(() => writeFold("markets", true, blocked));
  assert.equal(readFold("markets", null), null);
  assert.doesNotThrow(() => writeFold("markets", true, null));
});

test("garbage in storage reads as no choice", () => {
  const s = memory();
  s.data.set("amiri.folds", "not json");
  assert.equal(readFold("markets", s), null);
  s.data.set("amiri.folds", JSON.stringify({ markets: "yes" }));
  assert.equal(readFold("markets", s), null);
});
