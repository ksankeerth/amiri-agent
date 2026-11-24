// Events (board 03; states: boards 15 and 16): what happened in the world, traced to the products it could hit, most
// serious first. One table: the direction for you, the products it could move, how many effects, how many alerts wait.
// Tabs Open / Closed / All, a sort, simulated events on request, "show more" past 25. Reloads every 30 s (every 8 s while an
// investigation runs); Refresh reloads now. For the Platform Admin the investigation runs are folded under the list.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { alertsApi } from "../../api/alerts";
import { investigationApi, type EventDetail, type EventRow, type Run } from "../../api/investigation";
import { Icon } from "../../components/Icon";
import { usePlaceNames } from "../../components/blocks";
import { useNow, useRole } from "../../components/ui";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs } from "../../components/v2/Shell";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { TabPanel, Tabs } from "../../components/v2/Tabs";
import { ago, plural, until, ZONE_LABEL } from "../../format";
import { count, investigationFailed } from "../../plain";
import { DAYS, useRecentFindings } from "../findings/recent";
import { InvestigateNowButton, useInvestigationStatus } from "./investigate";
import { ClearSimulated, EventsSkeleton, EventsTable, Note, Runs, RunningNote } from "./listParts";
import { alertsByEvent, confirmedCount, ledeText, page, PAGE_SIZE, RUNS_LIMIT, sortEvents, tabRows, type Show, type Sort } from "./listWords";
import "../../styles/v2/events.css";

const REFRESH_MS = 30_000, RUNNING_MS = 8_000, EVENTS_LIMIT = 200, DETAIL_BATCH = 8, DETAIL_FRESH_MS = 90_000, DETAIL_MAX = 60;
const CRUMBS = [{ label: "What it found" }, { label: "Events" }];

// ---------------------------------------------------------------- each event's detail (its products and last news)
const details = new Map<string, { at: number; e: EventDetail }>();
const missed = new Set<string>();
/** The detail of each listed event, a few at a time: kept while the page is open and asked for again once it is a minute and a half old
 *  (`version` changes with every reload of the list). What is on screen stays until the new answer is in. */
export function useEventDetails(ids: string[], version: number): { byId: Record<string, EventDetail>; waiting: (id: string) => boolean } {
  const [tick, bump] = useState(0);
  const key = ids.join(",");
  useEffect(() => {
    const t = Date.now();
    const todo = ids.filter(id => !missed.has(id) && (!details.has(id) || t - details.get(id)!.at > DETAIL_FRESH_MS)).slice(0, DETAIL_BATCH);
    if (!todo.length) return;
    let live = true;
    Promise.all(todo.map(id => investigationApi.event(id).then(e => { details.set(id, { at: Date.now(), e }); }).catch(() => { if (!details.has(id)) missed.add(id); })))
      .then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
  }, [key, version, tick]);  // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => Object.fromEntries(ids.filter(id => details.has(id)).map(id => [id, details.get(id)!.e])),  // eslint-disable-line react-hooks/exhaustive-deps
    [key, version, tick]);
  return { byId, waiting: id => !details.has(id) && !missed.has(id) };
}

const SORTS: { id: Sort; label: string }[] = [
  { id: "serious", label: "Most serious first" }, { id: "newest", label: "Newest first" }, { id: "impacts", label: "Most possible effects" },
];

