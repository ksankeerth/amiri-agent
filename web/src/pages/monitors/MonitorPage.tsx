// One monitor, read top to bottom: its state and the one action it waits for, what its last check found, where it has got
// to; then what it found, what it watches, its checks and its versions, each line opening in place. New, a draft and Edit
// show the form (monitorForm.tsx) under the same opening.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { investigationApi } from "../../api/investigation";
import { inst, type Profile } from "../../api/institutions";
import { monitorsApi, type CheckRow, type Monitor, type MonitorFinding } from "../../api/monitors";
import type { Installation } from "../../App";
import { FactList, PageHeader, TechnicalDetails } from "../../components/blocks";
import { Icon } from "../../components/Icon";
import { LoadError, PageSkeleton, useNow, useRole, useToast } from "../../components/ui";
import { ago, dayTime, due } from "../../format";
import { count, eventTitle, everyText, listText } from "../../plain";
import { changed, draftedLine, MonitorForm } from "./monitorForm";
import { CheckLine, FindingLine, headOf, lower, Progress, Versions, Watches, wentTo, who } from "./monitorParts";
import { DraftFromProfile, MonitorActions, MonitorHelp, StatusBadge, useMonitorsStatus } from "./Monitors";
import "../../styles/monitor-page.css";

/** The answer in a sentence: what the last check found and where it went, or what the monitor waits for. */
function lede(m: Monitor, runs: CheckRow[], findings: MonitorFinding[], events: Record<string, string>, now: Date): ReactNode {
  const c = m.last_check, run = runs.find(r => r.world === "live");
  const latest = m.versions[m.versions.length - 1];
  if (m.status === "retired") return "Retired: it no longer checks the news. What it found stays in Findings.";
  if (m.status === "submitted") return <>Waiting for a Risk Manager to approve it: {who(latest.submitted_by)} sent it{latest.submitted_at ? ` ${ago(latest.submitted_at, now)}` : ""}. It goes live within minutes of approval.</>;
  if (m.status === "draft") return "A draft: it doesn't run on its own. Run a test to see what it would find, then send it for approval.";
  const pre = m.status === "paused" ? "Paused: it isn't checked until you resume it. " : "";
  if (!c) return <>{pre}{m.status === "paused" ? "It was paused before its first check." : `Not checked yet; the first check is ${due(m.next_check_at, now)}.`}</>;
  if (c.status === "error") return <>{pre}Its last check, {ago(c.at, now)}, couldn't read the news; it tries again within the hour.</>;
  if (c.status === "quiet") return <>{pre}Its last check, {ago(c.at, now)}, found nothing new{run?.summary ? <>: {lower(run.summary)}</> : "."}</>;
  const f = findings.find(x => x.world === "live") ?? findings[0], h = f && headOf(f), w = f && wentTo(f, events);
  return <>{pre}Its last check, {ago(c.at, now)}, found <span className="mp-n">{count(c.findings, "report")}</span>{f && w ? <>{c.findings > 1 ? "; the latest" : ""}:{" "}
    {h?.url ? <a className="mp-named" href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : <b className="mp-named">{h?.title ?? f.title}</b>}.
    <span className="mp-went">{w.to ? <>It is now part of <Link to={w.to}>{w.text}</Link>.</> : `${w.text}.`}</span></> : "."}</>;
}

