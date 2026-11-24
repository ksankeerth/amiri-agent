// The Institution page's overview: the profile at a glance (six figures), the map, and what is still open.
// While a profile is live only the checks not done are shown; while it is being set up, today's full checklist.
import { Fragment } from "react";
import { Link } from "react-router-dom";
import type { Check, Profile, Readiness } from "../../api/institutions";
import { Figures, Fold, Section, TextButton } from "../../components/rd";
import { plural } from "../../format";
import { ProfileMap } from "./ProfileMap";

export const TAB_OF_SECTION: Record<string, string> = {
  footprint: "footprint", "watch-places": "footprint", flows: "footprint", segments: "customers", products: "customers",
  regulators: "rules", rivals: "rivals", counterparties: "rivals", "risk-exposures": "risks", institution: "overview",
};

/** The six figures, each a link to the tab that holds them. */
export function ProfileFigures({ profile }: { profile: Profile }) {
  const c = profile.institution.counts;
  return <Figures label="The profile at a glance" size={34} items={[
    { value: c.segments, label: "customer groups", to: "/institution/customers" },
    { value: c.products, label: "products", to: "/institution/customers" },
    { value: c.flows, label: "money flows", to: "/institution/footprint" },
    { value: c.regulators, label: "regulators", to: "/institution/rules" },
    { value: c.rivals, label: "rivals", to: "/institution/rivals" },
    { value: c["risk-exposures"], label: "known risks", to: "/institution/risks" },
  ]} />;
}

/** The map's key in one line. The shapes are the map's own: the marks differ in shape and fill, not only colour. */
export const MAP_KEY = "Curved lines: money flows, thicker for bigger ones · filled dots: customer groups and rivals · rings: places to watch and parts of the footprint · dashed circles: risk areas · dotted lines: sea routes";

const firstNumber = (m: string, re: RegExp) => { const x = re.exec(m); return x ? Number(x[1]) : null; };

interface OpenCheck { title: string; sub?: string; action: string; to?: string }
/** A check that isn't done, in plain words, with its one action. `to` is missing when the action is "Edit details". */
function openWords(c: Check): OpenCheck {
  switch (c.id) {
    case "regulators": {
      const n = firstNumber(c.message, /(\d+) more suggested/);
      return { title: n ? `Review the ${n} suggested regulators` : "Review the suggested regulators", sub: "from the rule table", action: "Review", to: "/institution/rules" };
    }
    case "risk_exposures": {
      const n = firstNumber(c.message, /finder has (\d+) more/);
      return { title: "Review what the risk finder found", sub: n ? `${plural(n, "more known risk")} to look at` : undefined, action: "Review", to: "/institution/risks" };
    }
    case "flows": return { title: "Review the suggested money flows", sub: c.message, action: "Review", to: "/institution/footprint" };
    case "product_data": {
      const m = /(\d+) of (\d+)/.exec(c.message);
      return { title: "Link products to a data connection", sub: m ? `${m[1]} of ${m[2]} linked: checks need each product's numbers` : c.fix, action: "Link", to: "/institution/customers" };
    }
    default: {
      const tab = TAB_OF_SECTION[c.section] ?? "overview";
      return { title: c.fix || c.message, sub: c.message, action: c.section === "institution" ? "Edit details" : "Fix", to: c.section === "institution" ? undefined : `/institution/${tab}` };
    }
  }
}

function OpenRow({ w, onEdit }: { w: OpenCheck; onEdit?: () => void }) {
  return (
    <li className="rd-row ins-open-row">
      <div className="ins-main"><div className="rd-row-t ins-open-t">{w.title}</div>{w.sub && <p className="rd-row-m">{w.sub}</p>}</div>
      <div className="ins-acts">{w.to ? <Link className="rd-go" to={w.to}>{w.action} →</Link> : onEdit && <TextButton onClick={onEdit}>{w.action}</TextButton>}</div>
    </li>
  );
}

