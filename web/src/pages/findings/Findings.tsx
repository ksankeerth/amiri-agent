// Findings: what the sources found in the last 7 days, grouped by the event each one joined, and what the
// investigation made of the rest (waiting, being investigated, not in an event and why). No live push: the page
// reloads every 30 s, and Refresh reloads now.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { ApiError } from "../../api/client";
import { investigationApi, type EventRow, type FindingRow } from "../../api/investigation";
import { GoLink, PageTitle, QuietWarn, Section, TextButton, TextTabs, ToneMark, ToneWord, TONE_WORD } from "../../components/rd";
import { Icon } from "../../components/Icon";
import { errText, isDown, LoadError, ListSkeleton, useNow, useToast } from "../../components/ui";
import { ago, day, dayTime, plural, until, ZONE_LABEL } from "../../format";
import { count, eventTitle, investigationFailed, longWhen, signalStrength, sourceInfo } from "../../plain";
import "../../styles/rd-findings.css";
import { useInvestigationStatus } from "../events/Events";
import { DAYS, reasonText, useRecentFindings } from "./recent";

// the list carries each finding's evidence when the source kept it (the article's link)
type WithEvidence = FindingRow & { evidence?: { headlines?: { url?: string | null }[] } | null };
type Show = "all" | "new" | "grouped" | "linked" | "set_aside";

const SHOW_NEWEST = 3;      // an event's group shows its newest three; the rest is one click away
const SHOW_OTHERS = 10;     // the groups without an event are short; they fold only when they aren't

function sourceLink(f: FindingRow): string | null {
  const r = f.source_ref ?? {};
  if (f.source === "monitor" && r.monitor_id) return `/monitors/${r.monitor_id}`;
  if (f.source === "timeseries" && r.series_id) return `/series/${r.series_id}`;
  if (f.source === "radar") return "/radar";
  return null;
}
const SOURCE_GO: Record<string, string> = { monitor: "Open the monitor", timeseries: "Open the market series", radar: "Open Radar" };
const SOURCE_FROM: Record<string, string> = { monitor: "news monitors", radar: "Radar", timeseries: "market prices", studio: "Scenario Studio" };

const newestFirst = (a: FindingRow, b: FindingRow) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0);
const TONE_RANK: Record<string, number> = { bad: 0, mixed: 1, neutral: 2, good: 3 };

/** "4 to 10 Nov", "30 Oct to 4 Nov", or "10 Nov" when it is one day. */
function spanOf(fs: FindingRow[]): string {
  const ds = fs.map(f => f.created_at).sort();
  const a = day(ds[0]), b = day(ds[ds.length - 1]);
  if (a === b) return a;
  const [da, ma] = a.split(" "), [, mb] = b.split(" ");
  return `${ma === mb ? da : a} to ${b}`;
}

/** Why a finding wasn't put in an event, in words: the investigation's own note first, else its reason. */
const whyText = (f: FindingRow) => f.outcome?.note || reasonText(f) || "no link to your products";

interface Group { key: string; kind: "event" | "waiting" | "investigating" | "out"; eventId?: string; items: FindingRow[] }

/** The page's one filled button, when findings are waiting. */
function InvestigateNow({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const out = await investigationApi.investigateNow();
      const sent = out.items.reduce((n, r) => n + r.finding_ids.length, 0);
      toast([sent ? `Sent ${plural(sent, "finding")} to the investigation agent.` : "",
             out.developments.length ? `${out.developments.length} joined an open event as the same move continuing (${out.developments[0].event_title}).` : ""]
        .filter(Boolean).join(" "));
      onDone();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setBusy(false); }
  };
  return <button className="btn btn--primary" type="button" onClick={go} disabled={busy} title="Skips the wait for the next batch">
    <Icon name={busy ? "refresh" : "play"} className={busy ? "spin" : undefined} />Investigate now</button>;
}

