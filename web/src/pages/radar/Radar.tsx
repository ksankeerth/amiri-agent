// Radar: what it watches, how its runs went, and the stories it found:
// why each matters to the institution, where it went (an event, or held back), and the actions.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { inst, type Profile } from "../../api/institutions";
import { gb, radarApi, scheduleText, type RadarStatus, type RadarStory } from "../../api/radar";
import { ChipFilter } from "../../components/FlowFilter";
import { Icon } from "../../components/Icon";
import { HowItWorks, PageHeader, StatusPill } from "../../components/blocks";
import { Banner, Empty, useNow, useRole, useToast, ListSkeleton, LoadError } from "../../components/ui";
import { ago, dayTime, person, placeName, placeOrder, when } from "../../format";
import type { Tone } from "../../plain";
import { themeText } from "../events/Events";
import "../../styles/showcase.css";
import "../../styles/polish-forms.css";

type Show = "all" | "sent" | "below" | "dismissed";
const SHOW: [Show, string][] = [["all", "All"], ["sent", "Sent for investigation"], ["below", "Held back"], ["dismissed", "Dismissed"]];
const REL: Record<RadarStory["relevance"], [string, Tone]> = { high: ["Highly relevant", "blue"], medium: ["Relevant", "grey"], low: ["Slightly relevant", "grey"] };

/** The last run in words: what it read, what it kept, what it sent to you (numbers, not bar heights). */
function Funnel({ s }: { s: RadarStatus }) {
  const r = s.last_run;
  if (!r) return <span className="rd-v">no run yet</span>;
  return <span className="rd-v rd-funnel-t" title={`${r.considered ?? 0} read, ${r.shortlisted ?? 0} grouped into stories, ${r.stories ?? 0} kept, ${r.sent ?? 0} sent`}>
    <span><b>{r.considered ?? 0}</b> read</span><span aria-hidden="true">→</span><span><b>{r.stories ?? 0}</b> kept</span><span aria-hidden="true">→</span>
    <span className="sent"><b>{r.sent ?? 0}</b> sent to you</span></span>;
}

