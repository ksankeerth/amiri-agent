// One market series: its price as the hero beside the track (how unusual the latest one-day move is), the chart,
// the moves it flagged with the events they went to, the 1/3/5-day table, and three folds (what a move means,
// try a move, the fetch log for a Platform Admin).
import { useCallback, useEffect, useId, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { investigationApi, type EventRow } from "../api/investigation";
import { seriesApi, type Bar, type Finding, type ProviderCall, type Series, type SimulateResult } from "../api/series";
import { Places } from "../components/blocks";
import { PriceChart, type Mark } from "../components/charts";
import { spikeIndex } from "../components/chartMath";
import { Fold, GoLink, PageTitle, QuietWarn, Section, TextButton, TextTabs, ToneMark, TONE_WORD } from "../components/rd";
import { EditSeriesModal, RefreshButton, themeMeaning } from "../components/series";
import { InlineSkeleton, LoadError, Modal, PageSkeleton, useNow, useRole, useToast } from "../components/ui";
import { ago, day, dayTime, due, pct, price, ZONE_LABEL, zx } from "../format";
import { eventTitle, FINDING_STATUS, ruleText, setAsideReason } from "../plain";
import { InvestigateNowButton } from "./events/Events";
import { SeriesHelp, Track, useSeriesStatus } from "./series/parts";
import { moveLine, oneDayZ, seriesNotice, shortMeaning } from "./series/words";

const RANGES = [
  { id: "1w", label: "1 week", phrase: "the week", days: 7, interval: "1h" as const },
  { id: "1m", label: "1 month", phrase: "the month", days: 31, interval: "1h" as const },
  { id: "3m", label: "3 months", phrase: "3 months", days: 92, interval: "1d" as const },
];
type RangeId = (typeof RANGES)[number]["id"];

/** The chart's takeaway in one line: which way it went over the range, and by how much. */
function takeaway(name: string, vs: number[], range: string, typical: number | null | undefined): string {
  if (vs.length < 2) return name;
  const chg = (vs[vs.length - 1] / vs[0] - 1) * 100;
  const flat = Math.abs(chg) < Math.max(0.1, (typical ?? 0) / 2);
  return `${name} ${flat ? "flat" : chg > 0 ? "up" : "down"} over ${range} (${pct(chg)})`;
}

function Chart({ s, findings }: { s: Series; findings: Finding[] }) {
  const [rangeId, setRangeId] = useState<RangeId>("1w");
  const range = RANGES.find(r => r.id === rangeId)!;
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastBar = s.latest?.bar_ts;
  // a stale series is drawn up to its last price, not to now (which would leave the chart empty)
  const lastMs = lastBar ? new Date(lastBar).getTime() : 0;
  const anchored = !!lastMs && Date.now() - lastMs > range.days * 86400_000 / 2;
  useEffect(() => {
    const until = new Date((anchored ? lastMs : Date.now()) + 3600_000);
    const from = new Date(until.getTime() - range.days * 86400_000);
    setErr(null);
    seriesApi.bars(s.series_id, from, until, range.interval).then(setBars).catch(e => setErr(e instanceof ApiError ? e.full : String(e)));
  }, [s.series_id, range, lastBar, anchored, lastMs]);
  const marks: Mark[] = findings.filter(f => f.world === "live").map(f => ({ t: f.evidence?.signals?.[0]?.end_at ?? f.created_at, color: "var(--high)", label: f.title, tag: "Flagged move" }));
  const vs = (bars ?? []).map(b => b.close);
  // A one-hour spike that came straight back never reaches a daily close, which is what Amiri Agent looks at, so it
  // isn't flagged. Only said on the hourly charts: on the daily one a one-day spike *is* a daily close and may well be
  // flagged, and the note is left off wherever a flagged move sits within a day of it.
  const spike = range.interval === "1h" ? spikeIndex(vs) : -1;
  const spikeAt = bars && spike >= 0 ? new Date(bars[spike].ts).getTime() : NaN;
  if (bars && spike >= 0 && !marks.some(m => Math.abs(new Date(m.t).getTime() - spikeAt) < 86400_000))
    marks.push({ t: bars[spike].ts, color: "var(--ink-3)", note: true, tag: "One-hour spike, not flagged",
      label: "A single hourly price far from its neighbours that came straight back: Amiri Agent looks at closes over whole days, so it doesn't count as a move." });
  return (
    <Section title="Price">
      <TextTabs label="Period" value={rangeId} onChange={setRangeId} items={RANGES.map(r => ({ key: r.id, label: r.label }))}
        end={<span className="rd-fine">{range.interval === "1h" ? "Hourly" : "Daily"} closes, {ZONE_LABEL} time</span>} />
      {bars && bars.length > 1 && <p className="sr-take">{takeaway(s.name, vs, `${range.phrase}${anchored ? ` to ${day(bars[bars.length - 1].ts)}` : ""}`, s.latest?.typical_daily_move_pct)}</p>}
      {anchored && <p className="rd-fine sr-note">No new prices since {dayTime(s.latest?.bar_end ?? lastBar!)}, so this shows {range.phrase} up to the last one.</p>}
      <div className="sr-chart">
        {err ? <div className="rawerr">{err}</div> : bars === null ? <InlineSkeleton /> :
          <PriceChart points={bars.map(b => ({ t: b.ts, v: b.close }))} marks={marks}
            fmtX={day} fmtY={price}
            fmtTip={t => (range.interval === "1h" ? `hour from ${dayTime(t)}` : day(t))} />}
      </div>
    </Section>
  );
}

function Windows({ s }: { s: Series }) {
  const l = s.latest;
  return (
    <Section title="How unusual, over 1, 3 and 5 days">
      <p className="sr-lede">{l?.typical_daily_move_pct ? <>A normal day moves <b>±{l.typical_daily_move_pct.toFixed(2)}%</b>. </> : null}Amiri Agent {ruleText(s.detector.z_threshold)}.</p>
      {!l || !l.windows.length ? <p className="sr-lede">No prices yet.</p> : (
        <table className="rd-table">
          <thead><tr><th scope="col">Over</th><th scope="col" className="rd-num">Change</th><th scope="col">Against a normal move</th><th scope="col" className="rd-num">From</th></tr></thead>
          <tbody>{l.windows.map(w => {
            const fires = w.z !== null && Math.abs(w.z) >= s.detector.z_threshold;
            return (
              <tr key={w.days}>
                <td className="rd-strong">{w.days} trading day{w.days === 1 ? "" : "s"}</td>
                <td className="rd-num">{pct(w.change_pct)}</td>
                <td>{w.z === null ? "not known yet" : fires
                  ? <span className="sr-flag"><ToneMark tone="mixed" />{zx(w.z)}, flagged</span> : zx(w.z)}</td>
                <td className="rd-num">{price(w.ref_close)}</td>
              </tr>);
          })}</tbody>
        </table>
      )}
    </Section>
  );
}

function Moves({ findings, events, onChange }: { findings: Finding[] | null; events: Record<string, EventRow> | null; onChange: () => void }) {
  const waiting = (findings ?? []).filter(f => f.status === "new").map(f => f.finding_id);
  return (
    <Section id="findings" title="Moves it flagged" count={findings ? findings.length : undefined}>
      {waiting.length > 0 && <div className="sr-wait"><InvestigateNowButton ids={waiting} onDone={onChange} small /></div>}
      {!findings ? <InlineSkeleton /> : !findings.length ? <p className="sr-lede">None yet. A move shows here when it's far bigger than usual.</p> : (
        <ul className="sr-moves">{findings.map(f => {
          const ev = f.outcome?.event_id ? events?.[f.outcome.event_id] : undefined;
          const [label] = FINDING_STATUS[f.status] ?? [f.status];
          return (
            <li key={f.finding_id}>
              <span className="sr-mt"><ToneMark tone="mixed" label="Flagged move: " />{moveLine(f)}{f.world === "sandbox" && <span className="rd-fine"> · test</span>}</span>
              <span className="sr-mm">{dayTime(f.created_at)}{" · "}
                {f.outcome?.event_id
                  ? ev ? <>in {ev.tone && <ToneMark tone={ev.tone} label={`${TONE_WORD[ev.tone]}: `} />}<Link className="rd-name" to={`/events/${ev.event_id}`}>{eventTitle(ev)}</Link></>
                    : <GoLink to={`/events/${f.outcome.event_id}`}>Open the event</GoLink>
                  : f.status === "set_aside" ? `no impact found: ${setAsideReason(f.outcome?.reason)}` : label.toLowerCase()}</span>
            </li>);
        })}</ul>
      )}
    </Section>
  );
}

