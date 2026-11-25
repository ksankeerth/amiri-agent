// The right side of the Data connection page (board 11): what was imported, the check's result, and the approval.
// Steps 3, 4 and 5 of the strip live here: Check, Approve, Use it.
import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { connectApi, type Connection, type Report } from "../../api/connect";
import { Button } from "../../components/v2/Button";
import { ChecksOff } from "../../components/v2/Verdict";
import { Empty } from "../../components/v2/Empty";
import { Pill } from "../../components/v2/Pill";
import { Skeleton } from "../../components/v2/Skeleton";
import { Cell, Row, Table } from "../../components/v2/Table";
import { ago, dayTime, isToday, person, plural, when } from "../../format";
import { Switch } from "./dataParts";
import {
  approveWhy, CHECK_WORDS, checkPill, conformanceLine, coverageCounts, coverageHeadline, productDetail, sourceName, sourceOf, statusTone, validationWhy,
} from "./dataWords";
import { bulkWords, coverWords, dateWords, rangeWords, sizeWords } from "./importWords";

const SHOWN = 6;
const SHORT = 8;  // up to this many conformance checks are all listed; more: the gaps, and the rest in a fold
type Checks = Awaited<ReturnType<typeof connectApi.checks>>;

/** "today 10:52", or "24 Nov 10:52" on another day. */
const whenWords = (iso: string) => (isToday(iso) ? `today ${when(iso)}` : when(iso));

function Details({ title, open, children }: { title: ReactNode; open?: boolean; children: ReactNode }) {
  return <details className="v2-ad-det" open={open}><summary>{title}</summary><div className="v2-ad-det__b">{children}</div></details>;
}

/** One conformance check: its pill, its name (linked to the Spec), what was found and the fix. */
function CheckRow({ c, overall }: { c: Report["checks"][number]; overall: Report["status"] }) {
  const pill = checkPill(c.status, overall);
  return (
    <div className="v2-ad-crow">
      <Pill tone={pill.tone} className="v2-ad-crow__p">{pill.label}</Pill>
      <div className="v2-ad-crow__b">
        <b>{c.title}</b>
        <Link className="v2-ad-crow__id v2-mono" to={`/spec#check-${c.id}`} title="This check in the Metrics Spec">{c.id}</Link>
        {c.status === "fail" && c.findings[0] && <span className="v2-ad-crow__d"> {c.findings[0]}{(c.findings.length > 1 || c.more > 0) && ` (and ${c.findings.length - 1 + c.more} more)`}</span>}
        {c.status !== "fail" && c.note && <span className="v2-ad-crow__d"> {c.note}</span>}
        {c.status === "fail" && c.fix && <span className="v2-ad-find__fix"><b>Fix:</b> {c.fix}</span>}
      </div>
    </div>
  );
}

/** What was imported: the source, the file, what it covers. */
function Imported({ conn }: { conn: Connection }) {
  const imp = conn.imported;
  if (!imp) return null;
  const src = sourceOf(imp);
  return (
    <dl className="v2-ad-kv">
      <dt>Source</dt><dd>{sourceName(src)}</dd>
      <dt>File</dt><dd><span className="v2-mono">{imp.file_name ?? "(no name)"}</span> · {sizeWords(imp.bytes)}</dd>
      <dt>Imported</dt><dd>{dayTime(imp.at)} by {person(imp.by)} <span className="v2-ad-fine">· {ago(imp.at)}</span></dd>
      <dt>Covers</dt><dd>{coverWords(imp.summary)} · {bulkWords(imp.summary)}{rangeWords(imp.summary) && <> · {rangeWords(imp.summary)}</>}</dd>
      <dt>As of</dt><dd>{dateWords(imp.as_of)}</dd>
      {imp.about && <><dt>About</dt><dd>{imp.about}</dd></>}
    </dl>
  );
}

export interface ResultPanelProps {
  conn: Connection; report: Report | null; history: Checks; current: boolean; names: Map<string, string>;
  checking: boolean; locked: boolean;
  onCheck: () => void; onApprove: () => void; onValidation: (on: boolean) => void; onPick: (id: string) => void;
}

