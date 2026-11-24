// Radar's story rows: a sent story with its progress line, a compact row (held back, or in the full list),
// and the opened story. No cards: rows, rules and words.
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { radarApi, type RadarStory } from "../../api/radar";
import { Chain, ClampedText, TextButton, type Step } from "../../components/rd";
import { useNow, useToast } from "../../components/ui";
import { ago, day, dayTime, person, placeName, placeOrder } from "../../format";
import { investigationFailed, setAsideReason } from "../../plain";
import { themeText } from "../events/Events";
import { REL_WORD } from "./words";

/** What Radar knows about where its stories went, beyond the story itself. */
export interface Where {
  names: Record<string, string | null>;
  admin: boolean;
  reasons: Record<string, string | null>;      // finding_id → why it was set aside (set-aside findings only)
  linkedRun: Record<string, string | null>;    // finding_id → the investigation run it went through (null: joined by rule)
  alerts: Record<string, number | null>;       // event_id → teams alerted (null: couldn't be read)
  titles: Record<string, string>;              // event_id → the event's display title (eventTitle)
}

const Chev = () => (
  <svg className="rs-chev" viewBox="0 0 20 20" aria-hidden="true"><path d="M7 4l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>);

const placeList = (s: RadarStory, names: Where["names"], cap = 3) => {
  const all = placeOrder(s.places).map(p => names[p] ?? placeName(p));
  return all.length > cap ? `${all.slice(0, cap).join(", ")} and ${all.length - cap} more` : all.join(", ");
};
const publishers = (n: number) => `${n} publisher${n === 1 ? "" : "s"}`;

/** A story sent in an earlier run and seen again in the latest one. */
export const seenAgain = (s: RadarStory, runStart: string | undefined) => s.status === "sent" && !!runStart && s.first_seen_at < runStart;

/** Sent → Investigated → In an event → Alert, truthfully per story: only the steps it went through. */
export function sentSteps(s: RadarStory, w: Where): Step[] {
  const sent: Step = { label: "Sent" };
  const reason = s.finding_id ? w.reasons[s.finding_id] : undefined;
  if (s.event_id) {
    const run = s.finding_id ? w.linkedRun[s.finding_id] : undefined;  // undefined: not among the findings loaded
    const steps: Step[] = [sent];
    if (run) steps.push({ label: "Investigated" });
    steps.push({ label: run === null ? "Joined an event" : "In an event" });
    const n = w.alerts[s.event_id];
    if (n === undefined) steps.push({ label: "Alert", state: "next" });
    else if (n === null) { /* the alerts couldn't be read: say nothing rather than guess */ }
    else steps.push(n > 0 ? { label: `${n} ${n === 1 ? "team" : "teams"} alerted` } : { label: "No team alerted", state: "next" });
    return steps;
  }
  if (s.finding_status === "grouped") return [sent, { label: "Being investigated", state: "next" }];
  if (investigationFailed(s.finding_status, reason)) return [sent, { label: "Couldn't be investigated", state: "fail" }];
  if (s.finding_status === "set_aside") return reason ? [sent, { label: "Investigated" }, { label: "No impact found", state: "none" }] : [sent, { label: "Not in an event", state: "none" }];
  return [sent, { label: "Waiting to be investigated", state: "next" }];
}

/** Where a sent story stands, as one short line. */
function sentLine(s: RadarStory, w: Where, again: boolean): ReactNode {
  const reason = s.finding_id ? w.reasons[s.finding_id] : undefined;
  let where: ReactNode;
  if (s.event_id) where = <>in <Link className="rd-name" to={`/events/${s.event_id}`} title={w.titles[s.event_id] ?? s.event_title ?? undefined}>{w.titles[s.event_id] ?? s.event_title ?? "the event"} →</Link></>;
  else if (s.finding_status === "grouped") where = "Being investigated";
  else if (investigationFailed(s.finding_status, reason)) where = "Radar sent it, but the investigation couldn't run on it";
  else if (s.finding_status === "set_aside") where = reason ? `No impact found: ${setAsideReason(reason)}` : "Not in an event";
  else where = "Waiting to be investigated";
  const extra = [again ? `sent ${day(s.first_seen_at)}, seen again this run` : "", s.sent_by && s.sent_by !== "agent" ? `sent by ${person(s.sent_by)}` : ""].filter(Boolean).join(" · ");
  return <>{where}{extra && <span className="rd-fine"> · {extra}</span>}</>;
}

function useAct(onChange: (s: RadarStory) => void) {
  const toast = useToast();
  return async (f: () => Promise<RadarStory>, msg: string) => {
    try { onChange(await f()); toast(msg); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
}

/** The opened story: why it matters, the summary, two headlines, one line of small print, the admin extras. */
function Opened({ s, w, id, extra }: { s: RadarStory; w: Where; id: string; extra?: string[] }) {
  const [all, setAll] = useState(false);
  const heads = all ? s.headlines : s.headlines.slice(0, 2);
  const more = s.headlines.length - 2;
  const reason = s.finding_id ? w.reasons[s.finding_id] : undefined;
  const fine = [publishers(s.publishers), placeList(s, w.names, 4), s.themes.map(themeText).join(", "), ...(extra ?? [])].filter(Boolean).join(" · ");
  return (
    <div className="rd-open rs-opened" id={id}>
      <p className="rs-why"><b>Why it matters to you:</b> {s.why}</p>
      <ClampedText text={s.summary} className="rd-prose rs-sum" />
      <ul className="rs-heads">{heads.map((h, i) => (
        <li key={i}>{h.url ? <a className="rd-name" href={h.url} target="_blank" rel="noreferrer">{h.title}</a> : <span>{h.title}</span>}
          <span className="rd-fine">{[h.outlet, dayTime(h.published_at)].filter(Boolean).join(" · ")}</span></li>))}
      </ul>
      {more > 0 && <p style={{ margin: "8px 0 0" }}><TextButton onClick={() => setAll(o => !o)}>{all ? "Fewer headlines" : `${more} more headline${more === 1 ? "" : "s"}`}</TextButton></p>}
      <p className="rd-fine" style={{ margin: "10px 0 0" }}>{fine}
        {s.monitor_hint && <> · Your monitor <Link className="rd-go" to={`/monitors/${s.monitor_hint.monitor_id}`}>{s.monitor_hint.name}</Link> covers these places.</>}</p>
      {w.admin && <p className="rd-fine" style={{ margin: "4px 0 0" }}>Radar's score {s.score} of 100 (footprint match × corroboration × freshness × relevance)
        {s.finding_status === "set_aside" && s.event_id == null && reason ? ` · set aside: ${reason.replace(/_/g, " ")}` : ""}.</p>}
    </div>
  );
}

function TitleButton({ s, open, setOpen, panel }: { s: RadarStory; open: boolean; setOpen: (o: boolean) => void; panel: string }) {
  return (
    <button type="button" className="rs-title" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(!open)}>
      <Chev /><span className="rd-clamp1" title={s.title}>{s.title}</span></button>);
}

/** A story sent to you: the title, one line on where it went, and a small progress line on the right. */
export function SentRow({ s, w, runStart }: { s: RadarStory; w: Where; runStart: string | undefined }) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const steps = sentSteps(s, w).slice(1);  // "Sent" is the section's name: it isn't said again on every row
  return (
    <li className="rd-row rs-row">
      <div className="rs-main">
        <TitleButton s={s} open={open} setOpen={setOpen} panel={panel} />
        <div className="rd-row-d rs-line rd-clamp1">{sentLine(s, w, seenAgain(s, runStart))}</div>
      </div>
      <div className="rs-chain" style={{ width: `min(100%, ${steps.length * 128}px)` }}>
        <Chain size="sm" steps={steps} label={`Where "${s.title}" went`} /></div>
      {open && <div className="rs-panel"><Opened s={s} w={w} id={panel} /></div>}
    </li>
  );
}

/** One line per story: held back this run, or any story in the full list. Actions are text. */
export function CompactRow({ s, w, onChange, listing }: { s: RadarStory; w: Where; onChange: (s: RadarStory) => void; listing?: boolean }) {
  const now = useNow(60_000);
  const act = useAct(onChange);
  const [open, setOpen] = useState(false);
  const panel = useId();
  const status: ReactNode = !listing ? null
    : s.status === "sent" ? sentLine(s, w, false)
    : s.status === "dismissed" ? `Dismissed by ${person(s.dismissed_by)}${s.dismissed_at ? ` ${ago(s.dismissed_at, now)}` : ""}`
    : "Held back";
  // three things at most; the rest is in the opened story's small print
  const meta = [listing ? day(s.last_seen_at) : "", publishers(s.publishers), placeList(s, w.names), listing ? "" : REL_WORD[s.relevance]].filter(Boolean).join(" · ");
  const more = [listing ? REL_WORD[s.relevance] : "", s.runs_seen > 1 ? `seen in ${s.runs_seen} runs` : "", s.development_of ? "continues an earlier story" : ""].filter(Boolean);
  return (
    <li className="rd-row rs-row rs-compact">
      <div className="rs-main">
        <TitleButton s={s} open={open} setOpen={setOpen} panel={panel} />
        {status && <div className="rd-row-d rs-line rd-clamp1">{status}</div>}
        <div className="rd-row-m rs-meta rd-clamp1" title={meta}>{meta}</div>
      </div>
      <div className="rs-acts">
        {s.status === "below" && <><TextButton onClick={() => act(() => radarApi.investigate(s.story_id), "Sent for investigation")}>Investigate anyway</TextButton>
          <TextButton onClick={() => act(() => radarApi.dismiss(s.story_id), "Dismissed")}>Dismiss</TextButton></>}
        {s.status === "dismissed" && <TextButton onClick={() => act(() => radarApi.restore(s.story_id), "Restored")}>Restore</TextButton>}
      </div>
      {open && <div className="rs-panel"><Opened s={s} w={w} id={panel} extra={more} /></div>}
    </li>
  );
}
