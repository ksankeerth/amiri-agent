// The Overview: the Risk Manager's first page. What is happening to
// the institution, what needs them, and whether Amiri Agent is working. One call; refreshed every minute.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { inst, type Profile } from "../api/institutions";
import { overviewApi, type Attention, type Overview } from "../api/overview";
import { TONE } from "../api/studio";
import { Spark } from "../components/charts";
import { Icon } from "../components/Icon";
import { Banner, CountUp, PageSkeleton, useNow, useRole } from "../components/ui";
import { ago, dayTime, plural, price, TIME_ZONE, ZONE_LABEL } from "../format";
import { ProfileMap } from "./institution/ProfileMap";
import { themeText } from "./events/Events";

const REFRESH_MS = 60_000;
const LEVEL_ICON: Record<Attention["level"], string> = { crit: "warn", warn: "warn", info: "info" };
const RANK = { bad: 0, mixed: 1, good: 2, neutral: 3 };  // what hurts first
const KPI_TONE = { bad: "var(--critical)", good: "var(--accent)", mixed: "var(--high)", neutral: "var(--hairline-2)" };

function greeting(now: Date): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: TIME_ZONE }).format(now));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const longDate = (now: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TIME_ZONE }).format(now);

function findingStatus(f: Overview["findings"][number]) {
  if (f.event_id) return <Link to={`/events/${f.event_id}`}>in an event</Link>;
  return { new: "waiting for the investigation", grouped: "being investigated", set_aside: `set aside${f.reason ? `: ${f.reason.replace(/_/g, " ")}` : ""}` }[f.status] ?? f.status;
}

