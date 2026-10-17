// Alerts: what Amiri Agent found for each team's products, and who has taken it on.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { alertsApi, type AlertItem, type AlertSummary, type Effect } from "../api/alerts";
import { investigationApi, type EventDetail } from "../api/investigation";
import { HowItWorks, ImpactRow, PageHeader, StatTiles, StatusPill } from "../components/blocks";
import { CheckPill, CheckSummary } from "../components/checks";
import { Icon } from "../components/Icon";
import { Banner, Empty, ListSkeleton, useNow, useToast } from "../components/ui";
import { ago, dayTime, TIME_ZONE } from "../format";
import {
  ACTION_MEANS, ALERT_STATUS, checkMove, count, earliest, impactText, LEVEL_LABEL, LEVEL_TONE, listText, longWhen, onDay, relDay, sizeTiming,
  sourceInfo, type VerdictKey,
} from "../plain";

type Show = "new" | "acknowledged" | "resolved" | "all";
const SHOW: [Show, string][] = [["new", "To review"], ["acknowledged", "Acknowledged"], ["resolved", "Resolved"], ["all", "All"]];
const CHANGE: Record<string, string> = {
  raised: "Raised", escalated: "Level raised", acknowledged: "Acknowledged", resolved: "Resolved", reopened: "Reopened",
  confirmed: "Confirmed by your data", withdrawn: "Withdrawn", checked: "Checked against your data",
};

// when Amiri Agent last raised or escalated it: a person acknowledging it doesn't move it on the page
const changed = (a: AlertItem) => [...a.history].reverse().find(h => h.by === "Amiri Agent" && h.change !== "resolved")?.at ?? a.created_at;
const dayKey = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(iso));
function dayLabel(key: string, now: Date): string {
  const today = dayKey(now.toISOString());
  const y = dayKey(new Date(now.getTime() - 86400_000).toISOString());
  if (key === today) return "Today";
  if (key === y) return "Yesterday";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(new Date(`${key}T12:00:00Z`));
}

/** The impact in a few words, with the move your data showed when it was checked. */
function EffectImpact({ e }: { e: Effect }) {
  const m = e.check ? checkMove(e.check.what) : null;
  return <>{impactText(e.metric_name, e.direction)}{m && <span className="ir-move"><b>{m.move}</b> {m.against}</span>}</>;
}

