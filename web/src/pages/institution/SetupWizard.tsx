// Guided setup without the assistant: the interview's steps as forms. Each step saves as
// it goes (every add is its own all-or-nothing change), so leaving keeps what's done.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { inst } from "../../api/institutions";
import { Icon } from "../../components/Icon";
import { askSetupAgent, WithChat } from "../../components/SetupChat";
import { Banner, LoadError, PageHead, useToast, PageSkeleton, StatusIcon, type Status } from "../../components/ui";
import "../../styles/setup.css";
import { CurrenciesField, Field, PlacePicker } from "./fields";
import { InstitutionModal } from "./forms";
import { CreateInstitution, ReadinessList, StatusBadge, useInstitution } from "./InstitutionPage";
import { ProfileMap } from "./ProfileMap";
import { MonitorsStep } from "../monitors/Monitors";
import { LinkGrid, SectionList, SuggestionPicker } from "./sections";
import { cap, words } from "../../plain";

const STEPS = [
  ["institution", "Institution", "Who you are"],
  ["where", "Where", "Where you operate"],
  ["customers", "Customers", "Who your customers are"],
  ["products", "Products", "What you sell, and to whom"],
  ["flows", "Flows", "Money and goods moving with places abroad"],
  ["rules", "Rules", "Regulators and rules that reach you"],
  ["rivals", "Rivals", "Rivals and firms you depend on"],
  ["risks", "Risks", "Risks that meet what you depend on"],
  ["monitors", "Monitors", "News to watch for what you depend on"],
  ["review", "Review", "Check and go live"],
] as const;
type Step = (typeof STEPS)[number][0];
const REQUIRED_BY_STEP: Partial<Record<Step, string[]>> = { institution: ["identity"], where: ["footprint_home"], customers: ["segments"], products: ["products"] };
const RECOMMENDED_BY_STEP: Partial<Record<Step, string[]>> = { customers: ["segment_mapping"], products: ["product_segments"], flows: ["flows"], rules: ["regulators"], rivals: ["rivals"], risks: ["risk_exposures"] };

/** "Commercial bank (Islamic)" rather than "bank · commercial". */
const kindText = (i: { institution_type: string; subtype?: string | null; islamic?: boolean }) => {
  const kind = i.subtype ? `${i.subtype.replace(/_/g, " ")} ${i.institution_type === "bank" ? "bank" : "insurer"}` : i.institution_type;
  return `${cap(kind)}${i.islamic ? " (Islamic)" : ""}`;
};
const STATE_WORDS: Record<Status, string> = { done: "done", partial: "recommended part still open", required: "required, not done", open: "not started" };

/** The two ways to answer a step, side by side: the form saves at once, the agent's changes wait for Apply. */
function TwoWays() {
  return (
    <div className="twoway">
      <span className="tw-opt"><Icon name="edit" /><span><b>Fill the form</b> · saved as you go</span></span>
      <span className="tw-or">or</span>
      <button type="button" className="tw-opt tw-ask" onClick={askSetupAgent}><Icon name="chat" />
        <span><b>Ask the Setup agent</b> · its changes wait for your Apply</span></button>
    </div>
  );
}

