// Alerts (board 01; states: board 16 section D): what AMIRI Agent found for each team's products, as a list and a reading
// pane. New / Acknowledged / Resolved tabs, a team and a level filter, one Acknowledge button for every alert to review.
// The tab, filters and open alert live in the address (?tab=&team=&level=&alert=), so a link opens the right alert. On a
// phone the list is the page and an alert opens as its own view with a back link. Reloads every minute.
import { Select } from "../components/v2/Field";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { alertsApi, type AlertItem, type AlertSummary } from "../api/alerts";
import { peek } from "../api/client";
import { investigationApi, type EventDetail } from "../api/investigation";
import { useNow, useRefusalToast, useToast } from "../components/ui";
import { ListPane, MoreRows, PaneBack, PaneView, usePaged } from "../components/v2/ListPane";
import { LoadError } from "../components/v2/LoadError";
import { useCrumbs } from "../components/v2/Shell";
import { StaleBanner } from "../components/v2/StaleBanner";
import { TabPanel, Tabs } from "../components/v2/Tabs";
import { alertOrder, eventTitle } from "../plain";
import { AlertList, AlertsSkeleton, Article, changedAt, EmptyList, FilterFold, LevelsHelp, ManyStrip } from "./alerts/parts";
import {
  countAt, filterState, LEVELS, LIST_LIMIT, ledeText, limitNote, MANY, neighbour, parseLevel, parseTab, pickAlert, TABS, type LevelKey, type Tab,
} from "./alerts/words";
import { usePolling } from "../components/usePolling";
import "../styles/v2/alerts.css";

const REFRESH_MS = 60_000;
const CRUMBS = [{ label: "Today" }, { label: "Alerts" }];
const PHONE = "(max-width: 719.98px)";

