// A simulation as it runs (the demo screen): one control line, the chain as four figures, the price beside what the
// scenario expected and what Amiri Agent found, then the alerts, the events and what happened. Nothing animates but
// the day advancing; a new alert is one quiet line under the controls.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { studioApi, type Simulation, type TimelineItem } from "../../api/studio";
import { PriceChart, type Mark } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { Figures, GoLink, PageTitle, QuietWarn, Section, TextButton, ToneMark, TONE_WORD } from "../../components/rd";
import { LoadError, PageSkeleton, useToast } from "../../components/ui";
import { ZONE_LABEL, clockText, dayTime, plural } from "../../format";
import { cap, eventTitle, listText, themeLabel, words } from "../../plain";
import { eventsSplit, findingsSplit, howRun, storyWord, trackDays } from "./words";
import "../../styles/rd-studio.css";

const PLAY_MS = 1200;
/** What each kind of row is called. The agents' own steps (checks, investigations, joins) are shown on request. */
const KIND: Record<string, string> = {
  headline: "Headline", price: "Flagged move", finding: "Finding", check: "Monitor check",
  investigation: "Investigation", event: "Event", development: "Joined an event", note: "",
};
const STORY = new Set(["headline", "finding", "event"]);

function line(t: TimelineItem): string {
  const d = t.data;
  switch (t.kind) {
    case "headline": return `${d.title}`;
    case "price": return `Unusual move: ${t.ref} ${Math.abs(d.z).toFixed(1)}× a typical day (${d.change_pct >= 0 ? "+" : ""}${d.change_pct}% since the start)`;
    case "finding": return `${d.source === "timeseries" ? "Market series" : "Monitor"}: ${d.title}`;
    case "check": return d.status === "started" ? `Reading ${plural(d.headlines, "headline")}` : `${d.status}${d.findings ? ` · ${plural(d.findings, "finding")}` : ""}${d.error ? ` · ${d.error}` : ""}`;
    case "investigation": return d.status === "started" ? `Investigating ${plural(d.findings, "finding")}` : `${d.status}${d.error ? ` · ${d.error}` : ""}`;
    case "development": return d.reason;
    default: return d.text ?? "";
  }
}

type Alert = Simulation["alerts"][number];

/** The control line: Play (the one filled button), Step, Stop as text, the day, the date and a track of the days. */
function Controls({ sim, timeline, active, playing, setPlaying, stopping, setStopping, onStep, onStop }: {
  sim: Simulation; timeline: TimelineItem[]; active: boolean; playing: boolean; setPlaying: (f: (p: boolean) => boolean) => void;
  stopping: boolean; setStopping: (b: boolean) => void; onStep: () => void; onStop: () => void;
}) {
  const days = trackDays(sim.steps, sim.step, timeline);
  const formed = days.filter(d => d.event).map(d => d.day);
  const summary = `${sim.step} of ${sim.steps} days run${formed.length ? `; an event formed on day ${listText(formed.map(String), 30)}` : ""}`;
  return (
    <div className="rds-ctl" role="group" aria-label="Run controls">
      <div className="rds-btns">{active ? <>
        <button className="btn btn--primary btn--lg" type="button" onClick={() => setPlaying(p => !p)}><Icon name={playing ? "pause" : "play"} />{playing ? "Pause" : "Play"}</button>
        <button className="btn btn--lg" type="button" disabled={playing} onClick={onStep} title="Run one simulated day">Step</button>
        {stopping ? <span className="rds-quiet" style={{ margin: 0 }}><span>End this run for good? It can't carry on after.</span>
          <TextButton onClick={onStop}>Stop the run</TextButton><TextButton onClick={() => setStopping(false)}>Keep it</TextButton></span>
          : <TextButton onClick={() => setStopping(true)} title="End this run (Pause keeps it, Stop ends it)">Stop</TextButton>}</>
        : <span className="rds-state">{sim.status === "finished" ? "Finished" : cap(words(sim.status))}</span>}</div>
      <div className="rds-day" aria-live="polite"><b>Day {sim.step}</b><span>of {sim.steps}</span></div>
      <div className="rds-when">
        <div className="rds-date">{clockText(sim.virtual_now, sim.institution.time_zone)} <span className="rd-fine">(simulated, {ZONE_LABEL} time)</span></div>
        <div className="rds-track" role="img" aria-label={summary}>
          {days.map(d => <span key={d.day} className={`rds-seg${d.ran ? " ran" : ""}${d.event ? " ev" : ""}${d.headlines ? " hd" : ""}`}
            title={`Day ${d.day}${d.event ? ": an event formed" : ""}${d.headlines ? `${d.event ? "," : ":"} headlines` : ""}`} />)}
        </div>
        <div className="rds-key">Marked days: an event formed · dots: headlines arrived</div>
      </div>
    </div>
  );
}