export function ResultPanel(p: ResultPanelProps) {
  const { conn, report, history, current, names, checking, locked } = p;
  const head = useId(), switchId = useId();
  const [all, setAll] = useState(false);

  if (!conn.configured) {
    return (
      <article className="v2-panel v2-ad-panel" aria-labelledby={head}>
        <h2 id={head} className="v2-ad-ph">Nothing to check yet</h2>
        <Empty plain title="No data connected">Choose a source on the left and bring its figures in. Amiri Agent then checks each possible impact against them.</Empty>
      </article>);
  }

  const latest = conn.latest_check;
  const coverage = report?.coverage?.products ?? [];
  const counts = coverageCounts(coverage);
  const title = !report ? "Check the data to see what Amiri Agent can use" : coverage.length ? coverageHeadline(coverage) : report.headline;
  const shown = all ? coverage : coverage.slice(0, SHOWN);
  const failedSteps = report?.steps.filter(s => s.status !== "pass") ?? [];
  const fails = report?.checks.filter(c => c.status === "fail") ?? [];
  const rest = report?.checks.filter(c => c.status !== "fail") ?? [];
  const why = approveWhy({ check: latest ? { status: latest.status, current: !!latest.current } : null, approved: !!conn.approved });
  const vWhy = validationWhy({ validation_allowed: conn.validation_allowed, approved: !!conn.approved });
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `${report.check_id}.json`; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <article className="v2-panel v2-ad-panel" aria-labelledby={head} aria-busy={checking || undefined}>
      <div className="v2-ad-ph-row">
        {report ? <Pill tone={statusTone(report.status)}>{CHECK_WORDS[report.status]}</Pill> : <Pill>Not checked yet</Pill>}
        {conn.approved && <Pill tone="good">Approved</Pill>}
        {conn.approved && !conn.validation_enabled && <ChecksOff />}
        <span className="v2-ad-meta">{report ? `Check run ${whenWords(report.started_at)} by ${person(report.run_by)} · ${plural(report.summary.calls, "call")} in ${report.summary.seconds} s`
          : `Imported ${ago(conn.imported?.at)} by ${person(conn.imported?.by)}`}</span>
        <span className="v2-ad-gap" />
        {history.length > 1 && report && <label className="v2-ad-pick"><span className="v2-sr">Earlier checks</span>
          <select className="v2-ad-select" value={report.check_id} onChange={e => p.onPick(e.target.value)}>
            {history.map(h => <option key={h.check_id} value={h.check_id}>{dayTime(h.started_at)} · {CHECK_WORDS[h.status].toLowerCase()}</option>)}</select></label>}
        <Button variant={report ? "secondary" : "primary"} disabled={checking} onClick={p.onCheck}>{checking ? "Checking…" : report ? "Check again" : "Check"}</Button>
      </div>

      <h2 id={head} className="v2-ad-ph">{title}</h2>
      <div role="status" className="v2-ad-fine">{checking ? "Checking the data: about 70 reads, a few seconds…" : ""}</div>
      {checking && !report && <Skeleton rows={3} label="Checking the data" />}
      {report && !current && <p className="v2-ad-old">This is an older check: the data changed after it.</p>}
      {report?.withdrawn && <p className="v2-ad-old">{report.withdrawn}</p>}

      {failedSteps.length > 0 && (
        <section aria-label="What the check found" className="v2-ad-finds">
          {failedSteps.map((s, i) => (
            <div key={i} className="v2-ad-find">
              <Pill tone={s.status === "fail" ? "bad" : "unusual"}>{s.status === "fail" ? "Fail" : "Warning"}</Pill>
              <div className="v2-ad-find__b">
                <span className="v2-ad-find__t">{s.title}{s.detail && <span className="v2-ad-find__d"> · {s.detail}</span>}</span>
                {s.items.length > 0 && <ul>{s.items.slice(0, 6).map((x, j) => <li key={j}>{x}</li>)}</ul>}
                {s.fix && <span className="v2-ad-find__fix"><b>Fix:</b> {s.fix}</span>}
              </div>
            </div>))}
        </section>)}

      {coverage.length > 0 && (
        <section>
          <div className="v2-ad-counts">
            <span><span className="v2-ad-dot is-good" aria-hidden="true" /> {counts.full} full</span>
            <span><span className="v2-ad-dot is-unusual" aria-hidden="true" /> {counts.partial} in part</span>
            <span><span className="v2-ad-dot is-bad" aria-hidden="true" /> {counts.none} none</span>
            <span className="v2-ad-gap" />
            {coverage.length > SHOWN && <button type="button" className="v2-ad-link" aria-expanded={all} onClick={() => setAll(a => !a)}>{all ? "Fewer" : `All ${coverage.length}`}<span aria-hidden="true"> →</span></button>}
          </div>
          <Table label="Products and what can be checked" cols="16px minmax(0,1.3fr) minmax(0,1.4fr)" colsPhone="16px minmax(0,1fr)" className="v2-ad-prod">
            {shown.map(c => (
              <Row key={c.profile_product_id}>
                <Cell><span className={`v2-ad-dot is-${c.status === "full" ? "good" : c.status === "partial" ? "unusual" : "bad"}`} aria-hidden="true" /></Cell>
                <Cell><span className="v2-sr">{c.status === "full" ? "Full: " : c.status === "partial" ? "In part: " : "None: "}</span>{c.name}</Cell>
                <Cell className="v2-ad-prod__d">{productDetail(c, names)}</Cell>
              </Row>))}
          </Table>
          {report!.coverage!.unmapped_catalog_products.length > 0 && <p className="v2-ad-fine v2-ad-unmapped">In the data but not in your profile: {report!.coverage!.unmapped_catalog_products.map(x => x.name || x.product_id).join(", ")}.</p>}
        </section>)}

      {report && report.checks.length > 0 && (
        <Details title={conformanceLine(report.checks, report.status)} open>
          {(report.checks.length <= SHORT ? [...fails, ...rest] : fails).map(c => <CheckRow key={c.id} c={c} overall={report.status} />)}
          {report.checks.length > SHORT && rest.length > 0 && <Details title={fails.length ? plural(rest.length, "other check") : `All ${rest.length} checks`}>
            {rest.map(c => <CheckRow key={c.id} c={c} overall={report.status} />)}
          </Details>}
        </Details>)}

      {report && report.missing_for_profile.length > 0 && (
        <Details title={`What's missing for your profile · ${report.missing_for_profile.length}`}>
          <ul className="v2-ad-list">{report.missing_for_profile.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Details>)}
      {report && report.formats.length > 0 && (
        <Details title={`Answers that don't match the spec's formats · ${report.formats.length}`}>
          {report.formats.slice(0, 10).map((f, i) => <div key={i} className="v2-ad-fmt"><span className="v2-mono">{f.where}</span>
            <ul className="v2-ad-list">{f.errors.map((e, j) => <li key={j} className="v2-mono">{e}</li>)}{f.more > 0 && <li>and {f.more} more</li>}</ul></div>)}
          {report.formats.length > 10 && <p className="v2-ad-fine">and {report.formats.length - 10} more answers</p>}
        </Details>)}
      {report && (
        <Details title={`Calls made · ${report.calls.length}`}>
          <div className="v2-ad-calls">{report.calls.map((c, i) => <div key={i} className="v2-ad-call">
            <span className="v2-mono v2-ad-call__p">{c.method} {c.path}{Object.keys(c.query).length ? "?" + new URLSearchParams(Object.entries(c.query).map(([k, v]) => [k, String(v)])).toString() : ""}</span>
            <span className="v2-mono">{c.status ?? c.error}</span><span className="v2-mono v2-ad-call__ms">{c.ms} ms</span></div>)}</div>
        </Details>)}
      <Details title={`What was imported`} open={!report}><Imported conn={conn} /></Details>

      {/* step 4 and 5: approve, then use it */}
      {conn.approved ? (
        <div className={`v2-ad-appr${conn.validation_enabled ? " is-on" : ""}`}>
          <div className="v2-ad-appr__b">
            <b>{conn.validation_enabled ? "Approved · checks against your data are on" : "Approved · checks against your data are off"}</b>
            <span>Approved by {person(conn.approved.by)}, {when(conn.approved.at)}. {conn.validation_enabled
              ? "Events and alerts now show what your figures say. Changing the source means checking and approving again."
              : "Switch checks on to use these figures for events and alerts."}</span>
          </div>
          <div className="v2-ad-appr__sw">
            <Switch large on={conn.validation_enabled} locked={locked} disabled={!conn.validation_allowed && !conn.validation_enabled} onChange={p.onValidation}
              aria-labelledby={`${switchId}-l`} aria-describedby={vWhy ? `${switchId}-w` : undefined} />
            <label id={`${switchId}-l`}>{conn.validation_enabled ? "On" : "Off"}<span className="v2-sr"> · Checks against your data</span></label>
          </div>
          {vWhy && !conn.validation_enabled && <span id={`${switchId}-w`} className="v2-ad-fine v2-ad-appr__w">{vWhy}</span>}
        </div>
      ) : (
        <div className="v2-ad-appr is-todo">
          <div className="v2-ad-appr__b">
            <b>Not approved yet</b>
            <span>{why ?? "Approving says these figures can be trusted. Events and alerts then check against them."}</span>
            <span className="v2-ad-checks">Checks against your data: {conn.validation_enabled ? <Pill tone="good">On</Pill> : <Pill dashed>Off · approve a ready connection first</Pill>}</span>
          </div>
          <Button variant={why ? "secondary" : "primary"} locked={locked} disabled={!!why} title={why ?? undefined} onClick={p.onApprove}>Approve</Button>
        </div>)}

      {report && <div className="v2-ad-foot"><button type="button" className="v2-ad-link" onClick={download}>Download this report (JSON)</button></div>}
    </article>
  );
}
