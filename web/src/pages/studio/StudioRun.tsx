// A simulation as it runs: the clock (play, pause, step), the price, the timeline, the events
// Amiri Agent forms (good, bad, neutral) and how they compare with what the scenario expected.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { studioApi, type Simulation, type TimelineItem } from "../../api/studio";
import { StatusPill, TonePill } from "../../components/blocks";
import { PriceChart, type Mark } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { Banner, CountUp, LoadError, PageHead, useToast, PageSkeleton } from "../../components/ui";
import { dayTime, plural } from "../../format";
import { listText, themeLabel } from "../../plain";
import "../../styles/showcase.css";

const PLAY_MS = 1200;
const KIND: Record<string, [string, string]> = {
  headline: ["chat", "Headline"], price: ["series", "Flagged move"], finding: ["search", "Finding"], check: ["monitor", "Monitor check"],
  investigation: ["search", "Investigation"], event: ["events", "Event"], development: ["events", "Joined an event"], note: ["info", ""],
};

function line(t: TimelineItem): string {
  const d = t.data;
  switch (t.kind) {
    case "headline": return `${d.title} · ${d.outlet}`;
    case "price": return `Unusual move: ${t.ref} ${Math.abs(d.z).toFixed(1)}× a typical day (${d.change_pct >= 0 ? "+" : ""}${d.change_pct}% since the start)`;
    case "finding": return `${d.source === "timeseries" ? "Market series" : "Monitor"}: ${d.title}`;
    case "check": return d.status === "started" ? `Reading ${plural(d.headlines, "headline")}` : `${d.status}${d.findings ? ` · ${plural(d.findings, "finding")}` : ""}${d.error ? ` · ${d.error}` : ""}`;
    case "investigation": return d.status === "started" ? `Investigating ${plural(d.findings, "finding")}` : `${d.status}${d.error ? ` · ${d.error}` : ""}`;
    case "event": return `${d.title} · ${plural(d.effects, "effect")} to watch`;
    case "development": return d.reason;
    default: return d.text ?? "";
  }
}

type Alert = Simulation["alerts"][number];

/** The chain Amiri Agent runs, as it happens: what it read → what it found → what it means → who must act. */
function Chain({ timeline, sim }: { timeline: TimelineItem[]; sim: Simulation }) {
  const heads = timeline.filter(t => t.kind === "headline");
  const finds = timeline.filter(t => t.kind === "finding");
  const last = <T,>(xs: T[]) => xs[xs.length - 1];
  const bad = sim.events.filter(e => e.tone === "bad" || e.tone === "mixed").length;
  const stages: { n: number; label: string; sub: string; icon: string; hot?: boolean }[] = [
    { n: heads.length, label: "Headlines read", icon: "chat", sub: last(heads)?.data.title ?? "Waiting for the first day" },
    { n: finds.length, label: "Findings", icon: "search", sub: last(finds)?.data.title ?? "Nothing unusual yet" },
    { n: sim.events.length, label: "Events traced to you", icon: "events", sub: sim.events.length ? `${bad} bad or mixed · ${sim.events.length - bad} good or neutral` : "None yet" },
    { n: sim.alerts.length, label: "Team alerts", icon: "alert", hot: sim.alerts.length > 0,
      sub: sim.alerts.length ? [...new Set(sim.alerts.map(a => a.owner))].join(", ") : "No product at risk yet" },
  ];
  return (
    <div className="chain" role="group" aria-label="What Amiri Agent has done so far">{stages.map((st, i) => (
      <div key={st.label} className={`chain-step ${st.n ? "on" : ""} ${st.hot ? "hot" : ""}`}>
        <div className="row" style={{ gap: 8 }}><span className="chain-ico"><Icon name={st.icon} /></span>
          <span className="chain-n" key={st.n}><CountUp value={st.n} /></span></div>
        <div className="chain-l">{st.label}</div>
        <div className="chain-s" title={st.sub}>{st.sub}</div>
        {i < stages.length - 1 && <span className="chain-arrow" aria-hidden="true" />}
      </div>))}
    </div>
  );
}

/** A new team alert arriving: the moment the chain reaches someone who must act. It sits under the top bar, where
 * the eye already is, and stays 15 s (or until closed) so the presenter can talk over it. Rendered on <body>, so no
 * ancestor transform can move it off-screen. */
