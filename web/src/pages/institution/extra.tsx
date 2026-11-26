// The Institution page's other two views: every change to the profile (with Undo), and what the agents see of it.
import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { inst, type HistoryRow, type Item } from "../../api/institutions";
import { useDemoLock } from "../../components/lock";
import { changeWords, fieldWord, SECTION_ONE, valueText } from "../../components/setupFlow";
import { useRefusalToast, useRole, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { Empty } from "../../components/v2/Empty";
import { LoadError } from "../../components/v2/LoadError";
import { SectionHead } from "../../components/v2/SectionHead";
import { Skeleton } from "../../components/v2/Skeleton";
import { Cell, Row, Table } from "../../components/v2/Table";
import { dayTime, person, placeName, plural, ZONE_LABEL } from "../../format";
import { batchSummary, byWords, groupBatches, THEME_WORDS, whyParts } from "./words";

// ---------------------------------------------------------------- history

/** One change as a sentence: "Added rival **Coastal Remit**". */
function ChangeSentence({ r, names }: { r: HistoryRow; names: Record<string, string | null> }) {
  const w = changeWords(r, "done", names);
  return <>{w.lead} {w.name && <b>{w.name}</b>}{w.tail ? ` ${w.tail}` : ""}</>;
}

/** Before and after as a field list, not JSON. */
function BeforeAfter({ r }: { r: HistoryRow }) {
  const keys = [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})])]
    .filter(k => r.op !== "update" || JSON.stringify(r.before?.[k]) !== JSON.stringify(r.after?.[k]));
  if (!keys.length) return <p className="v2-meta">No field changes.</p>;
  return (
    <dl className="v2-in-diff">{keys.map(k => (
      <div key={k}><dt>{fieldWord(k)}</dt><dd>
        {r.before && <del>{valueText(r.before[k])}</del>}{r.before && r.after && <span aria-hidden="true"> → </span>}{r.before && r.after && <span className="v2-sr"> became </span>}{r.after && <ins>{valueText(r.after[k])}</ins>}</dd></div>))}</dl>
  );
}

export function History({ id, pv, onChanged, readOnly, names }: { id: string; pv: number; onChanged: () => void; readOnly: boolean; names: Record<string, string | null> }) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [undo, setUndo] = useState<Awaited<ReturnType<typeof inst.undo>> | null>(null);
  const load = useCallback(() => inst.history(id).then(r => { setRows(r.items); setNext(r.next_before); setErr(null); }).catch(e => setErr(e)), [id]);
  useEffect(() => { load(); }, [load, pv]);
  const askUndo = async (batchId: string) => {
    try { setUndo(await inst.undo(id, batchId)); } catch (e) { refuse(e, "Couldn't check the undo"); }
  };
  const doUndo = async () => {
    if (!undo) return;
    try { await inst.batch(id, undo.operations); toast("Undone."); setUndo(null); onChanged(); }
    catch (e) { refuse(e, "Couldn't undo"); }
  };
  const more = async () => {
    if (!next) return;
    try { const r = await inst.history(id, next); setRows(x => [...(x ?? []), ...r.items]); setNext(r.next_before); } catch (e) { refuse(e, "Couldn't load older changes"); }
  };
  if (rows === null) return err != null ? <LoadError error={err} onRetry={load} what="the history" /> : <Skeleton rows={5} label="Loading the history" />;
  const batches = groupBatches(rows);
  return (
    <section aria-labelledby="hist-h" className="v2-in-sec">
      <SectionHead title="Every change" id="hist-h" meta={<span className="v2-in-sec__meta">what changed, when, and who made it (a form, the Setup agent, an import) · {ZONE_LABEL} time</span>} />
      {!batches.length ? <Empty title="No changes yet" className="v2-in-empty">Every change to the profile will be listed here, with who made it.</Empty> : (
        <Table label="Every change" cols="130px minmax(0, 1.6fr) minmax(0, 1fr) 150px" colsPhone="minmax(0, 1fr)" className="v2-in-tbl v2-in-hist" closed
          columns={[{ label: "When", phoneHide: true }, { label: "What changed" }, { label: "By", phoneHide: true }, { label: "Actions", srOnly: true }]}>
          {batches.map(b => {
            const r = b[0], k = r.batch_id;
            return (
              <div key={k} className="v2-in-hist__g" role="presentation">
                <Row>
                  <Cell muted className="v2-in-when">{dayTime(r.at)}</Cell>
                  <Cell className="v2-in-what">{b.length === 1 ? <ChangeSentence r={r} names={names} /> : <>{r.source === "import" ? "Imported" : "Saved"} <b>{plural(b.length, "change")}</b>: {batchSummary(b)}</>}
                    <span className="v2-in-sub">{dayTime(r.at)} · {byWords(r.actor, r.source, person)}</span></Cell>
                  <Cell muted phoneHide>{byWords(r.actor, r.source, person)}</Cell>
                  <Cell className="v2-in-acts v2-in-acts--text">
                    <Button size="sm" variant="quiet" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>{open === k ? "Hide" : "Details"}</Button>
                    {!readOnly && r.op !== "status" && <Button size="sm" variant="quiet" title="Undo this whole save" locked={locked} onClick={() => askUndo(k)}>Undo</Button>}
                  </Cell>
                </Row>
                {open === k && (
                  <div role="row" className="v2-row v2-in-opened"><div role="cell" className="v2-cell">
                    {b.length === 1 ? <BeforeAfter r={r} /> : <ul className="v2-in-items">{b.map(x => <li key={x.change_id}><ChangeSentence r={x} names={names} /></li>)}</ul>}
                  </div></div>)}
              </div>);
          })}
        </Table>)}
      {next && <p className="v2-in-sec__more"><Button onClick={more}>Older changes</Button></p>}
      {undo && (
        <Dialog size="M" title="Undo this change?" onClose={() => setUndo(null)} actions={<>
          <Button onClick={() => setUndo(null)}>Cancel</Button>
          <Button variant="primary" locked={locked} disabled={!undo.valid} onClick={doUndo}>Undo</Button></>}>
          <p className="v2-in-dlgtext">Saved by {byWords(undo.actor, undo.source, person)} on {dayTime(undo.at)}{undo.proposal_id ? ", from a Setup agent proposal" : ""}. Undoing it is a new change, kept in the history.</p>
          {undo.valid
            ? <ul className="v2-in-items">{undo.changes.map((c, k) => { const w = changeWords(c, "propose", names); return <li key={k}>{c.op === "create" ? "Add back" : c.op === "delete" ? "Remove" : "Restore"} {w.name ? <b>{w.name}</b> : SECTION_ONE[c.section] ?? c.section}{w.name ? ` (${SECTION_ONE[c.section] ?? c.section})` : ""}</li>; })}</ul>
            : <p className="v2-in-err" role="alert"><span aria-hidden="true">◆ </span>Can't be undone as it stands: {undo.errors.map(e => e.message).join("; ")}</p>}
        </Dialog>)}
    </section>
  );
}

