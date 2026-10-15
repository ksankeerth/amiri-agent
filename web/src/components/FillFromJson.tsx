// "Fill from a JSON file": loads a file into the form's own fields, so the person checks and edits it, then saves.
// Nothing is saved by this. A file with several items offers a pick list.
import { useId, useState } from "react";
import { Icon } from "./Icon";
import { parseJson, type Candidate } from "./fillJson";

export function FillFromJson({ what, read, onFill, example }: {
  what: string;                                  // "a product", "the institution": what the form is about
  read: (doc: unknown) => Candidate[];           // what the file holds (components/fillJson.ts)
  onFill: (c: Candidate) => void | Promise<void>;
  example?: string;                              // the shape a file may have, shown under the button
}) {
  const id = useId();
  const [file, setFile] = useState<string | null>(null);
  const [cands, setCands] = useState<Candidate[]>([]);
  const [at, setAt] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fill = async (c: Candidate) => {
    setBusy(true);
    try { await onFill(c); setMsg(null); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  const load = async (f: File) => {
    setMsg(null);
    const p = parseJson(await f.text());
    if (!p.ok) { setFile(null); setCands([]); setMsg(p.error); return; }
    const found = read(p.doc);
    if (!found.length) { setFile(null); setCands([]); setMsg(`Nothing in ${f.name} to fill ${what} with.${example ? ` Expected: ${example}.` : ""}`); return; }
    setFile(f.name); setCands(found); setAt(0);
    await fill(found[0]);
  };
  return (
    <div className="fillfile" style={{ gridColumn: "1 / -1" }}>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <label className="btn btn--sm" title={`Load ${what} from a JSON file into this form; nothing is saved until you do`}>
          <Icon name="plus" />Fill from a JSON file
          <input type="file" accept="application/json,.json" className="sr" aria-describedby={`${id}-msg`}
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) load(f); }} /></label>
        {file && cands.length > 1 && (
          <label className="row" style={{ gap: 6, alignItems: "center" }}><span className="small muted">Which one</span>
            <select className="input" style={{ width: "auto", maxWidth: 320 }} value={at} disabled={busy}
              onChange={e => { const n = Number(e.target.value); setAt(n); fill(cands[n]); }}>
              {cands.map((c, i) => <option key={i} value={i}>{c.label}</option>)}</select></label>)}
        <span id={`${id}-msg`} className={`small ${msg ? "errtext" : "muted"}`} role="status">
          {msg ?? (file ? `Filled from ${file}${cands.length > 1 ? ` (${cands.length} in the file)` : ""}: check it, then save.` : "")}</span>
      </div>
    </div>
  );
}