export function FindingsPage() {
  const toast = useToast();
  const now = useNow(15_000);
  const { hash } = useLocation();
  const { items, err, loadedAt, load } = useRecentFindings();
  const { status, reload } = useInvestigationStatus();
  const [show, setShow] = useState<Show>("all");
  const [checking, setChecking] = useState<string | null>(null);
  const [events, setEvents] = useState<Record<string, EventRow>>({});
  const [eventsReady, setEventsReady] = useState(false);  // the group names wait for the events (or their failure)
  const [more, setMore] = useState<Record<string, boolean>>({});     // groups opened to show every finding
  const [opened, setOpened] = useState<Record<string, boolean>>({}); // findings opened for their details
  const [help, setHelp] = useState(false);
  const helpId = useId();
  useEffect(() => {
    investigationApi.events().then(xs => setEvents(Object.fromEntries(xs.map(e => [e.event_id, e])))).catch(() => {}).finally(() => setEventsReady(true));
  }, [items]);
  const refresh = () => { load(); reload(); };
  const target = useMemo(() => { try { return decodeURIComponent(hash.slice(1)); } catch { return ""; } }, [hash]);

  const check = async (f: FindingRow) => {
    if (!f.run_id) return;
    setChecking(f.finding_id);
    try {
      const r = await investigationApi.collect(f.run_id);
      toast(r.status === "running" ? "Still being investigated. Try again in a moment." : "The investigation has finished.");
      refresh();
    } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
    finally { setChecking(null); }
  };

  // ---- the week in numbers
  const all = useMemo(() => items ?? [], [items]);
  const nOf = (s: Show) => all.filter(f => s === "all" || f.status === s).length;
  const nEvents = new Set(all.filter(f => f.status === "linked" && f.outcome?.event_id).map(f => f.outcome!.event_id)).size;
  const nPending = nOf("new") + nOf("grouped");
  const sources = useMemo(() => {
    const by = new Map<string, number>();
    for (const f of all) by.set(f.source, (by.get(f.source) ?? 0) + 1);
    return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${n} from ${SOURCE_FROM[s] ?? sourceInfo(s).label.toLowerCase()}`);
  }, [all]);

  // ---- the groups: waiting, being investigated, then the events (most serious first), then those in no event
  const groups = useMemo<Group[]>(() => {
    const rows = [...all].sort(newestFirst);
    const out: Group[] = [];
    const wants = (s: Show) => show === "all" || show === s;
    if (wants("new")) { const xs = rows.filter(f => f.status === "new"); if (xs.length) out.push({ key: "waiting", kind: "waiting", items: xs }); }
    if (wants("grouped")) { const xs = rows.filter(f => f.status === "grouped"); if (xs.length) out.push({ key: "investigating", kind: "investigating", items: xs }); }
    if (wants("linked")) {
      const by = new Map<string, FindingRow[]>();
      for (const f of rows) if (f.status === "linked") { const id = f.outcome?.event_id ?? "none"; by.set(id, [...(by.get(id) ?? []), f]); }
      const evs = [...by.entries()].map(([id, xs]): Group => ({ key: id, kind: "event", eventId: id === "none" ? undefined : id, items: xs }));
      const rank = (g: Group) => TONE_RANK[events[g.eventId ?? ""]?.tone ?? ""] ?? 4;
      evs.sort((a, b) => rank(a) - rank(b) || b.items.length - a.items.length || (a.items[0].created_at < b.items[0].created_at ? 1 : -1));
      out.push(...evs);
    }
    if (wants("set_aside")) { const xs = rows.filter(f => f.status === "set_aside"); if (xs.length) out.push({ key: "out", kind: "out", items: xs }); }
    return out;
  }, [all, show, events]);

  const targetFinding = useMemo(() => all.find(f => `f-${f.finding_id}` === target), [all, target]);
  const targetGroup = useMemo(() => groups.find(g => g.items.some(f => `f-${f.finding_id}` === target))?.key, [groups, target]);
  const scrolled = useRef("");
  useEffect(() => {  // from the Overview: open on that finding, in its group, even if that group was folded or filtered out
    if (!items || !eventsReady || !targetFinding) return;
    if (!targetGroup) { setShow("all"); return; }
    if (scrolled.current === target) return;
    scrolled.current = target;
    document.getElementById(target)?.scrollIntoView({ block: "center" });
  }, [items, eventsReady, targetFinding, targetGroup, target]);

  const nextBatch = status?.next_batch_at && status.connected ? (new Date(status.next_batch_at) <= now ? "very soon" : `in ${until(status.next_batch_at, now)}`) : null;

  const tabs = ([["all", "All"], ["new", "Waiting"], ["grouped", "Being investigated"], ["linked", "In an event"], ["set_aside", "Not in an event"]] as const)
    .map(([key, label]) => ({ key, label, count: nOf(key) }));

  const lede = !items ? null : !items.length ? `Nothing found in the last ${DAYS} days.` : <>
    <b>{items.length} found</b> in the last {DAYS} days.{" "}
    {[nOf("linked") ? `${nOf("linked")} went into ${count(nEvents, "event")}` : "None went into an event",
      nOf("set_aside") ? `${nOf("set_aside")} didn't` : "",
      nPending ? `${nPending} ${nPending === 1 ? "is" : "are"} still with the investigation` : ""].filter(Boolean).join("; ")}.{" "}</>;

  // ---- one finding: the headline is the link; source and time on the right; Details opens it in place
  const row = (f: FindingRow, g: Group): ReactNode => {
    const id = `f-${f.finding_id}`;
    const si = sourceInfo(f.source), src = sourceLink(f), sig = signalStrength(f.score);
    const url = (f as WithEvidence).evidence?.headlines?.find(h => h.url)?.url;
    const isOpen = !!opened[f.finding_id];
    const failed = investigationFailed(f.status, f.outcome?.reason);
    const headline = url
      ? <a className="rd-name" href={url} target="_blank" rel="noreferrer">{f.title}<span aria-hidden="true"> ↗</span><span className="sr"> (opens the article)</span></a>
      : src ? <Link className="rd-name" to={src}>{f.title}</Link> : f.title;
    return (
      <li key={f.finding_id} id={id} className={`fd-row${target === id ? " fd-target" : ""}`}>
        <div className="fd-line">
          <span className="fd-t">{headline}</span>
          <span className="fd-m" title={longWhen(f.created_at)}>{si.label} · {dayTime(f.created_at)}</span>
          <TextButton aria-expanded={isOpen} aria-controls={`${id}-d`} onClick={() => setOpened(o => ({ ...o, [f.finding_id]: !o[f.finding_id] }))}>
            {isOpen ? "Hide" : "Details"}<span className="sr"> for {f.title}</span></TextButton>
        </div>
        {g.kind === "out" && <div className="fd-what">{failed
          ? <><ToneWord tone="mixed">Couldn't be investigated</ToneWord><span>· the investigation couldn't run on it</span></>
          : <><ToneWord tone="neutral">No impact found</ToneWord><span>· {whyText(f)}</span></>}</div>}
        {g.kind === "waiting" && <div className="fd-what">Waiting to be investigated{nextBatch ? `: the next batch goes ${nextBatch}` : ""}</div>}
        {g.kind === "investigating" && <div className="fd-what">Being investigated{f.run_started_at ? `, started ${ago(f.run_started_at, now)}` : ""}
          {f.run_status === "running" && f.run_id && <span className="fd-checks">
            <TextButton disabled={checking === f.finding_id} onClick={() => check(f)}>{checking === f.finding_id ? "Checking…" : "Check now"}</TextButton>
            <span className="rd-fine">Otherwise the result comes in on its own within a few minutes.</span></span>}</div>}
        {isOpen && <div id={`${id}-d`} className="rd-open rd-prose fd-opened">
          {f.explanation && <p>{f.explanation}</p>}
          <p className="rd-fine">
            {src && <Link className="rd-go" to={src}>{SOURCE_GO[f.source] ?? `Open ${si.label}`} →</Link>}
            {sig && <span>{sig[0]}</span>}
          </p>
        </div>}
      </li>);
  };

  const groupView = (g: Group, gi: number): ReactNode => {
    const limit = g.kind === "event" ? SHOW_NEWEST : SHOW_OTHERS;
    const expanded = more[g.key] ?? (g.key === targetGroup);
    const shown = expanded ? g.items : g.items.slice(0, limit);
    const hidden = g.items.length - limit;
    const ev = g.eventId ? events[g.eventId] : undefined;
    const meta = <span className="rd-dots"><span>{count(g.items.length, "finding")}</span>{g.kind === "event" && <span>{spanOf(g.items)}</span>}
      {gi === 0 && <span>{ZONE_LABEL} time</span>}</span>;
    const name = g.kind === "event" ? (ev ? eventTitle(ev) : "An event")
      : g.kind === "waiting" ? "Waiting to be investigated" : g.kind === "investigating" ? "Being investigated" : "Not in an event";
    const title = g.kind === "event"
      ? <>{ev && <ToneMark tone={ev.tone} label={`${TONE_WORD[ev.tone]}: `} />}
          {g.eventId ? <Link className="rd-name" to={`/events/${g.eventId}`}>{name}</Link> : name}</>
      : name;
    return (
      <Section key={g.key} className="fd-grp" title={title} meta={meta} action={g.eventId ? <GoLink to={`/events/${g.eventId}`}>Open the event</GoLink> : undefined}>
        {g.kind === "waiting" && <div className="fd-wait"><span>
          <b>{count(g.items.length, "finding")} waiting</b>{status?.connected && nextBatch ? ` · next batch ${nextBatch}` : ""}</span>
          {status?.connected && <InvestigateNow onDone={refresh} />}</div>}
        <ul className="fd-list" aria-label={`Findings: ${name}`}>{shown.map(f => row(f, g))}</ul>
        {hidden > 0 && <div className="fd-more">
          <TextButton aria-expanded={expanded} onClick={() => setMore(m => ({ ...m, [g.key]: !expanded }))}>
            {expanded ? "Show fewer" : `Show ${hidden} more`}</TextButton></div>}
      </Section>);
  };

  return (
    <div className="page rd rd-findings">
      <PageTitle title="Findings"
        actions={<>
          <span className="rd-fine">{loadedAt ? `Updated ${ago(loadedAt.toISOString(), now)}` : ""}</span>
          <TextButton onClick={refresh}><span aria-hidden="true">↻ </span>Refresh</TextButton></>}
        lede={lede ? <>{lede}<TextButton aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(h => !h)}>How this works</TextButton></> : undefined}
        help={<>
          {items && items.length > 0 && <p className="rd-fine fd-sources">{sources.join(" · ")}</p>}
          <div id={helpId} className="rd-open rd-prose rd-help" hidden={!help}>
            <p>A finding is something a monitor, a market series or Radar noticed. Each one goes to the investigation, which
              links it to an event or finds no impact on your products. Findings from tests aren't shown.</p></div></>} />
      {err != null && (items === null ? <LoadError error={err} onRetry={refresh} what="the findings" />
        : <QuietWarn>Couldn't refresh: {isDown(err) ? "Amiri Agent didn't answer" : errText(err)}. Showing what was loaded.</QuietWarn>)}

      {(items !== null || err == null) && <TextTabs label="Which findings" items={tabs} value={show} onChange={setShow} />}

      {items === null || !eventsReady ? (err == null && <div className="mt12"><ListSkeleton rows={3} /></div>)
        : !groups.length ? <div className="rd-empty">
          <p className="rd-lede">{show === "all" ? "When a monitor, a market series or Radar notices something, it appears here." : "None in this group. Choose another above."}</p>
          {show === "all" && <Link className="btn btn--primary" to="/monitors">See your monitors</Link>}</div>
        : <div className="fd-groups">{groups.map(groupView)}</div>}
    </div>
  );
}
