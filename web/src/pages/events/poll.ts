// Waiting for an investigation (server: GET /api/v1/investigations/{run_id}, UI_POLLING_NOTE.md): ask every 3 s while a
// run is `running`, stop when it isn't or after 2 minutes. After that the page says "still working; it will appear here"
// and the server's tick collects the result. Plain logic with the clock and the call passed in, so `npm test` covers it.

export const POLL_EVERY_MS = 3_000;
export const POLL_FOR_MS = 120_000;

export type PollEnd = "done" | "timeout" | "cancelled";
export interface PollOptions {
  /** Ask once: true while the run is still going. */
  stillRunning: () => Promise<boolean>;
  /** Wait this long (the page passes setTimeout; tests pass a fake clock that moves time). */
  wait: (ms: number) => Promise<void>;
  cancelled: () => boolean;
  every?: number;
  forAtMost?: number;
}

/** Asks `stillRunning` every `every` ms until it says no (done), `forAtMost` ms have passed (timeout), or the page left (cancelled).
 *  A failed ask counts as "still going": a flaky answer doesn't end the wait early. */
export async function pollRun({ stillRunning, wait, cancelled, every = POLL_EVERY_MS, forAtMost = POLL_FOR_MS }: PollOptions): Promise<PollEnd> {
  for (let waited = 0; waited < forAtMost; waited += every) {
    await wait(every);
    if (cancelled()) return "cancelled";
    let going = true;
    try { going = await stillRunning(); } catch { /* ask again */ }
    if (!going) return "done";
  }
  return "timeout";
}

/** What the toast says when the wait ends. `found` is how many events the finished runs made. */
export function finishedText(end: PollEnd, found: number): string {
  if (end === "timeout") return "Still working; it will appear here.";
  if (end === "cancelled") return "";
  return found > 0 ? `The investigation finished: ${found === 1 ? "1 event" : `${found} events`} found.` : "The investigation finished. It found no new event.";
}
