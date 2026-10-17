// Alerts: what Amiri Agent found for each team's products, and who has looked at it.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { alertsApi, LEVEL, type AlertItem, type AlertSummary } from "../api/alerts";
import { VERDICT_BADGE } from "../api/investigation";
import { Icon } from "../components/Icon";
import { Banner, Empty, PageHead, useNow, useToast, ListSkeleton } from "../components/ui";
import { ago, dayTime, TIME_ZONE } from "../format";

type Show = "new" | "acknowledged" | "resolved" | "all";
const SHOW: [Show, string][] = [["new", "To review"], ["acknowledged", "Acknowledged"], ["resolved", "Resolved"], ["all", "All"]];
const CHANGE: Record<string, string> = { raised: "Raised", escalated: "Escalated", acknowledged: "Acknowledged", resolved: "Resolved", reopened: "Reopened", confirmed: "Confirmed", withdrawn: "Withdrawn", checked: "Checked" };

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

function AlertCard({ a, onChange }: { a: AlertItem; onChange: (a: AlertItem) => void }) {
  const toast = useToast();
  const now = useNow(60_000);
  const [asking, setAsking] = useState<"ack" | "resolve" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const act = async (action: "ack" | "resolve" | "reopen") => {
    setBusy(true);
    try { onChange(await alertsApi.act(a.alert_id, action, note)); setAsking(null); setNote("");
      toast({ ack: "Acknowledged", resolve: "Resolved", reopen: "Back to review" }[action]); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  const [cls, label] = LEVEL[a.level];
  const hist = a.history.slice(-4);
  const nFindings = a.finding_ids.length;
  return (
    <div className={`card al-card ${a.status !== "new" ? "done" : ""}`} data-lv={a.level}>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge ${cls}`}>{label}</span>
        <span className="chip"><Icon name="users" className="ico16" />{a.owner}</span>
        {a.via_monitor && <span className="small muted">via the monitor <Link to={`/monitors/${a.via_monitor}`}>{a.via_monitor}</Link></span>}
        <span className="spacer" />
        {a.status !== "new" && <span className={`badge ${a.status === "resolved" ? "b-noeffect" : "b-info"}`}>{a.status.toUpperCase()}</span>}
        <span className="small muted" title={dayTime(changed(a))}>{ago(changed(a), now)}</span>
      </div>
      <h2 className="t">{a.title}</h2>
      <div className="small muted">From the event <Link to={`/events/${a.event_id}`}>{a.event_title}</Link>
        {a.event_status === "closed" ? " (closed)" : ""} · {nFindings} finding{nFindings === 1 ? "" : "s"}
        {a.sources?.length ? ` from ${a.sources.map(s => (s === "timeseries" ? "market series" : s)).join(", ")}` : ""}
        {a.top_finding ? <> · “{a.top_finding}”</> : null}</div>
      <ul className="al-fx">{a.effects.map(e => (
        <li key={e.hypothesis_id}>
          <span className="arr">{e.direction === "fall" ? "▼" : "▲"}</span>
          <span><b>{e.product}</b>: {e.metric_name.toLowerCase()} expected to {e.direction}
            {e.size || e.timing ? <span className="muted"> · {[e.size, e.timing].filter(Boolean).join(", ")}</span> : null}
            {e.check && <span className="al-ck"><span className={`badge ${VERDICT_BADGE[e.check.verdict]}`}>{e.check.verdict_text.toUpperCase()}</span>{" "}
              <span className="small">{e.check.what ?? e.check.line}</span></span>}</span></li>))}</ul>
      <div className="small muted">{a.basis === "data" ? "Checked against your own data: the level follows the checks."
        : Object.keys(a.checked).length ? "Rests on the investigation's expectations: your own data can't tell yet."
        : "Rests on the investigation's expectations only: not yet checked against your own data."}</div>
      <details className="al-why"><summary>Why Amiri Agent expects this</summary>
        <ul>{a.effects.map(e => <li key={e.hypothesis_id}><b>{e.product}</b>: {e.statement}{e.chain_label ? <span className="muted"> ({e.chain_label})</span> : null}</li>)}</ul>
        <p className="small muted">Traced by the investigation agent from the findings above; the product, the metric and its direction are checked by code against your profile. Sizes and timing are estimates.</p>
      </details>
      {a.status === "acknowledged" && <div className="al-note">Acknowledged by <b>{a.acknowledged_by}</b> {a.acknowledged_at ? ago(a.acknowledged_at, now) : ""}{a.ack_note ? `: ${a.ack_note}` : "."}</div>}
      {a.status === "resolved" && <div className="al-note">Resolved by <b>{a.resolved_by}</b> {a.resolved_at ? ago(a.resolved_at, now) : ""}{a.resolved_note ? `: ${a.resolved_note}` : "."}</div>}
      <div className="al-hist">{hist.map((h, i) => (
        <span key={i}><b>{CHANGE[h.change] ?? h.change}</b> {dayTime(h.at)}{h.by && h.by !== "Amiri Agent" ? ` by ${h.by}` : ""}{h.text && h.change !== "raised" && h.text !== a.ack_note && h.text !== a.resolved_note ? ` · ${h.text}` : ""}</span>))}</div>
      {asking ? (
        <div className="row" style={{ gap: 8 }}>
          <input className="input" autoFocus placeholder={asking === "ack" ? "A note for the team (optional): who is looking, what next" : "Why it's resolved (optional)"}
            value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") act(asking); }} />
          <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => act(asking)}>{asking === "ack" ? "Acknowledge" : "Resolve"}</button>
          <button className="btn btn--sm" type="button" onClick={() => { setAsking(null); setNote(""); }}>Cancel</button>
        </div>
      ) : (
        <div className="row wrap" style={{ gap: 8 }}>
          {a.status === "new" && <button className="btn btn--primary btn--sm" type="button" onClick={() => setAsking("ack")}><Icon name="check" />Acknowledge</button>}
          {a.status !== "resolved" && <button className="btn btn--sm" type="button" onClick={() => setAsking("resolve")}>Resolve</button>}
          {a.status !== "new" && <button className="btn btn--sm btn--ghost" type="button" disabled={busy} onClick={() => act("reopen")}>Reopen</button>}
          <span className="spacer" />
          <Link className="btn btn--sm btn--ghost" to={`/events/${a.event_id}`}>Open the event →</Link>
        </div>
      )}
    </div>
  );
}

export function AlertsPage() {
  const now = useNow(60_000);
  const [show, setShow] = useState<Show>("new");
  const [team, setTeam] = useState("");
  const [items, setItems] = useState<AlertItem[] | null>(null);
  const [sum, setSum] = useState<AlertSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [s, xs] = await Promise.all([alertsApi.summary(), alertsApi.list({ status: show === "all" ? undefined : show, owner: team || undefined })]);
      setSum(s); setItems(xs); setErr(null);
    } catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
  }, [show, team]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
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
      <PageHead title="Alerts" sub="Early warnings when Amiri Agent traces an event to your products, for the team that owns them. Someone acknowledges each one. With validation on, each effect is checked against your own data and the alert follows the checks." />
      {err && <Banner kind="crit" icon="warn">{err}</Banner>}
      {s && <div className="rd-strip al-strip">
        <div className="card ov-kpi" style={{ ["--kpi" as string]: s.to_review ? "var(--critical)" : "var(--accent)" }}>
          <div className="v">{s.to_review}</div><div className="l">To review</div><div className="s">{s.to_review ? "acknowledge each one" : "all caught up"}</div></div>
        <div className="card ov-kpi" style={{ ["--kpi" as string]: s.teams.length ? "var(--high)" : "var(--hairline-2)" }}>
          <div className="v">{s.teams.length}</div><div className="l">Teams with alerts waiting</div>
          <div className="s">{s.teams.length ? s.teams.slice(0, 3).map(t => t.owner).join(", ") + (s.teams.length > 3 ? ` and ${s.teams.length - 3} more` : "") : "none"}</div></div>
        <div className="card ov-kpi"><div className="v">{s.acknowledged_week}</div><div className="l">Acknowledged this week</div><div className="s">by your Risk Managers</div></div>
      </div>}

      <div className="row wrap mt16" style={{ gap: 10 }}>
        <span className="seg">{SHOW.map(([k, label]) => <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{label}{k === "new" && s?.to_review ? ` (${s.to_review})` : ""}</button>)}</span>
        {s && s.all_teams.length > 0 && <div className="al-teams">
          <button type="button" className={`chip click ${team === "" ? "sel" : ""}`} onClick={() => setTeam("")}>All teams</button>
          {s.all_teams.map(t => { const n = s.teams.find(x => x.owner === t)?.to_review;
            return <button key={t} type="button" className={`chip click ${team === t ? "sel" : ""}`} onClick={() => setTeam(team === t ? "" : t)}>{t}{n ? ` · ${n}` : ""}</button>; })}
        </div>}
      </div>

      {items === null ? <div className="mt12"><ListSkeleton rows={3} /></div>
        : !items.length ? <div className="card mt12"><Empty icon="check" title={show === "new" ? "All caught up" : "Nothing here"}>
          {show === "new" ? "Nothing is waiting for review. When the investigation traces an event to your products, the owning team's alert appears here." : "No alerts in this group."}</Empty></div>
        : groups.map(([k, xs]) => (
          <div key={k}><div className="al-day">{dayLabel(k, now)}</div>
            <div className="col gap16">{xs.map(a => <AlertCard key={a.alert_id} a={a} onChange={update} />)}</div></div>))}
    </div>
  );
}
