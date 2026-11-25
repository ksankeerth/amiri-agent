// The Institution page's header parts: the strip of section counters (board 08), the line under it, and the buttons.
import { useRef } from "react";
import { Link } from "react-router-dom";
import type { Readiness, SectionName } from "../../api/institutions";
import { nextTabIndex } from "../../components/v2/tabsNav";
import { emptyNote, countTone, SECTION_STRIP, viewName, viewPath, type View } from "./words";

export const PANEL_ID = "in-panel";
const tabId = (s: string) => `in-tab-${s}`;

/** The nine sections with their counts, as one row of tabs: pick a number to open that part of the profile. An empty part the
 *  profile still needs shows its 0 in amber (red when going live needs it) and the line under the row says so in words. */
export function ProfileStrip({ counts, checks, view, onPick }: {
  counts: Record<SectionName, number>; checks: Readiness["checks"]; view: View; onPick: (s: SectionName) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const at = SECTION_STRIP.findIndex(([k]) => k === view);
  // Picking a part changes the address, and after a change of address the shell moves focus to the page (250 ms later): put it back on
  // the tab, so the arrows keep going along the row.
  const pick = (i: number) => {
    onPick(SECTION_STRIP[i][0]);
    setTimeout(() => list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[i]?.focus({ preventScroll: true }), 420);
  };
  const key = (e: React.KeyboardEvent) => {
    const i = nextTabIndex(e.key, Math.max(0, at), SECTION_STRIP.length);
    if (i === null) return;
    e.preventDefault();
    pick(i);
  };
  return (
    <div className="v2-in-strip" role="tablist" aria-label="Parts of the profile" ref={list} onKeyDown={key}>
      {SECTION_STRIP.map(([k, label], i) => {
        const tone = countTone(k, counts[k] ?? 0, checks);
        const on = k === view;
        return (
          <button key={k} type="button" role="tab" id={tabId(k)} aria-selected={on} aria-controls={on ? PANEL_ID : undefined} tabIndex={on || (at < 0 && i === 0) ? 0 : -1}
            className={`v2-in-tab${on ? " is-on" : ""}`} onClick={() => pick(i)}>
            <span className={`v2-in-tab__n${tone ? ` is-${tone}` : ""}`}>{counts[k] ?? 0}</span>
            <span className="v2-in-tab__l">{label}</span>
            {tone && <span className="v2-sr">{tone === "bad" ? " (empty, needed before going live)" : " (empty, recommended)"}</span>}
          </button>);
      })}
    </div>
  );
}

/** "Flows, rivals and risks are empty. Recommended, not required: …", and the other views: Overview, History, What the agents see. */
export function NoteLine({ counts, checks, view }: { counts: Record<SectionName, number>; checks: Readiness["checks"]; view: View }) {
  const note = emptyNote(counts, checks);
  const link = (v: View) => <Link to={viewPath(v)} aria-current={view === v ? "page" : undefined}>{viewName(v)}</Link>;
  return (
    <div className="v2-in-note">
      {note ? <p className={`v2-in-note__t${note.required ? " is-req" : ""}`}><span className="v2-in-note__dot" aria-hidden="true">●</span> {note.text}</p> : <span />}
      <nav className="v2-in-views" aria-label="Other views of the profile">{link("overview")}<span aria-hidden="true">·</span>{link("history")}<span aria-hidden="true">·</span>{link("agents")}</nav>
    </div>
  );
}

export { tabId };
