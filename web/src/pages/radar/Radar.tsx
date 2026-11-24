// Radar: what it read this morning (the funnel), where each story it sent went, what it held back, and, folded,
// the earlier runs, every story with filters, what it watches and its reading budget.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../../api/client";
import { inst, type Profile } from "../../api/institutions";
import { alertsApi } from "../../api/alerts";
import { investigationApi } from "../../api/investigation";
import { eventTitle } from "../../plain";
import { gb, radarApi, scheduleText, type RadarRun, type RadarStatus, type RadarStory } from "../../api/radar";
import { Icon } from "../../components/Icon";
import { Figures, Fold, GoLink, PageTitle, QuietWarn, Section, TextButton, TextTabs } from "../../components/rd";
import { LoadError, useNow, useRole, useToast } from "../../components/ui";
import { ago, day, plural } from "../../format";
import { Link } from "react-router-dom";
import { CompactRow, SentRow, seenAgain, type Where } from "./RadarStories";
import { budgetResets, clock, nextAt, plainCount, zoneName } from "./words";
import "../../styles/rd-radar.css";

type Show = "all" | "sent" | "below" | "dismissed";
const SHOW: [Show, string][] = [["all", "All"], ["sent", "Sent for investigation"], ["below", "Held back"], ["dismissed", "Dismissed"]];
const SHORTLIST = 30;  // Radar's judge is handed this many at most; it isn't in the API, so it's named only when the run hit it

