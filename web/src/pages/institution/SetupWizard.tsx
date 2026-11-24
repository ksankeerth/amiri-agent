// Guided setup without the assistant: the interview's steps as forms. Each step saves as
// it goes (every add is its own all-or-nothing change), so leaving keeps what's done.
import { useContext, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { inst } from "../../api/institutions";
import { Fold, PageTitle, Section, TextButton, TextTabs } from "../../components/rd";
import { askSetupAgent, WithChat } from "../../components/SetupChat";
import { ChatToggleCtx, LoadError, useToast, PageSkeleton, type Status } from "../../components/ui";
import "../../styles/setup.css";
import "../../styles/rd-setup.css";
import { CurrenciesField, Field, PlacePicker } from "./fields";
import { InstitutionModal } from "./forms";
import { CreateInstitution, ReadinessList, useInstitution } from "./InstitutionPage";
import { MAP_KEY } from "./overview";
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
/** A step's state as a shape and a word, never colour alone: ● done · ◐ part still open · ◆ required · ○ not started. */
const MARK: Record<Status, [shape: string, word: string]> = { done: ["●", "Done"], partial: ["◐", "Part open"], required: ["◆", "Required"], open: ["○", "Not started"] };
const STATE_WORDS: Record<Status, string> = { done: "done", partial: "a recommended part is still open", required: "required, not done yet", open: "not started" };

/** The lede under each step's title: what to do here, in one line. */
const LEDE: Record<Step, string> = {
  institution: "Check the basics Amiri Agent starts from. Change them any time with Edit details.",
  where: "Add the countries, states or provinces where you operate. The first one should be your home country.",
  customers: "Pick the customer groups you serve, then say where each is concentrated and how your data identifies it.",
  products: "Pick what you sell, then say which customer groups each product is for.",
  flows: "Money and goods that move between your footprint and places abroad. Each figure shows where it comes from.",
  rules: "Regulators and rules that reach you, from your home country, where you operate and the currencies you settle in.",
  rivals: "Firms you compete with, and firms you depend on to do business.",
  risks: "Known hazards that meet your places, customers, flows and sea routes.",
  monitors: "Watch the news for what your profile says matters. Optional: you can go live without any.",
  review: "Check what is still open, then go live. You can keep changing the profile afterwards.",
};

/** The page's root. Beside the Setup agent's panel the page is about 540 px wide: narrower rules apply then. */
function Root({ children }: { children: ReactNode }) {
  const chat = useContext(ChatToggleCtx);
  return <div className={`page rd rd-inst rd-setup${chat?.open ? " ins-narrow wz-chat" : ""}`}>{children}</div>;
}

/** The two ways to answer a step. Picking "Ask" opens the Setup agent beside the page; "Fill the form" closes it. */
function TwoWays() {
  const chat = useContext(ChatToggleCtx);
  const ask = !!chat?.open;
  return (
    <div className="wz-ways">
      <TextTabs label="Two ways to answer this step" value={ask ? "ask" : "form"}
        items={[{ key: "form", label: "Fill the form" }, { key: "ask", label: "Ask the Setup agent" }]}
        onChange={k => { if (k === "ask") askSetupAgent(); else if (chat?.open) chat.toggle(); }} />
      <p className="rd-fine wz-ways-s">{ask ? "The Setup agent drafts changes for you. Nothing is saved until you press Apply." : "Each change saves as you go."}</p>
    </div>
  );
}

/** The step list. With room it stands beside the form; beside the Setup agent's panel it folds into one line. */
function Steps({ cur, idx, states, done }: { cur: Step; idx: number; states: Status[]; done: number }) {
  const chat = useContext(ChatToggleCtx);
  const list = (
    <>
      <ol>{STEPS.map(([k, label], n) => {
        const [shape, word] = MARK[states[n]];
        return (
          <li key={k} data-s={states[n]}><Link to={`/institution/setup/${k}`} aria-current={k === cur ? "step" : undefined}
            title={`Step ${n + 1}, ${label}: ${STATE_WORDS[states[n]]}`}>
            <span className="wz-shape" aria-hidden="true">{shape}</span>
            <span className="wz-n" aria-hidden="true">{n + 1}</span>
            <span className="wz-l">{label}</span>
            <span className="wz-w"><span className="sr">, </span>{k === "review" ? (states[n] === "done" ? "Ready" : "Not ready") : word}</span>
            {k === cur && <span className="sr">, this step</span>}
          </Link></li>);
      })}</ol>
      <p className="rd-fine wz-key">● done · ◐ part still open · ◆ required · ○ not started</p>
    </>);
  return (
    <nav className="wz-steps" aria-label="Setup steps">
      {chat?.open
        ? <Fold title={`Step ${idx + 1} of ${STEPS.length}: ${STEPS[idx][1]}`} summary={`${done} of ${STEPS.length} done · all steps`}>{list}</Fold>
        : <><p className="wz-prog">{done} of {STEPS.length} steps done</p>{list}</>}
    </nav>
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
  if (S.error != null && !profile) return <div className="page rd"><PageTitle title="Set up your institution" crumbs={<Link to="/institution">Institution</Link>} /><LoadError error={S.error} onRetry={S.reload} what="the institution" /></div>;
  if (S.list === null) return <PageSkeleton />;
  if (!S.list.length || !profile || !readiness) {
    return (
      <WithChat institutionId={null} onTrack={follow} onApplied={applied} at={{ step: "institution", label: `Step 1 · ${STEPS[0][1]}` }}><Root>
        <PageTitle title="Set up your institution" crumbs={<Link to="/institution">Institution</Link>}
          status={<><span>Step 1 of {STEPS.length}</span><span>Who you are</span></>}
          actions={<Link className="rd-tbtn" to="/institution">Leave setup</Link>} />
        <TwoWays />
        <CreateInstitution onCreated={id => { S.select(id); S.reloadList(); nav("/institution/setup/where"); }} />
      </Root></WithChat>
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
  const stateLine = i.status === "active" ? ["Active:", "Amiri Agent uses this profile"] : i.status === "archived" ? ["Archived:", "Amiri Agent does not use this profile"] : ["Being set up:", "Amiri Agent does not use it until it is activated"];
  const goStep = (s: string) => nav(`/institution/setup/${s}`);
  const fixStep = (section: string) => goStep(({ footprint: "where", "watch-places": "where", segments: "customers", products: "products", flows: "flows", regulators: "rules", rivals: "rivals", counterparties: "rivals", "risk-exposures": "risks" } as Record<string, string>)[section] ?? "institution");

  return (
    <WithChat institutionId={i.institution_id} onTrack={follow} onApplied={applied} at={{ step: cur[0], label: `Step ${idx + 1} · ${cur[1]}` }}><Root>
      <PageTitle crumbs={<><Link to="/institution">Institution</Link><span> / </span><span>Guided setup</span></>}
        title={cur[2]}
        status={<>
          <span><b className="ins-state">{stateLine[0]}</b> {stateLine[1]}</span>
          <span>{i.name}</span></>}
        lede={cur[0] === "review" && i.status === "active" ? "The profile is live. Check what is still open; you can keep changing it." : LEDE[cur[0]]}
        actions={<Link className="rd-tbtn" to="/institution">Leave setup</Link>} />

      <div className="wz-layout">
        <Steps cur={cur[0]} idx={idx} states={states} done={done} />

        <div className="wz-body">
          <TwoWays />
          {step === "institution" && <Section title={i.name} action={<TextButton onClick={() => setEditing(true)}>Edit details</TextButton>}>
            <dl className="ins-kv wz-kv">
              <dt>Type</dt><dd>{kindText(i)}</dd>
              <dt>Home</dt><dd>{profile.place_names[i.home_country] ?? i.home_country} · {i.base_currency} · {i.time_zone}</dd>
              <dt>Owns risk decisions</dt><dd>{i.governance_body ?? "—"}</dd>
              <dt>Summary</dt><dd>{i.summary ?? "—"}</dd>
            </dl>
          </Section>}

          {step === "where" && <>
            <Section title="Add where you operate">
              <div className="wz-form grid2">
                <Field label="Place" hint="Countries, states, provinces or districts."><PlacePicker scope="iso" onPick={p => addFootprint(p.code)} placeholder="e.g. a state, a province or a country" /></Field>
                <Field label="As"><select className="input" value={role} onChange={e => setRole(e.target.value)}>
                  {["branches", "subsidiary", "representative_office", "agents", "digital_only", "home"].map(r => <option key={r} value={r}>{r === "home" ? "Home country" : cap(words(r))}</option>)}</select></Field>
              </div>
            </Section>
            <Section title="Your footprint on the map" className="ins-map-sec">
              <ProfileMap profile={profile} height={340} legend={false} />
              <p className="rd-fine ins-key">{MAP_KEY}</p>
            </Section>
            <SectionList rd section="footprint" ctx={ctx} reload={S.reload} />
            <SectionList rd section="watch-places" ctx={ctx} reload={S.reload} />
          </>}

          {step === "customers" && <>
            <Section title={`Usual customer groups for ${i.institution_type === "bank" ? "a bank" : "an insurer"}`}>
              <SuggestionPicker inline section="segments" ctx={ctx} onAdded={S.reload} />
            </Section>
            <SectionList rd section="segments" ctx={ctx} reload={S.reload} />
            <p className="rd-fine rd-prose wz-after">Edit each group to say where it is concentrated and how your data identifies it, so checks can look at just that group.</p>
          </>}

          {step === "products" && <>
            <Section title="What do you offer?">
              <SuggestionPicker inline section="products" ctx={ctx} onAdded={S.reload} />
            </Section>
            <SectionList rd section="products" ctx={ctx} reload={S.reload} />
            <LinkGrid rd ctx={ctx} rows="products" cols="segments" field="segments" reload={S.reload} title="Edit who uses which product" summary="a grid you can tick" />
          </>}

          {step === "flows" && <>
            <Section title="Published figures for your footprint">
              <SuggestionPicker inline section="flows" ctx={ctx} onAdded={S.reload} />
            </Section>
            <SectionList rd section="flows" ctx={ctx} reload={S.reload} />
            <LinkGrid rd ctx={ctx} rows="flows" cols="segments" field="segments" reload={S.reload} title="Edit which customer groups each flow concerns" summary="a grid you can tick" />
          </>}

          {step === "rules" && <>
            <Section title="Currencies you settle in abroad">
              <div className="wz-form"><CurrenciesField value={i.clearing_currencies ?? []} onChange={setClearing} /></div>
              <p className="rd-fine wz-after">USD brings US sanctions (OFAC); EUR the EU's; GBP the UK's.</p>
            </Section>
            <Section title="From the rule table">
              <SuggestionPicker inline section="regulators" ctx={ctx} onAdded={S.reload} />
            </Section>
            <SectionList rd section="regulators" ctx={ctx} reload={S.reload} />
          </>}

          {step === "rivals" && <>
            <SectionList rd section="rivals" ctx={ctx} reload={S.reload} />
            <SectionList rd section="counterparties" ctx={ctx} reload={S.reload} />
          </>}

          {step === "risks" && <>
            <Section title="The risk finder" meta="known hazards that meet your places, customers, flows and sea routes">
              <SuggestionPicker inline section="risk-exposures" ctx={ctx} onAdded={S.reload} />
            </Section>
            <SectionList rd section="risk-exposures" ctx={ctx} reload={S.reload} />
          </>}

          {step === "monitors" && <MonitorsStep institutionId={i.institution_id} />}

          {step === "review" && <>
            <Section title="Your profile on the map" className="ins-map-sec">
              <ProfileMap profile={profile} height={320} legend={false} />
              <p className="rd-fine ins-key">{MAP_KEY}</p>
            </Section>
            <Section title="Ready to go live?" meta={`${readiness.checks.filter(c => c.level === "required" && c.ok).length} of ${readiness.checks.filter(c => c.level === "required").length} required parts done`}>
              <ReadinessList r={readiness} onFix={fixStep} />
            </Section>
          </>}

          <div className="wz-foot">
            <div className="wz-foot-in">
              {prev && <button className="btn" type="button" onClick={() => goStep(prev)}>← Back</button>}
              <span className="wz-foot-s">Step {idx + 1} of {STEPS.length}</span>
              {next && <button className="btn btn--primary" type="button" onClick={() => goStep(next)}>Next: {STEPS[idx + 1][1]} →</button>}
              {!next && i.status === "setup" && <button className="btn btn--primary" type="button" disabled={!readiness.ready}
                title={readiness.ready ? "" : "Required parts are missing"} onClick={activate}>Activate</button>}
            </div>
          </div>
        </div>
      </div>
      {editing && <InstitutionModal profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); S.reload(); }} />}
    </Root></WithChat>
  );
}
