// What a check's verdict looks like: the seven server values (server: app/validation/explain.py, VERDICT) mapped to the
// words and tone on board 13 section 5. Plain logic, no React, so `npm test` covers it.

export type PillTone = "bad" | "unusual" | "good" | "neutral" | "brand" | "ink" | "sim";
export type VerdictKey = "confirms" | "contradicts" | "no_effect" | "insufficient_data" | "masked" | "not_yet" | "error";

export interface VerdictLook { key: VerdictKey | "unknown"; label: string; tone: PillTone }

/** Every verdict, in the board's order. The label is the server's `verdict_text` with a capital letter. */
export const VERDICTS: Record<VerdictKey, VerdictLook> = {
  confirms: { key: "confirms", label: "Confirms", tone: "ink" },
  contradicts: { key: "contradicts", label: "Moved the other way", tone: "unusual" },
  no_effect: { key: "no_effect", label: "No effect", tone: "good" },
  insufficient_data: { key: "insufficient_data", label: "Not enough data", tone: "neutral" },
  masked: { key: "masked", label: "Hidden by relief", tone: "neutral" },
  not_yet: { key: "not_yet", label: "Not published yet", tone: "neutral" },
  error: { key: "error", label: "Couldn't check", tone: "bad" },
};
export const VERDICT_ORDER = Object.keys(VERDICTS) as VerdictKey[];

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The look for a server verdict. The server's own words win when it sent them (`verdict_text`), so a reworded
 *  server never shows a stale label; a verdict this build doesn't know is shown neutral, in the server's words. */
export function verdictLook(verdict: string | null | undefined, verdictText?: string | null): VerdictLook {
  const known = verdict ? VERDICTS[verdict as VerdictKey] : undefined;
  const words = verdictText?.trim();
  if (known) return words ? { ...known, label: capital(words) } : known;
  return { key: "unknown", label: capital(words || (verdict ?? "").replace(/_/g, " ")) || "Not checked", tone: "neutral" };
}

/** The small print under a verdict: "First look; may change as more data comes in · was: Not published yet". */
export function verdictNotes(c: { final?: boolean; verdict?: string | null; supersedes?: { verdict: string } | null }): string[] {
  const out: string[] = [];
  // an error or a "not published yet" has nothing to change: only a result with data in it is a first look
  if (c.final === false && c.verdict !== "error" && c.verdict !== "not_yet") out.push("First look; may change as more data comes in");
  if (c.supersedes) out.push(`was: ${verdictLook(c.supersedes.verdict).label}`);
  return out;
}
