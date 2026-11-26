// A box over the page (board 15 B "Start a new run?") with one layout for every dialog (F6): a header (title, an optional line under it, a
// warning mark when the tone is danger), a body that scrolls on its own (the header and the footer stay in view), and a footer of actions,
// right-aligned, the main one last with Cancel to its left. Sizes: S (400 px, a confirm), M (560 px, a short form), L (760 px, a long form).
// Under 720 px it is a bottom sheet: full width, rounded on top, sliding up.
// Focus goes into it and stays inside (Tab wraps), Esc and a click on the dimmed page close it, and focus returns to what opened it.
// It is drawn into <body>, so the page's own transforms can't trap it.
// Motion (F3): the box fades in and scales .98 to 1 in 160 ms (the scrim fades; the sheet slides up); on close it fades out in 120 ms. The parent
// just removes it, so the fade is a copy of the box that stays for 120 ms (useExitGhost): focus is back on the opener at once.
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useExitGhost } from "./useMotion";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export type DialogSize = "S" | "M" | "L";
export interface DialogProps {
  title: string;
  /** A line under the title: what this is about, in a few words. */
  description?: ReactNode;
  onClose: () => void;
  /** The body. It scrolls inside the box when it is long. */
  children: ReactNode;
  /** The footer, right-aligned: Cancel, then the main action. Anything that belongs on the far left (a quiet "Delete this item", a count) is
   *  wrapped in `.v2-dlg__aside`. */
  actions?: ReactNode;
  /** S 400 px (a confirm), M 560 px (a short form), L 760 px (a long form). */
  size?: DialogSize;
  /** "danger": a warning mark by the title and the main action (the last `.v2-btn--primary` in the footer) in the red. */
  tone?: "default" | "danger";
  /** Which field takes focus first (a CSS selector inside the box); the first control otherwise. */
  initialFocus?: string;
}
export function Dialog({ title, description, onClose, children, actions, size = "S", tone = "default", initialFocus }: DialogProps) {
  const box = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  useExitGhost(scrim);
  const titleId = useId(), descId = useId();
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
    <div className="v2 v2-dlg-scrim" ref={scrim} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`v2-dlg is-${size}${tone === "danger" ? " is-danger" : ""}`} ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-describedby={description != null ? descId : undefined} tabIndex={-1}>
        <header className="v2-dlg__head">
          {tone === "danger" && <span className="v2-dlg__mark" aria-hidden="true">▲</span>}
          <div className="v2-dlg__heads">
            <h2 id={titleId} className="v2-dlg__t">{title}</h2>
            {description != null && <p id={descId} className="v2-dlg__desc">{description}</p>}
          </div>
        </header>
        <div className="v2-dlg__body">{children}</div>
        {actions != null && <footer className="v2-dlg__foot">{actions}</footer>}
      </div>
    </div>, document.body);
}
