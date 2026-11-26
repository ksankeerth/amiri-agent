// A simulation as it runs (board 10; states: board 15 B): the title, the day and the controls, what AMIRI Agent has done so far
// (four tiles), the stories the scenario expected beside what was found, the alerts it would raise, the price and the timeline.
// Nothing here is saved or sent: the run is in the Studio's own world. The page drives the run: Next day and Play ask the server
// to step (POST :step), again and again while agents work, until the day moves (or, for Play, the run ends). A run that nobody
// is driving is looked at every few seconds, so a stop or an agent answering elsewhere shows. Stop, Run again and Replay are
// open under the demo lock: the server guards only a scenario's edit and delete (server/app/studio/api.py).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { studioApi, type Mode, type Scenario, type Simulation, type TimelineItem } from "../../api/studio";
import { useNow, useRefusalToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs, type Crumb } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { eventTitle } from "../../plain";
import { AlertsRaised, EndPanel, ExpectedFound, PricePanel, RunHead, RunSkeleton, RunTiles, StopDialog, Timeline } from "./runParts";
import {
  driveDelay, driveDone, driveNext, drivePlay, foundCount, isActive, liveText, priceName, REFRESH_MS, storyRows, workingText, type Drive,
} from "./runWords";
import { StartDialog } from "./parts";
import "../../styles/v2/studio-run.css";

const CRUMBS: Crumb[] = [{ label: "Try it" }, { label: "Scenario Studio", to: "/studio" }];

