// Toasts (A10, board 13 section 3). Two kinds, both closable:
//   info      a short note the app says ("Saved"): role=status, in a polite live region
//   refusal   the server said no: its `detail` is the message, its `code` small in mono for support; role=alert
// A toast never closes while the pointer is over it or focus is inside it, and Esc closes the one that has focus.
// <ToastHost> draws a list of them; the provider in components/ui.tsx owns the list and its timers' lengths.
// Motion (F3): a toast slides in (160 ms); when it is dismissed or times out it fades out (120 ms) before it leaves the stack.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "../Icon";
import { exitDelay, prefersReducedMotion, withLeaving, type Leaving } from "./motion";

export interface ToastData {
  id: number;
  kind: "info" | "refusal";
  message: string;
  /** Refusals: the problem's `code` ("budget_spent"). */
  code?: string;
  /** Refusals: a bold line above the message, when the page has one. */
  title?: string;
  /** Info toasts: one button after the message ("Undo"). It closes the toast and runs `onClick`. */
  action?: ToastAction;
}
export interface ToastAction { label: string; /** what it does, as a tooltip ("Moves it back to New") */ title?: string; onClick: () => void }

/** Counts down `ms`, but stands still while paused; calls `done` once. ms <= 0: never. */
function useCloseTimer(ms: number, paused: boolean, done: () => void) {
  const left = useRef(ms);
  const doneRef = useRef(done);
  doneRef.current = done;
  useEffect(() => {
    if (ms <= 0 || paused) return;
    const started = Date.now();
    const t = setTimeout(() => doneRef.current(), left.current);
    return () => { clearTimeout(t); left.current = Math.max(600, left.current - (Date.now() - started)); };  // a moment to read, whenever it resumes
  }, [ms, paused]);
}

export interface ToastProps extends Omit<ToastData, "id" | "kind"> {
  kind?: "info" | "refusal";
  onClose: () => void;
  /** How long it stays when nobody is looking at it; 0 keeps it (the gallery's specimens). */
  ms?: number;
  /** Fading out: its entry is already gone from the list. Can't be clicked or read again. */
  leaving?: boolean;
}

/** One toast. A refusal is announced at once (role=alert); an info toast waits in the polite region of its host. */
export function Toast({ kind = "info", message, code, title, action, onClose, ms, leaving }: ToastProps) {
  const [hover, setHover] = useState(false), [focus, setFocus] = useState(false);
  useCloseTimer(ms ?? (kind === "refusal" ? 9000 : action ? 8000 : 4200), hover || focus, onClose);
  const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
  return (
    <div className={`v2-toast v2-toast--${kind}${leaving ? " is-leaving" : ""}`} {...(kind === "refusal" ? { role: "alert" } : {})} {...(leaving ? { inert: true, "aria-hidden": true } : {})}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false); }} onKeyDown={esc}>
      <span className="v2-toast__dot" aria-hidden="true" />
      <div className="v2-toast__body">
        {title && <b className="v2-toast__title">{title}</b>}
        <div className={title ? "v2-toast__msg" : "v2-toast__msg is-lead"}>{message}</div>
        {code && <div className="v2-mono v2-toast__code">{code}</div>}
      </div>
      {action && <button type="button" className="v2-toast__act" title={action.title} onClick={() => { onClose(); action.onClick(); }}>{action.label}</button>}
      <button type="button" className="v2-toast__x" aria-label="Close" onClick={onClose}><Icon name="x" /></button>
    </div>
  );
}

/** The refusal toast of board 13 (detail as the message, code small). */
export function RefusalToast(props: Omit<ToastProps, "kind">) {
  return <Toast {...props} kind="refusal" />;
}

/** The stack at the bottom of the screen. Info toasts share one polite live region; each refusal is its own alert.
 *  A toast that leaves the list stays for 120 ms, fading, then goes. */
export function ToastHost({ items, onClose }: { items: ToastData[]; onClose: (id: number) => void }) {
  const [shown, setShown] = useState<Leaving<ToastData>[]>(() => items.map(item => ({ item, leaving: false })));
  useEffect(() => { setShown(prev => withLeaving(prev, items)); }, [items]);
  useEffect(() => {
    if (!shown.some(s => s.leaving)) return;
    const t = setTimeout(() => setShown(prev => prev.filter(s => !s.leaving)), exitDelay(prefersReducedMotion()));
    return () => clearTimeout(t);
  }, [shown]);
  const info = shown.filter(s => s.item.kind === "info"), refusals = shown.filter(s => s.item.kind === "refusal");
  return (
    <div className="v2 v2-toasts">
      <div role="status" aria-live="polite" className="v2-toasts__list">
        {info.map(({ item: t, leaving }) => <Toast key={t.id} message={t.message} action={t.action} leaving={leaving} onClose={() => onClose(t.id)} />)}
      </div>
      <div className="v2-toasts__list">
        {refusals.map(({ item: t, leaving }) => <Toast key={t.id} kind="refusal" message={t.message} code={t.code} title={t.title} leaving={leaving} onClose={() => onClose(t.id)} />)}
      </div>
    </div>
  );
}
