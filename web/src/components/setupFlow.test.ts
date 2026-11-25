// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { changeWords, continuedTo, countOf, continueText, fieldWord, nextOpen, NEUTRAL_STARTERS, setupOrder, STARTERS, startersFor, stepFrom, trackFor, US_STARTERS, valueText, waitingForAnswer } from "./setupFlow.ts";

test("an unanswered question holds the move; anything said after it releases it", () => {
  const q = { role: "assistant", kind: "question" }, said = { role: "user", kind: "text" }, picked = { role: "user", kind: "answer" };
  const applied = { role: "system", kind: "applied" }, card = { role: "assistant", kind: "proposal" };
  assert.equal(waitingForAnswer([said, card, q, applied]), true);   // proposed, asked, then applied: wait
  assert.equal(waitingForAnswer([q, picked, card, applied]), false); // the question was answered before
  assert.equal(waitingForAnswer([q, said, card, applied]), false);   // answered by typing counts too
  assert.equal(waitingForAnswer([said, card, applied]), false);      // no question at all
  assert.equal(waitingForAnswer([]), false);
  // asked in the reply's own words rather than with options
  const asks = { role: "assistant", kind: "text", content: { text: "I've proposed Samoa. Would you like to add any places to watch? " } };
  const tells = { role: "assistant", kind: "text", content: { text: "Nothing changes until you apply it; next is customers and products." } };
  assert.equal(waitingForAnswer([said, card, asks, applied]), true);
  assert.equal(waitingForAnswer([said, card, tells, applied]), false);
  assert.equal(waitingForAnswer([said, card, asks, said, applied]), false);
});

const t = (track: string, order: number | null, status = "not_started", extra: Record<string, unknown> = {}) =>
  ({ track, label: track[0].toUpperCase() + track.slice(1).replace(/_/g, " "), order, read_only: order === null, shown: true, status, ...extra });
const TRACKS = [
  t("history", null), t("institution", 1, "concluded"), t("footprint_flows", 2), t("customers_products", 3),
  t("rules", 4, "concluded"), t("rivals_partners", 5), t("verification", 8), t("monitors", 7), t("offtopic", null, "not_started", { shown: false }),
];

test("first setup is the ordered, writable, shown tracks", () => {
  assert.deepEqual(setupOrder(TRACKS).map(x => x.track),
    ["institution", "footprint_flows", "customers_products", "rules", "rivals_partners", "monitors", "verification"]);
});

test("after applying a track, the chat moves to the next one not yet concluded", () => {
  assert.equal(nextOpen(TRACKS, "institution")?.track, "footprint_flows");
  assert.equal(nextOpen(TRACKS, "customers_products")?.track, "rivals_partners");  // rules is already concluded
  assert.equal(nextOpen(TRACKS, "verification"), null);                           // the last one: nothing after it
  assert.equal(nextOpen(TRACKS, "history"), null);                                // not a setup track: stay
  const allDone = TRACKS.map(x => ({ ...x, status: "concluded" }));
  assert.equal(nextOpen(allDone, "institution"), null);
});

test("← and → step through first setup; → from outside it goes to the first open track", () => {
  assert.equal(stepFrom(TRACKS, "footprint_flows", 1)?.track, "customers_products");
  assert.equal(stepFrom(TRACKS, "footprint_flows", -1)?.track, "institution");
  assert.equal(stepFrom(TRACKS, "institution", -1), null);
  assert.equal(stepFrom(TRACKS, "verification", 1), null);
  assert.equal(stepFrom(TRACKS, "history", 1)?.track, "footprint_flows");
  assert.equal(stepFrom(TRACKS, null, -1), null);
});

test("the moving-on message is recognised, and nothing else is", () => {
  assert.equal(continueText("Footprint and flows"), "Continue with footprint and flows.");
  const labelled = [{ ...t("footprint_flows", 2), label: "Footprint and flows" }];
  assert.equal(continuedTo(labelled, "Continue with footprint and flows.")?.track, "footprint_flows");
  assert.equal(continuedTo(labelled, "continue with footprint and flows"), null);
  assert.equal(continuedTo(labelled, undefined), null);
});

