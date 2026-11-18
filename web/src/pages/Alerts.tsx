// Alerts: what AMIRI Agent found for each team's products, and who has taken it on.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { alertsApi, type AlertItem, type AlertSummary, type Effect } from "../api/alerts";
import { investigationApi, type EventDetail } from "../api/investigation";
import { HowItWorks, ImpactRow, PageHeader, StatTiles, StatusPill } from "../components/blocks";
import "../styles/daily.css";
import "../styles/polish-daily.css";
import { CheckPill } from "../components/checks";
import { ChipFilter, FlowFilter } from "../components/FlowFilter";
import { Icon } from "../components/Icon";
import { Empty, ListSkeleton, LoadError, useNow, useToast } from "../components/ui";
import { ago, dayTime } from "../format";
import {
  ACTION_MEANS, alertOrder, ALERT_STATUS, checkMove, count, earliest, eventTitle, impactText, LEVEL_LABEL, LEVEL_TONE, listText, longWhen, onDay, relDay, sizeTiming,
  sourceInfo, type VerdictKey,
} from "../plain";

type Show = "new" | "acknowledged" | "resolved" | "all";
const CHANGE: Record<string, string> = {
  raised: "Raised", escalated: "Level raised", acknowledged: "Acknowledged", resolved: "Resolved", reopened: "Reopened",
  confirmed: "Confirmed by your data", withdrawn: "Withdrawn", checked: "Checked against your data",
};

// when AMIRI Agent last raised or escalated it: a person acknowledging it doesn't move it on the page
const changed = (a: AlertItem) => [...a.history].reverse().find(h => h.by === "AMIRI Agent" && h.change !== "resolved")?.at ?? a.created_at;
/** The impact in a few words, with the move your data showed when it was checked. */
function EffectImpact({ e }: { e: Effect }) {
  const m = e.check ? checkMove(e.check.what) : null;
  return <>{impactText(e.metric_name, e.direction)}{m && <span className="ir-move"><b>{m.move}</b> {m.against}</span>}</>;
}
// "Remittance inflow may fall" → "remittance inflow may fall" after the team's name; "FC deposit…" keeps its capitals
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

