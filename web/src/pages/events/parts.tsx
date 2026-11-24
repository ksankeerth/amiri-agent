// The Event page's parts (board 02): the title and four steps, the chain (what happened → the event → your products),
// the assessment, alerts raised and when you'll know, plus the states under it (boards 15 section C, 16 section E).
// Page logic is in ./EventDetail.tsx; the words and rules are in ./eventWords.ts and ./words.ts.
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AlertItem } from "../../api/alerts";
import type { EventDetail, Hypothesis } from "../../api/investigation";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/markdown";
import { Button } from "../../components/v2/Button";
import { DirectionMark } from "../../components/v2/Direction";
import { DIRECTIONS, directionOf } from "../../components/v2/directionWords";
import { Empty } from "../../components/v2/Empty";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { ChecksOff, Verdict } from "../../components/v2/Verdict";
import { verdictLook } from "../../components/v2/verdictWords";
import { WorldMark } from "../../components/v2/WorldMark";
import { day, dayTime, placeName } from "../../format";
import { anchorLabel, cap, count, dateRange, impactText, listText, onDay, sizeTiming, splitCheckText, themeLabel, type VerdictKey } from "../../plain";
import {
  alertLook, alertStatus, arrowFor, asideTypes, assessmentText, checksUntil, dataSays, expectedParts, findingSource, joinedText, parseBand, parseNum,
  periodLayout, progressSteps, retriedText, runState, scaleLayout, whenYoullKnow, type ToneKey,
} from "./eventWords";
import { againstOf, asideMeaning, groupAside, otherEventsInReport, plannedTests, STRICTER, testWords, today, untracedWhy, type Threshold } from "./words";

// the task carries more than the shared type names; these are the parts this page reads
export type Task = EventDetail["tasks"][number] & { method?: string; thresholds?: Threshold[] };
type Finding = EventDetail["findings"][number];
const SOURCE_ICON: Record<string, string> = { monitor: "monitor", timeseries: "series", radar: "radar", studio: "studio" };
const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Everything the parts need about the event, worked out once by the page. */
export interface EventModel {
  e: EventDetail;
  alerts: AlertItem[];
  title: string;
  tone: ToneKey;
  tasks: Map<string, Task>;
  metricName: (h: Hypothesis) => string;
  adverseOf: (h: Hypothesis) => boolean | null;
  alertOf: Map<string, AlertItem>;
  checked: number;
  teams: number;
  pickedUp: string | null;
}

// ---------------------------------------------------------------- the title and the four steps
export function EventHead({ m }: { m: EventModel }) {
  const { e } = m;
  const places = e.places.map(placeName);
  const closed = e.status !== "open";
  const until = closed ? checksUntil(e.tasks, today()) : null;
  const steps = progressSteps({ findings: e.findings.length, effects: e.hypotheses.length, teams: m.teams, checked: m.checked, validation: e.run.validation });
  return (
    <header className="v2-ev-head">
      <div className="v2-ev-pills">
        <Pill tone={DIRECTIONS[directionOf(m.tone)].pill} mark={<DirectionMark tone={m.tone} size={10} />}>{DIRECTIONS[directionOf(m.tone)].word}</Pill>
        <Pill>{closed ? `Closed${e.closed_at ? ` ${day(e.closed_at)}` : ""}` : `Open until ${day(e.open_until)}`}</Pill>
        <WorldMark world={e.world} />
        <span className="v2-meta">
          {[places.length ? listText(places, 2) : null, m.pickedUp ? `first seen ${dayTime(m.pickedUp)}` : null, until ? `checks can still arrive until ${until}` : null].filter(Boolean).join(" · ")}
        </span>
      </div>
      <h1 className={`v2-ev-h1${closed ? " is-closed" : ""}`}>{m.title}</h1>
      <ol className="v2-ev-steps" aria-label="How far it has got">
        {steps.map(s => (
          <li key={s.label} className="v2-ev-step">
            <span className="v2-ev-step__bar" aria-hidden="true" style={{ "--fill": `${Math.round(s.fill * 100)}%` } as React.CSSProperties} />
            <b className="v2-ev-step__t">{s.label}</b>
            <span className="v2-ev-step__v">{s.value}</span>
          </li>
        ))}
      </ol>
    </header>
  );
}