function usePhone(): boolean {
  const [phone, setPhone] = useState(() => matchMedia(PHONE).matches);
  useEffect(() => {
    const m = matchMedia(PHONE), f = () => setPhone(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return phone;
}

/** The event behind the open alert: its tasks know the next check and the figure, and its findings have the article links. */
function useEvent(eventId: string | undefined, stamp: string | undefined): EventDetail | null {
  const [ev, setEv] = useState<EventDetail | null>(() => (eventId ? peek(() => investigationApi.event(eventId)) ?? null : null));
  useEffect(() => {
    if (!eventId) { setEv(null); return; }
    let live = true;
    investigationApi.event(eventId).then(e => { if (live) setEv(e); }).catch(() => { if (live) setEv(null); });  // the pane reads without it
    return () => { live = false; };
  }, [eventId, stamp]);
  return ev && ev.event_id === eventId ? ev : null;
}

/** Event names as the Events pages show them: the alert carries only the stored title, the list has the themes. */
function useEventTitles(): (a: AlertItem) => string {
  const [names, setNames] = useState<Map<string, string>>(() => new Map((peek(() => investigationApi.events(200)) ?? []).map(r => [r.event_id, eventTitle(r)])));
  useEffect(() => {
    let live = true;
    investigationApi.events(200).then(rows => { if (live) setNames(new Map(rows.map(r => [r.event_id, eventTitle(r)]))); })
      .catch(() => {});  // the stored title is the fallback
    return () => { live = false; };
  }, []);
  return useCallback((a: AlertItem) => names.get(a.event_id) ?? a.event_title, [names]);
}

const listFor = (status: string, owner: string, level: string) => alertsApi.list({ status, owner: owner || undefined, level: level || undefined, limit: LIST_LIMIT });

export function AlertsPage() {
  useCrumbs(CRUMBS);
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const loc = useLocation();
  const phone = usePhone();
  const now = useNow(60_000);
  const toast = useToast(), refuse = useRefusalToast();
  const teamId = useId(), levelId = useId();
  const [filtersOpen, setFiltersOpen] = useState(false);       // phone: the filters fold behind one button

  const tab = parseTab(sp.get("tab")), team = sp.get("team") ?? "", level = parseLevel(sp.get("level")), alertId = sp.get("alert");
  // seen before: the last list and counts show at once and are refreshed below (F4)
  const [items, setItems] = useState<AlertItem[] | null>(() => peek(() => listFor(tab, team, level)) ?? null);
  const [sum, setSum] = useState<AlertSummary | null>(() => peek(() => alertsApi.summary()) ?? null);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const seq = useRef(0);
  const pushed = useRef(0);                               // alerts opened with a new history entry (phone), so Back can undo them
  const focusNext = useRef<"article" | "list" | null>(null);
  const lastOpened = useRef<string | null>(null);

  /** Change the address. Filters and selections replace the entry; opening an alert on a phone adds one (the phone's Back). */
  const setParams = useCallback((patch: Record<string, string | null>, push = false) => {
    setSp(prev => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
      return n;
    }, { replace: !push });
  }, [setSp]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      // one status at a time (the newest 200); the tab counts come from the summary, which counts them all
      const [s, xs] = await Promise.all([alertsApi.summary(), listFor(tab, team, level)]);
      if (mine !== seq.current) return;
      setSum(s); setItems(xs); setErr(null); setLoadedAt(Date.now());
    } catch (e) { if (mine === seq.current) setErr(e); }
  }, [tab, team, level]);
  useEffect(() => { setItems(peek(() => listFor(tab, team, level)) ?? null); }, [tab, team, level]);  // another filter: its own last list if seen, else wait for it rather than show the old one
  useEffect(() => { load(); }, [load]);
  usePolling(load, REFRESH_MS);  // every minute, not while the tab is hidden

  // the list as shown: an alert acted on leaves a tab it no longer belongs to at once, before the next load; most serious first
  const queue = useMemo(() => (items ?? []).filter(a => a.status === tab).sort((x, y) => alertOrder({ ...x, at: changedAt(x) }, { ...y, at: changedAt(y) })), [items, tab]);
  const selected = pickAlert(queue, alertId, phone);
  const paged = usePaged<AlertItem, HTMLUListElement>(queue, `${tab}|${team}|${level}`, selected ? queue.findIndex(a => a.alert_id === selected.alert_id) : -1, "li");
  const ev = useEvent(selected?.event_id, selected?.updated_at);
  const titleOf = useEventTitles();
  useEffect(() => { setNote(""); }, [selected?.alert_id]);

  // a link to an alert (?alert=) with no tab: open the tab it is in. An old #event-<id> link opens that event's first alert.
  useEffect(() => {
    if (!items || !alertId || sp.has("tab") || items.some(a => a.alert_id === alertId)) return;
    alertsApi.one(alertId).then(a => setParams({ tab: a.status === "new" ? null : a.status })).catch(() => {});
  }, [items, alertId, sp, setParams]);
  useEffect(() => {
    const m = loc.hash.match(/^#event-(.+)$/);
    const hit = m && !alertId && queue.find(a => a.event_id === m[1]);
    if (hit) setParams({ alert: hit.alert_id });
  }, [loc.hash, queue, alertId, setParams]);

  // focus follows a choice: to the alert's heading when one opens, to the list (or the row left) when one closes
  useEffect(() => {
    if (focusNext.current === "article") document.getElementById("alert-title")?.focus({ preventScroll: false });
    else if (focusNext.current === "list") (document.getElementById(lastOpened.current ? `al-row-${lastOpened.current}` : "al-list-h") ?? document.getElementById("al-list-h"))?.focus();
    else return;
    focusNext.current = null;
  });
  useEffect(() => {  // the phone's own Back button closed the alert
    if (phone && !alertId && lastOpened.current && pushed.current > 0) { focusNext.current = "list"; pushed.current -= 1; }
  }, [phone, alertId]);

  const hrefFor = (id: string) => { const n = new URLSearchParams(sp); n.set("alert", id); return `?${n}`; };
  const open = (id: string) => { focusNext.current = "article"; lastOpened.current = id; if (phone) pushed.current += 1; setParams({ alert: id }, phone); };
  const back = () => {
    focusNext.current = "list";
    if (pushed.current > 0) { pushed.current -= 1; nav(-1); } else setParams({ alert: null });
  };
  const setFilter = (patch: Record<string, string | null>) => setParams({ ...patch, alert: null });

  const refreshSummary = () => { alertsApi.summary().then(setSum).catch(() => {}); window.dispatchEvent(new Event("amiri:alerts")); };
  const act = async (a: AlertItem, action: "ack" | "resolve" | "reopen") => {
    setBusy(true);
    try {
      const done = await alertsApi.act(a.alert_id, action, action === "reopen" ? undefined : note);
      const after = neighbour(queue, a.alert_id);
      setItems(xs => (xs ?? []).map(x => (x.alert_id === done.alert_id ? done : x)));
      setNote("");
      refreshSummary();
      if (done.status !== tab) {  // it left this tab: the next one down opens (on a phone, back to the list)
        lastOpened.current = null;
        if (phone) { focusNext.current = "list"; pushed.current = 0; setParams({ alert: null }); }
        else { focusNext.current = after ? "article" : "list"; setParams({ alert: after?.alert_id ?? null }); }
      }
      const n = (countAt(sum?.by_team_status, done.status as Tab, team) ?? 0) + 1;
      if (action === "ack") toast(`Acknowledged · moved to Acknowledged (${n})`, { label: "Undo", title: "Moves it back to New", onClick: () => undo(done) });
      else if (action === "resolve") toast(`Resolved · moved to Resolved (${n})`);
      else toast("Back in New");
    } catch (e) { refuse(e); }
    finally { setBusy(false); }
  };
  const undo = async (a: AlertItem) => {
    try {
      await alertsApi.act(a.alert_id, "reopen");
      toast("Back in New");
      focusNext.current = "article"; lastOpened.current = a.alert_id;
      setParams({ tab: null, alert: a.alert_id });
      load(); refreshSummary();
    } catch (e) { refuse(e); }
  };

  // ---------------------------------------------------------------- what the page says
  const toReview = !sum ? null : team ? sum.teams.find(t => t.owner === team)?.to_review ?? 0 : sum.to_review;
  const lede = ledeText({ toReview, acknowledgedWeek: sum ? sum.acknowledged_week : null, team });
  const byTeamStatus = sum?.by_team_status;
  const levelOn = !!level;  // the summary doesn't count by level, so a level filter leaves the other tabs' numbers out
  const tabs = TABS.map(t => ({
    id: t.id, label: t.label, countLabel: t.countLabel,
    count: levelOn ? (t.id === tab && items ? queue.length : undefined) : countAt(byTeamStatus, t.id, team),
    countTone: t.id === "new" ? ("hot" as const) : undefined,
  })).map(t => ({ ...t, countTone: t.countTone && t.count ? t.countTone : undefined }));
  const tabTotal = levelOn ? undefined : countAt(byTeamStatus, tab, team);
  const teamRows = (sum?.all_teams ?? []).map(t => ({ owner: t, n: countAt(byTeamStatus, tab, t) ?? 0 }));
  const many = !team && !levelOn && (tabTotal ?? 0) > MANY && teamRows.filter(t => t.n > 0).length > 1;
  const reading = phone && !!selected;
  const stale = err != null && items !== null && loadedAt != null;

  const fstate = filterState(team, level);
  const filters = (
    <>
      {sum && sum.all_teams.length > 1 && (
        <span className="v2-al-sel">
          <label htmlFor={teamId}>Team</label>
          <Select inline id={teamId} value={team} onChange={e => setFilter({ team: e.target.value || null })}>
            <option value="">All teams ({countAt(byTeamStatus, tab) ?? 0})</option>
            {teamRows.map(t => <option key={t.owner} value={t.owner}>{t.owner} ({t.n})</option>)}
          </Select>
        </span>
      )}
      <span className="v2-al-sel">
        <label htmlFor={levelId}>Level</label>
        <Select inline id={levelId} value={level} onChange={e => setFilter({ level: e.target.value || null })}>
          {LEVELS.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </Select>
      </span>
    </>
  );

  const list = (
    <>
      <h2 id="al-list-h" tabIndex={-1} className="v2-sr">{TABS.find(t => t.id === tab)!.label} alerts, most serious first</h2>
      <AlertList titleOf={titleOf} rows={paged.shown} selectedId={selected?.alert_id ?? null} now={now} hrefFor={hrefFor} onOpen={open} listRef={paged.listRef} />
      <MoreRows left={paged.left} onMore={paged.more} />
      {limitNote(tabTotal, queue.length) && <p className="v2-meta v2-al-limit">{limitNote(tabTotal, queue.length)}</p>}
      <LevelsHelp />
    </>
  );
  const article = selected && (
    <Article titleOf={titleOf} a={selected} ev={ev} now={now} busy={busy} note={note} onNote={setNote} onAct={action => act(selected, action)} />
  );

  return (
    <div className="v2-al">
      {stale && <StaleBanner loadedAt={loadedAt!} now={now.getTime()} onRetry={load} />}

      <header className={`v2-al-head${reading ? " v2-sr" : ""}`}>
        <h1 className="v2-al-h1">Alerts</h1>
        {lede && <p className="v2-al-lede">{lede.hot && <><b className="v2-al-lede__hot v2-num">{lede.hot}</b>{lede.rest.length > 0 && " · "}</>}{lede.rest.join(" · ")}</p>}
      </header>

      {items === null && err != null && <LoadError error={err} onRetry={load} what="the alerts" safe="Your alerts are safe; this page just couldn't reach them." />}

      {reading && selected ? (
        <PaneView back={<PaneBack to="?" onClick={e => { e.preventDefault(); back(); }}>All alerts</PaneBack>}>{article}</PaneView>
      ) : (items !== null || err == null) && (
        <Tabs label="Which alerts" tabs={tabs} value={tab} onChange={id => setFilter({ tab: id === "new" ? null : id })} className="v2-al-tabs" trailing={phone ? undefined : <div className="v2-al-filters">{filters}</div>}>
          {phone && <FilterFold label={fstate.label} summary={fstate.summary} open={filtersOpen} onToggle={() => setFiltersOpen(o => !o)}>{filters}</FilterFold>}
          <TabPanel id={tab}>
            {items === null ? <AlertsSkeleton phone={phone} /> : <>
              {many && !phone && <ManyStrip total={tabTotal!} tab={tab} teams={teamRows.filter(t => t.n > 0).sort((a, b) => b.n - a.n).slice(0, 4)} onTeam={t => setFilter({ team: t })} />}
              {!queue.length
                ? <EmptyList tab={tab} team={team} level={level as "" | LevelKey}
                    onClear={what => setFilter({ ...(what !== "level" ? { team: null } : {}), ...(what !== "team" ? { level: null } : {}) })} />
                : <ListPane list={list} pane={!phone && article} itemKey={selected?.alert_id} />}
            </>}
          </TabPanel>
        </Tabs>
      )}
    </div>
  );
}
