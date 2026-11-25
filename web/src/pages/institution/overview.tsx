// The Institution page's overview: the profile on its map beside what is still open (board 15 section C draws the open part), and
// a short "about". While a profile is being set up the open part is the whole go-live checklist; once it is live, only what is not done.
import { Link } from "react-router-dom";
import type { Profile, Readiness } from "../../api/institutions";
import { useDemoLock } from "../../components/lock";
import { Button } from "../../components/v2/Button";
import { Pill } from "../../components/v2/Pill";
import { SectionHead } from "../../components/v2/SectionHead";
import { dayTime, plural, ZONE_LABEL } from "../../format";
import { ProfileMap } from "./ProfileMap";
import { isSection, liveWords, openWords, readinessRows, viewPath } from "./words";

/** The map's key in one line. The shapes are the map's own: the marks differ in shape and fill, not only colour. */
export const MAP_KEY = "Curved lines: money flows, thicker for bigger ones · filled dots: customer groups · crosses: rivals · rings: places to watch and parts of the footprint · dashed circles: risk areas · dotted lines: sea routes";

function Checks({ readiness, setup, onEdit }: { readiness: Readiness; setup: boolean; onEdit: () => void }) {
  const warns = readiness.warnings;
  const rows = readinessRows(readiness.checks).filter(r => setup || !r.ok);
  const done = readiness.checks.filter(c => c.ok);
  const reqDone = done.filter(c => c.level === "required").length, reqAll = readiness.checks.filter(c => c.level === "required").length;
  const rest = done.length - reqDone;
  const doneSummary = `${reqDone === reqAll ? "everything required" : `${reqDone} of ${reqAll} required`}${rest ? `, and ${rest} recommended` : ""}`;
  return (
    <>
      {rows.length + warns.length === 0 && <p className="v2-in-none">Nothing is open. Every check is done.</p>}
      {(rows.length > 0 || warns.length > 0) && (
        <ul className="v2-in-chk" aria-label={setup ? "Checks before going live" : "Checks still open"}>
          {rows.map(r => (
            <li key={r.id} className={r.ok ? "is-done" : undefined}>
              <span className={`v2-in-chk__shape is-${r.ok ? "done" : r.level}`} aria-hidden="true">{r.shape}</span>
              <span className="v2-in-chk__body">
                <span className="v2-in-chk__t">{setup ? r.text : openWords(readiness.checks.find(c => c.id === r.id)!).title}</span>
                <span className="v2-in-chk__m"><b>{r.word}</b>{!r.ok && r.fix ? ` · ${r.fix}` : ""}</span>
              </span>
              {!r.ok && (r.edit
                ? <Button size="sm" variant="quiet" className="v2-in-chk__go" onClick={onEdit}>Edit details</Button>
                : r.to && <Link className="v2-arrowlink v2-in-chk__go" to={r.to}>{r.level === "info" ? openWords(readiness.checks.find(c => c.id === r.id)!).action : "Fix"}<span aria-hidden="true"> →</span></Link>)}
            </li>))}
          {warns.map((w, k) => (
            <li key={`w${k}`}>
              <span className="v2-in-chk__shape is-recommended" aria-hidden="true">◆</span>
              <span className="v2-in-chk__body"><span className="v2-in-chk__t">{w.message}</span><span className="v2-in-chk__m"><b>Look at it</b></span></span>
              <Link className="v2-arrowlink v2-in-chk__go" to={viewPath(isSection(w.section ?? "") ? (w.section as never) : "overview")}>Look<span aria-hidden="true"> →</span></Link>
            </li>))}
        </ul>)}
      {!setup && done.length > 0 && (
        <details className="v2-in-donefold">
          <summary><span>{done.length} done</span><span className="v2-in-fold__m">{doneSummary}</span></summary>
          <ul className="v2-in-done" aria-label="Checks done">{done.map(c => <li key={c.id}>{c.message}</li>)}</ul>
        </details>)}
    </>
  );
}

/** The overview tab. */
export function Overview({ profile, readiness, setup, mapTitle, onEdit, onActivate }: {
  profile: Profile; readiness: Readiness; setup: boolean; mapTitle: string; onEdit: () => void; onActivate: () => void;
}) {
  const locked = useDemoLock();
  const i = profile.institution, c = i.counts;
  const req = readiness.checks.filter(x => x.level === "required");
  return (
    <div className="v2-in-ov">
      <section className="v2-in-ov__map" aria-labelledby="ov-map">
        <SectionHead title={mapTitle} id="ov-map" />
        <div className="v2-in-map"><ProfileMap profile={profile} height={360} legend={false} /></div>
        <p className="v2-in-key">{MAP_KEY}</p>
      </section>
      <section className="v2-in-ov__open" aria-labelledby="ov-open">
        {setup ? (
          <>
            <div className="v2-in-live">
              <Pill>Setting up</Pill>
              <h2 id="ov-open" className="v2-in-live__t">{liveWords(readiness)}</h2>
              <Button variant="primary" locked={locked} disabled={!readiness.ready} title={readiness.ready ? undefined : "Required parts are missing"} onClick={onActivate}>Activate</Button>
            </div>
            <p className="v2-meta v2-in-open__n">{req.filter(x => x.ok).length} of {req.length} required parts done</p>
          </>
        ) : (
          <SectionHead title="Still open" id="ov-open" meta={<span className="v2-in-sec__meta">{readiness.checks.filter(x => !x.ok).length + readiness.warnings.length} of {readiness.checks.length} checks</span>} />
        )}
        <Checks readiness={readiness} setup={setup} onEdit={onEdit} />
      </section>
      <section className="v2-in-ov__about" aria-labelledby="ov-about">
        <SectionHead title="About this institution" id="ov-about" />
        {i.summary && <p className="v2-in-about__p">{i.summary}</p>}
        <dl className="v2-in-kv">
          <dt>Time zone</dt><dd>{i.time_zone}</dd>
          <dt>Owns risk decisions</dt><dd>{i.governance_body ?? "—"}</dd>
          <dt>Settles abroad in</dt><dd>{i.clearing_currencies?.join(", ") || "—"}</dd>
          <dt>Also in the profile</dt>
          <dd><Link to={viewPath("footprint")}>{plural(c.footprint, "place")} in the footprint</Link>{" · "}<Link to={viewPath("watch-places")}>{plural(c["watch-places"], "place")} to watch</Link>{" · "}
            <Link to={viewPath("counterparties")}>{plural(c.counterparties, "firm")} you depend on</Link></dd>
          <dt>Version</dt><dd>{i.profile_version} · changed {dayTime(i.updated_at)} ({ZONE_LABEL} time)</dd>
        </dl>
        <p className="v2-meta">Amiri Agent reads this profile to decide what matters to you: where you operate, your customers and products, your flows, rules, rivals and risks.</p>
      </section>
    </div>
  );
}
