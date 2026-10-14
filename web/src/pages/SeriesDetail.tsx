import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { seriesApi, type Bar, type Finding, type ProviderCall, type Series, type SimulateResult } from "../api/series";
import { PriceChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { EditSeriesModal, FetchBadge, RefreshButton, StateBadge, themeMeaning } from "../components/series";
import { Banner, Empty, Modal, PageHead, useNow, useRole, useToast, PageSkeleton, InlineSkeleton } from "../components/ui";
import { ago, day, dayTime, due, pct, price, when, zx, ZONE_LABEL } from "../format";
import { InvestigateNowButton } from "./events/Events";
import { PrototypeBanner, useSeriesStatus } from "./SeriesList";

const RANGES = [
  { id: "1w", label: "1 week", days: 7, interval: "1h" as const },
  { id: "1m", label: "1 month", days: 31, interval: "1h" as const },
  { id: "3m", label: "3 months", days: 92, interval: "1d" as const },
];

function Chart({ s, findings }: { s: Series; findings: Finding[] }) {
  const [range, setRange] = useState(RANGES[0]);
  const [bars, setBars] = useState<Bar[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lastBar = s.latest?.bar_ts;
  useEffect(() => {
    const until = new Date(Date.now() + 3600_000);
    const from = new Date(until.getTime() - range.days * 86400_000);
    setErr(null);
    seriesApi.bars(s.series_id, from, until, range.interval).then(setBars).catch(e => setErr(e instanceof ApiError ? e.full : String(e)));
  }, [s.series_id, range, lastBar]);
  const marks = findings.filter(f => f.world === "live").map(f => ({ t: f.evidence.signals[0]?.end_at ?? f.created_at, color: "var(--high)", label: f.title }));
  return (
    <div className="card">
      <div className="hd"><h2>Price</h2><span className="small muted">{range.interval === "1h" ? "hourly closes" : "daily closes (last finished hour of each UTC day)"} · {ZONE_LABEL} time · orange dots: moves flagged</span>
        <span className="spacer" />
        <span className="seg">{RANGES.map(r => <button key={r.id} type="button" aria-pressed={r.id === range.id} onClick={() => setRange(r)}>{r.label}</button>)}</span></div>
      <div className="bd">
        {err ? <div className="rawerr">{err}</div> : bars === null ? <InlineSkeleton /> :
          <PriceChart points={bars.map(b => ({ t: b.ts, v: b.close }))} marks={marks}
            fmtX={t => (range.interval === "1h" && range.days <= 7 ? dayTime(t) : day(t))} fmtY={price}
            fmtTip={t => (range.interval === "1h" ? `hour from ${dayTime(t)}` : day(t))} />}
      </div>
    </div>
  );
}

function Windows({ s }: { s: Series }) {
  const l = s.latest;
  return (
    <div className="card">
      <div className="hd"><h2>How unusual is the latest price?</h2></div>
      {!l || !l.windows.length ? <div className="bd muted small">No prices yet.</div> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Over</th><th>From</th><th>Change</th><th>vs typical</th></tr></thead>
          <tbody>{l.windows.map(w => {
            const fires = w.z !== null && Math.abs(w.z) >= s.detector.z_threshold;
            return (
              <tr key={w.days}>
                <td className="strong">{w.days} trading day{w.days === 1 ? "" : "s"}</td>
                <td className="small">{price(w.ref_close)} <span className="muted">at {dayTime(new Date(new Date(w.ref_ts).getTime() + 3600_000).toISOString())}</span></td>
                <td className="num">{pct(w.change_pct)}</td>
                <td>{w.z === null ? <span className="muted">—</span> : fires ? <span className="badge b-warn">{zx(w.z)}</span> : <span className="num">{zx(w.z)}</span>}</td>
              </tr>);
          })}</tbody>
        </table></div>
      )}
      <div className="bd small muted">
        Typical trading day: <b>{l?.typical_daily_move_pct ? `±${l.typical_daily_move_pct.toFixed(2)}%` : "not known yet"}</b>, from the last {s.detector.sigma_days} trading days.
        A move fires at <b>{s.detector.z_threshold}×</b> typical for its length (typical day × √days), then the series stays quiet for {s.detector.cooldown_hours} h. Plain arithmetic; no model.
      </div>
    </div>
  );
}

function FetchLog({ calls }: { calls: ProviderCall[] | null }) {
  return (
    <div className="card">
      <div className="hd"><h2>Fetch log</h2><span className="small muted">every call to Twelve Data for this series, errors exactly as returned</span></div>
      {!calls ? <InlineSkeleton /> : !calls.length ? <div className="bd muted small">No calls yet.</div> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>When</th><th>Why</th><th>Result</th><th>New hours</th><th>Credits</th><th>Took</th><th>Error</th></tr></thead>
          <tbody>{calls.map(c => (
            <tr key={c.call_id}>
              <td className="num">{dayTime(c.at)}</td>
              <td>{{ scheduled: "hourly pull", manual: "refresh", backfill: "history (added)", lookup: "search" }[c.trigger] ?? c.trigger}</td>
              <td>{c.status === "ok" ? <span className="badge b-ok">OK</span> : c.status === "no_new_data" ? <span className="badge b-noeffect">NO NEW DATA</span> :
                c.status === "error" ? <span className="badge b-down">ERROR</span> : <span className="badge b-info">RUNNING</span>}</td>
              <td className="num">{c.bars_new ?? "—"}{c.bars_received !== null ? <span className="muted"> / {c.bars_received}</span> : null}</td>
              <td className="num">{c.credits}</td>
              <td className="num">{c.duration_ms !== null ? `${(c.duration_ms / 1000).toFixed(1)} s` : "—"}</td>
              <td className="small mono" style={{ color: "var(--critical-ink)", maxWidth: 360 }}>{c.error_code && c.status === "error" ? `${c.error_code}${c.http_status ? ` (${c.http_status})` : ""}: ${c.error_message}` : ""}</td>
            </tr>))}</tbody>
        </table></div>
      )}
    </div>
  );
}

