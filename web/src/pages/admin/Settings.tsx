// Platform Admin: Settings. For now, starting the prototype again (the reset), so it can be tried as a new institution.
import { useEffect, useState } from "react";
import type { Installation } from "../../App";
import { api } from "../../api/client";
import { PageTitle, QuietWarn, Section } from "../../components/rd";
import { LockBtn, LockNote } from "../../components/lock";
import { LoadError, ResetModal } from "../../components/ui";
import "../../styles/rd-admin.css";

export function SettingsPage() {
  const [inst, setInst] = useState<Installation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = () => api<Installation>("/api/v1/installation").then(x => { setInst(x); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, []);
  const [resetting, setResetting] = useState(false);
  const allowed = inst ? inst.prototype_reset !== false : null;  // null: still loading
  return (
    <div className="page rd rd-admin">
      <PageTitle title="Settings" lede="What a Platform Admin controls for this installation." />
      <LockNote />
      {err != null && <LoadError error={err} onRetry={load} what="the settings" />}
      <Section title="Start again">
        <p className="rd-row-d rd-prose">Reset the prototype to try it as a new institution: everything Amiri Agent holds for the institution goes,
          including its imported data and validation settings. Market series, their prices and the reference data stay.</p>
        {allowed === null ? null : allowed
          ? <div className="ad-act"><LockBtn className="btn btn--danger" onClick={() => setResetting(true)}>Reset the prototype…</LockBtn></div>
          : <QuietWarn>The reset is switched off on this server. To allow it, set <code>prototype_reset = true</code> in Terraform and deploy (locally: <code>PROTOTYPE_RESET=true</code>).</QuietWarn>}
      </Section>
      {resetting && <ResetModal onClose={() => setResetting(false)} />}
    </div>
  );
}
