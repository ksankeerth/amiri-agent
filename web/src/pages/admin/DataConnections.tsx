// Platform Admin: where Amiri Agent reads the institution's own numbers. Set the connection (an address,
// or a sample institution), Check it, read the report, Approve it, and switch validation on. The sample
// bank and insurer are switched on, and given conditions, here too.
import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { connectApi, type CheckState, type CheckStatus, type Condition, type Connection, type Report, type Sample } from "../../api/connect";
import { FillFromJson } from "../../components/FillFromJson";
import type { Candidate } from "../../components/fillJson";
import { Fold, PageTitle, QuietWarn, Section, TextButton, TextTabs, ToneWord, type ToneKey } from "../../components/rd";
import { errText, ListSkeleton, LoadError, useToast } from "../../components/ui";
import { ago, dayTime, person, plural } from "../../format";
import "../../styles/rd-admin.css";

/** A check's overall result as a tone and a word. */
const STATUS_TONE: Record<CheckStatus, [ToneKey, string]> = { ready: ["good", "Ready"], ready_with_gaps: ["mixed", "Ready with gaps"], not_ready: ["bad", "Not ready"] };
const STATE_TONE: Record<CheckState, [ToneKey, string]> = { pass: ["good", "Passed"], fail: ["bad", "Failed"], not_applicable: ["neutral", "Not applicable"], not_run: ["neutral", "Not run"] };
const STEP_TONE: Record<string, [ToneKey, string]> = { pass: ["good", "Passed"], warn: ["mixed", "Warning"], fail: ["bad", "Failed"] };
const SPEC = "1.0.0";

/** A real switch with its state said in a word beside it. */
function Switch({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (v: boolean) => void }) {
  return <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
    onClick={() => onChange(!on)} />;
}

export function DataConnectionsPage() {
  const toast = useToast();
  const [conn, setConn] = useState<Connection | null>(null);
  const [samples, setSamples] = useState<Sample[] | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof connectApi.checks>>>([]);
  const [error, setError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, s, h] = await Promise.all([connectApi.get(), connectApi.samples(), connectApi.checks()]);
      setConn(c); setSamples(s.items); setHistory(h);
      if (c.latest_check && (!report || report.check_id !== c.latest_check.check_id)) setReport(await connectApi.report(c.latest_check.check_id));
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

  if (error != null && !conn) return <div className="page rd rd-admin"><PageTitle title="Data connections" /><LoadError error={error} onRetry={load} what="the data connection" /></div>;
  if (!conn || !samples) return <div className="page rd rd-admin"><PageTitle title="Data connections" /><ListSkeleton rows={4} /></div>;
  const latest = conn.latest_check;
  const state = !conn.configured ? "Not connected" : conn.approved ? "Connected and approved" : latest ? (latest.current ? `Checked: ${STATUS_TONE[latest.status][1].toLowerCase()}, not approved yet` : "Changed since the last check") : "Connected, not checked yet";
  return (
    <div className="page rd rd-admin rd-dc">
      <PageTitle title="Data connections"
        status={<><span>{state}</span><span>Metrics Spec {SPEC}</span></>}
        lede="Amiri Agent checks each possible impact against your institution's own figures, read from a Metrics Spec reference API. Only that API is accepted. Connect it, run the check, then approve it and switch checks on." />
      <ConnectionSection conn={conn} samples={samples} checking={checking} onSaved={c => { setConn(c); setReport(null); load(); }}
        onCheck={run} onApprove={approve} onValidation={validation} />
      {report ? <ReportSection report={report} history={history} current={!!conn.latest_check?.current && conn.latest_check.check_id === report.check_id}
        onPick={async id => { try { setReport(await connectApi.report(id)); } catch (e) { toast(errText(e)); } }} />
        : conn.configured && <Section title="The check"><p className="rd-row-d rd-prose">Not checked yet. Press <b>Check</b> to see whether the API is the reference API and what your profile is missing.</p></Section>}
      <Section title="Sample institutions" id="dc-samples">
        <p className="rd-row-d rd-prose">A sample bank and insurer that serve the Metrics Spec exactly, shaped by your profile. Use one as a test API;
          conditions make its data show an effect, or make it break a rule on purpose.</p>
        <div className="dc-samples">
          {samples.map(s => <SampleRow key={s.kind} sample={s} onSaved={x => setSamples(ss => ss!.map(y => (y.kind === x.kind ? x : y)))}
            onUse={async () => { try { const c = await connectApi.put({ source: "sample", sample: s.kind }); setConn(c); setReport(null); toast(`Connected to the sample ${s.kind}: check it next.`); } catch (e) { toast(errText(e)); } }} />)}
        </div>
      </Section>
    </div>
  );
}

