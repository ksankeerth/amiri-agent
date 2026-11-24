// Events: what happened in the world, most serious first, grouped by what it means for the bank (could hurt you,
// could help you, touch none of your products). Closed events and, for the Platform Admin, the investigation runs
// are folded. The page reloads every 30 s; Refresh reloads now.
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { alertsApi } from "../../api/alerts";
import { investigationApi, type EventDetail, type EventRow, type InvestigationStatus, type Run, type Theme } from "../../api/investigation";
import { Places } from "../../components/blocks";
import { Fold, GoLink, PageTitle, QuietWarn, Result, Section, TextButton, TextTabs, ToneMark, ToneWord, TONE_WORD } from "../../components/rd";
import { Icon } from "../../components/Icon";
import { LockBtn } from "../../components/lock";
import { errText, isDown, LoadError, ListSkeleton, useNow, useRole, useToast } from "../../components/ui";
import { ago, day, dayTime, until, plural, ZONE_LABEL } from "../../format";
import { count, eventTitle, investigationFailed, longWhen, themeLabel } from "../../plain";
import "../../styles/rd-events.css";
import { DAYS, useRecentFindings } from "../findings/recent";
import { checkWords, fetchRuns, GROUP_TITLE, RUNS_LIMIT, runKind, runWords, sortEvents, splitGroups, whenText, type CheckWords, type GroupKey, type Sort } from "./listWords";

/** A theme tag in words ("Oil prices up"): the Overview and Radar use it too. */
export const themeText = (t: Theme) => themeLabel(t);

const details = new Map<string, EventDetail>();
/** Each listed event's detail (its checks), fetched once per page load and kept while the page is open. */
export function useEventDetails(ids: string[]): Record<string, EventDetail> {
  const [, bump] = useState(0);
  const key = ids.join(",");
  useEffect(() => {
    const todo = ids.filter(id => !details.has(id)).slice(0, 30);
    if (!todo.length) return;
    let live = true;
    Promise.all(todo.map(id => investigationApi.event(id).then(e => { details.set(id, e); }).catch(() => {})))
      .then(() => { if (live) bump(n => n + 1); });
    return () => { live = false; };
  }, [key]);  // eslint-disable-line react-hooks/exhaustive-deps
  return Object.fromEntries(ids.filter(id => details.has(id)).map(id => [id, details.get(id)!]));
}

export function useInvestigationStatus() {
  const [status, setStatus] = useState<InvestigationStatus | null>(null);
  const reload = useCallback(() => { investigationApi.status().then(setStatus).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload]);
  return { status, reload };
}

