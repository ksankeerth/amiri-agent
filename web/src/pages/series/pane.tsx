// The open series (board 07; states: board 16 section H): what it is and its latest price, the chart over a week, a month or
// three months, how unusual the move is over 1, 3 and 5 days, the moves it flagged and where they went, Try a move, and the
// details. Shown beside the list; on a phone it is the page, with a back link. The page's list and status are in Series.tsx.
//
// Asking, and how often (nothing is asked about unless this viewer pressed a button; UI_POLLING_NOTE.md):
//   passive: the moves it flagged (and, for a Platform Admin, the fetch log) every 60 s, and not while the tab is hidden;
//            the chart is asked again when a new price has arrived (the list's own refresh tells it).
//   Refresh now: one call that fetches the prices and answers; nothing polls after it.
//   Investigate now: the investigation's runs every 3 s, up to 2 min (pages/events/investigate.tsx).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "../../api/client";
import { seriesApi, type Bar, type Finding, type ProviderCall, type Series, type SeriesStatus, type SimulateResult } from "../../api/series";
import { themeMeaning } from "../../components/series";
import { useDemoLock } from "../../components/lock";
import { useNow, useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { LoadError } from "../../components/v2/LoadError";
import { MoreMenu } from "../../components/v2/MoreMenu";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { Skeleton } from "../../components/v2/Skeleton";
import { WorldMark } from "../../components/v2/WorldMark";
import { ago, day, dayTime, due, pct, placeName, price, until } from "../../format";
import { ruleText, setAsideReason } from "../../plain";
import { InvestigateNowButton } from "../events/investigate";
import { dayWord } from "../radar/words";
import { lateSince } from "../overview/words";
import { spikeIndex } from "../../components/chartMath";
import { PriceChart, type Mark } from "./chart";
import { EditSeriesDialog, StopWatchingDialog } from "./dialogs";
import { ZBar } from "./list";
import {
  asRefusal, moveLine, placesLine, refusalTitle, rowState, seriesNotes, shortMeaning, takeaway, windowWord,
} from "./words";

const REFRESH_MS = 60_000;   // passive: no faster than every 30 s
const RANGES = [
  { id: "1w", label: "1 week", phrase: "the week", days: 7, interval: "1h" as const },
  { id: "1m", label: "1 month", phrase: "the month", days: 31, interval: "1h" as const },
  { id: "3m", label: "3 months", phrase: "3 months", days: 92, interval: "1d" as const },
];
type RangeId = (typeof RANGES)[number]["id"];

// ---------------------------------------------------------------- Refresh now
/** What a refresh did, in words. */
function outcomeText(name: string, f: { status: string; bars_new: number; finding_id: string | null }): string {
  if (f.finding_id) return `${name}: unusual move flagged. It joins the next batch for the investigation.`;
  if (f.status === "ok") return `${name}: ${f.bars_new} new hour${f.bars_new === 1 ? "" : "s"} of prices.`;
  return `${name}: no new prices yet (the current hour shows once it closes; markets may be closed).`;
}

function RefreshNow({ s, onDone }: { s: Series; onDone: (s: Series) => void }) {
  const toast = useToast(), refuse = useRefusalToast();
  const now = useNow(1000);
  const [busy, setBusy] = useState(false);
  const [retryAt, setRetryAt] = useState<string | null>(null);
  const wait = [s.fetch.refresh_available_at, retryAt].filter((x): x is string => !!x && new Date(x) > now).sort().pop();
  const working = busy || s.fetch.in_progress;
  const disabled = working || !s.enabled || !!wait;
  const go = async () => {
    setBusy(true);
    try {
      const r = await seriesApi.refresh(s.series_id);
      toast(outcomeText(s.name, r.fetch));
      onDone(r.series);
    } catch (e) {
      refuse(asRefusal(e), refusalTitle((e as ApiError | undefined)?.code));
      if (e instanceof ApiError && e.problem.retry_after_seconds) setRetryAt(new Date(Date.now() + e.problem.retry_after_seconds * 1000).toISOString());
      seriesApi.get(s.series_id).then(onDone).catch(() => {});
    } finally { setBusy(false); }
  };
  const why = !s.enabled ? "Paused: resume the series to fetch." : undefined;
  return (
    <span className="v2-sr-refresh">
      <Button size="sm" disabled={disabled} onClick={go} title={why ?? "Pull the latest hourly prices from Twelve Data now"}>{working ? "Fetching…" : "Refresh now"}</Button>
      {wait && <span className="v2-meta" role="status">Again in {until(wait, now)}</span>}
    </span>
  );
}

// ---------------------------------------------------------------- the chart
function SeriesChart({ s, findings }: { s: Series; findings: Finding[] }) {
  const [rangeId, setRangeId] = useState<RangeId>("1w");
  const range = RANGES.find(r => r.id === rangeId)!;
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastBar = s.latest?.bar_ts;
  // a late series is drawn up to its last price, not to now (which would leave the chart empty)
  const lastMs = lastBar ? new Date(lastBar).getTime() : 0;
  const anchored = !!lastMs && Date.now() - lastMs > (range.days * 86400_000) / 2;
  useEffect(() => {
    let live = true;
    const until = new Date((anchored ? lastMs : Date.now()) + 3600_000);
    const from = new Date(until.getTime() - range.days * 86400_000);
    setErr(null);
    seriesApi.bars(s.series_id, from, until, range.interval).then(b => { if (live) setBars(b); })
      .catch(e => { if (live) setErr(e instanceof ApiError ? e.full : String(e)); });
    return () => { live = false; };
  }, [s.series_id, range, lastBar, anchored, lastMs]);
  const vs = (bars ?? []).map(b => b.close);
  const marks = useMemo<Mark[]>(() => {
    const m: Mark[] = findings.filter(f => f.world === "live").map(f => ({ t: f.evidence?.signals?.[0]?.end_at ?? f.created_at, label: f.title, tag: "Flagged move" }));
    // A one-hour spike that came straight back never reaches a daily close, which is what Amiri Agent looks at, so it isn't
    // flagged. Only said on the hourly charts, and left off wherever a flagged move sits within a day of it.
    const spike = range.interval === "1h" ? spikeIndex(vs) : -1;
    const at = bars && spike >= 0 ? new Date(bars[spike].ts).getTime() : NaN;
    if (bars && spike >= 0 && !m.some(x => Math.abs(new Date(x.t).getTime() - at) < 86400_000))
      m.push({ t: bars[spike].ts, note: true, tag: "One-hour spike, not flagged",
        label: "A single hourly price far from its neighbours that came straight back: Amiri Agent looks at closes over whole days, so it doesn't count as a move." });
    return m;
  }, [findings, bars, range.interval]);   // eslint-disable-line react-hooks/exhaustive-deps
  const id = useId();
  const flagged = marks.filter(m => !m.note).length;
  return (
    <section aria-labelledby={`${id}-h`} className="v2-sr-chartbox">
      <h3 id={`${id}-h`} className="v2-sr">Price chart</h3>
      <div className="v2-sr-seg" role="group" aria-label="Period">
        {RANGES.map(r => <button key={r.id} type="button" aria-pressed={r.id === rangeId} onClick={() => setRangeId(r.id)}>{r.label}</button>)}
      </div>
      {err ? <p className="v2-sr-alert" role="alert">{err}</p> : bars === null ? <Skeleton rows={3} label="Loading the chart" className="v2-sr-chart__skel" /> : (
        <PriceChart points={bars.map(b => ({ t: b.ts, v: b.close }))} marks={marks} fmtX={day} fmtY={price}
          fmtTip={t => (range.interval === "1h" ? `hour from ${dayTime(t)}` : day(t))} />)}
      {bars && bars.length > 1 && (
        <p className="v2-sr-take">{takeaway(s.name, vs, `${range.phrase}${anchored ? ` to ${day(bars[bars.length - 1].ts)}` : ""}`, s.latest?.typical_daily_move_pct)}
          <span className="v2-meta"> · {range.interval === "1h" ? "hourly" : "daily"} closes{flagged ? <> · <span aria-hidden="true">◆ </span>{flagged} flagged {flagged === 1 ? "move" : "moves"}</> : null}</span></p>)}
      {anchored && <p className="v2-meta">No new price since {dayTime(s.latest?.bar_end ?? lastBar!)}, so this shows {range.phrase} up to the last one.</p>}
    </section>
  );
}

// ---------------------------------------------------------------- how unusual
function Windows({ s }: { s: Series }) {
  const l = s.latest, id = useId();
  const th = s.detector.z_threshold;
  return (
    <section aria-labelledby={`${id}-h`} className="v2-sr-sec">
      <h3 id={`${id}-h`} className="v2-cap">How unusual</h3>
      {!l || !l.windows.length ? <p className="v2-meta">No prices yet.</p> : (
        <ul className="v2-sr-wins">{l.windows.map(w => (
          <li key={w.days}>
            <span>{windowWord(w.days)}</span>
            <b className="v2-num">{pct(w.change_pct, 1)}</b>
            {w.z === null ? <span className="v2-meta">not known yet</span> : <ZBar z={w.z} threshold={th} label={windowWord(w.days)} />}
          </li>))}</ul>)}
      <p className="v2-meta">{l?.typical_daily_move_pct ? <>A usual day moves ±{l.typical_daily_move_pct.toFixed(2)}%. </> : null}Amiri Agent {ruleText(th)}: the tick marks {th}×.</p>
    </section>
  );
}

// ---------------------------------------------------------------- the moves it flagged
function Moves({ findings, titles, onChange }: { findings: Finding[] | null; titles: Record<string, string>; onChange: () => void }) {
  const waiting = (findings ?? []).filter(f => f.status === "new").map(f => f.finding_id);
  const id = useId();
  return (
    <section id="findings" aria-labelledby={`${id}-h`} className="v2-sr-sec">
      <SectionHead id={`${id}-h`} level={3} size="sm" title="Moves it flagged" count={findings ? findings.length : undefined} countLabel="moves"
        action={waiting.length > 0 ? <InvestigateNowButton ids={waiting} onDone={onChange} small /> : undefined} />
      {!findings ? <Skeleton rows={2} label="Loading the moves" /> : !findings.length ? <p className="v2-meta">None yet. A move shows here when it's far bigger than usual.</p> : (
        <ul className="v2-sr-moves">{findings.map(f => {
          const evId = f.outcome?.event_id;
          const fate = f.status === "set_aside" ? `no impact found: ${setAsideReason(f.outcome?.reason)}` : f.status === "new" ? "waiting for the next investigation" : "being investigated";
          return (
            <li key={f.finding_id}>
              <span className="v2-sr-moves__t"><span aria-hidden="true">◆ </span><span className="v2-sr">Flagged move: </span>{moveLine(f)} <WorldMark world={f.world} /></span>
              <span className="v2-meta">{dayTime(f.created_at)} · {evId
                ? <>in <Link to={`/events/${evId}`}>{titles[evId] ?? "the event"}</Link></> : fate}</span>
            </li>);
        })}</ul>)}
    </section>
  );
}

