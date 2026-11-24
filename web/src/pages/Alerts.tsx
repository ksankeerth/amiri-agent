// Alerts, by event: the headline says how many teams have an alert waiting and where they came from; each event is said once, as a
// section, with one line per team under it. A line opens why AMIRI Agent expects it and what changed; Acknowledge opens a note in
// place, with the why still open beside it. Taken-on alerts fold away at the end of All.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { alertsApi, type AlertItem, type AlertSummary, type Effect } from "../api/alerts";
import { investigationApi, type EventDetail } from "../api/investigation";
import { HowItWorks, PageHeader, StatusPill } from "../components/blocks";
import "../styles/daily.css";
import "../styles/polish-daily.css";
import "../styles/alerts.css";
import { FlowFilter } from "../components/FlowFilter";
import { Icon } from "../components/Icon";
import { Empty, ListSkeleton, LoadError, useNow, useToast } from "../components/ui";
import { ago, dayTime } from "../format";
import {
  ACTION_MEANS, alertOrder, checkMove, count, earliest, eventTitle, impactText, LEVEL_LABEL, LEVEL_TONE, listText, onDay, relDay, sizeTiming, sourceInfo,
} from "../plain";

type Show = "new" | "acknowledged" | "resolved" | "all";
const CHANGE: Record<string, string> = {
  raised: "Raised", escalated: "More evidence", acknowledged: "Acknowledged", resolved: "Resolved", reopened: "Reopened",
  confirmed: "Confirmed by your data", withdrawn: "Withdrawn", checked: "Checked against your data",
};

// the agent's own entries: alerts saved before the rename say "Amiri Agent", so both spellings count
const AGENT = "AMIRI Agent";
const isAgent = (by: string | null | undefined) => (by ?? "").toLowerCase() === AGENT.toLowerCase();
// when AMIRI Agent last raised or escalated it: a person acknowledging it doesn't move it on the page
const changed = (a: AlertItem) => [...a.history].reverse().find(h => isAgent(h.by) && h.change !== "resolved")?.at ?? a.created_at;
// "Remittance inflow may fall" → "remittance inflow may fall" after the team's name; "FC deposit…" keeps its capitals
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
// the impact the alert's level rests on leads
const lead = (a: AlertItem) => a.effects.find(e => e.check?.alert === a.level) ?? a.effects[0];
const what = (a: AlertItem) => { const e = lead(a); return e ? lower(impactText(e.metric_name, e.direction)) : a.title; };

/** The history in runs: "More evidence 11 times, last 23 Nov 06:30" rather than eleven lines that say the same. */
function runs(a: AlertItem) {
  const out: { change: string; by: string; n: number; at: string; text: string }[] = [];
  for (const h of a.history) {
    const by = isAgent(h.by) ? "" : h.by ?? "", last = out[out.length - 1];
    if (last && last.change === h.change && last.by === by) { last.n++; last.at = h.at; last.text = h.text; }
    else out.push({ change: h.change, by, n: 1, at: h.at, text: h.text });
  }
  return out.reverse();
}

function Impact({ e }: { e: Effect }) {
  const m = e.check ? checkMove(e.check.what) : null;
  return <li><b>{e.product}</b>: {lower(impactText(e.metric_name, e.direction))}, because {lower(e.chain_label)}.
    <span className="muted"> {sizeTiming(e.size, e.timing)}.</span>{m && <span className="ap-move"> Your data: <b>{m.move}</b> {m.against}.</span>}</li>;
}

