// Run with `npm test` (Node runs the TypeScript directly). What a file may hold, and what comes out of it.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanInstitution, cleanMonitorSpec, draftFrom, institutionsOf, itemsOf, labelOf, monitorsOf, parseJson, scenariosOf, seriesOf } from "./fillJson.ts";

const demo = {
  institution: { institution_id: "serendib-bank", name: "Serendib Commercial Bank", institution_type: "bank", subtype: "commercial",
    home_country: "LK", base_currency: "LKR", time_zone: "Asia/Colombo", clearing_currencies: ["USD", "EUR"], summary: "Mid-size bank" },
  sections: {
    products: [{ id: "migrant-savings", name: "Migrant Family Savings", category: "savings", product_type: "savings_account", segments: ["migrant-families"],
      book_size: { amount: 64000000000, currency: "LKR" } }, { id: "pawning", name: "Pawning", category: "gold_loan", product_type: "gold_loan" }],
    flows: [{ kind: "remittances_in", local: "LK", counterpart: "SA", figure_id: "remittances-in-lk-sa-2024", value: { amount: 1200000000, currency: "USD", year: 2024 } }],
    regulators: [{ regulator_id: "lk-cbsl", relation: "home" }],
    "risk-exposures": [{ id: "gulf", title: "Gulf tension", hazard_id: "gulf-security", touches: { segments: ["migrant-families"] } }],
  },
};

test("a list, {items}, a whole profile and one item all give the section's items", () => {
  assert.equal(itemsOf(demo, "products").length, 2);
  assert.equal(itemsOf(demo.sections.products, "products").length, 2);
  assert.equal(itemsOf({ items: demo.sections.products }, "products").length, 2);
  assert.equal(itemsOf(demo.sections.products[0], "products").length, 1);  // one item on its own
  assert.equal(itemsOf({ products: demo.sections.products }, "products").length, 2);
  assert.equal(itemsOf(demo, "rivals").length, 0);  // the profile has none of that section
  assert.equal(itemsOf({ institution: demo.institution }, "products").length, 0);  // an institution is not an item
  assert.equal(itemsOf([1, "x", null, { name: "A" }], "rivals").length, 1);  // only objects count
  assert.equal(itemsOf(null, "products").length, 0);
  assert.equal(itemsOf("text", "products").length, 0);
});

test("a pick list names each item by its own words", () => {
  assert.deepEqual(itemsOf(demo, "products").map(c => c.label), ["Migrant Family Savings", "Pawning"]);
  assert.equal(itemsOf(demo, "flows")[0].label, "remittances in LK ↔ SA");
  assert.equal(itemsOf(demo, "regulators")[0].label, "lk-cbsl");
  assert.equal(itemsOf(demo, "risk-exposures")[0].label, "Gulf tension");
  assert.equal(labelOf({}, "Item 3"), "Item 3");
  assert.equal(labelOf({ name: "  " }, "Item 1"), "Item 1");
});

test("the institution comes from {institution}, the fields alone, or a list; only its own fields", () => {
  const a = institutionsOf(demo);
  assert.equal(a.length, 1);
  assert.equal(a[0].data.name, "Serendib Commercial Bank");
  assert.equal("institution_id" in a[0].data, false);  // not a form field
  assert.deepEqual(a[0].data.clearing_currencies, ["USD", "EUR"]);
  assert.equal(institutionsOf(demo.institution).length, 1);
  assert.equal(institutionsOf([demo, demo.institution]).length, 2);
  assert.equal(institutionsOf({ sections: demo.sections }).length, 0);
  assert.equal(institutionsOf({ foo: 1 }).length, 0);
  assert.equal(institutionsOf(42).length, 0);
});

