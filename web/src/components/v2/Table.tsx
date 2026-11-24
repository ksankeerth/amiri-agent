// Table primitives for the boards' row lists: a caps header row, 1 px dividers, hover fill. Built on a CSS grid whose
// columns the page sets once (`cols`), so the header and every row line up. Roles are the table roles, so a screen
// reader reads it as a table.
// A row can be a link: the whole row is clickable, and the link is a real <a> for the keyboard (the stretched-link pattern:
// the <a> covers the row; other buttons inside a row sit above it with className="v2-row__act").
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";

export interface Column { label: string; align?: "right"; /** Hide on phones (the boards' .hs). */ phoneHide?: boolean; /** Keep the label for assistive technology only. */ srOnly?: boolean }
const colsStyle = (cols?: string, phone?: string): CSSProperties | undefined =>
  cols || phone ? ({ ...(cols ? { "--v2-cols": cols } : {}), ...(phone ? { "--v2-cols-phone": phone } : {}) } as CSSProperties) : undefined;

export interface TableProps {
  /** Names the table for assistive technology. */
  label: string;
  /** CSS grid-template-columns shared by the header and the rows: "minmax(0,1fr) 70px 58px". */
  cols: string;
  /** The same on phones, when fewer columns show. */
  colsPhone?: string;
  /** The header row; leave out for a list without one. */
  columns?: Column[];
  /** The last row has no rule under it unless there is one: board 07 closes the list with a line. */
  closed?: boolean;
  children: ReactNode;
  className?: string;
}
export function Table({ label, cols, colsPhone, columns, closed, children, className }: TableProps) {
  return (
    <div role="table" aria-label={label} className={`v2-table${closed ? " is-closed" : ""}${className ? ` ${className}` : ""}`} style={colsStyle(cols, colsPhone)}>
      {columns && (
        <div role="row" className="v2-row v2-row--head">
          {columns.map((c, i) => (
            <div key={i} role="columnheader" className={`v2-cap v2-cell${c.align === "right" ? " is-right" : ""}${c.phoneHide ? " v2-hs" : ""}${c.srOnly ? " v2-sr" : ""}`}>{c.label}</div>
          ))}
        </div>
      )}
      <div role="rowgroup">{children}</div>
    </div>
  );
}

interface RowBase { children: ReactNode; selected?: boolean; className?: string; cols?: string; colsPhone?: string }
type RowAction =
  | { to: string; onSelect?: undefined; label: string }   // a link
  | { onSelect: () => void; to?: undefined; label: string } // selects (a list beside a detail): aria-pressed
  | { to?: undefined; onSelect?: undefined; label?: undefined };
export type RowProps = RowBase & RowAction;

export function Row({ children, selected, className, cols, colsPhone, to, onSelect, label }: RowProps) {
  const interactive = to !== undefined || onSelect !== undefined;
  return (
    <div role="row" className={`v2-row${interactive ? " is-action" : ""}${selected ? " is-selected" : ""}${className ? ` ${className}` : ""}`} style={colsStyle(cols, colsPhone)}>
      {to !== undefined && <div role="cell" className="v2-row__hitcell"><Link to={to} className="v2-row__hit" aria-current={selected ? "true" : undefined}><span className="v2-sr">{label}</span></Link></div>}
      {onSelect && <div role="cell" className="v2-row__hitcell"><button type="button" className="v2-row__hit" aria-pressed={!!selected} onClick={onSelect}><span className="v2-sr">{label}</span></button></div>}
      {children}
    </div>
  );
}

export interface CellProps { children?: ReactNode; align?: "right"; muted?: boolean; mono?: boolean; num?: boolean; phoneHide?: boolean; className?: string }
export function Cell({ children, align, muted, mono, num, phoneHide, className }: CellProps) {
  const c = ["v2-cell", align === "right" && "is-right", muted && "v2-muted", mono && "v2-mono", num && "v2-num", phoneHide && "v2-hs", className].filter(Boolean).join(" ");
  return <div role="cell" className={c}>{children}</div>;
}