function FirstRun({ o }: { o: Overview }) {
  const i = o.institution;
  const steps = [
    { done: !!i, title: "Tell Amiri Agent about your institution", body: "Where you operate, who your customers are, your products, flows, regulators, rivals and risks. Talk to the setup agent, or use the forms.",
      action: <Link className="btn btn--primary" to={i ? "/institution/setup" : "/institution/new"}><Icon name="chat" />{i ? "Continue setup" : "Start setup"}</Link> },
    { done: !!i && i.readiness.ready && i.status === "active", title: "Check it and go live",
      body: i ? (i.readiness.ready ? "Everything required is there. Activate the profile so the agents use it." : `${plural(i.readiness.missing_required, "required item")} still missing.`) : "Once the profile has what's required, activate it.",
      action: <Link className="btn" to="/institution/setup/review">Review</Link> },
    { done: o.counts.monitors_live > 0, title: "Choose what to watch", body: "Draft monitors from your profile: a corridor's jobs, a regulator's rules, a rival's prices. A Risk Manager approves each one.",
      action: <Link className="btn" to="/monitors">Monitors</Link> },
  ];
  return (
    <div className="page">
      <div className="ov-hello"><div><h1>Welcome to Amiri Agent</h1>
        <div className="lede">Three steps, and Amiri Agent starts watching the world for {i ? <b>{i.name}</b> : "your institution"}.</div></div></div>
      <div className="ov-steps">{steps.map((s, n) => (
        <div key={s.title} className={`card ov-step ${s.done ? "done" : ""}`}>
          <span className="n">{s.done ? "✓" : n + 1}</span><h2>{s.title}</h2>
          <p className="small muted" style={{ margin: 0, flex: 1 }}>{s.body}</p><div className="row">{s.action}</div></div>))}</div>
      <div className="card mt16"><div className="bd row wrap" style={{ gap: 16 }}>
        <div className="col" style={{ gap: 4, flex: 1, minWidth: 260 }}><h2 style={{ margin: 0 }}>See it work first</h2>
          <span className="small muted">Run a sharp currency fall on your institution in the Scenario Studio: headlines arrive, prices move, and Amiri Agent's monitors and investigation respond. Nothing touches live data.</span></div>
        <Link className="btn" to="/studio"><Icon name="studio" />Open the Scenario Studio</Link></div></div>
    </div>
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
  const worst = o.events.some(e => e.tone === "bad") ? "bad" : o.events.some(e => e.tone === "mixed") ? "mixed" : o.events.length ? "good" : "neutral";
  const needs = o.attention.length + o.attention_more;
  const topLevel = o.attention[0]?.level;
  const f24 = c.findings_24h.timeseries + c.findings_24h.monitor + c.findings_24h.radar;
  const s = o.services;
  const names = { ...Object.fromEntries(Object.entries(o.map.places).map(([k, v]) => [k, v.name])), ...(profile?.place_names ?? {}) };

  return (
    <div className="page">
      <div className="ov-hello">
        <div style={{ flex: 1, minWidth: 280 }}>
          <span className="label">{longDate(now)} · {ZONE_LABEL}</span>
          <h1>{greeting(now)}</h1>
          <div className="lede">{o.events.length ? <><b>{plural(o.events.length, "open event")}</b> for {i.name}</> : <>Nothing open for {i.name} right now</>}
            {needs ? <> · <b>{plural(needs, "thing")} need{needs === 1 ? "s" : ""} you</b></> : <> · nothing needs you</>}.</div>
        </div>
        <span className="small muted">Updated {loadedAt ? ago(loadedAt.toISOString(), now) : ""}</span>
        <button className="btn btn--ghost btn--icon" type="button" aria-label="Refresh" onClick={load}><Icon name="refresh" /></button>
        <Link className="btn" to="/studio"><Icon name="studio" />Scenario Studio</Link>
      </div>
      {err && <Banner kind="warn" icon="warn">Couldn't refresh: {err}. Showing what was loaded {loadedAt ? ago(loadedAt.toISOString(), now) : ""}.</Banner>}

      <div className="ov-strip pipe" role="group" aria-label="How Amiri Agent works: what it watches, what it found, what it means, who must act">
        <Link to="/monitors" className="card ov-kpi" style={{ ["--kpi" as string]: c.monitors_live || c.series_watched ? "var(--accent)" : "var(--hairline-2)" }}>
          <div className="step">1 · Watching</div>
          <div className="v"><CountUp value={c.monitors_live + c.series_watched + (s.radar.connected ? 1 : 0)} /></div><div className="l">Sources</div>
          <div className="s">{plural(c.monitors_live, "monitor")} · {plural(c.series_watched, "market series", "market series")}{s.radar.connected ? " · Radar" : ""}{c.monitors_waiting_approval ? ` · ${c.monitors_waiting_approval} waiting for approval` : ""}</div></Link>
        <Link to="/events" className="card ov-kpi" style={{ ["--kpi" as string]: f24 ? "var(--info)" : "var(--hairline-2)" }}>
          <div className="step">2 · Found</div>
          <div className="v"><CountUp value={f24} /></div><div className="l">Findings, last 24 h</div>
          <div className="s">{c.findings_24h.timeseries} market series · {c.findings_24h.monitor} monitors{c.findings_24h.radar ? ` · ${c.findings_24h.radar} Radar` : ""}</div></Link>
        <Link to="/events" className="card ov-kpi" style={{ ["--kpi" as string]: KPI_TONE[worst] }}>
          <div className="step">3 · Traced to you</div>
          <div className="v"><CountUp value={c.open_events} /></div><div className="l">Open events</div>
          <div className="s">{c.open_events ? `${o.events.filter(e => e.tone === "bad").length} bad · ${o.events.filter(e => e.tone === "good").length} good for you · ${plural(c.effects_to_watch, "effect")} to watch` : "none open"}</div></Link>
        <Link to="/alerts" className="card ov-kpi" style={{ ["--kpi" as string]: c.alerts_to_review ? "var(--critical)" : "var(--hairline-2)" }}>
          <div className="step">4 · Who must act</div>
          <div className="v"><CountUp value={c.alerts_to_review} /></div><div className="l">Alerts to review</div>
          <div className="s">{c.alerts_to_review ? "early warnings for the owning teams" : "all caught up"}</div></Link>
        <a href="#needs" className="card ov-kpi ov-need-card" style={{ ["--kpi" as string]: topLevel === "crit" ? "var(--critical)" : topLevel === "warn" ? "var(--high)" : topLevel ? "var(--info)" : "var(--accent)" }}>
          <div className="step">Also</div><div className="v"><CountUp value={needs} /></div><div className="l">Need you</div><div className="s">{needs ? "most serious first, below" : "all clear"}</div></a>
      </div>

      <div className="ov-grid">
        <div className="col gap16">
          <div className="card" id="needs"><div className="hd"><h2>Needs you</h2></div>
            {!o.attention.length ? <div className="ov-need" data-lv="info" style={{ ["--lv" as string]: "var(--accent)" }}>
              <span className="ico"><Icon name="check" /></span><div><div className="t">Nothing needs you right now</div>
                <div className="d">Approvals, failed checks, stale prices and gaps in the profile appear here.</div></div></div>
              : o.attention.map((a, n) => {
                const body = <><span className="ico"><Icon name={LEVEL_ICON[a.level]} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}><div className="t">{a.title}</div>{a.detail && <div className="d">{a.detail}</div>}</div>
                  {a.link && <span className="small muted">Open →</span>}</>;
                return a.link ? <Link key={n} to={a.link} className="ov-need" data-lv={a.level}>{body}</Link>
                  : <div key={n} className="ov-need" data-lv={a.level}>{body}</div>;
              })}
            {o.attention_more > 0 && <div className="li small muted">and {o.attention_more} more</div>}
            {o.admin_notes > 0 && <div className="li small muted">{plural(o.admin_notes, "note")} about Amiri Agent's own services {o.admin_notes === 1 ? "is" : "are"} with your Platform Admin.</div>}
          </div>

          <div className="card"><div className="hd"><h2>Open events</h2><span className="spacer" /><Link className="small" to="/events">All events →</Link></div>
            {!o.events.length ? <div className="bd col" style={{ gap: 10 }}>
              <span className="small muted">No open events. When a market series, a monitor or Radar finds something, the investigation traces it to your products and it appears here.</span>
              <div className="row wrap"><Link className="btn btn--sm" to="/studio"><Icon name="studio" />See how Amiri Agent responds: try a what-if</Link></div></div>
              : [...o.events].sort((x, y) => RANK[x.tone] - RANK[y.tone]).map(e => (
                <Link key={e.event_id} to={`/events/${e.event_id}`} className="ov-event">
                  <div className="h"><span className={`badge ${TONE[e.tone][0]}`}>{TONE[e.tone][1]}</span><span className="ttl">{e.title}</span></div>
                  {e.top_effects.length > 0 && <ul className="fx">{e.top_effects.map((x, n) => (
                    <li key={n}><span className="muted">→</span><span><b>{x.product}</b>: {x.label}</span></li>))}</ul>}
                  <div className="m"><span>{e.themes.map(themeText).join(" · ")}</span>
                    {e.places.length > 0 && <span>{e.places.map(p => names[p] ?? p).join(", ")}</span>}
                    <span>{plural(e.effects, "effect")} to watch</span>
                    {e.developments > 0 && <span>{plural(e.developments, "later finding")} joined</span>}
                    <span>last news {ago(e.last_finding_at, now)}</span></div>
                </Link>))}
          </div>
          <div className="card"><div className="hd"><h2>Latest findings</h2></div>
            {!o.findings.length ? <div className="bd small muted">None yet.</div> : <div className="list">{o.findings.map(f => (
              <div key={f.finding_id} className="li"><Icon name={f.source === "monitor" ? "monitor" : f.source === "radar" ? "radar" : "series"} className="ico16" />
                <div className="col" style={{ gap: 2, minWidth: 0 }}><span className="small" style={{ color: "var(--ink)" }}>{f.title}</span>
                  <span className="meta">{dayTime(f.created_at)} · {findingStatus(f)}</span></div></div>))}</div>}
          </div>

        </div>

        <div className="col gap16">
          {profile && <div className="card"><div className="hd"><h2>Where it's happening</h2></div><div className="bd">
            <p className="sr">{o.events.length ? `Open events by place: ${o.events.map(e => `${e.title}${e.places.length ? ` (${e.places.map(p => names[p] ?? p).join(", ")})` : ""}`).join("; ")}.` : "No open events on the map."} Places where you operate: {Object.values(names).slice(0, 12).join(", ")}.</p>
            <ProfileMap profile={profile} height={290} compact layers={["footprint", "flows", "risks"]}
              events={o.events.map(e => ({ event_id: e.event_id, title: e.title, tone: e.tone, places: e.places }))}
              extraPlaces={o.map.places} onEvent={id => nav(`/events/${id}`)} /></div></div>}

          {o.markets.length > 0 && <div className="card"><div className="hd"><h2>Markets</h2><span className="spacer" /><Link className="small" to="/series">Market series →</Link></div>
            {o.markets.map(m => (
              <Link key={m.series_id} to={`/series/${m.series_id}`} className="ov-mkt">
                <span><span className="n">{m.name}</span>{m.state !== "normal" && <span className={`badge ${m.state === "moved" ? "b-warn" : m.state === "stale" ? "b-down" : "b-noeffect"}`} style={{ marginLeft: 8 }}>{m.state.replace(/_/g, " ").toUpperCase()}</span>}</span>
                <span className="p">{price(m.close)}</span>
                <Spark values={m.spark} w={70} h={22} color={m.state === "moved" ? "var(--high)" : "var(--ink-3)"} />
                <span className="c">{m.change_1d_pct == null ? "—" : `${m.change_1d_pct > 0 ? "▲" : m.change_1d_pct < 0 ? "▼" : ""} ${Math.abs(m.change_1d_pct).toFixed(2)}%`}</span>
              </Link>))}</div>}

          <div className="card"><div className="hd"><h2>Latest from Radar</h2><span className="spacer" /><Link className="small" to="/radar">Radar →</Link></div>
            {!o.radar.stories.length ? <div className="bd small muted">{s.radar.connected ? "No stories yet." : "Radar isn't connected yet."}</div>
              : <div className="list">{o.radar.stories.map(r => (
                <Link key={r.story_id} to={r.event_id ? `/events/${r.event_id}` : "/radar"} className="li" style={{ textDecoration: "none", color: "inherit" }}>
                  <Icon name="radar" className="ico16" />
                  <div className="col" style={{ gap: 2, minWidth: 0, flex: 1 }}><span className="small" style={{ color: "var(--ink)", fontWeight: 600 }}>{r.title}</span>
                    <span className="meta">{ago(r.last_seen_at, now)} · {r.publishers} publisher{r.publishers === 1 ? "" : "s"} · {r.status === "sent" ? (r.event_id ? "in an event" : "sent for investigation") : r.status === "below" ? "held back" : "dismissed"}</span></div>
                  <b className="small" style={{ fontVariantNumeric: "tabular-nums" }}>{r.score}</b></Link>))}</div>}
          </div>

          <div className="card"><div className="hd"><h2>Is Amiri Agent working?</h2></div>
            <div className="ov-sys">
              <span><span className={`statusdot ${s.tick.ok ? "sd-ok" : "sd-down"}`} aria-hidden="true" />refresh: {s.tick.last_at ? <>{s.tick.ok ? "last ran" : "overdue, last ran"} {ago(s.tick.last_at, now)}</> : "hasn't run yet"}</span>
              {([["investigation agent", s.investigation.connected], ["monitor agent", s.monitor.connected], ["setup agent", s.assistant.connected], ["Radar", s.radar.connected]] as const).map(([n, up]) => (
                <span key={n}><span className={`statusdot ${up ? "sd-ok" : "sd-off"}`} aria-hidden="true" />{n}: {up ? "connected" : "not connected"}</span>))}
              {o.studio && <span><span className="statusdot sd-warn" /><Link to={`/studio/run/${o.studio.sim_id}`}>Studio: {o.studio.title}, day {o.studio.step} of {o.studio.steps}</Link></span>}
            </div></div>
        </div>
      </div>
    </div>
  );
}
