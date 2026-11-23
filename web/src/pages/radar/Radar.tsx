// Radar, as a news reader. The headline is the last read's answer; filters sit above two panes: story titles by day on the
// left, the chosen story in full on the right. Held-back stories are quieter rows; run details, scope and sources are one click down.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type UIEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { inst } from "../../api/institutions";
import { gb, radarApi, scheduleText, type RadarStatus, type RadarStory } from "../../api/radar";
import { ChipFilter } from "../../components/FlowFilter";
import { Icon } from "../../components/Icon";
import { HowItWorks, PageHeader } from "../../components/blocks";
import { Banner, Empty, ListSkeleton, LoadError, useNow, useRole, useToast } from "../../components/ui";
import { ago, day, dayTime, placeName, placeOrder, plural, when } from "../../format";
import { themeText } from "../events/Events";
import "../../styles/radar.css";

type Show = "all" | "sent" | "below" | "dismissed";
type Scope = { places: string[]; why: Record<string, string[]>; themes: string[]; actors: string[] };
const SHOW: [Show, string][] = [["all", "All"], ["sent", "Sent for investigation"], ["below", "Held back"], ["dismissed", "Dismissed"]];
const FEW = { sent: 3, below: 2 };  // stories a day card shows before "more": short enough that the whole first card fits at a glance
const REL = { high: "highly relevant", medium: "relevant", low: "slightly relevant" } as const;
const STATE = { sent: "Sent for investigation", below: "Held back by Radar", dismissed: "Dismissed" } as const;

const outlets = (s: RadarStory) => [...new Set(s.headlines.map(h => h.outlet).filter(Boolean))] as string[];

/** Where a sent story went, with the link when there is one. */
function Outcome({ s }: { s: RadarStory }) {
  if (s.status !== "sent") return null;
  return s.event_id ? <span className="rd-out">In the event <Link to={`/events/${s.event_id}`}>{s.event_title ?? "Open the event"}</Link></span>
    : <span className="rd-out wait">{s.finding_status === "grouped" ? "Being investigated" : "Waiting to be investigated"}</span>;
}

/** The chosen story: what happened, why it matters (or why it was held back), what to do, and the sources on request. */
function Reader({ s, place, act, admin }: { s: RadarStory; place: (p: string) => string; act: (f: () => Promise<RadarStory>, m: string) => void; admin: boolean }) {
  const [more, setMore] = useState(false);  // kept across stories: once a reader wants the detail, they get it on every story
  const [src, setSrc] = useState(false);
  useEffect(() => setSrc(false), [s.story_id]);
  const os = outlets(s);
  return <article className={`rd-read ${s.status}`} aria-labelledby="rd-read-h">
    <span className="label">{dayTime(s.last_seen_at)} · {STATE[s.status]}{s.status === "sent" && s.sent_by && s.sent_by !== "agent" ? ` by ${s.sent_by}` : ""} · {REL[s.relevance]}</span>
    <h2 id="rd-read-h">{s.title}</h2>
    <div className="rd-acts">
      <Outcome s={s} />
      {s.status === "below" && <><span className="rd-out quiet rd-full">Relevant, but Radar judged it not important enough to investigate.</span>
        <button className="btn btn--sm" type="button" onClick={() => act(() => radarApi.investigate(s.story_id), "Sent for investigation")}>Investigate anyway</button>
        <button className="btn btn--sm btn--ghost" type="button" onClick={() => act(() => radarApi.dismiss(s.story_id), "Dismissed")}>Dismiss</button></>}
      {s.status === "dismissed" && <><span className="rd-out quiet">by {s.dismissed_by}{s.dismissed_at ? ` ${ago(s.dismissed_at)}` : ""}</span>
        <button className="btn btn--sm btn--ghost" type="button" onClick={() => act(() => radarApi.restore(s.story_id), "Restored")}>Restore</button></>}
    </div>
    <p className="rd-why"><b>{s.status === "sent" ? "Why it matters to you." : "Why Radar held it back."}</b> {s.why}</p>
    <button type="button" className="rd-link" aria-expanded={more} onClick={() => setMore(o => !o)}>
      <Icon name="chevron" className={`ico16 ${more ? "rot" : ""}`} />{more ? "Less about this story" : "What happened, places and sources"}</button>
    {more && <div className="rd-more">
      <p className="rd-sum">{s.summary}</p>
      <p className="rd-meta">{placeOrder(s.places).map(place).join(" · ")}{s.themes.length ? <> · <span className="rd-themes">{s.themes.map(t => themeText(t)).join(" · ")}</span></> : null}</p>
      <p className="rd-meta">{plural(s.publishers, "publisher")} · {os.slice(0, 3).join(", ")}{os.length > 3 ? ` and ${os.length - 3} more` : ""}
        {s.runs_seen > 1 ? ` · seen in ${s.runs_seen} reads` : ""}{s.development_of ? " · continues an earlier story" : ""}{admin ? ` · Radar score ${s.score}` : ""}</p>
      {s.monitor_hint && <p className="rd-meta">Your monitor <Link to={`/monitors/${s.monitor_hint.monitor_id}`}>{s.monitor_hint.name}</Link> also covers these places.</p>}
      <button type="button" className="rd-link" aria-expanded={src} onClick={() => setSrc(o => !o)}>
        <Icon name="chevron" className={`ico16 ${src ? "rot" : ""}`} />{src ? "Hide the headlines" : `Show the ${plural(s.headlines.length, "headline")}`}</button>
      {src && <ul className="rd-heads">{s.headlines.map((h, i) => <li key={i}>
        {h.url ? <a href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : h.title}<span>{h.outlet ?? ""} · {dayTime(h.published_at)}</span></li>)}</ul>}
    </div>}
  </article>;
}

