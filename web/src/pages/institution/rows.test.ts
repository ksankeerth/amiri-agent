// Run with `node --test src/pages/institution/rows.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item, SectionName } from "../../api/institutions";
import { columnsOf, gridOf, rowText, withShort } from "./rows.ts";

const item = (o: Record<string, unknown>): Item => ({ id: "x", version: 1, created_at: null, updated_at: null, updated_by: null, ...o });
const names = { US: "United States", "US-TX": "Texas", KW: "Kuwait" };
const SEGS = [item({ id: "s1", label: "Venture-backed startups" }), item({ id: "s2", label: "Tech employees" })];
const ctx = { names, segments: SEGS };
const ALL: SectionName[] = ["footprint", "watch-places", "segments", "products", "flows", "regulators", "rivals", "counterparties", "risk-exposures"];

test("every section's columns: a name column first, the rest hidden on a phone, and a grid with the edit button last", () => {
  for (const s of ALL) {
    const cols = columnsOf(s, []);
    assert.ok(cols.length >= 3, s);
    assert.equal(cols[0].phoneHide, undefined, `${s}: the name shows on a phone`);
    assert.ok(cols.slice(1).every(c => c.phoneHide), `${s}: the details move under the name`);
    assert.ok(gridOf(cols).startsWith(cols[0].width) && gridOf(cols).endsWith(" 32px"), s);
    assert.equal(rowText(s, item({ code: "KW", local: "US", counterpart: "KW", name: "n", label: "n", title: "n", kind: "x", role: "x", type: "x", overlap: "low", importance: "other", area: "x", relation: "x", product_type: "x", months: [], places: [], segments: [], spec_mapping: [], touches: {} }), [], ctx).cells.length, cols.length - 1, s);
  }
});

test("products: the board's row", () => {
  const p = item({ name: "Startup Operating Accounts", product_type: "current_account", owner: "Technology banking", segments: ["s1"], book_size: { amount: 9.2e9, currency: "USD" } });
  const r = rowText("products", p, [p], ctx);
  assert.equal(r.name, "Startup Operating Accounts");
  assert.deepEqual(r.cells, ["Current account", "Technology banking", "Venture-backed startups", "9.2 bn"]);
  assert.equal(r.sub, "Type: Current account · Owner: Technology banking · Customers: Venture-backed startups · Book, USD: 9.2 bn");
  assert.equal(columnsOf("products", [p])[4].label, "Book, USD");
});

test("products: no owner, no group, no book", () => {
  const p = item({ name: "Lines", product_type: "working_capital", owner: null, segments: [], book_size: null });
  const r = rowText("products", p, [p], ctx);
  assert.deepEqual(r.cells, ["Working capital", "—", "—", "—"]);
  assert.equal(r.sub, "Type: Working capital");
});

test("products in two currencies carry the currency in each book", () => {
  const a = item({ name: "A", product_type: "term_loan", segments: [], book_size: { amount: 1e9, currency: "USD" } });
  const b = item({ name: "B", product_type: "term_loan", segments: [], book_size: { amount: 2e9, currency: "LKR" } });
  assert.equal(rowText("products", a, [a, b], ctx).cells[3], "USD 1.0 bn");
  assert.equal(columnsOf("products", [a, b])[4].label, "Book");
});

test("footprint, watch places, segments", () => {
  assert.deepEqual(rowText("footprint", item({ code: "US-TX", role: "home", scope: "part", branch_count: 12 }), [], ctx).cells, ["Home country", "Part of it", "12"]);
  assert.equal(rowText("footprint", item({ code: "US", role: "branches", scope: "all", branch_count: null }), [], ctx).name, "United States");
  assert.deepEqual(rowText("watch-places", item({ name: "Strait of Hormuz", kind: "chokepoint", reason: null }), [], ctx).cells, ["Chokepoint", "—"]);
  const s = rowText("segments", item({ label: "Migrant families", kind: "individual", places: ["KW", "US"], spec_mapping: [{ dimension: "segment", value: "remittance_linked" }] }), [], ctx);
  assert.deepEqual(s.cells, ["Individual", "Kuwait, United States", "customer type “receives remittances”"]);
});

test("flows read as a sentence, with the figure", () => {
  const f = item({ kind: "remittances_in", goods: null, local: "US", counterpart: "KW", value: { amount: 1.2e9, currency: "USD", year: 2024 }, segments: ["s2"] });
  const r = rowText("flows", f, [], ctx);
  assert.equal(r.name, "Remittances in");
  assert.deepEqual(r.cells, ["United States ↔ Kuwait", "USD 1.2bn", "Tech employees"]);
  assert.equal(rowText("flows", item({ kind: "exports", goods: "Garments", local: "US", counterpart: "KW", value: null, segments: [] }), [], ctx).name, "Exports (Garments)");
  assert.equal(rowText("flows", item({ kind: "exports", local: "US", counterpart: "KW", value: null, segments: [] }), [], ctx).cells[1], "No figure");
});

test("regulators, rivals, firms, risks", () => {
  const reg = rowText("regulators", item({ name: "Central Bank of Sri Lanka", short: "CBSL", area: "banking", country: "KW", relation: "home" }), [], ctx);
  assert.equal(reg.name, "Central Bank of Sri Lanka (CBSL)");
  assert.deepEqual(reg.cells, ["Banking", "Kuwait", "Home"]);
  assert.deepEqual(rowText("regulators", item({ name: "FATF", short: "FATF", area: "aml", country: null, relation: "standard" }), [], ctx).cells, ["Anti-money-laundering", "Global", "Global standard"]);
  assert.equal(withShort("US Treasury sanctions (OFAC)", "OFAC"), "US Treasury sanctions (OFAC)");
  assert.deepEqual(rowText("rivals", item({ name: "Coastal", type: "finance_company", places: [], overlap: "high" }), [], ctx).cells, ["Finance company", "—", "High overlap"]);
  assert.equal(rowText("counterparties", item({ name: "Corr Bank", kind: "correspondent_bank", places: ["US"], importance: "critical" }), [], ctx).cells[2], "Critical to you");
  const risk = rowText("risk-exposures", item({ title: "Floods meet branches", kind: "climate", months: [10, 11], touches: { segments: ["s1", "s2"], products: [], flows: ["f"], routes: [] } }), [], ctx);
  assert.deepEqual(risk.cells, ["Climate", "Oct, Nov", "2 customer groups, 1 flow"]);
  assert.equal(rowText("risk-exposures", item({ title: "T", kind: "climate", months: [], touches: { segments: [], products: [], flows: [], routes: [] } }), [], ctx).cells[1], "any time");
});