export function MonitorPage() {
  const { id = "new" } = useParams();
  const isNew = id === "new";
  const toast = useToast();
  const now = useNow(30_000);
  const { role } = useRole();
  const { status } = useMonitorsStatus();
  const [m, setM] = useState<Monitor | null>(null);
  const [runs, setRuns] = useState<CheckRow[]>([]);
  const [findings, setFindings] = useState<MonitorFinding[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [drafting, setDrafting] = useState(false);
  const [help, setHelp] = useState(false);
  const [editing, setEditing] = useState<boolean | null>(null);  // null: the default for its state (a fresh draft opens in the form)
  const [events, setEvents] = useState<Record<string, string>>({});
  useEffect(() => { if (findings.some(f => f.outcome?.event_id)) investigationApi.events().then(xs => setEvents(Object.fromEntries(xs.map(e => [e.event_id, eventTitle(e)])))).catch(() => {}); }, [findings]);

  const owner = m?.institution_id;
  useEffect(() => {  // the exposure chips come from the monitor's own institution (the installation's for a new one)
    if (!isNew && !owner) return;
    (owner ? Promise.resolve(owner) : api<Installation>("/api/v1/installation").then(i => (i.profile ? i.institution_id : null)))
      .then(x => (x ? inst.profile(x).then(setProfile) : null)).catch(() => {});
  }, [owner, isNew]);
  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const [mm, r, f] = await Promise.all([monitorsApi.get(id), monitorsApi.runs(id), monitorsApi.findings(id)]);
      setM(mm); setRuns(r); setFindings(f); setErr(null);
    } catch (e) { setErr(e); }
  }, [id, isNew]);
  useEffect(() => { setM(null); setEditing(null); load(); }, [load]);

  // A check started here is asked for its status until it finishes (the server asks the agent).
  useEffect(() => {
    const running = checking ?? runs.find(r => r.status === "running")?.run_id;
    if (!running) return;
    const t = setInterval(async () => {
      try {
        const r = await monitorsApi.check(running);
        if (r.status !== "running") {
          setChecking(null); await load();
          if (checking) toast(r.status === "failed" ? "The check failed: see Checks" : r.findings ? `Found ${r.findings}` : "Nothing new");
        }
      } catch { /* the next poll */ }
    }, 5000);
    return () => clearInterval(t);
  }, [checking, runs, load, toast]);

  const runNow = async () => {
    if (!m) return;
    try { const r = await monitorsApi.runNow(m.monitor_id); setChecking(r.status === "running" ? r.run_id : null); await load(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const act = async (a: "pause" | "resume" | "retire") => {
    if (!m) return;
    try { await monitorsApi.act(m.monitor_id, a); toast({ pause: "Paused", resume: "Resumed: checked again within a few minutes", retire: "Retired" }[a]); load(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const saved = (x: Monitor) => { setM(x); setFormKey(k => k + 1); setEditing(false); load(); };
  const editMode = isNew || editing || (m?.status === "draft" && editing !== false && !m.last_check);

  if (!isNew && !m) return <div className="page">{err != null ? <><PageHeader title="Monitor" crumbs={<Link to="/monitors">Monitors</Link>} /><LoadError error={err} onRetry={load} what="this monitor" /></> : <PageSkeleton bare />}</div>;

  const title = m ? m.spec.about.name || m.name : "New monitor";
  const latest = m?.versions[m.versions.length - 1];
  const waits = !!m && (m.status === "submitted" || m.pending?.status === "submitted");
  const sentBack = latest?.status === "draft" && latest.note && latest.submitted_at;
  const nextDiff = m?.pending && m.live_spec ? changed(m.live_spec, m.spec) : [];
  const where = !m ? null : editMode ? (m.status === "draft" ? "Not sent yet" : `Editing the next version; version ${m.live_version} keeps running`)
    : `${everyText(m.spec.about.check_frequency)}, owned by ${m.spec.about.owner}`;
  const actions = isNew ? <button className="btn" type="button" onClick={() => setDrafting(true)}><Icon name="bank" />Draft from the profile</button>
    : m && !editMode && m.status !== "retired" ? <>
      {(m.status === "submitted" || m.status === "draft") && <MonitorActions m={m} onChange={load} only="pending" />}
      {m.status === "paused" && <button className="btn btn--primary" type="button" onClick={() => act("resume")}>Resume</button>}
      <button className="btn" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit</button></> : null;

  return (
    <div className="page mp">
      <header className="mp-head">
        <nav className="crumbs" aria-label="Breadcrumb"><Link to="/monitors">Monitors</Link><span aria-hidden="true">/</span><span>{m ? m.name : "New monitor"}</span></nav>
        <p className="mp-when">{m && <StatusBadge status={m.status} />}{where && <span>{where}</span>}
          {m?.review_due && !editMode && <span className="mp-due">Review due</span>}
          <button type="button" className="ph-help" aria-expanded={help} aria-controls="mp-help" onClick={() => setHelp(h => !h)}><Icon name="help" />How this works</button></p>
        <div className="mp-h1row"><h1>{title}</h1>{actions && <span className="mp-acts">{actions}</span>}</div>
        <div id="mp-help" className="ph-panel" hidden={!help}><MonitorHelp status={status} /></div>
        <p className="mp-lede">{!m ? "Answer four questions in plain words. It runs once a Risk Manager approves it."
          : editMode ? draftedLine(m) ?? "Open a line to change it. Nothing runs until a Risk Manager approves it."
          : lede(m, runs, findings, events, now)}</p>
        {m && !editMode && <>
          {waits && <p className="mp-small">In this prototype the person who sent it can also approve it. Who sent and who approved each version is recorded.</p>}
          {sentBack && <p className="mp-note"><span><b>Changes requested:</b> {latest!.note}</span></p>}
          {m.pending && m.live_version && <div className="mp-note"><span>Version {m.pending.version} {m.pending.status === "submitted" ? "waits for approval" : "is being edited, not sent yet"}
            {nextDiff.length ? `; it changes ${listText(nextDiff, 4)}` : ""}. Version {m.live_version} keeps running.</span><MonitorActions m={m} onChange={load} only="pending" /></div>}
          <Progress m={m} runs={runs} findings={findings} status={status} now={now} />
          {role === "platform_admin" && status?.notes.length ? <p className="mp-small mp-warn">{status.notes.join(" ")}</p> : null}
        </>}
      </header>
      {err != null && <LoadError error={err} onRetry={load} what="this monitor" />}

      {editMode ? <MonitorForm key={`${m?.monitor_id ?? "new"}-${formKey}`} m={m} profile={profile} status={status} onSaved={saved}
          onCancel={m ? () => setEditing(false) : undefined} runs={runs} onRun={runNow} running={!!checking} onRetire={() => act("retire")} />
        : m && <>
          {(findings.length > 0 || m.status === "live" || m.status === "paused") && <section className="mp-sec" aria-labelledby="mp-found">
            <h2 id="mp-found">What it found <span>{findings.length}</span><Link className="mp-all" to="/findings">All findings</Link></h2>
            {findings.length ? findings.map(f => <FindingLine key={f.finding_id} f={f} events={events} m={m} />)
              : <p className="mp-sub">Nothing yet. What it finds shows here and goes to the investigation.</p>}</section>}
          <section className="mp-sec" aria-labelledby="mp-watch"><h2 id="mp-watch">What it watches</h2><Watches m={m} profile={profile} /></section>
          <section className="mp-sec" aria-labelledby="mp-checks"><h2 id="mp-checks">Checks <span>{runs.length}</span>
            {m.status !== "retired" && <button type="button" className="mp-all" disabled={!!checking} onClick={runNow}
              title={m.status === "live" ? "Check the news now" : "Test it now; what it finds is kept apart from your real findings"}>
              <Icon name="play" />{checking ? "Checking…" : m.status === "live" ? "Check now" : "Run a test"}</button>}</h2>
            {runs.length ? runs.map((r, i) => <CheckLine key={r.run_id} r={r} prev={runs[i - 1]} />)
              : <p className="mp-sub">No checks yet.{m.status === "live" && m.next_check_at ? ` The first is due ${due(m.next_check_at, now)}.` : m.status === "paused" ? " Resume it to start."
                : " A test shows what it would find, kept apart from your real findings."}</p>}</section>
          <div className="mp-foot">
            <Versions m={m} />
            {m.status !== "retired" && <p className="mp-quiet">{m.status === "live" && <button type="button" onClick={() => act("pause")}>Pause it</button>}
              <button type="button" onClick={() => act("retire")}>Retire it</button><span className="muted">A retired monitor stops checking; what it found stays in Findings.</span></p>}
            {role === "platform_admin" && <TechnicalDetails><FactList items={[["Monitor", <span className="mono">{m.monitor_id}</span>], ["Institution", m.institution_id],
              ["Versions", `live ${m.live_version ?? "none"}, latest ${m.latest_version}`], ["Drafted fields", m.drafted_fields.join(", ") || null],
              ["Created", `${m.created_by} ${dayTime(m.created_at)}`], ["Next check", m.next_check_at ? dayTime(m.next_check_at) : null]]} /></TechnicalDetails>}
          </div>
        </>}
      {drafting && <DraftFromProfile onClose={() => setDrafting(false)} />}
    </div>
  );
}
