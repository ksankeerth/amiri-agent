// Run with `node --test src/pages/admin/dataWords.test.ts` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  approveWhy, checkPill, conditionsFor, conformanceLine, coverageCounts, coverageHeadline, defaultOn, metricLabel, moreConditions, moreLine,
  plantedIds, productDetail, sampleOff, scenarioParam, SOURCES, sourceOf, stepStrip, validationWhy,
} from "./dataWords.ts";

const prod = (status: "full" | "partial" | "none", over = {}) => ({ profile_product_id: "p", name: "P", category: "c", catalog_product_id: status === "none" ? null : "cp",
  required: ["a", "b", "c", "d", "e", "f"], served: [], missing: [], reduced: [], extra: [], status, ...over });

test("the sources are the two samples and a file, and nothing about an API address", () => {
  assert.deepEqual(SOURCES.map(s => s.title), ["The sample bank", "The sample insurer", "Import a JSON file"]);
  assert.ok(!SOURCES.some(s => /\b(api|url|rest)\b|open-?api/i.test(s.title + s.line)));
  assert.equal(sampleOff("bank", "bank"), null);
  assert.equal(sampleOff("file", "bank"), null);
  assert.equal(sampleOff("insurer", "bank"), "Only for an insurer: this institution is a bank.");
  assert.equal(sampleOff("bank", "insurer"), "Only for a bank: this institution is an insurer.");
});

test("the sample's conditions: what a kind has, what is on, and the scenario sent", () => {
  assert.equal(conditionsFor("bank").length, 7);
  assert.deepEqual(conditionsFor("insurer").map(c => c.id), ["floods", "late_revision", "few_customers", "reporting_lag"]);
  assert.deepEqual(defaultOn("bank"), ["remittances_fall"]);
  assert.deepEqual(defaultOn("insurer"), ["floods"]);
  assert.equal(scenarioParam("bank", ["floods", "remittances_fall"]), "remittances_fall,floods");  // in the sample's order
  assert.equal(scenarioParam("bank", []), "none");
  assert.equal(scenarioParam("insurer", ["remittances_fall"]), "none");  // not an insurer's condition
  const m = moreConditions("bank", ["remittances_fall", "late_revision"]);
  assert.deepEqual(m, { count: 5, on: 1 });
  assert.equal(moreLine(m), "5 more conditions, 1 on");
  assert.equal(moreLine({ count: 4, on: 0 }), "4 more conditions, off");
});

test("where the data came from", () => {
  assert.equal(sourceOf(null), null);
  assert.equal(sourceOf({ about: "Synthetic data from AMIRI Agent's sample bank, shaped by Austin Tech Bank (your profile). Planted: x." }), "bank");
  assert.equal(sourceOf({ about: "Synthetic data from AMIRI Agent's sample insurer, shaped by X." }), "insurer");
  assert.equal(sourceOf({ about: "From our core system" }), "file");
  assert.equal(sourceOf({ about: null }), "file");
});

const facts = { source: "bank" as const, fileName: "x.json", conditionsOn: 2, configured: true, check: { status: "ready_with_gaps" as const, current: true },
  approved: { by: "Dilan", when: "10:55" }, validationOn: true, validationAllowed: true };

test("the five steps: what is done, which is the current one", () => {
  const all = stepStrip(facts);
  assert.deepEqual(all.map(s => s.note), ["Sample bank", "2 on", "Ready, with gaps", "Approved by Dilan, 10:55", "Checks on"]);
  assert.deepEqual(all.map(s => s.done), [true, true, true, true, true]);
  assert.deepEqual(all.map(s => s.current), [false, false, false, false, true]);  // all done: the last
  const none = stepStrip({ ...facts, source: null, configured: false, check: null, approved: null, validationOn: false, conditionsOn: null });
  assert.deepEqual(none.map(s => s.note), ["Not chosen yet", "Optional", "Not yet", "Not approved", "Checks off until approved"]);
  assert.equal(none.findIndex(s => s.current), 0);
  const imported = stepStrip({ ...facts, check: null, approved: null, validationOn: false });
  assert.equal(imported.findIndex(s => s.current), 2);
  assert.equal(imported[2].note, "Not checked yet");
  const file = stepStrip({ ...facts, source: "file", conditionsOn: null });
  assert.equal(file[0].note, "x.json");
  assert.equal(file[1].note, "Not used for a file");
  const old = stepStrip({ ...facts, check: { status: "ready" as const, current: false }, approved: null, validationOn: false });
  assert.equal(old[2].note, "Out of date");
  assert.equal(old[2].done, false);
  const notReady = stepStrip({ ...facts, check: { status: "not_ready" as const, current: true }, approved: null, validationOn: false });
  assert.equal(notReady[3].note, "Can't be approved yet");
  assert.equal(stepStrip({ ...facts, validationOn: false })[4].note, "Checks off");
});