export function RadarPage() {
  const toast = useToast();
  const now = useNow(30_000);
  const { role } = useRole();
  const admin = role === "platform_admin";
  const [status, setStatus] = useState<RadarStatus | null>(null);
  const [items, setItems] = useState<RadarStory[] | null>(null);
  const [names, setNames] = useState<Record<string, string | null>>({});
  const [scope, setScope] = useState<Scope | null>(null);
  const [instName, setInstName] = useState("your institution");
  const [show, setShow] = useState<Show>("all");
  const [where, setWhere] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [upto, setUpto] = useState(2);  // days loaded: the latest plus one ahead to scroll to; reaching the last brings in the next
  const [open, setOpen] = useState<Set<string>>(new Set());  // days whose "more" is unfolded
  const [inView, setInView] = useState<string | null>(null);  // the day at the top of the list; the tabs count that day
  const [hover, setHover] = useState<string | null>(null);  // a day card under the mouse wins over the scrolled one
  const [details, setDetails] = useState(false);
  const [why, setWhy] = useState<string | null>(null);  // the watched place whose reason is open
  const [running, setRunning] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const listRef = useRef<HTMLOListElement>(null);

  const load = useCallback(async () => {
    try { // ponytail: the newest 200 stories (the server's cap, about 20 days of reads) load at once and the list reveals them a day at a time;
      // past 200, add a "before this date" option to /radar/stories and fetch each older day as it is scrolled to
      const [st, ss] = await Promise.all([radarApi.status(), radarApi.stories({ limit: "200" })]); setStatus(st); setItems(ss); setErr(null); }
    catch (e) { setErr(e); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    api<{ institution_id: string; profile: boolean }>("/api/v1/installation").then(i => {
      if (!i.profile) return;
      inst.profile(i.institution_id).then(p => { setNames(p.place_names ?? {}); setInstName(p.institution.name); }).catch(() => {});
      inst.context(i.institution_id).then(c => setScope(c.radar_scope)).catch(() => {});
    }).catch(() => {});
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

  const place = (p: string) => names[p] ?? placeName(p);
  const act = async (f: () => Promise<RadarStory>, msg: string) => {
    try { const x = await f(); setItems(xs => xs?.map(y => (y.story_id === x.story_id ? x : y)) ?? null); toast(msg); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const runNow = async () => {
    try { const r = await radarApi.run(); if (r.status === "running") setRunning(r.run_id); else { load(); toast(`Radar found ${r.stories ?? 0} stories, sent ${r.sent ?? 0}`); } }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };

  const all = useMemo(() => [...(items ?? [])].sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at)
    || Number(b.status === "sent") - Number(a.status === "sent") || b.score - a.score), [items]);
  const inPlace = all.filter(s => !where || s.places.includes(where));
  const shown = inPlace.filter(s => show === "all" || s.status === show);
  // one card per day, newest first; a filter starts from the latest day it matches, so it reaches back as far as it needs to
  const days = [...new Set(shown.map(s => day(s.last_seen_at)))];
  const visible = shown.filter(s => days.indexOf(day(s.last_seen_at)) < upto);
  // a card shows the first few sent and held back; the rest fold under "more"
  const rowsOf = (d: string) => {
    const xs = shown.filter(s => day(s.last_seen_at) === d);
    const top = [...xs.filter(s => s.status === "sent").slice(0, FEW.sent), ...xs.filter(s => s.status === "below").slice(0, FEW.below)];
    return { top, rest: xs.filter(s => !top.includes(s)) };
  };
  const loaded = days.slice(0, upto);
  const order = loaded.flatMap(d => { const r = rowsOf(d); return open.has(d) ? [...r.top, ...r.rest] : r.top; });
  const cur = visible.find(s => s.story_id === sel) ?? visible.find(s => s.status === "sent") ?? visible[0];
  const placesSeen = useMemo(() => [...new Set(all.flatMap(s => s.places))], [all]);
  // the tabs count the day in view: the latest on opening (so they agree with the headline), then whichever day is scrolled to
  const countDay = hover && days.includes(hover) ? hover : inView && days.includes(inView) ? inView : days[0] ?? (inPlace[0] ? day(inPlace[0].last_seen_at) : "");
  const ofDay = inPlace.filter(s => day(s.last_seen_at) === countDay);
  const count = (k: Show) => (k === "all" ? ofDay.length : ofDay.filter(s => s.status === k).length);
  const refilter = () => { listRef.current?.scrollTo(0, 0); setSel(null); setUpto(2); setOpen(new Set()); setInView(null); setHover(null); };  // a new filter starts again at the top
  const scrolled = (e: UIEvent<HTMLOListElement>) => {
    const o = e.currentTarget, top = o.getBoundingClientRect().top;
    let d: string | null = null;  // the card at the top of the list
    o.querySelectorAll<HTMLElement>("[data-day]").forEach(h => { if (h.getBoundingClientRect().top - top <= 24) d = h.dataset.day ?? null; });
    if (o.scrollTop > 0 && o.scrollHeight - o.scrollTop - o.clientHeight < 2) d = loaded[loaded.length - 1];  // at the bottom, short last cards never reach the top
    setInView(d);
    clearTimeout(settle.current); settle.current = window.setTimeout(() => { settle.current = 0; fit(); }, 150);  // fit once the snap has settled
    if (d && days.indexOf(d) >= upto - 1) setUpto(u => Math.min(days.length, u + 1));  // on the last card loaded: bring in the next
  };
  useEffect(() => {  // short cards: keep bringing in days until the list has something to scroll
    const o = listRef.current;
    if (o && upto < days.length && o.scrollHeight <= o.parentElement!.clientHeight + 40) setUpto(u => u + 1);
  });
  // unfiltered, one day per view: the list takes the height of the day at its top (within the room there is), so no other day shows
  // and no space is left under a short one. Filtered, days are short, so the list uses all the room and stacks them, the next one
  // showing below. Once a scroll settles a day's start eases to the top; an unfolded day being read is left alone.
  const settle = useRef(0);
  const single = useRef(true);
  single.current = show === "all" && !where;
  const peek = useRef(0);  // resting on a story shows it, after a moment so passing over rows on the way to the reader doesn't
  const fit = useCallback(() => {
    const o = listRef.current;
    if (!o || settle.current) return;
    const top = o.getBoundingClientRect().top, cards = [...o.querySelectorAll<HTMLElement>(".rd-card")];
    // reading down an unfolded day: leave the scroll where the reader put it until the next day reaches the top
    if (cards.some(c => { const r = c.getBoundingClientRect(); return c.classList.contains("open") && r.top < top - 1 && r.bottom > top + 1; })) return;
    // the day whose start is nearest the top (a short last day can stop short of it until the next one loads)
    const gap = (c: HTMLElement) => Math.abs(c.getBoundingClientRect().top - top);
    const at = cards.reduce<HTMLElement | null>((a, c) => (!a || gap(c) < gap(a) ? c : a), null);
    if (!at) return;
    const room = o.parentElement!.clientHeight;
    o.style.height = `${single.current ? Math.min(room, at.offsetHeight) : room}px`;
    const by = at.getBoundingClientRect().top - top;  // and snap it there
    if (Math.abs(by) > 1) o.scrollBy({ top: by, behavior: "smooth" });
  }, []);
  useLayoutEffect(fit);
  useEffect(() => { window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit); }, [fit]);
  const fold = (d: string) => setOpen(o => { const n = new Set(o); if (!n.delete(d)) n.add(d); return n; });

  // up and down move through the list, like a mail reader
  const keys = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const i = Math.max(0, order.findIndex(s => s.story_id === cur?.story_id)) + (e.key === "ArrowDown" ? 1 : -1);
    // past the last row loaded, the next day comes in
    const nx = i >= order.length && upto < days.length ? rowsOf(days[upto]).top[0] : order[Math.min(order.length - 1, Math.max(0, i))];
    if (!nx) return;
    setUpto(u => Math.max(u, days.indexOf(day(nx.last_seen_at)) + 1));
    setSel(nx.story_id);
    setTimeout(() => listRef.current?.querySelector<HTMLButtonElement>(`[data-id="${nx.story_id}"]`)?.focus());
  };

  const st = status, lr = st?.last_run, left = st?.run_now.left ?? 0;
  const cant = !st?.connected ? "Radar isn't connected yet" : st.budget_spent ? "Today's reading budget is spent"
    : running || st.running ? "A run is in progress" : left === 0 ? "Limit reached; resets at midnight" : null;
  const sched = st ? scheduleText(st.every_minutes, st.run_at) : "";
  const next = st ? (new Date(st.next_run_at) <= now ? "due now" : when(st.next_run_at, now)) : "";
  return (
    <div className="page rd">
      <PageHeader eyebrow={st ? `Reads world news ${sched}${lr ? ` · last read ${ago(lr.finished_at ?? lr.created_at, now)}` : ""}${st.connected ? ` · next ${next}` : ""}` : undefined}
        title={!st ? "Radar" : !lr ? "Radar hasn't read the news yet"
          : <>Radar read <span className="rd-n read">{(lr.considered ?? 0).toLocaleString()}</span> articles and sent <span className="rd-n ok">{lr.sent ?? 0}</span> to you</>}
        status={lr ? <>{lr.stories ?? 0} stories touched your footprint; {lr.sent ?? 0} {lr.sent === 1 ? "was" : "were"} worth investigating, the rest are kept below.</> : undefined}
        cta={<>
          <button className="btn btn--primary btn--lg" type="button" disabled={!!cant} title={cant ?? undefined} onClick={runNow}>
            <Icon name={running ? "refresh" : "radar"} />{running ? "Checking…" : "Check now"}</button>
          <span className="muted">{st?.connected ? `${left} of ${st.run_now.limit} left today` : "once Radar is connected"}</span>
          <button className="rd-link" type="button" aria-expanded={details} onClick={() => setDetails(o => !o)}>
            {scope ? `What it watches: ${plural(scope.places.length, "place")}${scope.actors.length ? `, ${plural(scope.actors.length, "name")}` : ""}` : "Run details"}</button>
        </>}
        actions={<Link className="btn" to="/institution/agents">What Radar reads from your profile</Link>}
        help={<HowItWorks><p>Radar reads the world's news for anything that touches {instName}, using the places and names in your profile. What matters goes to the investigation like any other finding; the rest is kept here, and you can still send it.</p>
          {st && <p>Prototype limits: Radar reads the news {sched}, and you can Check now {st.run_now.limit} times a day. English news only.</p>}</HowItWorks>} />

      <div className="banners">
        {err != null && <LoadError error={err} onRetry={load} what="Radar" />}
        {admin ? st?.notes.map(n => <Banner key={n} kind="warn" icon="warn">{n}</Banner>)
          : st && !st.connected && <Banner kind="warn" icon="warn"><b>Radar isn't reading the news yet.</b> Your Platform Admin connects it. Monitors and market series still watch for you.</Banner>}
        {st && st.connected && left === 0 && <Banner kind="info" icon="info">You've used today's {st.run_now.limit} checks; the next read is {next}.</Banner>}
        {lr?.status === "failed" && <Banner kind="crit" icon="warn"><b>The last read failed</b> {ago(lr.finished_at ?? lr.created_at, now)}.{admin ? ` ${lr.error ?? ""}` : " Radar will try again at the next read."}</Banner>}
      </div>

      {details && st && <div className="rd-details">
        <dl>
          <div><dt>Last read</dt><dd>{lr ? `${dayTime(lr.created_at)}, ${lr.trigger === "now" ? "on request" : "on schedule"}, ${lr.status === "completed" ? "finished" : lr.status.replace("_", " ")}` : "never"}</dd></div>
          {lr && <div><dt>What it found</dt><dd>{(lr.considered ?? 0).toLocaleString()} read → {lr.shortlisted ?? 0} grouped → {lr.stories ?? 0} kept → {lr.sent ?? 0} sent</dd></div>}
          <div><dt>Next read</dt><dd>{st.connected ? next : "once Radar is connected"}{st.running ? " · running now" : ""}</dd></div>
          <div><dt>{admin ? "BigQuery today" : "Reading budget"}</dt><dd>{admin ? `${gb(st.bytes_today)} of ${gb(st.bytes_cap)}, at most ${st.limits.max_queries} queries a run, ${gb(st.limits.max_bytes_per_query)} each` : `${Math.round((st.bytes_today / Math.max(1, st.bytes_cap)) * 100)}% used, resets at midnight UTC`}</dd></div>
        </dl>
        {scope && <p className="rd-places"><b>Places.</b> {scope.places.map(p => <button key={p} type="button" className="rd-pl" aria-expanded={why === p} onClick={() => setWhy(why === p ? null : p)}>{place(p)}</button>)}</p>}
        {scope && why && <p className="rd-pwhy" role="status"><b>{place(why)}</b> is watched because: {(scope.why[why] ?? []).join("; ") || "it is part of where you operate"}.</p>}
        {scope && scope.actors.length > 0 && <p><b>Names.</b> {scope.actors.join(", ")}</p>}
        <p className="muted">Select a place to see why it's watched. These come from your profile: <Link to="/institution/agents">what Radar reads from your profile</Link>.</p>
      </div>}

      <div className="rd-filters">
        <ChipFilter label="Which stories" value={show} onChange={k => { refilter(); setShow(k); }}
          options={SHOW.map(([key, label]) => ({ key, label, count: count(key) }))} />
        {placesSeen.length > 1 && <select className="input rd-where" aria-label="Filter by place" value={where} onChange={e => { refilter(); setWhere(e.target.value); }}>
          <option value="">All places</option>{placesSeen.map(p => <option key={p} value={p}>{place(p)}</option>)}</select>}
      </div>

      {items === null ? (err == null && <ListSkeleton rows={4} />)
        : !shown.length ? <Empty icon="radar" title={show === "all" && !where ? "No stories yet" : "Nothing here"}
            actions={show === "all" && !st?.connected ? <Link className="btn" to="/institution/agents">See what Radar will read</Link> : undefined}>
            {show === "all" && !where ? (st?.connected ? "Radar hasn't found anything touching your footprint yet. Check now runs it at once." : admin ? "Connect the Radar agent (RADAR_URL) and it starts reading the news." : "Radar starts reading the news once your Platform Admin connects it.") : "No stories match these filters."}</Empty>
        : <div className="rd-split">
          <nav className="rd-index" aria-label="Stories">
            <ol ref={listRef} onKeyDown={keys} onScroll={scrolled} onMouseLeave={() => setHover(null)}>{loaded.map(d => {
              const { top, rest } = rowsOf(d), isOpen = open.has(d);
              const tally = (["sent", "below", "dismissed"] as const).map(k => [rest.filter(s => s.status === k).length, k === "below" ? "held back" : k] as const).filter(([c]) => c);
              return <li key={d} data-day={d} className={`rd-card ${d === countDay ? "on" : ""} ${isOpen ? "open" : ""}`} onMouseEnter={() => setHover(d)}>
                <span className="rd-day">{d}</span>
                <ol>{(isOpen ? [...top, ...rest] : top).map(s => <li key={s.story_id}>
                  <button type="button" data-id={s.story_id} className={s.status} title={s.title} aria-current={cur?.story_id === s.story_id} onClick={() => setSel(s.story_id)}
                    onMouseEnter={() => { clearTimeout(peek.current); peek.current = window.setTimeout(() => setSel(s.story_id), 180); }}
                    onMouseLeave={() => clearTimeout(peek.current)}>
                    <span className="rd-dot" aria-hidden="true" />
                    <span className="rd-it"><span className="rd-tt">{s.title}</span>
                      <span className="rd-sub">{placeOrder(s.places).slice(0, 2).map(place).join(", ")}{s.places.length > 2 ? ` +${s.places.length - 2}` : ""}
                        {" · "}{s.status === "sent" ? (s.event_title ?? "sent") : s.status === "below" ? "held back" : "dismissed"}</span></span>
                  </button></li>)}</ol>
                {rest.length > 0 && <button type="button" className="rd-link rd-fold" aria-expanded={isOpen} onClick={() => fold(d)}>
                  <Icon name="chevron" className={`ico16 ${isOpen ? "rot" : ""}`} />
                  {isOpen ? "Show fewer" : `Show ${rest.length} more: ${tally.map(([c, w]) => `${c} ${w}`).join(", ")}`}</button>}
              </li>;
            })}</ol>
          </nav>
          {cur && <Reader s={cur} place={place} act={act} admin={admin} />}
        </div>}
    </div>
  );
}
