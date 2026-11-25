// The event page's parts: what it says worked out once, where the event has got to, a product's possible impacts as one
// line, what happened, what was set aside, the report. The page (EventDetail.tsx) puts them in order.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { AlertItem } from "../../api/alerts";
import type { EventDetail, Hypothesis } from "../../api/investigation";
import { FactList, Places, TechnicalDetails } from "../../components/blocks";
import { CheckPill } from "../../components/checks";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/markdown";
import { useRole } from "../../components/ui";
import { dayTime, person, placeName } from "../../format";
import {
  angleLabel, count, dateRange, earliest, eventTitle, impactText, listText, metricWords, onDay, productTypeLabel, relDay, SCREENING,
  sizeTiming, sourceInfo, splitCheckText, themeLabel, words, type VerdictKey,
} from "../../plain";

export const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
/** What narrows a possible impact, in words: "from Saudi Arabia", "three wheeler". */
const segText = (h: Hypothesis) => !h.segment ? "" : h.segment.dimension === "corridor" ? `from ${placeName(h.segment.value)}` : words(h.segment.value);
/** The run's report covers every event it found: this event's part only, when it has a heading of its own. */
export function reportFor(md: string | null, title: string): string | null {
  if (!md) return null;
  const hit = md.split(/\n(?=## )/).find(p => p.startsWith(`## ${title}\n`));
  return hit ? hit.replace(/^## .*\n+/, "") : md;
}
const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();
const productOf = (h: Hypothesis) => h.product_name ?? h.product_id;
/** An alert's level and status as words after "has": "an early warning, waiting for review". */
const LEVEL_PHRASE: Record<string, string> = { warning: "an early warning", developing: "an alert showing early signs", adverse: "an alert confirmed by your data" };
const STATUS_PHRASE = (a: AlertItem) => a.status === "new" ? "waiting for review" : a.status === "acknowledged" ? (a.acknowledged_by ? `taken on by ${person(a.acknowledged_by)}` : "taken on") : "resolved";
export const alertPhrase = (a: AlertItem) => `${LEVEL_PHRASE[a.level] ?? "an alert"}, ${STATUS_PHRASE(a)}`;

/** Everything the page says, worked out once from the event and its alerts. */
export function derive(e: EventDetail, alerts: AlertItem[], alertsFailed = false) {
  const tasks = new Map(e.tasks.map(t => [t.hypothesis_id, t]));
  const effects = new Map(alerts.flatMap(a => a.effects).map(x => [x.hypothesis_id, x]));
  // the spec's metric name and whether the move is bad for you: from the alerts when they carry it, else from the task
  const metric = (h: Hypothesis) => effects.get(h.hypothesis_id)?.metric_name
    ?? (tasks.get(h.hypothesis_id)?.check ? splitCheckText(tasks.get(h.hypothesis_id)!.check!.what)[0] : metricWords(h.expected.metric));
  const adverse = (h: Hypothesis): boolean | null => {
    const t = tasks.get(h.hypothesis_id);
    if (t?.adverse_direction) return h.expected.direction === t.adverse_direction;
    if (effects.has(h.hypothesis_id)) return effects.get(h.hypothesis_id)!.adverse;
    return e.tone === "bad" ? true : e.tone === "good" ? false : null;
  };
  const hs = e.hypotheses;
  const nBad = hs.filter(h => adverse(h) === true).length, nGood = hs.filter(h => adverse(h) === false).length;
  const checks = hs.map(h => tasks.get(h.hypothesis_id)?.check).filter(c => !!c).map(c => ({ verdict: c!.verdict as VerdictKey, alert: c!.alert }));
  // teams in the order their alerts came, each with the impacts its alerts carry; impacts no alert carries go apart
  const teams = [...new Set(alerts.map(a => a.owner))].map(owner => {
    const as = alerts.filter(a => a.owner === owner), ids = new Set(as.flatMap(a => a.effects.map(x => x.hypothesis_id)));
    return { owner, alerts: as, hs: hs.filter(h => ids.has(h.hypothesis_id)) };
  });
  // checks agree when verdict and alert match and the impacts agree on bad-or-good; then the result is said once
  const advs = new Set(hs.map(adverse));
  const same = new Set(checks.map(c => `${c.verdict}|${c.alert}`)).size <= 1 && checks.length === hs.length && advs.size <= 1;
  const alerted = new Set(alerts.flatMap(a => a.effects.map(x => x.hypothesis_id)));
  const phrases = new Set(alerts.map(alertPhrase));
  return {
    e, alerts, alertsFailed, tasks, metric, adverse, nBad, nGood, checks, teams, free: hs.filter(h => !alerted.has(h.hypothesis_id)),
    tone: (nBad && nGood ? "mixed" : nBad ? "bad" : nGood ? "good" : "neutral") as "bad" | "good" | "mixed" | "neutral",
    checked: checks.filter(c => c.verdict !== "not_yet").length,
    same, sharedAdverse: advs.size === 1 ? adverse(hs[0]) : null,  // same: then no per-line result
    next: earliest(e.tasks.filter(t => !t.check?.final).map(t => t.next_check_after ?? t.check?.next_check_after)),
    products: [...new Set(hs.map(productOf))], toReview: alerts.filter(a => a.status === "new").length,
    onePhrase: phrases.size === 1 ? [...phrases][0] : null,  // said once above the teams when every alert shares it
    lead: e.findings[0], head: e.findings[0]?.evidence?.headlines?.[0],
    devs: [...e.developments].sort((a, b) => (a.joined_at < b.joined_at ? -1 : 1)),
    title: eventTitle(e), report: reportFor(e.run.report, e.title), allBad: hs.length > 1 && nBad === hs.length, validation: e.run.validation,
  };
}
export type D = ReturnType<typeof derive>;

/** Bad or good, said once for the event when every impact agrees. */
export const forYou = (d: D) => d.allBad ? (d.e.hypotheses.length === 2 ? "both bad for you" : "all bad for you")
  : d.nBad && d.nGood ? `${d.nBad} bad and ${d.nGood} good for you` : d.nBad ? "bad for you" : d.nGood ? "good for you" : "";

/** Where the event has got to. A green tick only where a person finished the step; the agent's own steps are plain dots,
 *  steps waiting on people amber. */
export function Progress({ d }: { d: D }) {
  const { e } = d, n = e.hypotheses.length;
  const s: { t: ReactNode; st: "agent" | "wait" | "person" | "off" | "now" }[] = [
    { t: <>Noticed <span>{onDay(e.anchor.slice(0, 10))}</span></>, st: "agent" },
    { t: e.run.status === "running" ? "Investigating" : "Investigated", st: e.run.status === "running" ? "now" : "agent" },
    { t: n ? count(n, "possible impact") : "No impact found", st: "agent" },
    d.alertsFailed ? { t: "Alerts couldn't be loaded", st: "off" }
      : d.teams.length ? { t: <>{count(d.teams.length, "team")} alerted <span>{d.toReview ? `${d.toReview} waiting for review` : "all taken on"}</span></>, st: d.toReview ? "wait" : "person" }
      : { t: "No alerts", st: "off" },
    !d.validation ? { t: "Checks switched off", st: "off" }
      : d.checked ? { t: <>{d.checked} of {n} checked{d.next && <span>next {onDay(d.next)}</span>}</>, st: d.next ? "now" : "agent" }
      : { t: <>Checks start <span>{d.next ? `${onDay(d.next)} (${relDay(d.next)})` : "with your data"}</span></>, st: "off" },
  ];
  return <ol className="evd-prog" aria-label="Where this event has got to">{s.map((x, i) =>
    <li key={i} className={`p-${x.st}`}><i aria-hidden="true">{x.st === "person" && <Icon name="check" />}</i><b>{x.t}</b>
      <span className="sr">{x.st === "person" ? "(done by a person)" : x.st === "wait" ? "(waiting for a person)" : x.st === "now" ? "(in progress)" : x.st === "off" ? "" : "(done)"}</span></li>)}</ol>;
}

/** One possible impact opened: why, what is watched, the check against your data; ids for the admin. */
function Detail({ d, h }: { d: D; h: Hypothesis }) {
  const { role } = useRole();
  const t = d.tasks.get(h.hypothesis_id), c = t?.check;
  const next = t?.next_check_after ?? c?.next_check_after;
  const rest = c ? splitCheckText(c.what)[1] : "";
  return <div className="evd-det">
    <FactList items={[
      ["Why", `${h.chain_label}.`],
      ["What we watch", <>{d.metric(h)}{segText(h) ? <span className="muted"> · {segText(h)}</span> : null}{t?.watch ? <span className="muted"> · {dateRange(t.watch.from, t.watch.until)}</span> : null}</>],
      ["Your data", !d.validation ? null : c ? <span className="ck-sum"><CheckPill c={{ verdict: c.verdict as VerdictKey, alert: c.alert, adverse: d.adverse(h) }} />
        {rest && <span>{rest}</span>}</span> : t ? "Not checked yet" : "No check for this one"],
      ["Next check", next && !c?.final ? <>{onDay(next)} <span className="muted">({relDay(next)})</span></> : null],
      ["How sure", c && !c.final && c.verdict !== "not_yet" && c.verdict !== "error" ? "First look; may change as more data comes in" : null],
    ]} />
    {c && <Link className="evd-small" to={c.spec_link}>What this metric means</Link>}
    {role === "platform_admin" && <TechnicalDetails><FactList items={[["Possible impact", <span className="mono">{h.hypothesis_id}</span>],
      ["Check", t ? <span className="mono">{t.task_id}</span> : null], ["Metric", <span className="mono">{h.expected.metric}</span>],
      ["Mechanism", <span className="mono">{h.mechanism_id}</span>], ["Watch", t?.watch ? `${t.watch.from} to ${t.watch.until}` : null],
      ["Scope", t?.scope_note ?? null], ["Tests", c?.checks.length ? c.checks.join("; ") : null], ["Revised", c?.supersedes ? `This ${c.supersedes.text}.` : null],
      ["Spec", c?.versions.spec ?? null], ["Catalog", c?.versions.catalog ?? null], ["Data", c?.versions.data ?? null], ["Validator", c?.versions.validator ?? null]]} /></TechnicalDetails>}
  </div>;
}

/** A product's possible impacts as one line: the same move from two angles is one line ("from Saudi Arabia and overall"),
 *  both angles in the detail. Bad or good only when the event's impacts differ; the result only when the checks differ. */
function ProductLine({ d, hs }: { d: D; hs: Hypothesis[] }) {
  const move = impactText(d.metric(hs[0]), hs[0].expected.direction);
  const segs = hs.map(segText).filter(Boolean);
  // every angle of one move shares its bad-or-good; a result shows on the line only when the angles' checks agree
  const mixed = d.nBad > 0 && d.nGood > 0, bads = new Set(hs.map(d.adverse)), bad = bads.size === 1 ? d.adverse(hs[0]) : null;
  const cs = hs.map(h => d.tasks.get(h.hypothesis_id)?.check);
  const c = cs.every(x => x && x.verdict === cs[0]?.verdict && x.alert === cs[0]?.alert) && bads.size === 1 ? cs[0] : undefined;
  return <details className="evd-line">
    <summary><span className="evd-l1"><b>{productOf(hs[0])}</b>: {lower(move)}
      {segs.length > 0 && <span className="muted"> ({listText(hs.length > segs.length ? [...segs, "overall"] : segs)})</span>}
      {mixed && bad !== null && <span className={`evd-for ${bad ? "bad" : "good"}`}> · {bad ? "bad for you" : "good for you"}</span>}</span>
      {d.validation && !d.same && c && <CheckPill c={{ verdict: c.verdict as VerdictKey, alert: c.alert, adverse: bad }} />}
      <span className="evd-st">{sizeTiming(hs[0].expected.size, hs[0].expected.timing)}</span>
      <Icon name="chevron" className="evd-chev" /></summary>
    {hs.map(h => <Detail key={h.hypothesis_id} d={d} h={h} />)}
  </details>;
}
/** Impacts as lines, in the order they came: one per product and move, so two angles on one move share a line and two
 *  different moves on one product each get their own. */
export function ProductLines({ d, hs }: { d: D; hs: Hypothesis[] }) {
  const key = (h: Hypothesis) => `${productOf(h)}|${impactText(d.metric(h), h.expected.direction)}`;
  return <>{[...new Set(hs.map(key))].map(k => <ProductLine key={k} d={d} hs={hs.filter(h => key(h) === k)} />)}</>;
}

/** Where it started, labelled; the reports that joined since in one line, the list on request. */
export function Story({ d }: { d: D }) {
  const [more, setMore] = useState(false);
  const { e, lead, head } = d;
  const si = lead ? sourceInfo(lead.source) : null, ref = lead?.source_ref ?? {};
  const last = d.devs[d.devs.length - 1];
  return <div className="evd-story">
    {lead && <p className="evd-src"><span>It started from</span>{si && <span className={`ev-lab src-${lead.source}`}><Icon name={si.icon} />{si.label}</span>}
      <span>{head?.url ? <a href={head.url} target="_blank" rel="noreferrer">{head.title ?? lead.title}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a> : head?.title ?? lead.title}
        <span className="muted"> · {[head?.outlet, onDay((head?.published_at ?? lead.created_at).slice(0, 10))].filter(Boolean).join(", ")}</span></span></p>}
    {lead?.explanation && <p>{firstSentence(lead.explanation)}</p>}
    {(ref.monitor_id || ref.series_id) && <Link className="ev-go" to={ref.monitor_id ? `/monitors/${ref.monitor_id}` : `/series/${ref.series_id}`}>
      {ref.monitor_id ? "Open the monitor" : "Open the price series"}<Icon name="arrow" /></Link>}
    {e.findings.length > 1 && <p>Also from {listText(e.findings.slice(1).map(f => `“${f.title}”`), 3)}.</p>}
    {(e.places.length > 0 || e.themes.length > 0) && <p className="evd-where">
      {e.places.length > 0 && <span className="ev-lab place"><Icon name="pin" /><Places codes={e.places} max={4} /></span>}
      <span className="muted">{e.themes.map(themeLabel).join(" · ")}</span></p>}
    {last && <div>
      <p><b>{count(d.devs.length, "more report")}</b> about the same thing joined it since, the latest {onDay(last.joined_at.slice(0, 10))}: “{last.title}”.</p>
      {more && <ol className="evd-devs">{d.devs.map(x => <li key={x.finding_id}><time dateTime={x.joined_at}>{dayTime(x.joined_at)}</time><span>{x.title}</span></li>)}</ol>}
      <button type="button" className="ev-more" aria-expanded={more} onClick={() => setMore(!more)}>
        <Icon name="chevron" className={more ? "rot" : undefined} />{more ? "Show fewer" : `Show the ${d.devs.length}`}</button>
    </div>}
  </div>;
}

/** What the investigation weighed and set aside, a sentence each. */
export const SetAside = ({ d }: { d: D }) => <ul className="evd-aside">{d.e.set_aside.map((s, i) =>
  <li key={i}><b>{productTypeLabel(s.product_type)}</b>, {lower(angleLabel(s.angle))}: {lower(SCREENING[s.decision] ?? "no clear link")}. <span className="muted">{s.reason}</span></li>)}</ul>;

/** The investigation's report, folded; this event's part of it. */
export const Report = ({ d }: { d: D }) => <details className="evd-fold"><summary><Icon name="book" />The full investigation report
  <span className="muted">written by AMIRI Agent</span><Icon name="chevron" className="evd-chev" /></summary>
  <div className="evd-rep">{d.report ? <Markdown text={d.report} /> : <span className="muted">No report.</span>}</div></details>;
