// The forms and pickers of the Institution page, in v2: add or edit one item (a dialog), the institution's own details, the
// code-made suggestions, and an import from a JSON file. The fields are the profile's own controls (fields.tsx, forms.tsx);
// this file is the dialogs around them and how a save ends.
//
// Saving: every save sends the version it was opened on (If-Match). When someone else saved first the server says so (409 or
// 412): the dialog keeps what was typed, puts it on the clipboard at once, and offers Reload (their version) or Copy my changes.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "../../api/client";
import { inst, type Item, type Profile, type SectionName } from "../../api/institutions";
import { ref } from "../../api/reference";
import { FillFromJson } from "../../components/FillFromJson";
import { askSetupAgent } from "../../components/useSetupChat";
import { draftFrom, itemsOf } from "../../components/fillJson";
import { useDemoLock } from "../../components/lock";
import { useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Dialog } from "../../components/v2/Dialog";
import { EditConflict } from "../../components/v2/EditConflict";
import { ago, person } from "../../format";
import { BODIES, DEFAULTS, InstitutionFields, LABELS, META, same, splitErrors, useHiddenErrors, type Ctx, type Draft, type Errors } from "./forms";
import { useImportItems, useSuggestionPicker } from "./profileKit";
import { changesText, isStale } from "./words";

/** What a stale save shows: the other person's version of the thing, when the server can say who and when. */
interface Conflict { who: string; when: string; name: string }

async function describeConflict(iid: string, section: SectionName | "institution", id: string | null, name: string): Promise<Conflict> {
  try {
    const p = await inst.profile(iid);
    const it = section === "institution" ? p.institution : p.sections[section].find(x => x.id === id);
    const by = (it as { updated_by?: string | null } | undefined)?.updated_by;
    const at = (it as { updated_at?: string | null } | undefined)?.updated_at;
    return { who: by && by !== "anonymous" ? person(by) : "A colleague", when: at ? ago(at) : "", name };
  } catch { return { who: "A colleague", when: "", name }; }
}

/** Copy my changes (a button the person pressed: a refusal to copy is reported by it). */
const copy = (text: string) => navigator.clipboard.writeText(text);
/** The same, at once and without being asked, so the typed text is not lost: when the browser says no, Copy my changes asks again. */
const autoCopy = (text: string) => { try { navigator.clipboard?.writeText(text)?.catch(() => {}); } catch { /* no clipboard */ } };

/** What a save says back, at the top of the form: general errors in words, and a conflict. It is brought into view (the Save button is at
 *  the bottom, and the fields may have scrolled). */
function Problems({ general, conflict, what, text, onReload }: { general: string[]; conflict: Conflict | null; what: string; text: string; onReload: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (conflict || general.length) box.current?.scrollIntoView({ block: "nearest" }); }, [conflict, general.length]);
  if (!conflict && !general.length) return null;
  return (
    <div ref={box} className="v2-in-problems">
      {conflict && <EditConflict what={what} who={conflict.who} name={conflict.name} when={conflict.when} onReload={onReload} onCopy={() => copy(text)} className="v2-in-conflict" />}
      {general.length > 0 && <p className="v2-in-err" role="alert"><span aria-hidden="true">◆ </span>{general.join(" · ")}</p>}
    </div>
  );
}

