// The Events list's parts (board 03): the table of events, the notes above it, the investigation runs (Platform Admin).
// Page logic and the calls stay in Events.tsx; the words and rules are in listWords.ts.
import { useId, useState, type ReactNode } from "react";
import { investigationApi, type EventDetail, type EventRow, type Run } from "../../api/investigation";
import { Icon } from "../../components/Icon";
import { useDemoLock } from "../../components/lock";
import { useNow, useRefusalToast, useToast } from "../../components/ui";
import { readFold, writeFold } from "../../components/foldStore";
import { Button } from "../../components/v2/Button";
import { DirectionMark, DirectionPill } from "../../components/v2/Direction";
import { DIRECTIONS, directionOf } from "../../components/v2/directionWords";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { Cell, Row, Table } from "../../components/v2/Table";
import { WorldMark } from "../../components/v2/WorldMark";
import { ago, day, dayTime, plural } from "../../format";
import { eventTitle, longWhen } from "../../plain";
import { ageText, placesText } from "../overview/words";
import { alertsText, effectsFigure, lastNews, productNames, productsText, RUNS_LIMIT, runKind, runWords, whenText } from "./listWords";
import { SkBar } from "../../components/v2/Skeleton";

// ---------------------------------------------------------------- the table
const COLS = "16px minmax(0, 1.4fr) 110px minmax(0, 1.6fr) 92px 90px";
const COLS_PHONE = "16px minmax(0, 1fr) auto";

export interface EventsTableProps {
  rows: EventRow[];
  /** each event's detail once it is in: the products and the last news come from it */
  details: Record<string, EventDetail>;
  /** whether an event's detail is still on its way (no products yet, not "none") */
  waiting: (id: string) => boolean;
  /** alerts waiting for review, per event */
  alerts: Map<string, number>;
  placeName: (code: string) => string;
  now: Date;
  label: string;
}
export function EventsTable({ rows, details, waiting, alerts, placeName, now, label }: EventsTableProps) {
  return (
    <Table label={label} cols={COLS} colsPhone={COLS_PHONE} className="v2-evs-table" closed
      columns={[{ label: "" }, { label: "Event" }, { label: "For you" }, { label: "Products it could move", phoneHide: true }, { label: "Effects" }, { label: "Alerts" }]}>
      {rows.map(e => <EventRowView key={e.event_id} e={e} d={details[e.event_id]} waiting={waiting(e.event_id)} alerts={alerts.get(e.event_id) ?? 0} placeName={placeName} now={now} />)}
    </Table>
  );
}

