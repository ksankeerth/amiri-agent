// The guided setup (P15b; no board draws it, decision D5: the Institution page's tables, forms and Setup agent, and board 14's steps):
// the interview's ten steps as forms, one at a time, with the Setup agent beside them. /institution/setup is the first step,
// /institution/setup/:step is a step (institution, where, customers, products, flows, rules, rivals, risks, monitors, review).
// Each step saves as it goes (every add is its own all-or-nothing change), so leaving keeps what is done. The last step checks the
// profile and goes live. The step logic is wizardWords.ts (tested); the tables and dialogs are the Institution page's.
//
// Asking, and how often: the list, the profile and its checks once, and again after something saved or a proposal was applied in the
// Setup agent's panel. Nothing polls (the panel looks at its own thread, SetupAgent.tsx).
import { Select } from "../../components/v2/Field";
import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { inst } from "../../api/institutions";
import type { Proposal, TrackDef } from "../../api/assistant";
import { LockFields, useDemoLock } from "../../components/lock";
import { useNow, useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { LoadError } from "../../components/v2/LoadError";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { useCrumbs } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { placeName } from "../../format";
import { cap, words } from "../../plain";
import { MonitorsStep } from "../monitors/step";
import { CurrenciesField, Field, PlacePicker } from "./fields";
import { DetailsDialog } from "./edit";
import { NewInstitutionForm } from "./NewInstitution";
import { MAP_KEY } from "./overview";
import { ProfileMap } from "./ProfileMap";
import { GoLiveDialog, ReviewChecks } from "./review";
import { SetupAgent, SetupAgentButton, useAgentPanel } from "./SetupAgent";
import { LinkGrid, SectionBlock } from "./tables";
import { useInstitution } from "./useInstitution";
import { liveWords, statusLook, typeWords } from "./words";
import { progressLine, requiredLine, STEPS, stepAria, stepIndex, stepMark, stepStates, whyNotLive } from "./wizardWords";
import "../../styles/v2/institution.css";
import "../../styles/v2/setup.css";

const ROLES = ["branches", "subsidiary", "representative_office", "agents", "digital_only", "home"];

/** The ten steps as one row, in order: a dot per step with its number or its state's shape, and a word for the one you are on. A step
 *  is a real link, so the arrows of the browser and Tab both get you anywhere. */
function Steps({ idx, states }: { idx: number; states: ReturnType<typeof stepStates> }) {
  const cur = STEPS[idx];
  return (
    <nav className="v2-sw-nav" aria-label="Setup steps">
      <ol className="v2-sw-steps">
        {STEPS.map((s, n) => {
          const m = stepMark(states[n], s.key);
          return (
            <li key={s.key} className={`is-${states[n]}${n === idx ? " is-cur" : ""}`}>
              <Link to={`/institution/setup/${s.key}`} aria-current={n === idx ? "step" : undefined} aria-label={stepAria(n + 1, s.label, states[n], s.key)} title={`${s.label}: ${m.word.toLowerCase()}`}>
                <span className="v2-sw-dot" aria-hidden="true">{m.shape || n + 1}</span>
                <span className="v2-sw-lbl" aria-hidden="true">{s.label}</span>
              </Link>
            </li>);
        })}
      </ol>
      <p className="v2-sw-where"><b>Step {idx + 1} of {STEPS.length}: {cur.label}</b><span aria-hidden="true"> · </span>{progressLine(states)}</p>
      <p className="v2-sw-key"><span aria-hidden="true">✓</span> done · <span aria-hidden="true">◐</span> part still open · <span aria-hidden="true">◆</span> required · a number: not started</p>
    </nav>
  );
}

export function SetupWizard() {
  const S = useInstitution();
  const { step } = useParams();
  const nav = useNavigate();
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const now = useNow(30_000);
  const panel = useAgentPanel("setup");
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [going, setGoing] = useState(false);
  const [role, setRole] = useState("branches");
  const { profile, readiness, list, loadedAt } = S;
  const idx = stepIndex(step);
  const cur = STEPS[Math.max(0, idx)];

  useCrumbs([{ label: "Your institution" }, ...(profile && idx >= 0 ? [{ label: "Set up", to: "/institution/setup" }, { label: cur.label }] : [{ label: "Set up" }])]);

  const follow = (t: TrackDef) => { if (t.setup_step) nav(`/institution/setup/${t.setup_step}`); };
  const applied = (p: Pick<Proposal, "kind" | "result">) => {
    if (p.kind === "create_institution" && p.result?.institution_id) { S.select(p.result.institution_id); S.reloadList(); }
    else S.reload();
  };
  const id = profile?.institution.institution_id ?? null;
  const agent = <SetupAgent key={id ?? "new"} panel={panel} institutionId={id} onTrack={follow} onApplied={applied}
    at={{ step: cur.key, label: cur.label }} profileVersion={profile?.institution.profile_version ?? null} names={profile?.place_names ?? {}} />;
  const agentBtn = <SetupAgentButton panel={panel} />;
  const shell = (body: ReactNode, withAgent = false) => <div className="v2-in-wrap"><div className="v2-in v2-sw">{body}</div>{withAgent && agent}</div>;
  const plainHead = (sub?: string, btns?: ReactNode) => (
    <header className="v2-in-head"><div className="v2-in-head__t"><h1 className="v2-in-h1">Set up your institution</h1>{sub && <p className="v2-in-sub1">{sub}</p>}</div>
      {btns && <div className="v2-in-head__btns">{btns}</div>}</header>);

  // ---------------------------------------------------------------- loading, failing, nothing yet
  // a failed load is not "no institution yet": say the server didn't answer instead of offering to create one
  if (S.error != null && !profile) return shell(<>{plainHead()}<LoadError error={S.error} onRetry={S.reload} what="the institution" safe="Your profile is safe; this page just couldn't reach it." /></>);
  if (list === null || (list.length > 0 && (!profile || !readiness))) return shell(<>{plainHead()}<Skeleton rows={7} label="Loading the guided setup" /></>);
  if (!list.length || !profile || !readiness) {
    return shell(<>
      {plainHead("Step 1 of 10: who you are. Tell AMIRI Agent what kind of institution you are, then the steps add where you operate, your customers, products, flows, rules, rivals and risks.",
        <><Button as="link" to="/institution">Leave setup</Button>{agentBtn}</>)}
      <NewInstitutionForm onCreated={newId => { S.select(newId); S.reloadList(); nav("/institution/setup/where"); }} />
    </>, true);
  }
  // an address that names no step
  if (idx < 0) return <Navigate to="/institution/setup" replace />;

  const i = profile.institution;
  const r = readiness;
  const states = stepStates(r);
  const next = STEPS[idx + 1], prev = STEPS[idx - 1];
  const setup = i.status === "setup";
  const look = statusLook(i.status);
  const ctx = S.ctx;
  const stale = S.error != null && loadedAt != null;
  const goStep = (s: string) => nav(`/institution/setup/${s}`);
  const why = whyNotLive(r);

  const addFootprint = async (code: string) => {
    try { await inst.create_item(i.institution_id, "footprint", { code, role }); toast("Added to the footprint."); S.reload(); }
    catch (e) { refuse(e, "Couldn't add it"); }
  };
  const setClearing = async (v: string[]) => {
    try { await inst.patch(i.institution_id, i.version, { clearing_currencies: v }); S.reload(); }
    catch (e) { refuse(e, "Couldn't save it"); S.reload(); }
  };
  const activate = async () => {
    setGoing(true);
    try {
      await inst.status(i.institution_id, "activate");
      toast("Active: AMIRI Agent now uses this profile.");
      window.dispatchEvent(new Event("amiri:installation"));
      nav("/institution");
    } catch (e) { refuse(e, "Couldn't go live"); setConfirm(false); }
    finally { setGoing(false); }
  };
  const grid = (rows: "products" | "flows", title: string, summary: string) => <LinkGrid ctx={ctx} rows={rows} cols="segments" field="segments" reload={S.reload} title={title} summary={summary} />;
  const map = (height: number) => (
    <section className="v2-in-sec" aria-labelledby="sw-map">
      <SectionHead title={step === "review" ? "Your profile on the map" : "Your footprint on the map"} id="sw-map" />
      <div className="v2-in-map"><ProfileMap profile={profile} height={height} legend={false} /></div>
      <p className="v2-in-key">{MAP_KEY}</p>
    </section>);

  const lede = cur.key === "review" && !setup ? "The profile is live. Check what is still open; you can keep changing it." : cur.lede;
  const body = (() => {
    switch (cur.key) {
      case "institution": return (
        <section className="v2-in-sec" aria-labelledby="sw-inst">
          <SectionHead title={i.name} id="sw-inst" action={i.status === "archived" ? undefined : <Button locked={locked} onClick={() => setEditing(true)}>Edit details</Button>} />
          <dl className="v2-in-kv v2-sw-kv">
            <dt>Type</dt><dd>{typeWords(i)}</dd>
            <dt>Home</dt><dd>{profile.place_names[i.home_country] ?? placeName(i.home_country)} · {i.base_currency} · {i.time_zone}</dd>
            <dt>Settles abroad in</dt><dd>{i.clearing_currencies?.join(", ") || "—"}</dd>
            <dt>Owns risk decisions</dt><dd>{i.governance_body ?? "—"}</dd>
            <dt>Summary</dt><dd>{i.summary ?? "—"}</dd>
          </dl>
        </section>);
      case "where": return (<>
        <section className="v2-in-sec" aria-labelledby="sw-add">
          <SectionHead title="Add where you operate" id="sw-add" />
          <LockFields><div className="v2-in-form"><div className="grid2">
            <Field label="Place" hint="Countries, states, provinces or districts. Picking one adds it."><PlacePicker scope="iso" onPick={p => addFootprint(p.code)} placeholder="e.g. a state, a province or a country" /></Field>
            <Field label="As"><Select value={role} onChange={e => setRole(e.target.value)}>
              {ROLES.map(x => <option key={x} value={x}>{x === "home" ? "Home country" : cap(words(x))}</option>)}</Select></Field>
          </div></div></LockFields>
        </section>
        {map(320)}
        <SectionBlock section="footprint" ctx={ctx} reload={S.reload} />
        <SectionBlock section="watch-places" ctx={ctx} reload={S.reload} />
      </>);
      case "customers": return <SectionBlock section="segments" ctx={ctx} reload={S.reload} suggest
        note="Edit each group to say where it is concentrated and how your data identifies it, so checks can look at just that group." />;
      case "products": return <SectionBlock section="products" ctx={ctx} reload={S.reload} suggest extra={grid("products", "Edit who uses which product", "a grid you can tick")} />;
      case "flows": return <SectionBlock section="flows" ctx={ctx} reload={S.reload} suggest extra={grid("flows", "Edit which customer groups each flow concerns", "a grid you can tick")} />;
      case "rules": return (<>
        <section className="v2-in-sec" aria-labelledby="sw-cur">
          <SectionHead title="Currencies you settle in abroad" id="sw-cur" />
          <p className="v2-in-sec__note">USD brings US sanctions (OFAC); EUR the EU's; GBP the UK's.</p>
          <LockFields><div className="v2-in-form"><CurrenciesField value={i.clearing_currencies ?? []} onChange={setClearing} /></div></LockFields>
        </section>
        <SectionBlock section="regulators" ctx={ctx} reload={S.reload} suggest />
      </>);
      case "rivals": return (<>
        <SectionBlock section="rivals" ctx={ctx} reload={S.reload} suggest />
        <SectionBlock section="counterparties" ctx={ctx} reload={S.reload} />
      </>);
      case "risks": return <SectionBlock section="risk-exposures" ctx={ctx} reload={S.reload} suggest
        note="The risk finder checks a library of known hazards against your footprint, customer groups, flows and the sea routes your goods take. Code only, no model. Dismiss what doesn't apply and it won't be offered again." />;
      case "monitors": return <MonitorsStep institutionId={i.institution_id} />;
      default: return (<>
        <section className="v2-in-sec" aria-labelledby="sw-live">
          <SectionHead title="Ready to go live?" id="sw-live" meta={<span className="v2-in-sec__meta">{requiredLine(r.checks)}</span>} />
          <p className="v2-sw-live"><Pill tone={r.ready ? "good" : "unusual"} mark={r.ready ? "●" : "◆"}>{r.ready ? "Ready" : "Not ready"}</Pill> <span>{liveWords(r)}</span></p>
          <ReviewChecks readiness={r} onFix={goStep} onEdit={() => setEditing(true)} />
        </section>
        {map(300)}
      </>);
    }
  })();

  return shell(<>
    {stale && <StaleBanner loadedAt={loadedAt!} now={now.getTime()} onRetry={S.reload} />}
    <header className="v2-in-head">
      <div className="v2-in-head__t">
        <div className="v2-in-head__row"><span className="v2-sw-kicker">Guided setup for {i.name}</span><span title={look.hint}><Pill tone={look.tone} mark={look.tone === "good" ? "●" : undefined}>{look.word}</Pill></span></div>
        <h1 className="v2-in-h1 v2-sw-h1">{cur.title}</h1>
        <p className="v2-in-sub1">{lede}</p>
      </div>
      <div className="v2-in-head__btns"><Button as="link" to="/institution">Leave setup</Button>{agentBtn}</div>
    </header>
    <Steps idx={idx} states={states} />
    <p className="v2-meta v2-sw-save">Each change saves as you go, so you can leave and come back. The Setup agent drafts changes too; nothing it drafts is saved until you press Apply.</p>
    <div className="v2-sw-body">{body}</div>
    <div className="v2-sw-foot">
      <div className="v2-sw-foot__in">
        {prev ? <Button as="link" to={`/institution/setup/${prev.key}`}><span aria-hidden="true">←</span> Back</Button> : <span />}
        <span className="v2-meta v2-sw-foot__s">Step {idx + 1} of {STEPS.length}</span>
        {next ? <Button as="link" to={`/institution/setup/${next.key}`} variant="primary">Next: {next.label} <span aria-hidden="true">→</span></Button>
          : setup ? <>
            {why && <span id="sw-why" className="v2-sw-why">{why}</span>}
            <Button variant="primary" locked={locked} className={r.ready ? undefined : "is-idle"} aria-disabled={!r.ready || undefined} aria-describedby={why ? "sw-why" : undefined}
              onClick={() => { if (r.ready) setConfirm(true); }}>Go live</Button></>
          : <Button as="link" to="/institution" variant="primary">Back to the institution</Button>}
      </div>
    </div>

    {editing && <DetailsDialog profile={profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); S.reload(); }} />}
    {confirm && <GoLiveDialog name={i.name} readiness={r} busy={going} onClose={() => setConfirm(false)} onConfirm={activate} />}
  </>, true);
}
