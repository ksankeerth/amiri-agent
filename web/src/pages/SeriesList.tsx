// Market series: one table of the prices Amiri Agent watches, each with how unusual its latest one-day move is on a
// track from 0× to the flag line. "Not updated" is said once at the top and once, quietly, on each row.
import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { seriesApi, type Series } from "../api/series";
import { Spark } from "../components/charts";
import { PageTitle, QuietWarn, TextButton } from "../components/rd";
import { AddSeriesModal, themeMeaning } from "../components/series";
import { ListSkeleton, LoadError, useRole } from "../components/ui";
import { day, dayTime, pct, price } from "../format";
import { count } from "../plain";
import { SeriesHelp, Track, useSeriesStatus } from "./series/parts";
import { listNotice, oneDayZ, shortMeaning } from "./series/words";

const POLL_MS = 60_000;

function Row({ s, threshold }: { s: Series; threshold: number }) {
  const l = s.latest;
  const note = s.state === "stale" && l ? `not updated since ${dayTime(l.bar_end)}`
    : s.fetch.last_status === "error" ? "last update failed"
    : s.state === "paused" ? "paused: no prices pulled"
    : s.state === "pending" ? "waiting for its first prices"
    : s.state === "warming_up" ? "still learning what a normal day is" : null;
  const amber = s.state === "stale" || s.fetch.last_status === "error";
  return (
    <tr>
      <td>
        <div className="sr-name"><Link className="rd-name" to={`/series/${s.series_id}`}>{s.name}</Link></div>
        <p className="sr-mean">{shortMeaning(themeMeaning(s.theme))}{s.last_finding ? ` · last flagged ${day(s.last_finding.at)}` : ""}</p>
        {note && <p className={amber ? "sr-stale" : "sr-fine"}>{note}</p>}
      </td>
      <td>
        <div className="sr-price">{price(l?.close)}</div>
        <div className="sr-chg">{l?.change_1d_pct === null || l?.change_1d_pct === undefined ? "no day's change yet" : `${pct(l.change_1d_pct)} in a day`}</div>
      </td>
      <td><Spark values={s.spark.map(p => p.close)} color="var(--ink-2)" w={130} h={40} /></td>
      <td><Track z={oneDayZ(l)} threshold={threshold} /></td>
    </tr>
  );
}

export function SeriesList() {
  const { role } = useRole();
  const [items, setItems] = useState<Series[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [help, setHelp] = useState(false);
  const helpId = useId();
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

  const isAdmin = role === "platform_admin";
  const left = status ? status.limits.available : 0;
  const threshold = status?.detector_defaults.z_threshold ?? 3;
  const stale = (items ?? []).filter(s => s.state === "stale" && s.latest);
  const oldest = stale.map(s => s.latest!.bar_end).sort()[0];
  const notice = items && status ? listNotice({ total: items.length, stale: stale.length, oldestDay: oldest ? day(oldest) : null, configured: status.provider.configured, admin: isAdmin }) : null;
  const addButton = (primary: boolean) => primary
    ? <button className="btn btn--primary" type="button" onClick={() => setAdding(true)} disabled={!status || left <= 0}>Add a series</button>
    : <TextButton onClick={() => setAdding(true)} disabled={!status || left <= 0}
        title={left <= 0 ? "The prototype's series limit is reached; delete one first" : undefined}>+ Add a series</TextButton>;

  return (
    <div className="page rd rd-series">
      <PageTitle title="Market series"
        actions={isAdmin ? addButton(false) : <span className="rd-fine">Platform Admins add and edit series</span>}
        lede={items === null ? undefined : <><b>{count(items.length, "price")} watched.</b> A move {threshold}× bigger than a normal day is flagged.
          <TextButton aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(h => !h)}>How this works</TextButton></>}
        help={<><SeriesHelp status={status} id={helpId} open={help} />{notice && <QuietWarn>{notice}</QuietWarn>}</>} />
      {error != null && <LoadError error={error} onRetry={load} what="the market series" />}
      {items === null && error == null && <ListSkeleton rows={2} />}
      {items && items.length === 0 && (
        <div className="rd-empty">
          <p className="rd-lede">{isAdmin ? "No series yet. Add the exchange rates and prices that matter to your institution." : "No series yet. A Platform Admin adds the series Amiri Agent watches."}</p>
          {isAdmin && addButton(true)}
        </div>
      )}
      {items && items.length > 0 && (
        <table className="rd-table sr-table">
          <thead><tr>
            <th scope="col">Price</th><th scope="col">Latest</th><th scope="col">Last 2 weeks</th>
            <th scope="col">Latest one-day move, against a normal day</th>
          </tr></thead>
          <tbody>{items.map(s => <Row key={s.series_id} s={s} threshold={s.detector.z_threshold} />)}</tbody>
        </table>
      )}
      {adding && <AddSeriesModal left={left} onClose={() => setAdding(false)}
        onAdded={s => { setAdding(false); setItems(xs => [...(xs ?? []), s]); reloadStatus(); }} />}
    </div>
  );
}
