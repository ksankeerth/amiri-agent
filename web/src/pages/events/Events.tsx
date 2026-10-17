import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventDetail, type EventRow, type InvestigationStatus, type Run, type Theme } from "../../api/investigation";
import { HowItWorks, PageHeader, Places, StatTiles, TonePill } from "../../components/blocks";
import { CheckBrief } from "../../components/checks";
import { Icon } from "../../components/Icon";
import { Banner, Empty, useNow, useRole, useToast, InlineSkeleton } from "../../components/ui";
import { ago, dayTime, until, plural } from "../../format";
import { count, longWhen, sourceInfo, themeLabel } from "../../plain";
import { DAYS, useRecentFindings } from "../findings/recent";

/** A theme tag in words ("Oil prices up"): the Overview and Radar use it too. */
export const themeText = (t: Theme) => themeLabel(t);

const details = new Map<string, EventDetail>();
/** Each listed event's detail (its checks), fetched once per page load and kept while the page is open. */
export function useEventDetails(ids: string[]): Record<string, EventDetail> {
  const [, bump] = useState(0);
  const key = ids.join(",");
  useEffect(() => {
    const todo = ids.filter(id => !details.has(id)).slice(0, 30);
    if (!todo.length) return;
    let live = true;
    Promise.all(todo.map(id => investigationApi.event(id).then(e => { details.set(id, e); }).catch(() => {})))
      .then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return Object.fromEntries(ids.filter(id => details.has(id)).map(id => [id, details.get(id)!]));
}

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
      <div className="hd"><h2>Investigation runs</h2><span className="small muted">for the Platform Admin: each run sends a batch of findings to the investigation agent</span></div>
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

type Sort = "newest" | "impacts";
export function EventsPage() {
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [sort, setSort] = useState<Sort>("newest");
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
  const rows = useMemo(() => (events ?? []).filter(e => (show === "all" || e.status === show) && (sim || e.world === "live"))
    .sort((a, b) => sort === "impacts" ? b.hypotheses - a.hypotheses || (a.anchor < b.anchor ? 1 : -1) : (a.anchor < b.anchor ? 1 : -1)), [events, show, sim, sort]);
  const ev = useEventDetails(rows.map(e => e.event_id));
  // the headline each event came from: its first finding, when it's among the recent ones
  const lead = useMemo(() => new Map((recent.items ?? []).filter(f => f.outcome?.event_id).map(f => [f.outcome!.event_id!, f])), [recent.items]);
  const live = (events ?? []).filter(e => e.world === "live");
  const open = live.filter(e => e.status === "open");
  const bad = open.filter(e => e.tone === "bad" || e.tone === "mixed").length;
  return (
    <div className="page">
      <PageHeader title="Events"
        status={events === null ? "" : open.length ? <><b className="ink">{count(open.length, "open event")}</b>{bad ? `, ${bad} bad for you` : ""}</> : "No open events right now"}
        actions={<>
          <span className="small muted">Updated {loadedAt ? ago(loadedAt.toISOString(), now) : ""}</span>
          <button className="btn" type="button" onClick={refresh}><Icon name="refresh" />Refresh</button>
          {sim && ((events ?? []).some(e => e.world === "sandbox") || runs.some(r => r.world === "sandbox")) ? <ClearSandbox onDone={load} /> : null}
          {status && status.findings_waiting > 0 && status.connected ? <InvestigateNowButton onDone={refresh} /> : null}
        </>}
        help={<HowItWorks><p>An event is something that happened in the world, traced to the products it could hit. It stays open while news about it keeps coming, then closes.</p></HowItWorks>} />
      <div className="banners">
        {err && <Banner kind="crit" icon="warn">{err}</Banner>}
        {admin && status?.notes.map(n => <Banner key={n} kind={status.connected ? "info" : "warn"} icon="info">{n}</Banner>)}
        {!admin && status && !status.connected && <Banner kind="warn" icon="warn">New findings can't be investigated right now. Your Platform Admin has been told.</Banner>}
        {status && status.findings_waiting > 0 && (
          <Banner kind="info" icon="info">
            <b>{plural(status.findings_waiting, "finding")} waiting</b> to be investigated
            {status.next_batch_at && status.connected ? <>, {new Date(status.next_batch_at) <= now ? "very soon" : `in ${until(status.next_batch_at, now)}`}. Investigate now skips the wait.</> : "."}
          </Banner>
        )}
      </div>
      {events !== null && <StatTiles label="Events in short" items={[
        { value: open.length, label: "Open events", sub: open.length ? "news still coming in" : "none right now", tone: open.length ? "blue" : "grey", icon: "events" },
        { value: bad, label: "Bad for you", sub: "open events", tone: bad ? "red" : "grey", icon: "bad" },
        { value: inProgress.length, label: "Being investigated", sub: inProgress.length ? inProgress[0].title : "nothing right now", tone: inProgress.length ? "blue" : "grey", icon: "search" },
        { value: noEvent.length, label: "No impact found", sub: `last ${DAYS} days`, tone: "grey", icon: "check" },
      ]} />}
      <div className="filters">
        <span className="seg" role="group" aria-label="Which events">{(["open", "closed", "all"] as const).map(x => (
          <button key={x} type="button" aria-pressed={show === x} onClick={() => setShow(x)}>{x[0].toUpperCase() + x.slice(1)}</button>))}</span>
        <label className="sortby small">Sort <select className="input" value={sort} onChange={e => setSort(e.target.value as Sort)}>
          <option value="newest">Newest first</option><option value="impacts">Most possible impacts</option></select></label>
        {nSim > 0 && <label className="check small"><input type="checkbox" checked={sim} onChange={e => setSim(e.target.checked)} /> Also show {plural(nSim, "simulated event")} (from tests; not real)</label>}
        <span className="spacer" />
        {(inProgress.length > 0 || noEvent.length > 0) && <Link className="small" to="/findings">See all findings</Link>}
      </div>
      <div className="card mt12">
        {events === null ? <InlineSkeleton /> : !rows.length ? (
          <Empty icon="events" title={show === "open" ? "No open events" : "No events here"} actions={<Link className="btn" to="/studio"><Icon name="studio" />Try a what-if in the Scenario Studio</Link>}>
            When Amiri Agent traces news or a price move to your products, the event appears here.</Empty>
        ) : (
          <ul className="evlist" aria-label="Events">{rows.map(e => {
            const f = lead.get(e.event_id), si = f ? sourceInfo(f.source) : null;
            return (
              <li key={e.event_id}>
                <Link className="evrow" to={`/events/${e.event_id}`}>
                  <span className={`evrow-ico tone-${e.tone}`}><Icon name="events" /></span>
                  <span className="evrow-main">
                    <span className="row-top"><b className="row-l">{e.title}</b><TonePill tone={e.tone} />
                      {e.world !== "live" && <span className="pill t-blue">Simulated</span>}
                      {e.status === "closed" && <span className="pill t-grey">Closed</span>}</span>
                    {f && <span className="evrow-src">{si && <Icon name={si.icon} />}<span>{f.title}</span></span>}
                    <span className="evrow-tags">{e.themes.map((t, i) => <span key={i} className="chip">{themeLabel(t)}</span>)}
                      {e.places.length > 0 && <span className="evrow-where"><Icon name="pin" /><Places codes={e.places} max={2} /></span>}</span>
                  </span>
                  <span className="evrow-side">
                    <span className="evrow-n"><b>{e.hypotheses}</b> {e.hypotheses === 1 ? "possible impact" : "possible impacts"}</span>
                    <CheckBrief e={ev[e.event_id]} />
                    <span className="evrow-when" title={longWhen(e.anchor)}>{dayTime(e.anchor)}</span>
                  </span>
                  <Icon name="chevron" className="row-go" />
                </Link>
              </li>);
          })}</ul>
        )}
      </div>
      {admin && <Runs runs={runs} onChange={load} />}
    </div>
  );
}
