// New institution (P15b; no board draws it, decision D5: the shell, the tokens and the Institution page's forms): one calm form, the
// Setup agent beside it, and on to the guided setup once it is created. The form is also the guided setup's first screen when there is
// no institution yet. Creating, and importing a whole profile, are the two writes here; the demo lock greys both.
//
// Asking, and how often: the list of institutions once (to see whether there is one already: one institution per platform). Nothing polls.
import { FileDrop } from "../../components/v2/FilePicker";
import { Fragment, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { inst } from "../../api/institutions";
import type { Proposal } from "../../api/assistant";
import { useDemoLock } from "../../components/lock";
import { DEMOS, useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { LoadError } from "../../components/v2/LoadError";
import { useCrumbs } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { plural } from "../../format";
import { InstitutionFields, splitErrors, useHiddenErrors } from "./forms";
import { pickCreate } from "./profileFile";
import { SetupAgent, useAgentPanel } from "./SetupAgent";
import { INSTITUTION_KEY } from "./useInstitution";
import "../../styles/v2/institution.css";
import "../../styles/v2/setup.css";

/** The form: what an institution is, where it is and in what money, and a few optional lines. Create makes it; Import makes one from a
 *  profile file. `onCreated` gets the new id. */
export function NewInstitutionForm({ onCreated }: { onCreated: (id: string) => void }) {
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const [d, setD] = useState<Record<string, any>>({ institution_type: "bank", clearing_currencies: [], islamic: false, fiscal_year_start_month: 1 });
  const [err, setErr] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { box, hidden } = useHiddenErrors(err);
  const bad = Object.keys(err).length;

  // a refused save puts the cursor on the first field that needs another look
  useEffect(() => {
    if (bad) box.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus({ preventScroll: false });
  }, [err]);   // eslint-disable-line react-hooks/exhaustive-deps

  const made = (i: { institution_id: string; name: string }, said: string) => {
    toast(said);
    window.dispatchEvent(new Event("amiri:installation"));   // the app bar and the other pages learn there is an institution now
    onCreated(i.institution_id);
  };
  const create = async () => {
    if (locked || busy) return;
    setBusy(true); setErr({}); setGeneral([]);
    try {
      const body = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== null && v !== ""));
      const i = await inst.create(body);
      made(i, `${i.name} created. Next: where you operate.`);
    } catch (e) {
      if (e instanceof ApiError && !(e.problem.errors as unknown[] | undefined)?.length) refuse(e, "Couldn't create it");
      else { const s = splitErrors(e); setErr(s.fields); setGeneral(s.general); }
    } finally { setBusy(false); }
  };
  const importFile = async (f: File) => {
    setErr({}); setGeneral([]);
    try {
      const doc = JSON.parse(await f.text());
      const body = doc.institution && doc.sections ? { institution: pickCreate(doc.institution), sections: doc.sections } : doc;
      const i = await inst.import(body);
      made(i, `Imported ${i.name}.`);
    } catch (e) {
      if (e instanceof ApiError) refuse(e, "Couldn't import it");
      else setGeneral([`${f.name} isn't a profile file: ${e instanceof Error ? e.message : String(e)}`]);
    }
  };
  const problems = general.concat(hidden);
  return (
    <form className="v2-in-form v2-sw-form" noValidate onSubmit={e => { e.preventDefault(); create(); }} aria-labelledby="ni-h">
      <h2 id="ni-h" className="v2-sr">The institution's details</h2>
      <p className="v2-in-reqtop"><span aria-hidden="true">*</span> means required; the rest is optional.</p>
      {locked && <p className="v2-sw-lock" role="note"><span aria-hidden="true">◆</span> Creating an institution is switched off for this demo. You can still look around.</p>}
      {bad > 0 && <p className="v2-in-err v2-sw-sum" role="alert"><span aria-hidden="true">◆ </span>{plural(bad, "field")} to look at again. {bad === 1 ? "It is" : "They are"} marked below.</p>}
      <div ref={box}>
        <InstitutionFields grouped d={d} set={(k, v) => setD(x => ({ ...x, [k]: v }))} err={err} creating
          fill={data => { setErr({}); setGeneral([]); setD(x => ({ ...x, ...data })); }} />
      </div>
      {problems.length > 0 && <p className="v2-in-err v2-sw-sum" role="alert"><span aria-hidden="true">◆ </span>{problems.join(" · ")}</p>}
      <div className="v2-sw-formfoot">
        <Button type="submit" variant="primary" size="lg" locked={locked} disabled={busy} busy={busy} busyLabel="Creating…">Create and continue</Button>
        {locked ? <Button locked>Import a whole profile</Button>
          : <FileDrop accept="application/json,.json" noun="a JSON file" size="md" pickLabel="Import a whole profile" aria-label="Import a whole profile from a JSON file"
              onFile={importFile} onReject={why => { setErr({}); setGeneral([why]); }} />}
      </div>
      <p className="v2-meta v2-sw-demos">Already have a profile file? Import it to create everything at once. To try one, download a demo's profile: {DEMOS.map((x, n) => (
        <Fragment key={x.kind}>{n ? ", " : ""}<a href={`/api/v1/reference/demo-profile?kind=${x.kind}`} download>{x.label.toLowerCase()}</a></Fragment>))}.</p>
    </form>
  );
}

/** Setting up an institution from scratch (scenario S41): the form, with a fresh Setup agent beside it. */
export function NewInstitutionPage() {
  const nav = useNavigate();
  const panel = useAgentPanel();
  const [has, setHas] = useState<boolean | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = () => { setError(null); return inst.list().then(xs => setHas(xs.some(x => x.status !== "archived"))).catch(setError); };
  useEffect(() => { load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useCrumbs([{ label: "Your institution" }, { label: "New institution" }]);
  const remember = (id: string) => { try { localStorage.setItem(INSTITUTION_KEY, id); } catch { /* private mode */ } };

  const head = (btn?: boolean) => (
    <header className="v2-in-head">
      <div className="v2-in-head__t">
        <h1 className="v2-in-h1">New institution</h1>
        <p className="v2-in-sub1">Everything AMIRI Agent watches and checks starts from this profile. Start with the basics; the guided setup then asks about where you operate, your customers, products, flows, rules, rivals and risks.</p>
      </div>
      {btn && !panel.open && <div className="v2-in-head__btns"><Button onClick={() => panel.setOpen(true)} aria-haspopup={panel.sheet ? "dialog" : undefined}>Setup agent</Button></div>}
    </header>);
  if (error != null) {
    return <div className="v2-in-wrap"><div className="v2-in v2-sw">{head()}
      <LoadError error={error} onRetry={load} what="the institutions" safe="Nothing is lost; this page just couldn't reach them." /></div></div>;
  }
  if (has === null) return <div className="v2-in-wrap"><div className="v2-in v2-sw">{head()}<Skeleton rows={6} label="Loading" /></div></div>;
  if (has) return <Navigate to="/institution" replace />;   // one institution per platform
  return (
    <div className="v2-in-wrap">
      <div className="v2-in v2-sw">
        {head(true)}
        <NewInstitutionForm onCreated={id => { remember(id); nav("/institution/setup/where"); }} />
      </div>
      <SetupAgent panel={panel} institutionId={null} profileVersion={null} names={{}}
        onApplied={(p: Proposal) => { if (p.kind === "create_institution" && p.result?.institution_id) { remember(p.result.institution_id); window.dispatchEvent(new Event("amiri:installation")); nav("/institution"); } }} />
    </div>
  );
}
