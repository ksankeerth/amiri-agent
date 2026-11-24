// Alerts: what Amiri Agent found for each team's products, grouped by the event behind it, and who has taken it on.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { alertsApi, type AlertItem, type AlertSummary } from "../api/alerts";
import { investigationApi, type EventDetail } from "../api/investigation";
import { PageTitle, Result, Section, TextButton, TextTabs, ToneMark, ToneWord } from "../components/rd";
import { ListSkeleton, LoadError, useNow, useToast } from "../components/ui";
import { ago, dayTime, ZONE_LABEL } from "../format";
import {
  ACTION_MEANS, alertChangeText, alertOrder, checkMove, count, earliest, eventTitle, impactText, LEVEL_LABEL, listText, onDay,
  relDay, sizeTiming, sourceInfo, type LevelKey, type VerdictKey,
} from "../plain";
import { useArticleUrl } from "./alerts/article";
import { historySummary } from "./alerts/words";
import "../styles/rd-alerts.css";

type Show = "new" | "acknowledged" | "resolved" | "all";

// when Amiri Agent last raised or escalated it: a person acknowledging it doesn't move it on the page
const changed = (a: AlertItem) => [...a.history].reverse().find(h => h.by === "Amiri Agent" && h.change !== "resolved")?.at ?? a.created_at;
// "Remittance inflow may fall" → "remittance inflow may fall" after the team's name; "FC deposit…" keeps its capitals
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** An alert's level in words, with its shape: amber ◆ for the two early levels, red ▲ once your data confirms it. */
function LevelWord({ level }: { level: LevelKey }) {
  return <ToneWord tone={level === "adverse" ? "bad" : "mixed"}>{LEVEL_LABEL[level]}</ToneWord>;
}
const Chevron = () => (
  <svg className="rd-chev" viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>);

/** What your data has said so far, in the app's result words: one result when every impact reads alike. The words
 *  "Your data" are said once, as the group's column heading (screen readers get them on each row). */
function DataSoFar({ a }: { a: AlertItem }) {
  const checked = a.effects.filter(e => e.check);
  if (!checked.length) return <span><span className="sr">Your data: </span>Not checked yet</span>;
  const lead = checked.find(e => e.check!.alert === a.level) ?? checked[0];
  const kinds = [...new Set(checked.map(e => e.check!.verdict as VerdictKey))];
  const move = a.effects.length === 1 ? checkMove(lead.check!.what)?.move : undefined;
  return <span><span className="sr">Your data: </span>{kinds.map((v, i) => (
    <span key={v}>{i > 0 && ", "}<Result verdict={v} adverse={checked.find(e => e.check!.verdict === v)!.adverse} figure={kinds.length === 1 ? move : undefined} strong={false} /></span>))}</span>;
}

