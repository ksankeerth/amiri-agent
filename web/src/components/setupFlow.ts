// The setup chat's first-setup order: where ← and → go, which track comes next once one is applied,
// and the short message that moves the chat on (an ordinary turn with the track picked, so the agent opens
// the next track with its first question and the notes kept for it).

export interface FlowTrack { track: string; label: string; order: number | null; read_only: boolean; shown: boolean; status?: string }

/** The tracks of first setup, in their order. */
export const setupOrder = <T extends FlowTrack>(ts: T[]): T[] =>
  ts.filter(t => t.order !== null && !t.read_only && t.shown).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

/** The track before (-1) or after (1) `from` in first setup; null at either end. From a track outside it
 *  (a question, the history), → goes to the first one not yet concluded. */
export function stepFrom<T extends FlowTrack>(ts: T[], from: string | null, dir: 1 | -1): T | null {
  const o = setupOrder(ts);
  const i = o.findIndex(t => t.track === from);
  if (i < 0) return dir === 1 ? o.find(t => t.status !== "concluded") ?? null : null;
  return o[i + dir] ?? null;
}

/** Once `done` is applied: the next track of first setup that isn't concluded yet; null when none is left. */
export function nextOpen<T extends FlowTrack>(ts: T[], done: string): T | null {
  const o = setupOrder(ts);
  const i = o.findIndex(t => t.track === done);
  return i < 0 ? null : o.slice(i + 1).find(t => t.status !== "concluded") ?? null;
}

/** Whether the agent's latest question still waits for its answer: nothing typed or picked since it was asked.
 *  A question is one with options, or a reply of the agent's that ends by asking ("…any places to watch?"). */
export function waitingForAnswer(messages: { role: string; kind: string; content?: Record<string, any> }[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && (m.kind === "text" || m.kind === "answer")) return false;
    if (m.kind === "question") return true;
    if (m.role === "assistant" && m.kind === "text" && typeof m.content?.text === "string" && m.content.text.trim().endsWith("?")) return true;
  }
  return false;
}

/** The message that moves the chat on to a track; shown as a marker, not as something the person typed. */
export const continueText = (label: string) => `Continue with ${label.toLowerCase()}.`;

/** The track a message moved the chat on to, if it is one of those messages. */
export const continuedTo = <T extends FlowTrack>(ts: T[], text: unknown): T | null =>
  typeof text === "string" ? ts.find(t => continueText(t.label) === text) ?? null : null;
