// Market series (board 07; states: board 16 section H): the prices AMIRI Agent watches, as a list with the open one beside it.
// /series opens the first one (unusual first); /series/:id opens that one. On a phone the list is the page and a series opens as
// its own view with a back link.
//
// Asking, and how often (nothing is asked about unless this viewer pressed a button; see pane.tsx for the buttons):
//   passive: the list and the service's status every 60 s, and not while the tab is hidden.
import { Input, Select } from "../../components/v2/Field";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { peek, quietly } from "../../api/client";
import { investigationApi } from "../../api/investigation";
import { seriesApi, type Series, type SeriesStatus } from "../../api/series";
import { useDemoLock } from "../../components/lock";
import { useNow, useRole } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { ListPane, MoreRows, PaneBack, PaneView, usePaged } from "../../components/v2/ListPane";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs, usePhone } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { TabPanel, Tabs } from "../../components/v2/Tabs";
import { day, when } from "../../format";
import { eventTitle } from "../../plain";
import { AddSeriesDialog } from "./dialogs";
import { SeriesRows } from "./list";
import { SeriesPane } from "./pane";
import { ledeParts, listNotice, matchesQuery, seriesName, sortSeries, tabCounts, tabOf, TABS, typeOptions, seriesType, type TabId } from "./words";
import "../../styles/v2/series.css";

const REFRESH_MS = 60_000;   // passive: no faster than every 30 s
const NEXT = [{ label: "What it watches" }];

