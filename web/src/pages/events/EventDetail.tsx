// One event: what happened, why it matters to you, when your data will tell, then the detail on demand.
import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventDetail, type Hypothesis } from "../../api/investigation";
import { alertsApi, type AlertItem } from "../../api/alerts";
import { FactList, HowItWorks, ImpactMarker, ImpactRow, PageHeader, Places, Row, Section, SourceCard, Steps, StatusPill, TechnicalDetails, type Step } from "../../components/blocks";
import { CheckPill, CheckSummary } from "../../components/checks";
import { Icon } from "../../components/Icon";
import { Markdown } from "../../components/markdown";
import { Banner, Empty, PageSkeleton } from "../../components/ui";
import { dayTime } from "../../format";
import {
  ALERT_STATUS, checkMove, count, dateRange, earliest, impactText, LEVEL_LABEL, LEVEL_TONE, listText, longWhen, metricWords, onDay,
  productAngle, relDay, SCREENING, sizeTiming, sourceInfo, splitCheckText, themeLabel, verdictWhy, type VerdictKey,
} from "../../plain";

type Task = EventDetail["tasks"][number];
const TONE_PILL: Record<"bad" | "good" | "mixed" | "neutral", ReactNode> = {
  bad: <ImpactMarker adverse={true} />, good: <ImpactMarker adverse={false} />,
  mixed: <StatusPill tone="amber">Mixed for you</StatusPill>, neutral: <StatusPill tone="grey">Neutral for you</StatusPill>,
};

