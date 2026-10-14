// A simulation as it runs: the clock (play, pause, step), the price, the timeline, the events
// Amiri Agent forms (good, bad, neutral) and how they compare with what the scenario expected.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { studioApi, TONE, type Simulation, type TimelineItem } from "../../api/studio";
import { PriceChart, type Mark } from "../../components/charts";
import { Icon } from "../../components/Icon";
import { Banner, CountUp, PageHead, useToast, PageSkeleton } from "../../components/ui";
import { dayTime, plural } from "../../format";

const PLAY_MS = 1200;
const KIND: Record<string, [string, string]> = {
  headline: ["chat", "Headline"], price: ["series", "Price"], finding: ["alert", "Finding"], check: ["monitor", "Monitor check"],
  investigation: ["search", "Investigation"], event: ["events", "Event"], development: ["events", "Joined an event"], note: ["info", ""],
};

function line(t: TimelineItem): string {
  const d = t.data;
  switch (t.kind) {
    case "headline": return `${d.title} · ${d.outlet}`;
    case "price": return `${t.ref} ${d.change_pct >= 0 ? "+" : ""}${d.change_pct}% since the start${d.fires ? ` · ${Math.abs(d.z).toFixed(1)}× typical` : ""}`;
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

/** A new team alert arriving: the moment the chain reaches someone who must act. */
function AlertMoment({ a, onDone }: { a: Alert; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 5200); return () => clearTimeout(t); }, [onDone]);
  return (
    <div className="moment" role="status">
      <span className="moment-ico"><Icon name="alert" /></span>
      <div className="col" style={{ gap: 2, minWidth: 0 }}>
        <span className="moment-k">Early warning · {a.owner}</span>
        <b>{a.title}</b>
        <span className="small">From “{a.event_title}”. In the live app, {a.owner} would see this on their Alerts page.</span>
      </div>
      <button className="btn btn--ghost btn--icon btn--sm" type="button" aria-label="Close" onClick={onDone}><Icon name="x" /></button>
    </div>
  );
}

