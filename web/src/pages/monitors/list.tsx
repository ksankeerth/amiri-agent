// The monitors list (board 06): groups under caps headings (Waiting for approval, Live, Paused, Drafts, Retired), each
// monitor a real link with its name, its question's owner, how often it checks, the last check and the findings in 30 days.
// The open one is marked with a bar and aria-current. "▸ N more live" and "▸ N retired" hold the rest.
import { Link } from "react-router-dom";
import type { MonitorRow } from "../../api/monitors";
import { Count } from "../../components/v2/Count";
import { Pill } from "../../components/v2/Pill";
import { ago } from "../../format";
import { GROUP_ORDER, GROUP_TITLE, liveShown, rowLine, rowPill, type GroupId, type Groups } from "./words";

interface RowProps { m: MonitorRow; group: GroupId; on: boolean; now: Date }

function Row({ m, group, on, now }: RowProps) {
  const line = rowLine(m, now, iso => ago(iso, now));
  const pill = rowPill(m, group);
  const late = m.review_due;
  return (
    <li>
      <Link id={`mn-row-${m.monitor_id}`} to={`/monitors/${m.monitor_id}`} className={`v2-rowlink v2-mn-row${on ? " is-on" : ""}`} aria-current={on ? "true" : undefined}>
        <span className="v2-mn-row__top">
          <span className="v2-mn-row__name">{m.name}</span>
          {pill && <Pill tone={pill.tone} dashed={pill.dashed}>{pill.label}</Pill>}
        </span>
        <span className="v2-mn-row__meta">
          {line.lead}
          {line.count !== null && <> · <b className="v2-num">{line.count}</b> in 30 days</>}
          {late && <> · <span className="v2-mn-row__review"><span aria-hidden="true">◆ </span>Review due</span></>}
        </span>
      </Link>
    </li>
  );
}

export interface MonitorListProps {
  groups: Groups;
  selectedId: string | null;
  now: Date;
  liveOpen: boolean;
  onLiveOpen: () => void;
  retiredOpen: boolean;
  onRetiredToggle: () => void;
}
export function MonitorList({ groups, selectedId, now, liveOpen, onLiveOpen, retiredOpen, onRetiredToggle }: MonitorListProps) {
  return (
    <nav className="v2-mn-list" aria-label="Monitors">
      {GROUP_ORDER.map(g => {
        const xs = groups[g];
        if (!xs.length) return null;
        const id = `mn-g-${g}`;
        if (g === "retired") {
          return (
            <section key={g} aria-labelledby={id} className="v2-mn-group">
              <h2 id={id} className="v2-sr">{GROUP_TITLE[g]}</h2>
              <button type="button" className="v2-mn-more" aria-expanded={retiredOpen} aria-controls="mn-retired" onClick={onRetiredToggle}>
                {retiredOpen ? "Hide retired" : `${xs.length} retired`}
              </button>
              {retiredOpen && <ul id="mn-retired" className="v2-mn-rows">{xs.map(m => <Row key={m.monitor_id} m={m} group={g} on={m.monitor_id === selectedId} now={now} />)}</ul>}
            </section>
          );
        }
        const { shown, hidden } = g === "live" ? liveShown(xs, selectedId, liveOpen) : { shown: xs, hidden: 0 };
        return (
          <section key={g} aria-labelledby={id} className="v2-mn-group">
            <h2 id={id} className="v2-cap v2-mn-gh">{GROUP_TITLE[g]}<Count n={xs.length} /></h2>
            <ul className="v2-mn-rows">{shown.map(m => <Row key={m.monitor_id} m={m} group={g} on={m.monitor_id === selectedId} now={now} />)}</ul>
            {hidden > 0 && (
              <button type="button" className="v2-mn-more" aria-expanded="false" onClick={onLiveOpen}>{hidden} more live</button>
            )}
          </section>
        );
      })}
    </nav>
  );
}
