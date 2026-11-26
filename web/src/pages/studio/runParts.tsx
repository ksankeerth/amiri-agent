// The run page's parts (board 10; states: board 15 B): the head with its day track and controls, the four tiles, expected vs
// found, the alerts it would raise, the price, the timeline, and how a run ended. Page logic is in ./StudioRun.tsx; the words
// and rules are in ./runWords.ts and ./words.ts.
import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { Scenario, Simulation, TimelineItem } from "../../api/studio";
import { niceTicks } from "../../components/chartMath";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { DirectionMark } from "../../components/v2/Direction";
import { Empty } from "../../components/v2/Empty";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { StatTile, StatTiles } from "../../components/v2/StatTile";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { LEVEL_LABEL } from "../../plain";
import { plainError, plural } from "../../format";
import { listText } from "../../plain";
import { replayable, runHint } from "./editorWords";
import {
  againMode, clockWithYear, effectLines, endedText, eventsSplit, findingsLine, finishedLine, foldDays, foundCount, isActive, priceSummary, recordingLine,
  STORY_WORD, statusPill, teamsOf, timeOfDay, timeRow, toneWords, type StoryRow, type TimeRow,
} from "./runWords";
import { findingsSplit, trackDays } from "./words";
import { SkBar } from "../../components/v2/Skeleton";

type Alert = Simulation["alerts"][number];

// ---------------------------------------------------------------- the head
export interface HeadProps {
  sim: Simulation;
  timeline: TimelineItem[];
  /** "investigating 2 findings, 12 s so far" */
  working: string | null;
  /** the page is carrying on by itself (Next day or Play) */
  driving: boolean;
  playing: boolean;
  onNext: () => void;
  onPlay: () => void;
  onStop: () => void;
}
export function RunHead({ sim, timeline, working, driving, playing, onNext, onPlay, onStop }: HeadProps) {
  const active = isActive(sim.status);
  const pill = statusPill(sim);
  const rec = recordingLine(sim.mode, active);
  const tz = sim.institution.time_zone;
  const last = sim.step >= sim.steps;
  return (
    <header className="v2-run-head">
      <div className="v2-run-pills">
        <Pill tone="sim">Simulated · nothing reaches the live pages</Pill>
        <Pill tone={pill.tone} mark={pill.mark}>{pill.text}</Pill>
        {rec && <span className="v2-meta">{rec}</span>}
      </div>
      <div className="v2-run-titlerow">
        <div className="v2-run-title">
          <h1 className="v2-run-h1">{sim.title}</h1>
          <p className="v2-run-clock">
            Simulated clock: <b className="v2-num">{clockWithYear(sim.virtual_now, tz)}</b>
            {active && (working ? <> · {working}{driving && !playing ? ", carrying on by itself" : ""}</> : sim.step === 0 ? " · ready to start" : "")}
          </p>
        </div>
        <div className="v2-run-day v2-num"><b>Day {sim.step}</b><span> of {sim.steps}</span></div>
        {active && (
          <div className="v2-run-btns">
            <Button size="lg" onClick={onStop}>Stop</Button>
            <Button size="lg" onClick={onPlay} aria-pressed={playing} title={playing ? "Stop carrying on after this day" : "Run every day until the end"}>{playing ? "Pause" : "Play all days"}</Button>
            <Button size="lg" variant="primary" disabled={driving} onClick={onNext}>{last ? "Finish the run" : "Next day"}<span aria-hidden="true"> →</span></Button>
          </div>)}
      </div>
      <DayTrack sim={sim} timeline={timeline} />
    </header>
  );
}

/** One bar for each day (dark once run), a round dot where headlines arrived and a diamond where an event formed. */
function DayTrack({ sim, timeline }: { sim: Simulation; timeline: TimelineItem[] }) {
  const days = trackDays(sim.steps, sim.step, timeline);
  const list = (xs: number[]) => (xs.length ? listText(xs.map(String), 30) : "none yet");
  const label = `Day ${sim.step} of ${sim.steps}; headlines on days ${list(days.filter(d => d.headlines).map(d => d.day))}; events formed on days ${list(days.filter(d => d.event).map(d => d.day))}`;
  return (
    <div className="v2-run-trackwrap">
      <div className="v2-run-track" role="img" aria-label={label}>
        {days.map(d => (
          <span key={d.day} className="v2-run-seg" title={`Day ${d.day}${d.headlines ? ": headlines" : ""}${d.event ? `${d.headlines ? ", " : ": "}an event formed` : ""}`}>
            <span className={`v2-run-bar${d.ran ? " is-ran" : ""}${d.ran && d.day === sim.step ? " is-now" : ""}`} />
            <span className="v2-run-marks">
              <span className={`v2-run-dot${d.headlines ? " is-on" : ""}`} />
              <span className={`v2-run-dia${d.event ? " is-on" : ""}`} />
            </span>
          </span>))}
      </div>
      <p className="v2-run-key" aria-hidden="true"><span className="v2-run-dot is-on" /> headlines arrived <span className="v2-run-dia is-on" /> an event formed</p>
    </div>
  );
}

