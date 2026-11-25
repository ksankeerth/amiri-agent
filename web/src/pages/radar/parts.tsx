// Radar's parts (board 05; states: board 16 section F): the funnel, the list of stories, the reading pane, the read in
// progress, the loading shape and the folded details at the foot. The page's state and calls are in ./Radar.tsx; the words
// and rules are in ./storyWords.ts.
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { RadarRun, RadarStatus, RadarStory } from "../../api/radar";
import { gb } from "../../api/radar";
import { Button } from "../../components/v2/Button";
import { Cell, Row, Table } from "../../components/v2/Table";
import { Pill } from "../../components/v2/Pill";
import { dayTime, person, placeName, placeOrder, plural, when } from "../../format";
import { themeText } from "../events/investigate";
import { clock, dayWord, plainCount, zoneName } from "./words";
import {
  followUpOf, placeList, publishers, RELEVANCE, seenIn, whereWent, type FunnelStat, type Where, type Went,
} from "./storyWords";

export type Names = Record<string, string | null>;
const placeNames = (s: RadarStory, names: Names) => placeOrder(s.places).map(p => names[p] ?? placeName(p));

// ---------------------------------------------------------------- the funnel
/** What the latest finished read did: four numbers, and a bar that steps down from all the articles to the few sent (decoration). */
export function Funnel({ stats, run, now }: { stats: FunnelStat[]; run: RadarRun; now: Date }) {
  return (
    <section className="v2-rd-funnel" aria-label="What the latest read did">
      <div className="v2-rd-bar" aria-hidden="true"><span /><span /><span /><span /></div>
      <ul className="v2-rd-stats">
        {stats.map(s => (
          <li key={s.label} className={`v2-rd-stat${s.big ? " is-big" : ""}`}>
            <span className="v2-num v2-rd-stat__n">{plainCount(s.n)}</span>{" "}
            <span className="v2-rd-stat__l">{s.label}</span>
          </li>
        ))}
      </ul>
      <p className="v2-meta v2-rd-funnel__fine">
        Read {dayWord(run.created_at, now)}{run.finished_at ? ` to ${clock(run.finished_at)}` : ""} · {run.trigger === "now" ? "started by Check now" : "on schedule"}
        {run.status === "stopped_early" ? " · stopped early" : ""}
      </p>
    </section>
  );
}

/** A read is going (board 16 F): three dots, the words, when it started and how long it usually takes. */
export function ReadingNow({ since }: { since: string | null }) {
  return (
    <div className="v2-rd-now" role="status">
      <span className="v2-dots" aria-hidden="true"><span /><span /><span /></span>
      <b>Reading the news…</b>
      <span className="v2-rd-now__m">{since ? `started ${clock(since)} · ` : ""}usually 2–4 min</span>
    </div>
  );
}

/** The sent stories are on their way to the investigation (after a read, or Investigate anyway). */
export function Investigating({ n }: { n: number }) {
  return (
    <div className="v2-rd-now" role="status">
      <span className="v2-dots" aria-hidden="true"><span /><span /><span /></span>
      <b>Working on it…</b>
      <span className="v2-rd-now__m">{n === 1 ? "The investigation is looking at the story." : `The investigation is looking at ${n} stories.`} Results appear here.</span>
    </div>
  );
}

// ---------------------------------------------------------------- the list
const REL_TITLE: Record<RadarStory["relevance"], string> = { high: "high", medium: "medium", low: "low" };

