// The Institution page (board 08; states: board 15 section C, board 13 sections 2, 3 and 6): who the institution is and what Amiri
// Agent knows about it, one part of the profile at a time, with the Setup agent beside it. /institution is the overview (the map and what
// is still open); /institution/:part is a section (products, flows, …), the history, or what the agents see. The older names the
// Setup agent still uses (customers, rules, risks) go to their section. The guided setup and the new-institution form are
// NewInstitution.tsx and SetupWizard.tsx.
//
// Asking, and how often: the profile and its checks every 60 s, and not while the tab is hidden; and after something saved. The Setup
// agent's panel looks at its own thread (SetupAgent.tsx).
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { useInstallation } from "../../App";
import { inst, type Item, type Profile } from "../../api/institutions";
import type { Proposal, TrackDef } from "../../api/assistant";
import { useDemoLock } from "../../components/lock";
import { useNow, useRefusalToast, useToast } from "../../components/ui";
import { Button } from "../../components/v2/Button";
import { Empty } from "../../components/v2/Empty";
import { LoadError } from "../../components/v2/LoadError";
import { MoreMenu, type MoreItem } from "../../components/v2/MoreMenu";
import { Pill } from "../../components/v2/Pill";
import { useCrumbs, usePhone } from "../../components/v2/Shell";
import { Skeleton } from "../../components/v2/Skeleton";
import { StaleBanner } from "../../components/v2/StaleBanner";
import { plural, zoneName } from "../../format";
import { placeName } from "../../format";
import { DeleteDialog, ResetDialog } from "./dialogs";
import { DetailsDialog } from "./edit";
import { AgentsView, History } from "./extra";
import { NoteLine, PANEL_ID, ProfileStrip, tabId } from "./head";
import { Overview } from "./overview";
import { downloadJson, pickCreate } from "./profileFile";
import { SetupAgent, useAgentPanel } from "./SetupAgent";
import { LinkGrid, SectionBlock } from "./tables";
import { useInstitution } from "./useInstitution";
import { statusLook, subLine, toReview, topicTab, viewForTopic, viewName, viewOf, viewPath, type View } from "./words";
import { DraftFromProfile } from "../monitors/Monitors";
import "../../styles/v2/institution.css";

const REFRESH_MS = 60_000;

/** The map's takeaway: "Sri Lanka · money moves with 6 places abroad". */
const mapTitle = (p: Profile) => {
  const abroad = new Set(p.sections.flows.map(f => f.counterpart)).size;
  const home = p.place_names[p.institution.home_country] ?? placeName(p.institution.home_country);
  return abroad ? `${home} · money moves with ${plural(abroad, "place")} abroad` : `Where ${p.institution.short_name ?? p.institution.name} operates`;
};

const REGULATOR_NOTE = (i: Profile["institution"]) =>
  `Regulators come from a rule table: your home and other countries, the currencies you settle in abroad (${i.clearing_currencies?.join(", ") || "none set; add them in Edit details"}), and global standards for your type. Your compliance team still needs to review it.`;
const RISK_NOTE = "The risk finder (Suggestions) checks a library of known hazards against your footprint, customer groups, flows and the sea routes your goods take. Code only, no model. Dismiss what doesn't apply and it won't be offered again.";