export function InvestigateNowButton({ ids, onDone, small }: { ids?: string[]; onDone: () => void; small?: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const out = await investigationApi.investigateNow(ids);
      const sent = out.items.reduce((n, r) => n + r.finding_ids.length, 0);
      toast([sent ? `Sent ${plural(sent, "finding")} to the investigation agent.` : "",
             out.developments.length ? `${out.developments.length} joined an open event as the same move continuing (${out.developments[0].event_title}).` : ""]
        .filter(Boolean).join(" "));
      onDone();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  return <button className={`btn${small ? " btn--sm" : ""}`} type="button" onClick={go} disabled={busy} title="Skips the wait for the next batch">
    <Icon name={busy ? "refresh" : "play"} className={busy ? "spin" : undefined} />Investigate now</button>;
}

// ---------------------------------------------------------------- investigation runs (Platform Admin)
function RunsTable({ runs, now, onCheck, finished }: { runs: Run[]; now: Date; onCheck?: (r: Run) => void; finished?: boolean }) {
  return (
    <table className="rd-table ev-runs">
      <thead><tr><th>Started</th><th>Findings</th><th>{finished ? "Found" : "What happened"}</th>{onCheck && <th><span className="sr">Actions</span></th>}</tr></thead>
      <tbody>{runs.map(r => {
        const k = runKind(r), w = k === "failed" || k === "stopped" ? runWords(r) : null;
        return (
          <tr key={r.run_id}>
            <td className="ev-when" title={longWhen(r.created_at)}>{dayTime(r.created_at)}
              <span className="rd-fine">{ago(r.created_at, now)}{r.world === "sandbox" ? " · simulated" : ""}</span></td>
            <td className="rd-num">{r.finding_ids.length}</td>
            <td>{w ? <><ToneWord tone="mixed">{w.what}</ToneWord>{w.why && <> · {w.why}</>}{r.attempt > 1 && <span className="rd-fine"> · attempt {r.attempt}</span>}</>
              : k === "running" ? "Still running"
              : !r.events ? "No event made"
              : `${plural(r.events, "event")}, ${plural(r.hypotheses ?? 0, "possible impact")}${r.validation ? `, ${plural(r.tasks ?? 0, "check")}` : ""}`}</td>
            {onCheck && <td>{k === "running" && <TextButton onClick={() => onCheck(r)}>Check now</TextButton>}</td>}
          </tr>);
      })}</tbody>
    </table>
  );
}

function Runs({ runs, onChange }: { runs: Run[]; onChange: () => void }) {
  const toast = useToast();
  const now = useNow(30_000);
  const [all, setAll] = useState(false);
  const [shownN, setShownN] = useState(25);
  const check = async (r: Run) => {
    try { const x = await investigationApi.collect(r.run_id); toast(x.status === "running" ? "Still running; it's collected on the next tick." : "Collected."); onChange(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const running = runs.filter(r => runKind(r) === "running");
  const trouble = runs.filter(r => ["failed", "stopped"].includes(runKind(r)));
  const finished = runs.filter(r => runKind(r) === "finished");
  const summary = !runs.length ? "none yet" : <>the last {runs.length >= RUNS_LIMIT ? RUNS_LIMIT : runs.length}: {finished.length} finished
    {running.length > 0 && <>, {running.length} running</>}
    {trouble.length > 0 ? <>, <b className="rd-warn">{trouble.length} failed</b></> : ", none failed"}</>;
  return (
    <Fold title="Investigation runs" summary={<>Platform Admin · {summary}</>} remember="events-runs">
      {!runs.length ? <p className="rd-fine">None yet.</p> : <>
        {running.length > 0 && <RunsTable runs={running} now={now} onCheck={check} />}
        {trouble.length > 0
          ? <RunsTable runs={trouble} now={now} />
          : <p className="rd-row-d">No run failed in the last {runs.length >= RUNS_LIMIT ? RUNS_LIMIT : runs.length}.</p>}
        {finished.length > 0 && <div className="ev-more">
          <TextButton aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? "Hide the runs that finished" : `Show the ${finished.length} that finished`}</TextButton></div>}
        {all && <RunsTable runs={finished.slice(0, shownN)} now={now} finished />}
        {all && finished.length > shownN && <div className="ev-more">
          <TextButton onClick={() => setShownN(n => n + 25)}>Show 25 more ({finished.length - shownN} not shown)</TextButton></div>}
      </>}
    </Fold>
  );
}

function ClearSandbox({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const clear = async () => {
    try { const r = await investigationApi.clearSandbox(); toast(`Cleared ${plural(r.findings, "simulated finding")} and ${plural(r.investigations, "run")}.`); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setAsking(false); }
  };
  return asking ? <span className="ev-ask"><span className="rd-fine">Remove every simulated finding, run and event?</span>
    <LockBtn className="btn btn--danger" onClick={clear}>Clear</LockBtn>
    <button className="btn" type="button" onClick={() => setAsking(false)}>Cancel</button></span>
    : <LockBtn className="btn" onClick={() => setAsking(true)}><Icon name="trash" />Clear simulated</LockBtn>;
}

// ---------------------------------------------------------------- the page
function CheckCell({ w }: { w: CheckWords | null }) {
  if (!w) return null;
  return <div className="ev-ck">
    {w.progress && <div>{w.progress}:</div>}
    {w.result ? <Result verdict={w.result.verdict} adverse={w.result.adverse} figure={w.result.figure} /> : <div>{w.text}</div>}
  </div>;
}

export function EventsPage() {
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [sort, setSort] = useState<Sort>("serious");
  const [sim, setSim] = useState(false);  // simulated events (from a series' "Simulate a move") stay out of the live picture unless asked for
  const [help, setHelp] = useState(false);
  const helpId = useId();
  const now = useNow(30_000);
  const { status, reload: reloadStatus } = useInvestigationStatus();
  const [events, setEvents] = useState<EventRow[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const recent = useRecentFindings();
  const [toReview, setToReview] = useState(0);
  useEffect(() => { alertsApi.summary().then(x => setToReview(x.to_review)).catch(() => {}); }, []);
  const load = useCallback(async () => {
    try {
      const e = await investigationApi.events();
      setEvents(e); setErr(null); setLoadedAt(new Date()); reloadStatus();
    } catch (e) { setErr(e); }
  }, [reloadStatus]);
  const loadRuns = useCallback(() => { if (admin) fetchRuns().then(setRuns).catch(() => {}); }, [admin]);
  const reloadAll = useCallback(() => { load(); loadRuns(); }, [load, loadRuns]);
  const refresh = () => { reloadAll(); recent.load(); };
  useEffect(() => { reloadAll(); const t = setInterval(reloadAll, 30_000); return () => clearInterval(t); }, [reloadAll]);

  const inProgress = (recent.items ?? []).filter(f => f.status === "grouped").length;
  const noEvent = (recent.items ?? []).filter(f => f.status === "set_aside");
  // "set aside" holds both judgements and runs the agent refused: only the first are "no impact found"
  const notInvestigated = noEvent.filter(f => investigationFailed(f.status, f.outcome?.reason)).length;
  const noImpact = noEvent.length - notInvestigated;

  const nSim = (events ?? []).filter(e => e.world !== "live").length;
  const shown = (events ?? []).filter(e => sim || e.world === "live");  // what the tabs count
  const tabRows = useMemo(() => shown.filter(e => show === "all" || e.status === show), [events, show, sim]);  // eslint-disable-line react-hooks/exhaustive-deps
  const closedFold = show === "open" ? shown.filter(e => e.status === "closed") : [];
  const groups = useMemo(() => splitGroups(sortEvents(tabRows, sort)), [tabRows, sort]);
  const ev = useEventDetails([...groups.hurt, ...groups.help].map(e => e.event_id));

  // the sentence counts the live open events, whatever the tab
  const open = (events ?? []).filter(e => e.world === "live" && e.status === "open");
  const oc = splitGroups(open);
  const lede = events === null ? null : !open.length ? <b>Nothing is open right now.</b> : <>
    <b>{open.length} open.</b>{" "}
    {[oc.hurt.length ? `${oc.hurt.length} could hurt your products` : "", oc.help.length ? `${oc.help.length} could help` : "",
      oc.none.length ? `${oc.none.length} touch none of them` : ""].filter(Boolean).join(", ")}.{" "}</>;

  const nextBatch = status?.next_batch_at && status.connected ? (new Date(status.next_batch_at) <= now ? "very soon" : `in ${until(status.next_batch_at, now)}`) : null;

  const small = (e: EventRow) => <>
    {whenText(e, day)}{e.places.length > 0 && <> · <Places codes={e.places} max={3} /></>}
    {e.world !== "live" && " · simulated"}{e.status === "closed" && show !== "open" && ` · closed${e.closed_at ? ` ${day(e.closed_at)}` : ""}`}</>;

  const eventRow = (e: EventRow) => (
    <li key={e.event_id} className="ev-row">
      <span className="ev-shape"><ToneMark tone={e.tone} label={`${TONE_WORD[e.tone]}: `} /></span>
      <div className="ev-main">
        <div className="rd-row-t"><Link className="rd-name" to={`/events/${e.event_id}`}>{eventTitle(e)}</Link></div>
        <div className="rd-row-m" title={longWhen(e.anchor)}>{small(e)}</div>
      </div>
      <div className="ev-n"><b>{e.hypotheses}</b><span>{e.hypotheses === 1 ? "possible impact" : "possible impacts"}</span></div>
      <CheckCell w={checkWords(ev[e.event_id])} />
    </li>);

  const quietRow = (e: EventRow) => (
    <li key={e.event_id} className="ev-quiet">
      <span className="ev-shape"><ToneMark tone={e.tone} label={`${TONE_WORD[e.tone]}: `} /></span>
      <Link className="rd-name" to={`/events/${e.event_id}`}>{eventTitle(e)}</Link>
      <span className="rd-fine">{e.hypotheses > 0 ? `${plural(e.hypotheses, "possible impact")} · ` : ""}{e.status === "closed" && show === "open" && e.closed_at ? `closed ${day(e.closed_at)} · ` : ""}{whenText(e, day)}{e.world !== "live" ? " · simulated" : ""}</span>
    </li>);

  const order: GroupKey[] = ["hurt", "help", "none"];
  const first = order.find(k => groups[k].length);
  const groupView = (k: GroupKey) => groups[k].length ? (
    <Section key={k} className="ev-grp" title={GROUP_TITLE[k]} count={groups[k].length} meta={k === first ? `${ZONE_LABEL} time` : undefined}>
      <ul className="ev-list" aria-label={GROUP_TITLE[k]}>{groups[k].map(k === "none" ? quietRow : eventRow)}</ul>
    </Section>) : null;

  const tabs = [
    { key: "open" as const, label: "Open", count: shown.filter(e => e.status === "open").length },
    { key: "closed" as const, label: "Closed", count: shown.filter(e => e.status === "closed").length },
    { key: "all" as const, label: "All", count: shown.length },
  ];

  return (
    <div className="page rd rd-events">
      <PageTitle title="Events"
        actions={<>
          <span className="rd-fine">{loadedAt ? `Updated ${ago(loadedAt.toISOString(), now)}` : ""}</span>
          <TextButton onClick={refresh}><span aria-hidden="true">↻ </span>Refresh</TextButton>
          {admin && sim && ((events ?? []).some(e => e.world === "sandbox") || runs.some(r => r.world === "sandbox")) ? <ClearSandbox onDone={reloadAll} /> : null}
          {toReview > 0 && <Link className="btn btn--primary" to="/alerts">Review {count(toReview, "alert")} →</Link>}
        </>}
        lede={lede ? <>{lede}<TextButton aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(h => !h)}>How this works</TextButton></> : undefined}
        help={<div id={helpId} className="rd-open rd-prose rd-help" hidden={!help}>
          <p>An event is something that happened in the world, traced to the products it could hit. It stays open while
            news about it keeps coming, then closes.</p></div>} />

      <div className="ev-lines">
        {err != null && (events === null ? <LoadError error={err} onRetry={refresh} what="the events" />
          : <QuietWarn>Couldn't refresh: {isDown(err) ? "Amiri Agent didn't answer" : errText(err)}. Showing what was loaded.</QuietWarn>)}
        {admin && status?.notes.map(n => status.connected ? <p key={n} className="rd-fine">{n}</p> : <QuietWarn key={n}>{n}</QuietWarn>)}
        {!admin && status && !status.connected && <QuietWarn>New findings can't be investigated right now. Your Platform Admin has been told.</QuietWarn>}
        {status && status.findings_waiting > 0 && (
          <div className="ev-wait"><span><b>{plural(status.findings_waiting, "finding")} waiting</b> to be investigated{nextBatch ? `, ${nextBatch}` : ""}.</span>
            {status.connected && <InvestigateNowButton onDone={refresh} />}</div>
        )}
      </div>

      {(events !== null || err == null) && <TextTabs label="Which events" items={tabs} value={show} onChange={setShow}
        end={<>
          <label className="ev-sort">Sort <select className="input" value={sort} onChange={e => setSort(e.target.value as Sort)}>
            <option value="serious">Most serious first</option><option value="newest">Newest first</option><option value="impacts">Most possible impacts</option></select></label>
          {nSim > 0 && <label className="check rd-fine"><input type="checkbox" checked={sim} onChange={e => setSim(e.target.checked)} /> Also show {plural(nSim, "simulated event")} (from tests; not real)</label>}
        </>} />}

      {events === null ? (err == null && <div className="mt12"><ListSkeleton rows={3} /></div>)
        : !tabRows.length && !closedFold.length ? (
          <div className="rd-empty">
            <p className="rd-lede">{show === "open" ? "No open events." : "No events here."} When Amiri Agent traces news or a price move to your products, the event appears here.</p>
            <Link className="btn" to="/studio">Try a what-if in the Scenario Studio</Link></div>
        ) : <div className="ev-groups">
          {!tabRows.length && <p className="rd-lede ev-none">No open events right now.</p>}
          {order.map(groupView)}
        </div>}

      {events !== null && (recent.items?.length ?? 0) > 0 && (noEvent.length > 0 || inProgress > 0) && (
        <p className="ev-findings">
          {noEvent.length > 0 && <>This week, {noEvent.length === 1 ? "1 finding didn't" : `${noEvent.length} findings didn't`} make an event:{" "}
            {noImpact} no impact found{notInvestigated > 0 && <>, <ToneWord tone="mixed">{notInvestigated} couldn't be investigated</ToneWord></>}.{" "}</>}
          {inProgress > 0 && <>{inProgress} {inProgress === 1 ? "is" : "are"} being investigated now.{" "}</>}
          <GoLink to="/findings">See {noEvent.length > 0 ? "them" : "it"} in Findings</GoLink>
          <span className="sr"> (the last {DAYS} days)</span>
        </p>
      )}

      {events !== null && (closedFold.length > 0 || admin) && <div className="ev-folds">
        {closedFold.length > 0 && (
          <Fold title="Closed events" summary={`${closedFold.length}, closed when no new news came in`} remember="events-closed">
            <ul className="ev-list" aria-label="Closed events">{sortEvents(closedFold, "newest").map(quietRow)}</ul>
          </Fold>)}
        {admin && <Runs runs={runs} onChange={reloadAll} />}
      </div>}
    </div>
  );
}
