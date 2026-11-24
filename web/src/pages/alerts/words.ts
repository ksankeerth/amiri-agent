// Alerts page: small word helpers, kept out of the shared plain.ts.
import { day } from "../../format.ts";
import { alertChangeText } from "../../plain.ts";

interface Entry { at: string; change: string; text?: string | null; by?: string }
const asDay = (d: string) => (d.length === 10 ? `${d}T12:00:00Z` : d);

/** The history in one line. A run of the same change (the event only grew, 227 times) is counted, not listed:
 *  "raised 18 Oct · 227 updates from the event, 18 Oct to 10 Nov · last checked 10 Nov".
 *  `lastChecked` is the day the latest check looked at (the checks themselves stay in the full list). */
export function historySummary(history: Entry[], raisedAt: string, lastChecked?: string | null): string {
  const parts: string[] = [];
  const st: { run: { n: number; from: string; to: string } | null } = { run: null };
  const flush = () => {
    if (!st.run) return;
    const { n, from, to } = st.run;
    const [a, b] = [day(from), day(to)];
    parts.push(`${n} ${n === 1 ? "update" : "updates"} from the event, ${a === b ? `on ${a}` : `${a} to ${b}`}`);
    st.run = null;
  };
  let raised = false;
  for (const h of history) {
    if (h.change === "checked") continue;  // said once, as "last checked"
    if (alertChangeText(h).startsWith("Updated")) {
      st.run = st.run ? { ...st.run, n: st.run.n + 1, to: h.at } : { n: 1, from: h.at, to: h.at };
      continue;
    }
    flush();
    if (h.change === "raised") { raised = true; parts.push(`raised ${day(h.at)}`); continue; }
    const who = h.by && h.by !== "Amiri Agent" ? ` by ${h.by}` : "";
    parts.push(`${alertChangeText(h).toLowerCase()}${who} ${day(h.at)}`);
  }
  flush();
  if (!raised) parts.unshift(`raised ${day(raisedAt)}`);
  if (lastChecked) parts.push(`last checked ${day(asDay(lastChecked))}`);
  return parts.join(" · ");
}