// ---------------------------------------------------------------- how a run ended
export interface EndProps {
  sim: Simulation;
  scenario: Scenario | null;
  rows: StoryRow[];
  busy: boolean;
  onStart: (mode: "replay" | "record" | "live") => void;
}
export function EndPanel({ sim, scenario, rows, busy, onStart }: EndProps) {
  const rec = scenario?.recording ?? null;
  const ready = replayable(rec);
  const again = againMode(sim.mode);
  const done = sim.status === "finished";
  const { found, expected } = foundCount(rows);
  const text = done ? null : endedText(sim, plainError);
  const back = <Button as="link" to={`/studio/${sim.scenario_id}`} variant={done ? "primary" : "secondary"}>Back to the scenario</Button>;
  const hint = !ready && scenario ? runHint({ running: false, empty: false, rec, mode: "replay" }) : null;
  return (
    <section className={`v2-panel v2-run-end${done ? "" : sim.status === "failed" ? " is-failed" : ""}`} aria-label={done ? "How the run ended" : "Why the run stopped"}>
      <div className="v2-run-end__main">
        {done
          ? <>
            <div className="v2-run-end__big">{expected ? <><span className={`v2-num${found === expected ? " is-all" : ""}`}>{found} of {expected}</span> stories found</> : "The run is over"}</div>
            <p className="v2-run-end__sub">{finishedLine(sim.events.length, sim.alerts.length, ready)}</p>
          </>
          : <>
            <b className="v2-run-end__title">{text!.title}</b>
            <p className="v2-run-end__sub">{text!.body}</p>
            {sim.status === "failed" && sim.error && <details className="v2-run-tech"><summary>Technical details</summary><code>{sim.error}</code></details>}
          </>}
        {sim.status === "stopped" && hint && sim.mode === "record" && <p className="v2-meta">{hint}</p>}
      </div>
      <div className="v2-run-end__btns">
        {again && <Button variant={done ? "secondary" : "primary"} disabled={busy} busy={busy} busyLabel="Starting…" onClick={() => onStart(again)}>{again === "record" ? "Record it again" : "Run again"}</Button>}
        {ready && <Button disabled={busy} onClick={() => onStart("replay")}>{done || !again ? "Replay" : "Replay instead"}</Button>}
        {back}
      </div>
    </section>
  );
}

/** "Stop this run?" before the end of a run that can't be taken back. */
export function StopDialog({ onCancel, onGo, busy }: { onCancel: () => void; onGo: () => void; busy: boolean }) {
  return (
    <Dialog tone="danger" title="Stop this run?" onClose={onCancel}
      actions={<><Button onClick={onCancel}>Keep it going</Button><Button variant="primary" onClick={onGo} disabled={busy} busy={busy} busyLabel="Stopping…">Stop the run</Button></>}>
      <p>Pause keeps the run where it is. Stop ends it for good: its clock won't move again, and a recording being made won't be complete.</p>
      <p className="v2-meta">What it found so far stays on this page.</p>
    </Dialog>
  );
}

// ---------------------------------------------------------------- the four tiles
export function RunTiles({ sim, timeline, planned }: { sim: Simulation; timeline: TimelineItem[]; planned: number | null }) {
  const heads = timeline.filter(t => t.kind === "headline").length;
  const findings = timeline.filter(t => t.kind === "finding").length;
  const teams = teamsOf(sim.alerts);
  return (
    <StatTiles label="So far">
      <StatTile caption="Headlines read" value={heads} meta={planned != null ? `of ${planned} planned` : heads ? undefined : "waiting for the first day"} />
      <StatTile caption="Findings" value={findings} meta={findingsSplit(timeline)} />
      <StatTile caption="Events" value={sim.events.length} meta={eventsSplit(sim.events)} />
      <StatTile caption="Alerts it would raise" value={sim.alerts.length} tone={sim.alerts.length ? "act" : undefined}
        meta={sim.alerts.length ? `for ${listText(teams)} · none saved` : "none yet · none saved"} />
    </StatTiles>
  );
}

