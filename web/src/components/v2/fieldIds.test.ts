import assert from "node:assert/strict";
import { test } from "node:test";
import { controlAttrs, describedBy, fieldIds, joinIds, type FieldState } from "./fieldIds.ts";

test("one base id gives four distinct ids", () => {
  const ids = fieldIds(":r1:");
  assert.equal(new Set(Object.values(ids)).size, 4);
  assert.equal(ids.control, ":r1:");
});

test("describedBy names only the hint and error that are shown, hint first", () => {
  const ids = fieldIds("f");
  assert.equal(describedBy(ids, {}), undefined);
  assert.equal(describedBy(ids, { hint: true }), "f-h");
  assert.equal(describedBy(ids, { error: true }), "f-e");
  assert.equal(describedBy(ids, { hint: true, error: true }), "f-h f-e");
});

test("joinIds drops empties and repeats", () => {
  assert.equal(joinIds(undefined, "", false, null), undefined);
  assert.equal(joinIds("a b", "b", "c"), "a b c");
});

const single: FieldState = { id: "f", labelId: "f-l", describedBy: "f-h f-e", invalid: true, required: true, single: true };
const group: FieldState = { labelId: "g-l", describedBy: "g-h", invalid: true, required: true, single: false };

test("a control alone in its field gets the id, the description, invalid and required", () => {
  assert.deepEqual(controlAttrs({}, single), {
    id: "f", "aria-labelledby": undefined, "aria-describedby": "f-h f-e", "aria-invalid": true, "aria-required": true,
  });
});

test("a control keeps what it sets itself and adds the field's ids to its own description", () => {
  const a = controlAttrs({ id: "mine", "aria-describedby": "extra", "aria-invalid": "false" }, single);
  assert.equal(a.id, "mine");
  assert.equal(a["aria-describedby"], "extra f-h f-e");
  assert.equal(a["aria-invalid"], "false");
});

test("a control in a group is named by the group and takes no id, error or required mark", () => {
  const a = controlAttrs({}, group);
  assert.equal(a.id, undefined);
  assert.equal(a["aria-labelledby"], "g-l");
  assert.equal(a["aria-describedby"], undefined);
  assert.equal(a["aria-invalid"], undefined);
  assert.equal(a["aria-required"], undefined);
});

test("a control in a group with its own aria-label is not also given the group's name", () => {
  assert.equal(controlAttrs({ "aria-label": "Add a currency" }, group)["aria-labelledby"], undefined);
});

test("outside any field nothing is added", () => {
  assert.deepEqual(controlAttrs({ id: "x" }, null), { id: "x", "aria-describedby": undefined, "aria-invalid": undefined });
});
