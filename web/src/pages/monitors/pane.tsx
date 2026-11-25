// The open monitor's parts (board 06; states: board 16 section G): the top line, the pending version's panel, the question,
// what it could reach and the examples, the versions, and the recent checks with what each found. The page's state and calls
// are in MonitorPage.tsx; the words and rules are in words.ts.
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CheckRow, Monitor, MonitorFinding, MonitorSpec, MonitorsStatus } from "../../api/monitors";
import { useDemoLock } from "../../components/lock";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { Button } from "../../components/v2/Button";
import { Pill } from "../../components/v2/Pill";
import { WorldMark } from "../../components/v2/WorldMark";
import { ago, dayTime, person, placeName, plainError } from "../../format";
import { setAsideReason } from "../../plain";
import { kindOf } from "../findings/words";
import { dayWord } from "../radar/words";
import {
  changesLine, checkLook, dateWords, coverageText, diffParts, everyWords, findingsIn30, isOverdue, lineMatches, needsSlot, shownLines, slotsWords, statusLook, TELL_SHOWN,
  type Part,
} from "./words";

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const specOf = (m: Monitor): MonitorSpec => m.live_spec ?? m.spec;

// ---------------------------------------------------------------- the top line
export function PaneTop({ m, now, actions }: { m: Monitor; now: Date; actions: ReactNode }) {
  const look = statusLook(m, true);
  const sp = specOf(m);
  const review = sp.about.review_by;
  const failed = m.last_check?.status === "error" && m.status === "live";
  const late = isOverdue(m, now);
  const freq = m.status === "live" || m.status === "paused" ? `checks ${everyWords(sp.about.check_frequency)}` : `will be checked ${everyWords(sp.about.check_frequency)}`;
  return (
    <>
      <div className="v2-mn-top">
        <Pill tone={look.tone} dashed={look.dashed} mark={m.status === "live" ? "●" : undefined}>{look.label}</Pill>
        <span className="v2-mn-top__m">Owner <b>{sp.about.owner}</b> · {m.status === "retired" ? "no longer checked" : freq}{review ? ` · review by ${dateWords(review)}` : ""}</span>
        <span className="v2-mn-top__gap" />
        <div className="v2-mn-top__act">{actions}</div>
      </div>
      {(m.review_due || failed || late) && (
        <ul className="v2-mn-flags" aria-label="Needs a look">
          {m.review_due && <li><Pill tone="unusual" mark="◆">Review due{review ? ` ${dateWords(review)}` : ""}</Pill></li>}
          {failed && m.last_check && <li><Pill tone="bad" mark="▲">Last check failed · {dayWord(m.last_check.at, now)}</Pill></li>}
          {late && m.last_check && !failed && <li><Pill tone="unusual" mark="◆">Overdue: last checked {ago(m.last_check.at, now)}</Pill></li>}
        </ul>)}
    </>
  );
}

