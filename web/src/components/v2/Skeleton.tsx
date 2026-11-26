// The loading state (board 13 section 2): rows that keep the shape of the real ones, so nothing jumps when the data arrives.
// One placeholder for the whole app (F3): <SkBar> is a single calm bar (a soft pulse, still under reduced motion); a page that wants its own
// shape lays SkBars out with its own wrapper (rows, a header, a pane) and sets each bar's width, height and radius as props.
// <Skeleton> is the ready-made list of rows.
import type { CSSProperties } from "react";

export interface SkBarProps {
  /** Width: px as a number, or any CSS length ("46%", "min(420px, 100%)"). Omit to fill the line. */
  w?: number | string;
  h?: number | string;
  /** Corner radius: px, or a CSS value ("var(--v2-r-sm)"). 4 px by default; 999 for a pill. */
  r?: number | string;
  className?: string;
  style?: CSSProperties;
}
export function SkBar({ w, h, r, className, style }: SkBarProps) {
  return <span className={`v2-skel__b${className ? ` ${className}` : ""}`} aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />;
}

export interface SkeletonProps {
  rows?: number;
  /** Read out while loading ("Loading the alerts"). */
  label?: string;
  className?: string;
}
export function Skeleton({ rows = 4, label = "Loading", className }: SkeletonProps) {
  return (
    <div className={`v2-skel${className ? ` ${className}` : ""}`} role="status" aria-busy="true">
      <span className="v2-sr">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="v2-skel__row" aria-hidden="true"><span className="v2-skel__dot" /><span className="v2-skel__bar" /><span className="v2-skel__end" /></div>
      ))}
    </div>
  );
}
