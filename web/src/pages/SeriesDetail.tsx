import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { seriesApi, type Bar, type Finding, type ProviderCall, type Series, type SimulateResult } from "../api/series";
import { FactList, PageHeader, Places, Section, StatTiles, StatusPill, TechnicalDetails } from "../components/blocks";
import { PriceChart } from "../components/charts";
import { Icon } from "../components/Icon";
import { EditSeriesModal, FetchBadge, RefreshButton, seriesSentence, StateBadge, themeMeaning } from "../components/series";
import { Banner, Empty, Modal, useNow, useRole, useToast, PageSkeleton, InlineSkeleton } from "../components/ui";
import { ago, day, dayTime, due, pct, price, when, zx, ZONE_LABEL } from "../format";
import { FINDING_STATUS, ruleText, setAsideReason, themeLabel } from "../plain";
import { InvestigateNowButton } from "./events/Events";
import { PricesHelp, PrototypeBanner, useSeriesStatus } from "./SeriesList";

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
  const marks = findings.filter(f => f.world === "live").map(f => ({ t: f.evidence?.signals?.[0]?.end_at ?? f.created_at, color: "var(--high)", label: f.title }));
  return (
    <div className="card">
      <div className="hd wrap"><h2>Price</h2><span className="small muted">{range.interval === "1h" ? "Hourly" : "Daily"} closes, {ZONE_LABEL} time · orange dots: flagged moves</span>
        <span className="spacer" />
        <span className="seg" role="group" aria-label="Period">{RANGES.map(r => <button key={r.id} type="button" aria-pressed={r.id === range.id} onClick={() => setRange(r)}>{r.label}</button>)}</span></div>
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
    <Section title="How unusual is the latest price?" flush>
      <p className="sec-line">{l?.typical_daily_move_pct ? <>A normal day moves <b>±{l.typical_daily_move_pct.toFixed(2)}%</b>. </> : null}Amiri Agent {ruleText(s.detector.z_threshold)}.</p>
      {!l || !l.windows.length ? <p className="sec-line">No prices yet.</p> : (
        <div className="tblwrap"><table className="tbl">
          <thead><tr><th>Over</th><th>Change</th><th>Compared with usual</th></tr></thead>
          <tbody>{l.windows.map(w => {
            const fires = w.z !== null && Math.abs(w.z) >= s.detector.z_threshold;
            return (
              <tr key={w.days}>
                <td className="strong">{w.days} trading day{w.days === 1 ? "" : "s"}<div className="sub">from {price(w.ref_close)}</div></td>
                <td className="num">{pct(w.change_pct)}</td>
                <td>{w.z === null ? <span className="muted">not known yet</span> : fires ? <StatusPill tone="red">{zx(w.z)} usual: flagged</StatusPill> : <span className="num">{zx(w.z)} usual</span>}</td>
              </tr>);
          })}</tbody>
        </table></div>
      )}
    </Section>
  );
}