function AlertCard({ a, next, onChange }: { a: AlertItem; next: string | null; onChange: (a: AlertItem) => void }) {
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
  const products = [...new Set(a.effects.map(e => e.product))];
  const bad = a.effects.filter(e => e.adverse).length;
  const checks = a.effects.filter(e => e.check).map(e => ({ verdict: e.check!.verdict as VerdictKey, alert: e.check!.alert, adverse: e.adverse }));
  const same = new Set(checks.map(c => c.verdict)).size <= 1 && checks.length === a.effects.length;
  const src = a.sources?.[0] ? sourceInfo(a.sources[0]) : null;
  const [statusText, statusTone] = ALERT_STATUS[a.status];
  return (
    <article className={`card alc ${a.status !== "new" ? "done" : ""}`} data-lv={a.level} aria-labelledby={`t-${a.alert_id}`}>
      <div className="alc-hd">
        <StatusPill tone={LEVEL_TONE[a.level]} icon={a.level === "adverse" ? "bad" : "alert"}>{LEVEL_LABEL[a.level]}</StatusPill>
        <span className="alc-team"><Icon name="users" />{a.owner}</span>
        <span className="spacer" />
        {a.status !== "new" && <StatusPill tone={statusTone}>{statusText}</StatusPill>}
        <span className="alc-time" title={longWhen(changed(a))}>{ago(changed(a), now)}</span>
      </div>
      <h2 className="alc-t" id={`t-${a.alert_id}`}><Link to={`/events/${a.event_id}`}>{a.event_title}</Link>{a.event_status === "closed" && <span className="alc-closed"> (event closed)</span>}</h2>
      {a.top_finding && <div className="alc-src">{src && <Icon name={src.icon} />}<span>{a.top_finding}</span></div>}
      <ul className="alc-stats" aria-label="In short">
        <li><Icon name="box" /><b>{count(products.length, "product")}</b></li>
        <li>{bad === a.effects.length ? <StatusPill tone="red" icon="bad">Bad for you</StatusPill>
          : <StatusPill tone="amber">{bad} of {a.effects.length} bad for you</StatusPill>}</li>
        {next && <li><Icon name="calendar" />{checks.some(c => c.verdict !== "not_yet") ? "Next check" : "First check"} <b>{onDay(next)}</b><span className="muted">({relDay(next)})</span></li>}
      </ul>
      <div className={`alc-impacts irs${same ? "" : " with-status"}`}>{a.effects.map(e => (
        <ImpactRow key={e.hypothesis_id} product={e.product} impact={<EffectImpact e={e} />} adverse={bad === a.effects.length ? undefined : e.adverse} size={sizeTiming(e.size, e.timing)}
          status={!same && e.check ? <CheckPill c={{ verdict: e.check.verdict as VerdictKey, alert: e.check.alert, adverse: e.adverse }} /> : undefined} />))}
      </div>
      <CheckSummary checks={checks} total={a.effects.length} />
      {a.status === "acknowledged" && <div className="alc-note"><Icon name="check" /><span><b>{a.acknowledged_by}</b> is on it{a.acknowledged_at ? `, ${ago(a.acknowledged_at, now)}` : ""}{a.ack_note ? `: “${a.ack_note}”` : ""}</span></div>}
      {a.status === "resolved" && <div className="alc-note"><Icon name="check" /><span>Resolved by <b>{a.resolved_by}</b>{a.resolved_at ? `, ${ago(a.resolved_at, now)}` : ""}{a.resolved_note ? `: “${a.resolved_note}”` : ""}</span></div>}
      {asking ? (
        <div className="alc-act">
          <input className="input" autoFocus aria-label={asking === "ack" ? "A note for your team (optional)" : "Why it's resolved (optional)"}
            placeholder={asking === "ack" ? "A note for your team (optional): who is looking, what next" : "Why it's resolved (optional)"}
            value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") act(asking); }} />
          <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => act(asking)}>{asking === "ack" ? "Acknowledge" : "Resolve"}</button>
          <button className="btn btn--sm" type="button" onClick={() => { setAsking(null); setNote(""); }}>Cancel</button>
        </div>
      ) : (
        <div className="alc-act">
          {a.status === "new" && <button className="btn btn--primary btn--sm" type="button" onClick={() => setAsking("ack")}><Icon name="check" />Acknowledge</button>}
          {a.status !== "resolved" && <button className="btn btn--sm" type="button" onClick={() => setAsking("resolve")}>Resolve</button>}
          {a.status !== "new" && <button className="btn btn--sm btn--ghost" type="button" disabled={busy} onClick={() => act("reopen")}>Reopen</button>}
          <span className="alc-means">{a.status === "new" ? ACTION_MEANS.ack : a.status === "acknowledged" ? ACTION_MEANS.resolve : ACTION_MEANS.reopen}</span>
          <span className="spacer" />
          <Link className="btn btn--sm btn--ghost" to={`/events/${a.event_id}`}>Open the event <Icon name="arrow" /></Link>
        </div>
      )}
      <div className="alc-more">
        <details className="tech"><summary>Why Amiri Agent expects this</summary>
          <div className="tech-bd"><ul className="alc-why">{a.effects.map(e => <li key={e.hypothesis_id}><b>{e.product}</b>: {e.chain_label}.</li>)}</ul>
            <span className="muted">Sizes and timing are estimates. Each impact is checked against your own figures as they're published.</span></div></details>
        <details className="tech"><summary>History ({a.history.length})</summary>
          <div className="tech-bd"><ol className="alc-hist">{[...a.history].reverse().map((h, i) => (
            <li key={i}><b>{CHANGE[h.change] ?? h.change}</b><span>{dayTime(h.at)}{h.by && h.by !== "Amiri Agent" ? ` · ${h.by}` : ""}</span></li>))}</ol></div></details>
        {a.via_monitor && <span className="alc-via">Sent to you because your team owns <Link to={`/monitors/${a.via_monitor}`}>the monitor</Link> that found it</span>}
      </div>
    </article>
  );
}

