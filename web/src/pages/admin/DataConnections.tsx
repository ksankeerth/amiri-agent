// Platform Admin: where Amiri Agent reads the institution's own numbers. Set the connection (an address,
// or a sample institution), Check it, read the report, Approve it, and switch validation on. The sample
// bank and insurer are switched on, and given conditions, here too.
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { connectApi, type CheckState, type CheckStatus, type Condition, type Connection, type Report, type Sample } from "../../api/connect";
import { FillFromJson } from "../../components/FillFromJson";
import type { Candidate } from "../../components/fillJson";
import { Icon } from "../../components/Icon";
import { Banner, Empty, ListSkeleton, PageHead, useToast } from "../../components/ui";
import { ago, dayTime, plural } from "../../format";

const STATUS_BADGE: Record<CheckStatus, [string, string]> = {
  ready: ["b-ok", "READY"], ready_with_gaps: ["b-warn", "READY WITH GAPS"], not_ready: ["b-down", "NOT READY"],
};
const STATE_BADGE: Record<CheckState, [string, string]> = {
  pass: ["b-ok", "PASS"], fail: ["b-down", "FAIL"], not_applicable: ["b-noeffect", "N/A"], not_run: ["b-noeffect", "NOT RUN"],
};
const STEP_ICON: Record<string, [string, string]> = { pass: ["check", "var(--accent)"], warn: ["warn", "var(--medium-ink)"], fail: ["x", "var(--critical-ink)"] };
const SPEC = "1.0.0";

function errText(e: unknown) { return e instanceof ApiError ? e.full : String(e); }

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
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, s, h] = await Promise.all([connectApi.get(), connectApi.samples(), connectApi.checks()]);
      setConn(c); setSamples(s.items); setHistory(h);
      if (c.latest_check && (!report || report.check_id !== c.latest_check.check_id)) setReport(await connectApi.report(c.latest_check.check_id));
      setError(null);
    } catch (e) { setError(errText(e)); }
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

  if (error && !conn) return <div className="page"><PageHead title="Data connections" /><Banner kind="crit" icon="warn">{error}</Banner></div>;
  if (!conn || !samples) return <div className="page"><PageHead title="Data connections" /><div className="card"><ListSkeleton rows={4} /></div></div>;
  return (
    <div className="page">
      <PageHead title="Data connections"
        sub={<>Where Amiri Agent reads your institution's own numbers to check what an event does to it. Only the
          {" "}<b>Metrics Spec reference API</b> is accepted <span className="badge b-info" title="The version this server implements">Spec {SPEC}</span></>} />
      <div className="col gap16">
        <ConnectionCard conn={conn} samples={samples} checking={checking} onSaved={c => { setConn(c); setReport(null); load(); }}
          onCheck={run} onApprove={approve} onValidation={validation} />
        {report ? <ReportCard report={report} history={history} current={!!conn.latest_check?.current && conn.latest_check.check_id === report.check_id}
          onPick={async id => { try { setReport(await connectApi.report(id)); } catch (e) { toast(errText(e)); } }} />
          : conn.configured && <div className="card"><Empty icon="data" title="Not checked yet">Press <b>Check</b> to see whether the API is the reference API and what your profile is missing.</Empty></div>}
        <div className="card"><div className="hd"><h2>Sample institutions</h2></div>
          <div className="bd col gap12">
            <p className="small muted" style={{ margin: 0 }}>A bank and an insurer that serve the Metrics Spec exactly, shaped by your profile (or a
              bundled one): a working example of the API, something to check, and data the validator can read. Conditions make the
              data show an effect, or make the API break a rule on purpose.</p>
            {samples.map(s => <SampleCard key={s.kind} sample={s} onSaved={x => setSamples(ss => ss!.map(y => (y.kind === x.kind ? x : y)))}
              onUse={async () => { try { const c = await connectApi.put({ source: "sample", sample: s.kind }); setConn(c); setReport(null); toast(`Connected to the sample ${s.kind}: check it next.`); } catch (e) { toast(errText(e)); } }} />)}
          </div></div>
      </div>
    </div>
  );
}