// ---------------------------------------------------------------- the investigation's own state (boards 15, 16)
export function RunBanner({ status, busy, onAgain }: { status: string; busy: boolean; onAgain: () => void }) {
  const s = runState(status);
  if (s === "ok") return null;
  if (s === "running") {
    return (
      <div className="v2-ev-run" role="status">
        <span className="v2-ev-run__dots" aria-hidden="true"><i /><i /><i /></span>
        <b>Amiri Agent is still investigating this.</b>
        <span className="v2-meta">What it finds appears here as it goes; the page updates itself.</span>
      </div>
    );
  }
  return (
    <div className="v2-ev-stop" role="status">
      <Pill tone="bad">{s === "stopped" ? "Stopped early" : "Failed"}</Pill>
      <span className="v2-ev-stop__t">{s === "stopped" ? "The investigation stopped before tracing every product, so this event may be incomplete." : "The investigation failed, so this event may be incomplete."}</span>
      <Button size="sm" onClick={onAgain} disabled={busy}>{busy ? "Starting…" : "Investigate again"}</Button>
    </div>
  );
}

// ---------------------------------------------------------------- the chain
export interface ChainProps {
  m: EventModel;
  open: string | null;
  onToggle: (hypothesisId: string) => void;
  onSeeWhy: () => void;
}
export function Chain({ m, open, onToggle, onSeeWhy }: ChainProps) {
  const { e } = m;
  const n = e.hypotheses.length;
  return (
    <section aria-label="From the news to your products" className="v2-panel v2-ev-chain">
      <Findings m={m} />
      <span className="v2-ev-arrow" aria-hidden="true" />
      <EventCard m={m} />
      <span className="v2-ev-arrow" aria-hidden="true" />
      {n ? <Products m={m} open={open} onToggle={onToggle} /> : <NoneExposed m={m} onSeeWhy={onSeeWhy} />}
    </section>
  );
}

function Findings({ m }: { m: EventModel }) {
  const { e } = m;
  const [listOpen, setListOpen] = useState(false);
  const [all, setAll] = useState(false);
  const id = useId();
  const findings = [...e.findings].sort((a, b) => when(a).localeCompare(when(b)));
  const joined = [...e.developments].sort((a, b) => b.joined_at.localeCompare(a.joined_at));
  const shown = all ? joined : joined.slice(0, 10);
  const prices = findings.length > 0 && findings.every(f => f.source === "timeseries");
  return (
    <div className="v2-ev-col v2-ev-col--found">
      <h2 className="v2-cap v2-ev-colh">What happened · {count(findings.length, prices ? "price move" : "finding")}</h2>
      <ul className="v2-ev-finds">{findings.map(f => <FindingRow key={f.finding_id} f={f} />)}</ul>
      {joined.length > 0 && (
        <>
          <button type="button" className="v2-ev-link" aria-expanded={listOpen} aria-controls={id} onClick={() => setListOpen(v => !v)}>
            {joinedText(joined.length)}<span aria-hidden="true"> {listOpen ? "▾" : "▸"}</span>
          </button>
          <div id={id} hidden={!listOpen}>
            <ol className="v2-ev-devs">{shown.map(d => (
              <li key={d.finding_id}><span>{d.title}</span> <span className="v2-meta">· joined {dayTime(d.joined_at)}</span></li>
            ))}</ol>
            {joined.length > 10 && <p className="v2-ev-devs__more v2-meta">
              {all ? `Showing all ${joined.length}. ` : `Showing the latest 10 of ${joined.length}. `}
              <button type="button" className="v2-ev-link v2-ev-link--inline" onClick={() => setAll(v => !v)}>{all ? "Show the latest 10" : `Show all ${joined.length}`}</button>
            </p>}
          </div>
        </>
      )}
    </div>
  );
}

const when = (f: Finding) => f.evidence?.headlines?.[0]?.published_at ?? f.created_at;

