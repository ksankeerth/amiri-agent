// Guided setup without the assistant: the interview's steps as forms. Each step saves as
// it goes (every add is its own all-or-nothing change), so leaving keeps what's done.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { inst } from "../../api/institutions";
import { Icon } from "../../components/Icon";
import { WithChat } from "../../components/SetupChat";
import { Banner, PageHead, useToast, PageSkeleton } from "../../components/ui";
import { CurrenciesField, Field, PlacePicker } from "./fields";
import { InstitutionModal } from "./forms";
import { CreateInstitution, ReadinessList, StatusBadge, useInstitution } from "./InstitutionPage";
import { ProfileMap } from "./ProfileMap";
import { MonitorsStep } from "../monitors/Monitors";
import { LinkGrid, SectionList, SuggestionPicker } from "./sections";

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
  if (S.list === null) return <PageSkeleton />;
  if (!S.list.length || !profile || !readiness) {
    return (
      <WithChat institutionId={null} onTrack={follow} onApplied={applied}><div className="page">
        <PageHead title="Set up your institution" sub="Step 1 of 9 · Who you are" crumbs={<Link to="/institution">Institution</Link>} />
        <CreateInstitution onCreated={id => { S.select(id); S.reloadList(); nav("/institution/setup/where"); }} />
      </div></WithChat>
    );
  }
  const i = profile.institution;
  const ok = (ids: string[] | undefined) => (ids ?? []).every(id => readiness.checks.find(c => c.id === id)?.ok);
  const stepState = (s: Step) => (s === "review" ? (readiness.ready ? "done" : "todo")
    : !ok(REQUIRED_BY_STEP[s]) ? "todo" : ok(RECOMMENDED_BY_STEP[s]) ? "done" : "partial");
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
    <WithChat institutionId={i.institution_id} onTrack={follow} onApplied={applied}><div className="page">
      <PageHead crumbs={<><Link to="/institution">Institution</Link><span>/</span><span>Guided setup</span></>}
        title={<span className="row" style={{ gap: 10 }}>{cur[2]} <StatusBadge status={i.status} /></span>}
        sub={`Step ${idx + 1} of ${STEPS.length} · ${i.name} · each change is saved as you make it`}
        actions={<Link className="btn" to="/institution">Leave setup</Link>} />
      <div className="tabs" role="tablist">
        {STEPS.map(([k, label], n) => {
          const st = stepState(k);
          return <button key={k} type="button" role="tab" aria-selected={k === step} onClick={() => nav(`/institution/setup/${k}`)}>
            <span className={`statusdot ${st === "done" ? "sd-ok" : st === "partial" ? "sd-warn" : REQUIRED_BY_STEP[k] ? "sd-down" : "sd-off"}`} />{n + 1}. {label}</button>;
        })}
      </div>

      {step === "institution" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>{i.name}</h2><span className="spacer" /><button className="btn btn--sm" type="button" onClick={() => setEditing(true)}><Icon name="edit" />Edit details</button></div>
          <div className="bd"><div className="kv">
            <div className="k">Type</div><div className="v">{i.institution_type}{i.subtype ? ` · ${i.subtype}` : ""}{i.islamic ? " · Islamic" : ""}</div>
            <div className="k">Home</div><div className="v">{profile.place_names[i.home_country] ?? i.home_country} · {i.base_currency} · {i.time_zone}</div>
            <div className="k">Owns risk decisions</div><div className="v">{i.governance_body ?? "—"}</div>
            <div className="k">Summary</div><div className="v">{i.summary ?? "—"}</div>
          </div></div></div>
      </div>}

      {step === "where" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>Add where you operate</h2></div><div className="bd grid2">
          <Field label="Place" hint="Countries, states, provinces or districts."><PlacePicker scope="iso" onPick={p => addFootprint(p.code)} placeholder="e.g. Kerala, Tamil Nadu, Singapore" /></Field>
          <Field label="As"><select className="input" value={role} onChange={e => setRole(e.target.value)}>
            {["branches", "subsidiary", "representative_office", "agents", "digital_only", "home"].map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></Field>
        </div></div>
        <div className="card"><div className="bd"><ProfileMap profile={profile} height={340} /></div></div>
        <SectionList section="footprint" ctx={ctx} reload={S.reload} />
        <SectionList section="watch-places" ctx={ctx} reload={S.reload} />
      </div>}

      {step === "customers" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>Usual customer groups for {i.institution_type === "bank" ? "a bank" : "an insurer"}</h2></div>
          <div className="bd"><SuggestionPicker inline section="segments" ctx={ctx} onAdded={S.reload} /></div></div>
        <SectionList section="segments" ctx={ctx} reload={S.reload} />
        <Banner kind="info">Edit each group to say where it is concentrated and how your data identifies it (a Metrics Spec value), so checks can look at just that group.</Banner>
      </div>}

      {step === "products" && <div className="col gap16">
        <div className="card"><div className="hd"><h2>What do you offer? (Metrics Spec product types)</h2></div>
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
        <div className="card"><div className="bd"><ProfileMap profile={profile} /></div></div>
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
