// The list-and-pane layout of Alerts, Radar, Monitors, Market series and the Scenario Studio: a list on the left and the open
// item's pane on the right. Beside each other when the page is wide enough, one under the other when it is not; on a phone each
// page shows the list, or the pane with a back link (PaneView), as it always has.
//
// Which column stays in view while the page scrolls is one rule for every page (listPaneMath.whoSticks): the shorter column,
// if it fits the scrolling area. A long list beside a pane that fits keeps the pane in view; a short list beside a long pane
// keeps the list in view. Nothing in the layout scrolls on its own: only <main> does (F1).
//
// The pane has a first view (what matters, in a `.v2-lp__panel`) and folded details (PaneFolds holding PaneFold, closed by default).
import { useCallback, useEffect, useRef, useState, type MouseEventHandler, type ReactNode, type RefObject } from "react";
import { Link } from "react-router-dom";
import { moreLabel, PAGE, visibleCount, whoSticks } from "./listPaneMath";
import { useItemFade } from "./useItemFade";

const GAP = 32;  // the sticky offset (16) above a pinned column, and the same below

export interface ListPaneProps {
  list: ReactNode;
  /** The open item's pane. Leave it out (a phone, nothing open) and the list takes the row alone. */
  pane?: ReactNode;
  /** The list is a table with several columns: it gets more of the row. */
  wide?: boolean;
  className?: string;
  /** Which item the pane shows (an id): when it changes the pane's content fades in (F4b). Leave it out for no fade. */
  itemKey?: string | null;
}

export function ListPane({ list, pane, wide, className, itemKey }: ListPaneProps) {
  const root = useRef<HTMLDivElement>(null), listEl = useRef<HTMLDivElement>(null), paneEl = useRef<HTMLDivElement>(null);
  const has = pane != null && pane !== false;
  useItemFade(paneEl, itemKey);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const main = el.closest<HTMLElement>(".v2-main");
    let raf = 0;
    const measure = () => {
      raf = 0;
      const l = listEl.current, p = paneEl.current;
      if (!l || !p) { el.dataset.stick = "none"; return; }
      const lr = l.getBoundingClientRect(), pr = p.getBoundingClientRect();
      const side = pr.left > lr.left + 40;  // stacked: the pane is under the list
      const room = (main?.clientHeight ?? window.innerHeight) - GAP;
      el.dataset.stick = whoSticks(l.offsetHeight, p.offsetHeight, room, side);
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(schedule);
    if (listEl.current) ro.observe(listEl.current);
    if (paneEl.current) ro.observe(paneEl.current);
    if (main) ro.observe(main);
    ro.observe(el);
    schedule();
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [has]);

  return (
    <div ref={root} className={`v2-lp${className ? ` ${className}` : ""}`} data-stick="none">
      <div className={`v2-lp__grid${has ? " has-pane" : ""}${wide ? " is-wide" : ""}`}>
        <div ref={listEl} className="v2-lp__list">{list}</div>
        {has && <div ref={paneEl} className="v2-lp__pane">{pane}</div>}
      </div>
    </div>
  );
}

/** A phone's one-pane view: the back link, then the pane. */
export function PaneView({ back, children }: { back: ReactNode; children: ReactNode }) {
  return <div className="v2-lp__read">{back}{children}</div>;
}

/** The back link of a phone's pane view. Pages that keep their own history handling pass `onClick`. */
export function PaneBack({ to, onClick, children }: { to: string; onClick?: MouseEventHandler<HTMLAnchorElement>; children: ReactNode }) {
  return <Link to={to} className="v2-lp__back" onClick={onClick}><span aria-hidden="true">←</span>{children}</Link>;
}

/** The details under a pane's first view: each a closed fold. */
export function PaneFolds({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`v2-lp__folds${className ? ` ${className}` : ""}`}>{children}</div>;
}

export interface PaneFoldProps {
  title: string;
  /** Grey words after the title: a count, or what is inside. */
  note?: ReactNode;
  id?: string;
  /** Controlled: a deep link opens the fold it points at. */
  open?: boolean;
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}
export function PaneFold({ title, note, id, open, onToggle, children }: PaneFoldProps) {
  return (
    <details id={id} className="v2-lp__fold" open={open} onToggle={onToggle ? e => onToggle(e.currentTarget.open) : undefined}>
      <summary><span className="v2-lp__fold-t">{title}</span>{note != null && note !== false && <span className="v2-lp__fold-n"> · {note}</span>}</summary>
      <div className="v2-lp__fold-b">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------- long lists, ten at a time
export interface Paged<T, E extends HTMLElement = HTMLElement> {
  shown: T[];
  left: number;
  more: () => void;
  /** Put on the element holding the rows; after "Show more" focus moves to the first new row. */
  listRef: RefObject<E | null>;
}
/** The first ten rows, then ten more at a time. `key` says which list this is (a tab, a filter): another one starts again at ten.
 *  `openIdx` is the open row's place in `rows` (-1 for none): a row beyond the first page that is open is always shown. */
export function usePaged<T, E extends HTMLElement = HTMLElement>(rows: T[], key: string, openIdx: number, rowSel: string): Paged<T, E> {
  const [ask, setAsk] = useState({ key, n: PAGE });
  const asked = ask.key === key ? ask.n : PAGE;
  const count = visibleCount(rows.length, asked, openIdx);
  const listRef = useRef<E | null>(null);
  const focusAt = useRef<number | null>(null);
  const more = useCallback(() => { focusAt.current = count; setAsk({ key, n: count + PAGE }); }, [key, count]);
  useEffect(() => {
    if (focusAt.current === null) return;
    const at = focusAt.current;
    focusAt.current = null;
    const row = listRef.current?.querySelectorAll(rowSel)[at];
    row?.querySelector<HTMLElement>("a, button")?.focus();  // the button itself stays put or goes: the next row down is where the reader was heading
  });
  return { shown: rows.slice(0, count), left: rows.length - count, more, listRef };
}

export function MoreRows({ left, onMore, className }: { left: number; onMore: () => void; className?: string }) {
  if (left <= 0) return null;
  return <button type="button" className={`v2-lp__more${className ? ` ${className}` : ""}`} onClick={onMore}>{moreLabel(left)}</button>;
}
