// Run with `node --test src/pages/admin/resetFile.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkShape, profileFile, readResetFile, resetFailure, summarize } from "./resetFile.ts";

const INST = { name: "Serendib Commercial Bank", institution_type: "bank", home_country: "LK", base_currency: "LKR", time_zone: "Asia/Colombo" };
const FILE = { institution: INST, sections: { footprint: [{ code: "LK", role: "home" }], products: [{ name: "A" }, { name: "B" }], segments: [{ label: "Farmers" }], flows: [] } };

test("a profile in the import shape reads, with its summary", () => {
  const r = readResetFile(JSON.stringify(FILE));
  assert.ok(r.ok);
  assert.deepEqual([r.summary.name, r.summary.kind, r.summary.home, r.summary.currency], ["Serendib Commercial Bank", "Bank", "LK", "LKR"]);
  assert.deepEqual(r.summary.counts.map(c => c.words), ["1 place in the footprint", "1 customer group", "2 products"]);  // the server's order; empty sections left out
  assert.equal(r.summary.total, 4);
});

test("an insurer is called one; a file with no sections is still a profile", () => {
  const r = readResetFile(JSON.stringify({ institution: { ...INST, institution_type: "insurer" } }));
  assert.ok(r.ok);
  assert.equal(r.summary.kind, "Insurer");
  assert.deepEqual(r.summary.counts, []);
  assert.deepEqual(r.profile.sections, {});
});

test("other top-level keys (an _about note) are not sent", () => {
  const r = checkShape({ _about: "a note", ...FILE });
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.profile), ["institution", "sections"]);
});

test("text that isn't JSON is said so", () => {
  const r = readResetFile("{ not json");
  assert.ok(!r.ok);
  assert.match(r.error, /isn't valid JSON/);
});

test("JSON that isn't a profile says what a profile looks like", () => {
  for (const doc of [[], "text", 5, null]) assert.match((checkShape(doc) as any).error, /isn't an institution profile/);
  assert.match((checkShape({ sections: {} }) as any).error, /no “institution” part/);
  assert.match((checkShape({ name: "X", institution_type: "bank" }) as any).error, /no “institution” part/);
  assert.match((checkShape({ products: [] }) as any).error, /isn't an institution profile/);
});

test("the institution's required fields are named when missing", () => {
  const { time_zone, base_currency, ...rest } = INST;
  const r = checkShape({ institution: rest, sections: {} });
  assert.ok(!r.ok);
  assert.match(r.error, /a base currency, a time zone/);
  assert.match((checkShape({ institution: { ...INST, name: "  " } }) as any).error, /a name/);
  assert.match((checkShape({ institution: { ...INST, institution_type: "shop" } }) as any).error, /must be bank or insurer/);
});

test("sections must be known and lists of objects", () => {
  assert.match((checkShape({ institution: INST, sections: { spaceships: [] } }) as any).error, /“spaceships” isn't a section/);
  assert.match((checkShape({ institution: INST, sections: { products: {} } }) as any).error, /“products” section should be a list/);
  assert.match((checkShape({ institution: INST, sections: { products: ["x"] } }) as any).error, /each one an object/);
  assert.match((checkShape({ institution: INST, sections: [] }) as any).error, /“sections” should be an object/);
});

test("the summary uses the singular for one", () => {
  const s = summarize({ institution: INST, sections: { rivals: [{ name: "R" }], regulators: [{}, {}] } });
  assert.deepEqual(s.counts.map(c => c.words), ["2 regulators", "1 rival"]);
});

test("a downloaded profile can be read back in", () => {
  const pick = (i: Record<string, any>) => Object.fromEntries(Object.entries(i).filter(([k]) => !["status", "version", "counts"].includes(k)));
  const f = profileFile({ ...INST, institution_id: "x", status: "active", version: 3, counts: {} }, FILE.sections, pick);
  assert.deepEqual(Object.keys(f), ["institution", "sections"]);
  const r = readResetFile(JSON.stringify(f));
  assert.ok(r.ok && r.summary.total === 4);
});

test("a refusal shows the server's sentence and its first problems", () => {
  assert.equal(resetFailure({ problem: { detail: "Reset is switched off on this server (PROTOTYPE_RESET)." } }), "Reset is switched off on this server (PROTOTYPE_RESET).");
  assert.equal(resetFailure({ problem: { detail: "The change breaks the profile's rules.", errors: [{ field: "products.0.segments", message: "no such segment" }, { message: "x" }] } }),
    "The change breaks the profile's rules. products.0.segments: no such segment; x.");
  assert.match(resetFailure(new Error("x")), /Nothing was changed/);
});
