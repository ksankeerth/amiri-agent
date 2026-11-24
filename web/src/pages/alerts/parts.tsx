// The Alerts page's parts (board 01; states: board 16 section D): the list, the reading pane (what Amiri Agent expects, what
// your data says, the evidence and the history) and the note that goes with an acknowledgement. The page's state and
// calls are in ../Alerts.tsx; the words and rules are in ./words.ts.
import { useId, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { AlertItem } from "../../api/alerts";
import type { EventDetail } from "../../api/investigation";
import { usePlaceNames } from "../../components/blocks";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { Pill } from "../../components/v2/Pill";
import { ChecksOff, Verdict } from "../../components/v2/Verdict";
import { ago, dayTime, person, placeOrder, plural } from "../../format";
import { alertChangeText, cap, eventTitle, sourceInfo, listText, ACTION_MEANS } from "../../plain";
import { arrowFor, expectedParts, nextCheckText, type TaskLike } from "../events/eventWords";
import { today } from "../events/words";
import { placesText } from "../overview/words";
import { useArticleUrl } from "./article";
import {
  checkedCount, effectSays, emptyCopy, evidenceTitle, historySummary, levelPill, listMeta, progressWords, statusWord, whoLine,
  type LevelKey, type Tab,
} from "./words";

/** when Amiri Agent last raised or escalated it: a person acknowledging it doesn't move it on the page */
export const changedAt = (a: AlertItem): string =>
  [...a.history].reverse().find(h => h.by === "Amiri Agent" && h.change !== "resolved")?.at ?? a.created_at;

// ---------------------------------------------------------------- the list
export interface AlertListProps {
  rows: AlertItem[];
  selectedId: string | null;
  now: Date;
  hrefFor: (id: string) => string;
  onOpen: (id: string) => void;
  /** The event's name as the rest of the app shows it ("Oil prices up", not the stored "Oil rose"). */
  titleOf?: (a: AlertItem) => string;
}
export function AlertList({ rows, selectedId, now, hrefFor, onOpen, titleOf = a => a.event_title }: AlertListProps) {
  return (
    <ul className="v2-al-list">
      {rows.map(a => {
        const on = a.alert_id === selectedId, lv = levelPill(a.level);
        const who = whoLine(a, iso => ago(iso, now));
        const when = ago(changedAt(a), now);
        return (
          <li key={a.alert_id}>
            <Link id={`al-row-${a.alert_id}`} to={hrefFor(a.alert_id)} className={`v2-al-row${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}
              onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); onOpen(a.alert_id); }}>
              <span className="v2-al-row__top">
                <Pill tone={lv.tone}>{lv.label}</Pill>
                <span className="v2-al-row__team">{a.owner}</span>
                <span className="v2-al-row__gap" />
                <span className="v2-al-row__right">
                  {a.status === "new" && <><span className="v2-al-row__dot" aria-hidden="true" /><span className="v2-sr">New. </span></>}
                  <span className="v2-al-row__when" title={`Last changed ${dayTime(changedAt(a))}`}><span className="v2-sr">Updated </span>{when}</span>
                </span>
              </span>
              <span className="v2-al-row__t">{a.title}</span>
              <span className="v2-al-row__m">{listMeta(titleOf(a), a.effects.length)}</span>
              {who && <span className="v2-al-row__who">{who}{a.status === "acknowledged" && a.ack_note ? `: “${a.ack_note}”` : a.status === "resolved" && a.resolved_note ? `: “${a.resolved_note}”` : ""}</span>}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** What the three levels mean: the old "How this works", kept under the list. */
export function LevelsHelp() {
  return (
    <details className="v2-al-help">
      <summary>What the levels mean</summary>
      <ul>
        {(["warning", "developing", "adverse"] as LevelKey[]).map(l => {
          const p = levelPill(l);
          return <li key={l}><Pill tone={p.tone}>{p.label}</Pill><span>{LEVEL_MEANING[l]}</span></li>;
        })}
      </ul>
      <p>The most serious alerts are at the top. Someone on the owning team acknowledges an alert so everyone knows it is taken on.</p>
    </details>
  );
}
const LEVEL_MEANING: Record<LevelKey, string> = {
  warning: "Amiri Agent expects an impact; your data can't tell yet.",
  developing: "Your figures are starting to move the bad way.",
  adverse: "Your own figures show the impact.",
};

/** Many alerts: filter by team first (board 16 section D). Each alert is acknowledged on its own, with its own note. */
export function ManyStrip({ total, tab, teams, onTeam }: { total: number; tab: Tab; teams: { owner: string; n: number }[]; onTeam: (t: string) => void }) {
  const word = tab === "new" ? "new alerts" : tab === "acknowledged" ? "acknowledged alerts" : "resolved alerts";
  return (
    <div className="v2-al-many">
      <p><b className="v2-num">{total}</b> <b>{word}</b> · filter by team first:{" "}
        {teams.map(t => <button key={t.owner} type="button" className="v2-al-teamchip" onClick={() => onTeam(t.owner)}>{t.owner} <span className="v2-num">{t.n}</span></button>)}</p>
      <p className="v2-meta">No select-all: each alert is acknowledged on its own, with its own note.</p>
    </div>
  );
}

export function EmptyList({ tab, team, level, onClear }: { tab: Tab; team: string; level: "" | LevelKey; onClear: (what: "team" | "level" | "both") => void }) {
  const c = emptyCopy(tab, team, level);
  return (
    <Empty title={c.title} className="v2-al-empty"
      action={c.clear ? <Button onClick={() => onClear(c.clear!)}>{c.clear === "team" ? "Show all teams" : c.clear === "level" ? "Show every level" : "Clear the filters"}</Button>
        : tab === "new" ? <Button as="link" to="/events">See events</Button> : undefined}>
      {c.text}
    </Empty>
  );
}

/** The page's shape while it loads: the list's rows and the reading pane. */
export function AlertsSkeleton({ phone }: { phone: boolean }) {
  return (
    <div className="v2-al-body" role="status" aria-busy="true">
      <span className="v2-sr">Loading the alerts</span>
      <div className="v2-al-col" aria-hidden="true">
        {[0, 1, 2].map(i => (
          <div key={i} className="v2-al-sk-row">
            <span className="v2-al-sk" style={{ width: 96, height: 20, borderRadius: 999 }} />
            <span className="v2-al-sk" style={{ width: `${92 - i * 9}%`, height: 16 }} />
            <span className="v2-al-sk" style={{ width: `${66 - i * 8}%`, height: 16 }} />
            <span className="v2-al-sk" style={{ width: "46%", height: 12 }} />
          </div>
        ))}
      </div>
      {!phone && (
        <div className="v2-panel v2-al-art v2-al-art--sk" aria-hidden="true">
          <span className="v2-al-sk" style={{ width: 220, height: 22 }} />
          <span className="v2-al-sk" style={{ width: "86%", height: 28 }} />
          <span className="v2-al-sk" style={{ width: "58%", height: 28 }} />
          <span className="v2-al-sk" style={{ width: "100%", height: 46, borderRadius: 12 }} />
          {[0, 1].map(i => <span key={i} className="v2-al-sk" style={{ width: "100%", height: 48 }} />)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the reading pane
export interface ArticleProps {
  a: AlertItem;
  ev: EventDetail | null;
  now: Date;
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  onAct: (action: "ack" | "resolve" | "reopen") => void;
  titleOf?: (a: AlertItem) => string;
}
export function Article({ a, ev, now, busy, note, onNote, onAct, titleOf = a => a.event_title }: ArticleProps) {
  const lv = levelPill(a.level);
  const name = usePlaceNames(a.places);
  const places = placesText(placeOrder(a.places).map(name), 2);
  const t0 = today(now);
  const tasks = new Map((ev?.tasks ?? []).map(t => [t.hypothesis_id, t as TaskLike]));
  const validation = ev ? ev.run.validation : null;
  const done = checkedCount(a.effects);
  const hs = new Set(a.effects.map(e => e.hypothesis_id));
  const nextDue = (ev?.tasks ?? []).filter(t => hs.has(t.hypothesis_id) && !t.check?.final).map(t => t.next_check_after ?? t.check?.next_check_after).filter((x): x is string => !!x).sort()[0];
  const progress = progressWords(done, a.effects.length, nextCheckText(nextDue, t0), validation === false);
  const who = whoLine(a, iso => ago(iso, now));
  const personNote = a.status === "acknowledged" ? a.ack_note : a.status === "resolved" ? a.resolved_note : null;
  const eventWord = a.event_status ? `${cap(a.event_status)} event` : null;

  return (
    <article className="v2-panel v2-al-art" aria-labelledby="alert-title">
      <div className="v2-al-art__top">
        <Pill tone={lv.tone}>{lv.label}</Pill>
        <Pill>{statusWord(a.status)}</Pill>
        <span className="v2-al-art__raised">Raised {ago(a.created_at, now)} · for <b>{a.owner}</b></span>
        <div className="v2-al-art__acts">
          {a.status !== "new" && <Button variant={a.status === "resolved" ? "primary" : "secondary"} disabled={busy} title={ACTION_MEANS.reopen} onClick={() => onAct("reopen")}>Reopen</Button>}
          {a.status === "new" && <Button disabled={busy} title={ACTION_MEANS.resolve} onClick={() => onAct("resolve")}>Resolve</Button>}
          {a.status === "acknowledged" && <Button variant="primary" disabled={busy} title={ACTION_MEANS.resolve} onClick={() => onAct("resolve")}>Resolve</Button>}
          {a.status === "new" && <Button variant="primary" disabled={busy} title={ACTION_MEANS.ack} onClick={() => onAct("ack")}>Acknowledge</Button>}
        </div>
      </div>

      <h2 id="alert-title" tabIndex={-1} className="v2-al-art__h">{a.title}</h2>

      <p className="v2-al-art__from">
        From <Link to={`/events/${a.event_id}`}>{ev ? eventTitle(ev) : titleOf(a)}</Link>
        {eventWord && <Pill>{eventWord}</Pill>}
        {places && <span>in {places}</span>}
      </p>

      {who && (
        <p className="v2-al-art__who" role="status">
          <b>{who}</b>{personNote ? <>: “{personNote}”</> : ""}
        </p>
      )}

      {progress && (
        <div className="v2-al-progress">
          <ProgressBar done={done} total={a.effects.length} />
          <span><b>{progress.strong}</b>{progress.rest && <> <span className="v2-al-progress__rest">{progress.rest}</span></>}</span>
        </div>
      )}

      <Effects a={a} tasks={tasks} t0={t0} validation={validation} />

      <Evidence a={a} ev={ev} />
      <History a={a} />

      {a.via_monitor && <p className="v2-meta v2-al-art__via">Sent to you because your team owns <Link to={`/monitors/${a.via_monitor}`}>the monitor</Link> that found it.</p>}

      {a.status !== "resolved" && <NoteBox a={a} busy={busy} note={note} onNote={onNote} onAct={onAct} />}
    </article>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  if (total <= 8) {
    return <span className="v2-al-progress__segs" aria-hidden="true">{Array.from({ length: total }, (_, i) => <span key={i} className={i < done ? "is-on" : ""} />)}</span>;
  }
  return <span className="v2-al-progress__bar" aria-hidden="true" style={{ "--fill": `${Math.round((done / total) * 100)}%` } as CSSProperties} />;
}

// What Amiri Agent expects, product by product, against what your data says.
function Effects({ a, tasks, t0, validation }: { a: AlertItem; tasks: Map<string, TaskLike>; t0: string; validation: boolean | null }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="v2-al-fx">
      <h3 id={id} className="v2-sr">What Amiri Agent expects at your products, and what your data says</h3>
      <p className="v2-meta v2-al-fx__ai">Amiri Agent's assessment (AI). Sizes and timing are estimates, checked against your own figures as they're published.</p>
      <div role="table" aria-labelledby={id} className="v2-al-fxtable">
        <div role="row" className="v2-al-fxrow v2-al-fxrow--head">
          <span role="columnheader" className="v2-cap">Product</span>
          <span role="columnheader" className="v2-cap">Expected</span>
          <span role="columnheader" className="v2-cap">Your data says</span>
        </div>
        <div role="rowgroup">
          {a.effects.map(e => {
            const arrow = arrowFor(e.direction, e.adverse);
            const x = expectedParts(e.size, e.timing);
            const says = effectSays(e, tasks.get(e.hypothesis_id), t0, validation);
            const move = e.direction === "rise" ? "rise" : e.direction === "fall" ? "fall" : "move";
            return (
              <div key={e.hypothesis_id} role="row" className="v2-al-fxrow">
                <span role="cell" className="v2-al-fxcell" data-label="Product">
                  <b className="v2-al-fx__name">{e.product}</b>
                  <span className="v2-al-fx__how">{e.chain_label}</span>
                </span>
                <span role="cell" className="v2-al-fxcell" data-label="Expected">
                  <span className="v2-al-fx__metric">{e.metric_name}</span>
                  <span className="v2-al-fx__size v2-num">
                    <b className={`v2-al-fx__arrow is-${arrow.tone}`}><span aria-hidden="true">{arrow.glyph} </span>{x.size ? cap(x.size) : "Expected"} {move}</b>
                    {x.when ? ` ${x.when}` : ""}<span className="v2-sr">{e.adverse ? "; bad for you" : ""}</span>
                  </span>
                </span>
                <span role="cell" className="v2-al-fxcell" data-label="Your data says">
                  {says.off ? <ChecksOff />
                    : says.verdict ? <Verdict verdict={says.verdict.key} text={says.verdict.text} />
                    : <Pill>{says.word ?? "Not checked yet"}</Pill>}
                  {says.line && <span className="v2-al-fx__line">{says.line}</span>}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function Evidence({ a, ev }: { a: AlertItem; ev: EventDetail | null }) {
  const [open, setOpen] = useState(false);
  const strongest = a.top_finding;
  const inEvent = ev && strongest
    ? ev.findings.filter(f => f.title === strongest).flatMap(f => f.evidence?.headlines ?? []).find(h => h.url)?.url ?? null : null;
  const url = useArticleUrl(strongest, a.sources, open, inEvent);
  const labels = (a.sources ?? []).map(s => sourceInfo(s).label);
  if (!strongest && !a.finding_ids.length) return null;
  return (
    <details className="v2-al-det" onToggle={e => setOpen(e.currentTarget.open)}>
      <summary>{evidenceTitle(a.finding_ids.length)}</summary>
      <div className="v2-al-det__body">
        {a.finding_ids.length > 0 && <>{plural(a.finding_ids.length, "finding")}{labels.length ? ` from ${listText(labels)}` : ""}. </>}
        {strongest && <>Strongest: {url
          ? <a href={url} target="_blank" rel="noreferrer">{strongest}<span aria-hidden="true"> ↗</span><span className="v2-sr"> (opens the article)</span></a>
          : strongest}</>}
      </div>
    </details>
  );
}

const SHORT_HISTORY = 6;
function History({ a }: { a: AlertItem }) {
  const [all, setAll] = useState(false);
  const id = useId();
  const n = a.history.length;
  const lastChecked = a.effects.map(e => e.check?.as_of).filter((x): x is string => !!x).sort().pop()
    ?? [...a.history].reverse().find(h => h.change === "checked")?.at ?? null;
  const list = (
    <ol className="v2-al-hist" id={id} tabIndex={n > 12 ? 0 : undefined} aria-label={`All ${n} history entries, newest first`}>
      {[...a.history].reverse().map((h, i) => (
        <li key={i}><span className="v2-al-hist__at">{dayTime(h.at)}</span><span>{alertChangeText(h)}{h.by && h.by !== "Amiri Agent" ? ` · ${person(h.by)}` : ""}</span></li>
      ))}
    </ol>
  );
  return (
    <details className="v2-al-det">
      <summary>History · {n}</summary>
      <div className="v2-al-det__body">
        {n <= SHORT_HISTORY ? list : <>
          <p>{historySummary(a.history, a.created_at, lastChecked)}.</p>
          <button type="button" className="v2-al-link" aria-expanded={all} aria-controls={id} onClick={() => setAll(v => !v)}>{all ? "Hide the list" : `Show all ${n}`}</button>
          {all && list}
        </>}
      </div>
    </details>
  );
}

// The note goes with the action: the API takes it on acknowledge and on resolve (there is no separate "save note").
function NoteBox({ a, busy, note, onNote, onAct }: { a: AlertItem; busy: boolean; note: string; onNote: (v: string) => void; onAct: ArticleProps["onAct"] }) {
  const id = useId(), hint = `${id}-h`;
  const next = a.status === "new" ? "ack" : "resolve";
  const submit = (e: FormEvent) => { e.preventDefault(); if (!busy) onAct(next); };
  return (
    <form className="v2-al-note" onSubmit={submit}>
      <label htmlFor={id} className="v2-sr">Note for your team (optional)</label>
      <input id={id} className="v2-al-input" value={note} onChange={e => onNote(e.target.value)} aria-describedby={hint}
        placeholder={a.status === "new" ? "Add a note for the record (optional)" : "Why it's resolved (optional)"} />
      <span id={hint} className="v2-meta v2-al-note__hint">
        {a.status === "new" ? "Added when you acknowledge or resolve. Press Enter to acknowledge." : "Added when you resolve. Press Enter to resolve."}
      </span>
    </form>
  );
}