export interface StoryListProps {
  rows: RadarStory[];
  all: RadarStory[];
  selectedId: string | null;
  names: Names;
  w: Where;
  now: Date;
  hrefFor: (id: string) => string;
  onOpen: (id: string) => void;
  /** A button after the rows ("5 more held back"). */
  more?: ReactNode;
}
export function StoryList({ rows, all, selectedId, names, w, now, hrefFor, onOpen, more }: StoryListProps) {
  return (
    <>
      <ul className="v2-rd-list">
        {rows.map(s => {
          const on = s.story_id === selectedId, rel = RELEVANCE[s.relevance], went = whereWent(s, w), follow = followUpOf(s, all);
          const status = s.status === "sent" ? { tone: "good" as const, label: "Sent", dashed: false } : s.status === "below" ? { tone: "neutral" as const, label: "Held back", dashed: false } : { tone: "neutral" as const, label: "Dismissed", dashed: true };
          const line = [placeList(placeNames(s, names)), publishers(s.publishers)].filter(Boolean).join(" · ");
          return (
            <li key={s.story_id}>
              <Link id={`rd-row-${s.story_id}`} to={hrefFor(s.story_id)} className={`v2-rd-row${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}
                onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); onOpen(s.story_id); }}>
                <span className={`v2-rd-dot is-${s.relevance}`} aria-hidden="true" title={`${REL_TITLE[s.relevance]} relevance`} />
                <span className="v2-rd-row__body">
                  <span className="v2-rd-row__t"><span className="v2-sr">{rel.word}. </span>{s.title}</span>
                  <span className="v2-rd-row__m">
                    {line}
                    {went.text && <> · <b className={`v2-rd-row__went is-${went.kind}`}>{went.text}</b></>}
                  </span>
                  {follow && <span className="v2-rd-row__m">{follow}</span>}
                  {s.status === "dismissed" && <span className="v2-rd-row__m">Dismissed by {person(s.dismissed_by) || "someone"}{s.dismissed_at ? `, ${dayWord(s.dismissed_at, now)}` : ""}</span>}
                </span>
                <span className="v2-rd-row__pill"><Pill tone={status.tone} dashed={status.dashed}>{status.label}</Pill></span>
              </Link>
            </li>
          );
        })}
      </ul>
      {more}
    </>
  );
}

// ---------------------------------------------------------------- the reading pane
export interface StoryProps {
  s: RadarStory;
  all: RadarStory[];
  names: Names;
  w: Where;
  now: Date;
  admin: boolean;
  busy: boolean;
  onInvestigate: () => void;
  onDismiss: () => void;
  onRestore: () => void;
}
export function Story({ s, all, names, w, now, admin, busy, onInvestigate, onDismiss, onRestore }: StoryProps) {
  const [allHeads, setAllHeads] = useState(false);
  const went = whereWent(s, w), follow = followUpOf(s, all), rel = RELEVANCE[s.relevance];
  const heads = allHeads ? s.headlines : s.headlines.slice(0, 2);
  const more = s.headlines.length - 2;
  const places = placeNames(s, names);
  const reason = s.finding_id ? w.reasons[s.finding_id] : undefined;
  const state = s.status === "sent" ? { tone: "good" as const, label: "Sent to investigate" } : s.status === "below" ? { tone: "neutral" as const, label: "Held back" } : { tone: "neutral" as const, label: "Dismissed" };
  const by = s.sent_by && s.sent_by !== "agent" ? `sent by ${person(s.sent_by)}` : "";
  const themes = s.themes.map(themeText).join(", ");
  return (
    <article className="v2-panel v2-rd-art" aria-labelledby="rd-story-title">
      <div className="v2-rd-art__top">
        <Pill tone={state.tone} dashed={s.status === "dismissed"}>{state.label}</Pill>
        <Pill tone={rel.pill}>{rel.word}</Pill>
        <span className="v2-rd-art__when">{dayWord(s.last_seen_at, now).replace(/^./, c => c.toUpperCase())}{seenIn(s.runs_seen) ? ` · ${seenIn(s.runs_seen)}` : ""}</span>
      </div>
      <h2 id="rd-story-title" tabIndex={-1} className="v2-rd-art__h">{s.title}</h2>

      <WentLine went={went} places={places} follow={follow} />

      <div className="v2-rd-why">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" aria-hidden="true" focusable="false"><path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>
        <div><b>Why it matters to you.</b> {s.why}</div>
      </div>

      <p className="v2-rd-sum">{s.summary}</p>

      {s.headlines.length > 0 && (
        <section aria-labelledby="rd-heads">
          <h3 id="rd-heads" className="v2-cap v2-rd-cap">Headlines · {publishers(s.publishers)}</h3>
          <ul className="v2-rd-heads">
            {heads.map((h, i) => (
              <li key={i}>
                <span className="v2-rd-heads__o">{h.outlet ?? ""}</span>
                {h.url
                  ? <a className="v2-rd-heads__t" href={h.url} target="_blank" rel="noreferrer">{h.title}<span aria-hidden="true"> ↗</span><span className="v2-sr"> (opens in a new tab)</span></a>
                  : <span className="v2-rd-heads__t">{h.title}</span>}
                <span className="v2-rd-heads__w">{when(h.published_at, now)}</span>
              </li>
            ))}
            {more > 0 && (
              <li className="v2-rd-heads__more">
                <button type="button" className="v2-rd-link" aria-expanded={allHeads} onClick={() => setAllHeads(o => !o)}>
                  {allHeads ? "Fewer headlines" : `${more} more headline${more === 1 ? "" : "s"}`}<span aria-hidden="true"> {allHeads ? "▾" : "▸"}</span></button>
              </li>
            )}
          </ul>
        </section>
      )}

      {(themes || by || admin) && (
        <p className="v2-meta v2-rd-fine">
          {[themes && `Themes: ${themes}`, by].filter(Boolean).join(" · ")}
          {admin && <>{themes || by ? " · " : ""}Radar's score {s.score} of 100{s.finding_status === "set_aside" && !s.event_id && reason ? ` · set aside: ${reason.replace(/_/g, " ")}` : ""}</>}
        </p>
      )}

      <div className="v2-rd-acts">
        {s.status === "sent" && went.eventId && <Button as="link" variant="primary" to={`/events/${went.eventId}`}>Open the event →</Button>}
        {s.status === "sent" && !went.eventId && s.finding_id && <Button as="link" to={`/findings#f-${s.finding_id}`}>See the finding →</Button>}
        {s.status === "below" && <>
          <Button variant="primary" onClick={onInvestigate} disabled={busy}>{busy ? "Sending…" : "Investigate anyway"}</Button>
          <Button onClick={onDismiss} disabled={busy}>Dismiss</Button>
        </>}
        {s.status === "dismissed" && <Button onClick={onRestore} disabled={busy}>{busy ? "Restoring…" : "Restore"}</Button>}
        <span className="v2-rd-acts__gap" />
        {s.monitor_hint && <Link className="v2-rd-hint" to={`/monitors/${s.monitor_hint.monitor_id}`}>Also matches the monitor: {s.monitor_hint.name}<span aria-hidden="true"> ▸</span></Link>}
      </div>
      {s.status === "below" && <p className="v2-meta v2-rd-hold">Radar sends only the few its judge picks, best first. You can still send this one, or hide it.</p>}
      {s.status === "dismissed" && s.dismissed_by && <p className="v2-meta v2-rd-hold">Dismissed by {person(s.dismissed_by)}{s.dismissed_at ? ` · ${dayTime(s.dismissed_at)}` : ""}. Restore it to bring it back to held back.</p>}
    </article>
  );
}

/** "Now part of Texas power prices spike · Texas": where the story went, then where it is about. */
function WentLine({ went, places, follow }: { went: Went; places: string[]; follow: string | null }) {
  const bits: ReactNode[] = [];
  if (went.kind === "event" && went.eventId) bits.push(<span key="w">Now part of <Link to={`/events/${went.eventId}`}>{went.text}</Link></span>);
  else if (went.kind !== "none") bits.push(<span key="w">{went.detail ?? went.text}</span>);
  if (follow) bits.push(<span key="f">{follow}</span>);
  if (places.length) bits.push(<span key="p">{placeList(places, 4)}</span>);
  if (!bits.length) return null;
  return <div className="v2-rd-from">{bits.map((b, i) => <span key={i} className="v2-rd-from__bit">{i > 0 && <span aria-hidden="true"> · </span>}{b}</span>)}</div>;
}

// ---------------------------------------------------------------- loading
export function RadarSkeleton({ phone }: { phone: boolean }) {
  return (
    <div className="v2-rd-sk" role="status" aria-busy="true">
      <span className="v2-sr">Loading Radar</span>
      <div className="v2-rd-sk__stats" aria-hidden="true">
        {[0, 1, 2, 3].map(i => <span key={i} className="v2-rd-skb" style={{ width: 150, height: 44 }} />)}
      </div>
      <div className="v2-rd-body" aria-hidden="true">
        <div className="v2-rd-col">
          {[0, 1, 2].map(i => (
            <div key={i} className="v2-rd-sk__row">
              <span className="v2-rd-skb" style={{ width: 8, height: 8, borderRadius: 4 }} />
              <span className="v2-rd-sk__lines">
                <span className="v2-rd-skb" style={{ width: `${90 - i * 8}%`, height: 16 }} />
                <span className="v2-rd-skb" style={{ width: `${60 - i * 6}%`, height: 12 }} />
              </span>
              <span className="v2-rd-skb" style={{ width: 52, height: 22, borderRadius: 999 }} />
            </div>
          ))}
        </div>
        {!phone && (
          <div className="v2-panel v2-rd-art v2-rd-art--sk">
            <span className="v2-rd-skb" style={{ width: 240, height: 22 }} />
            <span className="v2-rd-skb" style={{ width: "86%", height: 28 }} />
            <span className="v2-rd-skb" style={{ width: "100%", height: 46, borderRadius: 12 }} />
            {[0, 1].map(i => <span key={i} className="v2-rd-skb" style={{ width: "100%", height: 40 }} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- the foot: earlier reads, what it watches, the budget, how it works
function Fold({ title, summary, children }: { title: string; summary?: ReactNode; children: ReactNode }) {
  return (
    <details className="v2-rd-fold">
      <summary><span className="v2-rd-fold__t">{title}</span>{summary != null && <span className="v2-rd-fold__s">{summary}</span>}</summary>
      <div className="v2-rd-fold__b">{children}</div>
    </details>
  );
}

export function EarlierReads({ runs, last }: { runs: RadarRun[] | null; last: RadarRun | null | undefined }) {
  const others = (runs ?? []).filter(r => r.run_id !== last?.run_id);
  const done = others.filter(r => r.considered != null);
  const summary = runs === null ? "…" : others.length === 0 ? "No earlier reads yet"
    : done.length === 0 ? `${others.length} earlier`
    : `${others.length} earlier, each read ${plainCount(Math.min(...done.map(r => r.considered ?? 0)))} to ${plainCount(Math.max(...done.map(r => r.considered ?? 0)))} articles and sent ${Math.min(...others.map(r => r.sent ?? 0))} to ${Math.max(...others.map(r => r.sent ?? 0))}`;
  return (
    <Fold title="Earlier reads" summary={summary}>
      {others.length > 0 && (
        <Table label="Earlier reads" cols="minmax(0,1.6fr) repeat(4, minmax(0,1fr))" colsPhone="minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr)"
          columns={[{ label: "Read" }, { label: "Articles", align: "right" }, { label: "About your places", align: "right", phoneHide: true }, { label: "Stories", align: "right", phoneHide: true }, { label: "Sent", align: "right" }]}>
          {others.map(r => (
            <Row key={r.run_id}>
              <Cell>{dayTime(r.created_at)}{r.status === "failed" ? " · failed" : r.status === "stopped_early" ? " · stopped early" : r.trigger === "now" ? " · Check now" : ""}</Cell>
              <Cell align="right" num>{r.considered == null ? "—" : plainCount(r.considered)}</Cell>
              <Cell align="right" num phoneHide>{r.shortlisted == null ? "—" : plainCount(r.shortlisted)}</Cell>
              <Cell align="right" num phoneHide>{r.stories ?? "—"}</Cell>
              <Cell align="right" num>{r.sent ?? "—"}</Cell>
            </Row>
          ))}
        </Table>
      )}
    </Fold>
  );
}

export interface Scope { places: string[]; why: Record<string, string[]>; themes: string[]; actors: string[] }
export function Watches({ scope, names }: { scope: Scope; names: Names }) {
  const n = scope.places.length;
  return (
    <Fold title="What Radar watches"
      summary={<>{plural(n, "place")}{n > 0 && <>, starting with {scope.places.slice(0, 3).map(p => names[p] ?? placeName(p)).join(", ")}</>}{scope.actors.length > 0 && ` · also ${plural(scope.actors.length, "name")}`}</>}>
      <Table label="Places Radar watches" cols="minmax(0,1fr) minmax(0,2fr)" columns={[{ label: "Place" }, { label: "Why Radar watches it" }]}>
        {scope.places.map(p => (
          <Row key={p}><Cell><b>{names[p] ?? placeName(p)}</b></Cell><Cell className="v2-text-2">{(scope.why[p] ?? []).join("; ") || "Part of where you operate"}</Cell></Row>
        ))}
      </Table>
      {scope.actors.length > 0 && <p className="v2-meta v2-rd-fold__p">Also looks for: {scope.actors.join(", ")}</p>}
      <p className="v2-rd-fold__p"><Link className="v2-arrowlink" to="/institution/agents">What Radar reads from your profile<span aria-hidden="true"> →</span></Link></p>
    </Fold>
  );
}

export function Budget({ status, admin, resets, zone }: { status: RadarStatus; admin: boolean; resets: string; zone: string }) {
  const pct = Math.round((status.bytes_today / Math.max(1, status.bytes_cap)) * 100);
  return (
    <Fold title="Reading budget" summary={admin ? `${gb(status.bytes_today)} of ${gb(status.bytes_cap)} used today` : `${pct}% used today · resets ${resets}`}>
      <p className="v2-rd-fold__p">
        {admin
          ? <>Radar's BigQuery use today: {gb(status.bytes_today)} of {gb(status.bytes_cap)}. It runs at most {plural(status.limits.max_queries, "query", "queries")} a read, {gb(status.limits.max_bytes_per_query)} each.</>
          : <>Radar has used {pct}% of its reading budget today.</>}
        {" "}It starts again {resets} ({zone} time).
      </p>
    </Fold>
  );
}

export function HowItWorks({ name, status, schedule, zone }: { name: string; status: RadarStatus; schedule: string; zone: string }) {
  return (
    <Fold title="How Radar works">
      <p className="v2-rd-fold__p">Radar reads the world's news for anything that touches {name}, using the places and names in your profile. What matters goes to the investigation like any other finding; the rest is kept here, and you can still send it.</p>
      <p className="v2-rd-fold__p v2-text-2">Prototype limits: Radar reads the news {schedule}, and you can Check now {status.run_now.limit} times a day. English news only. Times are {zone} time.</p>
    </Fold>
  );
}

export const zoneOf = (st: RadarStatus | null) => zoneName(st?.time_zone);