function ConnectionCard({ conn, samples, checking, onSaved, onCheck, onApprove, onValidation }: {
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
    <div className="card">
      <div className="hd"><h2>The connection</h2>{conn.configured && !editing && <button className="btn btn--sm btn--ghost" type="button" style={{ marginLeft: "auto" }} onClick={() => setEditing(true)}><Icon name="edit" />Change</button>}</div>
      <div className="bd col gap12">
        {conn.auth_allowed === false && <Banner kind="warn" icon="warn"><b>Prototype: no authorization.</b> Use only the sample institutions or a test API with no real data.</Banner>}
        {conn.configured && !editing && <div className="col gap8">
          <div className="row wrap"><b>{conn.source === "sample" ? `The sample ${conn.sample}` : "Your institution's API"}</b>
            <span className="mono small" style={{ wordBreak: "break-all" }}>{conn.base_url}</span>
            {conn.auth_set && <span className="badge">key stored ({conn.auth_header})</span>}</div>
          {latest?.server_version && <div className="small">Your API: <b>Metrics Spec {latest.server_version}</b> · {latest.server_version.split(".")[0] === SPEC.split(".")[0]
            ? <>accepted (same MAJOR as {SPEC})</> : <b style={{ color: "var(--critical-ink)" }}>not accepted: a different MAJOR from {SPEC}</b>}</div>}
          <div className="small">{conn.approved ? <>Approved by {conn.approved.by} {ago(conn.approved.at)}.</> : latest
            ? latest.current ? <>Checked {ago(latest.started_at)}: <b>{STATUS_BADGE[latest.status][1].toLowerCase()}</b>. Not approved yet.</> : <>Changed since the last check: check it again.</>
            : <>Not checked yet.</>}</div>
        </div>}
        {editing && <div className="col gap12">
          <span className="seg" role="group" aria-label="Where the data comes from">
            <button type="button" aria-pressed={source === "sample"} onClick={() => setSource("sample")}>A sample institution</button>
            <button type="button" aria-pressed={source === "url"} onClick={() => setSource("url")}>Your institution's API</button>
          </span>
          {source === "sample" ? <div className="field"><label htmlFor="dc-sample">Sample</label>
            <select id="dc-sample" className="input" style={{ maxWidth: 280 }} value={sample} onChange={e => setSample(e.target.value as "bank" | "insurer")}>
              <option value="bank">The sample bank</option><option value="insurer">The sample insurer</option></select>
            {sampleOff && <span className="small" style={{ color: "var(--medium-ink)" }}>It's switched off: switch it on under Sample institutions below.</span>}</div>
            : <div className="grid2">
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="dc-base">Address <span className="req" aria-hidden="true">*</span></label>
                <input id="dc-base" className="input mono" placeholder="https://data.bank.example/metrics/v1" value={base} onChange={e => setBase(e.target.value)} />
                <span className="small muted">The reference API's base, ending in /metrics/v1. https only.</span></div>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="dc-openapi">OpenAPI document (optional)</label>
                <input id="dc-openapi" className="input mono" placeholder="Default: the address without /metrics/v1, then /openapi.json" value={openapi} onChange={e => setOpenapi(e.target.value)} /></div>
              {conn.auth_allowed !== false && <>
              <div className="field"><label htmlFor="dc-header">Key header (optional)</label>
                <input id="dc-header" className="input mono" placeholder="Authorization" value={header} onChange={e => setHeader(e.target.value)} /></div>
              <div className="field"><label htmlFor="dc-secret">Key or token</label>
                <input id="dc-secret" className="input mono" type="password" autoComplete="off"
                  placeholder={conn.auth_set ? "Stored; type to replace" : "e.g. Bearer …"} value={secret} onChange={e => setSecret(e.target.value)} />
                <span className="small muted">Stored encrypted, never shown again.</span></div>
              </>}
            </div>}
          <div className="row"><button className="btn btn--primary" type="button" onClick={save} disabled={busy || (source === "url" && !base.trim())}>Save</button>
            {conn.configured && <button className="btn" type="button" onClick={() => setEditing(false)}>Cancel</button>}
            <span className="small muted">Saving a change means checking and approving it again.</span></div>
        </div>}
        {conn.configured && !editing && <div className="row wrap" style={{ gap: 12 }}>
          <button className="btn btn--primary" type="button" onClick={onCheck} disabled={checking}><Icon name="refresh" />{checking ? "Checking…" : "Check"}</button>
          <button className="btn" type="button" onClick={onApprove} disabled={!canApprove}
            title={canApprove ? "Approve this connection for validation" : conn.approved ? "Already approved" : "Check it first; a connection that isn't ready can't be approved"}><Icon name="check" />Approve</button>
          <span className="row" style={{ marginLeft: "auto", gap: 8 }}>
            <Switch on={conn.validation_enabled} label="Validation against the institution's data" disabled={!!validationWhy && !conn.validation_enabled} onChange={onValidation} />
            <span className="small"><b>Validation {conn.validation_enabled ? "on" : "off"}</b>{validationWhy && !conn.validation_enabled ? <span className="muted"> · {validationWhy}</span> : null}</span>
          </span>
        </div>}
        <div role="status" aria-live="polite" className="small muted">{checking ? "Checking the API: about 70 calls, a few seconds…" : ""}</div>
      </div>
    </div>
  );
}

function ReportCard({ report, history, current, onPick }: { report: Report; history: Awaited<ReturnType<typeof connectApi.checks>>; current: boolean; onPick: (id: string) => void }) {
  const [badge, label] = STATUS_BADGE[report.status];
  const [open, setOpen] = useState<string | null>(null);
  const failed = report.checks.filter(c => c.status === "fail");
  const others = report.checks.filter(c => c.status !== "fail");
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${report.check_id}.json`; a.click(); URL.revokeObjectURL(url);
  };
  return (
    <div className="card">
      <div className="hd" style={{ flexWrap: "wrap" }}><h2>The check</h2><span className={`badge ${badge}`}>{label}</span>
        {!current && <span className="badge b-noeffect" title="The connection changed after this check">OLDER CHECK</span>}
        <span className="row wrap" style={{ marginLeft: "auto", gap: 8, maxWidth: "100%" }}>
          {history.length > 1 && <label className="row small" style={{ gap: 6 }}><span className="muted">Check</span>
            <select className="input" style={{ width: "auto", maxWidth: "100%" }} value={report.check_id} onChange={e => onPick(e.target.value)}>
              {history.map(h => <option key={h.check_id} value={h.check_id}>{dayTime(h.started_at)} · {STATUS_BADGE[h.status][1].toLowerCase()}</option>)}</select></label>}
          <button className="btn btn--sm" type="button" onClick={download}>Download JSON</button></span></div>
      <div className="bd col gap16">
        {report.withdrawn && <Banner kind="warn" icon="warn">{report.withdrawn}</Banner>}
        <div><b>{report.headline}</b><div className="small muted">{report.target} · {dayTime(report.started_at)} by {report.run_by} ·
          {" "}{plural(report.summary.calls, "call")} in {report.summary.seconds} s · checked against Metrics Spec {report.spec_version}{report.server_version ? `, the API says ${report.server_version}` : ""}</div></div>
        <ol className="col gap8" style={{ listStyle: "none", padding: 0, margin: 0 }} aria-label="Steps">
          {report.steps.map((s, i) => { const [ico, color] = STEP_ICON[s.status]; return (
            <li key={i} className="row" style={{ alignItems: "flex-start" }}><span style={{ color }} role="img" aria-label={s.status}><Icon name={ico} className="ico16" /></span>
              <div><span>{s.title}</span>{s.detail && <span className="small muted"> · {s.detail}</span>}
                {s.items.length > 0 && <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>{s.items.slice(0, 12).map((x, j) => <li key={j}>{x}</li>)}</ul>}
                {s.fix && <div className="small muted"><b>Fix:</b> {s.fix}</div>}</div></li>); })}
        </ol>
        {report.missing_for_profile.length > 0 && <div><h3 className="small" style={{ margin: "0 0 6px" }}>What's missing for your profile</h3>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{report.missing_for_profile.map((x, i) => <li key={i}>{x}</li>)}</ul></div>}
        {report.formats.length > 0 && <div><h3 className="small" style={{ margin: "0 0 6px" }}>Answers that don't match the spec's formats</h3>
          {report.formats.slice(0, 10).map((f, i) => <div key={i} className="small" style={{ marginBottom: 6 }}><span className="mono">{f.where}</span>
            <ul style={{ margin: "2px 0 0", paddingLeft: 18 }}>{f.errors.map((e, j) => <li key={j} className="mono">{e}</li>)}{f.more > 0 && <li>and {f.more} more</li>}</ul></div>)}
          {report.formats.length > 10 && <div className="small muted">and {report.formats.length - 10} more answers</div>}</div>}
        <div><h3 className="small" style={{ margin: "0 0 6px" }}>Conformance checks (spec §9) · {report.summary.passed} passed, {report.summary.failed} failed</h3>
          <div className="tblwrap" tabIndex={0} role="region" aria-label="Conformance checks (scrolls sideways)"><table className="tbl">
            <thead><tr><th scope="col">Check</th><th scope="col">Level</th><th scope="col">Result</th><th scope="col">What was found</th></tr></thead>
            <tbody>{[...failed, ...others].map(c => { const [b, l] = STATE_BADGE[c.status]; const isOpen = open === c.id; return (
              <tr key={c.id}><td><Link className="mono" to={`/spec#check-${c.id}`}>{c.id}</Link> {c.title}</td><td>{c.level}</td><td><span className={`badge ${b}`}>{l}</span></td>
                <td className="small">{c.status === "fail" ? <>
                  {c.findings[0]}{(c.findings.length > 1 || c.more > 0) && <> <button className="btn btn--sm btn--ghost" type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.id)}>{isOpen ? "Less" : `${c.findings.length - 1 + c.more} more`}</button></>}
                  {isOpen && <ul style={{ margin: "4px 0", paddingLeft: 18 }}>{c.findings.slice(1).map((x, i) => <li key={i}>{x}</li>)}{c.more > 0 && <li>and {c.more} more</li>}</ul>}
                  <div className="muted"><b>Fix:</b> {c.fix}</div></> : c.note ?? ""}</td></tr>); })}</tbody></table></div></div>
        {report.coverage && report.coverage.products.length > 0 && <div><h3 className="small" style={{ margin: "0 0 6px" }}>Coverage for your profile</h3>
          <div className="tblwrap" tabIndex={0} role="region" aria-label="Coverage (scrolls sideways)"><table className="tbl">
            <thead><tr><th scope="col">Product</th><th scope="col">In the catalog as</th><th scope="col">Required metrics</th><th scope="col">Missing or reduced</th></tr></thead>
            <tbody>{report.coverage.products.map(p => <tr key={p.profile_product_id}>
              <td>{p.name} <span className={`badge ${p.status === "full" ? "b-ok" : p.status === "partial" ? "b-warn" : "b-down"}`}>{p.status.toUpperCase()}</span></td>
              <td className="mono small">{p.catalog_product_id ?? "—"}</td><td className="small">{p.required.length - p.missing.length} of {p.required.length}</td>
              <td className="small">{p.missing.length || p.reduced.length ? [...p.missing.map(m => [m, "missing"]), ...p.reduced.map(r => [r.key, `served ${r.grain_served} (spec: ${r.grain_spec})`])]
                .map(([k, what], i) => <Fragment key={k}>{i ? "; " : ""}<Link className="mono" to={`/spec#metric-${k}`}>{k}</Link> {what}</Fragment>) : "—"}</td></tr>)}</tbody></table></div>
          {report.coverage.unmapped_catalog_products.length > 0 && <div className="small muted">In the catalog but not in your profile: {report.coverage.unmapped_catalog_products.map(p => p.name || p.product_id).join(", ")}.</div>}</div>}
        <details><summary className="small">The calls ({report.calls.length})</summary>
          <div className="tblwrap" tabIndex={0} role="region" aria-label="The calls (scrolls)" style={{ maxHeight: 320, overflow: "auto" }}><table className="tbl small">
            <thead><tr><th scope="col">Call</th><th scope="col">Status</th><th scope="col">Time</th></tr></thead>
            <tbody>{report.calls.map((c, i) => <tr key={i}><td className="mono" style={{ wordBreak: "break-all" }}>{c.method} {c.path}{Object.keys(c.query).length ? "?" + new URLSearchParams(Object.entries(c.query).map(([k, v]) => [k, String(v)])).toString() : ""}</td>
              <td>{c.status ?? c.error}</td><td>{c.ms} ms</td></tr>)}</tbody></table></div></details>
      </div>
    </div>
  );
}

