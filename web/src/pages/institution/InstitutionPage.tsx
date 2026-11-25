// What the new-institution form and the guided setup still use from the old Institution page (they are restyled in P15):
// the first-run form, the go-live checklist, the page for setting up another institution, and the setup chat's toggle.
// The Institution page itself is in Institution.tsx (v2).
import { Fragment, useContext, useEffect, useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { inst, type Readiness } from "../../api/institutions";
import { WithChat } from "../../components/SetupChat";
import { PageTitle, Section, TextButton } from "../../components/rd";
import { LockBtn, LockFields, LockNote, useDemoLock } from "../../components/lock";
import { ChatToggleCtx, DEMOS, useToast, PageSkeleton } from "../../components/ui";
import { InstitutionFields, splitErrors, useHiddenErrors } from "./forms";
import { INSTITUTION_KEY, useInstitution } from "./useInstitution";
import { pickCreate } from "./profileFile";
import "../../styles/setup.css";
import "../../styles/rd-institution.css";
import "../../styles/rd-setup.css";

// the wizard and the pages above take the shared loading from here
export { useInstitution };

// ---------------------------------------------------------------- first run: create or import

export function CreateInstitution({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast();
  const locked = useDemoLock();
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
    <Section title="Tell Amiri Agent about your institution" className="rd-form">
      <p className="rd-row-d rd-prose rf-intro">Everything Amiri Agent watches and checks starts from this profile. Start with the basics; the next steps add where you operate, your customers, products, flows, rules, rivals and risks. Works with forms alone; the Setup agent is optional.</p>
      <p className="rd-fine rf-req"><span aria-hidden="true">*</span> means required; the rest is optional.</p>
      <LockNote />
      <LockFields><div ref={box} className="rf-fields"><InstitutionFields grouped d={d} set={(k, v) => setD(x => ({ ...x, [k]: v }))} err={err} creating
        fill={data => { setErr({}); setGeneral([]); setD(x => ({ ...x, ...data })); }} /></div></LockFields>
      {general.concat(hidden).length > 0 && <p className="rd-warn rf-err" role="alert"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {general.concat(hidden).join(" · ")}</p>}
      <p className="rd-fine rf-demos">Already have a profile file? Import it to create everything at once. To try one, download a demo's profile: {DEMOS.map((d, n) => <Fragment key={d.kind}>{n ? ", " : ""}<a href={`/api/v1/reference/demo-profile?kind=${d.kind}`} download>{d.label.toLowerCase()}</a></Fragment>)}.</p>
      <div className="rf-foot"><div className="rf-foot-in">
        {locked ? <LockBtn className="btn">Import a whole profile</LockBtn>
          : <label className="btn">Import a whole profile
            <input type="file" accept="application/json" className="sr" onChange={e => e.target.files?.[0] && importFile(e.target.files[0])} /></label>}
        <LockBtn className="btn btn--primary" disabled={busy} onClick={create}>Create and continue</LockBtn>
      </div></div>
    </Section>
  );
}

// ---------------------------------------------------------------- shared pieces

/** The go-live checks as ruled rows: what is open first (required, then recommended), what is done last. Each says its state in a
 *  shape and a word: ◆ required, ○ recommended, ● done. */
export function ReadinessList({ r, onFix }: { r: Readiness; onFix?: (section: string) => void }) {
  const rank = (c: Readiness["checks"][number]) => (c.ok ? 2 : c.level === "required" ? 0 : 1);
  const sorted = [...r.checks].sort((a, b) => rank(a) - rank(b));
  return (
    <ul className="ins-rows" aria-label="Checks before going live">{sorted.map(c => (
      <li key={c.id} className="rd-row ins-open-row">
        <div className="ins-main">
          <div className="rd-row-t ins-open-t">{c.message}</div>
          <p className="rd-row-m">
            <span className={!c.ok && c.level === "required" ? "rd-warn" : undefined}>
              <span className="rd-shape" aria-hidden="true">{c.ok ? "●" : c.level === "required" ? "◆" : "○"}</span>{" "}
              <b className="ins-k">{c.ok ? "Done" : c.level === "required" ? "Required, not done" : "Recommended, not done"}</b></span>
            {!c.ok && c.fix ? ` · ${c.fix}` : ""}</p>
        </div>
        {!c.ok && onFix && c.section !== "institution" && <div className="ins-acts"><TextButton onClick={() => onFix(c.section)}>Fix</TextButton></div>}
      </li>))}</ul>
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
      try { localStorage.setItem(INSTITUTION_KEY, p.result.institution_id); } catch { /* */ } nav("/institution/overview"); } }}>
      <PageRoot>
        <PageTitle title="New institution" crumbs={<Link to="/institution">Institution</Link>} actions={<SetupAgentToggle />} />
        <CreateInstitution onCreated={id => { try { localStorage.setItem(INSTITUTION_KEY, id); } catch { /* */ } toast("Created."); nav("/institution/setup/where"); }} />
      </PageRoot>
    </WithChat>
  );
}
