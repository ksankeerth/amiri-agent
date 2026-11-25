// The Institution page's confirmations: delete an institution that was never activated, and reset the prototype.
import { useState } from "react";
import { isDemoLocked, LOCK_TOAST } from "../../components/demoLock";
import { useDemoLock } from "../../components/lock";
import { DEMOS } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";

/** Reset the prototype: starts it again, on a demo or empty. Typing RESET keeps it from being done by accident. */
export function ResetDialog({ onClose }: { onClose: () => void }) {
  const locked = useDemoLock();
  const [then, setThen] = useState<"demo-bank" | "demo-insurer" | "empty">("demo-bank");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/v1/prototype:reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: "RESET", then }) });
      if (!r.ok) {
        const p = await r.json().catch(() => ({}));
        if (isDemoLocked(p)) window.dispatchEvent(new Event("amiri:demo-locked"));
        throw new Error(isDemoLocked(p) ? LOCK_TOAST : p.detail ?? `HTTP ${r.status}`);
      }
      try { localStorage.removeItem("amiri.institution"); } catch { /* private mode */ }
      window.location.assign("/home");  // a fresh start: every page loads again
    } catch (e) { setErr(String((e as Error).message ?? e)); setBusy(false); }
  };
  const options = [...DEMOS.map(d => [`demo-${d.kind}`, `${d.label}: ${d.name}`, `${d.what}, ready to use. Monitors, events and scenarios start empty.`] as const),
    ["empty", "Start empty", "The welcome page: set up an institution from scratch with the setup agent or the forms."] as const];
  return (
    <Dialog title="Reset the prototype" onClose={onClose} initialFocus="input[type=radio]:checked" footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button className="v2-btn--danger" locked={locked} disabled={busy || typed.trim().toUpperCase() !== "RESET"} onClick={go}>{busy ? "Resetting…" : "Reset"}</Button></>}>
      <p className="v2-in-dlgtext"><b>Removed:</b> the institution profile, monitors, findings, events, alerts, Radar stories, scenarios, the setup chat, and the institution's imported data with its checks, approval and validation switch. <b>Kept:</b> market series and their prices, and the reference data.</p>
      <fieldset className="v2-in-opts"><legend>Then</legend>
        {options.map(([k, t, d]) => (
          <label key={k} className={`v2-in-opt${then === k ? " is-on" : ""}`}>
            <input type="radio" name="then" checked={then === k} onChange={() => setThen(k as typeof then)} />
            <span><b>{t}</b><span className="v2-in-opt__d">{d}</span></span></label>))}
      </fieldset>
      <div className="v2-in-form"><label className="field"><span>Type RESET to confirm</span><input className="input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" aria-describedby={err ? "reset-err" : undefined} /></label></div>
      {err && <p id="reset-err" className="v2-in-err" role="alert"><span aria-hidden="true">◆ </span>{err}</p>}
    </Dialog>
  );
}

/** Delete an institution that was never activated. */
export function DeleteDialog({ name, onClose, onDelete }: { name: string; onClose: () => void; onDelete: () => void }) {
  const locked = useDemoLock();
  return (
    <Dialog title={`Delete ${name}?`} onClose={onClose} footer={<>
      <Button onClick={onClose}>Cancel</Button>
      <Button className="v2-btn--danger" locked={locked} onClick={onDelete}>Delete</Button></>}>
      <p className="v2-in-dlgtext">It was never activated, so it is deleted with its whole profile and history.</p>
    </Dialog>
  );
}