export function RadarPage() {
  const toast = useToast();
  const now = useNow(30_000);
  const { role } = useRole();
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [items, setItems] = useState<RadarStory[] | null>(null);
  const [runs, setRuns] = useState<RadarRun[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scope, setScope] = useState<{ places: string[]; why: Record<string, string[]>; themes: string[]; actors: string[] } | null>(null);
  const [show, setShow] = useState<Show>("all");
  const [place, setPlace] = useState("");
  const [err, setErr] = useState<unknown>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [how, setHow] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string | null>>({});  // why each set-aside finding was set aside
  const [linkedRun, setLinkedRun] = useState<Record<string, string | null>>({});  // a linked finding's investigation run (none: joined by rule)
  const [alerts, setAlerts] = useState<Record<string, number | null>>({});  // teams alerted, per event
  const [titles, setTitles] = useState<Record<string, string>>({});  // each event's display title

  const load = useCallback(async () => {
    try {
      const [st, ss] = await Promise.all([radarApi.status(), radarApi.stories()]);
      setStatus(st); setItems(ss); setErr(null);
      radarApi.runs().then(setRuns).catch(() => {});
      if (ss.some(x => x.event_id)) investigationApi.events().then(es => setTitles(Object.fromEntries(es.map(e => [e.event_id, eventTitle(e)])))).catch(() => {});
      const start = st.last_run?.created_at;
      const mine = ss.filter(x => x.status === "sent" && start && x.last_seen_at >= start);
      if (ss.some(x => x.finding_status === "set_aside"))  // a failed run and "no impact" share a status: the finding's reason tells them apart
        investigationApi.findings("?world=live&status=set_aside&limit=200")
          .then(fs => setReasons(Object.fromEntries(fs.map(f => [f.finding_id, f.outcome?.reason ?? null])))).catch(() => {});
      if (ss.some(x => x.finding_status === "linked"))  // an investigation run, or a rule: the finding's run tells them apart
        investigationApi.findings("?world=live&status=linked&limit=200")
          .then(fs => setLinkedRun(Object.fromEntries(fs.map(f => [f.finding_id, f.run_id])))).catch(() => {});
      for (const id of new Set(mine.map(x => x.event_id).filter((x): x is string => !!x)))
        alertsApi.list({ event_id: id }).then(a => setAlerts(o => ({ ...o, [id]: new Set(a.map(x => x.owner)).size })))
          .catch(() => setAlerts(o => ({ ...o, [id]: null })));
    } catch (e) { setErr(e); }
  }, []);
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
  const admin = role === "platform_admin";
  const w: Where = useMemo(() => ({ names, admin, reasons, linkedRun, alerts, titles }), [names, admin, reasons, linkedRun, alerts, titles]);
  const onChange = (x: RadarStory) => setItems(xs => xs?.map(y => (y.story_id === x.story_id ? x : y)) ?? null);

  const runNow = async () => {
    try { const r = await radarApi.run(); if (r.status === "running") setRunning(r.run_id); else { load(); toast(`Radar found ${r.stories ?? 0} stories, sent ${r.sent ?? 0}`); } }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const lr = status?.last_run;
  const left = status?.run_now.left ?? 0;
  const cantRun = !status?.connected ? "Radar isn't connected yet" : status.budget_spent ? "Today's reading budget is spent"
    : running || status.running ? "A run is in progress" : left === 0 ? "Limit reached; resets at midnight" : null;
  const sched = status ? scheduleText(status.every_minutes, status.run_at) : "";
  const zone = zoneName(status?.time_zone);
  const next = status ? nextAt(status.next_run_at, now) : "";

  // this run's stories: those it saw since the last run began. Sent ones first (new before "seen again"), then held back.
  const runStart = lr?.created_at;
  const thisRun = useMemo(() => (items ?? []).filter(s => !!runStart && s.last_seen_at >= runStart), [items, runStart]);
  const sentNow = useMemo(() => thisRun.filter(s => s.status === "sent").sort((a, b) => Number(seenAgain(a, runStart)) - Number(seenAgain(b, runStart))), [thisRun, runStart]);
  const held = useMemo(() => thisRun.filter(s => s.status === "below"), [thisRun]);
  const again = sentNow.filter(s => seenAgain(s, runStart)).length;
  const placesSeen = useMemo(() => [...new Set((items ?? []).flatMap(s => s.places))], [items]);
  const listed = useMemo(() => (items ?? []).filter(s => (show === "all" || s.status === show) && (!place || s.places.includes(place))), [items, show, place]);
  const others = useMemo(() => (runs ?? []).filter(r => r.run_id !== lr?.run_id), [runs, lr]);

  const lede = !status ? "" : !status.connected ? "Radar isn't running yet."
    : status.run_at ? `Reads the world's news every day at ${status.run_at} ${zone} time.` : `Reads the world's news ${sched}. Times are ${zone} time.`;
  const funnel = lr && lr.considered != null && lr.status !== "failed";
  const kept = lr?.stories ?? 0;
  const caps = status?.limits.max_stories ?? 10;

  return (
    <div className="page rd rd-radar">
      <PageTitle title="Radar"
        lede={lede ? <>{lede} <TextButton onClick={() => setHow(h => !h)} aria-expanded={how} aria-controls="rs-how">How this works</TextButton></> : undefined}
        actions={<>
          <GoLink to="/institution/agents">What Radar reads from your profile</GoLink>
          <button className="btn btn--primary" type="button" disabled={!!cantRun} title={cantRun ?? undefined} onClick={runNow}>
            <Icon name={running ? "refresh" : "radar"} />{running ? "Checking…" : status?.connected ? `Check now · ${left} left today` : "Check now"}</button></>}
        help={how ? <div id="rs-how" className="rd-prose rs-how">
          <p>Radar reads the world's news for anything that touches {profile?.institution.name ?? "your institution"}, using the places and names in your profile. What matters goes to the investigation like any other finding; the rest is kept here, and you can still send it.</p>
          {status && <p>Prototype limits: Radar reads the news {sched}, and you can Check now {status.run_now.limit} times a day. English news only.</p>}</div> : undefined} />

      {/* the states that matter on the day: one quiet line each, only when they apply */}
      <div className="rs-warns">
        {err != null && <LoadError error={err} onRetry={load} what="Radar" />}
        {status && left === 0 && status.connected && <QuietWarn>You've used today's {status.run_now.limit} checks; the next run is {next}.</QuietWarn>}
        {status?.budget_spent && <QuietWarn>Today's reading budget is spent; Radar reads again after it resets at {budgetResets(now)}.</QuietWarn>}
        {admin ? status?.notes.map(n => <QuietWarn key={n}>{n}</QuietWarn>)
          : status && !status.connected && <QuietWarn><b>Radar isn't running yet.</b> It reads the news for you once your Platform Admin connects it. Monitors and market series still work.</QuietWarn>}
        {lr?.status === "failed" && <QuietWarn><b>The last run failed</b> {ago(lr.finished_at ?? lr.created_at, now)}.{admin ? ` ${lr.error ?? ""}` : " Radar will try again at the next run."}</QuietWarn>}
      </div>

      {status === null ? (err == null && <p className="rd-fine" role="status" style={{ marginTop: 28 }}>Loading Radar…</p>) : <>
        {status.connected && (funnel && lr ? <>
          <Figures flow label="What the latest run did" items={[
            { value: plainCount(lr.considered), label: "articles read", sub: "from world news" },
            { value: plainCount(lr.shortlisted), label: "shortlisted", sub: lr.shortlisted === SHORTLIST ? "the most it shortlists" : "closest to your places" },
            { value: plainCount(kept), label: "kept", sub: kept >= caps ? "the most it keeps" : "judged relevant" },
            { value: plainCount(lr.sent), label: "sent to you", sub: "the ones its judge picked", go: true }]} />
          <p className="rd-fine rs-small">Run of {day(lr.created_at)}, {clock(lr.created_at)}{lr.finished_at ? ` to ${clock(lr.finished_at)}` : ""}
            {" · "}{lr.status === "running" ? "running now" : lr.trigger === "now" ? "started by Check now" : "on schedule"}{" · "}next run {next}</p>
        </> : <p className="rd-fine rs-small">{lr ? `Run of ${day(lr.created_at)}, ${clock(lr.created_at)}` : "No run yet"}{" · "}next run {next}</p>)}
        {!status.connected && <p className="rd-fine rs-small">Last run {lr ? ago(lr.finished_at ?? lr.created_at, now) : "never"} · next run {sched.replace(/^once a day/, "daily")} once Radar is connected</p>}

        <Section title="Sent to you" meta={items === null ? undefined : sentNow.length === 0 ? undefined
          : <>{plural(sentNow.length - again, "story", "stories")} this run{again > 0 ? ` · ${again} sent earlier, seen again` : ""}</>}>
          {items === null ? (err == null && <p className="rd-fine" role="status">Loading stories…</p>)
            : !items.length ? <p className="rd-row-d">{status.connected ? "Radar hasn't found anything touching your footprint yet. Check now runs it at once."
              : admin ? "Connect the Radar agent (RADAR_URL) and it starts reading the news." : "Radar starts reading the news once your Platform Admin connects it."}
              {!status.connected && <> <GoLink to="/institution/agents">See what Radar will read</GoLink></>}</p>
            : sentNow.length === 0 ? <p className="rd-row-d">Nothing was sent to you in the latest run.</p>
            : <ul className="rs-list">{sentNow.map(s => <SentRow key={s.story_id} s={s} w={w} runStart={runStart} />)}</ul>}
        </Section>

        {held.length > 0 && <Section title="Held back" meta={`${held.length} this run`}>
          <p className="rd-fine rd-prose" style={{ margin: "0 0 4px" }}>Radar sends only the few its judge picks, best first.</p>
          <ul className="rs-list">{held.map(s => <CompactRow key={s.story_id} s={s} w={w} onChange={onChange} />)}</ul>
        </Section>}

        <Section title="More">
          {status.connected && <Fold remember="radar-runs" title="Earlier runs"
            summary={runs === null ? "…" : others.length === 0 ? "No earlier runs yet"
              : `${others.length} more, each read ${plainCount(Math.min(...others.map(r => r.considered ?? 0)))} to ${plainCount(Math.max(...others.map(r => r.considered ?? 0)))} articles and sent ${Math.min(...others.map(r => r.sent ?? 0))} to ${Math.max(...others.map(r => r.sent ?? 0))}`}>
            {others.length > 0 && <table className="rd-table">
              <thead><tr><th>Run</th><th className="rd-num">Read</th><th className="rd-num">Shortlisted</th><th className="rd-num">Kept</th><th className="rd-num">Sent to you</th></tr></thead>
              <tbody>{others.map(r => <tr key={r.run_id}>
                <td className="rd-strong">{day(r.created_at)}, {clock(r.created_at)}{r.status === "failed" ? " · failed" : r.status === "stopped_early" ? " · stopped early" : r.trigger === "now" ? " · Check now" : ""}</td>
                <td className="rd-num">{r.considered == null ? "—" : plainCount(r.considered)}</td><td className="rd-num">{r.shortlisted == null ? "—" : plainCount(r.shortlisted)}</td>
                <td className="rd-num">{r.stories ?? "—"}</td><td className="rd-num">{r.sent ?? "—"}</td></tr>)}</tbody></table>}
          </Fold>}

          <Fold remember="radar-all" title="All stories, with filters"
            summary={items === null ? "…" : `${items.length} stories from the latest runs, newest first`}>
            <TextTabs label="Which stories" value={show} onChange={setShow} items={SHOW.map(([key, label]) => ({ key, label }))}
              end={placesSeen.length > 1 ? <select className="input rs-place" aria-label="Filter by place" value={place} onChange={e => setPlace(e.target.value)}>
                <option value="">All places</option>{placesSeen.map(p => <option key={p} value={p}>{names[p] ?? p}</option>)}</select> : undefined} />
            {!listed.length ? <p className="rd-row-d">{show === "all" && !place ? "No stories yet." : "Nothing here. No stories in this group."}</p>
              : <ul className="rs-list">{listed.map(s => <CompactRow key={s.story_id} s={s} w={w} onChange={onChange} listing />)}</ul>}
          </Fold>

          {scope && <Fold remember="radar-watch" title="What Radar watches"
            summary={<>{scope.places.length} {scope.places.length === 1 ? "place" : "places"}{scope.places.length > 0 && <>, starting with {scope.places.slice(0, 3).map(p => names[p] ?? p).join(", ")}</>}
              {scope.actors.length > 0 && ` · also ${scope.actors.length} ${scope.actors.length === 1 ? "name" : "names"}`}</>}>
            <table className="rd-table"><thead><tr><th>Place</th><th>Why Radar watches it</th></tr></thead>
              <tbody>{scope.places.map(p => <tr key={p}><td className="rd-strong">{names[p] ?? p}</td><td>{(scope.why[p] ?? []).join("; ") || "part of where you operate"}</td></tr>)}</tbody></table>
            {scope.actors.length > 0 && <p className="rd-fine rd-prose" style={{ marginTop: 12 }}>Also looks for: {scope.actors.join(", ")}</p>}
            <p className="rd-fine" style={{ marginTop: 8 }}><Link className="rd-go" to="/institution/agents">What Radar reads from your profile →</Link></p>
          </Fold>}

          {status.connected && <Fold remember="radar-budget" title="Reading budget"
            summary={admin ? `${gb(status.bytes_today)} of ${gb(status.bytes_cap)} used today`
              : `${Math.round((status.bytes_today / Math.max(1, status.bytes_cap)) * 100)}% used today · resets at ${budgetResets(now)}`}>
            <p className="rd-prose" style={{ margin: 0 }}>{admin
              ? <>Radar's BigQuery use today: {gb(status.bytes_today)} of {gb(status.bytes_cap)}. It runs at most {status.limits.max_queries} {status.limits.max_queries === 1 ? "query" : "queries"} a run, {gb(status.limits.max_bytes_per_query)} each.</>
              : <>Radar has used {Math.round((status.bytes_today / Math.max(1, status.bytes_cap)) * 100)}% of its reading budget today.</>}
              {" "}It starts again at {budgetResets(now)} ({zone} time).</p>
          </Fold>}
        </Section>
      </>}
    </div>
  );
}

async function api_installation(): Promise<string | null> {
  try { const i = await api<{ institution_id: string; profile: boolean }>("/api/v1/installation"); return i.profile ? i.institution_id : null; }
  catch { return null; }
}
