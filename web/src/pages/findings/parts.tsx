// The Findings page's parts (board 04): the rows, a group's heading and folding, the waiting panel, the loading shape.
// Page logic and the calls stay in Findings.tsx; the words and rules are in words.ts.
import { useId } from "react";
import type { EventRow, FindingRow, InvestigationStatus } from "../../api/investigation";
import { Icon } from "../../components/Icon";
import { Button } from "../../components/v2/Button";
import { DirectionPill } from "../../components/v2/Direction";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { Cell, Row, Table } from "../../components/v2/Table";
import { ArrowLink } from "../../components/v2/ArrowLink";
import { WorldMark } from "../../components/v2/WorldMark";
import { ago, placeOrder, when } from "../../format";
import { eventTitle, longWhen } from "../../plain";
import { InvestigateNowButton } from "../events/investigate";
import { placesText } from "../overview/words";
import { SkBar } from "../../components/v2/Skeleton";
import {
  GROUP_TITLE, groupMeta, hiddenIn, moreWords, noImpactWhy, notInvestigatedLine, retryWord, rowLink, shownIn, signalOf, sourceIcon, sourceWords, triesOf, whenColumn,
  type Group, type Kind,
} from "./words";

const COLS = "52px fit-content(220px) minmax(0, 1fr) 118px 24px";

/** What the page knows about each finding that the finding itself doesn't say. */
export interface RowContext {
  /** the monitor's or series' own name, by source and id */
  sourceName: (f: FindingRow) => string | null;
  placeName: (code: string) => string;
  now: Date;
  timeZone: string;
  /** the finding the page opened on (from a link elsewhere) */
  targetId: string;
  /** the finding whose "Check now" is running */
  checking: string | null;
  onCheck: (f: FindingRow) => void;
}

/** Three bars: strong, moderate or weak, in words for a screen reader. */
export function Signal({ score }: { score: number }) {
  const s = signalOf(score);
  if (!s.level) return <span className="v2-sr">{s.word}</span>;
  return (
    <>
      <svg className="v2-fd-sig" width="14" height="12" viewBox="0 0 14 12" aria-hidden="true" focusable="false">
        {[4, 8, 12].map((h, i) => <rect key={h} x={i * 5} y={12 - h} width="3" height={h} className={i < s.level ? "is-on" : undefined} />)}
      </svg>
      <span className="v2-sr">{s.word}</span>
    </>
  );
}