export function EventDetailPage() {
  const { id = "" } = useParams();
  const [e, setE] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<ApiError | string | null>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  useEffect(() => { investigationApi.event(id).then(setE).catch(x => setErr(x instanceof ApiError ? x : String(x))); }, [id]);
  useEffect(() => { alertsApi.list({ event_id: id }).then(setAlerts).catch(() => setAlerts([])); }, [id]);
  if (err instanceof ApiError && err.status === 404) return (
    <div className="page"><PageHeader title="Event not found" crumbs={<Link to="/events">Events</Link>} />
      <div className="card"><Empty icon="events" title="This event isn't here" actions={<Link className="btn" to="/events">See all events</Link>}>
        It may have been removed when the prototype was reset.</Empty></div></div>);
  if (!e) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err instanceof ApiError ? err.full : err}</Banner> : <PageSkeleton bare />}</div>;

  const tasks = new Map(e.tasks.map(t => [t.hypothesis_id, t]));
  // the spec's metric name and whether the move is bad for you: from the alerts when they carry it, else from the task
  const effects = new Map(alerts.flatMap(a => a.effects).map(x => [x.hypothesis_id, x]));
  const metricName = (h: Hypothesis) => effects.get(h.hypothesis_id)?.metric_name
    ?? (tasks.get(h.hypothesis_id)?.check ? splitCheckText(tasks.get(h.hypothesis_id)!.check!.what)[0] : metricWords(h.expected.metric));
  const adverseOf = (h: Hypothesis): boolean | null => {
    const t = tasks.get(h.hypothesis_id);
    if (t?.adverse_direction) return h.expected.direction === t.adverse_direction;
    if (effects.has(h.hypothesis_id)) return effects.get(h.hypothesis_id)!.adverse;
    return e.tone === "bad" ? true : e.tone === "good" ? false : null;
  };
  const checks = e.hypotheses.map(h => tasks.get(h.hypothesis_id)?.check).filter(c => !!c)
    .map(c => ({ verdict: c!.verdict as VerdictKey, alert: c!.alert }));
  const checkOf = (h: Hypothesis) => { const c = tasks.get(h.hypothesis_id)?.check; return c ? { verdict: c.verdict as VerdictKey, alert: c.alert, adverse: adverseOf(h) } : null; };
  const same = new Set(checks.map(c => c.verdict)).size <= 1 && checks.length === e.hypotheses.length;
  const next = earliest(e.tasks.filter(t => !t.check?.final).map(t => t.next_check_after ?? t.check?.next_check_after));
  const checked = checks.filter(c => c.verdict !== "not_yet").length;
  const nBad = e.hypotheses.filter(h => adverseOf(h) === true).length, nGood = e.hypotheses.filter(h => adverseOf(h) === false).length;
  const teams = [...new Set(alerts.map(a => a.owner))];
  const toReview = alerts.filter(a => a.status === "new").length;
  const lead = e.findings[0];
  const headline = lead?.evidence?.headlines?.[0];
  const src = lead ? sourceInfo(lead.source) : null;

  const steps: Step[] = [
    { label: "Noticed", detail: onDay(e.anchor.slice(0, 10)), state: "done", icon: "eye" },
    { label: "Investigated", detail: e.run.status === "running" ? "in progress" : "linked to this event", state: e.run.status === "running" ? "now" : "done", icon: "search" },
    { label: e.hypotheses.length ? count(e.hypotheses.length, "possible impact") : "No impacts found", detail: e.hypotheses.length ? count(new Set(e.hypotheses.map(h => h.product_id)).size, "product") : undefined, state: "done", icon: "box" },
    { label: teams.length ? `Alert to ${teams.length === 1 ? teams[0] : count(teams.length, "team")}` : "No alerts", detail: teams.length ? (toReview ? `${toReview} waiting for review` : "all taken on") : e.hypotheses.length ? "none bad for you" : undefined, state: "done", icon: "alert" },
    !e.run.validation ? { label: "Checks", detail: "switched off", state: "next", icon: "data" }
      : checked ? { label: `${checked} of ${e.hypotheses.length} checked`, detail: next ? `next ${onDay(next)}` : "all done", state: next ? "now" : "done", icon: "data" }
      : { label: next ? `Checks start ${onDay(next)}` : "Checks", detail: next ? relDay(next) : "waiting for your data", state: "next", icon: "data" },
  ];

  return (
    <div className="page">
      <PageHeader crumbs={<><Link to="/events">Events</Link><span aria-hidden="true">/</span><span>{e.title}</span></>}
        title={e.title}
        pills={<>{TONE_PILL[nBad && nGood ? "mixed" : nBad ? "bad" : nGood ? "good" : "neutral"]}{e.world !== "live" && <StatusPill tone="blue">Simulated</StatusPill>}
          <StatusPill tone={e.status === "open" ? "blue" : "grey"}>{e.status === "open" ? "Open" : "Closed"}</StatusPill></>}
        status={<>Noticed {longWhen(e.anchor)}{e.places.length ? <> · <Places codes={e.places} max={2} /></> : null}</>}
        actions={toReview ? <Link className="btn btn--primary" to="/alerts"><Icon name="alert" />Review {count(toReview, "alert")}</Link> : undefined}
        help={<HowItWorks><p>{e.status === "open"
          ? <>This event stays open until <b>{dayTime(e.open_until)}</b>: new news about the same thing joins it instead of starting a new one.</>
          : <>This event closed {e.closed_at ? dayTime(e.closed_at) : ""}: nothing new about it came in for a while.</>}</p></HowItWorks>} />

      <Steps steps={steps} label="Where this event has got to" />

      <div className="ev-sum">
        <section className="card ev-card" aria-labelledby="ev-what">
          <h2 id="ev-what" className="ev-k">What happened</h2>
          {lead ? <>
            <p className="ev-head">{headline?.url ? <a href={headline.url} target="_blank" rel="noreferrer">{headline.title ?? lead.title}<Icon name="external" className="src-ext" /><span className="sr"> (opens the article)</span></a> : headline?.title ?? lead.title}</p>
            <p className="ev-meta">{src && <Icon name={src.icon} />}{[src?.label, headline?.outlet, onDay((headline?.published_at ?? lead.created_at).slice(0, 10))].filter(Boolean).join(" · ")}</p>
          </> : <p className="ev-head">{e.title}</p>}
          {e.themes.length > 0 && <div className="ev-chips">{e.themes.map((t, i) => <span key={i} className="chip">{themeLabel(t)}</span>)}</div>}
        </section>
        <section className="card ev-card" aria-labelledby="ev-why">
          <h2 id="ev-why" className="ev-k">Why it matters to you</h2>
          <p className="ev-big">{e.hypotheses.length}<span>{e.hypotheses.length === 1 ? "possible impact" : "possible impacts"} on your products</span></p>
          <div className="ev-chips">
            {nBad > 0 && <StatusPill tone="red" icon="bad">{nBad} bad for you</StatusPill>}
            {nGood > 0 && <StatusPill tone="green" icon="good">{nGood} good for you</StatusPill>}
            {teams.length > 0 && <StatusPill tone="blue" icon="users">{count(teams.length, "team")} alerted</StatusPill>}
          </div>
        </section>
        <section className="card ev-card" aria-labelledby="ev-when">
          <h2 id="ev-when" className="ev-k">When we'll know</h2>
          {!e.run.validation ? <p className="ev-meta">Checks against your data are switched off.</p>
            : next ? <p className="ev-big">{onDay(next)}<span>{checked ? "next check" : "first check"} against your data, {relDay(next)}</span></p>
            : <p className="ev-big">{checked}<span>of {e.hypotheses.length} checked against your data</span></p>}
          {e.run.validation && e.hypotheses.length > 0 && <CheckSummary checks={checks} total={e.hypotheses.length} />}
        </section>
      </div>

      <Section title="Possible impacts" count={e.hypotheses.length} flush id="ev-impacts">
        {!e.hypotheses.length ? <p className="sec-line">None of your products is exposed to this event.</p> : <div className={`irs${same ? "" : " with-status"}`}>
          {e.hypotheses.map(h => {
            const t = tasks.get(h.hypothesis_id), c = checkOf(h), m = t?.check ? checkMove(t.check.what) : null;
            return (
              <ImpactRow key={h.hypothesis_id} product={h.product_name ?? h.product_id} kind={productAngle(h.product_type, h.angle)}
                impact={<>{impactText(metricName(h), h.expected.direction)}{m && <span className="ir-move"><b>{m.move}</b> {m.against}</span>}</>}
                adverse={adverseOf(h)} size={sizeTiming(h.expected.size, h.expected.timing)}
                status={!same && c ? <CheckPill c={c} /> : undefined}>
                <ImpactDetail h={h} t={t} metric={metricName(h)} />
              </ImpactRow>);
          })}
        </div>}
      </Section>

      <div className="ev-grid2">
        <div className="col gap16">
          {alerts.length > 0 && (
            <Section title="Alerts raised" count={alerts.length} flush action={<Link className="small" to="/alerts">All alerts</Link>}>
              {alerts.map(a => {
                const [st] = ALERT_STATUS[a.status];
                return <Row key={a.alert_id} to="/alerts" marker={<StatusPill tone={LEVEL_TONE[a.level]}>{LEVEL_LABEL[a.level]}</StatusPill>}
                  label={a.owner} detail={listText([...new Set(a.effects.map(x => x.product))])}
                  meta={a.status === "acknowledged" && a.acknowledged_by ? `Taken on by ${a.acknowledged_by}` : st} />;
              })}
            </Section>
          )}
          {e.set_aside.length > 0 && (
            <Section title="Considered, no impact" count={e.set_aside.length} flush>
              {e.set_aside.map((s, i) => (
                <details key={i} className="ir aside">
                  <summary className="lrow"><span className="row-main"><b className="row-l">{productAngle(s.product_type, s.angle)}</b></span>
                    <span className="row-meta">{SCREENING[s.decision] ?? "No clear link"}</span><Icon name="chevron" className="row-go ir-chev" /></summary>
                  <p className="aside-why">{s.reason}</p>
                </details>))}
            </Section>
          )}
        </div>
        <Section title="What Amiri Agent noticed" count={e.findings.length + e.developments.length} flush>
          {e.findings.map(f => {
            const h = f.evidence?.headlines?.[0], si = sourceInfo(f.source);
            const ref = f.source_ref ?? {};
            return <SourceCard key={f.finding_id} icon={si.icon} source={si.label} title={h?.title ?? f.title} href={h?.url}
              outlet={h?.outlet} when={longWhen(h?.published_at ?? f.created_at)} detail={f.explanation}
              to={ref.monitor_id ? `/monitors/${ref.monitor_id}` : ref.series_id ? `/series/${ref.series_id}` : undefined}
              toLabel={ref.monitor_id ? "Open the monitor" : "Open the price series"} />;
          })}
          {e.developments.map(d => <Row key={d.finding_id} icon="news" label={d.title} detail="More news about the same thing" meta={`Joined ${dayTime(d.joined_at)}`} />)}
        </Section>
      </div>

      <details className="card rep">
        <summary><Icon name="book" /><span>Full investigation report</span><Icon name="chevron" className="ir-chev" /></summary>
        <div className="rep-bd">{e.run.report ? <Markdown text={e.run.report} /> : <span className="muted small">No report.</span>}</div>
      </details>
      <div className="mt16"><TechnicalDetails>
        <FactList items={[["Event", <span className="mono">{e.event_id}</span>], ["Investigation", <span className="mono">{e.run.run_id}</span>],
          ["Findings", <span className="mono">{e.findings.map(f => `${f.finding_id} (score ${f.score})`).join(", ")}</span>],
          ["Places", <span className="mono">{e.places.join(", ")}</span>], ["Open until", dayTime(e.open_until)]]} />
      </TechnicalDetails></div>
    </div>
  );
}

