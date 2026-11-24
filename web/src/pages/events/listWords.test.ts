// Run with `node --test src/pages/events/listWords.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventDetail, EventRow } from "../../api/investigation";
import { alertsByEvent, alertsText, confirmedCount, effectsFigure, lastNews, ledeText, page, productNames, productsText, sortEvents, tabRows, runKind, runWords } from "./listWords.ts";

const ev = (id: string, tone: EventRow["tone"], more: Partial<EventRow> = {}): EventRow => ({
  event_id: id, run_id: "r", world: "live", title: id, themes: [], country: "", country_code: null, anchor: "2026-11-20T00:00:00Z", places: [], regions: [],
  finding_ids: [], status: "open", open_until: "", closed_at: null, hypotheses: 1, tasks: 0, developments: 0, size: null, tone, ...more });
const detail = (more: Record<string, unknown>) => ({ hypotheses: [], tasks: [], findings: [], developments: [], ...more }) as unknown as EventDetail;

test("most serious first: bad, mixed, good, neutral; then more effects; then newest", () => {
  const rows = [ev("n", "neutral"), ev("g", "good"), ev("b1", "bad", { hypotheses: 1 }), ev("b5", "bad", { hypotheses: 5 }), ev("m", "mixed")];
  assert.deepEqual(sortEvents(rows, "serious").map(e => e.event_id), ["b5", "b1", "m", "g", "n"]);
  assert.deepEqual(sortEvents(rows, "impacts").map(e => e.event_id)[0], "b5");
  const dated = [ev("old", "bad", { anchor: "2026-11-01T00:00:00Z" }), ev("new", "good", { anchor: "2026-11-22T00:00:00Z" })];
  assert.deepEqual(sortEvents(dated, "newest").map(e => e.event_id), ["new", "old"]);
});

test("a tab lists its own status; simulated events only when asked", () => {
  const rows = [ev("a", "bad"), ev("b", "bad", { status: "closed" }), ev("c", "bad", { world: "sandbox" }), ev("d", "good", { world: "studio", status: "closed" })];
  assert.deepEqual(tabRows(rows, "open", false).map(e => e.event_id), ["a"]);
  assert.deepEqual(tabRows(rows, "closed", false).map(e => e.event_id), ["b"]);
  assert.deepEqual(tabRows(rows, "all", false).map(e => e.event_id), ["a", "b"]);
  assert.deepEqual(tabRows(rows, "all", true).map(e => e.event_id), ["a", "b", "c", "d"]);
});

test("show more: the first page and how many are left", () => {
  const xs = Array.from({ length: 60 }, (_, i) => i);
  assert.deepEqual([page(xs, 25).shown.length, page(xs, 25).left], [25, 35]);
  assert.deepEqual([page(xs, 75).shown.length, page(xs, 75).left], [60, 0]);
});

test("products: the first two, then how many more", () => {
  assert.equal(productsText(["Energy Loans"]), "Energy Loans");
  assert.equal(productsText(["A", "B"]), "A · B");
  assert.equal(productsText(["A", "B", "C", "D", "E"]), "A · B +3");
});

test("an event's products are its effects' products, once each", () => {
  assert.equal(productNames(undefined), null);
  const d = detail({ hypotheses: [
    { product_id: "p1", product_name: "Energy Loans", product_type: "term_loan" },
    { product_id: "p1", product_name: "Energy Loans", product_type: "term_loan" },
    { product_id: "p2", product_type: "working_capital" }] });
  assert.deepEqual(productNames(d), ["Energy Loans", "Working capital"]);
  assert.deepEqual(productNames(detail({})), []);
});

test("last news is the newest finding or the latest one that joined", () => {
  assert.equal(lastNews(undefined), null);
  assert.equal(lastNews(detail({})), null);
  const d = detail({ findings: [{ created_at: "2026-11-20T10:00:00Z" }, { created_at: "2026-11-21T10:00:00Z" }], developments: [{ joined_at: "2026-11-22T09:00:00Z" }] });
  assert.equal(lastNews(d), "2026-11-22T09:00:00Z");
});

test("the effects and alerts columns", () => {
  assert.deepEqual(effectsFigure(5), [5, "effects"]);
  assert.deepEqual(effectsFigure(1), [1, "effect"]);
  assert.equal(effectsFigure(0), null);
  assert.equal(alertsText(0), null);
  assert.equal(alertsText(1), "1 alert");
  assert.equal(alertsText(2), "2 alerts");
  assert.deepEqual([...alertsByEvent([{ event_id: "a" }, { event_id: "b" }, { event_id: "a" }])], [["a", 2], ["b", 1]]);
});

test("the line under the heading, as the board words it", () => {
  const open = [{ tone: "bad", hypotheses: 5 }, { tone: "bad", hypotheses: 4 }, { tone: "mixed", hypotheses: 3 }, { tone: "good", hypotheses: 2 }];
  assert.deepEqual(ledeText({ open, products: 9, confirmed: 1, validation: true }),
    { hot: "2 bad for you", rest: ["14 possible effects on 9 products", "checks against your data on: 1 confirmed so far"] });
  assert.deepEqual(ledeText({ open, products: null, confirmed: null, validation: true }).rest, ["14 possible effects"]);
  assert.deepEqual(ledeText({ open, products: 1, confirmed: 0, validation: true }).rest, ["14 possible effects on 1 product", "checks against your data on: none confirmed yet"]);
  assert.deepEqual(ledeText({ open, products: 9, confirmed: 0, validation: false }).rest[1], "checks against your data are off");
  assert.deepEqual(ledeText({ open: [{ tone: "good", hypotheses: 1 }], products: 1, confirmed: 0, validation: null }),
    { hot: null, rest: ["None bad for you", "1 possible effect on 1 product"] });
  assert.deepEqual(ledeText({ open: [], products: 0, confirmed: 0, validation: true }), { hot: null, rest: ["Watching for news and price moves that reach your products"] });
  assert.deepEqual(ledeText({ open: [{ tone: "neutral", hypotheses: 0 }], products: 0, confirmed: 0, validation: null }).rest, ["None bad for you", "No effects on your products traced yet"]);
});

test("confirmed checks are counted across the events", () => {
  const a = detail({ tasks: [{ check: { verdict: "confirms" } }, { check: { verdict: "not_yet" } }, { check: null }] });
  const b = detail({ tasks: [{ check: { verdict: "confirms" } }, { check: { verdict: "no_effect" } }] });
  assert.equal(confirmedCount([a, b, undefined]), 2);
});

test("a run that failed says who said no and why", () => {
  const run = { status: "failed", error: "the agent refused the run: HTTP 422", attempt: 1 } as never;
  assert.equal(runKind(run), "failed");
  assert.equal(runWords(run).what, "Refused by the agent");
});
