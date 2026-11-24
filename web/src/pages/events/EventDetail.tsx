// One event as a chain: the news, when Amiri Agent picked it up, what it traced to your products, which teams it told,
// and what your data says so far. Opening an impact shows it as expected (the AI's assessment) against your data
// (counted by code). What it set aside, the reports and the report follow; the detail is folded at the end.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventDetail, type Hypothesis } from "../../api/investigation";
import { alertsApi, type AlertItem } from "../../api/alerts";
import { Places } from "../../components/blocks";
import { Markdown } from "../../components/markdown";
import { errText, isDown, PageSkeleton } from "../../components/ui";
import { Chain, Fold, PageTitle, Result, Scale, Section, TextButton, TONE_WORD, ToneMark, ToneWord, type Step, type ToneKey } from "../../components/rd";
import { day, dayTime, person, ZONE_LABEL } from "../../format";
import {
  anchorLabel, cap, count, dateRange, earliest, eventTitle, impactText, listText, metricWords, onDay, sizeTiming,
  sourceInfo, splitCheckText, themeLabel, VERDICT_LABEL, type VerdictKey,
} from "../../plain";
import {
  againstOf, asideMeaning, groupAside, otherEventsInReport, plannedTests, STRICTER, testWords, today, untracedWhy,
  type Threshold,
} from "./words";
import "../../styles/rd-event.css";

// the task carries more than the shared type names; these are the parts this page reads
type Task = EventDetail["tasks"][number] & { method?: string; thresholds?: Threshold[] };
type Finding = EventDetail["findings"][number];
const AI = "Amiri Agent's assessment (AI)";

/** "to review", "acknowledged by Dilan", "resolved". */
function alertStatus(a: AlertItem): string {
  if (a.status === "acknowledged") return a.acknowledged_by ? `acknowledged by ${person(a.acknowledged_by)}` : "acknowledged";
  if (a.status === "resolved") return a.resolved_by ? `resolved by ${person(a.resolved_by)}` : "resolved";
  return "to review";
}
/** When the next check is: "next check 16 Nov", "next check today", or "check due" once the day has passed. */
function nextCheck(d: string | null | undefined): string | null {
  if (!d) return null;
  const t = today();
  return d < t ? "check due" : d === t ? "next check today" : `next check ${onDay(d)}`;
}
const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: "start" });

export function EventDetailPage() {
  const { id = "" } = useParams();
  const loc = useLocation();
  const [e, setE] = useState<EventDetail | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const load = () => investigationApi.event(id).then(x => { setE(x); setErr(null); }).catch(setErr);
  useEffect(() => { load(); }, [id]);  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { alertsApi.list({ event_id: id }).then(setAlerts).catch(() => setAlerts([])); }, [id]);
  // a link to one impact (#impact-<id>) opens it
  useEffect(() => {
    const m = loc.hash.match(/^#impact-(.+)$/);
    if (!e || !m || !e.hypotheses.some(h => h.hypothesis_id === m[1])) return;
    setOpen(m[1]);
    requestAnimationFrame(() => scrollTo(`impact-${m[1]}`));
  }, [e, loc.hash]);

  const crumbs = (title?: string) => <><Link to="/events">Events</Link>{title && <> / <span>{title}</span></>}</>;
  if (err instanceof ApiError && err.status === 404) return (
    <div className="page rd rd-event">
      <PageTitle crumbs={crumbs()} title="Event not found" />
      <p className="rd-lede rd-prose">This event isn't here. It may have been removed when the prototype was reset.</p>
      <p className="ev-actions"><Link className="btn" to="/events">See all events</Link></p>
    </div>);
  if (!e) return <div className="page rd rd-event">{err != null
    ? <><PageTitle crumbs={crumbs()} title="Event" /><LoadFailed error={err} onRetry={load} /></> : <PageSkeleton bare />}</div>;
  return <EventView e={e} alerts={alerts} open={open} setOpen={setOpen} help={help} setHelp={setHelp} crumbs={crumbs} />;
}

