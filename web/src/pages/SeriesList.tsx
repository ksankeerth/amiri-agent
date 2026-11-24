import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { seriesApi, type Series, type SeriesStatus } from "../api/series";
import { Spark } from "../components/charts";
import { Icon } from "../components/Icon";
import { HowItWorks, PageHeader, StatusPill } from "../components/blocks";
import { AddSeriesModal, FetchBadge, RefreshButton, seriesSentence, StateBadge, themeMeaning } from "../components/series";
import { Banner, Empty, useNow, useRole, ListSkeleton, LoadError } from "../components/ui";
import { ago, due, pctFine, price, when, zx, ZONE_LABEL } from "../format";
import { count, ruleText } from "../plain";
import "../styles/series.css";

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
      <p>AMIRI Agent watches these prices by itself, with plain arithmetic. It {ruleText(status?.detector_defaults.z_threshold ?? 3)} for that length of time; each flagged move becomes a finding for the investigation.</p>
      {status && <p>Prices are pulled once an hour, not streamed. The next pull is due {due(status.schedule.next_run_at, now)}{status.schedule.next_run_at && new Date(status.schedule.next_run_at) > now ? ` ${ZONE_LABEL} time` : ""}. Refresh now pulls a series' latest prices (once every {Math.round(status.refresh.cooldown_seconds / 60)} minutes). Up to {status.limits.max_series} series can be watched; {status.limits.used} are.</p>}
      {role === "platform_admin" && c && <p>Twelve Data credits today: {c.used_today} of {c.per_day}; this minute {c.used_last_minute} of {c.per_minute}.</p>}
    </HowItWorks>
  );
}

// an unusual move or a price that stopped updating comes first; the rest keep the order they were added in (sort is stable)
const concern = (s: Series) => (s.state === "moved" ? 0 : s.state === "stale" ? 1 : 2);

/** Gemini's plan: the card says name, how unusual, price, 1 day, the spark and one line on the latest anomaly;
 *  the facts, Refresh and the way to the chart wait behind "Series stats & threshold". */
function SeriesCard({ s, onChange }: { s: Series; onChange: (s: Series) => void }) {
  const now = useNow(30_000);
  const l = s.latest;
  const z = l?.max_z === null || l?.max_z === undefined ? null : Math.abs(l.max_z);
  const unusual = s.state === "moved" || (z !== null && z >= s.detector.z_threshold);
  const settled = z !== null && (s.state === "normal" || s.state === "moved");  // pending, learning, stale, paused keep their own word
  const sparkColor = s.state === "stale" ? "var(--medium)" : unusual ? "var(--high)" : "var(--accent)";
  const anomaly = s.last_finding ? <>Flagged <Link to={`/series/${s.series_id}#findings`}>{when(s.last_finding.at, now)}</Link>{z !== null ? `: ${zx(z)} a normal move` : ""}</>
    : settled ? <>Largest recent move {zx(z)} a normal one</> : seriesSentence(s, now);
  return (
    <article className="card scard sc" aria-labelledby={`sc-${s.series_id}`}>
      <div className="sc-top">
        <h2 id={`sc-${s.series_id}`}><Link to={`/series/${s.series_id}`}>{s.name}</Link></h2>
        {settled ? <StatusPill tone={unusual ? "red" : "green"}>{zx(z)} normal</StatusPill> : <StateBadge state={s.state} />}
      </div>
      <div className="sc-mid">
        <span className="sc-price">{price(l?.close)}</span>
        <span className={`sc-chg${unusual ? " hot" : ""}`}>{pctFine(l?.change_1d_pct)} <span className="muted">1 day</span></span>
        <span className="spacer" />
        <Spark values={s.spark.map(p => p.close)} color={sparkColor} w={120} h={36} />
      </div>
      <p className="sc-anom">{anomaly}</p>
      <details className="sc-det">
        <summary>Series stats &amp; threshold</summary>
        <dl className="facts">
          <div><dt>Normal day</dt><dd>{l?.typical_daily_move_pct ? `±${pctFine(l.typical_daily_move_pct).replace(/^\+/, "")}` : "not known yet"}</dd></div>
          <div><dt>Flagged at</dt><dd>{s.detector.z_threshold}× a normal move</dd></div>
          <div><dt>Latest price</dt><dd>{l ? `hour ending ${when(l.bar_end, now)}` : "none yet"}</dd></div>
          <div><dt>Updated</dt><dd>{ago(s.fetch.last_at, now)} <FetchBadge s={s} /></dd></div>
          <div><dt>A move means</dt><dd>{themeMeaning(s.theme)}</dd></div>
        </dl>
        <div className="sc-foot"><RefreshButton s={s} onDone={onChange} /><span className="spacer" /><Link to={`/series/${s.series_id}`}>Chart and details</Link></div>
      </details>
    </article>
  );
}

export function SeriesList() {
  const { role } = useRole();
  const [items, setItems] = useState<Series[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const { status, reload: reloadStatus } = useSeriesStatus();

  const load = useCallback(async () => {
    try { setItems(await seriesApi.list()); setError(null); }
    catch (e) { setError(e); }
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
      {error != null && <LoadError error={error} onRetry={load} what="the market series" />}
      {items === null && error == null && <ListSkeleton rows={2} />}
      {items && items.length === 0 && (
        <div className="card"><Empty icon="series" title="No series yet"
          actions={isAdmin ? <button className="btn btn--primary" type="button" onClick={() => setAdding(true)}><Icon name="plus" />Add a series</button> : undefined}>
          {isAdmin ? "Add the exchange rates and prices that matter to your institution." : "A Platform Admin adds the series AMIRI Agent watches."}
        </Empty></div>
      )}
      {items && items.length > 0 && <div className="seriesgrid mt12">{[...items].sort((a, b) => concern(a) - concern(b)).map(s => <SeriesCard key={s.series_id} s={s} onChange={replace} />)}</div>}
      {adding && <AddSeriesModal left={left} onClose={() => setAdding(false)}
        onAdded={s => { setAdding(false); setItems(xs => [...(xs ?? []), s]); reloadStatus(); }} />}
    </div>
  );
}