test("the check in a person's words", () => {
  const ps = [prod("full"), prod("full"), prod("partial"), prod("none")];
  assert.deepEqual(coverageCounts(ps), { full: 2, partial: 1, none: 1 });
  assert.equal(coverageHeadline(ps), "3 of 4 products can be checked, 1 of them in part");
  assert.equal(coverageHeadline([prod("full")]), "1 of 1 product can be checked");
  assert.equal(coverageHeadline([prod("none")]), "None of the products can be checked yet");
  const names = new Map([["late_30_plus", "Late 30+ days"], ["prepay", "Prepayments"]]);
  assert.equal(productDetail(prod("full")), "6 of 6");
  assert.equal(productDetail(prod("partial", { missing: ["late_30_plus"] }), names), "5 of 6 · missing “Late 30+ days”");
  assert.equal(productDetail(prod("partial", { reduced: [{ key: "prepay", grain_spec: "daily", grain_served: "weekly", off: [] }] }), names), "6 of 6 · Prepayments weekly, not daily");
  assert.equal(productDetail(prod("none")), "No catalog product matches");
  assert.equal(metricLabel("late_30_plus"), "Late 30 plus");
  assert.equal(metricLabel("late_30_plus", names), "Late 30+ days");
  assert.deepEqual(checkPill("pass", "ready"), { tone: "good", label: "Pass" });
  assert.deepEqual(checkPill("fail", "ready_with_gaps"), { tone: "unusual", label: "Gap" });
  assert.deepEqual(checkPill("fail", "not_ready"), { tone: "bad", label: "Fail" });
  assert.deepEqual(checkPill("not_applicable", "ready"), { tone: "neutral", label: "N/A" });
  const cs = [{ status: "pass" as const }, { status: "pass" as const }, { status: "fail" as const }, { status: "not_applicable" as const }];
  assert.equal(conformanceLine(cs, "ready_with_gaps"), "Conformance · 2 pass, 1 gap");
  assert.equal(conformanceLine(cs, "not_ready"), "Conformance · 2 pass, 1 failed");
  assert.equal(conformanceLine([{ status: "pass" as const }], "ready"), "Conformance · 1 pass");
});

test("why Approve and the checks switch can't be used yet", () => {
  assert.equal(approveWhy({ check: null, approved: false }), "Check the data first.");
  assert.equal(approveWhy({ check: { status: "ready", current: false }, approved: false }), "The data changed after the last check: check it again.");
  assert.match(approveWhy({ check: { status: "not_ready", current: true }, approved: false })!, /can't be approved/);
  assert.equal(approveWhy({ check: { status: "ready_with_gaps", current: true }, approved: false }), null);
  assert.equal(approveWhy({ check: { status: "ready", current: true }, approved: true }), "Already approved.");
  assert.equal(validationWhy({ validation_allowed: true, approved: true }), null);
  assert.equal(validationWhy({ validation_allowed: true, approved: false }), "Approve a ready connection first.");
  assert.equal(validationWhy({ validation_allowed: false, approved: true }), "Switched off on this server.");
});

test("the conditions a sample was made with, read from its about line", () => {
  const about = "Synthetic data from AMIRI Agent's sample bank, shaped by Austin Tech Bank (your profile). Planted: Remittances fall (from 2026-11-04, 6); A late revision (from 2026-11-15, 0.6).";
  assert.deepEqual(plantedIds(about, "bank"), ["remittances_fall", "late_revision"]);
  assert.deepEqual(plantedIds("Synthetic data from AMIRI Agent's sample insurer, shaped by X (the bundled demo profile). Nothing planted.", "insurer"), []);
  assert.deepEqual(plantedIds("Synthetic data from AMIRI Agent's sample insurer, shaped by X. Planted: Remittances fall (from 2026-11-04, 6).", "insurer"), []);  // not an insurer's
  assert.equal(plantedIds("From our core system", "bank"), null);
  assert.equal(plantedIds(null, "bank"), null);
});
