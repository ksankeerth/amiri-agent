// Run with `node --test src/pages/admin/importWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { coverWords, dateWords, fileProblem, rangeWords, sizeWords, uploadWords } from "./importWords.ts";

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
