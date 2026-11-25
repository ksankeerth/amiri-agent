import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../api/client";
import { LOCK_TOAST } from "./demoLock";
import { refusalOf } from "./v2/states";
import { ToastHost, type ToastAction, type ToastData } from "./v2/Toasts";

/** Set by a page that has the setup agent beside it: PageHead puts the show/hide button with the page's buttons. */
export const ChatToggleCtx = createContext<{ open: boolean; toggle: () => void } | null>(null);

/** The server didn't answer (no connection, or a 5xx): not the user's fault, and not "no profile yet". */
export const isDown = (e: unknown) => e instanceof ApiError && (e.code === "network" || e.status >= 500);
export const errText = (e: unknown) => (e instanceof ApiError ? e.full : String(e));

/** The two demo institutions, both invented: the reset and the empty first screen load them (app/demo.py on the server). */
export const DEMOS = [
  { kind: "bank", label: "Demo bank", name: "Serendib Commercial Bank", what: "A bank in Sri Lanka" },
  { kind: "insurer", label: "Demo insurer", name: "Samudra Raya General Insurance", what: "A general insurer in Indonesia" },
] as const;

// ---------------------------------------------------------------- toasts
// One list, drawn by v2/Toasts.tsx. `useToast()` is the short note every page already uses (a string: role=status).
// `useRefusalToast()` is for when the server said no: it shows the problem's detail and, small, its code (role=alert).
// Neither closes while hovered or focused, and each has a close button (A10).
const ToastCtx = createContext<(msg: string, action?: ToastAction) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
type RefusalPush = (error: unknown, title?: string) => void;
const RefusalCtx = createContext<RefusalPush>(() => {});
/** Show a refusal from a failed call: `catch (e) { refuse(e) }`. A title (one bold line above the detail) is optional. */
export const useRefusalToast = () => useContext(RefusalCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastData[]>([]);
  const add = useCallback((t: Omit<ToastData, "id">) => {
    const id = Date.now() + Math.random();
    setItems(x => (x.some(o => o.message === t.message && o.code === t.code) ? x : [...x, { ...t, id }]));  // the same words twice at once: once
  }, []);
  const push = useCallback((message: string, action?: ToastAction) => add({ kind: "info", message, action }), [add]);
  const refuse = useCallback<RefusalPush>((error, title) => {
    const r = refusalOf(error);
    add({ kind: "refusal", message: r?.message ?? "Something went wrong.", code: r?.code, title });
  }, [add]);
  const close = useCallback((id: number) => setItems(x => x.filter(t => t.id !== id)), []);
  useEffect(() => {  // a page that didn't know the demo is locked met the server's 403
    const f = () => push(LOCK_TOAST);
    window.addEventListener("amiri:demo-locked", f);
    return () => window.removeEventListener("amiri:demo-locked", f);
  }, [push]);
  return (
    <ToastCtx.Provider value={push}>
      <RefusalCtx.Provider value={refuse}>
        {children}
        <ToastHost items={items} onClose={close} />
      </RefusalCtx.Provider>
    </ToastCtx.Provider>
  );
}

/** Re-renders every `ms` (countdowns, "x min ago"). */
export function useNow(ms = 1000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// ---------------------------------------------------------------- roles (applied in the UI only)
export type Role = "risk_manager" | "platform_admin";
const RoleCtx = createContext<{ role: Role; setRole: (r: Role) => void }>({ role: "risk_manager", setRole: () => {} });
export const useRole = () => useContext(RoleCtx);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(() => {
    try { return (localStorage.getItem("amiri.role") as Role) || "risk_manager"; } catch { return "risk_manager"; }
  });
  const setRole = (r: Role) => { setRoleState(r); try { localStorage.setItem("amiri.role", r); } catch { /* private mode */ } };
  return <RoleCtx.Provider value={{ role, setRole }}>{children}</RoleCtx.Provider>;
}