function AlertRow({ a, next, ev, showLevel, now, onChange }: {
  a: AlertItem; next: string | null; ev: EventDetail | undefined; showLevel: boolean; now: Date; onChange: (a: AlertItem) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const [asking, setAsking] = useState<"ack" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const id = useId();
  const act = async (action: "ack" | "resolve" | "reopen") => {
    setBusy(true);
    try { onChange(await alertsApi.act(a.alert_id, action, note)); setAsking(null); setNote("");
      toast({ ack: "Acknowledged: your team can see you're on it", resolve: "Resolved", reopen: "Back on the review list" }[action]); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  // the impact the alert's level rests on leads; the rest wait in Details
  const lead = a.effects.find(e => e.check?.alert === a.level) ?? a.effects[0];
  const products = [...new Set(a.effects.map(e => e.product))];
  const strongest = a.top_finding;
  const inEvent = ev && strongest
    ? ev.findings.filter(f => f.title === strongest).flatMap(f => f.evidence?.headlines ?? []).find(h => h.url)?.url ?? null : null;
  const articleUrl = useArticleUrl(strongest, a.sources, open, inEvent);
  const labels = (a.sources ?? []).map(s => sourceInfo(s).label);
  const lastChecked = a.effects.map(e => e.check?.as_of).filter((x): x is string => !!x).sort().pop()
    ?? [...a.history].reverse().find(h => h.change === "checked")?.at ?? null;
  const dueIn = next ? relDay(next, now) : "";
  const anyChecked = a.effects.some(e => e.check && e.check.verdict !== "not_yet");

  return (
    <article className="rd-al" aria-labelledby={`t-${a.alert_id}`}>
      <div className="rd-row rd-alrow">
        <div className="rd-alrow-main">
          <h3 className="rd-row-t" id={`t-${a.alert_id}`}>
            <button type="button" className="rd-tgl" title={`${a.owner}, ${lead ? lower(impactText(lead.metric_name, lead.direction)) : a.title}`}
              aria-expanded={open} aria-controls={`d-${id}`} onClick={() => setOpen(o => !o)}>
              <span className="rd-clamp1 rd-tgl-t">{a.owner}<span aria-hidden="true"> · </span><span className="sr">, </span>
                <span className="rd-what">{lead ? lower(impactText(lead.metric_name, lead.direction)) : a.title}</span></span><Chevron /></button></h3>
          <div className="rd-row-d rd-dots rd-clamp1" title={listText(products, 6)}>
            <span>{listText(products, 2)}</span>
            {showLevel && <span className="rd-lv"><LevelWord level={a.level} /></span>}
          </div>
          {a.status === "acknowledged" && <div className="rd-row-d rd-who rd-clamp1"><b>{a.acknowledged_by}</b> is on it{a.acknowledged_at ? `, ${ago(a.acknowledged_at, now)}` : ""}{a.ack_note ? `: “${a.ack_note}”` : ""}</div>}
          {a.status === "resolved" && <div className="rd-row-d rd-who">Resolved by <b>{a.resolved_by}</b>{a.resolved_at ? `, ${ago(a.resolved_at, now)}` : ""}{a.resolved_note ? `: “${a.resolved_note}”` : ""}</div>}
        </div>
        <div className="rd-alrow-data rd-row-d"><DataSoFar a={a} /></div>
        {!asking ? <div className="rd-alrow-act">
          {/* every alert waiting for review gets the same button: they're peers, and the list's order already says which
              is most serious. The filled button is kept for the confirmation, the one action at that moment. */}
          {a.status === "new" && <button className="btn" type="button" title={ACTION_MEANS.ack} onClick={() => setAsking("ack")}>Acknowledge</button>}
          {a.status === "acknowledged" && <TextButton title={ACTION_MEANS.resolve} onClick={() => setAsking("resolve")}>Resolve</TextButton>}
          {a.status !== "new" && <TextButton title={ACTION_MEANS.reopen} disabled={busy} onClick={() => act("reopen")}>Reopen</TextButton>}
        </div> : <div className="rd-alrow-act" />}
      </div>

      {(open || asking) && <div className="rd-open rd-det" id={`d-${id}`}>
        {open && <>
          <h4>Why Amiri Agent expects this</h4>
          <p className="rd-fine rd-prose">Amiri Agent's assessment (AI). Sizes and timing are estimates, checked against your
            own figures as they're published.</p>
          <div className="rd-scroll"><table className="rd-table">
            <thead><tr><th scope="col">Product</th><th scope="col">Expected</th><th scope="col">Size and timing</th><th scope="col">Your data so far</th></tr></thead>
            <tbody>{a.effects.map(e => { const m = e.check ? checkMove(e.check.what) : null; return (
              <tr key={e.hypothesis_id}>
                <td className="rd-strong">{e.product}</td>
                <td>{impactText(e.metric_name, e.direction)}<div className="rd-fine">How: {e.chain_label}</div></td>
                <td>{sizeTiming(e.size, e.timing)}</td>
                <td>{e.check ? <><Result verdict={e.check.verdict as VerdictKey} adverse={e.adverse} figure={m?.move} strong={false} />
                  {m && <div className="rd-fine">{m.against}</div>}</> : <span className="rd-fine">Not checked yet</span>}</td>
              </tr>); })}</tbody></table></div>

          {(strongest || a.finding_ids.length > 0) && <p className="rd-det-line"><b>Evidence:</b>{" "}
            {a.finding_ids.length > 0 && <>{count(a.finding_ids.length, "finding")}{labels.length ? ` from ${listText(labels)}` : ""}. </>}
            {strongest && <>Strongest:{" "}{articleUrl
              ? <a className="rd-link" href={articleUrl} target="_blank" rel="noreferrer">{strongest}<span aria-hidden="true"> ↗</span><span className="sr"> (opens the article)</span></a>
              : strongest}</>}</p>}

          <p className="rd-det-line"><b>History:</b> {historySummary(a.history, a.created_at, lastChecked)}.{" "}
            <TextButton aria-expanded={all} aria-controls={`h-${id}`} onClick={() => setAll(x => !x)}>{all ? "Hide the list" : `Show all ${a.history.length}`}</TextButton></p>
          {all && <ol className="rd-hist" id={`h-${id}`} tabIndex={0} aria-label={`All ${a.history.length} history entries, newest first`}>
            {[...a.history].reverse().map((h, i) => (
              <li key={i}><b>{alertChangeText(h)}</b><span className="rd-fine">{dayTime(h.at)}{h.by && h.by !== "Amiri Agent" ? ` · ${h.by}` : ""}</span></li>))}</ol>}

          {next && <p className="rd-det-line"><b>{dueIn.includes("ago") ? "Check due:" : anyChecked ? "Next check:" : "First check:"}</b> {onDay(next)}{" "}
            <span className="rd-fine">({dueIn})</span></p>}
          {a.via_monitor && <p className="rd-det-line">Sent to you because your team owns <Link className="rd-link" to={`/monitors/${a.via_monitor}`}>the monitor</Link> that found it.</p>}
          {a.status === "new" && !asking && <p className="rd-det-line"><TextButton title={ACTION_MEANS.resolve} onClick={() => setAsking("resolve")}>Resolve</TextButton>{" "}
            <span className="rd-fine">You've dealt with it; it leaves the review list.</span></p>}
        </>}

        {asking && <div className="rd-ask">
          <input className="input" autoFocus aria-label={asking === "ack" ? "A note for your team (optional)" : "Why it's resolved (optional)"}
            placeholder={asking === "ack" ? "A note for your team (optional): who is looking, what next" : "Why it's resolved (optional)"}
            value={note} onChange={e => setNote(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") act(asking); else if (e.key === "Escape") { setAsking(null); setNote(""); } }} />
          <button className="btn btn--primary" type="button" disabled={busy} onClick={() => act(asking)}>{asking === "ack" ? "Acknowledge" : "Resolve"}</button>
          <TextButton onClick={() => { setAsking(null); setNote(""); }}>Cancel</TextButton>
        </div>}
      </div>}
    </article>
  );
}

export function AlertsPage() {
  const [show, setShow] = useState<Show>("new");
  const [team, setTeam] = useState("");
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [sum, setSum] = useState<AlertSummary | null>(null);
  const [events, setEvents] = useState<Record<string, EventDetail>>({});
  const [byEvent, setByEvent] = useState<Record<string, AlertItem[]>>({});  // every team's alerts on an event, whatever the filter
  const [err, setErr] = useState<unknown>(null);
  const [help, setHelp] = useState(false);
  const helpId = useId();
  const now = useNow(60_000);
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
  // each alert's next check is on its event, and "reached N teams" counts every team's alert on the event, even with
  // a team filter on: two requests per event on the page
  const eventIds = useMemo(() => [...new Set((shown ?? []).map(a => a.event_id))].sort().join(","), [shown]);
  useEffect(() => {
    if (!eventIds) return;
    let live = true;
    const ids = eventIds.split(",");
    Promise.all(ids.map(id => investigationApi.event(id).then(e => [id, e] as const).catch(() => null)))
      .then(xs => { if (live) setEvents(Object.fromEntries(xs.filter(x => x !== null))); });
    Promise.all(ids.map(id => alertsApi.list({ event_id: id }).then(l => [id, l] as const).catch(() => null)))
      .then(xs => { if (live) setByEvent(Object.fromEntries(xs.filter(x => x !== null))); });
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

  // one queue, the most serious first (the alert your own data confirms leads), then the latest; an event's alerts
  // sit together where its most serious one is
  const queue = useMemo(() => [...(shown ?? [])].sort((x, y) => alertOrder({ ...x, at: changed(x) }, { ...y, at: changed(y) })), [shown]);
  const groups = useMemo(() => {
    const m = new Map<string, AlertItem[]>();
    for (const a of queue) m.set(a.event_id, [...(m.get(a.event_id) ?? []), a]);
    return [...m.entries()];
  }, [queue]);

  const s = sum;
  const waiting = !s ? null : team ? s.teams.find(t => t.owner === team)?.to_review ?? 0 : s.to_review;
  const title = waiting === null ? "Alerts" : waiting ? `${count(waiting, "alert")} waiting for ${team || "review"}` : team ? `All caught up for ${team}` : "All caught up";
  const nTeams = new Set(queue.map(a => a.owner)).size;
  const nConfirmed = queue.filter(a => a.status === "new" && a.level === "adverse").length;
  const lede = shown && shown.length ? <>From {count(groups.length, "event")}{team ? "" : `, for ${count(nTeams, "team")}`}.{" "}
    {nConfirmed > 0 && <><ToneWord tone="bad">{nConfirmed} confirmed by your data</ToneWord>. </>}Most serious first.{" "}</> : null;
  const tabs = ([["new", "To review"], ["acknowledged", "Acknowledged"], ["resolved", "Resolved"], ["all", "All"]] as const)
    .map(([key, label]) => ({ key, label, count: nAt(key) }));

  return (
    <div className="page rd rd-alerts">
      <PageTitle title={title}
        lede={<>{lede}<TextButton aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(h => !h)}>How this works</TextButton></>}
        help={<div id={helpId} className="rd-open rd-prose rd-help" hidden={!help}>
          <p>Amiri Agent watches the news and the markets, links what it finds to an event, and works out which of your
            products the event could hit. The team that owns each product gets an alert. Amiri Agent then tests each
            possible impact against your own figures as they're published.</p>
          <p>Someone on that team acknowledges it, so everyone knows it's taken on. The most serious alert is at the top;
            work down the list.</p>
          <ul className="rd-levels">
            <li><LevelWord level="warning" /> <span>Amiri Agent expects an impact; your data can't tell yet.</span></li>
            <li><LevelWord level="developing" /> <span>Your figures are starting to move the bad way.</span></li>
            <li><LevelWord level="adverse" /> <span>Your own figures show the impact.</span></li>
          </ul>
        </div>} />
      {err != null && <LoadError error={err} onRetry={load} what="the alerts" />}

      {(items !== null || err == null) && <TextTabs label="Which alerts" items={tabs} value={show} onChange={setShow}
        end={<>
          {s && <span className="rd-fine">{s.acknowledged_week} acknowledged this week</span>}
          {s && s.all_teams.length > 1 && <select className="input rd-select" aria-label="Team" value={team} onChange={e => setTeam(e.target.value)}>
            <option value="">Team: All teams</option>
            {s.all_teams.map(t => { const n = s.teams.find(x => x.owner === t)?.to_review; return <option key={t} value={t}>{t}{n ? ` (${n} to review)` : ""}</option>; })}
          </select>}
        </>} />}

      {shown === null ? (err == null && <div className="mt12"><ListSkeleton rows={3} /></div>)
        : !shown.length ? <div className="rd-empty">
          <p className="rd-lede">{show === "new" ? "When an event could hit your products, the owning team's alert appears here." : "No alerts in this group."}</p>
          {show === "new" && <Link className="btn btn--primary" to="/events">See events</Link>}</div>
        : <div className="rd-groups">{groups.map(([eid, as], gi) => {
          const ev = events[eid];
          const all = byEvent[eid];
          const reached = all ? new Set(all.map(x => x.owner)).size : team ? null : new Set(as.map(x => x.owner)).size;
          const raised = earliest([...(all ?? as).map(x => x.created_at)]) ?? as[0].created_at;
          const sameLevel = as.every(x => x.level === as[0].level);
          const name = ev ? eventTitle(ev) : as[0].event_title;
          const tone = as.some(x => x.effects.some(e => e.adverse)) ? "bad" : "mixed";
          return (
            <Section key={eid} className="rd-grp" id={`event-${eid}`}
              title={<><ToneMark tone={tone} label={tone === "bad" ? "Bad for you: " : "Mixed for you: "} /><Link className="rd-name" to={`/events/${eid}`}>{name}</Link></>}
              meta={<span className="rd-dots">
                {sameLevel && <span className="rd-lv"><LevelWord level={as[0].level} /></span>}
                <span>raised {dayTime(raised)}{gi === 0 ? ` ${ZONE_LABEL} time` : ""}</span>
                {reached !== null && <span>reached {count(reached, "team")}</span>}
              </span>}
              >
              <div className="rd-alhead rd-colh" aria-hidden="true"><span /><span>Your data</span><span /></div>
              {as.map(a => <AlertRow key={a.alert_id} a={a} next={nextCheck(a)} ev={ev} now={now} showLevel={!sameLevel} onChange={update} />)}
            </Section>);
        })}</div>}
    </div>
  );
}
