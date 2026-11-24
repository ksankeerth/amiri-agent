// Platform Admin: where Amiri Agent reads the institution's own numbers. Import them as one JSON file (or download an
// example file first), Check it, read the report, Approve it, and switch validation on. The demo lock greys out
// Import, Replace and Approve; Download and Check stay.
import { Fragment, useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { connectApi, type CheckState, type CheckStatus, type Connection, type Report } from "../../api/connect";
import { Fold, PageTitle, QuietWarn, Section, TextButton, ToneWord, type ToneKey } from "../../components/rd";
import { LockBtn, LockNote, useDemoLock } from "../../components/lock";
import { errText, ListSkeleton, LoadError, useToast } from "../../components/ui";
import { ago, dayTime, person, plural } from "../../format";
import { coverWords, dateWords, fileProblem, rangeWords, sizeWords, uploadWords, type UploadProblem } from "./importWords";
import "../../styles/rd-admin.css";

/** A check's overall result as a tone and a word. */
const STATUS_TONE: Record<CheckStatus, [ToneKey, string]> = { ready: ["good", "Ready"], ready_with_gaps: ["mixed", "Ready with gaps"], not_ready: ["bad", "Not ready"] };
const STATE_TONE: Record<CheckState, [ToneKey, string]> = { pass: ["good", "Passed"], fail: ["bad", "Failed"], not_applicable: ["neutral", "Not applicable"], not_run: ["neutral", "Not run"] };
const STEP_TONE: Record<string, [ToneKey, string]> = { pass: ["good", "Passed"], warn: ["mixed", "Warning"], fail: ["bad", "Failed"] };
const SPEC = "1.0.0";

/** A real switch with its state said in a word beside it. */
function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <LockBtn className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
    onClick={() => onChange(!on)} />;
}

