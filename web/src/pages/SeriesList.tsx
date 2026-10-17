import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { seriesApi, type Series, type SeriesStatus } from "../api/series";
import { Spark } from "../components/charts";
import { Icon } from "../components/Icon";
import { HowItWorks, PageHeader } from "../components/blocks";
import { AddSeriesModal, FetchBadge, RefreshButton, seriesSentence, StateBadge, themeMeaning } from "../components/series";
import { Banner, Empty, useNow, useRole, ListSkeleton } from "../components/ui";
import { ago, due, pct, price, when, zx, ZONE_LABEL } from "../format";
import { count, ruleText } from "../plain";

const POLL_MS = 60_000;

export function useSeriesStatus() {
  const [status, setStatus] = useState<SeriesStatus | null>(null);
  const load = useCallback(() => seriesApi.status().then(setStatus).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  return { status, reload: load };
}

/** The provider isn't set up: the Platform Admin sees how to fix it, a Risk Manager what it means. */
export function PrototypeBanner({ status }: { status: SeriesStatus | null }) {
  const { role } = useRole();
  if (!status || status.provider.configured) return null;
  return role === "platform_admin"
    ? <Banner kind="crit" icon="warn"><b>Twelve Data isn't configured.</b> Set <span className="mono">TWELVEDATA_API_KEY</span> in the server's environment; until then nothing can be added, refreshed or pulled.</Banner>
    : <Banner kind="warn" icon="warn">Prices can't be updated right now. Your Platform Admin has been told.</Banner>;
}

/** How prices are pulled: behind the page's "How this works" link. */
export function PricesHelp({ status }: { status: SeriesStatus | null }) {
  const now = useNow(60_000);
  const { role } = useRole();
  const c = status?.provider.credits;
  return (
    <HowItWorks>
      <p>Amiri Agent watches these prices by itself, with plain arithmetic. It {ruleText(status?.detector_defaults.z_threshold ?? 3)} for that length of time; each flagged move becomes a finding for the investigation.</p>
      {status && <p>Prices are pulled once an hour, not streamed. The next pull is due {due(status.schedule.next_run_at, now)}{status.schedule.next_run_at && new Date(status.schedule.next_run_at) > now ? ` ${ZONE_LABEL} time` : ""}. Refresh now pulls a series' latest prices (once every {Math.round(status.refresh.cooldown_seconds / 60)} minutes). Up to {status.limits.max_series} series can be watched; {status.limits.used} are.</p>}
      {role === "platform_admin" && c && <p>Twelve Data credits today: {c.used_today} of {c.per_day}; this minute {c.used_last_minute} of {c.per_minute}.</p>}
    </HowItWorks>
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
            <div className="meta">{themeMeaning(s.theme)}</div>
          </div>
          <span className="spacer" />
          <div className="row" style={{ gap: 6 }}><FetchBadge s={s} /><StateBadge state={s.state} /></div>
        </div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div>
            <div className="price">{price(l?.close)}</div>
            <div className="small">
              <span className="flat">{pct(l?.change_1d_pct)}</span> <span className="muted">over one trading day</span>
            </div>
          </div>
          <span className="spacer" />
          <Spark values={s.spark.map(p => p.close)} color={sparkColor} />
        </div>
        <dl className="facts">
          <div><dt>Latest price</dt><dd>{l ? `hour ending ${when(l.bar_end, now)}` : "none yet"}</dd></div>
          <div><dt>Normal day</dt><dd>{l?.typical_daily_move_pct ? `±${l.typical_daily_move_pct.toFixed(2)}%` : "not known yet"}</dd></div>
          <div><dt>Largest recent move</dt><dd>{l?.max_z !== null && l?.max_z !== undefined ? `${zx(l.max_z)} a normal one; flagged at ${s.detector.z_threshold}×` : "not known yet"}</dd></div>
          <div><dt>Updated</dt><dd>{ago(s.fetch.last_at, now)}</dd></div>
          {s.last_finding && <div><dt>Last flagged</dt><dd><Link to={`/series/${s.series_id}#findings`}>{when(s.last_finding.at, now)}</Link></dd></div>}
        </dl>
        {s.state !== "normal" && <div className="note small">{seriesSentence(s, now)}</div>}
        <div className="foot">
          <RefreshButton s={s} onDone={onChange} />
          <span className="spacer" />
          <Link className="small" to={`/series/${s.series_id}`}>Chart and details</Link>
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
      <PageHeader title="Market series"
        status={items === null ? "" : <><b className="ink">{count(items.length, "price")} watched</b>{items.some(x => x.state === "moved") ? `, ${items.filter(x => x.state === "moved").length} moving unusually` : ""}{items.some(x => x.state === "stale") ? `, ${items.filter(x => x.state === "stale").length} not updating` : ""}</>}
        actions={isAdmin
          ? <button className="btn btn--primary" type="button" onClick={() => setAdding(true)} disabled={!status || left <= 0}
              title={left <= 0 ? "The prototype's series limit is reached; delete one first" : undefined}><Icon name="plus" />Add a series</button>
          : <span className="small muted">Platform Admins add and edit series.</span>}
        help={<PricesHelp status={status} />} />
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