function AlertLine({ a, ev, label, primary, onChange }: { a: AlertItem; ev?: EventDetail; label: boolean; primary: boolean; onChange: (a: AlertItem) => void }) {
  const toast = useToast();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
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
  const products = [...new Set(a.effects.map(e => e.product))];
  const src = a.sources?.[0] ? sourceInfo(a.sources[0]) : null;
  const article = ev?.findings.flatMap(f => f.evidence?.headlines ?? []).find(h => h.url && (!a.top_finding || h.title === a.top_finding));
  const id = `al-${a.alert_id}`;
  return (
    <li className={`ap-line ${a.status}`} id={id}>
      <span className="ap-team">{a.owner}</span>
      <button type="button" className="ap-t" aria-expanded={open} aria-controls={`${id}-x`} onClick={() => setOpen(!open)}><span className="ap-w">{what(a)}</span>
        <span className="ap-sub">{listText(products, 2)}{a.effects.length > 1 ? ` · ${count(a.effects.length, "impact")}` : ""}</span></button>
      <span className="ap-end">
        {label && <StatusPill tone={LEVEL_TONE[a.level]} icon={a.level === "adverse" ? "bad" : "alert"}>{LEVEL_LABEL[a.level]}</StatusPill>}
        {asking ? <span className="ap-act">
          <input className="input" autoFocus aria-label={asking === "ack" ? "A note for your team (optional)" : "Why it's resolved (optional)"}
            placeholder={asking === "ack" ? "A note for your team (optional)" : "Why it's resolved (optional)"}
            value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") act(asking); if (e.key === "Escape") { setAsking(null); setNote(""); } }} />
          <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => act(asking)}>{asking === "ack" ? "Acknowledge" : "Resolve"}</button>
          <button className="btn btn--sm btn--ghost" type="button" onClick={() => { setAsking(null); setNote(""); }}>Cancel</button>
        </span> : <span className="ap-act">
          {a.status === "new" && <button className={`btn btn--sm${primary ? " btn--primary" : ""}`} type="button" title={ACTION_MEANS.ack} onClick={() => setAsking("ack")}><Icon name="check" />Acknowledge</button>}
          {a.status !== "resolved" && <button className="btn btn--sm btn--ghost" type="button" title={ACTION_MEANS.resolve} onClick={() => setAsking("resolve")}>Resolve</button>}
          {a.status !== "new" && <button className="btn btn--sm btn--ghost" type="button" title={ACTION_MEANS.reopen} disabled={busy} onClick={() => act("reopen")}>Reopen</button>}
        </span>}
      </span>
      {a.status === "acknowledged" && <p className="ap-done"><Icon name="check" /><span><b>{a.acknowledged_by}</b> is on it{a.acknowledged_at ? `, ${ago(a.acknowledged_at, now)}` : ""}{a.ack_note ? `: “${a.ack_note}”` : ""}</span></p>}
      {a.status === "resolved" && <p className="ap-done ok"><Icon name="check" /><span>Resolved by <b>{isAgent(a.resolved_by) ? AGENT : a.resolved_by}</b>{a.resolved_at ? `, ${ago(a.resolved_at, now)}` : ""}{a.resolved_note ? `: “${a.resolved_note}”` : ""}</span></p>}
      {open && <div className="ap-x" id={`${id}-x`}>
        <h3>Why AMIRI Agent expects this</h3>
        <p className="dl-ai"><span className="dl-ai-chip"><b aria-hidden="true">AI</b>AMIRI Agent's assessment</span>
          <span className="muted">Sizes and timing are estimates, checked against your own figures as they're published.</span></p>
        <ul className="ap-why">{a.effects.map(e => <Impact key={e.hypothesis_id} e={e} />)}</ul>
        {a.top_finding && <p className="ap-src">{src && <Icon name={src.icon} />}<span>It started from {src ? `${src.label}: ` : ""}{article?.url
          ? <a href={article.url} target="_blank" rel="noreferrer">{a.top_finding}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a>
          : a.top_finding}</span></p>}
        {a.via_monitor && <p className="muted">Sent to you because your team owns <Link to={`/monitors/${a.via_monitor}`}>the monitor</Link> that found it.</p>}
        <h3>What changed</h3>
        <ol className="ap-hist">{runs(a).map((r, i) => <li key={i}><b>{CHANGE[r.change] ?? r.change}{r.n > 1 ? ` ${r.n} times` : ""}</b>
          <span>{r.n > 1 ? "last " : ""}{dayTime(r.at)}{r.by ? ` · ${r.by}` : ""}</span></li>)}</ol>
      </div>}
    </li>
  );
}

