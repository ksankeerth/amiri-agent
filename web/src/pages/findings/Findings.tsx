// Findings (board 04; states: board 16 section E): what the monitors, market prices and Radar picked up in the last 7 days,
// grouped by what became of each one: waiting for the next investigation, being investigated, in an event (under the
// event's name), couldn't be investigated, no impact found. Tabs by status and a Source filter. Reloads every 30 s; a
// finding that is on its way is asked about every 3 s until it lands (UI_POLLING_NOTE.md). Refresh reloads now.
import { seriesName } from "../series/words";
import { Checkbox } from "../../components/v2/Choice";
import { Select } from "../../components/v2/Field";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { peek } from "../../api/client";
import { investigationApi, type EventRow, type FindingRow } from "../../api/investigation";
import { monitorsApi } from "../../api/monitors";
import { seriesApi } from "../../api/series";
import { Icon } from "../../components/Icon";
import { usePlaceNames } from "../../components/blocks";
import { useInstallation } from "../../App";
import { useNow, useRefusalToast, useRole, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs } from "../../components/v2/Shell";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { TabPanel, Tabs } from "../../components/v2/Tabs";
import { ago, plural, TIME_ZONE, ZONE_LABEL } from "../../format";
import { DAYS, useRecentFindings, useSandboxFindings } from "./recent";
import { pollRun } from "../events/poll";
import { useInvestigationStatus } from "../events/investigate";
import { ClearSimulated, Note } from "../events/listParts";
import { FindingsSkeleton, GroupView, WaitingPanel, type RowContext } from "./parts";
import {
  bySource, isSourceFilter, isTab, landed, makeGroups, onItsWay, SOURCE_OPTIONS, tabCounts, TAB_LABEL, type SourceFilter, type Tab,
} from "./words";
import "../../styles/v2/findings.css";

const CRUMBS = [{ label: "What it found" }, { label: "Findings" }];
const LIST_LIMIT = 200;
const ASK_EVERY = 3_000;