export function StudioRunPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [sim, setSim] = useState<Simulation | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [playing, setPlaying] = useState(false);
  const [stopping, setStopping] = useState(false);  // Stop asks once: it ends the run for good, unlike Pause
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<unknown>(null);  // the first load: the page has nothing to show without it
  const [showAll, setShowAll] = useState(false);
  const busy = useRef(false);
  const seq = useRef(0);
  const seen = useRef<Set<string> | null>(null);  // alerts already on screen: only a new one gets the line
  const [moment, setMoment] = useState<Alert | null>(null);

  const take = useCallback((s: Simulation) => {
    setSim(s);
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
  useEffect(() => { seq.current = 0; seen.current = null; setTimeline([]); setMoment(null); first(); }, [first]);

  const step = useCallback(async () => {
    if (!sim || busy.current || !["running", "waiting"].includes(sim.status)) return;
    busy.current = true;
    try { take(await studioApi.step(id, sim.step)); setErr(null); }
    catch (e) {
      if (e instanceof ApiError && (e.code === "busy" || e.code === "step_moved")) { studioApi.get(id, seq.current).then(take).catch(() => {}); }
      else { setPlaying(false); setErr(e instanceof ApiError ? e.full : String(e)); }
    } finally { busy.current = false; }
  }, [id, sim, take]);

  // play: one step at a time; a waiting step comes back quickly and is asked again
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => { step(); }, PLAY_MS);
    return () => clearInterval(t);
  }, [playing, step]);
  useEffect(() => { if (sim && !["running", "waiting"].includes(sim.status)) setPlaying(false); }, [sim]);

  if (!sim) return <div className="page rd rd-studio">{loadErr != null
    ? <><PageTitle title="Scenario run" crumbs={<Link to="/studio">Scenario Studio</Link>} /><LoadError error={loadErr} onRetry={first} what="this run" /></>
    : <PageSkeleton bare />}</div>;

  const active = ["running", "waiting"].includes(sim.status);
  const stopped = sim.status.startsWith("stopped");
  const heads = timeline.filter(t => t.kind === "headline");
  const findings = timeline.filter(t => t.kind === "finding");
  const marks: Mark[] = findings.filter(f => f.data.source === "timeseries").map(f => ({ t: f.at, color: "var(--high)", label: f.data.title, tag: "Flagged move" }));
  const stop = async () => { setStopping(false); setPlaying(false); try { take(await studioApi.stop(id)); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); } };
  const evById = new Map(sim.events.map(e => [e.event_id, e]));
  const evName = (event_id: string, title: string) => { const e = evById.get(event_id); return eventTitle({ title, themes: e?.themes }); };
  const exp = sim.summary.stories.filter(s => s.expected);
  const foundN = exp.filter(s => s.found).length;
  const story = timeline.filter(t => STORY.has(t.kind));
  const rows = [...(showAll ? timeline : story)].reverse();
  const hasSteps = timeline.length > story.length;
  const lastHead = heads[heads.length - 1];

  return (
    <div className="page rd rd-studio">
      <PageTitle title={sim.title}
        crumbs={<><Link to="/studio">Scenario Studio</Link> / <Link to={`/studio/${sim.scenario_id}`}>The scenario</Link> / This run</>}
        status={<><span>Simulated</span><span>{howRun(sim.mode)}</span><span>nothing here reaches your live pages</span></>} />
      <Controls sim={sim} timeline={timeline} active={active} playing={playing} setPlaying={setPlaying} stopping={stopping} setStopping={setStopping} onStep={step} onStop={stop} />
      {moment && <div className="rd-moment" role="status" style={{ marginTop: 14 }}>
        <span><b>New alert · {moment.owner}</b></span><span style={{ flex: 1 }}>{moment.title}</span>
        <TextButton onClick={() => setMoment(null)}>Close</TextButton></div>}
      {err && <QuietWarn>{err}</QuietWarn>}
      {stopped && <p className="rds-quiet">This run was stopped on day {sim.step} of {sim.steps}, so its clock won't move again. What it found up to then stays below.
        <GoLink to={`/studio/${sim.scenario_id}`}>Back to the scenario</GoLink></p>}
      {active && sim.pending.length > 0 && <p className="rds-quiet">Waiting for {sim.pending.map(p => `the ${p.kind === "check" ? "monitor agent" : "investigation agent"} (${p.seconds} s)`).join(" and ")}. The clock moves on when {sim.pending.length > 1 ? "they answer" : "it answers"}.</p>}

      <Figures label="What Amiri Agent has done so far" size={36} items={[
        { value: heads.length, label: "headlines read", sub: lastHead ? `latest: ${lastHead.data.title}` : "waiting for the first day" },
        { value: findings.length, label: "findings", sub: findingsSplit(timeline) },
        { value: sim.events.length, label: "events traced to you", sub: eventsSplit(sim.events) },
        { value: sim.alerts.length ? <><span className="rd-shape" aria-hidden="true" style={{ fontSize: "0.8em" }}>▲</span>{sim.alerts.length}</> : 0, label: "team alerts", hot: sim.alerts.length > 0,
          sub: sim.alerts.length ? [...new Set(sim.alerts.map(a => a.owner))].join(", ") : "no product at risk yet" },
      ]} />

      <div className="rds-two">
        <Section title={sim.symbol} meta="daily close, simulated" action={<span className="rd-fine"><span className="rds-dot" aria-hidden="true" />flagged move</span>}>
          <div className="rds-chart">{sim.bars.length > 1
            ? <PriceChart points={sim.bars.map(b => ({ t: b.ts, v: b.close }))} marks={marks} height={240}
              fmtX={t => dayTime(t).split(" ").slice(0, 2).join(" ")} fmtY={v => v.toFixed(2)} fmtTip={t => dayTime(t)} />
            : <p className="rd-row-d">Press Play: the price is drawn day by day.</p>}</div>
        </Section>
        <Section title="Expected vs found" meta={`${foundN} of ${exp.length} ${active ? "so far" : "found"}`}>
          <ul className="rds-score">
            {exp.map(s => {
              const w = storyWord(s.found, active);
              return <li key={s.key}><span className={`rds-w${w === "Not yet" ? " rds-no" : ""}`}>{w}</span>
                <span><ToneMark tone={s.tone} label={TONE_WORD[s.tone]} />
                  {s.found && s.event_id ? <Link className="rd-name" to={`/events/${s.event_id}`} title={s.event_title ?? undefined}>{s.label}</Link> : s.label}</span></li>;
            })}
          </ul>
          {sim.summary.other_events.map(e => <p key={e.event_id} className="rd-row-m" style={{ marginTop: 10 }}>Also found: <ToneMark tone={e.tone} label={TONE_WORD[e.tone]} />
            <Link className="rd-name" to={`/events/${e.event_id}`}>{evName(e.event_id, e.title)}</Link></p>)}
          <p className="rd-fine rds-more">Findings: {Object.entries(sim.summary.findings).map(([k, v]) => `${v.found} of ${v.expected}+ expected from ${k === "timeseries" ? "prices" : k === "monitor" ? "news" : k}`).join(" · ")}</p>
        </Section>
      </div>

      <Section title="Alerts it would raise" count={sim.alerts.length || undefined} meta="for the team that owns each product">
        {!sim.alerts.length ? <p className="rd-row-d" style={{ marginTop: 12 }}>{active ? "None yet. An alert appears when an event is traced to a product's risk." : "No event in this run puts a product at risk."}</p>
          : sim.alerts.map((a, n) => (
            <div key={n} className="rd-row">
              <div className="rd-row-t">{a.title}</div>
              <div className="rd-row-d">{a.owner} · {listText([...new Set(a.effects.map(x => x.product))])}</div>
              <div className="rd-row-m">From <Link className="rd-name" to={`/events/${a.event_id}`}>{evName(a.event_id, a.event_title)}</Link></div>
            </div>))}
      </Section>

      <Section title="Events" count={sim.events.length || undefined} meta={sim.events.length ? "traced to your products" : undefined}>
        {!sim.events.length ? <p className="rd-row-d" style={{ marginTop: 12 }}>None yet. The first investigation starts after day 2, so a story's first findings go in together.</p>
          : sim.events.map(e => (
            <div key={e.event_id} className="rd-row">
              <div className="rd-row-t"><ToneMark tone={e.tone} label={TONE_WORD[e.tone]} /><Link className="rd-name" to={`/events/${e.event_id}`}>{eventTitle({ title: e.title, themes: e.themes })}</Link></div>
              <div className="rd-row-m">{TONE_WORD[e.tone]}{e.themes.length ? ` · ${[...new Set(e.themes.map(themeLabel))].join(", ")}` : ""} · {plural(e.effects, "possible impact")}{e.developments ? ` · ${plural(e.developments, "later finding")} joined` : ""}</div>
            </div>))}
      </Section>

      <Section title="What happened" meta={`newest first · ${ZONE_LABEL} time`} className="rds-happ">
        {!rows.length ? <p className="rd-row-d" style={{ marginTop: 12 }}>Press Play or Step: each simulated day's headlines, findings and events appear here.</p>
          : rows.map(t => {
            const isStep = !STORY.has(t.kind);
            const tone = t.kind === "event" ? t.data.tone : null;
            return <div key={t.seq} className={`rd-row${isStep ? " rds-step" : ""}`}>
              <div className="rd-row-t">{tone && <ToneMark tone={tone} label={TONE_WORD[tone as keyof typeof TONE_WORD]} />}
                {t.kind === "event" && t.ref ? <Link className="rd-name" to={`/events/${t.ref}`}>{eventTitle({ title: t.data.title, themes: t.data.themes })}</Link> : line(t)}</div>
              <div className="rd-row-m">Day {t.step} · {dayTime(t.at)}{KIND[t.kind] ? ` · ${KIND[t.kind]}` : ""}{t.kind === "headline" && t.data.outlet ? ` · ${t.data.outlet}` : ""}{t.kind === "event" ? ` · ${plural(t.data.effects, "effect")} to watch` : ""}</div>
            </div>;
          })}
        {hasSteps && <p className="rds-showall"><TextButton aria-expanded={showAll} onClick={() => setShowAll(a => !a)}>
          {showAll ? "Show only headlines, findings and events" : `Show all ${timeline.length}, including the agents' own steps`}</TextButton></p>}
      </Section>
    </div>
  );
}
