import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventRow, type InvestigationStatus, type Run, type Theme } from "../../api/investigation";
import { Icon } from "../../components/Icon";
import { TONE } from "../../api/studio";
import { Banner, Empty, PageHead, useNow, useRole, useToast, InlineSkeleton } from "../../components/ui";
import { ago, dayTime, until, plural, placeName } from "../../format";
import { DAYS, useRecentFindings } from "../findings/recent";

export const themeText = (t: Theme) =>
  `${t.theme}${t.item ? ` (${t.item})` : ""}: ${t.currency ? `${t.currency} ` : ""}${t.direction.replace(/_/g, " ")}`;

const RUN_BADGE: Record<Run["status"], [string, string]> = {
  running: ["b-info", "RUNNING"], completed: ["b-ok", "DONE"], stopped_early: ["b-warn", "STOPPED EARLY"], failed: ["b-down", "FAILED"],
};

export function useInvestigationStatus() {
  const [status, setStatus] = useState<InvestigationStatus | null>(null);
  const reload = useCallback(() => { investigationApi.status().then(setStatus).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { status, reload };
}

export function InvestigateNowButton({ ids, onDone, small }: { ids?: string[]; onDone: () => void; small?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const out = await investigationApi.investigateNow(ids);
      const sent = out.items.reduce((n, r) => n + r.finding_ids.length, 0);
      toast([sent ? `Sent ${plural(sent, "finding")} to the investigation agent.` : "",
             out.developments.length ? `${out.developments.length} joined an open event as the same move continuing (${out.developments[0].event_title}).` : ""]
        .filter(Boolean).join(" "));
      onDone();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  return <button className={`btn${small ? " btn--sm" : " btn--primary"}`} type="button" onClick={go} disabled={busy}>
    <Icon name={busy ? "refresh" : "play"} className={busy ? "spin" : undefined} />Investigate now</button>;
}

function Runs({ runs, onChange }: { runs: Run[]; onChange: () => void }) {
  const toast = useToast();
  const now = useNow(30_000);
  const check = async (r: Run) => {
    try { const x = await investigationApi.collect(r.run_id); toast(x.status === "running" ? "Still running; it's collected on the next tick." : "Collected."); onChange(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  return (
    <div className="card mt16">
      <div className="hd"><h2>Investigation runs</h2><span className="small muted">each run sends a batch of findings to the investigation agent</span></div>
      {!runs.length ? <div className="bd small muted">None yet.</div> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Started</th><th>Run</th><th>Status</th><th>Findings</th><th>Found</th><th>Error</th><th><span className="sr">Actions</span></th></tr></thead>
          <tbody>{runs.map(r => (
            <tr key={r.run_id}>
              <td className="num">{dayTime(r.created_at)}<div className="sub">{ago(r.created_at, now)} · {r.trigger === "now" ? "investigate now" : "tick"}{r.world === "sandbox" ? " · sandbox" : ""}</div></td>
              <td className="mono small">{r.run_id}</td>
              <td><span className={`badge ${RUN_BADGE[r.status][0]}`}>{RUN_BADGE[r.status][1]}</span>{r.attempt > 1 && <div className="sub">attempt {r.attempt}</div>}</td>
              <td className="num">{r.finding_ids.length}</td>
              <td className="small">{r.status === "running" ? "—" : `${plural(r.events ?? 0, "event")}, ${plural(r.hypotheses ?? 0, "effect")}${r.validation ? `, ${plural(r.tasks ?? 0, "task")}` : ""}`}</td>
              <td className="small mono" style={{ color: "var(--critical-ink)", maxWidth: 360 }}>{r.error}</td>
              <td>{r.status === "running" && <button className="btn btn--sm" type="button" onClick={() => check(r)}><Icon name="refresh" />Check now</button>}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function ClearSandbox({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const clear = async () => {
    try { const r = await investigationApi.clearSandbox(); toast(`Cleared ${plural(r.findings, "simulated finding")} and ${plural(r.investigations, "run")}.`); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setAsking(false); }
  };
  return asking ? <span className="row" style={{ gap: 6 }}><span className="small">Remove every simulated finding, run and event?</span>
    <button className="btn btn--danger btn--sm" type="button" onClick={clear}>Clear</button>
    <button className="btn btn--sm" type="button" onClick={() => setAsking(false)}>Cancel</button></span>
    : <button className="btn" type="button" onClick={() => setAsking(true)}><Icon name="trash" />Clear simulated</button>;
}

export function EventsPage() {
  const nav = useNavigate();
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [sim, setSim] = useState(false);  // simulated events (from a series' "Simulate a move") stay out of the live picture unless asked for
  const now = useNow(30_000);
  const { status, reload: reloadStatus } = useInvestigationStatus();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const recent = useRecentFindings();
  const load = useCallback(async () => {
    try {
      const [e, r] = await Promise.all([investigationApi.events(), investigationApi.runs()]);
      setEvents(e); setRuns(r); setErr(null); setLoadedAt(new Date()); reloadStatus();
    } catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
  }, [reloadStatus]);
  const refresh = () => { load(); recent.load(); };
  const inProgress = (recent.items ?? []).filter(f => f.status === "grouped");
  const noEvent = (recent.items ?? []).filter(f => f.status === "set_aside");
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const nSim = (events ?? []).filter(e => e.world !== "live").length;
  const rows = (events ?? []).filter(e => (show === "all" || e.status === show) && (sim || e.world === "live"));
  return (
    <div className="page">
      <PageHead title="Events" sub="Each event is something that happened in the world, traced to your products by the investigation agent."
        actions={<>
          <span className="small muted">Updated {loadedAt ? ago(loadedAt.toISOString(), now) : ""}</span>
          <button className="btn" type="button" onClick={refresh}><Icon name="refresh" />Refresh</button>
          {sim && ((events ?? []).some(e => e.world === "sandbox") || runs.some(r => r.world === "sandbox")) ? <ClearSandbox onDone={load} /> : null}
          {status && status.findings_waiting > 0 && status.connected ? <InvestigateNowButton onDone={refresh} /> : null}
        </>} />
      <div className="banners">
        {err && <Banner kind="crit" icon="warn">{err}</Banner>}
        {admin && status?.notes.map(n => <Banner key={n} kind={status.connected ? "info" : "warn"} icon="info">{n}</Banner>)}
        {!admin && status && !status.connected && <Banner kind="warn" icon="warn">New findings can't be investigated right now: the investigation service isn't connected. Your Platform Admin has been told.</Banner>}
        {status && status.findings_waiting > 0 && (
          <Banner kind="info" icon="info">
            <b>{status.findings_waiting} finding{status.findings_waiting === 1 ? "" : "s"} waiting</b> for investigation.
            {status.next_batch_at && status.connected ? <> The next batch goes {new Date(status.next_batch_at) <= now ? "on the next tick" : `in ${until(status.next_batch_at, now)}`} (findings wait {status.wait_minutes} min for related ones); Investigate now skips the wait.</> : null}
          </Banner>
        )}
      </div>
      {(inProgress.length > 0 || noEvent.length > 0) && <div className="card ev-strip">
        <Icon name="search" className="ico16" />
        <span>{inProgress.length > 0 && <><b>Being investigated: {inProgress.length}</b> ({inProgress[0].title}{inProgress.length > 1 ? ` and ${inProgress.length - 1} more` : ""})</>}
          {inProgress.length > 0 && noEvent.length > 0 && " · "}
          {noEvent.length > 0 && <>Investigated, no event (last {DAYS} days): {noEvent.length}</>}</span>
        <span className="spacer" /><Link className="small" to="/findings">See findings →</Link>
      </div>}
      <div className="row mb wrap" style={{ gap: 12 }}><span className="seg" role="group" aria-label="Which events">{(["open", "closed", "all"] as const).map(x => (
        <button key={x} type="button" aria-pressed={show === x} onClick={() => setShow(x)}>{x[0].toUpperCase() + x.slice(1)}</button>))}</span>
        {nSim > 0 && <label className="check small"><input type="checkbox" checked={sim} onChange={e => setSim(e.target.checked)} /> Also show {plural(nSim, "simulated event")} (from tests; not real)</label>}</div>
      <div className="card mt12">
        {events === null ? <InlineSkeleton /> : !rows.length ? (
          <Empty icon="events" title={show === "open" ? "No open events" : "No events here"} actions={<Link className="btn" to="/studio"><Icon name="studio" />Try a what-if in the Scenario Studio</Link>}>When a market series, a monitor or Radar finds something, the investigation traces it to your products and the event appears here.</Empty>
        ) : (
          <div className="tblwrap"><table className="tbl">
            <thead><tr><th>Event</th><th>When</th><th>Where</th><th>Effects to watch</th><th>Findings</th></tr></thead>
            <tbody>{rows.map(e => (
              <tr key={e.event_id} className="click" onClick={() => nav(`/events/${e.event_id}`)}>
                <td><Link className="strong" to={`/events/${e.event_id}`} onClick={ev => ev.stopPropagation()}>{e.title}</Link>
                  <span className={`badge ${TONE[e.tone][0]}`} style={{ marginLeft: 8 }}>{TONE[e.tone][1]}</span>
                  {e.world !== "live" && <span className="badge b-info" style={{ marginLeft: 8 }}>SIMULATED</span>}
                  {e.status === "closed" && <span className="badge b-noeffect" style={{ marginLeft: 8 }}>CLOSED</span>}
                  <div className="sub">{e.themes.map(themeText).join(" · ")}</div></td>
                <td className="num">{dayTime(e.anchor)}</td>
                <td className="small">{e.places.length ? e.places.map(placeName).join(", ") : e.country === "footprint" ? `${placeName(e.country_code ?? "")} (where you operate)` : e.country === "home" ? "Your home country" : e.country}</td>
                <td className="num">{e.hypotheses ? e.hypotheses : <span className="muted">none</span>}{e.tasks ? <span className="sub"> · {plural(e.tasks, "task")}</span> : null}</td>
                <td className="num">{e.finding_ids.length}{e.developments ? <div className="sub">+{e.developments} joined later</div> : null}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      {admin && <Runs runs={runs} onChange={load} />}
    </div>
  );
}