/** A possible impact opened: why, what is watched and when, the result so far; versions under Technical details. */
function ImpactDetail({ h, t, metric }: { h: Hypothesis; t: Task | undefined; metric: string }) {
  const c = t?.check;
  const next = t?.next_check_after ?? c?.next_check_after;
  const rest = c ? splitCheckText(c.what)[1] : "";
  return <>
    <FactList items={[
      ["Why", `${h.chain_label}.`],
      ["What we watch", <>{metric}{t?.watch ? <span className="muted"> · {dateRange(t.watch.from, t.watch.until)}</span> : null}</>],
      ["Result so far", c ? <span className="ck-sum"><CheckPill c={{ verdict: c.verdict as VerdictKey, alert: c.alert }} />
        {c.verdict === "not_yet" || c.verdict === "insufficient_data" ? <span>{verdictWhy(c.why) || rest}</span> : rest ? <span>{rest}</span> : null}</span>
        : t ? "Not checked yet" : "No check for this one"],
      ["Next check", next && !c?.final ? <>{onDay(next)} <span className="muted">({relDay(next)})</span></> : null],
      ["How sure", c && !c.final && c.verdict !== "not_yet" && c.verdict !== "error" ? "First look; may change as more data comes in" : null],
    ]} />
    {c && <Link className="small" to={c.spec_link}>What this metric means</Link>}
    {(c || t) && <TechnicalDetails>
      <FactList items={[
        ["Check", t ? <span className="mono">{t.task_id}</span> : null],
        ["Metric", <span className="mono">{h.expected.metric}</span>],
        ["Watch", t?.watch ? `${t.watch.from} to ${t.watch.until}` : null],
        ["Scope", t?.scope_note ?? null],
        ["Tests", c?.checks.length ? c.checks.join("; ") : null],
        ["Revised", c?.supersedes ? `This ${c.supersedes.text}.` : null],
        ["Spec", c?.versions.spec ?? null], ["Catalog", c?.versions.catalog ?? null],
        ["Data", c?.versions.data ?? null], ["Validator", c?.versions.validator ?? null],
      ]} />
    </TechnicalDetails>}
  </>;
}