const FINDING_STATUS: Record<string, [string, string]> = {
  new: ["b-info", "WAITING"], grouped: ["b-info", "BEING INVESTIGATED"], linked: ["b-ok", "IN AN EVENT"], set_aside: ["b-noeffect", "SET ASIDE"],
};

function Findings({ findings, onChange }: { findings: Finding[] | null; onChange: () => void }) {
  const waiting = (findings ?? []).filter(f => f.status === "new").map(f => f.finding_id);
  return (
    <div className="card" id="findings">
      <div className="hd"><h2>Moves flagged</h2><span className="small muted">each became a finding for the investigation</span>
        <span className="spacer" />{waiting.length > 0 && <InvestigateNowButton ids={waiting} onDone={onChange} small />}</div>
      {!findings ? <InlineSkeleton /> : !findings.length ? (
        <div className="bd small muted">None yet. A move shows here when it reaches the threshold.</div>
      ) : (
        <div className="bd col" style={{ gap: 12 }}>{findings.map(f => (
          <div key={f.finding_id} className="col" style={{ gap: 4 }}>
            <div className="row"><b>{f.title}</b>{f.world === "sandbox" && <span className="badge b-info" title="Made by Simulate a move; live prices are unchanged">SIMULATED</span>}
              {FINDING_STATUS[f.status] && <span className={`badge ${FINDING_STATUS[f.status][0]}`}>{FINDING_STATUS[f.status][1]}</span>}
              {f.outcome?.event_id && <Link className="small" to={`/events/${f.outcome.event_id}`}>open the event</Link>}
              {f.status === "set_aside" && f.outcome?.reason && <span className="small muted">{f.outcome.reason.replace(/_/g, " ")}{f.outcome.note ? `: ${f.outcome.note}` : ""}</span>}
              <span className="spacer" /><span className="small muted">{dayTime(f.created_at)}</span></div>
            <div className="small">{f.explanation}</div>
            <div className="row wrap small muted" style={{ gap: 8 }}>
              <span>score {f.score}</span>
              {f.themes.map(t => <span key={t.theme} className="chip">{t.theme}{t.item ? ` (${t.item})` : ""}: {t.currency ? `${t.currency} ` : ""}{t.direction.replace(/_/g, " ")}</span>)}
              {f.places.map(p => <span key={p} className="chip">{p}</span>)}
              <span className="mono">{f.finding_id}</span>
            </div>
          </div>))}</div>
      )}
    </div>
  );
}

