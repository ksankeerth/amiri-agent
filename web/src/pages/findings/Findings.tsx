// Findings: what the sources found in the last 7 days, and what the investigation made of each (waiting, being
// investigated, in an event, no impact found and why). No live push: the page reloads every 30 s, and Refresh reloads now.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventRow, type FindingRow } from "../../api/investigation";
import { HowItWorks, PageHeader, StatusPill } from "../../components/blocks";
import { FlowFilter } from "../../components/FlowFilter";
import { Icon } from "../../components/Icon";
import { Banner, Empty, errText, InlineSkeleton, isDown, LoadError, useNow, useToast } from "../../components/ui";
import { ago, dayTime, until } from "../../format";
import { count, eventTitle, FINDING_STATUS, longWhen, signalStrength, sourceInfo } from "../../plain";
import "../../styles/daily.css";
import { InvestigateNowButton, useInvestigationStatus } from "../events/Events";
import { DAYS, reasonText, useRecentFindings } from "./recent";

// the list carries each finding's evidence when the source kept it (the article's link)
type WithEvidence = FindingRow & { evidence?: { headlines?: { url?: string | null }[] } | null };
type Show = "all" | "new" | "grouped" | "linked" | "set_aside";

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
        </>}
        help={<HowItWorks><p>A finding is something a monitor, a market series or Radar noticed. Each one goes to the investigation, which links it to an event or finds no impact on your products. Findings from tests aren't shown.</p></HowItWorks>} />
      {err != null && (items === null ? <LoadError error={err} onRetry={refresh} what="the findings" />
        : <Banner kind="warn" icon="warn">Couldn't refresh: {isDown(err) ? "Amiri Agent didn't answer" : errText(err)}. Showing what was loaded.</Banner>)}
      {status && status.findings_waiting > 0 && status.connected && (
        <Banner kind="info" icon="info" action={<InvestigateNowButton onDone={refresh} small />}>
          <b>{count(status.findings_waiting, "finding")} waiting</b> to be investigated{nextBatch ? `: the next batch goes ${nextBatch}` : ""}.
        </Banner>)}
      <div className="filters"><FlowFilter label="Which findings" value={show} onChange={setShow} all={{ key: "all", label: "All", count: n("all") }}
        steps={[{ key: "new", label: "Waiting", count: n("new") }, { key: "grouped", label: "Being investigated", count: n("grouped") },
          [{ key: "linked", label: "In an event", count: n("linked") }, { key: "set_aside", label: "No impact found", count: n("set_aside") }]]} /></div>
      <div className="card mt12">
        {items === null ? (err == null && <InlineSkeleton />) : !rows.length ? (
          <Empty icon="search" title={show === "all" ? `Nothing found in the last ${DAYS} days` : "None in this group"}
            actions={show === "all" ? <Link className="btn" to="/monitors"><Icon name="monitor" />See your monitors</Link> : undefined}>
            {show === "all" ? "When a monitor, a market series or Radar notices something, it appears here." : "Choose another group above."}</Empty>
        ) : (
          <ul className="evlist" aria-label="Findings">{rows.map(f => {
            const [label, tone] = FINDING_STATUS[f.status];
            const si = sourceInfo(f.source), src = sourceLink(f);
            const ev = f.outcome?.event_id ? events[f.outcome.event_id] : undefined;
            const url = (f as WithEvidence).evidence?.headlines?.find(h => h.url)?.url;
            const sig = signalStrength(f.score);
            return (
              <li key={f.finding_id} id={`f-${f.finding_id}`} className={`fd-row ${target === `f-${f.finding_id}` ? "fd-target" : ""}`}>
                <div className="evrow">
                  <span className="evrow-ico"><Icon name={si.icon} /></span>
                  <span className="evrow-main">
                    <span className="row-top"><b className="row-l dl-fd-t">{url
                      ? <a href={url} target="_blank" rel="noreferrer">{f.title}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a>
                      : f.title}</b><StatusPill tone={tone}>{label}</StatusPill></span>
                    <span className="row-d fd-what">
                      {f.status === "new" && <>Waiting to be investigated{nextBatch ? `: the next batch goes ${nextBatch}` : ""}</>}
                      {f.status === "grouped" && <>Being investigated{f.run_started_at ? `, started ${ago(f.run_started_at, now)}` : ""}</>}
                      {f.status === "linked" && f.outcome?.event_id && <>In the event <Link to={`/events/${f.outcome.event_id}`}>{ev ? eventTitle(ev) : "open the event"}</Link></>}
                      {f.status === "set_aside" && <>No impact found: {reasonText(f) || "no link to your products"}</>}
                    </span>
                    {f.explanation && <span className="row-d muted">{f.explanation}</span>}
                    {f.status === "grouped" && f.run_status === "running" && f.run_id && <span className="row wrap">
                      <button className="btn btn--sm" type="button" disabled={checking === f.finding_id} onClick={() => check(f)}>
                        <Icon name="refresh" className={checking === f.finding_id ? "spin" : undefined} />Check now</button>
                      <span className="small muted">Otherwise the result comes in on its own within a few minutes.</span></span>}
                  </span>
                  <span className="evrow-side">
                    {sig && <span className={`dl-sig t-${sig[1]}`} title="How strongly the source flagged it">{sig[0]}</span>}
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