// ---------------------------------------------------------------- what the agents see

export function AgentsView({ id, pv, names, regulators }: { id: string; pv: number; names: Record<string, string | null>; regulators: Item[] }) {
  const { role } = useRole();
  const [c, setC] = useState<Record<string, any> | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [raw, setRaw] = useState(false);
  const load = useCallback(() => inst.context(id).then(x => { setC(x); setErr(null); }).catch(e => setErr(e)), [id]);
  useEffect(() => { load(); }, [load, pv]);
  if (!c) return err != null ? <LoadError error={err instanceof ApiError ? err : err} onRetry={load} what="what the agents see" /> : <Skeleton rows={5} label="Loading what the agents see" />;
  const s = c.radar_scope;
  const place = (p: string) => names[p] ?? placeName(p);
  const actorName = (a: string) => { const r = regulators.find(x => x.short === a); return r ? `${r.name}${r.name.includes(`(${a})`) ? "" : ` (${a})`}` : a; };
  return (
    <div className="v2-in-agents">
      <p className="v2-in-lead">Radar reads news about these places, topics and names. Code works them out from your profile (version {c.profile_version}); the monitors, the investigation and the Setup agent read the same profile.</p>
      <section aria-labelledby="ag-places" className="v2-in-sec">
        <SectionHead title="Places Radar watches" id="ag-places" count={s.places.length} />
        <Table label="Places Radar watches" cols="minmax(0, 1fr) minmax(0, 2fr)" colsPhone="minmax(0, 1fr)" className="v2-in-tbl" closed
          columns={[{ label: "Place" }, { label: "Why it is watched" }]}>
          {s.places.map((p: string) => (
            <Row key={p}>
              <Cell className="v2-in-name"><span className="v2-in-name__t">{place(p)}</span></Cell>
              <Cell><ul className="v2-in-why">{(s.why?.[p] ?? []).map((w: string, k: number) => { const [tag, text] = whyParts(w, names); return <li key={k}>{tag && <b>{tag}: </b>}{text}</li>; })}</ul></Cell>
            </Row>))}
        </Table>
      </section>
      <div className="v2-in-two">
        <section aria-labelledby="ag-topics" className="v2-in-sec">
          <SectionHead title="Topics" id="ag-topics" count={s.themes.length} />
          <ul className="v2-in-words">{s.themes.map((t: string) => <li key={t}>{THEME_WORDS[t] ?? t}</li>)}</ul>
        </section>
        <section aria-labelledby="ag-names" className="v2-in-sec">
          <SectionHead title="Names" id="ag-names" count={s.actors.length} />
          <ul className="v2-in-words">{s.actors.map((a: string) => <li key={a}>{actorName(a)}</li>)}</ul>
        </section>
      </div>
      {role === "platform_admin" && (
        <section aria-labelledby="ag-full" className="v2-in-sec">
          <SectionHead title="The full context" id="ag-full" action={<Button size="sm" aria-expanded={raw} onClick={() => setRaw(!raw)}>{raw ? "Hide" : "Show"} JSON</Button>} />
          {raw && <pre className="v2-in-json" tabIndex={0}>{JSON.stringify(c, null, 2)}</pre>}
        </section>)}
    </div>
  );
}
