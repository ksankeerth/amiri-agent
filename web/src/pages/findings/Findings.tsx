// Findings: what the sources found in the last 7 days, and what the investigation made of each (waiting, being
// investigated, in an event, no impact found and why). No live push: the page reloads every 30 s, and Refresh reloads now.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventRow, type FindingRow } from "../../api/investigation";
import { HowItWorks, PageHeader, StatusPill } from "../../components/blocks";
import { Icon } from "../../components/Icon";
import { Banner, Empty, InlineSkeleton, useNow, useToast } from "../../components/ui";
import { ago, dayTime, until } from "../../format";
import { count, FINDING_STATUS, longWhen, sourceInfo } from "../../plain";
import { InvestigateNowButton, useInvestigationStatus } from "../events/Events";
import { DAYS, reasonText, useRecentFindings } from "./recent";

type Show = "all" | "new" | "grouped" | "linked" | "set_aside";
const SHOW: [Show, string][] = [["all", "All"], ["grouped", "Being investigated"], ["linked", "In an event"], ["set_aside", "No impact found"], ["new", "Waiting"]];

function sourceLink(f: FindingRow): string | null {
  const r = f.source_ref ?? {};
  if (f.source === "monitor" && r.monitor_id) return `/monitors/${r.monitor_id}`;
  if (f.source === "timeseries" && r.series_id) return `/series/${r.series_id}`;
  if (f.source === "radar") return "/radar";
  return null;
}

export function FindingsPage() {
  const toast = useToast();
  const now = useNow(15_000);
  const { hash } = useLocation();
  const { items, err, loadedAt, load } = useRecentFindings();
  const { status, reload } = useInvestigationStatus();
  const [show, setShow] = useState<Show>("all");
  const [checking, setChecking] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, EventRow>>({});
  useEffect(() => { investigationApi.events().then(xs => setEvents(Object.fromEntries(xs.map(e => [e.event_id, e])))).catch(() => {}); }, [items]);
  const refresh = () => { load(); reload(); };
  const target = decodeURIComponent(hash.slice(1));
  useEffect(() => {  // from the Overview: open on that finding
    if (!items || !target) return;
    document.getElementById(target)?.scrollIntoView({ block: "center" });
  }, [items, target]);
  const rows = useMemo(() => (items ?? []).filter(f => show === "all" || f.status === show), [items, show]);
  const n = (s: Show) => (items ?? []).filter(f => s === "all" || f.status === s).length;
  const check = async (f: FindingRow) => {
    if (!f.run_id) return;
    setChecking(f.finding_id);
    try {
      const r = await investigationApi.collect(f.run_id);
      toast(r.status === "running" ? "Still being investigated. Try again in a moment." : "The investigation has finished.");
      refresh();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setChecking(null); }
  };
  const nextBatch = status?.next_batch_at && status.connected ? (new Date(status.next_batch_at) <= now ? "very soon" : `in ${until(status.next_batch_at, now)}`) : null;
  return (
    <div className="page">
      <PageHeader title="Findings"
        status={items === null ? "" : <><b className="ink">{count(items.length, "finding")}</b> in the last {DAYS} days{n("grouped") ? `, ${n("grouped")} being investigated` : ""}</>}
        actions={<>
          <span className="small muted">Updated {loadedAt ? ago(loadedAt.toISOString(), now) : ""}</span>
          <button className="btn" type="button" onClick={refresh}><Icon name="refresh" />Refresh</button>
          {status && status.findings_waiting > 0 && status.connected ? <InvestigateNowButton onDone={refresh} small /> : null}
        </>}
        help={<HowItWorks><p>A finding is something a monitor, a market series or Radar noticed. Each one goes to the investigation, which links it to an event or finds no impact on your products. Findings from tests aren't shown.</p></HowItWorks>} />
      {err && <Banner kind="warn" icon="warn">Couldn't refresh: {err}</Banner>}
      <div className="filters"><span className="seg" role="group" aria-label="Which findings">{SHOW.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{label} ({n(k)})</button>))}</span></div>
      <div className="card mt12">
        {items === null ? <InlineSkeleton /> : !rows.length ? (
          <Empty icon="search" title={show === "all" ? `Nothing found in the last ${DAYS} days` : "None in this group"}
            actions={show === "all" ? <Link className="btn" to="/monitors"><Icon name="monitor" />See your monitors</Link> : undefined}>
            {show === "all" ? "When a monitor, a market series or Radar notices something, it appears here." : "Choose another group above."}</Empty>
        ) : (
          <ul className="evlist" aria-label="Findings">{rows.map(f => {
            const [label, tone] = FINDING_STATUS[f.status];
            const si = sourceInfo(f.source), src = sourceLink(f);
            const ev = f.outcome?.event_id ? events[f.outcome.event_id] : undefined;
            return (
              <li key={f.finding_id} id={`f-${f.finding_id}`} className={`fd-row ${target === `f-${f.finding_id}` ? "fd-target" : ""}`}>
                <div className="evrow">
                  <span className="evrow-ico"><Icon name={si.icon} /></span>
                  <span className="evrow-main">
                    <span className="row-top"><b className="row-l">{f.title}</b><StatusPill tone={tone}>{label}</StatusPill></span>
                    <span className="row-d fd-what">
                      {f.status === "new" && <>Waiting to be investigated{nextBatch ? `: the next batch goes ${nextBatch}` : ""}</>}
                      {f.status === "grouped" && <>Being investigated{f.run_started_at ? `, started ${ago(f.run_started_at, now)}` : ""}</>}
                      {f.status === "linked" && f.outcome?.event_id && <>In the event <Link to={`/events/${f.outcome.event_id}`}>{ev?.title ?? "open the event"}</Link></>}
                      {f.status === "set_aside" && <>No impact found: {reasonText(f) || "no link to your products"}</>}
                    </span>
                    {f.explanation && <span className="row-d muted">{f.explanation}</span>}
                    {f.status === "grouped" && f.run_status === "running" && f.run_id && <span className="row wrap">
                      <button className="btn btn--sm" type="button" disabled={checking === f.finding_id} onClick={() => check(f)}>
                        <Icon name="refresh" className={checking === f.finding_id ? "spin" : undefined} />Check now</button>
                      <span className="small muted">Otherwise the result comes in on its own within a few minutes.</span></span>}
                  </span>
                  <span className="evrow-side">
                    {src ? <Link className="small" to={src}>{si.label}</Link> : <span className="small">{si.label}</span>}
                    <span className="evrow-when" title={longWhen(f.created_at)}>{dayTime(f.created_at)}</span>
                  </span>
                </div>
              </li>);
          })}</ul>
        )}
      </div>
    </div>
  );
}