export function AlertsPage() {
  const [show, setShow] = useState<Show>("new");
  const [team, setTeam] = useState("");
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [sum, setSum] = useState<AlertSummary | null>(null);
  const [events, setEvents] = useState<Record<string, EventDetail>>({});
  const [err, setErr] = useState<unknown>(null);
  const [taken, setTaken] = useState(false);  // the taken-on section of All, unfolded
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
  const nAt = (k: Show, owner = team) => sum?.by_team_status?.filter(r => (!owner || r.owner === owner) && (k === "all" || r.status === k)).reduce((n, r) => n + r.n, 0);
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
  const evName = (a: AlertItem) => (events[a.event_id] ? eventTitle(events[a.event_id]) : a.event_title);

  // the most serious first (the alert your own data confirms leads), then the latest; in All, taken-on ones fold away at the end
  const queue = useMemo(() => [...(shown ?? [])].sort((x, y) => alertOrder({ ...x, at: changed(x) }, { ...y, at: changed(y) })), [shown]);
  const open = show === "all" ? queue.filter(a => a.status === "new") : queue;
  const done = show === "all" ? queue.filter(a => a.status !== "new") : [];
  const groups = useMemo(() => { const m = new Map<string, AlertItem[]>(); open.forEach(a => m.set(a.event_id, [...(m.get(a.event_id) ?? []), a])); return [...m.values()]; }, [open]);
  const levels = new Set(open.map(a => a.level));
  const firstNew = open.find(a => a.status === "new")?.alert_id;

  const s = sum;
  const waiting = open.filter(a => a.status === "new");
  // all early warnings: the headline says so once, and the lines leave the label out; any other mix keeps it on every line
  const allEarly = waiting.length > 0 && levels.size === 1 && levels.has("warning");
  const teams = new Set(waiting.map(a => a.owner)).size;
  const first = earliest(waiting.map(nextCheck));
  const adverse = waiting.filter(a => a.level === "adverse").length;
  const g0 = waiting[0];
  const headline = !s ? "Alerts" : !s.to_review ? "All caught up"
    : team && (show === "new" || show === "all") ? <><span className="ap-n">{count(waiting.length, "alert")}</span> waiting for {team}</>
    : show === "new" || show === "all" ? <><span className="ap-n">{count(teams || s.teams.length, "team")}</span> {(teams || s.teams.length) === 1 ? "has" : "have"} an alert waiting</>
    : <>{count(s.to_review, "alert")} waiting for review</>;
  const status = !s ? "" : !s.to_review ? "Nothing is waiting for review." : !waiting.length ? "Choose To review to see them." : <>
    {new Set(waiting.map(a => a.event_id)).size === 1 && g0 ? <>All from <Link className="ap-ev" to={`/events/${g0.event_id}`}>{evName(g0)}</Link></>
      : <>From {count(new Set(waiting.map(a => a.event_id)).size, "event")}</>}
    {adverse ? <>; <b className="dl-crit">{adverse} confirmed by your data</b>, shown first.</>
      : allEarly ? <>, and all are early warnings: AMIRI Agent expects the impact, your data can't show it yet.</> : "."}
    {first && <> The first check against your figures is <b>{onDay(first)}</b> ({relDay(first)}).</>}</>;

  const section = (k: string, g: AlertItem[]) => {
    const a0 = g[0], latest = g.map(changed).reduce((x, y) => (Date.parse(y) > Date.parse(x) ? y : x));  // a0 is the most serious, not the latest
    return <section key={k} aria-labelledby={`ap-${k}`}>
    <h2 id={`ap-${k}`}><Link to={`/events/${a0.event_id}`}>{evName(a0)}</Link> <span>{count(g.length, "alert")}</span>{a0.event_status === "closed" && <span>· closed</span>}</h2>
    <p className="ap-sub2">Raised {onDay(a0.created_at)}{a0.top_finding ? <>, from “{a0.top_finding}”</> : null}. Last new evidence {dayTime(latest)}.</p>
    <ol className="ap-lines">{g.map(a => <AlertLine key={a.alert_id} a={a} ev={events[a.event_id]} label={!allEarly} primary={a.alert_id === firstNew} onChange={update} />)}</ol>
  </section>; };

  return (
    <div className="page ap">
      <PageHeader eyebrow="Alerts" title={headline} status={status}
        help={<HowItWorks>
          <p>An alert goes to the team that owns each product an event could hit. Someone on that team acknowledges it, so everyone knows it's taken on. The most serious alert is at the top; work down the list.</p>
          <div className="row wrap"><StatusPill tone="amber" icon="alert">Early warning</StatusPill><span>AMIRI Agent expects an impact; your data can't tell yet.</span></div>
          <div className="row wrap"><StatusPill tone="amber" icon="alert">Showing early signs</StatusPill><span>Your figures are starting to move the bad way.</span></div>
          <div className="row wrap"><StatusPill tone="red" icon="bad">Confirmed by your data</StatusPill><span>Your own figures show the impact.</span></div>
        </HowItWorks>} />
      {err != null && <LoadError error={err} onRetry={load} what="the alerts" />}

      {(items !== null || err == null) && <div className="filters ap-filters">
        <FlowFilter toned label="Which alerts" value={show} onChange={setShow} all={{ key: "all", label: "All", count: nAt("all") }}
          steps={([["new", "To review", "queued"], ["acknowledged", "Acknowledged", "held"], ["resolved", "Resolved", "done"]] as const)
            .map(([key, label, state]) => ({ key, label, count: nAt(key), state }))} />
        {s && s.all_teams.length > 1 && <select className="input ap-team-sel" aria-label="Filter by team" value={team} onChange={e => setTeam(e.target.value)}>
          <option value="">All teams ({nAt(show, "")})</option>
          {s.all_teams.map(t => <option key={t} value={t}>{t} ({nAt(show, t)})</option>)}</select>}
      </div>}

      {shown === null ? (err == null && <div className="mt12"><ListSkeleton rows={3} /></div>)
        : !shown.length ? <Empty icon="check" title={show === "new" ? "All caught up" : "Nothing here"}
          actions={show === "new" ? <Link className="btn" to="/events"><Icon name="events" />See events</Link> : undefined}>
          {show === "new" ? "When an event could hit your products, the owning team's alert appears here." : "No alerts in this group."}</Empty>
        : <div className="ap-groups">
          {groups.map(g => section(g[0].event_id, g))}
          {done.length > 0 && <section className="quiet" aria-labelledby="ap-done">
            <h2 id="ap-done">Already taken on <span>{done.length}</span></h2>
            <p className="ap-sub2">Acknowledged or resolved: someone has these in hand.</p>
            {taken && <ol className="ap-lines">{done.map(a => <AlertLine key={a.alert_id} a={a} ev={events[a.event_id]} label primary={false} onChange={update} />)}</ol>}
            <button type="button" className="ap-more" aria-expanded={taken} onClick={() => setTaken(!taken)}>
              <Icon name="chevron" className={`ico16 ${taken ? "rot" : ""}`} />{taken ? "Show fewer" : `Show the ${done.length}`}</button>
          </section>}
        </div>}
    </div>
  );
}
