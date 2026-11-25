// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { clockText, moveSize, person, placeName, zx } from "./format.ts";

test("a move vs typical is rounded down, so one under the threshold never reads as it", () => {
  assert.equal(zx(-2.998), "2.9×");
  assert.equal(zx(3), "3.0×");
  assert.equal(zx(8.085), "8.0×");
  assert.equal(zx(null), "—");
});

test("an event's size reads as a number and a unit", () => {
  assert.equal(moveSize({ value: 9, unit: "pct" }), "9%");
  assert.equal(moveSize({ value: 1.094, unit: "%" }), "1.09%");
  assert.equal(moveSize({ value: 25, unit: "bp" }), "25 bp");
  assert.equal(moveSize(null), "");
});

test("the Studio clock keeps its dot between the day and the time", () => {
  assert.equal(clockText("2026-11-17T03:50:00Z", "Asia/Colombo"), "Tue 17 Nov · 09:20");
  assert.equal(clockText("2026-11-16T23:05:00Z", "Asia/Jakarta"), "Tue 17 Nov · 06:05");
  assert.equal(clockText("2026-11-16T00:00:00Z", "UTC"), "Mon 16 Nov · 00:00");  // midnight is 00:00, never "24:00"
});

test("the US pack's places read by name, and the others as before", () => {
  assert.equal(placeName("US-TX"), "Texas");
  assert.equal(placeName("US-AZ"), "Arizona");
  assert.equal(placeName("city:dallas"), "Dallas");
  assert.equal(placeName("city:fort-worth"), "Fort Worth");
  assert.equal(placeName("city:san-antonio"), "San Antonio");
  assert.equal(placeName("city:midland"), "Midland");
  assert.equal(placeName("IN-KL"), "Kerala");
  assert.equal(placeName("chk:hormuz"), "Strait of Hormuz");
  assert.equal(placeName("sea:java-sea"), "Java Sea");
});

test("an actor reads as a name, never an email address", () => {
  assert.equal(person("John"), "John");
  assert.equal(person("dilan@serendib.lk"), "Dilan");
  assert.equal(person("nadeesha.perera@serendib.lk"), "Nadeesha");
  assert.equal(person("assistant for dilan@serendib.lk"), "assistant for Dilan");
  assert.equal(person("Amiri Agent"), "Amiri Agent");
  assert.equal(person(null), "");
  assert.doesNotMatch(person("x.y@bank.example.com and a@b.io"), /@/);
});