function StoryCard({ s, names, onChange }: { s: RadarStory; names: Record<string, string | null>; onChange: (s: RadarStory) => void }) {
  const toast = useToast();
  const { role } = useRole();
  const now = useNow(60_000);
  const [open, setOpen] = useState(false);
  const act = async (f: () => Promise<RadarStory>, msg: string) => {
    try { onChange(await f()); toast(msg); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const heads = open ? s.headlines : s.headlines.slice(0, 2);
  return (
    <div className={`card rd-story ${s.status}`}>
      <div className="row wrap" style={{ gap: 6 }}>
        <span className="small muted">{ago(s.last_seen_at, now)}{s.runs_seen > 1 ? ` · seen in ${s.runs_seen} runs` : ""}</span>
        <span className="chip">{s.publishers} publisher{s.publishers === 1 ? "" : "s"}</span>
        {placeOrder(s.places).map(p => <span key={p} className="chip">{names[p] ?? placeName(p)}</span>)}
        {s.themes.map((t, i) => <span key={i} className="chip">{themeText(t)}</span>)}
        <span className="spacer" />
        <StatusPill tone={REL[s.relevance][1]}>{REL[s.relevance][0]}</StatusPill>
        {role === "platform_admin" && <span className="rd-score" title="Radar's score: footprint match × corroboration × freshness × relevance">
          <span className={`meter ${s.score >= 60 ? "" : "warn"}`}><span style={{ width: `${s.score}%` }} /></span><b>{s.score}</b></span>}
      </div>
      <h2>{s.title}</h2>
      <p className="sum">{s.summary}</p>
      <div className="rd-why"><Icon name="info" className="ico16" /><span><b>{s.status === "sent" ? "Why it matters to you" : "Why it was held back"}:</b> {s.why}</span></div>
      <ul className="rd-heads">{heads.map((h, i) => (
        <li key={i}><span className="muted">—</span>{h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : <span>{h.title}</span>}
          <span className="o">{h.outlet ?? ""} · {dayTime(h.published_at)}</span></li>))}
        {s.headlines.length > 2 && <li><button className="btn btn--sm btn--ghost" type="button" onClick={() => setOpen(o => !o)}>
          {open ? "Fewer" : `${s.headlines.length - 2} more headline${s.headlines.length - 2 === 1 ? "" : "s"}`}</button></li>}
      </ul>
      <div className="row wrap" style={{ gap: 8 }}>
        {s.status === "sent" ? (s.event_id
          ? <><StatusPill tone="green">In an event</StatusPill><Link className="small" to={`/events/${s.event_id}`}>{s.event_title ?? "Open the event"}</Link></>
          : <><StatusPill tone="blue">{s.finding_status === "grouped" ? "Being investigated" : "Sent"}</StatusPill><span className="small muted">waiting to be investigated</span></>)
          : s.status === "dismissed" ? <><StatusPill tone="grey">Dismissed</StatusPill><span className="small muted">by {person(s.dismissed_by)} {s.dismissed_at ? ago(s.dismissed_at, now) : ""}</span></>
          : <><StatusPill tone="grey">Not sent</StatusPill><span className="small muted">Radar judged it not important enough for you</span></>}
        {s.status === "sent" && s.sent_by && s.sent_by !== "agent" && <span className="small muted">sent by {person(s.sent_by)}</span>}
        {s.development_of && <span className="small muted">continues an earlier story</span>}
        <span className="spacer" />
        {s.monitor_hint && <span className="small muted">Your monitor <Link to={`/monitors/${s.monitor_hint.monitor_id}`}>{s.monitor_hint.name}</Link> covers these places.</span>}
        {s.status === "below" && <button className="btn btn--sm" type="button" onClick={() => act(() => radarApi.investigate(s.story_id), "Sent for investigation")}>Investigate anyway</button>}
        {s.status === "below" && <button className="btn btn--sm btn--ghost" type="button" onClick={() => act(() => radarApi.dismiss(s.story_id), "Dismissed")}>Dismiss</button>}
        {s.status === "dismissed" && <button className="btn btn--sm btn--ghost" type="button" onClick={() => act(() => radarApi.restore(s.story_id), "Restored")}>Restore</button>}
      </div>
    </div>
  );
}

export function RadarPage() {
  const toast = useToast();
  const now = useNow(30_000);
  const { role } = useRole();
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [items, setItems] = useState<RadarStory[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scope, setScope] = useState<{ places: string[]; why: Record<string, string[]>; themes: string[]; actors: string[] } | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [place, setPlace] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);  // the watched place whose reason is open
  const [places, setPlaces] = useState(false);  // the watched places, folded to one line until asked

  const load = useCallback(async () => {
    try {
      const [st, ss] = await Promise.all([radarApi.status(), radarApi.stories({ status: show === "all" ? undefined : show, place: place || undefined })]);
      setStatus(st); setItems(ss); setErr(null);
    } catch (e) { setErr(e); }
  }, [show, place]);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    api_installation().then(iid => {
      if (!iid) return;
      inst.profile(iid).then(setProfile).catch(() => {});
      inst.context(iid).then(c => setScope(c.radar_scope)).catch(() => {});
    });
  }, []);
  // a run started here is asked for until it finishes
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => {
      try { const r = await radarApi.getRun(running); if (r.status !== "running") { setRunning(null); load(); toast(r.status === "failed" ? `Radar's run failed: ${r.error}` : `Radar found ${r.stories ?? 0} stories, sent ${r.sent ?? 0}`); } }
      catch { /* next poll */ }
    }, 4000);
    return () => clearInterval(t);
  }, [running, load, toast]);

  const names = useMemo(() => profile?.place_names ?? {}, [profile]);
  const placesSeen = useMemo(() => [...new Set((items ?? []).flatMap(s => s.places))], [items]);
  const runNow = async () => {
    try { const r = await radarApi.run(); if (r.status === "running") setRunning(r.run_id); else { load(); toast(`Radar found ${r.stories ?? 0} stories, sent ${r.sent ?? 0}`); } }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const lr = status?.last_run;
  const admin = role === "platform_admin";
  const left = status?.run_now.left ?? 0;
  const cantRun = !status?.connected ? "Radar isn't connected yet" : status.budget_spent ? "Today's reading budget is spent"
    : running || status.running ? "A run is in progress" : left === 0 ? "Limit reached; resets at midnight" : null;
  const sched = status ? scheduleText(status.every_minutes, status.run_at) : "";
  const nextRun = status ? (new Date(status.next_run_at) <= now ? "due now" : when(status.next_run_at, now)) : "";
  return (
    <div className="page">
      <PageHeader title="Radar"
        status={!status ? "" : !status.connected ? "Not running yet" : <>Reads world news {sched}{lr ? `, last ${ago(lr.finished_at ?? lr.created_at, now)}` : ""}</>}
        help={<HowItWorks><p>Radar reads the world's news for anything that touches {profile?.institution.name ?? "your institution"}, using the places and names in your profile. What matters goes to the investigation like any other finding; the rest is kept here, and you can still send it.</p>
          {status && <p>Prototype limits: Radar reads the news {sched}, and you can Check now {status.run_now.limit} times a day. English news only.</p>}</HowItWorks>}
        actions={<>
          <Link className="btn" to="/institution/agents">What Radar reads from your profile</Link>
          <button className="btn btn--primary" type="button" disabled={!!cantRun} title={cantRun ?? undefined} onClick={runNow}>
            <Icon name={running ? "refresh" : "radar"} />{running ? "Checking…" : status?.connected ? `Check now · ${left} left today` : "Check now"}</button></>} />
      <div className="banners">
        {err != null && <LoadError error={err} onRetry={load} what="Radar" />}
        {status && left === 0 && status.connected && <Banner kind="info" icon="info">You've used today's {status.run_now.limit} checks; the next run is {nextRun}.</Banner>}
        {admin ? status?.notes.map(n => <Banner key={n} kind="warn" icon="warn">{n}</Banner>)
          : status && !status.connected && <Banner kind="warn" icon="warn"><b>Radar isn't running yet.</b> It reads the news for you once your Platform Admin connects it. Monitors and market series still work.</Banner>}
        {lr?.status === "failed" && <Banner kind="crit" icon="warn"><b>The last run failed</b> {ago(lr.finished_at ?? lr.created_at, now)}.{admin ? ` ${lr.error ?? ""}` : " Radar will try again at the next run."}</Banner>}
      </div>
      {status && <div className="card rd-status">
        {status.connected && <div className="rd-facts">
          <div className={`rd-fact ${lr?.status === "failed" ? "bad" : ""}`}><span className="rd-k">Last run</span>
            <span className="rd-v">{lr ? ago(lr.finished_at ?? lr.created_at, now) : "never"}</span>
            <span className="rd-s">{lr ? `${lr.trigger === "now" ? "on request" : "on schedule"}, ${lr.status === "completed" ? "finished" : lr.status.replace("_", " ")}` : "no run yet"}</span></div>
          <div className="rd-fact"><span className="rd-k">Next run</span><span className="rd-v">{status.connected ? nextRun : "—"}</span>
            <span className="rd-s">{sched}{status.running ? " · running now" : ""}</span></div>
          <div className="rd-fact wide"><span className="rd-k">What that run found</span><Funnel s={status} /></div>
          <div className={`rd-fact ${status.budget_spent ? "bad" : ""}`}><span className="rd-k">{admin ? "BigQuery today" : "Reading budget"}</span>
            <span className="rd-v">{admin ? <>{gb(status.bytes_today)} <span className="rd-s">of {gb(status.bytes_cap)}</span></> : <>{Math.round((status.bytes_today / Math.max(1, status.bytes_cap)) * 100)}% <span className="rd-s">used today</span></>}</span>
            <span className="rd-s">{admin ? `at most ${status.limits.max_queries} queries a run, ${gb(status.limits.max_bytes_per_query)} each` : "resets at midnight UTC"}</span></div>
        </div>}
        {/* not connected: the same two facts on one quiet line, so "when does it run?" is never hidden */}
        {!status.connected && <div className="rd-line">
          <span><span className="rd-k">Last run</span><b>{lr ? ago(lr.finished_at ?? lr.created_at, now) : "never"}</b></span>
          <span><span className="rd-k">Next run</span><b>{sched.replace(/^once a day/, "daily")}</b><span className="muted">once Radar is connected</span></span>
        </div>}
        {scope && <div className="rd-watch">
          <span><b>Watching {scope.places.length} {scope.places.length === 1 ? "place" : "places"}</b>{!places && scope.places.length > 0 && <span className="muted">: {scope.places.slice(0, 3).map(p => names[p] ?? p).join(", ")}{scope.places.length > 3 ? " and more" : ""}</span>}
            {scope.actors.length > 0 && <span className="muted"> · also {scope.actors.length} {scope.actors.length === 1 ? "name" : "names"}</span>}</span>
          <button type="button" className="btn btn--sm btn--ghost" aria-expanded={places} onClick={() => setPlaces(o => !o)}>
            <Icon name="chevron" className={`ico16 ${places ? "rot" : ""}`} />{places ? "Hide places" : `Show ${scope.places.length} places`}</button>
        </div>}
        {scope && places && <div className="rd-places col" style={{ gap: 8 }}>
          <div className="row wrap" style={{ gap: 8 }}>{scope.places.map(p => (
            <button key={p} type="button" className={`chip click ${why === p ? "sel" : ""}`} aria-expanded={why === p} onClick={() => setWhy(why === p ? null : p)}>{names[p] ?? p}</button>))}</div>
          {why && <div className="note" role="status"><b>{names[why] ?? why}</b>: {(scope.why[why] ?? []).join("; ") || "part of where you operate"}</div>}
          {scope.actors.length > 0 && <span className="small">Also looks for: {scope.actors.join(", ")}</span>}
          <span className="small muted">Select a place to see why it's watched.</span>
        </div>}
      </div>}

      <div className="row wrap mt16" style={{ gap: 10 }}>
        <ChipFilter label="Which stories" value={show} onChange={setShow} options={SHOW.map(([key, label]) => ({ key, label }))} />
        {placesSeen.length > 1 && <select className="input" aria-label="Filter by place" style={{ width: 200 }} value={place} onChange={e => setPlace(e.target.value)}>
          <option value="">All places</option>{placesSeen.map(p => <option key={p} value={p}>{names[p] ?? p}</option>)}</select>}
      </div>
      <div className="col gap16 mt12">
        {items === null ? (err == null && <ListSkeleton rows={3} />)
          : !items.length ? <div className="card"><Empty icon="radar" title={show === "all" ? "No stories yet" : "Nothing here"}
            actions={show === "all" && !status?.connected ? <Link className="btn" to="/institution/agents">See what Radar will read</Link> : undefined}>
            {show === "all" ? (status?.connected ? "Radar hasn't found anything touching your footprint yet. Check now runs it at once." : admin ? "Connect the Radar agent (RADAR_URL) and it starts reading the news." : "Radar starts reading the news once your Platform Admin connects it.") : "No stories in this group."}</Empty></div>
          : items.map(s => <StoryCard key={s.story_id} s={s} names={names} onChange={x => setItems(xs => xs?.map(y => (y.story_id === x.story_id ? x : y)) ?? null)} />)}
      </div>
    </div>
  );
}

async function api_installation(): Promise<string | null> {
  try { const i = await api<{ institution_id: string; profile: boolean }>("/api/v1/installation"); return i.profile ? i.institution_id : null; }
  catch { return null; }
}