// ---------------------------------------------------------------- a version waiting for approval
export interface ApprovalProps {
  m: Monitor;
  status: MonitorsStatus | null;
  busy: boolean;
  onApprove: () => void;
  onSubmit: () => void;
  onAskChanges: () => void;
  onEdit: () => void;
}
/** Board 16 G: "Version 4 waits for approval · version 3 stays live until then", what changed, and Approve / Request changes / Compare. */
export function Approval({ m, status, busy, onApprove, onSubmit, onAskChanges, onEdit }: ApprovalProps) {
  const locked = useDemoLock();
  const [compare, setCompare] = useState(false);
  const cmpId = useId(), whyId = useId();
  const p = m.pending;
  const sentRow = [...m.versions].reverse().find(v => v.status === "submitted");
  const who = sentRow ? `${person(sentRow.submitted_by) || "Someone"}${sentRow.submitted_at ? `, ${dayTime(sentRow.submitted_at)}` : ""}` : "";
  const parts = p && m.live_spec ? diffParts(m.live_spec, m.spec) : [];
  const latest = m.versions[m.versions.length - 1];
  const sentBack = latest?.status === "draft" && latest.note && latest.submitted_at ? latest.note : null;
  const keeps = m.status === "paused" ? "stays as it is" : "stays live until then";
  const full = needsSlot(m) ? slotsWords(status) : null;

  let title: ReactNode, body: ReactNode = null, acts: ReactNode;
  if (p?.status === "submitted") {
    title = `Version ${p.version} waits for approval · version ${m.live_version} ${keeps}`;
    body = <>Sent by {who}.</>;
    acts = <>
      <Button variant="primary" size="sm" locked={locked} disabled={busy} onClick={onApprove}>Approve v{p.version}</Button>
      <Button size="sm" locked={locked} disabled={busy} onClick={onAskChanges}>Request changes</Button>
      {parts.length > 0 && <Button variant="quiet" size="sm" aria-expanded={compare} aria-controls={cmpId} onClick={() => setCompare(c => !c)}>{compare ? "Hide the comparison" : "Compare"}</Button>}
    </>;
  } else if (m.status === "submitted") {
    title = "Waiting for your approval";
    body = <>Sent by {who}. It goes live within minutes of approval.</>;
    acts = <>
      <Button variant="primary" size="sm" locked={locked} disabled={busy || !!full} aria-describedby={full ? whyId : undefined} onClick={onApprove}>Approve</Button>
      <Button size="sm" locked={locked} disabled={busy} onClick={onAskChanges}>Request changes</Button>
    </>;
  } else if (p?.status === "draft") {
    title = `Version ${p.version} is a draft · version ${m.live_version} keeps running`;
    body = <>Submit it when it is ready. The running version isn't touched until a Risk Manager approves the new one.</>;
    acts = <>
      <Button variant="primary" size="sm" locked={locked} disabled={busy} onClick={onSubmit}>Submit v{p.version} for approval</Button>
      <Button size="sm" onClick={onEdit}>Edit v{p.version}</Button>
      {parts.length > 0 && <Button variant="quiet" size="sm" aria-expanded={compare} aria-controls={cmpId} onClick={() => setCompare(c => !c)}>{compare ? "Hide the comparison" : "Compare"}</Button>}
    </>;
  } else {
    title = "A draft: it isn't running yet";
    body = <>Run a test to see what it would find, then submit it for approval. A test's findings are kept apart from your real ones.</>;
    acts = <Button variant="primary" size="sm" locked={locked} disabled={busy} onClick={onSubmit}>Submit for approval</Button>;
  }
  return (
    <section className="v2-mn-appr" aria-labelledby={`${cmpId}-t`}>
      <h3 id={`${cmpId}-t`} className="v2-mn-appr__t">{title}</h3>
      {body && <p className="v2-mn-appr__m">{body}</p>}
      {sentBack && <p className="v2-mn-appr__m"><b>Changes requested:</b> {sentBack}</p>}
      {parts.length > 0 && <p className="v2-mn-appr__m"><b>Changed:</b> {changesLine(parts)}</p>}
      <div className="v2-mn-appr__act">{acts}</div>
      {full && <p id={whyId} className="v2-mn-appr__why">{full}</p>}
      {compare && parts.length > 0 && <Compare id={cmpId} m={m} parts={parts} />}
      {(p?.status === "submitted" || m.status === "submitted") && <p className="v2-meta v2-mn-appr__f">In this prototype the person who sent it can also approve it. Who sent and who approved each version is recorded.</p>}
    </section>
  );
}

function Compare({ id, m, parts }: { id: string; m: Monitor; parts: Part[] }) {
  return (
    <div id={id} className="v2-mn-cmp" role="group" aria-label={`Version ${m.live_version} compared with version ${m.latest_version}`}>
      <div className="v2-mn-cmp__h v2-cap">What changes</div>
      <dl>
        {parts.map(p => (
          <div key={p.label}>
            <dt>{p.label}</dt>
            <dd>
              {p.before !== undefined
                ? <><span className="v2-mn-cmp__old">{p.before}</span><span aria-hidden="true"> → </span><span className="v2-sr"> changed to </span><b>{p.after}</b></>
                : <ul>
                  {p.added.map(x => <li key={`a${x}`}><span aria-hidden="true">+ </span><span className="v2-sr">Added: </span>{x}</li>)}
                  {p.removed.map(x => <li key={`r${x}`} className="is-removed"><span aria-hidden="true">− </span><span className="v2-sr">Removed: </span>{x}</li>)}
                </ul>}
            </dd>
          </div>))}
      </dl>
    </div>
  );
}