const LEVEL_WORD: Record<string, string> = { required: "Required", recommended: "Recommended", info: "Good to have" };
const ORDER: Record<string, number> = { required: 0, recommended: 1, info: 2 };

/** The right-hand column. */
export function StillOpen({ readiness, setup, onEdit }: { readiness: Readiness; setup: boolean; onEdit: () => void }) {
  const checks = readiness.checks;
  const open = checks.filter(c => !c.ok);
  const done = checks.filter(c => c.ok);
  const warns = readiness.warnings;

  if (setup) {
    const sorted = [...checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]);
    const req = checks.filter(c => c.level === "required");
    return (
      <Section title="Ready to go live?" meta={`${req.filter(c => c.ok).length} of ${req.length} required parts done`} className="ins-open-sec">
        <ul className="ins-rows" aria-label="Checks before going live">{sorted.map(c => {
          const w = openWords(c);
          return (
            <li key={c.id} className="rd-row ins-open-row">
              <div className="ins-main">
                <div className="rd-row-t ins-open-t">{c.message}</div>
                <p className="rd-row-m">{LEVEL_WORD[c.level]} · <b className="ins-k">{c.ok ? "Done" : "Still to do"}</b>{!c.ok && c.fix ? `: ${c.fix}` : ""}</p>
              </div>
              {!c.ok && <div className="ins-acts">{c.section === "institution" ? <TextButton onClick={onEdit}>Edit details</TextButton>
                : <Link className="rd-go" to={w.to ?? "/institution"}>{c.level === "info" ? w.action : "Fix"} →</Link>}</div>}
            </li>);
        })}</ul>
      </Section>
    );
  }

  const reqDone = done.filter(c => c.level === "required").length;
  const reqAll = checks.filter(c => c.level === "required").length;
  const rest = done.length - reqDone;
  const doneSummary = `${reqDone === reqAll ? "everything required" : `${reqDone} of ${reqAll} required`}${rest ? `, and ${rest} recommended` : ""}`;
  return (
    <Section title="Still open" meta={`${open.length + warns.length} of ${checks.length} checks`} className="ins-open-sec">
      {open.length + warns.length === 0 && <p className="rd-row-d ins-none">Nothing is open. Every check is done.</p>}
      {(open.length > 0 || warns.length > 0) && <ul className="ins-rows" aria-label="Checks still open">
        {open.map(c => <OpenRow key={c.id} w={openWords(c)} onEdit={onEdit} />)}
        {warns.map((w, k) => <li key={`w${k}`} className="rd-row ins-open-row">
          <div className="ins-main"><div className="rd-row-t ins-open-t"><span className="rd-warn"><span className="rd-shape rd-t-mixed" aria-hidden="true">◆</span> {w.message}</span></div></div>
          <div className="ins-acts"><Link className="rd-go" to={`/institution/${TAB_OF_SECTION[w.section ?? ""] ?? "overview"}`}>Look →</Link></div></li>)}
      </ul>}
      {done.length > 0 && <Fold title={`${done.length} done`} summary={doneSummary} remember="inst-done">
        <ul className="ins-done" aria-label="Checks done">{done.map(c => <li key={c.id}>{c.message}<span className="rd-fine"> · {LEVEL_WORD[c.level].toLowerCase()}</span></li>)}</ul>
      </Fold>}
    </Section>
  );
}

/** The overview tab: figures, then the map beside what's still open. */
export function Overview({ profile, readiness, setup, mapTitle, onEdit }: {
  profile: Profile; readiness: Readiness; setup: boolean; mapTitle: string; onEdit: () => void;
}) {
  return (
    <Fragment>
      <ProfileFigures profile={profile} />
      <div className="ins-cols">
        <Section title={mapTitle} className="ins-map-sec">
          <ProfileMap profile={profile} height={360} legend={false} />
          <p className="rd-fine ins-key">{MAP_KEY}</p>
        </Section>
        <StillOpen readiness={readiness} setup={setup} onEdit={onEdit} />
      </div>
    </Fragment>
  );
}