// ---------------------------------------------------------------- expected vs found
export function ExpectedFound({ rows, findings, active }: { rows: StoryRow[]; findings: Simulation["summary"]["findings"]; active: boolean }) {
  const id = useId();
  const { found, expected } = foundCount(rows);
  const line = findingsLine(findings, active);
  return (
    <section aria-labelledby={id}>
      <SectionHead id={id} title="Expected vs found"
        action={expected > 0 ? <span className="v2-run-score"><b className="v2-num">{found}</b> of {expected} {active ? "so far" : "found"}</span> : undefined} />
      {rows.length === 0
        ? <Empty plain title="Nothing to compare">This scenario doesn't say which stories to expect. What turned up is in the timeline.</Empty>
        : <ul className="v2-run-xf">
          {rows.map(r => {
            const w = STORY_WORD[r.state];
            return (
              <li key={r.key} className="v2-run-xf__row">
                <Pill tone={w.tone} mark={w.mark}>{w.word}</Pill>
                <span className="v2-run-xf__label"><DirectionMark tone={r.tone} size={11} /><span>{r.label}<span className="v2-sr"> ({toneWords(r.tone)})</span></span></span>
                <span className="v2-run-xf__to">
                  {r.eventId && r.state !== "unexpected" ? <ArrowLink to={`/events/${r.eventId}`}>{r.eventTitle}</ArrowLink>
                    : r.eventId ? <><ArrowLink to={`/events/${r.eventId}`}>See the event</ArrowLink><span className="v2-run-xf__note">{r.note}</span></>
                    : <span className="v2-run-xf__note">{r.note}</span>}
                </span>
              </li>);
          })}
        </ul>}
      {line && <p className="v2-run-xf__find">{line}</p>}
    </section>
  );
}

// ---------------------------------------------------------------- alerts it would raise
export function AlertsRaised({ alerts, evName, active }: { alerts: Alert[]; evName: (id: string, title: string) => string; active: boolean }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <SectionHead id={id} title="Alerts it would raise" count={alerts.length || undefined} countLabel="alerts"
        meta={<span className="v2-meta">for the team that owns each product · none saved</span>} />
      {!alerts.length
        ? <Empty plain title={active ? "None yet" : "None raised"}>{active ? "An alert appears when an event is traced to a product at risk." : "No event in this run puts a product at risk."}</Empty>
        : <ul className="v2-run-alerts">
          {alerts.map((a, n) => (
            <li key={`${a.event_id}|${a.owner}|${n}`} className="v2-run-alert">
              <div className="v2-run-alert__who"><Pill tone="bad">{LEVEL_LABEL.warning}</Pill><b>{a.owner}</b></div>
              <div className="v2-run-alert__t">{a.title}</div>
              <ul className="v2-run-alert__fx">
                {effectLines(a.effects).map((x, i) => (
                  <li key={i}>{x.product} · {x.metric} <span aria-hidden="true">{x.arrow}</span><span className="v2-sr"> {x.word}</span>{x.size || x.when ? <> {[x.size, x.when].filter(Boolean).join(", ")}</> : null}</li>))}
              </ul>
              <div className="v2-run-alert__from">From <Link to={`/events/${a.event_id}`}>{evName(a.event_id, a.event_title)}</Link></div>
            </li>))}
        </ul>}
    </section>
  );
}

