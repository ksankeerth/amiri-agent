// Events, as a reader: the headline says which events could hit the bank's products; the list on the left groups them by
// whether anything was traced to a product, and the chosen one reads in full on the right: why it matters by product,
// where it started, where it is, and the way into the event. The investigation's queue is one line, not stacked banners.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { alertsApi } from "../../api/alerts";
import { investigationApi, type EventDetail, type EventRow, type InvestigationStatus, type Run, type Theme } from "../../api/investigation";
import { HowItWorks, PageHeader, Places, TonePill } from "../../components/blocks";
import { CheckBrief } from "../../components/checks";
import { FlowFilter } from "../../components/FlowFilter";
import { Icon } from "../../components/Icon";
import { Empty, useNow, useRole, useToast, InlineSkeleton, LoadError } from "../../components/ui";
import { ago, dayTime, until, plural } from "../../format";
import { count, eventTitle, impactText, longWhen, metricWords, onDay, productTypeLabel, sizeTiming, sourceInfo, themeLabel } from "../../plain";
import { useRecentFindings } from "../findings/recent";
import "../../styles/events.css";

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

export function ClearSandbox({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const clear = async () => {
    try { const r = await investigationApi.clearSandbox(); toast(`Cleared ${plural(r.findings, "simulated finding")} and ${plural(r.investigations, "run")}.`); onDone(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setAsking(false); }
  };
  return asking ? <span className="row" style={{ gap: 6 }}><span className="small">Remove every simulated finding, run and event?</span>
    <button className="btn btn--danger btn--sm" type="button" onClick={clear}>Clear</button>
    <button className="btn btn--sm" type="button" onClick={() => setAsking(false)}>Cancel</button></span>
    : <button className="btn" type="button" onClick={() => setAsking(true)}><Icon name="trash" />Clear simulated</button>;
}

type Show = "open" | "closed" | "all";
type Sort = "newest" | "impacts";
const TONE: Record<EventRow["tone"], string> = { bad: "bad for you", good: "good for you", mixed: "mixed for you", neutral: "neutral for you" };
// "disaster (abroad) in IR and LK and SA and YE" slips past eventTitle (the places on the end): the theme says it; the places show apart
const title = (e: EventRow) => { const t = eventTitle(e); return /^[a-z_]+ \([\w ]+\)/.test(t) && e.themes[0] ? themeLabel(e.themes[0]) : t; };
// the same product and move from two angles reads as one impact here (the event page keeps both)
const impacts = (d?: EventDetail) => [...new Map((d?.hypotheses ?? []).map(h => {
  const x = { id: h.hypothesis_id, product: h.product_name ?? productTypeLabel(h.product_type),
    what: impactText(metricWords(h.expected.metric), h.expected.direction), st: sizeTiming(h.expected.size, h.expected.timing) };
  return [`${x.product}|${x.what}`, x] as const;
})).values()];
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** The admin's run log as a quiet, folded section: one line per run, its status only where it isn't "done". */
function Runs({ runs, onChange }: { runs: Run[]; onChange: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const check = async (r: Run) => {
    try { const x = await investigationApi.collect(r.run_id); toast(x.status === "running" ? "Still running; it's collected on the next tick." : "Collected."); onChange(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const done = runs.filter(r => r.status === "completed").length;
  const STATUS: Record<Run["status"], string> = { running: "Running", completed: "", stopped_early: "Stopped early", failed: "Failed" };
  return <section className="ev-runs" aria-labelledby="ev-runs">
    <h2 id="ev-runs">Investigation runs <span>{runs.length}</span></h2>
    <p className="ev-sub">Each run sends a batch of findings to the investigation agent. {runs.length ? (done === runs.length ? `All ${runs.length} finished.` : `${done} of ${runs.length} finished.`) : "None yet."}</p>
    {open && <ol className="ev-lines">{runs.map(r => <li key={r.run_id} className={`ev-run ${r.status}`}>
      <time dateTime={r.created_at} title={longWhen(r.created_at)}>{dayTime(r.created_at)}</time>
      <span>{plural(r.finding_ids.length, "finding")} → {r.status === "running" ? "still running" : `${plural(r.events ?? 0, "event")}, ${plural(r.hypotheses ?? 0, "possible impact")}${r.validation ? `, ${plural(r.tasks ?? 0, "check")}` : ""}`}
        <span className="muted"> · {r.trigger === "now" ? "investigate now" : r.trigger === "tick" ? "scheduled" : r.trigger}{r.world === "sandbox" ? " · sandbox" : ""}{r.attempt > 1 ? ` · attempt ${r.attempt}` : ""}</span>
        {r.error && <span className="ev-err">{r.error}</span>}</span>
      <span className="ev-run-end">{STATUS[r.status] && <b className={`ev-st ${r.status}`}>{STATUS[r.status]}</b>}
        {r.status === "running" && <button className="btn btn--sm" type="button" onClick={() => check(r)}><Icon name="refresh" />Check now</button>}
        <code title="Run id">{r.run_id}</code></span>
    </li>)}</ol>}
    {runs.length > 0 && <button type="button" className="ev-more" aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon name="chevron" className={`ico16 ${open ? "rot" : ""}`} />{open ? "Show fewer" : `Show the ${runs.length}`}</button>}
  </section>;
}

/** What an event means for the bank: its impacts by product, where it started (its source, labelled), where it is, and the way in. */
function Brief({ e, det, checks }: { e: EventRow; det?: EventDetail; checks: boolean }) {
  const xs = impacts(det), f = det?.findings[0], si = f ? sourceInfo(f.source) : null;
  const url = f?.evidence?.headlines?.find(h => h.url)?.url;
  return <div className="ev-brief">
    {xs.length > 0 ? <>
      <h3>Why it matters to you</h3>
      <ul className="ev-imp">{xs.map(i => <li key={i.id}><b>{i.product}</b>: {lower(i.what)}<span className="muted"> · {i.st}</span></li>)}</ul>
    </> : e.hypotheses === 0 && <p>The investigation found nothing in it that reaches your products. It closes on its own when the news stops.</p>}
    {f && <p className="ev-src"><span>It started from</span>
      {si && <span className={`ev-lab src-${f.source}`}><Icon name={si.icon} />{si.label}</span>}
      <span>{url ? <a href={url} target="_blank" rel="noreferrer">{f.title}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a> : f.title}
        {e.developments > 0 && <span className="muted">, and {plural(e.developments, "more report")} joined it since</span>}.</span></p>}
    {e.places.length > 0 && <p className="ev-where"><span className="ev-lab place"><Icon name="pin" /><Places codes={e.places} max={4} /></span></p>}
    <p className="ev-facts"><span>{e.themes.map(themeLabel).join(" · ")}</span>
      <span>{e.status === "open" ? `Open until ${onDay(e.open_until)}` : `Closed ${e.closed_at ? onDay(e.closed_at) : ""}`}</span>
      {checks && det && <CheckBrief e={det} />}</p>
    <Link className="ev-go" to={`/events/${e.event_id}`}>Open the event<Icon name="arrow" /></Link>
  </div>;
}

export function EventsPage() {
  const { role } = useRole();
  const admin = role === "platform_admin";
  const now = useNow(30_000);
  const [show, setShow] = useState<Show>("open");
  const [sort, setSort] = useState<Sort>("newest");
  const [sim, setSim] = useState(false);  // simulated events (from a series' "Simulate a move") stay out of the live picture unless asked for
  const [sel, setSel] = useState<string | null>(null);    // the event picked with a click
  const [peek, setPeek] = useState<string | null>(null);  // the event the mouse rests on: shown until it leaves the list
  const timer = useRef(0);
  const nav = useRef<HTMLElement>(null);
  // the list ends at the bottom of the screen and scrolls inside itself, like Radar's; measured from where it starts
  useLayoutEffect(() => {
    const fit = () => { const el = nav.current; if (!el) return;
      const top = el.getBoundingClientRect().top + (el.closest(".main")?.scrollTop ?? 0);
      el.style.setProperty("--ev-top", `${Math.round(top)}px`); };
    fit(); addEventListener("resize", fit); return () => removeEventListener("resize", fit);
  });
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
      const [e, r] = await Promise.all([investigationApi.events(), investigationApi.runs()]);
      setEvents(e); setRuns(r); setErr(null); setLoadedAt(new Date()); reloadStatus();
    } catch (e) { setErr(e); }
  }, [reloadStatus]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  const refresh = () => { load(); recent.load(); };
  const inProgress = (recent.items ?? []).filter(f => f.status === "grouped");
  const noEvent = (recent.items ?? []).filter(f => f.status === "set_aside");
  const nSim = (events ?? []).filter(e => e.world !== "live").length;
  const shown = (events ?? []).filter(e => sim || e.world === "live");  // what the status filter counts
  const rows = useMemo(() => shown.filter(e => show === "all" || e.status === show)
    .sort((a, b) => sort === "impacts" ? b.hypotheses - a.hypotheses || (a.anchor < b.anchor ? 1 : -1) : (a.anchor < b.anchor ? 1 : -1)), [shown, show, sort]);
  const ev = useEventDetails(shown.map(e => e.event_id));
  const open = (events ?? []).filter(e => e.world === "live" && e.status === "open");
  const checks = !!status?.validation;

  // the answer: which open events reach the bank's products
  const hit = open.filter(e => e.hypotheses > 0), rest = open.length - hit.length;
  const bad = hit.filter(e => e.tone === "bad" || e.tone === "mixed").length;
  const products = new Set(hit.flatMap(e => impacts(ev[e.event_id]).map(i => i.product))).size;
  const nImp = hit.reduce((s, e) => s + e.hypotheses, 0);
  const headline: ReactNode = events === null ? "Events" : hit.length ? <><span className="ev-n">{count(hit.length, "event")}</span> could hit your products</>
    : open.length ? "No open event reaches your products" : "No open events right now";
  const said: ReactNode = events === null ? "" : <>
    {hit.length === 1 ? <><Link className="ev-name" to={`/events/${hit[0].event_id}`}>{title(hit[0])}</Link> is {TONE[hit[0].tone]}: </>
      : bad ? <><b>{bad}</b> {bad === 1 ? "is" : "are"} bad for you; </> : null}
    {hit.length > 0 && <><b>{count(nImp, "possible impact")}</b>{products ? <> on <b>{count(products, "product")}</b></> : null}. </>}
    {rest > 0 && <>{hit.length ? count(rest, "other open event") : count(rest, "open event")} had no impact traced. </>}
    {status && !checks && hit.length > 0 && "None is checked against your own figures yet: the checks are switched off."}</>;

  // the investigation's queue in one line under the headline: only when something waits, runs, or the agent is down
  const waiting = status?.findings_waiting ?? 0;
  // whether the agent is connected is the side bar's system status: not said again here
  const pipeline = !!status && (waiting > 0 || inProgress.length > 0 || (admin && status.notes.length > 0));
  const next = status?.next_batch_at && status.connected ? (new Date(status.next_batch_at) <= now ? "very soon" : `in ${until(status.next_batch_at, now)}`) : null;

  const reach = rows.filter(e => e.hypotheses > 0), none = rows.filter(e => e.hypotheses === 0);
  const cur = rows.find(e => e.event_id === peek) ?? rows.find(e => e.event_id === sel) ?? reach[0] ?? rows[0];
  const item = (e: EventRow) => <li key={e.event_id}>
    <button type="button" aria-current={cur?.event_id === e.event_id}
      // resting on an event previews it, after a moment so passing over rows on the way to the reader doesn't
      onMouseEnter={() => { clearTimeout(timer.current); timer.current = window.setTimeout(() => setPeek(e.event_id), 180); }}
      onMouseLeave={() => clearTimeout(timer.current)}
      onClick={() => { clearTimeout(timer.current); setPeek(null); setSel(e.event_id);  // on a phone the reader is under the list: go to it
      if (matchMedia("(max-width:900px)").matches) requestAnimationFrame(() => document.getElementById("ev-read-h")?.scrollIntoView({ block: "start" })); }}>
      <span className="ev-tt">{title(e)}</span>
      <span className="ev-isub">{e.hypotheses ? `${count(e.hypotheses, "possible impact")} · ` : ""}{dayTime(e.anchor)}{e.status === "closed" && show === "all" ? " · closed" : ""}{e.world !== "live" ? " · simulated" : ""}</span>
    </button></li>;

  return (
    <div className="page ev">
      <PageHeader eyebrow={`Events${loadedAt ? ` · updated ${ago(loadedAt.toISOString(), now)}` : ""}`} title={headline} status={said}
        actions={<>
          <button className="btn" type="button" onClick={refresh}><Icon name="refresh" />Refresh</button>
          {sim && ((events ?? []).some(e => e.world === "sandbox") || runs.some(r => r.world === "sandbox")) ? <ClearSandbox onDone={load} /> : null}
          {toReview > 0 && <Link className="btn btn--primary" to="/alerts"><Icon name="alert" />Review {count(toReview, "alert")}</Link>}
        </>}
        help={<HowItWorks><p>An event is something that happened in the world, traced to the products it could hit. It stays open while news about it keeps coming, then closes.</p></HowItWorks>} />
      {err != null && <LoadError error={err} onRetry={refresh} what="the events" />}
      {pipeline && status && <div className="ev-note" role="status">
        <Icon name="hourglass" />
        <div>
          <p>{waiting > 0 && <><b>{count(waiting, "finding")}</b> {waiting === 1 ? "is" : "are"} waiting to be investigated{next ? `: the next batch goes ${next}` : ""}. </>}
            {inProgress.length > 0 && <><b>{inProgress.length}</b> {inProgress.length === 1 ? "is" : "are"} being investigated now. </>}
            {admin && status.notes.join(" ")}
            {noEvent.length > 0 && <> {noEvent.length} more this week had no impact.</>}</p>
          <Link to="/findings">See the findings</Link>
        </div>
        {status.connected && waiting > 0 && <InvestigateNowButton onDone={refresh} small />}
      </div>}
      <div className="filters ev-filters">
        <FlowFilter label="Which events" value={show} onChange={setShow} all={{ key: "all", label: "All", count: shown.length }}
          steps={[{ key: "open", label: "Open", count: shown.filter(e => e.status === "open").length }, { key: "closed", label: "Closed", count: shown.filter(e => e.status === "closed").length }]} />
        {/* the groups already put events with impacts first: sorting changes something only when 2 or more could hit products */}
        {reach.length > 1 && <label className="sortby ev-sort">Sort <select className="input" value={sort} onChange={e => setSort(e.target.value as Sort)}>
          <option value="newest">Newest first</option><option value="impacts">Most possible impacts</option></select></label>}
        {nSim > 0 && <label className="check ev-sort"><input type="checkbox" checked={sim} onChange={e => setSim(e.target.checked)} /> Also show {plural(nSim, "simulated event")} (from tests; not real)</label>}
        <span className="spacer" />
        {!pipeline && (inProgress.length > 0 || noEvent.length > 0) && <Link className="ev-sort" to="/findings">See all findings</Link>}
      </div>
      {events === null ? (err == null && <InlineSkeleton />) : !rows.length || !cur ? (
        <Empty icon="events" title={show === "open" ? "No open events" : "No events here"} actions={<Link className="btn" to="/studio"><Icon name="studio" />Try a what-if in the Scenario Studio</Link>}>
          When AMIRI Agent traces news or a price move to your products, the event appears here.</Empty>
      ) : <div className="ev-split">
        <nav className="ev-index" aria-label="Events" ref={nav} onMouseLeave={() => { clearTimeout(timer.current); setPeek(null); }}>
          {reach.length > 0 && <section className="hit" aria-labelledby="ev-k-hit"><h2 id="ev-k-hit">Could hit your products <span>{reach.length}</span></h2><ol>{reach.map(item)}</ol></section>}
          {none.length > 0 && <section className="none" aria-labelledby="ev-k-none"><h2 id="ev-k-none">No impact traced <span>{none.length}</span></h2><ol>{none.map(item)}</ol></section>}
        </nav>
        <article className="ev-read" aria-labelledby="ev-read-h">
          <p className="ev-when"><time dateTime={cur.anchor} title={longWhen(cur.anchor)}>{dayTime(cur.anchor)}</time>
            {cur.hypotheses > 0 && <TonePill tone={cur.tone} />}
            {cur.world !== "live" && <span className="pill t-blue">Simulated</span>}</p>
          <h2 id="ev-read-h">{title(cur)}</h2>
          <Brief e={cur} det={ev[cur.event_id]} checks={checks} />
        </article>
      </div>}
      {admin && <Runs runs={runs} onChange={load} />}
    </div>
  );
}