function AlertMoment({ a, onDone }: { a: Alert; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 15000); return () => clearTimeout(t); }, [onDone, a]);
  return createPortal(
    <div className="moment" role="status">
      <span className="moment-ico"><Icon name="alert" /></span>
      <div className="col" style={{ gap: 4, minWidth: 0 }}>
        <span className="moment-k">Early warning · {a.owner}</span>
        <b>{a.title}</b>
        <span className="moment-s">From “{a.event_title}”. In the live app, {a.owner} would see this on their Alerts page.</span>
      </div>
      <button className="btn btn--ghost btn--icon btn--sm" type="button" aria-label="Close" onClick={onDone}><Icon name="x" /></button>
    </div>, document.body);
}

/** The clock as the hero: big day count, the simulated date, and a track with a tick on each day that had news. */
function Clock({ sim, timeline }: { sim: Simulation; timeline: TimelineItem[] }) {
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: sim.institution.time_zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(sim.virtual_now)).replace(",", "").replace(/, (\d\d:\d\d)$/, " · $1");
  const days = (k: string) => [...new Set(timeline.filter(t => t.kind === k).map(t => t.step))];
  const pct = (d: number) => `${Math.min(100, (d / Math.max(1, sim.steps)) * 100)}%`;
  return (
    <div className="rn-clock">
      <div className="rn-day" aria-live="polite"><b>Day {sim.step}</b><span>of {sim.steps}</span></div>
      <div className="rn-when">
        <span className="rn-date">{date} <span className="muted">(simulated)</span></span>
        <div className="rn-track" role="progressbar" aria-label="How far the simulated days have run" aria-valuemin={0} aria-valuemax={sim.steps} aria-valuenow={sim.step}>
          <span className="rn-fill" style={{ width: pct(sim.step) }} />
          {days("headline").map(d => <span key={`h${d}`} className="rn-tick" style={{ left: pct(d - 0.5) }} title={`Day ${d}: headlines`} />)}
          {days("event").map(d => <span key={`e${d}`} className="rn-tick ev" style={{ left: pct(d - 0.5) }}
            title={`Day ${d}: ${plural(timeline.filter(t => t.kind === "event" && t.step === d).length, "event")} formed${days("headline").includes(d) ? ", and headlines" : ""}`} />)}
        </div>
        <span className="rn-legend"><span className="rn-tick inl" />headlines <span className="rn-tick ev inl" />event formed</span>
      </div>
    </div>
  );
}

