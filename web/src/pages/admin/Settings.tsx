// Platform Admin: Settings (decision D5: no board; the layout follows board 11's forms). What a Platform Admin controls for
// this installation: whether the demo lock is on, and starting the prototype again (the reset), so it can be tried as a new
// institution. The demo lock greys out the reset (it stays visible and focusable); the server answers 403 demo_locked too.
import { useCallback, useEffect, useId, useState } from "react";
import type { Installation } from "../../App";
import { api } from "../../api/client";
import { useDemoLock } from "../../components/lock";
import { DEMOS } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { LoadError } from "../../components/v2/LoadError";
import { Pill } from "../../components/v2/Pill";
import { useCrumbs } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { confirmed, demoMode, institutionLine, resetChoices, resetProblem, resetState, type ResetChoice } from "./settingsWords";
import "../../styles/v2/admin.css";

const CRUMBS = [{ label: "Platform admin" }, { label: "Settings" }];
const CHOICES = resetChoices(DEMOS);

/** The reset's confirm box: what goes, what stays, what to start again with, and RESET typed out loud. */
function ResetDialog({ onClose }: { onClose: () => void }) {
  const [then, setThen] = useState<ResetChoice["id"]>("demo-bank");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const group = useId(), field = useId(), name = useId();
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      await api("/api/v1/prototype:reset", { method: "POST", json: { confirm: "RESET", then } });
      try { localStorage.removeItem("amiri.institution"); } catch { /* private mode */ }
      window.location.assign("/home");  // a fresh start: every page loads again
    } catch (e) { setErr(resetProblem(e)); setBusy(false); }
  };
  return (
    <Dialog wide title="Reset the prototype" onClose={onClose} footer={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button className="v2-st-danger" disabled={busy || !confirmed(typed)} onClick={go}>{busy ? "Resetting…" : "Reset the prototype"}</Button></>}>
      <p>Starts the prototype again. <b>Removed:</b> the institution profile, monitors, findings, events, alerts, Radar stories, scenarios, the setup chat, and the institution's imported data with its checks, approval and validation switch. <b>Kept:</b> market series and their prices, and the reference data.</p>
      <div>
        <p id={group} className="v2-st-label">Then start with</p>
        <div role="radiogroup" aria-labelledby={group} className="v2-ad-cards">
          {CHOICES.map(c => (
            <label key={c.id} className={`v2-ad-card${then === c.id ? " is-on" : ""}`}>
              <input type="radio" name={name} value={c.id} checked={then === c.id} onChange={() => setThen(c.id)} />
              <span className="v2-ad-card__txt"><b className="v2-ad-card__t">{c.title}</b><span className="v2-ad-card__l">{c.line}</span></span>
            </label>))}
        </div>
      </div>
      <div className="v2-st-field">
        <label htmlFor={field} className="v2-st-label">Type RESET to confirm</label>
        <input id={field} className="v2-st-input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
          aria-describedby={err ? `${field}-err` : undefined} />
      </div>
      <p id={`${field}-err`} className="v2-st-err" role="alert" hidden={!err}><span aria-hidden="true">◆</span> {err}</p>
    </Dialog>
  );
}

export function SettingsPage() {
  useCrumbs(CRUMBS);
  const locked = useDemoLock();
  const [inst, setInst] = useState<Installation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => api<Installation>("/api/v1/installation").then(x => { setInst(x); setErr(null); }).catch(setErr), []);
  useEffect(() => { load(); }, [load]);
  const [resetting, setResetting] = useState(false);
  const reset = resetState(inst);
  const mode = inst ? demoMode(inst) : null;
  return (
    <div className="v2-ad v2-st">
      <header className="v2-ad-head">
        <h1 className="v2-ad-h1">Settings</h1>
        <p className="v2-ad-sub">What a Platform Admin controls for this installation.</p>
      </header>
      {err != null && !inst && <LoadError error={err} onRetry={load} what="the settings" />}
      {err == null && !inst && <Skeleton rows={4} label="Loading the settings" />}
      {inst && mode && <>
        <section aria-labelledby="st-this">
          <h2 id="st-this" className="v2-ad-h2">This installation</h2>
          <dl className="v2-st-rows">
            <div className="v2-st-row">
              <dt>Institution</dt>
              <dd><span className="v2-st-val">{institutionLine(inst)}</span>{inst.time_zone && <span className="v2-st-note">Time zone: {inst.time_zone}</span>}</dd>
            </div>
            <div className="v2-st-row">
              <dt>Demo mode</dt>
              <dd><span className="v2-st-val"><Pill tone={mode.on ? "brand" : "neutral"}>{mode.word}</Pill></span><span className="v2-st-note">{mode.line}</span></dd>
            </div>
          </dl>
        </section>
        <section aria-labelledby="st-again" className="v2-st-again">
          <h2 id="st-again" className="v2-ad-h2">Start again</h2>
          <p className="v2-st-prose">Reset the prototype to try it as a new institution: everything Amiri Agent holds for the institution goes,
            including its imported data and validation settings. Market series, their prices and the reference data stay.</p>
          {reset === "off"
            ? <p className="v2-ad-old" role="note">The reset is switched off on this server. To allow it, set <code>prototype_reset = true</code> in Terraform and deploy (locally: <code>PROTOTYPE_RESET=true</code>).</p>
            : <div><Button className="v2-st-reset" locked={locked} onClick={() => setResetting(true)}>Reset the prototype…</Button></div>}
        </section>
      </>}
      {resetting && <ResetDialog onClose={() => setResetting(false)} />}
    </div>
  );
}
