// Findings: what the sources found in the last 7 days, and what the investigation made of each (waiting, being
// investigated, in an event, set aside and why). No live push: the page reloads every 30 s, and Refresh reloads now.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type FindingRow } from "../../api/investigation";
import { Icon } from "../../components/Icon";
import { Banner, Empty, InlineSkeleton, PageHead, useNow, useToast } from "../../components/ui";
import { ago, dayTime, plural, until } from "../../format";
import { InvestigateNowButton, useInvestigationStatus } from "../events/Events";
import { DAYS, reasonText, STATUS, useRecentFindings } from "./recent";

type Show = "all" | "new" | "grouped" | "linked" | "set_aside";
const SHOW: [Show, string][] = [["all", "All"], ["grouped", "Being investigated"], ["linked", "In an event"], ["set_aside", "Set aside"], ["new", "Waiting"]];
const SOURCE: Record<string, string> = { monitor: "a monitor", timeseries: "a market series", radar: "Radar" };

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
  const refresh = () => { load(); reload(); };
  const target = decodeURIComponent(hash.slice(1));
  useEffect(() => {  // from the Overview: open on that finding
    if (!items || !target) return;
    document.getElementById(target)?.scrollIntoView({ block: "center" });
  }, [items, target]);
  const rows = useMemo(() => (items ?? []).filter(f => show === "all" || f.status === show), [items, show]);
  const count = (s: Show) => (items ?? []).filter(f => s === "all" || f.status === s).length;
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
  return (
    <div className="page">
      <PageHead title="Findings" sub={`What your monitors, market series and Radar found in the last ${DAYS} days, and what the investigation made of each.`}
        actions={<>
          <span className="small muted">Updated {loadedAt ? ago(loadedAt.toISOString(), now) : ""}</span>
          <button className="btn" type="button" onClick={refresh}><Icon name="refresh" />Refresh</button>
          {status && status.findings_waiting > 0 && status.connected ? <InvestigateNowButton onDone={refresh} small /> : null}
        </>} />
      {err && <Banner kind="warn" icon="warn">Couldn't refresh: {err}</Banner>}
      <span className="seg" role="group" aria-label="Which findings">{SHOW.map(([k, label]) => (
        <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}>{label} ({count(k)})</button>))}</span>
      <div className="card mt12">
        {items === null ? <InlineSkeleton /> : !rows.length ? (
          <Empty icon="search" title={show === "all" ? `Nothing found in the last ${DAYS} days` : "None in this group"}>
            {show === "all" ? "When a monitor, a market series or Radar finds something, it appears here, then goes to the investigation." : "Choose another group above."}</Empty>
        ) : (
          <div className="list">{rows.map(f => {
            const [cls, label] = STATUS[f.status];
            const src = sourceLink(f);
            return (
              <div key={f.finding_id} id={`f-${f.finding_id}`} className={`li fd-row ${target === `f-${f.finding_id}` ? "fd-target" : ""}`}>
                <Icon name={f.source === "monitor" ? "monitor" : f.source === "radar" ? "radar" : "series"} className="ico16" />
                <div className="col" style={{ gap: 4, minWidth: 0, flex: 1 }}>
                  <div className="row wrap" style={{ gap: 8 }}><b>{f.title}</b><span className={`badge ${cls}`}>{label}</span></div>
                  {f.explanation && <div className="small">{f.explanation}</div>}
                  <div className="small muted">
                    {dayTime(f.created_at)} · from {src ? <Link to={src}>{SOURCE[f.source] ?? f.source}</Link> : SOURCE[f.source] ?? f.source}
                    {" · "}
                    {f.status === "new" && <>waiting for the investigation{status?.next_batch_at && status.connected ? <>: the next batch goes {new Date(status.next_batch_at) <= now ? "on the next refresh" : `in ${until(status.next_batch_at, now)}`}</> : null}</>}
                    {f.status === "grouped" && <>being investigated{f.run_started_at ? `, started ${ago(f.run_started_at, now)}` : ""}</>}
                    {f.status === "linked" && f.outcome?.event_id && <>traced to your products: <Link to={`/events/${f.outcome.event_id}`}>open the event</Link></>}
                    {f.status === "set_aside" && <>investigated, no event: {reasonText(f)}</>}
                  </div>
                  {f.status === "grouped" && f.run_status === "running" && f.run_id && <div>
                    <button className="btn btn--sm" type="button" disabled={checking === f.finding_id} onClick={() => check(f)}>
                      <Icon name="refresh" className={checking === f.finding_id ? "spin" : undefined} />Check now</button>
                    <span className="small muted"> The result is otherwise collected on the server's next refresh.</span></div>}
                </div>
              </div>);
          })}</div>
        )}
      </div>
      {items && items.length > 0 && <p className="small muted mt8">{plural(items.length, "finding")} in the last {DAYS} days. Simulated findings (from tests) aren't shown.</p>}
    </div>
  );
}