function SimulateMove({ s, onDone }: { s: Series; onDone: () => void }) {
  const [pctText, setPct] = useState("3");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<SimulateResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    const v = Number(pctText);
    if (!Number.isFinite(v) || v === 0) { setErr("Enter a move in percent, e.g. 3 or -2.5."); return; }
    setBusy(true); setErr(null);
    try { const r = await seriesApi.simulate(s.series_id, v); setOut(r); if (r.fired) onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="hd"><h2>Simulate a move</h2><span className="badge b-info">TEST</span>
        <span className="small muted">a made-up next hour, run through the same detector</span></div>
      <div className="bd col" style={{ gap: 10 }}>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 160 }}><span>Move (% of the latest price)</span>
            <input className="input" type="number" step="0.5" value={pctText} onChange={e => setPct(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} /></label>
          <button className="btn" type="button" onClick={run} disabled={busy}><Icon name={busy ? "refresh" : "play"} className={busy ? "spin" : undefined} />Simulate</button>
        </div>
        {out && <div className={out.fired ? "note" : "small muted"}>{out.note}{out.finding && <> <span className="mono">{out.finding.finding_id}</span></>}</div>}
        {err && <div className="rawerr">{err}</div>}
        <div className="small muted">If it fires, a <b>sandbox</b> finding is written for the investigation, marked SIMULATED. Live prices, the series' state and its quiet period don't change.</div>
      </div>
    </div>
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
  const [err, setErr] = useState<string | null>(null);
  const [findings, setFindings] = useState<Finding[] | null>(null);
  const [calls, setCalls] = useState<ProviderCall[] | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { status, reload: reloadStatus } = useSeriesStatus();
  const isAdmin = role === "platform_admin";

  const load = useCallback(async () => {
    try {
      const [a, f, c] = await Promise.all([seriesApi.get(id), seriesApi.findings(id), seriesApi.fetches(id)]);
      setS(a); setFindings(f); setCalls(c); setErr(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setErr(e instanceof ApiError ? e.full : String(e));
    }
  }, [id]);
  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (loc.hash === "#findings" && findings) document.getElementById("findings")?.scrollIntoView({ behavior: "smooth" });
  }, [loc.hash, findings]);

  const updated = (x: Series) => { setS(x); reloadStatus(); seriesApi.findings(id).then(setFindings).catch(() => {}); seriesApi.fetches(id).then(setCalls).catch(() => {}); };
  const pause = async () => {
    if (!s) return;
    try { updated(await seriesApi.update(s.series_id, s.version, { enabled: !s.enabled })); toast(s.enabled ? `${s.name} paused: no hourly pulls until resumed.` : `${s.name} resumed: it's pulled at the next tick.`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const remove = async () => {
    if (!s) return;
    try { await seriesApi.remove(s.series_id); toast(`${s.name} is no longer watched. Its flagged moves stay in findings.`); nav("/series"); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };

  if (notFound) return (
    <div className="page"><PageHead title="Series not found" crumbs={<Link to="/series">Market series</Link>} />
      <div className="card"><Empty icon="series" title={`No series “${id}”`} actions={<Link className="btn" to="/series">Market series</Link>}>It may have been deleted.</Empty></div></div>
  );
  if (!s) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err}</Banner> : <PageSkeleton bare />}</div>;
  const l = s.latest;
  return (
    <div className="page">
      <PageHead crumbs={<><Link to="/series">Market series</Link><span>/</span><span>{s.name}</span></>}
        title={<span className="row" style={{ gap: 10 }}>{s.name} <StateBadge state={s.state} /> <FetchBadge s={s} /></span>}
        sub={<>{s.symbol}{s.instrument.type ? ` · ${s.instrument.type}` : ""}{s.instrument.exchange ? ` · ${s.instrument.exchange}` : ""} · Twelve Data, hourly · added {day(s.created_at)}</>}
        actions={<>
          <RefreshButton s={s} onDone={updated} small={false} />
          {isAdmin && <>
            <button className="btn" type="button" onClick={pause}><Icon name={s.enabled ? "pause" : "play"} />{s.enabled ? "Pause" : "Resume"}</button>
            <button className="btn" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit</button>
            <button className="btn btn--danger" type="button" onClick={() => setDeleting(true)}><Icon name="trash" />Delete</button>
          </>}
        </>} />
      <div className="banners">
        <PrototypeBanner status={status} />
        {s.state !== "normal" && <Banner kind={s.state === "stale" || s.state === "moved" ? "warn" : "info"} icon={s.state === "stale" ? "warn" : "info"}>{s.state_reason}</Banner>}
        {s.fetch.last_status === "error" && s.fetch.last_error && (
          <Banner kind="crit" icon="warn"><b>The last fetch failed</b> ({when(s.fetch.last_error.at, now)}). Twelve Data returned: <span className="mono">{s.fetch.last_error.code}{s.fetch.last_error.http_status ? ` ${s.fetch.last_error.http_status}` : ""}: {s.fetch.last_error.message}</span>. The prices below are the last ones received.</Banner>
        )}
      </div>
      <div className="grid4">
        <div className="card kpi"><div className="l">Latest price</div><div className="v num">{price(l?.close)}</div><div className="small muted">{l ? `hour ending ${when(l.bar_end, now)}` : "—"}</div></div>
        <div className="card kpi"><div className="l">Over 1 trading day</div><div className="v num">{pct(l?.change_1d_pct)}</div><div className="small muted">typical ±{l?.typical_daily_move_pct?.toFixed(2) ?? "—"}%</div></div>
        <div className="card kpi"><div className="l">Largest move vs typical</div><div className="v num">{zx(l?.max_z)}</div><div className="small muted">fires at {s.detector.z_threshold}×{l?.max_z_days ? ` · over ${l.max_z_days} day${l.max_z_days === 1 ? "" : "s"}` : ""}</div></div>
        <div className="card kpi"><div className="l">Fetched</div><div className="v" style={{ fontSize: 18 }}>{ago(s.fetch.last_at, now)}</div><div className="small muted">{s.enabled ? `next hourly pull: ${due(s.fetch.next_scheduled_at, now)}` : "paused"}</div></div>
      </div>
      <div className="mt16"><Chart s={s} findings={findings ?? []} /></div>
      <div className="grid2 mt16">
        <Windows s={s} />
        <div className="card">
          <div className="hd"><h2>Settings</h2>{isAdmin && <><span className="spacer" /><button className="btn btn--sm" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit</button></>}</div>
          <div className="bd"><div className="kv small" style={{ gridTemplateColumns: "150px 1fr" }}>
            <div className="k">A move means</div><div className="v">{themeMeaning(s.theme)}</div>
            <div className="k">Places</div><div className="v">{s.places.length ? s.places.join(", ") : "—"}</div>
            <div className="k">Fires at</div><div className="v">{s.detector.z_threshold}× typical, over {s.detector.windows_days.join(", ")} trading days</div>
            <div className="k">Typical move from</div><div className="v">last {s.detector.sigma_days} trading days</div>
            <div className="k">Quiet after firing</div><div className="v">{s.detector.cooldown_hours} h</div>
            <div className="k">Stale after</div><div className="v">{s.detector.stale_after_hours} market hours without a new price (weekends don't count)</div>
            <div className="k">Pulled</div><div className="v">every {status?.schedule.every_minutes ?? 60} min (prototype; not live)</div>
            <div className="k">Version</div><div className="v">{s.version} · changed {dayTime(s.updated_at)}</div>
          </div></div>
        </div>
      </div>
      <div className="grid2 mt16" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <Findings findings={findings} onChange={() => seriesApi.findings(id).then(setFindings).catch(() => {})} />
        <SimulateMove s={s} onDone={() => seriesApi.findings(id).then(setFindings).catch(() => {})} />
      </div>
      <div className="mt16"><FetchLog calls={calls} /></div>
      {editing && <EditSeriesModal s={s} onClose={() => setEditing(false)} onSaved={x => { setEditing(false); updated(x); }} />}
      {deleting && (
        <Modal title={`Stop watching ${s.name}?`} onClose={() => setDeleting(false)} footer={<>
          <button className="btn" type="button" onClick={() => setDeleting(false)}>Cancel</button>
          <button className="btn btn--danger" type="button" onClick={remove}>Delete</button></>}>
          <p>Its stored prices and fetch log are removed and it frees a series slot. Moves it already flagged stay as findings.</p>
        </Modal>
      )}
    </div>
  );
}