/** "Source  The sample bank": a label and its value, one per line. */
const Row = ({ k, children }: { k: string; children: ReactNode }) => <><dt>{k}</dt><dd>{children}</dd></>;

function ConnectionSection({ conn, samples, checking, onSaved, onCheck, onApprove, onValidation }: {
  conn: Connection; samples: Sample[]; checking: boolean; onSaved: (c: Connection) => void; onCheck: () => void;
  onApprove: () => void; onValidation: (v: boolean) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(!conn.configured);
  const [source, setSource] = useState<"sample" | "url">(conn.source ?? "sample");
  const [sample, setSample] = useState<"bank" | "insurer">(conn.sample ?? "bank");
  const [base, setBase] = useState(conn.source === "url" ? conn.base_url ?? "" : "");
  const [openapi, setOpenapi] = useState(conn.openapi_url ?? "");
  const [header, setHeader] = useState(conn.auth_header ?? "");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  // a connection saved elsewhere on the page ("Use it as the connection"): show it, and start the form from it
  useEffect(() => {
    if (conn.configured) setEditing(false);
    setSource(conn.source ?? "sample"); setSample(conn.sample ?? "bank");
    setBase(conn.source === "url" ? conn.base_url ?? "" : ""); setOpenapi(conn.openapi_url ?? ""); setHeader(conn.auth_header ?? "");
  }, [conn.configured, conn.updated_at, conn.source, conn.sample, conn.base_url, conn.openapi_url, conn.auth_header]);
  const latest = conn.latest_check;
  const sampleOff = source === "sample" && !samples.find(s => s.kind === sample)?.enabled;
  const save = async () => {
    setBusy(true);
    try {
      const c = await connectApi.put(source === "sample" ? { source, sample } : {
        source, base_url: base.trim(), openapi_url: openapi.trim() || undefined,
        ...(conn.auth_allowed !== false ? { auth_header: header.trim() || undefined, auth_value: secret || undefined } : {}) });
      setSecret(""); setEditing(false); onSaved(c); toast("Saved. Check it next.");
    } catch (e) { toast(errText(e)); }
    finally { setBusy(false); }
  };
  const canApprove = !!latest?.current && latest.status !== "not_ready" && !conn.approved;
  const validationWhy = !conn.validation_allowed ? "Validation is switched off on this server (METRICS_VALIDATION)."
    : !conn.approved ? "Approve a checked connection first." : null;
  return (
    <Section title="The connection" action={conn.configured && !editing ? <TextButton onClick={() => setEditing(true)}>Change</TextButton> : undefined}>
      {conn.auth_allowed === false && <QuietWarn><b>Prototype: no authorization.</b> Use only the sample institutions or a test API with no real data.</QuietWarn>}
      {conn.configured && !editing && <>
        <dl className="ad-kv">
          <Row k="Source"><b>{conn.source === "sample" ? `The sample ${conn.sample}` : "Your institution's API"}</b>{" "}
            {conn.source === "sample" ? <span className="rd-fine" title={conn.base_url ?? undefined}>hosted with Amiri Agent</span>
              : <span className="ad-mono">{conn.base_url}</span>}
            {conn.auth_set && <span className="rd-fine"> · key stored ({conn.auth_header})</span>}</Row>
          {latest?.server_version && <Row k="Version">{latest.server_version.split(".")[0] === SPEC.split(".")[0]
            ? <>Compatible with Metrics Spec {SPEC.split(".")[0]}.x <span className="rd-fine">(the API serves {latest.server_version})</span></>
            : <span className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> <b>Not compatible:</b> the API serves Metrics Spec {latest.server_version}, and Amiri Agent reads {SPEC.split(".")[0]}.x</span>}</Row>}
          <Row k="State">{conn.approved ? <>Approved by {person(conn.approved.by)} {ago(conn.approved.at)}.</> : latest
            ? latest.current ? <>Checked {ago(latest.started_at)}: <b>{STATUS_TONE[latest.status][1].toLowerCase()}</b>. Not approved yet.</> : <>Changed since the last check: check it again.</>
            : <>Not checked yet.</>}</Row>
          <Row k="Validation">
            <span className="ad-switch"><Switch on={conn.validation_enabled} label="Validation against the institution's data" disabled={!!validationWhy && !conn.validation_enabled} onChange={onValidation} />
              <b>{conn.validation_enabled ? "On" : "Off"}</b></span>
            {validationWhy && !conn.validation_enabled ? <span className="rd-fine"> · {validationWhy}</span> : <span className="rd-fine"> · new tasks are checked against the institution's data</span>}</Row>
        </dl>
        <div className="ad-acts">
          <button className="btn btn--primary" type="button" onClick={onCheck} disabled={checking}>{checking ? "Checking…" : "Check"}</button>
          <button className="btn" type="button" onClick={onApprove} disabled={!canApprove}
            title={canApprove ? "Approve this connection for validation" : conn.approved ? "Already approved" : "Check it first; a connection that isn't ready can't be approved"}>Approve</button>
        </div>
      </>}
      {editing && <div className="ad-form">
        <TextTabs label="Where the data comes from" value={source} onChange={setSource}
          items={[{ key: "sample", label: "A sample institution" }, { key: "url", label: "Your institution's API" }]} />
        {source === "sample" ? <div className="field"><label htmlFor="dc-sample">Sample</label>
          <select id="dc-sample" className="input" style={{ maxWidth: 320 }} value={sample} onChange={e => setSample(e.target.value as "bank" | "insurer")}>
            <option value="bank">The sample bank</option><option value="insurer">The sample insurer</option></select>
          {sampleOff && <span className="hint rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> It's switched off: switch it on under Sample institutions below.</span>}</div>
          : <div className="grid2">
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="dc-base">Address <span className="req" aria-hidden="true">*</span></label>
              <input id="dc-base" className="input mono" placeholder="https://data.bank.example/metrics/v1" value={base} onChange={e => setBase(e.target.value)} />
              <span className="hint">The reference API's base, ending in /metrics/v1. https only.</span></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="dc-openapi">OpenAPI document (optional)</label>
              <input id="dc-openapi" className="input mono" placeholder="Default: the address without /metrics/v1, then /openapi.json" value={openapi} onChange={e => setOpenapi(e.target.value)} /></div>
            {conn.auth_allowed !== false && <>
            <div className="field"><label htmlFor="dc-header">Key header (optional)</label>
              <input id="dc-header" className="input mono" placeholder="Authorization" value={header} onChange={e => setHeader(e.target.value)} /></div>
            <div className="field"><label htmlFor="dc-secret">Key or token</label>
              <input id="dc-secret" className="input mono" type="password" autoComplete="off"
                placeholder={conn.auth_set ? "Stored; type to replace" : "e.g. Bearer …"} value={secret} onChange={e => setSecret(e.target.value)} />
              <span className="hint">Stored encrypted, never shown again.</span></div>
            </>}
          </div>}
        <div className="ad-acts">
          <button className="btn btn--primary" type="button" onClick={save} disabled={busy || (source === "url" && !base.trim())}>Save</button>
          {conn.configured && <TextButton onClick={() => setEditing(false)}>Cancel</TextButton>}
          <span className="rd-fine">Saving a change means checking and approving it again.</span>
        </div>
      </div>}
      <div role="status" aria-live="polite" className="rd-fine ad-status">{checking ? "Checking the API: about 70 calls, a few seconds…" : ""}</div>
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
      {!current && <p className="rd-fine ad-old">This is an older check: the connection changed after it.</p>}
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

function SampleRow({ sample, onSaved, onUse }: { sample: Sample; onSaved: (s: Sample) => void; onUse: () => void }) {
  const toast = useToast();
  const [conds, setConds] = useState<Condition[]>(sample.conditions);
  const [busy, setBusy] = useState(false);
  useEffect(() => setConds(sample.conditions), [sample.conditions]);
  const byId = useMemo(() => Object.fromEntries(conds.map(c => [c.id, c])), [conds]);
  const dirty = JSON.stringify(conds) !== JSON.stringify(sample.conditions);
  const set = (id: string, patch: Partial<Condition> | null) => setConds(cs => {
    const rest = cs.filter(c => c.id !== id);
    if (patch === null) return rest;
    const prev = cs.find(c => c.id === id) ?? { id };
    return [...rest, { ...prev, ...patch }].sort((a, b) => sample.presets.findIndex(p => p.id === a.id) - sample.presets.findIndex(p => p.id === b.id));
  });
  const put = async (enabled: boolean, conditions: Condition[]) => {
    setBusy(true);
    try { onSaved(await connectApi.putSample(sample.kind, enabled, conditions)); toast(`The sample ${sample.kind}: saved.`); }
    catch (e) { toast(errText(e)); }
    finally { setBusy(false); }
  };
  const read = (doc: unknown): Candidate[] => {
    const list = Array.isArray(doc) ? doc : doc && typeof doc === "object" && Array.isArray((doc as { conditions?: unknown }).conditions) ? (doc as { conditions: unknown[] }).conditions : null;
    if (!list) return [];
    const known = new Set(sample.presets.map(p => p.id));
    const ok = list.filter((c): c is Condition => !!c && typeof c === "object" && known.has((c as Condition).id));
    return ok.length ? [{ label: `${ok.length} condition(s)`, data: { conditions: ok } }] : [];
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ conditions: conds }, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `sample-${sample.kind}-conditions.json`; a.click(); URL.revokeObjectURL(url);
  };
  const groups: [string, string, "data" | "fault"][] = [
    ["What the data shows", "Effects in the figures, from a start date you choose", "data"],
    ["What the API gets wrong", "Rule breaks, to show what the checker catches", "fault"]];
  const nOn = conds.filter(c => c.on !== false).length;
  return (
    <article className="dc-sample" aria-label={`The sample ${sample.kind}`}>
      <div className="dc-sample-hd">
        <Switch on={sample.enabled} label={`The sample ${sample.kind}`} disabled={busy || !sample.allowed} onChange={v => put(v, conds)} />
        <div className="dc-sample-t">
          <h3>The sample {sample.kind} <span className="dc-state">{sample.enabled ? "On" : "Off"}</span></h3>
          <p className="rd-fine">Shaped by {sample.shaped_by.name} ({sample.shaped_by.source === "installation" ? "your profile" : "a bundled sample"}) · <span className="ad-mono">{sample.base_path}</span></p>
        </div>
        <span className="dc-sample-acts">
          {sample.enabled && <a className="rd-go" href={sample.openapi_path} target="_blank" rel="noreferrer">OpenAPI document</a>}
          <button className="btn" type="button" onClick={onUse} disabled={!sample.enabled} title={sample.enabled ? undefined : "Switch it on first"}>Use it as the connection</button></span>
      </div>
      {!sample.allowed && <QuietWarn>Sample institutions are switched off on this server (MOCK_INSTITUTIONS).</QuietWarn>}
      <Fold title="Conditions" summary={nOn ? `${nOn} on` : "none on"} remember={`dc-conds-${sample.kind}`}>
        {groups.map(([title, note, group]) => (
          <fieldset key={group} className="dc-conds">
            <legend><b>{title}</b><span className="rd-fine">{note}</span></legend>
            <ul>{sample.presets.filter(p => p.group === group).map(p => { const c = byId[p.id]; const on = !!c && c.on !== false; return (
              <li key={p.id}>
                <label className="dc-cond">
                  <input type="checkbox" checked={on} onChange={e => set(p.id, e.target.checked ? { on: true } : null)} />
                  <span><span className="dc-cond-t">{p.label}</span>{p.note && <span className="dc-cond-d">{p.note}</span>}</span></label>
                {on && group === "data" && <div className="dc-cond-opts">
                  <label>From
                    <input type="date" className="input" value={c?.start ?? ""} aria-label={`${p.label}: from`}
                      onChange={e => set(p.id, { start: e.target.value || null })} />
                    {!c?.start && <span className="rd-fine">({p.start_days_ago} days ago)</span>}</label>
                  {p.size_label && <label>{p.size_label}
                    <input type="number" className="input dc-num" value={c?.size ?? ""} placeholder={String(p.size ?? "")} aria-label={`${p.label}: ${p.size_label}`}
                      onChange={e => set(p.id, { size: e.target.value === "" ? null : Number(e.target.value) })} /></label>}
                </div>}
              </li>); })}</ul>
          </fieldset>))}
        <div className="dc-sample-ft">
          <TextButton onClick={download}>Download as JSON</TextButton>
          <FillFromJson what="the conditions" read={read} onFill={c => setConds((c.data as { conditions: Condition[] }).conditions)}
            example={'{"conditions": [{"id": "floods", "start": "2026-10-01", "size": 600}]}'} />
          <span className="dc-spacer" />
          {dirty && <span className="rd-fine">Unsaved changes</span>}
          <button className="btn" type="button" disabled={busy || !dirty} onClick={() => put(sample.enabled, conds)}>Save conditions</button>
        </div>
      </Fold>
    </article>
  );
}
