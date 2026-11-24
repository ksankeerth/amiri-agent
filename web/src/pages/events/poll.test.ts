// Run with `node --test src/pages/events/poll.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { finishedText, pollRun, POLL_EVERY_MS, POLL_FOR_MS } from "./poll.ts";

const clock = () => { const c = { t: 0, asks: 0 }; return { c, wait: async (ms: number) => { c.t += ms; } }; };

test("polls every 3 s and stops as soon as the run is no longer running", async () => {
  const { c, wait } = clock();
  const end = await pollRun({ wait, cancelled: () => false, stillRunning: async () => { c.asks++; return c.asks < 4; } });
  assert.equal(end, "done");
  assert.equal(c.asks, 4);
  assert.equal(c.t, 4 * POLL_EVERY_MS);
});

test("gives up after two minutes", async () => {
  const { c, wait } = clock();
  const end = await pollRun({ wait, cancelled: () => false, stillRunning: async () => { c.asks++; return true; } });
  assert.equal(end, "timeout");
  assert.equal(c.t, POLL_FOR_MS);
  assert.equal(c.asks, POLL_FOR_MS / POLL_EVERY_MS);
});

test("a failed ask doesn't end the wait", async () => {
  const { c, wait } = clock();
  const end = await pollRun({ wait, cancelled: () => false, stillRunning: async () => { c.asks++; if (c.asks < 3) throw new Error("down"); return false; } });
  assert.equal(end, "done");
  assert.equal(c.asks, 3);
});

test("stops without asking when the page has gone", async () => {
  const { c, wait } = clock();
  let gone = false;
  const end = await pollRun({ wait: async ms => { await wait(ms); gone = true; }, cancelled: () => gone, stillRunning: async () => { c.asks++; return true; } });
  assert.equal(end, "cancelled");
  assert.equal(c.asks, 0);
});

test("the words when the wait ends", () => {
  assert.equal(finishedText("timeout", 0), "Still working; it will appear here.");
  assert.equal(finishedText("done", 2), "The investigation finished: 2 events found.");
  assert.equal(finishedText("done", 1), "The investigation finished: 1 event found.");
  assert.equal(finishedText("done", 0), "The investigation finished. It found no new event.");
  assert.equal(finishedText("cancelled", 0), "");
});
