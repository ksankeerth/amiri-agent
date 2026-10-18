import { createPortal } from "react-dom";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";
import { PageHeader } from "./blocks";

/** Set by a page that has the setup agent beside it: PageHead puts the show/hide button with the page's buttons. */
export const ChatToggleCtx = createContext<{ open: boolean; toggle: () => void } | null>(null);

/** The older page head, drawn as the new PageHeader (components/blocks.tsx): a short `sub` is the status line; a long one
 *  is an explanation, so it moves behind the "How this works" link instead of sitting under the title. */
export function PageHead({ title, sub, actions, crumbs }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumbs?: ReactNode }) {
  const long = typeof sub === "string" && sub.length > 90;
  return <PageHeader title={title} crumbs={crumbs} actions={actions} status={long ? undefined : sub}
    help={long ? <p className="ph-about">{sub}</p> : undefined} />;
}

export function Banner({ kind, icon = "info", children, action }: { kind: "info" | "warn" | "crit"; icon?: string; children: ReactNode; action?: ReactNode }) {
  return <div className={`banner ${kind}`}><Icon name={icon} /><div>{children}</div>{action && <div className="act">{action}</div>}</div>;
}

/** A button that opens a short list of actions; closes on Escape, a click outside, or a choice. */
export function MenuButton({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menu" ref={box}>
      <button className="btn" type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}>{label}<span aria-hidden="true" className="caret">▾</span></button>
      {open && <div className="menu-pop" role="group" aria-label={label} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

/** The two demo institutions, both invented: the reset and the empty first screen load them (app/demo.py on the server). */
export const DEMOS = [
  { kind: "bank", label: "Demo bank", name: "Serendib Commercial Bank", what: "A bank in Sri Lanka" },
  { kind: "insurer", label: "Demo insurer", name: "Samudra Raya General Insurance", what: "A general insurer in Indonesia" },
] as const;

/** The prototype reset: wipes the institution and everything Amiri Agent made for it; keeps market prices and reference data. */
export function ResetModal({ onClose }: { onClose: () => void }) {
  const [then, setThen] = useState<"demo-bank" | "demo-insurer" | "empty">("demo-bank");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/v1/prototype:reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "RESET", then }) });
      if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(p.detail ?? `HTTP ${r.status}`); }
      try { localStorage.removeItem("amiri.institution"); } catch { /* private mode */ }
      window.location.assign("/home");  // a fresh start: every page loads again
    } catch (e) { setErr(String((e as Error).message ?? e)); setBusy(false); }
  };
  return (
    <Modal title="Reset the prototype" onClose={onClose} footer={<>
      <button className="btn" type="button" onClick={onClose}>Cancel</button>
      <button className="btn btn--danger" type="button" disabled={busy || typed.trim().toUpperCase() !== "RESET"} onClick={go}>{busy ? "Resetting…" : "Reset"}</button></>}>
      <p style={{ margin: 0 }}>Starts the prototype again. <b>Removed:</b> the institution profile, monitors, findings, events, alerts, Radar stories, scenarios, the setup chat, and the data connection with its checks, approval and validation switch (the sample institutions go back to off). <b>Kept:</b> market series and their prices, and the reference data.</p>
      <div className="col" role="radiogroup" aria-label="Then" style={{ gap: 8 }}>
        {([...DEMOS.map(d => [`demo-${d.kind}`, `${d.label}: ${d.name}`, `${d.what}, ready to use. Monitors, events and scenarios start empty.`] as const),
           ["empty", "Start empty", "The welcome page: set up an institution from scratch with the setup agent or the forms."] as const]).map(([k, t, d]) => (
          <label key={k} className={`choice ${then === k ? "sel" : ""}`}><input type="radio" name="then" checked={then === k} onChange={() => setThen(k)} />
            <span className="col" style={{ gap: 2 }}><b>{t}</b><span className="small muted">{d}</span></span></label>))}
      </div>
      <label className="field"><span>Type RESET to confirm</span><input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" /></label>
      {err && <div className="errtext">{err}</div>}
    </Modal>
  );
}