function AlertCard({ a, next, ev, primary, onChange }: {
  a: AlertItem; next: string | null; ev: EventDetail | undefined; primary: boolean; onChange: (a: AlertItem) => void;
}) {
  const toast = useToast();
  const now = useNow(60_000);
  const [asking, setAsking] = useState<"ack" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: "ack" | "resolve" | "reopen") => {
    setBusy(true);
    try { onChange(await alertsApi.act(a.alert_id, action, note)); setAsking(null); setNote("");
      toast({ ack: "Acknowledged: your team can see you're on it", resolve: "Resolved", reopen: "Back on the review list" }[action]); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  // the impact the alert's level rests on leads; the rest wait in "Why"
  const lead = a.effects.find(e => e.check?.alert === a.level) ?? a.effects[0];
  const move = lead?.check ? checkMove(lead.check.what) : null;
  const products = [...new Set(a.effects.map(e => e.product))];
  const bad = a.effects.filter(e => e.adverse).length;
  const checks = a.effects.filter(e => e.check).map(e => ({ verdict: e.check!.verdict as VerdictKey, alert: e.check!.alert, adverse: e.adverse }));
  const same = new Set(checks.map(c => c.verdict)).size <= 1 && checks.length === a.effects.length;
  const src = a.sources?.[0] ? sourceInfo(a.sources[0]) : null;
  const article = ev?.findings.flatMap(f => f.evidence?.headlines ?? []).find(h => h.url && (!a.top_finding || h.title === a.top_finding));
  const [statusText, statusTone] = ALERT_STATUS[a.status];
  const title = ev ? eventTitle(ev) : a.event_title;
  return (
    <article className={`card alc dl-alc ${a.status !== "new" ? "done" : ""}`} data-lv={a.level} aria-labelledby={`t-${a.alert_id}`}>
      <div className="dl-alc-hd">
        <StatusPill tone={LEVEL_TONE[a.level]} icon={a.level === "adverse" ? "bad" : "alert"}>{LEVEL_LABEL[a.level]}</StatusPill>
        {a.status !== "new" && <StatusPill tone={statusTone}>{statusText}</StatusPill>}
        <span className="spacer" />
        <span className="alc-time" title={longWhen(changed(a))}><Icon name="clock" />{ago(changed(a), now)}</span>
      </div>
      <h2 className="dl-alc-t" id={`t-${a.alert_id}`}><span className="dl-team">{a.owner}</span><span className="dl-dot" aria-hidden="true">·</span>
        <span className="dl-what">{lead ? lower(impactText(lead.metric_name, lead.direction)) : a.title}</span></h2>
      <ul className="dl-alc-meta" aria-label="In short">
        <li><Icon name="box" /><span>{listText(products, 2)}</span></li>
        {move && <li className="dl-move"><Icon name="data" /><span>Your data: <b>{move.move}</b> {move.against}</span></li>}
        {a.effects.length > 1 && <li><Icon name="bad" /><span>{bad === a.effects.length ? `${count(a.effects.length, "impact")}, all bad for you` : `${bad} of ${a.effects.length} impacts bad for you`}</span></li>}
        {next && <li><Icon name="calendar" /><span>{checks.some(c => c.verdict !== "not_yet") ? "Next check" : "First check"} <b>{onDay(next)}</b> <span className="muted">({relDay(next)})</span></span></li>}
      </ul>
      {a.status === "acknowledged" && <div className="alc-note"><Icon name="check" /><span><b>{a.acknowledged_by}</b> is on it{a.acknowledged_at ? `, ${ago(a.acknowledged_at, now)}` : ""}{a.ack_note ? `: “${a.ack_note}”` : ""}</span></div>}
      {a.status === "resolved" && <div className="alc-note"><Icon name="check" /><span>Resolved by <b>{a.resolved_by}</b>{a.resolved_at ? `, ${ago(a.resolved_at, now)}` : ""}{a.resolved_note ? `: “${a.resolved_note}”` : ""}</span></div>}
      {asking ? (
        <div className="dl-alc-act">
          <input className="input" autoFocus aria-label={asking === "ack" ? "A note for your team (optional)" : "Why it's resolved (optional)"}
            placeholder={asking === "ack" ? "A note for your team (optional): who is looking, what next" : "Why it's resolved (optional)"}
            value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") act(asking); }} />
          <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => act(asking)}>{asking === "ack" ? "Acknowledge" : "Resolve"}</button>
          <button className="btn btn--sm" type="button" onClick={() => { setAsking(null); setNote(""); }}>Cancel</button>
        </div>
      ) : (
        <div className="dl-alc-act">
          {a.status === "new" && <button className={`btn btn--sm${primary ? " btn--primary" : ""}`} type="button" title={ACTION_MEANS.ack} onClick={() => setAsking("ack")}><Icon name="check" />Acknowledge</button>}
          {a.status !== "resolved" && <button className="btn btn--sm btn--ghost" type="button" title={ACTION_MEANS.resolve} onClick={() => setAsking("resolve")}>Resolve</button>}
          {a.status !== "new" && <button className="btn btn--sm btn--ghost" type="button" title={ACTION_MEANS.reopen} disabled={busy} onClick={() => act("reopen")}>Reopen</button>}
          <span className="pd-vr" aria-hidden="true" />
          <details className="tech dl-why"><summary>Why AMIRI Agent expects this</summary>
            <div className="tech-bd col gap12">
              <p className="dl-ai"><span className="dl-ai-chip"><b aria-hidden="true">AI</b>AMIRI Agent's assessment</span>
                <span className="muted">Sizes and timing are estimates, checked against your own figures as they're published.</span></p>
              <div className={`alc-impacts irs${same ? "" : " with-status"}`}>{a.effects.map(e => (
                <ImpactRow key={e.hypothesis_id} product={e.product} impact={<EffectImpact e={e} />} adverse={bad === a.effects.length ? undefined : e.adverse} size={sizeTiming(e.size, e.timing)}
                  status={!same && e.check ? <CheckPill c={{ verdict: e.check.verdict as VerdictKey, alert: e.check.alert, adverse: e.adverse }} /> : undefined} />))}
              </div>
              <ul className="alc-why">{a.effects.map(e => <li key={e.hypothesis_id}><b>{e.product}</b>: {e.chain_label}.</li>)}</ul>
              {a.top_finding && <div className="alc-src">{src && <Icon name={src.icon} />}<span>{src ? `${src.label}: ` : ""}{article?.url
                ? <a href={article.url} target="_blank" rel="noreferrer">{a.top_finding}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a>
                : a.top_finding}</span></div>}
              {a.via_monitor && <span className="alc-via">Sent to you because your team owns <Link to={`/monitors/${a.via_monitor}`}>the monitor</Link> that found it</span>}
            </div></details>
          <details className="tech dl-hist"><summary>History ({a.history.length})</summary>
            <div className="tech-bd"><ol className="alc-hist">{[...a.history].reverse().map((h, i) => (
              <li key={i}><b>{CHANGE[h.change] ?? h.change}</b><span>{dayTime(h.at)}{h.by && h.by !== "AMIRI Agent" ? ` · ${h.by}` : ""}</span></li>))}</ol></div></details>
          <span className="spacer" />
          <Link className="dl-ev" to={`/events/${a.event_id}`}><span className="muted">From the event</span> <b>{title}</b>{a.event_status === "closed" && <span className="muted"> (closed)</span>}<Icon name="arrow" /></Link>
        </div>
      )}
    </article>
  );
}