function EventRowView({ e, d, waiting, alerts, placeName, now }: { e: EventRow; d: EventDetail | undefined; waiting: boolean; alerts: number; placeName: (c: string) => string; now: Date }) {
  const title = eventTitle(e);
  const names = productNames(d);
  const fx = effectsFigure(e.hypotheses);
  const al = alertsText(alerts);
  const closed = e.status === "closed";
  const news = lastNews(d);
  const places = placesText(e.places.map(placeName), 1);
  const meta = [
    places,
    e.created_at ? `opened ${day(e.created_at)}` : whenText(e, day),
    closed ? `closed ${e.closed_at ? day(e.closed_at) : ""}`.trim() : news ? `last news ${ageText(news, now)}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <Row to={`/events/${e.event_id}`} label={`${title}, ${DIRECTIONS[directionOf(e.tone)].word}${closed ? ", closed" : ""}`} className={`v2-evs-row${closed ? " is-closed" : ""}`}>
      <Cell className="v2-evs-mark"><DirectionMark tone={e.tone} /></Cell>
      <Cell className="v2-evs-ev">
        <span className="v2-evs-title"><span className="v2-title">{title}</span>{e.world !== "live" && <WorldMark world={e.world} />}</span>
        <span className="v2-evs-meta" title={longWhen(e.anchor)}>{meta}</span>
      </Cell>
      <Cell className="v2-evs-pill"><DirectionPill tone={e.tone} />{closed && <span className="v2-sr"> (closed)</span>}</Cell>
      <Cell phoneHide className="v2-evs-prods">
        {names === null ? (waiting ? <SkBar w={80} h={13} /> : <span className="v2-muted">—</span>)
          : names.length ? productsText(names) : <span className="v2-muted">{e.hypotheses ? "—" : "No products traced yet"}</span>}
      </Cell>
      <Cell className="v2-evs-fx">{fx ? <><b className="v2-num">{fx[0]}</b> {fx[1]}</> : <span className="v2-muted">No effects yet</span>}</Cell>
      <Cell className="v2-evs-al">{al ? <b className="v2-evs-al__n">{al}<span className="v2-sr"> to review</span></b> : <><span aria-hidden="true" className="v2-muted">—</span><span className="v2-sr">No alerts</span></>}</Cell>
    </Row>
  );
}

/** The table's shape while it loads: the real columns, grey bars. */
export function EventsSkeleton() {
  return (
    <div className="v2-evs-skel" role="status" aria-busy="true">
      <span className="v2-sr">Loading the events</span>
      {[0, 1, 2, 3].map(i => (
        <div key={i} className="v2-evs-skel__row" aria-hidden="true">
          <SkBar w={13} h={13} />
          <span className="v2-evs-skel__ev"><SkBar w={`${62 - i * 7}%`} h={16} /><SkBar w="44%" h={12} /></span>
          <SkBar w={84} h={22} r={999} />
          <SkBar w="70%" h={13} className="v2-hs" />
          <SkBar w={60} h={13} />
          <SkBar w={60} h={13} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- notes above the table
/** A line the page needs to say before the list: a warning (⚠ and words), or an action to take. */
export function Note({ tone = "info", children, action, status }: { tone?: "info" | "warn"; children: ReactNode; action?: ReactNode; status?: boolean }) {
  return (
    <div className={`v2-evs-note${tone === "warn" ? " is-warn" : ""}`} role={status ? "status" : undefined}>
      {tone === "warn" && <span aria-hidden="true">⚠</span>}
      <span className="v2-evs-note__t">{children}</span>
      {action}
    </div>
  );
}

/** An investigation is running: three dots (the shape; the words say it) while the result is on its way. */
export function RunningNote({ n }: { n: number }) {
  return (
    <Note status>
      <span className="v2-evs-dots" aria-hidden="true"><i /><i /><i /></span>{" "}
      <b>{n === 1 ? "An investigation is running." : `${n} investigations are running.`}</b> What it finds appears here as soon as it is done.
    </Note>
  );
}

export function ClearSimulated({ onDone }: { onDone: () => void }) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const [asking, setAsking] = useState(false);
  const clear = async () => {
    try { const r = await investigationApi.clearSandbox(); toast(`Cleared ${plural(r.findings, "simulated finding")} and ${plural(r.investigations, "run")}.`); onDone(); }
    catch (e) { refuse(e); }
    finally { setAsking(false); }
  };
  return asking
    ? <span className="v2-evs-ask" role="group" aria-label="Clear the simulated events">
      <span className="v2-meta">Remove every simulated finding, run and event?</span>
      <Button size="sm" onClick={clear} locked={locked}>Clear</Button>
      <Button size="sm" variant="quiet" onClick={() => setAsking(false)}>Cancel</Button>
    </span>
    : <Button size="sm" locked={locked} onClick={() => setAsking(true)}><Icon name="trash" />Clear simulated</Button>;
}

// ---------------------------------------------------------------- investigation runs (Platform Admin)
const RUN_COLS = "minmax(0, 1.1fr) 70px minmax(0, 2fr) 96px";
function RunsTable({ runs, now, onCheck, finished, label }: { runs: Run[]; now: Date; onCheck?: (r: Run) => void; finished?: boolean; label: string }) {
  return (
    <Table label={label} cols={RUN_COLS} colsPhone="minmax(0, 1fr) 96px" className="v2-evs-runs__table"
      columns={[{ label: "Started" }, { label: "Findings", phoneHide: true }, { label: finished ? "Found" : "What happened" }, { label: "" }]}>
      {runs.map(r => {
        const k = runKind(r), w = k === "failed" || k === "stopped" ? runWords(r) : null;
        return (
          <Row key={r.run_id} className="v2-evs-run">
            <Cell>
              <span className="v2-evs-run__when" title={longWhen(r.created_at)}>{dayTime(r.created_at)} {r.world !== "live" && <WorldMark world={r.world} />}</span>
              <span className="v2-meta v2-evs-run__ago">{ago(r.created_at, now)}</span>
            </Cell>
            <Cell phoneHide num>{r.finding_ids.length}</Cell>
            <Cell className="v2-evs-run__what">
              {w ? <><Pill tone="unusual">{w.what}</Pill>{w.why && <> {w.why}</>}{r.attempt > 1 && <span className="v2-meta"> · attempt {r.attempt}</span>}</>
                : k === "running" ? "Still running"
                : !r.events ? "No event made"
                : `${plural(r.events, "event")}, ${plural(r.hypotheses ?? 0, "possible impact")}${r.validation ? `, ${plural(r.tasks ?? 0, "check")}` : ""}`}
            </Cell>
            <Cell align="right">{onCheck && k === "running" && <Button size="sm" variant="quiet" onClick={() => onCheck(r)} label={`Check now: run started ${dayTime(r.created_at)}`}>Check now</Button>}</Cell>
          </Row>);
      })}
    </Table>
  );
}

/** The runs, folded away by default (the choice is remembered in this browser). "Check now" on a running one stays as a manual retry. */
export function Runs({ runs, onChange }: { runs: Run[]; onChange: () => void }) {
  const toast = useToast(), refuse = useRefusalToast();
  const now = useNow(30_000);
  const id = useId();
  const [open, setOpen] = useState(() => readFold("events-runs") ?? false);
  const [all, setAll] = useState(false);
  const [shownN, setShownN] = useState(25);
  const check = async (r: Run) => {
    try { const x = await investigationApi.collect(r.run_id); toast(x.status === "running" ? "Still working; it will appear here." : "Collected."); onChange(); }
    catch (e) { refuse(e); }
  };
  const running = runs.filter(r => runKind(r) === "running");
  const trouble = runs.filter(r => ["failed", "stopped"].includes(runKind(r)));
  const finished = runs.filter(r => runKind(r) === "finished");
  const last = runs.length >= RUNS_LIMIT ? RUNS_LIMIT : runs.length;
  const summary = !runs.length ? "none yet" : `the last ${last}: ${finished.length} finished${running.length ? `, ${running.length} running` : ""}${trouble.length ? "" : ", none failed"}`;
  const toggle = () => { const v = !open; setOpen(v); writeFold("events-runs", v); };
  return (
    <section className="v2-evs-runs" aria-labelledby={`${id}-h`}>
      <SectionHead id={`${id}-h`} title="Investigation runs" size="sm"
        meta={<span className="v2-meta">Platform Admin · {summary}{trouble.length > 0 && <>, <b className="v2-evs-warnword">{trouble.length} failed</b></>}</span>}
        action={<Button size="sm" variant="quiet" aria-expanded={open} aria-controls={`${id}-b`} onClick={toggle}>{open ? "Hide" : "Show"}</Button>} />
      <div id={`${id}-b`} hidden={!open}>
        {open && (!runs.length ? <p className="v2-meta">None yet.</p> : <>
          {running.length + trouble.length > 0 && <RunsTable runs={[...running, ...trouble]} now={now} onCheck={check} label="Investigations running or failed" />}
          {trouble.length === 0 && <p className="v2-meta v2-evs-runs__ok">No run failed in the last {last}.</p>}
          {finished.length > 0 && <div className="v2-evs-runs__more">
            <Button size="sm" variant="quiet" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? "Hide the runs that finished" : `Show the ${finished.length} that finished`}</Button></div>}
          {all && <RunsTable runs={finished.slice(0, shownN)} now={now} finished label="Investigations that finished" />}
          {all && finished.length > shownN && <div className="v2-evs-runs__more">
            <Button size="sm" variant="quiet" onClick={() => setShownN(n => n + 25)}>Show 25 more ({finished.length - shownN} not shown)</Button></div>}
        </>)}
      </div>
    </section>
  );
}