/** Placeholders shaped like what is loading, so the page doesn't jump and nothing says "Loading…". */
export function Skel({ w = "100%", h = 14, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="skel" style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card" role="status" aria-busy="true"><span className="sr">Loading</span>
      <div className="bd col" style={{ gap: 16 }}>{Array.from({ length: rows }, (_, i) => (
        <div key={i} className="col" style={{ gap: 8 }}><Skel w={`${55 + ((i * 17) % 30)}%`} h={16} /><Skel w="90%" /><Skel w="70%" /></div>))}</div>
    </div>
  );
}
export function InlineSkeleton() {
  return <div className="bd col" role="status" aria-busy="true" style={{ gap: 10 }}><span className="sr">Loading</span><Skel w="55%" h={16} /><Skel /><Skel w="80%" /></div>;
}
export function PageSkeleton({ bare }: { bare?: boolean }) {
  return (
    <div className={bare ? undefined : "page"} role="status" aria-busy="true"><span className="sr">Loading</span>
      <div className="col" style={{ gap: 10, marginBottom: 20 }}><Skel w={110} h={12} /><Skel w={280} h={28} r={8} /><Skel w="48%" /></div>
      <div className="skel-strip">{[0, 1, 2, 3].map(i => <div key={i} className="card"><div className="bd col" style={{ gap: 10 }}><Skel w={48} h={28} r={8} /><Skel w="70%" /><Skel w="50%" h={10} /></div></div>)}</div>
      <div className="mt16"><ListSkeleton rows={3} /></div>
    </div>
  );
}

/** The "how this works / prototype limits" text: one line until someone wants it, instead of a banner on every page. */
export function Limits({ summary, children, status }: { summary: ReactNode; children: ReactNode; status?: ReactNode }) {
  return (
    <div className="limits">
      {status && <div className="small">{status}</div>}
      <details><summary><Icon name="info" className="ico16" />{summary}</summary><div className="small">{children}</div></details>
    </div>
  );
}

export function Empty({ icon, title, children, actions }: { icon: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="empty"><Icon name={icon} /><h2>{title}</h2>{children && <p>{children}</p>}{actions && <div className="row">{actions}</div>}</div>;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, onClose, children, footer, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // forms pass a new onClose on every render: keep the latest in a ref, so the effect below runs once, when the
  // dialog opens (re-running it on each keystroke moved the focus back to the first field)
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    // the first field, not the "fill from a file" control that sits above it
    const first = [...(box.current?.querySelectorAll<HTMLElement>(".mb " + FOCUSABLE.split(", ").join(", .mb ")) ?? [])].find(x => !x.closest(".fillfile")) ?? box.current;
    first?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(x => x.offsetParent !== null);
      if (!items.length) return;
      const a = items[0], z = items[items.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", k);
    document.body.classList.add("modal-open");  // the page behind doesn't scroll
    return () => { window.removeEventListener("keydown", k); document.body.classList.remove("modal-open"); opener?.focus?.({ preventScroll: true }); };
  }, []);
  // into <body>: a page wrapper with a transform or filter would otherwise trap the "fixed" backdrop inside it
  // (the dialog then sat in the page column, only partly dimmed, sometimes off screen)
  return createPortal(
    <div className="modalback" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={box} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={wide ? { width: "min(860px,100%)" } : undefined}>
        <div className="mh"><h2 id={titleId}>{title}</h2><span className="spacer" />
          <button className="btn btn--ghost btn--icon" type="button" aria-label="Close" onClick={onClose}><Icon name="x" /></button></div>
        <div className="mb">{children}</div>
        {footer && <div className="mf">{footer}</div>}
      </div>
    </div>, document.body
  );
}

// ---------------------------------------------------------------- toasts
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; msg: string }[]>([]);
  const push = useCallback((msg: string) => {
    const id = Date.now() + Math.random();
    setItems(x => [...x, { id, msg }]);
    setTimeout(() => setItems(x => x.filter(t => t.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">{items.map(t => <div className="toast" key={t.id}>{t.msg}</div>)}</div>
    </ToastCtx.Provider>
  );
}

/** A number that counts to its new value (ease-out), so a change is seen; instant when motion is reduced. */
export function useCountUp(value: number, ms = 700): number {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || value === from.current) { setShown(value); from.current = value; return; }
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(a + (value - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return shown;
}

export function CountUp({ value }: { value: number }) {
  return <>{useCountUp(value)}</>;
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