test("a monitor's spec is found inside {spec}, {monitor: {spec}}, or on its own", () => {
  const spec = { about: { name: "Gulf watch" }, public: { tell_me_if: ["x"] }, private: { serious: [] } };
  assert.equal(monitorsOf(spec)[0].label, "Gulf watch");
  assert.deepEqual((monitorsOf({ spec })[0].data as any).public.tell_me_if, ["x"]);
  assert.deepEqual((monitorsOf({ monitor: { spec } })[0].data as any).about.name, "Gulf watch");
  assert.equal(monitorsOf([{ spec }, { spec }]).length, 2);
  assert.equal(monitorsOf({ name: "not a spec" }).length, 0);
});

test("series need a symbol", () => {
  assert.equal(seriesOf({ symbol: "USD/LKR", name: "Dollar" })[0].label, "USD/LKR · Dollar");
  assert.equal(seriesOf({ series: [{ symbol: "XAU/USD" }, { name: "no symbol" }, { symbol: " " }] }).length, 1);
  assert.equal(seriesOf([]).length, 0);
});

test("a scenario is a title, headlines or a custom block", () => {
  assert.equal(scenariosOf({ title: "Gulf visa freeze", headlines: [] })[0].label, "Gulf visa freeze");
  assert.equal(scenariosOf({ custom: { headlines: [] } }).length, 1);
  assert.equal(scenariosOf({ scenarios: [{ title: "A" }, { title: "B" }, { x: 1 }] }).length, 2);
  assert.equal(scenariosOf({ unrelated: true }).length, 0);
});

test("a dialog's draft: the file's fields over the defaults, nested defaults kept, no server bookkeeping", () => {
  const defaults = { name: "", status: "active", segments: [], touches: { segments: [], products: [], flows: [], routes: [] } };
  const d = draftFrom(defaults, { id: "x", name: "N", version: 3, created_at: "now", used_by: [], touches: { segments: ["a"] }, extra: 1 }, { keepId: true });
  assert.equal(d.id, "x");
  assert.equal(d.name, "N");
  assert.equal(d.status, "active");  // a default the file leaves out
  assert.deepEqual(d.touches, { segments: ["a"], products: [], flows: [], routes: [] });  // the nested keys it leaves out stay
  assert.equal("version" in d || "created_at" in d || "used_by" in d, false);
  assert.equal(d.extra, "1");  // fields the form doesn't show are carried to the server (as text, the kind every form value is)
  assert.equal("id" in draftFrom(defaults, { id: "x", name: "N" }, { keepId: false }), false);  // editing keeps the item's own id
  assert.equal(draftFrom(defaults, { name: undefined }, { keepId: true }).name, "");  // undefined is not a value
});