/** A report that started the event: its headline (linked), where it came from and when, and Amiri Agent's line. */
function FindingRow({ f }: { f: Finding }) {
  const h = f.evidence?.headlines?.[0], ref = f.source_ref ?? {};
  const to = ref.monitor_id ? `/monitors/${ref.monitor_id}` : ref.series_id ? `/series/${ref.series_id}` : undefined;
  const retried = retriedText(f.outcome);
  const title = h?.title ?? f.title;
  return (
    <li className="v2-ev-find">
      <span className="v2-ev-find__icon" aria-hidden="true"><Icon name={SOURCE_ICON[f.source] ?? "info"} /></span>
      <div className="v2-ev-find__body">
        <div className="v2-ev-find__t">{h?.url
          ? <a href={h.url} target="_blank" rel="noreferrer">{title}<span aria-hidden="true"> ↗</span><span className="v2-sr"> (opens the article)</span></a>
          : title}</div>
        <div className="v2-ev-find__m">
          {[findingSource(f), day(when(f))].join(" · ")}
          {retried && <> · <Pill tone="unusual">{retried}</Pill></>}
          {to && <> · <Link to={to}>{ref.monitor_id ? "Open the monitor" : "Open the price series"}</Link></>}
        </div>
        {f.explanation && <p className="v2-ev-find__why" title={f.explanation}>{f.explanation}</p>}
      </div>
    </li>
  );
}

function EventCard({ m }: { m: EventModel }) {
  const { e } = m;
  const themes = e.themes.filter(t => !t.implied).concat(e.themes.filter(t => t.implied));
  return (
    <div className="v2-ev-event">
      <h2 className="v2-cap v2-ev-event__cap">The event</h2>
      <p className="v2-ev-event__t">{m.title}</p>
      <p className="v2-ev-event__m">Anchored on: {lower(anchorLabel(e.anchor_basis))}, {day(e.anchor)}</p>
      {themes.length > 0 && <p className="v2-ev-event__m">Themes: {listText(themes.map(t => themeLabel(t).toLowerCase()), 4)}</p>}
    </div>
  );
}

