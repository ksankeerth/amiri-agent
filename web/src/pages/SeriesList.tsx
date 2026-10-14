import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { seriesApi, type Series, type SeriesStatus } from "../api/series";
import { Spark } from "../components/charts";
import { Icon } from "../components/Icon";
import { AddSeriesModal, FetchBadge, RefreshButton, StateBadge, themeMeaning } from "../components/series";
import { Banner, Empty, Limits, PageHead, useNow, useRole, ListSkeleton } from "../components/ui";
import { ago, due, pct, placeName, price, when, zx, ZONE_LABEL } from "../format";

const POLL_MS = 60_000;

export function useSeriesStatus() {
  const [status, setStatus] = useState<SeriesStatus | null>(null);
  const load = useCallback(() => seriesApi.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

export function PrototypeBanner({ status }: { status: SeriesStatus | null }) {
  const now = useNow(60_000);
  const { role } = useRole();
  if (!status) return null;
  const c = status.provider.credits;
  return (
    <>
      {!status.provider.configured && (
        <Banner kind="crit" icon="warn"><b>Twelve Data isn't configured.</b> Set <span className="mono">TWELVEDATA_API_KEY</span> in the server's environment; until then nothing can be added, refreshed or pulled.</Banner>
      )}
      <Limits summary="How prices are pulled"
        status={<>Next hourly pull: <b>{due(status.schedule.next_run_at, now)}</b>{status.schedule.next_run_at && new Date(status.schedule.next_run_at) > now ? <> {ZONE_LABEL}</> : null} · Series: <b>{status.limits.used}</b> of {status.limits.max_series}</>}>
        Prices come from Twelve Data once an hour, not streamed live; use <b>Refresh now</b> on a series to pull its latest prices (once every {Math.round(status.refresh.cooldown_seconds / 60)} minutes per series). Only finished hours are shown; up to {status.limits.max_series} series can be watched.
        {role === "platform_admin" && <> Twelve Data credits today: <b>{c.used_today}</b> of {c.per_day} · this minute {c.used_last_minute} of {c.per_minute}.</>}
      </Limits>
    </>
  );
}

function SeriesCard({ s, onChange }: { s: Series; onChange: (s: Series) => void }) {
  const now = useNow(30_000);
  const l = s.latest;
  const sparkColor = s.state === "stale" ? "var(--medium)" : s.state === "moved" ? "var(--high)" : "var(--accent)";
  return (
    <div className="card scard">
      <div className="bd col" style={{ gap: 10 }}>
        <div className="row">
          <div style={{ minWidth: 0 }}>
            <h2><Link to={`/series/${s.series_id}`}>{s.name}</Link></h2>
            <div className="meta">{s.symbol !== s.name ? `${s.symbol} · ` : ""}{(s.instrument.type ?? "").replace("Physical Currency", "Currency")}</div>
          </div>
          <span className="spacer" />
          <div className="row" style={{ gap: 6 }}><FetchBadge s={s} /><StateBadge state={s.state} /></div>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="price">{price(l?.close)}</div>
            <div className="small">
              <span className="flat">{pct(l?.change_1d_pct)}</span> <span className="muted">over 1 trading day</span>
            </div>
          </div>
          <span className="spacer" />
          <Spark values={s.spark.map(p => p.close)} color={sparkColor} />
        </div>
        <div className="kv small" style={{ gridTemplateColumns: "118px 1fr" }}>
          <div className="k">Latest price</div><div className="v">{l ? `hour ending ${when(l.bar_end, now)}` : "—"}</div>
          <div className="k">A move means</div><div className="v">{themeMeaning(s.theme)}{s.places.length ? ` · ${s.places.map(placeName).join(", ")}` : ""}</div>
          <div className="k">Normal day</div><div className="v">{l?.typical_daily_move_pct ? `±${l.typical_daily_move_pct.toFixed(2)}%` : "—"}</div>
          <div className="k">Largest recent move</div><div className="v">{l?.max_z !== null && l?.max_z !== undefined ? `${zx(l.max_z)} a normal move over ${l.max_z_days} day${l.max_z_days === 1 ? "" : "s"} · flagged at ${s.detector.z_threshold}×` : "—"}</div>
          <div className="k">Last fetched</div><div className="v">{ago(s.fetch.last_at, now)}{s.enabled && s.fetch.next_scheduled_at ? ` · next: ${due(s.fetch.next_scheduled_at, now)}` : ""}</div>
          {s.last_finding && <><div className="k">Last flagged</div><div className="v"><Link to={`/series/${s.series_id}#findings`}>{when(s.last_finding.at, now)}</Link></div></>}
        </div>
        {["stale", "warming_up", "moved", "pending", "paused"].includes(s.state) && <div className="note small">{s.state_reason}</div>}
        {s.fetch.last_status === "error" && s.fetch.last_error && (
          <div className="rawerr">{when(s.fetch.last_error.at, now)} · {s.fetch.last_error.code}{s.fetch.last_error.http_status ? ` (${s.fetch.last_error.http_status})` : ""}: {s.fetch.last_error.message}</div>
        )}
        <div className="foot">
          <RefreshButton s={s} onDone={onChange} />
          <span className="spacer" />
          <Link className="small" to={`/series/${s.series_id}`}>Chart and details →</Link>
        </div>
      </div>
    </div>
  );
}

export function SeriesList() {
  const { role } = useRole();
  const [items, setItems] = useState<Series[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const { status, reload: reloadStatus } = useSeriesStatus();

  const load = useCallback(async () => {
    try { setItems(await seriesApi.list()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.full : String(e)); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { load(); reloadStatus(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, reloadStatus]);

  const replace = (s: Series) => { setItems(xs => xs?.map(x => (x.series_id === s.series_id ? s : x)) ?? null); reloadStatus(); };
  const isAdmin = role === "platform_admin";
  const left = status ? status.limits.available : 0;

  return (
    <div className="page">
      <PageHead title="Market series"
        sub="Prices and rates Amiri Agent watches by itself. A move far outside normal for its length becomes a finding, which the investigation picks up. Code only; no model."
        actions={isAdmin
          ? <button className="btn btn--primary" type="button" onClick={() => setAdding(true)} disabled={!status || left <= 0}
              title={left <= 0 ? "The prototype's series limit is reached; delete one first" : undefined}><Icon name="plus" />Add a series</button>
          : <span className="small muted">Platform Admins add and edit series.</span>} />
      <div className="banners"><PrototypeBanner status={status} /></div>
      {error && <Banner kind="crit" icon="warn">{error}</Banner>}
      {items === null && !error && <ListSkeleton rows={2} />}
      {items && items.length === 0 && (
        <div className="card"><Empty icon="series" title="No series yet"
          actions={isAdmin ? <button className="btn btn--primary" type="button" onClick={() => setAdding(true)}><Icon name="plus" />Add a series</button> : undefined}>
          {isAdmin ? "Add the exchange rates and prices that matter to your institution." : "A Platform Admin adds the series Amiri Agent watches."}
        </Empty></div>
      )}
      {items && items.length > 0 && <div className="seriesgrid mt12">{items.map(s => <SeriesCard key={s.series_id} s={s} onChange={replace} />)}</div>}
      {adding && <AddSeriesModal left={left} onClose={() => setAdding(false)}
        onAdded={s => { setAdding(false); setItems(xs => [...(xs ?? []), s]); reloadStatus(); }} />}
    </div>
  );
}