test("text that isn't JSON says so in a sentence", () => {
  assert.equal(parseJson('{"a": 1}').ok, true);
  const bad = parseJson("{nope");
  assert.equal(bad.ok, false);
  assert.match(bad.ok ? "" : bad.error, /isn't valid JSON/);
  assert.equal(parseJson("").ok, false);
});

// ---------------------------------------------------------------- a file can say anything: nothing may throw, nothing may be the wrong kind
const DEFAULTS = {  // what the forms start from (pages/institution/forms.tsx), all sections together
  name: "", label: "", title: "", code: null, kind: "x", role: "branches", scope: "all", reason: null, note: null, places: [], segments: [], categories: [],
  controls: [], aliases: [], currencies: [], income_sources: [], months: [], spec_mapping: [], attributes: {}, source: { kind: "user" }, status: "active",
  touches: { segments: [], products: [], flows: [], routes: [], watch_places: [] }, value: null, islamic: false, overlap: "medium" };
const KEYS = [...Object.keys(DEFAULTS), "book_size", "owner", "data", "branch_count", "share_of_customers_pct", "launched_on", "counterpart", "local", "goods",
  "category", "product_type", "type", "area", "relation", "importance", "website", "id", "regulator_id", "extra", "__proto__", "constructor"];
const WRONG: unknown[] = [null, undefined, 0, -1, 3.5, NaN, Infinity, "", " ", "x", "LK", "5", true, false, [], [[]], [null], [1, "a", null, {}], {}, { a: 1 },
  { a: { b: [] } }, { amount: "big", currency: 5 }, { amount: "64", currency: "LKR" }, "x".repeat(100000), [{}], [[], {}]];
const isStrList = (x: unknown) => Array.isArray(x) && x.every(e => typeof e === "string");

test("whatever the file holds, a draft never throws and keeps the form's kinds", () => {
  let n = 0;
  for (const k of KEYS) for (const v of WRONG) {
    const raw = JSON.parse(JSON.stringify({ [k]: v === undefined ? null : v }, (_, x) => (typeof x === "number" && !Number.isFinite(x) ? null : x)));
    const d = draftFrom(DEFAULTS, raw, { keepId: true });
    n++;
    for (const [dk, dv] of Object.entries(DEFAULTS)) {  // the kinds the forms rely on
      if (Array.isArray(dv)) assert.ok(Array.isArray(d[dk]), `${dk} must stay a list (from ${JSON.stringify(v)?.slice(0, 40)})`);
      if (["places", "segments", "categories", "controls", "aliases", "currencies", "income_sources"].includes(dk)) assert.ok(isStrList(d[dk]), `${dk}: strings only`);
      if (dk === "months") assert.ok(d.months.every((m: unknown) => typeof m === "number"), "months: numbers only");
      if (dk === "touches") for (const t of ["segments", "products", "flows", "routes", "watch_places"]) assert.ok(isStrList(d.touches?.[t]), `touches.${t}: strings only`);
      if (["name", "label", "title", "role", "scope", "status", "overlap", "kind"].includes(dk)) assert.equal(typeof d[dk], "string", `${dk} is text`);
      if (dk === "islamic") assert.equal(typeof d.islamic, "boolean");
    }
    if (d.book_size !== undefined) assert.ok(typeof d.book_size.amount === "number" && typeof d.book_size.currency === "string");
    if (d.value) assert.ok(typeof d.value.amount === "number" && typeof d.value.currency === "string");
    if (d.code != null) assert.equal(typeof d.code, "string");  // the forms call .includes on it
    assert.equal(Object.getPrototypeOf(d), Object.prototype);  // a "__proto__" key changes nothing
  }
  assert.ok(n > 600);
});

test("details keep their kind: a number stays a number, a flag stays a flag", () => {
  const D = (item: object) => draftFrom({ ...DEFAULTS, attributes: {} }, item, { keepId: true });
  assert.deepEqual(D({ attributes: { tenor_months: 12, secured: true, tier: "gold", bad: { x: 1 }, worse: [1], none: null } }).attributes, { tenor_months: 12, secured: true, tier: "gold" });
  assert.deepEqual(D({ source: { kind: "dataset", dataset: "CBSL", dataset_year: 2024, sample: true } }).source, { kind: "dataset", dataset: "CBSL", dataset_year: 2024, sample: true });
  assert.equal(D({ name: null }).name, "");  // a null where a text belongs leaves the default
});

test("what fits is kept, converted where that's obvious", () => {
  const D = (item: object) => draftFrom(DEFAULTS, item, { keepId: true });
  assert.deepEqual(D({ places: "LK" }).places, ["LK"]);
  assert.deepEqual(D({ places: ["LK", 5, null, "", {}] }).places, ["LK", "5"]);
  assert.deepEqual(D({ months: ["5", "x", 7, null] }).months, [5, 7]);
  assert.deepEqual(D({ touches: { segments: "a", products: ["p", 3] } }).touches, { segments: ["a"], products: ["p", "3"], flows: [], routes: [], watch_places: [] });
  assert.deepEqual(D({ touches: "x" }).touches, DEFAULTS.touches);  // a text where an object belongs: the default stays
  assert.deepEqual(D({ book_size: { amount: "64", currency: "LKR" } }).book_size, { amount: 64, currency: "LKR" });
  assert.equal(D({ book_size: { amount: "big", currency: "LKR" } }).book_size, undefined);
  assert.equal(D({ islamic: "yes" }).islamic, false);
  assert.equal(D({ islamic: true }).islamic, true);
  assert.equal(D({ name: 123 }).name, "123");
  assert.equal(D({ name: ["x"] }).name, "");
  assert.equal(D({ branch_count: "12" }).branch_count, 12);
  assert.equal(D({ branch_count: "many" }).branch_count, undefined);
  assert.deepEqual(D({ source: "finder" }).source, { kind: "user" });  // flows' source is an object
  assert.deepEqual(draftFrom({ source: "user" }, { source: "finder" }, { keepId: true }).source, "finder");  // a risk's source is a word
  assert.deepEqual(D({ spec_mapping: [{ dimension: "segment", value: "salaried" }, 5, null] }).spec_mapping, [{ dimension: "segment", value: "salaried" }]);
  assert.equal(D({ id: 5 }).id, "5");
  assert.equal("id" in draftFrom(DEFAULTS, { id: "x" }, { keepId: false }), false);
});

test("the institution: only fields it has, of the right kinds", () => {
  assert.deepEqual(cleanInstitution({ name: 5, institution_type: [], home_country: {}, clearing_currencies: "USD", islamic: "x", fiscal_year_start_month: "April" }),
    { name: "5", clearing_currencies: ["USD"] });
  assert.equal(cleanInstitution({ institution_type: "insurer" }).institution_type, "insurer");
  assert.equal(cleanInstitution({ institution_type: "bank holding" }).institution_type, undefined);
  assert.equal(cleanInstitution({ fiscal_year_start_month: 13 }).fiscal_year_start_month, undefined);
  assert.equal(cleanInstitution({ fiscal_year_start_month: "4" }).fiscal_year_start_month, 4);
  assert.deepEqual(cleanInstitution({ foo: 1 }), {});
});

test("a monitor: lists are lists, objects are objects, and a missing part stays out", () => {
  const c = cleanMonitorSpec({ about: { name: 1, key_dates: "x", also_notify: 5 }, public: { watch: "a", tell_me_if: "x", places: "LK", sources: 3, example_headlines: [] },
    private: { exposure: "x", serious: 4 } }) as any;
  assert.equal(c.about.name, "1");
  assert.equal(c.about.key_dates, undefined);
  assert.deepEqual(c.about.also_notify, ["5"]);
  assert.equal(c.public.watch, undefined);
  assert.deepEqual(c.public.tell_me_if, ["x"]);
  assert.deepEqual(c.public.places, ["LK"]);
  assert.equal(c.private.exposure, undefined);
  assert.deepEqual(c.private.serious, ["4"]);
  const ok = cleanMonitorSpec({ about: { name: "N", check_frequency: 60 }, private: { exposure: [{ id: "gulf", how_it_reaches_us: "x" }, 5, null] } }) as any;
  assert.deepEqual(ok.private.exposure, [{ id: "gulf", how_it_reaches_us: "x" }]);
  assert.equal(ok.about.check_frequency, 60);
  assert.doesNotThrow(() => cleanMonitorSpec({}));
});

test("an edit keeps the item's other values: only what the file gives is replaced", () => {
  const defaults = { name: "", category: "", attributes: {}, segments: [] };
  const current = { id: "pm", name: "Private motor", category: "motor", attributes: { retention_pct: 10 }, segments: ["a"] };
  const d = draftFrom(defaults, { attributes: { retention_pct: 15 } }, { keepId: false, base: current });
  assert.equal(d.name, "Private motor");
  assert.deepEqual(d.segments, ["a"]);
  assert.deepEqual(d.attributes, { retention_pct: 15 });
  assert.equal(draftFrom(defaults, { name: "X" }, { keepId: true }).category, "");   // an add still starts from the defaults
});