export function StudioRunPage() {
  const { id = "" } = useParams();
  const toast = useToast();
  const [sim, setSim] = useState<Simulation | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
      seq.current = Math.max(...fresh.map(x => x.seq));
      setTimeline(t => [...t, ...fresh]);
    }
  }, []);
  useEffect(() => { seq.current = 0; seen.current = null; setTimeline([]); studioApi.get(id).then(take).catch(e => setErr(e instanceof ApiError ? e.full : String(e))); }, [id, take]);

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

  if (!sim) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err}</Banner> : <PageSkeleton bare />}</div>;
  const active = ["running", "waiting"].includes(sim.status);
  const findings = timeline.filter(t => t.kind === "finding");
  const marks: Mark[] = findings.filter(f => f.data.source === "timeseries").map(f => ({ t: f.at, color: "var(--high)", label: f.data.title }));
  const stop = async () => { try { take(await studioApi.stop(id)); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); } };
  return (
    <div className="page">
      <PageHead title={sim.title}
        crumbs={<><Link to="/studio">Scenario Studio</Link> / <Link to={`/studio/${sim.scenario_id}`}>The scenario</Link> / This run</>}
        sub={<>{sim.institution.name} · {sim.mode === "replay" ? "replaying a recording" : sim.mode === "record" ? "recording" : "live agents"} · <b>{dayTime(sim.virtual_now)}</b> (simulated) · step {sim.step} of {sim.steps}</>}
        actions={active ? <>
          <button className="btn btn--primary" type="button" onClick={() => setPlaying(p => !p)}><Icon name={playing ? "pause" : "play"} />{playing ? "Pause" : "Play"}</button>
          <button className="btn" type="button" disabled={playing} onClick={step}>Step</button>
          <button className="btn btn--ghost" type="button" onClick={stop}>Stop</button></> : <span className="badge b-noeffect">{sim.status.toUpperCase()}</span>} />
      {moment && <AlertMoment a={moment} onDone={() => setMoment(null)} />}
      <Chain timeline={timeline} sim={sim} />
      <div className="progress" role="progressbar" aria-label="How far the simulated days have run" aria-valuemin={0} aria-valuemax={sim.steps} aria-valuenow={sim.step}>
        <span style={{ width: `${Math.min(100, (sim.step / Math.max(1, sim.steps)) * 100)}%` }} /></div>
      <div className="banners">
        {err && <Banner kind="crit" icon="warn">{err}</Banner>}
        {sim.pending.length > 0 && <Banner kind="info" icon="refresh">Waiting for {sim.pending.map(p => `the ${p.kind === "check" ? "monitor agent" : "investigation agent"} (${p.seconds} s)`).join(" and ")}. The clock moves on when {sim.pending.length > 1 ? "they answer" : "it answers"}.</Banner>}
        <Banner kind="info">Simulated: the headlines and prices are this scenario's, not real. Events here never reach the live Events page.</Banner>
      </div>
      <div className="split mt12">
        <div className="col gap16">
          <div className="card"><div className="hd"><h2>{sim.symbol}</h2><span className="spacer" /><span className="small muted">daily close, simulated</span></div>
            <div className="bd">{sim.bars.length > 1 ? <PriceChart points={sim.bars.map(b => ({ t: b.ts, v: b.close }))} marks={marks} height={200}
              fmtX={t => dayTime(t).split(" ").slice(0, 2).join(" ")} fmtY={v => v.toFixed(2)} fmtTip={t => dayTime(t)} /> : <span className="muted small">Press Play.</span>}</div></div>
          <div className="card"><div className="hd"><h2>Events</h2><span className="spacer" /><span className="small muted">{sim.events.length} so far</span></div>
            {!sim.events.length ? <div className="bd small muted">None yet. The first investigation starts after day 2, so a story's first findings go in together.</div> : (
              <div className="list">{sim.events.map(e => (
                <div key={e.event_id} className="li"><div className="col" style={{ gap: 3, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}><span className={`badge ${TONE[e.tone][0]}`}>{TONE[e.tone][1]}</span>
                    <Link className="strong" to={`/events/${e.event_id}`}>{e.title}</Link></div>
                  <span className="small muted">{e.themes.map(t => [t.theme, t.currency ?? t.item, t.direction].filter(Boolean).join(" ").replace(/_/g, " ")).join(" · ")} · {plural(e.effects, "effect")} to watch{e.developments ? ` · ${plural(e.developments, "later finding")} joined` : ""}</span>
                </div></div>))}</div>)}
          </div>
          <div className="card"><div className="hd"><h2>Alerts it would raise</h2><span className="spacer" /><span className="small muted">for the team that owns each product</span></div>
            {!sim.alerts.length ? <div className="bd small muted">{active ? "None yet. An alert appears when an event is traced to a product's risk." : "No event in this run puts a product at risk."}</div> : (
              <div className="list">{sim.alerts.map((a, n) => (
                <div key={n} className="li"><div className="col" style={{ gap: 3, flex: 1 }}>
                  <div className="row wrap" style={{ gap: 8 }}><span className="badge b-down">EARLY WARNING</span><span className="chip">{a.owner}</span><span className="strong">{a.title}</span></div>
                  <span className="small muted">From <Link to={`/events/${a.event_id}`}>{a.event_title}</Link>. In the live app this lands on the Alerts page for {a.owner}, who acknowledge it.</span>
                </div></div>))}</div>)}
          </div>
          <div className="card"><div className="hd"><h2>What was expected, and what Amiri Agent found</h2></div><div className="list">
            {sim.summary.stories.filter(s => s.expected).map(s => (
              <div key={s.key} className="li"><div className="row" style={{ gap: 8, flex: 1 }}>
                <span className={`badge ${s.found ? "b-ok" : active ? "b-noeffect" : "b-down"}`}>{s.found ? "FOUND" : active ? "NOT YET" : "MISSED"}</span>
                <span style={{ flex: 1 }}>{s.label} <span className="small muted">(expected {s.tone})</span></span>
                {s.found && <Link className="small" to={`/events/${s.event_id}`}>{s.event_title}</Link>}
              </div></div>))}
            {sim.summary.other_events.map(e => <div key={e.event_id} className="li small">Also found: <Link to={`/events/${e.event_id}`}>{e.title}</Link> ({e.tone})</div>)}
            <div className="li small muted">Findings: {Object.entries(sim.summary.findings).map(([k, v]) => `${k === "timeseries" ? "market series" : k} ${v.found} (expected ${v.expected}+)`).join(" · ")}</div>
          </div></div>
        </div>
        <div className="card"><div className="hd"><h2>Timeline</h2></div>
          <div className="list" tabIndex={0} role="region" aria-label="Timeline of the run" style={{ maxHeight: 900, overflow: "auto" }}>{[...timeline].reverse().map(t => {
            const [icon, label] = KIND[t.kind] ?? ["info", t.kind];
            return <div key={t.seq} className="li"><div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
              <Icon name={icon} className="ico16" /><div className="col" style={{ gap: 2 }}>
                <span className="small muted">day {t.step} · {dayTime(t.at)}{label ? ` · ${label}` : ""}</span>
                <span className="small">{line(t)}</span></div></div></div>;
          })}</div></div>
      </div>
    </div>
  );
}