/** The event didn't load: what happened, in plain words, and one way out (the shared LoadError, without its card). */
function LoadFailed({ error, onRetry }: { error: unknown; onRetry: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const down = isDown(error);
  const retry = async () => {
    setBusy(true);
    if (down) window.dispatchEvent(new Event("amiri:installation"));  // the app bar's institution comes back too
    try { await onRetry(); } finally { setBusy(false); }
  };
  return (
    <div className="rd-sec" role="alert">
      <h2 className="ev-err-h"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {down ? "Amiri Agent didn't answer" : "Couldn't load this event"}</h2>
      <p className="rd-prose">{down ? "It may be starting up after a quiet spell, or the connection dropped. Nothing you saved is lost." : errText(error)}</p>
      <p className="ev-actions"><button className="btn btn--primary" type="button" disabled={busy} onClick={retry}>{busy ? "Trying…" : "Try again"}</button></p>
    </div>
  );
}

function EventView({ e, alerts, open, setOpen, help, setHelp, crumbs }: {
  e: EventDetail; alerts: AlertItem[]; open: string | null; setOpen: (id: string | null) => void; help: boolean;
  setHelp: (v: boolean) => void; crumbs: (title?: string) => ReactNode;
}) {
  const tasks = useMemo(() => new Map(e.tasks.map(t => [t.hypothesis_id, t as Task])), [e]);
  // the spec's metric name and whether the move is bad for you: from the alerts when they carry it, else from the task
  const effects = new Map(alerts.flatMap(a => a.effects).map(x => [x.hypothesis_id, x]));
  const alertOf = new Map(alerts.flatMap(a => a.effects.map(x => [x.hypothesis_id, a] as const)));
  const metricName = (h: Hypothesis) => effects.get(h.hypothesis_id)?.metric_name
    ?? (tasks.get(h.hypothesis_id)?.check ? splitCheckText(tasks.get(h.hypothesis_id)!.check!.what)[0] : metricWords(h.expected.metric));
  const adverseOf = (h: Hypothesis): boolean | null => {
    const t = tasks.get(h.hypothesis_id);
    if (t?.adverse_direction) return h.expected.direction === t.adverse_direction;
    if (effects.has(h.hypothesis_id)) return effects.get(h.hypothesis_id)!.adverse;
    return e.tone === "bad" ? true : e.tone === "good" ? false : null;
  };
  const n = e.hypotheses.length;
  const nBad = e.hypotheses.filter(h => adverseOf(h) === true).length, nGood = e.hypotheses.filter(h => adverseOf(h) === false).length;
  const tone: ToneKey = nBad && nGood ? "mixed" : nBad ? "bad" : nGood ? "good" : "neutral";
  const sameTone = n > 1 && (nBad === n || nGood === n);  // then the tone is said once, not on every row
  const teams = [...new Set(alerts.map(a => a.owner))];
  const toReview = alerts.filter(a => a.status === "new").length;
  const title = eventTitle(e);
  const findings = [...e.findings].sort((a, b) => when(a).localeCompare(when(b)));
  const pickedUp = earliest(e.findings.map(f => f.created_at));
  const alertedAt = earliest(alerts.map(a => a.created_at));
  const products = new Set(e.hypotheses.map(h => h.product_id)).size;
  const verdicts = e.hypotheses.map(h => tasks.get(h.hypothesis_id)?.check?.verdict as VerdictKey | undefined);
  const checked = verdicts.filter(v => v && v !== "not_yet").length;
    const prices = e.findings.length > 0 && e.findings.every(f => f.source === "timeseries");
  const groups = groupAside(e.set_aside);
  const nAside = e.set_aside.length;
  const asideLink = nAside > 0 && <a className="rd-name" href="#set-aside" aria-label={`${count(nAside, "link")} set aside: go to them`}>{nAside} set aside ↓</a>;
  const why = n ? null : untracedWhy(e.run.report, e.findings.map(f => f.title));
  const others = otherEventsInReport(e.run.report);

  // step 5: what your data says so far, in a few words
  const dataSub = (() => {
    if (!checked) { const t = earliest(e.tasks.map(t => t.next_check_after ?? t.check?.next_check_after)); return t ? nextCheck(t)?.replace(/^next check/, "first check") : "waiting for your figures"; }
    const by = new Map<string, number>();
    for (const v of verdicts) if (v && v !== "not_yet") by.set(v, (by.get(v) ?? 0) + 1);
    if (by.size === 1) { const [v, k] = [...by][0]; return `${k === 1 ? "" : k === 2 ? "both " : "all "}${VERDICT_LABEL[v as VerdictKey].toLowerCase()}`; }
    return [...by].map(([v, k]) => `${k} ${VERDICT_LABEL[v as VerdictKey].toLowerCase()}`).join(", ");
  })();
  const steps: Step[] = [
    { label: anchorLabel(e.anchor_basis), value: dayTime(e.anchor), sub: `${ZONE_LABEL} time` },
    { label: "Picked up", value: pickedUp ? dayTime(pickedUp) : "—",
      sub: e.findings.length ? `by ${listText([...new Set(e.findings.map(f => sourceInfo(f.source).label))])}${e.findings.length > 1 ? `, ${count(e.findings.length, prices ? "price move" : "report")}` : ""}` : undefined,
      state: pickedUp ? "done" : "next" },
    n ? { label: "Traced to you", value: count(n, "possible impact"), sub: <>on {count(products, "product")}{nAside > 0 && <> · {asideLink}</>}</> }
      : { label: "Traced to you", value: "No impact", sub: "on your products", state: "none" },
    alerts.length ? { label: "Alerted", value: count(teams.length, "team"), sub: `${alertedAt ? `${dayTime(alertedAt)} · ` : ""}${toReview ? `${toReview} to review` : "all taken on"}` }
      : { label: "Alerted", value: "No one", sub: n ? "none bad for you" : "nothing to send", state: n ? "done" : "none" },
    !n ? { label: "Your data", value: "Nothing to check", state: "none" }
      : !e.run.validation ? { label: "Your data", value: "Checks off", sub: "not checked against your figures", state: "none" }
      : { label: "Your data", value: `${checked} of ${n} checked`, sub: dataSub ?? undefined, state: checked === n ? "done" : "next" },
  ];

  const toggle = (hid: string) => {
    const next = open === hid ? null : hid;
    setOpen(next);
    try { window.history.replaceState(window.history.state, "", next ? `#impact-${next}` : window.location.pathname + window.location.search); } catch { /* */ }
  };

  return (
    <div className="page rd rd-event">
      <PageTitle crumbs={crumbs(title)} title={title}
        actions={toReview ? <Link className="btn btn--primary" to="/alerts">Review {count(toReview, "alert")} →</Link> : undefined}
        status={<>
          <ToneWord tone={tone} />
          {e.world !== "live" && <span className="rd-ink">Simulated</span>}
          <span>{e.status === "open" ? `Collecting news until ${day(e.open_until)}` : `Closed${e.closed_at ? ` ${day(e.closed_at)}` : ""}`}</span>
          {e.places.length > 0 && <Places codes={e.places} max={2} />}
          <TextButton aria-expanded={help} aria-controls="ev-help" onClick={() => setHelp(!help)}>How this works</TextButton>
        </>}
        help={<div id="ev-help" className="rd-open rd-prose ev-help" hidden={!help}>
          <p>Amiri Agent <b>watches</b> the news through your monitors, market prices and Radar; <b>notices</b> a finding worth a
            closer look; <b>investigates</b> it, linking it to an event and working out which of your products it could hit;
            <b> alerts</b> the team that owns each product; and <b>checks</b> each possible impact against your own figures as
            they're published.</p>
          <p>{e.status === "open"
            ? <>This event stays open until <b>{dayTime(e.open_until)}</b>: new news about the same thing joins it instead of starting a new one.</>
            : <>This event closed {e.closed_at ? dayTime(e.closed_at) : ""}: nothing new about it came in for a while.</>}</p>
        </div>} />

      <div className={`ev-chain${n ? " ev-chain-n" : ""}`}><Chain steps={steps} label="From the news to your data" /></div>

      <Section title="Possible impacts" count={n ? `${n} · ${AI}` : "none"} id="impacts">
        {!n ? <div className="rd-prose ev-none">
          <p className="ev-none-h">No impact traced to your products.</p>
          {why
            ? <p>Amiri Agent's reason (AI), from the investigation that opened this event: “{why}”</p>
            : <p>The investigation report below says why.</p>}
          {e.run.report && <p><a className="rd-name" href="#report" onClick={() => setTimeout(() => document.querySelector<HTMLButtonElement>("#report > button[aria-expanded=false]")?.click())}>Read the investigation report ↓</a></p>}
        </div> : <>
          <p className="ev-lede">Expectations, not facts yet: each is checked against your own figures as they're published.
            {sameTone && <> All {n} would be <ToneWord tone={nBad ? "bad" : "good"}>{nBad ? "bad for you" : "good for you"}</ToneWord>.</>}</p>
          <table className="rd-table ev-impacts">
            <thead><tr><th scope="col">Product</th><th scope="col">What may happen</th><th scope="col">Team alerted</th><th scope="col">Your data so far</th></tr></thead>
            <tbody>
              {e.hypotheses.map(h => {
                const t = tasks.get(h.hypothesis_id), c = t?.check, a = alertOf.get(h.hypothesis_id), isOpen = open === h.hypothesis_id;
                const adverse = adverseOf(h);
                return [
                  <tr key={h.hypothesis_id} id={`impact-${h.hypothesis_id}`} className={isOpen ? "ev-row is-open" : "ev-row"}>
                    <td className="rd-strong">
                      <button type="button" className="ev-opener" aria-expanded={isOpen} aria-controls={`impact-${h.hypothesis_id}-open`} onClick={() => toggle(h.hypothesis_id)}>
                        <svg className="ev-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        {h.product_name ?? h.product_id}</button></td>
                    <td>{!sameTone && adverse !== null && <><ToneMark tone={adverse ? "bad" : "good"} label={TONE_WORD[adverse ? "bad" : "good"]} /> </>}{impactText(metricName(h), h.expected.direction)}</td>
                    <td>{a ? <><span className="rd-ink">{a.owner}</span> <span className="ev-st">· {alertStatus(a)}</span></>
                      : <span className="ev-st">{adverse === false ? "not sent: good for you" : "not sent"}</span>}</td>
                    <td>{c ? <Result verdict={c.verdict as VerdictKey} adverse={adverse} figure={c.change} />
                      : <span className="ev-st">{t ? "Not checked yet" : e.run.validation ? "No check" : "Checks off"}</span>}</td>
                  </tr>,
                  isOpen && <tr key={`${h.hypothesis_id}-open`} className="ev-openrow"><td colSpan={4} id={`impact-${h.hypothesis_id}-open`}>
                    <Verification h={h} t={t} metric={metricName(h)} adverse={adverse} team={a?.owner} onClose={() => toggle(h.hypothesis_id)} />
                  </td></tr>,
                ];
              })}
            </tbody>
          </table>
        </>}
      </Section>

      {nAside > 0 && (
        <Section title="Considered and set aside" count={`${nAside} · Amiri Agent's judgement (AI)`} id="set-aside">
          <p className="ev-lede">Links it looked at and didn't send to a team.</p>
          {groups.map((g, i) => (
            <div key={i} className="rd-row">
              <div className="rd-row-t">{g.links.length > 1 ? `${g.links.length} links set aside for the same reason:` : `${g.links[0]}:`}</div>
              <p className="ev-reason rd-prose">“{g.reason}”</p>
              {g.links.length > 1 && <ul className="ev-links">{g.links.map(l => <li key={l}>{l}</li>)}</ul>}
              <p className="rd-row-d rd-prose">In plain words: {asideMeaning(g)}</p>
            </div>))}
        </Section>
      )}

      <Section title="What Amiri Agent noticed" id="noticed"
        count={[`${count(findings.length, prices ? "price move" : "report")} started it`, e.developments.length ? `${e.developments.length} joined later` : ""].filter(Boolean).join(" · ")}>
        {findings.map(f => <FindingRow key={f.finding_id} f={f} />)}
        {e.developments.length > 0 && <Developments items={e.developments} />}
        {e.themes.length > 0 && <p className="ev-themes">Themes: {e.themes.map(t => themeLabel(t).toLowerCase()).join(" · ")}</p>}
      </Section>

      <div className="ev-end">
        <Fold id="report" title="Full investigation report"
          summary={`Written by Amiri Agent (AI) · covers the whole investigation${others ? `, which also covers ${count(others, "other event")}` : ", not only this event"}`}>
          <div className="rd-prose ev-report">{e.run.report ? <Markdown text={e.run.report} /> : <p>No report.</p>}</div>
        </Fold>
        <Fold title="Technical details" summary="event and investigation IDs, findings and scores, places, open until">
          <Facts items={[["Event", <code>{e.event_id}</code>], ["Investigation", <code>{e.run.run_id}</code>],
            ["Findings", <code>{e.findings.map(f => `${f.finding_id} (score ${f.score})`).join(", ")}</code>],
            ["Places", <code>{e.places.join(", ")}</code>], ["Open until", dayTime(e.open_until)]]} />
        </Fold>
      </div>
    </div>
  );
}

const when = (f: Finding) => f.evidence?.headlines?.[0]?.published_at ?? f.created_at;

/** A report that started the event: its headline (linked), where it came from, its own date and Amiri Agent's line. */
function FindingRow({ f }: { f: Finding }) {
  const h = f.evidence?.headlines?.[0], si = sourceInfo(f.source), ref = f.source_ref ?? {};
  const to = ref.monitor_id ? `/monitors/${ref.monitor_id}` : ref.series_id ? `/series/${ref.series_id}` : undefined;
  return (
    <div className="rd-row">
      <h3 className="rd-row-t">{h?.url
        ? <a className="rd-name" href={h.url} target="_blank" rel="noreferrer">{h.title ?? f.title} ↗<span className="sr"> (opens the article)</span></a>
        : h?.title ?? f.title}</h3>
      <div className="rd-row-m">{[si.label, h?.outlet, day(when(f))].filter(Boolean).join(" · ")}
        {to && <> · <Link className="rd-go" to={to}>{ref.monitor_id ? "Open the monitor" : "Open the price series"}</Link></>}</div>
      {f.explanation && <p className="rd-row-d rd-prose">{f.explanation}</p>}
    </div>
  );
}

/** The reports that joined later: one line, then the latest 10, then all. */
function Developments({ items }: { items: EventDetail["developments"] }) {
  const [all, setAll] = useState(false);
  const sorted = [...items].sort((a, b) => b.joined_at.localeCompare(a.joined_at));
  const first = sorted[sorted.length - 1], latest = sorted[0];
  const shown = all ? sorted : sorted.slice(0, 10);
  return (
    <Fold title={`${count(items.length, "more report")} joined this event`}
      summary={`${first ? `${day(first.joined_at)} to ${day(latest.joined_at)} · ` : ""}latest: “${latest.title}”`}>
      <ol className="ev-devs">{shown.map(d => <li key={d.finding_id}><span className="ev-dev-t">{d.title}</span> <span className="ev-st">· joined {dayTime(d.joined_at)}</span></li>)}</ol>
      {items.length > 10 && <p className="ev-more"><TextButton onClick={() => setAll(!all)}>{all ? "Show the latest 10" : `Show all ${items.length}`}</TextButton></p>}
    </Fold>
  );
}

function Facts({ items }: { items: [string, ReactNode][] }) {
  const shown = items.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return <dl className="ev-facts">{shown.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

// ------------------------------------------------------------------ an impact opened: expected vs your data
const parseNum = (s: string | null | undefined) => {
  if (!s) return null;
  const m = s.replace(/−/g, "-").match(/[-+]?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const lower = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/** Expected (Amiri Agent's assessment, AI) against your data so far (counted by code): the figure, the result, a scale,
 *  the tests that decided it, then one quiet line and the technical details. */
function Verification({ h, t, metric, adverse, team, onClose }: {
  h: Hypothesis; t: Task | undefined; metric: string; adverse: boolean | null; team?: string; onClose: () => void;
}) {
  const c = t?.check;
  const v = c?.verdict as VerdictKey | undefined;
  const next = t?.next_check_after ?? c?.next_check_after;
  const method = t?.method;
  const against = againstOf(method);
  const tests = (c?.checks ?? []).map(line => ({ line, w: testWords(line, method, c?.final) }));
  const planned = !c || v === "not_yet" ? plannedTests(t?.thresholds ?? [], method, t?.expected_direction ?? h.expected.direction, !!c?.final) : [];
  const watch = t?.watch;
  const reason = (why: string | null | undefined) => !why ? null
    : /hasn't published enough/.test(why) ? "Not enough of the watch period is in your figures yet."
    : /period to watch hasn't started/.test(why) ? "The watch period hasn't started yet." : `${cap(why)}.`;

  // the scale: the usual range, your figure, and where an effect starts (the change test's own number)
  const fig = parseNum(c?.change);
  const usual = c?.usual?.split(/\s+to\s+/).map(parseNum);
  const band = usual && usual.length === 2 && usual[0] !== null && usual[1] !== null ? [usual[0], usual[1]] as [number, number] : undefined;
  const changeTest = tests.find(x => /^change /.test(x.line));
  const thr = parseNum(changeTest?.line.match(/needed ([^ ]+(?: pp|%)?)/)?.[1]);
  const unit = c?.change?.includes("pp") ? " pp" : c?.change?.includes("%") ? "%" : "";
  const fmt = (x: number) => `${x < 0 ? "−" : x > 0 ? "+" : ""}${Math.abs(x).toFixed(unit === " pp" ? 2 : 1)}${unit}`;
  let scale: ReactNode = null;
  if (fig !== null && v !== "not_yet") {
    const pts = [fig, ...(band ?? []), ...(thr !== null ? [thr] : [])];
    const lo = Math.min(...pts), hi = Math.max(...pts), pad = Math.max((hi - lo) * 0.18, Math.abs(hi) * 0.1, 0.1);
    scale = <Scale min={lo - pad} max={hi + pad} value={fig} band={band} threshold={thr ?? undefined} width={880}
      valueLabel={`yours ${c!.change}`} thresholdLabel={thr !== null ? `effect from ${fmt(thr)}` : undefined}
      bandLabel={band ? `usual range ${c!.usual}` : undefined}
      label={`Your figure ${c!.change}${band ? `, usual range ${c!.usual}` : ""}${thr !== null ? `, an effect starts at ${fmt(thr)}` : ""}`} />;
  } else if (watch && (!c || v === "not_yet")) {
    const a = Date.parse(watch.from), b = Date.parse(watch.until), now = Date.parse(today());
    const at = Math.max(a, Math.min(b, now));
    scale = <div className="ev-period">
      <Scale min={a} max={b} value={at} band={[a, at]} width={880} valueLabel={now < a ? "starts later" : `today, ${onDay(today())}`}
        label={`Watch period ${dateRange(watch.from, watch.until)}; today is ${now < a ? "before it starts" : now > b ? "after it ends" : "inside it"}`} />
      <div className="ev-period-l" aria-hidden="true"><span>{onDay(watch.from)}</span><span>watch period</span><span>{onDay(watch.until)}</span></div>
    </div>;
  }

  const sure = !c ? null : v === "not_yet" ? (c.as_of ? `last checked ${onDay(c.as_of)}` : null)
    : c.final ? `final${c.as_of ? `, checked ${onDay(c.as_of)}` : ""}`
    : v === "error" ? (c.as_of ? `tried ${onDay(c.as_of)}` : null)
    : `a first look, may change as more data comes in${c.as_of ? `; checked ${onDay(c.as_of)}` : ""}`;
  const quiet = [sure, c?.final ? null : nextCheck(next), watch ? `watched ${dateRange(watch.from, watch.until)}` : null].filter(Boolean) as string[];

  return (
    <div className="rd-open ev-verif" aria-label={`${h.product_name ?? h.product_id}: expected against your data`}>
      <div className="ev-verif-h">
        <h3>{h.product_name ?? h.product_id} <span className="ev-verif-m">· {lower(metric)}</span></h3>
        {team && <span className="ev-st">alerted the {team} team</span>}
        <span className="ev-verif-close"><TextButton onClick={onClose}>Close</TextButton></span>
      </div>

      <div className="ev-vs">
        <div>
          <p className="ev-vs-l"><b>Expected</b> · {AI}</p>
          <p className="ev-exp">{impactText(metric, h.expected.direction)}</p>
          <p className="ev-exp-s">{sizeTiming(h.expected.size, h.expected.timing)}{adverse !== null && <> · <ToneWord tone={adverse ? "bad" : "good"} /></>}</p>
          <p className="ev-exp-why">Because {lower(h.chain_label)}.</p>
        </div>
        <div>
          <p className="ev-vs-l"><b>Your data so far</b> · counted by code, from your figures</p>
          {!c ? <><p className="ev-early">{t ? "Not checked yet" : "No check"}</p>
              <p className="ev-exp-why">{t ? "The first check runs once your figures for the watch period come in." : "Checks against your data are switched off for this investigation."}</p></>
            : v === "not_yet" ? <><p className="ev-early">{VERDICT_LABEL.not_yet}</p><p className="ev-exp-why">{reason(c.why) ?? splitCheckText(c.what)[1]}</p></>
            : fig !== null ? <><p className="ev-fig">{c.change}</p>
              {against && <p className="ev-exp-s">against {against}</p>}
              <p className="ev-res"><Result verdict={v!} adverse={adverse} strong /></p></>
            : <><p className="ev-res ev-res-big"><Result verdict={v!} adverse={adverse} strong /></p>
              <p className="ev-exp-why">{reason(c.why) ?? splitCheckText(c.what)[1]}</p></>}
        </div>
      </div>

      {scale && <div className="ev-scale">{scale}</div>}

      {tests.length > 0 && <div className="ev-tests">
        <h4>Why “{VERDICT_LABEL[v!].toLowerCase()}”</h4>
        <p className="ev-tests-l">{tests.length > 1 ? "An effect counts only when every test is met." : "An effect counts only when this test is met."}</p>
        <table className="rd-table ev-tests-t">
          <thead><tr><th scope="col">Needed</th><th scope="col">Yours</th><th scope="col"><span className="sr">Met?</span></th></tr></thead>
          <tbody>{tests.map(({ line, w }) => w
            ? <tr key={line}><td>{cap(w.needed)}{w.stricter && <span className="ev-st"> ({STRICTER})</span>}</td><td className="rd-strong">{w.yours}</td><td className="ev-met">{w.met ? "met" : "not met"}</td></tr>
            : <tr key={line}><td colSpan={3}>{line}</td></tr>)}</tbody>
        </table>
      </div>}
      {planned.length > 0 && <div className="ev-tests">
        <h4>What will count as an effect</h4>
        <p className="ev-tests-l">{planned.length === 2 ? "Both must hold:" : planned.length > 2 ? `All ${planned.length} must hold:` : "This must hold:"}</p>
        <ul className="ev-planned">{planned.map(p => <li key={p.text}>{cap(p.text)}{p.stricter && <span className="ev-st"> ({STRICTER})</span>}</li>)}</ul>
      </div>}

      <p className="ev-quiet rd-dots">{quiet.map(q => <span key={q}>{cap(q)}</span>)}
        {c && <span><Link className="rd-go" to={c.spec_link}>What this metric means</Link></span>}</p>
      {(c || t) && <Fold title="Technical details" summary="check, metric key, watch, scope, tests, versions">
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
      </Fold>}
    </div>
  );
}