function SimulateMove({ s, onDone }: { s: Series; onDone: () => void }) {
  const [pctText, setPct] = useState("3");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<SimulateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  const run = async () => {
    const v = Number(pctText);
    if (!Number.isFinite(v) || v === 0) { setErr("Enter a move in percent, e.g. 3 or -2.5."); return; }
    setBusy(true); setErr(null);
    try { const r = await seriesApi.simulate(s.series_id, v); setOut(r); if (r.fired) onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <p className="rd-fine rd-prose" style={{ margin: "0 0 12px" }}>See whether a made-up move would be flagged. Your real prices don't change. If it's flagged, a test finding goes to the investigation, marked as a test. It never reaches your real alerts.</p>
      <div className="sr-try">
        <label htmlFor={id}>Move (% of the latest price)
          <input id={id} className="input" type="number" step="0.5" value={pctText} onChange={e => setPct(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} /></label>
        <button className="btn" type="button" onClick={run} disabled={busy}>{busy ? "Simulating…" : "Simulate"}</button>
      </div>
      {out && <p className="sr-out" style={{ color: "var(--ink)" }}>{out.fired && <ToneMark tone="mixed" label="Flagged: " />}{out.note}</p>}
      {err && <div className="rawerr">{err}</div>}
    </>
  );
}

function FetchLog({ calls }: { calls: ProviderCall[] | null }) {
  if (!calls) return <InlineSkeleton />;
  if (!calls.length) return <p className="rd-fine">No calls yet.</p>;
  return (
    <table className="rd-table sr-log">
      <thead><tr><th scope="col">When</th><th scope="col">Why</th><th scope="col">Result</th><th scope="col" className="rd-num">New hours</th><th scope="col" className="rd-num">Credits</th><th scope="col" className="rd-num">Took</th><th scope="col">Error</th></tr></thead>
      <tbody>{calls.map(c => (
        <tr key={c.call_id}>
          <td className="rd-num">{dayTime(c.at)}</td>
          <td>{{ scheduled: "hourly pull", manual: "refresh", backfill: "history (added)", lookup: "search" }[c.trigger] ?? c.trigger}</td>
          <td>{c.status === "ok" ? "OK" : c.status === "no_new_data" ? "No new data" : c.status === "error" ? <span className="rd-warn"><ToneMark tone="mixed" />Error</span> : "Running"}</td>
          <td className="rd-num">{c.bars_new ?? "—"}{c.bars_received !== null ? ` / ${c.bars_received}` : ""}</td>
          <td className="rd-num">{c.credits}</td>
          <td className="rd-num">{c.duration_ms !== null ? `${(c.duration_ms / 1000).toFixed(1)} s` : "—"}</td>
          <td className="sr-err">{c.error_code && c.status === "error" ? `${c.error_code}${c.http_status ? ` (${c.http_status})` : ""}: ${c.error_message}` : ""}</td>
        </tr>))}</tbody>
    </table>
  );
}

export function SeriesDetail() {
  const { id = "" } = useParams();
  const { role } = useRole();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const now = useNow(30_000);
  const [s, setS] = useState<Series | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [events, setEvents] = useState<Record<string, EventRow> | null>(null);
  const [calls, setCalls] = useState<ProviderCall[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [help, setHelp] = useState(false);
  const [tech, setTech] = useState(false);
  const helpId = useId(), techId = useId();
  const { status, reload: reloadStatus } = useSeriesStatus();
  const isAdmin = role === "platform_admin";

  const load = useCallback(async () => {
    try {
      const [a, f, c] = await Promise.all([seriesApi.get(id), seriesApi.findings(id), seriesApi.fetches(id)]);
      setS(a); setFindings(f); setCalls(c); setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setErr(e);
    }
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  // the events its flagged moves went to, by name (a failure just leaves a plain "Open the event" link)
  useEffect(() => {
    investigationApi.events().then(xs => setEvents(Object.fromEntries(xs.map(e => [e.event_id, e])))).catch(() => setEvents({}));
  }, [id]);
  useEffect(() => {
    if (loc.hash === "#findings" && findings) document.getElementById("findings")?.scrollIntoView({ behavior: "smooth" });
  }, [loc.hash, findings]);

  const refreshFindings = () => seriesApi.findings(id).then(setFindings).catch(() => {});
  const updated = (x: Series) => { setS(x); reloadStatus(); refreshFindings(); seriesApi.fetches(id).then(setCalls).catch(() => {}); };
  const pause = async () => {
    if (!s) return;
    try { updated(await seriesApi.update(s.series_id, s.version, { enabled: !s.enabled })); toast(s.enabled ? `${s.name} paused: no hourly pulls until resumed.` : `${s.name} resumed: prices update again within the hour.`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const remove = async () => {
    if (!s) return;
    try { await seriesApi.remove(s.series_id); toast(`${s.name} is no longer watched. Its flagged moves stay in findings.`); nav("/series"); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };

  if (notFound) return (
    <div className="page rd rd-series">
      <PageTitle title="Series not found" crumbs={<Link to="/series">Market series</Link>} />
      <div className="rd-empty"><p className="rd-lede">This series isn't watched. It may have been deleted.</p>
        <Link className="btn btn--primary" to="/series">See market series</Link></div>
    </div>
  );
  if (!s) return <div className="page rd rd-series">{err != null ? <><PageTitle title="Market series" crumbs={<Link to="/series">Market series</Link>} /><LoadError error={err} onRetry={load} what="this series" /></> : <PageSkeleton bare />}</div>;
  const l = s.latest;
  const z = oneDayZ(l);
  const notice = seriesNotice({
    stale: s.state === "stale", since: l ? dayTime(l.bar_end) : "it was added", configured: status?.provider.configured ?? true, admin: isAdmin,
    failed: s.fetch.last_status === "error" && s.fetch.last_error ? { at: dayTime(s.fetch.last_error.at), code: s.fetch.last_error.code, http: s.fetch.last_error.http_status, message: s.fetch.last_error.message } : null,
  });
  const plain = s.state === "warming_up" ? "Still learning what a normal move is; it can flag moves once it has enough history."
    : s.state === "pending" ? "Waiting for its first prices." : s.state === "paused" ? "Paused: prices aren't updated until it's resumed." : null;
  return (
    <div className="page rd rd-series">
      <PageTitle crumbs={<><Link to="/series">Market series</Link> / {s.name}</>} title={s.name}
        actions={<span className="sr-act">
          <RefreshButton s={s} onDone={updated} small={false} />
          {isAdmin && <>
            <TextButton onClick={() => setEditing(true)}>Edit</TextButton>
            <TextButton onClick={pause}>{s.enabled ? "Pause" : "Resume"}</TextButton>
            <TextButton onClick={() => setDeleting(true)}>Stop watching</TextButton>
          </>}
        </span>}
        status={plain ? <span>{plain}</span> : undefined}
        help={<>
          {notice && <QuietWarn>{notice}</QuietWarn>}
          <p className="rd-fine" style={{ margin: "8px 0 0" }}><TextButton aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(h => !h)}>How this works</TextButton></p>
          <SeriesHelp status={status} id={helpId} open={help} />
        </>} />

      <div className="sr-hero">
        <div>
          <div className="sr-hp">{price(l?.close)}</div>
          <p className="sr-hd">{l ? <>{l.change_1d_pct === null ? "No day's change yet" : `${pct(l.change_1d_pct)} over one trading day`}{l.typical_daily_move_pct ? ` · a normal day is ±${l.typical_daily_move_pct.toFixed(2)}%` : ""}</> : "No prices yet"}</p>
        </div>
        <Track z={z} threshold={s.detector.z_threshold} size="lg" />
      </div>

      <Chart s={s} findings={findings ?? []} />
      <Moves findings={findings} events={events} onChange={refreshFindings} />
      <Windows s={s} />

      <div className="rd-sec">
        <Fold remember="series-meaning" title="What a move means"
          summary={`${shortMeaning(themeMeaning(s.theme))} · flagged at ${s.detector.z_threshold}×`}>
          <dl className="sr-facts">
            <dt>A move means</dt><dd>{themeMeaning(s.theme)}</dd>
            {s.places.length > 0 && <><dt>Where</dt><dd><Places codes={s.places} max={8} /></dd></>}
            <dt>Rule</dt><dd>Amiri Agent {ruleText(s.detector.z_threshold)}</dd>
            <dt>Updated</dt><dd>{s.enabled ? `${ago(s.fetch.last_at, now)}; prices are pulled every hour` : "Paused"}</dd>
            {l && <><dt>Latest price</dt><dd>hour ending {dayTime(l.bar_end)}</dd></>}
          </dl>
          <p className="sr-tech"><TextButton aria-expanded={tech} aria-controls={techId} onClick={() => setTech(t => !t)}>Technical details</TextButton></p>
          <div id={techId} className="rd-open sr-tech" hidden={!tech}>
            <dl className="sr-facts">
              <dt>Symbol</dt><dd>{s.symbol}{s.instrument.type ? ` · ${s.instrument.type}` : ""}{s.instrument.exchange ? ` · ${s.instrument.exchange}` : ""}</dd>
              <dt>Vendor</dt><dd>Twelve Data, hourly</dd>
              <dt>Next pull</dt><dd>{s.enabled ? due(s.fetch.next_scheduled_at, now) : "paused"}</dd>
              <dt>Detector</dt><dd>{s.detector.z_threshold}× typical over {s.detector.windows_days.join(", ")} trading days; typical from the last {s.detector.sigma_days}; quiet for {s.detector.cooldown_hours} h after flagging</dd>
              <dt>Stale after</dt><dd>{s.detector.stale_after_hours} market hours without a new price</dd>
              <dt>State</dt><dd>{s.state_reason}</dd>
              <dt>Version</dt><dd>{s.version}, changed {dayTime(s.updated_at)}</dd>
              <dt>Added</dt><dd>{day(s.created_at)}</dd>
            </dl>
          </div>
        </Fold>
        <Fold remember="series-try" title="Try a move" summary="a test: see whether a made-up move would be flagged; your real prices don't change">
          <SimulateMove s={s} onDone={refreshFindings} />
        </Fold>
        {isAdmin && <Fold remember="series-log" title="Fetch log" summary="Platform Admin · every call to Twelve Data, errors exactly as returned">
          <FetchLog calls={calls} />
        </Fold>}
      </div>

      {editing && <EditSeriesModal s={s} onClose={() => setEditing(false)} onSaved={x => { setEditing(false); updated(x); }} />}
      {deleting && (
        <Modal title={`Stop watching ${s.name}?`} onClose={() => setDeleting(false)} footer={<>
          <button className="btn" type="button" onClick={() => setDeleting(false)}>Cancel</button>
          <button className="btn btn--danger" type="button" onClick={remove}>Stop watching</button></>}>
          <p>Its stored prices and fetch log are removed and it frees a series slot. Moves it already flagged stay as findings.</p>
        </Modal>
      )}
    </div>
  );
}
