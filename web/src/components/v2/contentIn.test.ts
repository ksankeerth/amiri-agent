import { test } from "node:test";
import assert from "node:assert/strict";
import { filledIn } from "./contentIn.ts";

// just enough of a DOM element for the check
const el = (o: { skel?: boolean; holds?: boolean; connected?: boolean } = {}) => ({
  nodeType: 1, isConnected: o.connected ?? true,
  matches: () => !!o.skel, querySelector: () => (o.holds ? {} : null),
}) as unknown as Node;
const list = (...n: Node[]) => n as unknown as NodeList;
const rec = (target: Node, added: Node[], removed: Node[]) => ({ target, addedNodes: list(...added), removedNodes: list(...removed) });

test("what is put where a placeholder was removed fades in", () => {
  const parent = el(), content = el();
  assert.deepEqual(filledIn([rec(parent, [], [el({ skel: true })]), rec(parent, [content], [])]), [content]);
});

test("a placeholder that holds a bar counts, and so does one that is the page's root", () => {
  const parent = el(), content = el();
  assert.deepEqual(filledIn([rec(parent, [content], [el({ holds: true })])]), [content]);
});

test("a refresh (content replaced by content) never fades", () => {
  const parent = el();
  assert.deepEqual(filledIn([rec(parent, [el()], [el()])]), []);
});

test("a placeholder replaced by another placeholder, or by something not on the page, doesn't fade", () => {
  const parent = el();
  assert.deepEqual(filledIn([rec(parent, [el({ skel: true })], [el({ skel: true })])]), []);
  assert.deepEqual(filledIn([rec(parent, [el({ connected: false })], [el({ skel: true })])]), []);
});

test("only the parent that lost its placeholder", () => {
  const a = el(), b = el(), inA = el(), inB = el();
  assert.deepEqual(filledIn([rec(a, [inA], [el({ skel: true })]), rec(b, [inB], [])]), [inA]);
});
