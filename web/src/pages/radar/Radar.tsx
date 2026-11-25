// Radar (board 05; states: board 16 section F, board 13 sections 3 and 6): what Radar read in the news, the stories it sent to
// the investigation, the ones it held back, and the ones dismissed, as a list and a reading pane. Tabs All / Sent / Held back /
// Dismissed and a place filter; the tab, place and open story live in the address (?tab=&place=&story=). On a phone the list is
// the page and a story opens as its own view with a back link.
//
// Asking, and how often (the server reads an agent each time it is asked about a running run, so nothing is asked about
// unless this viewer pressed a button; UI_POLLING_NOTE.md):
//   passive: status and stories every 60 s, and not while the tab is hidden.
//   Check now: the run every 3 s while it is `running`, up to 2 min; then each sent story's finding every 3 s until it lands.
//   Investigate anyway: that story's finding every 3 s until it lands, up to 2 min.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useInstallation } from "../../App";
import { ApiError } from "../../api/client";
import { inst, type Profile } from "../../api/institutions";
import { investigationApi } from "../../api/investigation";
import { radarApi, scheduleText, type RadarRun, type RadarStatus, type RadarStory } from "../../api/radar";
import { Icon } from "../../components/Icon";
import { useNow, useRefusalToast, useRole, useToast } from "../../components/ui";
import { AgentState } from "../../components/v2/AgentState";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs, usePhone } from "../../components/v2/Shell";
import { useDemoLock } from "../../components/lock";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { TabPanel, Tabs } from "../../components/v2/Tabs";
import { ago, plural, placeName as codeName } from "../../format";
import { eventTitle } from "../../plain";
import { landed } from "../findings/words";
import { pollRun, POLL_EVERY_MS, POLL_FOR_MS } from "../events/poll";
import {
  Budget, EarlierReads, Funnel, HowItWorks, Investigating, RadarSkeleton, ReadingNow, Story, StoryList, Watches, type Scope,
} from "./parts";
import {
  cantCheck, emptyCopy, funnelOf, funnelRun, investigatedText, ledeText, leftToday, listFor, moreWord, neighbour, parseTab, pickStory, placesOf,
  refusalTitle, runDoneText, shownRows, TABS, tabCounts, toWatch, type Where,
} from "./storyWords";
import { budgetResetsAt, dayWord, nextWord, zoneName } from "./words";
import "../../styles/v2/radar.css";