function FetchLog({ calls }: { calls: ProviderCall[] | null }) {
  return (
    <div className="card">
      <div className="hd"><h2>Fetch log</h2><span className="small muted">for the Platform Admin: every call to Twelve Data, errors exactly as returned</span></div>
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

function Findings({ findings, onChange }: { findings: Finding[] | null; onChange: () => void }) {
  const waiting = (findings ?? []).filter(f => f.status === "new").map(f => f.finding_id);
  return (
    <section className="card sec" id="findings" aria-labelledby="moves-h">
      <div className="sec-hd"><h2 id="moves-h">Moves flagged</h2>{findings && <span className="sec-n">{findings.length}</span>}
        <span className="spacer" />{waiting.length > 0 && <InvestigateNowButton ids={waiting} onDone={onChange} small />}</div>
      <div className="sec-bd flush">
      {!findings ? <InlineSkeleton /> : !findings.length ? <p className="sec-line">None yet. A move shows here when it's far bigger than usual.</p>
        : findings.map(f => {
          const [label, tone] = FINDING_STATUS[f.status] ?? [f.status, "grey" as const];
          return (
            <div key={f.finding_id} className="lrow">
              <span className="row-ico"><Icon name="series" /></span>
              <span className="row-main">
                <span className="row-top"><b className="row-l">{f.title}</b><StatusPill tone={tone}>{label}</StatusPill>
                  {f.world === "sandbox" && <StatusPill tone="blue">Test</StatusPill>}</span>
                <span className="row-d">{f.outcome?.event_id ? <Link to={`/events/${f.outcome.event_id}`}>Open the event</Link>
                  : f.status === "set_aside" ? `No impact found: ${setAsideReason(f.outcome?.reason)}` : f.themes.map(themeLabel).join(", ")}</span>
              </span>
              <span className="row-meta">{dayTime(f.created_at)}</span>
            </div>);
        })}
      </div>
    </section>
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
      <div className="hd"><h2>Try a move</h2><StatusPill tone="blue">Test</StatusPill></div>
      <div className="bd col" style={{ gap: 10 }}>
        <p className="small muted">See whether a made-up move would be flagged. Your real prices don't change.</p>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ width: 160 }}><span>Move (% of the latest price)</span>
            <input className="input" type="number" step="0.5" value={pctText} onChange={e => setPct(e.target.value)} onKeyDown={e => e.key === "Enter" && run()} /></label>
          <button className="btn" type="button" onClick={run} disabled={busy}><Icon name={busy ? "refresh" : "play"} className={busy ? "spin" : undefined} />Simulate</button>
        </div>
        {out && <div className={out.fired ? "note" : "small muted"}>{out.note}</div>}
        {err && <div className="rawerr">{err}</div>}
        <div className="small muted">If it's flagged, a test finding goes to the investigation, marked Test. It never reaches your real alerts.</div>
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
    try { updated(await seriesApi.update(s.series_id, s.version, { enabled: !s.enabled })); toast(s.enabled ? `${s.name} paused: no hourly pulls until resumed.` : `${s.name} resumed: prices update again within the hour.`); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const remove = async () => {
    if (!s) return;
    try { await seriesApi.remove(s.series_id); toast(`${s.name} is no longer watched. Its flagged moves stay in findings.`); nav("/series"); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };

  if (notFound) return (
    <div className="page"><PageHeader title="Series not found" crumbs={<Link to="/series">Market series</Link>} />
      <div className="card"><Empty icon="series" title="This series isn't watched" actions={<Link className="btn" to="/series">See market series</Link>}>It may have been deleted.</Empty></div></div>
  );
  if (!s) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err}</Banner> : <PageSkeleton bare />}</div>;
  const l = s.latest;
  const moved = l?.max_z !== null && l?.max_z !== undefined && Math.abs(l.max_z) >= s.detector.z_threshold;
  return (
    <div className="page">
      <PageHeader crumbs={<><Link to="/series">Market series</Link><span aria-hidden="true">/</span><span>{s.name}</span></>}
        title={s.name} pills={<><StateBadge state={s.state} /><FetchBadge s={s} /></>}
        status={seriesSentence(s, now)}
        actions={<>
          <RefreshButton s={s} onDone={updated} small={false} />
          {isAdmin && <>
            <button className="btn" type="button" onClick={pause}><Icon name={s.enabled ? "pause" : "play"} />{s.enabled ? "Pause" : "Resume"}</button>
            <button className="btn" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit</button>
            <button className="btn btn--danger" type="button" onClick={() => setDeleting(true)}><Icon name="trash" />Delete</button>
          </>}
        </>}
        help={<PricesHelp status={status} />} />
      <div className="banners">
        <PrototypeBanner status={status} />
        {s.fetch.last_status === "error" && s.fetch.last_error && (isAdmin
          ? <Banner kind="crit" icon="warn"><b>The last fetch failed</b> ({when(s.fetch.last_error.at, now)}). Twelve Data returned: <span className="mono">{s.fetch.last_error.code}{s.fetch.last_error.http_status ? ` ${s.fetch.last_error.http_status}` : ""}: {s.fetch.last_error.message}</span>.</Banner>
          : <Banner kind="warn" icon="warn">The last price update failed. The prices below are the last ones received; your Platform Admin has been told.</Banner>)}
      </div>
      <StatTiles label="The latest price in short" items={[
        { value: price(l?.close), label: "Latest price", sub: l ? `hour ending ${when(l.bar_end, now)}` : "no prices yet", tone: s.state === "stale" ? "amber" : "grey", icon: "series" },
        { value: pct(l?.change_1d_pct), label: "Over one trading day", sub: l?.typical_daily_move_pct ? `a normal day is ±${l.typical_daily_move_pct.toFixed(2)}%` : undefined, tone: "grey" },
        { value: l?.max_z !== null && l?.max_z !== undefined ? zx(l.max_z) : "—", label: "How unusual", sub: `of a normal move; flagged at ${s.detector.z_threshold}×`, tone: moved ? "red" : "green" },
      ]} />
      <Chart s={s} findings={findings ?? []} />
      <div className="grid2 mt16">
        <Windows s={s} />
        <Section title="What a move means" action={isAdmin ? <button className="btn btn--sm" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit</button> : undefined}>
          <FactList items={[
            ["A move means", themeMeaning(s.theme)],
            ["Where", s.places.length ? <Places codes={s.places} max={8} /> : null],
            ["Rule", `Amiri Agent ${ruleText(s.detector.z_threshold)}`],
            ["Updated", s.enabled ? `${ago(s.fetch.last_at, now)}; prices are pulled every hour` : "Paused"],
          ]} />
          <div className="mt12"><TechnicalDetails>
            <FactList items={[["Symbol", `${s.symbol}${s.instrument.type ? ` · ${s.instrument.type}` : ""}${s.instrument.exchange ? ` · ${s.instrument.exchange}` : ""}`],
              ["Vendor", "Twelve Data, hourly"], ["Next pull", s.enabled ? due(s.fetch.next_scheduled_at, now) : "paused"],
              ["Detector", `${s.detector.z_threshold}× typical over ${s.detector.windows_days.join(", ")} trading days; typical from the last ${s.detector.sigma_days}; quiet for ${s.detector.cooldown_hours} h after flagging`],
              ["Stale after", `${s.detector.stale_after_hours} market hours without a new price`], ["State", s.state_reason],
              ["Version", `${s.version}, changed ${dayTime(s.updated_at)}`], ["Added", day(s.created_at)]]} />
          </TechnicalDetails></div>
        </Section>
      </div>
      <div className="grid2 mt16" style={{ gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
        <Findings findings={findings} onChange={() => seriesApi.findings(id).then(setFindings).catch(() => {})} />
        <SimulateMove s={s} onDone={() => seriesApi.findings(id).then(setFindings).catch(() => {})} />
      </div>
      {isAdmin && <div className="mt16"><FetchLog calls={calls} /></div>}
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