export function AlertsPage() {
  const now = useNow(60_000);
  const [show, setShow] = useState<Show>("new");
  const [team, setTeam] = useState("");
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [sum, setSum] = useState<AlertSummary | null>(null);
  const [events, setEvents] = useState<Record<string, EventDetail>>({});
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [s, xs] = await Promise.all([alertsApi.summary(), alertsApi.list({ status: show === "all" ? undefined : show, owner: team || undefined })]);
      setSum(s); setItems(xs); setErr(null);
    } catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
  }, [show, team]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  // each alert's next check is on its event: one request per event on the page
  const eventIds = useMemo(() => [...new Set((items ?? []).map(a => a.event_id))].sort().join(","), [items]);
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

  // days newest first; within a day, the latest change first
  const groups = useMemo(() => {
    const by = new Map<string, AlertItem[]>();
    for (const a of items ?? []) { const k = dayKey(changed(a)); by.set(k, [...(by.get(k) ?? []), a]); }
    return [...by.entries()].sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([k, xs]) => [k, xs.sort((x, y) => (changed(x) < changed(y) ? 1 : -1))] as const);
  }, [items]);
  const s = sum;
  return (
    <div className="page">
      <PageHeader title="Alerts"
        status={!s ? "" : s.to_review ? <><b className="ink">{count(s.to_review, "alert")} waiting for review</b>{s.teams.length ? ` for ${listText(s.teams.map(t => t.owner))}` : ""}</> : "All caught up: nothing waiting for review"}
        help={<HowItWorks>
          <p>An alert goes to the team that owns each product an event could hit. Someone on that team acknowledges it, so everyone knows it's taken on.</p>
          <div className="row wrap"><StatusPill tone="amber" icon="alert">Early warning</StatusPill><span>Amiri Agent expects an impact; your data can't tell yet.</span></div>
          <div className="row wrap"><StatusPill tone="amber" icon="alert">Showing early signs</StatusPill><span>Your figures are starting to move the bad way.</span></div>
          <div className="row wrap"><StatusPill tone="red" icon="bad">Confirmed by your data</StatusPill><span>Your own figures show the impact.</span></div>
        </HowItWorks>} />
      {err && <Banner kind="crit" icon="warn">{err}</Banner>}
      {s && <StatTiles label="Alerts in short" items={[
        { value: s.to_review, label: "To review", sub: s.to_review ? "acknowledge each one" : "all caught up", tone: s.to_review ? "red" : "green", icon: "alert" },
        { value: s.teams.length, label: s.teams.length === 1 ? "Team with alerts waiting" : "Teams with alerts waiting", sub: s.teams.length ? listText(s.teams.map(t => t.owner)) : "none", tone: s.teams.length ? "amber" : "grey", icon: "users" },
        { value: s.acknowledged_week, label: "Acknowledged this week", sub: "by your Risk Managers", tone: "blue", icon: "check" },
      ]} />}

      <div className="filters">
        <span className="seg" role="group" aria-label="Which alerts">{SHOW.map(([k, label]) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{label}{k === "new" && s?.to_review ? ` (${s.to_review})` : ""}</button>)}</span>
        {s && s.all_teams.length > 1 && <div className="al-teams" role="group" aria-label="Team">
          <button type="button" className={`chip click ${team === "" ? "sel" : ""}`} aria-pressed={team === ""} onClick={() => setTeam("")}>All teams</button>
          {s.all_teams.map(t => { const n = s.teams.find(x => x.owner === t)?.to_review;
            return <button key={t} type="button" className={`chip click ${team === t ? "sel" : ""}`} aria-pressed={team === t} onClick={() => setTeam(team === t ? "" : t)}>{t}{n ? ` (${n})` : ""}</button>; })}
        </div>}
      </div>

      {items === null ? <div className="mt12"><ListSkeleton rows={3} /></div>
        : !items.length ? <div className="card mt12"><Empty icon="check" title={show === "new" ? "All caught up" : "Nothing here"}
          actions={show === "new" ? <Link className="btn" to="/events"><Icon name="events" />See events</Link> : undefined}>
          {show === "new" ? "When an event could hit your products, the owning team's alert appears here." : "No alerts in this group."}</Empty></div>
        : groups.map(([k, xs]) => (
          <section key={k} aria-label={dayLabel(k, now)}><h2 className="al-day">{dayLabel(k, now)}</h2>
            <div className="col gap16">{xs.map(a => <AlertCard key={a.alert_id} a={a} next={nextCheck(a)} onChange={update} />)}</div></section>))}
    </div>
  );
}
