// A section's heading line (board 00): the title, a count chip, anything else on the left (a pill, "1 day"), and the
// right-side link ("All events →" as an ArrowLink). `size="sm"` is the narrow column's 16 px heading.
import type { ReactNode } from "react";
import { Count } from "./Count";

export interface SectionHeadProps {
  title: ReactNode;
  count?: number | string;
  countTone?: "neutral" | "hot" | "unusual";
  /** Read after the count: "open events". */
  countLabel?: string;
  /** Beside the count: a Pill, a quiet note. */
  meta?: ReactNode;
  /** Pushed to the right: usually an ArrowLink. */
  action?: ReactNode;
  size?: "md" | "sm";
  /** Heading level (2 by default). */
  level?: 2 | 3;
  id?: string;
  className?: string;
}
export function SectionHead({ title, count, countTone, countLabel, meta, action, size = "md", level = 2, id, className }: SectionHeadProps) {
  const H = level === 2 ? "h2" : "h3";
  return (
    <div className={`v2-sechead v2-sechead--${size}${className ? ` ${className}` : ""}`}>
      <H id={id} className="v2-sechead__t">{title}</H>
      {count != null && <Count n={count} tone={countTone} label={countLabel} />}
      {meta}
      <span className="v2-sechead__gap" />
      {action}
    </div>
  );
}