const REFRESH_MS = 60_000;      // passive: no faster than every 30 s
const CRUMBS = [{ label: "What it watches" }, { label: "Radar" }];
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export function RadarPage() {
  useCrumbs(CRUMBS);
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const phone = usePhone();
  const now = useNow(30_000);
  const toast = useToast(), refuse = useRefusalToast();
  const { role } = useRole();
  const admin = role === "platform_admin";
  const installation = useInstallation();
  const iid = installation?.profile ? installation.institution_id : null;
  const placeId = useId();

  const tab = parseTab(sp.get("tab")), place = sp.get("place") ?? "", storyId = sp.get("story");
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [items, setItems] = useState<RadarStory[] | null>(null);
  const [runs, setRuns] = useState<RadarRun[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [reasons, setReasons] = useState<Record<string, string | null>>({});   // why each set-aside finding was set aside
  const [titles, setTitles] = useState<Record<string, string>>({});            // each event's name as the other pages show it
  const locked = useDemoLock();  // Check now spends the day's budget: locked for a demo
  const [starting, setStarting] = useState(false);                             // Check now was pressed, the server hasn't answered
  const [runWait, setRunWait] = useState<{ id: string; since: string } | null>(null);  // this viewer's read, asked about every 3 s
  const [watching, setWatching] = useState<ReadonlySet<string>>(new Set());     // findings asked about every 3 s
  const [busyId, setBusyId] = useState<string | null>(null);                    // the story an action is on
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});       // lists opened past "N more"

  const alive = useRef(true);
  const seq = useRef(0);
  const known = useRef({ run: "", events: "", aside: "" });                    // what the side lists were last loaded for
  const inflight = useRef(new Set<string>());
  const pushed = useRef(0);                                                    // stories opened with a new history entry (phone), so Back can undo them
  const focusNext = useRef<"story" | "list" | null>(null);
  const lastOpened = useRef<string | null>(null);
  const movedOut = useRef<string | null>(null);                                 // a story this viewer just moved to another tab: don't follow it
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /** Change the address. Filters and selections replace the entry; opening a story on a phone adds one (the phone's Back). */
  const setParams = useCallback((patch: Record<string, string | null>, push = false) => {
    setSp(prev => {
      const n = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
      return n;
    }, { replace: !push });
  }, [setSp]);

  // ---------------------------------------------------------------- loading
  const load = useCallback(async (): Promise<RadarStory[] | null> => {
    const mine = ++seq.current;
    try {
      const [st, ss] = await Promise.all([radarApi.status(), radarApi.stories()]);
      if (!alive.current) return null;
      if (mine === seq.current) { setStatus(st); setItems(ss); setErr(null); setLoadedAt(Date.now()); }
      // the side lists change rarely: ask again only when what they are about has changed
      const run = st.last_run ? `${st.last_run.run_id}:${st.last_run.status}` : "";
      if (run !== known.current.run || known.current.run === "") { known.current.run = run || "none"; radarApi.runs().then(r => alive.current && setRuns(r)).catch(() => {}); }
      const events = [...new Set(ss.map(x => x.event_id).filter(Boolean))].sort().join(",");
      if (events && events !== known.current.events) {
        known.current.events = events;
        investigationApi.events(200).then(es => alive.current && setTitles(Object.fromEntries(es.map(e => [e.event_id, eventTitle(e)])))).catch(() => {});
      }
      const aside = ss.filter(x => x.finding_status === "set_aside").map(x => x.finding_id).sort().join(",");
      if (aside && aside !== known.current.aside) {  // a failed run and "no impact" share a status: the finding's reason tells them apart
        known.current.aside = aside;
        investigationApi.findings("?world=live&status=set_aside&limit=200")
          .then(fs => alive.current && setReasons(Object.fromEntries(fs.map(f => [f.finding_id, f.outcome?.reason ?? null])))).catch(() => {});
      }
      return ss;
    } catch (e) { if (alive.current && mine === seq.current) setErr(e); return null; }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    const vis = () => { if (!document.hidden) load(); };  // back on the tab: catch up at once, not at the next minute
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [load]);
  useEffect(() => {
    if (!iid) return;
    let live = true;
    inst.profile(iid).then(p => { if (live) setProfile(p); }).catch(() => {});
    inst.context(iid).then(c => { if (live) setScope(c.radar_scope); }).catch(() => {});
    return () => { live = false; };
  }, [iid]);

  // ---------------------------------------------------------------- asking: only after a button, every 3 s, for 2 min
  /** Ask about these findings until each lands (linked to an event, or set aside), then reload. Ids already being asked about are skipped. */
  const watchFindings = useCallback((ids: string[]) => {
    const todo = ids.filter(id => !inflight.current.has(id));
    if (!todo.length) return;
    todo.forEach(id => inflight.current.add(id));
    setWatching(new Set(inflight.current));
    const open = new Set(todo);
    let linked = 0;
    pollRun({
      wait: sleep, cancelled: () => !alive.current, every: POLL_EVERY_MS, forAtMost: POLL_FOR_MS,
      stillRunning: async () => {
        const rows = await Promise.all([...open].map(id => investigationApi.finding(id).catch(() => null)));  // a failed ask is asked again
        for (const f of rows) if (f && landed(f.status)) { open.delete(f.finding_id); if (f.status === "linked") linked++; }
        return open.size > 0;
      },
    }).then(async end => {
      todo.forEach(id => inflight.current.delete(id));
      if (!alive.current) return;
      setWatching(new Set(inflight.current));
      await load();
      const words = investigatedText(end, linked);
      if (words) toast(words);
    });
  }, [load, toast]);

  /** Ask about a run this viewer started until it isn't `running`; then say what it found and ask about the stories it sent. */
  const waitForRun = useCallback(async (first: RadarRun) => {
    let last = first;
    setRunWait({ id: first.run_id, since: first.created_at });
    const end = await pollRun({
      wait: sleep, cancelled: () => !alive.current, every: POLL_EVERY_MS, forAtMost: POLL_FOR_MS,
      stillRunning: async () => { last = await radarApi.getRun(first.run_id); return last.status === "running"; },
    });
    if (!alive.current) return;
    setRunWait(null);
    if (end === "timeout") { toast("Still working; it will appear here."); load(); return; }
    toast(runDoneText(last));
    const ss = await load();
    if (ss && last.status !== "failed") watchFindings(toWatch(ss, last.created_at));
  }, [load, toast, watchFindings]);

  const checkNow = async () => {
    setStarting(true);
    try {
      const r = await radarApi.run();
      if (r.status === "running") { load(); await waitForRun(r); }
      else { toast(runDoneText(r)); const ss = await load(); if (ss && r.status !== "failed") watchFindings(toWatch(ss, r.created_at)); }
    } catch (e) {
      refuse(e, refusalTitle((e as ApiError | undefined)?.code));
      load();  // the refusal says the numbers moved (budget, limit, a read already running): show them
    } finally { if (alive.current) setStarting(false); }
  };

  // ---------------------------------------------------------------- what is listed
  const all = items ?? [];
  const names = useMemo(() => profile?.place_names ?? {}, [profile]);
  const nameOf = useCallback((code: string) => names[code] ?? codeName(code), [names]);
  const w: Where = useMemo(() => ({ reasons, titles, watching }), [reasons, titles, watching]);
  const counts = useMemo(() => tabCounts(all, place), [all, place]);
  const rows = useMemo(() => listFor(all, tab, place), [all, tab, place]);
  const selected = pickStory(rows, storyId, phone);
  const listKey = `${tab}|${place}`;
  const { shown, hidden } = shownRows(rows, selected?.story_id ?? null, !!expanded[listKey]);
  const places = useMemo(() => placesOf(all), [all]);

  // a link to a story that is in another tab or place (?story=): open the tab it is in
  useEffect(() => {
    if (movedOut.current && movedOut.current !== storyId) movedOut.current = null;
    if (!items || !storyId || movedOut.current === storyId || rows.some(s => s.story_id === storyId)) return;
    const s = items.find(x => x.story_id === storyId);
    if (s) setParams({ tab: s.status === "sent" ? "sent" : s.status === "below" ? "below" : "dismissed", place: null });
  }, [items, storyId, rows, setParams]);
  // a place that no story is about any more (the list changed): show all places
  useEffect(() => { if (items && place && !places.includes(place)) setParams({ place: null }); }, [items, place, places, setParams]);

  // focus follows a choice: to the story's heading when one opens, to the list (or the row left) when one closes
  useEffect(() => {
    if (focusNext.current === "story") document.getElementById("rd-story-title")?.focus({ preventScroll: false });
    else if (focusNext.current === "list") (document.getElementById(lastOpened.current ? `rd-row-${lastOpened.current}` : "rd-list-h") ?? document.getElementById("rd-list-h"))?.focus();
    else return;
    focusNext.current = null;
  });
  useEffect(() => {  // the phone's own Back button closed the story
    if (phone && !storyId && lastOpened.current && pushed.current > 0) { focusNext.current = "list"; pushed.current -= 1; }
  }, [phone, storyId]);

  const hrefFor = (id: string) => { const n = new URLSearchParams(sp); n.set("story", id); return `?${n}`; };
  const open = (id: string) => { focusNext.current = "story"; lastOpened.current = id; if (phone) pushed.current += 1; setParams({ story: id }, phone); };
  const back = () => {
    focusNext.current = "list";
    if (pushed.current > 0) { pushed.current -= 1; nav(-1); } else setParams({ story: null });
  };
  const setFilter = (patch: Record<string, string | null>) => setParams({ ...patch, story: null });

  // ---------------------------------------------------------------- acting on a story
  const replace = (x: RadarStory) => setItems(xs => xs?.map(y => (y.story_id === x.story_id ? x : y)) ?? null);
  const act = async (s: RadarStory, what: "investigate" | "dismiss" | "restore") => {
    setBusyId(s.story_id);
    try {
      const done = await (what === "investigate" ? radarApi.investigate(s.story_id) : what === "dismiss" ? radarApi.dismiss(s.story_id) : radarApi.restore(s.story_id));
      const next = neighbour(rows, s.story_id);
      const leaves = tab !== "all" && done.status !== tab;
      if (leaves) movedOut.current = s.story_id;
      replace(done);
      if (leaves) {  // it left this tab: the next one down opens (on a phone, back to the list)
        lastOpened.current = null;
        if (phone) { focusNext.current = "list"; pushed.current = 0; setParams({ story: null }); }
        else { focusNext.current = next ? "story" : "list"; setParams({ story: next?.story_id ?? null }); }
      }
      if (what === "investigate") { toast("Sent for investigation."); if (done.finding_id) watchFindings([done.finding_id]); }
      else if (what === "dismiss") toast("Dismissed. It's under Dismissed if you want it back.", { label: "Undo", title: "Brings it back to held back", onClick: () => undo(done) });
      else toast("Restored. It's back in held back.");
    } catch (e) {
      refuse(e, refusalTitle((e as ApiError | undefined)?.code));
      load();
    } finally { if (alive.current) setBusyId(null); }
  };
  const undo = async (s: RadarStory) => {
    try { const back = await radarApi.restore(s.story_id); replace(back); toast("Restored. It's back in held back."); }
    catch (e) { refuse(e, refusalTitle((e as ApiError | undefined)?.code)); load(); }
  };

  // ---------------------------------------------------------------- what the page says
  const connected = status?.connected ?? false;
  const left = status?.run_now.left ?? 0;
  const running = !!status && (status.running > 0 || status.last_run?.status === "running") || !!runWait || starting;
  const resets = budgetResetsAt(now), zone = zoneName(status?.time_zone);
  const schedule = status ? scheduleText(status.every_minutes, status.run_at) : "";
  const why = status ? cantCheck({ connected, budgetSpent: status.budget_spent, running, left, limit: status.run_now.limit, budgetBack: resets, runAt: status.run_at }) : null;
  const lede = status ? ledeText(status, schedule, iso => dayWord(iso, now), iso => nextWord(iso, now)) : "";
  const last = status?.last_run;
  const shownRun = funnelRun(last, runs);
  const stats = funnelOf(shownRun);
  const reading = phone && !!selected;
  const stale = err != null && status !== null && loadedAt != null;
  const scopeText = scope ? `${plural(scope.places.length, "place")}, ${plural(scope.actors.length, "name")}` : "";
  const readingSince = last?.status === "running" ? last.created_at : runWait?.since ?? null;
  const empty = emptyCopy(tab, place, nameOf(place), { any: all.length > 0, connected, admin });

  const placeSelect = places.length > 1 && (
    <span className="v2-rd-sel">
      <label htmlFor={placeId}>Place</label>
      <select id={placeId} className="v2-rd-select" value={place} onChange={e => setFilter({ place: e.target.value || null })}>
        <option value="">All places</option>
        {places.map(p => <option key={p} value={p}>{nameOf(p)}</option>)}
      </select>
    </span>
  );

  const list = (
    <div className="v2-rd-col">
      <h2 id="rd-list-h" tabIndex={-1} className="v2-sr">{TABS.find(t => t.id === tab)!.label} stories, sent first</h2>
      <StoryList rows={shown} all={all} selectedId={selected?.story_id ?? null} names={names} w={w} now={now} hrefFor={hrefFor} onOpen={open}
        more={hidden > 0 && <button type="button" className="v2-rd-more" aria-expanded="false" onClick={() => setExpanded(e => ({ ...e, [listKey]: true }))}><span aria-hidden="true">▸ </span>{moreWord(tab, hidden)}</button>} />
      {all.length >= 50 && <p className="v2-meta v2-rd-limit">Showing the newest 50 stories.</p>}
    </div>
  );
  const pane = selected && (
    <Story s={selected} all={all} names={names} w={w} now={now} admin={admin} busy={busyId === selected.story_id}
      onInvestigate={() => act(selected, "investigate")} onDismiss={() => act(selected, "dismiss")} onRestore={() => act(selected, "restore")} />
  );

  return (
    <div className="v2-rd">
      {stale && <StaleBanner loadedAt={loadedAt!} now={now.getTime()} onRetry={load} />}

      <header className={`v2-rd-head${reading ? " v2-sr" : ""}`}>
        <div className="v2-rd-head__t">
          <h1 className="v2-rd-h1">Radar</h1>
          {lede && <p className="v2-rd-lede">{lede}</p>}
        </div>
        {status && (
          <div className="v2-rd-head__act">
            <div className="v2-rd-head__btns">
              <Button as="link" to="/institution/agents">What it watches{scopeText && <span className="v2-rd-btn__sub"> · {scopeText}</span>}</Button>
              {connected && (
                <Button variant="primary" locked={locked} onClick={checkNow} disabled={!!why} aria-describedby={why && !running ? "rd-why" : undefined}>
                  <Icon name="refresh" className={starting || runWait ? "spin" : undefined} />
                  {starting || runWait ? "Checking…" : <>Check now <span className="v2-rd-btn__sub">{leftToday(left)}</span></>}
                </Button>
              )}
            </div>
            {connected && why && !running && <p id="rd-why" className="v2-meta v2-rd-cant">{why}</p>}
          </div>
        )}
      </header>

      {status === null && err != null && <LoadError error={err} onRetry={load} what="Radar" safe="Radar's stories are safe; this page just couldn't reach them." />}

      {status && !connected && !reading && (
        <AgentState kind="offline" tone="idle" title="Radar isn't connected."
          action={<Button size="sm" disabled>Check now</Button>}>
          Monitors and prices still run.{!admin && " Your Platform Admin connects Radar."}
        </AgentState>
      )}
      {status && !reading && admin && status.notes.length > 0 && <div className="v2-rd-notes">{status.notes.map(n => <p key={n} className="v2-meta">{n}</p>)}</div>}
      {status && !reading && connected && last?.status === "failed" && !running && (
        <p className="v2-rd-note is-warn" role="status"><span aria-hidden="true">⚠</span>
          <span><b>The last read failed</b> {ago(last.finished_at ?? last.created_at, now)}. {admin && last.error ? last.error : "Radar will try again at the next read."}</span></p>
      )}

      {status && connected && running && !reading && <ReadingNow since={readingSince} />}
      {status && connected && !running && watching.size > 0 && !reading && <Investigating n={watching.size} />}
      {status && connected && stats && shownRun && !reading && <Funnel stats={stats} run={shownRun} now={now} />}

      {status === null && err == null && <RadarSkeleton phone={phone} />}

      {status && (reading && selected ? (
        <div className="v2-rd-read">
          <Link to="?" className="v2-rd-back" onClick={e => { e.preventDefault(); back(); }}><span aria-hidden="true">←</span>All stories</Link>
          {pane}
        </div>
      ) : (
        <Tabs label="Which stories" value={tab} onChange={id => setFilter({ tab: id === "all" ? null : id })} className="v2-rd-tabs"
          tabs={TABS.map(t => ({ id: t.id, label: t.label, count: items ? counts[t.id] : undefined, countLabel: t.countLabel }))}
          trailing={placeSelect || undefined}>
          <TabPanel id={tab}>
            {items === null ? <RadarSkeleton phone={phone} />
              : !rows.length
                ? <Empty title={empty.title} className="v2-rd-empty"
                    action={empty.clear ? <Button onClick={() => setFilter({ place: null })}>Show all places</Button>
                      : !all.length && !connected ? <Button as="link" to="/institution/agents">See what Radar will read</Button> : undefined}>{empty.text}</Empty>
                : <div className="v2-rd-body">
                  {list}
                  {!phone && selected && <div className="v2-rd-pane">{pane}</div>}
                </div>}
          </TabPanel>
        </Tabs>
      ))}

      {status && !reading && (
        <section className="v2-rd-foot" aria-labelledby="rd-more-h">
          <h2 id="rd-more-h" className="v2-cap v2-rd-foot__h">More about Radar</h2>
          {connected && <EarlierReads runs={runs} last={last} />}
          {scope && <Watches scope={scope} names={names} />}
          {connected && <Budget status={status} admin={admin} resets={resets} zone={zone} />}
          <HowItWorks name={profile?.institution.name ?? "your institution"} status={status} schedule={schedule} zone={zone} />
        </section>
      )}
    </div>
  );
}