// ---------------------------------------------------------------- Try a move
function TryMove({ s, onDone }: { s: Series; onDone: () => void }) {
  const refuse = useRefusalToast();
  const [text, setText] = useState("−5");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<SimulateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const run = async () => {
    const v = Number(text.replace("−", "-"));
    if (!Number.isFinite(v) || v === 0) { setErr("Enter a move in percent, for example 3 or −2.5."); return; }
    setBusy(true); setErr(null);
    try { const r = await seriesApi.simulate(s.series_id, v); setOut(r); if (r.fired) onDone(); }
    catch (e) { setOut(null); refuse(asRefusal(e), refusalTitle((e as ApiError | undefined)?.code)); }
    finally { setBusy(false); }
  };
  return (
    <section aria-labelledby={`${id}-h`} className="v2-sr-try">
      <div className="v2-sr-try__r">
        <h3 id={`${id}-h`} className="v2-sr-try__t">Try a move</h3>
        <label className="v2-sr-pctbox"><span className="v2-sr">Change in percent</span>
          <input className="v2-sr-pct" inputMode="decimal" value={text} aria-invalid={err ? true : undefined} aria-describedby={`${id}-m`}
            onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} /><span aria-hidden="true">%</span></label>
        <Button disabled={busy} onClick={run}>{busy ? "Testing…" : "Test"}</Button>
      </div>
      <p id={`${id}-m`} className="v2-meta">A made-up move: is it big enough to flag? Your real prices don't change. If it is, a <b>Test</b> finding goes to the investigation, marked as a test; it never reaches your real alerts.</p>
      {err && <p className="v2-sr-err" role="alert">{err}</p>}
      {out && <p className="v2-sr-out" role="status">{out.fired && <><Pill tone="unusual" mark="◆">Flagged</Pill> <WorldMark world="sandbox" /> </>}{out.note}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- details
function Fold({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <details className="v2-sr-fold">
      <summary><span className="v2-sr-fold__t">{title}</span>{note != null && <span className="v2-meta"> · {note}</span>}</summary>
      <div className="v2-sr-fold__b">{children}</div>
    </details>
  );
}

function FetchLog({ calls }: { calls: ProviderCall[] | null }) {
  if (!calls) return <Skeleton rows={2} label="Loading the fetch log" />;
  if (!calls.length) return <p className="v2-meta">No calls yet.</p>;
  const why: Record<string, string> = { scheduled: "hourly pull", manual: "refresh", backfill: "history (added)", lookup: "search" };
  return (
    <ul className="v2-sr-log">{calls.map(c => (
      <li key={c.call_id}>
        <span className="v2-sr-log__r">
          <span className="v2-mono v2-text-2">{dayTime(c.at)}</span>
          <span>{why[c.trigger] ?? c.trigger}</span>
          {c.status === "error" ? <Pill tone="bad" mark="▲">Error</Pill> : <span>{c.status === "ok" ? "OK" : c.status === "no_new_data" ? "No new data" : "Running"}</span>}
          <span className="v2-meta">{c.bars_new ?? "—"}{c.bars_received !== null ? ` of ${c.bars_received}` : ""} new hours · {c.credits} {c.credits === 1 ? "credit" : "credits"}{c.duration_ms !== null ? ` · ${(c.duration_ms / 1000).toFixed(1)} s` : ""}</span>
        </span>
        {c.error_code && c.status === "error" && <span className="v2-sr-log__e">{c.error_code}{c.http_status ? ` (${c.http_status})` : ""}: {c.error_message}</span>}
      </li>))}</ul>
  );
}

// ---------------------------------------------------------------- the pane
export interface PaneProps {
  s: Series;
  status: SeriesStatus | null;
  admin: boolean;
  eventTitles: Record<string, string>;
  askEventTitles: () => void;
  /** The series changed (a refresh, an edit, a pause): the list takes the new one. */
  onUpdated: (s: Series) => void;
  onRemoved: (s: Series) => void;
}
export function SeriesPane({ s, admin, eventTitles, askEventTitles, onUpdated, onRemoved }: PaneProps) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const loc = useLocation();
  const now = useNow(30_000);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [calls, setCalls] = useState<ProviderCall[] | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const loaded = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const id = s.series_id;

  const load = useCallback(async () => {
    try {
      const [f, c] = await Promise.all([seriesApi.findings(id), admin ? seriesApi.fetches(id) : Promise.resolve(null)]);
      if (!alive.current) return;
      setFindings(f); if (c) setCalls(c); setErr(null); loaded.current = Date.now();
    } catch (e) { if (alive.current) setErr(e); }
  }, [id, admin]);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    const vis = () => { if (!document.hidden && Date.now() - loaded.current > 30_000) load(); };   // back on the tab: catch up, but not in a burst
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  useEffect(() => { if (findings?.some(f => f.outcome?.event_id)) askEventTitles(); }, [findings, askEventTitles]);
  useEffect(() => {
    if (loc.hash === "#findings" && findings) document.getElementById("findings")?.scrollIntoView({ block: "start" });
  }, [loc.hash, findings]);

  const refreshFindings = () => seriesApi.findings(id).then(f => { if (alive.current) setFindings(f); }).catch(() => {});
  const updated = (x: Series) => { onUpdated(x); refreshFindings(); if (admin) seriesApi.fetches(id).then(c => { if (alive.current) setCalls(c); }).catch(() => {}); };
  const pause = async () => {
    setBusy(true);
    try { updated(await seriesApi.update(s.series_id, s.version, { enabled: !s.enabled })); toast(s.enabled ? `${s.name} paused: no hourly pulls until resumed.` : `${s.name} resumed: prices update again within the hour.`); }
    catch (e) { refuse(asRefusal(e), refusalTitle((e as ApiError | undefined)?.code)); seriesApi.get(id).then(onUpdated).catch(() => {}); }
    finally { if (alive.current) setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await seriesApi.remove(s.series_id); toast(`${s.name} is no longer watched. Its flagged moves stay in findings.`); setDeleting(false); onRemoved(s); }
    catch (e) { setDeleting(false); refuse(asRefusal(e), refusalTitle((e as ApiError | undefined)?.code)); }
    finally { if (alive.current) setBusy(false); }
  };

  const l = s.latest;
  const since = s.state === "stale" ? lateSince(s.state_reason) : null;
  const st = rowState(s, since);
  const failed = s.fetch.last_status === "error" && s.fetch.last_error ? s.fetch.last_error : null;
  const retryAt = s.enabled && s.fetch.next_scheduled_at && new Date(s.fetch.next_scheduled_at) > now ? dayWord(s.fetch.next_scheduled_at, now).replace(/^today /, "") : null;
  const notes = seriesNotes({ state: s.state, reason: s.state_reason, since: since ?? (l ? dayTime(l.bar_end) : null), admin, retryAt,
    failed: failed ? { code: failed.code, http: failed.http_status, message: failed.message } : null });
  const places = placesLine(s.places.map(placeName));
  const sub = [shortMeaning(themeMeaning(s.theme)).replace(/^./, c => c.toLowerCase()), places].filter(Boolean).join(" · ");
  const typical = l?.typical_daily_move_pct;

  return (
    <article className="v2-panel v2-sr-pane" aria-labelledby="sr-title">
      <div className="v2-sr-top">
        {st.tone ? <Pill tone={st.tone} mark={st.mark}>{st.label}</Pill> : <Pill>{st.label}</Pill>}
        {s.state === "moved" && s.last_finding && <span className="v2-meta">flagged {dayWord(s.last_finding.at, now)}</span>}
        <span className="v2-sr-top__gap" />
        <div className="v2-sr-top__act">
          <RefreshNow s={s} onDone={updated} />
          {admin && (
            <MoreMenu label="More: edit, pause or stop watching" items={[
              { label: "Edit", locked, onSelect: () => setEditing(true) },
              { label: s.enabled ? "Pause" : "Resume", locked, onSelect: pause },
              { label: "Stop watching", locked, danger: true, onSelect: () => setDeleting(true) },
            ]} />)}
        </div>
      </div>
      {err != null && findings === null && <LoadError error={err} onRetry={load} what="this series' moves" />}
      {notes.length > 0 && (
        <ul className="v2-sr-notes" aria-label="Needs a look">
          {notes.map((n, i) => <li key={i} className={`is-${n.tone}`}>{n.tone !== "neutral" && <span aria-hidden="true">{n.tone === "bad" ? "▲ " : "◆ "}</span>}{n.text}{!admin && n.tone !== "neutral" && s.state === "stale" && i === 0 ? " Your Platform Admin has been told." : ""}</li>)}
        </ul>)}
      <div>
        <h2 id="sr-title" tabIndex={-1} className="v2-sr-h2">{s.name}</h2>
        <p className="v2-sr-sub"><span className="v2-mono">{s.symbol}</span>{sub ? ` · ${sub}` : ""}</p>
      </div>
      <p className="v2-sr-px">
        <span className="v2-sr-px__v v2-num">{price(l?.close)}</span>
        {l?.change_1d_pct != null && s.state !== "stale" && <b className="v2-num">{pct(l.change_1d_pct, 1)}</b>}
        <span className="v2-meta">{l ? `${l.change_1d_pct != null && s.state !== "stale" ? "over one trading day" : "last price"}${typical ? ` · a usual day ±${typical.toFixed(1)}%` : ""}` : "No prices yet"}</span>
      </p>
      <SeriesChart s={s} findings={findings ?? []} />
      <Windows s={s} />
      <Moves findings={findings} titles={eventTitles} onChange={refreshFindings} />
      <TryMove s={s} onDone={refreshFindings} />
      <div className="v2-sr-folds">
        <Fold title="What a move means" note={`flagged at ${s.detector.z_threshold}×`}>
          <dl className="v2-sr-dl">
            <div><dt>A move means</dt><dd>{themeMeaning(s.theme)}</dd></div>
            {s.places.length > 0 && <div><dt>Where</dt><dd>{s.places.map(placeName).join(", ")}</dd></div>}
            <div><dt>Rule</dt><dd>Amiri Agent {ruleText(s.detector.z_threshold)}</dd></div>
            <div><dt>Updated</dt><dd>{s.enabled ? `${ago(s.fetch.last_at, now)}; prices are pulled every hour` : "Paused"}</dd></div>
            {l && <div><dt>Latest price</dt><dd>hour ending {dayTime(l.bar_end)}</dd></div>}
          </dl>
        </Fold>
        <Fold title="Technical details">
          <dl className="v2-sr-dl">
            <div><dt>Symbol</dt><dd><span className="v2-mono">{s.symbol}</span>{s.instrument.type ? ` · ${s.instrument.type}` : ""}{s.instrument.exchange ? ` · ${s.instrument.exchange}` : ""}</dd></div>
            <div><dt>Provider</dt><dd>Twelve Data, hourly</dd></div>
            <div><dt>Next pull</dt><dd>{s.enabled ? due(s.fetch.next_scheduled_at, now) : "paused"}</dd></div>
            <div><dt>Detector</dt><dd>{s.detector.z_threshold}× a usual move over {s.detector.windows_days.join(", ")} trading days; usual from the last {s.detector.sigma_days}; quiet for {s.detector.cooldown_hours} h after flagging</dd></div>
            <div><dt>Late after</dt><dd>{s.detector.stale_after_hours} market hours without a new price</dd></div>
            <div><dt>State</dt><dd>{s.state_reason}</dd></div>
            <div><dt>Version</dt><dd>{s.version}, changed {dayTime(s.updated_at)}</dd></div>
            <div><dt>Added</dt><dd>{day(s.created_at)}</dd></div>
          </dl>
        </Fold>
        {admin && <Fold title="Fetch log" note="every call to Twelve Data, errors as returned"><FetchLog calls={calls} /></Fold>}
      </div>
      {editing && <EditSeriesDialog s={s} onClose={() => setEditing(false)} onSaved={x => { setEditing(false); updated(x); }} />}
      {deleting && <StopWatchingDialog s={s} busy={busy} onClose={() => setDeleting(false)} onConfirm={remove} />}
      <p className="v2-sr" aria-live="polite">{busy ? "Working…" : ""}</p>
    </article>
  );
}

