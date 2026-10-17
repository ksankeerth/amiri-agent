// Platform Admin: Settings. For now, starting the prototype again (the reset), so it can be tried as a new institution.
import { useEffect, useState } from "react";
import type { Installation } from "../../App";
import { api } from "../../api/client";
import { Icon } from "../../components/Icon";
import { Banner, PageHead, ResetModal } from "../../components/ui";

export function SettingsPage() {
  const [inst, setInst] = useState<Installation | null>(null);
  useEffect(() => { api<Installation>("/api/v1/installation").then(setInst).catch(() => setInst(null)); }, []);
  const [resetting, setResetting] = useState(false);
  const allowed = inst ? inst.prototype_reset !== false : null;  // null: still loading
  return (
    <div className="page">
      <PageHead title="Settings" sub="What a Platform Admin controls for this installation." />
      <div className="card">
        <div className="hd"><h2>Start again</h2></div>
        <div className="bd col gap12">
          <p style={{ margin: 0 }}>Reset the prototype to try it as a new institution: everything Amiri Agent holds for the institution goes,
            including its data connection and validation settings. Market series, their prices and the reference data stay.</p>
          {allowed === null ? null : allowed
            ? <div><button className="btn btn--danger" type="button" onClick={() => setResetting(true)}><Icon name="refresh" />Reset the prototype…</button></div>
            : <Banner kind="info" icon="info">The reset is switched off on this server. To allow it, set <code>prototype_reset = true</code> in Terraform and deploy (locally: <code>PROTOTYPE_RESET=true</code>).</Banner>}
        </div>
      </div>
      {resetting && <ResetModal onClose={() => setResetting(false)} />}
    </div>
  );
}
