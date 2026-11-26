// "Start again from a JSON file": the only way to reset the prototype. A Platform Admin chooses an institution profile
// ({ institution, sections }, the file the Institution page exports and Settings downloads); it is read and checked here, what it will
// load is shown, RESET is typed, and only then does the server wipe and load it. The server checks the file first and wipes nothing if it
// fails (a 422): its sentence shows in the box. Used by Settings and by the Institution page's ⋯ menu.
import { useId, useRef, useState } from "react";
import { api } from "../../api/client";
import { useDemoLock } from "../../components/lock";
import { useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { Field, Input } from "../../components/v2/Field";
import { FileDrop } from "../../components/v2/FilePicker";
import { placeName } from "../../format";
import { confirmed } from "./settingsWords";
import { readResetFile, resetFailure, type ResetProfile, type ResetSummary } from "./resetFile";
import "../../styles/v2/admin.css";

export const RESET_WARNING = "Everything AMIRI Agent holds for the current institution goes: events, alerts, monitors, findings, scenarios, imported data. Market series and reference data stay.";

export function ResetFromJson({ onClose }: { onClose: () => void }) {
  const locked = useDemoLock();
  const toast = useToast();
  const [file, setFile] = useState<{ name: string; profile: ResetProfile; summary: ResetSummary } | null>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const done = useRef(false);
  const id = useId();

  const choose = async (f: File) => {
    setErr(null); setFileErr(null);
    let text = "";
    try { text = await f.text(); } catch { setFile(null); setFileErr(`${f.name} couldn't be read.`); return; }
    const r = readResetFile(text);
    if (r.ok) setFile({ name: f.name, profile: r.profile, summary: r.summary });
    else { setFile(null); setFileErr(`${f.name}: ${r.error}`); }
  };
  const go = async () => {
    if (!file || busy || done.current) return;
    setBusy(true); setErr(null);
    try {
      await api("/api/v1/prototype:reset", { method: "POST", json: { confirm: "RESET", profile: file.profile } });
      done.current = true;
      try { localStorage.removeItem("amiri.institution"); } catch { /* private mode */ }
      toast(`Started again as ${file.summary.name}.`);
      setTimeout(() => window.location.assign("/home"), 900);  // a fresh start: every page loads again
    } catch (e) { setErr(resetFailure(e)); setBusy(false); }
  };
  const s = file?.summary;
  return (
    <Dialog size="M" tone="danger" title="Start again from a JSON file" onClose={onClose} actions={<>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy || !file || !confirmed(typed)} busy={busy} busyLabel="Resetting…" onClick={go}>Reset and load this file</Button></>}>
      <p className="v2-rj-warn" id={`${id}-warn`}><span aria-hidden="true">◆</span> {RESET_WARNING}</p>
      <FileDrop variant="zone" accept=".json,application/json" noun="a JSON file" maxBytes={2 * 1024 * 1024} locked={locked} disabled={busy}
        label={file ? "Choose a different file" : "Drop an institution JSON file here"}
        hint="An institution profile: { institution, sections }. Settings and the Institution page can download one."
        pickLabel={file ? "Choose another file" : "Choose a file"} onFile={choose} onReject={m => { setFile(null); setFileErr(m); }}
        aria-describedby={fileErr ? `${id}-file-err` : undefined} />
      <p id={`${id}-file-err`} className="v2-st-err" role="alert" hidden={!fileErr}><span aria-hidden="true">◆</span> {fileErr}</p>
      {file && s && (
        <section className="v2-rj-sum" aria-label={`What ${file.name} will load`}>
          <h3 className="v2-rj-sum__h">This file will load</h3>
          <dl>
            <div><dt>Name</dt><dd>{s.name}</dd></div>
            <div><dt>Type</dt><dd>{s.kind}</dd></div>
            <div><dt>Home country</dt><dd>{placeName(s.home)} <span className="v2-rj-code">{s.home}</span></dd></div>
            <div><dt>Currency</dt><dd>{s.currency}</dd></div>
            <div><dt>Sections</dt><dd>{s.counts.length ? <ul>{s.counts.map(c => <li key={c.section}>{c.words}</li>)}</ul> : "No items: the institution starts with its home country only."}</dd></div>
          </dl>
        </section>)}
      <Field label="Type RESET to confirm">
        <Input value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
          aria-describedby={`${id}-warn${err ? ` ${id}-err` : ""}`} />
      </Field>
      <p id={`${id}-err`} className="v2-st-err" role="alert" hidden={!err}><span aria-hidden="true">◆</span> {err}</p>
    </Dialog>
  );
}
