// The Overview: the Risk Manager's first page. What is happening to
// the institution, what needs them, and whether Amiri Agent is working. One call; refreshed every minute.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { inst, type Profile } from "../api/institutions";
import { overviewApi, type Attention, type Overview } from "../api/overview";
import { scheduleText } from "../api/radar";
import { HowItWorks, PageHeader, TonePill } from "../components/blocks";
import type { SeriesState } from "../api/series";
import { Spark } from "../components/charts";
import { StateBadge } from "../components/series";
import { Icon } from "../components/Icon";
import { Banner, CountUp, DEMOS, PageSkeleton, useNow, useRole } from "../components/ui";
import { ago, dayTime, pct, placeName, placeOrder, plural, price, TIME_ZONE, ZONE_LABEL } from "../format";
import { eventTitle, setAsideReason, themeLabel } from "../plain";
import { ProfileMap } from "./institution/ProfileMap";

const REFRESH_MS = 60_000;
const LEVEL_ICON: Record<Attention["level"], string> = { crit: "warn", warn: "warn", info: "info" };
const RANK = { bad: 0, mixed: 1, good: 2, neutral: 3 };  // what hurts first

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
    { done: !!i, title: "Tell Amiri Agent about your institution", body: "Where you operate, who your customers are, your products, flows, regulators, rivals and risks. Talk to the setup agent, or use the forms.",
      action: <Link className={`btn${i ? " btn--primary" : ""}`} to={i ? "/institution/setup" : "/institution/new"}><Icon name="chat" />{i ? "Continue setup" : "Start setup"}</Link> },
    { done: !!i && i.readiness.ready && i.status === "active", title: "Check it and go live",
      body: i ? (i.readiness.ready ? "Everything required is there. Activate the profile so the agents use it." : `${plural(i.readiness.missing_required, "required item")} still missing.`) : "Once the profile has what's required, activate it.",
      action: <Link className="btn" to="/institution/setup/review">Review</Link> },
    { done: o.counts.monitors_live > 0, title: "Choose what to watch", body: "Draft monitors from your profile: a corridor's jobs, a regulator's rules, a rival's prices. A Risk Manager approves each one.",
      action: <Link className="btn" to="/monitors">Monitors</Link> },
  ];
  return (
    <div className="page ovx">
      <PageHeader title="Welcome to Amiri Agent"
        status={i ? <>Three steps, and Amiri Agent starts watching the world for <b className="ink">{i.name}</b>.</>
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
          <span className="small muted">Run a sharp currency fall on your institution in the Scenario Studio: headlines arrive, prices move, and Amiri Agent's monitors and investigation respond. Nothing touches live data.</span></div>
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
  const [err, setErr] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const load = useCallback(async () => {
    try { const x = await overviewApi.get(admin); setO(x); setErr(null); setLoadedAt(new Date());
      if (x.institution && !x.first_run) inst.profile(x.institution.institution_id).then(setProfile).catch(() => {}); }
    catch (e) { setErr(e instanceof ApiError ? e.full : String(e)); }
  }, [admin]);
  useEffect(() => { load(); const t = setInterval(load, REFRESH_MS); return () => clearInterval(t); }, [load]);

  if (!o) return <div className="page">{err ? <Banner kind="crit" icon="warn">{err}</Banner> : <PageSkeleton bare />}</div>;
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
    ? { title: `${plural(alerts, "alert")} need${alerts === 1 ? "s" : ""} your teams`,
        line: bad.length ? <>Most serious: <Link to={`/events/${bad[0].event_id}`}><b>{eventTitle(bad[0])}</b></Link>, bad for you</> : <>Early warnings for products your teams own</>,
        cta: <Link className="btn btn--primary btn--lg" to="/alerts">Review the alerts<Icon name="arrow" /></Link> }
    : o.events.length
      ? { title: "No alerts for your teams", line: <>Amiri Agent is following {plural(o.events.length, "open event")}; none needs a team yet</>,
          cta: <Link className="btn btn--primary btn--lg" to="/events">See the open events<Icon name="arrow" /></Link> }
      : { title: s.tick.ok ? "All clear" : "Nothing open right now",
          line: s.tick.ok ? <>No alerts and no open events. Amiri Agent is watching {plural(sources, "source")}.</>
            : <span className="ovx-warn"><Icon name="warn" />Updates aren't running, so no new news or prices arrive</span>,
          cta: <Link className="btn btn--primary btn--lg" to="/studio"><Icon name="studio" />See how it responds: try a what-if</Link> };

  return (
    <div className="page ovx">
      <PageHeader eyebrow={`${greeting(now)} · ${longDate(now)} · ${ZONE_LABEL}`} title={head.title}
        status={<>{head.line}{more > 0 && <> · <a href="#needs">{plural(more, "more thing")} below</a></>}</>}
        cta={head.cta}
        actions={<>
          <span className="small muted">Updated {loadedAt ? ago(loadedAt.toISOString(), now) : ""}</span>
          <button className="btn btn--ghost btn--icon" type="button" aria-label="Refresh" onClick={load}><Icon name="refresh" /></button></>}
        help={<HowItWorks><p>The four numbers below follow the same steps for {i.name}: what Amiri Agent watches, what it found in the last day, what it traced to your products, and who must act.</p></HowItWorks>} />
      {err && <Banner kind="warn" icon="warn">Couldn't refresh: {err}. Showing what was loaded {loadedAt ? ago(loadedAt.toISOString(), now) : ""}.</Banner>}

      <div className="ovx-kpis" role="group" aria-label="How Amiri Agent works: what it watches, what it found, what it traced to you, who must act">
        <Link to="/monitors" className="card ovx-kpi">
          <span className="step">1 · Watching</span>
          <span className="v"><CountUp value={sources} /></span><span className="l">Sources</span>
          <span className="s">{[plural(c.monitors_live, "monitor"), plural(c.series_watched, "market price"), s.radar.connected && "Radar"].filter(Boolean).join(" · ")}
            {c.monitors_waiting_approval ? <><br />{c.monitors_waiting_approval} waiting for approval</> : null}</span></Link>
        <Link to="/findings" className="card ovx-kpi">
          <span className="step">2 · Found</span>
          <span className="v"><CountUp value={f24} /></span><span className="l">Findings, last 24 h</span>
          <span className="s">{f24 ? [c.findings_24h.monitor && `${c.findings_24h.monitor} from news`, c.findings_24h.timeseries && `${c.findings_24h.timeseries} from prices`,
            c.findings_24h.radar && `${c.findings_24h.radar} from Radar`].filter(Boolean).join(" · ") : "nothing new today"}</span></Link>
        <Link to="/events" className="card ovx-kpi">
          <span className="step">3 · Traced to you</span>
          <span className="v"><CountUp value={c.open_events} /></span><span className="l">Open events</span>
          <span className="s">{c.open_events ? `${bad.length} bad for you · ${plural(c.effects_to_watch, "possible impact")}` : "none open"}</span></Link>
        <Link to="/alerts" className={`card ovx-kpi${alerts ? " hot" : ""}`}>
          <span className="step">4 · Who must act</span>
          <span className="v">{alerts > 0 && <Icon name="warn" />}<CountUp value={alerts} /></span><span className="l">Alerts to review</span>
          <span className="s">{alerts ? "for your teams to acknowledge" : "all caught up"}</span></Link>
      </div>

      <div className="ov-grid">
        <div className="col gap16">
          <div className="card" id="needs"><div className="hd"><h2>{alerts ? "Also waiting for you" : "Needs you"}</h2></div>
            {!rest.length ? <div className="ov-need" data-lv="info" style={{ ["--lv" as string]: "var(--accent)" }}>
              <span className="ico"><Icon name="check" /></span><div><div className="t">{alerts ? "Nothing else needs you" : "Nothing needs you right now"}</div>
                <div className="d">Approvals, failed checks, prices that stop updating and gaps in your profile appear here.</div></div></div>
              : rest.map((a, n) => {
                const body = <><span className="ico"><Icon name={LEVEL_ICON[a.level]} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="t">{plainNote(a.title)}</div>{a.detail && <div className="d">{a.detail}</div>}</div>
                  {a.link && <Icon name="chevron" className="row-go" />}</>;
                return a.link ? <Link key={n} to={a.link} className="ov-need" data-lv={a.level}>{body}</Link>
                  : <div key={n} className="ov-need" data-lv={a.level}>{body}</div>;
              })}
            {o.attention_more > 0 && <div className="li small muted">and {o.attention_more} more</div>}
            {o.admin_notes > 0 && <div className="li small muted">{plural(o.admin_notes, "note")} about Amiri Agent's own services {o.admin_notes === 1 ? "is" : "are"} with your Platform Admin.</div>}
          </div>

          <div className="card"><div className="hd"><h2>Open events</h2><span className="spacer" /><Link className="small" to="/events">All events</Link></div>
            {!o.events.length ? <div className="bd col" style={{ gap: 10 }}>
              <span className="small muted">No open events. When Amiri Agent traces news or a price move to your products, it appears here.</span></div>
              : [...o.events].sort((x, y) => RANK[x.tone] - RANK[y.tone]).map(e => (
                <Link key={e.event_id} to={`/events/${e.event_id}`} className="ov-event">
                  <div className="h"><span className="ttl">{eventTitle(e)}</span><TonePill tone={e.tone} /></div>
                  {e.top_effects.length > 0 && <ul className="fx">{e.top_effects.map((x, n) => (
                    <li key={n}><span className="muted">→</span><span><b>{x.product}</b>: {x.label}</span></li>))}</ul>}
                  <div className="ov-tags">{e.themes.map((t, n) => <span key={n} className="chip">{themeLabel(t)}</span>)}</div>
                  <div className="m"><span>{plural(e.effects, "possible impact")}</span>
                    {e.places.length > 0 && <span>{placeOrder(e.places).slice(0, 2).map(p => names[p] ?? placeName(p)).join(", ")}{e.places.length > 2 ? ` +${e.places.length - 2} more` : ""}</span>}
                    <span>last news {ago(e.last_finding_at, now)}</span></div>
                </Link>))}
          </div>
          <div className="card"><div className="hd"><h2>Latest findings</h2><span className="spacer" /><Link className="small" to="/findings">All findings</Link></div>
            {!o.findings.length ? <div className="bd small muted">None yet.</div> : <div className="list">{o.findings.map(f => (
              <Link key={f.finding_id} to={f.event_id ? `/events/${f.event_id}` : `/findings#f-${f.finding_id}`} className="li ov-finding">
                <Icon name={f.source === "monitor" ? "monitor" : f.source === "radar" ? "radar" : "series"} className="ico16" />
                <div className="col" style={{ gap: 2, minWidth: 0 }}><span className="small" style={{ color: "var(--ink)" }}>{f.title}</span>
                  <span className="meta">{dayTime(f.created_at)} · {findingStatus(f)}</span></div></Link>))}</div>}
          </div>

        </div>

        <div className="col gap16">
          {profile && <div className="card"><div className="hd"><h2>Where it's happening</h2></div><div className="bd">
            <p className="sr">{o.events.length ? `Open events by place: ${o.events.map(e => `${eventTitle(e)}${e.places.length ? ` (${e.places.map(p => names[p] ?? p).join(", ")})` : ""}`).join("; ")}.` : "No open events on the map."} Places where you operate: {Object.values(names).slice(0, 12).join(", ")}.</p>
            <ProfileMap profile={profile} height={290} compact layers={["footprint", "flows", "risks"]}
              events={o.events.map(e => ({ event_id: e.event_id, title: eventTitle(e), tone: e.tone, places: e.places }))}
              extraPlaces={o.map.places} onEvent={id => nav(`/events/${id}`)} /></div></div>}

          {o.markets.length > 0 && <div className="card"><div className="hd"><h2>Markets</h2><span className="spacer" /><Link className="small" to="/series">Market series</Link></div>
            {o.markets.map(m => (
              <Link key={m.series_id} to={`/series/${m.series_id}`} className="ov-mkt">
                <span className="ov-mkt-name"><span className="n">{m.name}</span>{m.state !== "normal" && <StateBadge state={m.state as SeriesState} />}</span>
                <span className="p">{price(m.close)}</span>
                <Spark values={m.spark} w={70} h={22} color={m.state === "moved" ? "var(--high)" : "var(--ink-3)"} />
                <span className="c">{pct(m.change_1d_pct)}</span>
              </Link>))}</div>}

          <div className="card"><div className="hd"><h2>Latest from Radar</h2><span className="spacer" /><Link className="small" to="/radar">Radar</Link></div>
            {s.radar.connected && <div className="bd small muted" style={{ paddingBottom: 0 }}>Prototype: {scheduleText(o.radar.every_minutes, o.radar.run_at)}, Check now {o.radar.run_now_limit} times a day.</div>}
            {!o.radar.stories.length ? <div className="bd small muted">{s.radar.connected ? "No stories yet." : "Radar isn't connected yet."}</div>
              : <div className="list">{o.radar.stories.map(r => (
                <Link key={r.story_id} to={r.event_id ? `/events/${r.event_id}` : "/radar"} className="li" style={{ textDecoration: "none", color: "inherit" }}>
                  <Icon name="radar" className="ico16" />
                  <div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}><span className="small" style={{ color: "var(--ink)", fontWeight: 600 }}>{r.title}</span>
                    <span className="meta">{ago(r.last_seen_at, now)} · {plural(r.publishers, "publisher")} · {r.status === "sent" ? (r.event_id ? "in an event" : "sent for investigation") : r.status === "below" ? "not important enough" : "dismissed"}</span></div>
                  {admin && <b className="small" style={{ fontVariantNumeric: "tabular-nums" }} title="Radar score">{r.score}</b>}</Link>))}</div>}
          </div>

          <div className="card" id="system"><div className="hd"><h2>Is Amiri Agent working?</h2></div>
            <div className="ov-sys">
              <span><span className={`statusdot ${s.tick.ok ? "sd-ok" : "sd-down"}`} aria-hidden="true" />Updates: {s.tick.last_at ? <>{s.tick.ok ? "last ran" : "late; last ran"} {ago(s.tick.last_at, now)}</> : "haven't run yet"}</span>
              {([["Investigation", s.investigation.connected], ["News monitors", s.monitor.connected], ["Setup agent", s.assistant.connected], ["Radar", s.radar.connected]] as const).map(([n, up]) => (
                <span key={n}><span className={`statusdot ${up ? "sd-ok" : "sd-off"}`} aria-hidden="true" />{n}: {up ? "working" : "not connected"}</span>))}
              {o.studio && <span><span className="statusdot sd-warn" /><Link to={`/studio/run/${o.studio.sim_id}`}>Studio: {o.studio.title}, day {o.studio.step} of {o.studio.steps}</Link></span>}
            </div></div>
        </div>
      </div>
    </div>
  );
}
