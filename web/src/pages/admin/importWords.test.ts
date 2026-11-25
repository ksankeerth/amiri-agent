// Run with `node --test src/pages/admin/importWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { bulkWords, coverWords, dateWords, fileProblem, jsonErrorAt, jsonWhere, peekImport, rangeWords, sizeWords, uploadWords } from "./importWords.ts";

const S = { products: 10, metrics: 53, series: 376, rows: 132769, from: "2023-07-01", until: "2026-10-06", as_of: "2026-10-05" };

test("says what a file covers", () => {
  assert.equal(coverWords(S), "10 products · 53 metrics");
  assert.equal(coverWords({ ...S, products: 1, metrics: 1 }), "1 product · 1 metric");
  assert.equal(rangeWords(S), "1 Jul 2023 to 5 Oct 2026");  // until is exclusive
  assert.equal(rangeWords({ ...S, from: null }), null);
  assert.equal(dateWords("2026-03-01"), "1 Mar 2026");
});

test("sizes and the check before sending", () => {
  assert.equal(sizeWords(14750110), "14.1 MB");
  assert.equal(sizeWords(900), "1 KB");
  assert.equal(fileProblem({ name: "data.json", size: 2000 }, 25), null);
  assert.equal(fileProblem({ name: "data.csv", size: 2000 }, 25), "data.csv isn't a JSON file.");
  assert.equal(fileProblem({ name: "big.json", size: 30 * 1024 * 1024 }, 25), "big.json is 30.0 MB; the most this server takes is 25 MB.");
  assert.equal(fileProblem({ name: "x.json", size: 0 }, 25), "x.json is empty.");
});

test("an upload's errors in words: the first few, and how many more", () => {
  const errors = [1, 2, 3, 4, 5, 6].map(i => ({ field: `series[${i}].rows[0].value`, message: "must be a number or null" }));
  const w = uploadWords({ code: "invalid_import", detail: "…", errors: [...errors, { field: "…", message: "and 3 more" }] });
  assert.equal(w.headline, "The file has 9 problems, so nothing was imported.");
  assert.deepEqual(w.items.slice(0, 2), ["series[1].rows[0].value: must be a number or null", "series[2].rows[0].value: must be a number or null"]);
  assert.equal(w.items.length, 4);
  assert.equal(w.more, 5);
  const one = uploadWords({ code: "invalid_import", errors: [{ field: "as_of", message: "is missing" }] });
  assert.equal(one.headline, "The file has a problem, so nothing was imported.");
  assert.deepEqual(one.items, ["as_of: is missing"]);
  const big = uploadWords({ code: "too_large", detail: "The file is 30.0 MB; the most this server takes is 25 MB (DATA_IMPORT_MAX_MB)." });
  assert.equal(big.headline, "The file is too large, so nothing was imported.");
  assert.equal(big.items.length, 1);
  assert.equal(uploadWords({ code: "network", detail: "Amiri Agent didn't answer." }).headline, "Amiri Agent didn't answer.");
});

test("finds the first JSON syntax error without leaning on the engine's wording", () => {
  assert.equal(jsonErrorAt('{"a": [1, 2, {"b": null}], "c": "x\\u00e9\\n"}'), null);
  assert.equal(jsonErrorAt("-1.5e+3"), null);
  const bad = '{\n "a": 1,\n "b": }';
  assert.equal(jsonErrorAt(bad), bad.indexOf("}", 10));
  assert.equal(jsonWhere(bad), "line 3, column 7");
  assert.equal(jsonWhere('{"a": 1,}'), "line 1, column 9");
  assert.equal(jsonWhere('{"a": 01}'), "line 1, column 8");
  assert.equal(jsonWhere('{"a": "x'), "line 1, column 9");
  assert.equal(jsonWhere('[1, 2] 3'), "line 1, column 8");
  assert.equal(jsonWhere("{}"), null);
});

test("a first look at a file: what it brings, or what is wrong, before anything is sent", () => {
  const doc = { format: "amiri-institution-data/1", as_of: "2026-11-23", about: "From the core system.",
    catalog: { profile: { name: "Austin Tech Bank" }, products: [{ metrics: [{}, {}] }, { metrics: [{}] }] },
    series: [{ rows: [{ from: "2026-11-01", until: "2026-11-02" }, { from: "2026-10-30", until: "2026-10-31" }] }, { rows: [{ from: "2026-11-02", until: "2026-11-23" }] }] };
  const ok = peekImport(JSON.stringify(doc));
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.deepEqual(ok.peek, { products: 2, metrics: 3, series: 2, rows: 3, from: "2026-10-30", until: "2026-11-23", as_of: "2026-11-23", about: "From the core system.", institution: "Austin Tech Bank" });
    assert.equal(bulkWords(ok.peek), "2 series · 3 rows");
    assert.equal(rangeWords({ ...ok.peek, institution: null } as never), "30 Oct 2026 to 22 Nov 2026");
  }
  const syntax = peekImport('{\n "format": }');
  assert.ok(!syntax.ok);
  if (!syntax.ok) { assert.equal(syntax.problem.headline, "The file isn't valid JSON, so nothing was imported."); assert.equal(syntax.problem.items[0], "line 2, column 12: this isn't valid JSON here"); }
  const why = (x: unknown) => { const r = peekImport(JSON.stringify(x)); return r.ok ? null : r.problem.items[0]; };
  assert.equal(why([1]), "(the file): must be one JSON object");
  assert.equal(why({ ...doc, format: "x" }), 'format: must be "amiri-institution-data/1"');
  assert.equal(why({ ...doc, as_of: "yesterday" }), "as_of: must be a date, like 2026-11-23");
  assert.equal(why({ ...doc, catalog: {} }), "catalog.products: is missing");
  assert.equal(why({ ...doc, series: null }), "series: is missing");
});