export function SetupWizard() {
  const S = useInstitution();
  const { step = "institution" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState("branches");
  const { profile, readiness, ctx } = S;
  const idx = STEPS.findIndex(s => s[0] === step);
  const cur = STEPS[Math.max(0, idx)];
  useEffect(() => { document.querySelector(".main")?.scrollTo({ top: 0 }); }, [step]);

  const follow = (t: { setup_step: string | null }) => { if (t.setup_step) nav(`/institution/setup/${t.setup_step}`); };
  const applied = (p: { kind: string; result: Record<string, any> | null }) => {
    if (p.kind === "create_institution" && p.result?.institution_id) { S.select(p.result.institution_id); S.reloadList(); }
    else S.reload();
  };
  // a failed load is not "no institution yet": say the server didn't answer instead of offering to create one
  if (S.error != null && !profile) return <div className="page"><PageHead title="Set up your institution" crumbs={<Link to="/institution">Institution</Link>} /><LoadError error={S.error} onRetry={S.reload} what="the institution" /></div>;
  if (S.list === null) return <PageSkeleton />;
  if (!S.list.length || !profile || !readiness) {
    return (
      <WithChat institutionId={null} onTrack={follow} onApplied={applied} at={{ step: "institution", label: `Step 1 · ${STEPS[0][1]}` }}><div className="page">
        <PageHead title="Set up your institution" sub={`Step 1 of ${STEPS.length} · Who you are`} crumbs={<Link to="/institution">Institution</Link>} />
        <TwoWays />
        <CreateInstitution onCreated={id => { S.select(id); S.reloadList(); nav("/institution/setup/where"); }} />
      </div></WithChat>
    );
  }
  const i = profile.institution;
  const ok = (ids: string[] | undefined) => (ids ?? []).every(id => readiness.checks.find(c => c.id === id)?.ok);
  const stepState = (s: Step): Status => (s === "review" ? (readiness.ready ? "done" : "open")
    : !ok(REQUIRED_BY_STEP[s]) ? (REQUIRED_BY_STEP[s] ? "required" : "open") : ok(RECOMMENDED_BY_STEP[s]) ? "done" : "partial");
  const states = STEPS.map(([k]) => stepState(k));
  const done = states.filter(x => x === "done").length;
  const next = STEPS[idx + 1]?.[0], prev = STEPS[idx - 1]?.[0];
  const addFootprint = async (code: string) => {
    try { await inst.create_item(i.institution_id, "footprint", { code, role }); toast("Added to the footprint."); S.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const setClearing = async (v: string[]) => {
    try { await inst.patch(i.institution_id, i.version, { clearing_currencies: v }); S.reload(); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };
  const activate = async () => {
    try { await inst.status(i.institution_id, "activate"); toast("Active: the agents now use this profile."); nav("/institution"); }
    catch (e) { toast(e instanceof ApiError ? e.full : String(e)); }
  };

  return (
    <WithChat institutionId={i.institution_id} onTrack={follow} onApplied={applied} at={{ step: cur[0], label: `Step ${idx + 1} · ${cur[1]}` }}><div className="page">
      <PageHead crumbs={<><Link to="/institution">Institution</Link><span>/</span><span>Guided setup</span></>}
        title={<span className="row" style={{ gap: 10 }}>{cur[2]} <StatusBadge status={i.status} /></span>}
        sub={`Step ${idx + 1} of ${STEPS.length} · ${i.name}`}
        actions={<Link className="btn" to="/institution">Leave setup</Link>} />
      <nav className="stepper" aria-label="Setup steps">
        <div className="stepper-top">
          <div className="stepper-bar" role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={done}>
            <span style={{ width: `${(done / STEPS.length) * 100}%` }} /></div>
          <span className="small muted">{done} of {STEPS.length} done</span>
        </div>
        <ol>{STEPS.map(([k, label], n) => (
          <li key={k}><button type="button" aria-current={k === step ? "step" : undefined} title={`Step ${n + 1} · ${label}: ${STATE_WORDS[states[n]]}`}
            onClick={() => nav(`/institution/setup/${k}`)}>
            <StatusIcon status={states[n]} label={`Step ${n + 1}, ${label}: ${STATE_WORDS[states[n]]}`} /><span className="lbl" aria-hidden="true">{label}</span></button></li>))}
        </ol>
      </nav>
      <TwoWays />

      {step === "institution" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>{i.name}</h2><span className="spacer" /><button className="btn btn--sm" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit details</button></div>
          <div className="bd"><div className="kv">
            <div className="k">Type</div><div className="v">{kindText(i)}</div>
            <div className="k">Home</div><div className="v">{profile.place_names[i.home_country] ?? i.home_country} · {i.base_currency} · {i.time_zone}</div>
            <div className="k">Owns risk decisions</div><div className="v">{i.governance_body ?? "—"}</div>
            <div className="k">Summary</div><div className="v">{i.summary ?? "—"}</div>
          </div></div></div>
      </div>}

      {step === "where" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>Add where you operate</h2></div><div className="bd grid2">
          <Field label="Place" hint="Countries, states, provinces or districts."><PlacePicker scope="iso" onPick={p => addFootprint(p.code)} placeholder="e.g. a state, a province or a country" /></Field>
          <Field label="As"><select className="input" value={role} onChange={e => setRole(e.target.value)}>
            {["branches", "subsidiary", "representative_office", "agents", "digital_only", "home"].map(r => <option key={r} value={r}>{r === "home" ? "Home country" : cap(words(r))}</option>)}</select></Field>
        </div></div>
        <div className="card"><div className="bd"><ProfileMap profile={profile} height={340} /></div></div>
        <SectionList section="footprint" ctx={ctx} reload={S.reload} />
        <SectionList section="watch-places" ctx={ctx} reload={S.reload} />
      </div>}

      {step === "customers" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>Usual customer groups for {i.institution_type === "bank" ? "a bank" : "an insurer"}</h2></div>
          <div className="bd"><SuggestionPicker inline section="segments" ctx={ctx} onAdded={S.reload} /></div></div>
        <SectionList section="segments" ctx={ctx} reload={S.reload} />
        <Banner kind="info">Edit each group to say where it is concentrated and how your data identifies it, so checks can look at just that group.</Banner>
      </div>}

      {step === "products" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>What do you offer?</h2></div>
          <div className="bd"><SuggestionPicker inline section="products" ctx={ctx} onAdded={S.reload} /></div></div>
        <SectionList section="products" ctx={ctx} reload={S.reload} />
        <LinkGrid ctx={ctx} rows="products" cols="segments" field="segments" reload={S.reload} title="Who uses which product" />
      </div>}

      {step === "flows" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>Published figures for your footprint</h2></div>
          <div className="bd"><SuggestionPicker inline section="flows" ctx={ctx} onAdded={S.reload} /></div></div>
        <SectionList section="flows" ctx={ctx} reload={S.reload} />
        <LinkGrid ctx={ctx} rows="flows" cols="segments" field="segments" reload={S.reload} title="Which customer groups each flow concerns" />
      </div>}

      {step === "rules" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>Currencies you settle in abroad</h2></div><div className="bd col" style={{ gap: 6 }}>
          <CurrenciesField value={i.clearing_currencies ?? []} onChange={setClearing} />
          <span className="small muted">USD brings US sanctions (OFAC); EUR the EU's; GBP the UK's.</span></div></div>
        <div className="card"><div className="hd"><h2>From the rule table</h2></div>
          <div className="bd"><SuggestionPicker inline section="regulators" ctx={ctx} onAdded={S.reload} /></div></div>
        <SectionList section="regulators" ctx={ctx} reload={S.reload} />
      </div>}

      {step === "rivals" && <div className="col gap16">
        <SectionList section="rivals" ctx={ctx} reload={S.reload} />
        <SectionList section="counterparties" ctx={ctx} reload={S.reload} />
      </div>}

      {step === "risks" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>The risk finder</h2><span className="small muted">known hazards that meet your places, customers, flows and sea routes</span></div>
          <div className="bd"><SuggestionPicker inline section="risk-exposures" ctx={ctx} onAdded={S.reload} /></div></div>
        <SectionList section="risk-exposures" ctx={ctx} reload={S.reload} />
      </div>}

      {step === "monitors" && <MonitorsStep institutionId={i.institution_id} />}

      {step === "review" && <div className="col gap16">
        <div className="card"><div className="bd"><ProfileMap profile={profile} height={320} /></div></div>
        <div className="card"><div className="hd"><h2>Ready to go live?</h2><span className="spacer" />
          {i.status === "setup" && <button className="btn btn--primary" type="button" disabled={!readiness.ready} onClick={activate}>Activate</button>}
          {i.status === "active" && <span className="badge b-ok">ACTIVE</span>}</div>
          <div className="bd"><ReadinessList r={readiness} onFix={s => nav(`/institution/setup/${({ footprint: "where", "watch-places": "where", segments: "customers", products: "products", flows: "flows", regulators: "rules", rivals: "rivals", counterparties: "rivals", "risk-exposures": "risks" } as Record<string, string>)[s] ?? "institution"}`)} /></div></div>
      </div>}

      <div className="row mt24">
        {prev && <button className="btn" type="button" onClick={() => nav(`/institution/setup/${prev}`)}>← Back</button>}
        <span className="spacer" />
        {next && <button className="btn btn--primary" type="button" onClick={() => nav(`/institution/setup/${next}`)}>Next: {STEPS[idx + 1][1]} →</button>}
      </div>
      {editing && <InstitutionModal profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); S.reload(); }} />}
    </div></WithChat>
  );
}
