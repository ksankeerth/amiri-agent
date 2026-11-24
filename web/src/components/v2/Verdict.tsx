// A check's verdict (board 13 section 5): the seven words as pills, "Checks off" when the institution's checks are
// switched off, and the full form with the server's line, "first look" and what it replaces.
import type { ReactNode } from "react";
import { Pill } from "./Pill";
import { verdictLook, verdictNotes } from "./verdictWords";

export interface VerdictProps {
  /** check.verdict */
  verdict: string | null | undefined;
  /** check.verdict_text: the server's words for the pill; the table's own words are used when it is missing. */
  text?: string | null;
  /** check.line / check.what: the sentence under the pill (full form). */
  line?: ReactNode;
  /** check.final: false means a first look. */
  final?: boolean;
  /** check.supersedes */
  supersedes?: { verdict: string } | null;
  /** Show the sentence and the small print under the pill. */
  full?: boolean;
}

export function Verdict({ verdict, text, line, final, supersedes, full = false }: VerdictProps) {
  const look = verdictLook(verdict, text);
  const pill = <Pill tone={look.tone}>{look.label}</Pill>;
  if (!full) return pill;
  const notes = verdictNotes({ final, verdict, supersedes });
  return (
    <span className="v2-verdict">
      {pill}
      {line && <span className="v2-verdict__line">{line}</span>}
      {notes.length > 0 && <span className="v2-verdict__note">{notes.join(" · ")}</span>}
    </span>
  );
}

/** data-connection.validation_enabled = false: never an empty cell. `action` is the way to turn them on (a link). */
export function ChecksOff({ action }: { action?: ReactNode }) {
  return (
    <span className="v2-verdict">
      <Pill dashed>Checks off</Pill>
      {action && <span className="v2-verdict__act">{action}</span>}
    </span>
  );
}
