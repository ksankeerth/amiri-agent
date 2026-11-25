// A confirm or form box over the page (board 15 B "Start a new run?"): a title, words, and the buttons at the foot.
// Focus goes into it and stays inside (Tab wraps), Esc and a click on the dimmed page close it, and focus returns to
// what opened it. It is drawn into <body>, so the page's own transforms can't trap it.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** The buttons, right-aligned: Cancel, then the main one. */
  footer?: ReactNode;
  /** A form box is wider than a confirm. */
  wide?: boolean;
  /** Which field takes focus first (a CSS selector inside the box); the first control otherwise. */
  initialFocus?: string;
}
export function Dialog({ title, onClose, children, footer, wide, initialFocus }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;   // forms pass a new onClose on every render: the effect below must run once, on opening
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = (initialFocus ? box.current?.querySelector<HTMLElement>(initialFocus) : null) ?? box.current?.querySelector<HTMLElement>(FOCUSABLE) ?? box.current;
    first?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === a || document.activeElement === box.current)) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", key);
    document.body.classList.add("modal-open");
    return () => { window.removeEventListener("keydown", key); document.body.classList.remove("modal-open"); opener?.focus?.({ preventScroll: true }); };
  }, [initialFocus]);
  return createPortal(
    <div className="v2 v2-dlg-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`v2-dlg${wide ? " is-wide" : ""}`} ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId} className="v2-dlg__t">{title}</h2>
        <div className="v2-dlg__body">{children}</div>
        {footer != null && <div className="v2-dlg__foot">{footer}</div>}
      </div>
    </div>, document.body);
}
