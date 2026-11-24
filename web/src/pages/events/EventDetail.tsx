// One event, read top to bottom: when, bad or good for you, the answer in a sentence and where it has got to; then why it
// matters by the team that has each impact, what happened, what was set aside, and the report. Detail opens in place.
import { useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventDetail } from "../../api/investigation";
import { alertsApi, type AlertItem } from "../../api/alerts";
import { FactList, HowItWorks, PageHeader, TechnicalDetails, TonePill } from "../../components/blocks";
import { CheckPill } from "../../components/checks";
import { Icon } from "../../components/Icon";
import { Empty, LoadError, PageSkeleton, useRole } from "../../components/ui";
import { dayTime } from "../../format";
import { count, longWhen, onDay } from "../../plain";
import { alertPhrase, derive, forYou, Progress, ProductLines, Report, SetAside, Story, type D } from "./eventParts";
import "../../styles/event-detail.css";

// keyed by the event id: moving to another event starts from loading, and the previous event's answers can't land on it
export function EventDetailPage() {
  const { id = "" } = useParams();
  return <EventLoader key={id} id={id} />;
}

function EventLoader({ id }: { id: string }) {
  const [e, setE] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [alerts, setAlerts] = useState<AlertItem[] | null>(null);
  const [alertsFailed, setAlertsFailed] = useState(false);
  const load = () => investigationApi.event(id).then(x => { setE(x); setErr(null); }).catch(setErr);
  // a failed alerts request is not "no alerts": the page says it couldn't load them and offers to try again
  const loadAlerts = () => alertsApi.list({ event_id: id }).then(x => { setAlerts(x); setAlertsFailed(false); }).catch(() => { setAlerts([]); setAlertsFailed(true); });
  useEffect(() => { load(); loadAlerts(); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  if (err instanceof ApiError && err.status === 404) return (
    <div className="page"><PageHeader title="Event not found" crumbs={<Link to="/events">Events</Link>} />
      <div className="card"><Empty icon="events" title="This event isn't here" actions={<Link className="btn" to="/events">See all events</Link>}>
        It may have been removed when the prototype was reset.</Empty></div></div>);
  if (!e || !alerts) return <div className="page">{err != null ? <><PageHeader title="Event" crumbs={<Link to="/events">Events</Link>} />
    <LoadError error={err} onRetry={load} what="this event" /></> : <PageSkeleton bare />}</div>;
  return <EventPage d={derive(e, alerts, alertsFailed)} retryAlerts={loadAlerts} />;
}

function EventPage({ d, retryAlerts }: { d: D; retryAlerts: () => void }) {
  const { role } = useRole();
  const [help, setHelp] = useState(false);
  const panel = useId();
  const { e } = d, n = e.hypotheses.length;
  const open = e.status === "open";
  return <div className="page evd">
    <header className="evd-head">
      <nav className="crumbs" aria-label="Breadcrumb"><Link to="/events">Events</Link><span aria-hidden="true">/</span><span>{d.title}</span></nav>
      <p className="evd-when"><time dateTime={e.anchor} title={longWhen(e.anchor)}>{dayTime(e.anchor)}</time>
        {n > 0 && <TonePill tone={d.tone} />}{e.world !== "live" && <span className="pill t-blue">Simulated</span>}
        <span>{open ? `Open until ${onDay(e.open_until.slice(0, 10))}` : `Closed${e.closed_at ? ` ${onDay(e.closed_at.slice(0, 10))}` : ""}`}</span>
        <button type="button" className="ph-help" aria-expanded={help} aria-controls={panel} onClick={() => setHelp(h => !h)}><Icon name="help" />How this works</button></p>
      <div className="evd-h1row"><h1>{d.title}</h1>
        {d.toReview > 0 && <Link className="btn btn--primary" to="/alerts"><Icon name="alert" />Review {count(d.toReview, "alert")}</Link>}</div>
      <div id={panel} className="ph-panel" hidden={!help}><HowItWorks><p>{open
        ? <>This event stays open until <b>{dayTime(e.open_until)}</b>: new news about the same thing joins it instead of starting a new one.</>
        : <>This event closed {e.closed_at ? dayTime(e.closed_at) : ""}: nothing new about it came in for a while.</>}</p></HowItWorks></div>
      <p className="evd-lede">{n ? <><span className="ev-n">{count(n, "possible impact")}</span> on <b>{count(d.products.length, "product")}</b>{forYou(d) && `, ${forYou(d)}`}.{" "}
        {!d.alertsFailed && d.teams.length > 0 && <><b>{count(d.teams.length, "team")}</b> {d.teams.length === 1 ? "has" : "have"} an alert
          {d.toReview === d.alerts.length ? `; ${d.alerts.length === 1 ? "not" : "none"} taken on yet` : d.toReview ? `; ${d.toReview} still to review` : ", all taken on"}.</>}</>
        : <>Nothing in it reaches your products. {open ? "It closes on its own when the news stops." : ""}</>}</p>
      <Progress d={d} />
      {e.world !== "live" && <p className="evd-sim"><Icon name="info" />Simulated: this event came from a test move, not real news. It stays out of the live picture.</p>}
    </header>

    {n > 0 && <section className="evd-sec" aria-labelledby="evd-why">
      <h2 id="evd-why">Why it matters to you, by team <span>{n}</span><Link className="evd-all" to="/alerts">All alerts</Link></h2>
      {d.alertsFailed && <p className="evd-once evd-fail"><Icon name="warn" />The alerts for this event couldn't be loaded, so the impacts aren't grouped by team.
        <button type="button" className="evd-retry" onClick={retryAlerts}>Try again</button></p>}
      {d.onePhrase && <p className="evd-once">{d.teams.length === 1 ? "The team has" : "Each team has"} {d.onePhrase}.</p>}
      {d.teams.map(t => <div key={t.owner} className="evd-team">
        <h3><Link to="/alerts">{t.owner}<Icon name="arrow" /></Link>
          {!d.onePhrase && <span className="evd-st">{[...new Set(t.alerts.map(alertPhrase))].join("; ")}</span>}</h3>
        <ProductLines d={d} hs={t.hs} /></div>)}
      {d.free.length > 0 && (d.alertsFailed ? <ProductLines d={d} hs={d.free} /> : <div className="evd-team"><h3>No team alerted</h3><ProductLines d={d} hs={d.free} /></div>)}
      <p className="evd-sub">AMIRI Agent's assessment: expectations, not facts yet{d.validation ? "; each is checked against your own figures as they're published" : ""}.
        {d.validation && d.same && d.checked > 0 && <span className="evd-shared">Your data so far, for all of them: <CheckPill c={d.checks[0]} /></span>}</p>
    </section>}

    <section className="evd-sec" aria-labelledby="evd-what"><h2 id="evd-what">What happened</h2><Story d={d} /></section>
    {e.set_aside.length > 0 && <section className="evd-sec" aria-labelledby="evd-set"><h2 id="evd-set">Considered, no impact <span>{e.set_aside.length}</span></h2><SetAside d={d} /></section>}

    <div className="evd-foot"><Report d={d} />
      {role === "platform_admin" && <TechnicalDetails><FactList items={[["Event", <span className="mono">{e.event_id}</span>],
        ["Investigation", <span className="mono">{e.run.run_id}</span>],
        ["Findings", <span className="mono">{e.findings.map(f => `${f.finding_id} (score ${f.score})`).join(", ")}</span>],
        ["Places", <span className="mono">{e.places.join(", ")}</span>], ["Open until", dayTime(e.open_until)]]} /></TechnicalDetails>}</div>
  </div>;
}
