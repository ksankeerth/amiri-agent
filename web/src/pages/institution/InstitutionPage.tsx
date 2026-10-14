// The Institution page (ongoing edits) and its shared loading. Everything here works
// without the assistant: forms, suggestion pickers and link grids on the profile API.
import { Fragment, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../../api/client";
import { inst, type HistoryRow, type InstitutionSummary, type Item, type Profile, type Readiness } from "../../api/institutions";
import type { Installation } from "../../App";
import { Icon } from "../../components/Icon";
import { WithChat } from "../../components/SetupChat";
import { Banner, MenuButton, Modal, PageHead, ResetModal, useToast, PageSkeleton } from "../../components/ui";
import { dayTime, plural } from "../../format";
import { PlaceName, useLoad } from "./fields";
import { InstitutionFields, InstitutionModal, LABELS, splitErrors, type Ctx } from "./forms";
import { ProfileMap } from "./ProfileMap";
import { LinkGrid, SectionList } from "./sections";
import { DraftFromProfile } from "../monitors/Monitors";

// ---------------------------------------------------------------- loading

const KEY = "amiri.institution";
export function useInstitution() {
  const [list, setList] = useState<InstitutionSummary[] | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [id, setId] = useState<string | null>(() => { try { return localStorage.getItem(KEY); } catch { return null; } });
  const loadList = useCallback(async () => {
    try {
      const l = await inst.list();
      setList(l);
      setId(cur => (cur && l.some(x => x.institution_id === cur) ? cur : l.find(x => x.status !== "archived")?.institution_id ?? l[0]?.institution_id ?? null));
    } catch (e) { setError(e instanceof ApiError ? e.full : String(e)); }
  }, []);
  const reload = useCallback(async () => {
    if (!id) { setProfile(null); return; }
    try {
      const [p, r] = await Promise.all([inst.profile(id), inst.readiness(id)]);
      setProfile(p); setReadiness(r); setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { try { localStorage.removeItem(KEY); } catch { /* */ } loadList(); }
      else setError(e instanceof ApiError ? e.full : String(e));
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
  return { list, id, select, profile, readiness, error, reload: async () => { await reload(); loadList(); }, ctx, reloadList: loadList };
}

export type InstitutionState = ReturnType<typeof useInstitution>;

// ---------------------------------------------------------------- first run: create or import

export function CreateInstitution({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const [d, setD] = useState<Record<string, any>>({ institution_type: "bank", clearing_currencies: [], islamic: false, fiscal_year_start_month: 1 });
  const [err, setErr] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
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
      <InstitutionFields d={d} set={(k, v) => setD(x => ({ ...x, [k]: v }))} err={err} creating />
      {general.length > 0 && <div className="rawerr">{general.join(" · ")}</div>}
      <div className="row"><label className="btn"><Icon name="plus" />Import a profile (JSON)
        <input type="file" accept="application/json" hidden onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} /></label>
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
        <span className={`statusdot ${c.ok ? "sd-ok" : c.level === "required" ? "sd-down" : c.level === "info" ? "sd-off" : "sd-warn"}`} style={{ marginTop: 6 }} />
        <div className="col" style={{ gap: 2, flex: 1 }}>
          <span className="small" style={{ color: "var(--ink)" }}>{c.message}</span>
          {!c.ok && c.fix && <span className="small muted">{c.fix}</span>}
        </div>
        <span className={`badge ${c.level === "required" ? (c.ok ? "b-ok" : "b-down") : c.level === "info" ? "b-noeffect" : c.ok ? "b-ok" : "b-warn"}`}>{c.level.toUpperCase()}</span>
        {!c.ok && onFix && c.section !== "institution" && <button className="btn btn--sm btn--ghost" type="button" onClick={() => onFix(c.section)}>Fix</button>}
      </div>))}</div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${status === "active" ? "b-ok" : status === "archived" ? "b-paused" : "b-sub"}`}>{status.toUpperCase()}</span>;
}

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------- tabs

const TABS = [
  ["overview", "Overview"], ["customers", "Customers and products"], ["footprint", "Footprint and flows"], ["rules", "Rules"],
  ["rivals", "Rivals and partners"], ["risks", "Risks"], ["history", "History"], ["agents", "What the agents see"],
] as const;
const TAB_OF_SECTION: Record<string, string> = {
  footprint: "footprint", "watch-places": "footprint", flows: "footprint", segments: "customers", products: "customers",
  regulators: "rules", rivals: "rivals", counterparties: "rivals", "risk-exposures": "risks", institution: "overview",
};

function History({ id, pv, onChanged, readOnly }: { id: string; pv: number; onChanged: () => void; readOnly: boolean }) {
  const toast = useToast();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [undo, setUndo] = useState<Awaited<ReturnType<typeof inst.undo>> | null>(null);
  const askUndo = async (batchId: string) => {
    try { setUndo(await inst.undo(id, batchId)); } catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const doUndo = async () => {
    if (!undo) return;
    try { await inst.batch(id, undo.operations); toast("Undone."); setUndo(null); onChanged(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const firstOfBatch = new Set<number>();
  { const seen = new Set<string>(); for (const r of rows) if (!seen.has(r.batch_id)) { seen.add(r.batch_id); firstOfBatch.add(r.change_id); } }
  useEffect(() => { inst.history(id).then(r => { setRows(r.items); setNext(r.next_before); }).catch(() => {}); }, [id, pv]);
  return (
    <div className="card">
      <div className="hd"><h2>Every change</h2><span className="small muted">who, from where (form, assistant, setup, import), and what changed</span></div>
      <div className="tblwrap"><table className="tbl">
        <thead><tr><th>When</th><th>Who</th><th>From</th><th>What</th><th>Change</th><th><span className="sr">Actions</span></th></tr></thead>
        <tbody>{rows.map(r => (<Fragment key={r.change_id}>
          <tr>
            <td className="num small">{dayTime(r.at)}</td><td className="small">{r.actor}</td><td className="small">{r.source}</td>
            <td className="small">{LABELS[r.section as keyof typeof LABELS]?.one ?? r.section} <span className="mono muted">{r.item_id ?? ""}</span></td>
            <td className="small">{r.op}{r.op === "update" && r.after ? `: ${Object.keys(r.after).join(", ")}` : ""}</td>
            <td><div className="row" style={{ gap: 4 }}><button className="btn btn--sm btn--ghost" type="button" onClick={() => setOpen(open === r.change_id ? null : r.change_id)}>{open === r.change_id ? "Hide" : "Details"}</button>
              {!readOnly && firstOfBatch.has(r.change_id) && r.op !== "status" && <button className="btn btn--sm" type="button" title="Undo this whole save" onClick={() => askUndo(r.batch_id)}>Undo</button>}</div></td>
          </tr>
          {open === r.change_id && <tr><td colSpan={6}><div className="grid2">
            <div><div className="label">Before</div><pre className="mono small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(r.before, null, 1) ?? "—"}</pre></div>
            <div><div className="label">After</div><pre className="mono small" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{JSON.stringify(r.after, null, 1) ?? "—"}</pre></div></div></td></tr>}
        </Fragment>))}</tbody>
      </table></div>
      {next && <div className="bd"><button className="btn btn--sm" type="button" onClick={() => inst.history(id, next).then(r => { setRows(x => [...x, ...r.items]); setNext(r.next_before); })}>Older changes</button></div>}
      {undo && <Modal title="Undo this change?" onClose={() => setUndo(null)} footer={<>
        <button className="btn" type="button" onClick={() => setUndo(null)}>Cancel</button>
        <button className="btn btn--primary" type="button" disabled={!undo.valid} onClick={doUndo}>Undo</button></>}>
        <p className="small muted">Saved by {undo.actor} ({undo.source}) on {dayTime(undo.at)}{undo.proposal_id ? ", from a setup agent proposal" : ""}. Undoing it is a new change, kept in the history.</p>
        {undo.valid ? <ul className="small">{undo.changes.map((c, k) => <li key={k}>{c.op === "create" ? "Add back" : c.op === "delete" ? "Remove" : "Restore"} {LABELS[c.section as keyof typeof LABELS]?.one ?? c.section} <span className="mono">{c.id ?? ""}</span></li>)}</ul>
          : <div className="rawerr">Can't be undone as it stands: {undo.errors.map(e => e.message).join("; ")}</div>}
      </Modal>}
    </div>
  );
}

function AgentsView({ id, pv, names }: { id: string; pv: number; names: Record<string, string | null> }) {
  const [c, setC] = useState<Record<string, any> | null>(null);
  const [raw, setRaw] = useState(false);
  useEffect(() => { inst.context(id).then(setC).catch(() => {}); }, [id, pv]);
  if (!c) return <div className="muted small">Loading…</div>;
  const s = c.radar_scope;
  const chips = (xs: ReactNode[]) => <div className="row wrap" style={{ gap: 6 }}>{xs.map((x, i) => <span key={i} className="chip">{x}</span>)}</div>;
  return (
    <div className="col gap16">
      <Banner kind="info">This is the profile as the agents read it (Radar, monitors, the investigation and the assistant), with the Radar scope worked out from it by code. Profile version {c.profile_version}.</Banner>
      <div className="grid2">
        <div className="card"><div className="hd"><h2>Radar watches these places, because</h2></div><div className="bd col" style={{ gap: 6 }}>
          {s.places.map((p: string) => <div key={p} className="small"><span className="chip"><PlaceName code={p} names={names} /></span> <span className="muted">{(s.why?.[p] ?? []).join(" · ")}</span></div>)}</div></div>
        <div className="card"><div className="hd"><h2>…for news about</h2></div><div className="bd">{chips(s.themes)}</div>
          <div className="hd"><h2>…and these names</h2></div><div className="bd">{chips(s.actors)}</div></div>
      </div>
      <div className="card"><div className="hd"><h2>The full context</h2><span className="spacer" /><button className="btn btn--sm" type="button" onClick={() => setRaw(!raw)}>{raw ? "Hide" : "Show"} JSON</button></div>
        {raw && <div className="bd"><pre className="mono small" style={{ whiteSpace: "pre-wrap", margin: 0, maxHeight: 520, overflow: "auto" }}>{JSON.stringify(c, null, 2)}</pre></div>}</div>
    </div>
  );
}

// ---------------------------------------------------------------- the page

export function InstitutionPage() {
  const S = useInstitution();
  const { tab = "overview" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | "archive" | "delete">(null);
  const [resetting, setResetting] = useState(false);
  const [drafting, setDrafting] = useState<{ section: string; item_id: string } | null>(null);
  const installation = useLoad(() => api<Installation>("/api/v1/installation"));
  const { profile, readiness, ctx, list } = S;

  if (S.error && !profile) return <div className="page"><PageHead title="Institution" /><Banner kind="crit" icon="warn">{S.error}</Banner></div>;
  if (list === null) return <PageSkeleton />;
  const follow = (t: { tab: string | null }) => { if (t.tab) nav(`/institution/${t.tab}`); };
  const applied = (p: { kind: string; result: Record<string, any> | null }) => {
    if (p.kind === "create_institution" && p.result?.institution_id) { S.select(p.result.institution_id); S.reloadList(); }
    else S.reload();
  };
  if (!list.length) return (
    <WithChat institutionId={null} onTrack={follow} onApplied={applied}><div className="page">
      <PageHead title="Institution" sub="Not set up yet. Fill in the form, or tell the setup agent." actions={<Link className="btn" to="/institution/setup">Guided setup</Link>} />
      <CreateInstitution onCreated={id => { S.select(id); S.reloadList(); nav("/institution/setup/where"); }} />
    </div></WithChat>
  );
  if (!profile || !readiness) return <PageSkeleton />;
  const i = profile.institution;
  const archived = i.status === "archived";
  // Monitors belong to the institution this installation serves.
  const monitorButton = (section: string) => installation?.institution_id === i.institution_id && !archived
    ? (it: Item) => <button className="btn btn--sm btn--ghost" type="button" title="Draft a monitor from this item; you check it before it's submitted"
        onClick={() => setDrafting({ section, item_id: it.id })}><Icon name="monitor" />Draft a monitor</button>
    : undefined;
  const goFix = (section: string) => nav(`/institution/${TAB_OF_SECTION[section] ?? "overview"}`);
  const act = async (a: "activate" | "archive" | "restore") => {
    try { await inst.status(i.institution_id, a); toast(a === "activate" ? "Active: the agents now use this profile." : a === "archive" ? "Archived." : "Restored."); S.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const remove = async () => {
    try { await inst.remove(i.institution_id); toast("Deleted."); setConfirm(null); S.reloadList(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };

  return (
    <WithChat institutionId={i.institution_id} onTrack={follow} onApplied={applied}><div className="page">
      <PageHead
        title={<span className="row" style={{ gap: 10 }}>{i.name} <StatusBadge status={i.status} /></span>}
        sub={<>{i.institution_type === "bank" ? "Bank" : "Insurer"}{i.subtype ? ` · ${i.subtype.replace(/_/g, " ")}` : ""}{i.islamic ? " · Islamic" : ""} · <PlaceName code={i.home_country} names={profile.place_names} /> · {i.base_currency} · {i.time_zone}{i.summary ? <><br />{i.summary}</> : null}</>}
        actions={<>
          <Link className="btn" to="/institution/setup"><Icon name="check" />Guided setup</Link>
          {!archived && <button className="btn" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit details</button>}
          <MenuButton label="More">
              <button className="btn btn--ghost" type="button" onClick={() => download(`${i.institution_id}-profile.json`, { institution: pickCreate(i as any), sections: profile.sections })}>Export the profile (JSON)</button>
              <button className="btn btn--ghost btn--danger" type="button" onClick={() => setResetting(true)}><Icon name="refresh" />Reset the prototype…</button>
          </MenuButton>
          {i.status === "setup" && <button className="btn btn--primary" type="button" disabled={!readiness.ready} title={readiness.ready ? "" : "Required parts are missing"} onClick={() => act("activate")}>Activate</button>}
          {archived && <button className="btn btn--primary" type="button" onClick={() => act("restore")}>Restore</button>}
          {i.status === "setup" && <button className="btn btn--danger" type="button" onClick={() => setConfirm("delete")}><Icon name="trash" /></button>}
        </>} />
      <div className="banners">
        {archived && <Banner kind="warn" icon="warn">Archived: the agents don't use this profile and it can't be changed. Restore it to edit.</Banner>}
        {!archived && !readiness.ready && <Banner kind="warn" icon="warn"><b>{plural(readiness.missing_required, "required part")} missing</b> before it can go live. <Link to="/institution/setup">Continue the guided setup</Link> or use the tabs.</Banner>}
        {i.status === "setup" && readiness.ready && <Banner kind="info">Everything required is there. <b>Activate</b> to let the agents use this profile{readiness.open_recommendations ? `; ${plural(readiness.open_recommendations, "recommendation")} still open` : ""}.</Banner>}
      </div>
      <div className="tabs" role="tablist" aria-label="Parts of the profile">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => nav(`/institution/${k}`)}>{label}</button>)}
      </div>

      {tab === "overview" && <div className="col gap16">
        <div className="card"><div className="bd"><ProfileMap profile={profile} /></div></div>
        <div className="grid2">
          <div className="card"><div className="hd"><h2>Ready to go live?</h2></div><div className="bd"><ReadinessList r={readiness} onFix={goFix} /></div></div>
          <div className="card"><div className="hd"><h2>In the profile</h2></div><div className="bd"><div className="kv">
            {Object.entries(LABELS).map(([s, l]) => <Fragment key={s}><div className="k">{l.many}</div><div className="v"><Link to={`/institution/${TAB_OF_SECTION[s]}`}>{i.counts[s as keyof typeof i.counts]}</Link></div></Fragment>)}
            <div className="k">Owns risk decisions</div><div className="v">{i.governance_body ?? "—"}</div>
            <div className="k">Settles abroad in</div><div className="v">{i.clearing_currencies?.join(", ") || "—"}</div>
            <div className="k">Profile version</div><div className="v">{i.profile_version} · changed {dayTime(i.updated_at)}</div>
          </div></div></div>
        </div>
        {readiness.warnings.length > 0 && <div className="card"><div className="hd"><h2>Worth a look</h2></div><div className="bd col" style={{ gap: 6 }}>
          {readiness.warnings.map((w, k) => <div key={k} className="small"><span className="badge b-warn">{(w.section ?? "").toUpperCase()}</span> {w.message} <span className="mono muted">{w.id}</span></div>)}</div></div>}
      </div>}
      {tab === "customers" && <div className="col gap16">
        <SectionList section="segments" ctx={ctx} reload={S.reload} suggest />
        <SectionList section="products" ctx={ctx} reload={S.reload} suggest />
        <LinkGrid ctx={ctx} rows="products" cols="segments" field="segments" reload={S.reload} title="Who uses which product" />
      </div>}
      {tab === "footprint" && <div className="col gap16">
        <SectionList section="footprint" ctx={ctx} reload={S.reload} />
        <SectionList section="flows" ctx={ctx} reload={S.reload} suggest itemAction={monitorButton("flows")} />
        <LinkGrid ctx={ctx} rows="flows" cols="segments" field="segments" reload={S.reload} title="Which customer groups each flow concerns" />
        <SectionList section="watch-places" ctx={ctx} reload={S.reload} />
      </div>}
      {tab === "rules" && <div className="col gap16">
        <Banner kind="info">Regulators come from a rule table: your home and other countries, the currencies you settle in abroad ({i.clearing_currencies?.join(", ") || "none set; add them in Edit details"}), and global standards for your type. The table still needs review by your compliance team.</Banner>
        <SectionList section="regulators" ctx={ctx} reload={S.reload} suggest itemAction={monitorButton("regulators")} />
      </div>}
      {tab === "rivals" && <div className="col gap16">
        <SectionList section="rivals" ctx={ctx} reload={S.reload} itemAction={monitorButton("rivals")} />
        <SectionList section="counterparties" ctx={ctx} reload={S.reload} itemAction={monitorButton("counterparties")} />
      </div>}
      {tab === "risks" && <div className="col gap16">
        <Banner kind="info">The risk finder (Suggestions) checks a library of known hazards against your footprint, customer groups, flows and the sea routes your goods take. Code only; no model. Dismiss what doesn't apply and it won't be offered again.</Banner>
        <SectionList section="risk-exposures" ctx={ctx} reload={S.reload} suggest itemAction={monitorButton("risk-exposures")} />
      </div>}
      {tab === "history" && <History id={i.institution_id} pv={i.profile_version} onChanged={S.reload} readOnly={archived} />}
      {tab === "agents" && <AgentsView id={i.institution_id} pv={i.profile_version} names={profile.place_names} />}

      {drafting && <DraftFromProfile only={drafting} onClose={() => setDrafting(null)} />}
      {editing && <InstitutionModal profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); S.reload(); }} />}
      {resetting && <ResetModal onClose={() => setResetting(false)} />}
      {confirm && <Modal title={confirm === "archive" ? `Archive ${i.name}?` : `Delete ${i.name}?`} onClose={() => setConfirm(null)} footer={<>
        <button className="btn" type="button" onClick={() => setConfirm(null)}>Cancel</button>
        <button className="btn btn--danger" type="button" onClick={() => (confirm === "archive" ? (setConfirm(null), act("archive")) : remove())}>{confirm === "archive" ? "Archive" : "Delete"}</button></>}>
        <p>{confirm === "archive" ? "The agents stop using this profile and it can't be changed until restored. Nothing is deleted." : "It was never activated, so it is deleted with its whole profile and history."}</p>
      </Modal>}
    </div></WithChat>
  );
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
