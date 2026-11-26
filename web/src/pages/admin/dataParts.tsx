// The left side of the Data connection page: the five-step strip, the source cards, the sample's conditions, and the
// file import (choose, look at it, confirm). The check's result is in ResultPanel.tsx.
import { useId, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { connectApi, type Connection } from "../../api/connect";
import { useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { RadioGroup, Switch } from "../../components/v2/Choice";
import { FileDrop } from "../../components/v2/FilePicker";
import { Pill } from "../../components/v2/Pill";
import { plural } from "../../format";
import { CONDITIONS_SHOWN, conditionsFor, moreConditions, moreLine, sampleOff, scenarioParam, SOURCES, startWords, type Kind, type SourceId, type StripStep } from "./dataWords";
import { bulkWords, coverWords, dateWords, fileProblem, peekImport, rangeWords, sizeWords, uploadWords, type Peek, type UploadProblem } from "./importWords";

// ---------------------------------------------------------------- the five steps
/** A list of steps; the current one is marked for assistive technology. The bar is full where a step is done. */
export function Steps({ steps }: { steps: StripStep[] }) {
  return (
    <ol className="v2-ad-steps" aria-label="Steps to connect your data">
      {steps.map(s => (
        <li key={s.n} className={`v2-ad-step${s.done ? " is-done" : ""}${s.current ? " is-current" : ""}`} aria-current={s.current ? "step" : undefined}>
          <span className="v2-ad-step__bar" aria-hidden="true" />
          <span className="v2-ad-step__t">{s.n} · {s.name}{s.done && <span className="v2-sr"> (done)</span>}</span>
          <span className="v2-ad-step__n">{s.note}</span>
        </li>))}
    </ol>
  );
}

// ---------------------------------------------------------------- step 1: the source cards
export function SourceCards({ choice, kind, onPick }: { choice: SourceId | null; kind: Kind; onPick: (s: SourceId) => void }) {
  const head = useId();
  return (
    <section>
      <h2 id={head} className="v2-ad-h2">1 · Source</h2>
      <RadioGroup variant="cards" legend="Source" legendHidden value={choice} onChange={onPick}
        options={SOURCES.map(s => ({ value: s.id, label: s.title, description: s.line, disabled: !!sampleOff(s.id, kind), why: sampleOff(s.id, kind) ?? undefined }))} />
    </section>
  );
}

// ---------------------------------------------------------------- step 2: the sample's conditions
function CondRow({ label, note, startDaysAgo, on, onChange }: { label: string; note: string; startDaysAgo: number; on: boolean; onChange: (on: boolean) => void }) {
  const t = useId();
  return (
    <div className="v2-ad-cond">
      <Switch checked={on} onChange={e => onChange(e.target.checked)} aria-labelledby={`${t}-t`} aria-describedby={`${t}-n`}
        label={<span className="v2-ad-cond__main">
          <span id={`${t}-t`} className="v2-ad-cond__t">{label}</span>
          <span id={`${t}-n`} className="v2-ad-cond__n">{note} {startWords(startDaysAgo)}.</span>
        </span>} />
      <Pill>Data effect</Pill>
    </div>
  );
}

/** What the sample shows. Two conditions in view; the rest under "N more conditions". */
export function Conditions({ kind, on, onToggle, children }: { kind: Kind; on: string[]; onToggle: (id: string, on: boolean) => void; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const list = conditionsFor(kind);
  const more = moreConditions(kind, on);
  const rowOf = (c: (typeof list)[number]) => <CondRow key={c.id} label={c.label} note={c.note} startDaysAgo={c.startDaysAgo} on={on.includes(c.id)} onChange={v => onToggle(c.id, v)} />;
  const listId = useId();
  return (
    <section>
      <div className="v2-ad-h2row"><h2 className="v2-ad-h2">2 · Conditions</h2><span className="v2-ad-opt">optional</span></div>
      <div className="v2-ad-conds">
        {list.slice(0, CONDITIONS_SHOWN).map(rowOf)}
        {open && <div id={listId}>{list.slice(CONDITIONS_SHOWN).map(rowOf)}</div>}
      </div>
      {more.count > 0 && <button type="button" className="v2-ad-more" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen(o => !o)}>
        <span aria-hidden="true">{open ? "▾" : "▸"} </span>{open ? "Fewer conditions" : moreLine(more)}</button>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- using a sample
/** "Use the sample bank": fetches the sample with the chosen conditions and imports it, as the file import does. */
export function UseSample({ kind, on, conn, locked, onImported }: { kind: Kind; on: string[]; conn: Connection; locked: boolean; onImported: (c: Connection) => void }) {
  const toast = useToast(), refuse = useRefusalToast();
  const [busy, setBusy] = useState<"get" | "send" | null>(null);
  const scenario = scenarioParam(kind, on);
  const what = kind === "bank" ? "the sample bank" : "the sample insurer";
  const go = async () => {
    setBusy("get");
    try {
      const { blob, name } = await connectApi.example(scenario);
      setBusy("send");
      const c = await connectApi.importFile(blob, name);
      onImported(c); toast(`Using ${what}: check it next.`);
    } catch (e) { refuse(e, `Couldn't use ${what}`); }
    finally { setBusy(null); }
  };
  return (
    <div className="v2-ad-use">
      <div className="v2-ad-use__row">
        <Button variant="primary" locked={locked} disabled={!!busy} busy={!!busy} aria-describedby="ad-use-note" onClick={go}>{`Use ${what}`}</Button>
        <a className="v2-ad-link" href={connectApi.exampleHref(scenario)} download>Download as JSON</a>
      </div>
      <p id="ad-use-note" className="v2-ad-fine" role={busy ? "status" : undefined}>
        {busy === "get" ? "Preparing the sample: about 15 MB, a few seconds…" : busy === "send" ? "Sending it and checking every row…"
          : conn.configured ? "Replaces the data now loaded. You check and approve again." : "Nothing is changed until you press the button."}</p>
    </div>
  );
}

// ---------------------------------------------------------------- an upload's refusal
function UploadError({ id, problem }: { id: string; problem: UploadProblem }) {
  return (
    <div id={id} className="v2-ad-err" role="alert">
      <p><span aria-hidden="true">◆ </span><b>{problem.headline}</b></p>
      {problem.items.length > 0 && <ul>{problem.items.map((x, i) => <li key={i} className="v2-mono">{x}</li>)}
        {problem.more > 0 && <li>and {plural(problem.more, "more problem")}</li>}</ul>}
    </div>
  );
}

// ---------------------------------------------------------------- Import a JSON file
interface Picked { file: File; peek: Peek }

/** Choose a file (or drop it), look at it, see what it brings, then confirm. The server checks every row; a refusal says
 *  where (line for a syntax error, field for a value) and nothing is stored. */
export function FileImport({ conn, locked, onImported }: { conn: Connection; locked: boolean; onImported: (c: Connection) => void }) {
  const toast = useToast(), refuse = useRefusalToast();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [problem, setProblem] = useState<UploadProblem | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const errId = useId();

  const refuse1 = (why: string) => { setPicked(null); setProblem({ headline: "Nothing was imported.", items: [why], more: 0 }); };
  const take = async (file: File) => {
    setProblem(null); setPicked(null);
    setReading(file.name);
    try {
      const r = peekImport(await file.text());
      if (r.ok) setPicked({ file, peek: r.peek }); else setProblem(r.problem);
    } catch { setProblem({ headline: "The file couldn't be read.", items: [], more: 0 }); }
    finally { setReading(null); }
  };
  const send = async () => {
    if (!picked) return;
    setSending(true); setProblem(null);
    try {
      const c = await connectApi.importFile(picked.file, picked.file.name);
      onImported(c); toast(`Imported ${picked.file.name}: check it next.`); setPicked(null);
    } catch (e) {
      const p = e instanceof ApiError ? e.problem : null;
      if (p && ["invalid_import", "invalid_json", "too_large"].includes(p.code)) setProblem(uploadWords(p));
      else refuse(e, "Couldn't import the file");
    } finally { setSending(false); }
  };

  const p = picked?.peek;
  return (
    <div className="v2-ad-file">
      {!picked && (
        <FileDrop variant="zone" accept="application/json,.json" validate={f => fileProblem(f, conn.max_import_mb)} onFile={take} onReject={refuse1}
          label={reading ? `Reading ${reading}…` : sending ? "Sending…" : "Drop a JSON file here"}
          hint={`One file in the Metrics Spec format, up to ${conn.max_import_mb} MB.`}
          pickLabel="Choose a file" size="md" locked={locked} disabled={!!reading || sending}
          aria-describedby={problem ? errId : undefined} aria-invalid={problem ? true : undefined}>
          <a className="v2-ad-link" href={connectApi.exampleUrl} download>Download an example file</a>
        </FileDrop>)}
      {problem && <UploadError id={errId} problem={problem} />}
      {picked && p && (
        <div className="v2-ad-peek" role="group" aria-label="What will be imported">
          <b className="v2-ad-peek__h">What will be imported</b>
          <dl className="v2-ad-kv">
            <dt>File</dt><dd><span className="v2-mono">{picked.file.name}</span> · {sizeWords(picked.file.size)}</dd>
            <dt>Covers</dt><dd>{coverWords(p)} · {bulkWords(p)}</dd>
            {p.from && p.until && <><dt>Period</dt><dd>{rangeWords(p)}</dd></>}
            <dt>As of</dt><dd>{dateWords(p.as_of)}</dd>
            {p.about && <><dt>About</dt><dd>{p.about}</dd></>}
          </dl>
          <p className="v2-ad-fine">The server checks every row when you import. {conn.configured ? "This replaces the data now loaded; you check and approve again." : "Nothing is saved unless all of it is valid."}</p>
          <div className="v2-ad-drop__row">
            <Button variant="primary" locked={locked} disabled={sending} busy={sending} busyLabel="Importing…" onClick={send}>Import this file</Button>
            <Button variant="quiet" disabled={sending} onClick={() => { setPicked(null); setProblem(null); }}>Choose another file</Button>
          </div>
        </div>)}
    </div>
  );
}
