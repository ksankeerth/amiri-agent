// The demo lock in the web app (plain logic: demoLock.ts; styles: styles/lock.css). The server answers 403 demo_locked
// to every edit, delete and reset while DEMO_LOCK is on; here the same controls stay on screen, greyed out, with the
// reason as a tooltip (on hover and on keyboard focus). They are never hidden and never use the native `disabled`.
import { createContext, forwardRef, useContext, useEffect, useState, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type FieldsetHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, type LinkProps } from "react-router-dom";
import { guarded, LOCK_NOTE, LOCK_TIP, lockAttrs } from "./demoLock";
import "../styles/lock.css";

/** Whether the server has the demo lock on (the installation's `demo_lock`); App provides it to every page. */
export const DemoLockCtx = createContext(false);
export const useDemoLock = () => useContext(DemoLockCtx);

type Own = { locked?: boolean };  // `locked` overrides the app-wide switch (a control that is locked for another reason too)

/** A button that edits, deletes or resets something. Locked: still there, muted, focusable, `aria-disabled`, with the
 *  reason on hover and focus; a click does nothing. Not locked: exactly a <button> (type="button" unless given). */
export const LockBtn = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & Own>(function LockBtn(
  { locked, onClick, disabled, className, type = "button", ...rest }, ref) {
  const ctx = useDemoLock();
  const on = locked ?? ctx;
  return <button ref={ref} type={type} {...rest} {...lockAttrs(on)} className={on ? `${className ?? ""} is-locked`.trim() : className}
    disabled={on ? undefined : disabled} onClick={guarded(on, onClick)} />;
});

/** A link into something that edits (a "new" page). Locked: the click is swallowed. */
export function LockLink({ locked, onClick, className, ...rest }: LinkProps & Own) {
  const ctx = useDemoLock();
  const on = locked ?? ctx;
  return <Link {...rest} {...lockAttrs(on)} className={on ? `${className ?? ""} is-locked`.trim() : className} onClick={guarded(on, onClick)} />;
}

/** An <a> that edits (kept for a file picker styled as a button). */
export function LockAnchor({ locked, onClick, className, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & Own) {
  const ctx = useDemoLock();
  const on = locked ?? ctx;
  return <a {...rest} {...lockAttrs(on)} className={on ? `${className ?? ""} is-locked`.trim() : className} onClick={guarded(on, onClick)} />;
}

/** Fields of a form that is read-only while locked: values stay readable, nothing can be typed. */
export function LockFields({ locked, className, children, ...rest }: FieldsetHTMLAttributes<HTMLFieldSetElement> & Own & { children: ReactNode }) {
  const ctx = useDemoLock();
  const on = locked ?? ctx;
  return <fieldset {...rest} className={`lock-fields${on ? " is-locked-fields" : ""}${className ? ` ${className}` : ""}`} disabled={on} {...(on ? { "data-lock-fields": "" } : {})}>{children}</fieldset>;
}

/** One quiet line for a page that is mostly locked: "◆ Editing is switched off for this demo." Nothing otherwise. */
export function LockNote({ className }: { className?: string }) {
  if (!useDemoLock()) return null;
  return <p className={`rd-lock-note${className ? ` ${className}` : ""}`}><span className="rd-shape" aria-hidden="true">◆</span> {LOCK_NOTE}</p>;
}

/** The tooltip for locked controls, one for the whole app: it shows on hover and on keyboard focus (a native `title`
 *  shows on neither focus nor touch, and disappears with the button's own hover styles), and can't be clipped by a menu. */
export function LockTip() {
  const [tip, setTip] = useState<{ x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    let cur: HTMLElement | null = null;
    const hide = () => { if (cur) { if (cur.isConnected) cur.setAttribute("title", LOCK_TIP); cur = null; } setTip(null); };
    const show = (el: HTMLElement) => {
      if (cur === el) return;
      hide();
      cur = el;
      el.removeAttribute("title");  // the native tooltip would say it a second time
      const r = el.getBoundingClientRect();
      const below = window.innerHeight - r.bottom > 96;  // under the control, unless there is no room (above would cover a menu's own button)
      setTip({ x: Math.min(Math.max(r.left + r.width / 2, 150), window.innerWidth - 150), y: below ? r.bottom + 8 : r.top - 8, below });
    };
    const find = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>("[data-lock]") : null);
    const over = (e: Event) => { const t = find(e); if (t) show(t); else if (cur) hide(); };
    const out = (e: MouseEvent) => { if (!e.relatedTarget) hide(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };
    const away = () => { if (cur) hide(); };
    document.addEventListener("mouseover", over);
    document.addEventListener("focusin", over);
    document.addEventListener("focusout", away);
    document.addEventListener("mouseout", out);
    document.addEventListener("keydown", key);
    document.addEventListener("click", away, true);
    window.addEventListener("scroll", away, true);
    return () => {
      hide();
      document.removeEventListener("mouseover", over); document.removeEventListener("focusin", over);
      document.removeEventListener("focusout", away); document.removeEventListener("mouseout", out);
      document.removeEventListener("keydown", key); document.removeEventListener("click", away, true);
      window.removeEventListener("scroll", away, true);
    };
  }, []);
  return tip ? createPortal(<div className={`lock-tip${tip.below ? " below" : ""}`} role="tooltip" style={{ left: tip.x, top: tip.y }}>{LOCK_TIP}</div>, document.body) : null;
}
