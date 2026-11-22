// The Overview: the Risk Manager's first page. What is happening to
// the institution, what needs them, and whether AMIRI Agent is working. One call; refreshed every minute.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { inst, type Check, type Profile } from "../api/institutions";
import { overviewApi, type Attention, type Overview } from "../api/overview";
import { scheduleText } from "../api/radar";
import { HowItWorks, PageHeader } from "../components/blocks";
import type { SeriesState } from "../api/series";
import { Spark } from "../components/charts";
import { Icon } from "../components/Icon";
import { Banner, CountUp, DEMOS, errText, isDown, LoadError, PageHead, PageSkeleton, useNow, useRole } from "../components/ui";
import { ago, dayTime, pct, placeName, placeOrder, plural, price, TIME_ZONE, ZONE_LABEL } from "../format";
import { eventTitle, SERIES_STATE, setAsideReason, themeLabel } from "../plain";
import { ProfileMap } from "./institution/ProfileMap";
import { TAB_OF_SECTION } from "./institution/InstitutionPage";
import { MoreInPlace, OverviewStory, Reveal } from "./OverviewStory";
import "../styles/polish-overview.css";
import "../styles/overview-story.css";

const REFRESH_MS = 60_000;
const RANK = { bad: 0, mixed: 1, good: 2, neutral: 3 };  // what hurts first
// every tone has a shape and a word (the map's shapes), so colour is never the only signal
const SHAPE = { bad: "▲", good: "●", mixed: "◆", neutral: "■" };
const TONE_WORD = { bad: "Bad for you", good: "Good for you", mixed: "Mixed for you", neutral: "Neutral for you" };
const LEVEL_SHAPE: Record<Attention["level"], string> = { crit: "▲", warn: "◆", info: "●" };
const SOURCE: Record<string, string> = { monitor: "News", timeseries: "Prices", radar: "Radar" };

function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TIME_ZONE }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const longDate = (now: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(now);

function findingStatus(f: Overview["findings"][number]) {
  if (f.event_id) return "in an event";
  return { new: "waiting to be investigated", grouped: "being investigated", linked: "in an event", set_aside: `no impact found${f.reason ? `: ${setAsideReason(f.reason)}` : ""}` }[f.status] ?? f.status;
}
/** A server note in plain words where it uses series wording ("No new bar since …"). */
const plainNote = (t: string) => t.replace(/^(.+?): No new bar since (.+?) \(.*\)\.?$/, "$1: prices haven't updated since $2");

function FirstRun({ o }: { o: Overview }) {
  const i = o.institution;
  const steps = [
    { done: !!i, title: "Tell AMIRI Agent about your institution", body: "Where you operate, who your customers are, your products, flows, regulators, rivals and risks. Talk to the setup agent, or use the forms.",
      action: <Link className={`btn${i ? " btn--primary" : ""}`} to={i ? "/institution/setup" : "/institution/new"}><Icon name="chat" />{i ? "Continue setup" : "Start setup"}</Link> },
    { done: !!i && i.readiness.ready && i.status === "active", title: "Check it and go live",
      body: i ? (i.readiness.ready ? "Everything required is there. Activate the profile so the agents use it." : `${plural(i.readiness.missing_required, "required item")} still missing.`) : "Once the profile has what's required, activate it.",
      action: <Link className="btn" to="/institution/setup/review">Review</Link> },
    { done: o.counts.monitors_live > 0, title: "Choose what to watch", body: "Draft monitors from your profile: a corridor's jobs, a regulator's rules, a rival's prices. A Risk Manager approves each one.",
      action: <Link className="btn" to="/monitors">Monitors</Link> },
  ];
  return (
    <div className="page ovx">
      <PageHeader title="Welcome to AMIRI Agent"
        status={i ? <>Three steps, and AMIRI Agent starts watching the world for <b className="ink">{i.name}</b>.</>
          : <>See it work on a sample institution in one click, or set up your own.</>} />
      {!i && <DemoCard />}
      {!i && <h2 className="ovx-or">Or set up your own institution</h2>}
      <div className="ov-steps">{steps.map((st, n) => {
        const locked = n > 0 && !steps[n - 1].done && !st.done;  // a step opens once the one before it is done
        return (
          <div key={st.title} className={`card ov-step ${st.done ? "done" : ""} ${locked ? "locked" : ""}`}>
            <span className="n">{st.done ? <Icon name="check" /> : n + 1}<span className="sr">{st.done ? " (done)" : locked ? " (after the step before)" : ""}</span></span>
            <h3>{st.title}</h3>
            <p className="small muted" style={{ margin: 0, flex: 1 }}>{st.body}</p>
            <div className="row">{locked ? <span className="small muted">After step {n}</span> : st.action}</div></div>);
      })}</div>
      {i && <div className="card mt16"><div className="bd row wrap" style={{ gap: 16 }}>
        <div className="col" style={{ gap: 4, flex: 1, minWidth: 260 }}><h2 style={{ margin: 0 }}>See it work first</h2>
          <span className="small muted">Run a sharp currency fall on your institution in the Scenario Studio: headlines arrive, prices move, and AMIRI Agent's monitors and investigation respond. Nothing touches live data.</span></div>
        <Link className="btn" to="/studio"><Icon name="studio" />Open the Scenario Studio</Link></div></div>}
    </div>
  );
}

/** No institution yet: load one of the two invented demos in one click (the server refuses once an institution exists). */
function DemoCard() {
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
    <section className="card ovx-demo" aria-labelledby="demo-h"><div className="bd">
      <span className="label">Fastest way in</span>
      <h2 id="demo-h">Start with a demo</h2>
      <p>An invented institution with its whole profile, ready to try everything on. No real customer data.</p>
      <div className="ovx-demo-btns">{DEMOS.map((d, n) => (
        <button key={d.kind} className={`btn btn--lg${n === 0 ? " btn--primary" : ""}`} type="button" disabled={!!busy} onClick={() => load(d.kind)}>
          <Icon name={d.kind === "bank" ? "bank" : "health"} />
          <span className="ovx-demo-t"><b>{busy === d.kind ? "Loading…" : `Load the ${d.label.toLowerCase()}`}</b><span>{d.name}, {d.what.charAt(0).toLowerCase()}{d.what.slice(1)}</span></span></button>))}</div>
      {err && <div className="errtext" role="alert">{err}</div>}
    </div></section>
  );
}

