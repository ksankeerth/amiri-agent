import assert from "node:assert/strict";
import { test } from "node:test";
import { liveState } from "./liveWords.ts";
import type { Overview } from "../../api/overview.ts";

const now = new Date("2026-11-25T14:00:00Z");
const ov = (tick: { last_at: string | null; minutes_ago: number | null; ok: boolean }, markets: object[] = []) =>
  ({ first_run: false, services: { tick }, markets }) as unknown as Overview;

test("a tick that is late is 'delayed', never 'Paused': the server doesn't say the work is paused", () => {
  const long = liveState(ov({ last_at: "2026-11-21T14:00:00Z", minutes_ago: 5780, ok: false }), now, false)!;
  assert.deepEqual([long.word, long.why], ["Updates delayed", "last ran 4 days ago"]);
  const short = liveState(ov({ last_at: "2026-11-25T13:30:00Z", minutes_ago: 30, ok: false }), now, false)!;
  assert.equal(short.word, "Updates a little late");
  assert.equal(liveState(ov({ last_at: null, minutes_ago: null, ok: false }), now, false)!.word, "Waiting for first update");
});

test("fresh updates are Live; stale prices say what is missing, calmly", () => {
  const ok = { last_at: "2026-11-25T13:55:00Z", minutes_ago: 5, ok: true };
  assert.deepEqual(liveState(ov(ok), now, false), { tone: "live", word: "Live", why: "updates ran 5 min ago" });
  const late = liveState(ov(ok, [{ name: "Natural gas fund", state: "stale", state_reason: "No new bar since 20 Nov 15:30 (65 market hours; stale after 30)." }]), now, false)!;
  assert.deepEqual([late.word, late.why], ["Waiting for prices", "Natural gas fund: no new price since 20 Nov 15:30"]);
});

test("no answer and first run", () => {
  assert.equal(liveState(null, now, true)!.word, "No answer");
  assert.equal(liveState(null, now, false), null);
  assert.equal(liveState({ first_run: true } as unknown as Overview, now, false)!.word, "Not watching yet");
});
