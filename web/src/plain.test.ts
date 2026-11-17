// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { placeName, placeOrder } from "./format.ts";
import { alertOrder, checkMove, dateRange, eventTitle, signalStrength, impactText, listText, productAngle, relDay, sizeTiming, splitCheckText, themeLabel, verdictTone } from "./plain.ts";

test("themes read as short phrases, not machine text", () => {
  assert.equal(themeLabel({ theme: "commodities", direction: "up", item: "oil" }), "Oil prices up");
  assert.equal(themeLabel({ theme: "remittance", direction: "down" }), "Remittances down");
  assert.equal(themeLabel({ theme: "prices", direction: "up", item: "fuel" }), "Fuel prices up");
  assert.equal(themeLabel({ theme: "prices", direction: "up", item: "general" }), "Inflation up");
  assert.equal(themeLabel({ theme: "fx", direction: "weaker", currency: "LKR" }), "Rupee weaker");
  assert.equal(themeLabel({ theme: "disaster", direction: "domestic", item: "flood" }), "Flood at home");
  assert.equal(themeLabel({ theme: "regulation", direction: "import_control_tighter" }), "Import controls tightened");
});

test("place codes become names; seas and straits come first", () => {
  assert.equal(placeName("sea:persian-gulf"), "Persian Gulf");
  assert.equal(placeName("chk:hormuz"), "Strait of Hormuz");
  assert.equal(placeName("AE"), "United Arab Emirates");
  assert.equal(placeName("sea:gulf-of-aden"), "Gulf of Aden");
  assert.equal(placeName("IN-TN"), "Tamil Nadu");
  assert.deepEqual(placeOrder(["AE", "chk:hormuz", "IR", "sea:persian-gulf"]), ["chk:hormuz", "sea:persian-gulf", "AE", "IR"]);
});

test("a possible impact in a few words", () => {
  assert.equal(productAngle("business_loan", "utilization"), "Business loan · more borrowing");
  assert.equal(impactText("Credit-line utilisation", "rise"), "Credit-line utilisation may rise");
  assert.equal(sizeTiming("medium", "weeks"), "Medium · within weeks");
  assert.equal(sizeTiming(null, "months"), "within months");
});

test("a check's sentence splits at the metric name, not at a colon in brackets", () => {
  assert.deepEqual(splitCheckText("Instalment collection rate (vehicle type: three wheeler): the period to watch hasn't started"),
    ["Instalment collection rate (vehicle type: three wheeler)", "the period to watch hasn't started"]);
  assert.deepEqual(checkMove("Letters of credit opened: −25.1% against the same period last year (usual range −6.3% to +5.5%)"),
    { move: "−25.1%", against: "vs the same period last year" });
  assert.equal(checkMove("Credit-line utilisation: the period to watch hasn't started"), null);
});

test("a confirmed impact is red when bad for you, green when good", () => {
  assert.equal(verdictTone("confirms", "adverse", true), "red");
  assert.equal(verdictTone("confirms", "opportunity", false), "green");
  assert.equal(verdictTone("not_yet"), "grey");
  assert.equal(verdictTone("error"), "amber");
});

test("dates read naturally", () => {
  const now = new Date("2026-10-17T06:00:00Z");
  assert.equal(dateRange("2026-10-19", "2026-11-30", now), "19 Oct – 30 Nov");
  assert.equal(dateRange("2026-10-16", "2027-01-16", now), "16 Oct 2026 – 16 Jan 2027");
  assert.equal(relDay("2026-10-18", now), "tomorrow");
  assert.equal(relDay("2026-10-20", now), "in 3 days");
  assert.equal(relDay("2026-10-17", now), "today");
});

test("names in a sentence", () => {
  assert.equal(listText(["A"]), "A");
  assert.equal(listText(["A", "B"]), "A and B");
  assert.equal(listText(["A", "B", "C", "D", "E"]), "A, B and 3 more");
});

test("generic event titles become the theme in words plus the size; real titles stay", () => {
  const oil = [{ theme: "commodities", direction: "up", item: "oil" }];
  assert.equal(eventTitle({ title: "Oil rose", themes: oil, size: { value: 9, unit: "pct" } }), "Oil prices up 9%");
  assert.equal(eventTitle({ title: "Oil rose (9%)", themes: oil, size: { value: 9, unit: "pct" } }), "Oil prices up 9%");
  assert.equal(eventTitle({ title: "remittance (up) (5.6%)", themes: [{ theme: "remittance", direction: "up" }], size: null }), "Remittances up 5.6%");
  assert.equal(eventTitle({ title: "Rates rose (25 bp)", themes: [{ theme: "rates", direction: "up" }] }), "Interest rates up 25 bp");
  assert.equal(eventTitle({ title: "Oil rose", themes: oil, size: null }), "Oil prices up");
  assert.equal(eventTitle({ title: "CBSL holds policy rate", themes: [{ theme: "rates", direction: "steady" }], size: { value: 9, unit: "pct" } }), "CBSL holds policy rate");
  assert.equal(eventTitle({ title: "Oil rose", themes: [] }), "Oil rose");
});

test("an alert queue: open first, then the most serious, then the latest", () => {
  const xs = [
    { id: "w-new", level: "warning", status: "new", at: "2026-11-16T10:00:00Z" },
    { id: "a-old", level: "adverse", status: "new", at: "2026-11-15T10:00:00Z" },
    { id: "d", level: "developing", status: "acknowledged", at: "2026-11-16T09:00:00Z" },
    { id: "a-res", level: "adverse", status: "resolved", at: "2026-11-16T11:00:00Z" },
    { id: "w-later", level: "warning", status: "new", at: "2026-11-16T12:00:00Z" },
  ];
  assert.deepEqual([...xs].sort(alertOrder).map(x => x.id), ["a-old", "d", "w-later", "w-new", "a-res"]);
});

test("a source's score reads as a signal strength in words", () => {
  assert.deepEqual(signalStrength(82), ["Strong signal", "blue"]);
  assert.deepEqual(signalStrength(0.55), ["Moderate signal", "grey"]);
  assert.deepEqual(signalStrength(31), ["Weak signal", "grey"]);
  assert.equal(signalStrength(null), null);
});
