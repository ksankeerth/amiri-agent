// The Overview's numbered tiles (board 00): "1 · WATCHING", a big number, a meta line. The last one, "who must act",
// takes the red tint; on a tint the meta line uses --v2-text-2, not muted (A1).
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** The row of tiles: a heavy rule above, a light one below. */
export function StatTiles({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <section aria-label={label} className={`v2-stats${className ? ` ${className}` : ""}`}>{children}</section>;
}

export interface StatTileProps {
  /** "1 · Watching" (shown in capitals). */
  caption: string;
  value: ReactNode;
  /** "7 monitors · 22 prices · Radar". */
  meta?: ReactNode;
  /** act: the red "who must act" tile. */
  tone?: "act";
  /** Makes the tile a link. */
  to?: string;
  className?: string;
}
export function StatTile({ caption, value, meta, tone, to, className }: StatTileProps) {
  const cls = `v2-stat${tone === "act" ? " v2-stat--act" : ""}${className ? ` ${className}` : ""}`;
  const inner = (
    <>
      <span className="v2-cap v2-stat__cap">{caption}</span>
      <span className="v2-stat__n v2-num">{value}</span>
      {meta != null && <span className="v2-stat__meta">{meta}</span>}
    </>
  );
  return to ? <Link to={to} className={cls}>{inner}</Link> : <div className={cls}>{inner}</div>;
}
