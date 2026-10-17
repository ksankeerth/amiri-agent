// Run with `npm test` (Node runs the TypeScript directly).
import assert from "node:assert/strict";
import { test } from "node:test";
import { continuedTo, continueText, nextOpen, setupOrder, stepFrom, waitingForAnswer } from "./setupFlow.ts";

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
