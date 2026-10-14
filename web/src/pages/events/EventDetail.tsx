import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventDetail } from "../../api/investigation";
import { Markdown } from "../../components/markdown";
import { alertsApi, LEVEL, type AlertItem } from "../../api/alerts";
import { Banner, Empty, PageHead, PageSkeleton } from "../../components/ui";
import { dayTime, placeName } from "../../format";
import { themeText } from "./Events";

const TIMING: Record<string, string> = { days: "within days", weeks: "within weeks", months: "within months" };

export function EventDetailPage() {
  const { id = "" } = useParams();
  const [e, setE] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<ApiError | string | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  useEffect(() => { investigationApi.event(id).then(setE).catch(x => setErr(x instanceof ApiError ? x : String(x))); }, [id]);
  useEffect(() => { alertsApi.list({ event_id: id }).then(setAlerts).catch(() => setAlerts([])); }, [id]);
  if (err instanceof ApiError && err.status === 404) return (
    <div className="page"><PageHead title="Event not found" crumbs={<Link to="/events">Events</Link>} />
      <div className="card"><Empty icon="events" title={`No event “${id}”`} actions={<Link className="btn" to="/events">Events</Link>} /></div></div>);
  if (!e) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err instanceof ApiError ? err.full : err}</Banner> : <PageSkeleton bare />}</div>;
  const tasks = new Map(e.tasks.map(t => [t.hypothesis_id, t]));
  return (
    <div className="page">
      <PageHead crumbs={<><Link to="/events">Events</Link><span>/</span><span>{e.title}</span></>}
        title={<span className="row" style={{ gap: 10 }}>{e.title}{e.world !== "live" && <span className="badge b-info">SIMULATED</span>}
          <span className={`badge ${e.status === "open" ? "b-info" : "b-noeffect"}`}>{e.status === "open" ? "OPEN" : "CLOSED"}</span></span>}
        sub={<>{dayTime(e.anchor)} · {e.country === "footprint" ? `${placeName(e.country_code ?? "")}, where you operate` :
          e.country === "home" ? (e.country_name ?? "your home country") : e.country}
          {e.places.filter(p => placeName(p) !== e.country_name).length ? ` · ${e.places.filter(p => placeName(p) !== e.country_name).map(placeName).join(", ")}` : ""} · {e.themes.map(themeText).join(" · ")}</>} />
      <div className="banners">
        <Banner kind="info" icon="info">{e.status === "open"
          ? <>Open until {dayTime(e.open_until)}: a new finding about the same move joins it as a development.</>
          : <>Closed {e.closed_at ? dayTime(e.closed_at) : ""}: no new finding about the same move for a while.</>}</Banner>
        {!e.run.validation && <Banner kind="info" icon="info">These are the effects to watch: where the investigation expects your numbers to move. They aren't checked against your own data yet.</Banner>}
      </div>
      <div className="grid2" style={{ gridTemplateColumns: "3fr 2fr", alignItems: "start" }}>
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="hd"><h2>What could be affected</h2><span className="small muted">by code from the investigation tracks; the model only chose among them</span></div>
            {!e.hypotheses.length ? <div className="bd small muted">No product is exposed through the tracks.</div> : (
              <div className="bd col" style={{ gap: 12 }}>{e.hypotheses.map(h => {
                const t = tasks.get(h.hypothesis_id);
                return (
                  <div key={h.hypothesis_id} className="col" style={{ gap: 4 }}>
                    <div className="row"><b>{h.product_name ?? h.product_id}</b><span className="chip">{h.product_type.replace(/_/g, " ")} · {h.angle.replace(/_/g, " ")}</span></div>
                    <div>{h.chain_label}.</div>
                    <div className="small muted">Watch <b>{h.expected.metric.replace(/_/g, " ")}</b>{h.segment ? ` (${h.segment.dimension.replace(/_/g, " ")}: ${h.segment.value})` : ""}: expected to {h.expected.direction} {TIMING[h.expected.timing] ?? h.expected.timing}.
                      {t ? <> Task <span className="mono">{t.task_id}</span>{t.watch ? ` checks ${t.watch.from} to ${t.watch.until}` : ""}.{t.scope_note ? ` ${t.scope_note}` : ""}</> : null}</div>
                  </div>);
              })}</div>
            )}
          </div>
          {alerts.length > 0 && (
            <div className="card">
              <div className="hd"><h2>Alerts it raised</h2><span className="spacer" /><Link className="small" to="/alerts">All alerts →</Link></div>
              <div className="list">{alerts.map(a => (
                <div key={a.alert_id} className="li"><div className="col" style={{ gap: 3, flex: 1 }}>
                  <div className="row wrap" style={{ gap: 8 }}><span className={`badge ${LEVEL[a.level][0]}`}>{LEVEL[a.level][1]}</span><span className="chip">{a.owner}</span>
                    <span className="small muted">{a.status === "new" ? "to review" : a.status}{a.status === "acknowledged" && a.acknowledged_by ? ` by ${a.acknowledged_by}` : ""}</span></div>
                  <span>{a.title}</span></div></div>))}</div>
            </div>
          )}
          {e.set_aside.length > 0 && (
            <div className="card">
              <div className="hd"><h2>Considered and set aside</h2></div>
              <div className="bd col small" style={{ gap: 6 }}>{e.set_aside.map((s, i) => (
                <div key={i}><b>{s.product_type.replace(/_/g, " ")}, {s.angle.replace(/_/g, " ")}</b>: {s.reason}</div>))}</div>
            </div>
          )}
          <div className="card">
            <div className="hd"><h2>The investigation</h2><span className="small muted">readable report, built by code from the run <span className="mono">{e.run.run_id}</span></span></div>
            <div className="bd">{e.run.report ? <Markdown text={e.run.report} /> : <span className="muted small">No report.</span>}</div>
          </div>
        </div>
        <div className="card">
          <div className="hd"><h2>Findings</h2><span className="small muted">{e.findings.length}{e.developments.length ? ` + ${e.developments.length} later` : ""}</span></div>
          <div className="bd col" style={{ gap: 12 }}>{e.findings.map(f => (
            <div key={f.finding_id} className="col" style={{ gap: 4 }}>
              <b>{f.title}</b>
              <div className="small">{f.explanation}</div>
              <div className="row wrap small muted" style={{ gap: 8 }}>
                <span>{f.source}</span><span>score {f.score}</span>{f.themes.map(t => <span key={t.theme} className="chip">{themeText(t)}</span>)}
                <span className="mono">{f.finding_id}</span>
              </div>
            </div>))}
            {e.developments.length > 0 && <>
              <div className="label mt8">Later: the same move continuing</div>
              {e.developments.map(d => (
                <div key={d.finding_id} className="col" style={{ gap: 2 }}>
                  <b className="small">{d.title}</b>
                  <span className="small muted">joined {dayTime(d.joined_at)} · {d.reason}</span>
                </div>))}
            </>}</div>
        </div>
      </div>
    </div>
  );
}
