import assert from "node:assert/strict";
import { test } from "node:test";
import { historySummary } from "./words.ts";

const up = (at: string) => ({ at, by: "Amiri Agent", change: "escalated", text: "1 more finding; the investigation added to the event" });

test("a long run of updates is counted, and the check is said once", () => {
  const h = [{ at: "2026-10-18T12:23:56Z", by: "Amiri Agent", change: "raised", text: "From the event." },
    { at: "2026-10-18T12:30:00Z", by: "Amiri Agent", change: "checked", text: "x" },
    up("2026-10-18T14:00:00Z"), up("2026-10-19T14:00:00Z"), up("2026-11-10T02:00:00Z")];
  assert.equal(historySummary(h, h[0].at, "2026-11-10"), "raised 18 Oct · 3 updates from the event, 18 Oct to 10 Nov · last checked 10 Nov");
});

test("people's actions stay in the line, with who did them", () => {
  const h = [{ at: "2026-10-18T12:23:56Z", by: "Amiri Agent", change: "raised" },
    { at: "2026-10-19T04:00:00Z", by: "John", change: "acknowledged" }, up("2026-10-20T04:00:00Z")];
  assert.equal(historySummary(h, h[0].at), "raised 18 Oct · acknowledged by John 19 Oct · 1 update from the event, on 20 Oct");
});