export function DataConnectionsPage() {
  const toast = useToast();
  const [conn, setConn] = useState<Connection | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof connectApi.checks>>>([]);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, h] = await Promise.all([connectApi.get(), connectApi.checks()]);
      setConn(c); setHistory(h);
      if (c.latest_check && (!report || report.check_id !== c.latest_check.check_id)) setReport(await connectApi.report(c.latest_check.check_id));
      if (!c.latest_check) setReport(null);
      setError(null);
    } catch (e) { setError(e); }
  }, [report]);
  useEffect(() => { load(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  const run = async () => {
    setChecking(true);
    try { const r = await connectApi.check(); setReport(r); toast(`Checked: ${r.headline}`); await load(); }
    catch (e) { toast(errText(e)); }
    finally { setChecking(false); }
  };
  const approve = async () => {
    try { setConn(await connectApi.approve()); toast("Approved: validation can now be switched on."); }
    catch (e) { toast(errText(e)); }
  };
  const validation = async (v: boolean) => {
    try { setConn(await connectApi.validation(v)); toast(v ? "Validation is on: new tasks are checked against the data." : "Validation is off."); }
    catch (e) { toast(errText(e)); }
  };

  if (error != null && !conn) return <div className="page rd rd-admin"><PageTitle title="Data connections" /><LoadError error={error} onRetry={load} what="the institution's data" /></div>;
  if (!conn) return <div className="page rd rd-admin"><PageTitle title="Data connections" /><ListSkeleton rows={4} /></div>;
  const latest = conn.latest_check;
  const state = !conn.configured ? "No data yet" : conn.approved ? "Imported and approved" : latest?.current ? `Checked: ${STATUS_TONE[latest.status][1].toLowerCase()}, not approved yet` : "Imported, not checked yet";
  return (
    <div className="page rd rd-admin rd-dc">
      <PageTitle title="Data connections"
        status={<><span>{state}</span><span>Metrics Spec {SPEC}</span></>}
        lede="Amiri Agent checks each possible impact against your institution's own figures. Import them as one JSON file in the Metrics Spec's shape, run the check, then approve them and switch checks on." />
      <LockNote />
      <DataSection conn={conn} checking={checking} onImported={c => { setConn(c); load(); }}
        onCheck={run} onApprove={approve} onValidation={validation} />
      {report ? <ReportSection report={report} history={history} current={!!conn.latest_check?.current && conn.latest_check.check_id === report.check_id}
        onPick={async id => { try { setReport(await connectApi.report(id)); } catch (e) { toast(errText(e)); } }} />
        : conn.configured && <Section title="The check"><p className="rd-row-d rd-prose">Not checked yet. Press <b>Check</b> to see whether the data can be read as the Metrics Spec's reference API and what your profile is missing.</p></Section>}
    </div>
  );
}

/** "File  institution-data.json": a label and its value, one per line. */
const Row = ({ k, children }: { k: string; children: ReactNode }) => <><dt>{k}</dt><dd>{children}</dd></>;

/** An upload's refusal, said in words with ◆: the first few problems, and how many more. */
function UploadError({ problem }: { problem: UploadProblem }) {
  return (
    <div className="dc-err" role="alert">
      <p className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> <b>{problem.headline}</b></p>
      {problem.items.length > 0 && <ul className="ad-list dc-err-list">{problem.items.map((x, i) => <li key={i} className="ad-mono">{x}</li>)}
        {problem.more > 0 && <li>and {plural(problem.more, "more problem")}</li>}</ul>}
    </div>
  );
}

function DataSection({ conn, checking, onImported, onCheck, onApprove, onValidation }: {
  conn: Connection; checking: boolean; onImported: (c: Connection) => void; onCheck: () => void;
  onApprove: () => void; onValidation: (v: boolean) => void;
}) {
  const toast = useToast();
  const locked = useDemoLock();
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);  // the file being sent
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [over, setOver] = useState(false);
  const latest = conn.latest_check;
  const imp = conn.imported;

  const send = async (file: File) => {
    const why = fileProblem(file, conn.max_import_mb);
    if (why) { setProblem({ headline: "Nothing was imported.", items: [why], more: 0 }); return; }
    setBusy(file.name); setProblem(null);
    try {
      const c = await connectApi.importFile(file, file.name);
      onImported(c); toast(`Imported ${file.name}: check it next.`);
    } catch (e) {
      setProblem(uploadWords(e instanceof ApiError ? e.problem : { detail: errText(e) }));
    } finally {
      setBusy(null);
      if (picker.current) picker.current.value = "";
    }
  };
  const pick = () => { if (!locked && !busy) picker.current?.click(); };
  const drop = (e: DragEvent) => {
    e.preventDefault(); setOver(false);
    if (locked || busy) return;
    const f = e.dataTransfer.files?.[0];
    if (f) send(f);
  };
  const canApprove = !!latest?.current && latest.status !== "not_ready" && !conn.approved;
  const validationWhy = !conn.validation_allowed ? "Validation is switched off on this server (METRICS_VALIDATION)."
    : !conn.approved ? "Approve checked data first." : null;
  const example = <a className="rd-go" href={connectApi.exampleUrl} download>Download an example file</a>;
  const input = <input ref={picker} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) send(f); }} />;
  return (
    <Section title="Your institution's data"
      action={imp ? <LockBtn className="rd-tbtn" onClick={pick} disabled={!!busy}>Replace with another file</LockBtn> : undefined}>
      {input}
      {!imp && <>
        <p className="rd-row-d rd-prose dc-intro">Your figures come from one JSON file in the Metrics Spec's shape; the example file shows how.</p>
        <div className={`dc-drop${over ? " is-over" : ""}${locked ? " is-locked-drop" : ""}`}
          onDragOver={e => { e.preventDefault(); if (!locked) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
          <LockBtn className="btn btn--primary" onClick={pick} disabled={!!busy}>{busy ? "Importing…" : "Import a JSON file"}</LockBtn>
          <span className="rd-fine">{busy ? `Sending ${busy} and checking every row…` : `or drop it here · up to ${conn.max_import_mb} MB`}</span>
          <span className="dc-spacer" />
          {example}
        </div>
      </>}
      {problem && <UploadError problem={problem} />}
      {imp && <>
        <dl className="ad-kv">
          <Row k="File"><b className="ad-mono">{imp.file_name ?? "(no name)"}</b> <span className="rd-fine">· {sizeWords(imp.bytes)}</span></Row>
          <Row k="Imported">{dayTime(imp.at)} by {person(imp.by)} <span className="rd-fine">· {ago(imp.at)}</span></Row>
          <Row k="Covers">{coverWords(imp.summary)}{rangeWords(imp.summary) && <> · {rangeWords(imp.summary)}</>}
            <span className="rd-fine"> · as of {dateWords(imp.as_of)}</span></Row>
          {imp.about && <Row k="About"><span className="rd-fine dc-about">{imp.about}</span></Row>}
          <Row k="State">{conn.approved ? <>Approved by {person(conn.approved.by)} {ago(conn.approved.at)}.</> : latest?.current
            ? <>Checked {ago(latest.started_at)}: <b>{STATUS_TONE[latest.status][1].toLowerCase()}</b>. Not approved yet.</>
            : <>Not checked yet.</>}</Row>
          <Row k="Validation">
            <span className="ad-switch"><Switch on={conn.validation_enabled} label="Validation against the institution's data" disabled={!!validationWhy && !conn.validation_enabled} onChange={onValidation} />
              <b>{conn.validation_enabled ? "On" : "Off"}</b></span>
            {validationWhy && !conn.validation_enabled ? <span className="rd-fine"> · {validationWhy}</span> : <span className="rd-fine"> · new tasks are checked against the institution's data</span>}</Row>
        </dl>
        <div className="ad-acts">
          <button className="btn btn--primary" type="button" onClick={onCheck} disabled={checking || !!busy}>{checking ? "Checking…" : "Check"}</button>
          <LockBtn className="btn" onClick={onApprove} disabled={!canApprove}
            title={canApprove ? "Approve this data for validation" : conn.approved ? "Already approved" : "Check it first; data that isn't ready can't be approved"}>Approve</LockBtn>
          <span className="dc-spacer" />
          {example}
        </div>
        {busy && <p className="rd-fine ad-status">Sending {busy} and checking every row…</p>}
      </>}
      <div role="status" aria-live="polite" className="rd-fine ad-status">{checking ? "Checking the data: about 70 reads, a few seconds…" : ""}</div>
    </Section>
  );
}

// the spec's capability levels (section 3) by name
const LEVEL: Record<string, string> = { L1: "Values", L2: "Checkable values", L3: "Timed and deep", L4: "Vintages", L5: "Change concentration" };

function ReportSection({ report, history, current, onPick }: { report: Report; history: Awaited<ReturnType<typeof connectApi.checks>>; current: boolean; onPick: (id: string) => void }) {
  const [tone, label] = STATUS_TONE[report.status];
  const [open, setOpen] = useState<string | null>(null);
  const failed = report.checks.filter(c => c.status === "fail");
  const others = report.checks.filter(c => c.status !== "fail");
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${report.check_id}.json`; a.click(); URL.revokeObjectURL(url);
  };
  const row = (c: Report["checks"][number]) => { const [t, l] = STATE_TONE[c.status]; const isOpen = open === c.id; return (
    <tr key={c.id}><td className="rd-strong">{c.title} <Link className="ad-mono rd-fine" to={`/spec#check-${c.id}`} title="This check in the Metrics Spec">{c.id}</Link></td>
      <td>{LEVEL[c.level] ?? c.level} <span className="rd-fine">{c.level}</span></td>
      <td><ToneWord tone={t}>{l}</ToneWord></td>
      <td>{c.status === "fail" ? <>
        {c.findings[0]}{(c.findings.length > 1 || c.more > 0) && <> <TextButton aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>{isOpen ? "Less" : `${c.findings.length - 1 + c.more} more`}</TextButton></>}
        {isOpen && <ul className="ad-list">{c.findings.slice(1).map((x, i) => <li key={i}>{x}</li>)}{c.more > 0 && <li>and {c.more} more</li>}</ul>}
        <div className="rd-fine"><b className="ins-k">Fix:</b> {c.fix}</div></> : c.note ?? ""}</td></tr>); };
  return (
    <Section title="The check" meta={<ToneWord tone={tone}>{label}</ToneWord>}
      action={<>{history.length > 1 && <label className="ad-pick"><span>Check</span>
        <select className="input" value={report.check_id} onChange={e => onPick(e.target.value)}>
          {history.map(h => <option key={h.check_id} value={h.check_id}>{dayTime(h.started_at)} · {STATUS_TONE[h.status][1].toLowerCase()}</option>)}</select></label>}
        <TextButton onClick={download}>Download JSON</TextButton></>}>
      {!current && <p className="rd-fine ad-old">This is an older check: the data changed after it.</p>}
      {report.withdrawn && <QuietWarn>{report.withdrawn}</QuietWarn>}
      <p className="ad-head"><b>{report.headline}</b></p>
      <p className="rd-fine ad-sub">{report.target} · {dayTime(report.started_at)} by {person(report.run_by)} · {plural(report.summary.calls, "call")} in {report.summary.seconds} s · checked against Metrics Spec {report.spec_version}{report.server_version ? `, the API says ${report.server_version}` : ""}</p>
      <ol className="ad-steps" aria-label="Steps">
        {report.steps.map((s, i) => { const [t, w] = STEP_TONE[s.status]; return (
          <li key={i} className="rd-row">
            <div className="rd-row-t">{s.title}</div>
            <p className="rd-row-m"><ToneWord tone={t}>{w}</ToneWord>{s.detail && ` · ${s.detail}`}</p>
            {s.items.length > 0 && <ul className="ad-list">{s.items.slice(0, 12).map((x, j) => <li key={j}>{x}</li>)}</ul>}
            {s.fix && <p className="rd-row-m"><b className="ins-k">Fix:</b> {s.fix}</p>}
          </li>); })}
      </ol>
      {report.missing_for_profile.length > 0 && <><h3 className="ad-h3">What's missing for your profile</h3>
        <ul className="ad-list">{report.missing_for_profile.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
      {report.formats.length > 0 && <Fold title="Answers that don't match the spec's formats" summary={plural(report.formats.length, "answer")} remember="dc-formats">
        {report.formats.slice(0, 10).map((f, i) => <div key={i} className="ad-fmt"><span className="ad-mono">{f.where}</span>
          <ul className="ad-list">{f.errors.map((e, j) => <li key={j} className="ad-mono">{e}</li>)}{f.more > 0 && <li>and {f.more} more</li>}</ul></div>)}
        {report.formats.length > 10 && <p className="rd-fine">and {report.formats.length - 10} more answers</p>}</Fold>}
      <h3 className="ad-h3">Conformance checks <span className="rd-sec-m">{report.summary.passed} of {report.summary.passed + report.summary.failed} passed</span></h3>
      {failed.length > 0 && <div className="ad-tbl" tabIndex={0} role="region" aria-label="Failed checks (scrolls sideways)"><table className="rd-table">
        <thead><tr><th scope="col">Check</th><th scope="col">Level</th><th scope="col">Result</th><th scope="col">What was found</th></tr></thead>
        <tbody>{failed.map(row)}</tbody></table></div>}
      {others.length > 0 && <Fold title={failed.length ? `${others.length} other checks` : `All ${others.length} checks`} summary="passed, or not applicable to this API" remember="dc-others">
        <div className="ad-tbl" tabIndex={0} role="region" aria-label="Other checks (scrolls sideways)"><table className="rd-table">
          <thead><tr><th scope="col">Check</th><th scope="col">Level</th><th scope="col">Result</th><th scope="col">What was found</th></tr></thead>
          <tbody>{others.map(row)}</tbody></table></div></Fold>}
      {report.coverage && report.coverage.products.length > 0 && <><h3 className="ad-h3">Coverage for your profile</h3>
        <div className="ad-tbl" tabIndex={0} role="region" aria-label="Coverage (scrolls sideways)"><table className="rd-table">
          <thead><tr><th scope="col">Product</th><th scope="col">In the catalog as</th><th scope="col">Required metrics</th><th scope="col">Missing or reduced</th></tr></thead>
          <tbody>{report.coverage.products.map(p => <tr key={p.profile_product_id}>
            <td className="rd-strong">{p.name} <ToneWord tone={p.status === "full" ? "good" : p.status === "partial" ? "mixed" : "bad"}>{p.status === "full" ? "Full" : p.status === "partial" ? "Partial" : "None"}</ToneWord></td>
            <td className="ad-mono">{p.catalog_product_id ?? "—"}</td><td>{p.required.length - p.missing.length} of {p.required.length}</td>
            <td>{p.missing.length || p.reduced.length ? [...p.missing.map(m => [m, "missing"]), ...p.reduced.map(r => [r.key, `served ${r.grain_served} (spec: ${r.grain_spec})`])]
              .map(([k, what], i) => <Fragment key={k}>{i ? "; " : ""}<Link className="rd-name ad-mono" to={`/spec#metric-${k}`}>{k}</Link> {what}</Fragment>) : "—"}</td></tr>)}</tbody></table></div>
        {report.coverage.unmapped_catalog_products.length > 0 && <p className="rd-fine">In the catalog but not in your profile: {report.coverage.unmapped_catalog_products.map(p => p.name || p.product_id).join(", ")}.</p>}</>}
      <Fold title="The calls" summary={`${report.calls.length}`} remember="dc-calls">
        <div className="ad-tbl ad-calls" tabIndex={0} role="region" aria-label="The calls (scrolls)"><table className="rd-table">
          <thead><tr><th scope="col">Call</th><th scope="col">Status</th><th scope="col" className="rd-num">Time</th></tr></thead>
          <tbody>{report.calls.map((c, i) => <tr key={i}><td className="ad-mono">{c.method} {c.path}{Object.keys(c.query).length ? "?" + new URLSearchParams(Object.entries(c.query).map(([k, v]) => [k, String(v)])).toString() : ""}</td>
            <td>{c.status ?? c.error}</td><td className="rd-num">{c.ms} ms</td></tr>)}</tbody></table></div></Fold>
    </Section>
  );
}