/** Add or edit one item of a section. */
export function ItemDialog({ section, ctx, editing, initial, onClose, onSaved, onDelete }: {
  section: SectionName; ctx: Ctx; editing: Item | null; initial?: Draft; onClose: () => void; onSaved: () => void;
  /** Editing only: the footer's Delete; the page asks before deleting. */
  onDelete?: () => void;
}) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const iid = ctx.profile!.institution.institution_id;
  const [start] = useState<Draft>(() => (editing ? Object.fromEntries(Object.entries(editing).filter(([k]) => !META.has(k))) : { ...DEFAULTS[section](ctx), ...(initial ?? {}) }));
  const [d, setD] = useState<Draft>(start);
  const [err, setErr] = useState<Errors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: any) => setD(x => ({ ...x, [k]: v }));
  const Body = BODIES[section];
  const { box, hidden } = useHiddenErrors(err);
  const L = LABELS[section];
  const name = String(d[L.nameKey] ?? editing?.[L.nameKey] ?? "");
  const changed = () => Object.fromEntries(Object.entries(d).filter(([k, v]) => !same(v, start[k])));
  // a file's item fills the form's fields (to check and edit, then save); a regulator that only names its rule-table entry is
  // completed from that table, as the server does when it saves it
  const fillFrom = async (item: Record<string, any>) => {
    let it = item;
    if (section === "regulators" && it.regulator_id && !it.name) it = { ...(await ref.regulator(it.regulator_id)), ...it };
    // a risk that only names its hazard is completed from the hazard library (title, kind, months, places)
    if (section === "risk-exposures" && it.hazard_id && !it.title) {
      const h = (await ref.hazards()).find(x => x.hazard_id === it.hazard_id);
      if (h) it = { title: h.name, kind: h.kind, months: h.months, places: h.places, ...it };
    }
    setErr({}); setGeneral([]);
    setD(draftFrom(DEFAULTS[section](ctx), it, { keepId: !editing, base: editing ? start : undefined }));
  };
  const save = async () => {
    setBusy(true); setErr({}); setGeneral([]); setConflict(null);
    try {
      const { id: ownId, ...rest } = d;
      const r = editing
        ? await inst.patch_item(iid, section, editing, changed())
        : ownId  // from a file: other items refer to this id, so it is kept (the server takes it as the operation's id)
          ? await inst.batch(iid, [{ op: "create", section, id: String(ownId), data: rest }])
          : await inst.create_item(iid, section, d);
      toast(`${editing ? "Saved" : "Added"}.${r.warnings.length ? " Note: " + r.warnings.map(w => w.message).join("; ") : ""}`);
      onSaved();
    } catch (e) {
      if (editing && isStale(e)) {
        autoCopy(changesText(name, changed()));
        setConflict(await describeConflict(iid, section, editing.id, name));
      } else if (e instanceof ApiError && !(e.problem.errors as unknown[] | undefined)?.length) {
        refuse(e, "Couldn't save");
      } else { const s = splitErrors(e); setErr(s.fields); setGeneral(s.general); }
    } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={`${editing ? "Edit" : "Add a"} ${L.one}`} onClose={onClose} initialFocus=".v2-in-form input:not([type=file]), .v2-in-form select" footer={<>
      {editing && onDelete && <Button variant="quiet" className="v2-in-del" locked={locked} onClick={onDelete}>Delete this {L.one}</Button>}
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy} onClick={save}>{editing ? "Save" : "Add"}</Button></>}>
      <div className="v2-in-form">
        <p className="v2-in-reqtop"><span aria-hidden="true">*</span> means required; the rest is optional.</p>
        <Problems general={general.concat(hidden)} conflict={conflict} what={`this ${L.one}`} text={changesText(name, changed())}
          onReload={() => { setConflict(null); onSaved(); }} />
        <div className="grid2" ref={box}>
          <FillFromJson what={`${L.one === "place in the footprint" ? "a place" : "a " + L.one}`} read={doc => itemsOf(doc, section)} onFill={c => fillFrom(c.data)}
            example={`one ${L.one} as JSON, a list of them, {"items": [...]}, or a whole profile`} />
          <Body d={d} set={set} err={err} ctx={ctx} editing={editing} />
        </div>
      </div>
    </Dialog>
  );
}

const INSTITUTION_KEYS = ["name", "legal_name", "short_name", "institution_type", "subtype", "islamic", "lei", "home_country", "base_currency", "time_zone", "clearing_currencies", "summary", "governance_body", "size_band", "fiscal_year_start_month", "website"];

/** The institution's own details. */
export function DetailsDialog({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: () => void }) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const i = profile.institution;
  const [start] = useState<Draft>(() => Object.fromEntries(INSTITUTION_KEYS.map(k => [k, (i as any)[k] ?? null])));
  const [d, setD] = useState<Draft>(start);
  const [err, setErr] = useState<Errors>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);
  const { box, hidden } = useHiddenErrors(err);
  const changed = () => Object.fromEntries(Object.entries(d).filter(([k, v]) => !same(v, start[k])));
  const save = async () => {
    setBusy(true); setErr({}); setGeneral([]); setConflict(null);
    try {
      await inst.patch(i.institution_id, i.version, changed());
      toast("Saved."); onSaved();
    } catch (e) {
      if (isStale(e)) { autoCopy(changesText(i.name, changed())); setConflict(await describeConflict(i.institution_id, "institution", null, i.name)); }
      else if (e instanceof ApiError && !(e.problem.errors as unknown[] | undefined)?.length) refuse(e, "Couldn't save");
      else { const s = splitErrors(e); setErr(s.fields); setGeneral(s.general); }
    } finally { setBusy(false); }
  };
  return (
    <Dialog wide title="Institution details" onClose={onClose} initialFocus=".v2-in-form input:not([type=file])" footer={<>
      <Button variant="quiet" className="v2-in-ask" title="Close this form and tell the Setup agent instead; its changes wait for your Apply" onClick={() => { onClose(); askSetupAgent(); }}>Ask the Setup agent instead</Button>
      <Button onClick={onClose}>Cancel</Button>
      <Button variant="primary" locked={locked} disabled={busy} onClick={save}>Save</Button></>}>
      <div className="v2-in-form">
        <p className="v2-in-reqtop"><span aria-hidden="true">*</span> means required; the rest is optional.</p>
        <Problems general={general.concat(hidden)} conflict={conflict} what="the institution's details" text={changesText(i.name, changed())}
          onReload={() => { setConflict(null); onSaved(); }} />
        <div ref={box}><InstitutionFields d={d} set={(k, v) => setD(x => ({ ...x, [k]: v }))} err={err} creating={false}
          fill={data => { setErr({}); setGeneral([]); setD(x => ({ ...x, ...data })); }} /></div>
      </div>
    </Dialog>
  );
}