export function StudioRunPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const refuse = useRefusalToast();
  const now = useNow(30_000);
  const [sim, setSim] = useState<Simulation | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [drive, setDrive] = useState<Drive | null>(null);
  const [stopping, setStopping] = useState(false);       // the "Stop this run?" box
  const [stopBusy, setStopBusy] = useState(false);
  const [confirm, setConfirm] = useState<Mode | null>(null);  // "Start a new run?": a start clears this one
  const [starting, setStarting] = useState(false);
  const [loadErr, setLoadErr] = useState<unknown>(null);  // the first load: nothing to show without it
  const [pollErr, setPollErr] = useState<unknown>(null);  // a later look failed: what is on screen is kept
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);                  // a finished ask wakes the carry-on loop even when nothing on screen changed
  const [steps, setSteps] = useState(false);              // the agents' own steps in the timeline
  const [moment, setMoment] = useState<Simulation["alerts"][number] | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const seen = useRef<Set<string> | null>(null);  // alerts already on screen: only a new one gets the line

  const take = useCallback((s: Simulation) => {
    setSim(s); setLoadedAt(Date.now()); setPollErr(null);
    const keys = s.alerts.map(a => `${a.event_id}|${a.owner}`);
    if (seen.current === null) seen.current = new Set(keys);
    else {
      const fresh = s.alerts.find(a => !seen.current!.has(`${a.event_id}|${a.owner}`));
      keys.forEach(k => seen.current!.add(k));
      if (fresh) setMoment(fresh);
    }
    const fresh = s.timeline.filter(x => x.seq > seq.current);  // decided now, not when React applies the update
    if (fresh.length) {
      seq.current = Math.max(...fresh.map(x => x.seq));
      setTimeline(t => [...t, ...fresh]);
    }
  }, []);
  const first = useCallback(() => studioApi.get(id).then(s => { take(s); setLoadErr(null); }).catch(setLoadErr), [id, take]);
  useEffect(() => {
    seq.current = 0; seen.current = null; busy.current = false;
    setSim(null); setTimeline([]); setScenario(null); setDrive(null); setMoment(null); setLoadErr(null); setPollErr(null); setLoadedAt(null);
    first();
  }, [first]);

  // one more look at the run (quietly: what is on screen stays if it fails)
  const look = useCallback(() => studioApi.get(id, seq.current).then(take).catch(setPollErr), [id, take]);

  // the scenario: its headline plan ("its headline comes on day 6") and whether a recording can be replayed
  const ended = sim ? !isActive(sim.status) : false;
  const scenarioId = sim?.scenario_id;
  useEffect(() => {
    if (!scenarioId) return;
    let off = false;
    studioApi.scenario(scenarioId).then(x => { if (!off) setScenario(x); }).catch(() => {});
    return () => { off = true; };
  }, [scenarioId, ended]);

  // one ask: run what is due. A busy or moved answer is not a failure: look again and carry on.
  const step = useCallback(async () => {
    if (!sim || busy.current || !isActive(sim.status)) return;
    busy.current = true;
    try { take(await studioApi.step(id, sim.step)); }
    catch (e) {
      if (e instanceof ApiError && ["busy", "step_moved", "not_running"].includes(e.code)) { await look(); }
      else { setDrive(null); refuse(e, "Couldn't run the day"); }
    } finally { busy.current = false; setTick(t => t + 1); }
  }, [id, sim, take, look, refuse]);

  // carrying on by itself: ask, wait (longer while agents work), ask again, until the clock gets where it was asked to
  useEffect(() => {
    if (!drive || !sim) return;
    if (driveDone(drive, sim)) { setDrive(null); return; }
    const t = setTimeout(step, driveDelay(sim.status));
    return () => clearTimeout(t);
  }, [drive, sim, step, tick]);
  // nobody driving: look every few seconds while the run is going (and when the tab is looked at again)
  const going = !!sim && isActive(sim.status);
  useEffect(() => {
    if (!going || drive) return;
    const f = () => { if (document.visibilityState === "visible" && !busy.current) look(); };
    const t = setInterval(f, REFRESH_MS);
    document.addEventListener("visibilitychange", f);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", f); };
  }, [going, drive, look]);

  const stop = async () => {
    setStopBusy(true); setDrive(null);
    try { take(await studioApi.stop(id)); setStopping(false); }
    catch (e) { setStopping(false); refuse(e, "Couldn't stop the run"); }
    finally { setStopBusy(false); }
  };
  const go = async (mode: Mode) => {
    if (!sim) return;
    setConfirm(null); setStarting(true);
    try { const n = await studioApi.start(sim.scenario_id, mode); nav(`/studio/run/${n.sim_id}`); }
    catch (e) { refuse(e); }
    finally { setStarting(false); }
  };

  const evName = useMemo(() => {
    const by = new Map((sim?.events ?? []).map(e => [e.event_id, e]));
    return (event_id: string, title: string) => eventTitle({ title, themes: by.get(event_id)?.themes });
  }, [sim?.events]);
  useCrumbs(useMemo<Crumb[]>(() => [...CRUMBS, ...(sim ? [{ label: sim.title, to: `/studio/${sim.scenario_id}` }] : []), { label: "This run" }], [sim?.title, sim?.scenario_id]));  // eslint-disable-line react-hooks/exhaustive-deps

  if (!sim) {
    return (
      <div className="v2-run">
        <h1 className="v2-sr">Scenario run</h1>
        {loadErr != null
          ? <><LoadError error={loadErr} onRetry={first} what="this run" safe="Your scenarios are safe; this page just couldn't reach the run." />
            <p><Button as="link" to="/studio" variant="quiet">Back to the Scenario Studio</Button></p></>
          : <><RunSkeleton /><Skeleton rows={5} label="Loading the run" /></>}
      </div>);
  }

  const active = isActive(sim.status);
  const planned = scenario ? scenario.built.headlines.length : null;
  const rows = storyRows(sim.summary, active, sim.step, scenario?.built.headlines ?? null, evName);
  const flagged = timeline.filter(t => t.kind === "price" && t.data.fires).map(t => t.at);
  const name = priceName(sim.symbol, (scenario?.built.prices as { name?: string } | undefined)?.name);
  const c = foundCount(rows);
  const working = workingText(sim.pending, timeline);

  return (
    <div className="v2-run">
      {pollErr != null && loadedAt != null && <StaleBanner loadedAt={loadedAt} now={now.getTime()} onRetry={look} />}
      <div className="v2-sr" aria-live="polite" aria-atomic="true">{liveText(sim, c.found, c.expected)}</div>
      <RunHead sim={sim} timeline={timeline} working={working} driving={!!drive} playing={drive?.until === Infinity}
        onNext={() => setDrive(driveNext(sim.step))} onPlay={() => setDrive(d => (d?.until === Infinity ? null : drivePlay()))} onStop={() => setStopping(true)} />
      {!active && <EndPanel sim={sim} scenario={scenario} rows={rows} busy={starting} onStart={m => setConfirm(m)} />}
      {moment && (
        <div className="v2-run-moment" role="status">
          <span><b>New alert · {moment.owner}</b></span><span className="v2-run-moment__t">{moment.title}</span>
          <Button size="sm" variant="quiet" onClick={() => setMoment(null)}>Close</Button>
        </div>)}
      <RunTiles sim={sim} timeline={timeline} planned={planned} />
      <div className="v2-run-cols">
        <div className="v2-run-main">
          <ExpectedFound rows={rows} findings={sim.summary.findings} active={active} />
          <AlertsRaised alerts={sim.alerts} evName={evName} active={active} />
          <PricePanel title={name} bars={sim.bars} flagged={flagged} step={sim.step} />
        </div>
        <Timeline timeline={timeline} tz={sim.institution.time_zone} more={steps} onMore={setSteps} />
      </div>
      {stopping && <StopDialog busy={stopBusy} onCancel={() => setStopping(false)} onGo={stop} />}
      {confirm && <StartDialog clears={sim.title} onCancel={() => setConfirm(null)} onGo={() => go(confirm)} />}
    </div>
  );
}
