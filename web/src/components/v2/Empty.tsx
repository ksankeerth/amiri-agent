// A calm empty state (boards 15 and 16): a title, one line, and at most one action. No icon, no cheer.
import type { ReactNode } from "react";

export interface EmptyProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** Without the dashed outline, for inside a panel that already has an edge. */
  plain?: boolean;
  className?: string;
}
export function Empty({ title, children, action, plain, className }: EmptyProps) {
  return (
    <div className={`v2-empty${plain ? " is-plain" : ""}${className ? ` ${className}` : ""}`}>
      <b className="v2-empty__t">{title}</b>
      {children != null && <div className="v2-empty__m">{children}</div>}
      {action != null && <div className="v2-empty__act">{action}</div>}
    </div>
  );
}