// ---------------------------------------------------------------- the question
export function Question({ m, findings }: { m: Monitor; findings: MonitorFinding[] }) {
  const sp = specOf(m);
  const [all, setAll] = useState(false);
  const tell = sp.public.tell_me_if;
  const real = findings.filter(f => f.world !== "sandbox");
  const pool = real.length ? real : findings;
  const hits = lineMatches(tell.length, pool);
  const { shown, hidden } = shownLines(tell, all);
  const ig = sp.public.ignore ?? [];
  const tId = useId(), wId = useId(), iId = useId();
  return (
    <>
      <p className="v2-mn-sentence">{sp.public.in_one_sentence}</p>
      <div className="v2-mn-qgrid">
        <section aria-labelledby={tId}>
          <h3 id={tId} className="v2-cap v2-mn-cap">Tell me if</h3>
          <ul className="v2-mn-tell">
            {shown.map((t, i) => (
              <li key={t}>{t}
                {hits[i] > 0 && <span className="v2-mn-tell__n"> · met by {hits[i]} of the latest {pool.length} findings{real.length ? "" : " (tests)"}</span>}</li>))}
          </ul>
          {hidden > 0 && <Button variant="quiet" size="sm" className="v2-mn-tell__more" aria-expanded="false" onClick={() => setAll(true)}>+{hidden} more</Button>}
          {all && tell.length > TELL_SHOWN && <Button variant="quiet" size="sm" className="v2-mn-tell__more" aria-expanded="true" onClick={() => setAll(false)}>Show fewer</Button>}
        </section>
        <section aria-labelledby={wId}>
          <h3 id={wId} className="v2-cap v2-mn-cap">Watch</h3>
          <ul className="v2-mn-tags">
            {sp.public.watch.map((w, i) => (
              <li key={`${w.name}-${i}`}><Pill>{w.name}<span className="v2-mn-tag__t"> · {w.type}</span></Pill></li>))}
          </ul>
          {ig.length > 0 && <>
            <h3 id={iId} className="v2-cap v2-mn-cap v2-mn-cap--2">Ignore</h3>
            <ul className="v2-mn-tags" aria-labelledby={iId}>{ig.map(x => <li key={x}><Pill>{x}</Pill></li>)}</ul>
          </>}
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- folds
function Fold({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <details className="v2-mn-fold">
      <summary><span className="v2-mn-fold__t">{title}</span>{note && <span className="v2-mn-fold__n"> · {note}</span>}</summary>
      <div className="v2-mn-fold__b">{children}</div>
    </details>
  );
}

/** "How it reaches us · only your institution sees this": the exposure, by what the profile calls each item. */
export function Reaches({ m, labels }: { m: Monitor; labels: Record<string, string> }) {
  const sp = specOf(m);
  const ex = sp.private.exposure, serious = sp.private.serious ?? [];
  if (!ex.length && !serious.length) return null;
  return (
    <Fold title="How it reaches us" note="only your institution sees this">
      {ex.length > 0 && <ul className="v2-mn-plain">{ex.map(e => (
        <li key={e.id}>{labels[e.id] ?? cap(e.id.replace(/^[a-z]+:/, "").replace(/[-_]+/g, " "))}{e.how_it_reaches_us ? `: ${e.how_it_reaches_us}` : ""}</li>))}</ul>}
      {serious.length > 0 && <><p className="v2-cap v2-mn-cap">Counts as serious</p><ul className="v2-mn-plain">{serious.map(x => <li key={x}>{x}</li>)}</ul></>}
    </Fold>
  );
}

export function Examples({ m }: { m: Monitor }) {
  const ex = specOf(m).public.example_headlines;
  if (!ex || (!ex.match.length && !ex.not_match.length)) return null;
  return (
    <Fold title="Example headlines" note={`${ex.match.length} match, ${ex.not_match.length} ${ex.not_match.length === 1 ? "doesn't" : "don't"}`}>
      {ex.match.length > 0 && <><p className="v2-cap v2-mn-cap">Match</p>
        <ul className="v2-mn-plain">{ex.match.map(x => <li key={x.headline}>“{x.headline}” <span className="v2-meta">· line {x.line}</span></li>)}</ul></>}
      {ex.not_match.length > 0 && <><p className="v2-cap v2-mn-cap">Don't match</p>
        <ul className="v2-mn-plain">{ex.not_match.map(x => <li key={x}>“{x}”</li>)}</ul></>}
    </Fold>
  );
}

/** Places, sources, key dates, who else is told, how serious before it reports. */
export function Details({ m, names }: { m: Monitor; names: Record<string, string | null> }) {
  const sp = specOf(m), p = sp.public;
  const where = p.places.map(c => names[c] ?? placeName(c));
  const rows: [string, string][] = ([
    ["Where", where.join(", ")],
    ["Reads news in", "English"],
    ["Sources", p.sources?.mode === "trusted_only" ? `Only ${p.sources.check_first.join(", ")}` : `Any reputable outlet${p.sources?.check_first.length ? `, checking ${p.sources.check_first.join(", ")} first` : ""}`],
    ["Also tells", (sp.about.also_notify ?? []).join(", ")],
    ["Key dates", (sp.about.key_dates ?? []).map(d => `${d.label} (${dateWords(d.date)}, watched ${d.lead_days} ${d.lead_days === 1 ? "day" : "days"} before)`).join("; ")],
    ["How serious before it reports", `${sp.alert_level} of 10`],
  ] as [string, string][]).filter(([, v]) => v);
  const note = [where.length && `${where.length} ${where.length === 1 ? "place" : "places"}`, p.sources?.mode === "trusted_only" ? "trusted outlets only" : "any reputable outlet"].filter(Boolean).join(" · ");
  return <Fold title="More about the question" note={note}><dl className="v2-mn-dl">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Fold>;
}

const VERSION_WORD: Record<string, string> = { draft: "draft", submitted: "waiting for approval", approved: "approved", superseded: "replaced" };
export function Versions({ m }: { m: Monitor }) {
  const note = `${m.versions.length}`;
  return (
    <Fold title="Versions" note={note}>
      <ol className="v2-mn-vers">
        {[...m.versions].reverse().map(v => (
          <li key={v.version}>
            <b>Version {v.version}</b>
            <span>{VERSION_WORD[v.status] ?? v.status}{v.version === m.live_version ? ", running" : ""} · by {person(v.created_by)}, {dayTime(v.created_at)}
              {v.approved_by ? ` · approved by ${person(v.approved_by)}` : ""}{v.note ? ` · ${v.note}` : ""}</span>
          </li>))}
      </ol>
      <p className="v2-meta">Monitor <span className="v2-mono">{m.monitor_id}</span></p>
    </Fold>
  );
}

// ---------------------------------------------------------------- recent checks
const ago2 = (iso: string, now: Date) => ago(iso, now);
function Found({ f, events }: { f: MonitorFinding; events: Record<string, string> }) {
  const k = kindOf(f);
  const ev = f.outcome?.event_id;
  const h = f.evidence?.headlines?.[0];
  const url = h?.url ?? f.evidence?.web?.[0]?.url;
  const out = k === "event" && ev
    ? <>In <Link to={`/events/${ev}`}>{events[ev] ?? "the event"}</Link></>
    : k === "waiting" || k === "investigating" ? "Being investigated"
    : k === "failed" ? "The investigation couldn't run on it"
    : `No impact found${f.outcome?.reason ? `: ${setAsideReason(f.outcome.reason)}` : ""}`;
  return (
    <li>
      <span className="v2-mn-found__t">{url
        ? <a href={url} target="_blank" rel="noreferrer">{h?.title ?? f.title}<span aria-hidden="true"> ↗</span><span className="v2-sr"> (opens the article)</span></a> : (h?.title ?? f.title)}
        {f.world === "sandbox" && <> <WorldMark world="sandbox" /></>}</span>
      <span className="v2-mn-found__o">{out}</span>
    </li>
  );
}

export interface ChecksProps {
  m: Monitor;
  runs: CheckRow[];
  byCheck: Record<string, MonitorFinding[]>;
  events: Record<string, string>;
  now: Date;
  /** The check this viewer started and is waiting for. */
  checking: string | null;
}
export function Checks({ m, runs, byCheck, events, now, checking }: ChecksProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const head = useId();
  const test = m.status !== "live" && m.status !== "retired";   // a draft, a waiting or a paused monitor is only ever tested
  return (
    <section className="v2-mn-checks" aria-labelledby={head}>
      <div className="v2-mn-checks__h">
        <h3 id={head} className="v2-mn-checks__t">{test ? "Recent tests" : "Recent checks"}</h3>
        <span className="v2-mn-checks__gap" />
        {m.status !== "draft" && <ArrowLink to="/findings">{findingsIn30(m.findings_30d)}</ArrowLink>}
      </div>
      {!runs.length
        ? <p className="v2-mn-none">{test ? "No tests yet. A test shows what the monitor would find; its findings are kept apart from your real ones." : `No checks yet.${m.status === "live" && m.next_check_at ? ` The first is due ${dayWord(m.next_check_at, now)}.` : ""}`}</p>
        : (
          <ul className="v2-mn-ck">
            {runs.map((r, i) => {
              const look = checkLook(r);
              const same = r.status === "failed" && i > 0 && runs[i - 1].status === "failed" && runs[i - 1].error === r.error;
              const detail = r.error ? (same ? "Same problem as the check below." : `${plainError(r.error)} It tries again within the hour.`) : r.summary;
              const fs = byCheck[r.run_id] ?? [];
              const isOpen = !!open[r.run_id];
              const did = `ck-${r.run_id}`;
              return (
                <li key={r.run_id} className="v2-mn-ck__i">
                  <div className="v2-mn-ck__r">
                    <span className="v2-mn-ck__when">{cap(dayWord(r.created_at, now))}</span>
                    <span className="v2-mn-ck__pill"><Pill tone={look.tone} mark={r.status === "failed" ? "▲" : undefined}>{look.word}</Pill>{r.world === "sandbox" && <> <WorldMark world="sandbox" /></>}</span>
                    <span className="v2-mn-ck__n">{r.run_id === checking && r.status === "running" ? "" : look.count}</span>
                    <span className="v2-mn-ck__cov">{coverageText(r.coverage) || (r.status === "running" ? "Reading the news…" : "")}</span>
                    <button type="button" className="v2-mn-ck__d" aria-expanded={isOpen} aria-controls={did}
                      onClick={() => setOpen(o => ({ ...o, [r.run_id]: !o[r.run_id] }))}>{isOpen ? "Hide" : "Details"}<span className="v2-sr"> of the check on {dayWord(r.created_at, now)}</span></button>
                  </div>
                  {detail && <p className={`v2-mn-ck__x${r.status === "failed" ? " is-failed" : ""}`}>{detail}</p>}
                  {fs.length > 0 && <ul className="v2-mn-found" aria-label={`What the check on ${dayWord(r.created_at, now)} found`}>{fs.map(f => <Found key={f.finding_id} f={f} events={events} />)}</ul>}
                  {isOpen && (
                    <dl id={did} className="v2-mn-dl v2-mn-ck__dl">
                      <div><dt>News since</dt><dd>{dayTime(r.window_since)}</dd></div>
                      <div><dt>Version checked</dt><dd>{r.version}</dd></div>
                      <div><dt>Started</dt><dd>{r.trigger === "now" ? "By Check now" : r.trigger === "test" ? "As a test" : "On schedule"}, {ago2(r.created_at, now)}</dd></div>
                      {r.error && <div><dt>What the service said</dt><dd className="v2-mono">{r.error}</dd></div>}
                      <div><dt>Check</dt><dd className="v2-mono">{r.run_id}</dd></div>
                    </dl>)}
                </li>);
            })}
          </ul>)}
    </section>
  );
}