/** Nothing exposed (board 15 section C): a dashed box in place of the product rows. */
function NoneExposed({ m, onSeeWhy }: { m: EventModel; onSeeWhy: () => void }) {
  const { e } = m;
  const types = asideTypes(e.set_aside);
  return (
    <div className="v2-ev-col v2-ev-none">
      <h2 className="v2-ev-none__t">None of your products is exposed</h2>
      <p className="v2-ev-none__m">
        {types > 0 ? `Amiri Agent looked at ${count(types, "product type")} and set ${types === 1 ? "it" : "them"} aside.` : "Amiri Agent found no product of yours that this could reach."}
        {" "}
        {e.set_aside.length > 0
          ? <button type="button" className="v2-ev-link" onClick={onSeeWhy}>See why<span aria-hidden="true"> ▸</span></button>
          : e.run.report ? <button type="button" className="v2-ev-link" onClick={onSeeWhy}>Read the report<span aria-hidden="true"> ▸</span></button> : null}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- your products: the rows
function Products({ m, open, onToggle }: { m: EventModel; open: string | null; onToggle: (id: string) => void }) {
  const { e } = m;
  const t0 = today();
  return (
    <div className="v2-ev-col v2-ev-col--prod">
      <h2 className="v2-sr">Your products and what your data says</h2>
      <div role="table" aria-label="Your products: what is expected and what your data says" className="v2-ev-prods">
        <div role="row" className="v2-ev-prod v2-ev-prod--head">
          <span role="columnheader"><span className="v2-sr">Direction</span></span>
          <span role="columnheader" className="v2-cap">Your product · metric</span>
          <span role="columnheader" className="v2-cap">Expected</span>
          <span role="columnheader" className="v2-cap">Your data says</span>
          <span role="columnheader"><span className="v2-sr">Details</span></span>
        </div>
        <div role="rowgroup">
          {e.hypotheses.map(h => {
            const t = m.tasks.get(h.hypothesis_id), c = t?.check;
            const adverse = m.adverseOf(h);
            const arrow = arrowFor(h.expected.direction, adverse);
            const x = expectedParts(h.expected.size, h.expected.timing);
            const says = dataSays(t, t0);
            const isOpen = open === h.hypothesis_id;
            const name = h.product_name ?? h.product_id;
            const panel = `impact-${h.hypothesis_id}-open`;
            return (
              <div key={h.hypothesis_id} id={`impact-${h.hypothesis_id}`} className="v2-ev-prodgroup">
                <div role="row" className={`v2-ev-prod${isOpen ? " is-open" : ""}`}>
                  <span role="cell" className={`v2-ev-prod__arrow is-${arrow.tone}`}><b aria-hidden="true">{arrow.glyph}</b><span className="v2-sr">{arrow.word}</span></span>
                  <span role="cell" className="v2-ev-prod__name">
                    <button type="button" className="v2-ev-open" aria-expanded={isOpen} aria-controls={panel} onClick={() => onToggle(h.hypothesis_id)}>
                      <span>{name}</span>
                    </button>
                    <span className="v2-ev-prod__metric">{m.metricName(h)}</span>
                  </span>
                  <span role="cell" className="v2-ev-prod__exp v2-num">
                    {x.size ? <><b>{x.size}</b>{x.when ? ` ${x.when}` : ""}</> : x.when ?? "—"}
                  </span>
                  <span role="cell" className="v2-ev-prod__says">
                    {c ? (says.pill ? <Pill>{says.pill}</Pill> : <Verdict verdict={c.verdict} text={c.verdict_text} />)
                      : t ? <Pill>{says.pill ?? "Not checked yet"}</Pill>
                      : e.run.validation ? <Pill>No check</Pill> : <ChecksOff />}
                    {says.line && <span className="v2-ev-prod__line">{says.line}</span>}
                  </span>
                  <span role="cell" className="v2-ev-prod__chev" aria-hidden="true"><Icon name="chevron" /></span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- one impact opened: expected against your data
/** Expected (Amiri Agent's assessment, AI) against your data so far (counted by code): the figure, the result, a scale,
 *  the tests that decided it, then one quiet line and the technical details. */
export function ImpactDetail({ h, t, metric, adverse, team, onClose }: { h: Hypothesis; t: Task | undefined; metric: string; adverse: boolean | null; team?: string; onClose: () => void }) {
  const c = t?.check;
  const v = c?.verdict as VerdictKey | undefined;
  const next = t?.next_check_after ?? c?.next_check_after;
  const method = t?.method;
  const against = againstOf(method);
  const tests = (c?.checks ?? []).map(line => ({ line, w: testWords(line, method, c?.final) }));
  const planned = !c || v === "not_yet" ? plannedTests(t?.thresholds ?? [], method, t?.expected_direction ?? h.expected.direction, !!c?.final) : [];
  const watch = t?.watch;
  const t0 = today();
  const reason = (why: string | null | undefined) => !why ? null
    : /hasn't published enough/.test(why) ? "Not enough of the watch period is in your figures yet."
    : /period to watch hasn't started/.test(why) ? "The watch period hasn't started yet." : `${cap(why)}.`;
  const fig = parseNum(c?.change);
  const changeTest = tests.find(x => /^change /.test(x.line));
  const thr = parseNum(changeTest?.line.match(/needed ([^ ]+(?: pp|%)?)/)?.[1]);
  const unit = c?.change?.includes("pp") ? " pp" : c?.change?.includes("%") ? "%" : "";
  const fmt = (x: number) => `${x < 0 ? "−" : x > 0 ? "+" : ""}${Math.abs(x).toFixed(unit === " pp" ? 2 : 1)}${unit}`;
  const band = parseBand(c?.usual);

  const sure = !c ? null : v === "not_yet" ? (c.as_of ? `last checked ${onDay(c.as_of)}` : null)
    : c.final ? `final${c.as_of ? `, checked ${onDay(c.as_of)}` : ""}`
    : v === "error" ? (c.as_of ? `tried ${onDay(c.as_of)}` : null)
    : `a first look, may change as more data comes in${c.as_of ? `; checked ${onDay(c.as_of)}` : ""}`;
  const nextText = c?.final ? null : next ? (next < t0 ? "check due" : next === t0 ? "next check today" : `next check ${onDay(next)}`) : null;
  const quiet = [sure, nextText, watch ? `watched ${dateRange(watch.from, watch.until)}` : null].filter(Boolean) as string[];
  const name = h.product_name ?? h.product_id;

  return (
    <div className="v2-ev-detail">
      <div className="v2-ev-detail__h">
        <h3 className="v2-title">{name} <span className="v2-ev-detail__m">· {lower(metric)}</span></h3>
        {team && <span className="v2-meta">alerted the {team} team</span>}
        <Button variant="quiet" size="sm" className="v2-ev-detail__close" onClick={onClose}>Close</Button>
      </div>

      <div className="v2-ev-vs">
        <div>
          <p className="v2-cap v2-ev-vs__l">Expected · Amiri Agent's assessment (AI)</p>
          <p className="v2-ev-vs__big">{impactText(metric, h.expected.direction)}</p>
          <p className="v2-ev-vs__s">{sizeTiming(h.expected.size, h.expected.timing)}{adverse !== null && <> · <b className={adverse ? "v2-ev-bad" : "v2-ev-good"}>{adverse ? "Bad for you" : "Good for you"}</b></>}</p>
          <p className="v2-ev-vs__why">Because {lower(h.chain_label)}.</p>
        </div>
        <div>
          <p className="v2-cap v2-ev-vs__l">Your data so far · counted by code, from your figures</p>
          {!c ? <>
            <p className="v2-ev-vs__big">{t ? "Not checked yet" : "No check"}</p>
            <p className="v2-ev-vs__why">{t ? "The first check runs once your figures for the watch period come in." : "Checks against your data are switched off for this investigation."}</p>
          </> : v === "not_yet" ? <>
            <p className="v2-ev-vs__big">{verdictLook("not_yet", c.verdict_text).label}</p>
            <p className="v2-ev-vs__why">{reason(c.why) ?? splitCheckText(c.what)[1]}</p>
          </> : fig !== null ? <>
            <p className="v2-ev-vs__fig v2-num">{c.change}</p>
            {against && <p className="v2-ev-vs__s">against {against}</p>}
            <p className="v2-ev-vs__res"><Verdict verdict={c.verdict} text={c.verdict_text} /></p>
          </> : <>
            <p className="v2-ev-vs__res"><Verdict verdict={c.verdict} text={c.verdict_text} /></p>
            <p className="v2-ev-vs__why">{reason(c.why) ?? splitCheckText(c.what)[1]}</p>
          </>}
        </div>
      </div>

      {fig !== null && v !== "not_yet" && c && <FigureScale fig={fig} band={band} thr={thr ?? undefined} yours={c.change!} usual={c.usual} start={thr !== null ? fmt(thr) : undefined} />}
      {watch && (!c || v === "not_yet") && <PeriodScale from={watch.from} until={watch.until} today={t0} />}

      {tests.length > 0 && (
        <div className="v2-ev-tests">
          <h4 className="v2-title">Why “{verdictLook(c!.verdict, c!.verdict_text).label.toLowerCase()}”</h4>
          <p className="v2-meta">{tests.length > 1 ? "An effect counts only when every test is met." : "An effect counts only when this test is met."}</p>
          <table className="v2-ev-tests__t">
            <thead><tr><th scope="col">Needed</th><th scope="col">Yours</th><th scope="col"><span className="v2-sr">Met?</span></th></tr></thead>
            <tbody>{tests.map(({ line, w }) => w
              ? <tr key={line}><td>{cap(w.needed)}{w.stricter && <span className="v2-meta"> ({STRICTER})</span>}</td><td className="v2-ev-tests__y">{w.yours}</td><td className="v2-ev-tests__met">{w.met ? "met" : "not met"}</td></tr>
              : <tr key={line}><td colSpan={3}>{line}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      {planned.length > 0 && (
        <div className="v2-ev-tests">
          <h4 className="v2-title">What will count as an effect</h4>
          <p className="v2-meta">{planned.length === 2 ? "Both must hold:" : planned.length > 2 ? `All ${planned.length} must hold:` : "This must hold:"}</p>
          <ul className="v2-ev-planned">{planned.map(p => <li key={p.text}>{cap(p.text)}{p.stricter && <span className="v2-meta"> ({STRICTER})</span>}</li>)}</ul>
        </div>
      )}

      <p className="v2-ev-quiet v2-meta">
        {quiet.map(q => <span key={q}>{cap(q)}</span>)}
        {c && <span><Link to={c.spec_link}>What this metric means</Link></span>}
      </p>
      {(c || t) && (
        <details className="v2-ev-tech">
          <summary>Technical details</summary>
          <Facts items={[
            ["Check", t ? <code>{t.task_id}</code> : null],
            ["Metric", <code>{h.expected.metric}</code>],
            ["Watch", t?.watch ? `${t.watch.from} to ${t.watch.until}` : null],
            ["Scope", t?.scope_note ?? null],
            ["Tests", c?.checks.length ? c.checks.join("; ") : null],
            ["Revised", c?.supersedes ? `This ${c.supersedes.text}.` : null],
            ["Spec", c?.versions.spec ?? null], ["Catalog", c?.versions.catalog ?? null],
            ["Data", c?.versions.data ?? null], ["Validator", c?.versions.validator ?? null],
          ]} />
        </details>
      )}
    </div>
  );
}

/** The opened impact, as a panel under the chain (it needs the width the product column hasn't). */
export function ImpactPanel({ m, hid, onClose }: { m: EventModel; hid: string; onClose: () => void }) {
  const h = m.e.hypotheses.find(x => x.hypothesis_id === hid);
  if (!h) return null;
  return (
    <section id={`impact-${hid}-open`} className="v2-panel v2-ev-detailpanel" aria-label={`${h.product_name ?? h.product_id}: expected against your data`}>
      <ImpactDetail h={h} t={m.tasks.get(hid)} metric={m.metricName(h)} adverse={m.adverseOf(h)} team={m.alertOf.get(hid)?.owner} onClose={onClose} />
    </section>
  );
}

/** Your figure against the usual range and where an effect starts: a track, and the words under it. */
function FigureScale({ fig, band, thr, yours, usual, start }: { fig: number; band?: [number, number]; thr?: number; yours: string; usual: string | null; start?: string }) {
  const l = scaleLayout(fig, band, thr);
  return (
    <div className="v2-ev-scale">
      <div className="v2-ev-scale__track" aria-hidden="true">
        {l.band && <i className="v2-ev-scale__band" style={{ left: `${l.band.left}%`, width: `${l.band.width}%` }} />}
        {l.thr !== undefined && <i className="v2-ev-scale__thr" style={{ left: `${l.thr}%` }} />}
        <i className="v2-ev-scale__fig" style={{ left: `${l.fig}%` }} />
      </div>
      <ul className="v2-ev-scale__key v2-meta">
        <li><i className="v2-ev-scale__sw is-fig" aria-hidden="true" />Yours {yours}</li>
        {band && <li><i className="v2-ev-scale__sw is-band" aria-hidden="true" />Usual range {usual}</li>}
        {start && <li><i className="v2-ev-scale__sw is-thr" aria-hidden="true" />An effect starts at {start}</li>}
      </ul>
    </div>
  );
}

/** Before any figure is in: where today sits inside the watch period. */
function PeriodScale({ from, until, today: t }: { from: string; until: string; today: string }) {
  const p = periodLayout(from, until, t);
  const word = p.state === "before" ? "starts later" : p.state === "after" ? "ended" : `today, ${onDay(t)}`;
  return (
    <div className="v2-ev-scale">
      <div className="v2-ev-scale__track" aria-hidden="true">
        <i className="v2-ev-scale__band" style={{ left: 0, width: `${p.at}%` }} />
        <i className="v2-ev-scale__fig" style={{ left: `${p.at}%` }} />
      </div>
      <p className="v2-meta v2-ev-scale__period">Watch period {dateRange(from, until)}; {word}</p>
    </div>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return <dl className="v2-ev-facts">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

// ---------------------------------------------------------------- under the chain
export interface AssessmentProps { m: EventModel; reportOpen: boolean; onReport: (v: boolean) => void; asideOpen: boolean; onAside: (v: boolean) => void }
export function Assessment({ m, reportOpen, onReport, asideOpen, onAside }: AssessmentProps) {
  const { e } = m;
  const text = assessmentText(e.hypotheses);
  const why = e.hypotheses.length ? null : untracedWhy(e.run.report, e.findings.map(f => f.title));
  const groups = groupAside(e.set_aside);
  const others = otherEventsInReport(e.run.report);
  const reportId = useId();
  return (
    <section aria-labelledby="ev-as" className="v2-ev-assess">
      <div className="v2-ev-assess__h">
        <h2 id="ev-as" className="v2-title-lg">Amiri Agent's assessment</h2>
        <Pill>Written by AI</Pill>
      </div>
      <div className="v2-ev-ai">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" focusable="false" className="v2-ev-ai__spark"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>
        <div className="v2-ev-ai__body">
          {text ? <p className="v2-ev-ai__t">{text}</p>
            : why ? <p>The investigation that opened this event says: “{why}”</p>
            : <p>Nothing was traced to your products. The investigation report says why.</p>}
          {e.run.report && (
            <button type="button" className="v2-ev-link" aria-expanded={reportOpen} aria-controls={reportId} onClick={() => onReport(!reportOpen)}>
              {reportOpen ? "Hide the investigation report" : "Read the full investigation report"}<span aria-hidden="true"> {reportOpen ? "▾" : "▸"}</span>
            </button>
          )}
        </div>
      </div>
      <div id={reportId} hidden={!reportOpen} className="v2-ev-report">
        <p className="v2-meta">Written by Amiri Agent (AI) · covers the whole investigation{others ? `, which also covers ${count(others, "other event")}` : ", not only this event"}</p>
        {reportOpen && e.run.report && <div className="v2-ev-report__md"><Markdown text={e.run.report} under={2} /></div>}
      </div>

      {groups.length > 0 && (
        <details id="set-aside" className="v2-ev-aside" open={asideOpen} onToggle={ev => onAside((ev.currentTarget as HTMLDetailsElement).open)}>
          <summary>Considered, no impact · {e.set_aside.length}</summary>
          <p className="v2-meta v2-ev-aside__lede">Looked at and not sent to a team · Amiri Agent's judgement (AI)</p>
          <ul className="v2-ev-aside__list">{groups.map((g, i) => (
            <li key={i}>
              <b>{g.links.length > 1 ? `${g.links.length} links set aside for the same reason` : g.links[0]}</b>
              <span className="v2-ev-aside__reason">“{g.reason}”</span>
              {g.links.length > 1 && <ul className="v2-ev-aside__links">{g.links.map(l => <li key={l}>{l}</li>)}</ul>}
              <span className="v2-meta">In plain words: {asideMeaning(g)}</span>
            </li>
          ))}</ul>
        </details>
      )}
    </section>
  );
}

export function SideColumn({ m }: { m: EventModel }) {
  const { e, alerts } = m;
  const know = whenYoullKnow({ tasks: e.tasks, status: e.status, open_until: e.open_until, closed_at: e.closed_at, today: today() });
  const nBad = e.hypotheses.filter(h => m.adverseOf(h) === true).length;
  return (
    <aside className="v2-ev-side" aria-label="Alerts and dates">
      <section aria-labelledby="ev-ar">
        <SectionHead id="ev-ar" size="sm" title="Alerts raised" count={alerts.length || undefined} countLabel={alerts.length === 1 ? "alert" : "alerts"} />
        {alerts.length > 0 ? (
          <ul className="v2-ev-alerts">{alerts.map(a => {
            const look = alertLook(a.level);
            return (
              <li key={a.alert_id}>
                <Link to="/alerts" className="v2-ev-alert">
                  <Pill tone={look.tone}>{look.label}</Pill>
                  <span className="v2-ev-alert__t"><span>{a.owner}</span><span className="v2-meta">{cap(alertStatus(a))}</span></span>
                  <span className="v2-ev-alert__n v2-meta">{count(a.effects.length, "effect")}<span aria-hidden="true"> ›</span></span>
                </Link>
              </li>
            );
          })}</ul>
        ) : (
          <p className="v2-ev-side__none v2-meta">{e.hypotheses.length === 0 ? "Nothing was traced to your products, so there is nothing to send." : nBad === 0 ? "Nothing here is bad for you, so no team was alerted." : "No team has been alerted yet."}</p>
        )}
      </section>
      <section aria-labelledby="ev-wk">
        <SectionHead id="ev-wk" size="sm" title="When you'll know" />
        {know.length > 0 && <dl className="v2-ev-know">{know.map(k => <div key={k.label} className="v2-ev-know__row"><dt>{k.label}</dt><dd>{k.value}</dd></div>)}</dl>}
      </section>
    </aside>
  );
}

export function TechnicalDetails({ e }: { e: EventDetail }) {
  return (
    <details className="v2-ev-tech v2-ev-tech--page">
      <summary>Technical details</summary>
      <p className="v2-meta">Event and investigation IDs, findings and scores, places, open until</p>
      <Facts items={[
        ["Event", <code key="e">{e.event_id}</code>], ["Investigation", <code key="r">{e.run.run_id}</code>],
        ["Findings", <code key="f">{e.findings.map(f => `${f.finding_id} (score ${f.score})`).join(", ")}</code>],
        ["Places", <code key="p">{e.places.join(", ")}</code>], ["Open until", dayTime(e.open_until)],
      ]} />
    </details>
  );
}

export function NotFound() {
  return (
    <div className="v2-ev">
      <h1 className="v2-ev-h1">Event not found</h1>
      <Empty title="This event isn't here" action={<Button as="link" to="/events" variant="primary">See all events</Button>}>
        It may have been removed when the prototype was reset.
      </Empty>
    </div>
  );
}