function SampleCard({ sample, onSaved, onUse }: { sample: Sample; onSaved: (s: Sample) => void; onUse: () => void }) {
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
  const groups: [string, "data" | "fault"][] = [["What the data shows", "data"], ["What the API gets wrong (to show the checker)", "fault"]];
  return (
    <div className="card flat">
      <div className="hd"><Switch on={sample.enabled} label={`The sample ${sample.kind}`} disabled={busy || !sample.allowed} onChange={v => put(v, conds)} />
        <h2 style={{ margin: 0 }}>The sample {sample.kind}</h2>
        <span className="small muted">shaped by {sample.shaped_by.name} ({sample.shaped_by.source === "installation" ? "your profile" : "a bundled sample"})</span>
        <span className="row" style={{ marginLeft: "auto", gap: 8 }}>
          {sample.enabled && <a className="btn btn--sm btn--ghost" href={sample.openapi_path} target="_blank" rel="noreferrer">OpenAPI document</a>}
          <button className="btn btn--sm" type="button" onClick={onUse} disabled={!sample.enabled}>Use it as the connection</button></span></div>
      <div className="bd col gap12">
        {!sample.allowed && <Banner kind="info">Sample institutions are switched off on this server (MOCK_INSTITUTIONS).</Banner>}
        <div className="small mono muted">{sample.base_path}</div>
        {groups.map(([title, group]) => (
          <fieldset key={group} className="col gap8" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>{title}</legend>
            {sample.presets.filter(p => p.group === group).map(p => { const c = byId[p.id]; const on = !!c && c.on !== false; return (
              <div key={p.id} className="row wrap" style={{ alignItems: "flex-start", gap: 10 }}>
                <label className="row" style={{ gap: 6, minWidth: 260, alignItems: "flex-start" }}>
                  <input type="checkbox" checked={on} onChange={e => set(p.id, e.target.checked ? { on: true } : null)} />
                  <span><span>{p.label}</span>{p.note && <span className="small muted" style={{ display: "block" }}>{p.note}</span>}</span></label>
                {on && group === "data" && <>
                  <label className="row small" style={{ gap: 6 }}>From
                    <input type="date" className="input" style={{ width: "auto" }} value={c?.start ?? ""} aria-label={`${p.label}: from`}
                      onChange={e => set(p.id, { start: e.target.value || null })} />
                    {!c?.start && <span className="muted">({p.start_days_ago} days ago)</span>}</label>
                  {p.size_label && <label className="row small" style={{ gap: 6 }}>{p.size_label}
                    <input type="number" className="input" style={{ width: 90 }} value={c?.size ?? ""} placeholder={String(p.size ?? "")} aria-label={`${p.label}: ${p.size_label}`}
                      onChange={e => set(p.id, { size: e.target.value === "" ? null : Number(e.target.value) })} /></label>}
                </>}
              </div>); })}
          </fieldset>))}
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn--primary btn--sm" type="button" disabled={busy || !dirty} onClick={() => put(sample.enabled, conds)}>Save conditions</button>
          <button className="btn btn--sm" type="button" onClick={download}>Download as JSON</button>
          <FillFromJson what="the conditions" read={read} onFill={c => setConds((c.data as { conditions: Condition[] }).conditions)}
            example={'{"conditions": [{"id": "floods", "start": "2026-10-01", "size": 600}]}'} />
        </div>
      </div>
    </div>
  );
}
