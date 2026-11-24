// "All events →": a text link with an arrow. The arrow is decoration; the words say where it goes.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function ArrowLink({ to, href, children, className }: { to?: string; href?: string; children: ReactNode; className?: string }) {
  const cls = `v2-arrowlink${className ? ` ${className}` : ""}`;
  const inner = <>{children}<span aria-hidden="true"> →</span></>;
  return to !== undefined ? <Link to={to} className={cls}>{inner}</Link> : <a href={href} className={cls}>{inner}</a>;
}
