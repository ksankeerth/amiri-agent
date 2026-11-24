// The Institution page (ongoing edits) and its shared loading. Everything here works
// without the assistant: forms, suggestion pickers and link grids on the profile API.
import { Fragment, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { inst, type HistoryRow, type InstitutionSummary, type Item, type Profile, type Readiness } from "../../api/institutions";
import type { Installation } from "../../App";
import { Icon } from "../../components/Icon";
import { WithChat } from "../../components/SetupChat";
import { changeWords, countOf, fieldWord, SECTION_ONE, valueText } from "../../components/setupFlow";
import { StatusPill } from "../../components/blocks";
import { PageTitle, Section, TextButton, TextTabs } from "../../components/rd";
import { ChatToggleCtx, DEMOS, InlineSkeleton, LoadError, Modal, PageHead, ResetModal, useRole, useToast, PageSkeleton, StatusIcon } from "../../components/ui";
import { dayTime, person, plural, ZONE_LABEL } from "../../format";
import { cap, words } from "../../plain";
import { PlaceName, useLoad } from "./fields";
import { InstitutionFields, InstitutionModal, splitErrors, useHiddenErrors, type Ctx } from "./forms";
import { Overview } from "./overview";
import { LinkGrid, SectionList } from "./sections";
import { DraftFromProfile } from "../monitors/Monitors";
import "../../styles/setup.css";
import "../../styles/rd-institution.css";

// ---------------------------------------------------------------- loading

const KEY = "amiri.institution";
export function useInstitution() {
  const [list, setList] = useState<InstitutionSummary[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [id, setId] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  const loadList = useCallback(async () => {
    try {
      const l = await inst.list();
      setList(l);
      setId(cur => (cur && l.some(x => x.institution_id === cur) ? cur : l.find(x => x.status !== "archived")?.institution_id ?? l[0]?.institution_id ?? null));
    } catch (e) { setError(e); }
  }, []);
  const reload = useCallback(async () => {
    // no institution chosen: nothing to load, so an old error (a failed list) goes too; "Try again" then
    // loads the list afresh and sets it again only if that fails once more
    if (!id) { setProfile(null); setError(null); return; }
    try {
      const [p, r] = await Promise.all([inst.profile(id), inst.readiness(id)]);
      setProfile(p); setReadiness(r); setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { try { localStorage.removeItem(KEY); } catch { /* */ } loadList(); }
      else setError(e);
    }
  }, [id, loadList]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { reload(); }, [reload]);
  // a proposal confirmed in the assistant drawer changes the profile under this page
  useEffect(() => {
    const f = () => { reload(); };
    window.addEventListener("amiri:profile-changed", f);
    return () => window.removeEventListener("amiri:profile-changed", f);
  }, [reload]);
  const select = (x: string) => { setId(x); try { localStorage.setItem(KEY, x); } catch { /* */ } };
  const ctx: Ctx = { profile, type: profile?.institution.institution_type ?? "bank" };
  return { list, id, select, profile, readiness, error, reload: async () => { await reload(); loadList(); }, ctx, reloadList: () => { loadList(); window.dispatchEvent(new Event("amiri:installation")); } };
}

export type InstitutionState = ReturnType<typeof useInstitution>;

// ---------------------------------------------------------------- first run: create or import

export function CreateInstitution({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Record<string, any>>({ institution_type: "bank", clearing_currencies: [], islamic: false, fiscal_year_start_month: 1 });
  const [err, setErr] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { box, hidden } = useHiddenErrors(err);
  const create = async () => {
    setBusy(true); setErr({}); setGeneral([]);
    try {
      const body = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== ""));
      const i = await inst.create(body);
      toast(`${i.name} created. Next: where you operate.`);
      onCreated(i.institution_id);
    } catch (e) { const s = splitErrors(e); setErr(s.fields); setGeneral(s.general); }
    finally { setBusy(false); }
  };
  const importFile = async (f: File) => {
    try {
      const doc = JSON.parse(await f.text());
      const body = doc.institution && doc.sections ? { institution: pickCreate(doc.institution), sections: doc.sections } : doc;
      const i = await inst.import(body);
      toast(`Imported ${i.name}.`); onCreated(i.institution_id);
    } catch (e) { setGeneral(e instanceof ApiError ? [e.full] : [`Not a profile file: ${String(e)}`]); }
  };
  return (
    <div className="card"><div className="bd col" style={{ gap: 14 }}>
      <div><h2>Tell Amiri Agent about your institution</h2>
        <p className="small muted">Everything Amiri Agent watches and checks starts from this profile. Start with the basics; the next steps add where you operate, your customers, products, flows, rules, rivals and risks. Works with forms alone; the setup assistant is optional.</p></div>
      <div ref={box}><InstitutionFields d={d} set={(k, v) => setD(x => ({ ...x, [k]: v }))} err={err} creating
        fill={data => { setErr({}); setGeneral([]); setD(x => ({ ...x, ...data })); }} /></div>
      {general.concat(hidden).length > 0 && <div className="rawerr" role="alert">{general.concat(hidden).join(" · ")}</div>}
      <div className="row wrap"><label className="btn"><Icon name="plus" />Import a whole profile (creates everything)
        <input type="file" accept="application/json" className="sr" onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
        <span className="small muted">Download a demo's profile: {DEMOS.map((d, n) => <Fragment key={d.kind}>{n ? ", " : ""}<a href={`/api/v1/reference/demo-profile?kind=${d.kind}`} download>{d.label.toLowerCase()}</a></Fragment>)}</span>
        <span className="spacer" /><button className="btn btn--primary" type="button" disabled={busy} onClick={create}>Create and continue</button></div>
    </div></div>
  );
}

const CREATE_KEYS = ["institution_id", "name", "legal_name", "short_name", "institution_type", "subtype", "islamic", "lei", "home_country", "base_currency", "time_zone", "clearing_currencies", "summary", "governance_body", "size_band", "fiscal_year_start_month", "website"];
const pickCreate = (i: Record<string, any>) => Object.fromEntries(CREATE_KEYS.filter(k => i[k] !== undefined && i[k] !== null).map(k => [k, i[k]]));

// ---------------------------------------------------------------- shared pieces

export function ReadinessList({ r, onFix }: { r: Readiness; onFix?: (section: string) => void }) {
  return (
    <div className="list">{r.checks.map(c => (
      <div key={c.id} className="li" style={{ padding: "8px 0" }}>
        <StatusIcon status={c.ok ? "done" : c.level === "required" ? "required" : "open"} />
        <div className="col" style={{ gap: 2, flex: 1 }}>
          <span className="small" style={{ color: "var(--ink)" }}>{c.message}</span>
          {!c.ok && c.fix && <span className="small muted">{c.fix}</span>}
        </div>
        <span className="badge b-noeffect">{c.level === "required" ? "Required" : "Recommended"}</span>
        {!c.ok && onFix && c.section !== "institution" && <button className="btn btn--sm" type="button" onClick={() => onFix(c.section)}>Fix</button>}
      </div>))}</div>
  );
}

/** The profile's state, as a square chip with an icon: not a green dot, so it can't be read as the app bar's Live pill. */
export function StatusBadge({ status }: { status: string }) {
  const [tone, icon, word] = status === "active" ? ["blue", "check", "Profile active"] as const
    : status === "archived" ? ["grey", "box", "Archived"] as const : ["grey", "edit", "Being set up"] as const;
  return <span className="profile-state"><StatusPill tone={tone} icon={icon}
    title={status === "active" ? "The agents use this profile" : status === "archived" ? "The agents don't use this profile" : "Not active yet: the agents don't use it until it's activated"}>{word}</StatusPill></span>;
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- tabs

// short names, so the eight fit one row beside the Setup agent; the full name is the tooltip
const TABS = [
  ["overview", "Overview", "Overview"], ["customers", "Customers", "Customers and products"], ["footprint", "Footprint", "Footprint and flows"],
  ["rules", "Rules", "Rules"], ["rivals", "Rivals", "Rivals and partners"], ["risks", "Risks", "Risks"], ["history", "History", "History"],
  ["agents", "Agents' view", "What the agents see"],
] as const;
/** The map's takeaway: "Sri Lanka · money moves with 6 places abroad". */
const mapTitle = (p: Profile) => {
  const abroad = new Set(p.sections.flows.map(f => f.counterpart)).size;
  const home = p.place_names[p.institution.home_country] ?? p.institution.home_country;
  return abroad ? `${home} · money moves with ${plural(abroad, "place")} abroad` : `Where ${p.institution.short_name ?? p.institution.name} operates`;
};

const SOURCE_WORDS: Record<string, string> = { form: "a form", assistant: "the Setup agent", setup: "guided setup", import: "an import", system: "the system" };
const who = (actor: string, source: string) => `${actor === "anonymous" || !actor ? "System" : person(actor)} · via ${SOURCE_WORDS[source] ?? source}`;

/** One change as a sentence: "Added rival **Coastal Remit**". */
function ChangeSentence({ r, names }: { r: HistoryRow; names: Record<string, string | null> }) {
  const w = changeWords(r, "done", names);
  return <>{w.lead} {w.name && <b>{w.name}</b>}{w.tail ? ` ${w.tail}` : ""}</>;
}

/** Before and after as a field list, not JSON. */
function BeforeAfter({ r }: { r: HistoryRow }) {
  const keys = [...new Set([...Object.keys(r.before ?? {}), ...Object.keys(r.after ?? {})])]
    .filter(k => r.op !== "update" || JSON.stringify(r.before?.[k]) !== JSON.stringify(r.after?.[k]));
  if (!keys.length) return <span className="small muted">No field changes.</span>;
  return (
    <div className="diff hist-diff">{keys.map(k => (
      <Fragment key={k}><span className="k">{fieldWord(k)}</span><span>
        {r.before && <del>{valueText(r.before[k])}</del>}{r.before && r.after && <span aria-hidden="true"> → </span>}{r.after && <ins>{valueText(r.after[k])}</ins>}</span></Fragment>))}</div>
  );
}

function History({ id, pv, onChanged, readOnly, names }: { id: string; pv: number; onChanged: () => void; readOnly: boolean; names: Record<string, string | null> }) {
  const toast = useToast();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [undo, setUndo] = useState<Awaited<ReturnType<typeof inst.undo>> | null>(null);
  const askUndo = async (batchId: string) => {
    try { setUndo(await inst.undo(id, batchId)); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const doUndo = async () => {
    if (!undo) return;
    try { await inst.batch(id, undo.operations); toast("Undone."); setUndo(null); onChanged(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  // one row per save: a batch of changes (an import, an applied proposal) reads as one line with a count
  const batches: HistoryRow[][] = [];
  { const at = new Map<string, HistoryRow[]>(); for (const r of rows) { let b = at.get(r.batch_id); if (!b) { b = []; at.set(r.batch_id, b); batches.push(b); } b.push(r); } }
  const summary = (b: HistoryRow[]) => {
    const by = new Map<string, number>();
    for (const r of b) by.set(r.section, (by.get(r.section) ?? 0) + 1);
    return [...by].map(([s, n]) => countOf(s, n)).join(", ");
  };
  useEffect(() => { inst.history(id).then(r => { setRows(r.items); setNext(r.next_before); }).catch(() => {}); }, [id, pv]);
  return (
    <Section title="Every change" meta={`what changed, when, and who made it (a form, the Setup agent, an import) · ${ZONE_LABEL} time`} className="ins-hist-sec">
      {!batches.length ? <p className="rd-row-d ins-none">No changes yet.</p> : (
        <table className="rd-table ins-hist">
          <thead><tr><th scope="col">When</th><th scope="col">What changed</th><th scope="col">By</th><th scope="col"><span className="sr">Actions</span></th></tr></thead>
          <tbody>{batches.map(b => { const r = b[0], k = r.batch_id; return (<Fragment key={k}>
            <tr>
              <td className="ins-when">{dayTime(r.at)}</td>
              <td className="ins-what">{b.length === 1 ? <ChangeSentence r={r} names={names} />
                : <>{r.source === "import" ? "Imported" : "Saved"} <b>{plural(b.length, "change")}</b>: {summary(b)}</>}</td>
              <td>{who(r.actor, r.source)}</td>
              <td><div className="ins-acts"><TextButton aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>{open === k ? "Hide" : "Details"}</TextButton>
                {!readOnly && r.op !== "status" && <TextButton title="Undo this whole save" onClick={() => askUndo(k)}>Undo</TextButton>}</div></td>
            </tr>
            {open === k && <tr className="ins-opened"><td colSpan={4}><div className="rd-open">{b.length === 1 ? <BeforeAfter r={r} />
              : <ul className="hist-items ins-items">{b.map(x => <li key={x.change_id}><ChangeSentence r={x} names={names} /></li>)}</ul>}</div></td></tr>}
          </Fragment>); })}</tbody>
        </table>)}
      {next && <p className="ins-more"><TextButton onClick={() => inst.history(id, next).then(r => { setRows(x => [...x, ...r.items]); setNext(r.next_before); })}>Older changes</TextButton></p>}
      {undo && <Modal title="Undo this change?" onClose={() => setUndo(null)} footer={<>
        <button className="btn" type="button" onClick={() => setUndo(null)}>Cancel</button>
        <button className="btn btn--primary" type="button" disabled={!undo.valid} onClick={doUndo}>Undo</button></>}>
        <p className="small muted">Saved by {who(undo.actor, undo.source)} on {dayTime(undo.at)}{undo.proposal_id ? ", from a Setup agent proposal" : ""}. Undoing it is a new change, kept in the history.</p>
        {undo.valid ? <ul className="small">{undo.changes.map((c, k) => { const w = changeWords(c, "propose", names); return <li key={k}>{c.op === "create" ? "Add back" : c.op === "delete" ? "Remove" : "Restore"} {w.name ? <b>{w.name}</b> : SECTION_ONE[c.section] ?? c.section}{w.name ? ` (${SECTION_ONE[c.section] ?? c.section})` : ""}</li>; })}</ul>
          : <div className="rawerr">Can't be undone as it stands: {undo.errors.map(e => e.message).join("; ")}</div>}
      </Modal>}
    </Section>
  );
}

const THEME_WORDS: Record<string, string> = {
  rates: "Interest rates", sector: "Banking and insurance", macro: "The economy", fx: "Exchange rates", commodities: "Commodities (oil, gold, food)",
  remittance: "Remittances", prices: "Prices and inflation", regulation: "Rules and regulators", disaster: "Disasters", trust: "Trust in banks",
  competitor: "Rivals' moves", markets: "Share and bond markets",
};
const WHY_TAG: Record<string, string> = { footprint: "Footprint", "place to watch": "Place to watch", flow: "Flow", risk: "Risk" };

/** "flow: remittances in with LK" → a tag "Flow" and "remittances in with Sri Lanka". */
function whyParts(w: string, names: Record<string, string | null>): [tag: string, text: string] {
  const m = /^(footprint|place to watch|flow|risk)\b:?\s*(.*)$/i.exec(w);
  const tag = m ? WHY_TAG[m[1].toLowerCase()] : "";
  let text = (m ? m[2] : w).replace(/\b([A-Z]{2}(?:-\w+)?)\b/g, c => names[c] ?? c);
  if (tag === "Footprint") text = text.replace(/^\((.*)\)$/, "$1");
  return [tag, cap(text)];
}

function AgentsView({ id, pv, names, regulators }: { id: string; pv: number; names: Record<string, string | null>; regulators: Item[] }) {
  const { role } = useRole();
  const [c, setC] = useState<Record<string, any> | null>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => { inst.context(id).then(setC).catch(() => {}); }, [id, pv]);
  if (!c) return <InlineSkeleton />;
  const s = c.radar_scope;
  const actorName = (a: string) => { const r = regulators.find(x => x.short === a); return r ? `${r.name}${r.name.includes(`(${a})`) ? "" : ` (${a})`}` : a; };
  return (
    <div className="ins-agents">
      <p className="rd-prose ins-lead">Radar reads news about these places, topics and names. Code works them out from your profile (version {c.profile_version}); the monitors, the investigation and the Setup agent read the same profile.</p>
      <Section title="Places Radar watches" count={s.places.length}>
        <table className="rd-table ins-why">
          <thead><tr><th scope="col">Place</th><th scope="col">Why it is watched</th></tr></thead>
          <tbody>{s.places.map((p: string) => (
            <tr key={p}><td className="rd-strong"><PlaceName code={p} names={names} /></td>
              <td><ul className="ins-whyl">{(s.why?.[p] ?? []).map((w: string, k: number) => { const [tag, text] = whyParts(w, names); return (
                <li key={k}>{tag && <b className="ins-k">{tag}: </b>}{text}</li>); })}</ul></td></tr>))}</tbody>
        </table>
      </Section>
      <div className="ins-two">
        <Section title="Topics" count={s.themes.length}>
          <ul className="ins-words">{s.themes.map((t: string) => <li key={t}>{THEME_WORDS[t] ?? t}</li>)}</ul></Section>
        <Section title="Names" count={s.actors.length}>
          <ul className="ins-words">{s.actors.map((a: string) => <li key={a}>{actorName(a)}</li>)}</ul></Section>
      </div>
      {role === "platform_admin" && <Section title="The full context" action={<TextButton aria-expanded={raw} onClick={() => setRaw(!raw)}>{raw ? "Hide" : "Show"} JSON</TextButton>}>
        {raw && <pre className="ins-json">{JSON.stringify(c, null, 2)}</pre>}</Section>}
    </div>
  );
}

// ---------------------------------------------------------------- the page

/** A text action that opens a short list of actions (a popover, closed by Escape, a click outside or a choice). */
function TextMenu({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="menu ins-menu" ref={box}>
      <button type="button" className="rd-tbtn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(o => !o)}>{label} <span aria-hidden="true">▾</span></button>
      {open && <div className="menu-pop ins-menu-pop" role="group" aria-label={label} onClick={() => setOpen(false)}>{children}</div>}
    </div>
  );
}

/** "Commercial bank in Sri Lanka": the type in plain words. */
const typeWords = (i: Profile["institution"]) =>
  `${i.subtype ? `${cap(words(i.subtype))} ${i.institution_type === "bank" ? "bank" : "insurer"}` : i.institution_type === "bank" ? "Bank" : "Insurer"}${i.islamic ? " (Islamic)" : ""}`;

/** Everything about the institution that isn't on the first screen: opened from the status line. */
function AboutPanel({ profile, id, open }: { profile: Profile; id: string; open: boolean }) {
  const i = profile.institution, c = i.counts;
  return (
    <div id={id} className="rd-open rd-prose ins-about" hidden={!open}>
      {i.summary && <p>{i.summary}</p>}
      <dl className="ins-kv">
        <dt>Time zone</dt><dd>{i.time_zone}</dd>
        <dt>Owns risk decisions</dt><dd>{i.governance_body ?? "—"}</dd>
        <dt>Settles abroad in</dt><dd>{i.clearing_currencies?.join(", ") || "—"}</dd>
        <dt>Also in the profile</dt><dd><Link className="rd-go" to="/institution/footprint">{plural(c.footprint, "place")} in the footprint</Link>{" · "}
          <Link className="rd-go" to="/institution/footprint">{plural(c["watch-places"], "place")} to watch</Link>{" · "}
          <Link className="rd-go" to="/institution/rivals">{plural(c.counterparties, "firm")} you depend on</Link></dd>
        <dt>Version</dt><dd>{i.profile_version} · changed {dayTime(i.updated_at)} ({ZONE_LABEL} time)</dd>
      </dl>
      <p className="rd-fine">Amiri Agent reads this profile to decide what matters to you: where you operate, your customers and products, your flows, rules, rivals and risks.</p>
    </div>
  );
}

export function InstitutionPage() {
  const S = useInstitution();
  const { tab = "overview" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const [resetting, setResetting] = useState(false);
  const [about, setAbout] = useState(false);
  const aboutId = useId();
  const [drafting, setDrafting] = useState<{ section: string; item_id: string } | null>(null);
  const installation = useLoad(() => api<Installation>("/api/v1/installation"));
  const { profile, readiness, ctx, list } = S;

  if (!TABS.some(([k]) => k === tab)) return <Navigate to="/institution" replace />;  // an unknown tab: the overview
  if (S.error != null && !profile) return <div className="page rd"><PageTitle title="Institution" /><LoadError error={S.error} onRetry={S.reload} what="the institution" /></div>;
  if (list === null) return <PageSkeleton />;
  const follow = (t: { tab: string | null }) => { if (t.tab) nav(`/institution/${t.tab}`); };
  const applied = (p: { kind: string; result: Record<string, any> | null }) => {
    if (p.kind === "create_institution" && p.result?.institution_id) { S.select(p.result.institution_id); S.reloadList(); }
    else S.reload();
  };
  if (!list.length) return (
    <WithChat institutionId={null} onTrack={follow} onApplied={applied}><div className="page rd rd-inst">
      <PageTitle title="Institution" lede="Not set up yet. Fill in the form, or tell the Setup agent." actions={<Link className="rd-tbtn" to="/institution/setup">Guided setup</Link>} />
      <CreateInstitution onCreated={id => { S.select(id); S.reloadList(); nav("/institution/setup/where"); }} />
    </div></WithChat>
  );
  if (!profile || !readiness) return <PageSkeleton />;
  const i = profile.institution;
  const archived = i.status === "archived";
  // Monitors belong to the institution this installation serves.
  const monitorButton = (section: string) => installation?.institution_id === i.institution_id && !archived
    ? (it: Item) => <TextButton title="Draft a monitor from this item; you check it before it's submitted"
        onClick={() => setDrafting({ section, item_id: it.id })}>Draft a monitor</TextButton>
    : undefined;
  const act = async (a: "activate" | "archive" | "restore") => {
    try { await inst.status(i.institution_id, a); toast(a === "activate" ? "Active: Amiri Agent now uses this profile." : a === "archive" ? "Archived." : "Restored."); S.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const remove = async () => {
    try { await inst.remove(i.institution_id); toast("Deleted."); setConfirm(null); S.reloadList(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const setup = i.status === "setup";
  const stateWords = i.status === "active" ? ["Active:", "Amiri Agent uses this profile"] : archived ? ["Archived:", "Amiri Agent does not use this profile"] : ["Being set up:", "Amiri Agent does not use it until it is activated"];

  return (
    <WithChat institutionId={i.institution_id} onTrack={follow} onApplied={applied} at={{ tab }}><PageRoot>
      <PageTitle
        title={i.name}
        actions={<>
          {!archived && <TextButton onClick={() => setEditing(true)}>Edit details</TextButton>}
          <Link className="rd-tbtn" to="/institution/setup">Guided setup</Link>
          <TextMenu label="More">
            <button className="rd-tbtn ins-mi" type="button" onClick={() => download(`${i.institution_id}-profile.json`, { institution: pickCreate(i as any), sections: profile.sections })}>Export the profile (JSON)</button>
            {installation?.prototype_reset !== false && <button className="rd-tbtn ins-mi ins-danger" type="button" onClick={() => setResetting(true)}>Reset the prototype…</button>}
            {setup && <button className="rd-tbtn ins-mi ins-danger" type="button" onClick={() => setConfirm("delete")}>Delete this institution…</button>}
          </TextMenu>
          <SetupAgentToggle />
          {setup && <button className="btn btn--primary" type="button" disabled={!readiness.ready} title={readiness.ready ? "" : "Required parts are missing"} onClick={() => act("activate")}>Activate</button>}
          {archived && <button className="btn btn--primary" type="button" onClick={() => act("restore")}>Restore</button>}
        </>}
        status={<>
          <span><b className="ins-state">{stateWords[0]}</b> {stateWords[1]}</span>
          <span>{typeWords(i)} in <PlaceName code={i.home_country} names={profile.place_names} /></span>
          <span>{i.base_currency}</span>
          <TextButton aria-expanded={about} aria-controls={aboutId} onClick={() => setAbout(a => !a)}>About this institution</TextButton></>}
        help={<AboutPanel profile={profile} id={aboutId} open={about} />} />
      {archived && <p className="rd-warn ins-banner"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> Archived: Amiri Agent does not use this profile and it can't be changed. Restore it to edit.</p>}
      {!archived && !readiness.ready && <p className="rd-warn ins-banner"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> <b>{plural(readiness.missing_required, "required part")} missing</b> before it can go live. <Link className="rd-go" to="/institution/setup">Continue the guided setup →</Link></p>}
      {setup && readiness.ready && <p className="rd-fine ins-banner">Everything required is there. Activate to let Amiri Agent use this profile{readiness.open_recommendations ? `; ${plural(readiness.open_recommendations, "recommendation")} still open` : ""}.</p>}
      <TextTabs label="Parts of the profile" value={tab} onChange={k => nav(`/institution/${k}`)} items={TABS.map(([key, label]) => ({ key, label }))} />

      {tab === "overview" && <Overview profile={profile} readiness={readiness} setup={setup} mapTitle={mapTitle(profile)} onEdit={() => setEditing(true)} />}
      {tab === "customers" && <>
        <SectionList rd section="segments" ctx={ctx} reload={S.reload} suggest />
        <SectionList rd section="products" ctx={ctx} reload={S.reload} suggest />
        <LinkGrid rd ctx={ctx} rows="products" cols="segments" field="segments" reload={S.reload} title="Edit who uses which product" summary="the same links as the “For” column, as a grid you can tick" />
      </>}
      {tab === "footprint" && <>
        <SectionList rd section="footprint" ctx={ctx} reload={S.reload} />
        <SectionList rd section="flows" ctx={ctx} reload={S.reload} suggest itemAction={monitorButton("flows")} />
        <LinkGrid rd ctx={ctx} rows="flows" cols="segments" field="segments" reload={S.reload} title="Edit which customer groups each flow concerns" summary="a grid you can tick" />
        <SectionList rd section="watch-places" ctx={ctx} reload={S.reload} />
      </>}
      {tab === "rules" && <SectionList rd section="regulators" ctx={ctx} reload={S.reload} suggest itemAction={monitorButton("regulators")}
        note={`Regulators come from a rule table: your home and other countries, the currencies you settle in abroad (${i.clearing_currencies?.join(", ") || "none set; add them in Edit details"}), and global standards for your type. Your compliance team still needs to review it.`} />}
      {tab === "rivals" && <>
        <SectionList rd section="rivals" ctx={ctx} reload={S.reload} suggest itemAction={monitorButton("rivals")} />
        <SectionList rd section="counterparties" ctx={ctx} reload={S.reload} itemAction={monitorButton("counterparties")} />
      </>}
      {tab === "risks" && <SectionList rd section="risk-exposures" ctx={ctx} reload={S.reload} suggest itemAction={monitorButton("risk-exposures")}
        note="The risk finder (Suggestions) checks a library of known hazards against your footprint, customer groups, flows and the sea routes your goods take. Code only, no model. Dismiss what doesn't apply and it won't be offered again." />}
      {tab === "history" && <History id={i.institution_id} pv={i.profile_version} onChanged={S.reload} readOnly={archived} names={profile.place_names} />}
      {tab === "agents" && <AgentsView id={i.institution_id} pv={i.profile_version} names={profile.place_names} regulators={profile.sections.regulators} />}

      {drafting && <DraftFromProfile only={drafting} onClose={() => setDrafting(null)} />}
      {editing && <InstitutionModal profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); S.reload(); }} />}
      {resetting && <ResetModal onClose={() => setResetting(false)} />}
      {confirm && <Modal title={confirm === "archive" ? `Archive ${i.name}?` : `Delete ${i.name}?`} onClose={() => setConfirm(null)} footer={<>
        <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
        <button className="btn btn--danger" type="button" onClick={() => (confirm === "archive" ? (setConfirm(null), act("archive")) : remove())}>{confirm === "archive" ? "Archive" : "Delete"}</button></>}>
        <p>{confirm === "archive" ? "Amiri Agent stops using this profile and it can't be changed until restored. Nothing is deleted." : "It was never activated, so it is deleted with its whole profile and history."}</p>
      </Modal>}
    </PageRoot></WithChat>
  );
}

/** The page's root; narrower rules apply while the Setup agent's panel takes a third of the width. */
function PageRoot({ children }: { children: ReactNode }) {
  const chat = useContext(ChatToggleCtx);
  return <div className={`page rd rd-inst${chat?.open ? " ins-narrow" : ""}`}>{children}</div>;
}

/** "Setup agent", among the title's actions while its panel is closed. */
function SetupAgentToggle() {
  const chat = useContext(ChatToggleCtx);
  return chat && !chat.open ? <TextButton onClick={chat.toggle}>Setup agent</TextButton> : null;
}

/** Setting up another institution (scenario S41): the form, with a fresh setup chat beside it. */
export function NewInstitutionPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [has, setHas] = useState<boolean | null>(null);
  useEffect(() => { inst.list().then(xs => setHas(xs.some(x => x.status !== "archived"))).catch(() => setHas(false)); }, []);
  if (has === null) return <PageSkeleton />;
  if (has) return <Navigate to="/institution" replace />;  // one institution per platform
  return (
    <WithChat institutionId={null} onApplied={p => { if (p.kind === "create_institution" && p.result?.institution_id) {
      try { localStorage.setItem(KEY, p.result.institution_id); } catch { /* */ } nav("/institution/overview"); } }}>
      <div className="page">
        <PageHead title="New institution" crumbs={<Link to="/institution">Institution</Link>}
          sub="Tell Amiri Agent who you are: a bank or an insurer, where you operate, and who your customers are. The setup agent can do it with you." />
        <CreateInstitution onCreated={id => { try { localStorage.setItem(KEY, id); } catch { /* */ } toast("Created."); nav("/institution/setup/where"); }} />
      </div>
    </WithChat>
  );
}