/** The run as a story: headlines, findings, events; daily prices stay on the chart and only flagged moves show here. */
function Timeline({ timeline, sim, newFrom }: { timeline: TimelineItem[]; sim: Simulation; newFrom: number }) {
  const story = timeline.filter(t => t.kind !== "price" || t.data.fires);
  const ticks = timeline.length - story.length;
  const tone = (title: string) => sim.events.find(e => e.title === title)?.tone ?? "neutral";
  const cls = (t: TimelineItem) => t.kind === "event" ? `ev t-${tone(t.data.title)}` : t.kind === "price" ? "move"
    : t.kind === "check" || t.kind === "investigation" || t.kind === "note" ? "proc" : t.kind;
  return (
    <div className="card"><div className="hd"><h2>Timeline</h2><span className="spacer" /><span className="small muted">newest first</span></div>
      <div className="list rn-tl" tabIndex={0} role="region" aria-label="Timeline of the run">
        {!story.length && <div className="li small muted">Press Play or Step: each simulated day's headlines, findings and events appear here.</div>}
        {[...story].reverse().map(t => {
          const [icon, label] = KIND[t.kind] ?? ["info", t.kind];
          return <div key={t.seq} className={`li tl tl-${cls(t)} ${t.seq >= newFrom ? "fresh" : ""}`}>
            <span className="tl-ico"><Icon name={icon} /></span>
            <div className="col" style={{ gap: 2, minWidth: 0 }}>
              <span className="tl-meta">Day {t.step} · {dayTime(t.at)}{label ? ` · ${label}` : ""}{t.seq >= newFrom ? <b className="tl-new">New</b> : null}</span>
              <span className="tl-text">{line(t)}</span></div></div>;
        })}
        {ticks > 0 && <div className="li small muted">{plural(ticks, "daily price")} {ticks === 1 ? "is" : "are"} on the chart, not listed here.</div>}
      </div></div>
  );
}

/** The proof for the audience: what the scenario expected and what Amiri Agent found, with a score. */
function Scorecard({ sim, active }: { sim: Simulation; active: boolean }) {
  const exp = sim.summary.stories.filter(s => s.expected);
  const found = exp.filter(s => s.found).length;
  return (
    <div className="card rn-score"><div className="hd"><h2>Expected vs found</h2><span className="spacer" />
      <span className="rn-score-n"><b>{found}</b> of {exp.length} stories found</span></div>
      <div className="list">
        {exp.map(s => (
          <div key={s.key} className="li"><StatusPill tone={s.found ? "green" : active ? "grey" : "red"} icon={s.found ? "check" : undefined}>{s.found ? "Found" : active ? "Not yet" : "Missed"}</StatusPill>
            <span className="rn-story">{s.found && s.event_id ? <Link to={`/events/${s.event_id}`} title={s.event_title ?? undefined}>{s.label}</Link> : s.label}</span>
            <span className="small muted nowrap">{s.tone === "bad" ? "bad for you" : s.tone === "good" ? "good for you" : s.tone}</span></div>))}
        {sim.summary.other_events.map(e => <div key={e.event_id} className="li small">Also found: <Link to={`/events/${e.event_id}`}>{e.title}</Link></div>)}
        <div className="li small muted">Findings: {Object.entries(sim.summary.findings).map(([k, v]) => `${v.found} of ${v.expected}+ expected from ${k === "timeseries" ? "prices" : k === "monitor" ? "news" : k}`).join(" · ")}</div>
      </div></div>
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
  const [newFrom, setNewFrom] = useState(Infinity);  // rows from this seq on arrived with the last step: highlighted
  const busy = useRef(false);
  const seq = useRef(0);
  const seen = useRef<Set<string> | null>(null);  // alerts already on screen: only new ones get the moment
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
      if (seq.current > 0) setNewFrom(seq.current + 1);  // the first load is not "new"
      seq.current = Math.max(...fresh.map(x => x.seq));
      setTimeline(t => [...t, ...fresh]);
    }
  }, []);
  const first = useCallback(() => studioApi.get(id).then(s => { take(s); setLoadErr(null); }).catch(setLoadErr), [id, take]);
  useEffect(() => { seq.current = 0; seen.current = null; setTimeline([]); setNewFrom(Infinity); first(); }, [first]);

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
  const closeMoment = useCallback(() => setMoment(null), []);

  if (!sim) return <div className="page">{loadErr != null ? <><PageHead title="Scenario run" crumbs={<Link to="/studio">Scenario Studio</Link>} /><LoadError error={loadErr} onRetry={first} what="this run" /></> : <PageSkeleton bare />}</div>;
  const active = ["running", "waiting"].includes(sim.status);
  const findings = timeline.filter(t => t.kind === "finding");
  const marks: Mark[] = findings.filter(f => f.data.source === "timeseries").map(f => ({ t: f.at, color: "var(--high)", label: f.data.title, tag: "Flagged move" }));
  const pins = timeline.filter(t => t.kind === "headline").map(t => ({ t: t.at, label: `${t.data.title} · ${t.data.outlet}` }));
  const stop = async () => { setStopping(false); setPlaying(false); try { take(await studioApi.stop(id)); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); } };
  const mode = sim.mode === "replay" ? "Replaying a recording" : sim.mode === "record" ? "Recording" : "Live agents";
  return (
    <div className="page">
      <PageHead title={sim.title}
        crumbs={<><Link to="/studio">Scenario Studio</Link> / <Link to={`/studio/${sim.scenario_id}`}>The scenario</Link> / This run</>}
        sub={<><span className="chip">Simulated</span> {mode}. The headlines and prices are this scenario's, and nothing here reaches the live Events page.</>} />
      <section className="card rn-bar" aria-label="Run controls">
        <div className="rn-ctl">{active ? <>
          <button className="btn btn--primary btn--lg" type="button" onClick={() => setPlaying(p => !p)}><Icon name={playing ? "pause" : "play"} />{playing ? "Pause" : "Play"}</button>
          <button className="btn btn--lg" type="button" disabled={playing} onClick={step} title="Run one simulated day">Step</button>
          {stopping ? <span className="row" style={{ gap: 6 }}><span className="small">End this run for good? It can't carry on after.</span>
            <button className="btn btn--danger btn--sm" type="button" onClick={stop}>Stop the run</button>
            <button className="btn btn--sm" type="button" onClick={() => setStopping(false)}>Keep it</button></span>
            : <button className="btn btn--ghost" type="button" onClick={() => setStopping(true)} title="End this run (Pause keeps it, Stop ends it)">Stop</button>}</>
          : <StatusPill tone={sim.status === "finished" ? "green" : "grey"} icon={sim.status === "finished" ? "check" : undefined}>{sim.status === "finished" ? "Finished" : sim.status[0].toUpperCase() + sim.status.slice(1).replace(/_/g, " ")}</StatusPill>}</div>
        <Clock sim={sim} timeline={timeline} />
      </section>
      {moment && <AlertMoment a={moment} onDone={closeMoment} />}
      <Chain timeline={timeline} sim={sim} />
      {(err || (active && sim.pending.length > 0) || sim.status.startsWith("stopped")) && <div className="banners">
        {err && <Banner kind="crit" icon="warn">{err}</Banner>}
        {sim.status.startsWith("stopped") && <Banner kind="info" icon="info" action={<Link className="btn btn--sm" to={`/studio/${sim.scenario_id}`}>Back to the scenario</Link>}>
          This run was stopped on day {sim.step} of {sim.steps}, so its clock won't move again. What it found up to then stays below; to see the rest, start a new run from the scenario.</Banner>}
        {active && sim.pending.length > 0 && <Banner kind="info" icon="refresh">Waiting for {sim.pending.map(p => `the ${p.kind === "check" ? "monitor agent" : "investigation agent"} (${p.seconds} s)`).join(" and ")}. The clock moves on when {sim.pending.length > 1 ? "they answer" : "it answers"}.</Banner>}
      </div>}
      <div className="split rn-split">
        <div className="col gap16">
          <div className="card"><div className="hd"><h2>{sim.symbol}</h2><span className="spacer" />
            <span className="rn-legend"><span className="rn-pin inl" />headline <span className="rn-dot inl" />flagged move · daily close, simulated</span></div>
            <div className="bd">{sim.bars.length > 1 ? <PriceChart points={sim.bars.map(b => ({ t: b.ts, v: b.close }))} marks={marks} pins={pins} height={220}
              fmtX={t => dayTime(t).split(" ").slice(0, 2).join(" ")} fmtY={v => v.toFixed(2)} fmtTip={t => dayTime(t)} /> : <span className="muted small">Press Play: the price is drawn day by day.</span>}</div></div>
          <div className="card"><div className="hd"><h2>Alerts it would raise</h2><span className="spacer" /><span className="small muted">for the team that owns each product</span></div>
            {!sim.alerts.length ? <div className="bd small muted">{active ? "None yet. An alert appears when an event is traced to a product's risk." : "No event in this run puts a product at risk."}</div> : (
              <div className="list">{sim.alerts.map((a, n) => (
                <div key={n} className="li"><div className="col" style={{ gap: 4, flex: 1 }}>
                  <div className="row wrap" style={{ gap: 8 }}><StatusPill tone="amber" icon="alert">Early warning</StatusPill><span className="alc-team"><Icon name="users" />{a.owner}</span></div>
                  <span className="strong">{a.title}</span>
                  <span className="small">{listText([...new Set(a.effects.map(x => x.product))])} · from <Link to={`/events/${a.event_id}`}>{a.event_title}</Link></span>
                </div></div>))}</div>)}
          </div>
          <div className="card"><div className="hd"><h2>Events</h2><span className="spacer" /><span className="small muted">{sim.events.length} so far</span></div>
            {!sim.events.length ? <div className="bd small muted">None yet. The first investigation starts after day 2, so a story's first findings go in together.</div> : (
              <div className="list">{sim.events.map(e => (
                <div key={e.event_id} className="li"><div className="col" style={{ gap: 4, flex: 1 }}>
                  <div className="row wrap" style={{ gap: 8 }}><Link className="strong" to={`/events/${e.event_id}`}>{e.title}</Link><TonePill tone={e.tone} /></div>
                  <span className="row wrap" style={{ gap: 8 }}>{e.themes.map((t, i) => <span key={i} className="chip">{themeLabel(t)}</span>)}
                    <span className="small muted">{plural(e.effects, "possible impact")}{e.developments ? ` · ${plural(e.developments, "later finding")} joined` : ""}</span></span>
                </div></div>))}</div>)}
          </div>
        </div>
        <div className="col gap16">
          <Scorecard sim={sim} active={active} />
          <Timeline timeline={timeline} sim={sim} newFrom={newFrom} />
        </div>
      </div>
    </div>
  );
}