test("the chat follows the page: a setup step or a tab names its track", () => {
  const defs = [
    { ...t("institution", 1), setup_step: "institution", tab: "overview" },
    { ...t("footprint_flows", 2), setup_step: "where", tab: "footprint" },
    { ...t("customers_products", 3), setup_step: "customers", tab: "customers" },
    { ...t("verification", 8), setup_step: "review", tab: "overview" },
    { ...t("offtopic", null, "not_started", { shown: false }), setup_step: null, tab: "rules" },
  ];
  assert.equal(trackFor(defs, { step: "customers" })?.track, "customers_products");
  assert.equal(trackFor(defs, { step: "products" })?.track, "customers_products");  // shares its neighbour's
  assert.equal(trackFor(defs, { step: "flows" })?.track, "footprint_flows");
  assert.equal(trackFor(defs, { step: "review" })?.track, "verification");
  assert.equal(trackFor(defs, { tab: "overview" })?.track, "institution");           // the first one for a shared tab
  assert.equal(trackFor(defs, { tab: "overview" }, "verification")?.track, "verification");  // ...unless the chat is already on the other one
  assert.equal(trackFor(defs, { tab: "overview" }, "risks")?.track, "institution");  // a topic that doesn't fit the tab gives way
  assert.equal(trackFor(defs, { step: "institution" }, "verification")?.track, "institution");  // a setup step is never shared
  assert.equal(trackFor(defs, { tab: "rules" }), null);                                // hidden tracks never
  assert.equal(trackFor(defs, {}), null);
});

test("a change reads as words: names not ids, field names not keys", () => {
  const rival = { section: "rivals", op: "create", id: "bank-of-ceylon", before: null, after: { name: "Bank of Ceylon", type: "bank" } };
  assert.deepEqual(changeWords(rival, "propose"), { lead: "Add", name: "Bank of Ceylon", tail: "as a rival" });
  assert.deepEqual(changeWords(rival, "done"), { lead: "Added rival", name: "Bank of Ceylon", tail: "" });
  const ccy = { section: "institution", op: "update", id: "serendib-bank", before: { clearing_currencies: ["USD"] }, after: { clearing_currencies: ["USD", "EUR"] } };
  assert.equal(changeWords(ccy, "propose").lead, "Change the institution details");
  assert.equal(changeWords(ccy, "done").lead, "Changed currencies you settle in abroad");
  assert.equal(fieldWord("clearing_currencies"), "Currencies you settle in abroad");
  assert.equal(fieldWord("some_new_key"), "Some new key");
  assert.equal(countOf("watch-places", 6), "6 places to watch");
  assert.equal(countOf("rivals", 1), "1 rival");
  assert.equal(valueText(["USD", "EUR"]), "USD, EUR");
  assert.equal(valueText("remittances_in"), "remittances in");
  assert.equal(valueText(null), "—");
  const flow = { section: "flows", op: "create", item_id: "remit-kw", before: null, after: { kind: "remittances_in", local: "LK", counterpart: "KW" } };
  assert.equal(changeWords(flow, "done", { KW: "Kuwait" }).name, "remittances in: Kuwait");
  assert.equal(changeWords({ section: "rivals", op: "delete", id: "old-rival", before: null, after: null }, "propose").name, "Old rival");
  assert.equal(changeWords({ section: "institution", op: "status", before: { status: "setup" }, after: { status: "active" } }, "done").lead, "Went live");
});

test("the chat's starters follow the home country: Sri Lanka's as before, the US pack's, or neutral ones", () => {
  assert.equal(startersFor("LK"), STARTERS);
  assert.deepEqual(STARTERS.institution, ["We're a commercial bank in Sri Lanka", "Our Board Risk Committee owns risk decisions"]);
  assert.deepEqual(STARTERS.monitors, ["Watch Gulf jobs for our migrant families", "Watch our main rival's deposit rates"]);
  assert.equal(startersFor("US"), US_STARTERS);
  assert.equal(startersFor("us"), US_STARTERS);
  const us = Object.values(US_STARTERS).flat();
  for (const chip of ["We're a commercial bank in Dallas, Texas", "We lend to data-center contractors and energy firms",
                      "Watch ERCOT power curtailments"]) assert.ok(us.includes(chip), chip);
  for (const c of ["ID", "PH", "GB", null, undefined, ""]) assert.equal(startersFor(c), NEUTRAL_STARTERS);
  const place = /Sri Lanka|Gulf|Kerala|Tamil|Ceylon|migrant|Texas|Dallas|Houston|ERCOT/i;
  assert.deepEqual(Object.values(NEUTRAL_STARTERS).flat().filter(x => place.test(x)), []);
  assert.deepEqual(Object.values(US_STARTERS).flat().filter(x => /Sri Lanka|Gulf|Kerala|Tamil|Ceylon|migrant/i.test(x)), []);
  for (const set of [US_STARTERS, NEUTRAL_STARTERS]) assert.deepEqual(Object.keys(set).sort(), Object.keys(STARTERS).sort());
});
