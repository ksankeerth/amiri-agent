// Monitors (board 06; states: board 16 section G, board 13 sections 3 and 6): the questions Amiri Agent asks the web for you, as a
// list grouped by what each needs, and the open one beside it. /monitors opens the busiest live monitor; /monitors/:id opens
// that one; /monitors/new is the form. On a phone the list is the page and a monitor opens as its own view with a back link.
//
// Asking, and how often (the server asks the monitor agent about a running check, so nothing is asked about unless this viewer
// pressed Check now; MonitorPage.tsx does that):
//   passive: the list and the service's status every 60 s, and not while the tab is hidden.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useInstallation } from "../../App";
import { inst, type Profile } from "../../api/institutions";
import { investigationApi } from "../../api/investigation";
import { monitorsApi, type MonitorRow, type MonitorsStatus } from "../../api/monitors";
import { useDemoLock } from "../../components/lock";
import { useNow, useRole } from "../../components/ui";
import { AgentState } from "../../components/v2/AgentState";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs, usePhone } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { eventTitle } from "../../plain";
import { nextAt } from "../radar/words";
import { DraftFromProfile } from "./draft";
import { MonitorList } from "./list";
import { MonitorPane } from "./MonitorPage";
import { groupMonitors, pickDefault } from "./words";
import "../../styles/v2/monitors.css";

export { DraftFromProfile } from "./draft";

const REFRESH_MS = 60_000;      // passive: no faster than every 30 s
const NEXT: { label: string; to?: string }[] = [{ label: "What it watches" }];