export function AlertsPage() {
  const [show, setShow] = useState<Show>("new");
  const [team, setTeam] = useState("");
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [sum, setSum] = useState<AlertSummary | null>(null);
  const [events, setEvents] = useState<Record<string, EventDetail>>({});
  const [err, setErr] = useState<unknown>(null);
  const load = useCallback(async () => {
    try {
      // the list is the newest 100, so it's asked for one status at a time (older alerts to review still show);
      // the filter's counts come from the summary, which counts them all
      const [s, xs] = await Promise.all([alertsApi.summary(), alertsApi.list({ status: show === "all" ? undefined : show, owner: team || undefined })]);
      setSum(s); setItems(xs); setErr(null);
    } catch (e) { setErr(e); }
  }, [show, team]);
  useEffect(() => setItems(null), [show, team]);  // another filter: wait for its list rather than filter the old one
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  // an alert acted on here leaves a filter it no longer matches at once, before the next load
  const shown = useMemo(() => items && items.filter(a => show === "all" || a.status === show), [items, show]);
  const nAt = (k: Show) => sum?.by_team_status?.filter(r => (!team || r.owner === team) && (k === "all" || r.status === k))
    .reduce((n, r) => n + r.n, 0);
  // each alert's next check is on its event: one request per event on the page
  const eventIds = useMemo(() => [...new Set((shown ?? []).map(a => a.event_id))].sort().join(","), [shown]);
  useEffect(() => {
    if (!eventIds) return;
    let live = true;
    Promise.all(eventIds.split(",").map(id => investigationApi.event(id).then(e => [id, e] as const).catch(() => null)))
      .then(xs => { if (live) setEvents(Object.fromEntries(xs.filter(x => x !== null))); });
    return () => { live = false; };
  }, [eventIds]);
  const nextCheck = (a: AlertItem) => {
    const ev = events[a.event_id];
    if (!ev) return null;
    const hs = new Set(a.effects.map(e => e.hypothesis_id));
    return earliest(ev.tasks.filter(t => hs.has(t.hypothesis_id) && !t.check?.final).map(t => t.next_check_after ?? t.check?.next_check_after));
  };
  const update = (a: AlertItem) => { setItems(xs => (xs ?? []).map(x => (x.alert_id === a.alert_id ? a : x))); alertsApi.summary().then(setSum).catch(() => {});
    window.dispatchEvent(new Event("amiri:alerts")); };

  // one queue, the most serious first (the alert your own data confirms leads), then the latest
  const queue = useMemo(() => [...(shown ?? [])].sort((x, y) => alertOrder({ ...x, at: changed(x) }, { ...y, at: changed(y) })), [shown]);
  const firstNew = queue.find(a => a.status === "new")?.alert_id;
  const s = sum;
  return (
    <div className="page">
      <PageHeader title="Alerts"
        status={!s ? "" : s.to_review ? <><b className="ink">{count(s.to_review, "alert")} waiting for review</b>{s.by_level.adverse ? <>, <b className="dl-crit">{s.by_level.adverse} confirmed by your data</b></> : ""}. Most serious first.</> : "All caught up: nothing waiting for review"}
        help={<HowItWorks>
          <p>An alert goes to the team that owns each product an event could hit. Someone on that team acknowledges it, so everyone knows it's taken on. The most serious alert is at the top; work down the list.</p>
          <div className="row wrap"><StatusPill tone="amber" icon="alert">Early warning</StatusPill><span>AMIRI Agent expects an impact; your data can't tell yet.</span></div>
          <div className="row wrap"><StatusPill tone="amber" icon="alert">Showing early signs</StatusPill><span>Your figures are starting to move the bad way.</span></div>
          <div className="row wrap"><StatusPill tone="red" icon="bad">Confirmed by your data</StatusPill><span>Your own figures show the impact.</span></div>
        </HowItWorks>} />
      {err != null && <LoadError error={err} onRetry={load} what="the alerts" />}
      {s && <StatTiles label="Alerts in short" items={[
        { value: s.to_review, label: "To review", sub: s.to_review ? "acknowledge each one" : "all caught up", tone: s.to_review ? "red" : "green", icon: "alert" },
        { value: s.teams.length, label: s.teams.length === 1 ? "Team with alerts waiting" : "Teams with alerts waiting", sub: s.teams.length ? listText(s.teams.map(t => t.owner)) : "none", tone: s.teams.length ? "amber" : "grey", icon: "users" },
        { value: s.acknowledged_week, label: "Acknowledged this week", sub: "by your Risk Managers", tone: "blue", icon: "check" },
      ]} />}

      {(items !== null || err == null) && <div className="filters">
        <FlowFilter label="Which alerts" value={show} onChange={setShow} all={{ key: "all", label: "All", count: nAt("all") }}
          steps={([["new", "To review"], ["acknowledged", "Acknowledged"], ["resolved", "Resolved"]] as const).map(([key, label]) => ({ key, label, count: nAt(key) }))} />
        {s && s.all_teams.length > 1 && <ChipFilter label="Team" value={team} onChange={t => setTeam(t)}
          options={[{ key: "", label: "All teams" }, ...s.all_teams.map(t => ({ key: t, label: t, count: s.teams.find(x => x.owner === t)?.to_review }))]} />}
      </div>}

      {shown === null ? (err == null && <div className="mt12"><ListSkeleton rows={3} /></div>)
        : !shown.length ? <div className="card mt12"><Empty icon="check" title={show === "new" ? "All caught up" : "Nothing here"}
          actions={show === "new" ? <Link className="btn" to="/events"><Icon name="events" />See events</Link> : undefined}>
          {show === "new" ? "When an event could hit your products, the owning team's alert appears here." : "No alerts in this group."}</Empty></div>
        : <div className="col gap12 mt12">{queue.map(a => <AlertCard key={a.alert_id} a={a} next={nextCheck(a)} ev={events[a.event_id]} primary={a.alert_id === firstNew} onChange={update} />)}</div>}
    </div>
  );
}
