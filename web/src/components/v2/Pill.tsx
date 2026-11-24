// Pills (also called badges): a short word on a tinted background. The tinted tones use the tone's ink on its tint, which
// passes AA (npm run contrast). Never colour alone: the word says it; `mark` adds a shape in front (◆ Unusual).
import type { ReactNode } from "react";
import type { PillTone } from "./verdictWords";

export interface PillProps {
  tone?: PillTone;
  /** A dashed outline instead of a fill (Test, Checks off). */
  dashed?: boolean;
  /** A shape before the word (decoration: the word carries the meaning). */
  mark?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Pill({ tone = "neutral", dashed = false, mark, className, children }: PillProps) {
  return (
    <span className={`v2-pill v2-pill--${tone}${dashed ? " is-dashed" : ""}${className ? ` ${className}` : ""}`}>
      {mark != null && <span aria-hidden="true" className="v2-pill__mark">{mark}</span>}
      {children}
    </span>
  );
}
/** The same component, under the name the boards use for a status word in a table. */
export const Badge = Pill;