/** Suggestions made by code (the usual products, the rule table's regulators, the risk finder): tick, add in one batch. */
export function SuggestDialog({ section, ctx, onClose, onAdded }: { section: SectionName; ctx: Ctx; onClose: () => void; onAdded: () => void }) {
  const locked = useDemoLock();
  const { data, picked, err, busy, add, groups, open, textOf, tickAll, toggle } = useSuggestionPicker(section, ctx, onAdded);
  return (
    <Dialog wide title={`Suggested ${LABELS[section].many.toLowerCase()}`} onClose={onClose} footer={<>
      <span className="v2-in-req" aria-live="polite">{picked.size} ticked</span>
      {open > 0 && <Button variant="quiet" onClick={tickAll}>Tick all</Button>}
      <Button onClick={onClose}>Close</Button>
      <Button variant="primary" locked={locked} disabled={busy || !picked.size} onClick={add}>{picked.size ? `Add the ${picked.size} ticked` : "Add the ticked"}</Button></>}>
      {!data ? (err.length ? <p className="v2-in-err" role="alert">{err.join(" ")}</p> : <p className="v2-meta" role="status">Loading…</p>) : (
        <div className="v2-in-pick">
          <p className="v2-in-pick__note">{data.note} {open ? `${open} not added yet.` : "Everything here is already in your profile."}</p>
          <div role="group" aria-label="Suggestions">
            {[...groups.entries()].map(([g, idx]) => (
              <div key={g} className="v2-in-pick__g">
                {g && <h3 className="v2-cap">{g.replace(/_/g, " ")}</h3>}
                {idx.map(i => {
                  const s = data.items[i], t = textOf(i);
                  return (
                    <label key={i} className={`v2-in-pick__row${s.added ? " is-added" : ""}`}>
                      <input type="checkbox" disabled={s.added} checked={s.added || picked.has(i)} onChange={e => toggle(i, e.target.checked)} />
                      <span><span className="v2-in-pick__t">{t.title}{s.added && <span className="v2-in-pick__a"> · {s.status === "dismissed" ? "dismissed" : "already added"}</span>}</span>
                        <span className="v2-in-pick__s">{t.sub}</span></span>
                    </label>);
                })}
              </div>))}
          </div>
          {err.length > 0 && <p className="v2-in-err" role="alert"><span aria-hidden="true">◆ </span>{err.join(" · ")}</p>}
        </div>)}
    </Dialog>
  );
}

/** "Import": a file picker that looks like a button. The file is checked by the server first (a dry run, nothing written); what it
 *  holds is shown, and added only when confirmed, all or nothing. */
export function ImportItems({ section, iid, onAdded, children = "Import" }: { section: SectionName; iid: string; onAdded: () => void; children?: ReactNode }) {
  const locked = useDemoLock();
  const imp = useImportItems(section, iid, onAdded);
  const { ops, problems, busy } = imp;
  const many = LABELS[section].many.toLowerCase();
  return (
    <>
      <label className="v2-btn v2-btn--secondary v2-in-file" title={`Import ${many} from a JSON file`}>
        {children}
        <input type="file" accept="application/json" className="v2-sr" aria-label={`Import ${many} from a JSON file`}
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) imp.read(f); }} />
      </label>
      {ops !== null && (
        <Dialog title={`Import ${many}`} onClose={imp.close} footer={<>
          <Button onClick={imp.close}>Cancel</Button>
          <Button variant="primary" locked={locked} disabled={busy || !ops.length || problems.length > 0} onClick={imp.add}>Import {ops.length || ""}</Button></>}>
          {problems.length ? <p className="v2-in-err" role="alert"><span aria-hidden="true">◆ </span>{problems.join(" · ")}</p>
            : <p className="v2-in-dlgtext">{ops.length} {ops.length === 1 ? LABELS[section].one : many} checked and ready to add, all together.</p>}
          <p className="v2-meta">The file is a list of items, <span className="v2-mono">{"{\"items\": [...]}"}</span>, or a whole profile (its {many} are used).</p>
        </Dialog>)}
    </>
  );
}
