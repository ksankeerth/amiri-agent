// The Overview: the Risk Manager's first page, laid out like the front page of a briefing. Layer 0 (the first
// screen): one status sentence, the one thing to do, three figures and the map of where. Layer 1 (one scroll): the top
// 3 open events, what else needs you and the latest findings. Layer 2: Markets, Radar and the system's health, folded
// into one-line summaries. One call; refreshed every minute.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { inst, type Profile } from "../api/institutions";
import { overviewApi, type Attention, type Overview, type OverviewEvent } from "../api/overview";
import { scheduleText } from "../api/radar";
import { HowItWorks } from "../components/blocks";
import { Spark } from "../components/charts";
import { Icon } from "../components/Icon";
import { Fold, Figures, GoLink, QuietWarn, Section, TextButton, ToneMark, ToneWord, TONE_WORD, type ToneKey } from "../components/rd";
import { Banner, CountUp, DEMOS, errText, isDown, LoadError, PageHead, PageSkeleton, useNow, useRole } from "../components/ui";
import { ago, dayTime, pct, plural, price, TIME_ZONE, ZONE_LABEL } from "../format";
import { eventTitle, SERIES_STATE, setAsideReason } from "../plain";
import { ProfileMap } from "./institution/ProfileMap";
import "../styles/rd-overview.css";

const REFRESH_MS = 60_000;
const RANK = { bad: 0, mixed: 1, good: 2, neutral: 3 };  // what hurts first
const TOP = 3;  // layer 1 shows the top 3 of each list
const SOURCE_WORD: Record<string, string> = { monitor: "News", timeseries: "Prices", radar: "Radar" };