export function InstitutionPage() {
  const S = useInstitution();
  const { tab } = useParams();
  const view = viewOf(tab);
  const nav = useNavigate();
  const toast = useToast(), refuse = useRefusalToast();
  const locked = useDemoLock();
  const phone = usePhone();
  const now = useNow(30_000);
  const installation = useInstallation();
  const panel = useAgentPanel();
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [drafting, setDrafting] = useState<{ section: string; item_id: string } | null>(null);
  const { profile, readiness, list, loadedAt } = S;
  const shown: View = view ?? "overview";

  useCrumbs([{ label: "Your institution" }, shown === "overview" ? { label: "Institution" } : { label: "Institution", to: "/institution" }, ...(shown === "overview" ? [] : [{ label: viewName(shown) }])]);

  // passive refresh: every 60 s, not while the tab is hidden, and one catch-up when it comes back after a while
  const last = useRef(0);
  last.current = loadedAt ?? 0;
  const { refresh } = S;
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
    const vis = () => { if (!document.hidden && Date.now() - last.current > 30_000) refresh(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [refresh]);

  // the address: an unknown part goes to the overview; an older name (customers, rules, risks) to its section
  if (view === null) return <Navigate to="/institution" replace />;
  if (tab && viewPath(view) !== `/institution/${tab}`) return <Navigate to={viewPath(view)} replace />;

  const follow = (t: { tab: string | null }) => { if (t.tab) nav(viewPath(viewForTopic(t.tab))); };
  const applied = (p: Pick<Proposal, "kind" | "result">) => {
    if (p.kind === "create_institution" && p.result?.institution_id) { S.select(p.result.institution_id); S.reloadList(); }
    else S.reload();
  };
  const names = profile?.place_names ?? {};
  const agent = <SetupAgent panel={panel} institutionId={profile?.institution.institution_id ?? null} onTrack={follow as (t: TrackDef) => void} onApplied={applied}
    at={{ tab: topicTab(shown) }} profileVersion={profile?.institution.profile_version ?? null} names={names} />;
  const agentBtn = !panel.open && <Button onClick={() => panel.setOpen(true)} aria-haspopup={phone ? "dialog" : undefined}>Setup agent</Button>;

  // ---------------------------------------------------------------- loading, failing, nothing yet
  if (S.error != null && !profile) {
    return <div className="v2-in-wrap"><div className="v2-in"><header className="v2-in-head"><h1 className="v2-in-h1">Institution</h1></header>
      <LoadError error={S.error} onRetry={S.reload} what="the institution" safe="Your profile is safe; this page just couldn't reach it." /></div></div>;
  }
  if (list === null || (list.length > 0 && (!profile || !readiness))) {
    return <div className="v2-in-wrap"><div className="v2-in"><header className="v2-in-head"><h1 className="v2-in-h1">Institution</h1></header>
      <Skeleton rows={7} label="Loading the institution" /></div></div>;
  }
  if (!list.length) {
    return (
      <div className="v2-in-wrap">
        <div className="v2-in">
          <header className="v2-in-head"><div className="v2-in-head__t"><h1 className="v2-in-h1">Institution</h1><p className="v2-in-sub1">Not set up yet. Fill in the form, or tell the Setup agent.</p></div>
            <div className="v2-in-head__btns">{agentBtn}</div></header>
          <Empty title="No institution yet" action={<>
            <Button as="link" to="/institution/setup" variant="primary">Guided setup</Button>
            <Button as="link" to="/institution/new">Fill in the form</Button></>}>
            Everything Amiri Agent watches and checks starts from this profile: who you are, where you operate, your customers, products, flows, rules, rivals and risks. The guided setup, the form and the Setup agent all work; you check everything before it is saved.
          </Empty>
        </div>
        {agent}
      </div>);
  }
  const i = profile!.institution;
  const r = readiness!;
  const archived = i.status === "archived";
  const setup = i.status === "setup";
  const look = statusLook(i.status);
  const home = names[i.home_country] ?? placeName(i.home_country);
  const review = toReview(r);
  const stale = S.error != null && loadedAt != null;
  const mine = installation?.institution_id === i.institution_id && !archived;

  const act = async (a: "activate" | "restore") => {
    try { await inst.status(i.institution_id, a); toast(a === "activate" ? "Active: Amiri Agent now uses this profile." : "Restored."); S.reload(); }
    catch (e) { refuse(e, a === "activate" ? "Couldn't activate it" : "Couldn't restore it"); }
  };
  const remove = async () => {
    try { await inst.remove(i.institution_id); toast("Deleted."); setConfirm(false); S.reloadList(); }
    catch (e) { refuse(e, "Couldn't delete it"); setConfirm(false); }
  };
  const more: MoreItem[] = [
    { label: "Export the profile (JSON)", onSelect: () => downloadJson(`${i.institution_id}-profile.json`, { institution: pickCreate(i as any), sections: profile!.sections }) },
    ...(installation?.prototype_reset !== false ? [{ label: "Reset the prototype…", locked, danger: true, onSelect: () => setResetting(true) }] : []),
    ...(setup ? [{ label: "Delete this institution…", locked, danger: true, onSelect: () => setConfirm(true) }] : []),
  ];
  const ctx = S.ctx;
  const grid = (rows: "products" | "flows", title: string, summary: string) => <LinkGrid ctx={ctx} rows={rows} cols="segments" field="segments" reload={S.reload} title={title} summary={summary} />;
  const draftBtn = mine ? { draftable: true, onDraft: (it: Item) => setDrafting({ section: shown, item_id: it.id }) } : {};

  const part = (() => {
    switch (shown) {
      case "overview": return <Overview profile={profile!} readiness={r} setup={setup} mapTitle={mapTitle(profile!)} onEdit={() => setEditing(true)} onActivate={() => act("activate")} />;
      case "history": return <History id={i.institution_id} pv={i.profile_version} onChanged={S.reload} readOnly={archived} names={names} />;
      case "agents": return <AgentsView id={i.institution_id} pv={i.profile_version} names={names} regulators={profile!.sections.regulators} />;
      case "products": return <SectionBlock section="products" ctx={ctx} reload={S.reload} suggest extra={grid("products", "Edit who uses which product", "the same links as the “Customers” column, as a grid you can tick")} />;
      case "flows": return <SectionBlock section="flows" ctx={ctx} reload={S.reload} suggest {...draftBtn} extra={grid("flows", "Edit which customer groups each flow concerns", "a grid you can tick")} />;
      case "segments": return <SectionBlock section="segments" ctx={ctx} reload={S.reload} suggest />;
      case "regulators": return <SectionBlock section="regulators" ctx={ctx} reload={S.reload} suggest {...draftBtn} note={REGULATOR_NOTE(i)} />;
      case "rivals": return <SectionBlock section="rivals" ctx={ctx} reload={S.reload} suggest {...draftBtn} />;
      case "counterparties": return <SectionBlock section="counterparties" ctx={ctx} reload={S.reload} {...draftBtn} />;
      case "risk-exposures": return <SectionBlock section="risk-exposures" ctx={ctx} reload={S.reload} suggest {...draftBtn} note={RISK_NOTE} />;
      default: return <SectionBlock section={shown} ctx={ctx} reload={S.reload} />;
    }
  })();
  const isSectionView = shown !== "overview" && shown !== "history" && shown !== "agents";

  return (
    <div className="v2-in-wrap">
      <div className="v2-in">
        {stale && <StaleBanner loadedAt={loadedAt!} now={now.getTime()} onRetry={S.reload} />}
        <header className="v2-in-head">
          <div className="v2-in-head__t">
            <div className="v2-in-head__row"><h1 className="v2-in-h1">{i.name}</h1><span title={look.hint}><Pill tone={look.tone} mark={look.tone === "good" ? "●" : undefined}>{look.word}</Pill></span></div>
            <p className="v2-in-sub1">{subLine(i, home, zoneName(i.time_zone, now))}</p>
          </div>
          <div className="v2-in-head__btns">
            <Button as="link" to="/institution/setup">Guided setup{review > 0 && <Pill tone="unusual" className="v2-in-pill">{review} to review</Pill>}</Button>
            {!archived && <Button locked={locked} onClick={() => setEditing(true)}>Edit details</Button>}
            <MoreMenu label="More: export, reset or delete" items={more} />
            {agentBtn}
          </div>
        </header>

        {archived && (
          <div className="v2-in-banner" role="status"><span aria-hidden="true">◆</span><span><b>Archived.</b> Amiri Agent does not use this profile and it can't be changed. Restore it to edit.</span>
            <Button variant="primary" size="sm" locked={locked} onClick={() => act("restore")}>Restore</Button></div>)}
        {setup && (!r.ready
          ? <div className="v2-in-banner" role="status"><span aria-hidden="true">◆</span><span><b>{plural(r.missing_required, "required part")} missing</b> before it can go live. <Link className="v2-arrowlink" to="/institution/setup">Continue the guided setup<span aria-hidden="true"> →</span></Link></span></div>
          : shown !== "overview" && <div className="v2-in-banner" role="status"><span aria-hidden="true">●</span><span>Everything required is there. Activate to let Amiri Agent use this profile{r.open_recommendations ? `; ${plural(r.open_recommendations, "recommendation")} still open` : ""}.</span>
              <Button variant="primary" size="sm" locked={locked} onClick={() => act("activate")}>Activate</Button></div>)}

        <ProfileStrip counts={i.counts} checks={r.checks} view={shown} onPick={s => nav(viewPath(s))} />
        <NoteLine counts={i.counts} checks={r.checks} view={shown} />

        <div id={PANEL_ID} className="v2-in-panel" {...(isSectionView ? { role: "tabpanel", "aria-labelledby": tabId(shown) } : { role: "region", "aria-label": viewName(shown) })}>{part}</div>
      </div>
      {agent}

      {drafting && <DraftFromProfile only={drafting} onClose={() => setDrafting(null)} />}
      {editing && <DetailsDialog profile={profile!} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); S.reload(); }} />}
      {resetting && <ResetDialog onClose={() => setResetting(false)} />}
      {confirm && <DeleteDialog name={i.name} onClose={() => setConfirm(false)} onDelete={remove} />}
    </div>
  );
}