export function MonitorsPage() {
  const { id } = useParams();
  const isNew = id === "new";
  const phone = usePhone();
  const now = useNow(30_000);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const locked = useDemoLock();
  const installation = useInstallation();
  const iid = installation?.profile ? installation.institution_id : null;

  const [items, setItems] = useState<MonitorRow[] | null>(null);
  const [status, setStatus] = useState<MonitorsStatus | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [drafting, setDrafting] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const [retiredOpen, setRetiredOpen] = useState(false);
  const alive = useRef(true);
  const seq = useRef(0);
  const loaded = useRef(0);
  const askedTitles = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // ---------------------------------------------------------------- loading
  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [xs, st] = await Promise.all([monitorsApi.list(), monitorsApi.status().catch(() => null)]);
      if (!alive.current || mine !== seq.current) return;
      setItems(xs); if (st) setStatus(st); setErr(null); setLoadedAt(Date.now()); loaded.current = Date.now();
    } catch (e) { if (alive.current && mine === seq.current) setErr(e); }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    const vis = () => { if (!document.hidden && Date.now() - loaded.current > 30_000) load(); };   // back on the tab: catch up, but not in a burst
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  useEffect(() => {
    if (!iid) return;
    let live = true;
    inst.profile(iid).then(p => { if (live) setProfile(p); }).catch(() => {});
    return () => { live = false; };
  }, [iid]);
  /** The event names the findings link to, asked for once a few minutes at most (and only when a finding joined an event). */
  const askTitles = useCallback(() => {
    if (Date.now() - askedTitles.current < 300_000) return;
    askedTitles.current = Date.now();
    investigationApi.events(200).then(es => { if (alive.current) setTitles(Object.fromEntries(es.map(e => [e.event_id, eventTitle(e)]))); }).catch(() => { askedTitles.current = 0; });
  }, []);

  // ---------------------------------------------------------------- what is shown
  const groups = useMemo(() => groupMonitors(items ?? []), [items]);
  const empty = items !== null && !items.length;
  // the address names none: the busiest live monitor opens, and stays open when the list is reordered (it may be being edited)
  const [pinned, setPinned] = useState<string | null>(null);
  const best = !isNew && !id && !phone ? pickDefault(groups) : null;
  const fallbackId = pinned && items?.some(x => x.monitor_id === pinned) ? pinned : best?.monitor_id ?? null;
  useEffect(() => { if (fallbackId && fallbackId !== pinned && !id) setPinned(fallbackId); }, [fallbackId, pinned, id]);
  const openId = isNew ? "new" : id ?? fallbackId;
  const listed = openId && openId !== "new" ? items?.find(x => x.monitor_id === openId) ?? null : null;
  const reading = phone && !!id;
  const nLive = status?.live ?? (items ?? []).filter(m => m.status === "live").length;
  const nWaiting = groups.waiting.length;
  const stale = err != null && items !== null && loadedAt != null;

  useCrumbs(id ? [...NEXT, { label: "Monitors", to: "/monitors" }, { label: isNew ? "New monitor" : listed?.name ?? "Monitor" }] : [...NEXT, { label: "Monitors" }]);

  // a choice moves focus to the monitor's heading (the shell's own move to the page comes first, at 250 ms)
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (!id) return;
    const t = setTimeout(() => document.getElementById("mn-title")?.focus({ preventScroll: false }), 400);
    return () => clearTimeout(t);
  }, [id]);

  const lede = status
    ? <>Questions Amiri Agent asks the web for you · <b>{nLive} live</b> of {status.live_max}{nWaiting > 0 && <> · {nWaiting} waiting for your approval</>}
        {status.next_check_at && status.connected && <> · next check {nextAt(status.next_check_at, now)}</>}</>
    : "Questions Amiri Agent asks the web for you";

  const head = (
    <header className={`v2-mn-head${reading ? " v2-sr" : ""}`}>
      <div className="v2-mn-head__t">
        <h1 className="v2-mn-h1">Monitors</h1>
        <p className="v2-mn-lede">{lede}</p>
      </div>
      {!empty && (
        <div className="v2-mn-head__btns">
          <Button locked={locked} onClick={() => setDrafting(true)}>Draft from your profile</Button>
          <Button as="link" to="/monitors/new" variant="primary" locked={locked}>New monitor</Button>
        </div>)}
    </header>
  );

  const pane = openId && (
    <MonitorPane key={openId} id={openId} status={status} profile={profile} eventTitles={titles} askEventTitles={askTitles} onChanged={load} onDraft={() => setDrafting(true)} listStale={stale} />
  );
  const back = (
    <Link to="/monitors" className="v2-mn-back"><span aria-hidden="true">←</span>All monitors</Link>
  );

  return (
    <div className="v2-mn">
      {stale && <StaleBanner loadedAt={loadedAt!} now={now.getTime()} onRetry={load} />}
      {head}

      {status && !reading && !status.connected && (
        <AgentState kind="offline" tone={empty ? "idle" : "warn"} title="Monitors can't check the news right now.">
          Lists and findings still work{!empty && "; checks start again once the monitor agent is back"}.{!admin && " Your Platform Admin has been told."}
        </AgentState>)}
      {status && !reading && admin && status.notes.length > 0 && <div className="v2-mn-notes">{status.notes.map(n => <p key={n} className="v2-meta">{n}</p>)}</div>}

      {items === null && err != null && <LoadError error={err} onRetry={load} what="the monitors" safe="Your monitors are safe; this page just couldn't reach them." />}
      {items === null && err == null && (
        <div className="v2-mn-body">
          {!phone && <div className="v2-mn-col"><Skeleton rows={6} label="Loading the monitors" /></div>}
          <div className="v2-mn-pane-wrap"><div className="v2-panel v2-mn-pane"><Skeleton rows={5} label="Loading the monitor" /></div></div>
        </div>)}

      {items !== null && empty && !isNew && (
        <Empty title="No monitors yet" className="v2-mn-empty" action={<>
          <Button as="link" to="/monitors/new" variant="primary" locked={locked}>New monitor</Button>
          <Button locked={locked} onClick={() => setDrafting(true)}>Draft from your profile</Button></>}>
          A monitor watches the news for something you care about: a rival's prices, a regulator's rules, jobs in a remittance corridor.
          {status && !status.connected && " News checks are paused right now; a monitor you add starts once they are back."}
        </Empty>)}

      {items !== null && (reading ? (
        <div className="v2-mn-read">{back}{pane}</div>
      ) : isNew && empty ? (
        <div className="v2-mn-read">{back}{pane}</div>
      ) : !empty && (
        <div className="v2-mn-body">
          {(!phone || !id) && (
            <div className="v2-mn-col">
              <MonitorList groups={groups} selectedId={phone ? null : openId} now={now} liveOpen={liveOpen} onLiveOpen={() => setLiveOpen(true)}
                retiredOpen={retiredOpen} onRetiredToggle={() => setRetiredOpen(o => !o)} />
            </div>)}
          {!phone && pane && <div className="v2-mn-pane-wrap">{pane}</div>}
        </div>))}

      <p className="v2-meta v2-mn-note">Monitors watch the news. Price and rate moves are watched by <Link to="/series">market series</Link>, without a monitor.</p>
      {drafting && <DraftFromProfile onClose={() => setDrafting(false)} />}
    </div>
  );
}