function FindingRowView({ f, kind, c }: { f: FindingRow; kind: Kind; c: RowContext }) {
  const to = rowLink(f);
  const tries = triesOf(f);
  const places = [...new Set(placeOrder(f.places).map(c.placeName).filter(Boolean))];
  const src = sourceWords(f, c.sourceName(f));
  const id = `f-${f.finding_id}`;
  const body = (
    <>
      <Cell muted className="v2-fd-time"><time dateTime={f.created_at} title={longWhen(f.created_at)}>{whenColumn(f.created_at, c.now, c.timeZone)}</time></Cell>
      <Cell className="v2-fd-src" >
        <Icon name={sourceIcon(f.source)} />
        <span className="v2-fd-src__t" title={src}>{src}</span>
      </Cell>
      <Cell className="v2-fd-what">
        <span className="v2-fd-title">
          <span className="v2-title">{f.title}</span>
          {f.world !== "live" && <WorldMark world={f.world} />}
          {tries !== null && <Pill tone="unusual">{retryWord(tries)}</Pill>}
        </span>
        {kind === "noimpact" && <span className="v2-fd-sub">{noImpactWhy(f)}</span>}
        {kind === "failed" && <span className="v2-fd-sub">{notInvestigatedLine(f)}</span>}
        {kind === "waiting" && tries !== null && <span className="v2-fd-sub">The last try didn't finish. It goes again with the next batch.</span>}
        {kind === "investigating" && (
          <span className="v2-fd-sub">
            {f.run_started_at ? `Started ${ago(f.run_started_at, c.now)}` : "Being investigated"}
            {f.run_status === "running" && f.run_id && <>
              {" · "}
              <Button size="sm" variant="quiet" className="v2-row__act v2-fd-check" disabled={c.checking === f.finding_id} busy={c.checking === f.finding_id} busyLabel="Checking…" onClick={() => c.onCheck(f)}
                label={`Check now: ${f.title}`}>Check now</Button>
            </>}
          </span>)}
      </Cell>
      <Cell phoneHide muted className="v2-fd-where"><span title={places.join(", ")}>{placesText(places, 1)}</span></Cell>
      <Cell phoneHide className="v2-fd-signal"><Signal score={f.score} /></Cell>
    </>
  );
  const cls = `v2-fd-row${c.targetId === id ? " is-target" : ""}`;
  return to ? <Row id={id} to={to} label={`${f.title}: ${src}`} className={cls}>{body}</Row> : <Row id={id} className={cls}>{body}</Row>;
}

export function FindingsTable({ items, kind, label, c }: { items: FindingRow[]; kind: Kind; label: string; c: RowContext }) {
  return (
    <Table label={label} cols={COLS} className="v2-fd-table"
      columns={[{ label: "When", srOnly: true }, { label: "Found by", srOnly: true }, { label: "Finding", srOnly: true }, { label: "Where", srOnly: true }, { label: "Signal strength", srOnly: true }]}>
      {items.map(f => <FindingRowView key={f.finding_id} f={f} kind={kind} c={c} />)}
    </Table>
  );
}

/** One block of the list: its heading (the event's name and direction, or the status), the rows, and the fold. */
export function GroupView({ g, event, expanded, onToggle, waitMinutes, c }: {
  g: Group; event: EventRow | undefined; expanded: boolean; onToggle: () => void; waitMinutes: number | null; c: RowContext;
}) {
  const id = useId();
  const shown = shownIn(g, expanded);
  const hidden = hiddenIn(g);
  const title = g.kind === "event" ? (event ? eventTitle(event) : "An event") : GROUP_TITLE[g.kind];
  const meta = groupMeta(g, { waitMinutes, shown: shown.length });
  return (
    <section className="v2-fd-grp" aria-labelledby={`${id}-h`}>
      <SectionHead id={`${id}-h`} title={title} count={g.items.length} countLabel={g.items.length === 1 ? "finding" : "findings"}
        meta={<>
          {g.kind === "event" && event && <DirectionPill tone={event.tone} />}
          {meta && <span className="v2-meta v2-fd-gmeta">{meta}</span>}
        </>}
        action={g.eventId ? <ArrowLink to={`/events/${encodeURIComponent(g.eventId)}`}>Open the event<span className="v2-sr">: {title}</span></ArrowLink> : undefined} />
      <FindingsTable items={shown} kind={g.kind} label={`Findings: ${title}`} c={c} />
      {hidden > 0 && (
        <Button variant="quiet" size="sm" className="v2-fd-more" aria-expanded={expanded} aria-controls={`${id}-more`} onClick={onToggle}>
          <span aria-hidden="true">{expanded ? "▾" : "▸"} </span>{moreWords(hidden, expanded)}
        </Button>)}
    </section>
  );
}

/** The panel at the head of the page when findings wait for the next batch: how many, when, and the one button. */
export function WaitingPanel({ status, now, onDone }: { status: InvestigationStatus; now: Date; onDone: () => void }) {
  const next = status.next_batch_at && status.connected ? (new Date(status.next_batch_at) <= now ? "very soon" : when(status.next_batch_at, now)) : null;
  return (
    <div className="v2-fd-wait" role="status">
      <span className="v2-fd-wait__dot" aria-hidden="true" />
      <span><b>{status.findings_waiting} waiting</b>{next ? <> · next investigation {next}</> : null}</span>
      {status.connected && <InvestigateNowButton onDone={onDone} small />}
    </div>
  );
}

/** The list's shape while it loads: the real columns, grey bars. */
export function FindingsSkeleton() {
  return (
    <div className="v2-fd-skel" role="status" aria-busy="true">
      <span className="v2-sr">Loading the findings</span>
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className="v2-fd-skel__row" aria-hidden="true">
          <SkBar w={36} h={13} />
          <SkBar h={13} className="v2-fd-skel__src" />
          <SkBar w={`${78 - i * 9}%`} h={15} />
          <SkBar w={60} h={13} className="v2-hs" />
          <SkBar w={14} h={12} className="v2-hs" />
        </div>
      ))}
    </div>
  );
}