export function FindingsPage() {
  useCrumbs(CRUMBS);
  const toast = useToast(), refuse = useRefusalToast();
  const { role } = useRole();
  const admin = role === "platform_admin";
  const inst = useInstallation();
  const now = useNow(15_000);
  const { hash } = useLocation();
  const live = useRecentFindings();
  const sandbox = useSandboxFindings();
  const { status, reload: reloadStatus } = useInvestigationStatus();
  const [tab, setTab] = useState<Tab>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [sim, setSim] = useState(false);             // findings made by tests stay out of the live picture unless asked for
  const [more, setMore] = useState<Record<string, boolean>>({});  // groups opened to show every finding
  const [checking, setChecking] = useState<string | null>(null);
  const [seen] = useState(() => peek(() => investigationApi.events(LIST_LIMIT)));  // seen before: shown at once, refreshed below (F4)
  const [events, setEvents] = useState<Record<string, EventRow>>(() => Object.fromEntries((seen ?? []).map(e => [e.event_id, e])));
  const [eventsReady, setEventsReady] = useState(seen !== undefined);          // the group names wait for the events (or their failure)
  const [monitorNames, setMonitorNames] = useState<Record<string, string>>(() => Object.fromEntries((peek(() => monitorsApi.list()) ?? []).map(m => [m.monitor_id, m.name])));
  const [seriesNames, setSeriesNames] = useState<Record<string, string>>(() => Object.fromEntries((peek(() => seriesApi.list()) ?? []).map(s => [s.series_id, s.name])));
  const sourceId = useId();

  const { items, err, loadedAt } = live;
  const refresh = useCallback(() => { live.load(); sandbox.load(); reloadStatus(); }, [live.load, sandbox.load, reloadStatus]);  // eslint-disable-line react-hooks/exhaustive-deps
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    investigationApi.events(LIST_LIMIT).then(xs => setEvents(Object.fromEntries(xs.map(e => [e.event_id, e])))).catch(() => {}).finally(() => setEventsReady(true));
  }, [items]);
  useEffect(() => {  // names for "Monitor · Texas power prices"; without them the row says just "Monitor"
    monitorsApi.list().then(xs => setMonitorNames(Object.fromEntries(xs.map(m => [m.monitor_id, m.name])))).catch(() => {});
    seriesApi.list().then(xs => setSeriesNames(Object.fromEntries(xs.map(s => [s.series_id, s.name])))).catch(() => {});
  }, []);

  // ---- what is listed
  const nSim = sandbox.items.length;
  const all = useMemo(() => bySource([...(items ?? []), ...(sim ? sandbox.items : [])], source), [items, sandbox.items, sim, source]);
  const counts = useMemo(() => tabCounts(all), [all]);
  const groups = useMemo(() => makeGroups(all, tab, id => events[id]?.tone), [all, tab, events]);

  const tabs = (["all", "waiting", "investigating", "event", "noimpact", "failed"] as const)
    .filter(t => t !== "failed" || counts.failed > 0 || tab === "failed")
    .map(t => ({ id: t, label: TAB_LABEL[t], count: items ? counts[t] : undefined, ...(t === "failed" ? { countTone: "unusual" as const } : {}), countLabel: "findings" }));

  // ---- opening on one finding (from the Overview): in its group, even if the group was folded or filtered out
  const target = useMemo(() => { try { return decodeURIComponent(hash.slice(1)); } catch { return ""; } }, [hash]);
  const targetGroup = useMemo(() => groups.find(g => g.items.some(f => `f-${f.finding_id}` === target))?.key, [groups, target]);
  const scrolled = useRef("");
  useEffect(() => {
    if (!items || !eventsReady || !target.startsWith("f-")) return;
    const id = target.slice(2);
    if (targetGroup) {
      if (scrolled.current === target) return;
      scrolled.current = target;
      setMore(m => (m[targetGroup] ? m : { ...m, [targetGroup]: true }));
      requestAnimationFrame(() => document.getElementById(target)?.scrollIntoView({ block: "center" }));
      return;
    }
    // not on screen: it is in a tab or a source that is filtered out, or one of the test findings
    if (items.some(f => f.finding_id === id) || sandbox.items.some(f => f.finding_id === id)) {
      if (!items.some(f => f.finding_id === id)) setSim(true);
      setTab("all"); setSource("all");
    }
  }, [items, sandbox.items, eventsReady, target, targetGroup]);

  // ---- findings on their way: ask about each every 3 s until one lands, then reload (the rest keep waiting)
  const way = useMemo(() => onItsWay(items ?? []), [items]);
  const wayKey = way.join(",");
  useEffect(() => {
    if (!wayKey) return;
    const ids = wayKey.split(",");
    let alive = true;
    pollRun({
      wait: ms => new Promise(r => setTimeout(r, ms)),
      cancelled: () => !alive,
      every: ASK_EVERY,
      stillRunning: async () => !(await Promise.all(ids.map(id => investigationApi.finding(id)))).some(f => landed(f.status)),
    }).then(end => { if (alive && end === "done") refreshRef.current(); });
    return () => { alive = false; };
  }, [wayKey]);

  const check = async (f: FindingRow) => {
    if (!f.run_id) return;
    setChecking(f.finding_id);
    try {
      const r = await investigationApi.collect(f.run_id);
      toast(r.status === "running" ? "Still working; it will appear here." : "The investigation has finished.");
      refresh();
    } catch (e) { refuse(e); }
    finally { setChecking(null); }
  };

  const names = usePlaceNames(useMemo(() => [...new Set(all.flatMap(f => f.places))], [all]));
  const ctx: RowContext = {
    sourceName: f => (f.source === "monitor" ? monitorNames[f.source_ref?.monitor_id ?? ""] : f.source === "timeseries" ? (() => { const n = seriesNames[f.source_ref?.series_id ?? ""]; return n ? seriesName(n) : null; })() : null) ?? null,
    placeName: names, now, timeZone: TIME_ZONE, targetId: target, checking, onCheck: check,
  };

  const loading = items === null || !eventsReady;
  const waitMinutes = status?.wait_minutes ?? null;
  const lede = items === null ? null : !items.length ? `Nothing found in the last ${DAYS} days.`
    : `Everything the monitors, prices and Radar picked up${inst?.name ? ` for ${inst.name}` : ""} · last ${DAYS} days`;
  const hasSim = admin && sim && nSim > 0;
  const filtered = tab !== "all" || source !== "all";
  const reset = () => { setTab("all"); setSource("all"); };

  return (
    <div className="v2-fd">
      {err != null && items !== null && loadedAt != null && <StaleBanner loadedAt={loadedAt.getTime()} now={now.getTime()} onRetry={refresh} />}

      <header className="v2-fd-head">
        <div className="v2-fd-head__t">
          <h1 className="v2-fd-h1">Findings</h1>
          {lede && <p className="v2-fd-lede">{lede}</p>}
        </div>
        <div className="v2-fd-head__act">
          {status && status.findings_waiting > 0 && <WaitingPanel status={status} now={now} onDone={refresh} />}
          <div className="v2-fd-fresh">
            {loadedAt != null && <span className="v2-meta">Updated {ago(loadedAt.toISOString(), now)}</span>}
            <Button size="sm" variant="quiet" onClick={refresh}><Icon name="refresh" />Refresh</Button>
          </div>
        </div>
      </header>

      {items === null && err != null && <LoadError error={err} onRetry={refresh} what="the findings" />}

      {(admin ? status?.notes ?? [] : []).map(n => status!.connected ? <p key={n} className="v2-meta">{n}</p> : <Note key={n} tone="warn">{n}</Note>)}
      {!admin && status && !status.connected && <Note tone="warn">New findings can't be investigated right now. Your Platform Admin has been told.</Note>}

      {(items !== null || err == null) && (
        <Tabs label="Status" tabs={tabs} value={tab} onChange={id => isTab(id) && setTab(id)} className="v2-fd-tabs"
          trailing={<div className="v2-fd-tools">
            <label className="v2-fd-source" htmlFor={sourceId}>Source
              <Select inline id={sourceId} value={source} onChange={e => isSourceFilter(e.target.value) && setSource(e.target.value)}>
                {SOURCE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
              </Select></label></div>}>
          <TabPanel id={tab}>
            {nSim > 0 && (
              <div className="v2-fd-sim">
                <Checkbox checked={sim} onChange={e => setSim(e.target.checked)} label={`Also show ${plural(nSim, "test finding")} (from tests; not real)`} />
                {hasSim && <ClearSimulated onDone={refresh} />}
              </div>)}
            {loading ? (err == null && <FindingsSkeleton />)
              : !groups.length ? <EmptyList tab={tab} none={!items!.length} filtered={filtered} onReset={reset} />
              : <>
                <div className="v2-fd-groups">
                  {groups.map(g => (
                    <GroupView key={g.key} g={g} event={g.eventId ? events[g.eventId] : undefined} waitMinutes={waitMinutes} c={ctx}
                      expanded={more[g.key] ?? false} onToggle={() => setMore(m => ({ ...m, [g.key]: !m[g.key] }))} />))}
                </div>
                {(items?.length ?? 0) >= LIST_LIMIT && <p className="v2-meta v2-fd-cap">Showing the newest {LIST_LIMIT} findings.</p>}
                <p className="v2-meta v2-fd-foot">
                  A finding is something a monitor, a market price or Radar noticed. The investigation links it to an event, or finds no impact on your products.
                  Times are in {ZONE_LABEL}.
                </p>
              </>}
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}

function EmptyList({ tab, none, filtered, onReset }: { tab: Tab; none: boolean; filtered: boolean; onReset: () => void }) {
  if (none && !filtered) {
    return (
      <Empty title="No findings yet" action={<Button as="link" to="/monitors">See your monitors</Button>}>
        When a monitor, a market price or Radar notices something, it appears here.
      </Empty>);
  }
  return (
    <Empty title={tab === "all" ? "Nothing from this source" : `Nothing under "${TAB_LABEL[tab]}"`}
      action={filtered ? <Button onClick={onReset}>Show every finding</Button> : undefined}>
      {tab === "failed" ? "Every finding was investigated." : "Choose another tab or source above."}
    </Empty>
  );
}
