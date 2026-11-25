// The "⋯" button and its small menu (board 09: "More: rename or delete"). The button names what it is for (A11); the menu
// opens under it, Up/Down move between items, Esc closes and returns focus to the button, a click elsewhere closes it.
// Items are buttons; a locked one (demo lock) stays focusable, greyed, with the reason as its tooltip.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { guarded, lockAttrs } from "../demoLock";

export interface MoreItem { label: string; onSelect: () => void; locked?: boolean; danger?: boolean }

export function MoreMenu({ label, items, className }: { label: string; items: MoreItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const focusItem = (i: number) => {
    const els = root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (els?.length) els[(i + els.length) % els.length].focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const els = [...(root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); btn.current?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); if (!open) setOpen(true); else focusItem(at + 1); }
    else if (e.key === "ArrowUp" && open) { e.preventDefault(); focusItem(at < 0 ? -1 : at - 1); }
    else if (e.key === "Tab" && open) setOpen(false);
  };
  useEffect(() => { if (open) root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(); }, [open]);
  return (
    <span className={`v2-more${className ? ` ${className}` : ""}`} ref={root} onKeyDown={onKey}>
      <button ref={btn} type="button" className="v2-btn v2-btn--secondary v2-btn--icon v2-btn--sm" aria-label={label} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? id : undefined} onClick={() => setOpen(o => !o)}><span aria-hidden="true">⋯</span></button>
      {open && (
        <div id={id} className="v2-more__menu" role="menu" aria-label={label}>
          {items.map(it => (
            <button key={it.label} type="button" role="menuitem" className={`v2-more__item${it.danger ? " is-danger" : ""}`} {...lockAttrs(!!it.locked)}
              onClick={guarded(!!it.locked, () => { setOpen(false); btn.current?.focus(); it.onSelect(); })}>{it.label}</button>
          ))}
        </div>
      )}
    </span>
  );
}
