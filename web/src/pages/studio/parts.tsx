// The Scenario Studio's list column and its dialogs (board 09; states: board 15 B). The editor is in editor.tsx.
import { useId, useState, } from "react";
import { Link } from "react-router-dom";
import type { Custom, HeadlineIn, ScenarioRow, Simulation, Template } from "../../api/studio";
import { parseJson, scenariosOf } from "../../components/fillJson";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { Field, Input } from "../../components/v2/Field";
import { FileDrop } from "../../components/v2/FilePicker";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { WorldMark } from "../../components/v2/WorldMark";
import { dayTime, plural } from "../../format";
import { fillFromFile, goingText, rowMeta, tagsText, unavailableText, usedWords } from "./editorWords";

/** The page's heading: one h1, the "simulated" mark, one line on what this is. */
export function StudioHead({ name }: { name: string | null }) {
  return (
    <header className="v2-st-head">
      <div className="v2-st-head__row">
        <h1 className="v2-st-h1">Scenario Studio</h1>
        <Pill tone="sim">Simulated · live data untouched</Pill>
      </div>
      <p className="v2-st-lede">Play a what-if through the real agents and see what {name ?? "your institution"} would be told.</p>
    </header>
  );
}

/** One run goes at a time: who is running, the way into it, and a way to stop it (board 15 B "Another run is going"). */
export function GoingBanner({ sim, onStop, stopping }: { sim: Simulation; onStop: () => void; stopping: boolean }) {
  return (
    <div className="v2-st-going" role="status">
      <WorldMark world="studio" />
      <span className="v2-st-going__t"><b>Another run is going:</b> {goingText(sim)}. One run goes at a time.</span>
      <Button as="link" to={`/studio/run/${sim.sim_id}`} size="sm">Open it</Button>
      <Button size="sm" onClick={onStop} disabled={stopping} busy={stopping} busyLabel="Stopping…">Stop it</Button>
    </div>
  );
}

/** Your scenarios: the one open is marked (a bar and aria-current), the one running says so. */
export function ScenarioList({ items, openId, runningId }: { items: ScenarioRow[]; openId: string | undefined; runningId: string | undefined }) {
  const headId = useId();
  if (!items.length) return null;  // nothing saved: the pane previews a template instead (TemplatePreview)
  return (
    <section aria-labelledby={headId}>
      <SectionHead id={headId} title="Your scenarios" size="sm" />
          <ul className="v2-st-list">
            {items.map(s => {
              const running = s.scenario_id === runningId;
              return (
                <li key={s.scenario_id}>
                  <Link to={`/studio/${s.scenario_id}`} className={`v2-rowlink v2-st-item${s.scenario_id === openId ? " is-on" : ""}`} aria-current={s.scenario_id === openId ? "page" : undefined}>
                    <span className="v2-st-item__t">{s.title}</span>
                    <span className="v2-st-item__m">{rowMeta(s, running, iso => dayTime(iso).replace(/ \d\d:\d\d$/, ""))}</span>
                  </Link>
                </li>);
            })}
          </ul>
    </section>
  );
}

/** Start a new one: the server's list in the server's order (a region's own first). Unavailable ones say why. */
export function TemplateList({ templates, scenarios, onUse, busy }: { templates: Template[]; scenarios: ScenarioRow[]; onUse: (t: Template) => void; busy: boolean }) {
  const headId = useId();
  return (
    <section aria-labelledby={headId}>
      <SectionHead id={headId} title="Start a new one" size="sm" />
      <ul className="v2-st-tpls">
        {templates.map(t => {
          const own = t.template_id === "blank", off = !!t.unavailable;
          const used = usedWords(scenarios, t.template_id);
          return (
            <li key={t.template_id} className="v2-st-tpl">
              <div className="v2-st-tpl__main">
                <div className={`v2-st-tpl__t${off ? " is-off" : ""}`}>{t.title}</div>
                <div className="v2-st-tpl__d" title={t.summary}>{off ? unavailableText(t.unavailable!) : t.summary}</div>
                {!off && (t.tags.length > 0 || used) && <div className="v2-st-tpl__tags">{[tagsText(t.tags), used].filter(Boolean).join(" · ")}</div>}
              </div>
              <Button size="sm" variant={own ? "primary" : "secondary"} disabled={off || busy} onClick={() => onUse(t)}
                label={`${own ? "Write" : "Use"}: ${t.title}`}>{own ? "Write" : "Use"}</Button>
            </li>);
        })}
      </ul>
    </section>
  );
}