const longDate = (now: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(now);
/** "a, b and c" */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function findingStatus(f: Overview["findings"][number]) {
  if (f.event_id) return "in an event";
  if (f.status === "set_aside" && f.reason === "investigation_failed") return "couldn't be investigated";
  return { new: "waiting to be investigated", grouped: "being investigated", linked: "in an event", set_aside: `no impact found${f.reason ? `: ${setAsideReason(f.reason)}` : ""}` }[f.status] ?? f.status;
}
/** A server note in plain words where it uses series wording ("No new bar since …"). */
const plainNote = (t: string) => t.replace(/^(.+?): No new bar since (.+?) \(.*\)\.?$/, "$1: prices haven't updated since $2");
/** The day a price stopped updating ("10 Nov"), from the server's note. */
const staleDay = (reason: string | null) => reason?.match(/since (\d{1,2} \w{3})/)?.[1] ?? null;
/** "Brent oil fund (fuel imports)" → "Brent oil fund": the short name for a summary line. */
const shortName = (n: string) => n.replace(/\s*\(.*\)$/, "");

/** "6 possible impacts: Migrant Family Savings, Pawning, FC Savings and 3 more" */
function impactLine(e: OverviewEvent): string {
  if (!e.effects) return "No possible impact on your products";
  const products = [...new Set(e.top_effects.map(x => x.product))];
  const rest = e.effects - products.length;
  return `${plural(e.effects, "possible impact")}: ${products.length ? andList(rest > 0 ? [...products, `${rest} more`] : products) : "on your products"}`;
}

/** The map's height: as tall as the words beside it at their natural spacing (title down to the sources line), so the
 *  words never stretch to fill a tall map and neither column leaves a gap; 340 px at least. */
function useMapHeight(): [number, (el: HTMLDivElement | null) => void] {
  const [h, setH] = useState(520);
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const last = useRef(520);
  useEffect(() => {
    if (!el) return;
    const figs = el.querySelector(".rd-figs"), cap = el.querySelector(".rd-ov-cap"), map = el.nextElementSibling;
    const GAP = 28;  // the space above the sources line
    const fit = () => {
      const next = window.innerWidth <= 1000 || !figs || !cap || !map ? 420 : (() => {
        const words = figs.getBoundingClientRect().bottom - el.getBoundingClientRect().top + GAP + cap.getBoundingClientRect().height;
        const extra = map.getBoundingClientRect().height - last.current;  // the key under the map and the map's own frame
        return Math.max(340, Math.round(words - extra));
      })();
      if (Math.abs(next - last.current) > 1) { last.current = next; setH(next); }
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    [figs, cap, map].forEach(x => x && ro?.observe(x));
    window.addEventListener("resize", fit);
    return () => { ro?.disconnect(); window.removeEventListener("resize", fit); };
  }, [el]);
  return [h, setEl];
}

// ================================================================ first run
function FirstRun({ o }: { o: Overview }) {
  const i = o.institution;
  const steps: { done: boolean; title: string; body: string; to: string; label: string }[] = [
    { done: !!i, title: "Tell Amiri Agent about your institution", body: "Where you operate, your customers, products, flows, regulators, rivals and risks.",
      to: i ? "/institution/setup" : "/institution/new", label: i ? "Continue setup" : "Start setup" },
    { done: !!i && i.readiness.ready && i.status === "active", title: "Check it and go live",
      body: i ? (i.readiness.ready ? "Everything required is there. Activate the profile so Amiri Agent starts using it." : `${plural(i.readiness.missing_required, "required item")} still missing.`) : "Once the profile has what's required, activate it.",
      to: "/institution/setup/review", label: "Review" },
    { done: o.counts.monitors_live > 0, title: "Choose what to watch", body: "Draft monitors from your profile. A Risk Manager approves each one.",
      to: "/monitors", label: "Monitors" },
  ];
  const next = steps.findIndex(s => !s.done);
  return (
    <div className="page rd rd-overview">
      <h1 className="rd-ov-h1">Welcome to Amiri Agent</h1>
      <p className="rd-lede rd-prose">{i ? <>Three steps, and Amiri Agent starts watching the world for <b>{i.name}</b>.</>
        : <>See it work on a sample institution in one click, or set up your own.</>}</p>
      {!i && <DemoLoad />}
      <section className={i ? "rd-fr-demo" : "rd-fr-steps-sec"} aria-labelledby="fr-steps-h">
        <h2 id="fr-steps-h">{i ? "Three steps to go live" : "Or set up your own institution"}</h2>
        <ol className="rd-fr-steps">{steps.map((st, n) => {
          const locked = n > 0 && !steps[n - 1].done && !st.done;  // a step opens once the one before it is done
          return (
            <li key={st.title} data-s={st.done ? "done" : locked ? "locked" : "open"}>
              <span className="rd-fr-n" aria-hidden="true">{n + 1}</span>
              <h3><span className="sr">Step {n + 1}: </span>{st.title}</h3>
              <p>{st.body}</p>
              <div>{st.done ? <span className="rd-fr-done">Done</span>
                : locked ? <span className="rd-fr-state">After step {n}</span>
                  : i && n === next ? <Link className="btn btn--primary btn--lg" to={st.to}>{st.label} →</Link>
                    : <GoLink to={st.to}>{st.label}</GoLink>}</div>
            </li>);
        })}</ol>
      </section>
      {i && <section className="rd-fr-studio" aria-labelledby="fr-studio-h">
        <div><h2 id="fr-studio-h">See it work first</h2>
          <p className="rd-prose" style={{ margin: "4px 0 0" }}>Run a sharp currency fall on your institution in the Scenario Studio: headlines arrive, prices move, and Amiri Agent's monitors and investigation respond. Nothing touches live data.</p></div>
        <Link className="btn btn--lg" to="/studio">Open the Scenario Studio</Link></section>}
    </div>
  );
}

/** No institution yet: load one of the two invented demos in one click (the server refuses once an institution exists). */
function DemoLoad() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = async (kind: string) => {
    setBusy(kind); setErr(null);
    try {
      const r = await fetch("/api/v1/prototype:demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind }) });
      if (!r.ok) { const p = await r.json().catch(() => ({})); throw new Error(p.detail ?? `HTTP ${r.status}`); }
      window.location.assign("/home");  // every page loads again, with the demo
    } catch (e) { setErr(String((e as Error).message ?? e)); setBusy(null); }
  };
  return (
    <section className="rd-fr-demo" aria-labelledby="demo-h">
      <div className="rd-fine">Fastest way in</div>
      <h2 id="demo-h">Start with a demo</h2>
      <p>An invented institution with its whole profile, ready to try everything on. No real customer data.</p>
      <div className="rd-fr-btns">{DEMOS.map((d, n) => (
        <button key={d.kind} className={`btn${n === 0 ? " btn--primary" : ""}`} type="button" disabled={!!busy} onClick={() => load(d.kind)}>
          <b>{busy === d.kind ? "Loading…" : `Load the ${d.label.toLowerCase()}`}</b>
          <span>{d.name}, {d.what.charAt(0).toLowerCase()}{d.what.slice(1)}</span></button>))}</div>
      {err && <p className="rd-warn" role="alert"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> Couldn't load the demo: {err}</p>}
    </section>
  );
}

// ================================================================ the map's key
const KEY_TONES: [ToneKey, string][] = [["bad", TONE_WORD.bad], ["good", TONE_WORD.good], ["mixed", "Mixed"], ["neutral", "Neutral"]];
function MapKey({ reachesFlows }: { reachesFlows: boolean }) {
  const [open, setOpen] = useState(false);
  const more = useId();
  return (
    <>
      <div className="rd-ov-key">
        {KEY_TONES.map(([t, w]) => <ToneWord key={t} tone={t}>{w}</ToneWord>)}
        <TextButton aria-expanded={open} aria-controls={more} onClick={() => setOpen(o => !o)}>Map key</TextButton>
      </div>
      <ul id={more} className="rd-ov-keymore" hidden={!open}>
        <li><svg width={22} height={12} aria-hidden="true"><rect x={1} y={1} width={20} height={10} rx={3} fill="var(--map-home-fill)" stroke="var(--map-home)" /></svg>Where you operate</li>
        <li><svg width={16} height={16} aria-hidden="true"><circle cx={8} cy={8} r={6.5} fill="var(--critical-soft)" stroke="var(--critical)" strokeDasharray="3 2" /></svg>Risk areas in your profile</li>
        <li><svg width={22} height={12} aria-hidden="true"><path d="M1 10Q11 0 21 10" fill="none" stroke="var(--accent)" strokeWidth={2} /></svg>Money flows, moving the way the money goes</li>
        {reachesFlows && <li><svg width={22} height={12} aria-hidden="true"><path d="M1 10Q11 0 21 10" fill="none" stroke="var(--critical)" strokeWidth={3.5} /></svg>Flows an open event reaches</li>}
        <li>Click an event's mark to open it</li>
      </ul>
    </>
  );
}

// ================================================================ the page
export function OverviewPage() {
  const nav = useNavigate();
  const now = useNow(30_000);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [mapH, wordsRef] = useMapHeight();
  const [o, setO] = useState<Overview | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [how, setHow] = useState(false);
  const [allNeeds, setAllNeeds] = useState(false);
  const howId = useId();
  const load = useCallback(async () => {
    try { const x = await overviewApi.get(admin); setO(x); setErr(null); setLoadedAt(new Date());
      if (x.institution && !x.first_run) inst.profile(x.institution.institution_id).then(setProfile).catch(() => {}); }
    catch (e) { setErr(e); }
  }, [admin]);
  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t); }, [load]);

  if (!o) return <div className="page">{err ? <><PageHead title="Overview" /><LoadError error={err} onRetry={load} /></> : <PageSkeleton bare />}</div>;
  if (o.first_run) return <FirstRun o={o} />;
  const i = o.institution!;
  const c = o.counts;
  const s = o.services;
  const names = { ...Object.fromEntries(Object.entries(o.map.places).map(([k, v]) => [k, v.name])), ...(profile?.place_names ?? {}) };
  const f24 = c.findings_24h.timeseries + c.findings_24h.monitor + c.findings_24h.radar;
  const sources = c.monitors_live + c.series_watched + (s.radar.connected ? 1 : 0);
  const events = [...o.events].sort((x, y) => RANK[x.tone] - RANK[y.tone]);
  const bad = events.filter(e => e.tone === "bad");
  const alerts = c.alerts_to_review;
  // one place per fact: the alerts are the headline, so they aren't a row again; late prices become one row, not one each
  const late = o.attention.filter(a => a.kind === "series");
  const rest: Attention[] = [
    ...o.attention.filter(a => a.kind !== "alerts" && a.kind !== "series"),
    ...(late.length ? [{ kind: "series", audience: "user", level: "warn", link: "/series", at: null,
      title: late.length === 1 ? plainNote(late[0].title) : `${plural(late.length, "market price")} stopped updating`,
      detail: late.length === 1 ? null : late.map(a => a.title.split(":")[0]).join(", ") } as Attention] : []),
  ];
  const more = rest.length + o.attention_more;
  const updated = loadedAt ? ago(loadedAt.toISOString(), now) : "";

  // ---- layer 0: the headline answers "does anything need my teams?" and the one button under it is the next step
  const worst = bad[0];
  const head: { title: string; line: ReactNode; cta: ReactNode } = alerts
    ? { title: `${plural(alerts, "alert")} need${alerts === 1 ? "s" : ""} your teams`,
        line: worst ? <>Most serious: <ToneMark tone="bad" label="bad for you:" /><Link className="rd-name" to={`/events/${worst.event_id}`}>{eventTitle(worst)}</Link>
          {worst.effects ? <>, with {plural(worst.effects, "possible impact")} on your products.</> : <>, bad for you.</>}</>
          : <>Early warnings for products your teams own.</>,
        cta: <Link className="btn btn--primary btn--lg" to="/alerts">Review the alerts →</Link> }
    : events.length
      ? { title: "No alerts for your teams", line: <>Amiri Agent is following {plural(events.length, "open event")}; none needs a team yet.</>,
          cta: <Link className="btn btn--primary btn--lg" to="/events">See the open events →</Link> }
      : { title: s.tick.ok ? "All clear" : "Nothing open right now",
          line: s.tick.ok ? <>No alerts and no open events. Amiri Agent is watching {plural(sources, "source")}.</>
            : <span className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> Updates aren't running, so no new news or prices arrive.</span>,
          cta: <Link className="btn btn--primary btn--lg" to="/studio">See how it responds: try a what-if →</Link> };
  const watching = andList([plural(c.monitors_live, "monitor"), plural(c.series_watched, "market price"), ...(s.radar.connected ? ["Radar"] : [])]);
  const hint = [
    events.length > 0 && <a key="e" href="#ov-events">{plural(events.length, "open event")}</a>,
    more > 0 && <a key="n" href="#ov-needs">{plural(more, alerts ? "more thing" : "thing")} need{more === 1 ? "s" : ""} you</a>,
    o.findings.length > 0 && <a key="f" href="#ov-findings">latest findings</a>,
  ].filter(Boolean);

  // ---- layer 2 summaries: from data the page already has; a problem is named, in words and with ◆
  const stale = o.markets.filter(m => m.state === "stale");
  const staleDays = [...new Set(stale.map(m => staleDay(m.state_reason)).filter((d): d is string => !!d))];
  const allStale = o.markets.length > 0 && stale.length === o.markets.length;
  const mover = [...o.markets].filter(m => m.change_1d_pct != null).sort((a, b) => Math.abs(b.change_1d_pct!) - Math.abs(a.change_1d_pct!))[0];
  const moverDay = mover && mover.state === "stale" ? staleDay(mover.state_reason) : null;
  const marketSummary = [
    <span key="p">{plural(o.markets.length, "price")}</span>,
    stale.length > 0 && <span key="s" className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {allStale ? "" : `${stale.length} `}not updated {staleDays.length === 1 ? `since ${staleDays[0]}` : "lately"}</span>,
    mover && <span key="m">{shortName(mover.name)} {pct(mover.change_1d_pct)} {mover.state === "stale" ? `on its last day${moverDay ? ` (${moverDay})` : ""}` : "today"}</span>,
  ].filter(Boolean);
  const inEvent = o.radar.stories.filter(r => r.event_id).length;
  const radarSummary = !s.radar.connected ? "Not connected yet"
    : [o.radar.stories.length ? plural(o.radar.stories.length, "story", "stories") : "No stories yet", `runs ${scheduleText(o.radar.every_minutes, o.radar.run_at)}`,
      o.radar.stories.length > 0 && (inEvent === o.radar.stories.length ? `${inEvent === 1 ? "it's" : `all ${inEvent}`} in an event` : `${inEvent} in an event`)].filter(Boolean).join(" · ");
  const agents = [["Investigation", s.investigation.connected], ["News monitors", s.monitor.connected], ["Setup agent", s.assistant.connected], ["Radar", s.radar.connected]] as const;
  const down = agents.filter(([, up]) => !up);
  const warn = (k: string, t: ReactNode) => <span key={k} className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {t}</span>;
  const healthSummary = [
    !s.tick.last_at ? warn("t", "Updates haven't run yet") : s.tick.ok ? <span key="t">Updates ran {ago(s.tick.last_at, now)}</span> : warn("t", `Updates late: last ran ${ago(s.tick.last_at, now)}`),
    down.length ? warn("a", `${down.length} of ${agents.length} agents not connected`) : <span key="a">all {agents.length} agents connected</span>,
    o.studio && <span key="s">Studio scenario on day {o.studio.step} of {o.studio.steps}</span>,
  ].filter(Boolean);

  const needsShown = allNeeds ? rest : rest.slice(0, TOP);

  return (
    <div className="page rd rd-overview">
      <div className="rd-ov-top">
        <span>{longDate(now)} · {ZONE_LABEL} time</span><span className="rd-ov-sp" />
        <span>Updated {updated}</span>
        <button className="rd-ov-refresh" type="button" aria-label="Refresh" title="Refresh" onClick={load}><Icon name="refresh" /></button>
      </div>
      {err != null && <Banner kind="warn" icon="warn">Couldn't refresh: {isDown(err) ? "Amiri Agent didn't answer" : errText(err)}. Showing what was loaded {updated}.</Banner>}

      {/* ---------------- layer 0 */}
      <div className="rd-ov-hero">
        <div className="rd-ov-words" ref={wordsRef}>
          <h1 className="rd-ov-h1">{head.title}</h1>
          <p className="rd-lede">{head.line}</p>
          <div className="rd-ov-cta">{head.cta}</div>
          <Figures size={40} label="What Amiri Agent found, traced to you, and who must act" items={[
            { value: <CountUp value={f24} />, label: "new findings", sub: "in the last 24 hours", to: "/findings" },
            { value: <CountUp value={c.open_events} />, label: "open events", sub: c.open_events ? `${bad.length} bad for you` : "none open", to: "/events" },
            { value: <>{alerts > 0 && <span className="rd-ov-hot" aria-hidden="true">▲</span>}<CountUp value={alerts} /></>, label: "alerts to review",
              sub: alerts ? "for your teams" : "all caught up", to: "/alerts", hot: alerts > 0 },
          ]} />
          <p className="rd-ov-cap">Watching {plural(sources, "source")}: {watching}.
            {c.monitors_waiting_approval > 0 && <> {plural(c.monitors_waiting_approval, "monitor")} {c.monitors_waiting_approval === 1 ? "is" : "are"} waiting for approval.</>}
            {" "}<TextButton aria-expanded={how} aria-controls={howId} onClick={() => setHow(h => !h)}>How this works</TextButton></p>
        </div>
        <div className="rd-ov-map">
          <h2 className="sr">Where it's happening</h2>
          <p className="sr">{events.length ? `Open events by place: ${events.map(e => `${eventTitle(e)}, ${TONE_WORD[e.tone].toLowerCase()}${e.places.length ? ` (${e.places.map(p => names[p] ?? p).join(", ")})` : ""}`).join("; ")}.` : "No open events on the map."} Places where you operate: {Object.values(names).slice(0, 12).join(", ")}.</p>
          {profile ? <ProfileMap profile={profile} height={mapH} compact legend={false} labelTones={["bad"]} focusTones={["bad", "mixed", "good"]} markScale={0.85} layers={["footprint", "flows", "risks"]}
            events={[...events].reverse().map(  /* drawn in reverse, so the bad ones sit on top */e => ({ event_id: e.event_id, title: eventTitle(e), tone: e.tone, places: e.places }))}
            extraPlaces={o.map.places} onEvent={id => nav(`/events/${id}`)} />
            : <div className="rd-ov-mapph" style={{ height: mapH }} aria-hidden="true" />}
          <MapKey reachesFlows={events.some(e => e.tone !== "neutral")} />
        </div>
      </div>
      <div id={howId} className="rd-ov-how" hidden={!how}>
        <HowItWorks><p>The three numbers above follow these steps for {i.name}: what Amiri Agent found in the last day, what it traced to your products, and who must act. The line under them says what it watches.</p></HowItWorks>
      </div>
      {hint.length > 0 && <p className="rd-ov-hint"><span aria-hidden="true">↓ </span>{hint.flatMap((h, n) => (n ? [" · ", h] : [h]))}</p>}

      {/* ---------------- layer 1 */}
      <div className="rd-ov-l1">
        <Section id="ov-events" title="Open events" count={events.length || undefined}>
          {!events.length ? <p className="rd-ov-empty">No open events. When Amiri Agent traces news or a price move to your products, it appears here.</p>
            : events.slice(0, TOP).map(e => (
              <div key={e.event_id} className="rd-row">
                <div className="rd-row-t rd-ov-evt"><ToneMark tone={e.tone} /><Link className="rd-name" to={`/events/${e.event_id}`}>{eventTitle(e)}</Link>
                  {/* the shape is already at the start of the line: the word stands alone at the end */}
                  <span className={`rd-toneword rd-w-${e.tone}`}>{TONE_WORD[e.tone]}</span></div>
                <div className="rd-row-d">{impactLine(e)}</div>
              </div>))}
          <div className="rd-ov-all"><GoLink to="/events">{events.length > TOP ? `See all ${events.length} open events` : "See all events"}</GoLink></div>
        </Section>

        <Section id="ov-needs" title={alerts ? "Also needs you" : "Needs you"} count={more || undefined}>
            {!rest.length ? <div className="rd-row"><div className="rd-row-t">{alerts ? "Nothing else needs you" : "Nothing needs you right now"}</div>
              <div className="rd-row-m">Approvals, failed checks, prices that stop updating and gaps in your profile appear here.</div></div>
              : needsShown.map((a, n) => (
                <div key={n} className="rd-row">
                  <div className="rd-row-t">{a.link ? <Link className="rd-name" to={a.link}>{plainNote(a.title)}</Link> : plainNote(a.title)}</div>
                  {a.detail && <div className="rd-row-m rd-clamp1" title={a.detail}>{a.detail}</div>}
                </div>))}
            {(rest.length > TOP || o.attention_more > 0) && <p className="rd-ov-note">
              {rest.length > TOP && <TextButton aria-expanded={allNeeds} onClick={() => setAllNeeds(v => !v)}>{allNeeds ? "Show fewer" : `Show ${rest.length - TOP} more`}</TextButton>}
              {o.attention_more > 0 && <span className="rd-fine">{rest.length > TOP ? " · " : ""}and {o.attention_more} more not listed here</span>}</p>}
            {o.admin_notes > 0 && <p className="rd-fine rd-ov-note">{plural(o.admin_notes, "note")} about Amiri Agent's own services {o.admin_notes === 1 ? "is" : "are"} with your Platform Admin.</p>}
          </Section>

          <Section id="ov-findings" title="Latest findings" count={o.findings.length || undefined}>
            {!o.findings.length ? <p className="rd-ov-empty">No findings yet. They appear here when a monitor, a market price or Radar notices something.</p>
              : o.findings.slice(0, TOP).map(f => (
                <div key={f.finding_id} className="rd-row">
                  <div className="rd-ov-find rd-clamp1" title={f.title}><Link className="rd-name" to={f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`}>{f.title}</Link></div>
                  <div className="rd-row-m">{SOURCE_WORD[f.source] ?? f.source} · {dayTime(f.created_at)} · {findingStatus(f)}</div>
                </div>))}
            <div className="rd-ov-all"><GoLink to="/findings">See all findings</GoLink></div>
          </Section>
      </div>

      {/* ---------------- layer 2 */}
      <Section className="rd-ov-l2" title="More from Amiri Agent">
        {o.markets.length > 0 && <Fold remember="overview.markets" title="Markets" summary={<span className="rd-dots">{marketSummary}</span>}>
          {allStale && staleDays.length === 1 && <QuietWarn>Prices haven't updated since {staleDays[0]}; the changes are from each price's last day.</QuietWarn>}
          <table className="rd-table rd-ov-mk">
            <thead><tr><th>Market</th>{!allStale && <th>State</th>}<th className="rd-num">Price</th><th>Recent days</th><th className="rd-num">{allStale ? "Last day's change" : "Day's change"}</th></tr></thead>
            <tbody>{o.markets.map(m => {
              const [word] = SERIES_STATE[m.state] ?? [m.state];
              const d = staleDay(m.state_reason);
              return (
                <tr key={m.series_id}>
                  <td className="rd-strong"><Link className="rd-name" to={`/series/${m.series_id}`}>{m.name}</Link></td>
                  {!allStale && <td>{m.state === "moved" ? <span className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {word}</span>
                    : m.state === "stale" ? <span className="rd-warn">Not updated{d ? ` since ${d}` : ""}</span> : word}</td>}
                  <td className="rd-num">{price(m.close)}</td>
                  <td><Spark values={m.spark} w={96} h={24} color={m.state === "moved" ? "var(--high)" : "var(--ink-3)"} /></td>
                  <td className="rd-num">{pct(m.change_1d_pct)}</td>
                </tr>);
            })}</tbody>
          </table>
          <GoLink to="/series">See market series</GoLink>
        </Fold>}

        <Fold remember="overview.radar" title="Latest from Radar" summary={radarSummary}>
          {s.radar.connected && <p className="rd-fine" style={{ margin: "0 0 4px" }}>Prototype: runs {scheduleText(o.radar.every_minutes, o.radar.run_at)} ({ZONE_LABEL} time). Check now can run it {o.radar.run_now_limit} times a day.</p>}
          {!o.radar.stories.length ? <p style={{ margin: 0 }}>{s.radar.connected ? "No stories yet." : "Radar isn't connected yet."}</p>
            : o.radar.stories.map(r => (
              <div key={r.story_id} className="rd-row">
                <div className="rd-ov-find rd-clamp1" title={r.title}><Link className="rd-name" to={r.event_id ? `/events/${r.event_id}` : "/radar"}>{r.title}</Link></div>
                <div className="rd-row-m rd-dots"><span>{ago(r.last_seen_at, now)}</span><span>{plural(r.publishers, "publisher")}</span>
                  <span>{r.status === "sent" ? (r.event_id ? "in an event" : "sent for investigation") : r.status === "below" ? "not sent this run" : "dismissed"}</span>
                  {admin && <span>Radar score {r.score}</span>}</div>
              </div>))}
          <GoLink to="/radar">Open Radar</GoLink>
        </Fold>

        <Fold remember="overview.health" title="Is Amiri Agent working?" summary={<span className="rd-dots">{healthSummary}</span>}>
          <table className="rd-table">
            <tbody>
              <tr><td className="rd-strong">Updates</td><td>{!s.tick.last_at ? warn("t", "Haven't run yet")
                : s.tick.ok ? <>Last ran {ago(s.tick.last_at, now)}</> : warn("t", <>Late: last ran {ago(s.tick.last_at, now)}</>)}</td></tr>
              {agents.map(([n, up]) => (
                <tr key={n}><td className="rd-strong">{n}</td><td>{up ? "Working" : warn(n, "Not connected")}</td></tr>))}
              {o.studio && <tr><td className="rd-strong">Scenario Studio</td>
                <td><Link className="rd-name" to={`/studio/run/${o.studio.sim_id}`}>{o.studio.title}</Link>, day {o.studio.step} of {o.studio.steps}</td></tr>}
            </tbody>
          </table>
        </Fold>
      </Section>
    </div>
  );
}