export function SeriesPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const phone = usePhone();
  const now = useNow(30_000);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const locked = useDemoLock();

  // seen before: the last answers show at once and are refreshed below (F4)
  const [items, setItems] = useState<Series[] | null>(() => peek(() => seriesApi.list()) ?? null);
  const [status, setStatus] = useState<SeriesStatus | null>(() => peek(() => seriesApi.status()) ?? null);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>(() => Object.fromEntries((peek(() => investigationApi.events(200)) ?? []).map(e => [e.event_id, eventTitle(e)])));
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<TabId>("all");
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [pinned, setPinned] = useState<string | null>(null);
  const alive = useRef(true);
  const seq = useRef(0);
  const loaded = useRef(0);
  const askedTitles = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // ---------------------------------------------------------------- loading
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [xs, st] = await Promise.all([seriesApi.list(), seriesApi.status().catch(() => null)]);
      if (!alive.current || mine !== seq.current) return;
      setItems(xs); if (st) setStatus(st); setErr(null); setLoadedAt(Date.now()); loaded.current = Date.now();
    } catch (e) { if (alive.current && mine === seq.current) setErr(e); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) quietly(load); }, REFRESH_MS);
    const vis = () => { if (!document.hidden && Date.now() - loaded.current > 30_000) quietly(load); };   // back on the tab: catch up, but not in a burst
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  /** The event names the flagged moves link to, asked for once a few minutes at most (and only when a move joined an event). */
  const askTitles = useCallback(() => {
    if (Date.now() - askedTitles.current < 300_000) return;
    askedTitles.current = Date.now();
    investigationApi.events(200).then(es => { if (alive.current) setTitles(Object.fromEntries(es.map(e => [e.event_id, eventTitle(e)]))); }).catch(() => { askedTitles.current = 0; });
  }, []);
  const replace = useCallback((x: Series) => { seq.current++; setItems(xs => (xs ? xs.map(o => (o.series_id === x.series_id ? x : o)) : xs)); }, []);

  // ---------------------------------------------------------------- what is shown
  const sorted = useMemo(() => sortSeries(items ?? []), [items]);
  const counts = useMemo(() => tabCounts(items ?? []), [items]);
  const types = useMemo(() => typeOptions(items ?? []), [items]);
  const shown = useMemo(() => sorted.filter(s => (tab === "all" || tabOf(s.state) === tab) && matchesQuery(s, q) && (!type || seriesType(s) === type)), [sorted, tab, q, type]);
  const empty = items !== null && !items.length;
  // the address names none: the first one opens, and stays open when the list is reordered
  const best = !id && !phone ? sorted[0] ?? null : null;
  const fallbackId = pinned && items?.some(x => x.series_id === pinned) ? pinned : best?.series_id ?? null;
  useEffect(() => { if (fallbackId && fallbackId !== pinned && !id) setPinned(fallbackId); }, [fallbackId, pinned, id]);
  const openId = id ?? fallbackId;
  const open = openId ? items?.find(x => x.series_id === openId) ?? null : null;
  const missing = items !== null && !!id && !open;
  const paged = usePaged<Series, HTMLDivElement>(shown, `${tab}|${q}|${type}`, openId ? shown.findIndex(s => s.series_id === openId) : -1, ".v2-row:not(.v2-row--head)");
  const reading = phone && !!id;
  const stale = err != null && items !== null && loadedAt != null;

  useCrumbs(id ? [...NEXT, { label: "Market series", to: "/series" }, { label: open ? seriesName(open.name) : "Series" }] : [...NEXT, { label: "Market series" }]);

  // a choice moves focus to the series' heading (the shell's own move to the page comes first, at 250 ms)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!id) return;
    const t = setTimeout(() => document.getElementById("sr-title")?.focus({ preventScroll: false }), 400);
    return () => clearTimeout(t);
  }, [id]);

  const parts = ledeParts({
    unusual: counts.moved, late: counts.stale, total: items?.length ?? 0, max: status?.limits.max_series ?? null,
    everyMinutes: status?.schedule.every_minutes ?? null, lastRun: status?.schedule.last_run_at ? when(status.schedule.last_run_at, now) : null,
    threshold: status?.detector_defaults.z_threshold ?? 3,
  });
  const credits = status?.provider.credits;
  const spent = !!credits && credits.used_today >= credits.per_day;
  const notice = items && status ? listNotice({
    total: items.length, stale: counts.stale, admin, configured: status.provider.configured,
    oldestDay: (() => { const o = items.filter(s => s.state === "stale" && s.latest).map(s => s.latest!.bar_end).sort()[0]; return o ? day(o) : null; })(),
  }) : null;
  const left = status ? status.limits.available : 0;

  const head = (
    <header className={`v2-sr-head${reading ? " v2-sr" : ""}`}>
      <div className="v2-sr-head__t">
        <h1 className="v2-sr-h1">Market series</h1>
        {items !== null && <p className="v2-sr-lede">{parts.strong && <><b className="v2-sr-lede__hot">{parts.strong}</b> · </>}{parts.rest}</p>}
        {admin && credits && <p className="v2-meta">Admin: provider credits <b>{credits.used_today} of {credits.per_day}</b> used today · this minute {credits.used_last_minute} of {credits.per_minute}</p>}
      </div>
      {admin
        ? <Button variant="primary" locked={locked} disabled={!status} onClick={() => setAdding(true)}>Add a series</Button>
        : <span className="v2-sr-head__note v2-meta"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 11h12v9H6z M8 11V8a4 4 0 0 1 8 0v3" /></svg>Platform Admins add and edit series</span>}
    </header>
  );

  const pane = open && (
    <SeriesPane key={open.series_id} s={open} status={status} admin={admin} eventTitles={titles} askEventTitles={askTitles}
      onUpdated={replace} onRemoved={s => { setItems(xs => (xs ?? []).filter(o => o.series_id !== s.series_id)); setPinned(null); nav("/series", { replace: true }); load(); }} />
  );
  const back = <PaneBack to="/series">All series</PaneBack>;
  const trailing = (
    <div className="v2-sr-filters">
      <Input type="search" className="v2-sr-find" aria-label="Find a series or symbol" placeholder="Find a series or symbol" value={q} onChange={e => setQ(e.target.value)} />
      {types.length > 1 && (
        <label className="v2-sr-type"><span className="v2-meta">Type</span>
          <Select inline value={type} onChange={e => setType(e.target.value)}>
            <option value="">All types</option>{types.map(t => <option key={t}>{t}</option>)}</Select></label>)}
    </div>
  );

  return (
    <div className="v2-sr-page">
      {stale && <StaleBanner loadedAt={loadedAt!} now={now.getTime()} onRetry={load} />}
      {head}

      {!reading && notice && <p className="v2-sr-notice" role="status"><span aria-hidden="true">◆ </span>{notice}</p>}
      {!reading && spent && <p className="v2-sr-notice" role="status"><span aria-hidden="true">◆ </span>Today's price credits are used up, so new prices wait until {when(credits!.day_resets_at, now)}. What is shown is the last prices received.</p>}

      {items === null && err != null && <LoadError error={err} onRetry={load} what="the market series" safe="Your series are safe; this page just couldn't reach them." />}
      {items === null && err == null && (
        <div className="v2-sr-body">
          <ListPane wide list={!phone && <Skeleton rows={8} label="Loading the market series" />}
            pane={<div className="v2-panel v2-lp__panel"><Skeleton rows={5} label="Loading the series" /></div>} />
        </div>)}

      {empty && (
        <Empty title="No series yet" className="v2-sr-empty" action={admin ? <Button variant="primary" locked={locked} onClick={() => setAdding(true)}>Add a series</Button> : undefined}>
          {admin ? "Add the exchange rates and prices that matter to your institution. AMIRI Agent watches them every hour and flags a move far bigger than usual."
            : "A Platform Admin adds the prices AMIRI Agent watches."}
        </Empty>)}

      {items !== null && !empty && missing && (
        <PaneView back={back}><Empty title="This series isn't watched" action={<Button as="link" to="/series" variant="primary">See market series</Button>}>It may have been deleted.</Empty></PaneView>)}

      {items !== null && !empty && !missing && (reading ? (
        <PaneView back={back}>{pane}</PaneView>
      ) : (
        <Tabs label="State" value={tab} onChange={v => setTab(v as TabId)} trailing={trailing}
          tabs={TABS.map(t => ({ id: t.id, label: t.label, count: counts[t.id], countTone: t.id === "moved" && counts.moved > 0 ? "unusual" : "neutral", countLabel: t.id === "all" ? "series" : t.label.toLowerCase() }))}>
          <TabPanel id={tab}>
            <div className="v2-sr-body">
              <ListPane wide pane={!phone && pane} itemKey={openId} list={
                <section aria-label="Series">
                  {shown.length ? (
                    <div className="v2-sr-scroll" ref={paged.listRef}><SeriesRows items={paged.shown} openId={phone ? null : openId} threshold={status?.detector_defaults.z_threshold ?? 3} /></div>
                  ) : (
                    <Empty title="No series match" plain>
                      <Button variant="quiet" onClick={() => { setTab("all"); setQ(""); setType(""); }}>Show all series</Button>
                    </Empty>)}
                  <MoreRows left={paged.left} onMore={paged.more} />
                  <p className="v2-meta v2-sr-count" role="status">{shown.length === items.length ? `${items.length} series` : `${shown.length} of ${items.length} series`}</p>
                </section>} />
            </div>
          </TabPanel>
        </Tabs>
      ))}

      {adding && <AddSeriesDialog left={left} onClose={() => setAdding(false)}
        onAdded={s => { setAdding(false); setItems(xs => [...(xs ?? []), s]); load(); nav(`/series/${encodeURIComponent(s.series_id)}`); }} />}
    </div>
  );
}
