// The demo lock's plain logic (no React, so `npm test` covers it). DEMO_LOCK on the server switches off editing,
// deleting and the reset; the web app keeps those controls on screen, greyed out, with the reason as a tooltip.

export const LOCK_TIP = "Switched off for this demo, so nothing is changed by accident.";
export const LOCK_NOTE = "Editing is switched off for this demo.";
export const LOCK_TOAST = "Switched off for this demo.";

/** The server's answer when a stale page still tried: 403 with the problem code demo_locked. */
export function isDemoLocked(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "demo_locked";
}

/** Attributes for a locked control: it stays visible and focusable (not `disabled`, which hides tooltips and skips
 *  focus), says so to assistive technology, and carries the reason. Nothing when the control isn't locked. */
export function lockAttrs(locked: boolean): { "aria-disabled"?: true; title?: string; "data-lock"?: "" } {
  return locked ? { "aria-disabled": true, title: LOCK_TIP, "data-lock": "" } : {};
}

interface Clickish { preventDefault(): void; stopPropagation(): void }
/** A click handler that does nothing but stop the click when locked, and is the given handler otherwise. */
export function guarded<E extends Clickish>(locked: boolean, fn?: (e: E) => void): ((e: E) => void) | undefined {
  if (!locked) return fn;
  return (e: E) => { e.preventDefault(); e.stopPropagation(); };
}
