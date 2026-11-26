import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptList, fileProblem, firstFile, matchesAccept, sizeWords } from "./dropRules.ts";

const JSON_ONLY = "application/json,.json";

test("accept is read as a list of extensions, types and families", () => {
  assert.deepEqual(acceptList(" application/json, .JSON ,"), ["application/json", ".json"]);
  assert.deepEqual(acceptList(undefined), []);
});

test("a file matches by extension or by type, case aside", () => {
  assert.equal(matchesAccept({ name: "Profile.JSON", size: 5 }, JSON_ONLY), true);
  assert.equal(matchesAccept({ name: "data", size: 5, type: "application/json" }, JSON_ONLY), true);
  assert.equal(matchesAccept({ name: "notes.txt", size: 5, type: "text/plain" }, JSON_ONLY), false);
  assert.equal(matchesAccept({ name: "a.png", size: 5, type: "image/png" }, "image/*"), true);
  assert.equal(matchesAccept({ name: "a.png", size: 5 }, undefined), true);
});

test("a wrong kind, an empty file and a big file each say why", () => {
  assert.match(fileProblem({ name: "notes.txt", size: 5 }, { accept: JSON_ONLY, noun: "a JSON file" })!, /notes\.txt isn't a JSON file\. Choose a file ending \.json/);
  assert.equal(fileProblem({ name: "a.json", size: 0 }, { accept: JSON_ONLY }), "a.json is empty.");
  assert.match(fileProblem({ name: "a.json", size: 3 * 1024 * 1024 }, { accept: JSON_ONLY, maxBytes: 2 * 1024 * 1024 })!, /3 MB; the most this takes is 2 MB/);
  assert.equal(fileProblem({ name: "a.json", size: 100 }, { accept: JSON_ONLY, maxBytes: 1024 }), null);
});

test("sizes read in plain units", () => {
  assert.equal(sizeWords(10), "10 bytes");
  assert.equal(sizeWords(2048), "2 KB");
  assert.equal(sizeWords(1572864), "1.5 MB");
});

test("only the first of several files is used", () => {
  assert.deepEqual(firstFile(["a", "b", "c"]), { file: "a", extra: 2 });
  assert.deepEqual(firstFile([]), { file: null, extra: 0 });
  assert.deepEqual(firstFile(null), { file: null, extra: 0 });
});