/** The pane when nothing is saved: the first template that can run here, read-only, with the way to use it (never an empty pane). */
export function TemplatePreview({ t, onUse, busy }: { t: Template; onUse: (t: Template) => void; busy: boolean }) {
  const own = t.template_id === "blank";
  return (
    <article className="v2-panel v2-st-panel v2-st-prev" aria-label={`Template: ${t.title}`}>
      <div className="v2-cap">{own ? "Write your own" : "Start with this template"}</div>
      <h2 className="v2-st-title">{t.title}</h2>
      <p className="v2-st-prev__sum">{t.summary}</p>
      {t.tags.length > 0 && <p className="v2-st-prev__tags">{tagsText(t.tags)}</p>}
      <div className="v2-st-prev__act">
        <Button variant="primary" disabled={busy} busy={busy} busyLabel="Creating…" onClick={() => onUse(t)}>{own ? "Write your own" : "Use this template"}</Button>
      </div>
    </article>
  );
}

/** Before a start: it clears the last run (board 15 B). */
export function StartDialog({ clears, onCancel, onGo }: { clears: string; onCancel: () => void; onGo: () => void }) {
  return (
    <Dialog title="Start a new run?" onClose={onCancel} actions={<><Button onClick={onCancel}>Cancel</Button><Button variant="primary" onClick={onGo}>Clear it and start</Button></>}>
      <p>The Studio keeps one run at a time. Starting this clears the last run of <b>{clears}</b>: its findings, events and the alerts it would raise.</p>
      <p className="v2-meta">Its recording stays, so you can replay it later.</p>
    </Dialog>
  );
}

/** Delete a scenario and its runs. */
export function DeleteDialog({ title, busy, onCancel, onGo }: { title: string; busy: boolean; onCancel: () => void; onGo: () => void }) {
  return (
    <Dialog tone="danger" title="Delete this scenario?" onClose={onCancel}
      actions={<><Button onClick={onCancel}>Keep it</Button><Button variant="primary" onClick={onGo} disabled={busy} busy={busy} busyLabel="Deleting…">Delete it</Button></>}>
      <p><b>{title}</b> and its runs will be gone. This can't be undone.</p>
    </Dialog>
  );
}

/** A name, and optionally a file's headlines and price move, for a scenario you write yourself. */
export function NewOwnDialog({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (title: string, custom: Custom) => void }) {
  const noteId = useId();
  const [title, setTitle] = useState("");
  const [custom, setCustom] = useState<Custom>({ headlines: [], prices: { direction: "none", size_pct: 0, ramp_days: 5 } });
  const [file, setFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = async (f: File) => {
    const p = parseJson(await f.text());
    if (!p.ok) { setFile(null); setError(p.error); return; }
    const found = scenariosOf(p.doc);
    if (!found.length) { setFile(null); setError(`Nothing in ${f.name} to fill a scenario with. Expected a name, headlines and a price move.`); return; }
    const x = fillFromFile(found[0].data, title);
    setTitle(x.title); setCustom({ headlines: x.headlines as HeadlineIn[], prices: x.prices });
    setFile(f.name); setError(null);
  };
  const n = custom.headlines?.length ?? 0, p = custom.prices;
  const go = () => { if (title.trim() && !busy) onCreate(title.trim(), custom); };
  return (
    <Dialog title="Write your own scenario" size="M" description="Name it, then write the headlines that arrive day by day and, if you like, how the exchange rate moves. AMIRI Agent's monitor reads your headlines and the investigation traces them to your products." onClose={onCancel} initialFocus="[data-name]"
      actions={<><Button onClick={onCancel}>Cancel</Button><Button variant="primary" disabled={busy || !title.trim()} onClick={go} busy={busy} busyLabel="Creating…">Create</Button></>}>
      <Field req label="Name">
        <Input data-name value={title} maxLength={120} placeholder="e.g. Port strike" autoComplete="off"
          onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); go(); } }} />
      </Field>
      <div className="v2-st-file">
        <FileDrop accept="application/json,.json" noun="a JSON file" pickLabel="Fill from a JSON file" aria-describedby={noteId} onFile={load} onReject={why => { setFile(null); setError(why); }} />
        <span id={noteId} className={`v2-meta${error ? " v2-st-err" : ""}`} role="status">
          {error ?? (file ? `Filled from ${file}: check it, then create.` : "Optional. Nothing is saved until you create it.")}</span>
      </div>
      {(n > 0 || (p && p.direction !== "none")) && (
        <p className="v2-meta">{n > 0 ? plural(n, "headline") : "No headlines"}{p && p.direction !== "none" ? `, and the rate moves ${p.size_pct}% ${p.direction} over ${p.ramp_days} days` : ""}: you can change them on the next page.</p>)}
    </Dialog>
  );
}