export function EventsPage() {
  useCrumbs(CRUMBS);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [show, setShow] = useState<Show>("open");
  const [sort, setSort] = useState<Sort>("serious");
  const [sim, setSim] = useState(false);  // simulated events (from a series' "Simulate a move") stay out of the live picture unless asked for
  const [shownN, setShownN] = useState(PAGE_SIZE);
  const sortId = useId();
  const now = useNow(30_000);
  const { status, reload: reloadStatus } = useInvestigationStatus();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const recent = useRecentFindings();
  const [toReview, setToReview] = useState(0);
  const [alerts, setAlerts] = useState<Map<string, number>>(new Map());

  const load = useCallback(async () => {
    try {
      const e = await investigationApi.events(EVENTS_LIMIT);
      setEvents(e); setErr(null); setLoadedAt(Date.now()); reloadStatus();
      alertsApi.list({ status: "new" }).then(a => setAlerts(alertsByEvent(a))).catch(() => { /* the list reads without the alerts column */ });
      alertsApi.summary().then(x => setToReview(x.to_review)).catch(() => {});
    } catch (e) { setErr(e); }
  }, [reloadStatus]);
  const loadRuns = useCallback(() => { if (admin) investigationApi.runs(RUNS_LIMIT).then(setRuns).catch(() => {}); }, [admin]);
  const reloadAll = useCallback(() => { load(); loadRuns(); }, [load, loadRuns]);
  const refresh = () => { reloadAll(); recent.load(); };
  const running = (status?.runs_running ?? 0) > 0;
  useEffect(() => { reloadAll(); const t = setInterval(reloadAll, running ? RUNNING_MS : REFRESH_MS); return () => clearInterval(t); }, [reloadAll, running]);
  useEffect(() => { setShownN(PAGE_SIZE); }, [show, sort, sim]);

  const all = events ?? [];
  const nSim = all.filter(e => e.world !== "live").length;
  const counted = all.filter(e => sim || e.world === "live");  // what the tabs count
  const rows = useMemo(() => sortEvents(tabRows(all, show, sim), sort), [events, show, sort, sim]);  // eslint-disable-line react-hooks/exhaustive-deps
  const { shown, left } = page(rows, shownN);

  // the sentence under the heading counts the live open events, whatever the tab
  const open = all.filter(e => e.world === "live" && e.status === "open");
  const ids = useMemo(() => [...new Set([...shown.map(e => e.event_id), ...open.map(e => e.event_id)])].slice(0, DETAIL_MAX), [shown, events]);  // eslint-disable-line react-hooks/exhaustive-deps
  const { byId, waiting } = useEventDetails(ids, loadedAt ?? 0);
  const openIn = open.map(e => byId[e.event_id]);
  const detailsIn = open.length > 0 && open.length <= DETAIL_MAX && openIn.every(Boolean);
  const products = detailsIn ? new Set(openIn.flatMap(d => d!.hypotheses.map(h => h.product_id))).size : null;
  const lede = events === null ? null : ledeText({
    open, products, confirmed: detailsIn ? confirmedCount(openIn) : null, validation: status ? status.validation : null,
  });

  const placeName = usePlaceNames(useMemo(() => [...new Set(shown.flatMap(e => e.places))], [shown]));

  const inProgress = (recent.items ?? []).filter(f => f.status === "grouped").length;
  const noEvent = (recent.items ?? []).filter(f => f.status === "set_aside");
  // "set aside" holds both judgements and runs the agent refused: only the first are "no impact found"
  const notInvestigated = noEvent.filter(f => investigationFailed(f.status, f.outcome?.reason)).length;
  const noImpact = noEvent.length - notInvestigated;

  const nextBatch = status?.next_batch_at && status.connected ? (new Date(status.next_batch_at) <= now ? "very soon" : `in ${until(status.next_batch_at, now)}`) : null;
  const tabs = [  // no counts until the list is in: "0" would say there are none
    { id: "open", label: "Open", count: events && counted.filter(e => e.status === "open").length, countLabel: "open events" },
    { id: "closed", label: "Closed", count: events && counted.filter(e => e.status === "closed").length, countLabel: "closed events" },
    { id: "all", label: "All", count: events && counted.length, countLabel: "events" },
  ].map(t => ({ ...t, count: t.count ?? undefined }));
  const hasSim = admin && sim && (all.some(e => e.world === "sandbox") || runs.some(r => r.world === "sandbox"));

  return (
    <div className="v2-evs">
      {err != null && events !== null && loadedAt != null && <StaleBanner loadedAt={loadedAt} now={now.getTime()} onRetry={refresh} />}

      <header className="v2-evs-head">
        <div className="v2-evs-head__t">
          <h1 className="v2-evs-h1">Events</h1>
          {lede && <p className="v2-evs-lede">
            {lede.hot && <><b className="v2-evs-lede__hot">{lede.hot}</b> · </>}{lede.rest.join(" · ")}
          </p>}
        </div>
        <div className="v2-evs-head__act">
          {loadedAt != null && <span className="v2-meta">Updated {ago(new Date(loadedAt).toISOString(), now)}</span>}
          <Button size="sm" variant="quiet" onClick={refresh}><Icon name="refresh" />Refresh</Button>
          {hasSim && <ClearSimulated onDone={reloadAll} />}
          {toReview > 0 && <Button as="link" to="/alerts" variant="primary" size="sm">Review {count(toReview, "alert")} →</Button>}
        </div>
      </header>

      {events === null && err != null && <LoadError error={err} onRetry={refresh} what="the events" />}

      {(admin ? status?.notes ?? [] : []).map(n => status!.connected ? <p key={n} className="v2-meta">{n}</p> : <Note key={n} tone="warn">{n}</Note>)}
      {!admin && status && !status.connected && <Note tone="warn">New findings can't be investigated right now. Your Platform Admin has been told.</Note>}
      {running && <RunningNote n={status!.runs_running} />}
      {status && status.findings_waiting > 0 && (
        <Note action={status.connected ? <InvestigateNowButton onDone={refresh} small /> : undefined}>
          <b>{plural(status.findings_waiting, "finding")} waiting</b> to be investigated{nextBatch ? `, ${nextBatch}` : ""}.
        </Note>
      )}

      {(events !== null || err == null) && (
        <Tabs label="Which events" tabs={tabs} value={show} onChange={id => setShow(id as Show)} className="v2-evs-tabs"
          trailing={<label className="v2-evs-sort" htmlFor={sortId}>Sort
            <select id={sortId} className="v2-evs-select" value={sort} onChange={e => setSort(e.target.value as Sort)}>
              {SORTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select></label>}>
          <TabPanel id={show}>
            {nSim > 0 && <label className="v2-evs-sim"><input type="checkbox" checked={sim} onChange={e => setSim(e.target.checked)} /> Also show {plural(nSim, "simulated event")} (from tests; not real)</label>}
            {events === null ? <EventsSkeleton />
              : !rows.length ? <EmptyList show={show} closed={counted.filter(e => e.status === "closed").length} />
              : <>
                <EventsTable rows={shown} details={byId} waiting={waiting} alerts={alerts} placeName={placeName} now={now}
                  label={show === "open" ? "Open events" : show === "closed" ? "Closed events" : "All events"} />
                {left > 0 && <div className="v2-evs-more">
                  <Button variant="quiet" onClick={() => setShownN(n => n + PAGE_SIZE)}>Show {Math.min(left, PAGE_SIZE)} more ({plural(left, "event")} not shown)</Button></div>}
                {events.length >= EVENTS_LIMIT && left === 0 && <p className="v2-meta v2-evs-cap">Showing the latest {EVENTS_LIMIT} events.</p>}
                <p className="v2-meta v2-evs-foot">Times are in {ZONE_LABEL}. An event is something that happened in the world, traced to the products it could hit. It stays open while news about it keeps coming, then closes.</p>
              </>}
          </TabPanel>
        </Tabs>
      )}

      {events !== null && (recent.items?.length ?? 0) > 0 && (noEvent.length > 0 || inProgress > 0) && (
        <p className="v2-evs-findings">
          {noEvent.length > 0 && <>This week, {noEvent.length === 1 ? "1 finding didn't" : `${noEvent.length} findings didn't`} make an event:{" "}
            {noImpact} no impact found{notInvestigated > 0 && <>, <b className="v2-evs-warnword">{notInvestigated} couldn't be investigated</b></>}.{" "}</>}
          {inProgress > 0 && <>{inProgress} {inProgress === 1 ? "is" : "are"} being investigated now.{" "}</>}
          <ArrowLink to="/findings">See {noEvent.length > 0 ? "them" : "it"} in Findings</ArrowLink>
          <span className="v2-sr"> (the last {DAYS} days)</span>
        </p>
      )}

      {events !== null && admin && <Runs runs={runs} onChange={reloadAll} />}
    </div>
  );
}

function EmptyList({ show, closed }: { show: Show; closed: number }) {
  if (show === "closed") return <Empty title="No closed events">An event closes when no new news about it has come in for a while.</Empty>;
  return (
    <Empty title={show === "open" ? "Nothing open right now" : "No events yet"}
      action={<Button as="link" to="/studio">Try a what-if in the Scenario Studio</Button>}>
      When Amiri Agent traces news or a price move to your products, the event appears here.
      {show === "open" && closed > 0 && <> {plural(closed, "closed event")} can be found under Closed.</>}
    </Empty>
  );
}