export function OverviewPage() {
  const nav = useNavigate();
  const now = useNow(30_000);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [o, setO] = useState<Overview | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recs, setRecs] = useState<Check[]>([]);  // the open recommendations, shown inside their "Also waiting" card
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try { const x = await overviewApi.get(admin); setO(x); setErr(null); setLoadedAt(new Date());
      if (x.institution && !x.first_run) inst.profile(x.institution.institution_id).then(setProfile).catch(() => {});
      if (x.institution && x.attention.some(a => a.kind === "recommended"))
        inst.readiness(x.institution.institution_id).then(r => setRecs(r.checks.filter(c => c.level === "recommended" && !c.ok))).catch(() => {}); }
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
  const bad = o.events.filter(e => e.tone === "bad");
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

  // The headline answers "does anything need my teams?" and the one button under it is the next step.
  const head = alerts
    ? { title: <><span className="ovx-n">{alerts}</span> alert{alerts === 1 ? "" : "s"} need{alerts === 1 ? "s" : ""} your attention</>,
        line: bad.length ? <>Most serious: <Link to={`/events/${bad[0].event_id}`}><b>{eventTitle(bad[0])}</b></Link>, bad for you</> : <>Early warnings for products your teams own</>,
        cta: <Link className="btn btn--primary btn--lg" to="/alerts">Review the alerts<Icon name="arrow" /></Link> }
    : o.events.length
      ? { title: "No alerts for your teams", line: <>AMIRI Agent is following {plural(o.events.length, "open event")}; none needs a team yet</>,
          cta: <Link className="btn btn--primary btn--lg" to="/events">See the open events<Icon name="arrow" /></Link> }
      : { title: s.tick.ok ? "All clear" : "Nothing open right now",
          line: s.tick.ok ? <>No alerts and no open events. AMIRI Agent is watching {plural(sources, "source")}.</>
            : <span className="ovx-warn"><Icon name="warn" />Updates aren't running, so no new news or prices arrive</span>,
          cta: <Link className="btn btn--primary btn--lg" to="/studio"><Icon name="studio" />See how it responds: try a what-if</Link> };

  // the map fills the hero beside the headline: 520 px on a full-HD screen, less on a shorter one so the steps and cue still fit
  // ponytail: read at render (the page re-renders every 30 s), not on resize; add a resize listener if that ever matters
  const mapH = Math.min(520, Math.max(320, window.innerHeight - 500));
  const below = 4 + (o.markets.length > 0 ? 1 : 0);  // the sections under the first screen, for the scroll cue

  const needRow = (a: Attention, n: number) => {
    // the profile's recommendations: each one by name, with what it found and a link to fix it; the rest on the Institution page
    if (a.kind === "recommended" && recs.length) return <div key={n} className="ovt-row ovt-need" data-lv={a.level}>
      <span className="ovt-tt"><span className="ovt-sh" aria-hidden="true">{LEVEL_SHAPE[a.level]}</span>{plainNote(a.title)}</span>
      <ul className="ovt-recs">{recs.slice(0, 3).map(c => <li key={c.id}>
        <Link to={`/institution/${TAB_OF_SECTION[c.section] ?? "overview"}`}>{c.fix.replace(/\.$/, "")} →</Link><span className="ovt-m">{c.message}</span></li>)}</ul>
      {recs.length > 3 && <Link className="ovt-all" to="/institution">See all {recs.length} in the profile →</Link>}</div>;
    const body = <><span className="ovt-tt"><span className="ovt-sh" aria-hidden="true">{LEVEL_SHAPE[a.level]}</span>{plainNote(a.title)}</span>{a.detail && <span className="ovt-m">{a.detail}</span>}</>;
    return a.link ? <Link key={n} to={a.link} className="ovt-row ovt-need" data-lv={a.level}>{body}</Link>
      : <div key={n} className="ovt-row ovt-need" data-lv={a.level}>{body}</div>;
  };
  // Radar's blips are labelled with where each story is: its sea or strait first, else its first country
  const radarAt = o.radar.stories.map(r => { const p = placeOrder(r.places)[0]; return p ? names[p] ?? placeName(p) : ""; });
  const late2 = o.markets.filter(m => m.state === "stale").length;  // prices that stopped updating; an unusual move is not one
  const big = [...o.markets].sort((x, y) => Math.abs(y.change_1d_pct ?? 0) - Math.abs(x.change_1d_pct ?? 0))[0];
  const marketsLine = [plural(o.markets.length, "price"), late2 ? `${late2} not updated` : null, big ? `biggest move today ${big.name} ${pct(big.change_1d_pct)}` : null].filter(Boolean).join(" · ");

  return (
    <div className="page ovx">
      {err != null && <Banner kind="warn" icon="warn">Couldn't refresh: {isDown(err) ? "AMIRI Agent didn't answer" : errText(err)}. Showing what was loaded {loadedAt ? ago(loadedAt.toISOString(), now) : ""}.</Banner>}
      {/* the first screen: headline beside the live map, the four steps beneath */}
      <div className="ovx-hero" data-state={alerts ? "alert" : "calm"}>
      <PageHeader eyebrow={`${greeting(now)} · ${longDate(now)} · ${ZONE_LABEL}`} title={head.title}
        status={<>{head.line}{more > 0 && <> · <a href="#needs">{plural(more, "more thing")} below</a></>}</>}
        cta={head.cta}
        actions={<>
          <span className="small muted">Updated {loadedAt ? ago(loadedAt.toISOString(), now) : ""}</span>
          <button className="btn btn--ghost btn--icon" type="button" aria-label="Refresh" onClick={load}><Icon name="refresh" /></button></>}
        help={<HowItWorks><p>The four numbers below follow the same steps for {i.name}: what AMIRI Agent watches, what it found in the last day, what it traced to your products, and who must act.</p></HowItWorks>} />

      {profile && <section className="ovx-map" aria-labelledby="ovx-map-h"><h2 id="ovx-map-h" className="sr">Where it's happening</h2>
        <p className="sr">{o.events.length ? `Open events by place: ${o.events.map(e => `${eventTitle(e)}${e.places.length ? ` (${e.places.map(p => names[p] ?? p).join(", ")})` : ""}`).join("; ")}.` : "No open events on the map."} Places where you operate: {Object.values(names).slice(0, 12).join(", ")}.</p>
        <ProfileMap profile={profile} height={mapH} compact layers={["footprint", "flows", "risks"]}
          events={o.events.map(e => ({ event_id: e.event_id, title: eventTitle(e), tone: e.tone, places: e.places }))}
          extraPlaces={o.map.places} onEvent={id => nav(`/events/${id}`)} /></section>}

      <div className="ovx-kpis" role="group" aria-label="How AMIRI Agent works: what it watches, what it found, what it traced to you, who must act">
        <Link to="/monitors" className={`ovx-kpi${sources ? " live" : ""}`}>
          <span className="step">1 · Watching</span>
          <span className="v"><CountUp value={sources} /></span><span className="l">Sources</span>
          <span className="s">{[plural(c.monitors_live, "monitor"), plural(c.series_watched, "market price"), s.radar.connected && "Radar"].filter(Boolean).join(" · ")}
            {c.monitors_waiting_approval ? <><br />{c.monitors_waiting_approval} waiting for approval</> : null}</span></Link>
        <Link to="/findings" className={`ovx-kpi${f24 ? " live" : ""}`}>
          <span className="step">2 · Found</span>
          <span className="v"><CountUp value={f24} /></span><span className="l">Findings, last 24 h</span>
          <span className="s">{f24 ? [c.findings_24h.monitor && `${c.findings_24h.monitor} from news`, c.findings_24h.timeseries && `${c.findings_24h.timeseries} from prices`,
            c.findings_24h.radar && `${c.findings_24h.radar} from Radar`].filter(Boolean).join(" · ") : "nothing new today"}</span></Link>
        <Link to="/events" className={`ovx-kpi${c.open_events ? " live" : ""}`}>
          <span className="step">3 · Traced to you</span>
          <span className="v"><CountUp value={c.open_events} /></span><span className="l">Open events</span>
          <span className="s">{c.open_events ? `${bad.length} bad for you · ${plural(c.effects_to_watch, "possible impact")}` : "none open"}</span></Link>
        <Link to="/alerts" className={`ovx-kpi${alerts ? " hot" : ""}`}>
          <span className="step">4 · Who must act</span>
          <span className="v">{alerts > 0 && <Icon name="warn" />}<CountUp value={alerts} /></span><span className="l">Alerts to review</span>
          <span className="s">{alerts ? "for your teams to acknowledge" : "all caught up"}</span></Link>
      </div>
      <div className="ovx-cue" aria-hidden="true">Scroll · {below} more sections</div>
      </div>

      <OverviewStory sections={[
        { id: "events", label: "Open events", count: o.events.length, scene: { kind: "events", data: { tones: [...o.events].sort((x, y) => RANK[x.tone] - RANK[y.tone]).slice(0, 3).map(e => e.tone), labels: [...o.events].sort((x, y) => RANK[x.tone] - RANK[y.tone]).slice(0, 3).map(e => eventTitle(e)), home: i.name }, label: "Each open event's news travelling to your bank, in its tone's colour; a neutral event's in grey" }, body: <>
          {!o.events.length ? <p className="ovt-empty">No open events. When AMIRI Agent traces news or a price move to your products, it appears here.</p>
            : [...o.events].sort((x, y) => RANK[x.tone] - RANK[y.tone]).slice(0, 3).map(e => (
              <div key={e.event_id} className="ovt-row ovt-ev" data-tone={e.tone}>
                <Link className="ovt-t" to={`/events/${e.event_id}`}><span className="ovt-sh" aria-hidden="true">{SHAPE[e.tone]}</span>
                  <span className="ovt-tt">{eventTitle(e)}</span><span className="ovt-tone">{TONE_WORD[e.tone]}</span></Link>
                <div className="ovt-d">{!e.effects ? "No possible impact on your products"
                  : `${plural(e.effects, "possible impact")}${e.top_effects.length ? `: ${e.top_effects.map(x => x.product).join(", ")}${e.effects > e.top_effects.length ? ` and ${e.effects - e.top_effects.length} more` : ""}` : ""}`}</div>
                <div className="ovt-m">{[e.places.length ? `${placeOrder(e.places).slice(0, 2).map(p => names[p] ?? placeName(p)).join(", ")}${e.places.length > 2 ? ` +${e.places.length - 2} more` : ""}` : null,
                  `last news ${ago(e.last_finding_at, now)}`].filter(Boolean).join(" · ")}</div>
                {e.top_effects.length > 0 && <Reveal label="How it reaches your products">
                  <table className="ovt-fx"><tbody>{e.top_effects.map((x, n) => <tr key={n}><th>{x.product}</th><td>{x.label}</td></tr>)}</tbody></table>
                  {e.themes.length > 0 && <div className="ovt-m">Themes: {e.themes.map(themeLabel).join(" · ")}</div>}</Reveal>}
              </div>))}
          <Link className="ovt-all" to="/events">See all {plural(o.events.length, "open event")} →</Link></> },
        { id: "needs", label: alerts ? "Also waiting for you" : "Needs you", count: more, scene: { kind: "needs", data: { n: Math.min(Math.max(rest.length, 1), 5) }, label: "One glowing point for each thing waiting for you, with particles settling around it" }, body: <>
          {!rest.length ? <p className="ovt-empty">{alerts ? "Nothing else needs you." : "Nothing needs you right now."} Approvals, failed checks, prices that stop updating and gaps in your profile appear here.</p>
            : <>{rest.slice(0, 3).map(needRow)}<MoreInPlace rest={rest.slice(3).map(needRow)} label={n => `Show ${n} more`} /></>}
          {o.attention_more > 0 && <p className="ovt-fine">and {o.attention_more} more</p>}
          {o.admin_notes > 0 && <p className="ovt-fine">{plural(o.admin_notes, "note")} about AMIRI Agent's own services {o.admin_notes === 1 ? "is" : "are"} with your Platform Admin.</p>}</> },
        { id: "findings", label: "Latest findings", count: o.findings.length, scene: { kind: "findings", data: { n: Math.min(o.findings.length, 6) }, label: "Drifting news, with a few signals pulled out into bright points" }, body: <>
          {!o.findings.length ? <p className="ovt-empty">No findings yet. They appear here when a monitor, a market price or Radar notices something.</p>
            : o.findings.slice(0, 3).map(f => (
              <Link key={f.finding_id} className="ovt-row" to={f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`}>
                <span className="ovt-tt2">{f.title}</span>
                <span className="ovt-m">{SOURCE[f.source] ?? f.source} · {dayTime(f.created_at)} · {findingStatus(f)}</span></Link>))}
          <Link className="ovt-all" to="/findings">See all findings →</Link></> },
        ...(o.markets.length ? [{ id: "markets", label: "Markets", scene: { kind: "markets" as const, data: { line: big?.spark }, label: "Particles running along the biggest mover's price line" }, body: <>
          <p className="ovt-sum">{marketsLine}</p>
          <table className="ovt-tbl"><tbody>{o.markets.map(m => (
            <tr key={m.series_id}><th><Link to={`/series/${m.series_id}`}>{m.name}</Link></th>
              <td className={m.state !== "normal" ? "ovt-warnw" : undefined}>{m.state !== "normal" ? `◆ ${SERIES_STATE[m.state as SeriesState][0]}` : "Normal"}</td>
              <td className="r">{price(m.close)}</td>
              <td><Spark values={m.spark} w={80} h={24} color={m.state === "moved" ? "var(--high)" : "var(--ink-3)"} /></td>
              <td className="r">{pct(m.change_1d_pct)}</td></tr>))}</tbody></table>
          <Link className="ovt-all" to="/series">See market series →</Link></> }] : []),
        { id: "radar", label: "Latest from Radar", count: o.radar.stories.length, scene: { kind: "radar", data: { n: o.radar.stories.length, labels: radarAt, ids: o.radar.stories.map(r => r.story_id), scores: o.radar.stories.map(r => r.score) }, label: `A radar sweep; each story is a bright blip, the most important nearest the centre${radarAt.some(Boolean) ? `: ${radarAt.filter(Boolean).join(", ")}` : ""}` }, body: <>
          {s.radar.connected && <p className="ovt-sum">Prototype: {scheduleText(o.radar.every_minutes, o.radar.run_at)}, Check now {o.radar.run_now_limit} times a day.</p>}
          {!o.radar.stories.length ? <p className="ovt-empty">{s.radar.connected ? "No stories yet." : "Radar isn't connected yet."}</p>
            : o.radar.stories.map(r => (
              <Link key={r.story_id} className="ovt-row" to={r.event_id ? `/events/${r.event_id}` : "/radar"}>
                <span className="ovt-tt2">{r.title}{admin && <b className="ovt-score" title="Radar score">{r.score}</b>}</span>
                <span className="ovt-m">{ago(r.last_seen_at, now)} · {plural(r.publishers, "publisher")} · {r.status === "sent" ? (r.event_id ? "in an event" : "sent for investigation") : r.status === "below" ? "not important enough" : "dismissed"}</span></Link>))}
          <Link className="ovt-all" to="/radar">Open Radar →</Link></> },
      ]} />
    </div>
  );
}