// ---------------------------------------------------------------- the price
export function PricePanel({ title, bars, flagged, step }: { title: string; bars: Simulation["bars"]; flagged: string[]; step: number }) {
  const id = useId();
  const points = bars.map(b => ({ t: new Date(b.ts).getTime(), v: b.close }));
  const flags = new Set(flagged.map(f => new Date(f).getTime()));
  const summary = priceSummary(points.map(p => ({ close: p.v })), Math.max(0, points.length - 1));
  const hits = points.map((p, i) => (flags.has(p.t) ? i : -1)).filter(i => i >= 0);
  const lo = Math.min(...points.map(p => p.v)), hi = Math.max(...points.map(p => p.v)), pad = (hi - lo) * 0.08 || 1;
  const a = lo - pad, z = hi + pad;
  const x = (i: number) => (points.length > 1 ? (i / (points.length - 1)) * 100 : 0), y = (v: number) => 100 - ((v - a) / (z - a)) * 100;
  const { ticks, dec } = niceTicks(a, z);
  const fmtDay = (t: number) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(t));
  return (
    <section aria-labelledby={id}>
      <SectionHead id={id} title={title} meta={<span className="v2-meta">daily close, simulated</span>}
        action={hits.length ? <span className="v2-meta"><span className="v2-run-dia is-flag" aria-hidden="true" /> flagged move</span> : undefined} />
      {points.length < 2
        ? <Empty plain title="Nothing drawn yet">{step === 0 ? "The price is drawn day by day once the run starts." : "No price came in for this run."}</Empty>
        : <>
          <div className="v2-run-chart" role="img" aria-label={`${summary ?? title}${hits.length ? `; ${plural(hits.length, "flagged move")}` : ""}`}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              {ticks.map(t => <line key={t} className="v2-run-grid" x1="0" x2="100" y1={y(t)} y2={y(t)} vectorEffect="non-scaling-stroke" />)}
              <polyline className="v2-run-line" fill="none" vectorEffect="non-scaling-stroke" points={points.map((p, i) => `${x(i)},${y(p.v)}`).join(" ")} />
            </svg>
            {ticks.map(t => <span key={t} className="v2-run-ytick v2-num" style={{ top: `${y(t)}%` }}>{t.toFixed(dec)}</span>)}
            {hits.map(i => <span key={i} className="v2-run-dia is-flag is-at" style={{ left: `${x(i)}%`, top: `${y(points[i].v)}%` }} />)}
          </div>
          <div className="v2-run-xticks v2-meta" aria-hidden="true"><span>{fmtDay(points[0].t)}</span><span>{fmtDay(points[points.length - 1].t)}</span></div>
          {summary && <p className="v2-meta v2-run-chart__sum">{summary}{hits.length ? `, with ${plural(hits.length, "flagged move")}` : ""}</p>}
        </>}
    </section>
  );
}

// ---------------------------------------------------------------- the timeline
export function Timeline({ timeline, tz, more, onMore }: { timeline: TimelineItem[]; tz: string; more: boolean; onMore: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const all = [...timeline].reverse().map(timeRow);
  const rows = more ? all : all.filter(r => r.story);
  const { shown, earlier, range } = foldDays(rows);
  const steps = all.length - all.filter(r => r.story).length;
  const row = (r: TimeRow) => (
    <li key={r.seq} className={`v2-run-tl__row${r.story ? "" : " is-step"}`}>
      <span className="v2-run-tl__when v2-num">Day {r.day} · {timeOfDay(r.at, tz)}</span>
      <div>
        <div className="v2-cap">{r.label}</div>
        <div className="v2-run-tl__t">{r.eventId ? <Link to={`/events/${r.eventId}`}>{r.text}</Link> : r.text}{r.note ? ` · ${r.note}` : ""}</div>
      </div>
    </li>);
  return (
    <aside className="v2-run-side" aria-label="Timeline">
      <SectionHead title="Timeline" size="sm" action={<span className="v2-meta">newest first</span>} />
      {!rows.length
        ? <p className="v2-run-tl__none">Each simulated day's headlines, findings and events appear here as the run goes.</p>
        : <ol id={bodyId} className="v2-run-tl">
          {shown.map(row)}
          {open && earlier.map(row)}
        </ol>}
      {range && (
        <button type="button" className="v2-run-link" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(o => !o)}>
          <span className={`v2-run-tri${open ? " is-open" : ""}`} aria-hidden="true" />{range}<span className="v2-sr"> ({plural(earlier.length, "line")})</span>
        </button>)}
      {(steps > 0 || more) && (
        <button type="button" className="v2-run-link" aria-pressed={more} onClick={() => onMore(!more)}>
          {more ? "Show only the story" : `Include the agents' own steps (${steps})`}
        </button>)}
    </aside>
  );
}

/** What stands in for the page while the first load is out. */
export function RunSkeleton() {
  return (
    <div className="v2-run-sk" aria-hidden="true">
      <SkBar w={260} h={24} r="var(--v2-r-sm)" />
      <SkBar w="min(520px, 100%)" h={44} r="var(--v2-r-sm)" />
      <SkBar w="100%" h={14} r="var(--v2-r-sm)" />
    </div>
  );
}
