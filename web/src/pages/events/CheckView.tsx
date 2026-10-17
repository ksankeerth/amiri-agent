// One effect checked against the institution's own data: the verdict, the numbers, what it rests on.
import { Link } from "react-router-dom";
import { VERDICT_BADGE, type Check } from "../../api/investigation";
import { day } from "../../format";

const onDay = (d: string) => day(d.length === 10 ? `${d}T12:00:00Z` : d);  // a date: the day it names

export function CheckView({ c, next }: { c: Check; next?: string | null }) {
  const v = c.versions;
  return (
    <div className="ck">
      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge ${VERDICT_BADGE[c.verdict]}`}>{c.verdict_text.toUpperCase()}</span>
        {!c.final && c.verdict !== "error" && <span className="small muted">provisional</span>}
        <span className="small">{c.what}</span>
      </div>
      {c.checks.length > 0 && <ul className="ck-list small">{c.checks.map(x => <li key={x}>{x}</li>)}</ul>}
      {c.supersedes && <div className="small muted">This {c.supersedes.text}.</div>}
      <div className="row wrap small muted" style={{ gap: 6 }}>
        {v.spec && <span className="chip">Spec {v.spec}</span>}
        {v.catalog && <span className="chip">Catalog {v.catalog}</span>}
        {v.data && <span>Data {v.data}</span>}
        {(next ?? c.next_check_after) && <span>· next look {onDay(next ?? c.next_check_after ?? "")}</span>}
        <Link to={c.spec_link}>What this metric means</Link>
      </div>
    </div>
  );
}
