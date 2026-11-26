// Platform Admin: Settings (decision D5: no board; the layout follows board 11's forms). What a Platform Admin controls for
// this installation: whether the demo lock is on, and starting the prototype again, which is only possible by loading a new institution
// JSON file (ResetFromJson.tsx); the current profile can be downloaded in the same shape. The demo lock greys out the reset (it stays visible
// and focusable) but not the download, which only reads; the server answers 403 demo_locked too.
import { useCallback, useEffect, useState } from "react";
import type { Installation } from "../../App";
import { api } from "../../api/client";
import { useDemoLock } from "../../components/lock";
import { inst as institutions } from "../../api/institutions";
import { useRefusalToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { LoadError } from "../../components/v2/LoadError";
import { Pill } from "../../components/v2/Pill";
import { useCrumbs } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { downloadJson, pickCreate } from "../institution/profileFile";
import { profileFile } from "./resetFile";
import { ResetFromJson } from "./ResetFromJson";
import { demoMode, institutionLine, resetState } from "./settingsWords";
import "../../styles/v2/admin.css";

const CRUMBS = [{ label: "Platform admin" }, { label: "Settings" }];

export function SettingsPage() {
  useCrumbs(CRUMBS);
  const locked = useDemoLock();
  const [inst, setInst] = useState<Installation | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(() => api<Installation>("/api/v1/installation").then(x => { setInst(x); setErr(null); }).catch(setErr), []);
  useEffect(() => { load(); }, [load]);
  const [resetting, setResetting] = useState(false);
  const [saving, setSaving] = useState(false);
  const refuse = useRefusalToast();
  const download = async () => {
    if (!inst) return;
    setSaving(true);
    try {
      const p = await institutions.profile(inst.institution_id);
      downloadJson(`${p.institution.institution_id}-profile.json`, profileFile(p.institution, p.sections, pickCreate));
    } catch (e) { refuse(e, "Couldn't download the profile"); }
    finally { setSaving(false); }
  };
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
          <p className="v2-st-prose">The only way to start again is to load a new institution JSON file. Everything AMIRI Agent holds for the current
            institution goes first, including its imported data and validation settings; market series, their prices and the reference data stay.
            The file is checked before anything is removed. Download the current profile to get a file in the right shape.</p>
          {reset === "off" && <p className="v2-ad-old" role="note">The reset is switched off on this server. To allow it, set <code>prototype_reset = true</code> in Terraform and deploy (locally: <code>PROTOTYPE_RESET=true</code>).</p>}
          <div className="v2-st-btns">
            {reset !== "off" && <Button className="v2-st-reset" locked={locked} onClick={() => setResetting(true)}>Start again from a JSON file…</Button>}
            {inst.profile && <Button variant="secondary" busy={saving} busyLabel="Preparing the file…" onClick={download}>Download the current profile (.json)</Button>}
          </div>
        </section>
      </>}
      {resetting && <ResetFromJson onClose={() => setResetting(false)} />}
    </div>
  );
}
